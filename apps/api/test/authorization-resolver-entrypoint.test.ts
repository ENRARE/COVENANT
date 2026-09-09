import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const artifact = resolve(
  process.cwd(),
  "../../deployment/arc-testnet/cov010-api-authorization-spec.json",
);

async function loadEntrypoint(rpcUrl?: string) {
  vi.stubEnv("COVENANT_AUTHORIZATION_SPEC_FILE", artifact);
  vi.stubEnv("COVENANT_ARC_RPC_URL", rpcUrl ?? "");
  vi.resetModules();
  return import("../src/deployment/authorization-resolver-entrypoint.js");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("deployment authorization resolver entrypoint", () => {
  it("requires explicit read-only Arc RPC configuration", async () => {
    await expect(loadEntrypoint()).rejects.toThrow(
      "COVENANT_ARC_RPC_URL is required",
    );
    await expect(loadEntrypoint("not-a-url")).rejects.toThrow(
      "COVENANT_ARC_RPC_URL is invalid",
    );
  });

  it("constructs the project-bound resolver without making an RPC call", async () => {
    const loaded = await loadEntrypoint("https://rpc.testnet.arc.network");
    expect(typeof loaded.default).toBe("function");
    expect(typeof loaded.default.checkReady).toBe("function");
  });
});
