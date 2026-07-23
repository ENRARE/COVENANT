import {
  SCHEMA_VERSION,
  buildDecisionReceiptTypedData,
  decisionReceiptSchema,
  deriveSigningDomainForCovenant,
  EIP712_DOMAIN_NAMES,
  hashRuleResults,
  signatureSchema,
  verifySignedDecisionReceiptForCovenant,
  type CanonicalRuleResults,
  type CovenantSpec,
  type SignedPaymentIntent,
} from "@covenant/spec";
import { AuthorityError } from "../errors.js";
import { parseGeneratedIdentifier } from "../schemas.js";
import type { ReceiptSigner } from "../ports/receipt-signer.js";
import type { RawSignedDecisionReceipt } from "../types.js";

export async function issueDecision(input: {
  rawCovenant: unknown;
  covenant: CovenantSpec;
  intent: SignedPaymentIntent;
  intentHash: `0x${string}`;
  ruleResults: CanonicalRuleResults;
  status: "APPROVED" | "REJECTED";
  createdAt: bigint;
  stableContext: string;
  createId: (stableContext: string) => Promise<unknown>;
  signer: ReceiptSigner;
}): Promise<RawSignedDecisionReceipt> {
  const decisionId = parseGeneratedIdentifier(
    await input.createId(input.stableContext),
  );
  const rawPayload = {
    version: SCHEMA_VERSION,
    decisionId,
    covenantId: input.covenant.covenantId,
    intentId: input.intent.payload.intentId,
    intentHash: input.intentHash,
    decision: input.status,
    ruleResultsHash: hashRuleResults(input.ruleResults),
    policyVersion: input.covenant.policyVersion,
    createdAt: input.createdAt.toString(),
    signer: input.covenant.authorizationSigner,
  } as const;
  decisionReceiptSchema.parse(rawPayload);
  const domain = deriveSigningDomainForCovenant(
    input.rawCovenant,
    EIP712_DOMAIN_NAMES.decisionReceipt,
  );
  const typedData = buildDecisionReceiptTypedData(rawPayload, domain);

  let signature: ReturnType<typeof signatureSchema.parse>;
  try {
    signature = signatureSchema.parse(
      await input.signer.signDecisionReceipt(typedData),
    );
  } catch {
    throw new AuthorityError(
      "SIGNING_FAILURE",
      "Decision signing operation failed",
    );
  }

  const envelope = { payload: rawPayload, signature };
  try {
    const verified = await verifySignedDecisionReceiptForCovenant(
      envelope,
      input.ruleResults,
      input.rawCovenant,
    );
    if (
      verified.envelope.payload.ruleResultsHash !== rawPayload.ruleResultsHash
    )
      throw new Error("Rule commitment mismatch");
  } catch {
    throw new AuthorityError(
      "SELF_VERIFICATION_FAILED",
      "Issued DecisionReceipt failed self-verification",
    );
  }
  return envelope;
}
