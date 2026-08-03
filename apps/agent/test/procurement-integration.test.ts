import { describe, expect, it } from "vitest";
import {
  AgentError,
  createProcurementIntegration,
  type AgentProposalResult,
  type ProcurementInvoiceSourceRequest,
} from "../src/index.js";

const PRODUCT_ID = "gpu-h100-hour" as const;
const SIGNATURE = `0x${"11".repeat(65)}`;

function createSignedInvoice(amount = "1.25", productId: string = PRODUCT_ID) {
  return {
    payload: {
      version: "1",
      invoiceId: `0x${"12".repeat(32)}`,
      vendor: "0x1000000000000000000000000000000000000001",
      recipient: "0x2000000000000000000000000000000000000002",
      token: "0x3000000000000000000000000000000000000003",
      amount,
      productId,
      purpose: "Purchase approved GPU compute",
      issuedAt: "2000000000",
      expiresAt: "2000001000",
      nonce: "1",
    },
    signature: SIGNATURE,
  };
}

function createProposalResult(
  signedInvoice: ReturnType<typeof createSignedInvoice>,
) {
  return {
    signedPaymentIntent: {
      payload: {
        version: "1",
        intentId: `0x${"13".repeat(32)}`,
        covenantId: `0x${"14".repeat(32)}`,
        agentSigner: "0x4000000000000000000000000000000000000004",
        recipient: "0x2000000000000000000000000000000000000002",
        token: "0x3000000000000000000000000000000000000003",
        amount: signedInvoice.payload.amount,
        invoiceHash: `0x${"15".repeat(32)}`,
        purpose: signedInvoice.payload.purpose,
        createdAt: "2000000000",
        expiresAt: "2000000600",
        nonce: "1",
      },
      signature: `0x${"16".repeat(65)}`,
    },
    signedInvoice,
  } satisfies AgentProposalResult;
}

function createHarness(
  input?: Readonly<{
    sourceOutput?: unknown;
    sourceFailure?: Error;
    agentFailure?: AgentError;
  }>,
) {
  const signedInvoice =
    input !== undefined && "sourceOutput" in input
      ? input.sourceOutput
      : createSignedInvoice();
  const proposalInvoice = createSignedInvoice();
  const proposalResult = createProposalResult(proposalInvoice);
  const sourceRequests: ProcurementInvoiceSourceRequest[] = [];
  const agentRequests: unknown[] = [];
  const service = createProcurementIntegration({
    invoiceSource: {
      requestSignedInvoice(request) {
        sourceRequests.push(request);
        if (input?.sourceFailure !== undefined) {
          return Promise.reject(input.sourceFailure);
        }
        return Promise.resolve(signedInvoice);
      },
    },
    agent: {
      proposePayment(request) {
        agentRequests.push(request);
        if (input?.agentFailure !== undefined) {
          return Promise.reject(input.agentFailure);
        }
        return Promise.resolve(proposalResult);
      },
    },
  });
  return {
    service,
    signedInvoice,
    proposalResult,
    sourceRequests,
    agentRequests,
  };
}

function publicRequest(maximumAmount: unknown = "2") {
  return { productId: PRODUCT_ID, maximumAmount };
}

describe("COV-011 procurement integration", () => {
  it("performs one exact frozen source request and one exact agent handoff", async () => {
    const harness = createHarness();

    const result = await harness.service.procurePayment(
      publicRequest("2.000000"),
    );

    expect(result).toBe(harness.proposalResult);
    expect(harness.sourceRequests).toHaveLength(1);
    const sourceRequest = harness.sourceRequests[0];
    if (sourceRequest === undefined) {
      throw new Error("Expected one procurement source request");
    }
    expect(sourceRequest).toEqual({
      productId: PRODUCT_ID,
      maximumAmount: "2",
    });
    expect(Object.keys(sourceRequest)).toEqual(["productId", "maximumAmount"]);
    expect(Object.isFrozen(sourceRequest)).toBe(true);
    expect(harness.agentRequests).toHaveLength(1);
    expect(harness.agentRequests[0]).toEqual({
      signedInvoice: harness.signedInvoice,
      procurementRequest: {
        productId: PRODUCT_ID,
        expectedAmount: "1.25",
      },
    });
    expect(
      (harness.agentRequests[0] as { signedInvoice: unknown }).signedInvoice,
    ).toBe(harness.signedInvoice);
    expect(Object.isFrozen(harness.agentRequests[0])).toBe(true);
    expect(
      Object.isFrozen(
        (harness.agentRequests[0] as { procurementRequest: unknown })
          .procurementRequest,
      ),
    ).toBe(true);
  });

  it.each([
    ["unknown outer field", { ...publicRequest(), extra: true }],
    ["missing productId", { maximumAmount: "2" }],
    ["missing maximumAmount", { productId: PRODUCT_ID }],
    ["unsupported product", { ...publicRequest(), productId: "gpu-a100-hour" }],
    ["zero maximum", publicRequest("0")],
    ["JavaScript number", publicRequest(2)],
    ["leading-zero money", publicRequest("02")],
    ["excess precision", publicRequest("2.0000001")],
    ["negative money", publicRequest("-2")],
    ["explicitly signed money", publicRequest("+2")],
  ])("rejects strict public request violation: %s", async (_label, request) => {
    const harness = createHarness();

    await expect(harness.service.procurePayment(request)).rejects.toEqual(
      new AgentError("MALFORMED_INPUT"),
    );
    expect(harness.sourceRequests).toHaveLength(0);
    expect(harness.agentRequests).toHaveLength(0);
  });

  it.each([
    ["undefined output", undefined],
    ["malformed envelope", { payload: createSignedInvoice().payload }],
    ["unknown envelope field", { ...createSignedInvoice(), extra: true }],
    [
      "unknown payload field",
      {
        ...createSignedInvoice(),
        payload: { ...createSignedInvoice().payload, extra: true },
      },
    ],
    [
      "malformed payload field",
      {
        ...createSignedInvoice(),
        payload: { ...createSignedInvoice().payload, version: "2" },
      },
    ],
    ["malformed signature", { ...createSignedInvoice(), signature: "0x12" }],
    [
      "malformed Invoice money",
      {
        ...createSignedInvoice(),
        payload: { ...createSignedInvoice().payload, amount: "01" },
      },
    ],
    [
      "unsupported Invoice product",
      createSignedInvoice("1.25", "gpu-a100-hour"),
    ],
  ])("rejects untrusted source output: %s", async (_label, sourceOutput) => {
    const harness = createHarness({ sourceOutput });

    await expect(
      harness.service.procurePayment(publicRequest()),
    ).rejects.toEqual(new AgentError("PROCUREMENT_INVOICE_INVALID"));
    expect(harness.sourceRequests).toHaveLength(1);
    expect(harness.agentRequests).toHaveLength(0);
  });

  it.each([
    ["equal to", "1.25", "1.250000"],
    ["below", "1.249999", "1.25"],
  ])(
    "accepts an Invoice amount %s the maximum",
    async (_label, amount, maximum) => {
      const signedInvoice = createSignedInvoice(amount);
      const harness = createHarness({ sourceOutput: signedInvoice });

      await expect(
        harness.service.procurePayment(publicRequest(maximum)),
      ).resolves.toBe(harness.proposalResult);
      expect(harness.sourceRequests).toHaveLength(1);
      expect(harness.agentRequests).toHaveLength(1);
      expect(harness.agentRequests[0]).toMatchObject({
        signedInvoice,
        procurementRequest: { expectedAmount: amount },
      });
    },
  );

  it("rejects an Invoice amount above the maximum before agent handoff", async () => {
    const harness = createHarness({
      sourceOutput: createSignedInvoice("1.250001"),
    });

    await expect(
      harness.service.procurePayment(publicRequest("1.25")),
    ).rejects.toEqual(new AgentError("PROCUREMENT_AMOUNT_EXCEEDS_MAXIMUM"));
    expect(harness.sourceRequests).toHaveLength(1);
    expect(harness.agentRequests).toHaveLength(0);
  });

  it("sanitizes source exceptions without leaking dependency data", async () => {
    const sensitive =
      "SENSITIVE_MARKER https://vendor.invalid Authorization: Bearer credential typedData signature";
    const harness = createHarness({ sourceFailure: new Error(sensitive) });

    let failure: unknown;
    try {
      await harness.service.procurePayment(publicRequest());
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AgentError);
    expect(JSON.parse(JSON.stringify(failure))).toEqual({
      name: "AgentError",
      code: "PROCUREMENT_SOURCE_FAILURE",
      message: "Procurement invoice source failed",
    });
    const serialized = JSON.stringify(failure);
    for (const forbidden of [
      "SENSITIVE_MARKER",
      "stack",
      "typedData",
      "signature",
      "https://",
      "credential",
      "Bearer",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(harness.sourceRequests).toHaveLength(1);
    expect(harness.agentRequests).toHaveLength(0);
  });

  it("preserves fixed AgentError behavior from the existing agent", async () => {
    const agentFailure = new AgentError("INVOICE_SIGNATURE_INVALID");
    const harness = createHarness({ agentFailure });

    let failure: unknown;
    try {
      await harness.service.procurePayment(publicRequest());
    } catch (error) {
      failure = error;
    }

    expect(failure).toBe(agentFailure);
    expect(JSON.parse(JSON.stringify(failure))).toEqual({
      name: "AgentError",
      code: "INVOICE_SIGNATURE_INVALID",
      message: "Invoice signature is invalid",
    });
    expect((failure as Error).stack).toBeUndefined();
    expect(failure).not.toHaveProperty("cause");
    expect(harness.sourceRequests).toHaveLength(1);
    expect(harness.agentRequests).toHaveLength(1);
  });

  it("exposes no authority or execution capability", async () => {
    const harness = createHarness();
    const prohibitedServiceProperties = [
      "authority",
      "executor",
      "transport",
      "wallet",
      "credentials",
      "signer",
      "authorizationSigner",
      "submit",
      "execute",
      "simulate",
      "prepareExecution",
      "executeAuthorizedPayment",
      "signAuthorizationReceipt",
      "signPaymentIntent",
      "calldata",
      "rpc",
      "circle",
    ];

    expect(Object.keys(harness.service)).toEqual(["procurePayment"]);
    expect(Object.isFrozen(harness.service)).toBe(true);
    for (const property of prohibitedServiceProperties) {
      expect(harness.service).not.toHaveProperty(property);
    }

    await harness.service.procurePayment(publicRequest());
    const prohibitedSourceFields = [
      "recipient",
      "token",
      "vault",
      "chain",
      "signer",
      "nonce",
      "purpose",
      "calldata",
      "transaction",
      "credential",
    ];
    for (const field of prohibitedSourceFields) {
      expect(harness.sourceRequests[0]).not.toHaveProperty(field);
    }
  });
});
