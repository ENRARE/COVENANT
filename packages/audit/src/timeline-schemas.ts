import {
  CANONICAL_RULE_IDS,
  addressSchema,
  formatUsdc,
  parseUsdc,
} from "@covenant/spec";
import { z } from "zod";
import {
  canonicalDigest,
  deepFreeze,
  type CanonicalJsonValue,
} from "./canonical-json.js";
import {
  AUDIT_MODE,
  AUDIT_SCHEMA_VERSION,
  AUDIT_SOURCE_KINDS,
  CLAIM_SCOPES,
  EVIDENCE_CLASSES,
  EVENT_OUTCOMES,
  LIFECYCLE_STAGES,
  NORMALIZED_EVENT_TYPES,
} from "./constants.js";

const lowercaseBytes32Schema = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/u, "Expected lowercase bytes32");
const positiveDecimalSchema = z.string().regex(/^[1-9][0-9]*$/u);
const canonicalDecimalSchema = z.string().regex(/^(0|[1-9][0-9]*)$/u);
const occurredAtSchema = z.string().regex(/^[1-9][0-9]*$/u);
const canonicalAmountSchema = z.string().refine((value) => {
  try {
    return formatUsdc(parseUsdc(value)) === value;
  } catch {
    return false;
  }
});

export const SOURCE_EVENT_TYPES = Object.freeze([
  "PAYMENT_INTENT_PROPOSED",
  "DECISION_APPROVED",
  "DECISION_REJECTED",
  "AUTHORIZATION_ISSUED",
  "EXECUTOR_REQUEST_PREPARED",
  "SIMULATION_ACCEPTED",
  "SUBMISSION_SIMULATED",
  "PaymentIntent",
  "DecisionReceipt",
  "AuthorizationReceipt",
  "PREPARED",
  "SIMULATED",
  "SUBMITTED",
  "LOCAL_EVM_DEPLOYMENT_VERIFIED",
  "LOCAL_VAULT_FUNDED_VERIFIED",
  "LOCAL_VAULT_EXECUTION_SUBMITTED",
  "LOCAL_VAULT_EXECUTION_VERIFIED",
  "LOCAL_REPLAY_REJECTED",
  "LOCAL_BYPASS_REJECTED",
  "LOCAL_NON_ISSUER_REVOCATION_REJECTED",
  "LOCAL_COVENANT_REVOCATION_VERIFIED",
  "LOCAL_POST_REVOCATION_EXECUTION_REJECTED",
  "COV-010_DEPLOYMENT_MANIFEST",
] as const);

export const normalizedSubjectSchema = z
  .object({
    covenantId: lowercaseBytes32Schema.optional(),
    invoiceId: lowercaseBytes32Schema.optional(),
    intentId: lowercaseBytes32Schema.optional(),
    decisionId: lowercaseBytes32Schema.optional(),
    authorizationId: lowercaseBytes32Schema.optional(),
    executionId: lowercaseBytes32Schema.optional(),
  })
  .strict();

export const normalizedSourceSchema = z
  .object({
    kind: z.enum(AUDIT_SOURCE_KINDS),
    eventType: z.enum(SOURCE_EVENT_TYPES),
    identity: lowercaseBytes32Schema,
    position: positiveDecimalSchema,
    occurredAt: occurredAtSchema.optional(),
  })
  .strict();

const emptyDetailsSchema = z.object({}).strict();
const ruleSummarySchema = z
  .object({
    ruleId: z.enum(CANONICAL_RULE_IDS),
    status: z.enum(["PASS", "FAIL"]),
  })
  .strict();
const canonicalRuleSummaryArraySchema = z
  .array(ruleSummarySchema)
  .length(CANONICAL_RULE_IDS.length)
  .superRefine((rules, context) => {
    CANONICAL_RULE_IDS.forEach((ruleId, index) => {
      if (rules[index]?.ruleId !== ruleId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "ruleId"],
          message: `Expected ${ruleId}`,
        });
      }
    });
  });

const eventDetailSchemas = {
  PROPOSAL_CREATED: z.object({ amount: canonicalAmountSchema }).strict(),
  POLICY_DECISION_RECORDED: z
    .object({
      decision: z.enum(["APPROVED", "REJECTED"]),
      ruleResults: canonicalRuleSummaryArraySchema,
    })
    .strict(),
  SIGNED_AUTHORIZATION_CREATED: z
    .object({ validUntil: canonicalDecimalSchema.optional() })
    .strict(),
  EXECUTOR_REQUEST_PREPARED: emptyDetailsSchema,
  TRANSPORT_SIMULATION_ACCEPTED: emptyDetailsSchema,
  TRANSPORT_SUBMISSION_ACCEPTED: z
    .object({
      transactionId: z
        .string()
        .min(1)
        .max(256)
        .regex(/^[A-Za-z0-9._:-]+$/u),
    })
    .strict(),
  SIMULATED_SUBMISSION_REFERENCE_RECORDED: z
    .object({ submissionReference: z.string().min(1).max(64) })
    .strict(),
  TRANSACTION_SUBMISSION_RECORDED: z
    .object({ mode: z.literal("LOCAL_ANVIL"), status: z.literal("PASS") })
    .strict(),
  EXECUTION_EVIDENCE_VERIFIED: z
    .object({ mode: z.literal("LOCAL_ANVIL"), status: z.literal("PASS") })
    .strict(),
  SETTLEMENT_EVIDENCE_RECORDED: z
    .object({ mode: z.literal("LOCAL_ANVIL"), status: z.literal("PASS") })
    .strict(),
  REPLAY_REJECTED: z
    .object({ mode: z.literal("LOCAL_ANVIL"), status: z.literal("PASS") })
    .strict(),
  INDIRECT_PROMPT_INJECTION_REJECTED: z
    .object({
      scenarioId: z.literal("compromised-proposer-v1"),
      failedRuleId: z.literal("recipient_allowed"),
      limitation: z.literal("FIXED_COMPROMISED_PROPOSER_SCENARIO_ONLY"),
      sourceEventIds: z.tuple([
        lowercaseBytes32Schema,
        lowercaseBytes32Schema,
        lowercaseBytes32Schema,
      ]),
    })
    .strict(),
  DIRECT_VAULT_BYPASS_REJECTED: z
    .object({ mode: z.literal("LOCAL_ANVIL"), status: z.literal("PASS") })
    .strict(),
  NON_ISSUER_REVOCATION_REJECTED: z
    .object({ mode: z.literal("LOCAL_ANVIL"), status: z.literal("PASS") })
    .strict(),
  REVOCATION_VERIFIED: z
    .object({ mode: z.literal("LOCAL_ANVIL"), status: z.literal("PASS") })
    .strict(),
  POST_REVOCATION_EXECUTION_REJECTED: z
    .object({ mode: z.literal("LOCAL_ANVIL"), status: z.literal("PASS") })
    .strict(),
  LOCAL_DEPLOYMENT_EVIDENCE_VERIFIED: z
    .object({ mode: z.literal("LOCAL_ANVIL"), status: z.literal("PASS") })
    .strict(),
  LOCAL_VAULT_FUNDING_EVIDENCE_VERIFIED: z
    .object({ mode: z.literal("LOCAL_ANVIL"), status: z.literal("PASS") })
    .strict(),
  ARC_DEPLOYMENT_EVIDENCE_VERIFIED: z
    .object({
      chainId: canonicalDecimalSchema,
      contractAddress: addressSchema,
      deploymentTransactionHash: lowercaseBytes32Schema,
      deploymentBlockNumber: positiveDecimalSchema,
      deploymentBlockHash: lowercaseBytes32Schema,
      actualRuntimeCodeHash: lowercaseBytes32Schema,
      trustedNetworkProfileDigest: lowercaseBytes32Schema,
      planDigest: lowercaseBytes32Schema,
      sourceGitCommit: z.string().regex(/^[0-9a-f]{40}$/u),
      receiptStatus: z.literal("SUCCESSFUL_EXECUTION"),
      finalityState: z.literal("FINAL_ARC_TRANSACTION"),
      finalityScope: z.literal("ARC_DEPLOYMENT_TRANSACTION_ONLY"),
      providerCorroborationState: z.enum([
        "PRIMARY_ONLY",
        "INDEPENDENTLY_CORROBORATED",
      ]),
      manifestDigest: lowercaseBytes32Schema,
    })
    .strict(),
} as const;

type EventClassification = Readonly<{
  stage: (typeof LIFECYCLE_STAGES)[number];
  outcome: (typeof EVENT_OUTCOMES)[number];
  evidenceClass: (typeof EVIDENCE_CLASSES)[number];
  claimScope: (typeof CLAIM_SCOPES)[number];
}>;

const EVENT_CLASSIFICATIONS = deepFreeze({
  PROPOSAL_CREATED: {
    stage: "PROPOSAL",
    outcome: "OBSERVED",
    evidenceClass: "VERIFIED_SIGNED_ARTIFACT",
    claimScope: "PROPOSAL_ONLY",
  },
  POLICY_DECISION_RECORDED: {
    stage: "POLICY_DECISION",
    outcome: "OBSERVED",
    evidenceClass: "VERIFIED_POLICY_OUTPUT",
    claimScope: "POLICY_DECISION_ONLY",
  },
  SIGNED_AUTHORIZATION_CREATED: {
    stage: "SIGNED_AUTHORIZATION",
    outcome: "OBSERVED",
    evidenceClass: "VERIFIED_SIGNED_ARTIFACT",
    claimScope: "SIGNED_AUTHORIZATION_ONLY",
  },
  EXECUTOR_REQUEST_PREPARED: {
    stage: "TRANSPORT_PREPARATION",
    outcome: "OBSERVED",
    evidenceClass: "EXECUTOR_TRANSPORT_OUTPUT",
    claimScope: "AUTHORIZED_REQUEST_PREPARATION_ONLY",
  },
  TRANSPORT_SIMULATION_ACCEPTED: {
    stage: "TRANSPORT_ACCEPTANCE",
    outcome: "ACCEPTED",
    evidenceClass: "SIMULATED_TRANSPORT_OUTPUT",
    claimScope: "SIMULATED_TRANSPORT_ACCEPTANCE_ONLY",
  },
  TRANSPORT_SUBMISSION_ACCEPTED: {
    stage: "TRANSPORT_ACCEPTANCE",
    outcome: "ACCEPTED",
    evidenceClass: "EXECUTOR_TRANSPORT_OUTPUT",
    claimScope: "EXECUTOR_TRANSPORT_ACCEPTANCE_ONLY",
  },
  SIMULATED_SUBMISSION_REFERENCE_RECORDED: {
    stage: "TRANSPORT_ACCEPTANCE",
    outcome: "OBSERVED",
    evidenceClass: "SIMULATED_TRANSPORT_OUTPUT",
    claimScope: "SIMULATED_SUBMISSION_REFERENCE_ONLY",
  },
  TRANSACTION_SUBMISSION_RECORDED: {
    stage: "TRANSACTION_SUBMISSION",
    outcome: "OBSERVED",
    evidenceClass: "LOCAL_EVM_RECEIPT_STATE_EVIDENCE",
    claimScope: "LOCAL_ANVIL_TRANSACTION_SUBMISSION",
  },
  EXECUTION_EVIDENCE_VERIFIED: {
    stage: "EXECUTION_EVIDENCE",
    outcome: "VERIFIED",
    evidenceClass: "LOCAL_EVM_RECEIPT_STATE_EVIDENCE",
    claimScope: "LOCAL_ANVIL_EXECUTION_EVIDENCE",
  },
  SETTLEMENT_EVIDENCE_RECORDED: {
    stage: "SETTLEMENT_EVIDENCE",
    outcome: "VERIFIED",
    evidenceClass: "LOCAL_EVM_RECEIPT_STATE_EVIDENCE",
    claimScope: "LOCAL_ANVIL_SETTLEMENT_OBSERVATION",
  },
  REPLAY_REJECTED: {
    stage: "SECURITY_CONTROL",
    outcome: "REJECTED",
    evidenceClass: "LOCAL_EVM_RECEIPT_STATE_EVIDENCE",
    claimScope: "LOCAL_ANVIL_REPLAY_REJECTION",
  },
  INDIRECT_PROMPT_INJECTION_REJECTED: {
    stage: "SECURITY_CONTROL",
    outcome: "REJECTED",
    evidenceClass: "DERIVED_SECURITY_SCENARIO_EVIDENCE",
    claimScope: "FIXED_COMPROMISED_PROPOSER_REJECTION",
  },
  DIRECT_VAULT_BYPASS_REJECTED: {
    stage: "SECURITY_CONTROL",
    outcome: "REJECTED",
    evidenceClass: "LOCAL_EVM_RECEIPT_STATE_EVIDENCE",
    claimScope: "LOCAL_ANVIL_DIRECT_BYPASS_REJECTION",
  },
  NON_ISSUER_REVOCATION_REJECTED: {
    stage: "REVOCATION",
    outcome: "REJECTED",
    evidenceClass: "LOCAL_EVM_RECEIPT_STATE_EVIDENCE",
    claimScope: "LOCAL_ANVIL_NON_ISSUER_REVOCATION_REJECTION",
  },
  REVOCATION_VERIFIED: {
    stage: "REVOCATION",
    outcome: "VERIFIED",
    evidenceClass: "LOCAL_EVM_RECEIPT_STATE_EVIDENCE",
    claimScope: "LOCAL_ANVIL_REVOCATION_EVIDENCE",
  },
  POST_REVOCATION_EXECUTION_REJECTED: {
    stage: "REVOCATION",
    outcome: "REJECTED",
    evidenceClass: "LOCAL_EVM_RECEIPT_STATE_EVIDENCE",
    claimScope: "LOCAL_ANVIL_POST_REVOCATION_REJECTION",
  },
  LOCAL_DEPLOYMENT_EVIDENCE_VERIFIED: {
    stage: "DEPLOYMENT_EVIDENCE",
    outcome: "VERIFIED",
    evidenceClass: "LOCAL_EVM_RECEIPT_STATE_EVIDENCE",
    claimScope: "LOCAL_ANVIL_DEPLOYMENT_EVIDENCE",
  },
  LOCAL_VAULT_FUNDING_EVIDENCE_VERIFIED: {
    stage: "DEPLOYMENT_EVIDENCE",
    outcome: "VERIFIED",
    evidenceClass: "LOCAL_EVM_RECEIPT_STATE_EVIDENCE",
    claimScope: "LOCAL_ANVIL_FUNDING_EVIDENCE",
  },
  ARC_DEPLOYMENT_EVIDENCE_VERIFIED: {
    stage: "DEPLOYMENT_EVIDENCE",
    outcome: "VERIFIED",
    evidenceClass: "COMMITTED_ARC_DEPLOYMENT_EVIDENCE",
    claimScope: "ARC_DEPLOYMENT_TRANSACTION_ONLY",
  },
} satisfies Record<
  (typeof NORMALIZED_EVENT_TYPES)[number],
  EventClassification
>);

const OBSERVATIONAL_DEMO_EVENT_TYPES = Object.freeze([
  "PROPOSAL_CREATED",
  "POLICY_DECISION_RECORDED",
  "SIGNED_AUTHORIZATION_CREATED",
  "EXECUTOR_REQUEST_PREPARED",
  "TRANSPORT_SIMULATION_ACCEPTED",
  "SIMULATED_SUBMISSION_REFERENCE_RECORDED",
] as const);

export function eventClassificationFor(
  eventType: (typeof NORMALIZED_EVENT_TYPES)[number],
  sourceKind: (typeof AUDIT_SOURCE_KINDS)[number],
): EventClassification {
  const classification = EVENT_CLASSIFICATIONS[eventType];
  if (
    sourceKind === "DEMO_AUDIT" &&
    (OBSERVATIONAL_DEMO_EVENT_TYPES as readonly string[]).includes(eventType)
  ) {
    return deepFreeze({
      ...classification,
      evidenceClass: "OBSERVATIONAL_DEMO_AUDIT",
    });
  }
  return classification;
}

export const normalizedAuditEventSchema = z
  .object({
    schemaVersion: z.literal(AUDIT_SCHEMA_VERSION),
    sequence: positiveDecimalSchema,
    eventId: lowercaseBytes32Schema,
    eventType: z.enum(NORMALIZED_EVENT_TYPES),
    stage: z.enum(LIFECYCLE_STAGES),
    outcome: z.enum(EVENT_OUTCOMES),
    evidenceClass: z.enum(EVIDENCE_CLASSES),
    claimScope: z.enum(CLAIM_SCOPES),
    source: normalizedSourceSchema,
    subject: normalizedSubjectSchema,
    causes: z.array(lowercaseBytes32Schema),
    details: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine((event, context) => {
    const classification = eventClassificationFor(
      event.eventType,
      event.source.kind,
    );
    const detailRecord = event.details;
    const expectedOutcome =
      event.eventType === "POLICY_DECISION_RECORDED" &&
      (detailRecord.decision === "APPROVED" ||
        detailRecord.decision === "REJECTED")
        ? detailRecord.decision
        : classification.outcome;
    for (const field of [
      "stage",
      "outcome",
      "evidenceClass",
      "claimScope",
    ] as const) {
      const expected =
        field === "outcome" ? expectedOutcome : classification[field];
      if (event[field] !== expected) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `Expected ${expected}`,
        });
      }
    }
    const details = eventDetailSchemas[event.eventType].safeParse(
      event.details,
    );
    if (!details.success) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["details"],
        message: "Event details do not match the event type",
      });
    }
    if (new Set(event.causes).size !== event.causes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["causes"],
        message: "Event causes must be unique",
      });
    }
    if (
      event.causes.some((cause, index) => {
        const previous = event.causes[index - 1];
        return previous !== undefined && cause < previous;
      })
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["causes"],
        message: "Event causes must use canonical lexical order",
      });
    }
    if (event.causes.includes(event.eventId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["causes"],
        message: "Event cannot cause itself",
      });
    }
  });

export const claimBoundarySchema = z
  .object({
    circleExecution: z.literal(false),
    arcPaymentSettlement: z.literal(false),
    paymentFinality: z.literal(false),
    databaseFinancialAuthority: z.literal(false),
  })
  .strict();

export const auditTimelineSchema = z
  .object({
    schemaVersion: z.literal(AUDIT_SCHEMA_VERSION),
    mode: z.literal(AUDIT_MODE),
    authoritative: z.literal(false),
    projectionId: lowercaseBytes32Schema,
    claimBoundary: claimBoundarySchema,
    events: z.array(normalizedAuditEventSchema),
  })
  .strict()
  .superRefine((timeline, context) => {
    const priorEventIds = new Set<string>();
    timeline.events.forEach((event, index) => {
      if (event.sequence !== String(index + 1)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", index, "sequence"],
          message: "Sequence is not canonical",
        });
      }
      const expectedEventId = canonicalDigest({
        auditSchemaVersion: AUDIT_SCHEMA_VERSION,
        normalizedEventType: event.eventType,
        sourceKind: event.source.kind,
        sourceEventType: event.source.eventType,
        sourceIdentity: event.source.identity,
        subjectIdentity: event.subject as unknown as CanonicalJsonValue,
      });
      if (event.eventId !== expectedEventId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", index, "eventId"],
          message: "Event identity mismatch",
        });
      }
      if (priorEventIds.has(event.eventId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", index, "eventId"],
          message: "Duplicate normalized event identity",
        });
      }
      for (const cause of event.causes) {
        if (!priorEventIds.has(cause)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["events", index, "causes"],
            message: "Cause must identify an earlier event",
          });
        }
      }
      priorEventIds.add(event.eventId);
    });
    const expectedProjectionId = canonicalDigest({
      schemaVersion: timeline.schemaVersion,
      mode: timeline.mode,
      authoritative: timeline.authoritative,
      claimBoundary: timeline.claimBoundary,
      events: timeline.events as unknown as CanonicalJsonValue,
    });
    if (timeline.projectionId !== expectedProjectionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectionId"],
        message: "Projection identity mismatch",
      });
    }
  });

export type NormalizedAuditEvent = z.infer<typeof normalizedAuditEventSchema>;
export type AuditTimeline = z.infer<typeof auditTimelineSchema>;
