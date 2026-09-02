import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  assertProjectOwnership,
  parseCovenantResource,
  type PlatformCovenant,
} from "@covenant/core";
import {
  RUNTIME_OUTBOX_EVENTS,
  RUNTIME_STATES,
  TERMINAL_RUNTIME_STATES,
  type NoResubmitReason,
  type RetryReason,
  type RuntimeOutboxEvent,
  type RuntimeState,
} from "./constants.js";
import { RuntimeError, runtimeFailure } from "./errors.js";
import type {
  RuntimeCovenant,
  RuntimeOperation,
  RuntimeOutboxRecord,
} from "./types.js";

const HEX_ID = /^0x[0-9a-f]{64}$/u;
const SAFE_OWNER = /^[A-Za-z0-9._:-]{1,128}$/u;
const MAX_FAILURE_LENGTH = 256;

export type DurableRuntimeStoreOptions = Readonly<{
  filename?: string;
}>;

export type CreateOperationInput = Readonly<{
  projectId: string;
  covenantId: string;
  executionId: string;
  operationKey: string;
  authorizationId: string;
  intentId: string;
  intentHash: string;
  amount: string;
  beneficiary: string;
  resource: PlatformCovenant;
  at: number;
}>;

export type OperationPatch = Readonly<{
  retryReason?: RetryReason | null;
  noResubmitReason?: NoResubmitReason | null;
  failureReason?: string | null;
  providerTransactionId?: string | null;
  providerState?: string | null;
  providerEvidence?: unknown;
  arcEvidence?: unknown;
  nextAttemptAt?: number | null;
  attemptCount?: number;
  submissionBoundary?: boolean;
}>;

type SqlRow = Record<string, unknown>;

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") runtimeFailure("RUNTIME_PERSISTENCE_FAILURE");
  try {
    return JSON.parse(value);
  } catch (error) {
    runtimeFailure(
      "RUNTIME_PERSISTENCE_FAILURE",
      "Stored JSON is invalid",
      error,
    );
  }
}

function numberValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    runtimeFailure("RUNTIME_PERSISTENCE_FAILURE", "Stored integer is invalid");
  }
  return value;
}

function nullableNumber(value: unknown): number | null {
  return value === null ? null : numberValue(value);
}

function textValue(value: unknown): string {
  if (typeof value !== "string") runtimeFailure("RUNTIME_PERSISTENCE_FAILURE");
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : textValue(value);
}

function validateId(value: string, name: string): string {
  if (!HEX_ID.test(value))
    runtimeFailure("RUNTIME_CONFLICT", `${name} is invalid`);
  return value.toLowerCase();
}

function validateAt(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    runtimeFailure(
      "RUNTIME_PERSISTENCE_FAILURE",
      "Runtime timestamp is invalid",
    );
  }
  return value;
}

function validateOwner(value: string): string {
  if (!SAFE_OWNER.test(value))
    runtimeFailure("LEASE_LOST", "Worker identity is invalid");
  return value;
}

function failureText(reason: string): string {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    runtimeFailure("RUNTIME_INVALID_STATE", "Failure reason is required");
  }
  return reason.trim().slice(0, MAX_FAILURE_LENGTH);
}

const FORBIDDEN_METADATA_KEY =
  /(?:private.?key|api.?key|secret|credential|password|mnemonic|seed|signing|calldata|signed.?transaction|entity.?secret|circle.?token)/iu;

function safeMetadata(value: unknown, depth = 0): unknown {
  if (depth > 8)
    runtimeFailure(
      "RUNTIME_INVALID_STATE",
      "Evidence metadata is too deeply nested",
    );
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (Array.isArray(value))
    return value.map((item) => safeMetadata(item, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (FORBIDDEN_METADATA_KEY.test(key))
        runtimeFailure(
          "RUNTIME_INVALID_STATE",
          "Secret-bearing metadata is not persistable",
        );
      output[key] = safeMetadata(item, depth + 1);
    }
    return output;
  }
  runtimeFailure(
    "RUNTIME_INVALID_STATE",
    "Evidence metadata is not JSON serializable",
  );
}

function metadataJson(value: unknown): string {
  const json = JSON.stringify(safeMetadata(value));
  if (json.length > 16_384)
    runtimeFailure("RUNTIME_INVALID_STATE", "Evidence metadata is too large");
  return json;
}

function eventFor(state: RuntimeState, retryable = false): RuntimeOutboxEvent {
  if (retryable) return "execution.retryable_failure";
  const event = `execution.${state.toLowerCase()}` as RuntimeOutboxEvent;
  if (!(RUNTIME_OUTBOX_EVENTS as readonly string[]).includes(event)) {
    runtimeFailure("RUNTIME_INVALID_STATE", `No outbox event for ${state}`);
  }
  return event;
}

function rowToCovenant(row: SqlRow): RuntimeCovenant {
  const resource = parseCovenantResource(parseJson(row.resource_json));
  assertProjectOwnership(resource, textValue(row.project_id));
  if (resource.id !== textValue(row.covenant_id).toLowerCase()) {
    runtimeFailure(
      "RUNTIME_PERSISTENCE_FAILURE",
      "Stored Covenant identity is inconsistent",
    );
  }
  return Object.freeze({
    projectId: textValue(row.project_id),
    covenantId: textValue(row.covenant_id),
    resource,
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  });
}

function rowToOperation(row: SqlRow): RuntimeOperation {
  const state = textValue(row.state);
  if (!(RUNTIME_STATES as readonly string[]).includes(state)) {
    runtimeFailure(
      "RUNTIME_PERSISTENCE_FAILURE",
      "Stored runtime state is invalid",
    );
  }
  const providerEvidence =
    row.provider_evidence_json === null
      ? null
      : parseJson(row.provider_evidence_json);
  const arcEvidence =
    row.arc_evidence_json === null ? null : parseJson(row.arc_evidence_json);
  return Object.freeze({
    operationKey: textValue(row.operation_key),
    projectId: textValue(row.project_id),
    covenantId: textValue(row.covenant_id),
    executionId: textValue(row.execution_id),
    authorizationId: textValue(row.authorization_id),
    intentId: textValue(row.intent_id),
    intentHash: textValue(row.intent_hash),
    amount: textValue(row.amount),
    beneficiary: textValue(row.beneficiary),
    state: state as RuntimeState,
    attemptCount: numberValue(row.attempt_count),
    nextAttemptAt: nullableNumber(row.next_attempt_at),
    lastAttemptAt: nullableNumber(row.last_attempt_at),
    leaseOwner: nullableText(row.lease_owner),
    leaseExpiresAt: nullableNumber(row.lease_expires_at),
    version: numberValue(row.version),
    submissionBoundary: numberValue(row.submission_boundary) === 1,
    providerTransactionId: nullableText(row.provider_transaction_id),
    providerState: nullableText(row.provider_state),
    providerEvidence,
    arcEvidence,
    retryReason:
      row.retry_reason === null
        ? null
        : (textValue(row.retry_reason) as RetryReason),
    noResubmitReason:
      row.no_resubmit_reason === null
        ? null
        : (textValue(row.no_resubmit_reason) as NoResubmitReason),
    failureReason: nullableText(row.failure_reason),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  });
}

function rowToOutbox(row: SqlRow): RuntimeOutboxRecord {
  const eventType = textValue(row.event_type);
  if (!(RUNTIME_OUTBOX_EVENTS as readonly string[]).includes(eventType)) {
    runtimeFailure(
      "RUNTIME_PERSISTENCE_FAILURE",
      "Stored outbox event is invalid",
    );
  }
  return Object.freeze({
    id: numberValue(row.id),
    operationKey: textValue(row.operation_key),
    projectId: textValue(row.project_id),
    covenantId: textValue(row.covenant_id),
    eventType: eventType as RuntimeOutboxEvent,
    version: numberValue(row.version),
    payload: parseJson(row.payload_json) as Record<string, unknown>,
    createdAt: numberValue(row.created_at),
    deliveredAt: nullableNumber(row.delivered_at),
  });
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS covenants (
  project_id TEXT NOT NULL,
  covenant_id TEXT NOT NULL,
  resource_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, covenant_id)
);
CREATE TABLE IF NOT EXISTS execution_operations (
  operation_key TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  covenant_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  authorization_id TEXT NOT NULL,
  intent_id TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  amount TEXT NOT NULL,
  beneficiary TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (${RUNTIME_STATES.map((value) => `'${value}'`).join(",")})),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at INTEGER,
  last_attempt_at INTEGER,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  submission_boundary INTEGER NOT NULL DEFAULT 0 CHECK (submission_boundary IN (0, 1)),
  provider_transaction_id TEXT,
  provider_state TEXT,
  provider_evidence_json TEXT,
  arc_evidence_json TEXT,
  retry_reason TEXT,
  no_resubmit_reason TEXT,
  failure_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (project_id, covenant_id, execution_id),
  UNIQUE (project_id, covenant_id, operation_key),
  FOREIGN KEY (project_id, covenant_id) REFERENCES covenants(project_id, covenant_id)
);
CREATE INDEX IF NOT EXISTS execution_operations_claim_idx
  ON execution_operations (state, next_attempt_at, lease_expires_at);
CREATE TABLE IF NOT EXISTS runtime_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_key TEXT NOT NULL,
  project_id TEXT NOT NULL,
  covenant_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  UNIQUE (operation_key, event_type, version),
  FOREIGN KEY (operation_key) REFERENCES execution_operations(operation_key),
  FOREIGN KEY (project_id, covenant_id, operation_key)
    REFERENCES execution_operations(project_id, covenant_id, operation_key)
);
`;

export class DurableRuntimeStore {
  readonly #db: DatabaseSync;

  constructor(options: DurableRuntimeStoreOptions = {}) {
    const filename = options.filename ?? ":memory:";
    if (filename !== ":memory:") {
      mkdirSync(dirname(filename), { recursive: true });
    }
    this.#db = new DatabaseSync(filename);
    this.#db.exec(
      "PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;",
    );
    this.#db.exec(SCHEMA);
    if (filename !== ":memory:") {
      try {
        chmodSync(filename, 0o600);
      } catch {
        /* SQLite may use an existing read-only file. */
      }
    }
  }

  close(): void {
    this.#db.close();
  }

  #transaction<T>(work: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.#db.exec("ROLLBACK");
      } catch {
        /* preserve original error */
      }
      if (error instanceof RuntimeError) throw error;
      runtimeFailure(
        "RUNTIME_PERSISTENCE_FAILURE",
        "Runtime transaction failed",
        error,
      );
    }
  }

  saveCovenant(
    projectId: string,
    resourceInput: unknown,
    at: number,
  ): RuntimeCovenant {
    const resource = parseCovenantResource(resourceInput);
    assertProjectOwnership(resource, projectId);
    const project = validateId(projectId, "projectId");
    const covenantId = validateId(resource.id, "covenantId");
    const timestamp = validateAt(at);
    const resourceJson = JSON.stringify(resource);
    return this.#transaction(() => {
      const existing = this.#db
        .prepare(
          "SELECT * FROM covenants WHERE project_id = ? AND covenant_id = ?",
        )
        .get(project, covenantId) as SqlRow | undefined;
      if (existing !== undefined) {
        const previous = rowToCovenant(existing);
        if (JSON.stringify(previous.resource) !== resourceJson) {
          runtimeFailure(
            "RUNTIME_CONFLICT",
            "Covenant projection is immutable once stored",
          );
        }
        return previous;
      }
      this.#db
        .prepare(
          "INSERT INTO covenants(project_id,covenant_id,resource_json,created_at,updated_at) VALUES (?,?,?,?,?)",
        )
        .run(project, covenantId, resourceJson, timestamp, timestamp);
      return Object.freeze({
        projectId: project,
        covenantId,
        resource,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
  }

  getCovenant(
    projectId: string,
    covenantId: string,
  ): RuntimeCovenant | undefined {
    const row = this.#db
      .prepare(
        "SELECT * FROM covenants WHERE project_id = ? AND covenant_id = ?",
      )
      .get(
        validateId(projectId, "projectId"),
        validateId(covenantId, "covenantId"),
      ) as SqlRow | undefined;
    return row === undefined ? undefined : rowToCovenant(row);
  }

  #getOperation(operationKey: string): RuntimeOperation | undefined {
    const row = this.#db
      .prepare("SELECT * FROM execution_operations WHERE operation_key = ?")
      .get(validateId(operationKey, "operationKey")) as SqlRow | undefined;
    return row === undefined ? undefined : rowToOperation(row);
  }

  getOperation(operationKey: string): RuntimeOperation | undefined {
    return this.#getOperation(operationKey);
  }

  createOrJoinOperation(
    input: CreateOperationInput,
  ): Readonly<{ operation: RuntimeOperation; joined: boolean }> {
    const projectId = validateId(input.projectId, "projectId");
    const covenantId = validateId(input.covenantId, "covenantId");
    const executionId = validateId(input.executionId, "executionId");
    const operationKey = validateId(input.operationKey, "operationKey");
    const at = validateAt(input.at);
    if (
      input.resource.id !== covenantId ||
      input.resource.projectId !== projectId
    ) {
      runtimeFailure(
        "RUNTIME_CONFLICT",
        "Operation does not belong to the Covenant project",
      );
    }
    return this.#transaction(() => {
      const existing = this.#getOperation(operationKey);
      if (existing !== undefined) {
        if (
          existing.projectId !== projectId ||
          existing.covenantId !== covenantId ||
          existing.executionId !== executionId ||
          existing.authorizationId !== input.authorizationId ||
          existing.intentId !== input.intentId ||
          existing.intentHash !== input.intentHash ||
          existing.amount !== input.amount ||
          existing.beneficiary !== input.beneficiary
        ) {
          runtimeFailure(
            "RUNTIME_CONFLICT",
            "Execution identity or financial intent conflicts",
          );
        }
        return { operation: existing, joined: true };
      }
      const existingExecution = this.#db
        .prepare(
          "SELECT * FROM execution_operations WHERE project_id = ? AND covenant_id = ? AND execution_id = ?",
        )
        .get(projectId, covenantId, executionId) as SqlRow | undefined;
      if (existingExecution !== undefined) {
        const operation = rowToOperation(existingExecution);
        if (operation.operationKey !== operationKey) {
          runtimeFailure(
            "RUNTIME_CONFLICT",
            "Execution identity already belongs to another operation",
          );
        }
      }
      const covenant = this.#db
        .prepare(
          "SELECT * FROM covenants WHERE project_id = ? AND covenant_id = ?",
        )
        .get(projectId, covenantId) as SqlRow | undefined;
      if (covenant === undefined)
        runtimeFailure(
          "RUNTIME_NOT_FOUND",
          "Covenant projection was not found",
        );
      const resource = rowToCovenant(covenant);
      if (resource.resource.status !== "AUTHORIZED") {
        runtimeFailure(
          "RUNTIME_CONFLICT",
          "Covenant is not available for a new execution",
        );
      }
      this.#db
        .prepare(
          "UPDATE covenants SET resource_json=?,updated_at=? WHERE project_id=? AND covenant_id=?",
        )
        .run(JSON.stringify(input.resource), at, projectId, covenantId);
      this.#db
        .prepare(
          `INSERT INTO execution_operations(
          operation_key,project_id,covenant_id,execution_id,authorization_id,intent_id,intent_hash,
          amount,beneficiary,state,attempt_count,version,submission_boundary,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          operationKey,
          projectId,
          covenantId,
          executionId,
          input.authorizationId,
          input.intentId,
          input.intentHash,
          input.amount,
          input.beneficiary,
          "QUEUED",
          0,
          0,
          0,
          at,
          at,
        );
      this.#db
        .prepare(
          "INSERT INTO runtime_outbox(operation_key,project_id,covenant_id,event_type,version,payload_json,created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          operationKey,
          projectId,
          covenantId,
          eventFor("QUEUED"),
          0,
          JSON.stringify({
            operationKey,
            projectId,
            covenantId,
            executionId,
            state: "QUEUED",
          }),
          at,
        );
      const operation = this.#getOperation(operationKey);
      if (operation === undefined)
        runtimeFailure("RUNTIME_PERSISTENCE_FAILURE");
      return { operation, joined: false };
    });
  }

  #requireLease(
    operationKey: string,
    workerId: string,
    expectedVersion: number,
    at: number,
  ): RuntimeOperation {
    const operation = this.#getOperation(operationKey);
    if (operation === undefined)
      runtimeFailure("RUNTIME_NOT_FOUND", "Execution operation was not found");
    if (
      operation.leaseOwner !== workerId ||
      operation.version !== expectedVersion ||
      operation.leaseExpiresAt === null ||
      operation.leaseExpiresAt <= at
    ) {
      runtimeFailure("LEASE_LOST", "Worker lease is stale or expired");
    }
    return operation;
  }

  claimOperation(
    operationKey: string,
    workerId: string,
    at: number,
    leaseMs = 30_000,
  ): RuntimeOperation | undefined {
    const key = validateId(operationKey, "operationKey");
    const owner = validateOwner(workerId);
    const now = validateAt(at);
    if (
      !Number.isSafeInteger(leaseMs) ||
      leaseMs <= 0 ||
      leaseMs > 86_400_000
    ) {
      runtimeFailure("LEASE_LOST", "Lease duration is invalid");
    }
    return this.#transaction(() => {
      const row = this.#db
        .prepare("SELECT * FROM execution_operations WHERE operation_key = ?")
        .get(key) as SqlRow | undefined;
      if (row === undefined) return undefined;
      const current = rowToOperation(row);
      if (
        (TERMINAL_RUNTIME_STATES as readonly string[]).includes(current.state)
      )
        return current;
      if (
        current.leaseOwner !== null &&
        current.leaseExpiresAt !== null &&
        current.leaseExpiresAt > now
      )
        return undefined;
      if (current.nextAttemptAt !== null && current.nextAttemptAt > now)
        return undefined;
      const nextVersion = current.version + 1;
      this.#db
        .prepare(
          "UPDATE execution_operations SET lease_owner=?,lease_expires_at=?,version=?,updated_at=? WHERE operation_key=? AND version=?",
        )
        .run(owner, now + leaseMs, nextVersion, now, key, current.version);
      return this.#getOperation(key);
    });
  }

  renewLease(
    operationKey: string,
    workerId: string,
    expectedVersion: number,
    at: number,
    leaseMs = 30_000,
  ): RuntimeOperation {
    const key = validateId(operationKey, "operationKey");
    const owner = validateOwner(workerId);
    const now = validateAt(at);
    return this.#transaction(() => {
      const current = this.#requireLease(key, owner, expectedVersion, now);
      const nextVersion = current.version + 1;
      this.#db
        .prepare(
          "UPDATE execution_operations SET lease_expires_at=?,version=?,updated_at=? WHERE operation_key=? AND version=? AND lease_owner=?",
        )
        .run(now + leaseMs, nextVersion, now, key, expectedVersion, owner);
      const next = this.#getOperation(key);
      if (next?.version !== nextVersion) runtimeFailure("LEASE_LOST");
      return next;
    });
  }

  releaseLease(
    operationKey: string,
    workerId: string,
    expectedVersion: number,
    at: number,
  ): RuntimeOperation {
    const key = validateId(operationKey, "operationKey");
    const owner = validateOwner(workerId);
    const now = validateAt(at);
    return this.#transaction(() => {
      const current = this.#requireLease(key, owner, expectedVersion, now);
      const nextVersion = current.version + 1;
      this.#db
        .prepare(
          "UPDATE execution_operations SET lease_owner=NULL,lease_expires_at=NULL,version=?,updated_at=? WHERE operation_key=? AND version=? AND lease_owner=?",
        )
        .run(nextVersion, now, key, expectedVersion, owner);
      const next = this.#getOperation(key);
      if (next === undefined) runtimeFailure("LEASE_LOST");
      return next;
    });
  }

  recoverExpiredLeases(at: number): RuntimeOperation[] {
    const now = validateAt(at);
    return this.#transaction(() => {
      const rows = this.#db
        .prepare(
          "SELECT * FROM execution_operations WHERE lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND lease_expires_at <= ? AND state NOT IN ('SUCCEEDED','TERMINAL_FAILED')",
        )
        .all(now) as SqlRow[];
      const recovered: RuntimeOperation[] = [];
      for (const row of rows) {
        const current = rowToOperation(row);
        const postBoundary =
          current.submissionBoundary ||
          [
            "SUBMISSION_STARTED",
            "SUBMITTED",
            "AMBIGUOUS",
            "RECONCILING",
          ].includes(current.state);
        const state: RuntimeState = postBoundary ? "AMBIGUOUS" : "QUEUED";
        const version = current.version + 1;
        const reason: NoResubmitReason | null = postBoundary
          ? "CRASH_AFTER_BOUNDARY"
          : null;
        this.#db
          .prepare(
            "UPDATE execution_operations SET state=?,lease_owner=NULL,lease_expires_at=NULL,version=?,no_resubmit_reason=?,updated_at=? WHERE operation_key=? AND version=?",
          )
          .run(
            state,
            version,
            reason,
            now,
            current.operationKey,
            current.version,
          );
        const event = eventFor(state);
        this.#db
          .prepare(
            "INSERT OR IGNORE INTO runtime_outbox(operation_key,project_id,covenant_id,event_type,version,payload_json,created_at) VALUES (?,?,?,?,?,?,?)",
          )
          .run(
            current.operationKey,
            current.projectId,
            current.covenantId,
            event,
            version,
            JSON.stringify({
              operationKey: current.operationKey,
              projectId: current.projectId,
              covenantId: current.covenantId,
              state,
              noResubmit: postBoundary,
            }),
            now,
          );
        const next = this.#getOperation(current.operationKey);
        if (next !== undefined) recovered.push(next);
      }
      return recovered;
    });
  }

  #transitionLeasedUnsafe(
    key: string,
    owner: string,
    expectedVersion: number,
    nextState: RuntimeState,
    now: number,
    patch: OperationPatch,
  ): RuntimeOperation {
    if (!(RUNTIME_STATES as readonly string[]).includes(nextState))
      runtimeFailure("RUNTIME_INVALID_STATE");
    const current = this.#requireLease(key, owner, expectedVersion, now);
    if ((TERMINAL_RUNTIME_STATES as readonly string[]).includes(current.state))
      runtimeFailure("RUNTIME_TERMINAL");
    const version = current.version + 1;
    const attemptCount = patch.attemptCount ?? current.attemptCount;
    const failure =
      patch.failureReason === undefined
        ? current.failureReason
        : patch.failureReason === null
          ? null
          : failureText(patch.failureReason);
    const values = [
      nextState,
      attemptCount,
      patch.nextAttemptAt === undefined
        ? current.nextAttemptAt
        : patch.nextAttemptAt,
      now,
      current.leaseOwner,
      current.leaseExpiresAt,
      version,
      patch.submissionBoundary === undefined
        ? current.submissionBoundary
          ? 1
          : 0
        : patch.submissionBoundary
          ? 1
          : 0,
      patch.providerTransactionId === undefined
        ? current.providerTransactionId
        : patch.providerTransactionId,
      patch.providerState === undefined
        ? current.providerState
        : patch.providerState,
      patch.providerEvidence === undefined
        ? current.providerEvidence === null
          ? null
          : metadataJson(current.providerEvidence)
        : patch.providerEvidence === null
          ? null
          : metadataJson(patch.providerEvidence),
      patch.arcEvidence === undefined
        ? current.arcEvidence === null
          ? null
          : metadataJson(current.arcEvidence)
        : patch.arcEvidence === null
          ? null
          : metadataJson(patch.arcEvidence),
      patch.retryReason === undefined ? current.retryReason : patch.retryReason,
      patch.noResubmitReason === undefined
        ? current.noResubmitReason
        : patch.noResubmitReason,
      failure,
      now,
      key,
      expectedVersion,
      owner,
    ];
    this.#db
      .prepare(
        `UPDATE execution_operations SET state=?,attempt_count=?,next_attempt_at=?,last_attempt_at=?,lease_owner=?,lease_expires_at=?,version=?,submission_boundary=?,provider_transaction_id=?,provider_state=?,provider_evidence_json=?,arc_evidence_json=?,retry_reason=?,no_resubmit_reason=?,failure_reason=?,updated_at=? WHERE operation_key=? AND version=? AND lease_owner=?`,
      )
      .run(...values);
    const next = this.#getOperation(key);
    if (next?.version !== version) runtimeFailure("LEASE_LOST");
    const event = eventFor(
      nextState,
      nextState === "QUEUED" &&
        patch.retryReason !== null &&
        patch.retryReason !== undefined,
    );
    this.#db
      .prepare(
        "INSERT OR IGNORE INTO runtime_outbox(operation_key,project_id,covenant_id,event_type,version,payload_json,created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        next.operationKey,
        next.projectId,
        next.covenantId,
        event,
        version,
        JSON.stringify({
          operationKey: next.operationKey,
          projectId: next.projectId,
          covenantId: next.covenantId,
          executionId: next.executionId,
          state: next.state,
          attemptCount: next.attemptCount,
          reason:
            next.retryReason ?? next.noResubmitReason ?? next.failureReason,
        }),
        now,
      );
    return next;
  }

  transitionLeased(
    operationKey: string,
    workerId: string,
    expectedVersion: number,
    nextState: RuntimeState,
    at: number,
    patch: OperationPatch = {},
  ): RuntimeOperation {
    const key = validateId(operationKey, "operationKey");
    const owner = validateOwner(workerId);
    const now = validateAt(at);
    return this.#transaction(() =>
      this.#transitionLeasedUnsafe(
        key,
        owner,
        expectedVersion,
        nextState,
        now,
        patch,
      ),
    );
  }

  updateCovenantAndOperation(
    operationKey: string,
    workerId: string,
    expectedVersion: number,
    resource: PlatformCovenant,
    operationState: RuntimeState,
    at: number,
    patch: OperationPatch = {},
  ): Readonly<{ covenant: RuntimeCovenant; operation: RuntimeOperation }> {
    const key = validateId(operationKey, "operationKey");
    const owner = validateOwner(workerId);
    const now = validateAt(at);
    return this.#transaction(() => {
      const current = this.#requireLease(key, owner, expectedVersion, now);
      if (
        resource.id !== current.covenantId ||
        resource.projectId !== current.projectId
      )
        runtimeFailure("RUNTIME_CONFLICT");
      parseCovenantResource(resource);
      const operation = this.#transitionLeasedUnsafe(
        key,
        owner,
        expectedVersion,
        operationState,
        now,
        patch,
      );
      this.#db
        .prepare(
          "UPDATE covenants SET resource_json=?,updated_at=? WHERE project_id=? AND covenant_id=?",
        )
        .run(
          JSON.stringify(resource),
          now,
          current.projectId,
          current.covenantId,
        );
      const covenantRow = this.#db
        .prepare("SELECT * FROM covenants WHERE project_id=? AND covenant_id=?")
        .get(current.projectId, current.covenantId) as SqlRow | undefined;
      if (covenantRow === undefined)
        runtimeFailure("RUNTIME_PERSISTENCE_FAILURE");
      return { covenant: rowToCovenant(covenantRow), operation };
    });
  }

  listOutbox(
    options: Readonly<{ undeliveredOnly?: boolean; limit?: number }> = {},
  ): RuntimeOutboxRecord[] {
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1000)
      runtimeFailure("RUNTIME_PERSISTENCE_FAILURE", "Outbox limit is invalid");
    const query = options.undeliveredOnly
      ? "SELECT * FROM runtime_outbox WHERE delivered_at IS NULL ORDER BY id LIMIT ?"
      : "SELECT * FROM runtime_outbox ORDER BY id LIMIT ?";
    return (this.#db.prepare(query).all(limit) as SqlRow[]).map(rowToOutbox);
  }

  markOutboxDelivered(id: number, at: number): RuntimeOutboxRecord | undefined {
    validateAt(at);
    if (!Number.isSafeInteger(id) || id <= 0)
      runtimeFailure("RUNTIME_PERSISTENCE_FAILURE");
    this.#db
      .prepare(
        "UPDATE runtime_outbox SET delivered_at=? WHERE id=? AND delivered_at IS NULL",
      )
      .run(at, id);
    const row = this.#db
      .prepare("SELECT * FROM runtime_outbox WHERE id=?")
      .get(id) as SqlRow | undefined;
    return row === undefined ? undefined : rowToOutbox(row);
  }
}
