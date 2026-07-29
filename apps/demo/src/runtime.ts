import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { parseDemoAction } from "./actions.js";
import {
  createAuditEvent,
  deterministicEventIdGenerator,
  type EventIdGenerator,
} from "./audit-events.js";
import { runFrozenComposition, type ScenarioEvent } from "./composition.js";
import { FROZEN_DEMO } from "./configuration.js";
import { DemoError, sanitizeDemoError } from "./errors.js";
import { projectRuntimeState } from "./projections.js";
import type { RuntimeProjection } from "./schemas.js";
import { createLocalRuntimeStore } from "./storage/local-runtime-store.js";
import type { RuntimeStore } from "./storage/runtime-store.js";

export type DemoActionResult = RuntimeProjection;

export type DemoRuntime = {
  executeDemoAction(...args: unknown[]): Promise<DemoActionResult>;
};

export type DemoRuntimeDependencies = Readonly<{
  store: RuntimeStore;
  now: () => bigint;
  createRuntimeId: () => unknown;
  eventIdGenerator?: EventIdGenerator;
  runComposition?: typeof runFrozenComposition;
}>;

function parseRuntimeId(value: unknown): string {
  if (typeof value !== "string" || !/^0x(?!0{64}$)[0-9a-f]{64}$/.test(value)) {
    throw new DemoError("RUNTIME_FAILURE");
  }
  return value;
}

export function createDemoRuntimeWithDependencies(
  dependencies: DemoRuntimeDependencies,
): DemoRuntime {
  let pendingRun: Promise<RuntimeProjection> | undefined;

  async function getState(): Promise<RuntimeProjection> {
    const snapshot = await dependencies.store.read();
    return projectRuntimeState(snapshot);
  }

  function occurredAt(): string {
    const value = dependencies.now();
    if (value <= 0n || value.toString().length > 20) {
      throw new DemoError("RUNTIME_FAILURE");
    }
    return value.toString();
  }

  async function seed(): Promise<RuntimeProjection> {
    const initial = await getState();
    if (initial.health.lock === "BUSY") throw new DemoError("LOCK_BUSY");
    if (initial.status === "SEEDED") return initial;
    if (initial.status === "COMPLETED")
      throw new DemoError("RUNTIME_COMPLETED");
    if (initial.status === "INTERRUPTED" || initial.status === "RUNNING")
      throw new DemoError("RUNTIME_INTERRUPTED");
    const runtimeId = parseRuntimeId(dependencies.createRuntimeId());
    await dependencies.store.mutate(null, async (session) => {
      if (session.timeline.length !== 0) {
        throw new DemoError("STORAGE_CORRUPT");
      }
      await session.append(
        createAuditEvent({
          runtimeId,
          sequence: "1",
          eventType: "RUNTIME_INITIALIZED",
          occurredAt: occurredAt(),
          ...(dependencies.eventIdGenerator === undefined
            ? {}
            : { eventIdGenerator: dependencies.eventIdGenerator }),
        }),
      );
      await session.append(
        createAuditEvent({
          runtimeId,
          sequence: "2",
          eventType: "SCENARIO_SEEDED",
          occurredAt: occurredAt(),
          fields: { covenantId: FROZEN_DEMO.covenantId },
          ...(dependencies.eventIdGenerator === undefined
            ? {}
            : { eventIdGenerator: dependencies.eventIdGenerator }),
        }),
      );
    });
    return getState();
  }

  async function run(): Promise<RuntimeProjection> {
    const before = await getState();
    if (before.status === "COMPLETED") return before;
    if (before.status === "UNINITIALIZED")
      throw new DemoError("RUNTIME_UNINITIALIZED");
    if (before.status !== "SEEDED" || before.runtimeId === null)
      throw new DemoError("RUNTIME_INTERRUPTED");
    const runtimeId = before.runtimeId;
    const runComposition = dependencies.runComposition ?? runFrozenComposition;
    await dependencies.store.mutate(runtimeId, async (session) => {
      if (
        session.timeline.length !== 2 ||
        session.timeline[0]?.runtimeId !== runtimeId
      ) {
        throw new DemoError("RUNTIME_INTERRUPTED");
      }
      const emit = async (event: ScenarioEvent) => {
        await session.append(
          createAuditEvent({
            runtimeId,
            sequence: (session.timeline.length + 1).toString(),
            eventType: event.eventType,
            scenarioId: event.scenarioId,
            occurredAt: occurredAt(),
            fields: event.fields,
            ...(dependencies.eventIdGenerator === undefined
              ? {}
              : { eventIdGenerator: dependencies.eventIdGenerator }),
          }),
        );
      };
      try {
        await runComposition({
          now: dependencies.now(),
          emit,
        });
      } catch (error) {
        if (error instanceof DemoError) throw error;
        throw new DemoError("RUNTIME_FAILURE");
      }
      await session.append(
        createAuditEvent({
          runtimeId,
          sequence: "17",
          eventType: "DEMO_COMPLETED",
          occurredAt: occurredAt(),
          fields: { covenantId: FROZEN_DEMO.covenantId },
          ...(dependencies.eventIdGenerator === undefined
            ? {}
            : { eventIdGenerator: dependencies.eventIdGenerator }),
        }),
      );
    });
    return getState();
  }

  async function executeDemoAction(
    ...args: unknown[]
  ): Promise<RuntimeProjection> {
    try {
      if (args.length !== 1) throw new DemoError("MALFORMED_ACTION");
      const parsed = parseDemoAction(args[0]);
      if (parsed === "RESET") {
        await dependencies.store.reset();
        return await getState();
      }
      if (parsed === "SEED") return await seed();
      if (parsed === "GET_HEALTH" || parsed === "GET_STATE")
        return await getState();
      pendingRun ??= run().finally(() => {
        pendingRun = undefined;
      });
      return await pendingRun;
    } catch (error) {
      throw sanitizeDemoError(error);
    }
  }

  return { executeDemoAction };
}

export function createDemoRuntime(): DemoRuntime {
  const now = () => BigInt(Math.floor(Date.now() / 1000));
  return createDemoRuntimeWithDependencies({
    store: createLocalRuntimeStore({
      repositoryRoot: resolve(process.cwd()),
      now,
    }),
    now,
    createRuntimeId: () => `0x${randomBytes(32).toString("hex")}`,
    eventIdGenerator: deterministicEventIdGenerator,
  });
}
