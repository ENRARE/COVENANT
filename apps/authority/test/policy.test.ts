import { CANONICAL_RULE_IDS } from "@covenant/spec";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { describe, expect, it } from "vitest";
import type { EvaluationResult } from "../src/index.js";
import { createTestHarness, TEST_NOW } from "./fixtures.js";

function rule(result: EvaluationResult, ruleId: string) {
  const found = result.ruleResults.find(
    (candidate) => candidate.ruleId === ruleId,
  );
  if (found === undefined) throw new Error(`Missing rule ${ruleId}`);
  return found;
}

describe("canonical authority policy", () => {
  it("approves all rules in the exact frozen order", async () => {
    const harness = await createTestHarness();
    const result = await harness.service.evaluatePaymentRequest(
      harness.request,
    );
    expect(result.status).toBe("APPROVED");
    expect(result.ruleResults.map(({ ruleId }) => ruleId)).toEqual(
      CANONICAL_RULE_IDS,
    );
    expect(result.ruleResults.every(({ status }) => status === "PASS")).toBe(
      true,
    );
  });

  it.each([
    [29n, "PASS"],
    [30n, "PASS"],
    [31n, "FAIL"],
  ] as const)(
    "applies the evidence age boundary at %s seconds",
    async (age, status) => {
      const harness = await createTestHarness();
      harness.evidence.observedAt = TEST_NOW - age;
      const result = await harness.service.evaluatePaymentRequest(
        harness.request,
      );
      expect(rule(result, "covenant_active").status).toBe(status);
    },
  );

  const inactiveCases: readonly [
    string,
    (harness: Awaited<ReturnType<typeof createTestHarness>>) => void,
    string,
  ][] = [
    [
      "revoked",
      (harness) => {
        harness.evidence.revoked = true;
      },
      "covenant_revoked",
    ],
    [
      "payment count",
      (harness) => {
        harness.evidence.paymentCount = 2n;
      },
      "payment_count_exhausted",
    ],
    [
      "future evidence",
      (harness) => {
        harness.evidence.observedAt = TEST_NOW + 1n;
      },
      "evidence_future",
    ],
  ];

  it.each(inactiveCases)(
    "rejects inactive Covenant evidence: %s",
    async (_label, mutate, reason) => {
      const harness = await createTestHarness();
      mutate(harness);
      const result = await harness.service.evaluatePaymentRequest(
        harness.request,
      );
      expect(rule(result, "covenant_active")).toMatchObject({
        status: "FAIL",
        reason,
      });
    },
  );

  it("checks Covenant activation and expiry boundaries", async () => {
    const before = await createTestHarness();
    before.clock.value = TEST_NOW - 101n;
    before.evidence.observedAt = before.clock.value;
    expect(
      rule(
        await before.service.evaluatePaymentRequest(before.request),
        "covenant_active",
      ).status,
    ).toBe("FAIL");

    const expired = await createTestHarness();
    expired.clock.value = TEST_NOW + 1_000n;
    expired.evidence.observedAt = expired.clock.value;
    expect(
      rule(
        await expired.service.evaluatePaymentRequest(expired.request),
        "covenant_active",
      ).reason,
    ).toBe("covenant_expired");
  });

  it("separates a valid attacker signature from agent authority", async () => {
    const harness = await createTestHarness();
    const attacker = privateKeyToAccount(generatePrivateKey());
    const maliciousIntent = {
      ...harness.intent,
      agentSigner: attacker.address,
    };
    const request = await harness.rebuildRequest({
      intent: maliciousIntent,
      intentSigner: attacker,
    });
    const result = await harness.service.evaluatePaymentRequest(request);
    expect(rule(result, "intent_signature_valid").status).toBe("PASS");
    expect(rule(result, "agent_authorized")).toMatchObject({
      status: "FAIL",
      reason: "unauthorized_agent",
    });
  });

  it.each([
    [
      "recipient_allowed",
      "recipient",
      "0x9000000000000000000000000000000000000009",
      "recipient_mismatch",
    ],
    [
      "token_allowed",
      "token",
      "0x8000000000000000000000000000000000000008",
      "token_mismatch",
    ],
  ] as const)(
    "fails %s deterministically",
    async (ruleId, field, value, reason) => {
      const harness = await createTestHarness();
      const changedInvoice = { ...harness.invoice, [field]: value };
      const request = await harness.rebuildRequest({
        invoice: changedInvoice,
        intent: { [field]: value },
      });
      const result = await harness.service.evaluatePaymentRequest(request);
      expect(rule(result, ruleId)).toMatchObject({ status: "FAIL", reason });
    },
  );

  it.each([
    ["5001", 0n, "amount_above_limit"],
    ["2", 9_999_000_000n, "insufficient_budget"],
    ["1.25", 10_000_000_001n, "invalid_spend_evidence"],
  ] as const)(
    "enforces amount and remaining budget for %s",
    async (amount, spent, reason) => {
      const harness = await createTestHarness();
      harness.evidence.totalSpent = spent;
      const changedInvoice = { ...harness.invoice, amount };
      const request = await harness.rebuildRequest({
        invoice: changedInvoice,
        intent: { amount },
      });
      const result = await harness.service.evaluatePaymentRequest(request);
      expect(rule(result, "amount_within_limit")).toMatchObject({
        status: "FAIL",
        reason,
      });
    },
  );

  it("rejects a wrong vendor", async () => {
    const harness = await createTestHarness();
    const attacker = privateKeyToAccount(generatePrivateKey());
    const changedInvoice = { ...harness.invoice, vendor: attacker.address };
    const request = await harness.rebuildRequest({
      invoice: changedInvoice,
      invoiceSigner: attacker,
    });
    const result = await harness.service.evaluatePaymentRequest(request);
    expect(rule(result, "invoice_signature_valid")).toMatchObject({
      status: "FAIL",
      reason: "unauthorized_vendor",
    });
  });

  it("rejects the wrong approved product without putting purpose in invoice matching", async () => {
    const harness = await createTestHarness();
    const changedInvoice = { ...harness.invoice, productId: "gpu-a100-hour" };
    const request = await harness.rebuildRequest({ invoice: changedInvoice });
    const result = await harness.service.evaluatePaymentRequest(request);
    expect(rule(result, "invoice_matches_intent")).toMatchObject({
      status: "FAIL",
      reason: "product_not_allowed",
    });
    expect(rule(result, "purpose_allowed").status).toBe("PASS");
  });

  it("places both intent and Invoice purpose checks in purpose_allowed", async () => {
    const harness = await createTestHarness();
    const changedInvoice = { ...harness.invoice, purpose: "Other purpose" };
    const request = await harness.rebuildRequest({
      invoice: changedInvoice,
      intent: { purpose: "Other purpose" },
    });
    const result = await harness.service.evaluatePaymentRequest(request);
    expect(rule(result, "invoice_matches_intent").status).toBe("PASS");
    expect(rule(result, "purpose_allowed")).toMatchObject({
      status: "FAIL",
      reason: "purpose_mismatch",
    });
  });

  it("rejects an Invoice digest mismatch", async () => {
    const harness = await createTestHarness();
    const signedInvoice = await harness.signInvoice(harness.invoice);
    const badIntent = {
      ...harness.intent,
      invoiceHash: `0x${"99".repeat(32)}`,
    };
    const signedPaymentIntent = await harness.signIntent(badIntent);
    const result = await harness.service.evaluatePaymentRequest({
      signedInvoice,
      signedPaymentIntent,
    });
    expect(rule(result, "invoice_matches_intent").reason).toBe(
      "invoice_hash_mismatch",
    );
  });

  const timeCases: readonly [
    string,
    {
      intent?: Record<string, unknown>;
      invoice?: Record<string, unknown>;
    },
    string,
  ][] = [
    [
      "intent expired",
      { intent: { expiresAt: TEST_NOW.toString() } },
      "request_expired",
    ],
    [
      "Invoice expired",
      { invoice: { expiresAt: TEST_NOW.toString() } },
      "invoice_expired",
    ],
    [
      "intent not started",
      {
        intent: {
          createdAt: (TEST_NOW + 1n).toString(),
          expiresAt: (TEST_NOW + 10n).toString(),
        },
      },
      "request_not_started",
    ],
    [
      "Invoice not issued",
      {
        invoice: {
          issuedAt: (TEST_NOW + 1n).toString(),
          expiresAt: (TEST_NOW + 10n).toString(),
        },
      },
      "invoice_not_issued",
    ],
  ];

  it.each(timeCases)(
    "enforces time boundary: %s",
    async (_label, changes, reason) => {
      const harness = await createTestHarness();
      const changedInvoice = { ...harness.invoice, ...(changes.invoice ?? {}) };
      const request = await harness.rebuildRequest({
        invoice: changedInvoice,
        ...(changes.intent === undefined ? {} : { intent: changes.intent }),
      });
      const result = await harness.service.evaluatePaymentRequest(request);
      expect(rule(result, "intent_not_expired")).toMatchObject({
        status: "FAIL",
        reason,
      });
    },
  );

  it("checks all replay identities", async () => {
    for (const field of [
      "usedIntentHash",
      "usedIntentId",
      "usedAgentNonce",
    ] as const) {
      const harness = await createTestHarness();
      harness.evidence[field] = true;
      const result = await harness.service.evaluatePaymentRequest(
        harness.request,
      );
      expect(rule(result, "nonce_unused")).toMatchObject({
        status: "FAIL",
        reason: "nonce_already_used",
      });
    }
  });

  it("does not stop after the first failure", async () => {
    const harness = await createTestHarness();
    harness.evidence.revoked = true;
    harness.evidence.usedAgentNonce = true;
    const result = await harness.service.evaluatePaymentRequest(
      harness.request,
    );
    expect(result.ruleResults).toHaveLength(11);
    expect(
      result.ruleResults.filter(({ status }) => status === "FAIL").length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      result.ruleResults.every(({ reason }) =>
        /^[a-z][a-z0-9_]*$/.test(reason),
      ),
    ).toBe(true);
  });
});
