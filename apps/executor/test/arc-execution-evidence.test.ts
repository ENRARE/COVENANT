import { pad } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  createArcExecutionEvidenceReader,
  reconcileCircleAndArcEvidence,
  type ArcExecutionEvidence,
  type KnownArcObservationSource,
} from "../src/index.js";
import {
  COV018_ARC_EXPECTED,
  COV018_ARC_RAW_FIXTURE,
  COV018_BLOCK_HASH,
  cov018PaymentData,
  cov018TransferData,
} from "./fixtures/cov018-arc-execution.js";

type MutableRecord = Record<string, unknown>;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function object(value: unknown): MutableRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected fixture object");
  return value as MutableRecord;
}

function logs(receipt: unknown): MutableRecord[] {
  const value = object(receipt).logs;
  if (!Array.isArray(value)) throw new Error("Expected fixture logs");
  return value.map(object);
}

function logAt(receipt: unknown, index: number): MutableRecord {
  const log = logs(receipt)[index];
  if (log === undefined) throw new Error("Missing fixture log");
  return log;
}

function harness(
  overrides: Partial<{
    chainId: unknown;
    receipt: unknown;
    block: unknown;
    vaultState: unknown;
  }> = {},
) {
  const values = {
    chainId: clone(COV018_ARC_RAW_FIXTURE.chainId),
    receipt: clone(COV018_ARC_RAW_FIXTURE.receipt),
    block: clone(COV018_ARC_RAW_FIXTURE.block),
    vaultState: clone(COV018_ARC_RAW_FIXTURE.vaultState),
    ...overrides,
  };
  const calls: string[] = [];
  const source: KnownArcObservationSource = Object.freeze({
    readChainId: vi.fn(() => {
      calls.push("chainId");
      return Promise.resolve(values.chainId);
    }),
    readKnownTransactionReceipt: vi.fn(() => {
      calls.push("receipt");
      return Promise.resolve(values.receipt);
    }),
    readReceiptBlock: vi.fn(() => {
      calls.push("block");
      return Promise.resolve(values.block);
    }),
    readKnownVaultStateAtReceiptBlock: vi.fn(() => {
      calls.push("vaultState");
      return Promise.resolve(values.vaultState);
    }),
  });
  return {
    calls,
    source,
    reader: createArcExecutionEvidenceReader(source),
  };
}

async function observe(overrides?: Parameters<typeof harness>[0]) {
  return harness(overrides).reader.observeKnownExecution(COV018_ARC_EXPECTED);
}

function expectConflict(result: ArcExecutionEvidence, reason: string): void {
  expect(result).toEqual({ status: "EVIDENCE_CONFLICT", reason });
}

describe("COV-019 read-only Arc execution evidence", () => {
  it("correlates the sanitized COV-018 receipt, logs, and post-state", async () => {
    const result = await observe();
    expect(result).toEqual({
      status: "OBSERVED_SUCCESS",
      chainId: 5_042_002,
      transactionHash: COV018_ARC_EXPECTED.transactionHash,
      blockNumber: "56117505",
      blockHash: COV018_BLOCK_HASH,
      vault: COV018_ARC_EXPECTED.vault,
      covenantId: COV018_ARC_EXPECTED.covenantId,
      intentId: COV018_ARC_EXPECTED.intentId,
      authorizationId: COV018_ARC_EXPECTED.authorizationId,
      recipient: COV018_ARC_EXPECTED.recipient,
      amount: "10000",
      token: COV018_ARC_EXPECTED.token,
      transfer: {
        source: COV018_ARC_EXPECTED.vault,
        recipient: COV018_ARC_EXPECTED.recipient,
        amount: "10000",
      },
      vaultState: {
        totalSpent: "10000",
        paymentCount: "1",
        revoked: false,
        tokenBalance: "2990000",
      },
    });
  });

  it("reports a reverted receipt without reading vault state", async () => {
    const receipt = clone(COV018_ARC_RAW_FIXTURE.receipt) as MutableRecord;
    receipt.status = "0x0";
    receipt.logs = [];
    const test = harness({ receipt });
    await expect(
      test.reader.observeKnownExecution(COV018_ARC_EXPECTED),
    ).resolves.toMatchObject({ status: "OBSERVED_REVERTED" });
    expect(test.calls).toEqual(["chainId", "receipt", "block"]);
  });

  it("rejects a reverted receipt that conflicts with emitted logs", async () => {
    const receipt = clone(COV018_ARC_RAW_FIXTURE.receipt) as MutableRecord;
    receipt.status = "0x0";
    expectConflict(await observe({ receipt }), "REVERTED_RECEIPT_HAS_LOGS");
  });

  it("reports a missing known receipt without reading block or state", async () => {
    const test = harness({ receipt: null });
    await expect(
      test.reader.observeKnownExecution(COV018_ARC_EXPECTED),
    ).resolves.toEqual({ status: "NOT_OBSERVED" });
    expect(test.calls).toEqual(["chainId", "receipt"]);
  });

  it.each([
    ["wrong chain", { chainId: "0x1" }, "WRONG_CHAIN"],
    ["malformed chain", { chainId: "5042002" }, "WRONG_CHAIN"],
    [
      "malformed receipt",
      { receipt: { secret: "rpc-secret" } },
      "MALFORMED_RECEIPT",
    ],
  ] as const)("rejects %s", async (_name, overrides, reason) => {
    expectConflict(await observe(overrides), reason);
  });

  it.each([
    [
      "transaction hash",
      "transactionHash",
      `0x${"12".repeat(32)}`,
      "TRANSACTION_HASH_MISMATCH",
    ],
    [
      "vault target",
      "to",
      "0x1111111111111111111111111111111111111111",
      "VAULT_TARGET_MISMATCH",
    ],
    ["block hash", "blockHash", `0x${"13".repeat(32)}`, "BLOCK_MISMATCH"],
  ] as const)(
    "rejects a mismatched %s",
    async (_name, field, value, reason) => {
      const receipt = clone(COV018_ARC_RAW_FIXTURE.receipt) as MutableRecord;
      receipt[field] = value;
      expectConflict(await observe({ receipt }), reason);
    },
  );

  it("rejects malformed block metadata", async () => {
    expectConflict(
      await observe({ block: { number: 56_117_505 } }),
      "MALFORMED_BLOCK",
    );
  });

  it("rejects a removed log", async () => {
    const receipt = clone(COV018_ARC_RAW_FIXTURE.receipt);
    logAt(receipt, 0).removed = true;
    expectConflict(await observe({ receipt }), "REMOVED_LOG");
  });

  it.each([
    ["PaymentExecuted", 1, "MISSING_PAYMENT_EXECUTED"],
    ["token Transfer", 0, "MISSING_TOKEN_TRANSFER"],
  ] as const)(
    "rejects missing %s evidence",
    async (_name, removeIndex, reason) => {
      const receipt = clone(COV018_ARC_RAW_FIXTURE.receipt) as MutableRecord;
      (receipt.logs as unknown[]).splice(removeIndex, 1);
      expectConflict(await observe({ receipt }), reason);
    },
  );

  it.each([
    ["PaymentExecuted", 1, "DUPLICATE_PAYMENT_EXECUTED"],
    ["token Transfer", 0, "DUPLICATE_TOKEN_TRANSFER"],
  ] as const)(
    "rejects duplicate %s evidence",
    async (_name, copyIndex, reason) => {
      const receipt = clone(COV018_ARC_RAW_FIXTURE.receipt) as MutableRecord;
      const receiptLogs = receipt.logs as unknown[];
      const duplicate = clone(receiptLogs[copyIndex]);
      object(duplicate).logIndex = "0x2";
      receiptLogs.push(duplicate);
      expectConflict(await observe({ receipt }), reason);
    },
  );

  it.each([
    ["covenant ID", 1, `0x${"21".repeat(32)}`, "WRONG_COVENANT_ID"],
    ["intent ID", 2, `0x${"22".repeat(32)}`, "WRONG_INTENT_ID"],
    ["authorization ID", 3, `0x${"23".repeat(32)}`, "WRONG_AUTHORIZATION_ID"],
  ] as const)(
    "rejects the wrong %s",
    async (_name, topicIndex, value, reason) => {
      const receipt = clone(COV018_ARC_RAW_FIXTURE.receipt);
      const topics = logAt(receipt, 1).topics as unknown[];
      topics[topicIndex] = value;
      expectConflict(await observe({ receipt }), reason);
    },
  );

  it.each([
    [
      "recipient",
      cov018PaymentData("0x1111111111111111111111111111111111111111"),
      "WRONG_RECIPIENT",
    ],
    [
      "amount",
      cov018PaymentData(COV018_ARC_EXPECTED.recipient, 10_001n),
      "WRONG_AMOUNT",
    ],
  ] as const)(
    "rejects the wrong PaymentExecuted %s",
    async (_name, data, reason) => {
      const receipt = clone(COV018_ARC_RAW_FIXTURE.receipt);
      logAt(receipt, 1).data = data;
      expectConflict(await observe({ receipt }), reason);
    },
  );

  it.each([
    [
      "token",
      "address",
      "0x1111111111111111111111111111111111111111",
      "WRONG_TOKEN",
    ],
    [
      "source",
      "topics",
      [0, pad("0x1111111111111111111111111111111111111111", { size: 32 })],
      "WRONG_TRANSFER_SOURCE",
    ],
    [
      "recipient",
      "topics",
      [1, pad("0x1111111111111111111111111111111111111111", { size: 32 })],
      "WRONG_TRANSFER_RECIPIENT",
    ],
    ["amount", "data", cov018TransferData(10_001n), "WRONG_TRANSFER_AMOUNT"],
  ] as const)(
    "rejects the wrong transfer %s",
    async (_name, field, value, reason) => {
      const receipt = clone(COV018_ARC_RAW_FIXTURE.receipt);
      const transfer = logAt(receipt, 0);
      if (field === "topics") {
        const [offset, topic] = value as readonly [number, unknown];
        (transfer.topics as unknown[])[offset + 1] = topic;
      } else {
        transfer[field] = value;
      }
      expectConflict(await observe({ receipt }), reason);
    },
  );

  it("rejects malformed PaymentExecuted data", async () => {
    const receipt = clone(COV018_ARC_RAW_FIXTURE.receipt);
    logAt(receipt, 1).data = "0x12";
    expectConflict(await observe({ receipt }), "MALFORMED_PAYMENT_EXECUTED");
  });

  it("rejects malformed Transfer topics", async () => {
    const receipt = clone(COV018_ARC_RAW_FIXTURE.receipt);
    (logAt(receipt, 0).topics as unknown[]).pop();
    expectConflict(await observe({ receipt }), "MALFORMED_TOKEN_TRANSFER");
  });

  it.each([
    [{ totalSpent: "10000" }, "MALFORMED_VAULT_STATE"],
    [
      { ...COV018_ARC_RAW_FIXTURE.vaultState, tokenBalance: "0x2d9faf" },
      "VAULT_STATE_CONFLICT",
    ],
  ] as const)(
    "fails closed on vault state evidence",
    async (vaultState, reason) => {
      expectConflict(await observe({ vaultState }), reason);
    },
  );

  it("rejects malformed expected authorized execution before any observation", async () => {
    const test = harness();
    const result = await test.reader.observeKnownExecution({
      ...COV018_ARC_EXPECTED,
      amount: 10_000,
    });
    expectConflict(result, "MALFORMED_EXPECTATION");
    expect(test.calls).toEqual([]);
  });

  it("sanitizes observation exceptions and exposes no upstream text", async () => {
    const source: KnownArcObservationSource = {
      readChainId: () =>
        Promise.reject(new Error("rpc-key https://rpc.invalid")),
      readKnownTransactionReceipt: () => Promise.reject(new Error("unused")),
      readReceiptBlock: () => Promise.reject(new Error("unused")),
      readKnownVaultStateAtReceiptBlock: () =>
        Promise.reject(new Error("unused")),
    };
    const result =
      await createArcExecutionEvidenceReader(source).observeKnownExecution(
        COV018_ARC_EXPECTED,
      );
    expect(result).toEqual({ status: "OBSERVATION_UNAVAILABLE" });
    expect(JSON.stringify(result)).not.toMatch(/rpc-key|rpc\.invalid|stack/i);
  });

  it("has only injected fixed reads and needs no network or credential", async () => {
    const test = harness();
    expect(Object.keys(test.source).sort()).toEqual([
      "readChainId",
      "readKnownTransactionReceipt",
      "readKnownVaultStateAtReceiptBlock",
      "readReceiptBlock",
    ]);
    expect(Object.keys(test.reader)).toEqual(["observeKnownExecution"]);
    await test.reader.observeKnownExecution(COV018_ARC_EXPECTED);
    expect(test.calls).toEqual(["chainId", "receipt", "block", "vaultState"]);
  });

  it("does not retain an additional injected mutation capability", async () => {
    const test = harness();
    const sendTransaction = vi.fn();
    const source = { ...test.source, sendTransaction };
    const reader = createArcExecutionEvidenceReader(source);
    delete (source as Partial<typeof source>).sendTransaction;
    await reader.observeKnownExecution(COV018_ARC_EXPECTED);
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(Object.keys(reader)).toEqual(["observeKnownExecution"]);
  });

  it("normalizes deterministically", async () => {
    const first = await observe();
    const second = await observe();
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("Circle and Arc evidence reconciliation", () => {
  async function successfulArc() {
    return observe();
  }

  it("resolves provider UNKNOWN only through independent Arc success", async () => {
    const result = reconcileCircleAndArcEvidence(
      { status: COV018_ARC_RAW_FIXTURE.circleLocalDurableState },
      await successfulArc(),
    );
    expect(result.classification).toBe("ARC_EXECUTION_SUCCEEDED");
    expect(result.provider).toEqual({ status: "UNKNOWN" });
  });

  it("keeps provider success-like evidence provider-only without Arc evidence", () => {
    const result = reconcileCircleAndArcEvidence(
      { status: "OBSERVED", providerState: "COMPLETE" },
      { status: "NOT_OBSERVED" },
    );
    expect(result.classification).toBe("PROVIDER_ONLY");
    expect(result.arc).toEqual({ status: "NOT_OBSERVED" });
  });

  it("classifies unknown provider and absent Arc receipt separately", () => {
    expect(
      reconcileCircleAndArcEvidence(
        { status: "UNKNOWN" },
        { status: "NOT_OBSERVED" },
      ).classification,
    ).toBe("ARC_NOT_OBSERVED");
  });

  it("reports observation unavailability independently", () => {
    expect(
      reconcileCircleAndArcEvidence(
        { status: "UNKNOWN" },
        { status: "OBSERVATION_UNAVAILABLE" },
      ).classification,
    ).toBe("OBSERVATION_UNAVAILABLE");
  });

  it("reports a proven reverted receipt", async () => {
    const receipt = clone(COV018_ARC_RAW_FIXTURE.receipt) as MutableRecord;
    receipt.status = "0x0";
    receipt.logs = [];
    const arc = await observe({ receipt });
    expect(
      reconcileCircleAndArcEvidence({ status: "UNKNOWN" }, arc).classification,
    ).toBe("ARC_EXECUTION_REVERTED");
  });

  it("fails closed when provider execution-like state conflicts with an Arc revert", async () => {
    const receipt = clone(COV018_ARC_RAW_FIXTURE.receipt) as MutableRecord;
    receipt.status = "0x0";
    receipt.logs = [];
    const arc = await observe({ receipt });
    expect(
      reconcileCircleAndArcEvidence(
        { status: "OBSERVED", providerState: "COMPLETE" },
        arc,
      ).classification,
    ).toBe("EVIDENCE_CONFLICT");
  });

  it.each([
    [
      "provider failure versus Arc success",
      { status: "OBSERVED", providerState: "FAILED" },
    ],
    [
      "transaction identity",
      {
        status: "OBSERVED",
        providerState: "SENT",
        transactionHash: `0x${"44".repeat(32)}`,
      },
    ],
  ] as const)("fails closed on %s conflict", async (_name, provider) => {
    expect(
      reconcileCircleAndArcEvidence(provider, await successfulArc())
        .classification,
    ).toBe("EVIDENCE_CONFLICT");
  });

  it("fails closed on malformed provider evidence without exposing it", async () => {
    const result = reconcileCircleAndArcEvidence(
      { status: "COMPLETE", raw: "circle-secret" },
      await successfulArc(),
    );
    expect(result.classification).toBe("EVIDENCE_CONFLICT");
    expect(JSON.stringify(result)).not.toContain("circle-secret");
  });

  it("strictly parses normalized Arc evidence from unknown", async () => {
    const arc = { ...(await successfulArc()), raw: "rpc-secret" };
    const result = reconcileCircleAndArcEvidence({ status: "UNKNOWN" }, arc);
    expect(result).toEqual({
      classification: "EVIDENCE_CONFLICT",
      provider: { status: "UNKNOWN" },
      arc: {
        status: "EVIDENCE_CONFLICT",
        reason: "MALFORMED_ARC_EVIDENCE",
      },
    });
    expect(JSON.stringify(result)).not.toContain("rpc-secret");
  });

  it("rejects internally inconsistent normalized Arc evidence", async () => {
    const arc = clone(await successfulArc()) as MutableRecord;
    object(arc.transfer).amount = "10001";
    expect(
      reconcileCircleAndArcEvidence({ status: "UNKNOWN" }, arc).classification,
    ).toBe("EVIDENCE_CONFLICT");
  });
});
