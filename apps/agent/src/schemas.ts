import {
  agentSignerAddressSchema,
  covenantSpecSchema,
  nonzeroBytes32Schema,
  paymentIntentSchema,
  positiveMoneySchema,
  signatureSchema,
  signedInvoiceSchema,
  signedPaymentIntentSchema,
  vendorAddressSchema,
} from "@covenant/spec";
import { z } from "zod";
import { AgentError } from "./errors.js";
import type {
  AgentProposalResult,
  ProposalReservation,
  RawSignedInvoice,
} from "./types.js";

const productSchema = z.literal("gpu-h100-hour");
const ttlSchema = z.literal(600n);

const requestSchema = z
  .object({
    signedInvoice: z.unknown(),
    procurementRequest: z
      .object({
        productId: productSchema,
        expectedAmount: z.unknown(),
      })
      .strict(),
  })
  .strict();

const rawPaymentIntentPayloadSchema = z
  .object({
    version: z.string(),
    intentId: z.string(),
    covenantId: z.string(),
    agentSigner: z.string(),
    recipient: z.string(),
    token: z.string(),
    amount: z.string(),
    invoiceHash: z.string(),
    purpose: z.string(),
    createdAt: z.string(),
    expiresAt: z.string(),
    nonce: z.string(),
  })
  .strict();

const rawSignedInvoiceSchema = z
  .object({
    payload: z
      .object({
        version: z.string(),
        invoiceId: z.string(),
        vendor: z.string(),
        recipient: z.string(),
        token: z.string(),
        amount: z.string(),
        productId: z.string(),
        purpose: z.string(),
        issuedAt: z.string(),
        expiresAt: z.string(),
        nonce: z.string(),
      })
      .strict(),
    signature: z.string(),
  })
  .strict();

const rawSignedPaymentIntentSchema = z
  .object({ payload: rawPaymentIntentPayloadSchema, signature: z.string() })
  .strict();

const rawResultSchema = z
  .object({
    signedPaymentIntent: rawSignedPaymentIntentSchema,
    signedInvoice: rawSignedInvoiceSchema,
  })
  .strict();

const reservationSchema = z
  .object({
    intentId: z.string(),
    nonce: z.string(),
    rawPaymentIntentPayload: rawPaymentIntentPayloadSchema,
    completedResult: rawResultSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.intentId !== value.rawPaymentIntentPayload.intentId ||
      value.nonce !== value.rawPaymentIntentPayload.nonce
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reservation identity fields do not match its payload",
      });
    }
  });

export function parsePublicRequest(value: unknown) {
  try {
    const outer = requestSchema.parse(value);
    const signedInvoice = signedInvoiceSchema.parse(outer.signedInvoice);
    const rawSignedInvoice = rawSignedInvoiceSchema.parse(
      outer.signedInvoice,
    ) as RawSignedInvoice;
    return {
      rawSignedInvoice,
      signedInvoice,
      productId: outer.procurementRequest.productId,
      expectedAmount: positiveMoneySchema.parse(
        outer.procurementRequest.expectedAmount,
      ),
    } as const;
  } catch {
    throw new AgentError("MALFORMED_INPUT");
  }
}

export function parseTrustedCovenant(value: unknown) {
  try {
    return { raw: value, parsed: covenantSpecSchema.parse(value) } as const;
  } catch {
    throw new AgentError("COVENANT_INVALID");
  }
}

export function parseConfiguration(input: {
  approvedVendor: unknown;
  approvedProductId: unknown;
  intentTtlSeconds: unknown;
}) {
  try {
    return {
      approvedVendor: vendorAddressSchema.parse(input.approvedVendor),
      approvedProductId: productSchema.parse(input.approvedProductId),
      intentTtlSeconds: ttlSchema.parse(input.intentTtlSeconds),
    } as const;
  } catch {
    throw new AgentError("CONFIGURATION_INVALID");
  }
}

export function parseClock(value: unknown): bigint {
  try {
    return z.bigint().positive().parse(value);
  } catch {
    throw new AgentError("CLOCK_FAILURE");
  }
}

export function parseSignerAddress(value: unknown) {
  try {
    return agentSignerAddressSchema.parse(value);
  } catch {
    throw new AgentError("SIGNER_ADDRESS_FAILURE");
  }
}

export function parseIdentifier(value: unknown) {
  try {
    return nonzeroBytes32Schema.parse(value);
  } catch {
    throw new AgentError("IDENTIFIER_GENERATION_FAILURE");
  }
}

export function parseNonce(value: unknown): bigint {
  try {
    return z.bigint().nonnegative().parse(value);
  } catch {
    throw new AgentError("RESERVATION_REPOSITORY_FAILURE");
  }
}

export function parseReservation(value: unknown): ProposalReservation {
  try {
    const reservation = reservationSchema.parse(value);
    paymentIntentSchema.parse(reservation.rawPaymentIntentPayload);
    if (reservation.completedResult !== undefined) {
      signedPaymentIntentSchema.parse(
        reservation.completedResult.signedPaymentIntent,
      );
      signedInvoiceSchema.parse(reservation.completedResult.signedInvoice);
    }
    return reservation as ProposalReservation;
  } catch {
    throw new AgentError("RESERVATION_REPOSITORY_FAILURE");
  }
}

export function parseOptionalReservation(
  value: unknown,
): ProposalReservation | undefined {
  if (value === undefined) return undefined;
  return parseReservation(value);
}

export function parseSignature(value: unknown): string {
  try {
    return signatureSchema.parse(value);
  } catch {
    throw new AgentError("PAYMENT_INTENT_SIGNING_FAILURE");
  }
}

export function parseCompletedResult(value: unknown): AgentProposalResult {
  try {
    const result = rawResultSchema.parse(value);
    signedPaymentIntentSchema.parse(result.signedPaymentIntent);
    signedInvoiceSchema.parse(result.signedInvoice);
    return result;
  } catch {
    throw new AgentError("RESERVATION_REPOSITORY_FAILURE");
  }
}
