import { z } from "zod";
import { CANONICAL_RULE_IDS } from "./constants.js";
import {
  agentSignerAddressSchema,
  authorizationSignerAddressSchema,
  bytes32Schema,
  identifierSchema,
  issuerAddressSchema,
  moneySchema,
  mvpChainIdSchema,
  policyVersionSchema,
  positiveMoneySchema,
  positiveUintStringSchema,
  purposeSchema,
  recipientAddressSchema,
  signatureSchema,
  timestampSchema,
  tokenAddressSchema,
  uintStringSchema,
  vaultAddressSchema,
  vendorAddressSchema,
  versionSchema,
} from "./primitives.js";

const covenantSpecPayloadSchema = z
  .object({
    version: versionSchema,
    covenantId: identifierSchema,
    issuer: issuerAddressSchema,
    agentSigner: agentSignerAddressSchema,
    authorizationSigner: authorizationSignerAddressSchema,
    vaultAddress: vaultAddressSchema,
    chainId: mvpChainIdSchema,
    tokenAddress: tokenAddressSchema,
    recipientAddress: recipientAddressSchema,
    maxAmountPerPayment: positiveMoneySchema,
    totalBudget: positiveMoneySchema,
    maxPaymentCount: positiveUintStringSchema,
    validAfter: timestampSchema,
    validUntil: timestampSchema,
    purpose: purposeSchema,
    policyHash: bytes32Schema,
    policyVersion: policyVersionSchema,
    createdAt: timestampSchema,
  })
  .strict();

export const COVENANT_SPEC_SCHEMA_FIELD_NAMES =
  covenantSpecPayloadSchema.keyof().options;

export const covenantSpecSchema = covenantSpecPayloadSchema.superRefine(
  (value, context) => {
    const separatedRoles = [
      value.issuer,
      value.agentSigner,
      value.authorizationSigner,
    ];
    if (new Set(separatedRoles).size !== separatedRoles.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authorizationSigner"],
        message:
          "issuer, agentSigner, and authorizationSigner must be pairwise distinct",
      });
    }
    const prohibitedRecipients = [
      value.issuer,
      value.agentSigner,
      value.authorizationSigner,
      value.vaultAddress,
      value.tokenAddress,
    ];
    if (prohibitedRecipients.includes(value.recipientAddress)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recipientAddress"],
        message:
          "recipientAddress must differ from issuer, signers, vault, and token",
      });
    }
    if (value.validUntil <= value.validAfter) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validUntil"],
        message: "validUntil must occur after validAfter",
      });
    }
    if (value.createdAt > value.validAfter) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["createdAt"],
        message: "createdAt must not occur after validAfter",
      });
    }
    if (value.maxAmountPerPayment > value.totalBudget) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxAmountPerPayment"],
        message: "Per-payment maximum must not exceed total budget",
      });
    }
  },
);

const paymentIntentPayloadSchema = z
  .object({
    version: versionSchema,
    intentId: identifierSchema,
    covenantId: identifierSchema,
    agentSigner: agentSignerAddressSchema,
    recipient: recipientAddressSchema,
    token: tokenAddressSchema,
    amount: positiveMoneySchema,
    invoiceHash: bytes32Schema,
    purpose: purposeSchema,
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
    nonce: uintStringSchema,
  })
  .strict();

export const PAYMENT_INTENT_SCHEMA_FIELD_NAMES =
  paymentIntentPayloadSchema.keyof().options;

export const paymentIntentSchema = paymentIntentPayloadSchema.superRefine(
  (value, context) => {
    if (value.expiresAt <= value.createdAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "expiresAt must occur after createdAt",
      });
    }
  },
);

const invoicePayloadSchema = z
  .object({
    version: versionSchema,
    invoiceId: identifierSchema,
    vendor: vendorAddressSchema,
    recipient: recipientAddressSchema,
    token: tokenAddressSchema,
    amount: positiveMoneySchema,
    productId: z.string().trim().min(1).max(128),
    purpose: purposeSchema,
    issuedAt: timestampSchema,
    expiresAt: timestampSchema,
    nonce: uintStringSchema,
  })
  .strict();

export const INVOICE_SCHEMA_FIELD_NAMES = invoicePayloadSchema.keyof().options;

export const invoiceSchema = invoicePayloadSchema.superRefine(
  (value, context) => {
    if (value.expiresAt <= value.issuedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "expiresAt must occur after issuedAt",
      });
    }
  },
);

export const ruleResultSchema = z
  .object({
    ruleId: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    status: z.enum(["PASS", "FAIL"]),
    expected: z.string().max(512),
    actual: z.string().max(512),
    reason: z.string().trim().min(1).max(512),
  })
  .strict();

export const canonicalRuleResultsSchema = z
  .array(ruleResultSchema)
  .length(CANONICAL_RULE_IDS.length)
  .superRefine((results, context) => {
    CANONICAL_RULE_IDS.forEach((ruleId, index) => {
      if (results[index]?.ruleId !== ruleId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "ruleId"],
          message: `Expected canonical rule ${ruleId} at index ${String(index)}`,
        });
      }
    });
  });

const decisionReceiptPayloadSchema = z
  .object({
    version: versionSchema,
    decisionId: identifierSchema,
    covenantId: identifierSchema,
    intentId: identifierSchema,
    intentHash: bytes32Schema,
    decision: z.enum(["APPROVED", "REJECTED"]),
    ruleResultsHash: bytes32Schema,
    policyVersion: policyVersionSchema,
    createdAt: timestampSchema,
    signer: authorizationSignerAddressSchema,
  })
  .strict();

export const DECISION_RECEIPT_SCHEMA_FIELD_NAMES =
  decisionReceiptPayloadSchema.keyof().options;

export const decisionReceiptSchema = decisionReceiptPayloadSchema;

const authorizationReceiptPayloadSchema = z
  .object({
    version: versionSchema,
    authorizationId: identifierSchema,
    decisionId: identifierSchema,
    covenantId: identifierSchema,
    intentHash: bytes32Schema,
    vaultAddress: vaultAddressSchema,
    chainId: mvpChainIdSchema,
    policyVersion: policyVersionSchema,
    authorizationNonce: uintStringSchema,
    validUntil: timestampSchema,
    signer: authorizationSignerAddressSchema,
  })
  .strict();

export const AUTHORIZATION_RECEIPT_SCHEMA_FIELD_NAMES =
  authorizationReceiptPayloadSchema.keyof().options;

export const authorizationReceiptSchema = authorizationReceiptPayloadSchema;

const detachedEnvelope = <T extends z.ZodTypeAny>(payload: T) =>
  z.object({ payload, signature: signatureSchema }).strict();

export const signedPaymentIntentSchema = detachedEnvelope(paymentIntentSchema);
export const signedInvoiceSchema = detachedEnvelope(invoiceSchema);
export const signedDecisionReceiptSchema = detachedEnvelope(
  decisionReceiptSchema,
);
export const signedAuthorizationReceiptSchema = detachedEnvelope(
  authorizationReceiptSchema,
);

export type CovenantSpec = z.infer<typeof covenantSpecSchema>;
export type PaymentIntent = z.infer<typeof paymentIntentSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type RuleResult = z.infer<typeof ruleResultSchema>;
export type CanonicalRuleResults = z.infer<typeof canonicalRuleResultsSchema>;
export type DecisionReceipt = z.infer<typeof decisionReceiptSchema>;
export type AuthorizationReceipt = z.infer<typeof authorizationReceiptSchema>;
export type SignedPaymentIntent = z.infer<typeof signedPaymentIntentSchema>;
export type SignedInvoice = z.infer<typeof signedInvoiceSchema>;
export type SignedDecisionReceipt = z.infer<typeof signedDecisionReceiptSchema>;
export type SignedAuthorizationReceipt = z.infer<
  typeof signedAuthorizationReceiptSchema
>;

export const nonNegativeMoneySchema = moneySchema;
