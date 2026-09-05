import { lstat, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { ARC_TESTNET_USDC_INTERFACE } from "@covenant/config";
import { withIsolatedKeystoreAccount as openIsolatedKeystoreAccount } from "@covenant/config/isolated-keystore";
import {
  ARC_TESTNET_CHAIN_ID,
  covenantSpecSchema,
  vaultAddressSchema,
  type CovenantSpec,
} from "@covenant/spec";
import { getAddress, type Address } from "viem";
import { createExecutorService, type ExecutorService } from "./service.js";
import type { Clock } from "./ports/clock.js";
import type { CovenantProvider } from "./ports/covenant-provider.js";
import type { ExecutionRepository } from "./ports/execution-repository.js";
import type { TransactionTransport } from "./ports/transaction-transport.js";
import { createCircleContractExecutionTransport } from "./circle/contract-execution-transport.js";
import { createCircleHttpsExchange } from "./circle/https-exchange.js";
import { createDurableCircleOperationRepository } from "./circle/durable-operation-repository.js";
import { createIsolatedCircleCredentialProvider } from "./circle/isolated-credential-provider.js";
import type { CircleOperationRepository } from "./circle/types.js";
import {
  parseCircleApiKey,
  parseCircleCiphertext,
  parseCircleConfig,
} from "./circle/schemas.js";

const ARC_RPC_URL = "https://rpc.testnet.arc.network" as const;
const ARC_CHAIN_ID_HEX = "0x4cef52" as const;
const DEFAULT_OPERATION_STORE_DIRECTORY = "/var/lib/covenant-executor";
const MAX_COVENANT_SPEC_BYTES = 512 * 1024;
const MAX_SIGNER_SOURCE_BYTES = 64 * 1024;

export class ExecutorDeploymentConfigurationError extends Error {
  override readonly name = "ExecutorDeploymentConfigurationError";

  constructor(message: string) {
    super(message);
    delete this.stack;
  }
}

export type ExecutorDeploymentEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type ExecutorDeploymentConfig = Readonly<{
  arcRpcUrl: typeof ARC_RPC_URL;
  covenantVaultAddress: Address;
  covenantSpecFile: string | undefined;
  circleKey: string;
  circleCiphertext: string;
  circleWalletId: string;
  executorSignerSource: string;
  operationStoreDirectory: string;
  feeLevel: "LOW" | "MEDIUM" | "HIGH";
}>;

export type ExecutorDeploymentService = ExecutorService & {
  close?: () => Promise<void>;
};

export type ArcChainVerifier = (rpcUrl: string) => Promise<void> | void;
export type SignerSourceValidator = (source: string) => Promise<void> | void;

export type ExecutorDeploymentOverrides = Readonly<{
  covenantProvider?: CovenantProvider;
  transport?: TransactionTransport;
  executionRepository?: ExecutionRepository;
  circleOperations?: CircleOperationRepository & {
    close?: () => Promise<void>;
  };
  clock?: Clock;
  verifyArcChain?: ArcChainVerifier;
  validateSignerSource?: SignerSourceValidator;
}>;

export type ExecutorDeploymentOptions = Readonly<{
  env?: ExecutorDeploymentEnvironment;
  dependencies?: ExecutorDeploymentOverrides;
}> &
  ExecutorDeploymentOverrides;

function configurationFailure(message: string): never {
  throw new ExecutorDeploymentConfigurationError(message);
}

function required(env: ExecutorDeploymentEnvironment, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value.length === 0)
    configurationFailure(`${name} is required`);
  return value;
}

function optional(
  env: ExecutorDeploymentEnvironment,
  name: string,
): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function deploymentPath(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.startsWith("file:") ||
    trimmed.includes("\0")
  )
    configurationFailure("Deployment path is invalid");
  return isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed);
}

export function loadExecutorDeploymentConfig(
  env: ExecutorDeploymentEnvironment = process.env,
  options: Readonly<{ requireCovenantSpec?: boolean }> = {},
): ExecutorDeploymentConfig {
  const arcRpcUrl = required(env, "ARC_RPC_URL");
  let parsedArcUrl: URL;
  try {
    parsedArcUrl = new URL(arcRpcUrl);
  } catch {
    configurationFailure("ARC_RPC_URL is invalid");
  }
  if (
    parsedArcUrl.protocol !== "https:" ||
    parsedArcUrl.hostname !== "rpc.testnet.arc.network" ||
    parsedArcUrl.username !== "" ||
    parsedArcUrl.password !== "" ||
    parsedArcUrl.pathname !== "/" ||
    parsedArcUrl.search !== "" ||
    parsedArcUrl.hash !== ""
  )
    configurationFailure("Only the reviewed Arc Testnet RPC is supported");

  let covenantVaultAddress: Address;
  try {
    covenantVaultAddress = vaultAddressSchema.parse(
      required(env, "COVENANT_VAULT_ADDRESS"),
    );
  } catch {
    configurationFailure("COVENANT_VAULT_ADDRESS is invalid");
  }

  const covenantSpecFile =
    optional(env, "COVENANT_EXECUTOR_COVENANT_SPEC_FILE") ??
    optional(env, "COVENANT_AUTHORIZATION_SPEC_FILE");
  if ((options.requireCovenantSpec ?? true) && covenantSpecFile === undefined)
    configurationFailure("COVENANT_EXECUTOR_COVENANT_SPEC_FILE is required");

  const executorSignerSource = required(env, "EXECUTOR_SIGNER_SOURCE");
  const circleCredential = required(env, "CIRCLE_API_KEY");
  const circleCiphertext = required(env, "CIRCLE_ENTITY_SECRET");
  const circleWalletId = required(env, "CIRCLE_WALLET_ID");
  const feeLevelValue = optional(env, "CIRCLE_FEE_LEVEL") ?? "MEDIUM";
  let circleConfig: ReturnType<typeof parseCircleConfig>;
  try {
    parseCircleApiKey(circleCredential);
    parseCircleCiphertext(circleCiphertext);
    circleConfig = parseCircleConfig({
      walletId: circleWalletId,
      contractAddress: covenantVaultAddress,
      feeLevel: feeLevelValue,
    });
  } catch {
    configurationFailure("Circle executor configuration is invalid");
  }
  return Object.freeze({
    arcRpcUrl: ARC_RPC_URL,
    covenantVaultAddress,
    covenantSpecFile,
    circleKey: circleCredential,
    circleCiphertext,
    circleWalletId: circleConfig.walletId,
    executorSignerSource,
    operationStoreDirectory:
      optional(env, "COVENANT_EXECUTOR_OPERATION_STORE_DIRECTORY") ??
      DEFAULT_OPERATION_STORE_DIRECTORY,
    feeLevel: circleConfig.feeLevel,
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>))
      deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function parseCovenantSpecDocument(
  value: unknown,
  vaultAddress: Address,
): CovenantSpec {
  const candidates: unknown[] = [];
  const direct = covenantSpecSchema.safeParse(value);
  if (direct.success) candidates.push(direct.data);
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    candidates.push(...items);
  } else if (typeof value === "object" && value !== null) {
    const entries = (value as Record<string, unknown>).entries;
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (typeof entry === "object" && entry !== null) {
          candidates.push((entry as Record<string, unknown>).covenantSpec);
        }
      }
    }
    const covenantSpec = (value as Record<string, unknown>).covenantSpec;
    if (covenantSpec !== undefined) candidates.push(covenantSpec);
  }
  const parsed = candidates.flatMap((candidate) => {
    const result = covenantSpecSchema.safeParse(candidate);
    return result.success ? [result.data] : [];
  });
  const matches = parsed.filter(
    (candidate) =>
      candidate.vaultAddress.toLowerCase() === vaultAddress.toLowerCase(),
  );
  if (matches.length !== 1)
    configurationFailure("CovenantSpec trust anchor is unavailable");
  const spec = matches[0];
  if (spec === undefined)
    configurationFailure("CovenantSpec trust anchor is unavailable");
  if (
    spec.chainId !== ARC_TESTNET_CHAIN_ID ||
    spec.tokenAddress.toLowerCase() !== ARC_TESTNET_USDC_INTERFACE.toLowerCase()
  )
    configurationFailure("CovenantSpec is not Arc Testnet USDC configuration");
  return deepFreeze(spec);
}

async function createFileCovenantProvider(
  filename: string,
  vaultAddress: Address,
): Promise<CovenantProvider> {
  const path = deploymentPath(filename);
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink())
      configurationFailure("CovenantSpec trust anchor file is invalid");
    if (metadata.size <= 0 || metadata.size > MAX_COVENANT_SPEC_BYTES)
      configurationFailure("CovenantSpec trust anchor file is invalid");
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    const covenant = parseCovenantSpecDocument(parsed, vaultAddress);
    return Object.freeze({
      getCovenant: () => Promise.resolve(covenant),
    });
  } catch (error: unknown) {
    if (error instanceof ExecutorDeploymentConfigurationError) throw error;
    configurationFailure("CovenantSpec trust anchor file is unavailable");
  }
}

type SignerDescriptor = Readonly<{
  type: "keystore";
  keystorePath: string;
  passwordFilePath: string;
  expectedAddress: string;
}>;

function parseSignerDescriptor(value: unknown): SignerDescriptor {
  if (typeof value !== "object" || value === null)
    configurationFailure("Executor signer source is invalid");
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (
    keys.join(",") !==
      ["expectedAddress", "keystorePath", "passwordFilePath", "type"].join(
        ",",
      ) ||
    candidate.type !== "keystore" ||
    typeof candidate.keystorePath !== "string" ||
    candidate.keystorePath.trim().length === 0 ||
    typeof candidate.passwordFilePath !== "string" ||
    candidate.passwordFilePath.trim().length === 0 ||
    typeof candidate.expectedAddress !== "string"
  )
    configurationFailure("Executor signer source is invalid");
  let expectedAddress: Address;
  try {
    expectedAddress = vaultAddressSchema.parse(candidate.expectedAddress);
  } catch {
    configurationFailure("Executor signer source is invalid");
  }
  return Object.freeze({
    type: "keystore",
    keystorePath: candidate.keystorePath,
    passwordFilePath: candidate.passwordFilePath,
    expectedAddress: getAddress(expectedAddress),
  });
}

export async function validateExecutorSignerSource(
  source: string,
): Promise<void> {
  const path = deploymentPath(source);
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink())
      configurationFailure("Executor signer source is invalid");
    if (metadata.size <= 0 || metadata.size > MAX_SIGNER_SOURCE_BYTES)
      configurationFailure("Executor signer source is invalid");
    const descriptor = parseSignerDescriptor(
      JSON.parse(await readFile(path, "utf8")) as unknown,
    );
    await openIsolatedKeystoreAccount(
      {
        keystorePath: deploymentPath(descriptor.keystorePath),
        passwordFilePath: deploymentPath(descriptor.passwordFilePath),
        expectedAddress: descriptor.expectedAddress,
      },
      () => undefined,
    );
  } catch (error: unknown) {
    if (error instanceof ExecutorDeploymentConfigurationError) throw error;
    configurationFailure("Executor signer source is unavailable");
  }
}

export async function verifyArcTestnetChain(rpcUrl: string): Promise<void> {
  if (rpcUrl !== ARC_RPC_URL && rpcUrl !== `${ARC_RPC_URL}/`)
    configurationFailure("Only the reviewed Arc Testnet RPC is supported");
  let response: Response;
  try {
    response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) configurationFailure("Arc RPC is unavailable");
    const body = (await response.json()) as unknown;
    const result =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).result
        : undefined;
    if (
      typeof body !== "object" ||
      body === null ||
      (body as Record<string, unknown>).jsonrpc !== "2.0" ||
      (body as Record<string, unknown>).id !== 1 ||
      typeof result !== "string" ||
      result.toLowerCase() !== ARC_CHAIN_ID_HEX
    )
      configurationFailure("Arc RPC returned an unsupported chain");
  } catch (error: unknown) {
    if (error instanceof ExecutorDeploymentConfigurationError) throw error;
    configurationFailure("Arc RPC is unavailable");
  }
}

function systemClock(): Clock {
  return Object.freeze({ now: () => BigInt(Math.floor(Date.now() / 1000)) });
}

function sourceCircleCredentials(config: ExecutorDeploymentConfig) {
  return createIsolatedCircleCredentialProvider({
    getApiKey: () => config.circleKey,
    createEntitySecretCiphertext: () => config.circleCiphertext,
  });
}

function createCircleTransport(
  config: ExecutorDeploymentConfig,
  operations: CircleOperationRepository,
): TransactionTransport {
  return createCircleContractExecutionTransport({
    config: {
      walletId: config.circleWalletId,
      contractAddress: config.covenantVaultAddress,
      feeLevel: config.feeLevel,
    },
    credentials: sourceCircleCredentials(config),
    http: createCircleHttpsExchange(),
    operations,
    generateUuid: randomUUID,
  });
}

function overridesOf(
  options: ExecutorDeploymentOptions,
): ExecutorDeploymentOverrides {
  return Object.freeze({
    ...options.dependencies,
    ...(options.covenantProvider === undefined
      ? {}
      : { covenantProvider: options.covenantProvider }),
    ...(options.transport === undefined
      ? {}
      : { transport: options.transport }),
    ...(options.executionRepository === undefined
      ? {}
      : { executionRepository: options.executionRepository }),
    ...(options.circleOperations === undefined
      ? {}
      : { circleOperations: options.circleOperations }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.verifyArcChain === undefined
      ? {}
      : { verifyArcChain: options.verifyArcChain }),
    ...(options.validateSignerSource === undefined
      ? {}
      : { validateSignerSource: options.validateSignerSource }),
  });
}

export async function createExecutorDeploymentService(
  options: ExecutorDeploymentOptions = {},
): Promise<ExecutorDeploymentService> {
  const overrides = overridesOf(options);
  const config = loadExecutorDeploymentConfig(options.env ?? process.env, {
    requireCovenantSpec: overrides.covenantProvider === undefined,
  });
  await Promise.all([
    (overrides.verifyArcChain ?? verifyArcTestnetChain)(config.arcRpcUrl),
    (overrides.validateSignerSource ?? validateExecutorSignerSource)(
      config.executorSignerSource,
    ),
  ]);

  const covenantProvider =
    overrides.covenantProvider ??
    (config.covenantSpecFile === undefined
      ? configurationFailure("COVENANT_EXECUTOR_COVENANT_SPEC_FILE is required")
      : await createFileCovenantProvider(
          config.covenantSpecFile,
          config.covenantVaultAddress,
        ));

  let operations:
    | (CircleOperationRepository & {
        close?: () => Promise<void>;
      })
    | undefined = overrides.circleOperations;
  let transport = overrides.transport;
  if (transport === undefined) {
    operations ??= await createDurableCircleOperationRepository({
      directory: config.operationStoreDirectory,
    });
    transport = createCircleTransport(config, operations);
  }

  const service = createExecutorService({
    clock: overrides.clock ?? systemClock(),
    covenantProvider,
    transport,
    ...(overrides.executionRepository === undefined
      ? {}
      : { executionRepository: overrides.executionRepository }),
  });
  const closeOperations = operations?.close;
  if (closeOperations !== undefined) {
    let closed = false;
    Object.defineProperty(service, "close", {
      configurable: false,
      enumerable: false,
      value: async () => {
        if (closed) return;
        closed = true;
        await closeOperations();
      },
      writable: false,
    });
  }
  return service;
}
