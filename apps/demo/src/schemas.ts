import { CANONICAL_RULE_IDS, parseUsdc, formatUsdc } from "@covenant/spec";
import { z } from "zod";
import { DEMO_ACTIONS } from "./actions.js";
import { COMPROMISED_SCENARIO_ID, HAPPY_SCENARIO_ID } from "./configuration.js";

const LOWERCASE_NONZERO_BYTES32 = /^0x(?!0{64}$)[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9]\d*)$/;
const POSITIVE_DECIMAL = /^[1-9]\d*$/;

export const lowercaseNonzeroBytes32Schema = z
  .string()
  .regex(LOWERCASE_NONZERO_BYTES32);
export const sequenceSchema = z.string().max(20).regex(DECIMAL);
export const occurredAtSchema = z.string().max(20).regex(POSITIVE_DECIMAL);
export const scenarioIdSchema = z.enum([
  HAPPY_SCENARIO_ID,
  COMPROMISED_SCENARIO_ID,
]);
export const canonicalAmountSchema = z.string().refine((value) => {
  try {
    return formatUsdc(parseUsdc(value)) === value;
  } catch {
    return false;
  }
});

export const ruleSummarySchema = z
  .object({
    ruleId: z.enum(CANONICAL_RULE_IDS),
    status: z.enum(["PASS", "FAIL"]),
  })
  .strict();

export const auditEventTypes = [
  "RUNTIME_INITIALIZED",
  "SCENARIO_SEEDED",
  "INVOICE_RECEIVED",
  "PAYMENT_INTENT_PROPOSED",
  "RULES_EVALUATED",
  "DECISION_APPROVED",
  "DECISION_REJECTED",
  "AUTHORIZATION_ISSUED",
  "EXECUTOR_REQUEST_PREPARED",
  "SIMULATION_ACCEPTED",
  "SUBMISSION_SIMULATED",
  "SCENARIO_COMPLETED",
  "DEMO_COMPLETED",
] as const;

const common = {
  schemaVersion: z.literal("1"),
  runtimeId: lowercaseNonzeroBytes32Schema,
  eventId: lowercaseNonzeroBytes32Schema,
  sequence: sequenceSchema,
  occurredAt: occurredAtSchema,
};

const scenarioCommon = {
  ...common,
  scenarioId: scenarioIdSchema,
};

export const auditEventSchema = z.discriminatedUnion("eventType", [
  z.object({ ...common, eventType: z.literal("RUNTIME_INITIALIZED") }).strict(),
  z
    .object({
      ...common,
      eventType: z.literal("SCENARIO_SEEDED"),
      covenantId: lowercaseNonzeroBytes32Schema,
    })
    .strict(),
  z
    .object({
      ...scenarioCommon,
      eventType: z.literal("INVOICE_RECEIVED"),
      invoiceId: lowercaseNonzeroBytes32Schema,
      amount: canonicalAmountSchema,
    })
    .strict(),
  z
    .object({
      ...scenarioCommon,
      eventType: z.literal("PAYMENT_INTENT_PROPOSED"),
      covenantId: lowercaseNonzeroBytes32Schema,
      invoiceId: lowercaseNonzeroBytes32Schema,
      intentId: lowercaseNonzeroBytes32Schema,
      amount: canonicalAmountSchema,
    })
    .strict(),
  z
    .object({
      ...scenarioCommon,
      eventType: z.literal("RULES_EVALUATED"),
      intentId: lowercaseNonzeroBytes32Schema,
      ruleResults: z.array(ruleSummarySchema).length(CANONICAL_RULE_IDS.length),
    })
    .strict(),
  z
    .object({
      ...scenarioCommon,
      eventType: z.literal("DECISION_APPROVED"),
      covenantId: lowercaseNonzeroBytes32Schema,
      intentId: lowercaseNonzeroBytes32Schema,
      decisionId: lowercaseNonzeroBytes32Schema,
    })
    .strict(),
  z
    .object({
      ...scenarioCommon,
      eventType: z.literal("DECISION_REJECTED"),
      covenantId: lowercaseNonzeroBytes32Schema,
      intentId: lowercaseNonzeroBytes32Schema,
      decisionId: lowercaseNonzeroBytes32Schema,
    })
    .strict(),
  z
    .object({
      ...scenarioCommon,
      eventType: z.literal("AUTHORIZATION_ISSUED"),
      covenantId: lowercaseNonzeroBytes32Schema,
      intentId: lowercaseNonzeroBytes32Schema,
      decisionId: lowercaseNonzeroBytes32Schema,
      authorizationId: lowercaseNonzeroBytes32Schema,
    })
    .strict(),
  z
    .object({
      ...scenarioCommon,
      eventType: z.literal("EXECUTOR_REQUEST_PREPARED"),
      intentId: lowercaseNonzeroBytes32Schema,
      authorizationId: lowercaseNonzeroBytes32Schema,
      executionId: lowercaseNonzeroBytes32Schema,
    })
    .strict(),
  z
    .object({
      ...scenarioCommon,
      eventType: z.literal("SIMULATION_ACCEPTED"),
      executionId: lowercaseNonzeroBytes32Schema,
    })
    .strict(),
  z
    .object({
      ...scenarioCommon,
      eventType: z.literal("SUBMISSION_SIMULATED"),
      executionId: lowercaseNonzeroBytes32Schema,
      submissionReference: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9-]+$/),
    })
    .strict(),
  z
    .object({
      ...scenarioCommon,
      eventType: z.literal("SCENARIO_COMPLETED"),
      decisionId: lowercaseNonzeroBytes32Schema,
    })
    .strict(),
  z
    .object({
      ...common,
      eventType: z.literal("DEMO_COMPLETED"),
      covenantId: lowercaseNonzeroBytes32Schema,
    })
    .strict(),
]);

export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditEventType = (typeof auditEventTypes)[number];

export const lockMetadataSchema = z
  .object({
    schemaVersion: z.literal("1"),
    runtimeId: lowercaseNonzeroBytes32Schema.nullable(),
    pid: z.string().max(20).regex(POSITIVE_DECIMAL),
    createdAt: occurredAtSchema,
  })
  .strict();
export type LockMetadata = z.infer<typeof lockMetadataSchema>;

const healthSchema = z
  .object({
    storage: z.enum(["READY", "MISSING", "CORRUPT"]),
    lock: z.enum(["AVAILABLE", "BUSY", "STALE"]),
    seeded: z.boolean(),
    arc: z.literal("NOT_CONFIGURED"),
    circle: z.literal("NOT_CONFIGURED"),
  })
  .strict();

export const runtimeProjectionSchema = z
  .object({
    schemaVersion: z.literal("1"),
    runtimeId: lowercaseNonzeroBytes32Schema.nullable(),
    mode: z.literal("LOCAL_SIMULATED"),
    status: z.enum([
      "UNINITIALIZED",
      "SEEDED",
      "RUNNING",
      "COMPLETED",
      "INTERRUPTED",
      "CORRUPT",
    ]),
    currentScenario: scenarioIdSchema.nullable(),
    health: healthSchema,
    covenant: z
      .object({
        covenantId: lowercaseNonzeroBytes32Schema,
        productId: z.literal("gpu-h100-hour"),
        tokenSymbol: z.literal("USDC"),
        chainId: z.literal("5042002"),
      })
      .strict()
      .nullable(),
    latestDecision: z
      .object({
        scenarioId: scenarioIdSchema,
        status: z.enum(["APPROVED", "REJECTED"]),
        decisionId: lowercaseNonzeroBytes32Schema,
        failedRuleIds: z.array(z.enum(CANONICAL_RULE_IDS)),
      })
      .strict()
      .nullable(),
    latestSubmission: z
      .object({
        status: z.literal("SIMULATED_SUBMISSION"),
        reference: z.string().min(1).max(64),
      })
      .strict()
      .nullable(),
    timeline: z.array(auditEventSchema),
    availableActions: z.array(z.enum(DEMO_ACTIONS)),
  })
  .strict();

export type RuntimeProjection = z.infer<typeof runtimeProjectionSchema>;
