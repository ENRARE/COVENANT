import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Hex } from "viem";
import { ExecutorError } from "../errors.js";
import { parseCircleOperationRecord, parseCircleUuidV4 } from "./schemas.js";
import type {
  CircleExecutionFingerprint,
  CircleOperationRecord,
  CircleOperationRepository,
  CircleTransactionState,
} from "./types.js";
import { z } from "zod";

const FORMAT_VERSION = "1";
const DEFAULT_FILE_NAME = "circle-operations.v1.jsonl";
const DECIMAL = /^(0|[1-9]\d*)$/;
const DIGEST = /^0x[0-9a-f]{64}$/;

const journalRecordSchema = z
  .object({
    formatVersion: z.literal(FORMAT_VERSION),
    recordType: z.literal("STATE"),
    sequence: z.string().regex(DECIMAL),
    previousRecordDigest: z.string().regex(DIGEST).nullable(),
    operation: z.unknown(),
    recordDigest: z.string().regex(DIGEST),
  })
  .strict();

export type DurableCircleOperationRepository = CircleOperationRepository & {
  close(): Promise<void>;
};

export type DurableCircleOperationRepositoryOptions = Readonly<{
  directory: string;
  fileName?: string;
}>;

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  throw new Error("Unsupported journal value");
}

function digest(value: unknown): string {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function existingKind(
  path: string,
): Promise<"missing" | "directory" | "file" | "symlink"> {
  return lstat(path)
    .then((status) => {
      if (status.isSymbolicLink()) return "symlink";
      if (status.isDirectory()) return "directory";
      return "file";
    })
    .catch((error: unknown) => {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return "missing";
      }
      throw error;
    });
}

function failInitialization(): never {
  throw new ExecutorError("EXECUTION_REPOSITORY_FAILURE");
}

function failPersistence(): never {
  throw new ExecutorError("EXECUTION_REPOSITORY_FAILURE");
}

function paths(options: DurableCircleOperationRepositoryOptions): {
  directory: string;
  journalPath: string;
  lockPath: string;
} {
  if (
    typeof options.directory !== "string" ||
    options.directory.length === 0 ||
    options.directory.includes("\0")
  ) {
    failInitialization();
  }
  const directory = resolve(options.directory);
  const fileName = options.fileName ?? DEFAULT_FILE_NAME;
  if (
    fileName.length === 0 ||
    fileName.includes("\0") ||
    basename(fileName) !== fileName ||
    fileName === "." ||
    fileName === ".."
  ) {
    failInitialization();
  }
  return {
    directory,
    journalPath: join(directory, fileName),
    lockPath: join(directory, `${fileName}.lock`),
  };
}

function parseJournal(contents: Uint8Array): {
  records: Map<Hex, CircleOperationRecord>;
  lastDigest: string | null;
  nextSequence: bigint;
} {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(contents);
  if (text.length === 0) {
    return { records: new Map(), lastDigest: null, nextSequence: 0n };
  }
  if (!text.endsWith("\n")) throw new Error("Truncated operation journal");
  const records = new Map<Hex, CircleOperationRecord>();
  const uuidOwners = new Map<string, Hex>();
  let lastDigest: string | null = null;
  let nextSequence = 0n;
  for (const line of text.slice(0, -1).split("\n")) {
    if (line.length === 0) throw new Error("Empty operation journal record");
    const parsed = journalRecordSchema.parse(JSON.parse(line) as unknown);
    if (BigInt(parsed.sequence) !== nextSequence) {
      throw new Error("Operation journal sequence is invalid");
    }
    if (parsed.previousRecordDigest !== lastDigest) {
      throw new Error("Operation journal chain is invalid");
    }
    const operation = parseCircleOperationRecord(parsed.operation);
    if (
      digest({
        formatVersion: parsed.formatVersion,
        recordType: parsed.recordType,
        sequence: parsed.sequence,
        previousRecordDigest: parsed.previousRecordDigest,
        operation,
      }) !== parsed.recordDigest
    ) {
      throw new Error("Operation journal digest is invalid");
    }
    const previous = records.get(operation.fingerprint.operationKey);
    if (previous !== undefined) {
      if (
        !isDeepStrictEqual(previous.fingerprint, operation.fingerprint) ||
        previous.idempotencyKey !== operation.idempotencyKey ||
        (previous.state === "ACCEPTED" &&
          (!isDeepStrictEqual(previous, operation) ||
            operation.state !== "ACCEPTED")) ||
        (previous.state === "UNKNOWN" && operation.state !== "UNKNOWN") ||
        (previous.state === "SUBMISSION_ATTEMPT_STARTED" &&
          operation.state === "PREPARED")
      ) {
        throw new Error("Operation journal transition conflicts");
      }
    } else if (operation.state !== "PREPARED") {
      throw new Error("Operation journal starts after preparation");
    }
    const uuidOwner = uuidOwners.get(operation.idempotencyKey);
    if (
      uuidOwner !== undefined &&
      uuidOwner !== operation.fingerprint.operationKey
    ) {
      throw new Error("Operation journal UUID conflicts");
    }
    uuidOwners.set(
      operation.idempotencyKey,
      operation.fingerprint.operationKey,
    );
    records.set(operation.fingerprint.operationKey, operation);
    lastDigest = parsed.recordDigest;
    nextSequence += 1n;
  }
  return { records, lastDigest, nextSequence };
}

class DurableRepository implements DurableCircleOperationRepository {
  readonly #journalPath: string;
  readonly #lockPath: string;
  readonly #lockHandle: FileHandle;
  readonly #records: Map<Hex, CircleOperationRecord>;
  #lastDigest: string | null;
  #nextSequence: bigint;
  #writeTail: Promise<void> = Promise.resolve();
  #closed = false;
  #closing = false;
  #faulted = false;
  #closePromise: Promise<void> | undefined;
  readonly #shutdown: () => void;

  constructor(input: {
    journalPath: string;
    lockPath: string;
    lockHandle: FileHandle;
    records: Map<Hex, CircleOperationRecord>;
    lastDigest: string | null;
    nextSequence: bigint;
  }) {
    this.#journalPath = input.journalPath;
    this.#lockPath = input.lockPath;
    this.#lockHandle = input.lockHandle;
    this.#records = input.records;
    this.#lastDigest = input.lastDigest;
    this.#nextSequence = input.nextSequence;
    this.#shutdown = () => {
      void this.close().catch(() => undefined);
    };
    process.once("beforeExit", this.#shutdown);
  }

  #assertOpen(): void {
    if (this.#closed || this.#closing) {
      throw new ExecutorError("EXECUTION_REPOSITORY_FAILURE");
    }
    if (this.#faulted) failPersistence();
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.#assertOpen();
    const result = this.#writeTail.then(operation);
    this.#writeTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #append(operation: CircleOperationRecord): Promise<void> {
    const unsigned = {
      formatVersion: FORMAT_VERSION,
      recordType: "STATE",
      sequence: this.#nextSequence.toString(),
      previousRecordDigest: this.#lastDigest,
      operation: clone(operation),
    } as const;
    const record = { ...unsigned, recordDigest: digest(unsigned) };
    let handle: FileHandle | undefined;
    try {
      if ((await existingKind(this.#journalPath)) !== "file") failPersistence();
      handle = await open(this.#journalPath, "a", 0o600);
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      this.#lastDigest = record.recordDigest;
      this.#nextSequence += 1n;
    } catch {
      this.#faulted = true;
      await handle?.close().catch(() => undefined);
      failPersistence();
    }
  }

  get(operationKey: Hex): Promise<unknown> {
    this.#assertOpen();
    const record = this.#records.get(operationKey);
    return Promise.resolve(record === undefined ? undefined : clone(record));
  }

  prepare(
    fingerprint: CircleExecutionFingerprint,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.#enqueue(async () => {
      const uuid = parseCircleUuidV4(idempotencyKey);
      const existing = this.#records.get(fingerprint.operationKey);
      if (existing !== undefined) {
        if (!isDeepStrictEqual(existing.fingerprint, fingerprint)) {
          throw new ExecutorError("EXECUTION_CONFLICT");
        }
        return clone(existing);
      }
      for (const existingRecord of this.#records.values()) {
        if (existingRecord.idempotencyKey === uuid) {
          throw new ExecutorError("EXECUTION_CONFLICT");
        }
      }
      const next = Object.freeze({
        fingerprint: Object.freeze({ ...fingerprint }),
        idempotencyKey: uuid,
        state: "PREPARED",
        attemptCount: 0,
      }) satisfies CircleOperationRecord;
      await this.#append(next);
      this.#records.set(fingerprint.operationKey, next);
      return clone(next);
    });
  }

  markSubmissionAttemptStarted(
    operationKey: Hex,
    expectedIdempotencyKey: string,
  ): Promise<unknown> {
    return this.#enqueue(async () => {
      const current = this.#required(operationKey, expectedIdempotencyKey);
      if (current.state !== "PREPARED") {
        throw new ExecutorError("EXECUTION_NOT_RETRYABLE");
      }
      const next = Object.freeze({
        ...current,
        state: "SUBMISSION_ATTEMPT_STARTED",
        attemptCount: 1,
      }) satisfies CircleOperationRecord;
      await this.#append(next);
      this.#records.set(operationKey, next);
      return clone(next);
    });
  }

  recordAccepted(
    operationKey: Hex,
    expectedIdempotencyKey: string,
    providerTransactionId: string,
    providerState: CircleTransactionState,
  ): Promise<unknown> {
    return this.#enqueue(async () => {
      const current = this.#required(operationKey, expectedIdempotencyKey);
      if (current.state === "ACCEPTED") {
        if (
          current.providerTransactionId !== providerTransactionId ||
          current.providerState !== providerState
        ) {
          throw new ExecutorError("EXECUTION_CONFLICT");
        }
        return clone(current);
      }
      if (current.state !== "SUBMISSION_ATTEMPT_STARTED") {
        throw new ExecutorError("EXECUTION_CONFLICT");
      }
      const next = Object.freeze({
        ...current,
        state: "ACCEPTED",
        providerTransactionId,
        providerState,
      }) satisfies CircleOperationRecord;
      await this.#append(next);
      this.#records.set(operationKey, next);
      return clone(next);
    });
  }

  recordUnknown(
    operationKey: Hex,
    expectedIdempotencyKey: string,
  ): Promise<unknown> {
    return this.#enqueue(async () => {
      const current = this.#required(operationKey, expectedIdempotencyKey);
      if (current.state === "ACCEPTED" || current.state === "UNKNOWN") {
        return clone(current);
      }
      if (current.state !== "SUBMISSION_ATTEMPT_STARTED") {
        throw new ExecutorError("EXECUTION_CONFLICT");
      }
      const next = Object.freeze({
        ...current,
        state: "UNKNOWN",
        attemptCount: 1,
      }) satisfies CircleOperationRecord;
      await this.#append(next);
      this.#records.set(operationKey, next);
      return clone(next);
    });
  }

  #required(operationKey: Hex, idempotencyKey: string): CircleOperationRecord {
    const current = this.#records.get(operationKey);
    if (current?.idempotencyKey !== idempotencyKey) {
      throw new ExecutorError("EXECUTION_CONFLICT");
    }
    return current;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closePromise ??= (async () => {
      this.#closing = true;
      process.removeListener("beforeExit", this.#shutdown);
      try {
        await this.#writeTail;
        await this.#lockHandle.close();
        await unlink(this.#lockPath);
        this.#closed = true;
      } catch {
        throw new ExecutorError("EXECUTION_REPOSITORY_FAILURE");
      } finally {
        this.#closing = false;
      }
    })();
    await this.#closePromise;
  }
}

export async function createDurableCircleOperationRepository(
  options: DurableCircleOperationRepositoryOptions,
): Promise<DurableCircleOperationRepository> {
  let lockHandle: FileHandle | undefined;
  let lockPath: string | undefined;
  let createdLock = false;
  try {
    const configured = paths(options);
    lockPath = configured.lockPath;
    const directoryKind = await existingKind(configured.directory);
    if (directoryKind === "missing") {
      await mkdir(configured.directory, { recursive: true, mode: 0o700 });
    } else if (directoryKind !== "directory") {
      failInitialization();
    }
    const journalKind = await existingKind(configured.journalPath);
    const lockKind = await existingKind(configured.lockPath);
    if (
      journalKind === "directory" ||
      journalKind === "symlink" ||
      lockKind !== "missing"
    ) {
      failInitialization();
    }
    lockHandle = await open(configured.lockPath, "wx", 0o600);
    createdLock = true;
    await lockHandle.writeFile(
      JSON.stringify({
        formatVersion: FORMAT_VERSION,
        processId: process.pid.toString(),
      }),
      "utf8",
    );
    await lockHandle.sync();
    if (journalKind === "missing") {
      const journalHandle = await open(configured.journalPath, "wx", 0o600);
      await journalHandle.sync();
      await journalHandle.close();
    }
    if ((await existingKind(configured.journalPath)) !== "file")
      failInitialization();
    const replayed = parseJournal(await readFile(configured.journalPath));
    return new DurableRepository({
      journalPath: configured.journalPath,
      lockPath: configured.lockPath,
      lockHandle,
      records: replayed.records,
      lastDigest: replayed.lastDigest,
      nextSequence: replayed.nextSequence,
    });
  } catch {
    await lockHandle?.close().catch(() => undefined);
    if (createdLock && lockPath !== undefined)
      await unlink(lockPath).catch(() => undefined);
    failInitialization();
  }
}
