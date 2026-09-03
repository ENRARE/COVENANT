import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  Covenant,
  CovenantApiError,
  CovenantAuthenticationError,
  CovenantConflictError,
  CovenantConfigurationError,
  CovenantRateLimitError,
  CovenantTimeoutError,
  CovenantTransportError,
  CovenantValidationError,
  CovenantWebhookSignatureError,
} from "../src/index.js";
import { SDK_ROUTE_CONTRACT } from "../src/routes.js";
import type { FetchLike } from "../src/types.js";

const TEST_PROJECT_KEY = `cov_test_${"a".repeat(16)}`;
const COVENANT_ID = `0x${"11".repeat(32)}` as const;
const POLICY_HASH = `0x${"ab".repeat(32)}` as const;

type Call = Readonly<{ url: string; init: RequestInit }>;

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function setup(
  handler: (call: Call, attempt: number) => Response | Promise<Response>,
  options: Readonly<{ maxRetries?: number; timeoutMs?: number }> = {},
) {
  const calls: Call[] = [];
  let attempt = 0;
  const fetcher: FetchLike = async (input, init = {}) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const call = { url, init };
    calls.push(call);
    attempt += 1;
    return handler(call, attempt);
  };
  const client = new Covenant({
    ["apiKey"]: TEST_PROJECT_KEY,
    baseUrl: "https://api.example.test/",
    fetch: fetcher,
    maxRetries: options.maxRetries ?? 0,
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
  });
  return { client, calls };
}

function createInput() {
  return {
    payer: `0x${"22".repeat(20)}`,
    beneficiary: `0x${"33".repeat(20)}`,
    amount: "1.25",
    conditions: { policyHash: POLICY_HASH, policyVersion: "1" },
    expiresAt: "1700001000",
  } as const;
}

describe("COV-025 TypeScript SDK", () => {
  it("validates server-side configuration and allows only localhost HTTP", () => {
    expect(
      () =>
        new Covenant({ ["apiKey"]: "", baseUrl: "https://api.example.test" }),
    ).toThrow(CovenantConfigurationError);
    expect(
      () =>
        new Covenant({
          ["apiKey"]: TEST_PROJECT_KEY,
          baseUrl: "http://api.example.test",
        }),
    ).toThrow(CovenantConfigurationError);
    expect(
      () =>
        new Covenant({
          ["apiKey"]: TEST_PROJECT_KEY,
          baseUrl: "https://user:pass@example.test",
        }),
    ).toThrow(CovenantConfigurationError);
    expect(
      () =>
        new Covenant({
          ["apiKey"]: TEST_PROJECT_KEY,
          baseUrl: "http://localhost:8787/",
        }),
    ).not.toThrow();
    expect(
      () =>
        new Covenant({
          ["apiKey"]: TEST_PROJECT_KEY,
          baseUrl: "http://127.0.0.1:8787/api/",
        }),
    ).not.toThrow();
  });

  it("sends authenticated typed Covenant requests with idempotency", async () => {
    const { client, calls } = setup(() =>
      jsonResponse(201, { id: COVENANT_ID }),
    );
    await client.covenants.create(createInput(), {
      idempotencyKey: "create-1",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.example.test/v1/covenants");
    expect(calls[0]?.init.headers).toEqual({
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": TEST_PROJECT_KEY,
      "user-agent": "@covenant/sdk/0.1.0",
      "idempotency-key": "create-1",
    });
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual(createInput());
  });

  it("rejects unsupported Covenant fields before making a request", async () => {
    const { client, calls } = setup(() =>
      jsonResponse(201, { id: COVENANT_ID }),
    );
    await expect(
      client.covenants.create({
        ...createInput(),
        network: { id: "ethereum", chainId: "1" },
      } as never),
    ).rejects.toBeInstanceOf(CovenantValidationError);
    expect(calls).toHaveLength(0);
  });

  it("supports Covenant lifecycle, audit, execution, and bounded pagination routes", async () => {
    const { client, calls } = setup((call) => {
      if (call.url.includes("/audit"))
        return jsonResponse(200, {
          projectionId: "projection",
          authoritative: false,
          covenantId: COVENANT_ID,
          events: [],
        });
      if (call.url.includes("/execute"))
        return jsonResponse(202, {
          covenant: { id: COVENANT_ID },
          execution: { id: `0x${"44".repeat(32)}` },
          joined: false,
        });
      if (call.url.includes("limit=2"))
        return jsonResponse(200, {
          data: [{ id: COVENANT_ID }],
          pagination: { nextCursor: null },
        });
      return jsonResponse(200, { id: COVENANT_ID });
    });
    await client.covenants.retrieve(COVENANT_ID);
    await client.covenants.list({ limit: 2, after: COVENANT_ID });
    await client.covenants.authorize(COVENANT_ID, { idempotencyKey: "auth-1" });
    await client.covenants.execute(COVENANT_ID, { idempotencyKey: "exec-1" });
    await client.covenants.cancel(COVENANT_ID, { idempotencyKey: "cancel-1" });
    await client.covenants.audit(COVENANT_ID);
    expect(
      calls.map((call) => `${call.init.method ?? ""} ${call.url}`),
    ).toEqual([
      `GET https://api.example.test/v1/covenants/${COVENANT_ID}`,
      `GET https://api.example.test/v1/covenants?limit=2&after=${COVENANT_ID}`,
      `POST https://api.example.test/v1/covenants/${COVENANT_ID}/authorize`,
      `POST https://api.example.test/v1/covenants/${COVENANT_ID}/execute`,
      `POST https://api.example.test/v1/covenants/${COVENANT_ID}/cancel`,
      `GET https://api.example.test/v1/covenants/${COVENANT_ID}/audit`,
    ]);
  });

  it("manages API keys and webhook endpoints without inventing bootstrap", async () => {
    const { client, calls } = setup((call) => {
      if (call.init.method === "POST" && call.url.endsWith("/api-keys"))
        return jsonResponse(201, {
          keyId: "key_1",
          ["apiKey"]: TEST_PROJECT_KEY,
          prefix: "cov_test_aaaa",
        });
      if (call.url.includes("/api-keys"))
        return jsonResponse(200, { data: [] });
      if (call.init.method === "POST")
        return jsonResponse(201, {
          endpointId: "wh_1",
          secret: "whsec_test_secret",
          url: "https://receiver.test/hook",
        });
      return jsonResponse(200, { data: [] });
    });
    const createdKey = await client.apiKeys.create();
    expect(createdKey.apiKey).toBe(TEST_PROJECT_KEY);
    await client.apiKeys.list();
    await client.apiKeys.revoke("key_1", { idempotencyKey: "revoke-1" });
    const endpoint = await client.webhooks.createEndpoint({
      url: "https://receiver.test/hook",
    });
    expect(endpoint.secret).toContain("whsec_test_");
    await client.webhooks.listEndpoints();
    await client.webhooks.deleteEndpoint("wh_1", {
      idempotencyKey: "delete-1",
    });
    expect(
      calls.map((call) => `${call.init.method ?? ""} ${call.url}`),
    ).toEqual([
      "POST https://api.example.test/v1/api-keys",
      "GET https://api.example.test/v1/api-keys",
      "DELETE https://api.example.test/v1/api-keys/key_1",
      "POST https://api.example.test/v1/webhook-endpoints",
      "GET https://api.example.test/v1/webhook-endpoints",
      "DELETE https://api.example.test/v1/webhook-endpoints/wh_1",
    ]);
  });

  it("maps bounded API errors and never exposes the API key", async () => {
    const cases = [
      [401, CovenantAuthenticationError],
      [400, CovenantValidationError],
      [409, CovenantConflictError],
      [429, CovenantRateLimitError],
    ] as const;
    for (const [status, ErrorClass] of cases) {
      const { client } = setup(() =>
        jsonResponse(
          status,
          {
            error: {
              type: "server_type",
              code: "SERVER_CODE",
              message: "safe message",
              requestId: "req_test",
            },
          },
          { "x-request-id": "req_header" },
        ),
      );
      await expect(client.covenants.list()).rejects.toBeInstanceOf(ErrorClass);
      try {
        await client.covenants.list();
      } catch (error) {
        expect(error).toBeInstanceOf(ErrorClass);
        expect((error as CovenantApiError).requestId).toBe("req_test");
      }
    }
    const { client } = setup(() =>
      jsonResponse(500, {
        error: {
          type: "server_error",
          code: "INTERNAL_ERROR",
          message: TEST_PROJECT_KEY,
        },
      }),
    );
    await expect(client.covenants.list()).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: "The Covenant API returned an error.",
    });
    await expect(client.covenants.list()).rejects.not.toThrow(TEST_PROJECT_KEY);
  });

  it("retries reads, never retries unkeyed mutations, and retries keyed safe mutations boundedly", async () => {
    let readAttempts = 0;
    const read = setup(
      () => {
        readAttempts += 1;
        if (readAttempts === 1) throw new Error("temporary transport");
        return jsonResponse(200, {
          data: [],
          pagination: { nextCursor: null },
        });
      },
      { maxRetries: 1 },
    );
    await read.client.covenants.list();
    expect(read.calls).toHaveLength(2);

    const mutation = setup(
      () => {
        return jsonResponse(500, {
          error: { code: "INTERNAL_ERROR", message: "failed" },
        });
      },
      { maxRetries: 2 },
    );
    await expect(
      mutation.client.covenants.create(createInput()),
    ).rejects.toBeInstanceOf(CovenantApiError);
    expect(mutation.calls).toHaveLength(1);

    let keyedAttempts = 0;
    const keyed = setup(
      () => {
        keyedAttempts += 1;
        return keyedAttempts === 1
          ? jsonResponse(500, {
              error: { code: "INTERNAL_ERROR", message: "retry" },
            })
          : jsonResponse(201, { id: COVENANT_ID });
      },
      { maxRetries: 1 },
    );
    await keyed.client.covenants.create(createInput(), {
      idempotencyKey: "safe-create",
    });
    expect(keyed.calls).toHaveLength(2);
  });

  it("represents timeouts separately from financial failure", async () => {
    const { client } = setup(() => new Promise<Response>(() => undefined), {
      timeoutMs: 5,
    });
    await expect(client.covenants.list()).rejects.toBeInstanceOf(
      CovenantTimeoutError,
    );
  });

  it("verifies the exact COV-024 webhook signature over the raw body", () => {
    const secret = "whsec_test_secret";
    const deliveryId = "whd_delivery";
    const timestamp = 1_700_000_000;
    const payload = JSON.stringify({
      eventId: "evt_1",
      eventType: "covenant.created",
      payload: { covenantId: COVENANT_ID },
    });
    const digest = createHmac("sha256", secret)
      .update(`${String(timestamp)}.${deliveryId}.${payload}`, "utf8")
      .digest("hex");
    const client = new Covenant({
      ["apiKey"]: TEST_PROJECT_KEY,
      baseUrl: "https://api.example.test",
    });
    const event = client.webhooks.verify({
      payload,
      signature: `v1=${digest}`,
      timestamp,
      deliveryId,
      secret,
      now: timestamp + 10,
    });
    expect(event.eventType).toBe("covenant.created");
    expect(() =>
      client.webhooks.verify({
        payload: `${payload} `,
        signature: `v1=${digest}`,
        timestamp,
        deliveryId,
        secret,
        now: timestamp + 10,
      }),
    ).toThrow(CovenantWebhookSignatureError);
    expect(() =>
      client.webhooks.verify({
        payload,
        signature: `v1=${digest}`,
        timestamp,
        deliveryId,
        secret,
        now: timestamp + 301,
      }),
    ).toThrow(CovenantWebhookSignatureError);
  });

  it("preserves OpenAPI route coverage and the unauthenticated health override", () => {
    const spec = JSON.parse(
      readFileSync(
        new URL("../../../apps/api/openapi.json", import.meta.url),
        "utf8",
      ),
    ) as {
      security: unknown;
      paths: Record<string, Record<string, { security?: unknown }>>;
    };
    expect(spec.security).toEqual([{ ApiKey: [] }]);
    expect(spec.paths["/health"]?.get?.security).toEqual([]);
    for (const route of SDK_ROUTE_CONTRACT)
      expect(spec.paths[route.path]?.[route.method]).toBeDefined();
  });

  it("does not expose an arbitrary low-level request escape hatch", () => {
    const client = new Covenant({
      ["apiKey"]: TEST_PROJECT_KEY,
      baseUrl: "https://api.example.test",
    });
    expect("request" in client).toBe(false);
  });

  it("maps unknown transport failures to sanitized transport errors", async () => {
    const { client } = setup(() =>
      Promise.reject(new Error("secret provider detail")),
    );
    await expect(client.covenants.list()).rejects.toBeInstanceOf(
      CovenantTransportError,
    );
  });
});
