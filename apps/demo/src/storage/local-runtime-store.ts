import {
  mkdir,
  open,
  readFile,
  readdir,
  rmdir,
  unlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { TextDecoder } from "node:util";
import { createAuditEvent, parseAndFreezeEvent } from "../audit-events.js";
import { DemoError } from "../errors.js";
import { auditEventSchema, type AuditEvent } from "../schemas.js";
import type {
  JournalSnapshot,
  MutationSession,
  RuntimeStore,
} from "./runtime-store.js";
import {
  pathKind,
  validateRepositoryRoot,
  type PathKind,
} from "./repository-root.js";
import {
  createRuntimeMutex,
  type RuntimeMutexTestHooks,
} from "./runtime-mutex.js";

const RUNTIME_DIRECTORY = ".covenant-demo-state";
const JOURNAL_FILE = "events.v1.jsonl";
const ALLOWED_ENTRIES = new Set([JOURNAL_FILE]);

const EXPECTED_ORDER = [
  ["RUNTIME_INITIALIZED", ""],
  ["SCENARIO_SEEDED", ""],
  ["INVOICE_RECEIVED", "happy-path-v1"],
  ["PAYMENT_INTENT_PROPOSED", "happy-path-v1"],
  ["RULES_EVALUATED", "happy-path-v1"],
  ["DECISION_APPROVED", "happy-path-v1"],
  ["AUTHORIZATION_ISSUED", "happy-path-v1"],
  ["EXECUTOR_REQUEST_PREPARED", "happy-path-v1"],
  ["SIMULATION_ACCEPTED", "happy-path-v1"],
  ["SUBMISSION_SIMULATED", "happy-path-v1"],
  ["SCENARIO_COMPLETED", "happy-path-v1"],
  ["INVOICE_RECEIVED", "compromised-proposer-v1"],
  ["PAYMENT_INTENT_PROPOSED", "compromised-proposer-v1"],
  ["RULES_EVALUATED", "compromised-proposer-v1"],
  ["DECISION_REJECTED", "compromised-proposer-v1"],
  ["SCENARIO_COMPLETED", "compromised-proposer-v1"],
  ["DEMO_COMPLETED", ""],
] as const;

function validateTimeline(events: readonly AuditEvent[]): void {
  if (events.length > EXPECTED_ORDER.length) throw new Error("too many events");
  const eventIds = new Set<string>();
  let runtimeId: string | undefined;
  for (const [index, event] of events.entries()) {
    const expected = EXPECTED_ORDER[index];
    const scenarioId = "scenarioId" in event ? event.scenarioId : undefined;
    if (
      event.eventType !== expected?.[0] ||
      (scenarioId ?? "") !== expected[1] ||
      event.sequence !== (index + 1).toString() ||
      eventIds.has(event.eventId)
    ) {
      throw new Error("illegal event transition");
    }
    runtimeId ??= event.runtimeId;
    if (event.runtimeId !== runtimeId) throw new Error("wrong runtime");
    const expectedId = createAuditEvent({
      runtimeId: event.runtimeId,
      sequence: event.sequence,
      eventType: event.eventType,
      ...(scenarioId === undefined ? {} : { scenarioId }),
      occurredAt: event.occurredAt,
      fields: Object.fromEntries(
        Object.entries(event).filter(
          ([key]) =>
            ![
              "schemaVersion",
              "runtimeId",
              "eventId",
              "sequence",
              "eventType",
              "occurredAt",
              "scenarioId",
            ].includes(key),
        ),
      ),
    }).eventId;
    if (event.eventId !== expectedId) throw new Error("wrong event id");
    eventIds.add(event.eventId);
  }
}

function replayJournal(contents: Uint8Array): readonly AuditEvent[] {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(contents);
  if (text.length === 0) return Object.freeze([]);
  if (!text.endsWith("\n")) throw new Error("truncated journal");
  const events = text
    .slice(0, -1)
    .split("\n")
    .map((line) => {
      if (line.length === 0) throw new Error("empty record");
      return parseAndFreezeEvent(JSON.parse(line) as unknown);
    });
  validateTimeline(events);
  return Object.freeze(events);
}

export type LocalRuntimeStoreOptions = Readonly<{
  repositoryRoot: string;
  testHooks?: Readonly<{
    afterExclusiveLockAcquired?(): Promise<void>;
    beforeJournalDeletion?(): Promise<void>;
    beforeLockRelease?(): Promise<void>;
  }> &
    RuntimeMutexTestHooks;
}>;

export function createLocalRuntimeStore(
  options: LocalRuntimeStoreOptions,
): RuntimeStore {
  const repositoryRoot = resolve(options.repositoryRoot);
  const directory = join(repositoryRoot, RUNTIME_DIRECTORY);
  const journalPath = join(directory, JOURNAL_FILE);
  const mutex = createRuntimeMutex({
    repositoryRoot,
    ...(options.testHooks?.afterSentinelOpened === undefined
      ? {}
      : {
          testHooks: {
            afterSentinelOpened: options.testHooks.afterSentinelOpened,
          },
        }),
  });

  async function inspectDirectory(allowMissing: boolean): Promise<PathKind> {
    await validateRepositoryRoot(repositoryRoot);
    const directoryKind = await pathKind(directory);
    if (directoryKind === "missing" && allowMissing) return directoryKind;
    if (directoryKind !== "directory") throw new DemoError("UNSAFE_STORAGE");
    const entries = await readdir(directory);
    if (entries.some((entry) => !ALLOWED_ENTRIES.has(entry))) {
      throw new DemoError("UNSAFE_STORAGE");
    }
    for (const entry of entries) {
      if ((await pathKind(join(directory, entry))) !== "file") {
        throw new DemoError("UNSAFE_STORAGE");
      }
    }
    return directoryKind;
  }

  async function readJournal(): Promise<JournalSnapshot> {
    if ((await inspectDirectory(true)) === "missing") {
      return Object.freeze({
        timeline: Object.freeze([]),
        lock: "AVAILABLE",
      });
    }
    const journalKind = await pathKind(journalPath);
    if (journalKind === "missing") throw new DemoError("STORAGE_CORRUPT");
    if (journalKind !== "file") throw new DemoError("UNSAFE_STORAGE");
    const timeline = replayJournal(await readFile(journalPath));
    return Object.freeze({ timeline, lock: "AVAILABLE" });
  }

  async function withExclusiveLock<T>(operation: () => Promise<T>): Promise<T> {
    const lease = await mutex.acquireExclusive();
    try {
      await options.testHooks?.afterExclusiveLockAcquired?.();
      return await operation();
    } finally {
      try {
        await options.testHooks?.beforeLockRelease?.();
      } finally {
        await lease.release();
      }
    }
  }

  async function read(): Promise<JournalSnapshot> {
    let lease: Awaited<ReturnType<typeof mutex.acquireShared>> | undefined;
    try {
      lease = await mutex.acquireShared();
      return await readJournal();
    } catch (error) {
      if (error instanceof DemoError) throw error;
      throw new DemoError("STORAGE_CORRUPT");
    } finally {
      await lease?.release();
    }
  }

  async function health(): Promise<JournalSnapshot> {
    try {
      return await withExclusiveLock(readJournal);
    } catch (error) {
      if (error instanceof DemoError && error.code === "LOCK_BUSY") {
        return Object.freeze({
          timeline: Object.freeze([]),
          lock: "BUSY",
        });
      }
      throw error;
    }
  }

  async function mutate<T>(
    operation: (session: MutationSession) => Promise<T>,
  ): Promise<T> {
    try {
      return await withExclusiveLock(async () => {
        await validateRepositoryRoot(repositoryRoot);
        const directoryKind = await pathKind(directory);
        if (directoryKind === "missing") {
          await mkdir(directory, { mode: 0o700 });
        } else {
          await inspectDirectory(false);
        }
        let timeline: AuditEvent[] = [];
        const journalKind = await pathKind(journalPath);
        if (journalKind === "missing") {
          const journal = await open(journalPath, "wx", 0o600);
          await journal.sync();
          await journal.close();
        } else if (journalKind !== "file") {
          throw new DemoError("UNSAFE_STORAGE");
        } else {
          timeline = [...replayJournal(await readFile(journalPath))];
        }

        let writeTail = Promise.resolve();
        const session: MutationSession = {
          get timeline() {
            return Object.freeze(timeline.map((event) => event));
          },
          append(event) {
            const parsed = auditEventSchema.parse(event);
            const next = [...timeline, parsed];
            validateTimeline(next);
            const operation = writeTail.then(async () => {
              const handle = await open(journalPath, "a", 0o600);
              try {
                await handle.writeFile(`${JSON.stringify(parsed)}\n`, "utf8");
                await handle.sync();
              } finally {
                await handle.close();
              }
              timeline = next;
            });
            writeTail = operation.then(
              () => undefined,
              () => undefined,
            );
            return operation;
          },
        };
        const result = await operation(session);
        await writeTail;
        return result;
      });
    } catch (error) {
      if (error instanceof DemoError) throw error;
      throw new DemoError("STORAGE_FAILURE");
    }
  }

  async function reset(): Promise<void> {
    try {
      await withExclusiveLock(async () => {
        if ((await inspectDirectory(true)) === "missing") return;
        await options.testHooks?.beforeJournalDeletion?.();
        if ((await pathKind(journalPath)) === "file") await unlink(journalPath);
        else if ((await pathKind(journalPath)) !== "missing")
          throw new DemoError("UNSAFE_STORAGE");
        const entries = await readdir(directory);
        if (entries.length !== 0) throw new DemoError("UNSAFE_STORAGE");
        await rmdir(directory);
        if ((await pathKind(directory)) !== "missing") {
          throw new DemoError("UNSAFE_STORAGE");
        }
      });
    } catch (error) {
      if (error instanceof DemoError) throw error;
      throw new DemoError("STORAGE_FAILURE");
    }
  }

  return { read, health, mutate, reset };
}
