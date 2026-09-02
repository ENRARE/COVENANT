import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  DurableExecutionRuntime,
  DurableRuntimeStore,
} from "@covenant/runtime";
import { CovenantApi } from "../src/server.js";
import { signWebhook, verifyWebhookSignature } from "../src/webhooks.js";

const payer = "0x1111111111111111111111111111111111111111";
const beneficiary = "0x2222222222222222222222222222222222222222";
const policyHash = `0x${"ab".repeat(32)}`;

function setup(
  sender?: (input: {
    url: string;
    body: string;
    headers: Record<string, string>;
  }) => Promise<{ status: number }>,
) {
  const store = new DurableRuntimeStore();
  const runtime = new DurableExecutionRuntime({
    store,
    adapter: {
      simulate: vi.fn(() => Promise.resolve({ status: "READY" as const })),
      submit: vi.fn(() =>
        Promise.resolve({
          status: "ACCEPTED" as const,
          transactionId: "tx_test",
        }),
      ),
    },
  });
  const api = new CovenantApi({
    runtime,
    now: () => 1_700_000_000_000,
    webhookMasterKey: new Uint8Array(32).fill(7),
    webhookSender: sender,
  });
  const project = api.provisionProject("test");
  return { store, runtime, api, project };
}

function createBody() {
  return {
    payer,
    beneficiary,
    amount: "1.25",
    conditions: { policyHash, policyVersion: "1" },
    expiresAt: "1700001000",
  };
}

describe("COV-024 developer API", () => {
  it("creates hashed project API keys and authenticates valid keys", async () => {
    const { api, project, store } = setup();
    expect(project.apiKey).toMatch(/^cov_test_/u);
    const record = store.listApiKeys(project.projectId)[0];
    expect(record?.digest).not.toContain(project.apiKey);
    const health = await api.handle({ method: "GET", path: "/health" });
    expect(health.status).toBe(200);
    const denied = await api.handle({ method: "GET", path: "/v1/covenants" });
    expect(denied.status).toBe(401);
    expect(
      (denied.body as { error: { requestId: string } }).error.requestId,
    ).toBe(denied.headers["x-request-id"]);
  });

  it("rejects a revoked API key without disclosing key state", async () => {
    const { api, project, store } = setup();
    store.revokeApiKey(project.projectId, project.keyId, 1_700_000_001_000);
    const response = await api.handle({
      method: "GET",
      path: "/v1/covenants",
      headers: { "x-api-key": project.apiKey },
    });
    expect(response.status).toBe(401);
    expect((response.body as { error: { code: string } }).error.code).toBe(
      "API_KEY_REVOKED",
    );
  });

  it("creates, lists, retrieves, and replays a Covenant with HTTP idempotency", async () => {
    const { api, project } = setup();
    const headers = {
      "x-api-key": project.apiKey,
      "idempotency-key": "create-one",
    };
    const first = await api.handle({
      method: "POST",
      path: "/v1/covenants",
      headers,
      body: createBody(),
    });
    const replay = await api.handle({
      method: "POST",
      path: "/v1/covenants",
      headers,
      body: createBody(),
    });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    const resource = first.body as { id: string };
    const fetched = await api.handle({
      method: "GET",
      path: `/v1/covenants/${resource.id}`,
      headers: { "x-api-key": project.apiKey },
    });
    expect(fetched.status).toBe(200);
    const listed = await api.handle({
      method: "GET",
      path: "/v1/covenants?limit=1",
      headers: { "x-api-key": project.apiKey },
    });
    expect((listed.body as { data: unknown[] }).data).toHaveLength(1);
  });

  it("rejects strict unknown network/token fields and idempotency conflicts", async () => {
    const { api, project } = setup();
    const headers = { "x-api-key": project.apiKey, "idempotency-key": "same" };
    const bad = await api.handle({
      method: "POST",
      path: "/v1/covenants",
      headers,
      body: { ...createBody(), network: { id: "ethereum", chainId: "1" } },
    });
    expect(bad.status).toBe(400);
    const first = await api.handle({
      method: "POST",
      path: "/v1/covenants",
      headers: { ...headers, "idempotency-key": "valid" },
      body: createBody(),
    });
    expect(first.status).toBe(201);
    const conflict = await api.handle({
      method: "POST",
      path: "/v1/covenants",
      headers: { ...headers, "idempotency-key": "valid" },
      body: { ...createBody(), amount: "2" },
    });
    expect(conflict.status).toBe(409);
    expect((conflict.body as { error: { code: string } }).error.code).toBe(
      "IDEMPOTENCY_CONFLICT",
    );
  });

  it("isolates projects and keeps authorization separate from API authentication", async () => {
    const first = setup();
    const second = setup();
    const created = await first.api.handle({
      method: "POST",
      path: "/v1/covenants",
      headers: { "x-api-key": first.project.apiKey },
      body: createBody(),
    });
    const covenantId = (created.body as { id: string }).id;
    const cross = await second.api.handle({
      method: "GET",
      path: `/v1/covenants/${covenantId}`,
      headers: { "x-api-key": second.project.apiKey },
    });
    expect(cross.status).toBe(404);
    const requested = await first.api.handle({
      method: "POST",
      path: `/v1/covenants/${covenantId}/authorize`,
      headers: { "x-api-key": first.project.apiKey, "idempotency-key": "auth" },
      body: {},
    });
    expect(requested.status).toBe(202);
    expect((requested.body as { status: string }).status).toBe(
      "AWAITING_AUTHORIZATION",
    );
  });

  it("uses the durable runtime for execution and returns a stable state error when unauthorised", async () => {
    const { api, project, runtime } = setup();
    const created = await api.handle({
      method: "POST",
      path: "/v1/covenants",
      headers: { "x-api-key": project.apiKey },
      body: createBody(),
    });
    const covenantId = (created.body as { id: string }).id;
    const response = await api.handle({
      method: "POST",
      path: `/v1/covenants/${covenantId}/execute`,
      headers: { "x-api-key": project.apiKey, "idempotency-key": "execute" },
      body: {},
    });
    expect(response.status).toBe(409);
    expect((response.body as { error: { code: string } }).error.code).toBe(
      "AUTHORIZATION_REQUIRED",
    );
    expect(runtime.store.listOutbox()).toHaveLength(0);
  });

  it("signs webhook payloads deterministically and retries fake deliveries", async () => {
    let calls = 0;
    const sender = ({
      headers,
    }: {
      url: string;
      body: string;
      headers: Record<string, string>;
    }) => {
      calls += 1;
      expect(headers["x-covenant-signature"]).toMatch(/^v1=[0-9a-f]{64}$/u);
      return Promise.resolve({ status: calls === 1 ? 500 : 204 });
    };
    const { api, project } = setup(sender);
    expect(
      verifyWebhookSignature({
        secret: "secret",
        timestamp: 1_700_000_000,
        deliveryId: "delivery",
        body: "body",
        signature: signWebhook("secret", 1_700_000_000, "delivery", "body"),
        now: 1_700_000_010,
      }),
    ).toBe(true);
    const endpoint = await api.handle({
      method: "POST",
      path: "/v1/webhook-endpoints",
      headers: { "x-api-key": project.apiKey },
      body: { url: "https://receiver.invalid/hooks" },
    });
    expect(endpoint.status).toBe(201);
    expect((endpoint.body as { secret: string }).secret).toMatch(
      /^whsec_test_/u,
    );
    const listed = await api.handle({
      method: "GET",
      path: "/v1/webhook-endpoints",
      headers: { "x-api-key": project.apiKey },
    });
    expect(JSON.stringify(listed.body)).not.toContain(
      (endpoint.body as { secret: string }).secret,
    );
    api.webhooks.emitEvent(
      project.projectId,
      "covenant.created",
      { covenantId: `0x${"01".repeat(32)}` },
      "event-stable",
    );
    const first = await api.webhooks.dispatchDue(1_700_000_000_000);
    expect(first[0]?.status).toBe("RETRYING");
    const second = await api.webhooks.dispatchDue(1_700_000_002_000);
    expect(second[0]?.status).toBe("DELIVERED");
    expect(calls).toBe(2);
  });

  it("publishes OpenAPI coverage for every implemented route", () => {
    const spec = JSON.parse(
      readFileSync(new URL("../openapi.json", import.meta.url), "utf8"),
    ) as { paths: Record<string, unknown> };
    for (const route of [
      "/health",
      "/v1/covenants",
      "/v1/covenants/{id}",
      "/v1/covenants/{id}/authorize",
      "/v1/covenants/{id}/execute",
      "/v1/covenants/{id}/cancel",
      "/v1/covenants/{id}/audit",
      "/v1/executions/{id}",
      "/v1/webhook-endpoints",
    ])
      expect(spec.paths[route]).toBeDefined();
  });
});
