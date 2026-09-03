import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_USDC_INTERFACE,
} from "@covenant/config";
import {
  addressSchema,
  bytes32Schema,
  formatUsdc,
  parseUsdc,
  policyVersionSchema,
  UINT256_MAX_DECIMAL,
} from "@covenant/spec";
import { z } from "zod";
import {
  ARC_OBSERVATION_STATES,
  AUTHORIZATION_DECISIONS,
  AUTHORIZATION_EVIDENCE_STATES,
  COVENANT_LIFECYCLE_STATES,
  EXECUTION_PREPARATION_STATES,
  PLATFORM_COVENANT_VERSION,
  PLATFORM_V1_ASSET_DECIMALS,
  PLATFORM_V1_ASSET_SYMBOL,
  PLATFORM_V1_CHAIN_ID,
  PLATFORM_V1_NETWORK_ID,
  PROVIDER_STATES,
} from "./constants.js";

const platformIdentifierSchema = bytes32Schema.transform(
  (value) => value.toLowerCase() as `0x${string}`,
);

const canonicalTimestampSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, "Expected a canonical Unix-second string")
  .max(78, "Timestamp exceeds uint256 range")
  .refine(
    (value) =>
      (value.length < 78 || value <= UINT256_MAX_DECIMAL) && BigInt(value) > 0n,
    "Timestamp must be positive and within uint256 range",
  );

const canonicalMoneySchema = z
  .unknown()
  .transform((value, context) => {
    try {
      return formatUsdc(parseUsdc(value));
    } catch (error) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "Invalid USDC value",
      });
      return z.NEVER;
    }
  })
  .refine((value) => value !== "0", "Amount must be positive");

const fixedUsdcAddress = addressSchema.parse(ARC_TESTNET_USDC_INTERFACE);
const fixedAddressSchema = addressSchema.refine(
  (value) => value === fixedUsdcAddress,
  "Expected the fixed Arc Testnet USDC interface address",
);

const fixedChainIdSchema = z
  .union([
    z.literal(PLATFORM_V1_CHAIN_ID),
    z.literal(Number(PLATFORM_V1_CHAIN_ID)),
  ])
  .transform(() => PLATFORM_V1_CHAIN_ID);

const opaqueIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:-]+$/, "Identifier contains unsupported characters");

const nullableIdentifierSchema = platformIdentifierSchema.nullable();
const nullableTimestampSchema = canonicalTimestampSchema.nullable();

export const platformNetworkSchema = z
  .object({
    id: z.literal(PLATFORM_V1_NETWORK_ID),
    chainId: z.literal(PLATFORM_V1_CHAIN_ID),
  })
  .strict();

export const platformAssetSchema = z
  .object({
    symbol: z.literal(PLATFORM_V1_ASSET_SYMBOL),
    decimals: z.literal(PLATFORM_V1_ASSET_DECIMALS),
    address: fixedAddressSchema,
  })
  .strict();

export const covenantConditionsSchema = z
  .object({
    policyHash: platformIdentifierSchema,
    policyVersion: policyVersionSchema,
  })
  .strict();

export const authorizationStatusSchema = z
  .object({
    decision: z.enum(AUTHORIZATION_DECISIONS),
    evidence: z.enum(AUTHORIZATION_EVIDENCE_STATES),
    decisionId: nullableIdentifierSchema,
    authorizationId: nullableIdentifierSchema,
    intentId: nullableIdentifierSchema,
    intentHash: bytes32Schema.nullable(),
    validUntil: nullableTimestampSchema,
  })
  .strict();

export const executionStatusSchema = z
  .object({
    preparation: z.enum(EXECUTION_PREPARATION_STATES),
    provider: z.enum(PROVIDER_STATES),
    arc: z.enum(ARC_OBSERVATION_STATES),
    executionId: nullableIdentifierSchema,
    transactionId: opaqueIdentifierSchema.nullable(),
    failureReason: z.string().trim().min(1).max(256).nullable(),
  })
  .strict();

const auditReferenceSchema = nullableIdentifierSchema;

const platformCovenantBaseSchema = z
  .object({
    version: z.literal(PLATFORM_COVENANT_VERSION),
    id: platformIdentifierSchema,
    projectId: platformIdentifierSchema,
    payer: addressSchema,
    beneficiary: addressSchema,
    asset: platformAssetSchema,
    amount: canonicalMoneySchema,
    network: platformNetworkSchema,
    conditions: covenantConditionsSchema,
    authorizationStatus: authorizationStatusSchema,
    executionStatus: executionStatusSchema,
    status: z.enum(COVENANT_LIFECYCLE_STATES),
    createdAt: canonicalTimestampSchema,
    updatedAt: canonicalTimestampSchema,
    expiresAt: canonicalTimestampSchema,
    auditReference: auditReferenceSchema,
  })
  .strict();

export const platformCovenantSchema = platformCovenantBaseSchema.superRefine(
  (value, context) => {
    if (BigInt(value.updatedAt) < BigInt(value.createdAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["updatedAt"],
        message: "updatedAt must not precede createdAt",
      });
    }
    if (BigInt(value.expiresAt) <= BigInt(value.createdAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "expiresAt must occur after createdAt",
      });
    }
    if (
      value.status === "AUTHORIZED" &&
      (value.authorizationStatus.decision !== "APPROVED" ||
        value.authorizationStatus.evidence !== "VALID" ||
        value.authorizationStatus.decisionId === null ||
        value.authorizationStatus.authorizationId === null ||
        value.authorizationStatus.intentId === null ||
        value.authorizationStatus.intentHash === null ||
        value.authorizationStatus.validUntil === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authorizationStatus"],
        message: "AUTHORIZED requires valid approved authorization evidence",
      });
    }
    if (
      value.status === "EXECUTING" &&
      (value.executionStatus.preparation === "NOT_REQUESTED" ||
        value.executionStatus.executionId === null ||
        value.authorizationStatus.decision !== "APPROVED" ||
        value.authorizationStatus.evidence !== "VALID")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["executionStatus"],
        message: "EXECUTING requires authorization and execution preparation",
      });
    }
    if (
      value.status === "EXECUTED" &&
      (value.executionStatus.arc !== "SUCCEEDED" ||
        value.executionStatus.executionId === null ||
        value.executionStatus.transactionId === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["executionStatus", "arc"],
        message: "EXECUTED requires independent Arc success evidence",
      });
    }
    if (
      value.status === "REJECTED" &&
      value.authorizationStatus.decision !== "REJECTED"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authorizationStatus", "decision"],
        message: "REJECTED requires a rejected authorization decision",
      });
    }
  },
);

export const createCovenantInputSchema = z
  .object({
    version: z.literal(PLATFORM_COVENANT_VERSION),
    id: platformIdentifierSchema,
    projectId: platformIdentifierSchema,
    payer: addressSchema,
    beneficiary: addressSchema,
    asset: platformAssetSchema,
    amount: canonicalMoneySchema,
    network: platformNetworkSchema,
    conditions: covenantConditionsSchema.optional(),
    policy: covenantConditionsSchema.optional(),
    createdAt: canonicalTimestampSchema,
    expiresAt: canonicalTimestampSchema,
    auditReference: auditReferenceSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.conditions === undefined && value.policy === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conditions"],
        message: "A conditions or policy reference is required",
      });
    }
    if (value.conditions !== undefined && value.policy !== undefined) {
      if (
        value.conditions.policyHash !== value.policy.policyHash ||
        value.conditions.policyVersion !== value.policy.policyVersion
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["policy"],
          message: "conditions and policy references must agree",
        });
      }
    }
    if (BigInt(value.expiresAt) <= BigInt(value.createdAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "expiresAt must occur after createdAt",
      });
    }
  });

const authorizationReceiptFieldSchema = z.unknown().optional();

export const authorizationEvidenceSchema = z
  .object({
    covenantId: platformIdentifierSchema,
    policyVersion: policyVersionSchema,
    decisionId: platformIdentifierSchema,
    intentId: platformIdentifierSchema,
    intentHash: bytes32Schema,
    decision: z.enum(["APPROVED", "REJECTED"]),
    authorizationId: nullableIdentifierSchema,
    validUntil: nullableTimestampSchema,
    signedDecisionReceipt: authorizationReceiptFieldSchema,
    decisionReceipt: authorizationReceiptFieldSchema,
    signedAuthorizationReceipt: authorizationReceiptFieldSchema,
    authorizationReceipt: authorizationReceiptFieldSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === "APPROVED") {
      if (value.authorizationId === null || value.validUntil === null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["authorizationId"],
          message:
            "Approved evidence requires authorization identity and expiry",
        });
      }
    } else if (value.authorizationId !== null || value.validUntil !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authorizationId"],
        message: "Rejected evidence cannot carry an authorization grant",
      });
    }
  });

/**
 * Transport bundle for externally produced authority evidence. The V2
 * lifecycle evidence remains the existing AuthorizationEvidence shape; the
 * signed PaymentIntent and canonical rule observations are carried alongside
 * it so a verifier can replay the unchanged V1 authorization chain.
 */
export const authorizationEvidenceSubmissionSchema = z
  .object({
    evidence: authorizationEvidenceSchema,
    signedPaymentIntent: z
      .unknown()
      .refine(
        (value) => value !== undefined,
        "signedPaymentIntent is required",
      ),
    ruleResults: z
      .unknown()
      .refine((value) => value !== undefined, "ruleResults are required"),
  })
  .strict();

const providerStateObjectSchema = z
  .object({
    status: z.enum(PROVIDER_STATES),
    transactionId: opaqueIdentifierSchema.optional(),
  })
  .strict();

const observedProviderSchema = z
  .object({
    status: z.literal("OBSERVED"),
    providerState: z.enum([
      "INITIATED",
      "CLEARED",
      "QUEUED",
      "SENT",
      "STUCK",
      "CONFIRMED",
      "COMPLETE",
      "FAILED",
      "DENIED",
      "CANCELLED",
    ]),
    transactionId: opaqueIdentifierSchema.optional(),
  })
  .strict();

const arcSuccessEvidenceSchema = z
  .object({
    status: z.literal("OBSERVED_SUCCESS"),
    chainId: fixedChainIdSchema,
    transactionHash: bytes32Schema,
    covenantId: platformIdentifierSchema,
    recipient: addressSchema,
    amount: canonicalMoneySchema,
    token: fixedAddressSchema,
    vault: addressSchema.optional(),
    intentId: nullableIdentifierSchema.optional(),
    authorizationId: nullableIdentifierSchema.optional(),
    blockNumber: canonicalTimestampSchema.optional(),
    blockHash: bytes32Schema.optional(),
  })
  .strict();

const arcRevertedEvidenceSchema = z
  .object({
    status: z.literal("OBSERVED_REVERTED"),
    chainId: fixedChainIdSchema,
    transactionHash: bytes32Schema,
    covenantId: nullableIdentifierSchema.optional(),
    vault: addressSchema.optional(),
  })
  .strict();

const arcConflictEvidenceSchema = z
  .object({
    status: z.literal("EVIDENCE_CONFLICT"),
    reason: z.string().trim().min(1).max(256),
  })
  .strict();

const arcEvidenceSchema = z.union([
  z.enum(["NOT_OBSERVED", "OBSERVATION_UNAVAILABLE"]),
  arcSuccessEvidenceSchema,
  arcRevertedEvidenceSchema,
  arcConflictEvidenceSchema,
]);

export const executionEvidenceSchema = z
  .object({
    covenantId: platformIdentifierSchema,
    executionId: platformIdentifierSchema,
    transactionId: opaqueIdentifierSchema.nullable().optional(),
    provider: z.union([
      z.enum(PROVIDER_STATES),
      providerStateObjectSchema,
      observedProviderSchema,
    ]),
    arc: arcEvidenceSchema,
    knownTerminalFailure: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

export type PlatformNetwork = z.infer<typeof platformNetworkSchema>;
export type PlatformAsset = z.infer<typeof platformAssetSchema>;
export type CovenantConditions = z.infer<typeof covenantConditionsSchema>;
export type AuthorizationStatus = z.infer<typeof authorizationStatusSchema>;
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;
export type PlatformCovenant = z.infer<typeof platformCovenantSchema>;
export type CreateCovenantInput = z.infer<typeof createCovenantInputSchema>;
export type AuthorizationEvidence = z.infer<typeof authorizationEvidenceSchema>;
export type AuthorizationEvidenceSubmission = z.infer<
  typeof authorizationEvidenceSubmissionSchema
>;
export type ExecutionEvidence = z.infer<typeof executionEvidenceSchema>;

export const covenantResourceSchema = platformCovenantSchema;
export const publicCovenantSchema = platformCovenantSchema;
export const PLATFORM_V1_NETWORK = Object.freeze({
  id: PLATFORM_V1_NETWORK_ID,
  chainId: PLATFORM_V1_CHAIN_ID,
}) satisfies PlatformNetwork;
export const PLATFORM_V1_ASSET = Object.freeze({
  symbol: PLATFORM_V1_ASSET_SYMBOL,
  decimals: PLATFORM_V1_ASSET_DECIMALS,
  address: fixedUsdcAddress,
}) satisfies PlatformAsset;
export const ARC_TESTNET_CHAIN_ID_STRING = ARC_TESTNET_CHAIN_ID;
