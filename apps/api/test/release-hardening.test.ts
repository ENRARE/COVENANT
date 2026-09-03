import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DurableExecutionRuntime,
  DurableRuntimeStore,
} from "@covenant/runtime";
import {
  loadApiDeploymentConfig,
  ApiConfigurationError,
} from "../src/configuration.js";
import {
  CovenantApi,
  createHttpServer,
  gracefulShutdown,
} from "../src/server.js";
import type { CovenantApiOptions } from "../src/server.js";
import { InMemoryRateLimiter } from "../src/rate-limit.js";

const key = "a".repeat(64);

function apiWith(options: Partial<Omit<CovenantApiOptions, "runtime">> = {}) {
  const store = new DurableRuntimeStore();
  const runtime = new DurableExecutionRuntime({
    store,
    adapter: {
      simulate: vi.fn(() => Promise.resolve({ status: "READY" as const })),
      submit: vi.fn(() =>
        Promise.resolve({
          status: "ACCEPTED" as const,
          transactionId: "tx",
        }),
      ),
    },
  });
  const api = new CovenantApi({
    runtime,
    webhookMasterKey: new Uint8Array(32).fill(1),
    ...options,
  });
  const project = api.provisionProject("release-test");
  return { api, project, store };
}

describe("COV-027 configuration and abuse boundaries", () => {
  it("requires an explicit 32-byte webhook key and fixes Arc Testnet", () => {
    expect(() => loadApiDeploymentConfig({})).toThrow(ApiConfigurationError);
    const config = loadApiDeploymentConfig({
      COVENANT_MODE: "test",
      COVENANT_WEBHOOK_MASTER_KEY: key,
    });
    expect(config.mode).toBe("test");
    expect(config.arcChainId).toBe("5042002");
    expect(config.usdcAddress).toBe(
      "0x3600000000000000000000000000000000000000",
    );
    expect(() =>
      loadApiDeploymentConfig({
        COVENANT_MODE: "test",
        COVENANT_WEBHOOK_MASTER_KEY: key,
        COVENANT_ARC_RPC_URL: "https://mainnet.arc.network",
      }),
    ).toThrow(ApiConfigurationError);
  });

  it("requires deployment modules and never echoes secret configuration", () => {
    expect(() =>
      loadApiDeploymentConfig({
        COVENANT_MODE: "deployment",
        COVENANT_WEBHOOK_MASTER_KEY: "not-a-key",
        COVENANT_DATABASE_FILENAME: "/tmp/covenant.db",
      }),
    ).toThrow(/32 bytes/u);
    expect(() =>
      loadApiDeploymentConfig({
        COVENANT_MODE: "deployment",
        COVENANT_WEBHOOK_MASTER_KEY: key,
        COVENANT_DATABASE_FILENAME: "/tmp/covenant.db",
      }),
    ).toThrow(/AUTHORIZATION_RESOLVER_MODULE/u);
    try {
      loadApiDeploymentConfig({
        COVENANT_MODE: "deployment",
        COVENANT_WEBHOOK_MASTER_KEY: key,
        COVENANT_DATABASE_FILENAME: "/tmp/covenant.db",
      });
    } catch (error) {
      expect(String(error)).not.toContain(key);
    }
  });

  it("enforces deterministic in-process limits and readiness", async () => {
    const { api, project } = apiWith({
      rateLimits: { authentication: { limit: 1, windowMs: 60_000 } },
    });
    const first = await api.handle({
      method: "GET",
      path: "/v1/covenants",
      headers: { "x-api-key": project.apiKey },
    });
    const second = await api.handle({
      method: "GET",
      path: "/v1/covenants",
      headers: { "x-api-key": project.apiKey },
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    expect((await api.handle({ method: "GET", path: "/ready" })).status).toBe(
      503,
    );
    api.close();
  });

  it("does not advertise wildcard browser access and rejects non-JSON mutations", async () => {
    const { api, project } = apiWith();
    const server = createHttpServer(api);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("server did not bind");
    try {
      const health = await fetch(
        `http://127.0.0.1:${String(address.port)}/health`,
      );
      expect(health.headers.get("access-control-allow-origin")).toBeNull();
      const response = await fetch(
        `http://127.0.0.1:${String(address.port)}/v1/covenants`,
        {
          method: "POST",
          headers: { "x-api-key": project.apiKey },
          body: JSON.stringify({}),
        },
      );
      expect(response.status).toBe(415);
      expect(await response.text()).not.toContain(project.apiKey);
    } finally {
      await gracefulShutdown(server, api);
    }
  });

  it("keeps every public resource boundary project-scoped", async () => {
    const first = apiWith();
    const second = apiWith();
    const created = await first.api.handle({
      method: "POST",
      path: "/v1/covenants",
      headers: { "x-api-key": first.project.apiKey, "idempotency-key": "same" },
      body: {
        payer: "0x1111111111111111111111111111111111111111",
        beneficiary: "0x2222222222222222222222222222222222222222",
        amount: "1",
        conditions: { policyHash: `0x${"ab".repeat(32)}`, policyVersion: "1" },
        expiresAt: "1900000000",
      },
    });
    const id = (created.body as { id: string }).id;
    for (const path of [
      `/v1/covenants/${id}`,
      `/v1/covenants/${id}/audit`,
      `/v1/covenants/${id}/execute`,
      `/v1/covenants/${id}/authorization-evidence`,
    ]) {
      const response = await second.api.handle({
        method: path.endsWith("/audit") ? "GET" : "POST",
        path,
        headers: { "x-api-key": second.project.apiKey },
        body: {},
      });
      expect(response.status).toBe(404);
    }
    expect(
      (
        await second.api.handle({
          method: "GET",
          path: "/v1/covenants",
          headers: { "x-api-key": second.project.apiKey },
        })
      ).body,
    ).toEqual({ data: [], pagination: { nextCursor: null } });
    const endpoint = await first.api.handle({
      method: "POST",
      path: "/v1/webhook-endpoints",
      headers: { "x-api-key": first.project.apiKey },
      body: { url: "https://example.invalid/hook" },
    });
    const endpointId = (endpoint.body as { endpointId: string }).endpointId;
    expect(
      (
        await second.api.handle({
          method: "GET",
          path: "/v1/webhook-endpoints",
          headers: { "x-api-key": second.project.apiKey },
        })
      ).body,
    ).toEqual({ data: [] });
    expect(
      (
        await second.api.handle({
          method: "DELETE",
          path: `/v1/webhook-endpoints/${endpointId}`,
          headers: { "x-api-key": second.project.apiKey },
        })
      ).status,
    ).toBe(404);
    const keys = await second.api.handle({
      method: "GET",
      path: "/v1/api-keys",
      headers: { "x-api-key": second.project.apiKey },
    });
    const keyRows = (
      keys.body as {
        data: {
          keyId: string;
          prefix: string;
          status: string;
          createdAt: string;
          revokedAt: null;
        }[];
      }
    ).data;
    expect(keyRows).toHaveLength(1);
    expect(keyRows[0]).toMatchObject({
      keyId: second.project.keyId,
      prefix: second.project.apiKey.slice(0, 18),
      status: "active",
      revokedAt: null,
    });
    first.api.close();
    second.api.close();
  });

  it("redacts credential-shaped webhook/provider failures before persistence", async () => {
    const sender = vi.fn(() =>
      Promise.reject(
        new Error("Bearer cov_test_leaked_value whsec_secret_value"),
      ),
    );
    const { api, project, store } = apiWith({ webhookSender: sender });
    const endpoint = await api.handle({
      method: "POST",
      path: "/v1/webhook-endpoints",
      headers: { "x-api-key": project.apiKey },
      body: { url: "https://example.invalid/hook" },
    });
    api.webhooks.emitEvent(
      project.projectId,
      "covenant.created",
      { covenantId: `0x${"01".repeat(32)}` },
      "redaction-event",
    );
    await api.webhooks.dispatchDue(Date.now() + 1_000);
    expect(sender).toHaveBeenCalledOnce();
    const text = JSON.stringify(
      store.listWebhookDeliveries({ projectId: project.projectId }),
    );
    expect(text).not.toContain("cov_test_leaked_value");
    expect(text).not.toContain("whsec_secret_value");
    expect(endpoint.status).toBe(201);
    api.close();
  });

  it("converges a bounded concurrent idempotent mutation batch", async () => {
    const { api, project } = apiWith({
      rateLimits: {
        authentication: { limit: 32, windowMs: 60_000 },
        mutations: { limit: 32, windowMs: 60_000 },
      },
    });
    const request = {
      method: "POST" as const,
      path: "/v1/covenants",
      headers: {
        "x-api-key": project.apiKey,
        "idempotency-key": "concurrent-release-batch",
      },
      body: {
        payer: "0x1111111111111111111111111111111111111111",
        beneficiary: "0x2222222222222222222222222222222222222222",
        amount: "1",
        conditions: {
          policyHash: `0x${"cd".repeat(32)}`,
          policyVersion: "1",
        },
        expiresAt: "1900000000",
      },
    };
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => api.handle(request)),
    );
    expect(responses.every((response) => response.status === 201)).toBe(true);
    expect(
      new Set(responses.map((response) => JSON.stringify(response.body))).size,
    ).toBe(1);
    api.close();
  });
});

describe("InMemoryRateLimiter", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resets a bucket at the configured boundary", () => {
    let now = 0;
    const limiter = new InMemoryRateLimiter({ now: () => now });
    const rule = { limit: 1, windowMs: 100 } as const;
    expect(limiter.consume("scope", "key", rule).allowed).toBe(true);
    expect(limiter.consume("scope", "key", rule).allowed).toBe(false);
    now = 100;
    expect(limiter.consume("scope", "key", rule).allowed).toBe(true);
  });
});
