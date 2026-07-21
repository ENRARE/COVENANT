import { verificationFailure } from "./errors.js";
import {
  canonicalRuleResultsSchema,
  covenantSpecSchema,
  signedAuthorizationReceiptSchema,
  signedDecisionReceiptSchema,
  signedPaymentIntentSchema,
} from "./schemas.js";
import {
  EIP712_DOMAIN_NAMES,
  deriveSigningDomainForCovenant,
  hashPaymentIntent,
  hashRuleResults,
  verifySignedAuthorizationReceiptForCovenant,
  verifySignedDecisionReceiptForCovenant,
  verifySignedPaymentIntentForCovenant,
} from "./typed-data.js";

function validatePaymentIntentRelationships(
  covenant: unknown,
  intent: unknown,
) {
  const covenantSpec = covenantSpecSchema.parse(covenant);
  const signedPaymentIntent = signedPaymentIntentSchema.parse(intent);
  const paymentIntent = signedPaymentIntent.payload;

  if (paymentIntent.covenantId !== covenantSpec.covenantId) {
    verificationFailure(
      "COVENANT_ID_MISMATCH",
      "PaymentIntent.covenantId does not match CovenantSpec.covenantId",
    );
  }
  if (paymentIntent.agentSigner !== covenantSpec.agentSigner) {
    verificationFailure(
      "UNTRUSTED_AGENT_SIGNER",
      "PaymentIntent.agentSigner is not CovenantSpec.agentSigner",
    );
  }
  if (paymentIntent.recipient !== covenantSpec.recipientAddress) {
    verificationFailure(
      "RECIPIENT_MISMATCH",
      "PaymentIntent.recipient does not match CovenantSpec.recipientAddress",
    );
  }
  if (paymentIntent.token !== covenantSpec.tokenAddress) {
    verificationFailure(
      "TOKEN_MISMATCH",
      "PaymentIntent.token does not match CovenantSpec.tokenAddress",
    );
  }
  if (paymentIntent.amount > covenantSpec.maxAmountPerPayment) {
    verificationFailure(
      "AMOUNT_EXCEEDS_LIMIT",
      "PaymentIntent.amount exceeds CovenantSpec.maxAmountPerPayment",
    );
  }
  if (paymentIntent.purpose !== covenantSpec.purpose) {
    verificationFailure(
      "PURPOSE_MISMATCH",
      "PaymentIntent.purpose does not match CovenantSpec.purpose",
    );
  }
  if (
    paymentIntent.createdAt < covenantSpec.validAfter ||
    paymentIntent.createdAt > covenantSpec.validUntil ||
    paymentIntent.expiresAt > covenantSpec.validUntil
  ) {
    verificationFailure(
      "COVENANT_INACTIVE",
      "PaymentIntent validity is outside CovenantSpec validity",
    );
  }
  return { covenantSpec, signedPaymentIntent, paymentIntent } as const;
}

export async function verifyAuthorizationChain(
  covenant: unknown,
  intent: unknown,
  decision: unknown,
  ruleResults: unknown,
  authorization: unknown,
) {
  const { covenantSpec, signedPaymentIntent, paymentIntent } =
    validatePaymentIntentRelationships(covenant, intent);
  const signedDecisionReceipt = signedDecisionReceiptSchema.parse(decision);
  const decisionReceipt = signedDecisionReceipt.payload;
  const canonicalRuleResults = canonicalRuleResultsSchema.parse(ruleResults);
  const signedAuthorizationReceipt =
    signedAuthorizationReceiptSchema.parse(authorization);
  const authorizationReceipt = signedAuthorizationReceipt.payload;

  const paymentIntentDomain = deriveSigningDomainForCovenant(
    covenant,
    EIP712_DOMAIN_NAMES.paymentIntent,
  );
  const rawPaymentIntent = (intent as { payload: unknown }).payload;
  const intentHash = hashPaymentIntent(rawPaymentIntent, paymentIntentDomain);

  if (decisionReceipt.covenantId !== covenantSpec.covenantId) {
    verificationFailure(
      "COVENANT_ID_MISMATCH",
      "DecisionReceipt.covenantId does not match CovenantSpec.covenantId",
    );
  }
  if (decisionReceipt.intentId !== paymentIntent.intentId) {
    verificationFailure(
      "INTENT_ID_MISMATCH",
      "DecisionReceipt.intentId does not match PaymentIntent.intentId",
    );
  }
  if (decisionReceipt.intentHash !== intentHash) {
    verificationFailure(
      "INTENT_HASH_MISMATCH",
      "DecisionReceipt.intentHash does not match the Covenant-anchored PaymentIntent digest",
    );
  }
  if (decisionReceipt.policyVersion !== covenantSpec.policyVersion) {
    verificationFailure(
      "POLICY_VERSION_MISMATCH",
      "DecisionReceipt.policyVersion does not match CovenantSpec.policyVersion",
    );
  }
  if (decisionReceipt.signer !== covenantSpec.authorizationSigner) {
    verificationFailure(
      "UNTRUSTED_AUTHORIZATION_SIGNER",
      "DecisionReceipt.signer is not CovenantSpec.authorizationSigner",
    );
  }
  const ruleResultsHash = hashRuleResults(canonicalRuleResults);
  if (decisionReceipt.ruleResultsHash !== ruleResultsHash) {
    verificationFailure(
      "RULE_RESULTS_MISMATCH",
      "DecisionReceipt.ruleResultsHash does not match canonical RuleResults",
    );
  }
  const allRulesPass = canonicalRuleResults.every(
    (result) => result.status === "PASS",
  );
  if ((decisionReceipt.decision === "APPROVED") !== allRulesPass) {
    verificationFailure(
      "RULE_RESULTS_NOT_ALL_PASSING",
      "APPROVED requires all canonical rules to pass and REJECTED requires at least one failure",
    );
  }
  if (decisionReceipt.decision !== "APPROVED") {
    verificationFailure(
      "DECISION_NOT_APPROVED",
      "Authorization requires an APPROVED DecisionReceipt",
    );
  }
  if (decisionReceipt.createdAt < paymentIntent.createdAt) {
    verificationFailure(
      "COVENANT_INACTIVE",
      "DecisionReceipt.createdAt precedes PaymentIntent.createdAt",
    );
  }
  if (decisionReceipt.createdAt >= paymentIntent.expiresAt) {
    verificationFailure(
      "INTENT_EXPIRED",
      "DecisionReceipt.createdAt must precede PaymentIntent.expiresAt",
    );
  }

  if (authorizationReceipt.decisionId !== decisionReceipt.decisionId) {
    verificationFailure(
      "AUTHORIZATION_DECISION_MISMATCH",
      "AuthorizationReceipt.decisionId does not match DecisionReceipt.decisionId",
    );
  }
  if (authorizationReceipt.covenantId !== covenantSpec.covenantId) {
    verificationFailure(
      "COVENANT_ID_MISMATCH",
      "AuthorizationReceipt.covenantId does not match CovenantSpec.covenantId",
    );
  }
  if (
    authorizationReceipt.intentHash !== decisionReceipt.intentHash ||
    authorizationReceipt.intentHash !== intentHash
  ) {
    verificationFailure(
      "INTENT_HASH_MISMATCH",
      "AuthorizationReceipt.intentHash does not match DecisionReceipt and PaymentIntent",
    );
  }
  if (authorizationReceipt.vaultAddress !== covenantSpec.vaultAddress) {
    verificationFailure(
      "VAULT_MISMATCH",
      "AuthorizationReceipt.vaultAddress does not match CovenantSpec.vaultAddress",
    );
  }
  if (authorizationReceipt.chainId !== covenantSpec.chainId) {
    verificationFailure(
      "CHAIN_MISMATCH",
      "AuthorizationReceipt.chainId does not match CovenantSpec.chainId",
    );
  }
  if (authorizationReceipt.policyVersion !== covenantSpec.policyVersion) {
    verificationFailure(
      "POLICY_VERSION_MISMATCH",
      "AuthorizationReceipt.policyVersion does not match CovenantSpec.policyVersion",
    );
  }
  if (authorizationReceipt.signer !== covenantSpec.authorizationSigner) {
    verificationFailure(
      "UNTRUSTED_AUTHORIZATION_SIGNER",
      "AuthorizationReceipt.signer is not CovenantSpec.authorizationSigner",
    );
  }
  if (authorizationReceipt.validUntil <= decisionReceipt.createdAt) {
    verificationFailure(
      "AUTHORIZATION_EXPIRED",
      "AuthorizationReceipt.validUntil must follow DecisionReceipt.createdAt",
    );
  }
  if (authorizationReceipt.validUntil > paymentIntent.expiresAt) {
    verificationFailure(
      "INTENT_EXPIRED",
      "AuthorizationReceipt.validUntil exceeds PaymentIntent.expiresAt",
    );
  }
  if (authorizationReceipt.validUntil > covenantSpec.validUntil) {
    verificationFailure(
      "AUTHORIZATION_EXPIRED",
      "AuthorizationReceipt.validUntil exceeds CovenantSpec.validUntil",
    );
  }

  await verifySignedPaymentIntentForCovenant(intent, covenant);
  await verifySignedDecisionReceiptForCovenant(decision, ruleResults, covenant);
  await verifySignedAuthorizationReceiptForCovenant(authorization, covenant);

  return {
    covenantSpec,
    signedPaymentIntent,
    signedDecisionReceipt,
    canonicalRuleResults,
    signedAuthorizationReceipt,
    intentHash,
  } as const;
}
