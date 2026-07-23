import { describe, expect, it } from "vitest";
import {
  AUTHORITY_ERROR_MESSAGES,
  createAuthorityService,
  type ApprovedDecisionRecord,
  type RawSignedAuthorizationReceipt,
} from "../src/index.js";
import { authorizationInput, createTestHarness } from "./fixtures.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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
    ).rejects.toMatchObject({ code: "AUTHORIZATION_SIGNING_FAILURE" });
    const generatedAfterFailure = harness.generatedIds.filter(
      ({ kind }) => kind === "authorization",
    );
    expect(generatedAfterFailure).toHaveLength(1);
    const receipt = await harness.service.issueAuthorization(input);
    expect(receipt.payload.authorizationId).toBe(generatedAfterFailure[0]?.id);
    expect(receipt.payload.authorizationNonce).toBe("1");
    expect(await harness.service.issueAuthorization(input)).toEqual(receipt);
    expect(
      harness.generatedIds.filter(({ kind }) => kind === "authorization"),
    ).toHaveLength(1);
    expect(harness.signer.authorizationCalls).toBe(2);
  });

  it("never replaces a retained authorization nonce consumed after signing failure", async () => {
    const harness = await createTestHarness();
    const approved = await harness.service.evaluatePaymentRequest(
      harness.request,
    );
    const input = authorizationInput(harness.request, approved);
    harness.signer.failNextAuthorization = true;

    await expect(
      harness.service.issueAuthorization(input),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_SIGNING_FAILURE" });
    const retainedIds = harness.generatedIds.filter(
      ({ kind }) => kind === "authorization",
    );
    expect(retainedIds).toHaveLength(1);
    expect(
      harness.authorizationNonceChecks.every((nonce) => nonce === 1n),
    ).toBe(true);

    harness.consumedAuthorizationNonces.add(1n);
    await expect(
      harness.service.issueAuthorization(input),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_NONCE_CONSUMED" });

    expect(
      harness.generatedIds.filter(({ kind }) => kind === "authorization"),
    ).toEqual(retainedIds);
    expect(
      harness.authorizationNonceChecks.every((nonce) => nonce === 1n),
    ).toBe(true);
    expect(harness.signer.authorizationCalls).toBe(1);
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

  it("gives all concurrent decision-signing joiners the same sanitized failure", async () => {
    const harness = await createTestHarness();
    const entered = deferred();
    const release = deferred();
    let calls = 0;
    let fail = true;
    const service = createAuthorityService({
      ...harness.dependencies,
      signer: {
        address: harness.signer.address,
        signDecisionReceipt: async (typedData) => {
          calls += 1;
          if (fail) {
            entered.resolve();
            await release.promise;
            throw new Error("concurrent-decision-secret");
          }
          return harness.signer.signDecisionReceipt(typedData);
        },
        signAuthorizationReceipt: harness.signer.signAuthorizationReceipt.bind(
          harness.signer,
        ),
      },
    });
    const first = service.evaluatePaymentRequest(harness.request);
    const second = service.evaluatePaymentRequest(harness.request);
    await entered.promise;
    expect(calls).toBe(1);
    release.resolve();
    const settled = await Promise.allSettled([first, second]);
    expect(settled).toEqual([
      {
        status: "rejected",
        reason: expect.objectContaining({
          code: "DECISION_SIGNING_FAILURE",
          message: AUTHORITY_ERROR_MESSAGES.DECISION_SIGNING_FAILURE,
        }),
      },
      {
        status: "rejected",
        reason: expect.objectContaining({
          code: "DECISION_SIGNING_FAILURE",
          message: AUTHORITY_ERROR_MESSAGES.DECISION_SIGNING_FAILURE,
        }),
      },
    ]);
    expect(JSON.stringify(settled)).not.toContain("concurrent-decision-secret");
    fail = false;
    expect((await service.evaluatePaymentRequest(harness.request)).status).toBe(
      "APPROVED",
    );
    expect(calls).toBe(2);
  });

  it("gives all concurrent authorization-signing joiners one failure and retains the reservation", async () => {
    const harness = await createTestHarness();
    const approved = await harness.service.evaluatePaymentRequest(
      harness.request,
    );
    const input = authorizationInput(harness.request, approved);
    const entered = deferred();
    const release = deferred();
    let fail = true;
    let calls = 0;
    const service = createAuthorityService({
      ...harness.dependencies,
      signer: {
        address: harness.signer.address,
        signDecisionReceipt: harness.signer.signDecisionReceipt.bind(
          harness.signer,
        ),
        signAuthorizationReceipt: async (typedData) => {
          calls += 1;
          if (fail) {
            entered.resolve();
            await release.promise;
            throw new Error("concurrent-authorization-secret");
          }
          return harness.signer.signAuthorizationReceipt(typedData);
        },
      },
    });
    const first = service.issueAuthorization(input);
    const second = service.issueAuthorization(input);
    await entered.promise;
    expect(calls).toBe(1);
    release.resolve();
    const settled = await Promise.allSettled([first, second]);
    expect(
      settled.every(
        (result) =>
          result.status === "rejected" &&
          (result.reason as { code?: string }).code ===
            "AUTHORIZATION_SIGNING_FAILURE",
      ),
    ).toBe(true);
    expect(JSON.stringify(settled)).not.toContain(
      "concurrent-authorization-secret",
    );
    fail = false;
    const receipt = await service.issueAuthorization(input);
    expect(receipt.payload.authorizationNonce).toBe("1");
    expect(
      harness.generatedIds.filter(({ kind }) => kind === "authorization"),
    ).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it("sanitizes a shared concurrent decision repository rejection once", async () => {
    const harness = await createTestHarness();
    const entered = deferred();
    const release = deferred();
    let calls = 0;
    let pending: Promise<ApprovedDecisionRecord> | undefined;
    let fail = true;
    const service = createAuthorityService({
      ...harness.dependencies,
      decisionRepository: {
        getOrCreate: (_identity, create) => {
          pending ??= (async () => {
            calls += 1;
            if (fail) {
              entered.resolve();
              await release.promise;
              throw new Error("concurrent-decision-repository-secret");
            }
            return create();
          })().finally(() => {
            pending = undefined;
          });
          return pending;
        },
      },
    });
    const operations = [
      service.evaluatePaymentRequest(harness.request),
      service.evaluatePaymentRequest(harness.request),
    ];
    await entered.promise;
    expect(calls).toBe(1);
    release.resolve();
    const settled = await Promise.allSettled(operations);
    expect(
      settled.every(
        (result) =>
          result.status === "rejected" &&
          (result.reason as { code?: string }).code ===
            "DECISION_REPOSITORY_FAILURE",
      ),
    ).toBe(true);
    expect(JSON.stringify(settled)).not.toContain(
      "concurrent-decision-repository-secret",
    );
    fail = false;
    expect((await service.evaluatePaymentRequest(harness.request)).status).toBe(
      "APPROVED",
    );
    expect(calls).toBe(2);
  });

  it("sanitizes a barrier-controlled nonce repository failure for all authorization joiners", async () => {
    const harness = await createTestHarness();
    const approved = await harness.service.evaluatePaymentRequest(
      harness.request,
    );
    const input = authorizationInput(harness.request, approved);
    const entered = deferred();
    const release = deferred();
    let calls = 0;
    let fail = true;
    const service = createAuthorityService({
      ...harness.dependencies,
      nonceRepository: {
        reserve: async () => {
          calls += 1;
          if (fail) {
            entered.resolve();
            await release.promise;
            throw new Error("concurrent-nonce-repository-secret");
          }
          return 1n;
        },
      },
    });
    const operations: Promise<RawSignedAuthorizationReceipt>[] = [
      service.issueAuthorization(input),
      service.issueAuthorization(input),
    ];
    await entered.promise;
    expect(calls).toBe(1);
    release.resolve();
    const settled = await Promise.allSettled(operations);
    expect(
      settled.every(
        (result) =>
          result.status === "rejected" &&
          (result.reason as { code?: string }).code ===
            "NONCE_REPOSITORY_FAILURE",
      ),
    ).toBe(true);
    expect(JSON.stringify(settled)).not.toContain(
      "concurrent-nonce-repository-secret",
    );
    fail = false;
    expect(
      (await service.issueAuthorization(input)).payload.authorizationNonce,
    ).toBe("1");
    expect(calls).toBe(2);
  });

  it("sanitizes a shared concurrent authorization repository rejection once", async () => {
    const harness = await createTestHarness();
    const approved = await harness.service.evaluatePaymentRequest(
      harness.request,
    );
    const input = authorizationInput(harness.request, approved);
    const entered = deferred();
    const release = deferred();
    let calls = 0;
    let pending: Promise<RawSignedAuthorizationReceipt> | undefined;
    let fail = true;
    const service = createAuthorityService({
      ...harness.dependencies,
      authorizationRepository: {
        getOrCreate: (_identity, reserve, issue) => {
          pending ??= (async () => {
            calls += 1;
            if (fail) {
              entered.resolve();
              await release.promise;
              throw new Error("concurrent-authorization-repository-secret");
            }
            return issue(await reserve());
          })().finally(() => {
            pending = undefined;
          });
          return pending;
        },
      },
    });
    const operations = [
      service.issueAuthorization(input),
      service.issueAuthorization(input),
    ];
    await entered.promise;
    expect(calls).toBe(1);
    release.resolve();
    const settled = await Promise.allSettled(operations);
    expect(
      settled.every(
        (result) =>
          result.status === "rejected" &&
          (result.reason as { code?: string }).code ===
            "AUTHORIZATION_REPOSITORY_FAILURE",
      ),
    ).toBe(true);
    expect(JSON.stringify(settled)).not.toContain(
      "concurrent-authorization-repository-secret",
    );
    fail = false;
    expect(
      (await service.issueAuthorization(input)).payload.authorizationNonce,
    ).toBe("1");
    expect(calls).toBe(2);
  });
});
