import { describe, expect, it } from "vitest";
import { verifyAuthorizationChain } from "../src/context.js";
import {
  rawApprovedRuleResultsFixture,
  rawApprovedSignedDecisionReceiptFixture,
  rawCovenantSpecFixture,
  rawSignedAuthorizationReceiptFixture,
  rawSignedPaymentIntentFixture,
} from "../src/fixtures.js";

describe("PaymentIntent Covenant context", () => {
  it("accepts the coherent signed envelope", async () => {
    await expect(
      verifyAuthorizationChain(
        rawCovenantSpecFixture,
        rawSignedPaymentIntentFixture,
        rawApprovedSignedDecisionReceiptFixture,
        rawApprovedRuleResultsFixture,
        rawSignedAuthorizationReceiptFixture,
      ),
    ).resolves.toBeDefined();
  });

  it.each([
    ["created before Covenant", { createdAt: "1784563199" }],
    [
      "created after Covenant",
      { createdAt: "1785168001", expiresAt: "1785168010" },
    ],
    ["expires after Covenant", { expiresAt: "1785168001" }],
  ] as const)("rejects an intent %s", async (_label, mutation) => {
    await expect(
      verifyAuthorizationChain(
        rawCovenantSpecFixture,
        {
          ...rawSignedPaymentIntentFixture,
          payload: {
            ...rawSignedPaymentIntentFixture.payload,
            ...mutation,
          },
        },
        rawApprovedSignedDecisionReceiptFixture,
        rawApprovedRuleResultsFixture,
        rawSignedAuthorizationReceiptFixture,
      ),
    ).rejects.toThrow();
  });
});
