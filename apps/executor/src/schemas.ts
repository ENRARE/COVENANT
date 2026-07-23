import {
  canonicalRuleResultsSchema,
  signedAuthorizationReceiptSchema,
  signedDecisionReceiptSchema,
  signedPaymentIntentSchema,
} from "@covenant/spec";
import { z } from "zod";
import { ExecutorError } from "./errors.js";

const publicExecutionRequestSchema = z
  .object({
    signedPaymentIntent: z.unknown(),
    ruleResults: z.unknown(),
    decisionReceipt: z.unknown(),
    authorizationReceipt: z.unknown(),
  })
  .strict();

export const simulationTransportResultSchema = z
  .object({ status: z.literal("SIMULATED") })
  .strict();

export const submissionTransportResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("SUBMITTED"),
      transactionId: z.string().trim().min(1).max(256),
    })
    .strict(),
  z
    .object({
      status: z.literal("REJECTED"),
      noSubmission: z.literal(true),
    })
    .strict(),
  z.object({ status: z.literal("AMBIGUOUS") }).strict(),
]);

export function parseExecutionRequest(value: unknown) {
  try {
    const raw = publicExecutionRequestSchema.parse(value);
    return {
      raw,
      signedPaymentIntent: signedPaymentIntentSchema.parse(
        raw.signedPaymentIntent,
      ),
      ruleResults: canonicalRuleResultsSchema.parse(raw.ruleResults),
      decisionReceipt: signedDecisionReceiptSchema.parse(raw.decisionReceipt),
      authorizationReceipt: signedAuthorizationReceiptSchema.parse(
        raw.authorizationReceipt,
      ),
    } as const;
  } catch {
    throw new ExecutorError("MALFORMED_EXECUTION_REQUEST");
  }
}

export function parseClockValue(value: unknown): bigint {
  try {
    return z.bigint().positive().parse(value);
  } catch {
    throw new ExecutorError("CLOCK_FAILURE");
  }
}

export function parseSubmissionTimeout(value: unknown): number {
  try {
    return z.number().int().positive().max(60_000).parse(value);
  } catch {
    throw new ExecutorError("EXECUTION_RESULT_AMBIGUOUS");
  }
}
