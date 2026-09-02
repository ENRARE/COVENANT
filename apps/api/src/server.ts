import { createHash, randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  cancelCovenant,
  createCovenant,
  requestAuthorization,
  type PlatformCovenant,
} from "@covenant/core";
import { DurableExecutionRuntime } from "@covenant/runtime";
import { ApiError, apiError, mapError } from "./errors.js";
import { ApiKeyService } from "./api-keys.js";
import { canonicalJson } from "./canonical-json.js";
import {
  createCovenantRequestSchema,
  emptyMutationSchema,
  paginationSchema,
  webhookEndpointRequestSchema,
} from "./schemas.js";
import { WebhookService } from "./webhooks.js";

export type ApiRequest = Readonly<{
  method: string;
  path: string;
  headers?: Readonly<Record<string, string | undefined>>;
  body?: unknown;
}>;
export type ApiResponse = Readonly<{
  status: number;
  headers: Readonly<Record<string, string>>;
  body: unknown;
}>;
export type CovenantApiOptions = Readonly<{
  runtime: DurableExecutionRuntime;
  now?: () => number;
  webhookMasterKey?: Uint8Array | string;
  webhookSender?: ConstructorParameters<typeof WebhookService>[0]["sender"];
}>;

function id(): `0x${string}` {
  return `0x${randomBytes(32).toString("hex")}`;
}
function requestId(): string {
  return `req_${randomBytes(12).toString("base64url")}`;
}
function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function nowSeconds(now: () => number): string {
  return String(Math.floor(now() / 1000));
}
function header(
  headers: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const wanted = name.toLowerCase();
  const value = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === wanted,
  )?.[1];
  return value?.trim() ?? undefined;
}

function publicCovenant(resource: PlatformCovenant): Record<string, unknown> {
  return {
    id: resource.id,
    projectId: resource.projectId,
    version: resource.version,
    status: resource.status,
    payer: resource.payer,
    beneficiary: resource.beneficiary,
    amount: resource.amount,
    asset: resource.asset,
    network: resource.network,
    conditions: resource.conditions,
    authorizationStatus: resource.authorizationStatus,
    executionStatus: resource.executionStatus,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
    expiresAt: resource.expiresAt,
    auditReference: resource.auditReference,
  };
}

function publicOperation(
  operation: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    id: operation.executionId,
    executionId: operation.executionId,
    operationKey: operation.operationKey,
    projectId: operation.projectId,
    covenantId: operation.covenantId,
    status: operation.state,
    attemptCount: operation.attemptCount,
    submissionBoundary: operation.submissionBoundary,
    provider: {
      status: operation.providerState,
      transactionId: operation.providerTransactionId,
    },
    arc:
      operation.arcEvidence === null
        ? { status: "NOT_OBSERVED" }
        : operation.arcEvidence,
    createdAt: String(operation.createdAt),
    updatedAt: String(operation.updatedAt),
  };
}

export class CovenantApi {
  readonly #runtime: DurableExecutionRuntime;
  readonly #now: () => number;
  readonly #keys: ApiKeyService;
  readonly #webhooks: WebhookService;

  constructor(options: CovenantApiOptions) {
    this.#runtime = options.runtime;
    this.#now = options.now ?? (() => Date.now());
    this.#keys = new ApiKeyService(options.runtime.store, this.#now);
    this.#webhooks = new WebhookService({
      runtime: options.runtime,
      ...(options.webhookMasterKey === undefined
        ? {}
        : { webhookMasterKey: options.webhookMasterKey }),
      ...(options.webhookSender === undefined
        ? {}
        : { sender: options.webhookSender }),
      now: this.#now,
    });
  }

  provisionProject(name?: string) {
    return this.#keys.provisionProject(name);
  }
  createApiKey(projectId: string) {
    return this.#keys.createKey(projectId);
  }
  get webhooks(): WebhookService {
    return this.#webhooks;
  }

  async handle(input: ApiRequest): Promise<ApiResponse> {
    const rid = requestId();
    const headers = input.headers ?? {};
    try {
      const url = new URL(input.path, "http://covenant.local");
      const method = input.method.toUpperCase();
      if (method === "GET" && url.pathname === "/health") {
        return this.response(
          200,
          { ok: true, service: "covenant-api", version: "v1" },
          rid,
        );
      }
      if (!url.pathname.startsWith("/v1/"))
        apiError("not_found", "NOT_FOUND", "Route was not found.", 404);
      const presentedKey =
        header(headers, "x-api-key") ??
        (() => {
          const auth = header(headers, "authorization");
          return auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
        })();
      let identity;
      try {
        identity = this.#keys.authenticate(presentedKey);
      } catch (error) {
        if (error instanceof Error && error.message === "REVOKED_API_KEY")
          apiError(
            "unauthorized",
            "API_KEY_REVOKED",
            "API key has been revoked.",
            401,
          );
        apiError(
          "unauthorized",
          "UNAUTHORIZED",
          "A valid Covenant API key is required.",
          401,
        );
      }
      const projectId = identity.projectId;
      const body = input.body ?? {};
      const route = url.pathname;
      const idemKey = header(headers, "idempotency-key");
      const mutation = method === "POST" || method === "DELETE";
      const run = (): Promise<Readonly<{ status: number; body: unknown }>> =>
        Promise.resolve(this.route(method, url, projectId, body));
      let result: Readonly<{ status: number; body: unknown }>;
      // Credential creation responses contain a one-time plaintext secret/key;
      // they are deliberately not persisted in the HTTP idempotency table.
      const idempotentMutation =
        mutation &&
        idemKey !== undefined &&
        route !== "/v1/api-keys" &&
        route !== "/v1/webhook-endpoints";
      if (idempotentMutation) {
        if (idemKey.length < 1 || idemKey.length > 256)
          apiError(
            "invalid_request",
            "INVALID_IDEMPOTENCY_KEY",
            "Idempotency-Key is invalid.",
            400,
          );
        const keyDigest = sha256(idemKey);
        const fingerprint = sha256(canonicalJson(body));
        const previous = this.#runtime.store.getHttpIdempotency(
          projectId,
          route,
          keyDigest,
        );
        if (previous !== undefined) {
          if (previous.requestFingerprint !== fingerprint)
            apiError(
              "conflict",
              "IDEMPOTENCY_CONFLICT",
              "Idempotency-Key was already used with a different request.",
              409,
            );
          if (
            previous.responseStatus !== null &&
            previous.responseJson !== null
          )
            return this.response(
              previous.responseStatus,
              JSON.parse(previous.responseJson),
              rid,
            );
        } else {
          this.#runtime.store.saveHttpIdempotency({
            projectId,
            route,
            keyDigest,
            requestFingerprint: fingerprint,
            at: this.#now(),
          });
        }
        try {
          result = await run();
        } catch (error) {
          this.#runtime.store.deleteHttpIdempotency(
            projectId,
            route,
            keyDigest,
          );
          throw error;
        }
        this.#runtime.store.saveHttpIdempotency({
          projectId,
          route,
          keyDigest,
          requestFingerprint: fingerprint,
          responseStatus: result.status,
          responseJson: JSON.stringify(result.body),
          resourceReference:
            typeof result.body === "object" &&
            result.body !== null &&
            "id" in result.body
              ? String(result.body.id)
              : null,
          at: this.#now(),
        });
      } else {
        result = await run();
      }
      return this.response(result.status, result.body, rid);
    } catch (error) {
      const mapped = mapError(error);
      return this.response(
        mapped.status,
        {
          error: {
            type: mapped.type,
            code: mapped.code,
            message: mapped.message,
            requestId: rid,
          },
        },
        rid,
      );
    }
  }

  private response(status: number, body: unknown, rid: string): ApiResponse {
    return {
      status,
      headers: { "content-type": "application/json", "x-request-id": rid },
      body,
    };
  }

  private route(
    method: string,
    url: URL,
    projectId: string,
    body: unknown,
  ): Readonly<{ status: number; body: unknown }> {
    const path = url.pathname;
    if (method === "POST" && path === "/v1/covenants") {
      const input = createCovenantRequestSchema.parse(body);
      const at = input.createdAt ?? nowSeconds(this.#now);
      const resource = createCovenant({
        version: "2",
        id: input.id ?? id(),
        projectId,
        payer: input.payer,
        beneficiary: input.beneficiary,
        asset: {
          symbol: "USDC",
          decimals: 6,
          address: "0x3600000000000000000000000000000000000000",
        },
        amount: input.amount,
        network: { id: "arc-testnet", chainId: "5042002" },
        conditions: input.conditions ?? input.policy,
        createdAt: at,
        expiresAt: input.expiresAt,
        auditReference: input.auditReference,
      });
      this.#runtime.saveCovenant(projectId, resource);
      this.#webhooks.emitEvent(
        projectId,
        "covenant.created",
        publicCovenant(resource),
        `covenant_${resource.id}`,
      );
      return { status: 201, body: publicCovenant(resource) };
    }
    if (method === "GET" && path === "/v1/covenants") {
      const page = paginationSchema.parse({
        limit: url.searchParams.get("limit") ?? undefined,
        after: url.searchParams.get("after") ?? undefined,
      });
      const result = this.#runtime.store.listCovenants(projectId, {
        limit: page.limit,
        ...(page.after === undefined ? {} : { after: page.after }),
      });
      return {
        status: 200,
        body: {
          data: result.items.map((item) => publicCovenant(item.resource)),
          pagination: { nextCursor: result.nextAfter },
        },
      };
    }
    const covenantMatch =
      /^\/v1\/covenants\/(0x[0-9a-fA-F]{64})(?:\/(authorize|execute|cancel|audit))?$/u.exec(
        path,
      );
    if (covenantMatch !== null) {
      const covenantIdValue = covenantMatch[1];
      if (covenantIdValue === undefined)
        apiError(
          "not_found",
          "COVENANT_NOT_FOUND",
          "Covenant was not found.",
          404,
        );
      const covenantId = covenantIdValue.toLowerCase();
      const action = covenantMatch[2];
      const projection = this.#runtime.store.getCovenant(projectId, covenantId);
      if (projection === undefined)
        apiError(
          "not_found",
          "COVENANT_NOT_FOUND",
          "Covenant was not found.",
          404,
        );
      if (action === undefined && method === "GET")
        return { status: 200, body: publicCovenant(projection.resource) };
      if (action === "authorize" && method === "POST") {
        emptyMutationSchema.parse(body);
        const next = requestAuthorization(
          projection.resource,
          nowSeconds(this.#now),
        );
        this.#runtime.store.replaceCovenantProjection(
          projectId,
          next,
          this.#now(),
        );
        this.#webhooks.emitEvent(
          projectId,
          "covenant.authorized",
          publicCovenant(next),
          `covenant_authorization_requested_${next.id}`,
        );
        return { status: 202, body: publicCovenant(next) };
      }
      if (action === "cancel" && method === "POST") {
        emptyMutationSchema.parse(body);
        const next = cancelCovenant(projection.resource, nowSeconds(this.#now));
        this.#runtime.store.replaceCovenantProjection(
          projectId,
          next,
          this.#now(),
        );
        this.#webhooks.emitEvent(
          projectId,
          "covenant.cancelled",
          publicCovenant(next),
          `covenant_cancelled_${next.id}`,
        );
        return { status: 200, body: publicCovenant(next) };
      }
      if (action === "execute" && method === "POST") {
        emptyMutationSchema.parse(body);
        const executionId = id();
        const started = this.#runtime.startExecution({
          projectId,
          covenantId,
          executionId,
          operationKey: executionId,
          at: nowSeconds(this.#now),
        });
        this.#webhooks.consumeOutbox();
        return {
          status: 202,
          body: {
            covenant: publicCovenant(started.covenant),
            execution: publicOperation(started.operation),
            joined: started.joined,
          },
        };
      }
      if (action === "audit" && method === "GET") {
        const projectionId = `0x${sha256(canonicalJson(publicCovenant(projection.resource)))}`;
        return {
          status: 200,
          body: {
            projectionId,
            authoritative: false,
            covenantId,
            events: [
              {
                eventId: projectionId,
                eventType: "COVENANT_RESOURCE_OBSERVED",
                sequence: "1",
                status: projection.resource.status,
                occurredAt: projection.resource.updatedAt,
              },
            ],
          },
        };
      }
    }
    const executionMatch = /^\/v1\/executions\/(0x[0-9a-fA-F]{64})$/u.exec(
      path,
    );
    if (method === "GET" && executionMatch !== null) {
      const executionIdValue = executionMatch[1];
      if (executionIdValue === undefined)
        apiError(
          "not_found",
          "EXECUTION_NOT_FOUND",
          "Execution was not found.",
          404,
        );
      const operation = this.#runtime.store.getOperationByExecution(
        projectId,
        executionIdValue,
      );
      if (operation === undefined)
        apiError(
          "not_found",
          "EXECUTION_NOT_FOUND",
          "Execution was not found.",
          404,
        );
      return {
        status: 200,
        body: publicOperation(operation),
      };
    }
    if (method === "POST" && path === "/v1/webhook-endpoints") {
      const input = webhookEndpointRequestSchema.parse(body);
      const result = this.#webhooks.createEndpoint(projectId, input.url);
      return { status: 201, body: result };
    }
    if (method === "GET" && path === "/v1/webhook-endpoints")
      return {
        status: 200,
        body: { data: this.#webhooks.listEndpoints(projectId) },
      };
    const webhookMatch = /^\/v1\/webhook-endpoints\/([^/]+)$/u.exec(path);
    if (method === "DELETE" && webhookMatch !== null) {
      const endpointId = webhookMatch[1];
      if (endpointId === undefined)
        apiError(
          "not_found",
          "WEBHOOK_ENDPOINT_NOT_FOUND",
          "Webhook endpoint was not found.",
          404,
        );
      const endpoint = this.#webhooks.revokeEndpoint(projectId, endpointId);
      if (endpoint === undefined)
        apiError(
          "not_found",
          "WEBHOOK_ENDPOINT_NOT_FOUND",
          "Webhook endpoint was not found.",
          404,
        );
      return { status: 204, body: null };
    }
    if (method === "GET" && path === "/v1/api-keys")
      return {
        status: 200,
        body: {
          data: this.#runtime.store.listApiKeys(projectId).map((key) => ({
            keyId: key.keyId,
            prefix: key.prefix,
            status: key.revokedAt === null ? "active" : "revoked",
            createdAt: String(key.createdAt),
            revokedAt: key.revokedAt === null ? null : String(key.revokedAt),
          })),
        },
      };
    if (method === "POST" && path === "/v1/api-keys")
      return { status: 201, body: this.#keys.createKey(projectId) };
    const keyMatch = /^\/v1\/api-keys\/([^/]+)$/u.exec(path);
    if (method === "DELETE" && keyMatch !== null) {
      const keyId = keyMatch[1];
      if (keyId === undefined)
        apiError(
          "not_found",
          "API_KEY_NOT_FOUND",
          "API key was not found.",
          404,
        );
      const key = this.#runtime.store.revokeApiKey(
        projectId,
        keyId,
        this.#now(),
      );
      if (key === undefined)
        apiError(
          "not_found",
          "API_KEY_NOT_FOUND",
          "API key was not found.",
          404,
        );
      return { status: 204, body: null };
    }
    apiError("not_found", "NOT_FOUND", "Route was not found.", 404);
  }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk as Uint8Array);
    size += value.length;
    if (size > 1_048_576)
      throw new ApiError(
        "invalid_request",
        "BODY_TOO_LARGE",
        "Request body is too large.",
        413,
      );
    chunks.push(value);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(
      "invalid_request",
      "INVALID_JSON",
      "Request body must be valid JSON.",
      400,
    );
  }
}

export function createHttpServer(api: CovenantApi): Server {
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const rid = requestId();
      try {
        const body =
          request.method === "GET" || request.method === "HEAD"
            ? {}
            : await readBody(request);
        const result = await api.handle({
          method: request.method ?? "GET",
          path: request.url ?? "/",
          headers: Object.fromEntries(
            Object.entries(request.headers).map(([key, value]) => [
              key,
              Array.isArray(value) ? value[0] : value,
            ]),
          ),
          body,
        });
        response.statusCode = result.status;
        for (const [key, value] of Object.entries(result.headers))
          response.setHeader(key, value);
        response.end(result.status === 204 ? undefined : JSON.stringify(result.body));
      } catch (error) {
        const mapped = mapError(error);
        response.statusCode = mapped.status;
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            error: {
              type: mapped.type,
              code: mapped.code,
              message: mapped.message,
              requestId: rid,
            },
          }),
        );
      }
    })();
  });
}
