import {
  ARC_TESTNET_CHAIN_ID_STRING,
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
import { AuthorityError } from "../errors.js";
import type { AuthorizationReservation } from "../ports/repositories.js";
import type { ReceiptSigner } from "../ports/receipt-signer.js";
import type { RawSignedAuthorizationReceipt } from "../types.js";

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

  let signature: ReturnType<typeof signatureSchema.parse>;
  try {
    signature = signatureSchema.parse(
      await input.signer.signAuthorizationReceipt(typedData),
    );
  } catch {
    throw new AuthorityError(
      "SIGNING_FAILURE",
      "Authorization signing operation failed",
    );
  }

  const envelope = { payload: rawPayload, signature };
  try {
    await verifyAuthorizationChain(
      input.rawCovenant,
      input.rawSignedPaymentIntent,
      input.rawDecisionReceipt,
      input.ruleResults,
      envelope,
    );
  } catch {
    throw new AuthorityError(
      "SELF_VERIFICATION_FAILED",
      "Issued AuthorizationReceipt failed self-verification",
    );
  }
  return envelope;
}
