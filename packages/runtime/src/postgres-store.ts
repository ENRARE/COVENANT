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
  ApiKeyRecord,
  CreateOperationInput,
  CreateWebhookDeliveryInput,
  DeveloperProjectRecord,
  HttpIdempotencyRecord,
  OperationPatch,
  RuntimeStore,
  WebhookDeliveryRecord,
  WebhookEndpointRecord,
} from "./store.js";
import type {
  RuntimeCovenant,
  RuntimeOperation,
  RuntimeOutboxRecord,
} from "./types.js";

/** A deliberately tiny driver boundary.  The repository does not bundle a
 * PostgreSQL client or credentials; deployment supplies a vetted driver
 * (node-postgres, Supabase pool, or an equivalent) through this interface. */
export type PostgresQueryClient = Readonly<{
  // Generic rows let deployment drivers retain their typed result shape.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  query: <Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ) => { rows: Row[] };
  transaction: <T>(work: (client: PostgresQueryClient) => T) => T;
  close?: () => void;
}>;

export type PostgresRuntimeStoreOptions = Readonly<{
  client: PostgresQueryClient;
}>;

type Row = Record<string, unknown>;
const HEX_ID = /^0x[0-9a-f]{64}$/u;
const SAFE_OWNER = /^[A-Za-z0-9._:-]{1,128}$/u;
const EVENT_NAMES = RUNTIME_OUTBOX_EVENTS as readonly string[];

function fail(message = "Runtime persistence failed"): never {
  runtimeFailure("RUNTIME_PERSISTENCE_FAILURE", message);
}
function id(value: string, name: string): string {
  if (!HEX_ID.test(value))
    runtimeFailure("RUNTIME_CONFLICT", `${name} is invalid`);
  return value.toLowerCase();
}
function at(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    runtimeFailure(
      "RUNTIME_PERSISTENCE_FAILURE",
      "Runtime timestamp is invalid",
    );
  return value;
}
function owner(value: string): string {
  if (!SAFE_OWNER.test(value))
    runtimeFailure("LEASE_LOST", "Worker identity is invalid");
  return value;
}
function json(value: unknown): string {
  try {
    const result = JSON.stringify(value);
    if (result === "undefined" || result.length > 1_048_576)
      fail("Stored JSON is invalid");
    return result;
  } catch (error) {
    fail(error instanceof Error ? error.message : "Stored JSON is invalid");
  }
}
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  fail("Stored JSON is invalid");
}
function parse(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      fail("Stored JSON is invalid");
    }
  }
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string") fail("Stored text is invalid");
  return value;
}
function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}
function integer(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/u.test(value)) {
    const number = Number(value);
    if (Number.isSafeInteger(number)) return number;
  }
  fail("Stored integer is invalid");
}
function nullableInteger(value: unknown): number | null {
  return value === null || value === undefined ? null : integer(value);
}
function eventFor(state: RuntimeState, retryable = false): RuntimeOutboxEvent {
  if (retryable) return "execution.retryable_failure";
  const event = `execution.${state.toLowerCase()}`;
  if (!EVENT_NAMES.includes(event)) fail("No outbox event for runtime state");
  return event as RuntimeOutboxEvent;
}

function covenant(row: Row): RuntimeCovenant {
  const resource = parseCovenantResource(parse(row.resource));
  const projectId = text(row.project_id);
  const covenantId = text(row.covenant_id).toLowerCase();
  assertProjectOwnership(resource, projectId);
  if (resource.id !== covenantId)
    fail("Stored Covenant identity is inconsistent");
  return Object.freeze({
    projectId,
    covenantId,
    resource,
    createdAt: integer(row.created_at),
    updatedAt: integer(row.updated_at),
  });
}
function evidence(value: unknown): AuthorizationEvidenceSubmission | null {
  if (value === null || value === undefined) return null;
  try {
    return authorizationEvidenceSubmissionSchema.parse(parse(value));
  } catch {
    fail("Stored authorization evidence is invalid");
  }
}
function operation(row: Row): RuntimeOperation {
  const state = text(row.state);
  if (!RUNTIME_STATES.includes(state as RuntimeState))
    fail("Stored runtime state is invalid");
  return Object.freeze({
    operationKey: text(row.operation_key),
    projectId: text(row.project_id),
    covenantId: text(row.covenant_id),
    executionId: text(row.execution_id),
    authorizationId: text(row.authorization_id),
    intentId: text(row.intent_id),
    intentHash: text(row.intent_hash),
    amount: text(row.amount),
    beneficiary: text(row.beneficiary),
    state: state as RuntimeState,
    attemptCount: integer(row.attempt_count),
    nextAttemptAt: nullableInteger(row.next_attempt_at),
    lastAttemptAt: nullableInteger(row.last_attempt_at),
    leaseOwner: nullableText(row.lease_owner),
    leaseExpiresAt: nullableInteger(row.lease_expires_at),
    version: integer(row.version),
    submissionBoundary:
      row.submission_boundary === true ||
      row.submission_boundary === 1 ||
      row.submission_boundary === "true",
    providerTransactionId: nullableText(row.provider_transaction_id),
    providerState: nullableText(row.provider_state),
    providerEvidence:
      row.provider_evidence === null || row.provider_evidence === undefined
        ? null
        : parse(row.provider_evidence),
    arcEvidence:
      row.arc_evidence === null || row.arc_evidence === undefined
        ? null
        : parse(row.arc_evidence),
    authorizationEvidence: evidence(row.authorization_evidence),
    retryReason: nullableText(row.retry_reason) as RetryReason | null,
    noResubmitReason: nullableText(
      row.no_resubmit_reason,
    ) as NoResubmitReason | null,
    failureReason: nullableText(row.failure_reason),
    createdAt: integer(row.created_at),
    updatedAt: integer(row.updated_at),
  });
}
function outbox(row: Row): RuntimeOutboxRecord {
  const eventType = text(row.event_type);
  if (!EVENT_NAMES.includes(eventType)) fail("Stored outbox event is invalid");
  return Object.freeze({
    id: integer(row.id),
    operationKey: text(row.operation_key),
    projectId: text(row.project_id),
    covenantId: text(row.covenant_id),
    eventType: eventType as RuntimeOutboxEvent,
    version: integer(row.version),
    payload: parse(row.payload) as Record<string, unknown>,
    createdAt: integer(row.created_at),
    deliveredAt: nullableInteger(row.delivered_at),
  });
}
function project(row: Row): DeveloperProjectRecord {
  return Object.freeze({
    projectId: text(row.project_id),
    name: text(row.name),
    createdAt: integer(row.created_at),
  });
}
function apiKey(row: Row): ApiKeyRecord {
  return Object.freeze({
    keyId: text(row.key_id),
    projectId: text(row.project_id),
    prefix: text(row.public_prefix),
    digest: text(row.digest),
    createdAt: integer(row.created_at),
    revokedAt: nullableInteger(row.revoked_at),
  });
}
function idempotency(row: Row): HttpIdempotencyRecord {
  return Object.freeze({
    projectId: text(row.project_id),
    route: text(row.route),
    keyDigest: text(row.key_digest),
    requestFingerprint: text(row.request_fingerprint),
    responseStatus: nullableInteger(row.response_status),
    responseJson:
      row.response_json == null ? null : json(parse(row.response_json)),
    resourceReference: nullableText(row.resource_reference),
    createdAt: integer(row.created_at),
    updatedAt: integer(row.updated_at),
  });
}
function endpoint(row: Row): WebhookEndpointRecord {
  return Object.freeze({
    endpointId: text(row.endpoint_id),
    projectId: text(row.project_id),
    url: text(row.url),
    secretCiphertext: text(row.secret_ciphertext),
    createdAt: integer(row.created_at),
    revokedAt: nullableInteger(row.revoked_at),
  });
}
function delivery(row: Row): WebhookDeliveryRecord {
  const status = text(row.status) as WebhookDeliveryRecord["status"];
  if (!["PENDING", "RETRYING", "DELIVERED", "FAILED"].includes(status))
    fail("Stored webhook status is invalid");
  return Object.freeze({
    deliveryId: text(row.delivery_id),
    endpointId: text(row.endpoint_id),
    projectId: text(row.project_id),
    eventId: text(row.event_id),
    eventType: text(row.event_type),
    payloadJson: json(parse(row.payload)),
    status,
    attemptCount: integer(row.attempt_count),
    nextAttemptAt: integer(row.next_attempt_at),
    lastAttemptAt: nullableInteger(row.last_attempt_at),
    deliveredAt: nullableInteger(row.delivered_at),
    lastError: nullableText(row.last_error),
    createdAt: integer(row.created_at),
    updatedAt: integer(row.updated_at),
  });
}

/* PostgreSQL timestamp columns are selected as epoch milliseconds.  This
 * keeps the public RuntimeStore contract identical to the SQLite adapter. */
const EPOCH = (name: string): string =>
  `(extract(epoch from ${name})*1000)::bigint`;
const COVENANT_COLUMNS = `project_id,covenant_id,resource,${EPOCH("created_at")} AS created_at,${EPOCH("updated_at")} AS updated_at`;
const OPERATION_COLUMNS = `operation_key,project_id,covenant_id,execution_id,authorization_id,intent_id,intent_hash,amount,beneficiary,state,attempt_count,${EPOCH("next_attempt_at")} AS next_attempt_at,${EPOCH("last_attempt_at")} AS last_attempt_at,lease_owner,${EPOCH("lease_expires_at")} AS lease_expires_at,version,submission_boundary,provider_transaction_id,provider_state,provider_evidence,arc_evidence,authorization_evidence,retry_reason,no_resubmit_reason,failure_reason,${EPOCH("created_at")} AS created_at,${EPOCH("updated_at")} AS updated_at`;
const OUTBOX_COLUMNS = `id,operation_key,project_id,covenant_id,event_type,version,payload,${EPOCH("created_at")} AS created_at,${EPOCH("delivered_at")} AS delivered_at`;
const PROJECT_COLUMNS = `project_id,name,${EPOCH("created_at")} AS created_at`;
const API_KEY_COLUMNS = `key_id,project_id,public_prefix,digest,${EPOCH("created_at")} AS created_at,${EPOCH("revoked_at")} AS revoked_at`;
const IDEMPOTENCY_COLUMNS = `project_id,route,key_digest,request_fingerprint,response_status,response_json,resource_reference,${EPOCH("created_at")} AS created_at,${EPOCH("updated_at")} AS updated_at`;
const ENDPOINT_COLUMNS = `endpoint_id,project_id,url,secret_ciphertext,${EPOCH("created_at")} AS created_at,${EPOCH("revoked_at")} AS revoked_at`;
const DELIVERY_COLUMNS = `delivery_id,endpoint_id,project_id,event_id,event_type,payload,status,attempt_count,${EPOCH("next_attempt_at")} AS next_attempt_at,${EPOCH("last_attempt_at")} AS last_attempt_at,${EPOCH("delivered_at")} AS delivered_at,last_error,${EPOCH("created_at")} AS created_at,${EPOCH("updated_at")} AS updated_at`;

export class PostgresRuntimeStore implements RuntimeStore {
  readonly #client: PostgresQueryClient;
  constructor(options: PostgresRuntimeStoreOptions) {
    this.#client = options.client;
  }
  close(): void {
    this.#client.close?.();
  }
  checkReady(): boolean {
    try {
      this.#client.query("select 1 as ok");
      return true;
    } catch {
      return false;
    }
  }
  #tx<T>(work: (client: PostgresQueryClient) => T): T {
    try {
      return this.#client.transaction(work);
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      runtimeFailure(
        "RUNTIME_PERSISTENCE_FAILURE",
        "Runtime transaction failed",
        error,
      );
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  #one<T extends Row>(
    client: PostgresQueryClient,
    sql: string,
    values: readonly unknown[] = [],
  ): T | undefined {
    return client.query<T>(sql, values).rows[0];
  }
  #operation(
    client: PostgresQueryClient,
    key: string,
  ): RuntimeOperation | undefined {
    const row = this.#one(
      client,
      `select ${OPERATION_COLUMNS} from public.execution_operations where operation_key=$1`,
      [key],
    );
    return row === undefined ? undefined : operation(row);
  }
  #covenant(
    client: PostgresQueryClient,
    projectId: string,
    covenantId: string,
  ): RuntimeCovenant | undefined {
    const row = this.#one(
      client,
      `select ${COVENANT_COLUMNS} from public.covenants where project_id=$1 and covenant_id=$2`,
      [projectId, covenantId],
    );
    return row === undefined ? undefined : covenant(row);
  }
  saveCovenant(
    projectIdInput: string,
    resourceInput: unknown,
    timestamp: number,
  ): RuntimeCovenant {
    const projectId = id(projectIdInput, "projectId");
    const resource = parseCovenantResource(resourceInput);
    assertProjectOwnership(resource, projectId);
    const covenantId = id(resource.id, "covenantId");
    const now = at(timestamp);
    const resourceJson = json(resource);
    return this.#tx((client) => {
      const previous = this.#covenant(client, projectId, covenantId);
      if (previous !== undefined) {
        if (canonicalJson(previous.resource) !== canonicalJson(resource))
          runtimeFailure(
            "RUNTIME_CONFLICT",
            "Covenant projection is immutable once stored",
          );
        return previous;
      }
      client.query(
        "insert into public.covenants(project_id,covenant_id,resource,created_at,updated_at) values($1,$2,$3::jsonb,to_timestamp($4/1000.0),to_timestamp($4/1000.0))",
        [projectId, covenantId, resourceJson, now],
      );
      return this.#covenant(client, projectId, covenantId) ?? fail();
    });
  }
  getCovenant(
    projectIdInput: string,
    covenantIdInput: string,
  ): RuntimeCovenant | undefined {
    return this.#covenant(
      this.#client,
      id(projectIdInput, "projectId"),
      id(covenantIdInput, "covenantId"),
    );
  }
  replaceCovenantProjection(
    projectIdInput: string,
    resourceInput: unknown,
    timestamp: number,
  ): RuntimeCovenant {
    const projectId = id(projectIdInput, "projectId");
    const resource = parseCovenantResource(resourceInput);
    assertProjectOwnership(resource, projectId);
    const covenantId = id(resource.id, "covenantId");
    const now = at(timestamp);
    return this.#tx((client) => {
      const previous = this.#covenant(client, projectId, covenantId);
      if (previous === undefined)
        runtimeFailure(
          "RUNTIME_NOT_FOUND",
          "Covenant projection was not found",
        );
      if (BigInt(resource.updatedAt) < BigInt(previous.resource.updatedAt))
        runtimeFailure(
          "RUNTIME_CONFLICT",
          "Covenant projection cannot move backwards",
        );
      client.query(
        "update public.covenants set resource=$1::jsonb,updated_at=to_timestamp($2/1000.0) where project_id=$3 and covenant_id=$4",
        [json(resource), now, projectId, covenantId],
      );
      return this.#covenant(client, projectId, covenantId) ?? fail();
    });
  }
  saveAuthorizationEvidence(
    projectIdInput: string,
    covenantIdInput: string,
    input: unknown,
    timestamp: number,
  ): AuthorizationEvidenceSubmission {
    const projectId = id(projectIdInput, "projectId");
    const covenantId = id(covenantIdInput, "covenantId");
    const now = at(timestamp);
    let parsed: AuthorizationEvidenceSubmission;
    try {
      parsed = authorizationEvidenceSubmissionSchema.parse(input);
    } catch {
      runtimeFailure(
        "RUNTIME_INVALID_STATE",
        "Authorization evidence is invalid",
      );
    }
    const body = json(parsed);
    return this.#tx((client) => {
      if (this.#covenant(client, projectId, covenantId) === undefined)
        runtimeFailure(
          "RUNTIME_NOT_FOUND",
          "Covenant projection was not found",
        );
      const prior = this.#one<Row>(
        client,
        "select evidence from public.authorization_evidence where project_id=$1 and covenant_id=$2",
        [projectId, covenantId],
      );
      if (prior !== undefined) {
        if (canonicalJson(parse(prior.evidence)) !== canonicalJson(parsed))
          runtimeFailure(
            "RUNTIME_CONFLICT",
            "Authorization evidence is immutable once stored",
          );
        return parsed;
      }
      client.query(
        "insert into public.authorization_evidence(project_id,covenant_id,evidence,created_at,updated_at) values($1,$2,$3::jsonb,to_timestamp($4/1000.0),to_timestamp($4/1000.0))",
        [projectId, covenantId, body, now],
      );
      return parsed;
    });
  }
  getAuthorizationEvidence(
    projectIdInput: string,
    covenantIdInput: string,
  ): AuthorizationEvidenceSubmission | null {
    const row = this.#one<Row>(
      this.#client,
      "select evidence from public.authorization_evidence where project_id=$1 and covenant_id=$2",
      [id(projectIdInput, "projectId"), id(covenantIdInput, "covenantId")],
    );
    return row === undefined ? null : evidence(row.evidence);
  }
  getOperation(input: string): RuntimeOperation | undefined {
    return this.#operation(this.#client, id(input, "operationKey"));
  }
  getOperationByExecution(
    projectIdInput: string,
    executionIdInput: string,
  ): RuntimeOperation | undefined {
    const row = this.#one<Row>(
      this.#client,
      `select ${OPERATION_COLUMNS} from public.execution_operations where project_id=$1 and execution_id=$2`,
      [id(projectIdInput, "projectId"), id(executionIdInput, "executionId")],
    );
    return row === undefined ? undefined : operation(row);
  }
  createOrJoinOperation(
    input: CreateOperationInput,
  ): Readonly<{ operation: RuntimeOperation; joined: boolean }> {
    const projectId = id(input.projectId, "projectId");
    const covenantId = id(input.covenantId, "covenantId");
    const executionId = id(input.executionId, "executionId");
    const operationKey = id(input.operationKey, "operationKey");
    const now = at(input.at);
    if (
      input.resource.id !== covenantId ||
      input.resource.projectId !== projectId
    )
      runtimeFailure(
        "RUNTIME_CONFLICT",
        "Operation does not belong to the Covenant project",
      );
    let auth: AuthorizationEvidenceSubmission | null = null;
    if (input.authorizationEvidence != null) {
      try {
        auth = authorizationEvidenceSubmissionSchema.parse(
          input.authorizationEvidence,
        );
      } catch {
        runtimeFailure(
          "RUNTIME_INVALID_STATE",
          "Authorization evidence is invalid",
        );
      }
    }
    return this.#tx((client) => {
      const existing = this.#operation(client, operationKey);
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
          canonicalJson(existing.authorizationEvidence) !== canonicalJson(auth)
        )
          runtimeFailure(
            "RUNTIME_CONFLICT",
            "Execution identity or financial intent conflicts",
          );
        return { operation: existing, joined: true };
      }
      const byExecution = this.getOperationByExecutionIn(
        client,
        projectId,
        executionId,
      );
      if (
        byExecution !== undefined &&
        byExecution.operationKey !== operationKey
      )
        runtimeFailure(
          "RUNTIME_CONFLICT",
          "Execution identity already belongs to another operation",
        );
      const cov = this.#covenant(client, projectId, covenantId);
      if (cov === undefined)
        runtimeFailure(
          "RUNTIME_NOT_FOUND",
          "Covenant projection was not found",
        );
      if (cov.resource.status !== "AUTHORIZED")
        runtimeFailure(
          "RUNTIME_CONFLICT",
          "Covenant is not available for a new execution",
        );
      client.query(
        "update public.covenants set resource=$1::jsonb,updated_at=to_timestamp($2/1000.0) where project_id=$3 and covenant_id=$4",
        [json(input.resource), now, projectId, covenantId],
      );
      client.query(
        "insert into public.execution_operations(operation_key,project_id,covenant_id,execution_id,authorization_id,intent_id,intent_hash,amount,beneficiary,state,attempt_count,version,submission_boundary,authorization_evidence,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'QUEUED',0,0,false,$10::jsonb,to_timestamp($11/1000.0),to_timestamp($11/1000.0))",
        [
          operationKey,
          projectId,
          covenantId,
          executionId,
          input.authorizationId,
          input.intentId,
          input.intentHash,
          input.amount,
          input.beneficiary,
          auth === null ? null : json(auth),
          now,
        ],
      );
      client.query(
        "insert into public.runtime_outbox(operation_key,project_id,covenant_id,event_type,version,payload,created_at) values($1,$2,$3,$4,0,$5::jsonb,to_timestamp($6/1000.0))",
        [
          operationKey,
          projectId,
          covenantId,
          eventFor("QUEUED"),
          json({
            operationKey,
            projectId,
            covenantId,
            executionId,
            state: "QUEUED",
          }),
          now,
        ],
      );
      const next = this.#operation(client, operationKey);
      if (next === undefined) fail();
      return { operation: next, joined: false };
    });
  }
  private getOperationByExecutionIn(
    client: PostgresQueryClient,
    projectId: string,
    executionId: string,
  ): RuntimeOperation | undefined {
    const row = this.#one<Row>(
      client,
      `select ${OPERATION_COLUMNS} from public.execution_operations where project_id=$1 and execution_id=$2`,
      [projectId, executionId],
    );
    return row === undefined ? undefined : operation(row);
  }
  #requireLease(
    client: PostgresQueryClient,
    key: string,
    workerId: string,
    version: number,
    now: number,
  ): RuntimeOperation {
    const current = this.#operation(client, key);
    if (current === undefined)
      runtimeFailure("RUNTIME_NOT_FOUND", "Execution operation was not found");
    if (
      current.leaseOwner !== workerId ||
      current.version !== version ||
      current.leaseExpiresAt === null ||
      current.leaseExpiresAt <= now
    )
      runtimeFailure("LEASE_LOST", "Worker lease is stale or expired");
    return current;
  }
  claimOperation(
    operationKeyInput: string,
    workerIdInput: string,
    timestamp: number,
    leaseMs = 30_000,
  ): RuntimeOperation | undefined {
    const key = id(operationKeyInput, "operationKey");
    const workerId = owner(workerIdInput);
    const now = at(timestamp);
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0 || leaseMs > 86_400_000)
      runtimeFailure("LEASE_LOST", "Lease duration is invalid");
    return this.#tx((client) => {
      const current = this.#operation(client, key);
      if (current === undefined) return undefined;
      if (
        (TERMINAL_RUNTIME_STATES as readonly string[]).includes(current.state)
      )
        return current;
      if (
        (current.leaseExpiresAt !== null && current.leaseExpiresAt > now) ||
        (current.nextAttemptAt !== null && current.nextAttemptAt > now)
      )
        return undefined;
      const updated = client.query(
        "update public.execution_operations set lease_owner=$1,lease_expires_at=to_timestamp($2/1000.0),version=version+1,updated_at=to_timestamp($3/1000.0) where operation_key=$4 and version=$5 and (lease_expires_at is null or lease_expires_at<=to_timestamp($3/1000.0)) returning *",
        [workerId, now + leaseMs, now, key, current.version],
      ).rows[0];
      return updated === undefined
        ? undefined
        : operation({
            ...updated,
            ...this.#one<Row>(
              client,
              `select ${OPERATION_COLUMNS} from public.execution_operations where operation_key=$1`,
              [key],
            ),
          });
    });
  }
  renewLease(
    operationKeyInput: string,
    workerIdInput: string,
    expectedVersion: number,
    timestamp: number,
    leaseMs = 30_000,
  ): RuntimeOperation {
    const key = id(operationKeyInput, "operationKey");
    const workerId = owner(workerIdInput);
    const now = at(timestamp);
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0 || leaseMs > 86_400_000)
      runtimeFailure("LEASE_LOST", "Lease duration is invalid");
    return this.#tx((client) => {
      this.#requireLease(client, key, workerId, expectedVersion, now);
      const result = client.query(
        "update public.execution_operations set lease_expires_at=to_timestamp($1/1000.0),version=version+1,updated_at=to_timestamp($2/1000.0) where operation_key=$3 and version=$4 and lease_owner=$5 returning version",
        [now + leaseMs, now, key, expectedVersion, workerId],
      ).rows[0];
      if (result === undefined) runtimeFailure("LEASE_LOST");
      return this.#operation(client, key) ?? fail();
    });
  }
  releaseLease(
    operationKeyInput: string,
    workerIdInput: string,
    expectedVersion: number,
    timestamp: number,
  ): RuntimeOperation {
    const key = id(operationKeyInput, "operationKey");
    const workerId = owner(workerIdInput);
    const now = at(timestamp);
    return this.#tx((client) => {
      this.#requireLease(client, key, workerId, expectedVersion, now);
      const result = client.query(
        "update public.execution_operations set lease_owner=null,lease_expires_at=null,version=version+1,updated_at=to_timestamp($1/1000.0) where operation_key=$2 and version=$3 and lease_owner=$4 returning version",
        [now, key, expectedVersion, workerId],
      ).rows[0];
      if (result === undefined) runtimeFailure("LEASE_LOST");
      return this.#operation(client, key) ?? fail();
    });
  }
  recoverExpiredLeases(timestamp: number): RuntimeOperation[] {
    const now = at(timestamp);
    return this.#tx((client) => {
      const rows = client.query<Row>(
        `select ${OPERATION_COLUMNS} from public.execution_operations where lease_owner is not null and lease_expires_at<=to_timestamp($1/1000.0) and state not in ('SUCCEEDED','TERMINAL_FAILED') for update`,
        [now],
      ).rows;
      const recovered: RuntimeOperation[] = [];
      for (const row of rows) {
        const current = operation(row);
        const postBoundary =
          current.submissionBoundary ||
          [
            "SUBMISSION_STARTED",
            "SUBMITTED",
            "AMBIGUOUS",
            "RECONCILING",
          ].includes(current.state);
        const state = postBoundary ? "AMBIGUOUS" : "QUEUED";
        const reason = postBoundary ? "CRASH_AFTER_BOUNDARY" : null;
        client.query(
          "update public.execution_operations set state=$1,lease_owner=null,lease_expires_at=null,version=version+1,no_resubmit_reason=$2,updated_at=to_timestamp($3/1000.0) where operation_key=$4 and version=$5",
          [state, reason, now, current.operationKey, current.version],
        );
        const version = current.version + 1;
        client.query(
          "insert into public.runtime_outbox(operation_key,project_id,covenant_id,event_type,version,payload,created_at) values($1,$2,$3,$4,$5,$6::jsonb,to_timestamp($7/1000.0)) on conflict do nothing",
          [
            current.operationKey,
            current.projectId,
            current.covenantId,
            eventFor(state),
            version,
            json({
              operationKey: current.operationKey,
              projectId: current.projectId,
              covenantId: current.covenantId,
              state,
              noResubmit: postBoundary,
            }),
            now,
          ],
        );
        const next = this.#operation(client, current.operationKey);
        if (next !== undefined) recovered.push(next);
      }
      return recovered;
    });
  }
  #transition(
    client: PostgresQueryClient,
    key: string,
    workerId: string,
    expectedVersion: number,
    nextState: RuntimeState,
    now: number,
    patch: OperationPatch,
  ): RuntimeOperation {
    if (!RUNTIME_STATES.includes(nextState))
      runtimeFailure("RUNTIME_INVALID_STATE");
    const current = this.#requireLease(
      client,
      key,
      workerId,
      expectedVersion,
      now,
    );
    if ((TERMINAL_RUNTIME_STATES as readonly string[]).includes(current.state))
      runtimeFailure("RUNTIME_TERMINAL");
    const nextVersion = current.version + 1;
    const attemptCount = patch.attemptCount ?? current.attemptCount;
    const submissionBoundary =
      patch.submissionBoundary ?? current.submissionBoundary;
    const providerEvidence =
      patch.providerEvidence === undefined
        ? current.providerEvidence
        : patch.providerEvidence;
    const arcEvidence =
      patch.arcEvidence === undefined ? current.arcEvidence : patch.arcEvidence;
    const failureReason =
      patch.failureReason === undefined
        ? current.failureReason
        : patch.failureReason;
    const result = client.query(
      "update public.execution_operations set state=$1,attempt_count=$2,next_attempt_at=case when $3::bigint is null then null else to_timestamp($3::bigint/1000.0) end,last_attempt_at=to_timestamp($4/1000.0),version=$5,submission_boundary=$6,provider_transaction_id=$7,provider_state=$8,provider_evidence=$9::jsonb,arc_evidence=$10::jsonb,retry_reason=$11,no_resubmit_reason=$12,failure_reason=$13,updated_at=to_timestamp($4/1000.0) where operation_key=$14 and version=$15 and lease_owner=$16 returning version",
      [
        nextState,
        attemptCount,
        patch.nextAttemptAt ?? null,
        now,
        nextVersion,
        submissionBoundary,
        patch.providerTransactionId === undefined
          ? current.providerTransactionId
          : patch.providerTransactionId,
        patch.providerState === undefined
          ? current.providerState
          : patch.providerState,
        providerEvidence == null ? null : json(providerEvidence),
        arcEvidence == null ? null : json(arcEvidence),
        patch.retryReason === undefined
          ? current.retryReason
          : patch.retryReason,
        patch.noResubmitReason === undefined
          ? current.noResubmitReason
          : patch.noResubmitReason,
        failureReason,
        key,
        expectedVersion,
        workerId,
      ],
    ).rows[0];
    if (result === undefined) runtimeFailure("LEASE_LOST");
    const next = this.#operation(client, key);
    if (next === undefined) fail();
    const retryable =
      nextState === "QUEUED" &&
      patch.retryReason !== undefined &&
      patch.retryReason !== null;
    client.query(
      "insert into public.runtime_outbox(operation_key,project_id,covenant_id,event_type,version,payload,created_at) values($1,$2,$3,$4,$5,$6::jsonb,to_timestamp($7/1000.0)) on conflict do nothing",
      [
        next.operationKey,
        next.projectId,
        next.covenantId,
        eventFor(nextState, retryable),
        nextVersion,
        json({
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
      ],
    );
    return next;
  }
  transitionLeased(
    operationKeyInput: string,
    workerIdInput: string,
    expectedVersion: number,
    nextState: RuntimeState,
    timestamp: number,
    patch: OperationPatch = {},
  ): RuntimeOperation {
    return this.#tx((client) =>
      this.#transition(
        client,
        id(operationKeyInput, "operationKey"),
        owner(workerIdInput),
        expectedVersion,
        nextState,
        at(timestamp),
        patch,
      ),
    );
  }
  updateCovenantAndOperation(
    operationKeyInput: string,
    workerIdInput: string,
    expectedVersion: number,
    resource: PlatformCovenant,
    operationState: RuntimeState,
    timestamp: number,
    patch: OperationPatch = {},
  ): Readonly<{ covenant: RuntimeCovenant; operation: RuntimeOperation }> {
    const key = id(operationKeyInput, "operationKey");
    const workerId = owner(workerIdInput);
    const now = at(timestamp);
    return this.#tx((client) => {
      const current = this.#requireLease(
        client,
        key,
        workerId,
        expectedVersion,
        now,
      );
      if (
        resource.id !== current.covenantId ||
        resource.projectId !== current.projectId
      )
        runtimeFailure("RUNTIME_CONFLICT");
      parseCovenantResource(resource);
      const next = this.#transition(
        client,
        key,
        workerId,
        expectedVersion,
        operationState,
        now,
        patch,
      );
      client.query(
        "update public.covenants set resource=$1::jsonb,updated_at=to_timestamp($2/1000.0) where project_id=$3 and covenant_id=$4",
        [json(resource), now, current.projectId, current.covenantId],
      );
      return {
        operation: next,
        covenant:
          this.#covenant(client, current.projectId, current.covenantId) ??
          fail(),
      };
    });
  }
  listOutbox(
    options: Readonly<{ undeliveredOnly?: boolean; limit?: number }> = {},
  ): RuntimeOutboxRecord[] {
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1000)
      runtimeFailure("RUNTIME_PERSISTENCE_FAILURE", "Outbox limit is invalid");
    const where =
      options.undeliveredOnly === false ? "" : "where delivered_at is null";
    return this.#client
      .query<Row>(
        `select ${OUTBOX_COLUMNS} from public.runtime_outbox ${where} order by id limit $1`,
        [limit],
      )
      .rows.map(outbox);
  }
  markOutboxDelivered(
    idInput: number,
    timestamp: number,
  ): RuntimeOutboxRecord | undefined {
    const idValue = integer(idInput);
    if (idValue <= 0) runtimeFailure("RUNTIME_PERSISTENCE_FAILURE");
    const now = at(timestamp);
    this.#client.query(
      "update public.runtime_outbox set delivered_at=to_timestamp($1/1000.0) where id=$2 and delivered_at is null",
      [now, idValue],
    );
    const row = this.#one<Row>(
      this.#client,
      `select ${OUTBOX_COLUMNS} from public.runtime_outbox where id=$1`,
      [idValue],
    );
    return row === undefined ? undefined : outbox(row);
  }
  ensureDeveloperProject(
    projectIdInput: string,
    nameInput: string,
    timestamp: number,
  ): DeveloperProjectRecord {
    const projectId = id(projectIdInput, "projectId");
    const name = nameInput.trim().slice(0, 128);
    if (name.length === 0)
      runtimeFailure("RUNTIME_INVALID_STATE", "Project name is required");
    const now = at(timestamp);
    this.#client.query(
      "insert into public.developer_projects(project_id,name,created_at) values($1,$2,to_timestamp($3/1000.0)) on conflict(project_id) do nothing",
      [projectId, name, now],
    );
    return project(
      this.#one<Row>(
        this.#client,
        `select ${PROJECT_COLUMNS} from public.developer_projects where project_id=$1`,
        [projectId],
      ) ?? fail(),
    );
  }
  getDeveloperProject(
    projectIdInput: string,
  ): DeveloperProjectRecord | undefined {
    const row = this.#one<Row>(
      this.#client,
      `select ${PROJECT_COLUMNS} from public.developer_projects where project_id=$1`,
      [id(projectIdInput, "projectId")],
    );
    return row === undefined ? undefined : project(row);
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
    if (
      !/^[A-Za-z0-9._:-]{1,128}$/u.test(input.keyId) ||
      !/^cov_test_[A-Za-z0-9_-]{8,}$/u.test(input.prefix) ||
      !/^[0-9a-f]{64}$/u.test(input.digest)
    )
      runtimeFailure("RUNTIME_INVALID_STATE", "API key identity is invalid");
    const projectId = id(input.projectId, "projectId");
    this.#client.query(
      "insert into public.api_keys(key_id,project_id,public_prefix,digest,created_at) values($1,$2,$3,$4,to_timestamp($5/1000.0))",
      [input.keyId, projectId, input.prefix, input.digest, at(input.at)],
    );
    return apiKey(
      this.#one<Row>(
        this.#client,
        `select ${API_KEY_COLUMNS} from public.api_keys where key_id=$1`,
        [input.keyId],
      ) ?? fail(),
    );
  }
  findApiKeyCandidates(prefix: string): ApiKeyRecord[] {
    return this.#client
      .query<Row>(
        `select ${API_KEY_COLUMNS} from public.api_keys where public_prefix=$1`,
        [prefix.trim()],
      )
      .rows.map(apiKey);
  }
  listApiKeys(projectIdInput: string): ApiKeyRecord[] {
    return this.#client
      .query<Row>(
        `select ${API_KEY_COLUMNS} from public.api_keys where project_id=$1 order by created_at,key_id`,
        [id(projectIdInput, "projectId")],
      )
      .rows.map(apiKey);
  }
  revokeApiKey(
    projectIdInput: string,
    keyIdInput: string,
    timestamp: number,
  ): ApiKeyRecord | undefined {
    const projectId = id(projectIdInput, "projectId");
    this.#client.query(
      "update public.api_keys set revoked_at=to_timestamp($1/1000.0) where project_id=$2 and key_id=$3 and revoked_at is null",
      [at(timestamp), projectId, keyIdInput],
    );
    const row = this.#one<Row>(
      this.#client,
      `select ${API_KEY_COLUMNS} from public.api_keys where project_id=$1 and key_id=$2`,
      [projectId, keyIdInput],
    );
    return row === undefined ? undefined : apiKey(row);
  }
  listCovenants(
    projectIdInput: string,
    options: Readonly<{ limit?: number; after?: string }> = {},
  ): Readonly<{ items: RuntimeCovenant[]; nextAfter: string | null }> {
    const projectId = id(projectIdInput, "projectId");
    const limit = options.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100)
      runtimeFailure(
        "RUNTIME_PERSISTENCE_FAILURE",
        "Covenant limit is invalid",
      );
    const values: unknown[] = [projectId];
    const cursor =
      options.after === undefined ? null : id(options.after, "cursor");
    const predicate =
      cursor === null
        ? ""
        : "and (created_at,covenant_id) > (select created_at,covenant_id from public.covenants where project_id=$2 and covenant_id=$3)";
    if (cursor !== null) values.push(projectId, cursor);
    values.push(limit + 1);
    const rows = this.#client
      .query<Row>(
        `select ${COVENANT_COLUMNS} from public.covenants where project_id=$1 ${predicate} order by created_at,covenant_id limit $${String(values.length)}`,
        values,
      )
      .rows.map(covenant);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    return {
      items,
      nextAfter: hasMore ? (items.at(-1)?.covenantId ?? null) : null,
    };
  }
  getHttpIdempotency(
    projectIdInput: string,
    route: string,
    keyDigest: string,
  ): HttpIdempotencyRecord | undefined {
    const row = this.#one<Row>(
      this.#client,
      `select ${IDEMPOTENCY_COLUMNS} from public.http_idempotency where project_id=$1 and route=$2 and key_digest=$3`,
      [id(projectIdInput, "projectId"), route, keyDigest],
    );
    return row === undefined ? undefined : idempotency(row);
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
    const projectId = id(input.projectId, "projectId");
    const now = at(input.at);
    return this.#tx((client) => {
      const existing = this.#one<Row>(
        client,
        "select request_fingerprint from public.http_idempotency where project_id=$1 and route=$2 and key_digest=$3 for update",
        [projectId, input.route, input.keyDigest],
      );
      if (
        existing !== undefined &&
        text(existing.request_fingerprint) !== input.requestFingerprint
      )
        runtimeFailure(
          "RUNTIME_CONFLICT",
          "Idempotency key was used with a different request",
        );
      client.query(
        "insert into public.http_idempotency(project_id,route,key_digest,request_fingerprint,response_status,response_json,resource_reference,created_at,updated_at) values($1,$2,$3,$4,$5,$6::jsonb,$7,to_timestamp($8/1000.0),to_timestamp($8/1000.0)) on conflict(project_id,route,key_digest) do update set response_status=excluded.response_status,response_json=excluded.response_json,resource_reference=excluded.resource_reference,updated_at=excluded.updated_at",
        [
          projectId,
          input.route,
          input.keyDigest,
          input.requestFingerprint,
          input.responseStatus ?? null,
          input.responseJson ?? null,
          input.resourceReference ?? null,
          now,
        ],
      );
      return idempotency(
        this.#one<Row>(
          client,
          `select ${IDEMPOTENCY_COLUMNS} from public.http_idempotency where project_id=$1 and route=$2 and key_digest=$3`,
          [projectId, input.route, input.keyDigest],
        ) ?? fail(),
      );
    });
  }
  deleteHttpIdempotency(
    projectIdInput: string,
    route: string,
    keyDigest: string,
  ): void {
    this.#client.query(
      "delete from public.http_idempotency where project_id=$1 and route=$2 and key_digest=$3 and response_status is null",
      [id(projectIdInput, "projectId"), route, keyDigest],
    );
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
    const projectId = id(input.projectId, "projectId");
    this.#client.query(
      "insert into public.webhook_endpoints(endpoint_id,project_id,url,secret_ciphertext,created_at) values($1,$2,$3,$4,to_timestamp($5/1000.0))",
      [
        input.endpointId,
        projectId,
        input.url,
        input.secretCiphertext,
        at(input.at),
      ],
    );
    return endpoint(
      this.#one<Row>(
        this.#client,
        `select ${ENDPOINT_COLUMNS} from public.webhook_endpoints where endpoint_id=$1`,
        [input.endpointId],
      ) ?? fail(),
    );
  }
  getWebhookEndpoint(
    projectIdInput: string,
    endpointId: string,
  ): WebhookEndpointRecord | undefined {
    const row = this.#one<Row>(
      this.#client,
      `select ${ENDPOINT_COLUMNS} from public.webhook_endpoints where project_id=$1 and endpoint_id=$2`,
      [id(projectIdInput, "projectId"), endpointId],
    );
    return row === undefined ? undefined : endpoint(row);
  }
  listWebhookEndpoints(projectIdInput: string): WebhookEndpointRecord[] {
    return this.#client
      .query<Row>(
        `select ${ENDPOINT_COLUMNS} from public.webhook_endpoints where project_id=$1 and revoked_at is null order by created_at,endpoint_id`,
        [id(projectIdInput, "projectId")],
      )
      .rows.map(endpoint);
  }
  revokeWebhookEndpoint(
    projectIdInput: string,
    endpointId: string,
    timestamp: number,
  ): WebhookEndpointRecord | undefined {
    const projectId = id(projectIdInput, "projectId");
    this.#client.query(
      "update public.webhook_endpoints set revoked_at=to_timestamp($1/1000.0) where project_id=$2 and endpoint_id=$3 and revoked_at is null",
      [at(timestamp), projectId, endpointId],
    );
    return this.getWebhookEndpoint(projectId, endpointId);
  }
  createWebhookDelivery(
    input: CreateWebhookDeliveryInput,
  ): WebhookDeliveryRecord {
    const projectId = id(input.projectId, "projectId");
    const now = at(input.at);
    this.#client.query(
      "insert into public.webhook_deliveries(delivery_id,endpoint_id,project_id,event_id,event_type,payload,status,attempt_count,next_attempt_at,created_at,updated_at) values($1,$2,$3,$4,$5,$6::jsonb,'PENDING',0,to_timestamp($7/1000.0),to_timestamp($7/1000.0),to_timestamp($7/1000.0)) on conflict(endpoint_id,event_id) do nothing",
      [
        input.deliveryId,
        input.endpointId,
        projectId,
        input.eventId,
        input.eventType,
        input.payloadJson,
        now,
      ],
    );
    const row =
      this.#one<Row>(
        this.#client,
        `select ${DELIVERY_COLUMNS} from public.webhook_deliveries where delivery_id=$1`,
        [input.deliveryId],
      ) ??
      this.#one<Row>(
        this.#client,
        `select ${DELIVERY_COLUMNS} from public.webhook_deliveries where endpoint_id=$1 and event_id=$2`,
        [input.endpointId, input.eventId],
      );
    return row === undefined ? fail() : delivery(row);
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
    const values: unknown[] = [];
    const filters = ["status in ('PENDING','RETRYING')"];
    if (options.projectId !== undefined) {
      values.push(id(options.projectId, "projectId"));
      filters.push(`project_id=$${String(values.length)}`);
    }
    if (options.dueAt !== undefined) {
      values.push(at(options.dueAt));
      filters.push(
        `next_attempt_at<=to_timestamp($${String(values.length)}/1000.0)`,
      );
    }
    values.push(limit);
    return this.#client
      .query<Row>(
        `select ${DELIVERY_COLUMNS} from public.webhook_deliveries where ${filters.join(" and ")} order by created_at,delivery_id limit $${String(values.length)}`,
        values,
      )
      .rows.map(delivery);
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
    this.#client.query(
      "update public.webhook_deliveries set status=$1,attempt_count=$2,next_attempt_at=to_timestamp($3/1000.0),last_attempt_at=to_timestamp($4/1000.0),delivered_at=case when $5::bigint is null then null else to_timestamp($5::bigint/1000.0) end,last_error=$6,updated_at=to_timestamp($7/1000.0) where delivery_id=$8",
      [
        input.status,
        input.attemptCount,
        at(input.nextAttemptAt),
        at(input.lastAttemptAt),
        input.deliveredAt == null ? null : at(input.deliveredAt),
        input.lastError ?? null,
        at(input.at),
        input.deliveryId,
      ],
    );
    const row = this.#one<Row>(
      this.#client,
      `select ${DELIVERY_COLUMNS} from public.webhook_deliveries where delivery_id=$1`,
      [input.deliveryId],
    );
    return row === undefined ? undefined : delivery(row);
  }
}
