import {
  CANONICAL_RULE_IDS,
  EIP712_DOMAIN_NAMES,
  buildAuthorizationReceiptTypedData,
  buildDecisionReceiptTypedData,
  buildPaymentIntentTypedData,
  deriveSigningDomainForCovenant,
  hashPaymentIntent,
  hashRuleResults,
} from "@covenant/spec";
import type {
  AuthorizationEvidenceSubmission,
  PlatformCovenant,
} from "@covenant/core";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const TOKEN = "0x3600000000000000000000000000000000000000";
const VAULT = "0x4000000000000000000000000000000000000004";

function bytes32(value: number): `0x${string}` {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function signTypedData(
  account: ReturnType<typeof privateKeyToAccount>,
  typedData: unknown,
) {
  return account.signTypedData(
    typedData as Parameters<typeof account.signTypedData>[0],
  );
}

export async function createEvidence(
  resource: PlatformCovenant,
  decision: "APPROVED" | "REJECTED" = "APPROVED",
): Promise<{
  context: { covenantSpec: unknown };
  submission: AuthorizationEvidenceSubmission;
}> {
  const agent = privateKeyToAccount(generatePrivateKey());
  const authorization = privateKeyToAccount(generatePrivateKey());
  const createdAt = BigInt(resource.createdAt);
  const expiresAt = BigInt(resource.expiresAt);
  const covenantSpec = {
    version: "1",
    covenantId: resource.id,
    issuer: resource.payer,
    agentSigner: agent.address,
    authorizationSigner: authorization.address,
    vaultAddress: VAULT,
    chainId: "5042002",
    tokenAddress: TOKEN,
    recipientAddress: resource.beneficiary,
    maxAmountPerPayment: resource.amount,
    totalBudget: resource.amount,
    maxPaymentCount: "1",
    validAfter: createdAt.toString(),
    validUntil: expiresAt.toString(),
    purpose: "COV-026 reference payment",
    policyHash: resource.conditions.policyHash,
    policyVersion: resource.conditions.policyVersion,
    createdAt: createdAt.toString(),
  };
  const intent = {
    version: "1",
    intentId: bytes32(2),
    covenantId: resource.id,
    agentSigner: agent.address,
    recipient: resource.beneficiary,
    token: TOKEN,
    amount: resource.amount,
    invoiceHash: bytes32(8),
    purpose: covenantSpec.purpose,
    createdAt: (createdAt + 1n).toString(),
    expiresAt: (createdAt + 100n).toString(),
    nonce: "1",
  };
  const intentDomain = deriveSigningDomainForCovenant(
    covenantSpec,
    EIP712_DOMAIN_NAMES.paymentIntent,
  );
  const intentHash = hashPaymentIntent(intent, intentDomain);
  const signedPaymentIntent = {
    payload: intent,
    signature: await signTypedData(
      agent,
      buildPaymentIntentTypedData(intent, intentDomain),
    ),
  };
  const ruleResults = CANONICAL_RULE_IDS.map((ruleId) => ({
    ruleId,
    status:
      decision === "REJECTED" && ruleId === "recipient_allowed"
        ? ("FAIL" as const)
        : ("PASS" as const),
    expected: "policy requirement satisfied",
    actual: "policy requirement satisfied",
    reason: `${ruleId} ${decision === "REJECTED" && ruleId === "recipient_allowed" ? "failed" : "passed"}`,
  }));
  const decisionId = bytes32(decision === "APPROVED" ? 4 : 5);
  const decisionPayload = {
    version: "1",
    decisionId,
    covenantId: resource.id,
    intentId: intent.intentId,
    intentHash,
    decision,
    ruleResultsHash: hashRuleResults(ruleResults),
    policyVersion: resource.conditions.policyVersion,
    createdAt: (createdAt + 2n).toString(),
    signer: authorization.address,
  };
  const decisionDomain = deriveSigningDomainForCovenant(
    covenantSpec,
    EIP712_DOMAIN_NAMES.decisionReceipt,
  );
  const signedDecisionReceipt = {
    payload: decisionPayload,
    signature: await signTypedData(
      authorization,
      buildDecisionReceiptTypedData(decisionPayload, decisionDomain),
    ),
  };
  const evidence = {
    covenantId: resource.id,
    policyVersion: resource.conditions.policyVersion,
    decisionId,
    intentId: intent.intentId,
    intentHash,
    decision,
    authorizationId: decision === "APPROVED" ? bytes32(6) : null,
    validUntil: decision === "APPROVED" ? (createdAt + 50n).toString() : null,
    signedDecisionReceipt,
    ...(decision === "APPROVED"
      ? {
          signedAuthorizationReceipt: {
            payload: {
              version: "1",
              authorizationId: bytes32(6),
              decisionId,
              covenantId: resource.id,
              intentHash,
              vaultAddress: VAULT,
              chainId: "5042002",
              policyVersion: resource.conditions.policyVersion,
              authorizationNonce: "1",
              validUntil: (createdAt + 50n).toString(),
              signer: authorization.address,
            },
            signature: await signTypedData(
              authorization,
              buildAuthorizationReceiptTypedData(
                {
                  version: "1",
                  authorizationId: bytes32(6),
                  decisionId,
                  covenantId: resource.id,
                  intentHash,
                  vaultAddress: VAULT,
                  chainId: "5042002",
                  policyVersion: resource.conditions.policyVersion,
                  authorizationNonce: "1",
                  validUntil: (createdAt + 50n).toString(),
                  signer: authorization.address,
                },
                deriveSigningDomainForCovenant(
                  covenantSpec,
                  EIP712_DOMAIN_NAMES.authorizationReceipt,
                ),
              ),
            ),
          },
        }
      : {}),
  };
  return {
    context: { covenantSpec },
    submission: { evidence, signedPaymentIntent, ruleResults },
  };
}

export function tamperSignature(
  submission: AuthorizationEvidenceSubmission,
): AuthorizationEvidenceSubmission {
  const signed = submission.evidence.signedDecisionReceipt as {
    payload: unknown;
    signature: string;
  };
  return {
    ...submission,
    evidence: {
      ...submission.evidence,
      signedDecisionReceipt: { ...signed, signature: `0x${"00".repeat(65)}` },
    },
  };
}
