import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_USDC_INTERFACE,
} from "@covenant/config";

export type ApiRunMode = "test" | "deployment";

export type ApiRateLimits = Readonly<{
  authentication: Readonly<{ limit: number; windowMs: number }>;
  mutations: Readonly<{ limit: number; windowMs: number }>;
  evidence: Readonly<{ limit: number; windowMs: number }>;
}>;

export type ApiDeploymentConfig = Readonly<{
  mode: ApiRunMode;
  databaseDriver: "sqlite" | "postgres";
  host: string;
  port: number;
  databaseFilename: string;
  databaseUrl: string | undefined;
  databaseModule: string | undefined;
  webhookMasterKey: Uint8Array;
  authorizationResolverModule: string | undefined;
  executionAdapterModule: string | undefined;
  arcRpcUrl: "https://rpc.testnet.arc.network";
  arcChainId: typeof ARC_TESTNET_CHAIN_ID;
  usdcAddress: typeof ARC_TESTNET_USDC_INTERFACE;
  corsAllowedOrigins: readonly string[];
  requestTimeoutMs: number;
  headersTimeoutMs: number;
  maxBodyBytes: number;
  rateLimits: ApiRateLimits;
}>;

export class ApiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiConfigurationError";
  }
}

const ARC_RPC = "https://rpc.testnet.arc.network" as const;
const DEFAULT_LIMITS: ApiRateLimits = Object.freeze({
  authentication: { limit: 30, windowMs: 60_000 },
  mutations: { limit: 60, windowMs: 60_000 },
  evidence: { limit: 20, windowMs: 60_000 },
});

function required(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = env[name]?.trim();
  if (value === undefined || value.length === 0)
    throw new ApiConfigurationError(`${name} is required.`);
  return value;
}

function boundedInteger(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name]?.trim();
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new ApiConfigurationError(
      `${name} must be an integer between ${String(min)} and ${String(max)}.`,
    );
  return value;
}

function decodeMasterKey(value: string): Uint8Array {
  const text = value.trim();
  const hex = text.startsWith("hex:") ? text.slice(4) : text;
  if (/^[0-9a-f]{64}$/iu.test(hex))
    return Uint8Array.from(Buffer.from(hex, "hex"));
  const encoded = text.startsWith("base64:") ? text.slice(7) : text;
  try {
    const bytes = Buffer.from(encoded, "base64url");
    if (
      bytes.length === 32 &&
      bytes.toString("base64url") === encoded.replace(/=+$/u, "")
    )
      return Uint8Array.from(bytes);
  } catch {
    /* fall through to the non-secret validation error */
  }
  throw new ApiConfigurationError(
    "COVENANT_WEBHOOK_MASTER_KEY must encode exactly 32 bytes (hex or base64url).",
  );
}

function origins(value: string | undefined): readonly string[] {
  if (value === undefined || value.trim() === "") return [];
  const result = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const origin of result) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new ApiConfigurationError(
        "COVENANT_CORS_ORIGINS contains an invalid origin.",
      );
    }
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      !["https:", "http:"].includes(parsed.protocol)
    )
      throw new ApiConfigurationError(
        "COVENANT_CORS_ORIGINS must contain origins without paths or credentials.",
      );
    if (
      parsed.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    )
      throw new ApiConfigurationError("Non-local CORS origins must use HTTPS.");
  }
  return Object.freeze(result);
}

function positiveLimit(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
): number {
  return boundedInteger(env, name, fallback, 1, 100_000);
}

function optionalValue(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

export function loadApiDeploymentConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ApiDeploymentConfig {
  const mode = env.COVENANT_MODE?.trim();
  if (mode === undefined || mode === "")
    throw new ApiConfigurationError(
      "COVENANT_MODE must be explicitly set to test or deployment.",
    );
  if (mode !== "test" && mode !== "deployment")
    throw new ApiConfigurationError(
      "COVENANT_MODE must be test or deployment.",
    );
  const webhookMasterKey = decodeMasterKey(
    required(env, "COVENANT_WEBHOOK_MASTER_KEY"),
  );
  const databaseDriver = env.COVENANT_DATABASE_DRIVER?.trim() ?? "sqlite";
  if (databaseDriver !== "sqlite" && databaseDriver !== "postgres")
    throw new ApiConfigurationError(
      "COVENANT_DATABASE_DRIVER must be sqlite or postgres.",
    );
  const databaseUrl = optionalValue(env, "COVENANT_DATABASE_URL");
  const databaseModule = optionalValue(env, "COVENANT_DATABASE_MODULE");
  if (databaseDriver === "postgres" && databaseModule === undefined)
    throw new ApiConfigurationError(
      "COVENANT_DATABASE_MODULE is required for the postgres driver.",
    );
  if (databaseDriver === "postgres" && databaseUrl === undefined)
    throw new ApiConfigurationError(
      "COVENANT_DATABASE_URL is required for the postgres driver.",
    );
  const databaseFilename =
    env.COVENANT_DATABASE_FILENAME?.trim() ??
    (mode === "test"
      ? ":memory:"
      : databaseDriver === "sqlite"
        ? ""
        : ":postgres:");
  if (databaseDriver === "sqlite" && databaseFilename.length === 0)
    throw new ApiConfigurationError(
      "COVENANT_DATABASE_FILENAME is required for the sqlite driver.",
    );
  const arcRpcUrl = env.COVENANT_ARC_RPC_URL?.trim() ?? ARC_RPC;
  if (arcRpcUrl !== ARC_RPC)
    throw new ApiConfigurationError(
      "Only the reviewed Arc Testnet RPC is supported.",
    );
  const authorizationResolverModule = optionalValue(
    env,
    "COVENANT_AUTHORIZATION_RESOLVER_MODULE",
  );
  const executionAdapterModule = optionalValue(
    env,
    "COVENANT_EXECUTION_ADAPTER_MODULE",
  );
  if (mode === "deployment" && authorizationResolverModule === undefined)
    throw new ApiConfigurationError(
      "COVENANT_AUTHORIZATION_RESOLVER_MODULE is required in deployment mode.",
    );
  if (mode === "deployment" && executionAdapterModule === undefined)
    throw new ApiConfigurationError(
      "COVENANT_EXECUTION_ADAPTER_MODULE is required in deployment mode.",
    );
  return Object.freeze({
    mode,
    databaseDriver,
    host: optionalValue(env, "COVENANT_API_HOST") ?? "127.0.0.1",
    port: boundedInteger(env, "COVENANT_API_PORT", 8787, 1, 65_535),
    databaseFilename,
    databaseUrl,
    databaseModule,
    webhookMasterKey,
    authorizationResolverModule,
    executionAdapterModule,
    arcRpcUrl: ARC_RPC,
    arcChainId: ARC_TESTNET_CHAIN_ID,
    usdcAddress: ARC_TESTNET_USDC_INTERFACE,
    corsAllowedOrigins: origins(env.COVENANT_CORS_ORIGINS),
    requestTimeoutMs: boundedInteger(
      env,
      "COVENANT_REQUEST_TIMEOUT_MS",
      30_000,
      1_000,
      120_000,
    ),
    headersTimeoutMs: boundedInteger(
      env,
      "COVENANT_HEADERS_TIMEOUT_MS",
      10_000,
      1_000,
      120_000,
    ),
    maxBodyBytes: boundedInteger(
      env,
      "COVENANT_MAX_BODY_BYTES",
      1_048_576,
      1_024,
      10_485_760,
    ),
    rateLimits: Object.freeze({
      authentication: {
        limit: positiveLimit(
          env,
          "COVENANT_AUTH_RATE_LIMIT",
          DEFAULT_LIMITS.authentication.limit,
        ),
        windowMs: boundedInteger(
          env,
          "COVENANT_AUTH_RATE_WINDOW_MS",
          DEFAULT_LIMITS.authentication.windowMs,
          1_000,
          3_600_000,
        ),
      },
      mutations: {
        limit: positiveLimit(
          env,
          "COVENANT_MUTATION_RATE_LIMIT",
          DEFAULT_LIMITS.mutations.limit,
        ),
        windowMs: boundedInteger(
          env,
          "COVENANT_MUTATION_RATE_WINDOW_MS",
          DEFAULT_LIMITS.mutations.windowMs,
          1_000,
          3_600_000,
        ),
      },
      evidence: {
        limit: positiveLimit(
          env,
          "COVENANT_EVIDENCE_RATE_LIMIT",
          DEFAULT_LIMITS.evidence.limit,
        ),
        windowMs: boundedInteger(
          env,
          "COVENANT_EVIDENCE_RATE_WINDOW_MS",
          DEFAULT_LIMITS.evidence.windowMs,
          1_000,
          3_600_000,
        ),
      },
    }),
  });
}
