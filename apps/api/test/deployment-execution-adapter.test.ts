import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

const AUTH_TOKEN = "a".repeat(32);

const PROJECT_ID = `0x${"11".repeat(32)}`;
const OLD_COVENANT_ID = `0x${"22".repeat(32)}`;
const NEW_COVENANT_ID = `0x${"33".repeat(32)}`;
const temporaryDirectories: string[] = [];

function operation(covenantId = OLD_COVENANT_ID) {
  return {
    executionId: "22222222-2222-4222-8222-222222222222",
    projectId: PROJECT_ID,
    covenantId,
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
  url?: string;
  transport?: string;
  authToken?: string;
  routesFile?: string;
}) {
  if (options.url !== undefined)
    vi.stubEnv("COVENANT_EXECUTOR_WORKER_URL", options.url);
  if (options.routesFile !== undefined)
    vi.stubEnv("COVENANT_EXECUTOR_WORKER_ROUTES_FILE", options.routesFile);
  vi.stubEnv(
    "COVENANT_EXECUTOR_WORKER_AUTH_TOKEN",
    options.authToken ?? AUTH_TOKEN,
  );
  if (options.transport !== undefined)
    vi.stubEnv("COVENANT_EXECUTOR_WORKER_TRANSPORT", options.transport);
  vi.resetModules();
  return import("../src/deployment/execution-adapter-entrypoint.js");
}

function writeRoutes(entries: readonly unknown[]): string {
  const directory = mkdtempSync(join(tmpdir(), "covenant-worker-routes-"));
  temporaryDirectories.push(directory);
  const filename = join(directory, "routes.json");
  writeFileSync(filename, JSON.stringify({ entries }), "utf8");
  return filename;
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
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
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

  it("routes exact project and Covenant identities to isolated workers", async () => {
    const routesFile = writeRoutes([
      {
        projectId: PROJECT_ID,
        covenantId: OLD_COVENANT_ID,
        workerUrl: "http://covenant-executor.railway.internal:8788",
      },
      {
        projectId: PROJECT_ID,
        covenantId: NEW_COVENANT_ID,
        workerUrl: "http://covenant-executor-fresh-demo.railway.internal:8788",
      },
    ]);
    const fetchMock = successfulWorker(
      "http://covenant-executor-fresh-demo.railway.internal:8788/simulate-authorized-payment",
    );
    vi.stubGlobal("fetch", fetchMock);
    const loaded = await loadAdapter({
      routesFile,
      transport: "railway-private",
    });

    await expect(
      loaded.default.simulate(operation(NEW_COVENANT_ID)),
    ).resolves.toEqual({ status: "READY" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fails closed for an unmapped Covenant and duplicate routes", async () => {
    const routesFile = writeRoutes([
      {
        projectId: PROJECT_ID,
        covenantId: OLD_COVENANT_ID,
        workerUrl: "https://executor.example",
      },
    ]);
    const loaded = await loadAdapter({ routesFile });
    await expect(
      loaded.default.simulate(operation(NEW_COVENANT_ID)),
    ).rejects.toThrow("Isolated executor route is unavailable");

    const duplicate = writeRoutes([
      {
        projectId: PROJECT_ID,
        covenantId: OLD_COVENANT_ID,
        workerUrl: "https://executor.example",
      },
      {
        projectId: PROJECT_ID.toUpperCase().replace("0X", "0x"),
        covenantId: OLD_COVENANT_ID,
        workerUrl: "https://other.example",
      },
    ]);
    await expect(loadAdapter({ routesFile: duplicate })).rejects.toThrow(
      "Duplicate isolated executor route",
    );
  });
});
