import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createExecutorDeploymentService,
  ExecutorDeploymentConfigurationError,
} from "../src/deployment-service-factory.js";
import { sanitizedStartupErrorCategory } from "../src/worker-main.js";

const ENV = Object.freeze({
  ARC_RPC_URL: "https://rpc.testnet.arc.network",
  COVENANT_VAULT_ADDRESS: "0x4000000000000000000000000000000000000004",
  CIRCLE_API_KEY: "x",
  CIRCLE_ENTITY_SECRET: "y",
  CIRCLE_WALLET_ID: "11111111-1111-5111-8111-111111111111",
  EXECUTOR_SIGNER_SOURCE: "synthetic-signer-source",
});

function fakeDependencies() {
  return {
    covenantProvider: {
      getCovenant: () => Promise.resolve({}),
    },
    transport: {
      simulate: () => Promise.resolve({ status: "SIMULATED" }),
      submit: () =>
        Promise.resolve({
          status: "SUBMITTED",
          transactionId: "synthetic-transaction",
        }),
    },
    clock: { now: () => 2_000_000_000n },
    verifyArcChain: vi.fn(() => undefined),
    validateSignerSource: vi.fn(() => undefined),
  } as const;
}

describe("executor deployment composition", () => {
  it("constructs the existing service from valid injected deployment dependencies", async () => {
    const dependencies = fakeDependencies();
    const service = await createExecutorDeploymentService({
      env: ENV,
      dependencies,
    });

    expect(Object.keys(service)).toEqual([
      "prepareExecution",
      "simulateAuthorizedPayment",
      "executeAuthorizedPayment",
    ]);
    expect(dependencies.verifyArcChain).toHaveBeenCalledWith(ENV.ARC_RPC_URL);
    expect(dependencies.validateSignerSource).toHaveBeenCalledWith(
      ENV.EXECUTOR_SIGNER_SOURCE,
    );
  });

  it("fails closed when Circle configuration is missing", async () => {
    const env: Record<string, string | undefined> = { ...ENV };
    delete env.CIRCLE_API_KEY;
    await expect(
      createExecutorDeploymentService({
        env,
        dependencies: fakeDependencies(),
      }),
    ).rejects.toThrow("CIRCLE_API_KEY is required");
  });

  it("fails closed when signer configuration is missing", async () => {
    const env = { ...ENV, EXECUTOR_SIGNER_SOURCE: undefined };
    await expect(
      createExecutorDeploymentService({
        env,
        dependencies: fakeDependencies(),
      }),
    ).rejects.toThrow("EXECUTOR_SIGNER_SOURCE is required");
  });

  it("rejects mainnet and malformed Vault configuration", async () => {
    const dependencies = fakeDependencies();
    await expect(
      createExecutorDeploymentService({
        env: { ...ENV, ARC_RPC_URL: "https://rpc.arc.network" },
        dependencies,
      }),
    ).rejects.toThrow(ExecutorDeploymentConfigurationError);
    await expect(
      createExecutorDeploymentService({
        env: {
          ...ENV,
          COVENANT_VAULT_ADDRESS: "0x0000000000000000000000000000000000000000",
        },
        dependencies,
      }),
    ).rejects.toThrow(ExecutorDeploymentConfigurationError);
  });

  it("keeps sanitized startup logging free of the underlying error text", () => {
    expect(
      sanitizedStartupErrorCategory(
        new Error("CIRCLE_API_KEY=x must not be logged"),
      ),
    ).toBe("STARTUP_FAILURE");
    expect(
      sanitizedStartupErrorCategory(
        new ExecutorDeploymentConfigurationError("x"),
      ),
    ).toBe("CONFIGURATION");
  });

  it("does not import the deployment module from the API", async () => {
    const apiRoot = resolve(import.meta.dirname, "../../api/src");
    const pending = [apiRoot];
    const files: string[] = [];
    while (pending.length > 0) {
      const directory = pending.pop();
      if (directory === undefined) continue;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) pending.push(path);
        else if (entry.name.endsWith(".ts")) files.push(path);
      }
    }
    const contents = await Promise.all(
      files.map((path) => readFile(path, "utf8")),
    );
    expect(contents.join("\n")).not.toContain("deployment-service");
  });
});
