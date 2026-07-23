import {
  EIP712_DOMAIN_NAMES,
  buildInvoiceTypedData,
  deriveSigningDomainForCovenant,
} from "@covenant/spec";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import type { EvaluationResult } from "../src/index.js";
import { createTestHarness } from "./fixtures.js";

function rule(result: EvaluationResult, ruleId: string) {
  return result.ruleResults.find((candidate) => candidate.ruleId === ruleId);
}

describe("Invoice verification coverage", () => {
  it.each([
    ["wrong chain", { chainId: 1n }],
    [
      "wrong vault",
      { verifyingContract: "0x8000000000000000000000000000000000000008" },
    ],
    ["wrong domain family", { name: EIP712_DOMAIN_NAMES.paymentIntent }],
  ] as const)(
    "rejects an Invoice signed under the %s domain",
    async (_label, domainMutation) => {
      const harness = await createTestHarness();
      const domain = deriveSigningDomainForCovenant(
        harness.covenant,
        EIP712_DOMAIN_NAMES.invoice,
      );
      const typedData = buildInvoiceTypedData(harness.invoice, domain);
      const signature = await harness.vendorAccount.signTypedData({
        ...typedData,
        domain: { ...typedData.domain, ...domainMutation },
      });
      const result = await harness.service.evaluatePaymentRequest({
        ...harness.request,
        signedInvoice: { payload: harness.invoice, signature },
      });
      expect(result.status).toBe("REJECTED");
      expect(rule(result, "invoice_signature_valid")).toMatchObject({
        status: "FAIL",
        reason: "unauthorized_vendor",
      });
    },
  );

  it("independently rejects a recovered vendor mismatch", async () => {
    const harness = await createTestHarness();
    const attacker = privateKeyToAccount(generatePrivateKey());
    const request = await harness.rebuildRequest({ invoiceSigner: attacker });
    const result = await harness.service.evaluatePaymentRequest(request);
    expect(rule(result, "invoice_signature_valid")).toMatchObject({
      status: "FAIL",
      reason: "unauthorized_vendor",
    });
  });

  it("independently rejects a vendor payload mismatch", async () => {
    const harness = await createTestHarness();
    const attacker = privateKeyToAccount(generatePrivateKey());
    const request = await harness.rebuildRequest({
      invoice: { ...harness.invoice, vendor: attacker.address },
    });
    const result = await harness.service.evaluatePaymentRequest(request);
    expect(rule(result, "invoice_signature_valid")).toMatchObject({
      status: "FAIL",
      reason: "unauthorized_vendor",
    });
  });

  it.each([
    [
      "recipient",
      "0x8000000000000000000000000000000000000008",
      "invoice_recipient_mismatch",
    ],
    [
      "token",
      "0x9000000000000000000000000000000000000009",
      "invoice_token_mismatch",
    ],
    ["amount", "1.5", "invoice_amount_mismatch"],
    ["productId", "gpu-a100-hour", "product_not_allowed"],
  ] as const)(
    "detects an Invoice %s linkage mismatch",
    async (field, value, reason) => {
      const harness = await createTestHarness();
      const request = await harness.rebuildRequest({
        invoice: { ...harness.invoice, [field]: value },
      });
      const result = await harness.service.evaluatePaymentRequest(request);
      expect(rule(result, "invoice_matches_intent")).toMatchObject({
        status: "FAIL",
        reason,
      });
    },
  );

  it("keeps purpose out of Invoice digest linkage and enforces it separately", async () => {
    const harness = await createTestHarness();
    const request = await harness.rebuildRequest({
      invoice: { ...harness.invoice, purpose: "Buy arbitrary tokens" },
    });
    const result = await harness.service.evaluatePaymentRequest(request);
    expect(rule(result, "invoice_matches_intent")).toMatchObject({
      status: "PASS",
    });
    expect(rule(result, "purpose_allowed")).toMatchObject({
      status: "FAIL",
      reason: "purpose_mismatch",
    });
  });

  it("detects a validly signed Invoice whose digest is not committed by the intent", async () => {
    const harness = await createTestHarness();
    const signedInvoice = await harness.signInvoice({
      ...harness.invoice,
      amount: "1.5",
    });
    const result = await harness.service.evaluatePaymentRequest({
      ...harness.request,
      signedInvoice,
    });
    expect(rule(result, "invoice_matches_intent")).toMatchObject({
      status: "FAIL",
      reason: "invoice_hash_mismatch",
    });
  });

  it.each([
    ["all-zero", `0x${"00".repeat(65)}`],
    ["zero-r", `0x${"00".repeat(32)}${"11".repeat(32)}1b`],
    ["zero-s", `0x${"11".repeat(32)}${"00".repeat(32)}1b`],
    ["invalid-v", `0x${"11".repeat(64)}00`],
  ])(
    "signs a rejection for schema-valid %s Invoice signatures",
    async (_label, signature) => {
      const harness = await createTestHarness();
      const invoice = harness.request.signedInvoice as {
        payload: unknown;
        signature: string;
      };
      const result = await harness.service.processPaymentRequest({
        ...harness.request,
        signedInvoice: { ...invoice, signature },
      });
      expect(result.status).toBe("REJECTED");
      expect(rule(result, "invoice_signature_valid")).toMatchObject({
        status: "FAIL",
        reason: "invalid_signature",
      });
      expect(harness.signer.decisionCalls).toBe(1);
      expect(harness.signer.authorizationCalls).toBe(0);
      expect(
        harness.generatedIds.filter(({ kind }) => kind === "authorization"),
      ).toHaveLength(0);
      expect(harness.authorizationNonceChecks).toHaveLength(0);
    },
  );

  it("signs a rejection for a schema-valid high-s Invoice signature", async () => {
    const harness = await createTestHarness();
    const invoice = harness.request.signedInvoice as {
      payload: unknown;
      signature: string;
    };
    const r = invoice.signature.slice(2, 66);
    const s = invoice.signature.slice(66, 130);
    const v = invoice.signature.slice(130, 132);
    const highS = (
      BigInt(
        "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
      ) - BigInt(`0x${s}`)
    )
      .toString(16)
      .padStart(64, "0");
    const result = await harness.service.processPaymentRequest({
      ...harness.request,
      signedInvoice: {
        ...invoice,
        signature: `0x${r}${highS}${v}`,
      },
    });
    expect(result.status).toBe("REJECTED");
    expect(rule(result, "invoice_signature_valid")).toMatchObject({
      status: "FAIL",
      reason: "invalid_signature",
    });
    expect(harness.signer.decisionCalls).toBe(1);
    expect(harness.signer.authorizationCalls).toBe(0);
    expect(
      harness.generatedIds.filter(({ kind }) => kind === "authorization"),
    ).toHaveLength(0);
    expect(harness.authorizationNonceChecks).toHaveLength(0);
  });

  it.each([
    ["short", `0x${"11".repeat(64)}`],
    ["long", `0x${"11".repeat(66)}`],
  ])(
    "rejects %s Invoice signatures at the strict public boundary",
    async (_label, signature) => {
      const harness = await createTestHarness();
      const invoice = harness.request.signedInvoice as {
        payload: unknown;
        signature: string;
      };
      await expect(
        harness.service.evaluatePaymentRequest({
          ...harness.request,
          signedInvoice: { ...invoice, signature },
        }),
      ).rejects.toMatchObject({ code: "MALFORMED_INPUT" });
      expect(harness.signer.decisionCalls).toBe(0);
      expect(harness.generatedIds).toHaveLength(0);
    },
  );
});
