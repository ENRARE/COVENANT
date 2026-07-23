import {
  authorizationSignerAddressSchema,
  canonicalRuleResultsSchema,
  covenantSpecSchema,
  nonzeroBytes32Schema,
  signedDecisionReceiptSchema,
  signedInvoiceSchema,
  signedPaymentIntentSchema,
  vaultAddressSchema,
} from "@covenant/spec";
import { z } from "zod";
import { AuthorityError } from "./errors.js";

const publicPaymentRequestSchema = z
  .object({ signedPaymentIntent: z.unknown(), signedInvoice: z.unknown() })
  .strict();

const publicAuthorizationRequestSchema = publicPaymentRequestSchema
  .extend({
    ruleResults: z.unknown(),
    decisionReceipt: z.unknown(),
  })
  .strict();

export const evidenceSnapshotSchema = z
  .object({
    chainId: z.bigint().nonnegative(),
    vaultAddress: vaultAddressSchema,
    observedAt: z.bigint().nonnegative(),
    revoked: z.boolean(),
    totalSpent: z.bigint().nonnegative(),
    paymentCount: z.bigint().nonnegative(),
    usedIntentHash: z.boolean(),
    usedIntentId: z.boolean(),
    usedAgentNonce: z.boolean(),
  })
  .strict();

export const approvedProductIdSchema = z.literal("gpu-h100-hour");

export type EvidenceSnapshot = z.infer<typeof evidenceSnapshotSchema>;

export function parseTrustedCovenant(value: unknown) {
  try {
    return { raw: value, parsed: covenantSpecSchema.parse(value) } as const;
  } catch {
    throw new AuthorityError(
      "DEPENDENCY_FAILURE",
      "Trusted Covenant configuration is invalid",
    );
  }
}

export function parsePaymentRequest(value: unknown) {
  try {
    const outer = publicPaymentRequestSchema.parse(value);
    return {
      rawSignedPaymentIntent: outer.signedPaymentIntent,
      signedPaymentIntent: signedPaymentIntentSchema.parse(
        outer.signedPaymentIntent,
      ),
      rawSignedInvoice: outer.signedInvoice,
      signedInvoice: signedInvoiceSchema.parse(outer.signedInvoice),
    } as const;
  } catch {
    throw new AuthorityError("MALFORMED_INPUT", "Payment request is malformed");
  }
}

export function parseAuthorizationRequest(value: unknown) {
  try {
    const outer = publicAuthorizationRequestSchema.parse(value);
    return {
      rawSignedPaymentIntent: outer.signedPaymentIntent,
      signedPaymentIntent: signedPaymentIntentSchema.parse(
        outer.signedPaymentIntent,
      ),
      rawSignedInvoice: outer.signedInvoice,
      signedInvoice: signedInvoiceSchema.parse(outer.signedInvoice),
      rawRuleResults: outer.ruleResults,
      ruleResults: canonicalRuleResultsSchema.parse(outer.ruleResults),
      rawDecisionReceipt: outer.decisionReceipt,
      decisionReceipt: signedDecisionReceiptSchema.parse(outer.decisionReceipt),
    } as const;
  } catch {
    throw new AuthorityError(
      "MALFORMED_INPUT",
      "Authorization request is malformed",
    );
  }
}

export function parseEvidence(value: unknown): EvidenceSnapshot {
  try {
    return evidenceSnapshotSchema.parse(value);
  } catch {
    throw new AuthorityError(
      "MALFORMED_EVIDENCE",
      "Authority evidence is malformed",
    );
  }
}

export function parseSignerAddress(value: unknown) {
  try {
    return authorizationSignerAddressSchema.parse(value);
  } catch {
    throw new AuthorityError(
      "SIGNER_MISMATCH",
      "Authorization signer address is invalid",
    );
  }
}

export function parseConfiguredVendor(value: unknown) {
  try {
    return authorizationSignerAddressSchema.parse(value);
  } catch {
    throw new AuthorityError(
      "DEPENDENCY_FAILURE",
      "Approved vendor configuration is invalid",
    );
  }
}

export function parseConfiguredProduct(value: unknown) {
  try {
    return approvedProductIdSchema.parse(value);
  } catch {
    throw new AuthorityError(
      "DEPENDENCY_FAILURE",
      "Approved product configuration is invalid",
    );
  }
}

export function parseClockValue(value: unknown): bigint {
  try {
    return z.bigint().positive().parse(value);
  } catch {
    throw new AuthorityError("DEPENDENCY_FAILURE", "Clock value is invalid");
  }
}

export function parseGeneratedIdentifier(value: unknown) {
  try {
    return nonzeroBytes32Schema.parse(value);
  } catch {
    throw new AuthorityError(
      "IDENTIFIER_INVALID",
      "Identifier generator returned an invalid identifier",
    );
  }
}

export function parseConsumedNonceResult(value: unknown): boolean {
  try {
    return z.boolean().parse(value);
  } catch {
    throw new AuthorityError(
      "MALFORMED_EVIDENCE",
      "Authorization nonce evidence is malformed",
    );
  }
}
