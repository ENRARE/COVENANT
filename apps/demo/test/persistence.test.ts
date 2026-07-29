import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAuditEvent } from "../src/audit-events.js";
import { createLocalRuntimeStore } from "../src/storage/local-runtime-store.js";
import {
  createTestRoot,
  createTestRuntime,
  TEST_NOW,
  TEST_RUNTIME_ID,
} from "./helpers.js";

const expectedOrder = [
  "RUNTIME_INITIALIZED",
  "SCENARIO_SEEDED",
  "INVOICE_RECEIVED",
  "PAYMENT_INTENT_PROPOSED",
  "RULES_EVALUATED",
  "DECISION_APPROVED",
  "AUTHORIZATION_ISSUED",
  "EXECUTOR_REQUEST_PREPARED",
  "SIMULATION_ACCEPTED",
  "SUBMISSION_SIMULATED",
  "SCENARIO_COMPLETED",
  "INVOICE_RECEIVED",
  "PAYMENT_INTENT_PROPOSED",
  "RULES_EVALUATED",
  "DECISION_REJECTED",
  "SCENARIO_COMPLETED",
  "DEMO_COMPLETED",
];

describe("local runtime persistence", () => {
  it("seeds, runs exactly 17 events, replays, and resets idempotently", async () => {
    const fixture = await createTestRoot();
    try {
      const runtime = createTestRuntime(fixture.root);
      const before = await runtime.executeDemoAction("GET_HEALTH");
      expect(before.status).toBe("UNINITIALIZED");
      const seeded = await runtime.executeDemoAction("SEED");
      expect(seeded.status).toBe("SEEDED");
      expect((await runtime.executeDemoAction("SEED")).runtimeId).toBe(
        seeded.runtimeId,
      );
      const completed = await runtime.executeDemoAction("RUN_DEMO");
      expect(completed.status).toBe("COMPLETED");
      expect(completed.timeline.map(({ eventType }) => eventType)).toEqual(
        expectedOrder,
      );
      expect(completed.timeline.map(({ sequence }) => sequence)).toEqual(
        Array.from({ length: 17 }, (_, index) => (index + 1).toString()),
      );
      expect(completed.latestSubmission).toEqual({
        status: "SIMULATED_SUBMISSION",
        reference: "simulated-submission-0001",
      });
      expect(JSON.stringify(completed)).not.toMatch(
        /"(signature|typedData|calldata|privateKey|transactionHash|settlement|finality)"\s*:/i,
      );
      const replayed = await runtime.executeDemoAction("RUN_DEMO");
      expect(replayed).toEqual(completed);
      expect(Object.isFrozen(replayed)).toBe(true);
      expect(Object.isFrozen(replayed.timeline)).toBe(true);
      expect((await runtime.executeDemoAction("RESET")).status).toBe(
        "UNINITIALIZED",
      );
      expect((await runtime.executeDemoAction("RESET")).status).toBe(
        "UNINITIALIZED",
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("joins concurrent runs and performs composition once", async () => {
    const fixture = await createTestRoot();
    let calls = 0;
    try {
      const normal = createTestRuntime(fixture.root);
      await normal.executeDemoAction("SEED");
      const runtime = createTestRuntime(fixture.root, {
        runComposition: async (input) => {
          calls += 1;
          const { runFrozenComposition } =
            await import("../src/composition.js");
          await runFrozenComposition(input);
        },
      });
      const [first, second] = await Promise.all([
        runtime.executeDemoAction("RUN_DEMO"),
        runtime.executeDemoAction("RUN_DEMO"),
      ]);
      expect(first).toEqual(second);
      expect(calls).toBe(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails closed on interrupted and corrupt journals", async () => {
    const fixture = await createTestRoot();
    try {
      const runtime = createTestRuntime(fixture.root);
      await runtime.executeDemoAction("SEED");
      const journal = join(
        fixture.root,
        ".covenant-demo-state",
        "events.v1.jsonl",
      );
      const contents = await readFile(journal, "utf8");
      await writeFile(journal, contents.slice(0, -1), "utf8");
      await expect(
        runtime.executeDemoAction("GET_STATE"),
      ).rejects.toMatchObject({
        code: "STORAGE_CORRUPT",
      });
      await writeFile(journal, `${contents}{}\n`, "utf8");
      await expect(
        runtime.executeDemoAction("GET_STATE"),
      ).rejects.toMatchObject({
        code: "STORAGE_CORRUPT",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("requires reset after an interrupted cryptographic run", async () => {
    const fixture = await createTestRoot();
    try {
      const runtime = createTestRuntime(fixture.root, {
        runComposition: async ({ emit }) => {
          await emit({
            eventType: "INVOICE_RECEIVED",
            scenarioId: "happy-path-v1",
            fields: {
              invoiceId:
                "0x0303030303030303030303030303030303030303030303030303030303030303",
              amount: "1.25",
            },
          });
          throw new Error("dependency secret");
        },
      });
      await runtime.executeDemoAction("SEED");
      await expect(runtime.executeDemoAction("RUN_DEMO")).rejects.toMatchObject(
        {
          code: "RUNTIME_FAILURE",
        },
      );
      expect((await runtime.executeDemoAction("GET_STATE")).status).toBe(
        "INTERRUPTED",
      );
      await expect(runtime.executeDemoAction("RUN_DEMO")).rejects.toMatchObject(
        {
          code: "RUNTIME_INTERRUPTED",
        },
      );
      await expect(runtime.executeDemoAction("SEED")).rejects.toMatchObject({
        code: "RUNTIME_INTERRUPTED",
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("reports live and stale locks and takes ownership before stale reset deletion", async () => {
    const fixture = await createTestRoot();
    let observedOwnedLock = false;
    try {
      const runtime = createTestRuntime(fixture.root);
      const seeded = await runtime.executeDemoAction("SEED");
      const lock = join(
        fixture.root,
        ".covenant-demo-state",
        "runtime.v1.lock",
      );
      await writeFile(
        lock,
        JSON.stringify({
          schemaVersion: "1",
          runtimeId: seeded.runtimeId,
          pid: process.pid.toString(),
          createdAt: "2100000000",
        }),
        "utf8",
      );
      expect((await runtime.executeDemoAction("GET_HEALTH")).health.lock).toBe(
        "BUSY",
      );
      await expect(runtime.executeDemoAction("RESET")).rejects.toMatchObject({
        code: "LOCK_BUSY",
      });
      await writeFile(
        lock,
        JSON.stringify({
          schemaVersion: "1",
          runtimeId: seeded.runtimeId,
          pid: "2147483647",
          createdAt: "2100000000",
        }),
        "utf8",
      );
      expect((await runtime.executeDemoAction("GET_HEALTH")).health.lock).toBe(
        "STALE",
      );
      const resetRuntime = createTestRuntime(fixture.root, {
        storeHooks: {
          afterResetLockAcquired: async () => {
            observedOwnedLock = true;
            expect(
              (await runtime.executeDemoAction("GET_HEALTH")).health.lock,
            ).toBe("BUSY");
            expect(
              await readFile(
                join(fixture.root, ".covenant-demo-state", "events.v1.jsonl"),
                "utf8",
              ),
            ).not.toBe("");
          },
        },
      });
      expect((await resetRuntime.executeDemoAction("RESET")).status).toBe(
        "UNINITIALIZED",
      );
      expect(observedOwnedLock).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects malformed locks without removing them", async () => {
    const fixture = await createTestRoot();
    try {
      const runtime = createTestRuntime(fixture.root);
      await runtime.executeDemoAction("SEED");
      const lock = join(
        fixture.root,
        ".covenant-demo-state",
        "runtime.v1.lock",
      );
      await writeFile(lock, '{"pid":"secret"}', "utf8");
      await expect(
        runtime.executeDemoAction("GET_HEALTH"),
      ).rejects.toMatchObject({ code: "LOCK_MALFORMED" });
      await expect(runtime.executeDemoAction("RESET")).rejects.toMatchObject({
        code: "LOCK_MALFORMED",
      });
      expect(await readFile(lock, "utf8")).toBe('{"pid":"secret"}');
    } finally {
      await fixture.cleanup();
    }
  });

  it("blocks reset without journal changes while a run owns the live lock", async () => {
    const fixture = await createTestRoot();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    try {
      const seedRuntime = createTestRuntime(fixture.root);
      await seedRuntime.executeDemoAction("SEED");
      const journal = join(
        fixture.root,
        ".covenant-demo-state",
        "events.v1.jsonl",
      );
      const before = await readFile(journal, "utf8");
      const runRuntime = createTestRuntime(fixture.root, {
        runComposition: async (input) => {
          entered();
          await barrier;
          const { runFrozenComposition } =
            await import("../src/composition.js");
          await runFrozenComposition(input);
        },
      });
      const operation = runRuntime.executeDemoAction("RUN_DEMO");
      await started;
      await expect(
        seedRuntime.executeDemoAction("RESET"),
      ).rejects.toMatchObject({ code: "LOCK_BUSY" });
      expect(await readFile(journal, "utf8")).toBe(before);
      release();
      await expect(operation).resolves.toMatchObject({ status: "COMPLETED" });
    } finally {
      release();
      await fixture.cleanup();
    }
  });

  it("holds reset ownership against a seed from another runtime", async () => {
    const fixture = await createTestRoot();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const owned = new Promise<void>((resolve) => {
      entered = resolve;
    });
    try {
      const seedRuntime = createTestRuntime(fixture.root);
      await seedRuntime.executeDemoAction("SEED");
      const resetRuntime = createTestRuntime(fixture.root, {
        storeHooks: {
          afterResetLockAcquired: async () => {
            entered();
            await barrier;
          },
        },
      });
      const reset = resetRuntime.executeDemoAction("RESET");
      await owned;
      await expect(seedRuntime.executeDemoAction("SEED")).rejects.toMatchObject(
        {
          code: "LOCK_BUSY",
        },
      );
      release();
      await expect(reset).resolves.toMatchObject({ status: "UNINITIALIZED" });
      expect(await seedRuntime.executeDemoAction("GET_STATE")).toMatchObject({
        status: "UNINITIALIZED",
        timeline: [],
      });
    } finally {
      release();
      await fixture.cleanup();
    }
  });

  it("loses a stale takeover race without deleting the winning run", async () => {
    const fixture = await createTestRoot();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const running = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let run: Promise<unknown> | undefined;
    try {
      const runtime = createTestRuntime(fixture.root);
      const seeded = await runtime.executeDemoAction("SEED");
      const lock = join(
        fixture.root,
        ".covenant-demo-state",
        "runtime.v1.lock",
      );
      await writeFile(
        lock,
        JSON.stringify({
          schemaVersion: "1",
          runtimeId: seeded.runtimeId,
          pid: "2147483647",
          createdAt: TEST_NOW.toString(),
        }),
        "utf8",
      );
      const runRuntime = createTestRuntime(fixture.root, {
        runComposition: async (input) => {
          entered();
          await barrier;
          const { runFrozenComposition } =
            await import("../src/composition.js");
          await runFrozenComposition(input);
        },
      });
      const resetRuntime = createTestRuntime(fixture.root, {
        storeHooks: {
          afterStaleLockRemoved: async () => {
            run = runRuntime.executeDemoAction("RUN_DEMO");
            await running;
          },
        },
      });
      await expect(
        resetRuntime.executeDemoAction("RESET"),
      ).rejects.toMatchObject({ code: "LOCK_BUSY" });
      release();
      await expect(run).resolves.toMatchObject({ status: "COMPLETED" });
      expect((await runtime.executeDemoAction("GET_STATE")).status).toBe(
        "COMPLETED",
      );
    } finally {
      release();
      await fixture.cleanup();
    }
  });

  it("preserves replacement state created before final directory removal", async () => {
    const fixture = await createTestRoot();
    try {
      const runtime = createTestRuntime(fixture.root);
      await runtime.executeDemoAction("SEED");
      const replacementStore = createLocalRuntimeStore({
        repositoryRoot: fixture.root,
        now: () => TEST_NOW,
      });
      const resetRuntime = createTestRuntime(fixture.root, {
        storeHooks: {
          afterResetLockReleased: async () => {
            await replacementStore.mutate(null, async (session) => {
              await session.append(
                createAuditEvent({
                  runtimeId: TEST_RUNTIME_ID,
                  sequence: "1",
                  eventType: "RUNTIME_INITIALIZED",
                  occurredAt: TEST_NOW.toString(),
                }),
              );
              await session.append(
                createAuditEvent({
                  runtimeId: TEST_RUNTIME_ID,
                  sequence: "2",
                  eventType: "SCENARIO_SEEDED",
                  occurredAt: TEST_NOW.toString(),
                  fields: {
                    covenantId:
                      "0x0101010101010101010101010101010101010101010101010101010101010101",
                  },
                }),
              );
            });
          },
        },
      });
      await expect(
        resetRuntime.executeDemoAction("RESET"),
      ).rejects.toMatchObject({ code: "UNSAFE_STORAGE" });
      await expect(
        runtime.executeDemoAction("GET_STATE"),
      ).resolves.toMatchObject({
        status: "SEEDED",
        runtimeId: TEST_RUNTIME_ID,
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects unknown entries and link-based storage", async () => {
    const fixture = await createTestRoot();
    try {
      const directory = join(fixture.root, ".covenant-demo-state");
      await mkdir(directory);
      await writeFile(join(directory, "unknown.txt"), "unsafe", "utf8");
      await expect(
        createTestRuntime(fixture.root).executeDemoAction("GET_STATE"),
      ).rejects.toMatchObject({ code: "UNSAFE_STORAGE" });
    } finally {
      await fixture.cleanup();
    }

    const linked = await createTestRoot();
    const target = await createTestRoot();
    try {
      await symlink(
        target.root,
        join(linked.root, ".covenant-demo-state"),
        "junction",
      );
      await expect(
        createTestRuntime(linked.root).executeDemoAction("GET_STATE"),
      ).rejects.toMatchObject({ code: "UNSAFE_STORAGE" });
    } finally {
      await linked.cleanup();
      await target.cleanup();
    }
  });

  it("rejects sequence gaps and unknown event fields", async () => {
    const fixture = await createTestRoot();
    try {
      const runtime = createTestRuntime(fixture.root);
      await runtime.executeDemoAction("SEED");
      const journal = join(
        fixture.root,
        ".covenant-demo-state",
        "events.v1.jsonl",
      );
      const lines = (await readFile(journal, "utf8")).trimEnd().split("\n");
      const firstLine = lines[0];
      const secondLine = lines[1];
      if (firstLine === undefined || secondLine === undefined) {
        throw new Error("Expected seeded journal records");
      }
      const second = JSON.parse(secondLine) as Record<string, unknown>;
      second.sequence = "3";
      await writeFile(journal, `${firstLine}\n${JSON.stringify(second)}\n`);
      await expect(
        runtime.executeDemoAction("GET_STATE"),
      ).rejects.toMatchObject({
        code: "STORAGE_CORRUPT",
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
