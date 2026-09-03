import { pathToFileURL } from "node:url";
import { isAbsolute, resolve } from "node:path";
import {
  DurableExecutionRuntime,
  DurableRuntimeStore,
  type ExecutionAdapter,
} from "@covenant/runtime";
import { CovenantApi, createHttpServer, gracefulShutdown } from "./server.js";
import {
  loadApiDeploymentConfig,
  type ApiDeploymentConfig,
} from "./configuration.js";
import type {
  AuthorizationVerificationContext,
  PlatformCovenant,
} from "@covenant/core";

type Resolver = (
  projectId: string,
  covenant: PlatformCovenant,
) =>
  | AuthorizationVerificationContext
  | undefined
  | Promise<AuthorizationVerificationContext | undefined>;

const SAFE_TEST_ADAPTER: ExecutionAdapter = Object.freeze({
  simulate: () =>
    Promise.resolve({
      status: "NO_SUBMISSION" as const,
      reason: "No execution adapter configured",
    }),
  submit: () =>
    Promise.resolve({
      status: "NO_SUBMISSION" as const,
      reason: "No execution adapter configured",
    }),
});

function importSpecifier(specifier: string): string {
  if (isAbsolute(specifier) || /^[A-Za-z]:[\\/]/u.test(specifier))
    return pathToFileURL(specifier).href;
  if (specifier.startsWith("./") || specifier.startsWith("../"))
    return pathToFileURL(resolve(process.cwd(), specifier)).href;
  return specifier;
}

async function loadConfiguredModule<T>(
  specifier: string,
  label: string,
): Promise<T> {
  try {
    const loaded = (await import(importSpecifier(specifier))) as {
      default?: unknown;
    } & Record<string, unknown>;
    const value = loaded.default ?? loaded;
    return value as T;
  } catch {
    throw new Error(`${label} could not be loaded.`);
  }
}

function assertAdapter(value: unknown): ExecutionAdapter {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof (value as { simulate?: unknown }).simulate !== "function" ||
    typeof (value as { submit?: unknown }).submit !== "function"
  )
    throw new Error("Configured execution adapter is invalid.");
  return value as ExecutionAdapter;
}

function assertResolver(value: unknown): Resolver {
  if (typeof value !== "function")
    throw new Error("Configured evidence resolver is invalid.");
  return value as Resolver;
}

export type RunningApi = Readonly<{
  config: ApiDeploymentConfig;
  api: CovenantApi;
  server: ReturnType<typeof createHttpServer>;
  close: () => Promise<void>;
}>;

export async function startApiServer(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<RunningApi> {
  const config = loadApiDeploymentConfig(env);
  const adapter =
    config.executionAdapterModule === undefined
      ? SAFE_TEST_ADAPTER
      : assertAdapter(
          await loadConfiguredModule<unknown>(
            config.executionAdapterModule,
            "Execution adapter",
          ),
        );
  const resolver =
    config.authorizationResolverModule === undefined
      ? undefined
      : assertResolver(
          await loadConfiguredModule<unknown>(
            config.authorizationResolverModule,
            "Authorization resolver",
          ),
        );
  const store = new DurableRuntimeStore({ filename: config.databaseFilename });
  const runtime = new DurableExecutionRuntime({ store, adapter });
  const api = new CovenantApi({
    runtime,
    webhookMasterKey: config.webhookMasterKey,
    ...(resolver === undefined
      ? {}
      : { authorizationContextResolver: resolver }),
    rateLimits: config.rateLimits,
    readinessCheck: () =>
      config.mode === "test" ||
      (resolver !== undefined && config.executionAdapterModule !== undefined),
  });
  const server = createHttpServer(api, {
    allowedOrigins: config.corsAllowedOrigins,
    maxBodyBytes: config.maxBodyBytes,
    requestTimeoutMs: config.requestTimeoutMs,
    headersTimeoutMs: config.headersTimeoutMs,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await gracefulShutdown(server, api);
  };
  return { config, api, server, close };
}

async function main(): Promise<void> {
  const running = await startApiServer();
  process.stdout.write(
    `Covenant API listening on ${running.config.host}:${String(running.config.port)}\n`,
  );
  const shutdown = () => {
    void running.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
)
  void main().catch(() => (process.exitCode = 1));
