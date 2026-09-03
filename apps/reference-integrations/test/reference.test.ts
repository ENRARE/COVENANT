import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CovenantApi } from "@covenant/api";
import {
  DurableExecutionRuntime,
  DurableRuntimeStore,
} from "@covenant/runtime";
import { Covenant } from "@covenant/sdk";
import type { AuthorizationEvidenceSubmission, FetchLike } from "@covenant/sdk";
import {
  cancelBeforeAuthorization,
  runAgentCovenant,
  runMarketplacePayment,
  runMilestonePayment,
  runOwnAppPayment,
} from "../src/index.js";
import { createEvidence } from "../../api/test/authorization-evidence-fixtures.js";

const payer = "0x1111111111111111111111111111111111111111";
const beneficiary = "0x2222222222222222222222222222222222222222";
const policyHash: `0x${string}` = `0x${"ab".repeat(32)}`;

function setup() {
  const contexts = new Map<string, { covenantSpec: unknown }>();
  const store = new DurableRuntimeStore();
  const runtime = new DurableExecutionRuntime({
    store,
    adapter: {
      simulate: vi.fn(() => Promise.resolve({ status: "READY" as const })),
      submit: vi.fn(() =>
        Promise.resolve({ status: "ACCEPTED" as const, transactionId: "tx" }),
      ),
    },
  });
  const api = new CovenantApi({
    runtime,
    now: () => 1_700_000_000_000,
    webhookMasterKey: new Uint8Array(32).fill(8),
    authorizationContextResolver: (_projectId, covenant) =>
      contexts.get(covenant.id),
    // The dogfood scenario intentionally exercises more requests than a
    // production request window. Keep the fixture deterministic without
    // changing the deployment-safe default limits.
    rateLimits: {
      authentication: { limit: 64, windowMs: 60_000 },
      mutations: { limit: 32, windowMs: 60_000 },
      evidence: { limit: 16, windowMs: 60_000 },
    },
  });
  const project = api.provisionProject("reference-integrations");
  const fetcher: FetchLike = async (input, init = {}) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const parsed = new URL(url);
    const response = await api.handle({
      method: init.method ?? "GET",
      path: `${parsed.pathname}${parsed.search}`,
      headers: Object.fromEntries(
        Object.entries(init.headers ?? {}).map(([key, value]) => [
          key,
          String(value),
        ]),
      ),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: response.headers,
    });
  };
  const projectAccess = project.apiKey;
  const client = new Covenant({
    ["apiKey"]: projectAccess,
    baseUrl: "http://localhost:8787",
    fetch: fetcher,
  });
  return { api, client, contexts, project, runtime, fetcher };
}

function input(_suffix: string) {
  return {
    payer,
    beneficiary,
    amount: "1.25",
    conditions: { policyHash, policyVersion: "1" },
    expiresAt: "1700001000",
  } as const;
}

describe("COV-026 SDK dogfooding and reference integrations", () => {
  it("runs own-app, milestone, marketplace, and agent flows through SDK/API", async () => {
    const harness = setup();
    const evidence = async (
      resource: unknown,
    ): Promise<AuthorizationEvidenceSubmission> => {
      const generated = await createEvidence(resource as never);
      harness.contexts.set((resource as { id: string }).id, generated.context);
      return generated.submission as unknown as AuthorizationEvidenceSubmission;
    };
    const own = await runOwnAppPayment(harness.client, input("own"), evidence);
    const milestone = await runMilestonePayment(
      harness.client,
      input("milestone"),
      evidence,
    );
    const marketplace = await runMarketplacePayment(
      harness.client,
      input("marketplace"),
      evidence,
    );
    const agent = await runAgentCovenant(
      harness.client,
      input("agent"),
      evidence,
    );
    for (const result of [own, milestone, marketplace, agent]) {
      expect(result.listed.some((item) => item.id === result.created.id)).toBe(
        true,
      );
      expect(result.retrieved.id).toBe(result.created.id);
      expect(result.requested.status).toBe("AWAITING_AUTHORIZATION");
      expect(result.authorized.status).toBe("AUTHORIZED");
      expect(result.operation.covenant.id).toBe(result.created.id);
      expect(result.execution.covenantId).toBe(result.created.id);
      expect(result.audit.authoritative).toBe(false);
    }
    const cancelled = await cancelBeforeAuthorization(
      harness.client,
      input("cancel"),
    );
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("proves project isolation and webhook projection at the SDK boundary", async () => {
    const harness = setup();
    const endpoint = await harness.client.webhooks.createEndpoint({
      url: "https://receiver.invalid/reference",
    });
    const evidence = async (
      resource: unknown,
    ): Promise<AuthorizationEvidenceSubmission> => {
      const generated = await createEvidence(resource as never);
      harness.contexts.set((resource as { id: string }).id, generated.context);
      return generated.submission as unknown as AuthorizationEvidenceSubmission;
    };
    const result = await runMilestonePayment(
      harness.client,
      input("hook"),
      evidence,
    );
    expect(result.authorized.status).toBe("AUTHORIZED");
    expect(
      harness.runtime.store
        .listWebhookDeliveries({ projectId: harness.project.projectId })
        .some((delivery) => delivery.eventType === "covenant.authorized"),
    ).toBe(true);
    expect(endpoint.secret).toMatch(/^whsec_test_/u);

    const other = harness.api.provisionProject("other");
    const otherAccess = other.apiKey;
    const otherClient = new Covenant({
      ["apiKey"]: otherAccess,
      baseUrl: "http://localhost:8787",
      fetch: harness.fetcher,
    });
    await expect(
      otherClient.covenants.retrieve(result.created.id),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it("keeps Platform reference source free of forbidden authority/runtime imports", () => {
    const source = readFileSync(
      new URL("../src/index.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/@covenant\/(core|runtime|authority|executor)/u);
    expect(source).not.toMatch(/Circle|Arc RPC|private key|x-api-key/iu);
  });
});
