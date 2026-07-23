import { describe, expect, it, vi } from "vitest";
import {
  createAgentHarness,
  proposalForInvoice,
  TEST_NOW,
} from "./fixtures.js";

describe("service-local single-flight and retained reservations", () => {
  it("shares one reservation and signature across concurrent duplicates", async () => {
    const harness = await createAgentHarness();
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    harness.signer.signPaymentIntent = async (typedData) => {
      harness.signer.calls += 1;
      harness.signer.typedData.push(typedData);
      await barrier;
      return harness.agentAccount.signTypedData(
        typedData as Parameters<typeof harness.agentAccount.signTypedData>[0],
      );
    };

    const first = harness.service.proposePayment(harness.request);
    const second = harness.service.proposePayment(harness.request);
    await vi.waitFor(() => {
      expect(harness.counts.signer).toBe(1);
    });
    release?.();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBe(secondResult);
    expect(Object.isFrozen(firstResult)).toBe(true);
    expect(harness.counts).toMatchObject({
      identifier: 1,
      signer: 1,
      reservation: 1,
      completion: 1,
    });
  });

  it("awaits the core operation when coordination invokes then rejects", async () => {
    const harness = await createAgentHarness({
      proposalRepository: {
        coordinate(_identity, operation) {
          void operation();
          return Promise.reject(
            new Error("repository rejected after invocation"),
          );
        },
      },
    });
    await expect(
      harness.service.proposePayment(harness.request),
    ).resolves.toMatchObject({
      signedPaymentIntent: { payload: { nonce: "0" } },
    });
    expect(harness.counts).toMatchObject({
      identifier: 1,
      signer: 1,
      reservation: 1,
      completion: 1,
    });
  });

  it("keeps invoke-then-reject joiners attached while the core operation is alive", async () => {
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = await createAgentHarness({
      proposalRepository: {
        coordinate(_identity, operation) {
          void operation();
          return Promise.reject(new Error("reject after invoking"));
        },
      },
    });
    harness.signer.signPaymentIntent = async (typedData) => {
      harness.signer.calls += 1;
      harness.signer.typedData.push(typedData);
      await barrier;
      return harness.agentAccount.signTypedData(
        typedData as Parameters<typeof harness.agentAccount.signTypedData>[0],
      );
    };

    const first = harness.service.proposePayment(harness.request);
    await vi.waitFor(() => {
      expect(harness.counts.signer).toBe(1);
    });
    const retry = harness.service.proposePayment(harness.request);
    await Promise.resolve();
    expect(harness.counts.signer).toBe(1);
    release?.();
    const [firstResult, retryResult] = await Promise.all([first, retry]);
    expect(retryResult).toBe(firstResult);
    expect(harness.counts).toMatchObject({
      identifier: 1,
      signer: 1,
      reservation: 1,
      completion: 1,
    });
  });

  it("awaits the core operation when coordination invokes then never settles", async () => {
    const harness = await createAgentHarness({
      proposalRepository: {
        coordinate(_identity, operation) {
          void operation();
          return new Promise<never>(() => undefined);
        },
      },
    });
    await expect(
      harness.service.proposePayment(harness.request),
    ).resolves.toMatchObject({
      signedPaymentIntent: { payload: { nonce: "0" } },
    });
    expect(harness.counts.signer).toBe(1);
  });

  it("gives a repository invoking twice the same core-operation promise", async () => {
    let samePromise = false;
    const harness = await createAgentHarness({
      proposalRepository: {
        coordinate(_identity, operation) {
          const first = operation();
          const second = operation();
          samePromise = first === second;
          return second;
        },
      },
    });
    await harness.service.proposePayment(harness.request);
    expect(samePromise).toBe(true);
    expect(harness.counts).toMatchObject({
      identifier: 1,
      signer: 1,
      reservation: 1,
      completion: 1,
    });
  });

  it("retains exact ID, nonce, createdAt, expiry, and payload after signer failure", async () => {
    const harness = await createAgentHarness();
    harness.signer.failure = new Error("first signing attempt fails");
    await expect(
      harness.service.proposePayment(harness.request),
    ).rejects.toMatchObject({ code: "PAYMENT_INTENT_SIGNING_FAILURE" });
    const firstTypedData = structuredClone(harness.signer.typedData[0]);
    harness.signer.failure = undefined;

    const result = await harness.service.proposePayment(harness.request);
    expect(harness.signer.typedData[1]).toEqual(firstTypedData);
    expect(result.signedPaymentIntent.payload).toMatchObject({
      intentId: `0x${"34".repeat(32)}`,
      nonce: "0",
      createdAt: TEST_NOW.toString(),
      expiresAt: (TEST_NOW + 600n).toString(),
    });
    expect(harness.counts).toMatchObject({
      identifier: 1,
      signer: 2,
      reservation: 1,
      completion: 1,
    });
  });

  it("permanently rejects an expired retained proposal without signing again", async () => {
    const harness = await createAgentHarness();
    harness.signer.failure = new Error("first signing attempt fails");
    await expect(
      harness.service.proposePayment(harness.request),
    ).rejects.toMatchObject({ code: "PAYMENT_INTENT_SIGNING_FAILURE" });
    harness.signer.failure = undefined;
    harness.clock.value = TEST_NOW + 600n;

    await expect(
      harness.service.proposePayment(harness.request),
    ).rejects.toMatchObject({ code: "PAYMENT_INTENT_EXPIRED" });
    expect(harness.counts).toMatchObject({
      identifier: 1,
      signer: 1,
      reservation: 1,
      completion: 0,
    });
  });

  it("returns completed duplicates without signing again", async () => {
    const harness = await createAgentHarness();
    const first = await harness.service.proposePayment(harness.request);
    const second = await harness.service.proposePayment(harness.request);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(harness.counts).toMatchObject({
      identifier: 1,
      signer: 1,
      reservation: 1,
      completion: 1,
    });
  });

  it("does not return an expired completed duplicate", async () => {
    const harness = await createAgentHarness();
    await harness.service.proposePayment(harness.request);
    harness.clock.value = TEST_NOW + 600n;
    await expect(
      harness.service.proposePayment(harness.request),
    ).rejects.toMatchObject({ code: "PAYMENT_INTENT_EXPIRED" });
    expect(harness.counts).toMatchObject({ signer: 1, completion: 1 });
  });

  it("never shares reservations across distinct Invoice digests", async () => {
    const harness = await createAgentHarness();
    const first = await harness.service.proposePayment(harness.request);
    const secondRequest = await proposalForInvoice(harness, {
      ...harness.invoice,
      invoiceId: `0x${"35".repeat(32)}`,
      nonce: "2",
    });
    const second = await harness.service.proposePayment(secondRequest);

    expect(first.signedPaymentIntent.payload.invoiceHash).not.toBe(
      second.signedPaymentIntent.payload.invoiceHash,
    );
    expect(first.signedPaymentIntent.payload.nonce).toBe("0");
    expect(second.signedPaymentIntent.payload.nonce).toBe("1");
    expect(harness.counts).toMatchObject({
      identifier: 2,
      signer: 2,
      reservation: 2,
      completion: 2,
    });
  });

  it("protects stored results from caller mutation", async () => {
    const harness = await createAgentHarness();
    const first = await harness.service.proposePayment(harness.request);
    const changed = Reflect.set(
      first.signedPaymentIntent.payload,
      "amount",
      "999",
    );
    const invoiceChanged = Reflect.set(
      first.signedInvoice.payload,
      "purpose",
      "attacker purpose",
    );
    expect(changed).toBe(false);
    expect(invoiceChanged).toBe(false);

    const second = await harness.service.proposePayment(harness.request);
    expect(second.signedPaymentIntent.payload.amount).toBe("1.25");
    expect(second.signedInvoice.payload.purpose).toBe(harness.invoice.purpose);
    expect(harness.counts.signer).toBe(1);
  });

  it("rejects when the retained lifetime is exhausted before first signing", async () => {
    let calls = 0;
    const harness = await createAgentHarness({
      clock: {
        value: TEST_NOW,
        now() {
          calls += 1;
          return calls === 1 ? TEST_NOW : TEST_NOW + 600n;
        },
      },
    });
    await expect(
      harness.service.proposePayment(harness.request),
    ).rejects.toMatchObject({ code: "PAYMENT_INTENT_EXPIRED" });
    expect(harness.counts).toMatchObject({
      identifier: 1,
      signer: 0,
      reservation: 1,
      completion: 0,
    });
  });
});
