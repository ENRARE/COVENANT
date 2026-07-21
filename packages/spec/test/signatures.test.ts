import { describe, expect, it } from "vitest";
import {
  approvedRuleResultsFixture,
  authorizationReceiptDomainFixture,
  decisionReceiptDomainFixture,
  expectedVectorHashes,
  fixtureAddresses,
  invoiceDomainFixture,
  paymentIntentDomainFixture,
  rawApprovedRuleResultsFixture,
  rawCovenantSpecFixture,
  rawRejectedRuleResultsFixture,
  rawSignedPaymentIntentFixture,
  rawSignedAuthorizationReceiptFixture,
  rawSignedInvoiceFixture,
  rawApprovedSignedDecisionReceiptFixture,
  rawRejectedSignedDecisionReceiptFixture,
} from "../src/fixtures.js";
import {
  hashAuthorizationReceipt,
  hashDecisionReceipt,
  hashInvoice,
  hashPaymentIntent,
  hashRuleResults,
  verifySignedAuthorizationReceipt,
  verifySignedDecisionReceipt,
  verifySignedInvoice,
  verifySignedPaymentIntent,
} from "../src/typed-data.js";

describe("detached signature recovery", () => {
  it("verifies every valid signed fixture", async () => {
    await expect(
      verifySignedPaymentIntent(
        rawSignedPaymentIntentFixture,
        paymentIntentDomainFixture,
        rawCovenantSpecFixture,
      ),
    ).resolves.toBeDefined();
    await expect(
      verifySignedInvoice(rawSignedInvoiceFixture, invoiceDomainFixture),
    ).resolves.toBeDefined();
    await expect(
      verifySignedDecisionReceipt(
        rawApprovedSignedDecisionReceiptFixture,
        rawApprovedRuleResultsFixture,
        decisionReceiptDomainFixture,
      ),
    ).resolves.toBeDefined();
    await expect(
      verifySignedDecisionReceipt(
        rawRejectedSignedDecisionReceiptFixture,
        rawRejectedRuleResultsFixture,
        decisionReceiptDomainFixture,
      ),
    ).resolves.toBeDefined();
    await expect(
      verifySignedAuthorizationReceipt(
        rawSignedAuthorizationReceiptFixture,
        authorizationReceiptDomainFixture,
      ),
    ).resolves.toBeDefined();
  });

  it("rejects payload mutation and recovered-signer mismatch", async () => {
    await expect(
      verifySignedPaymentIntent(
        {
          ...rawSignedPaymentIntentFixture,
          payload: {
            ...rawSignedPaymentIntentFixture.payload,
            recipient: fixtureAddresses.attacker,
          },
        },
        paymentIntentDomainFixture,
        rawCovenantSpecFixture,
      ),
    ).rejects.toThrow(/signer/);
    await expect(
      verifySignedPaymentIntent(
        rawSignedPaymentIntentFixture,
        paymentIntentDomainFixture,
        { ...rawCovenantSpecFixture, agentSigner: fixtureAddresses.vendor },
      ),
    ).rejects.toThrow();
  });

  it("keeps the detached signature outside the payload digest", () => {
    const changedSignature = {
      ...rawSignedPaymentIntentFixture,
      signature: `0x${"aa".repeat(65)}`,
    };
    expect(
      hashPaymentIntent(
        rawSignedPaymentIntentFixture.payload,
        paymentIntentDomainFixture,
      ),
    ).toBe(
      hashPaymentIntent(changedSignature.payload, paymentIntentDomainFixture),
    );
  });

  it("excludes every detached envelope signature from its payload digest", () => {
    const replacement = `0x${"aa".repeat(65)}`;
    const changedPayment = {
      ...rawSignedPaymentIntentFixture,
      signature: replacement,
    };
    const changedInvoice = {
      ...rawSignedInvoiceFixture,
      signature: replacement,
    };
    const changedDecision = {
      ...rawApprovedSignedDecisionReceiptFixture,
      signature: replacement,
    };
    const changedAuthorization = {
      ...rawSignedAuthorizationReceiptFixture,
      signature: replacement,
    };
    expect(
      hashPaymentIntent(changedPayment.payload, paymentIntentDomainFixture),
    ).toBe(expectedVectorHashes.paymentIntent);
    expect(hashInvoice(changedInvoice.payload, invoiceDomainFixture)).toBe(
      expectedVectorHashes.invoice,
    );
    expect(
      hashDecisionReceipt(
        changedDecision.payload,
        decisionReceiptDomainFixture,
      ),
    ).toBe(expectedVectorHashes.approvedDecisionReceipt);
    expect(
      hashAuthorizationReceipt(
        changedAuthorization.payload,
        authorizationReceiptDomainFixture,
      ),
    ).toBe(expectedVectorHashes.authorizationReceipt);
  });
});

describe("signed DecisionReceipt rule commitment", () => {
  it.each(["ruleId", "status", "expected", "actual", "reason"] as const)(
    "changing RuleResult.%s changes the collection hash",
    (field) => {
      const changed = rawApprovedRuleResultsFixture.map((rule) => ({
        ...rule,
      }));
      const firstRule = changed.at(0);
      if (!firstRule) throw new Error("fixture must include a first rule");
      Object.assign(firstRule, {
        [field]:
          field === "ruleId"
            ? "changed_rule"
            : field === "status"
              ? "FAIL"
              : "changed",
      });
      if (field === "ruleId") {
        expect(() => hashRuleResults(changed)).toThrow();
      } else {
        expect(hashRuleResults(changed)).not.toBe(
          expectedVectorHashes.approvedRuleResults,
        );
      }
    },
  );

  it("rejects changed rule order and mismatched rule hash", async () => {
    expect(() =>
      hashRuleResults([...rawApprovedRuleResultsFixture].reverse()),
    ).toThrow();
    const changed = rawApprovedRuleResultsFixture.map((rule) => ({ ...rule }));
    const firstRule = changed.at(0);
    if (!firstRule) throw new Error("fixture must include a first rule");
    firstRule.reason = "changed";
    await expect(
      verifySignedDecisionReceipt(
        rawApprovedSignedDecisionReceiptFixture,
        changed,
        decisionReceiptDomainFixture,
      ),
    ).rejects.toThrow(/ruleResultsHash/);
  });

  it("enforces APPROVED iff every canonical rule passes", async () => {
    await expect(
      verifySignedDecisionReceipt(
        rawApprovedSignedDecisionReceiptFixture,
        rawRejectedRuleResultsFixture,
        decisionReceiptDomainFixture,
      ),
    ).rejects.toThrow();
    const rejectedWithPassingHash = {
      ...rawRejectedSignedDecisionReceiptFixture,
      payload: {
        ...rawRejectedSignedDecisionReceiptFixture.payload,
        ruleResultsHash: expectedVectorHashes.approvedRuleResults,
      },
    };
    await expect(
      verifySignedDecisionReceipt(
        rejectedWithPassingHash,
        approvedRuleResultsFixture,
        decisionReceiptDomainFixture,
      ),
    ).rejects.toThrow(/APPROVED/);
  });

  it("commits to all founder-approved DecisionReceipt fields", () => {
    const base = rawApprovedSignedDecisionReceiptFixture.payload;
    for (const [field, value] of Object.entries({
      decision: "REJECTED",
      intentHash: `0x${"aa".repeat(32)}`,
      policyVersion: "gpu-policy-2",
      createdAt: "1784563301",
      signer: fixtureAddresses.issuer,
    })) {
      expect(
        hashDecisionReceipt(
          { ...base, [field]: value },
          decisionReceiptDomainFixture,
        ),
      ).not.toBe(expectedVectorHashes.approvedDecisionReceipt);
    }
  });
});
