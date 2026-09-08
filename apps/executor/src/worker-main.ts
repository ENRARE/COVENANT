import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createExecutorWorkerServer } from "./worker.js";
import type { ExecutorService } from "./service.js";

type ClosableExecutorService = ExecutorService & {
  close?: () => Promise<void>;
};

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
function assertService(value: unknown): ClosableExecutorService {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof (value as { simulateAuthorizedPayment?: unknown })
      .simulateAuthorizedPayment !== "function" ||
    typeof (value as { executeAuthorizedPayment?: unknown })
      .executeAuthorizedPayment !== "function"
  )
    throw new Error("Configured executor service is invalid");
  return value as ClosableExecutorService;
}

/** Never print loader paths, environment values, or provider error text. */
export function sanitizedStartupErrorCategory(
  error: unknown,
): "CONFIGURATION" | "STARTUP_FAILURE" {
  if (
    error instanceof Error &&
    error.name === "ExecutorDeploymentConfigurationError"
  )
    return "CONFIGURATION";
  return "STARTUP_FAILURE";
}

export type RunningExecutorWorker = Readonly<{
  server: ReturnType<typeof createExecutorWorkerServer>;
  close: () => Promise<void>;
}>;

type ShutdownSignalTarget = Readonly<{
  once: (event: "SIGINT" | "SIGTERM", listener: () => void) => unknown;
}>;

/** Installs one-shot handlers while keeping process termination testable. */
export function installExecutorWorkerShutdownHandlers(
  running: RunningExecutorWorker,
  target: ShutdownSignalTarget = process,
  exit: (code: number) => unknown = (code) => process.exit(code),
): void {
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => {
    shutdownPromise ??= running.close().then(
      () => {
        exit(0);
      },
      () => {
        exit(1);
      },
    );
  };
  target.once("SIGINT", shutdown);
  target.once("SIGTERM", shutdown);
}

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
  try {
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.removeListener("error", reject);
        resolveListen();
      });
    });
  } catch (error) {
    await service.close?.();
    throw error;
  }
  let closePromise: Promise<void> | undefined;
  return {
    server,
    close: () => {
      closePromise ??= (async () => {
        try {
          await new Promise<void>((resolveClose, reject) => {
            server.close((error) => {
              if (error) reject(error);
              else resolveClose();
            });
          });
        } finally {
          await service.close?.();
        }
      })();
      return closePromise;
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
      installExecutorWorkerShutdownHandlers(running);
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `Covenant executor worker startup failed: ${sanitizedStartupErrorCategory(error)}\n`,
      );
      process.exitCode = 1;
    });
}
