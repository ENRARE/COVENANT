import { describe, expect, it, vi } from "vitest";

describe("deployment isolated executor adapter entrypoint", () => {
  it("uses only the narrow worker endpoints and preserves worker outcomes", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      expect(url).toMatch(
        /^https:\/\/executor\.example\/simulate-authorized-payment$/u,
      );
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({
        "content-type": "application/json",
        "x-covenant-worker-auth": "a".repeat(32),
      });
      return Promise.resolve(
        new Response(JSON.stringify({ status: "SIMULATED" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("COVENANT_EXECUTOR_WORKER_URL", "https://executor.example/");
    vi.stubEnv("COVENANT_EXECUTOR_WORKER_AUTH_TOKEN", "a".repeat(32));
    vi.resetModules();
    const loaded =
      await import("../src/deployment/execution-adapter-entrypoint.js");
    const result = await loaded.default.simulate({
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
    } as never);
    expect(result).toEqual({ status: "READY" });
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }, 15_000);
});
