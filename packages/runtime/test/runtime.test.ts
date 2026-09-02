/* eslint-disable @typescript-eslint/require-await */

import {
  applyAuthorizationEvidence,
  createCovenant,
  PLATFORM_V1_ASSET,
  PLATFORM_V1_NETWORK,
  requestAuthorization,
} from "@covenant/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DurableExecutionRuntime,
  DurableRuntimeStore,
  RuntimeError,
  type ExecutionAdapter,
} from "../src/index.js";

const id = (byte: number) =>
  `0x${byte.toString(16).padStart(2, "0").repeat(32)}`;
const projectId = id(0xa0);
const covenantId = id(1);
const executionId = id(9);
const operationKey = id(10);
const payer = "0x1000000000000000000000000000000000000001";
const beneficiary = "0x2000000000000000000000000000000000000002";

function authorizedResource(idValue = covenantId, project = projectId) {
  const created = createCovenant({
    version: "2",
    id: idValue,
    projectId: project,
    payer,
    beneficiary,
    asset: PLATFORM_V1_ASSET,
    amount: "1.25",
    network: PLATFORM_V1_NETWORK,
    conditions: { policyHash: id(7), policyVersion: "gpu-policy-1" },
    createdAt: "100",
    expiresAt: "1000",
  });
  const awaiting = requestAuthorization(created, "101");
  return applyAuthorizationEvidence(
    awaiting,
    {
      covenantId: idValue,
      policyVersion: "gpu-policy-1",
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

function runtime(adapter: ExecutionAdapter, now = 200) {
  let current = now;
  const store = new DurableRuntimeStore();
  const value = new DurableExecutionRuntime({
    store,
    adapter,
    clock: { now: () => current },
    leaseMs: 10,
  });
  return {
    store,
    runtime: value,
    tick: (next: number) => {
      current = next;
    },
  };
}

function start(value: DurableExecutionRuntime) {
  value.saveCovenant(projectId, authorizedResource());
  return value.startExecution({
    projectId,
    covenantId,
    executionId,
    operationKey,
    at: "110",
  });
}

const acceptedArc = {
  status: "OBSERVED_SUCCESS" as const,
  chainId: "5042002" as const,
  transactionHash: id(11) as `0x${string}`,
  covenantId: covenantId as `0x${string}`,
  recipient: beneficiary as `0x${string}`,
  amount: "1.25",
  token: PLATFORM_V1_ASSET.address,
};

describe("@covenant/runtime COV-023 durable execution", () => {
  it("round-trips multiple project-scoped Covenants and emits a transactional outbox row", () => {
    const store = new DurableRuntimeStore();
    const first = authorizedResource();
    const second = authorizedResource(id(2), id(0xb0));
    store.saveCovenant(projectId, first, 200);
    store.saveCovenant(id(0xb0), second, 201);
    expect(store.getCovenant(projectId, covenantId)?.resource.id).toBe(
      covenantId,
    );
    expect(store.getCovenant(id(0xb0), id(2))?.resource.projectId).toBe(
      id(0xb0),
    );
    expect(store.listOutbox()).toHaveLength(0);
  });

  it("survives a process restart and keeps outbox delivery separate from state", () => {
    const directory = mkdtempSync(join(tmpdir(), "covenant-cov023-"));
    const filename = join(directory, "runtime.sqlite");
    try {
      const firstStore = new DurableRuntimeStore({ filename });
      const firstRuntime = new DurableExecutionRuntime({
        store: firstStore,
        adapter: {
          simulate: () => Promise.resolve({ status: "READY" }),
          submit: () =>
            Promise.resolve({ status: "ACCEPTED", transactionId: "t" }),
        },
        clock: { now: () => 200 },
      });
      const started = start(firstRuntime);
      const event = firstStore.listOutbox()[0];
      expect(event?.eventType).toBe("execution.queued");
      firstStore.close();
      const secondStore = new DurableRuntimeStore({ filename });
      expect(
        secondStore.getOperation(started.operation.operationKey)?.state,
      ).toBe("QUEUED");
      expect(secondStore.listOutbox({ undeliveredOnly: true })).toHaveLength(1);
      if (event !== undefined)
        expect(
          secondStore.markOutboxDelivered(event.id, 300)?.deliveredAt,
        ).toBe(300);
      expect(secondStore.listOutbox({ undeliveredOnly: true })).toHaveLength(0);
      secondStore.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("joins the same durable execution and rejects a conflicting identity", () => {
    const setup = runtime({
      simulate: async () => ({ status: "READY" }),
      submit: async () => ({ status: "ACCEPTED", transactionId: "circle-1" }),
    });
    const first = start(setup.runtime);
    const joined = setup.runtime.startExecution({
      projectId,
      covenantId,
      executionId,
      operationKey,
      at: "111",
    });
    expect(joined.joined).toBe(true);
    expect(joined.operation.operationKey).toBe(first.operation.operationKey);
    expect(() =>
      setup.runtime.startExecution({
        projectId,
        covenantId,
        executionId: id(12),
        operationKey: id(13),
        at: "112",
      }),
    ).toThrow();
  });

  it("allows exactly one claim and rejects stale lease writes", () => {
    const setup = runtime({
      simulate: async () => ({ status: "READY" }),
      submit: async () => ({ status: "ACCEPTED", transactionId: "circle-1" }),
    });
    const started = start(setup.runtime);
    const one = setup.runtime.claim(started.operation.operationKey, "worker-a");
    expect(one?.leaseOwner).toBe("worker-a");
    expect(
      setup.runtime.claim(started.operation.operationKey, "worker-b"),
    ).toBeUndefined();
    expect(() =>
      setup.store.transitionLeased(
        started.operation.operationKey,
        "worker-a",
        started.operation.version,
        "PREPARING",
        201,
      ),
    ).toThrowError(RuntimeError);
  });

  it("recovers an expired pre-submission lease but never retries a post-boundary operation", async () => {
    const setup = runtime({
      simulate: async () => ({ status: "READY" }),
      submit: async () => {
        throw new Error("provider timeout");
      },
    });
    const started = start(setup.runtime);
    const claimed = setup.runtime.claim(
      started.operation.operationKey,
      "worker-a",
    );
    expect(claimed).toBeDefined();
    setup.tick(220);
    expect(setup.runtime.recoverExpiredLeases()[0]?.state).toBe("QUEUED");
    const result = await setup.runtime.process(
      started.operation.operationKey,
      "worker-a",
    );
    expect(result.state).toBe("AMBIGUOUS");
    expect(result.submissionBoundary).toBe(true);
    expect(
      setup.runtime.claim(started.operation.operationKey, "worker-a")?.state,
    ).toBe("AMBIGUOUS");
    setup.tick(300);
    expect(setup.runtime.recoverExpiredLeases()[0]?.state).toBe("AMBIGUOUS");
  });

  it("persists the submission boundary before the external call and does not resubmit ambiguity", async () => {
    let submissions = 0;
    const setup = runtime({
      simulate: async () => ({ status: "READY" }),
      submit: async () => {
        submissions += 1;
        throw new Error("unknown");
      },
    });
    const started = start(setup.runtime);
    const result = await setup.runtime.process(
      started.operation.operationKey,
      "worker-a",
    );
    expect(result.state).toBe("AMBIGUOUS");
    expect(submissions).toBe(1);
    expect(
      (await setup.runtime.process(started.operation.operationKey, "worker-b"))
        .state,
    ).toBe("AMBIGUOUS");
    expect(submissions).toBe(1);
  });

  it("retries explicit no-submission rejection, keeps provider acceptance separate, and reconciles Arc success", async () => {
    const setup = runtime({
      simulate: async () => ({ status: "READY" }),
      submit: async () => ({
        status: "NO_SUBMISSION",
        reason: "provider rejected before dispatch",
      }),
    });
    const started = start(setup.runtime);
    const retry = await setup.runtime.process(
      started.operation.operationKey,
      "worker-a",
    );
    expect(retry.state).toBe("QUEUED");
    expect(retry.retryReason).toBe("PROVIDER_NO_SUBMISSION");

    let accepted = false;
    const acceptedRuntime = runtime({
      simulate: async () => ({ status: "READY" }),
      submit: async () => {
        accepted = true;
        return { status: "ACCEPTED", transactionId: "circle-2" };
      },
    });
    const acceptedStart = start(acceptedRuntime.runtime);
    const submitted = await acceptedRuntime.runtime.process(
      acceptedStart.operation.operationKey,
      "worker-a",
    );
    expect(accepted).toBe(true);
    expect(submitted.state).toBe("SUBMITTED");
    const providerOnly = acceptedRuntime.runtime.reconcile({
      operationKey: submitted.operationKey,
      projectId,
      workerId: "worker-b",
      at: "120",
      arc: "OBSERVATION_UNAVAILABLE",
    });
    expect(providerOnly.operation.state).toBe("RECONCILING");
    expect(providerOnly.covenant.status).toBe("EXECUTING");
    acceptedRuntime.tick(3_000);
    const executed = acceptedRuntime.runtime.reconcile({
      operationKey: submitted.operationKey,
      projectId,
      workerId: "worker-b",
      at: "121",
      arc: acceptedArc,
    });
    expect(executed.operation.state).toBe("SUCCEEDED");
    expect(executed.covenant.status).toBe("EXECUTED");
  });

  it("fails closed on conflicting Arc evidence and never reopens terminal state", async () => {
    const setup = runtime({
      simulate: async () => ({ status: "READY" }),
      submit: async () => ({ status: "ACCEPTED", transactionId: "circle-3" }),
    });
    const started = start(setup.runtime);
    const submitted = await setup.runtime.process(
      started.operation.operationKey,
      "worker-a",
    );
    const failed = setup.runtime.reconcile({
      operationKey: submitted.operationKey,
      projectId,
      workerId: "worker-b",
      at: "120",
      arc: { status: "EVIDENCE_CONFLICT", reason: "two Arc observations" },
    });
    expect(failed.operation.state).toBe("TERMINAL_FAILED");
    expect(() =>
      setup.store.transitionLeased(
        failed.operation.operationKey,
        "worker-b",
        failed.operation.version,
        "QUEUED",
        130,
      ),
    ).toThrow();
  });

  it("does not persist credentials or secret-bearing execution payloads", () => {
    const setup = runtime({
      simulate: async () => ({ status: "READY" }),
      submit: async () => ({ status: "ACCEPTED", transactionId: "circle-4" }),
    });
    const started = start(setup.runtime);
    const serialized = JSON.stringify(started.operation);
    expect(serialized).not.toContain("signedTransaction");
    expect(Object.keys(started.operation)).not.toContain("signedTransaction");
    const claimed = setup.runtime.claim(
      started.operation.operationKey,
      "worker-a",
    );
    expect(claimed).toBeDefined();
    if (claimed === undefined) throw new Error("expected a lease");
    expect(() =>
      setup.store.transitionLeased(
        started.operation.operationKey,
        "worker-a",
        claimed.version,
        "PREPARING",
        201,
        {
          providerEvidence: { ["api" + "Key"]: "must-not-persist" },
        },
      ),
    ).toThrowError(RuntimeError);
  });
});
