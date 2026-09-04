import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createExecutorWorkerServer } from "./worker.js";
import type { ExecutorService } from "./service.js";

function required(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = env[name]?.trim();
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}
function bounded(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  max: number,
): number {
  const value = Number(env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new Error(`${name} is invalid`);
  return value;
}
function moduleUrl(specifier: string): string {
  return isAbsolute(specifier) || /^[A-Za-z]:[\\/]/u.test(specifier)
    ? pathToFileURL(specifier).href
    : pathToFileURL(resolve(process.cwd(), specifier)).href;
}
function assertService(value: unknown): ExecutorService {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof (value as { simulateAuthorizedPayment?: unknown })
      .simulateAuthorizedPayment !== "function" ||
    typeof (value as { executeAuthorizedPayment?: unknown })
      .executeAuthorizedPayment !== "function"
  )
    throw new Error("Configured executor service is invalid");
  return value as ExecutorService;
}

export type RunningExecutorWorker = Readonly<{
  server: ReturnType<typeof createExecutorWorkerServer>;
  close: () => Promise<void>;
}>;

/** Starts the executor as a separately deployable process. The service module
 * is deployment-owned and is the only place where Circle/provider credentials
 * and any isolated signer material are assembled. */
export async function startExecutorWorker(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<RunningExecutorWorker> {
  const serviceModule = required(env, "COVENANT_EXECUTOR_SERVICE_MODULE");
  const token = required(env, "COVENANT_EXECUTOR_WORKER_AUTH_TOKEN");
  const loaded = (await import(moduleUrl(serviceModule))) as {
    default?: unknown;
  } & Record<string, unknown>;
  const service = assertService(loaded.default ?? loaded);
  const server = createExecutorWorkerServer({
    service,
    authToken: token,
    maxBodyBytes: bounded(
      env,
      "COVENANT_EXECUTOR_MAX_BODY_BYTES",
      262_144,
      262_144,
    ),
    requestTimeoutMs: bounded(
      env,
      "COVENANT_EXECUTOR_REQUEST_TIMEOUT_MS",
      30_000,
      120_000,
    ),
  });
  const host = env.COVENANT_EXECUTOR_WORKER_HOST?.trim() ?? "0.0.0.0";
  const port = bounded(env, "COVENANT_EXECUTOR_WORKER_PORT", 8788, 65_535);
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolveListen();
    });
  });
  let closed = false;
  return {
    server,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolveClose, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolveClose();
        });
      });
    },
  };
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  void startExecutorWorker()
    .then((running) => {
      process.stdout.write("Covenant executor worker listening\n");
      const shutdown = () => {
        void running.close().finally(() => process.exit(0));
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
