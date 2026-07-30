import {
  getAddress,
  isAddress,
  keccak256,
  stringToHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";
import {
  covenantVaultConstructorConfigurationSchema,
  covenantVaultConstructorDigest,
} from "./deployment-plan.js";

const UINT256_MAX_DECIMAL = ((1n << 256n) - 1n).toString();

function isStrictAddress(value: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value)) return false;
  if (value === value.toLowerCase()) return isAddress(value, { strict: false });
  return isAddress(value, { strict: true });
}

const addressSchema = z
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

const uintStringSchema = z
  .string()
  .max(UINT256_MAX_DECIMAL.length)
  .regex(/^(0|[1-9]\d*)$/u, "Expected canonical unsigned decimal string")
  .refine(
    (value) =>
      value.length < UINT256_MAX_DECIMAL.length || value <= UINT256_MAX_DECIMAL,
    "Value exceeds uint256",
  );

const positiveUintStringSchema = uintStringSchema.refine(
  (value) => BigInt(value) > 0n,
  "Expected a positive integer",
);

const sourceCommitSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/u, "Expected lowercase Git commit");

const immutableValuesSchema = z
  .object({
    covenantId: bytes32Schema,
    issuer: addressSchema,
    agentSigner: addressSchema,
    authorizationSigner: addressSchema,
    token: addressSchema,
    recipient: addressSchema,
    maxAmountPerPayment: positiveUintStringSchema,
    totalBudget: positiveUintStringSchema,
    maxPaymentCount: positiveUintStringSchema,
    validAfter: positiveUintStringSchema,
    validUntil: positiveUintStringSchema,
    purposeHash: bytes32Schema,
    policyHash: bytes32Schema,
    policyVersionHash: bytes32Schema,
  })
  .strict();

export const arcDeploymentManifestSchema = z
  .object({
    schemaVersion: z.literal("1"),
    trustedNetworkProfileDigest: bytes32Schema,
    planDigest: bytes32Schema,
    chainId: uintStringSchema,
    contractAddress: addressSchema,
    deploymentTransactionHash: bytes32Schema,
    deploymentBlockNumber: positiveUintStringSchema,
    deploymentBlockHash: bytes32Schema,
    deployerAddress: addressSchema,
    creationBytecodeHash: bytes32Schema,
    actualRuntimeCodeHash: bytes32Schema,
    canonicalAbiHash: bytes32Schema,
    constructorDigest: bytes32Schema,
    completeInitCodeHash: bytes32Schema,
    constructor: covenantVaultConstructorConfigurationSchema,
    immutableValues: immutableValuesSchema,
    sourceGitCommit: sourceCommitSchema,
    solidityVersion: z.literal("0.8.28"),
    forgeVersion: z.literal("1.7.1"),
    optimizerEnabled: z.literal(true),
    optimizerRuns: z.literal("200"),
    viaIr: z.literal(true),
    metadataBytecodeHash: z.literal("ipfs"),
    artifactEvmTarget: z.literal("prague"),
    receiptStatus: z.literal("SUCCESSFUL_EXECUTION"),
    finalityState: z.literal("FINAL_ARC_TRANSACTION"),
    verificationTimestamp: z.string().datetime({ offset: true }),
    providerCorroborationState: z.enum([
      "PRIMARY_ONLY",
      "INDEPENDENTLY_CORROBORATED",
    ]),
    supersededManifestIdentifier: bytes32Schema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedImmutables = {
      covenantId: value.constructor.covenantId,
      issuer: value.constructor.issuer,
      agentSigner: value.constructor.agentSigner,
      authorizationSigner: value.constructor.authorizationSigner,
      token: value.constructor.token,
      recipient: value.constructor.recipient,
      maxAmountPerPayment: value.constructor.maxAmountPerPayment,
      totalBudget: value.constructor.totalBudget,
      maxPaymentCount: value.constructor.maxPaymentCount,
      validAfter: value.constructor.validAfter,
      validUntil: value.constructor.validUntil,
      purposeHash: keccak256(stringToHex(value.constructor.purpose)),
      policyHash: value.constructor.policyHash,
      policyVersionHash: keccak256(
        stringToHex(value.constructor.policyVersion),
      ),
    };
    for (const [key, expected] of Object.entries(expectedImmutables)) {
      const actual =
        value.immutableValues[key as keyof typeof value.immutableValues];
      if (actual !== expected) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["immutableValues", key],
          message: "Immutable value does not match constructor configuration",
        });
      }
    }
    if (
      value.constructorDigest !==
      covenantVaultConstructorDigest(value.constructor)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["constructorDigest"],
        message: "Constructor digest mismatch",
      });
    }
  });

export type ArcDeploymentManifest = z.infer<typeof arcDeploymentManifestSchema>;

export type ArcManifestAnchors = Readonly<{
  chainId: string;
  usdcInterfaceAddress: Address;
  profileDigest: Hex;
  planDigest: Hex;
}>;

export function parseArcDeploymentManifest(
  input: unknown,
  anchors: ArcManifestAnchors,
): ArcDeploymentManifest {
  const parsed = arcDeploymentManifestSchema.parse(input);
  if (
    parsed.chainId !== anchors.chainId ||
    parsed.trustedNetworkProfileDigest !== anchors.profileDigest ||
    parsed.planDigest !== anchors.planDigest ||
    parsed.constructor.token !== anchors.usdcInterfaceAddress ||
    parsed.immutableValues.token !== anchors.usdcInterfaceAddress
  ) {
    throw new Error("Deployment manifest anchor mismatch");
  }
  return parsed;
}
