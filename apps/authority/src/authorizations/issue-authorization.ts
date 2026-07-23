import {
  ARC_TESTNET_CHAIN_ID_STRING,
  CovenantVerificationError,
  SCHEMA_VERSION,
  authorizationReceiptSchema,
  buildAuthorizationReceiptTypedData,
  deriveSigningDomainForCovenant,
  EIP712_DOMAIN_NAMES,
  signatureSchema,
  verifyAuthorizationChain,
  type CanonicalRuleResults,
  type CovenantSpec,
} from "@covenant/spec";
import {
  AUTHORITY_ERROR_MESSAGES,
  AuthorityError,
  callDependency,
  type AuthorityErrorCode,
} from "../errors.js";
import type { AuthorizationReservation } from "../ports/repositories.js";
import type { ReceiptSigner } from "../ports/receipt-signer.js";
import type { RawSignedAuthorizationReceipt } from "../types.js";

function authorizationVerificationError(error: unknown): AuthorityError {
  let code: AuthorityErrorCode = "SELF_VERIFICATION_FAILED";
  if (error instanceof CovenantVerificationError) {
    switch (error.code) {
      case "AUTHORIZATION_DECISION_MISMATCH":
        code = "AUTHORIZATION_DECISION_MISMATCH";
        break;
      case "COVENANT_ID_MISMATCH":
        code = "AUTHORIZATION_COVENANT_MISMATCH";
        break;
      case "INTENT_HASH_MISMATCH":
        code = "AUTHORIZATION_INTENT_HASH_MISMATCH";
        break;
      case "VAULT_MISMATCH":
        code = "AUTHORIZATION_VAULT_MISMATCH";
        break;
      case "CHAIN_MISMATCH":
        code = "AUTHORIZATION_CHAIN_MISMATCH";
        break;
      case "POLICY_VERSION_MISMATCH":
        code = "AUTHORIZATION_POLICY_VERSION_MISMATCH";
        break;
      case "UNTRUSTED_AUTHORIZATION_SIGNER":
        code = "AUTHORIZATION_SIGNER_MISMATCH";
        break;
      case "AUTHORIZATION_EXPIRED":
      case "INTENT_EXPIRED":
        code = "AUTHORIZATION_VALIDITY_INVALID";
        break;
      case "SIGNATURE_INVALID":
        code = "AUTHORIZATION_SIGNATURE_INVALID";
        break;
      default:
        code = "SELF_VERIFICATION_FAILED";
    }
  }
  return new AuthorityError(code, AUTHORITY_ERROR_MESSAGES[code]);
}

export async function verifyAuthorizationReceiptLinkage(input: {
  rawCovenant: unknown;
  rawSignedPaymentIntent: unknown;
  rawDecisionReceipt: unknown;
  ruleResults: CanonicalRuleResults;
  authorizationReceipt: unknown;
}) {
  try {
    return await verifyAuthorizationChain(
      input.rawCovenant,
      input.rawSignedPaymentIntent,
      input.rawDecisionReceipt,
      input.ruleResults,
      input.authorizationReceipt,
    );
  } catch (error) {
    throw authorizationVerificationError(error);
  }
}

export async function issueAuthorizationReceipt(input: {
  rawCovenant: unknown;
  covenant: CovenantSpec;
  rawSignedPaymentIntent: unknown;
  rawDecisionReceipt: unknown;
  ruleResults: CanonicalRuleResults;
  intentHash: `0x${string}`;
  decisionId: `0x${string}`;
  validUntil: bigint;
  reservation: AuthorizationReservation;
  signer: ReceiptSigner;
}): Promise<RawSignedAuthorizationReceipt> {
  const rawPayload = {
    version: SCHEMA_VERSION,
    authorizationId: input.reservation.authorizationId,
    decisionId: input.decisionId,
    covenantId: input.covenant.covenantId,
    intentHash: input.intentHash,
    vaultAddress: input.covenant.vaultAddress,
    chainId: ARC_TESTNET_CHAIN_ID_STRING,
    policyVersion: input.covenant.policyVersion,
    authorizationNonce: input.reservation.authorizationNonce.toString(),
    validUntil: input.validUntil.toString(),
    signer: input.covenant.authorizationSigner,
  } as const;
  authorizationReceiptSchema.parse(rawPayload);
  const domain = deriveSigningDomainForCovenant(
    input.rawCovenant,
    EIP712_DOMAIN_NAMES.authorizationReceipt,
  );
  const typedData = buildAuthorizationReceiptTypedData(rawPayload, domain);

  const rawSignature = await callDependency({
    operation: () => input.signer.signAuthorizationReceipt(typedData),
    code: "AUTHORIZATION_SIGNING_FAILURE",
  });
  let signature: ReturnType<typeof signatureSchema.parse>;
  try {
    signature = signatureSchema.parse(rawSignature);
  } catch {
    throw new AuthorityError(
      "AUTHORIZATION_SIGNING_FAILURE",
      AUTHORITY_ERROR_MESSAGES.AUTHORIZATION_SIGNING_FAILURE,
    );
  }

  const envelope = { payload: rawPayload, signature };
  try {
    await verifyAuthorizationReceiptLinkage({
      rawCovenant: input.rawCovenant,
      rawSignedPaymentIntent: input.rawSignedPaymentIntent,
      rawDecisionReceipt: input.rawDecisionReceipt,
      ruleResults: input.ruleResults,
      authorizationReceipt: envelope,
    });
  } catch (error) {
    if (error instanceof AuthorityError) throw error;
    throw new AuthorityError(
      "SELF_VERIFICATION_FAILED",
      AUTHORITY_ERROR_MESSAGES.SELF_VERIFICATION_FAILED,
    );
  }
  return envelope;
}
