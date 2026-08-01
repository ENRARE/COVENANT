import { keccak256, stringToHex } from "viem";
import { z } from "zod";

export const ARC_TESTNET_CHAIN_ID = "5042002" as const;
export const ARC_TESTNET_USDC_INTERFACE =
  "0x3600000000000000000000000000000000000000" as const;

export const ARC_TESTNET_SOURCE_URLS = Object.freeze([
  "https://docs.arc.io/integrate/infrastructure",
  "https://docs.arc.io/arc/references/rpc-endpoints",
  "https://docs.arc.io/arc/references/gas-and-fees",
  "https://docs.arc.io/integrate/wallets/transaction-lifecycle",
] as const);
export const CIRCLE_USDC_SOURCE_URL =
  "https://developers.circle.com/stablecoins/usdc-contract-addresses" as const;

type JsonValue =
  | boolean
  | null
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    const items = value as readonly JsonValue[];
    return items.map((item) => canonicalize(item));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, JsonValue>>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key] as JsonValue)]),
    );
  }
  return value;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export function deriveChainIdHex(chainId: string): `0x${string}` {
  if (!/^(0|[1-9]\d*)$/u.test(chainId)) {
    throw new Error("Chain ID must be a canonical unsigned decimal string");
  }
  return `0x${BigInt(chainId).toString(16)}`;
}

const httpsUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => new URL(value).protocol === "https:",
    "Expected HTTPS URL",
  );
const webSocketUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => new URL(value).protocol === "wss:",
    "Expected secure WebSocket URL",
  );

export const arcTestnetSecurityProfileSchema = z
  .object({
    schemaVersion: z.literal("1"),
    networkId: z.literal("arc-testnet"),
    networkName: z.literal("Arc Testnet"),
    chainId: z.literal(ARC_TESTNET_CHAIN_ID),
    chainIdHex: z
      .literal(deriveChainIdHex(ARC_TESTNET_CHAIN_ID))
      .refine(
        (value) => value === deriveChainIdHex(ARC_TESTNET_CHAIN_ID),
        "Chain ID hexadecimal form is inconsistent",
      ),
    primaryHttpsRpc: httpsUrlSchema.pipe(
      z.literal("https://rpc.testnet.arc.network"),
    ),
    primaryWebSocketRpc: webSocketUrlSchema.pipe(
      z.literal("wss://rpc.testnet.arc.network"),
    ),
    explorerBaseUrl: httpsUrlSchema.pipe(
      z.literal("https://testnet.arcscan.app"),
    ),
    usdcInterfaceAddress: z.literal(ARC_TESTNET_USDC_INTERFACE),
    nativeGasSymbol: z.literal("USDC"),
    nativeRpcDecimals: z.literal(18),
    walletDisplayDecimals: z.literal(6),
    erc20Decimals: z.literal(6),
    networkEvmTarget: z.literal("prague"),
    artifactEvmTarget: z.literal("prague"),
    finalityModel: z.literal("deterministic-bft"),
    requiredCommittedBlocks: z.literal(1),
  })
  .strict();

export const arcTestnetSourceVerificationSchema = z
  .object({
    arc: z.tuple([
      z.literal(ARC_TESTNET_SOURCE_URLS[0]),
      z.literal(ARC_TESTNET_SOURCE_URLS[1]),
      z.literal(ARC_TESTNET_SOURCE_URLS[2]),
      z.literal(ARC_TESTNET_SOURCE_URLS[3]),
    ]),
    circle: z.literal(CIRCLE_USDC_SOURCE_URL),
    verifiedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u, "Expected ISO calendar date"),
  })
  .strict();

export const arcTestnetProfileSchema = arcTestnetSecurityProfileSchema
  .extend({
    sourceVerification: arcTestnetSourceVerificationSchema,
  })
  .strict();

const securityProfile = arcTestnetSecurityProfileSchema.parse({
  schemaVersion: "1",
  networkId: "arc-testnet",
  networkName: "Arc Testnet",
  chainId: ARC_TESTNET_CHAIN_ID,
  chainIdHex: deriveChainIdHex(ARC_TESTNET_CHAIN_ID),
  primaryHttpsRpc: "https://rpc.testnet.arc.network",
  primaryWebSocketRpc: "wss://rpc.testnet.arc.network",
  explorerBaseUrl: "https://testnet.arcscan.app",
  usdcInterfaceAddress: ARC_TESTNET_USDC_INTERFACE,
  nativeGasSymbol: "USDC",
  nativeRpcDecimals: 18,
  walletDisplayDecimals: 6,
  erc20Decimals: 6,
  networkEvmTarget: "prague",
  artifactEvmTarget: "prague",
  finalityModel: "deterministic-bft",
  requiredCommittedBlocks: 1,
});

export const ARC_TESTNET_SECURITY_PROFILE = deepFreeze(securityProfile);

export const ARC_TESTNET_PROFILE = deepFreeze(
  arcTestnetProfileSchema.parse({
    ...securityProfile,
    sourceVerification: {
      arc: ARC_TESTNET_SOURCE_URLS,
      circle: CIRCLE_USDC_SOURCE_URL,
      verifiedOn: "2026-08-01",
    },
  }),
);

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalize(value));
}

export function securityProfileDigest(
  profile: unknown = ARC_TESTNET_PROFILE,
): `0x${string}` {
  const parsed = arcTestnetProfileSchema.parse(profile);
  const securityFields = arcTestnetSecurityProfileSchema.strip().parse(parsed);
  return keccak256(stringToHex(canonicalJson(securityFields)));
}

export const ARC_TESTNET_SECURITY_PROFILE_DIGEST =
  securityProfileDigest(ARC_TESTNET_PROFILE);

export type ArcTestnetProfile = z.infer<typeof arcTestnetProfileSchema>;
