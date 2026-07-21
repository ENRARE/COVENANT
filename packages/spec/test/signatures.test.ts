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
  recoverInvoiceSigner,
  verifySignedAuthorizationReceiptForCovenant,
  verifySignedDecisionReceiptForCovenant,
  verifySignedPaymentIntentForCovenant,
} from "../src/typed-data.js";

describe("detached signature recovery", () => {
  it("verifies every valid signed fixture", async () => {
    await expect(
      verifySignedPaymentIntentForCovenant(
        rawSignedPaymentIntentFixture,
        rawCovenantSpecFixture,
      ),
    ).resolves.toBeDefined();
    await expect(
      recoverInvoiceSigner(rawSignedInvoiceFixture, invoiceDomainFixture),
    ).resolves.toBe(fixtureAddresses.vendor);
    await expect(
      verifySignedDecisionReceiptForCovenant(
        rawApprovedSignedDecisionReceiptFixture,
        rawApprovedRuleResultsFixture,
        rawCovenantSpecFixture,
      ),
    ).resolves.toBeDefined();
    await expect(
      verifySignedDecisionReceiptForCovenant(
        rawRejectedSignedDecisionReceiptFixture,
        rawRejectedRuleResultsFixture,
        rawCovenantSpecFixture,
      ),
    ).resolves.toBeDefined();
    await expect(
      verifySignedAuthorizationReceiptForCovenant(
        rawSignedAuthorizationReceiptFixture,
        rawCovenantSpecFixture,
      ),
    ).resolves.toBeDefined();
  });

  it("rejects payload mutation and recovered-signer mismatch", async () => {
    await expect(
      verifySignedPaymentIntentForCovenant(
        {
          ...rawSignedPaymentIntentFixture,
          payload: {
            ...rawSignedPaymentIntentFixture.payload,
            recipient: fixtureAddresses.attacker,
          },
        },
        rawCovenantSpecFixture,
      ),
    ).rejects.toThrow(/signer/);
    await expect(
      verifySignedPaymentIntentForCovenant(rawSignedPaymentIntentFixture, {
        ...rawCovenantSpecFixture,
        agentSigner: fixtureAddresses.vendor,
      }),
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
      verifySignedDecisionReceiptForCovenant(
        rawApprovedSignedDecisionReceiptFixture,
        changed,
        rawCovenantSpecFixture,
      ),
    ).rejects.toThrow(/ruleResultsHash/);
  });

  it("enforces APPROVED iff every canonical rule passes", async () => {
    await expect(
      verifySignedDecisionReceiptForCovenant(
        rawApprovedSignedDecisionReceiptFixture,
        rawRejectedRuleResultsFixture,
        rawCovenantSpecFixture,
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
      verifySignedDecisionReceiptForCovenant(
        rejectedWithPassingHash,
        approvedRuleResultsFixture,
        rawCovenantSpecFixture,
      ),
    ).rejects.toThrow(/APPROVED/);
  });

  it.each([
    ["all-zero", `0x${"00".repeat(65)}`],
    [
      "invalid recovery byte",
      `${rawSignedPaymentIntentFixture.signature.slice(0, -2)}ff`,
    ],
    [
      "zero r",
      `0x${"00".repeat(32)}${rawSignedPaymentIntentFixture.signature.slice(66)}`,
    ],
    [
      "zero s",
      `${rawSignedPaymentIntentFixture.signature.slice(0, 66)}${"00".repeat(32)}${rawSignedPaymentIntentFixture.signature.slice(-2)}`,
    ],
  ])("rejects a well-shaped %s signature", async (_label, signature) => {
    await expect(
      verifySignedPaymentIntentForCovenant(
        { ...rawSignedPaymentIntentFixture, signature },
        rawCovenantSpecFixture,
      ),
    ).rejects.toMatchObject({
      code: "SIGNATURE_INVALID",
    });
  });

  it("documents that viem recovery accepts the ECDSA high-s twin", async () => {
    const curveOrder = BigInt(
      "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
    );
    const signature = rawSignedPaymentIntentFixture.signature;
    const s = BigInt(`0x${signature.slice(66, 130)}`);
    const highS = (curveOrder - s).toString(16).padStart(64, "0");
    const flippedRecoveryByte = signature.endsWith("1c") ? "1b" : "1c";
    const malleableTwin = `${signature.slice(0, 66)}${highS}${flippedRecoveryByte}`;
    await expect(
      verifySignedPaymentIntentForCovenant(
        { ...rawSignedPaymentIntentFixture, signature: malleableTwin },
        rawCovenantSpecFixture,
      ),
    ).resolves.toBeDefined();
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
