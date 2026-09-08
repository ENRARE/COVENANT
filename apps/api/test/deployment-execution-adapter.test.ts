import { afterEach, describe, expect, it, vi } from "vitest";

const AUTH_TOKEN = "a".repeat(32);

function operation() {
  return {
    executionId: "22222222-2222-4222-8222-222222222222",
    authorizationEvidence: {
      signedPaymentIntent: { payload: "intent", signature: "sig" },
      ruleResults: [],
      evidence: {
        signedDecisionReceipt: { payload: "decision", signature: "sig" },
        signedAuthorizationReceipt: {
          payload: "authorization",
          signature: "sig",
        },
      },
    },
  } as never;
}

async function loadAdapter(options: {
  url: string;
  transport?: string;
  authToken?: string;
}) {
  vi.stubEnv("COVENANT_EXECUTOR_WORKER_URL", options.url);
  vi.stubEnv(
    "COVENANT_EXECUTOR_WORKER_AUTH_TOKEN",
    options.authToken ?? AUTH_TOKEN,
  );
  if (options.transport !== undefined)
    vi.stubEnv("COVENANT_EXECUTOR_WORKER_TRANSPORT", options.transport);
  vi.resetModules();
  return import("../src/deployment/execution-adapter-entrypoint.js");
}

function successfulWorker(
  expectedUrl: string,
  responseBody: Readonly<Record<string, string>> = { status: "SIMULATED" },
) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    expect(url).toBe(expectedUrl);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "content-type": "application/json",
      "x-covenant-worker-auth": AUTH_TOKEN,
    });
    return Promise.resolve(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("deployment isolated executor adapter entrypoint", () => {
  it("keeps HTTPS as the normal transport and uses only the narrow route", async () => {
    const fetchMock = successfulWorker(
      "https://executor.example/simulate-authorized-payment",
    );
    vi.stubGlobal("fetch", fetchMock);
    const loaded = await loadAdapter({ url: "https://executor.example/" });

    await expect(loaded.default.simulate(operation())).resolves.toEqual({
      status: "READY",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  }, 15_000);

  it("allows authenticated HTTP for an explicit Railway private origin", async () => {
    const fetchMock = successfulWorker(
      "http://covenant-executor.railway.internal:8788/execute-authorized-payment",
      { status: "SUBMITTED", transactionId: "circle-operation-1" },
    );
    vi.stubGlobal("fetch", fetchMock);
    const loaded = await loadAdapter({
      url: "http://covenant-executor.railway.internal:8788",
      transport: "railway-private",
    });

    await expect(loaded.default.submit(operation())).resolves.toEqual({
      status: "ACCEPTED",
      transactionId: "circle-operation-1",
      providerState: "ACCEPTED",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    "http://example.com",
    "http://10.0.0.8:8788",
    "http://railway.internal:8788",
    "http://covenant-executorrailway.internal:8788",
    "http://covenant-executor.railway.internal.example.com:8788",
    "http://covenant-executor.railway.internal.evil:8788",
    "https://covenant-executor.railway.internal:8788",
  ])("rejects non-Railway-private origin %s", async (url) => {
    await expect(
      loadAdapter({ url, transport: "railway-private" }),
    ).rejects.toThrow();
  });

  it.each([
    "http://user@covenant-executor.railway.internal:8788",
    "http://user:password@covenant-executor.railway.internal:8788",
    "http://covenant-executor.railway.internal:8788/worker",
    "http://covenant-executor.railway.internal:8788?route=worker",
    "http://covenant-executor.railway.internal:8788#worker",
  ])("rejects non-origin Railway URL %s", async (url) => {
    await expect(
      loadAdapter({ url, transport: "railway-private" }),
    ).rejects.toThrow("must be an origin URL");
  });

  it("does not allow public HTTP without Railway private mode", async () => {
    await expect(loadAdapter({ url: "http://example.com" })).rejects.toThrow(
      "must use HTTPS",
    );
  });

  it("rejects unknown transport modes", async () => {
    await expect(
      loadAdapter({
        url: "https://executor.example",
        transport: "private-http",
      }),
    ).rejects.toThrow("COVENANT_EXECUTOR_WORKER_TRANSPORT is invalid");
  });

  it("requires the worker authentication token in Railway private mode", async () => {
    await expect(
      loadAdapter({
        url: "http://covenant-executor.railway.internal:8788",
        transport: "railway-private",
        authToken: "",
      }),
    ).rejects.toThrow("COVENANT_EXECUTOR_WORKER_AUTH_TOKEN is required");
  });
});
