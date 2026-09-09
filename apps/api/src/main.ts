import { pathToFileURL } from "node:url";
import { isAbsolute, resolve } from "node:path";
import {
  DurableExecutionRuntime,
  DurableRuntimeStore,
  type RuntimeStore,
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

type ReadyResolver = Resolver &
  Readonly<{ checkReady?: () => Promise<boolean> }>;

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

function assertResolver(value: unknown): ReadyResolver {
  if (typeof value !== "function")
    throw new Error("Configured evidence resolver is invalid.");
  const resolver = value as ReadyResolver;
  if (
    resolver.checkReady !== undefined &&
    typeof resolver.checkReady !== "function"
  )
    throw new Error("Configured evidence resolver is invalid.");
  return resolver;
}

function assertStore(value: unknown): RuntimeStore {
  if (value === null || typeof value !== "object")
    throw new Error("Configured database store is invalid.");
  const required = [
    "close",
    "checkReady",
    "saveCovenant",
    "getCovenant",
    "saveAuthorizationEvidence",
    "getAuthorizationEvidence",
    "getOperation",
    "createOrJoinOperation",
    "claimOperation",
    "renewLease",
    "releaseLease",
    "recoverExpiredLeases",
    "transitionLeased",
    "updateCovenantAndOperation",
    "listOutbox",
    "markOutboxDelivered",
    "ensureDeveloperProject",
    "getDeveloperProject",
    "saveApiKey",
    "findApiKeyCandidates",
    "listApiKeys",
    "revokeApiKey",
    "replaceCovenantProjection",
    "listCovenants",
    "getOperationByExecution",
    "getHttpIdempotency",
    "saveHttpIdempotency",
    "deleteHttpIdempotency",
    "createWebhookEndpoint",
    "getWebhookEndpoint",
    "listWebhookEndpoints",
    "revokeWebhookEndpoint",
    "createWebhookDelivery",
    "listWebhookDeliveries",
    "updateWebhookDelivery",
  ] as const;
  if (
    required.some(
      (name) => typeof (value as Record<string, unknown>)[name] !== "function",
    )
  )
    throw new Error("Configured database store is invalid.");
  return value as RuntimeStore;
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
  if (resolver?.checkReady !== undefined && !(await resolver.checkReady()))
    throw new Error("Authorization verifier is not ready.");
  let store: RuntimeStore;
  if (config.databaseDriver === "postgres") {
    const databaseModule = config.databaseModule;
    if (!databaseModule) {
      throw new Error("Postgres database module is required");
    }
    const configured = await loadConfiguredModule<unknown>(
      databaseModule,
      "Database store",
    );
    store = assertStore(configured);
  } else {
    store = new DurableRuntimeStore({ filename: config.databaseFilename });
  }
  if (!(await store.checkReady())) {
    await store.close();
    throw new Error("Database store is not ready.");
  }
  const runtime = new DurableExecutionRuntime({ store, adapter });
  const api = new CovenantApi({
    runtime,
    webhookMasterKey: config.webhookMasterKey,
    ...(resolver === undefined
      ? {}
      : { authorizationContextResolver: resolver }),
    rateLimits: config.rateLimits,
    readinessCheck: async () => {
      const configured =
        config.mode === "test" ||
        (resolver !== undefined && config.executionAdapterModule !== undefined);
      if (!configured) return false;
      return resolver?.checkReady === undefined ? true : resolver.checkReady();
    },
  });
  const server = createHttpServer(api, {
    allowedOrigins: config.corsAllowedOrigins,
    maxBodyBytes: config.maxBodyBytes,
    requestTimeoutMs: config.requestTimeoutMs,
    headersTimeoutMs: config.headersTimeoutMs,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, config.host, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await store.close();
    throw error;
  }
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
  const shutdown = async () => {
    try {
      await running.close();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  };
  // The listener owns the full awaited shutdown and handles all failures.
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  process.once("SIGINT", shutdown);
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  process.once("SIGTERM", shutdown);
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
)
  void main().catch(() => (process.exitCode = 1));
