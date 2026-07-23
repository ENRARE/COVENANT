import {
  EIP712_DOMAIN_NAMES,
  buildInvoiceTypedData,
  deriveSigningDomainForCovenant,
} from "@covenant/spec";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  createAgentHarness,
  expectNoDependencyCalls,
  proposalForInvoice,
  TEST_NOW,
} from "./fixtures.js";

const OTHER_RECIPIENT = getAddress(
  "0x7000000000000000000000000000000000000007",
);
const OTHER_TOKEN = getAddress("0x8000000000000000000000000000000000000008");

describe("strict public request boundary", () => {
  it.each([
    ["unknown outer field", { extra: true }],
    ["missing Invoice", { signedInvoice: undefined }],
  ])("rejects %s before dependencies", async (_label, mutation) => {
    const harness = await createAgentHarness();
    const request = { ...harness.request, ...mutation };
    await expect(harness.service.proposePayment(request)).rejects.toMatchObject(
      {
        code: "MALFORMED_INPUT",
      },
    );
    expectNoDependencyCalls(harness);
  });

  it("rejects unknown procurement fields before dependencies", async () => {
    const harness = await createAgentHarness();
    await expect(
      harness.service.proposePayment({
        ...harness.request,
        procurementRequest: {
          ...harness.request.procurementRequest,
          extra: true,
        },
      }),
    ).rejects.toMatchObject({ code: "MALFORMED_INPUT" });
    expectNoDependencyCalls(harness);
  });

  it("rejects a non-frozen procurement product before dependencies", async () => {
    const harness = await createAgentHarness();
    await expect(
      harness.service.proposePayment({
        ...harness.request,
        procurementRequest: {
          productId: "gpu-a100-hour",
          expectedAmount: "1.25",
        },
      }),
    ).rejects.toMatchObject({ code: "MALFORMED_INPUT" });
    expectNoDependencyCalls(harness);
  });

  it("rejects unknown Invoice envelope fields before dependencies", async () => {
    const harness = await createAgentHarness();
    await expect(
      harness.service.proposePayment({
        ...harness.request,
        signedInvoice: { ...harness.signedInvoice, extra: true },
      }),
    ).rejects.toMatchObject({ code: "MALFORMED_INPUT" });
    expectNoDependencyCalls(harness);
  });

  it("rejects unknown Invoice payload fields before dependencies", async () => {
    const harness = await createAgentHarness();
    await expect(
      harness.service.proposePayment({
        ...harness.request,
        signedInvoice: {
          ...harness.signedInvoice,
          payload: { ...harness.invoice, extra: true },
        },
      }),
    ).rejects.toMatchObject({ code: "MALFORMED_INPUT" });
    expectNoDependencyCalls(harness);
  });

  it.each([
    ["zero amount", "0"],
    ["more than six decimals", "1.0000001"],
    ["leading zero", "01"],
    ["number", 1],
  ])("rejects malformed expected amount: %s", async (_label, amount) => {
    const harness = await createAgentHarness();
    await expect(
      harness.service.proposePayment({
        ...harness.request,
        procurementRequest: {
          productId: "gpu-h100-hour",
          expectedAmount: amount,
        },
      }),
    ).rejects.toMatchObject({ code: "MALFORMED_INPUT" });
    expectNoDependencyCalls(harness);
  });

  it.each([
    ["malformed address", "not-an-address"],
    ["zero address", `0x${"00".repeat(20)}`],
  ])("rejects Invoice %s before dependencies", async (_label, vendor) => {
    const harness = await createAgentHarness();
    await expect(
      harness.service.proposePayment({
        ...harness.request,
        signedInvoice: {
          ...harness.signedInvoice,
          payload: { ...harness.invoice, vendor },
        },
      }),
    ).rejects.toMatchObject({ code: "MALFORMED_INPUT" });
    expectNoDependencyCalls(harness);
  });

  it("rejects malformed signatures before dependencies", async () => {
    const harness = await createAgentHarness();
    await expect(
      harness.service.proposePayment({
        ...harness.request,
        signedInvoice: { ...harness.signedInvoice, signature: "0x12" },
      }),
    ).rejects.toMatchObject({ code: "MALFORMED_INPUT" });
    expectNoDependencyCalls(harness);
  });

  it("rejects a zero Invoice amount before dependencies", async () => {
    const harness = await createAgentHarness();
    await expect(
      harness.service.proposePayment({
        ...harness.request,
        signedInvoice: {
          ...harness.signedInvoice,
          payload: { ...harness.invoice, amount: "0" },
        },
      }),
    ).rejects.toMatchObject({ code: "MALFORMED_INPUT" });
    expectNoDependencyCalls(harness);
  });
});

describe("Invoice authenticity and trusted linkage", () => {
  it("rejects an Invoice signed by the wrong signer", async () => {
    const harness = await createAgentHarness();
    const request = await proposalForInvoice(
      harness,
      harness.invoice,
      harness.attackerAccount,
    );
    await expect(harness.service.proposePayment(request)).rejects.toMatchObject(
      {
        code: "INVOICE_SIGNATURE_INVALID",
      },
    );
    expect(harness.counts).toMatchObject({
      covenant: 1,
      clock: 0,
      identifier: 0,
      signer: 0,
      reservation: 0,
      completion: 0,
    });
  });

  it("rejects disagreement between Invoice.vendor and recovered signer", async () => {
    const harness = await createAgentHarness();
    const invoice = {
      ...harness.invoice,
      vendor: harness.attackerAccount.address,
    };
    const request = await proposalForInvoice(
      harness,
      invoice,
      harness.vendorAccount,
    );
    await expect(harness.service.proposePayment(request)).rejects.toMatchObject(
      {
        code: "INVOICE_VENDOR_MISMATCH",
      },
    );
    expect(harness.counts).toMatchObject({
      covenant: 1,
      clock: 0,
      identifier: 0,
      signer: 0,
      reservation: 0,
      completion: 0,
    });
  });

  it("rejects a vendor outside trusted configuration", async () => {
    const first = await createAgentHarness();
    const harness = await createAgentHarness({
      approvedVendor: first.attackerAccount.address,
    });
    await expect(
      harness.service.proposePayment(harness.request),
    ).rejects.toMatchObject({ code: "INVOICE_SIGNATURE_INVALID" });
    expect(harness.counts).toMatchObject({
      covenant: 1,
      clock: 0,
      identifier: 0,
      signer: 0,
      reservation: 0,
      completion: 0,
    });
  });

  it.each([
    ["product", { productId: "gpu-a100-hour" }, "INVOICE_PRODUCT_MISMATCH"],
    ["recipient", { recipient: OTHER_RECIPIENT }, "INVOICE_RECIPIENT_MISMATCH"],
    ["token", { token: OTHER_TOKEN }, "INVOICE_TOKEN_MISMATCH"],
    ["purpose", { purpose: "Unapproved purpose" }, "INVOICE_PURPOSE_MISMATCH"],
  ])("rejects wrong Invoice %s", async (_label, mutation, code) => {
    const harness = await createAgentHarness();
    const request = await proposalForInvoice(harness, {
      ...harness.invoice,
      ...mutation,
    });
    await expect(harness.service.proposePayment(request)).rejects.toMatchObject(
      {
        code,
      },
    );
    expect(harness.counts).toMatchObject({
      covenant: 1,
      clock: 0,
      identifier: 0,
      signer: 0,
      reservation: 0,
      completion: 0,
    });
  });

  it("rejects the wrong expected amount", async () => {
    const harness = await createAgentHarness();
    await expect(
      harness.service.proposePayment({
        ...harness.request,
        procurementRequest: {
          productId: "gpu-h100-hour",
          expectedAmount: "2",
        },
      }),
    ).rejects.toMatchObject({ code: "INVOICE_AMOUNT_MISMATCH" });
    expect(harness.counts).toMatchObject({
      covenant: 1,
      clock: 0,
      identifier: 0,
      signer: 0,
      reservation: 0,
      completion: 0,
    });
  });

  it("rejects amount above the Covenant limit", async () => {
    const harness = await createAgentHarness();
    const request = await proposalForInvoice(harness, {
      ...harness.invoice,
      amount: "5001",
    });
    await expect(harness.service.proposePayment(request)).rejects.toMatchObject(
      {
        code: "AMOUNT_EXCEEDS_LIMIT",
      },
    );
    expect(harness.counts).toMatchObject({
      covenant: 1,
      clock: 0,
      identifier: 0,
      signer: 0,
      reservation: 0,
      completion: 0,
    });
  });

  it("rejects a noncanonical high-s Invoice signature", async () => {
    const harness = await createAgentHarness();
    const signature = harness.signedInvoice.signature;
    const curveOrder =
      0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const s = BigInt(`0x${signature.slice(66, 130)}`);
    const highS = (curveOrder - s).toString(16).padStart(64, "0");
    const flippedV = signature.endsWith("1c") ? "1b" : "1c";
    await expect(
      harness.service.proposePayment({
        ...harness.request,
        signedInvoice: {
          ...harness.signedInvoice,
          signature: `${signature.slice(0, 66)}${highS}${flippedV}`,
        },
      }),
    ).rejects.toMatchObject({ code: "INVOICE_SIGNATURE_INVALID" });
    expect(harness.counts).toMatchObject({
      covenant: 1,
      clock: 0,
      identifier: 0,
      signer: 0,
      reservation: 0,
      completion: 0,
    });
  });

  it.each([
    ["wrong chain", 1n, "0x4000000000000000000000000000000000000004"],
    ["wrong vault", 5_042_002n, OTHER_RECIPIENT],
  ])(
    "rejects an Invoice signed for the %s domain",
    async (_label, chainId, vault) => {
      const harness = await createAgentHarness();
      const correctDomain = deriveSigningDomainForCovenant(
        harness.covenant,
        EIP712_DOMAIN_NAMES.invoice,
      );
      const typedData = buildInvoiceTypedData(harness.invoice, correctDomain);
      const signedInvoice = {
        payload: harness.invoice,
        signature: await harness.vendorAccount.signTypedData({
          ...typedData,
          domain: {
            ...typedData.domain,
            chainId,
            verifyingContract: vault as `0x${string}`,
          },
        }),
      };
      await expect(
        harness.service.proposePayment({
          ...harness.request,
          signedInvoice,
        }),
      ).rejects.toMatchObject({ code: "INVOICE_SIGNATURE_INVALID" });
      expect(harness.counts).toMatchObject({
        covenant: 1,
        clock: 0,
        identifier: 0,
        signer: 0,
        reservation: 0,
        completion: 0,
      });
    },
  );
});

describe("trusted time boundaries and signer", () => {
  it.each([
    [
      "future Invoice",
      { issuedAt: (TEST_NOW + 1n).toString() },
      "INVOICE_NOT_CURRENT",
    ],
    [
      "expired Invoice",
      { expiresAt: TEST_NOW.toString() },
      "INVOICE_NOT_CURRENT",
    ],
  ])("rejects a %s", async (_label, mutation, code) => {
    const harness = await createAgentHarness();
    const request = await proposalForInvoice(harness, {
      ...harness.invoice,
      ...mutation,
    });
    await expect(harness.service.proposePayment(request)).rejects.toMatchObject(
      {
        code,
      },
    );
    expect(harness.counts).toMatchObject({
      covenant: 1,
      clock: 1,
      identifier: 0,
      signer: 0,
      reservation: 0,
      completion: 0,
    });
  });

  it.each([
    ["inactive Covenant", { validAfter: (TEST_NOW + 1n).toString() }],
    ["expired Covenant", { validUntil: TEST_NOW.toString() }],
  ])("rejects an %s", async (_label, covenant) => {
    const harness = await createAgentHarness({ covenant });
    await expect(
      harness.service.proposePayment(harness.request),
    ).rejects.toMatchObject({ code: "COVENANT_INACTIVE" });
    expect(harness.counts).toMatchObject({
      covenant: 1,
      clock: 1,
      identifier: 0,
      signer: 0,
      reservation: 0,
      completion: 0,
    });
  });

  it("rejects a signer address mismatch before reservation", async () => {
    const first = await createAgentHarness();
    const harness = await createAgentHarness({
      signer: {
        address: first.attackerAccount.address,
        signPaymentIntent: () => Promise.resolve(`0x${"00".repeat(65)}`),
      },
    });
    await expect(
      harness.service.proposePayment(harness.request),
    ).rejects.toMatchObject({ code: "SIGNER_MISMATCH" });
    expect(harness.counts).toMatchObject({
      covenant: 1,
      clock: 1,
      identifier: 0,
      signer: 0,
      reservation: 0,
      completion: 0,
    });
  });

  it("rejects expiry reached during signing", async () => {
    const harness = await createAgentHarness();
    const originalSign = harness.signer.signPaymentIntent.bind(harness.signer);
    harness.signer.signPaymentIntent = async (typedData) => {
      const signature = await originalSign(typedData);
      harness.clock.value = TEST_NOW + 600n;
      return signature;
    };
    await expect(
      harness.service.proposePayment(harness.request),
    ).rejects.toMatchObject({ code: "PAYMENT_INTENT_EXPIRED" });
    expect(harness.counts).toMatchObject({
      covenant: 1,
      clock: 3,
      identifier: 1,
      signer: 1,
      reservation: 1,
      completion: 0,
    });
  });

  it("derives the Invoice domain from the trusted Covenant", async () => {
    const harness = await createAgentHarness();
    const result = await harness.service.proposePayment(harness.request);
    const domain = deriveSigningDomainForCovenant(
      harness.covenant,
      EIP712_DOMAIN_NAMES.invoice,
    );
    expect(domain.chainId).toBe("5042002");
    expect(result.signedPaymentIntent.payload.invoiceHash).toMatch(
      /^0x[0-9a-f]{64}$/,
    );
  });
});
