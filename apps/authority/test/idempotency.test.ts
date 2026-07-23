import { describe, expect, it } from "vitest";
import { authorizationInput, createTestHarness } from "./fixtures.js";

describe("approved idempotency and concurrency", () => {
  it("shares concurrent decision and authorization signing operations", async () => {
    const harness = await createTestHarness();
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        harness.service.processPaymentRequest(harness.request),
      ),
    );
    expect(results.every(({ status }) => status === "APPROVED")).toBe(true);
    expect(harness.signer.decisionCalls).toBe(1);
    expect(harness.signer.authorizationCalls).toBe(1);
    expect(
      results.every(
        (result) => JSON.stringify(result) === JSON.stringify(results[0]),
      ),
    ).toBe(true);
  });

  it("returns byte-identical stored receipts for duplicate approved requests", async () => {
    const harness = await createTestHarness();
    const first = await harness.service.processPaymentRequest(harness.request);
    const second = await harness.service.processPaymentRequest(harness.request);
    expect(second).toEqual(first);
    expect(harness.signer.decisionCalls).toBe(1);
    expect(harness.signer.authorizationCalls).toBe(1);
  });

  it("shares concurrent standalone authorization issuance", async () => {
    const harness = await createTestHarness();
    const approved = await harness.service.evaluatePaymentRequest(
      harness.request,
    );
    const input = authorizationInput(harness.request, approved);
    const receipts = await Promise.all(
      Array.from({ length: 12 }, () =>
        harness.service.issueAuthorization(input),
      ),
    );
    expect(
      receipts.every(
        (receipt) => JSON.stringify(receipt) === JSON.stringify(receipts[0]),
      ),
    ).toBe(true);
    expect(harness.signer.authorizationCalls).toBe(1);
  });

  it("retains authorization ID and nonce across signing failure and retry", async () => {
    const harness = await createTestHarness();
    const approved = await harness.service.evaluatePaymentRequest(
      harness.request,
    );
    const input = authorizationInput(harness.request, approved);
    harness.signer.failNextAuthorization = true;
    await expect(
      harness.service.issueAuthorization(input),
    ).rejects.toMatchObject({ code: "SIGNING_FAILURE" });
    const generatedAfterFailure = harness.generatedIds.filter(
      ({ kind }) => kind === "authorization",
    );
    expect(generatedAfterFailure).toHaveLength(1);
    const receipt = await harness.service.issueAuthorization(input);
    expect(receipt.payload.authorizationId).toBe(generatedAfterFailure[0]?.id);
    expect(receipt.payload.authorizationNonce).toBe("1");
    expect(
      harness.generatedIds.filter(({ kind }) => kind === "authorization"),
    ).toHaveLength(1);
    expect(harness.signer.authorizationCalls).toBe(2);
  });

  it("skips authorization nonces already consumed onchain", async () => {
    const harness = await createTestHarness();
    harness.consumedAuthorizationNonces.add(1n);
    harness.consumedAuthorizationNonces.add(2n);
    const result = await harness.service.processPaymentRequest(harness.request);
    expect(result.status).toBe("APPROVED");
    if (result.status !== "APPROVED") throw new Error("Expected approval");
    expect(result.authorizationReceipt.payload.authorizationNonce).toBe("3");
  });

  it("does not include detached signature bytes in stable ID contexts", async () => {
    const harness = await createTestHarness();
    await harness.service.processPaymentRequest(harness.request);
    const intentSignature = (
      harness.request.signedPaymentIntent as { signature: string }
    ).signature;
    const invoiceSignature = (
      harness.request.signedInvoice as { signature: string }
    ).signature;
    for (const generated of harness.generatedIds) {
      expect(generated.context).not.toContain(intentSignature);
      expect(generated.context).not.toContain(invoiceSignature);
    }
  });
});
