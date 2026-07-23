import {
  EIP712_DOMAIN_NAMES,
  deriveSigningDomainForCovenant,
  hashPaymentIntent,
  recoverPaymentIntentSigner,
  type CovenantSpec,
  type SignedInvoice,
  type SignedPaymentIntent,
} from "@covenant/spec";
import { verifyInvoice } from "../invoices/verify-invoice.js";
import type { EvidenceSnapshot } from "../schemas.js";
import { createCanonicalRuleResults } from "./rule-results.js";

export type PolicyEvaluation = {
  status: "APPROVED" | "REJECTED";
  ruleResults: ReturnType<typeof createCanonicalRuleResults>;
  intentHash: `0x${string}`;
  invoiceHash: `0x${string}`;
};

export async function evaluatePolicy(input: {
  rawCovenant: unknown;
  covenant: CovenantSpec;
  rawSignedPaymentIntent: unknown;
  signedPaymentIntent: SignedPaymentIntent;
  rawSignedInvoice: unknown;
  signedInvoice: SignedInvoice;
  evidence: EvidenceSnapshot;
  now: bigint;
  approvedVendor: string;
  approvedProductId: string;
}): Promise<PolicyEvaluation> {
  const paymentDomain = deriveSigningDomainForCovenant(
    input.rawCovenant,
    EIP712_DOMAIN_NAMES.paymentIntent,
  );
  const rawIntentPayload = (
    input.rawSignedPaymentIntent as { payload: unknown }
  ).payload;
  const intentHash = hashPaymentIntent(rawIntentPayload, paymentDomain);

  let recoveredIntentSigner: string | undefined;
  try {
    recoveredIntentSigner = await recoverPaymentIntentSigner(
      input.rawSignedPaymentIntent,
      paymentDomain,
    );
  } catch {
    recoveredIntentSigner = undefined;
  }

  const invoiceVerification = await verifyInvoice({
    rawCovenant: input.rawCovenant,
    covenant: input.covenant,
    rawSignedInvoice: input.rawSignedInvoice,
    invoice: input.signedInvoice,
    intent: input.signedPaymentIntent,
    approvedVendor: input.approvedVendor,
    approvedProductId: input.approvedProductId,
  });

  const covenant = input.covenant;
  const intent = input.signedPaymentIntent.payload;
  const invoice = input.signedInvoice.payload;
  const evidence = input.evidence;

  let covenantReason = "covenant_active";
  if (evidence.chainId !== covenant.chainId) covenantReason = "chain_mismatch";
  else if (evidence.vaultAddress !== covenant.vaultAddress)
    covenantReason = "vault_mismatch";
  else if (evidence.revoked) covenantReason = "covenant_revoked";
  else if (input.now < covenant.validAfter)
    covenantReason = "covenant_not_active";
  else if (input.now >= covenant.validUntil)
    covenantReason = "covenant_expired";
  else if (evidence.paymentCount >= covenant.maxPaymentCount)
    covenantReason = "payment_count_exhausted";
  else if (evidence.observedAt > input.now) covenantReason = "evidence_future";
  else if (input.now - evidence.observedAt > 30n)
    covenantReason = "evidence_stale";
  const covenantActive = covenantReason === "covenant_active";

  const signatureValid = recoveredIntentSigner !== undefined;
  const agentAuthorized =
    recoveredIntentSigner === covenant.agentSigner &&
    intent.agentSigner === covenant.agentSigner &&
    intent.covenantId === covenant.covenantId;
  const recipientAllowed = intent.recipient === covenant.recipientAddress;
  const tokenAllowed = intent.token === covenant.tokenAddress;

  let amountReason = "amount_within_limit";
  if (intent.amount <= 0n) amountReason = "amount_not_positive";
  else if (intent.amount > covenant.maxAmountPerPayment)
    amountReason = "amount_above_limit";
  else if (evidence.totalSpent > covenant.totalBudget)
    amountReason = "invalid_spend_evidence";
  else if (intent.amount > covenant.totalBudget - evidence.totalSpent)
    amountReason = "insufficient_budget";
  const amountWithinLimit = amountReason === "amount_within_limit";

  const purposeAllowed =
    intent.purpose === covenant.purpose && invoice.purpose === covenant.purpose;

  let timeReason = "intent_not_expired";
  if (input.now < intent.createdAt) timeReason = "request_not_started";
  else if (input.now >= intent.expiresAt) timeReason = "request_expired";
  else if (
    intent.createdAt < covenant.validAfter ||
    intent.expiresAt > covenant.validUntil
  )
    timeReason = "request_outside_covenant_window";
  else if (input.now < invoice.issuedAt) timeReason = "invoice_not_issued";
  else if (input.now >= invoice.expiresAt) timeReason = "invoice_expired";
  const intentNotExpired = timeReason === "intent_not_expired";

  const nonceUnused =
    !evidence.usedIntentHash &&
    !evidence.usedIntentId &&
    !evidence.usedAgentNonce;

  const ruleResults = createCanonicalRuleResults([
    {
      ruleId: "covenant_active",
      passed: covenantActive,
      expected: "active Covenant and evidence age <= 30 seconds",
      actual: covenantReason,
      failReason: covenantReason,
    },
    {
      ruleId: "intent_signature_valid",
      passed: signatureValid,
      expected: "canonical recoverable PaymentIntent signature",
      actual: signatureValid ? "valid_signature" : "invalid_signature",
      failReason: "invalid_signature",
    },
    {
      ruleId: "agent_authorized",
      passed: agentAuthorized,
      expected: "configured Covenant agent",
      actual: agentAuthorized
        ? "configured_agent"
        : intent.covenantId !== covenant.covenantId
          ? "different_covenant"
          : "different_agent",
      failReason:
        intent.covenantId === covenant.covenantId
          ? "unauthorized_agent"
          : "covenant_mismatch",
    },
    {
      ruleId: "recipient_allowed",
      passed: recipientAllowed,
      expected: covenant.recipientAddress,
      actual: intent.recipient,
      failReason: "recipient_mismatch",
    },
    {
      ruleId: "token_allowed",
      passed: tokenAllowed,
      expected: covenant.tokenAddress,
      actual: intent.token,
      failReason: "token_mismatch",
    },
    {
      ruleId: "amount_within_limit",
      passed: amountWithinLimit,
      expected: "positive amount within payment and remaining budget limits",
      actual: amountReason,
      failReason: amountReason,
    },
    {
      ruleId: "invoice_signature_valid",
      passed: invoiceVerification.signatureValid,
      expected: "canonical signature by configured vendor",
      actual: invoiceVerification.signatureReason,
      failReason: invoiceVerification.signatureReason,
    },
    {
      ruleId: "invoice_matches_intent",
      passed: invoiceVerification.matchesIntent,
      expected: "matching digest, recipient, token, amount, and product",
      actual: invoiceVerification.matchReason,
      failReason: invoiceVerification.matchReason,
    },
    {
      ruleId: "purpose_allowed",
      passed: purposeAllowed,
      expected: covenant.purpose,
      actual: purposeAllowed ? "configured_purpose" : "different_purpose",
      failReason: "purpose_mismatch",
    },
    {
      ruleId: "intent_not_expired",
      passed: intentNotExpired,
      expected: "currently valid intent and Invoice",
      actual: timeReason,
      failReason: timeReason,
    },
    {
      ruleId: "nonce_unused",
      passed: nonceUnused,
      expected: "unused intent digest, identifier, and agent nonce",
      actual: nonceUnused ? "nonce_unused" : "nonce_already_used",
      failReason: "nonce_already_used",
    },
  ]);

  const status = ruleResults.every((rule) => rule.status === "PASS")
    ? "APPROVED"
    : "REJECTED";
  return {
    status,
    ruleResults,
    intentHash,
    invoiceHash: invoiceVerification.invoiceHash,
  };
}
