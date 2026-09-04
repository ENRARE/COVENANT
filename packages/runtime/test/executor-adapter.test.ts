import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createIsolatedExecutorAdapter } from "../src/index.js";
import { DurableExecutionRuntime, DurableRuntimeStore } from "../src/index.js";
import {
  applyAuthorizationEvidence,
  createCovenant,
  PLATFORM_V1_ASSET,
  PLATFORM_V1_NETWORK,
  requestAuthorization,
} from "@covenant/core";

const id = (byte: number) =>
  `0x${byte.toString(16).padStart(2, "0").repeat(32)}`;
const projectId = id(0xa1);
const covenantId = id(1);
const executionId = id(9);
const payer = "0x1000000000000000000000000000000000000001";
const beneficiary = "0x2000000000000000000000000000000000000002";

function resource() {
  const created = createCovenant({
    version: "2",
    id: covenantId,
    projectId,
    payer,
    beneficiary,
    asset: PLATFORM_V1_ASSET,
    amount: "1.25",
    network: PLATFORM_V1_NETWORK,
    conditions: { policyHash: id(7), policyVersion: "policy-1" },
    createdAt: "100",
    expiresAt: "1000",
  });
  return applyAuthorizationEvidence(
    requestAuthorization(created, "101"),
    {
      covenantId,
      policyVersion: "policy-1",
      decisionId: id(4),
      intentId: id(2),
      intentHash: id(8),
      decision: "APPROVED",
      authorizationId: id(6),
      validUntil: "900",
    },
    "102",
  );
}

const submission = {
  evidence: {
    covenantId,
    policyVersion: "policy-1",
    decisionId: id(4),
    intentId: id(2),
    intentHash: id(8),
    decision: "APPROVED" as const,
    authorizationId: id(6),
    validUntil: "900",
    signedDecisionReceipt: { payload: "decision", signature: "signature" },
    signedAuthorizationReceipt: {
      payload: "authorization",
      signature: "signature",
    },
  },
  signedPaymentIntent: { payload: "intent", signature: "signature" },
  ruleResults: ["canonical-rules"],
};

describe("isolated executor runtime adapter", () => {
  it("forwards only persisted authority evidence and maps reviewed outcomes", async () => {
    const store = new DurableRuntimeStore();
    const runtime = new DurableExecutionRuntime({
      store,
      adapter: {
        simulate: () =>
          Promise.resolve({ status: "NO_SUBMISSION", reason: "unused" }),
        submit: () =>
          Promise.resolve({ status: "NO_SUBMISSION", reason: "unused" }),
      },
      clock: { now: () => 200 },
    });
    const authorized = resource();
    store.saveCovenant(projectId, authorized, 200);
    store.saveAuthorizationEvidence(projectId, covenantId, submission, 201);
    const started = runtime.startExecution({
      projectId,
      covenantId,
      executionId,
      operationKey: executionId,
      at: "210",
    });
    expect(started.operation.authorizationEvidence).toEqual(submission);

    const requests: unknown[] = [];
    const adapter = createIsolatedExecutorAdapter({
      simulateAuthorizedPayment: (request) => {
        requests.push(request);
        return Promise.resolve({ status: "SIMULATED" });
      },
      executeAuthorizedPayment: (request) => {
        requests.push(request);
        return Promise.resolve({
          status: "SUBMITTED",
          transactionId: "circle-1",
        });
      },
    });
    await expect(adapter.simulate(started.operation)).resolves.toEqual({
      status: "READY",
    });
    await expect(adapter.submit(started.operation)).resolves.toEqual({
      status: "ACCEPTED",
      transactionId: "circle-1",
      providerState: "ACCEPTED",
    });
    expect(requests).toEqual([
      {
        executionId: started.operation.executionId,
        signedPaymentIntent: submission.signedPaymentIntent,
        ruleResults: submission.ruleResults,
        decisionReceipt: submission.evidence.signedDecisionReceipt,
        authorizationReceipt: submission.evidence.signedAuthorizationReceipt,
      },
      {
        executionId: started.operation.executionId,
        signedPaymentIntent: submission.signedPaymentIntent,
        ruleResults: submission.ruleResults,
        decisionReceipt: submission.evidence.signedDecisionReceipt,
        authorizationReceipt: submission.evidence.signedAuthorizationReceipt,
      },
    ]);
  });

  it("fails closed without persisted authority evidence", async () => {
    const store = new DurableRuntimeStore();
    const runtime = new DurableExecutionRuntime({
      store,
      adapter: {
        simulate: () =>
          Promise.resolve({ status: "NO_SUBMISSION", reason: "unused" }),
        submit: () =>
          Promise.resolve({ status: "NO_SUBMISSION", reason: "unused" }),
      },
      clock: { now: () => 200 },
    });
    const started = (() => {
      const authorized = resource();
      store.saveCovenant(projectId, authorized, 200);
      return runtime.startExecution({
        projectId,
        covenantId,
        executionId,
        operationKey: executionId,
        at: "210",
      });
    })();
    const adapter = createIsolatedExecutorAdapter({
      simulateAuthorizedPayment: () => Promise.resolve({ status: "SIMULATED" }),
      executeAuthorizedPayment: () =>
        Promise.resolve({ status: "SUBMITTED", transactionId: "circle-1" }),
    });
    await expect(adapter.simulate(started.operation)).resolves.toEqual({
      status: "NO_SUBMISSION",
      reason: "Verified authorization evidence is unavailable",
    });
  });

  it("retains verified evidence across a durable store restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "covenant-runtime-"));
    const filename = join(directory, "runtime.sqlite");
    try {
      const first = new DurableRuntimeStore({ filename });
      const authorized = resource();
      first.saveCovenant(projectId, authorized, 200);
      first.saveAuthorizationEvidence(projectId, covenantId, submission, 201);
      first.close();

      const second = new DurableRuntimeStore({ filename });
      expect(second.getAuthorizationEvidence(projectId, covenantId)).toEqual(
        submission,
      );
      second.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
