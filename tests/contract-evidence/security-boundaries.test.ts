import type { AuthorizedTransactionRequest } from "@covenant/executor";
import { describe, expect, it } from "vitest";
import { ContractEvidenceError } from "./errors.js";
import { LOCAL_EVIDENCE_TYPES, localEvidenceResultSchema } from "./schemas.js";
import { ViemTransactionTransport } from "./viem-transaction-transport.js";

const vault = "0x4000000000000000000000000000000000000004";
const payer = "0x5000000000000000000000000000000000000005";
const other = "0x6000000000000000000000000000000000000006";
const executeData = `0x7ee0e4da${"00".repeat(32)}` as const;

function transport() {
  return new ViemTransactionTransport({
    publicClient: {
      getChainId: () => Promise.resolve(5_042_002),
    } as never,
    walletClient: {} as never,
    payer,
    vault,
  });
}

function request(
  overrides: Partial<{
    chainId: bigint;
    to: `0x${string}`;
    value: bigint;
    data: `0x${string}`;
  }> = {},
): AuthorizedTransactionRequest {
  return {
    chainId: 5_042_002n,
    to: vault,
    value: 0n,
    data: executeData,
    ...overrides,
  } as unknown as AuthorizedTransactionRequest;
}

describe("contract-evidence public boundary", () => {
  it.each([
    ["chain", { chainId: 1n }],
    ["target", { to: other }],
    ["native value", { value: 1n }],
    ["calldata selector", { data: `0x12345678${"00".repeat(32)}` }],
  ] as const)("rejects caller-controlled %s", async (_label, override) => {
    await expect(transport().simulate(request(override))).rejects.toEqual(
      new ContractEvidenceError("SUBMISSION_FAILURE"),
    );
  });

  it("strictly rejects public leakage fields", () => {
    const safe = {
      schemaVersion: "1",
      mode: "LOCAL_ANVIL",
      chainId: "5042002",
      status: "VERIFIED",
      evidence: LOCAL_EVIDENCE_TYPES.map((type) => ({
        type,
        status: "PASS",
      })),
      counts: {
        submittedTransactions: "11",
        successfulReceipts: "7",
        revertedReceipts: "4",
      },
    };
    expect(localEvidenceResultSchema.parse(safe)).toEqual(safe);
    for (const forbidden of [
      "privateKey",
      "signature",
      "signedEnvelope",
      "typedData",
      "calldata",
      "rpcUrl",
      "port",
      "pid",
      "receipt",
      "logs",
      "path",
      "environment",
    ]) {
      expect(() =>
        localEvidenceResultSchema.parse({ ...safe, [forbidden]: "secret" }),
      ).toThrow();
    }
  });
});
