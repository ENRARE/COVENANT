import type { PrivateKeyAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  createAgentHarness,
  proposalForInvoice,
  TEST_NOW,
} from "./fixtures.js";

const fieldMutations: readonly (readonly [
  string,
  (message: Record<string, unknown>) => unknown,
])[] = [
  ["version", () => "2"],
  ["intentId", () => `0x${"41".repeat(32)}`],
  ["covenantId", () => `0x${"42".repeat(32)}`],
  ["agentSigner", () => "0x7000000000000000000000000000000000000007"],
  ["recipient", () => "0x7000000000000000000000000000000000000007"],
  ["token", () => "0x8000000000000000000000000000000000000008"],
  ["amount", () => 2_000_000n],
  ["invoiceHash", () => `0x${"43".repeat(32)}`],
  ["purpose", () => "Changed purpose"],
  ["createdAt", () => TEST_NOW - 1n],
  ["expiresAt", () => TEST_NOW + 599n],
  ["nonce", () => 99n],
];

describe("PaymentIntent self-verification", () => {
  it.each(fieldMutations)(
    "rejects a signature over a changed %s field",
    async (field, replacement) => {
      const harness = await createAgentHarness();
      harness.signer.signPaymentIntent = async (typedData) => {
        harness.signer.calls += 1;
        harness.signer.typedData.push(typedData);
        const changed = structuredClone(
          typedData as {
            domain: unknown;
            types: unknown;
            primaryType: string;
            message: Record<string, unknown>;
          },
        );
        changed.message[field] = replacement(changed.message);
        return harness.agentAccount.signTypedData(
          changed as Parameters<PrivateKeyAccount["signTypedData"]>[0],
        );
      };
      await expect(
        harness.service.proposePayment(harness.request),
      ).rejects.toMatchObject({ code: "SELF_VERIFICATION_FAILED" });
      expect(harness.counts).toMatchObject({
        identifier: 1,
        signer: 1,
        reservation: 1,
        completion: 0,
      });
    },
  );

  it("retains every verified raw Invoice field exactly", async () => {
    const harness = await createAgentHarness();
    const rawInvoice = {
      ...harness.invoice,
      amount: "1.250000",
      nonce: "000",
    };
    // Nonce strings must be canonical, while exact valid money spelling is retained.
    rawInvoice.nonce = "7";
    const request = await proposalForInvoice(harness, rawInvoice);
    request.procurementRequest.expectedAmount = "1.25";
    const result = await harness.service.proposePayment(request);
    expect(result.signedInvoice.payload).toEqual(rawInvoice);
    expect(result.signedInvoice.signature).toBe(
      request.signedInvoice.signature,
    );
    expect(result.signedPaymentIntent.payload.amount).toBe("1.25");
  });

  it("does not retain caller-owned Invoice references", async () => {
    const harness = await createAgentHarness();
    const request = structuredClone(harness.request);
    const operation = harness.service.proposePayment(request);
    (request.signedInvoice.payload as Record<string, unknown>).purpose =
      "mutated after invocation";
    const result = await operation;
    expect(result.signedInvoice.payload.purpose).toBe(harness.invoice.purpose);
  });
});
