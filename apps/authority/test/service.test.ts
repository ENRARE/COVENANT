import {
  EIP712_DOMAIN_NAMES,
  deriveSigningDomainForCovenant,
  verifyAuthorizationChain,
} from "@covenant/spec";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  AUTHORIZATION_TTL_SECONDS,
  AuthorityError,
  createAuthorityService,
} from "../src/index.js";
import { authorizationInput, createTestHarness, TEST_NOW } from "./fixtures.js";

describe("authority service integration", () => {
  it("returns both verified receipts for an approved gpu-h100-hour purchase", async () => {
    const harness = await createTestHarness();
    const result = await harness.service.processPaymentRequest(harness.request);
    expect(result.status).toBe("APPROVED");
    if (result.status !== "APPROVED") throw new Error("Expected approval");
    await expect(
      verifyAuthorizationChain(
        harness.covenant,
        harness.request.signedPaymentIntent,
        result.decisionReceipt,
        result.ruleResults,
        result.authorizationReceipt,
      ),
    ).resolves.toBeDefined();
    expect(result.authorizationReceipt.payload.validUntil).toBe(
      (TEST_NOW + AUTHORIZATION_TTL_SECONDS).toString(),
    );
    expect(harness.signer.decisionCalls).toBe(1);
    expect(harness.signer.authorizationCalls).toBe(1);
  });

  it("returns a signed rejection without an authorization for prompt-injected recipient replacement", async () => {
    const harness = await createTestHarness();
    const attacker = "0x9000000000000000000000000000000000000009";
    const changedInvoice = { ...harness.invoice, recipient: attacker };
    const request = await harness.rebuildRequest({
      invoice: changedInvoice,
      intent: { recipient: attacker },
    });
    const result = await harness.service.processPaymentRequest(request);
    expect(result.status).toBe("REJECTED");
    expect("authorizationReceipt" in result).toBe(false);
    expect(harness.signer.decisionCalls).toBe(1);
    expect(harness.signer.authorizationCalls).toBe(0);
  });

  it("does not let an invalid first submission poison a later approval", async () => {
    const harness = await createTestHarness();
    const signedInvoice = harness.request.signedInvoice as {
      payload: unknown;
      signature: string;
    };
    const invalid = {
      ...harness.request,
      signedInvoice: {
        ...signedInvoice,
        signature: `0x${"00".repeat(64)}1b`,
      },
    };
    expect((await harness.service.evaluatePaymentRequest(invalid)).status).toBe(
      "REJECTED",
    );
    expect(
      (await harness.service.evaluatePaymentRequest(harness.request)).status,
    ).toBe("APPROVED");
    expect(harness.signer.decisionCalls).toBe(2);
  });

  it("rejects authorization from a rejected DecisionReceipt before nonce reservation", async () => {
    const harness = await createTestHarness();
    harness.evidence.revoked = true;
    const rejected = await harness.service.evaluatePaymentRequest(
      harness.request,
    );
    harness.evidence.revoked = false;
    await expect(
      harness.service.issueAuthorization(
        authorizationInput(harness.request, rejected),
      ),
    ).rejects.toMatchObject({ code: "DECISION_STATUS_MISMATCH" });
    expect(
      harness.generatedIds.filter(({ kind }) => kind === "authorization"),
    ).toHaveLength(0);
    expect(harness.signer.authorizationCalls).toBe(0);
  });

  it.each([
    [
      "revocation",
      (h: Awaited<ReturnType<typeof createTestHarness>>) => {
        h.evidence.revoked = true;
      },
    ],
    [
      "Covenant expiry",
      (h: Awaited<ReturnType<typeof createTestHarness>>) => {
        h.clock.value = TEST_NOW + 1_000n;
        h.evidence.observedAt = h.clock.value;
      },
    ],
    [
      "intent expiry",
      (h: Awaited<ReturnType<typeof createTestHarness>>) => {
        h.clock.value = TEST_NOW + 600n;
        h.evidence.observedAt = h.clock.value;
      },
    ],
    [
      "Invoice expiry",
      (h: Awaited<ReturnType<typeof createTestHarness>>) => {
        h.clock.value = TEST_NOW + 500n;
        h.evidence.observedAt = h.clock.value;
      },
    ],
    [
      "budget exhaustion",
      (h: Awaited<ReturnType<typeof createTestHarness>>) => {
        h.evidence.totalSpent = 10_000_000_000n;
      },
    ],
    [
      "payment-count exhaustion",
      (h: Awaited<ReturnType<typeof createTestHarness>>) => {
        h.evidence.paymentCount = 2n;
      },
    ],
    [
      "intent hash consumption",
      (h: Awaited<ReturnType<typeof createTestHarness>>) => {
        h.evidence.usedIntentHash = true;
      },
    ],
    [
      "intent ID consumption",
      (h: Awaited<ReturnType<typeof createTestHarness>>) => {
        h.evidence.usedIntentId = true;
      },
    ],
    [
      "agent nonce consumption",
      (h: Awaited<ReturnType<typeof createTestHarness>>) => {
        h.evidence.usedAgentNonce = true;
      },
    ],
  ] as const)(
    "revalidates %s immediately before authorization",
    async (_label, mutate) => {
      const harness = await createTestHarness();
      const approved = await harness.service.evaluatePaymentRequest(
        harness.request,
      );
      expect(approved.status).toBe("APPROVED");
      mutate(harness);
      await expect(
        harness.service.issueAuthorization(
          authorizationInput(harness.request, approved),
        ),
      ).rejects.toMatchObject({ code: "DECISION_STATUS_MISMATCH" });
      expect(harness.signer.authorizationCalls).toBe(0);
      expect(
        harness.generatedIds.filter(({ kind }) => kind === "authorization"),
      ).toHaveLength(0);
    },
  );

  it("rejects a modified PaymentIntent or Invoice against an old approval", async () => {
    const harness = await createTestHarness();
    const approved = await harness.service.evaluatePaymentRequest(
      harness.request,
    );
    const changedInvoice = { ...harness.invoice, amount: "1.5" };
    const changed = await harness.rebuildRequest({
      invoice: changedInvoice,
      intent: { amount: "1.5" },
    });
    await expect(
      harness.service.issueAuthorization(authorizationInput(changed, approved)),
    ).rejects.toMatchObject({ code: "DECISION_INTENT_HASH_MISMATCH" });

    const invoiceOnly = await harness.rebuildRequest({
      invoice: { ...harness.invoice, productId: "gpu-a100-hour" },
    });
    await expect(
      harness.service.issueAuthorization(
        authorizationInput(invoiceOnly, approved),
      ),
    ).rejects.toMatchObject({ code: "INVALID_DECISION" });
  });

  it("rejects modified DecisionReceipt fields", async () => {
    const mutations: Record<string, unknown> = {
      version: "2",
      decisionId: `0x${"71".repeat(32)}`,
      covenantId: `0x${"72".repeat(32)}`,
      intentId: `0x${"73".repeat(32)}`,
      intentHash: `0x${"74".repeat(32)}`,
      decision: "REJECTED",
      ruleResultsHash: `0x${"75".repeat(32)}`,
      policyVersion: "gpu-policy-2",
      createdAt: (TEST_NOW + 1n).toString(),
      signer: privateKeyToAccount(generatePrivateKey()).address,
    };
    for (const [field, value] of Object.entries(mutations)) {
      const harness = await createTestHarness();
      const approved = await harness.service.evaluatePaymentRequest(
        harness.request,
      );
      const envelope = approved.decisionReceipt as {
        payload: Record<string, unknown>;
        signature: string;
      };
      await expect(
        harness.service.issueAuthorization({
          ...authorizationInput(harness.request, approved),
          decisionReceipt: {
            ...envelope,
            payload: { ...envelope.payload, [field]: value },
          },
        }),
      ).rejects.toBeDefined();
    }
  });

  it("caps authorization expiry by TTL, intent, Invoice, and Covenant", async () => {
    const cases = [
      { intent: 600n, invoice: 500n, covenant: 1_000n, expected: 300n },
      { intent: 100n, invoice: 500n, covenant: 1_000n, expected: 100n },
      { intent: 600n, invoice: 50n, covenant: 1_000n, expected: 50n },
      { intent: 40n, invoice: 40n, covenant: 40n, expected: 40n },
    ];
    for (const testCase of cases) {
      const harness = await createTestHarness();
      harness.covenant.validUntil = (TEST_NOW + testCase.covenant).toString();
      const changedInvoice = {
        ...harness.invoice,
        expiresAt: (TEST_NOW + testCase.invoice).toString(),
      };
      const request = await harness.rebuildRequest({
        invoice: changedInvoice,
        intent: { expiresAt: (TEST_NOW + testCase.intent).toString() },
      });
      const result = await harness.service.processPaymentRequest(request);
      expect(result.status).toBe("APPROVED");
      if (result.status !== "APPROVED") throw new Error("Expected approval");
      expect(result.authorizationReceipt.payload.validUntil).toBe(
        (TEST_NOW + testCase.expected).toString(),
      );
      expect(
        BigInt(result.authorizationReceipt.payload.validUntil),
      ).toBeLessThanOrEqual(BigInt(changedInvoice.expiresAt));
    }
  });

  it("rejects a signer adapter address mismatch before signing", async () => {
    const harness = await createTestHarness();
    const service = createAuthorityService({
      ...harness.dependencies,
      signer: {
        address: privateKeyToAccount(generatePrivateKey()).address,
        signDecisionReceipt: () => Promise.reject(new Error("must not run")),
        signAuthorizationReceipt: () =>
          Promise.reject(new Error("must not run")),
      },
    });
    await expect(
      service.evaluatePaymentRequest(harness.request),
    ).rejects.toMatchObject({ code: "SIGNER_MISMATCH" });
  });

  it("derives the Invoice domain from the Covenant vault", async () => {
    const harness = await createTestHarness();
    const domain = deriveSigningDomainForCovenant(
      harness.covenant,
      EIP712_DOMAIN_NAMES.invoice,
    );
    expect(domain).toMatchObject({
      chainId: "5042002",
      verifyingContract: harness.covenant.vaultAddress,
    });
  });

  it("serializes application errors without signatures or adapter details", async () => {
    const harness = await createTestHarness();
    harness.signer.failNextAuthorization = true;
    const approved = await harness.service.evaluatePaymentRequest(
      harness.request,
    );
    let caught: unknown;
    try {
      await harness.service.issueAuthorization(
        authorizationInput(harness.request, approved),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AuthorityError);
    const serialized = JSON.stringify(caught);
    const intentSignature = (
      harness.request.signedPaymentIntent as { signature: string }
    ).signature;
    expect(serialized).not.toContain(intentSignature);
    expect(serialized).not.toContain("adapter detail");
    expect(serialized).not.toContain("typedData");
    expect(serialized).not.toContain("stack");
  });
});
