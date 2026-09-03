import { SDK_ROUTES } from "./routes.js";
import { HttpTransport } from "./transport.js";
import { verifyWebhook } from "./webhooks.js";
import { CovenantValidationError } from "./errors.js";
import {
  assertCreateCovenantInput,
  assertAuthorizationEvidenceSubmission,
  assertId,
  assertListParams,
  assertResponseList,
  assertResponseObject,
  assertWebhookInput,
} from "./validation.js";
import type {
  ApiKeyCreated,
  ApiKeyResource,
  AuditResource,
  CovenantListParams,
  CovenantPage,
  CovenantResource,
  CovenantOptions,
  CreateCovenantInput,
  AuthorizationEvidenceSubmission,
  ExecutionAccepted,
  ExecutionResource,
  RequestOptions,
  WebhookEndpointCreated,
  WebhookEndpointResource,
  WebhookEvent,
  WebhookVerifyInput,
} from "./types.js";

function mutationOptions(
  options: RequestOptions | undefined,
  mutationRetrySafe: boolean,
) {
  return {
    ...(options?.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: options.idempotencyKey }),
    mutationRetrySafe,
  } as const;
}

export class CovenantsResource {
  constructor(private readonly transport: HttpTransport) {}

  async create(
    input: CreateCovenantInput,
    options?: RequestOptions,
  ): Promise<CovenantResource> {
    assertCreateCovenantInput(input);
    const value = await this.transport.request<unknown>(
      "POST",
      SDK_ROUTES.covenants,
      input,
      mutationOptions(options, true),
    );
    return assertResponseObject(value, "Covenant") as CovenantResource;
  }

  async list(params?: CovenantListParams): Promise<CovenantPage> {
    assertListParams(params);
    const query = new URLSearchParams();
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.after !== undefined) query.set("after", params.after);
    const suffix = query.toString() === "" ? "" : `?${query.toString()}`;
    const value = await this.transport.request<unknown>(
      "GET",
      `${SDK_ROUTES.covenants}${suffix}`,
    );
    return assertResponseObject(value, "Covenant list") as CovenantPage;
  }

  async retrieve(id: string): Promise<CovenantResource> {
    assertId(id, "id");
    const value = await this.transport.request<unknown>(
      "GET",
      `${SDK_ROUTES.covenants}/${encodeURIComponent(id)}`,
    );
    return assertResponseObject(value, "Covenant") as CovenantResource;
  }

  async authorize(
    id: string,
    options?: RequestOptions,
  ): Promise<CovenantResource> {
    assertId(id, "id");
    const value = await this.transport.request<unknown>(
      "POST",
      `${SDK_ROUTES.covenants}/${encodeURIComponent(id)}/authorize`,
      {},
      mutationOptions(options, true),
    );
    return assertResponseObject(value, "Covenant") as CovenantResource;
  }

  async submitAuthorizationEvidence(
    id: string,
    evidence: AuthorizationEvidenceSubmission,
    options?: RequestOptions,
  ): Promise<CovenantResource> {
    assertId(id, "id");
    assertAuthorizationEvidenceSubmission(evidence);
    const value = await this.transport.request<unknown>(
      "POST",
      `${SDK_ROUTES.covenants}/${encodeURIComponent(id)}/${SDK_ROUTES.authorizationEvidence}`,
      evidence,
      mutationOptions(options, true),
    );
    return assertResponseObject(value, "Covenant") as CovenantResource;
  }

  async execute(
    id: string,
    options?: RequestOptions,
  ): Promise<ExecutionAccepted> {
    assertId(id, "id");
    const value = await this.transport.request<unknown>(
      "POST",
      `${SDK_ROUTES.covenants}/${encodeURIComponent(id)}/execute`,
      {},
      mutationOptions(options, true),
    );
    return assertResponseObject(value, "execution") as ExecutionAccepted;
  }

  async cancel(
    id: string,
    options?: RequestOptions,
  ): Promise<CovenantResource> {
    assertId(id, "id");
    const value = await this.transport.request<unknown>(
      "POST",
      `${SDK_ROUTES.covenants}/${encodeURIComponent(id)}/cancel`,
      {},
      mutationOptions(options, true),
    );
    return assertResponseObject(value, "Covenant") as CovenantResource;
  }

  async audit(id: string): Promise<AuditResource> {
    assertId(id, "id");
    const value = await this.transport.request<unknown>(
      "GET",
      `${SDK_ROUTES.covenants}/${encodeURIComponent(id)}/audit`,
    );
    return assertResponseObject(value, "audit") as AuditResource;
  }
}

export class ExecutionsResource {
  constructor(private readonly transport: HttpTransport) {}

  async retrieve(id: string): Promise<ExecutionResource> {
    assertId(id, "id");
    const value = await this.transport.request<unknown>(
      "GET",
      `${SDK_ROUTES.executions}/${encodeURIComponent(id)}`,
    );
    return assertResponseObject(value, "execution") as ExecutionResource;
  }
}

export class ApiKeysResource {
  constructor(private readonly transport: HttpTransport) {}

  async create(options?: RequestOptions): Promise<ApiKeyCreated> {
    const value = await this.transport.request<unknown>(
      "POST",
      SDK_ROUTES.apiKeys,
      undefined,
      mutationOptions(options, false),
    );
    return assertResponseObject(value, "API key") as ApiKeyCreated;
  }

  async list(): Promise<readonly ApiKeyResource[]> {
    const value = await this.transport.request<unknown>(
      "GET",
      SDK_ROUTES.apiKeys,
    );
    return assertResponseList(
      value,
      "API key list",
    ) as readonly ApiKeyResource[];
  }

  async revoke(id: string, options?: RequestOptions): Promise<void> {
    if (typeof id !== "string" || id.trim() === "")
      throw new CovenantValidationError({
        type: "invalid_request",
        code: "INVALID_API_KEY_ID",
        message: "API key id must be a non-empty string.",
      });
    await this.transport.request<undefined>(
      "DELETE",
      `${SDK_ROUTES.apiKeys}/${encodeURIComponent(id)}`,
      undefined,
      mutationOptions(options, true),
    );
  }
}

export class WebhooksResource {
  constructor(private readonly transport: HttpTransport) {}

  async createEndpoint(
    input: Readonly<{ url: string }>,
    options?: RequestOptions,
  ): Promise<WebhookEndpointCreated> {
    assertWebhookInput(input);
    const value = await this.transport.request<unknown>(
      "POST",
      SDK_ROUTES.webhookEndpoints,
      input,
      mutationOptions(options, false),
    );
    return assertResponseObject(
      value,
      "webhook endpoint",
    ) as WebhookEndpointCreated;
  }

  async listEndpoints(): Promise<readonly WebhookEndpointResource[]> {
    const value = await this.transport.request<unknown>(
      "GET",
      SDK_ROUTES.webhookEndpoints,
    );
    return assertResponseList(
      value,
      "webhook endpoint list",
    ) as readonly WebhookEndpointResource[];
  }

  async deleteEndpoint(id: string, options?: RequestOptions): Promise<void> {
    if (typeof id !== "string" || id.trim() === "")
      throw new CovenantValidationError({
        type: "invalid_request",
        code: "INVALID_WEBHOOK_ENDPOINT_ID",
        message: "Webhook endpoint id must be a non-empty string.",
      });
    await this.transport.request<undefined>(
      "DELETE",
      `${SDK_ROUTES.webhookEndpoints}/${encodeURIComponent(id)}`,
      undefined,
      mutationOptions(options, true),
    );
  }

  verify(input: WebhookVerifyInput): WebhookEvent {
    return verifyWebhook(input);
  }
}

export class Covenant {
  readonly covenants: CovenantsResource;
  readonly executions: ExecutionsResource;
  readonly webhooks: WebhooksResource;
  readonly apiKeys: ApiKeysResource;

  constructor(options: CovenantOptions) {
    const transport = new HttpTransport(options);
    this.covenants = new CovenantsResource(transport);
    this.executions = new ExecutionsResource(transport);
    this.webhooks = new WebhooksResource(transport);
    this.apiKeys = new ApiKeysResource(transport);
  }
}
