import {
  createAuthorityService,
  type ReceiptSigner,
} from "../../authority/src/index.js";
import { describe, expect, it } from "vitest";
import { createAgentHarness, TEST_NOW } from "./fixtures.js";

describe("COV-005 agent service", () => {
  it("returns the exact frozen authority-ready result", async () => {
    const harness = await createAgentHarness();
    const result = await harness.service.proposePayment(harness.request);

    expect(Object.keys(result)).toEqual([
      "signedPaymentIntent",
      "signedInvoice",
    ]);
    expect(result.signedInvoice).toEqual(harness.signedInvoice);
    expect(result.signedPaymentIntent.payload).toEqual({
      version: "1",
      intentId: `0x${"34".repeat(32)}`,
      covenantId: harness.covenant.covenantId,
      agentSigner: harness.covenant.agentSigner,
      recipient: harness.covenant.recipientAddress,
      token: harness.covenant.tokenAddress,
      amount: "1.25",
      invoiceHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
      purpose: harness.covenant.purpose,
      createdAt: TEST_NOW.toString(),
      expiresAt: (TEST_NOW + 600n).toString(),
      nonce: "0",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.signedPaymentIntent)).toBe(true);
    expect(Object.isFrozen(result.signedPaymentIntent.payload)).toBe(true);
    expect(Object.isFrozen(result.signedInvoice)).toBe(true);
    expect(Object.isFrozen(result.signedInvoice.payload)).toBe(true);
    expect(harness.counts).toMatchObject({
      covenant: 1,
      clock: 3,
      identifier: 1,
      signer: 1,
      reservation: 1,
      completion: 1,
    });
  });

  it("produces a request accepted as APPROVED by the authority service", async () => {
    const harness = await createAgentHarness();
    const result = await harness.service.proposePayment(harness.request);
    let nextId = 1n;
    const receiptSigner: ReceiptSigner = {
      address: harness.authorizationAccount.address,
      signDecisionReceipt: (typedData) =>
        harness.authorizationAccount.signTypedData(
          typedData as Parameters<
            typeof harness.authorizationAccount.signTypedData
          >[0],
        ),
      signAuthorizationReceipt: (typedData) =>
        harness.authorizationAccount.signTypedData(
          typedData as Parameters<
            typeof harness.authorizationAccount.signTypedData
          >[0],
        ),
    };
    const authority = createAuthorityService({
      clock: { now: () => TEST_NOW },
      covenantProvider: {
        getCovenant: () => Promise.resolve(harness.covenant),
      },
      evidenceReader: {
        readEvidence: () =>
          Promise.resolve({
            chainId: 5_042_002n,
            vaultAddress: harness.covenant.vaultAddress,
            observedAt: TEST_NOW,
            revoked: false,
            totalSpent: 0n,
            paymentCount: 0n,
            usedIntentHash: false,
            usedIntentId: false,
            usedAgentNonce: false,
          }),
        isAuthorizationNonceUsed: () => Promise.resolve(false),
      },
      identifierGenerator: {
        createId: () => {
          const value = `0x${nextId.toString(16).padStart(64, "0")}`;
          nextId += 1n;
          return Promise.resolve(value);
        },
      },
      signer: receiptSigner,
      approvedVendor: harness.vendorAccount.address,
      approvedProductId: "gpu-h100-hour",
    });

    await expect(
      authority.evaluatePaymentRequest(result),
    ).resolves.toMatchObject({ status: "APPROVED" });
  });

  it("truncates expiry at the Invoice boundary", async () => {
    const harness = await createAgentHarness();
    harness.invoice.expiresAt = (TEST_NOW + 100n).toString();
    const signedInvoice = await harness.signInvoice(harness.invoice);
    const result = await harness.service.proposePayment({
      ...harness.request,
      signedInvoice,
    });
    expect(result.signedPaymentIntent.payload.expiresAt).toBe(
      (TEST_NOW + 100n).toString(),
    );
  });

  it("truncates expiry at the Covenant boundary", async () => {
    const harness = await createAgentHarness({
      covenant: { validUntil: (TEST_NOW + 50n).toString() },
    });
    const result = await harness.service.proposePayment(harness.request);
    expect(result.signedPaymentIntent.payload.expiresAt).toBe(
      (TEST_NOW + 50n).toString(),
    );
  });

  it("rejects when no PaymentIntent lifetime remains", async () => {
    const harness = await createAgentHarness();
    harness.clock.value = TEST_NOW + 1_000n;
    await expect(
      harness.service.proposePayment(harness.request),
    ).rejects.toMatchObject({ code: "INVOICE_NOT_CURRENT" });
    expect(harness.counts).toMatchObject({
      identifier: 0,
      signer: 0,
      reservation: 0,
      completion: 0,
    });
  });
});
