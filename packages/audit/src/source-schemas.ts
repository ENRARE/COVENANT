import { auditEventSchema } from "@covenant/demo/audit-schema";
import {
  arcDeploymentManifestSchema,
  addressSchema,
  canonicalRuleResultsSchema,
  hashRuleResults,
  localEvidenceResultSchema,
  signedAuthorizationReceiptSchema,
  signedDecisionReceiptSchema,
  signedPaymentIntentSchema,
} from "@covenant/spec";
import { z } from "zod";
import { AUDIT_SCHEMA_VERSION } from "./constants.js";

const lowercaseBytes32Schema = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/u, "Expected lowercase bytes32");

const nonzeroLowercaseBytes32Schema = lowercaseBytes32Schema.refine(
  (value) => value !== `0x${"00".repeat(32)}`,
  "Expected nonzero bytes32",
);

const canonicalOpaqueIdentifierSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:-]+$/u, "Opaque identifier is not sanitized");

const canonicalDecimalSchema = z.string().regex(/^(0|[1-9][0-9]*)$/u);
const positiveDecimalSchema = z.string().regex(/^[1-9][0-9]*$/u);
const reconciliationClassificationSchema = z.enum([
  "PROVIDER_ONLY",
  "ARC_NOT_OBSERVED",
  "ARC_EXECUTION_SUCCEEDED",
  "ARC_EXECUTION_REVERTED",
  "EVIDENCE_CONFLICT",
  "OBSERVATION_UNAVAILABLE",
]);
const providerStateSchema = z.enum([
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
]);
const providerEvidenceSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("UNKNOWN") }).strict(),
  z
    .object({
      status: z.literal("OBSERVED"),
      providerState: providerStateSchema,
      transactionHash: nonzeroLowercaseBytes32Schema.optional(),
    })
    .strict(),
]);
const arcConflictReasonSchema = z.enum([
  "MALFORMED_ARC_EVIDENCE",
  "MALFORMED_EXPECTATION",
  "WRONG_CHAIN",
  "MALFORMED_RECEIPT",
  "TRANSACTION_HASH_MISMATCH",
  "VAULT_TARGET_MISMATCH",
  "MALFORMED_BLOCK",
  "BLOCK_MISMATCH",
  "REMOVED_LOG",
  "REVERTED_RECEIPT_HAS_LOGS",
  "MISSING_PAYMENT_EXECUTED",
  "DUPLICATE_PAYMENT_EXECUTED",
  "MALFORMED_PAYMENT_EXECUTED",
  "WRONG_PAYMENT_EVENT_VAULT",
  "WRONG_COVENANT_ID",
  "WRONG_INTENT_ID",
  "WRONG_AUTHORIZATION_ID",
  "WRONG_RECIPIENT",
  "WRONG_AMOUNT",
  "MISSING_TOKEN_TRANSFER",
  "DUPLICATE_TOKEN_TRANSFER",
  "MALFORMED_TOKEN_TRANSFER",
  "WRONG_TOKEN",
  "WRONG_TRANSFER_SOURCE",
  "WRONG_TRANSFER_RECIPIENT",
  "WRONG_TRANSFER_AMOUNT",
  "MALFORMED_VAULT_STATE",
  "VAULT_STATE_CONFLICT",
]);
const observedArcSuccessSchema = z
  .object({
    status: z.literal("OBSERVED_SUCCESS"),
    chainId: z.literal(5_042_002),
    transactionHash: nonzeroLowercaseBytes32Schema,
    blockNumber: positiveDecimalSchema,
    blockHash: nonzeroLowercaseBytes32Schema,
    vault: addressSchema,
    covenantId: nonzeroLowercaseBytes32Schema,
    intentId: nonzeroLowercaseBytes32Schema,
    authorizationId: nonzeroLowercaseBytes32Schema,
    recipient: addressSchema,
    amount: positiveDecimalSchema,
    token: addressSchema,
    transfer: z
      .object({
        source: addressSchema,
        recipient: addressSchema,
        amount: positiveDecimalSchema,
      })
      .strict(),
    vaultState: z
      .object({
        totalSpent: canonicalDecimalSchema,
        paymentCount: canonicalDecimalSchema,
        revoked: z.boolean(),
        tokenBalance: canonicalDecimalSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.transfer.source !== value.vault ||
      value.transfer.recipient !== value.recipient ||
      value.transfer.amount !== value.amount
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Arc transfer does not match the observed execution",
      });
    }
  });
const arcEvidenceSchema = z.union([
  observedArcSuccessSchema,
  z
    .object({
      status: z.literal("OBSERVED_REVERTED"),
      chainId: z.literal(5_042_002),
      transactionHash: nonzeroLowercaseBytes32Schema,
      blockNumber: positiveDecimalSchema,
      blockHash: nonzeroLowercaseBytes32Schema,
      vault: addressSchema,
    })
    .strict(),
  z.object({ status: z.literal("NOT_OBSERVED") }).strict(),
  z
    .object({
      status: z.literal("EVIDENCE_CONFLICT"),
      reason: arcConflictReasonSchema,
    })
    .strict(),
  z.object({ status: z.literal("OBSERVATION_UNAVAILABLE") }).strict(),
]);
const expectedExecutionSchema = z
  .object({
    chainId: z.literal(5_042_002),
    transactionHash: nonzeroLowercaseBytes32Schema,
    vault: addressSchema,
    covenantId: nonzeroLowercaseBytes32Schema,
    intentId: nonzeroLowercaseBytes32Schema,
    authorizationId: nonzeroLowercaseBytes32Schema,
    executionId: nonzeroLowercaseBytes32Schema,
    recipient: addressSchema,
    amount: positiveDecimalSchema,
    token: addressSchema,
  })
  .strict();
const providerProgressionStateSchema = z.enum([
  "PREPARED",
  "SUBMISSION_ATTEMPT_STARTED",
  "UNKNOWN",
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
]);

function expectedClassification(
  provider: z.infer<typeof providerEvidenceSchema>,
  arc: z.infer<typeof arcEvidenceSchema>,
): z.infer<typeof reconciliationClassificationSchema> {
  if (arc.status === "EVIDENCE_CONFLICT") return "EVIDENCE_CONFLICT";
  if (arc.status === "OBSERVATION_UNAVAILABLE")
    return "OBSERVATION_UNAVAILABLE";
  if (arc.status === "NOT_OBSERVED")
    return provider.status === "OBSERVED"
      ? "PROVIDER_ONLY"
      : "ARC_NOT_OBSERVED";
  if (provider.status === "OBSERVED") {
    const hashConflict =
      provider.transactionHash !== undefined &&
      provider.transactionHash !== arc.transactionHash;
    const stateConflict =
      arc.status === "OBSERVED_SUCCESS"
        ? ["FAILED", "DENIED", "CANCELLED"].includes(provider.providerState)
        : ["SENT", "CONFIRMED", "COMPLETE"].includes(provider.providerState);
    if (hashConflict || stateConflict) return "EVIDENCE_CONFLICT";
  }
  return arc.status === "OBSERVED_SUCCESS"
    ? "ARC_EXECUTION_SUCCEEDED"
    : "ARC_EXECUTION_REVERTED";
}

const arcExecutionEvidenceSourceSchema = z
  .object({
    kind: z.literal("ARC_EXECUTION_EVIDENCE"),
    expected: expectedExecutionSchema,
    providerProgression: z.array(providerProgressionStateSchema).min(1).max(16),
    submissionAttemptObserved: z.literal(true),
    automaticRetry: z.literal(false),
    provider: providerEvidenceSchema,
    arc: arcEvidenceSchema,
    reconciliation: z
      .object({ classification: reconciliationClassificationSchema })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const expected = value.expected;
    const arc = value.arc;
    if (
      (arc.status === "OBSERVED_SUCCESS" &&
        (arc.transactionHash !== expected.transactionHash ||
          arc.vault !== expected.vault ||
          arc.covenantId !== expected.covenantId ||
          arc.intentId !== expected.intentId ||
          arc.authorizationId !== expected.authorizationId ||
          arc.recipient !== expected.recipient ||
          arc.amount !== expected.amount ||
          arc.token !== expected.token)) ||
      (arc.status === "OBSERVED_REVERTED" &&
        (arc.transactionHash !== expected.transactionHash ||
          arc.vault !== expected.vault)) ||
      value.reconciliation.classification !==
        expectedClassification(value.provider, value.arc)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Execution evidence is internally inconsistent",
      });
    }
  });

const demoAuditSourceSchema = z
  .object({
    kind: z.literal("DEMO_AUDIT"),
    events: z.array(auditEventSchema).min(1).max(1_000),
  })
  .strict();

const validatedSignedFlowSourceSchema = z
  .object({
    kind: z.literal("VALIDATED_SIGNED_FLOW"),
    intentDigest: nonzeroLowercaseBytes32Schema,
    decisionDigest: nonzeroLowercaseBytes32Schema,
    authorizationDigest: nonzeroLowercaseBytes32Schema.optional(),
    signedPaymentIntent: signedPaymentIntentSchema,
    ruleResults: canonicalRuleResultsSchema,
    signedDecisionReceipt: signedDecisionReceiptSchema,
    signedAuthorizationReceipt: signedAuthorizationReceiptSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const intent = value.signedPaymentIntent.payload;
    const decision = value.signedDecisionReceipt.payload;
    const authorization = value.signedAuthorizationReceipt?.payload;
    const allPass = value.ruleResults.every((rule) => rule.status === "PASS");

    if (
      decision.covenantId !== intent.covenantId ||
      decision.intentId !== intent.intentId ||
      decision.intentHash !== value.intentDigest ||
      decision.ruleResultsHash !== hashRuleResults(value.ruleResults) ||
      (decision.decision === "APPROVED") !== allPass
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Signed-flow objects are inconsistent",
      });
    }

    if (decision.decision === "REJECTED") {
      if (
        authorization !== undefined ||
        value.authorizationDigest !== undefined
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Rejected decision cannot include authorization",
        });
      }
      return;
    }

    if (
      (authorization === undefined) !==
      (value.authorizationDigest === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Authorization and its validated digest must appear together",
      });
      return;
    }

    if (
      authorization !== undefined &&
      (authorization.covenantId !== intent.covenantId ||
        authorization.decisionId !== decision.decisionId ||
        authorization.intentHash !== value.intentDigest ||
        authorization.policyVersion !== decision.policyVersion ||
        authorization.signer !== decision.signer)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Authorization is inconsistent with its approved decision",
      });
    }
  });

const executorLinkSchema = z
  .object({
    executionId: nonzeroLowercaseBytes32Schema,
    intentDigest: nonzeroLowercaseBytes32Schema,
    decisionDigest: nonzeroLowercaseBytes32Schema,
    authorizationDigest: nonzeroLowercaseBytes32Schema,
  })
  .strict();

const executorResultSchema = z.discriminatedUnion("status", [
  z
    .object({ status: z.literal("PREPARED"), execution: executorLinkSchema })
    .strict(),
  z
    .object({ status: z.literal("SIMULATED"), execution: executorLinkSchema })
    .strict(),
  z
    .object({
      status: z.literal("SUBMITTED"),
      execution: executorLinkSchema,
      transactionId: canonicalOpaqueIdentifierSchema,
    })
    .strict(),
]);

const executorResultSourceSchema = z
  .object({
    kind: z.literal("EXECUTOR_RESULT"),
    result: executorResultSchema,
  })
  .strict();

const localContractEvidenceSourceSchema = z
  .object({
    kind: z.literal("LOCAL_CONTRACT_EVIDENCE"),
    result: localEvidenceResultSchema,
  })
  .strict();

const arcDeploymentEvidenceSourceSchema = z
  .object({
    kind: z.literal("ARC_DEPLOYMENT_EVIDENCE"),
    manifest: arcDeploymentManifestSchema,
  })
  .strict();

export const auditSourceSchema = z.union([
  demoAuditSourceSchema,
  validatedSignedFlowSourceSchema,
  executorResultSourceSchema,
  localContractEvidenceSourceSchema,
  arcDeploymentEvidenceSourceSchema,
  arcExecutionEvidenceSourceSchema,
]);

export const auditSourceBundleSchema = z
  .object({
    schemaVersion: z.literal(AUDIT_SCHEMA_VERSION),
    sources: z.array(auditSourceSchema).min(1).max(1_000),
  })
  .strict();

export type AuditSource = z.infer<typeof auditSourceSchema>;
export type AuditSourceBundle = z.infer<typeof auditSourceBundleSchema>;
export type DemoAuditSource = z.infer<typeof demoAuditSourceSchema>;
export type ValidatedSignedFlowSource = z.infer<
  typeof validatedSignedFlowSourceSchema
>;
export type ExecutorResultSource = z.infer<typeof executorResultSourceSchema>;
export type LocalContractEvidenceSource = z.infer<
  typeof localContractEvidenceSourceSchema
>;
export type ArcDeploymentEvidenceSource = z.infer<
  typeof arcDeploymentEvidenceSourceSchema
>;
export type ArcExecutionEvidenceSource = z.infer<
  typeof arcExecutionEvidenceSourceSchema
>;
