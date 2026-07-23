import {
  buildPaymentIntentTypedData,
  deriveSigningDomainForCovenant,
  EIP712_DOMAIN_NAMES,
  verifyAuthorizationChain,
} from "@covenant/spec";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  createAuthorityService,
  type ApprovedDecisionRepository,
  type AuthorizationRepository,
} from "../src/index.js";
import { authorizationInput, createTestHarness, TEST_NOW } from "./fixtures.js";

function mutateSignature(
  signature: string,
  kind: "high-s" | "zero-r" | "zero-s" | "invalid-v",
): string {
  const r = signature.slice(2, 66);
  const s = signature.slice(66, 130);
  const v = signature.slice(130, 132);
  if (kind === "zero-r") return `0x${"00".repeat(32)}${s}${v}`;
  if (kind === "zero-s") return `0x${r}${"00".repeat(32)}${v}`;
  if (kind === "invalid-v") return `0x${r}${s}00`;
  const highS = (
    BigInt(
      "0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141",
    ) - BigInt(`0x${s}`)
  )
    .toString(16)
    .padStart(64, "0");
  return `0x${r}${highS}${v}`;
}

describe("strict and adversarial authority boundaries", () => {
  it.each(["high-s", "zero-r", "zero-s", "invalid-v"] as const)(
    "signs a rejection for schema-valid %s PaymentIntent signatures",
    async (kind) => {
      const harness = await createTestHarness();
      const envelope = harness.request.signedPaymentIntent as {
        payload: unknown;
        signature: string;
      };
      const result = await harness.service.evaluatePaymentRequest({
        ...harness.request,
        signedPaymentIntent: {
          ...envelope,
          signature: mutateSignature(envelope.signature, kind),
        },
      });
      expect(result.status).toBe("REJECTED");
      expect(
        result.ruleResults.find(
          ({ ruleId }) => ruleId === "intent_signature_valid",
        ),
      ).toMatchObject({ status: "FAIL", reason: "invalid_signature" });
    },
  );

  it.each([
    ["short", `0x${"11".repeat(64)}`],
    ["long", `0x${"11".repeat(66)}`],
  ])(
    "rejects %s signatures at the public boundary without signing",
    async (_label, signature) => {
      const harness = await createTestHarness();
      const envelope = harness.request.signedPaymentIntent as {
        payload: unknown;
        signature: string;
      };
      await expect(
        harness.service.evaluatePaymentRequest({
          ...harness.request,
          signedPaymentIntent: { ...envelope, signature },
        }),
      ).rejects.toMatchObject({ code: "MALFORMED_INPUT" });
      expect(harness.signer.decisionCalls).toBe(0);
    },
  );

  it.each([
    [
      "outer request",
      (request: Record<string, unknown>) => ({ ...request, executeNow: true }),
    ],
    [
      "PaymentIntent envelope",
      (request: Record<string, unknown>) => ({
        ...request,
        signedPaymentIntent: {
          ...(request.signedPaymentIntent as object),
          executeNow: true,
        },
      }),
    ],
    [
      "PaymentIntent payload",
      (request: Record<string, unknown>) => {
        const envelope = request.signedPaymentIntent as {
          payload: object;
          signature: string;
        };
        return {
          ...request,
          signedPaymentIntent: {
            ...envelope,
            payload: { ...envelope.payload, executeNow: true },
          },
        };
      },
    ],
    [
      "Invoice envelope",
      (request: Record<string, unknown>) => ({
        ...request,
        signedInvoice: {
          ...(request.signedInvoice as object),
          executeNow: true,
        },
      }),
    ],
    [
      "Invoice payload",
      (request: Record<string, unknown>) => {
        const envelope = request.signedInvoice as {
          payload: object;
          signature: string;
        };
        return {
          ...request,
          signedInvoice: {
            ...envelope,
            payload: { ...envelope.payload, executeNow: true },
          },
        };
      },
    ],
  ] as const)("rejects unknown fields in %s", async (_label, mutate) => {
    const harness = await createTestHarness();
    await expect(
      harness.service.evaluatePaymentRequest(
        mutate(harness.request as Record<string, unknown>),
      ),
    ).rejects.toMatchObject({ code: "MALFORMED_INPUT" });
  });

  it("strictly rejects malformed evidence", async () => {
    const harness = await createTestHarness();
    const service = createAuthorityService({
      ...harness.dependencies,
      evidenceReader: {
        ...harness.dependencies.evidenceReader,
        readEvidence: () =>
          Promise.resolve({ ...harness.evidence, totalSpent: "0" }),
      },
    });
    await expect(
      service.evaluatePaymentRequest(harness.request),
    ).rejects.toMatchObject({ code: "MALFORMED_EVIDENCE" });
  });

  it("strictly validates generated nonzero identifiers", async () => {
    const harness = await createTestHarness();
    const service = createAuthorityService({
      ...harness.dependencies,
      identifierGenerator: {
        createId: () => Promise.resolve(`0x${"00".repeat(32)}`),
      },
    });
    await expect(
      service.evaluatePaymentRequest(harness.request),
    ).rejects.toMatchObject({ code: "IDENTIFIER_INVALID" });
    expect(harness.signer.decisionCalls).toBe(0);
  });

  it("rejects wrong Covenant ID as unauthorized proposal authority", async () => {
    const harness = await createTestHarness();
    const request = await harness.rebuildRequest({
      intent: { covenantId: `0x${"81".repeat(32)}` },
    });
    const result = await harness.service.evaluatePaymentRequest(request);
    expect(result.status).toBe("REJECTED");
    expect(
      result.ruleResults.find(({ ruleId }) => ruleId === "agent_authorized"),
    ).toMatchObject({ status: "FAIL", reason: "covenant_mismatch" });
  });

  it.each([
    ["wrong chain", { chainId: 1n }, "chain_mismatch"],
    [
      "wrong vault",
      { vaultAddress: "0x8000000000000000000000000000000000000008" },
      "vault_mismatch",
    ],
  ] as const)("rejects %s evidence", async (_label, mutation, reason) => {
    const harness = await createTestHarness();
    Object.assign(harness.evidence, mutation);
    const result = await harness.service.evaluatePaymentRequest(
      harness.request,
    );
    expect(
      result.ruleResults.find(({ ruleId }) => ruleId === "covenant_active"),
    ).toMatchObject({ status: "FAIL", reason });
  });

  it("rejects a PaymentIntent signed under the wrong domain", async () => {
    const harness = await createTestHarness();
    const domain = deriveSigningDomainForCovenant(
      harness.covenant,
      EIP712_DOMAIN_NAMES.paymentIntent,
    );
    const typedData = buildPaymentIntentTypedData(harness.intent, domain);
    const signature = await harness.agentAccount.signTypedData({
      ...typedData,
      domain: { ...typedData.domain, chainId: 1n },
    });
    const result = await harness.service.evaluatePaymentRequest({
      ...harness.request,
      signedPaymentIntent: { payload: harness.intent, signature },
    });
    expect(result.status).toBe("REJECTED");
    expect(
      result.ruleResults.find(({ ruleId }) => ruleId === "agent_authorized"),
    ).toMatchObject({ status: "FAIL" });
  });

  it.each(["missing", "duplicated", "reordered", "extra"] as const)(
    "rejects %s canonical rules before authorization",
    async (kind) => {
      const harness = await createTestHarness();
      const approved = await harness.service.evaluatePaymentRequest(
        harness.request,
      );
      const rules = approved.ruleResults.map((result) => ({ ...result }));
      if (kind === "missing") rules.pop();
      const first = rules[0];
      const second = rules[1];
      if (first === undefined || second === undefined)
        throw new Error("Fixture rules are incomplete");
      if (kind === "duplicated") rules[1] = { ...first };
      if (kind === "reordered") [rules[0], rules[1]] = [second, first];
      if (kind === "extra") rules.push({ ...first });
      await expect(
        harness.service.issueAuthorization({
          ...authorizationInput(harness.request, approved),
          ruleResults: rules,
        }),
      ).rejects.toMatchObject({ code: "MALFORMED_INPUT" });
      expect(harness.signer.authorizationCalls).toBe(0);
    },
  );

  it("rejects every signed AuthorizationReceipt field mutation", async () => {
    const mutations: Record<string, unknown> = {
      version: "2",
      authorizationId: `0x${"91".repeat(32)}`,
      decisionId: `0x${"92".repeat(32)}`,
      covenantId: `0x${"93".repeat(32)}`,
      intentHash: `0x${"94".repeat(32)}`,
      vaultAddress: "0x8000000000000000000000000000000000000008",
      chainId: "1",
      policyVersion: "gpu-policy-2",
      authorizationNonce: "99",
      validUntil: (TEST_NOW + 1n).toString(),
      signer: privateKeyToAccount(generatePrivateKey()).address,
    };
    for (const [field, value] of Object.entries(mutations)) {
      const harness = await createTestHarness();
      const result = await harness.service.processPaymentRequest(
        harness.request,
      );
      if (result.status !== "APPROVED") throw new Error("Expected approval");
      await expect(
        verifyAuthorizationChain(
          harness.covenant,
          harness.request.signedPaymentIntent,
          result.decisionReceipt,
          result.ruleResults,
          {
            ...result.authorizationReceipt,
            payload: {
              ...result.authorizationReceipt.payload,
              [field]: value,
            },
          },
        ),
      ).rejects.toBeDefined();
    }
  });

  it("sanitizes repository failures", async () => {
    const harness = await createTestHarness();
    const broken: ApprovedDecisionRepository = {
      getOrCreate: () => Promise.reject(new Error("secret repository detail")),
    };
    const service = createAuthorityService({
      ...harness.dependencies,
      decisionRepository: broken,
    });
    await expect(
      service.evaluatePaymentRequest(harness.request),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      message: "Approved decision repository operation failed",
    });
  });

  it("does not cache rejected decisions", async () => {
    const harness = await createTestHarness();
    harness.evidence.revoked = true;
    const first = await harness.service.evaluatePaymentRequest(harness.request);
    const second = await harness.service.evaluatePaymentRequest(
      harness.request,
    );
    expect(first.status).toBe("REJECTED");
    expect(second.status).toBe("REJECTED");
    expect(second.decisionReceipt).not.toEqual(first.decisionReceipt);
    expect(harness.signer.decisionCalls).toBe(2);
  });

  it("sanitizes authorization repository failures before signing", async () => {
    const harness = await createTestHarness();
    const broken: AuthorizationRepository = {
      getOrCreate: () =>
        Promise.reject(new Error("secret authorization repository detail")),
    };
    const service = createAuthorityService({
      ...harness.dependencies,
      authorizationRepository: broken,
    });
    const approved = await service.evaluatePaymentRequest(harness.request);
    await expect(
      service.issueAuthorization(authorizationInput(harness.request, approved)),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(harness.signer.authorizationCalls).toBe(0);
  });
});
