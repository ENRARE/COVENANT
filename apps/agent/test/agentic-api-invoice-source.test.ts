import { describe, expect, it, vi } from "vitest";
import {
  AgentError,
  createAgenticApiInvoiceSource,
  type AgenticApiInvoiceClient,
  type ProcurementInvoiceSourceRequest,
} from "../src/index.js";

const PRODUCT_ID = "gpu-h100-hour" as const;

function createHarness(candidate: unknown = { untrusted: "candidate" }) {
  const clientRequests: ProcurementInvoiceSourceRequest[] = [];
  const client: AgenticApiInvoiceClient = {
    requestInvoiceCandidate(request) {
      clientRequests.push(request);
      return Promise.resolve(candidate);
    },
  };

  return {
    candidate,
    clientRequests,
    source: createAgenticApiInvoiceSource({ client }),
  };
}

function canonicalRequest(maximumAmount: unknown = "12.3456") {
  return { productId: PRODUCT_ID, maximumAmount };
}

async function requestUnknown(
  source: ReturnType<typeof createAgenticApiInvoiceSource>,
  request: unknown,
) {
  return source.requestSignedInvoice(
    request as ProcurementInvoiceSourceRequest,
  );
}

describe("COV-012 offline Agentic API invoice source", () => {
  it("exposes exactly one frozen public method", () => {
    const { source } = createHarness();

    expect(Object.keys(source)).toEqual(["requestSignedInvoice"]);
    expect(Object.isFrozen(source)).toBe(true);
  });

  it.each(["1", "0.000001", "12.3456"])(
    "delegates one fresh frozen canonical request for %s",
    async (maximumAmount) => {
      const harness = createHarness();
      const callerRequest = canonicalRequest(maximumAmount);

      const result = await requestUnknown(harness.source, callerRequest);

      expect(result).toBe(harness.candidate);
      expect(harness.clientRequests).toHaveLength(1);
      const clientRequest = harness.clientRequests[0];
      expect(clientRequest).toEqual(callerRequest);
      expect(Object.keys(clientRequest ?? {})).toEqual([
        "productId",
        "maximumAmount",
      ]);
      expect(clientRequest).not.toBe(callerRequest);
      expect(Object.isFrozen(clientRequest)).toBe(true);
    },
  );

  it("excludes payment-routing fields from the exact client request", async () => {
    const harness = createHarness();
    const callerRequest = canonicalRequest("1");

    await requestUnknown(harness.source, callerRequest);

    expect(harness.clientRequests).toHaveLength(1);
    const clientRequest = harness.clientRequests[0];
    expect(clientRequest).toEqual({
      productId: "gpu-h100-hour",
      maximumAmount: "1",
    });
    expect(Object.keys(clientRequest ?? {})).toEqual([
      "productId",
      "maximumAmount",
    ]);
    for (const property of [
      "recipient",
      "token",
      "vault",
      "chain",
      "chainId",
      "signer",
      "nonce",
      "purpose",
      "covenant",
      "authorization",
      "wallet",
      "circle",
      "rpc",
      "calldata",
      "transaction",
      "submit",
      "execute",
      "simulate",
      "credentials",
      "headers",
    ]) {
      expect(clientRequest).not.toHaveProperty(property);
    }
    expect(clientRequest).not.toBe(callerRequest);
    expect(Object.isFrozen(clientRequest)).toBe(true);
  });

  it("returns the untrusted candidate unchanged by identity", async () => {
    const candidate = Object.freeze({ malformed: true });
    const harness = createHarness(candidate);

    await expect(
      requestUnknown(harness.source, canonicalRequest()),
    ).resolves.toBe(candidate);
  });

  it.each([
    ["null", null],
    ["empty array", []],
    ["positional array", [PRODUCT_ID, "1"]],
    ["string", "not-an-object"],
    ["boolean", true],
    ["undefined", undefined],
    ["missing product", { maximumAmount: "1" }],
    ["missing maximum", { productId: PRODUCT_ID }],
    ["unknown field", { ...canonicalRequest("1"), extra: true }],
    ["unsupported product", { productId: "gpu-a100-hour", maximumAmount: "1" }],
    ["JavaScript number", canonicalRequest(1)],
    ["zero", canonicalRequest("0")],
    ["negative", canonicalRequest("-1")],
    ["explicit plus", canonicalRequest("+1")],
    ["leading zero", canonicalRequest("01")],
    ["scientific notation", canonicalRequest("1e3")],
    ["comma", canonicalRequest("1,000")],
    ["excess precision", canonicalRequest("0.0000001")],
    ["noncanonical fraction", canonicalRequest("1.0")],
    ["noncanonical fraction padding", canonicalRequest("1.000000")],
    [
      "uint256 overflow",
      canonicalRequest(
        "115792089237316195423570985008687907853269984665640564039457584007913130",
      ),
    ],
  ])("rejects malformed input before delegation: %s", async (_label, input) => {
    const harness = createHarness();

    await expect(requestUnknown(harness.source, input)).rejects.toEqual(
      new AgentError("MALFORMED_INPUT"),
    );
    expect(harness.clientRequests).toHaveLength(0);
  });

  it.each([
    ["synchronous throw", false],
    ["asynchronous rejection", true],
  ])("sanitizes a client %s without retrying", async (_label, asynchronous) => {
    const clientRequests: ProcurementInvoiceSourceRequest[] = [];
    const sensitive =
      "SENSITIVE_MARKER https://provider.invalid Authorization credential request-body response-body signature";
    const source = createAgenticApiInvoiceSource({
      client: {
        requestInvoiceCandidate(request) {
          clientRequests.push(request);
          if (asynchronous) return Promise.reject(new Error(sensitive));
          throw new Error(sensitive);
        },
      },
    });

    let failure: unknown;
    try {
      await requestUnknown(source, canonicalRequest("1"));
    } catch (error) {
      failure = error;
    }

    expect(JSON.parse(JSON.stringify(failure))).toEqual({
      name: "AgentError",
      code: "PROCUREMENT_SOURCE_FAILURE",
      message: "Procurement invoice source failed",
    });
    expect((failure as Error).stack).toBeUndefined();
    expect(failure).not.toHaveProperty("cause");
    const serialized = JSON.stringify(failure);
    for (const forbidden of [
      "SENSITIVE_MARKER",
      "https://",
      "Authorization",
      "credential",
      "request-body",
      "response-body",
      "signature",
      "stack",
      "cause",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(clientRequests).toHaveLength(1);
  });

  it("exposes no network, credential, authority, or execution surface", async () => {
    const harness = createHarness();

    for (const property of [
      "fetch",
      "http",
      "transport",
      "credential",
      "headers",
      "wallet",
      "signer",
      "authority",
      "executor",
      "circle",
      "rpc",
      "transaction",
      "calldata",
      "submit",
      "execute",
      "simulate",
    ]) {
      expect(harness.source).not.toHaveProperty(property);
    }

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network access prohibited"));
    try {
      await requestUnknown(harness.source, canonicalRequest("1"));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
