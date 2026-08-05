import canonicalTimeline from "../data/audit-timeline.json";
import { describe, expect, it } from "vitest";
import { createAuditDisplayModel, isDeeplyFrozen } from "./audit-display";

const fixture: unknown = canonicalTimeline;

describe("COV-016 audit display boundary", () => {
  it("strictly parses, reconstructs, and freezes the canonical timeline", () => {
    const model = createAuditDisplayModel(fixture);
    expect(model.projectionId).toBe(
      "0x2d746e4eac75eab7cb35182a25afd8b669335d8bbdf175fd72fa1598ba8d0bc3",
    );
    expect(model.events).toHaveLength(19);
    expect(isDeeplyFrozen(model)).toBe(true);
    expect(model.claimBoundary).toEqual({
      circleExecution: false,
      arcPaymentSettlement: false,
      paymentFinality: false,
      databaseFinancialAuthority: false,
    });
  });

  it.each([
    ["SETTLEMENT_EVIDENCE_RECORDED", "LOCAL_ANVIL_SETTLEMENT_OBSERVATION"],
    ["ARC_DEPLOYMENT_EVIDENCE_VERIFIED", "ARC_DEPLOYMENT_TRANSACTION_ONLY"],
    [
      "INDIRECT_PROMPT_INJECTION_REJECTED",
      "FIXED_COMPROMISED_PROPOSER_REJECTION",
    ],
  ])("preserves %s as %s", (eventType, claimScope) => {
    const event = createAuditDisplayModel(fixture).events.find(
      (item) => item.eventType === eventType,
    );
    expect(event?.claimScope).toBe(claimScope);
  });

  it("preserves Arc finality details without promoting them", () => {
    const event = createAuditDisplayModel(fixture).events.find(
      (item) => item.eventType === "ARC_DEPLOYMENT_EVIDENCE_VERIFIED",
    );
    expect(event?.details).toContainEqual({
      label: "finalityState",
      value: "FINAL_ARC_TRANSACTION",
    });
    expect(event?.details).toContainEqual({
      label: "finalityScope",
      value: "ARC_DEPLOYMENT_TRANSACTION_ONLY",
    });
  });

  it.each([
    ["unknown fields", { ...canonicalTimeline, unexpected: true }],
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
      "canonical sequence",
      {
        ...canonicalTimeline,
        events: canonicalTimeline.events.map((event, index) =>
          index === 1 ? { ...event, sequence: "99" } : event,
        ),
      },
    ],
    [
      "classification",
      {
        ...canonicalTimeline,
        events: canonicalTimeline.events.map((event, index) =>
          index === 0 ? { ...event, claimScope: "PROPOSAL_ONLY" } : event,
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
});
