import { auditEventSchema } from "@covenant/demo/audit-schema";
import {
  arcDeploymentManifestSchema,
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
