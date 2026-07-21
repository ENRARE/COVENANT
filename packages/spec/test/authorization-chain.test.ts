import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { verifyAuthorizationChain } from "../src/context.js";
import {
  CovenantVerificationError,
  type VerificationErrorCode,
} from "../src/errors.js";
import {
  authorizationReceiptDomainFixture,
  decisionReceiptDomainFixture,
  fixtureAddresses,
  paymentIntentDomainFixture,
  rawApprovedRuleResultsFixture,
  rawApprovedSignedDecisionReceiptFixture,
  rawAuthorizationReceiptFixture,
  rawCovenantSpecFixture,
  rawPaymentIntentFixture,
  rawRejectedRuleResultsFixture,
  rawRejectedSignedDecisionReceiptFixture,
  rawSignedAuthorizationReceiptFixture,
  rawSignedPaymentIntentFixture,
} from "../src/fixtures.js";
import {
  buildAuthorizationReceiptTypedData,
  buildDecisionReceiptTypedData,
  buildPaymentIntentTypedData,
  hashRuleResults,
  verifySignedAuthorizationReceiptForCovenant,
  verifySignedDecisionReceiptForCovenant,
  verifySignedPaymentIntentForCovenant,
} from "../src/typed-data.js";

const agentAccount = privateKeyToAccount(`0x${"11".repeat(32)}`);
const authorizationAccount = privateKeyToAccount(`0x${"22".repeat(32)}`);
const attackerAccount = privateKeyToAccount(`0x${"99".repeat(32)}`);

async function expectCode(
  operation: Promise<unknown>,
  code: VerificationErrorCode,
): Promise<void> {
  try {
    await operation;
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(CovenantVerificationError);
    expect((error as CovenantVerificationError).code).toBe(code);
  }
}

function intentEnvelope(mutation: Record<string, unknown>) {
  return {
    ...rawSignedPaymentIntentFixture,
    payload: { ...rawSignedPaymentIntentFixture.payload, ...mutation },
  };
}

function decisionEnvelope(mutation: Record<string, unknown>) {
  return {
    ...rawApprovedSignedDecisionReceiptFixture,
    payload: {
      ...rawApprovedSignedDecisionReceiptFixture.payload,
      ...mutation,
    },
  };
}

function authorizationEnvelope(mutation: Record<string, unknown>) {
  return {
    ...rawSignedAuthorizationReceiptFixture,
    payload: {
      ...rawSignedAuthorizationReceiptFixture.payload,
      ...mutation,
    },
  };
}

function verifyChain(overrides?: {
  covenant?: unknown;
  intent?: unknown;
  decision?: unknown;
  rules?: unknown;
  authorization?: unknown;
}) {
  return verifyAuthorizationChain(
    overrides?.covenant ?? rawCovenantSpecFixture,
    overrides?.intent ?? rawSignedPaymentIntentFixture,
    overrides?.decision ?? rawApprovedSignedDecisionReceiptFixture,
    overrides?.rules ?? rawApprovedRuleResultsFixture,
    overrides?.authorization ?? rawSignedAuthorizationReceiptFixture,
  );
}

describe("Covenant-anchored authorization chain", () => {
  it("uses the deterministic fixture agent and authorization test identities", () => {
    expect(agentAccount.address).toBe(fixtureAddresses.agentSigner);
    expect(authorizationAccount.address).toBe(
      fixtureAddresses.authorizationSigner,
    );
  });

  it("accepts the complete deterministic authorization chain", async () => {
    await expect(verifyChain()).resolves.toMatchObject({
      intentHash: rawAuthorizationReceiptFixture.intentHash,
    });
  });

  it("normalizes lowercase trusted addresses before comparison", async () => {
    await expect(
      verifyChain({
        covenant: {
          ...rawCovenantSpecFixture,
          agentSigner: rawCovenantSpecFixture.agentSigner.toLowerCase(),
          authorizationSigner:
            rawCovenantSpecFixture.authorizationSigner.toLowerCase(),
          vaultAddress: rawCovenantSpecFixture.vaultAddress.toLowerCase(),
        },
      }),
    ).resolves.toBeDefined();
  });

  it.each([
    [
      "wrong Covenant ID",
      { covenantId: `0x${"31".repeat(32)}` },
      "COVENANT_ID_MISMATCH",
    ],
    [
      "wrong agent signer",
      { agentSigner: fixtureAddresses.attacker },
      "UNTRUSTED_AGENT_SIGNER",
    ],
    [
      "wrong recipient",
      { recipient: fixtureAddresses.attacker },
      "RECIPIENT_MISMATCH",
    ],
    ["wrong token", { token: fixtureAddresses.attacker }, "TOKEN_MISMATCH"],
    ["amount above limit", { amount: "5001" }, "AMOUNT_EXCEEDS_LIMIT"],
    ["wrong purpose", { purpose: "Unapproved purpose" }, "PURPOSE_MISMATCH"],
  ] as const)("rejects PaymentIntent %s", async (_label, mutation, code) => {
    await expectCode(verifyChain({ intent: intentEnvelope(mutation) }), code);
  });

  it("rejects a PaymentIntent self-signed by an untrusted proposer", async () => {
    const payload = {
      ...rawPaymentIntentFixture,
      agentSigner: attackerAccount.address,
    };
    const signature = await attackerAccount.signTypedData(
      buildPaymentIntentTypedData(payload, paymentIntentDomainFixture),
    );
    await expectCode(
      verifySignedPaymentIntentForCovenant(
        { payload, signature },
        rawCovenantSpecFixture,
      ),
      "UNTRUSTED_AGENT_SIGNER",
    );
  });

  it.each(["contract", "chain"] as const)(
    "rejects a PaymentIntent signed under the wrong domain %s",
    async (boundary) => {
      const typedData = buildPaymentIntentTypedData(
        rawPaymentIntentFixture,
        boundary === "contract"
          ? {
              ...paymentIntentDomainFixture,
              verifyingContract: fixtureAddresses.attacker,
            }
          : paymentIntentDomainFixture,
      );
      const signature = await agentAccount.signTypedData({
        ...typedData,
        domain:
          boundary === "chain"
            ? { ...typedData.domain, chainId: 1n }
            : typedData.domain,
      });
      await expectCode(
        verifySignedPaymentIntentForCovenant(
          { payload: rawPaymentIntentFixture, signature },
          rawCovenantSpecFixture,
        ),
        "UNTRUSTED_AGENT_SIGNER",
      );
    },
  );

  it.each([
    [
      "wrong Covenant ID",
      { covenantId: `0x${"32".repeat(32)}` },
      "COVENANT_ID_MISMATCH",
    ],
    [
      "wrong intent ID",
      { intentId: `0x${"33".repeat(32)}` },
      "INTENT_ID_MISMATCH",
    ],
    [
      "wrong intent hash",
      { intentHash: `0x${"34".repeat(32)}` },
      "INTENT_HASH_MISMATCH",
    ],
    [
      "wrong policy version",
      { policyVersion: "gpu-policy-2" },
      "POLICY_VERSION_MISMATCH",
    ],
    [
      "wrong signer",
      { signer: fixtureAddresses.attacker },
      "UNTRUSTED_AUTHORIZATION_SIGNER",
    ],
    ["created before intent", { createdAt: "1784563259" }, "COVENANT_INACTIVE"],
    [
      "created at intent expiry",
      { createdAt: rawPaymentIntentFixture.expiresAt },
      "INTENT_EXPIRED",
    ],
  ] as const)("rejects DecisionReceipt %s", async (_label, mutation, code) => {
    await expectCode(
      verifyChain({ decision: decisionEnvelope(mutation) }),
      code,
    );
  });

  it("rejects an attacker-self-signed DecisionReceipt", async () => {
    const payload = {
      ...rawApprovedSignedDecisionReceiptFixture.payload,
      signer: attackerAccount.address,
    };
    const signature = await attackerAccount.signTypedData(
      buildDecisionReceiptTypedData(payload, decisionReceiptDomainFixture),
    );
    await expectCode(
      verifySignedDecisionReceiptForCovenant(
        { payload, signature },
        rawApprovedRuleResultsFixture,
        rawCovenantSpecFixture,
      ),
      "UNTRUSTED_AUTHORIZATION_SIGNER",
    );
  });

  it("rejects a REJECTED DecisionReceipt paired with authorization", async () => {
    await expectCode(
      verifyChain({
        decision: rawRejectedSignedDecisionReceiptFixture,
        rules: rawRejectedRuleResultsFixture,
        authorization: authorizationEnvelope({
          decisionId:
            rawRejectedSignedDecisionReceiptFixture.payload.decisionId,
        }),
      }),
      "DECISION_NOT_APPROVED",
    );
  });

  it("rejects APPROVED when any canonical rule failed", async () => {
    const payload = {
      ...rawApprovedSignedDecisionReceiptFixture.payload,
      ruleResultsHash: hashRuleResults(rawRejectedRuleResultsFixture),
    };
    const signature = await authorizationAccount.signTypedData(
      buildDecisionReceiptTypedData(payload, decisionReceiptDomainFixture),
    );
    await expectCode(
      verifyChain({
        decision: { payload, signature },
        rules: rawRejectedRuleResultsFixture,
      }),
      "RULE_RESULTS_NOT_ALL_PASSING",
    );
  });

  it.each([
    [
      "wrong decision ID",
      { decisionId: `0x${"35".repeat(32)}` },
      "AUTHORIZATION_DECISION_MISMATCH",
    ],
    [
      "wrong Covenant ID",
      { covenantId: `0x${"36".repeat(32)}` },
      "COVENANT_ID_MISMATCH",
    ],
    [
      "wrong intent hash",
      { intentHash: `0x${"37".repeat(32)}` },
      "INTENT_HASH_MISMATCH",
    ],
    [
      "wrong vault",
      { vaultAddress: fixtureAddresses.attacker },
      "VAULT_MISMATCH",
    ],
    [
      "wrong policy version",
      { policyVersion: "gpu-policy-2" },
      "POLICY_VERSION_MISMATCH",
    ],
    [
      "wrong signer",
      { signer: fixtureAddresses.attacker },
      "UNTRUSTED_AUTHORIZATION_SIGNER",
    ],
    [
      "not after decision",
      { validUntil: "1784563300" },
      "AUTHORIZATION_EXPIRED",
    ],
    ["after intent expiry", { validUntil: "1784563561" }, "INTENT_EXPIRED"],
    ["after Covenant expiry", { validUntil: "1785168001" }, "INTENT_EXPIRED"],
  ] as const)(
    "rejects AuthorizationReceipt %s",
    async (_label, mutation, code) => {
      await expectCode(
        verifyChain({ authorization: authorizationEnvelope(mutation) }),
        code,
      );
    },
  );

  it("rejects an AuthorizationReceipt with a non-MVP chain", async () => {
    await expect(
      verifyChain({ authorization: authorizationEnvelope({ chainId: "1" }) }),
    ).rejects.toThrow();
  });

  it("rejects an attacker-self-signed AuthorizationReceipt", async () => {
    const payload = {
      ...rawAuthorizationReceiptFixture,
      signer: attackerAccount.address,
    };
    const signature = await attackerAccount.signTypedData(
      buildAuthorizationReceiptTypedData(
        payload,
        authorizationReceiptDomainFixture,
      ),
    );
    await expectCode(
      verifySignedAuthorizationReceiptForCovenant(
        { payload, signature },
        rawCovenantSpecFixture,
      ),
      "UNTRUSTED_AUTHORIZATION_SIGNER",
    );
  });
});
