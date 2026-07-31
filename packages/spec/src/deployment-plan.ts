import {
  concatHex,
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  stringToHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";

export const ARC_PLAN_SCHEMA_VERSION = "1" as const;
export const ARC_PLAN_MINIMUM_VALIDITY_BUFFER_SECONDS = 7n * 24n * 60n * 60n;

const UINT256_MAX_DECIMAL = ((1n << 256n) - 1n).toString();
const UINT256_MAX_DIGITS = UINT256_MAX_DECIMAL.length;
const PRIVATE_KEY_PATTERN = /^(?:0x)?[0-9a-fA-F]{64}$/u;
const SECRET_KEY_PATTERN =
  /(?:api.?key|credential|encrypted.?keystore|mnemonic|private.?key|secret|signature|signed.?transaction)/iu;

type JsonValue =
  | boolean
  | null
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

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

export function canonicalDeploymentJson(value: JsonValue): string {
  return JSON.stringify(canonicalize(value));
}

export function canonicalDeploymentDigest(value: JsonValue): Hex {
  return keccak256(stringToHex(canonicalDeploymentJson(value)));
}

function isStrictAddress(value: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value)) return false;
  if (value === value.toLowerCase()) return isAddress(value, { strict: false });
  return isAddress(value, { strict: true });
}

const operationalAddressSchema = z
  .string()
  .refine(
    isStrictAddress,
    "Expected lowercase or correctly checksummed EVM address",
  )
  .transform((value) => getAddress(value))
  .refine((value) => value !== zeroAddress, "Zero address is not allowed");

const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/u, "Expected 32-byte hex value")
  .transform((value) => value.toLowerCase() as Hex);

const canonicalUint256Schema = z
  .string()
  .max(UINT256_MAX_DIGITS)
  .regex(/^(0|[1-9]\d*)$/u, "Expected canonical unsigned decimal string")
  .refine(
    (value) =>
      value.length < UINT256_MAX_DIGITS || value <= UINT256_MAX_DECIMAL,
    "Value exceeds uint256",
  );

const positiveUint256Schema = canonicalUint256Schema.refine(
  (value) => BigInt(value) > 0n,
  "Expected a positive integer",
);

const sourceCommitSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/u, "Expected lowercase Git commit");

function looksLikePlaceholder(address: Address): boolean {
  const digits = address.slice(2).toLowerCase();
  return new Set(digits).size < 8;
}

export const covenantVaultConstructorConfigurationSchema = z
  .object({
    covenantId: bytes32Schema,
    issuer: operationalAddressSchema,
    agentSigner: operationalAddressSchema,
    authorizationSigner: operationalAddressSchema,
    token: operationalAddressSchema,
    recipient: operationalAddressSchema,
    maxAmountPerPayment: positiveUint256Schema,
    totalBudget: positiveUint256Schema,
    maxPaymentCount: positiveUint256Schema,
    validAfter: positiveUint256Schema,
    validUntil: positiveUint256Schema,
    purpose: z
      .string()
      .min(1)
      .max(256)
      .refine(
        (value) => value === value.trim(),
        "Boundary whitespace is forbidden",
      ),
    policyHash: bytes32Schema,
    policyVersion: z
      .string()
      .max(32)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u),
  })
  .strict()
  .superRefine((value, context) => {
    const protectedRoles = [
      value.issuer,
      value.agentSigner,
      value.authorizationSigner,
    ];
    if (new Set(protectedRoles).size !== protectedRoles.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authorizationSigner"],
        message: "Issuer and signing roles must be pairwise distinct",
      });
    }
    if (
      [
        value.issuer,
        value.agentSigner,
        value.authorizationSigner,
        value.token,
      ].includes(value.recipient)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recipient"],
        message: "Recipient collides with a prohibited constructor role",
      });
    }
    if (BigInt(value.maxAmountPerPayment) > BigInt(value.totalBudget)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxAmountPerPayment"],
        message: "Per-payment maximum exceeds total budget",
      });
    }
    if (BigInt(value.validUntil) <= BigInt(value.validAfter)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validUntil"],
        message: "Validity window is not ordered",
      });
    }
  });

export const arcDeploymentPlanInputSchema = z
  .object({
    schemaVersion: z.literal(ARC_PLAN_SCHEMA_VERSION),
    expectedChainId: canonicalUint256Schema,
    usdcInterfaceAddress: operationalAddressSchema,
    plannedDeployer: operationalAddressSchema,
    plannedTransactionPayer: operationalAddressSchema,
    constructor: covenantVaultConstructorConfigurationSchema,
  })
  .strict();

export type ArcDeploymentPlanInput = z.infer<
  typeof arcDeploymentPlanInputSchema
>;
export type CovenantVaultConstructorConfiguration = z.infer<
  typeof covenantVaultConstructorConfigurationSchema
>;

export type ArcDeploymentAnchors = Readonly<{
  chainId: string;
  usdcInterfaceAddress: Address;
  profileDigest: Hex;
  nowSeconds: bigint;
}>;

function inspectSecretMaterial(
  value: unknown,
  path: readonly string[] = [],
): boolean {
  if (Array.isArray(value)) {
    return value.some((item, index) =>
      inspectSecretMaterial(item, [...path, String(index)]),
    );
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(
      ([key, nested]) =>
        SECRET_KEY_PATTERN.test(key) ||
        inspectSecretMaterial(nested, [...path, key]),
    );
  }
  if (typeof value !== "string" || !PRIVATE_KEY_PATTERN.test(value)) {
    return false;
  }
  const allowedBytes32Paths = new Set([
    "constructor.covenantId",
    "constructor.policyHash",
  ]);
  return !allowedBytes32Paths.has(path.join("."));
}

export function parseArcDeploymentPlanInput(
  input: unknown,
  anchors: ArcDeploymentAnchors,
): ArcDeploymentPlanInput {
  if (inspectSecretMaterial(input)) {
    throw new Error("Secret-like material is forbidden");
  }
  const parsed = arcDeploymentPlanInputSchema.parse(input);
  if (parsed.expectedChainId !== anchors.chainId) {
    throw new Error("Unexpected deployment chain");
  }
  if (
    parsed.usdcInterfaceAddress !== anchors.usdcInterfaceAddress ||
    parsed.constructor.token !== anchors.usdcInterfaceAddress
  ) {
    throw new Error("Unexpected Arc USDC interface");
  }
  const addresses = [
    parsed.plannedDeployer,
    parsed.plannedTransactionPayer,
    parsed.constructor.issuer,
    parsed.constructor.agentSigner,
    parsed.constructor.authorizationSigner,
    parsed.constructor.recipient,
  ];
  if (addresses.some((address) => looksLikePlaceholder(address))) {
    throw new Error("Placeholder addresses are forbidden");
  }
  if (
    BigInt(parsed.constructor.validUntil) <
    anchors.nowSeconds + ARC_PLAN_MINIMUM_VALIDITY_BUFFER_SECONDS
  ) {
    throw new Error("Deployment validity buffer is insufficient");
  }
  return parsed;
}

const constructorTuple = [
  {
    name: "configuration",
    type: "tuple",
    components: [
      { name: "covenantId", type: "bytes32" },
      { name: "issuer", type: "address" },
      { name: "agentSigner", type: "address" },
      { name: "authorizationSigner", type: "address" },
      { name: "token", type: "address" },
      { name: "recipient", type: "address" },
      { name: "maxAmountPerPayment", type: "uint256" },
      { name: "totalBudget", type: "uint256" },
      { name: "maxPaymentCount", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validUntil", type: "uint256" },
      { name: "purpose", type: "string" },
      { name: "policyHash", type: "bytes32" },
      { name: "policyVersion", type: "string" },
    ],
  },
] as const;

function constructorEncodingValue(
  configuration: CovenantVaultConstructorConfiguration,
) {
  return {
    ...configuration,
    maxAmountPerPayment: BigInt(configuration.maxAmountPerPayment),
    totalBudget: BigInt(configuration.totalBudget),
    maxPaymentCount: BigInt(configuration.maxPaymentCount),
    validAfter: BigInt(configuration.validAfter),
    validUntil: BigInt(configuration.validUntil),
  };
}

export function encodeCovenantVaultConstructor(
  configuration: CovenantVaultConstructorConfiguration,
): Hex {
  const parsed =
    covenantVaultConstructorConfigurationSchema.parse(configuration);
  return encodeAbiParameters(constructorTuple, [
    constructorEncodingValue(parsed),
  ]);
}

export function covenantVaultConstructorDigest(
  configuration: CovenantVaultConstructorConfiguration,
): Hex {
  return keccak256(encodeCovenantVaultConstructor(configuration));
}

export function covenantVaultInitCodeHash(
  creationBytecode: Hex,
  configuration: CovenantVaultConstructorConfiguration,
): Hex {
  return keccak256(
    concatHex([
      creationBytecode,
      encodeCovenantVaultConstructor(configuration),
    ]),
  );
}

const arcDeploymentPlanCoreBaseSchema = z
  .object({
    schemaVersion: z.literal(ARC_PLAN_SCHEMA_VERSION),
    sourceGitCommit: sourceCommitSchema,
    trustedNetworkProfileDigest: bytes32Schema,
    contractName: z.literal("CovenantVault"),
    solidityVersion: z.literal("0.8.28"),
    forgeVersion: z.literal("1.7.1"),
    artifactEvmTarget: z.literal("prague"),
    networkEvmTarget: z.literal("osaka"),
    optimizerEnabled: z.literal(true),
    optimizerRuns: z.literal("200"),
    viaIr: z.literal(true),
    metadataBytecodeHash: z.literal("ipfs"),
    creationBytecodeHash: bytes32Schema,
    unpatchedRuntimeBytecodeHash: bytes32Schema,
    semanticImmutableMapDigest: bytes32Schema,
    canonicalAbiHash: bytes32Schema,
    constructor: covenantVaultConstructorConfigurationSchema,
    constructorEncodingDigest: bytes32Schema,
    completeInitCodeHash: bytes32Schema,
    expectedChainId: canonicalUint256Schema,
    officialUsdcInterfaceAddress: operationalAddressSchema,
    plannedDeployer: operationalAddressSchema,
    plannedTransactionPayer: operationalAddressSchema,
    validAfter: positiveUint256Schema,
    validUntil: positiveUint256Schema,
    deploymentMethod: z.literal("CREATE"),
    planStatus: z.literal("BROADCASTABLE"),
  })
  .strict();

function validatePlanCore(
  value: z.infer<typeof arcDeploymentPlanCoreBaseSchema>,
  context: z.RefinementCtx,
): void {
  if (
    value.validAfter !== value.constructor.validAfter ||
    value.validUntil !== value.constructor.validUntil
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["validAfter"],
      message: "Top-level validity does not match constructor validity",
    });
  }
  if (
    value.constructorEncodingDigest !==
    covenantVaultConstructorDigest(value.constructor)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["constructorEncodingDigest"],
      message: "Constructor commitment mismatch",
    });
  }
}

export const arcDeploymentPlanCoreSchema =
  arcDeploymentPlanCoreBaseSchema.superRefine(validatePlanCore);

export const arcDeploymentPlanSchema = arcDeploymentPlanCoreBaseSchema
  .extend({ canonicalPlanDigest: bytes32Schema })
  .strict()
  .superRefine((value, context) => {
    validatePlanCore(value, context);
    const { canonicalPlanDigest, ...core } = value;
    if (canonicalPlanDigest !== canonicalDeploymentDigest(core)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["canonicalPlanDigest"],
        message: "Canonical plan digest mismatch",
      });
    }
  });

export type ArcDeploymentPlan = z.infer<typeof arcDeploymentPlanSchema>;

export type ReviewedArtifactCommitments = Readonly<{
  creationBytecode: Hex;
  creationBytecodeHash: Hex;
  unpatchedRuntimeBytecodeHash: Hex;
  semanticImmutableMapDigest: Hex;
  canonicalAbiHash: Hex;
}>;

export type DeploymentToolchain = Readonly<{
  sourceGitCommit: string;
  forgeVersion: "1.7.1";
}>;

export function createArcDeploymentPlan(input: {
  parsedInput: ArcDeploymentPlanInput;
  anchors: ArcDeploymentAnchors;
  artifact: ReviewedArtifactCommitments;
  toolchain: DeploymentToolchain;
}): ArcDeploymentPlan {
  const { parsedInput, anchors, artifact, toolchain } = input;
  const constructorEncodingDigest = covenantVaultConstructorDigest(
    parsedInput.constructor,
  );
  const core = arcDeploymentPlanCoreSchema.parse({
    schemaVersion: ARC_PLAN_SCHEMA_VERSION,
    sourceGitCommit: toolchain.sourceGitCommit,
    trustedNetworkProfileDigest: anchors.profileDigest,
    contractName: "CovenantVault",
    solidityVersion: "0.8.28",
    forgeVersion: toolchain.forgeVersion,
    artifactEvmTarget: "prague",
    networkEvmTarget: "osaka",
    optimizerEnabled: true,
    optimizerRuns: "200",
    viaIr: true,
    metadataBytecodeHash: "ipfs",
    creationBytecodeHash: artifact.creationBytecodeHash,
    unpatchedRuntimeBytecodeHash: artifact.unpatchedRuntimeBytecodeHash,
    semanticImmutableMapDigest: artifact.semanticImmutableMapDigest,
    canonicalAbiHash: artifact.canonicalAbiHash,
    constructor: parsedInput.constructor,
    constructorEncodingDigest,
    completeInitCodeHash: covenantVaultInitCodeHash(
      artifact.creationBytecode,
      parsedInput.constructor,
    ),
    expectedChainId: parsedInput.expectedChainId,
    officialUsdcInterfaceAddress: parsedInput.usdcInterfaceAddress,
    plannedDeployer: parsedInput.plannedDeployer,
    plannedTransactionPayer: parsedInput.plannedTransactionPayer,
    validAfter: parsedInput.constructor.validAfter,
    validUntil: parsedInput.constructor.validUntil,
    deploymentMethod: "CREATE",
    planStatus: "BROADCASTABLE",
  });
  return arcDeploymentPlanSchema.parse({
    ...core,
    canonicalPlanDigest: canonicalDeploymentDigest(core),
  });
}
