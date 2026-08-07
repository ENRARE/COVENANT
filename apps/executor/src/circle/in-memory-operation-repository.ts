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

export class InMemoryCircleOperationRepository implements CircleOperationRepository {
  readonly #records = new Map<Hex, CircleOperationRecord>();
  readonly #uuids = new Map<string, Hex>();

  prepare(
    fingerprint: CircleExecutionFingerprint,
    idempotencyKey: string,
  ): Promise<unknown> {
    const uuid = parseCircleUuidV4(idempotencyKey);
    const existing = this.#records.get(fingerprint.operationKey);
    if (existing !== undefined) {
      if (!isDeepStrictEqual(existing.fingerprint, fingerprint)) {
        throw new ExecutorError("EXECUTION_CONFLICT");
      }
      return Promise.resolve(existing);
    }
    const uuidOwner = this.#uuids.get(uuid);
    if (uuidOwner !== undefined && uuidOwner !== fingerprint.operationKey) {
      throw new ExecutorError("EXECUTION_CONFLICT");
    }
    const record = Object.freeze({
      fingerprint: Object.freeze({ ...fingerprint }),
      idempotencyKey: uuid,
      attemptCount: 0,
      state: "PREPARED",
    }) satisfies CircleOperationRecord;
    this.#records.set(fingerprint.operationKey, record);
    this.#uuids.set(uuid, fingerprint.operationKey);
    return Promise.resolve(record);
  }

  markSubmissionAttemptStarted(
    operationKey: Hex,
    expectedIdempotencyKey: string,
  ): Promise<unknown> {
    const current = this.#required(operationKey, expectedIdempotencyKey);
    if (current.state !== "PREPARED") {
      throw new ExecutorError("EXECUTION_NOT_RETRYABLE");
    }
    const next = Object.freeze({
      ...current,
      attemptCount: 1,
      state: "SUBMISSION_ATTEMPT_STARTED",
    }) satisfies CircleOperationRecord;
    this.#records.set(operationKey, next);
    return Promise.resolve(next);
  }

  recordAccepted(
    operationKey: Hex,
    expectedIdempotencyKey: string,
    providerTransactionId: string,
    providerState: CircleTransactionState,
  ): Promise<unknown> {
    const current = this.#required(operationKey, expectedIdempotencyKey);
    if (current.state !== "SUBMISSION_ATTEMPT_STARTED") {
      throw new ExecutorError("EXECUTION_CONFLICT");
    }
    const next = Object.freeze({
      ...current,
      state: "ACCEPTED",
      providerTransactionId,
      providerState,
    }) satisfies CircleOperationRecord;
    this.#records.set(operationKey, next);
    return Promise.resolve(next);
  }

  recordUnknown(
    operationKey: Hex,
    expectedIdempotencyKey: string,
  ): Promise<unknown> {
    const current = this.#required(operationKey, expectedIdempotencyKey);
    if (current.state === "ACCEPTED") return Promise.resolve(current);
    const next = Object.freeze({
      ...current,
      attemptCount: 1,
      state: "UNKNOWN",
    }) satisfies CircleOperationRecord;
    this.#records.set(operationKey, next);
    return Promise.resolve(next);
  }

  #required(operationKey: Hex, idempotencyKey: string): CircleOperationRecord {
    const value = this.#records.get(operationKey);
    if (value?.idempotencyKey !== idempotencyKey) {
      throw new ExecutorError("EXECUTION_CONFLICT");
    }
    return parseCircleOperationRecord(value);
  }
}
