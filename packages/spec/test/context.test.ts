import { describe, expect, it } from "vitest";
import {
  rawApprovedDecisionReceiptFixture,
  rawAuthorizationReceiptFixture,
  rawCovenantSpecFixture,
  rawPaymentIntentFixture,
} from "../src/fixtures.js";
import {
  validateAuthorizationContext,
  validatePaymentIntentContext,
} from "../src/context.js";

describe("cross-object temporal linkage", () => {
  it("accepts the coherent fixed context", () => {
    expect(
      validateAuthorizationContext(
        rawCovenantSpecFixture,
        rawPaymentIntentFixture,
        rawApprovedDecisionReceiptFixture,
        rawAuthorizationReceiptFixture,
      ),
    ).toBeDefined();
  });

  it.each([
    ["created before Covenant", { createdAt: "1784563199" }],
    [
      "created after Covenant",
      { createdAt: "1785168001", expiresAt: "1785168010" },
    ],
    ["expires after Covenant", { expiresAt: "1785168001" }],
  ] as const)("rejects PaymentIntent %s", (_label, mutation) => {
    expect(() =>
      validatePaymentIntentContext(rawCovenantSpecFixture, {
        ...rawPaymentIntentFixture,
        ...mutation,
      }),
    ).toThrow();
  });

  it("rejects DecisionReceipt before PaymentIntent", () => {
    expect(() =>
      validateAuthorizationContext(
        rawCovenantSpecFixture,
        rawPaymentIntentFixture,
        { ...rawApprovedDecisionReceiptFixture, createdAt: "1784563259" },
        rawAuthorizationReceiptFixture,
      ),
    ).toThrow(/DecisionReceipt/);
  });

  it.each([
    ["not after decision", "1784563300"],
    ["after intent expiry", "1784563561"],
    ["after Covenant expiry", "1785168001"],
  ])("rejects authorization %s", (_label, validUntil) => {
    expect(() =>
      validateAuthorizationContext(
        rawCovenantSpecFixture,
        rawPaymentIntentFixture,
        rawApprovedDecisionReceiptFixture,
        { ...rawAuthorizationReceiptFixture, validUntil },
      ),
    ).toThrow();
  });
});
