import canonicalTimeline from "../data/audit-timeline.json";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createAuditDisplayModel, isDeeplyFrozen } from "./audit-display";

const fixture: unknown = canonicalTimeline;
const projectionId =
  "0xedf05d3ce6263095b0cd323396e558409eae16090d6b00b599454a22de8f2a05";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(?:ts|tsx)$/u.test(name) && !/\.test\.(?:ts|tsx)$/u.test(name)
        ? [path]
        : [];
  });
}

describe("COV-020 audit display boundary", () => {
  it("strictly parses, reconstructs, and freezes the canonical v2 timeline", () => {
    const model = createAuditDisplayModel(fixture);
    expect(model.schemaVersion).toBe("2");
    expect(model.projectionId).toBe(projectionId);
    expect(model.events).toHaveLength(21);
    expect(isDeeplyFrozen(model)).toBe(true);
    expect(model.claimBoundary).toEqual({
      circleSubmissionAttemptObserved: true,
      circleProviderOutcomeKnown: false,
      arcExecutionObserved: true,
      arcPaymentSettlement: false,
      paymentFinality: false,
      databaseFinancialAuthority: false,
      automaticResubmission: false,
    });
  });

  it("reconstructs the exact historical payment display", () => {
    const model = createAuditDisplayModel(fixture);
    expect(model.payment).toEqual({
      amount: "0.01 USDC",
      amountBaseUnits: "10000",
      network: "Arc Testnet",
      recipient: "0xDbf314C646792dbbD48070e799E7B1EE5d913aB1",
      vault: "0x39400A08b37B1121a8cc5AB9102943236eB58ECe",
      token: "0x3600000000000000000000000000000000000000",
      transactionHash:
        "0x1429af87afb5865933cb4bc3870100c8c4d0cde8795efc54e07a9460f8acea55",
      executionClassification: "ARC_EXECUTION_SUCCEEDED",
      providerOutcome: "UNKNOWN",
      automaticRetry: false,
    });
    expect(model.providerEvidence.progression).toEqual([
      "PREPARED",
      "SUBMISSION_ATTEMPT_STARTED",
      "UNKNOWN",
    ]);
    expect(model.arcEvidence.accounting).toEqual([
      { label: "totalSpent", value: "10000" },
      { label: "paymentCount", value: "1" },
      { label: "revoked", value: "false" },
      { label: "vault token balance", value: "2990000" },
    ]);
  });

  it("keeps provider UNKNOWN distinct from Arc execution success", () => {
    const model = createAuditDisplayModel(fixture);
    expect(model.providerEvidence.outcome).toBe("UNKNOWN");
    expect(model.payment.executionClassification).toBe(
      "ARC_EXECUTION_SUCCEEDED",
    );
    expect(model.arcEvidence.receiptStatus).toBe("SUCCESSFUL");
    expect(model.providerEvidence.automaticRetry).toBe(false);
  });

  it("preserves exact source, subject, causal, and detail values for inspection", () => {
    const model = createAuditDisplayModel(fixture);
    const reconciliation = model.events.find(
      ({ eventType }) => eventType === "EXECUTION_RECONCILIATION_RECORDED",
    );
    expect(reconciliation).toMatchObject({
      source: {
        kind: "ARC_EXECUTION_EVIDENCE",
        eventType: "EXECUTION_RECONCILIATION",
        position: "3",
      },
      causes: expect.arrayContaining([
        expect.stringMatching(/^0x[0-9a-f]{64}$/u),
      ]),
      details: expect.arrayContaining([
        { label: "classification", value: "ARC_EXECUTION_SUCCEEDED" },
      ]),
    });
  });

  it.each([
    ["unknown fields", { ...canonicalTimeline, unexpected: true }],
    ["schema v1", { ...canonicalTimeline, schemaVersion: "1" }],
    [
      "projection identity",
      { ...canonicalTimeline, projectionId: `0x${"0".repeat(64)}` },
    ],
    [
      "event identity",
      {
        ...canonicalTimeline,
        events: canonicalTimeline.events.map((event, index) =>
          index === 0 ? { ...event, eventId: `0x${"0".repeat(64)}` } : event,
        ),
      },
    ],
    [
      "claim boundary",
      {
        ...canonicalTimeline,
        claimBoundary: {
          ...canonicalTimeline.claimBoundary,
          paymentFinality: true,
        },
      },
    ],
  ])("rejects invalid %s", (_name, input) => {
    expect(() => createAuditDisplayModel(input)).toThrow();
  });

  it("contains no runtime network, persistence, mutation, or financial capability", () => {
    const root = resolve(import.meta.dirname, "..");
    const sources = ["app", "components", "lib"]
      .flatMap((directory) => sourceFiles(resolve(root, directory)))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    for (const forbidden of [
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "serviceWorker.register",
      "createWalletClient",
      "sendTransaction",
      "writeContract",
      "privateKeyToAccount",
      "@circle-fin",
      "@supabase",
      "node:child_process",
      "fetch(",
      "XMLHttpRequest",
      "WebSocket(",
      "use server",
    ]) {
      expect(sources).not.toContain(forbidden);
    }
  });
});
