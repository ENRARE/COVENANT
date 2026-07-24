import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import {
  formatUsdc,
  nonzeroBytes32Schema,
  paymentIntentSchema,
} from "@covenant/spec";
import { z } from "zod";
import { AgentError } from "./errors.js";
import type { ProposalReservationRepository } from "./ports.js";
import { parseCompletedResult, parseReservation } from "./schemas.js";
import type { AgentProposalResult, ProposalReservation } from "./types.js";

const FORMAT_VERSION = "1";
const DEFAULT_FILE_NAME = "proposals.v1.jsonl";
const DECIMAL_STRING = /^(0|[1-9]\d*)$/;
const DIGEST = /^0x[0-9a-f]{64}$/;

const reservedRecordSchema = z
  .object({
    formatVersion: z.literal(FORMAT_VERSION),
    recordType: z.literal("RESERVED"),
    proposalIdentity: nonzeroBytes32Schema,
    intentId: z.string(),
    nonce: z.string().regex(DECIMAL_STRING),
    rawPaymentIntentPayload: z.unknown(),
    createdAt: z.string().regex(DECIMAL_STRING),
    recordDigest: z.string().regex(DIGEST),
  })
  .strict();

const completedRecordSchema = z
  .object({
    formatVersion: z.literal(FORMAT_VERSION),
    recordType: z.literal("COMPLETED"),
    proposalIdentity: nonzeroBytes32Schema,
    completedResult: z.unknown(),
    createdAt: z.string().regex(DECIMAL_STRING),
    previousRecordDigest: z.string().regex(DIGEST),
    recordDigest: z.string().regex(DIGEST),
  })
  .strict();

type ReservedRecord = z.infer<typeof reservedRecordSchema>;
type CompletedRecord = z.infer<typeof completedRecordSchema>;
type JournalRecord = ReservedRecord | CompletedRecord;

type DurableState = {
  reservation: ProposalReservation;
  reservationDigest: string;
};

export type DurableProposalReservationRepository =
  ProposalReservationRepository & {
    close(): Promise<void>;
  };

export type DurableProposalReservationRepositoryOptions = Readonly<{
  directory: string;
  fileName?: string;
}>;

function failInitialization(): never {
  throw new AgentError("DURABLE_REPOSITORY_INITIALIZATION_FAILURE");
}

function failPersistence(): never {
  throw new AgentError("DURABLE_REPOSITORY_PERSISTENCE_FAILURE");
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  throw new Error("Unsupported journal value");
}

function digestRecord(record: Omit<JournalRecord, "recordDigest">): string {
  return `0x${createHash("sha256").update(canonicalJson(record)).digest("hex")}`;
}

function withoutDigest(
  record: JournalRecord,
): Omit<JournalRecord, "recordDigest"> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== "recordDigest"),
  ) as Omit<JournalRecord, "recordDigest">;
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function validateCanonicalPaymentIntent(
  rawPayload: ProposalReservation["rawPaymentIntentPayload"],
): void {
  const parsed = paymentIntentSchema.parse(rawPayload);
  if (
    rawPayload.amount !== formatUsdc(parsed.amount) ||
    rawPayload.createdAt !== parsed.createdAt.toString() ||
    rawPayload.expiresAt !== parsed.expiresAt.toString() ||
    rawPayload.nonce !== parsed.nonce.toString()
  ) {
    throw new Error("PaymentIntent numeric fields are not canonical");
  }
}

function parseReservedRecord(value: unknown): {
  record: ReservedRecord;
  reservation: ProposalReservation;
} {
  const record = reservedRecordSchema.parse(value);
  const reservation = parseReservation({
    intentId: record.intentId,
    nonce: record.nonce,
    rawPaymentIntentPayload: record.rawPaymentIntentPayload,
  });
  validateCanonicalPaymentIntent(reservation.rawPaymentIntentPayload);
  if (
    record.createdAt !== reservation.rawPaymentIntentPayload.createdAt ||
    record.intentId !== reservation.intentId ||
    record.nonce !== reservation.nonce
  ) {
    throw new Error("Reservation record linkage is invalid");
  }
  return { record, reservation };
}

function parseCompletedRecord(value: unknown): {
  record: CompletedRecord;
  completedResult: AgentProposalResult;
} {
  const record = completedRecordSchema.parse(value);
  const completedResult = parseCompletedResult(record.completedResult);
  validateCanonicalPaymentIntent(completedResult.signedPaymentIntent.payload);
  if (
    record.createdAt !== completedResult.signedPaymentIntent.payload.createdAt
  ) {
    throw new Error("Completion record time is invalid");
  }
  return { record, completedResult };
}

function parseJournalRecord(line: string): JournalRecord {
  const value = JSON.parse(line) as unknown;
  if (typeof value !== "object" || value === null || !("recordType" in value)) {
    throw new Error("Journal record type is missing");
  }
  const parsed =
    (value as { recordType?: unknown }).recordType === "RESERVED"
      ? parseReservedRecord(value).record
      : (value as { recordType?: unknown }).recordType === "COMPLETED"
        ? parseCompletedRecord(value).record
        : (() => {
            throw new Error("Journal record type is unknown");
          })();
  if (digestRecord(withoutDigest(parsed)) !== parsed.recordDigest) {
    throw new Error("Journal record digest is invalid");
  }
  return parsed;
}

function replayJournal(contents: Uint8Array): {
  records: Map<string, DurableState>;
  nextNonce: bigint;
} {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(contents);
  if (text.length === 0) {
    return { records: new Map(), nextNonce: 0n };
  }
  if (!text.endsWith("\n")) {
    throw new Error("Journal final record is truncated");
  }
  const records = new Map<string, DurableState>();
  const intentOwners = new Map<string, string>();
  const nonceOwners = new Map<string, string>();
  let nextNonce = 0n;
  for (const line of text.slice(0, -1).split("\n")) {
    if (line.length === 0) throw new Error("Journal contains an empty record");
    const record = parseJournalRecord(line);
    if (record.recordType === "RESERVED") {
      const { reservation } = parseReservedRecord(record);
      const existing = records.get(record.proposalIdentity);
      if (
        existing !== undefined &&
        (existing.reservation.completedResult !== undefined ||
          !sameValue(existing.reservation, reservation) ||
          existing.reservationDigest !== record.recordDigest)
      ) {
        throw new Error("Journal contains a conflicting reservation");
      }
      const intentOwner = intentOwners.get(reservation.intentId);
      const nonceOwner = nonceOwners.get(reservation.nonce);
      if (
        (intentOwner !== undefined &&
          intentOwner !== record.proposalIdentity) ||
        (nonceOwner !== undefined && nonceOwner !== record.proposalIdentity)
      ) {
        throw new Error("Journal reuses a reservation identity");
      }
      intentOwners.set(reservation.intentId, record.proposalIdentity);
      nonceOwners.set(reservation.nonce, record.proposalIdentity);
      records.set(record.proposalIdentity, {
        reservation: clone(reservation),
        reservationDigest: record.recordDigest,
      });
      const nonce = BigInt(record.nonce);
      if (nonce >= nextNonce) nextNonce = nonce + 1n;
      continue;
    }

    const { completedResult } = parseCompletedRecord(record);
    const existing = records.get(record.proposalIdentity);
    if (existing === undefined) {
      throw new Error("Journal completion has no reservation");
    }
    const priorCompletion = existing.reservation.completedResult;
    if (
      record.previousRecordDigest !== existing.reservationDigest ||
      !sameValue(
        existing.reservation.rawPaymentIntentPayload,
        completedResult.signedPaymentIntent.payload,
      ) ||
      (priorCompletion !== undefined &&
        !sameValue(priorCompletion, completedResult))
    ) {
      throw new Error("Journal contains a conflicting completion");
    }
    existing.reservation = {
      ...existing.reservation,
      completedResult: clone(completedResult),
    };
  }
  return { records, nextNonce };
}

async function existingKind(
  path: string,
): Promise<"missing" | "directory" | "file" | "symlink"> {
  try {
    const status = await lstat(path);
    if (status.isSymbolicLink()) return "symlink";
    if (status.isDirectory()) return "directory";
    return "file";
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

function validateOptions(
  options: DurableProposalReservationRepositoryOptions,
): {
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
  if (!isAbsolute(directory)) failInitialization();
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

class DurableRepository implements DurableProposalReservationRepository {
  readonly #journalPath: string;
  readonly #lockPath: string;
  readonly #lockHandle: FileHandle;
  readonly #records: Map<string, DurableState>;
  readonly #pendingReservations = new Map<
    string,
    Promise<ProposalReservation>
  >();
  #nextNonce: bigint;
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
    records: Map<string, DurableState>;
    nextNonce: bigint;
  }) {
    this.#journalPath = input.journalPath;
    this.#lockPath = input.lockPath;
    this.#lockHandle = input.lockHandle;
    this.#records = input.records;
    this.#nextNonce = input.nextNonce;
    this.#shutdown = () => {
      void this.close().catch(() => undefined);
    };
    process.once("beforeExit", this.#shutdown);
  }

  #assertOpen(): void {
    if (this.#closed || this.#closing) {
      throw new AgentError("DURABLE_REPOSITORY_CLOSED");
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

  async #append(record: JournalRecord): Promise<void> {
    let handle: FileHandle | undefined;
    try {
      if ((await existingKind(this.#journalPath)) !== "file") {
        failPersistence();
      }
      handle = await open(this.#journalPath, "a", 0o600);
      await handle.writeFile(`${JSON.stringify(record)}\n`, {
        encoding: "utf8",
      });
      await handle.sync();
      await handle.close();
      handle = undefined;
    } catch {
      this.#faulted = true;
      if (handle !== undefined) {
        await handle.close().catch(() => undefined);
      }
      failPersistence();
    }
  }

  get(identity: string): Promise<unknown> {
    this.#assertOpen();
    const reservation = this.#records.get(identity)?.reservation;
    return Promise.resolve(
      reservation === undefined ? undefined : clone(reservation),
    );
  }

  reserve(
    identity: string,
    createReservation: (nonce: unknown) => Promise<ProposalReservation>,
  ): Promise<unknown> {
    this.#assertOpen();
    const existing = this.#records.get(identity);
    if (existing !== undefined)
      return Promise.resolve(clone(existing.reservation));
    const pending = this.#pendingReservations.get(identity);
    if (pending !== undefined) return pending.then(clone);

    const operation = this.#enqueue(async () => {
      const afterQueue = this.#records.get(identity);
      if (afterQueue !== undefined) return clone(afterQueue.reservation);
      const nonce = this.#nextNonce;
      let reservation: ProposalReservation;
      let proposalIdentity: z.infer<typeof nonzeroBytes32Schema>;
      try {
        proposalIdentity = nonzeroBytes32Schema.parse(identity);
        reservation = parseReservation(await createReservation(nonce));
        validateCanonicalPaymentIntent(reservation.rawPaymentIntentPayload);
        if (reservation.nonce !== nonce.toString()) {
          throw new Error("Reservation nonce does not match allocation");
        }
      } catch (error) {
        if (error instanceof AgentError) throw error;
        failPersistence();
      }
      for (const [storedIdentity, state] of this.#records) {
        if (
          storedIdentity !== proposalIdentity &&
          state.reservation.intentId === reservation.intentId
        ) {
          failPersistence();
        }
      }
      const unsigned = {
        formatVersion: FORMAT_VERSION,
        recordType: "RESERVED",
        proposalIdentity,
        intentId: reservation.intentId,
        nonce: reservation.nonce,
        rawPaymentIntentPayload: clone(reservation.rawPaymentIntentPayload),
        createdAt: reservation.rawPaymentIntentPayload.createdAt,
      } as const;
      const record: ReservedRecord = {
        ...unsigned,
        recordDigest: digestRecord(unsigned),
      };
      await this.#append(record);
      this.#records.set(identity, {
        reservation: clone(reservation),
        reservationDigest: record.recordDigest,
      });
      this.#nextNonce = nonce + 1n;
      return clone(reservation);
    });
    this.#pendingReservations.set(identity, operation);
    return operation.finally(() => {
      if (this.#pendingReservations.get(identity) === operation) {
        this.#pendingReservations.delete(identity);
      }
    });
  }

  storeCompleted(
    identity: string,
    result: AgentProposalResult,
  ): Promise<unknown> {
    return this.#enqueue(async () => {
      let completedResult: AgentProposalResult;
      let proposalIdentity: z.infer<typeof nonzeroBytes32Schema>;
      try {
        proposalIdentity = nonzeroBytes32Schema.parse(identity);
        completedResult = parseCompletedResult(result);
        validateCanonicalPaymentIntent(
          completedResult.signedPaymentIntent.payload,
        );
      } catch {
        failPersistence();
      }
      const existing = this.#records.get(proposalIdentity);
      if (existing === undefined) failPersistence();
      if (
        !sameValue(
          existing.reservation.rawPaymentIntentPayload,
          completedResult.signedPaymentIntent.payload,
        )
      ) {
        failPersistence();
      }
      if (existing.reservation.completedResult !== undefined) {
        if (!sameValue(existing.reservation.completedResult, completedResult)) {
          failPersistence();
        }
        return undefined;
      }
      const unsigned = {
        formatVersion: FORMAT_VERSION,
        recordType: "COMPLETED",
        proposalIdentity,
        completedResult: clone(completedResult),
        createdAt: completedResult.signedPaymentIntent.payload.createdAt,
        previousRecordDigest: existing.reservationDigest,
      } as const;
      const record: CompletedRecord = {
        ...unsigned,
        recordDigest: digestRecord(unsigned),
      };
      await this.#append(record);
      existing.reservation = {
        ...existing.reservation,
        completedResult: clone(completedResult),
      };
      return undefined;
    });
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
        throw new AgentError("DURABLE_REPOSITORY_CLOSE_FAILURE");
      } finally {
        this.#closing = false;
      }
    })();
    await this.#closePromise;
  }
}

export async function createDurableProposalReservationRepository(
  options: DurableProposalReservationRepositoryOptions,
): Promise<DurableProposalReservationRepository> {
  let lockHandle: FileHandle | undefined;
  let lockPath: string | undefined;
  let createdLock = false;
  try {
    const paths = validateOptions(options);
    lockPath = paths.lockPath;
    const directoryKind = await existingKind(paths.directory);
    if (directoryKind === "missing") {
      await mkdir(paths.directory, { recursive: true, mode: 0o700 });
    } else if (directoryKind !== "directory") {
      failInitialization();
    }
    if ((await existingKind(paths.directory)) !== "directory") {
      failInitialization();
    }
    const journalKind = await existingKind(paths.journalPath);
    const lockKind = await existingKind(paths.lockPath);
    if (
      journalKind === "directory" ||
      journalKind === "symlink" ||
      lockKind !== "missing"
    ) {
      failInitialization();
    }

    lockHandle = await open(paths.lockPath, "wx", 0o600);
    createdLock = true;
    await lockHandle.writeFile(
      JSON.stringify({
        formatVersion: FORMAT_VERSION,
        processId: process.pid.toString(),
      }),
      { encoding: "utf8" },
    );
    await lockHandle.sync();

    if (journalKind === "missing") {
      let journalHandle: FileHandle | undefined;
      try {
        journalHandle = await open(paths.journalPath, "wx", 0o600);
        await journalHandle.sync();
        await journalHandle.close();
        journalHandle = undefined;
      } finally {
        if (journalHandle !== undefined) {
          await journalHandle.close().catch(() => undefined);
        }
      }
    }
    if ((await existingKind(paths.journalPath)) !== "file") {
      failInitialization();
    }
    const replayed = replayJournal(await readFile(paths.journalPath));
    return new DurableRepository({
      journalPath: paths.journalPath,
      lockPath: paths.lockPath,
      lockHandle,
      records: replayed.records,
      nextNonce: replayed.nextNonce,
    });
  } catch {
    if (lockHandle !== undefined) {
      await lockHandle.close().catch(() => undefined);
    }
    if (createdLock && lockPath !== undefined) {
      await unlink(lockPath).catch(() => undefined);
    }
    failInitialization();
  }
}
