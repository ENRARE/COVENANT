import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rmdir,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { TextDecoder } from "node:util";
import { createAuditEvent, parseAndFreezeEvent } from "../audit-events.js";
import { DemoError } from "../errors.js";
import {
  auditEventSchema,
  lockMetadataSchema,
  type AuditEvent,
  type LockMetadata,
} from "../schemas.js";
import type {
  JournalSnapshot,
  LockState,
  MutationSession,
  RuntimeStore,
} from "./runtime-store.js";

const RUNTIME_DIRECTORY = ".covenant-demo-state";
const JOURNAL_FILE = "events.v1.jsonl";
const LOCK_FILE = "runtime.v1.lock";
const ALLOWED_ENTRIES = new Set([JOURNAL_FILE, LOCK_FILE]);

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

type Kind = "missing" | "directory" | "file" | "symlink" | "other";

async function kind(path: string): Promise<Kind> {
  try {
    const status = await lstat(path);
    if (status.isSymbolicLink()) return "symlink";
    if (status.isDirectory()) return "directory";
    if (status.isFile()) return "file";
    return "other";
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return "missing";
    }
    throw error;
  }
}

function processIsLive(pid: string): boolean {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EPERM"
    );
  }
}

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

async function validateRepositoryRoot(root: string): Promise<void> {
  if (resolve(root) !== root || basename(root).length === 0) {
    throw new DemoError("INVALID_REPOSITORY_ROOT");
  }
  const packagePath = join(root, "package.json");
  const workspacePath = join(root, "pnpm-workspace.yaml");
  if (
    (await kind(packagePath)) !== "file" ||
    (await kind(workspacePath)) !== "file"
  ) {
    throw new DemoError("INVALID_REPOSITORY_ROOT");
  }
  try {
    const parsed = JSON.parse(await readFile(packagePath, "utf8")) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("name" in parsed) ||
      parsed.name !== "covenant"
    ) {
      throw new Error("wrong package marker");
    }
  } catch (error) {
    if (error instanceof DemoError) throw error;
    throw new DemoError("INVALID_REPOSITORY_ROOT");
  }
}

export type LocalRuntimeStoreOptions = Readonly<{
  repositoryRoot: string;
  now: () => bigint;
}>;

export function createLocalRuntimeStore(
  options: LocalRuntimeStoreOptions,
): RuntimeStore {
  const repositoryRoot = resolve(options.repositoryRoot);
  const directory = join(repositoryRoot, RUNTIME_DIRECTORY);
  const journalPath = join(directory, JOURNAL_FILE);
  const lockPath = join(directory, LOCK_FILE);

  async function inspectDirectory(allowMissing: boolean): Promise<Kind> {
    await validateRepositoryRoot(repositoryRoot);
    const directoryKind = await kind(directory);
    if (directoryKind === "missing" && allowMissing) return directoryKind;
    if (directoryKind !== "directory") throw new DemoError("UNSAFE_STORAGE");
    const entries = await readdir(directory);
    if (entries.some((entry) => !ALLOWED_ENTRIES.has(entry))) {
      throw new DemoError("UNSAFE_STORAGE");
    }
    for (const entry of entries) {
      if ((await kind(join(directory, entry))) !== "file") {
        throw new DemoError("UNSAFE_STORAGE");
      }
    }
    return directoryKind;
  }

  async function readLock(): Promise<{
    state: LockState;
    metadata?: LockMetadata;
    bytes?: string;
  }> {
    const lockKind = await kind(lockPath);
    if (lockKind === "missing") return { state: "AVAILABLE" };
    if (lockKind !== "file") throw new DemoError("UNSAFE_STORAGE");
    let bytes: string;
    let metadata: LockMetadata;
    try {
      bytes = await readFile(lockPath, "utf8");
      metadata = lockMetadataSchema.parse(JSON.parse(bytes) as unknown);
    } catch {
      throw new DemoError("LOCK_MALFORMED");
    }
    return {
      state: processIsLive(metadata.pid) ? "BUSY" : "STALE",
      metadata,
      bytes,
    };
  }

  async function read(): Promise<JournalSnapshot> {
    try {
      if ((await inspectDirectory(true)) === "missing") {
        return Object.freeze({
          timeline: Object.freeze([]),
          lock: "AVAILABLE",
        });
      }
      const lock = await readLock();
      const journalKind = await kind(journalPath);
      if (journalKind === "missing") {
        if (lock.state === "BUSY") {
          return Object.freeze({
            timeline: Object.freeze([]),
            lock: lock.state,
          });
        }
        throw new DemoError("STORAGE_CORRUPT");
      }
      if (journalKind !== "file") throw new DemoError("UNSAFE_STORAGE");
      const timeline = replayJournal(await readFile(journalPath));
      return Object.freeze({ timeline, lock: lock.state });
    } catch (error) {
      if (error instanceof DemoError) throw error;
      throw new DemoError("STORAGE_CORRUPT");
    }
  }

  async function mutate<T>(
    runtimeId: string | null,
    operation: (session: MutationSession) => Promise<T>,
  ): Promise<T> {
    let lockHandle: FileHandle | undefined;
    try {
      await validateRepositoryRoot(repositoryRoot);
      const directoryKind = await kind(directory);
      if (directoryKind === "missing") {
        await mkdir(directory, { mode: 0o700 });
      } else {
        await inspectDirectory(false);
      }
      if ((await kind(lockPath)) !== "missing") {
        await readLock();
        throw new DemoError("LOCK_BUSY");
      }
      lockHandle = await open(lockPath, "wx", 0o600);
      const lockMetadata = lockMetadataSchema.parse({
        schemaVersion: "1",
        runtimeId,
        pid: process.pid.toString(),
        createdAt: options.now().toString(),
      });
      await lockHandle.writeFile(JSON.stringify(lockMetadata), "utf8");
      await lockHandle.sync();

      let timeline: AuditEvent[] = [];
      const journalKind = await kind(journalPath);
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
    } catch (error) {
      if (error instanceof DemoError) throw error;
      throw new DemoError("STORAGE_FAILURE");
    } finally {
      if (lockHandle !== undefined) {
        await lockHandle.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
      }
    }
  }

  async function reset(): Promise<void> {
    try {
      if ((await inspectDirectory(true)) === "missing") return;
      const lock = await readLock();
      if (lock.state === "BUSY") throw new DemoError("LOCK_BUSY");
      if (lock.state === "STALE") {
        if (lock.bytes === undefined || lock.metadata === undefined) {
          throw new DemoError("LOCK_MALFORMED");
        }
        const secondBytes = await readFile(lockPath, "utf8");
        const secondMetadata = lockMetadataSchema.parse(
          JSON.parse(secondBytes) as unknown,
        );
        if (
          secondBytes !== lock.bytes ||
          processIsLive(secondMetadata.pid) ||
          (await kind(lockPath)) !== "file"
        ) {
          throw new DemoError("LOCK_BUSY");
        }
        await unlink(lockPath);
      }
      if ((await kind(journalPath)) === "file") await unlink(journalPath);
      else if ((await kind(journalPath)) !== "missing")
        throw new DemoError("UNSAFE_STORAGE");
      const entries = await readdir(directory);
      if (entries.length !== 0) throw new DemoError("UNSAFE_STORAGE");
      await rmdir(directory);
    } catch (error) {
      if (error instanceof DemoError) throw error;
      throw new DemoError("STORAGE_FAILURE");
    }
  }

  return { read, mutate, reset };
}
