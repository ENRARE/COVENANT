import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { covenantSpecSchema } from "@covenant/spec";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createExecutorDeploymentService,
  ExecutorDeploymentConfigurationError,
} from "../src/deployment-service-factory.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const TRUST_ANCHOR_FILE = resolve(
  ROOT,
  "deployment/arc-testnet/cov010-runtime-trust-anchor.json",
);
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const VAULT = "0x2405Da1115B47A9D60499E12aA216874dc44c75a";
const temporaryFiles: string[] = [];

type RuntimeTrustAnchorDocument = {
  provenance: Record<string, unknown>;
  covenantSpec: Record<string, unknown> & {
    vaultAddress: unknown;
    createdAt: unknown;
    validAfter: unknown;
  };
};

const ENV = Object.freeze({
  ARC_RPC_URL: "https://rpc.testnet.arc.network",
  COVENANT_VAULT_ADDRESS: VAULT,
  COVENANT_EXECUTOR_COVENANT_SPEC_FILE: TRUST_ANCHOR_FILE,
  CIRCLE_API_KEY: "x",
  CIRCLE_ENTITY_SECRET: "y",
  CIRCLE_WALLET_ID: "11111111-1111-5111-8111-111111111111",
  EXECUTOR_SIGNER_SOURCE: "synthetic-signer-source",
});

const DEPENDENCIES = Object.freeze({
  transport: {
    simulate: () => Promise.resolve({ status: "SIMULATED" }),
    submit: () =>
      Promise.resolve({
        status: "SUBMITTED",
        transactionId: "synthetic-transaction",
      }),
  },
  clock: { now: () => 1_785_620_000n },
  verifyArcChain: vi.fn(() => undefined),
  validateSignerSource: vi.fn(() => undefined),
});

async function readAnchor(): Promise<RuntimeTrustAnchorDocument> {
  return JSON.parse(
    await readFile(TRUST_ANCHOR_FILE, "utf8"),
  ) as RuntimeTrustAnchorDocument;
}

async function writeTemporaryAnchor(value: unknown): Promise<string> {
  const filename = resolve(
    tmpdir(),
    `covenant-cov010-runtime-anchor-${crypto.randomUUID()}.json`,
  );
  temporaryFiles.push(filename);
  await writeFile(filename, JSON.stringify(value), { mode: 0o600 });
  return filename;
}

afterEach(async () => {
  await Promise.all(
    temporaryFiles.splice(0).map((path) => unlink(path).catch(() => undefined)),
  );
});

describe("COV-010 reconstructed runtime trust anchor", () => {
  it("parses exactly one deployed-vault CovenantSpec for Arc Testnet USDC", async () => {
    const anchor = await readAnchor();
    const candidates = [anchor.covenantSpec];
    const matches = candidates.filter(
      (candidate) => candidate.vaultAddress === VAULT,
    );
    expect(matches).toHaveLength(1);
    const parsed = covenantSpecSchema.parse(matches[0]);
    expect(parsed.chainId).toBe(5_042_002n);
    expect(parsed.tokenAddress).toBe(ARC_USDC);
    expect(parsed.createdAt).toBe(parsed.validAfter);
    expect(anchor.provenance).toMatchObject({
      kind: "RECONSTRUCTED_RUNTIME_PROJECTION",
      historicalCovenantSpecRecovered: false,
      createdAtProvenance: "NORMALIZED_TO_VALID_AFTER_FOR_RUNTIME_SCHEMA_ONLY",
    });
  });

  it("is loaded successfully by the executor deployment composition", async () => {
    const service = await createExecutorDeploymentService({
      env: ENV,
      dependencies: DEPENDENCIES,
    });
    expect(Object.keys(service)).toEqual([
      "prepareExecution",
      "simulateAuthorizedPayment",
      "executeAuthorizedPayment",
    ]);
  });

  it("fails closed when the configured vault does not match", async () => {
    await expect(
      createExecutorDeploymentService({
        env: {
          ...ENV,
          COVENANT_VAULT_ADDRESS: "0x9000000000000000000000000000000000000009",
        },
        dependencies: DEPENDENCIES,
      }),
    ).rejects.toThrow(ExecutorDeploymentConfigurationError);
  });

  it("rejects a normalized createdAt later than validAfter", async () => {
    const modified = await readAnchor();
    modified.covenantSpec.createdAt = (
      BigInt(String(modified.covenantSpec.validAfter)) + 1n
    ).toString();
    const filename = await writeTemporaryAnchor(modified);
    await expect(
      createExecutorDeploymentService({
        env: { ...ENV, COVENANT_EXECUTOR_COVENANT_SPEC_FILE: filename },
        dependencies: DEPENDENCIES,
      }),
    ).rejects.toThrow(ExecutorDeploymentConfigurationError);
  });
});
