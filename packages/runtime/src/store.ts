import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  assertProjectOwnership,
  authorizationEvidenceSubmissionSchema,
  parseCovenantResource,
  type AuthorizationEvidenceSubmission,
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
  /** Verified external evidence; the runtime never creates or signs it. */
  authorizationEvidence?: unknown;
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

/** Public-platform persistence records. These tables live in the same
 * durable store as Covenants, execution operations, and the transactional
 * outbox; the API must not create a second database authority. */
export type DeveloperProjectRecord = Readonly<{
  projectId: string;
  name: string;
  createdAt: number;
}>;

export type ApiKeyRecord = Readonly<{
  keyId: string;
  projectId: string;
  prefix: string;
  digest: string;
  createdAt: number;
  revokedAt: number | null;
}>;

export type HttpIdempotencyRecord = Readonly<{
  projectId: string;
  route: string;
  keyDigest: string;
  requestFingerprint: string;
  responseStatus: number | null;
  responseJson: string | null;
  resourceReference: string | null;
  createdAt: number;
  updatedAt: number;
}>;

export type WebhookEndpointRecord = Readonly<{
  endpointId: string;
  projectId: string;
  url: string;
  secretCiphertext: string;
  createdAt: number;
  revokedAt: number | null;
}>;

export type WebhookDeliveryRecord = Readonly<{
  deliveryId: string;
  endpointId: string;
  projectId: string;
  eventId: string;
  eventType: string;
  payloadJson: string;
  status: "PENDING" | "RETRYING" | "DELIVERED" | "FAILED";
  attemptCount: number;
  nextAttemptAt: number;
  lastAttemptAt: number | null;
  deliveredAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}>;

export type CreateWebhookDeliveryInput = Readonly<{
  deliveryId: string;
  endpointId: string;
  projectId: string;
  eventId: string;
  eventType: string;
  payloadJson: string;
  at: number;
}>;

/**
 * Persistence boundary shared by the local SQLite adapter and the
 * PostgreSQL/Supabase deployment adapter.  Implementations contain only
 * operational projections; CovenantVault remains authoritative for money,
 * replay, revocation, and settlement state.
 */
export type RuntimeStore = Readonly<{
  close: () => void;
  checkReady: () => boolean;
  saveCovenant: (
    projectId: string,
    resource: unknown,
    at: number,
  ) => RuntimeCovenant;
  getCovenant: (
    projectId: string,
    covenantId: string,
  ) => RuntimeCovenant | undefined;
  replaceCovenantProjection: (
    projectId: string,
    resource: unknown,
    at: number,
  ) => RuntimeCovenant;
  saveAuthorizationEvidence: (
    projectId: string,
    covenantId: string,
    evidence: unknown,
    at: number,
  ) => AuthorizationEvidenceSubmission;
  getAuthorizationEvidence: (
    projectId: string,
    covenantId: string,
  ) => AuthorizationEvidenceSubmission | null;
  getOperation: (operationKey: string) => RuntimeOperation | undefined;
  getOperationByExecution: (
    projectId: string,
    executionId: string,
  ) => RuntimeOperation | undefined;
  createOrJoinOperation: (
    input: CreateOperationInput,
  ) => Readonly<{ operation: RuntimeOperation; joined: boolean }>;
  claimOperation: (
    operationKey: string,
    workerId: string,
    at: number,
    leaseMs?: number,
  ) => RuntimeOperation | undefined;
  renewLease: (
    operationKey: string,
    workerId: string,
    expectedVersion: number,
    at: number,
    leaseMs?: number,
  ) => RuntimeOperation;
  releaseLease: (
    operationKey: string,
    workerId: string,
    expectedVersion: number,
    at: number,
  ) => RuntimeOperation;
  recoverExpiredLeases: (at: number) => RuntimeOperation[];
  transitionLeased: (
    operationKey: string,
    workerId: string,
    expectedVersion: number,
    nextState: RuntimeState,
    at: number,
    patch?: OperationPatch,
  ) => RuntimeOperation;
  updateCovenantAndOperation: (
    operationKey: string,
    workerId: string,
    expectedVersion: number,
    resource: PlatformCovenant,
    operationState: RuntimeState,
    at: number,
    patch?: OperationPatch,
  ) => Readonly<{ covenant: RuntimeCovenant; operation: RuntimeOperation }>;
  listOutbox: (
    options?: Readonly<{ undeliveredOnly?: boolean; limit?: number }>,
  ) => RuntimeOutboxRecord[];
  markOutboxDelivered: (
    id: number,
    at: number,
  ) => RuntimeOutboxRecord | undefined;
  ensureDeveloperProject: (
    projectId: string,
    name: string,
    at: number,
  ) => DeveloperProjectRecord;
  getDeveloperProject: (
    projectId: string,
  ) => DeveloperProjectRecord | undefined;
  saveApiKey: (
    input: Readonly<{
      keyId: string;
      projectId: string;
      prefix: string;
      digest: string;
      at: number;
    }>,
  ) => ApiKeyRecord;
  findApiKeyCandidates: (prefix: string) => ApiKeyRecord[];
  listApiKeys: (projectId: string) => ApiKeyRecord[];
  revokeApiKey: (
    projectId: string,
    keyId: string,
    at: number,
  ) => ApiKeyRecord | undefined;
  listCovenants: (
    projectId: string,
    options?: Readonly<{ limit?: number; after?: string }>,
  ) => Readonly<{ items: RuntimeCovenant[]; nextAfter: string | null }>;
  getHttpIdempotency: (
    projectId: string,
    route: string,
    keyDigest: string,
  ) => HttpIdempotencyRecord | undefined;
  saveHttpIdempotency: (
    input: Readonly<{
      projectId: string;
      route: string;
      keyDigest: string;
      requestFingerprint: string;
      responseStatus?: number | null;
      responseJson?: string | null;
      resourceReference?: string | null;
      at: number;
    }>,
  ) => HttpIdempotencyRecord;
  deleteHttpIdempotency: (
    projectId: string,
    route: string,
    keyDigest: string,
  ) => void;
  createWebhookEndpoint: (
    input: Readonly<{
      endpointId: string;
      projectId: string;
      url: string;
      secretCiphertext: string;
      at: number;
    }>,
  ) => WebhookEndpointRecord;
  getWebhookEndpoint: (
    projectId: string,
    endpointId: string,
  ) => WebhookEndpointRecord | undefined;
  listWebhookEndpoints: (projectId: string) => WebhookEndpointRecord[];
  revokeWebhookEndpoint: (
    projectId: string,
    endpointId: string,
    at: number,
  ) => WebhookEndpointRecord | undefined;
  createWebhookDelivery: (
    input: CreateWebhookDeliveryInput,
  ) => WebhookDeliveryRecord;
  listWebhookDeliveries: (
    options?: Readonly<{ projectId?: string; dueAt?: number; limit?: number }>,
  ) => WebhookDeliveryRecord[];
  updateWebhookDelivery: (
    input: Readonly<{
      deliveryId: string;
      status: WebhookDeliveryRecord["status"];
      attemptCount: number;
      nextAttemptAt: number;
      lastAttemptAt: number;
      deliveredAt?: number | null;
      lastError?: string | null;
      at: number;
    }>,
  ) => WebhookDeliveryRecord | undefined;
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

function parseAuthorizationEvidence(
  value: unknown,
): AuthorizationEvidenceSubmission {
  try {
    return authorizationEvidenceSubmissionSchema.parse(value);
  } catch (error) {
    runtimeFailure(
      "RUNTIME_PERSISTENCE_FAILURE",
      "Stored authorization evidence is invalid",
      error,
    );
  }
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
  const authorizationEvidence =
    row.authorization_evidence_json === undefined ||
    row.authorization_evidence_json === null
      ? null
      : parseAuthorizationEvidence(parseJson(row.authorization_evidence_json));
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
    authorizationEvidence,
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

function rowToProject(row: SqlRow): DeveloperProjectRecord {
  return Object.freeze({
    projectId: textValue(row.project_id),
    name: textValue(row.name),
    createdAt: numberValue(row.created_at),
  });
}

function rowToApiKey(row: SqlRow): ApiKeyRecord {
  return Object.freeze({
    keyId: textValue(row.key_id),
    projectId: textValue(row.project_id),
    prefix: textValue(row.public_prefix),
    digest: textValue(row.digest),
    createdAt: numberValue(row.created_at),
    revokedAt: nullableNumber(row.revoked_at),
  });
}

function rowToIdempotency(row: SqlRow): HttpIdempotencyRecord {
  return Object.freeze({
    projectId: textValue(row.project_id),
    route: textValue(row.route),
    keyDigest: textValue(row.key_digest),
    requestFingerprint: textValue(row.request_fingerprint),
    responseStatus:
      row.response_status === null ? null : numberValue(row.response_status),
    responseJson:
      row.response_json === null ? null : textValue(row.response_json),
    resourceReference:
      row.resource_reference === null
        ? null
        : textValue(row.resource_reference),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
  });
}

function rowToWebhookEndpoint(row: SqlRow): WebhookEndpointRecord {
  return Object.freeze({
    endpointId: textValue(row.endpoint_id),
    projectId: textValue(row.project_id),
    url: textValue(row.url),
    secretCiphertext: textValue(row.secret_ciphertext),
    createdAt: numberValue(row.created_at),
    revokedAt: nullableNumber(row.revoked_at),
  });
}

function rowToWebhookDelivery(row: SqlRow): WebhookDeliveryRecord {
  const status = textValue(row.status);
  if (
    !(["PENDING", "RETRYING", "DELIVERED", "FAILED"] as const).includes(
      status as never,
    )
  ) {
    runtimeFailure(
      "RUNTIME_PERSISTENCE_FAILURE",
      "Stored webhook status is invalid",
    );
  }
  return Object.freeze({
    deliveryId: textValue(row.delivery_id),
    endpointId: textValue(row.endpoint_id),
    projectId: textValue(row.project_id),
    eventId: textValue(row.event_id),
    eventType: textValue(row.event_type),
    payloadJson: textValue(row.payload_json),
    status: status as WebhookDeliveryRecord["status"],
    attemptCount: numberValue(row.attempt_count),
    nextAttemptAt: numberValue(row.next_attempt_at),
    lastAttemptAt: nullableNumber(row.last_attempt_at),
    deliveredAt: nullableNumber(row.delivered_at),
    lastError: nullableText(row.last_error),
    createdAt: numberValue(row.created_at),
    updatedAt: numberValue(row.updated_at),
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
  authorization_evidence_json TEXT,
  retry_reason TEXT,
  no_resubmit_reason TEXT,
  failure_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (project_id, covenant_id, execution_id),
  UNIQUE (project_id, covenant_id, operation_key),
  FOREIGN KEY (project_id, covenant_id) REFERENCES covenants(project_id, covenant_id)
);
CREATE TABLE IF NOT EXISTS authorization_evidence (
  project_id TEXT NOT NULL,
  covenant_id TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, covenant_id),
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
CREATE TABLE IF NOT EXISTS developer_projects (
  project_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  key_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  public_prefix TEXT NOT NULL UNIQUE,
  digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES developer_projects(project_id)
);
CREATE INDEX IF NOT EXISTS api_keys_project_idx ON api_keys(project_id, created_at);
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  endpoint_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  url TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (project_id) REFERENCES developer_projects(project_id)
);
CREATE INDEX IF NOT EXISTS webhook_endpoints_project_idx
  ON webhook_endpoints(project_id, created_at);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','RETRYING','DELIVERED','FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at INTEGER NOT NULL,
  last_attempt_at INTEGER,
  delivered_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(endpoint_id, event_id),
  FOREIGN KEY (endpoint_id) REFERENCES webhook_endpoints(endpoint_id),
  FOREIGN KEY (project_id) REFERENCES developer_projects(project_id)
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx
  ON webhook_deliveries(status, next_attempt_at, created_at);
CREATE TABLE IF NOT EXISTS http_idempotency (
  project_id TEXT NOT NULL,
  route TEXT NOT NULL,
  key_digest TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  response_status INTEGER,
  response_json TEXT,
  resource_reference TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(project_id, route, key_digest),
  FOREIGN KEY (project_id) REFERENCES developer_projects(project_id)
);
`;

export class DurableRuntimeStore implements RuntimeStore {
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
    const operationColumns = this.#db
      .prepare("PRAGMA table_info(execution_operations)")
      .all() as { name?: unknown }[];
    if (
      !operationColumns.some(
        (column) => column.name === "authorization_evidence_json",
      )
    ) {
      this.#db.exec(
        "ALTER TABLE execution_operations ADD COLUMN authorization_evidence_json TEXT",
      );
    }
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

  /** Lightweight readiness probe that never returns database internals. */
  checkReady(): boolean {
    try {
      this.#db.prepare("SELECT 1 AS ok").get();
      return true;
    } catch {
      return false;
    }
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

  /**
   * Persist the exact verified authority bundle supplied by the API. This is
   * operational evidence only: no signature is generated or modified here.
   */
  saveAuthorizationEvidence(
    projectId: string,
    covenantId: string,
    submissionInput: unknown,
    at: number,
  ): AuthorizationEvidenceSubmission {
    const project = validateId(projectId, "projectId");
    const covenant = validateId(covenantId, "covenantId");
    const timestamp = validateAt(at);
    let submission: AuthorizationEvidenceSubmission;
    try {
      submission = authorizationEvidenceSubmissionSchema.parse(submissionInput);
    } catch (error) {
      runtimeFailure(
        "RUNTIME_INVALID_STATE",
        "Authorization evidence is invalid",
        error,
      );
    }
    const evidenceJson = metadataJson(submission);
    return this.#transaction(() => {
      const covenantRow = this.#db
        .prepare(
          "SELECT 1 AS present FROM covenants WHERE project_id = ? AND covenant_id = ?",
        )
        .get(project, covenant);
      if (covenantRow === undefined)
        runtimeFailure(
          "RUNTIME_NOT_FOUND",
          "Covenant projection was not found",
        );
      const existing = this.#db
        .prepare(
          "SELECT evidence_json FROM authorization_evidence WHERE project_id = ? AND covenant_id = ?",
        )
        .get(project, covenant) as SqlRow | undefined;
      if (existing !== undefined) {
        if (textValue(existing.evidence_json) !== evidenceJson)
          runtimeFailure(
            "RUNTIME_CONFLICT",
            "Authorization evidence is immutable once stored",
          );
        return submission;
      }
      this.#db
        .prepare(
          "INSERT INTO authorization_evidence(project_id,covenant_id,evidence_json,created_at,updated_at) VALUES (?,?,?,?,?)",
        )
        .run(project, covenant, evidenceJson, timestamp, timestamp);
      return submission;
    });
  }

  getAuthorizationEvidence(
    projectId: string,
    covenantId: string,
  ): AuthorizationEvidenceSubmission | null {
    const row = this.#db
      .prepare(
        "SELECT evidence_json FROM authorization_evidence WHERE project_id = ? AND covenant_id = ?",
      )
      .get(
        validateId(projectId, "projectId"),
        validateId(covenantId, "covenantId"),
      ) as SqlRow | undefined;
    return row === undefined
      ? null
      : parseAuthorizationEvidence(parseJson(row.evidence_json));
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
    const authorizationEvidence =
      input.authorizationEvidence === undefined ||
      input.authorizationEvidence === null
        ? null
        : (() => {
            try {
              return authorizationEvidenceSubmissionSchema.parse(
                input.authorizationEvidence,
              );
            } catch (error) {
              runtimeFailure(
                "RUNTIME_INVALID_STATE",
                "Authorization evidence is invalid",
                error,
              );
            }
          })();
    const authorizationEvidenceJson =
      authorizationEvidence === null
        ? null
        : metadataJson(authorizationEvidence);
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
          existing.beneficiary !== input.beneficiary ||
          JSON.stringify(existing.authorizationEvidence) !==
            JSON.stringify(authorizationEvidence)
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
          amount,beneficiary,state,attempt_count,version,submission_boundary,authorization_evidence_json,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
          authorizationEvidenceJson,
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

  ensureDeveloperProject(
    projectIdInput: string,
    nameInput: string,
    at: number,
  ): DeveloperProjectRecord {
    const projectId = validateId(projectIdInput, "projectId");
    const name = nameInput.trim().slice(0, 128);
    if (name.length === 0)
      runtimeFailure("RUNTIME_INVALID_STATE", "Project name is required");
    const timestamp = validateAt(at);
    return this.#transaction(() => {
      this.#db
        .prepare(
          "INSERT OR IGNORE INTO developer_projects(project_id,name,created_at) VALUES (?,?,?)",
        )
        .run(projectId, name, timestamp);
      const row = this.#db
        .prepare("SELECT * FROM developer_projects WHERE project_id=?")
        .get(projectId) as SqlRow | undefined;
      if (row === undefined) runtimeFailure("RUNTIME_PERSISTENCE_FAILURE");
      return rowToProject(row);
    });
  }

  getDeveloperProject(
    projectIdInput: string,
  ): DeveloperProjectRecord | undefined {
    const row = this.#db
      .prepare("SELECT * FROM developer_projects WHERE project_id=?")
      .get(validateId(projectIdInput, "projectId")) as SqlRow | undefined;
    return row === undefined ? undefined : rowToProject(row);
  }

  saveApiKey(
    input: Readonly<{
      keyId: string;
      projectId: string;
      prefix: string;
      digest: string;
      at: number;
    }>,
  ): ApiKeyRecord {
    const keyId = input.keyId.trim();
    const prefix = input.prefix.trim();
    const digest = input.digest.trim();
    if (
      !/^[A-Za-z0-9._:-]{1,128}$/u.test(keyId) ||
      !/^cov_test_[A-Za-z0-9_-]{8,}$/u.test(prefix)
    ) {
      runtimeFailure("RUNTIME_INVALID_STATE", "API key identity is invalid");
    }
    if (!/^[0-9a-f]{64}$/u.test(digest))
      runtimeFailure("RUNTIME_INVALID_STATE", "API key digest is invalid");
    const projectId = validateId(input.projectId, "projectId");
    const at = validateAt(input.at);
    return this.#transaction(() => {
      this.#db
        .prepare(
          "INSERT INTO api_keys(key_id,project_id,public_prefix,digest,created_at) VALUES (?,?,?,?,?)",
        )
        .run(keyId, projectId, prefix, digest, at);
      const row = this.#db
        .prepare("SELECT * FROM api_keys WHERE key_id=?")
        .get(keyId) as SqlRow | undefined;
      if (row === undefined) runtimeFailure("RUNTIME_PERSISTENCE_FAILURE");
      return rowToApiKey(row);
    });
  }

  findApiKeyCandidates(prefixInput: string): ApiKeyRecord[] {
    const prefix = prefixInput.trim();
    return (
      this.#db
        .prepare("SELECT * FROM api_keys WHERE public_prefix=?")
        .all(prefix) as SqlRow[]
    ).map(rowToApiKey);
  }

  listApiKeys(projectIdInput: string): ApiKeyRecord[] {
    const projectId = validateId(projectIdInput, "projectId");
    return (
      this.#db
        .prepare(
          "SELECT * FROM api_keys WHERE project_id=? ORDER BY created_at,key_id",
        )
        .all(projectId) as SqlRow[]
    ).map(rowToApiKey);
  }

  revokeApiKey(
    projectIdInput: string,
    keyId: string,
    at: number,
  ): ApiKeyRecord | undefined {
    const projectId = validateId(projectIdInput, "projectId");
    const timestamp = validateAt(at);
    this.#db
      .prepare(
        "UPDATE api_keys SET revoked_at=? WHERE project_id=? AND key_id=? AND revoked_at IS NULL",
      )
      .run(timestamp, projectId, keyId);
    const row = this.#db
      .prepare("SELECT * FROM api_keys WHERE project_id=? AND key_id=?")
      .get(projectId, keyId) as SqlRow | undefined;
    return row === undefined ? undefined : rowToApiKey(row);
  }

  replaceCovenantProjection(
    projectIdInput: string,
    resourceInput: unknown,
    at: number,
  ): RuntimeCovenant {
    const projectId = validateId(projectIdInput, "projectId");
    const resource = parseCovenantResource(resourceInput);
    assertProjectOwnership(resource, projectId);
    const covenantId = validateId(resource.id, "covenantId");
    const timestamp = validateAt(at);
    return this.#transaction(() => {
      const row = this.#db
        .prepare("SELECT * FROM covenants WHERE project_id=? AND covenant_id=?")
        .get(projectId, covenantId) as SqlRow | undefined;
      if (row === undefined)
        runtimeFailure(
          "RUNTIME_NOT_FOUND",
          "Covenant projection was not found",
        );
      const previous = rowToCovenant(row);
      if (BigInt(resource.updatedAt) < BigInt(previous.resource.updatedAt)) {
        runtimeFailure(
          "RUNTIME_CONFLICT",
          "Covenant projection cannot move backwards",
        );
      }
      this.#db
        .prepare(
          "UPDATE covenants SET resource_json=?,updated_at=? WHERE project_id=? AND covenant_id=?",
        )
        .run(JSON.stringify(resource), timestamp, projectId, covenantId);
      const next = this.#db
        .prepare("SELECT * FROM covenants WHERE project_id=? AND covenant_id=?")
        .get(projectId, covenantId) as SqlRow | undefined;
      if (next === undefined) runtimeFailure("RUNTIME_PERSISTENCE_FAILURE");
      return rowToCovenant(next);
    });
  }

  listCovenants(
    projectIdInput: string,
    options: Readonly<{ limit?: number; after?: string }> = {},
  ): Readonly<{ items: RuntimeCovenant[]; nextAfter: string | null }> {
    const projectId = validateId(projectIdInput, "projectId");
    const limit = options.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100)
      runtimeFailure(
        "RUNTIME_PERSISTENCE_FAILURE",
        "Covenant limit is invalid",
      );
    const after =
      options.after === undefined ? null : validateId(options.after, "cursor");
    const rows =
      after === null
        ? (this.#db
            .prepare(
              "SELECT * FROM covenants WHERE project_id=? ORDER BY created_at,covenant_id LIMIT ?",
            )
            .all(projectId, limit + 1) as SqlRow[])
        : (this.#db
            .prepare(
              "SELECT * FROM covenants WHERE project_id=? AND (created_at,covenant_id) > (SELECT created_at,covenant_id FROM covenants WHERE project_id=? AND covenant_id=?) ORDER BY created_at,covenant_id LIMIT ?",
            )
            .all(projectId, projectId, after, limit + 1) as SqlRow[]);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(rowToCovenant);
    return {
      items,
      nextAfter: hasMore ? (items.at(-1)?.covenantId ?? null) : null,
    };
  }

  getOperationByExecution(
    projectIdInput: string,
    executionIdInput: string,
  ): RuntimeOperation | undefined {
    const projectId = validateId(projectIdInput, "projectId");
    const executionId = validateId(executionIdInput, "executionId");
    const row = this.#db
      .prepare(
        "SELECT * FROM execution_operations WHERE project_id=? AND execution_id=?",
      )
      .get(projectId, executionId) as SqlRow | undefined;
    return row === undefined ? undefined : rowToOperation(row);
  }

  getHttpIdempotency(
    projectIdInput: string,
    route: string,
    keyDigest: string,
  ): HttpIdempotencyRecord | undefined {
    const projectId = validateId(projectIdInput, "projectId");
    const row = this.#db
      .prepare(
        "SELECT * FROM http_idempotency WHERE project_id=? AND route=? AND key_digest=?",
      )
      .get(projectId, route, keyDigest) as SqlRow | undefined;
    return row === undefined ? undefined : rowToIdempotency(row);
  }

  saveHttpIdempotency(
    input: Readonly<{
      projectId: string;
      route: string;
      keyDigest: string;
      requestFingerprint: string;
      responseStatus?: number | null;
      responseJson?: string | null;
      resourceReference?: string | null;
      at: number;
    }>,
  ): HttpIdempotencyRecord {
    const projectId = validateId(input.projectId, "projectId");
    const at = validateAt(input.at);
    return this.#transaction(() => {
      const existing = this.#db
        .prepare(
          "SELECT * FROM http_idempotency WHERE project_id=? AND route=? AND key_digest=?",
        )
        .get(projectId, input.route, input.keyDigest) as SqlRow | undefined;
      if (
        existing !== undefined &&
        textValue(existing.request_fingerprint) !== input.requestFingerprint
      )
        runtimeFailure(
          "RUNTIME_CONFLICT",
          "Idempotency key was used with a different request",
        );
      this.#db
        .prepare(
          "INSERT INTO http_idempotency(project_id,route,key_digest,request_fingerprint,response_status,response_json,resource_reference,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,route,key_digest) DO UPDATE SET response_status=excluded.response_status,response_json=excluded.response_json,resource_reference=excluded.resource_reference,updated_at=excluded.updated_at",
        )
        .run(
          projectId,
          input.route,
          input.keyDigest,
          input.requestFingerprint,
          input.responseStatus ?? null,
          input.responseJson ?? null,
          input.resourceReference ?? null,
          at,
          at,
        );
      const row = this.#db
        .prepare(
          "SELECT * FROM http_idempotency WHERE project_id=? AND route=? AND key_digest=?",
        )
        .get(projectId, input.route, input.keyDigest) as SqlRow | undefined;
      if (row === undefined) runtimeFailure("RUNTIME_PERSISTENCE_FAILURE");
      return rowToIdempotency(row);
    });
  }

  deleteHttpIdempotency(
    projectIdInput: string,
    route: string,
    keyDigest: string,
  ): void {
    const projectId = validateId(projectIdInput, "projectId");
    this.#db
      .prepare(
        "DELETE FROM http_idempotency WHERE project_id=? AND route=? AND key_digest=? AND response_status IS NULL",
      )
      .run(projectId, route, keyDigest);
  }

  createWebhookEndpoint(
    input: Readonly<{
      endpointId: string;
      projectId: string;
      url: string;
      secretCiphertext: string;
      at: number;
    }>,
  ): WebhookEndpointRecord {
    const projectId = validateId(input.projectId, "projectId");
    const at = validateAt(input.at);
    this.#db
      .prepare(
        "INSERT INTO webhook_endpoints(endpoint_id,project_id,url,secret_ciphertext,created_at) VALUES (?,?,?,?,?)",
      )
      .run(input.endpointId, projectId, input.url, input.secretCiphertext, at);
    const row = this.#db
      .prepare("SELECT * FROM webhook_endpoints WHERE endpoint_id=?")
      .get(input.endpointId) as SqlRow | undefined;
    if (row === undefined) runtimeFailure("RUNTIME_PERSISTENCE_FAILURE");
    return rowToWebhookEndpoint(row);
  }

  getWebhookEndpoint(
    projectIdInput: string,
    endpointId: string,
  ): WebhookEndpointRecord | undefined {
    const projectId = validateId(projectIdInput, "projectId");
    const row = this.#db
      .prepare(
        "SELECT * FROM webhook_endpoints WHERE project_id=? AND endpoint_id=?",
      )
      .get(projectId, endpointId) as SqlRow | undefined;
    return row === undefined ? undefined : rowToWebhookEndpoint(row);
  }

  listWebhookEndpoints(projectIdInput: string): WebhookEndpointRecord[] {
    const projectId = validateId(projectIdInput, "projectId");
    return (
      this.#db
        .prepare(
          "SELECT * FROM webhook_endpoints WHERE project_id=? AND revoked_at IS NULL ORDER BY created_at,endpoint_id",
        )
        .all(projectId) as SqlRow[]
    ).map(rowToWebhookEndpoint);
  }

  revokeWebhookEndpoint(
    projectIdInput: string,
    endpointId: string,
    at: number,
  ): WebhookEndpointRecord | undefined {
    const projectId = validateId(projectIdInput, "projectId");
    const timestamp = validateAt(at);
    this.#db
      .prepare(
        "UPDATE webhook_endpoints SET revoked_at=? WHERE project_id=? AND endpoint_id=? AND revoked_at IS NULL",
      )
      .run(timestamp, projectId, endpointId);
    return this.getWebhookEndpoint(projectId, endpointId);
  }

  createWebhookDelivery(
    input: CreateWebhookDeliveryInput,
  ): WebhookDeliveryRecord {
    const projectId = validateId(input.projectId, "projectId");
    const at = validateAt(input.at);
    this.#db
      .prepare(
        "INSERT OR IGNORE INTO webhook_deliveries(delivery_id,endpoint_id,project_id,event_id,event_type,payload_json,status,attempt_count,next_attempt_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        input.deliveryId,
        input.endpointId,
        projectId,
        input.eventId,
        input.eventType,
        input.payloadJson,
        "PENDING",
        0,
        at,
        at,
        at,
      );
    const row = (this.#db
      .prepare("SELECT * FROM webhook_deliveries WHERE delivery_id=?")
      .get(input.deliveryId) ??
      this.#db
        .prepare(
          "SELECT * FROM webhook_deliveries WHERE endpoint_id=? AND event_id=?",
        )
        .get(input.endpointId, input.eventId)) as SqlRow | undefined;
    if (row === undefined) runtimeFailure("RUNTIME_PERSISTENCE_FAILURE");
    return rowToWebhookDelivery(row);
  }

  listWebhookDeliveries(
    options: Readonly<{
      projectId?: string;
      dueAt?: number;
      limit?: number;
    }> = {},
  ): WebhookDeliveryRecord[] {
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1000)
      runtimeFailure(
        "RUNTIME_PERSISTENCE_FAILURE",
        "Delivery limit is invalid",
      );
    const rows =
      options.projectId === undefined
        ? (this.#db
            .prepare(
              "SELECT * FROM webhook_deliveries WHERE (? IS NULL OR next_attempt_at <= ?) AND status IN ('PENDING','RETRYING') ORDER BY created_at,delivery_id LIMIT ?",
            )
            .all(
              options.dueAt ?? null,
              options.dueAt ?? null,
              limit,
            ) as SqlRow[])
        : (this.#db
            .prepare(
              "SELECT * FROM webhook_deliveries WHERE project_id=? AND (? IS NULL OR next_attempt_at <= ?) AND status IN ('PENDING','RETRYING') ORDER BY created_at,delivery_id LIMIT ?",
            )
            .all(
              validateId(options.projectId, "projectId"),
              options.dueAt ?? null,
              options.dueAt ?? null,
              limit,
            ) as SqlRow[]);
    return rows.map(rowToWebhookDelivery);
  }

  updateWebhookDelivery(
    input: Readonly<{
      deliveryId: string;
      status: WebhookDeliveryRecord["status"];
      attemptCount: number;
      nextAttemptAt: number;
      lastAttemptAt: number;
      deliveredAt?: number | null;
      lastError?: string | null;
      at: number;
    }>,
  ): WebhookDeliveryRecord | undefined {
    const at = validateAt(input.at);
    this.#db
      .prepare(
        "UPDATE webhook_deliveries SET status=?,attempt_count=?,next_attempt_at=?,last_attempt_at=?,delivered_at=?,last_error=?,updated_at=? WHERE delivery_id=?",
      )
      .run(
        input.status,
        input.attemptCount,
        input.nextAttemptAt,
        input.lastAttemptAt,
        input.deliveredAt ?? null,
        input.lastError ?? null,
        at,
        input.deliveryId,
      );
    const row = this.#db
      .prepare("SELECT * FROM webhook_deliveries WHERE delivery_id=?")
      .get(input.deliveryId) as SqlRow | undefined;
    return row === undefined ? undefined : rowToWebhookDelivery(row);
  }
}
