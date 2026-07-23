import {
  EIP712_DOMAIN_NAMES,
  buildAuthorizationReceiptTypedData,
  buildDecisionReceiptTypedData,
  deriveSigningDomainForCovenant,
  hashRuleResults,
} from "@covenant/spec";
import { describe, expect, it } from "vitest";
import type { PrivateKeyAccount } from "viem/accounts";
import { verifyAuthorizationReceiptLinkage } from "../src/authorizations/issue-authorization.js";
import { authorizationInput, createTestHarness, TEST_NOW } from "./fixtures.js";

type Envelope = {
  payload: Record<string, unknown>;
  signature: `0x${string}`;
};

function envelope(value: unknown): Envelope {
  return value as Envelope;
}

async function sign(
  account: PrivateKeyAccount,
  typedData: ReturnType<typeof buildDecisionReceiptTypedData>,
) {
  return account.signTypedData(typedData);
}

describe("cryptographically valid receipt linkage mutations", () => {
  it.each([
    ["covenantId", `0x${"71".repeat(32)}`, "DECISION_COVENANT_MISMATCH"],
    ["intentId", `0x${"72".repeat(32)}`, "DECISION_INTENT_ID_MISMATCH"],
    ["intentHash", `0x${"73".repeat(32)}`, "DECISION_INTENT_HASH_MISMATCH"],
    ["policyVersion", "gpu-policy-2", "DECISION_POLICY_VERSION_MISMATCH"],
    [
      "ruleResultsHash",
      `0x${"74".repeat(32)}`,
      "DECISION_RULE_RESULTS_MISMATCH",
    ],
    ["createdAt", (TEST_NOW + 1n).toString(), "DECISION_CREATED_IN_FUTURE"],
    ["decision", "REJECTED", "DECISION_STATUS_MISMATCH"],
  ] as const)(
    "rejects a re-signed DecisionReceipt %s mutation with a precise code",
    async (field, value, code) => {
      const harness = await createTestHarness();
      const approved = await harness.service.evaluatePaymentRequest(
        harness.request,
      );
      const original = envelope(approved.decisionReceipt);
      const payload = { ...original.payload, [field]: value };
      const domain = deriveSigningDomainForCovenant(
        harness.covenant,
        EIP712_DOMAIN_NAMES.decisionReceipt,
      );
      const signature = await sign(
        harness.signer.account,
        buildDecisionReceiptTypedData(payload, domain),
      );

      await expect(
        harness.service.issueAuthorization({
          ...authorizationInput(harness.request, approved),
          decisionReceipt: { payload, signature },
        }),
      ).rejects.toMatchObject({ code });
      expect(harness.signer.authorizationCalls).toBe(0);
    },
  );

  it.each([
    ["decisionId", `0x${"81".repeat(32)}`, "AUTHORIZATION_DECISION_MISMATCH"],
    ["covenantId", `0x${"82".repeat(32)}`, "AUTHORIZATION_COVENANT_MISMATCH"],
    [
      "intentHash",
      `0x${"83".repeat(32)}`,
      "AUTHORIZATION_INTENT_HASH_MISMATCH",
    ],
    [
      "vaultAddress",
      "0x8000000000000000000000000000000000000008",
      "AUTHORIZATION_VAULT_MISMATCH",
    ],
    ["policyVersion", "gpu-policy-2", "AUTHORIZATION_POLICY_VERSION_MISMATCH"],
    [
      "signer",
      "0x9000000000000000000000000000000000000009",
      "AUTHORIZATION_SIGNER_MISMATCH",
    ],
    [
      "validUntil",
      (TEST_NOW - 1n).toString(),
      "AUTHORIZATION_VALIDITY_INVALID",
    ],
  ] as const)(
    "rejects a re-signed AuthorizationReceipt %s mutation with a precise code",
    async (field, value, code) => {
      const harness = await createTestHarness();
      const approved = await harness.service.processPaymentRequest(
        harness.request,
      );
      if (approved.status !== "APPROVED") throw new Error("Expected approval");
      const original = envelope(approved.authorizationReceipt);
      const payload = { ...original.payload, [field]: value };
      const baseDomain = deriveSigningDomainForCovenant(
        harness.covenant,
        EIP712_DOMAIN_NAMES.authorizationReceipt,
      );
      const domain =
        field === "vaultAddress"
          ? { ...baseDomain, verifyingContract: value }
          : baseDomain;
      const signature = await harness.signer.account.signTypedData(
        buildAuthorizationReceiptTypedData(payload, domain),
      );

      await expect(
        verifyAuthorizationReceiptLinkage({
          rawCovenant: harness.covenant,
          rawSignedPaymentIntent: harness.request.signedPaymentIntent,
          rawDecisionReceipt: approved.decisionReceipt,
          ruleResults: approved.ruleResults,
          authorizationReceipt: { payload, signature },
        }),
      ).rejects.toMatchObject({ code });
    },
  );

  it("rejects a re-signed authorization rule commitment mismatch", async () => {
    const harness = await createTestHarness();
    const approved = await harness.service.processPaymentRequest(
      harness.request,
    );
    if (approved.status !== "APPROVED") throw new Error("Expected approval");
    const changedRules = approved.ruleResults.map((rule, index) =>
      index === 0 ? { ...rule, status: "FAIL" as const } : rule,
    );
    expect(hashRuleResults(changedRules)).not.toBe(
      envelope(approved.decisionReceipt).payload.ruleResultsHash,
    );
    await expect(
      verifyAuthorizationReceiptLinkage({
        rawCovenant: harness.covenant,
        rawSignedPaymentIntent: harness.request.signedPaymentIntent,
        rawDecisionReceipt: approved.decisionReceipt,
        ruleResults: changedRules,
        authorizationReceipt: approved.authorizationReceipt,
      }),
    ).rejects.toMatchObject({ code: "SELF_VERIFICATION_FAILED" });
  });
});
