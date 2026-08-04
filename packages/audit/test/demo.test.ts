import {
  AuditProjectionError,
  projectAuditTimeline,
  projectAuditTimelineJson,
} from "../src/index.js";
import { keccak256, stringToHex } from "viem";
import { describe, expect, it } from "vitest";
import { approvedDemoSource, bundle, rejectedDemoSource } from "./fixtures.js";

const alternateId = `0x${"b".repeat(64)}`;

function recordFor(
  source: { events: readonly { eventType: string }[] },
  eventType: string,
): Record<string, unknown> {
  const event = source.events.find(
    (candidate) => candidate.eventType === eventType,
  );
  if (event === undefined) throw new Error(`Expected ${eventType} fixture`);
  return event;
}

function refreshDemoEventId(event: Record<string, unknown>): void {
  event.eventId = keccak256(
    stringToHex(
      [
        event.schemaVersion,
        event.runtimeId,
        event.sequence,
        event.eventType,
        event.scenarioId ?? "",
      ].join(":"),
    ),
  );
}

function projectionErrorCode(input: unknown): string | undefined {
  try {
    projectAuditTimeline(input);
  } catch (error) {
    if (error instanceof AuditProjectionError) return error.code;
    throw error;
  }
  return undefined;
}

function eventAt(
  events: ReturnType<typeof projectAuditTimeline>["events"],
  index: number,
) {
  const event = events.at(index);
  if (event === undefined) throw new Error("Expected fixture event");
  return event;
}

describe("COV-015 demo audit adapter", () => {
  it("preserves the simulated happy-path distinctions", () => {
    const timeline = projectAuditTimeline(bundle(approvedDemoSource()));
    expect(timeline.events.map(({ eventType }) => eventType)).toEqual([
      "PROPOSAL_CREATED",
      "POLICY_DECISION_RECORDED",
      "SIGNED_AUTHORIZATION_CREATED",
      "EXECUTOR_REQUEST_PREPARED",
      "TRANSPORT_SIMULATION_ACCEPTED",
      "SIMULATED_SUBMISSION_REFERENCE_RECORDED",
    ]);
    const reference = eventAt(timeline.events, -1);
    expect(reference.stage).toBe("TRANSPORT_ACCEPTANCE");
    expect(reference.claimScope).toBe("SIMULATED_SUBMISSION_REFERENCE_ONLY");
    expect(reference.source.eventType).toBe("SUBMISSION_SIMULATED");
    expect(
      timeline.events.some(({ stage }) => stage === "TRANSACTION_SUBMISSION"),
    ).toBe(false);
    expect(
      timeline.events.some(({ stage }) => stage === "EXECUTION_EVIDENCE"),
    ).toBe(false);
    expect(
      timeline.events.some(({ stage }) => stage === "SETTLEMENT_EVIDENCE"),
    ).toBe(false);
  });

  it("classifies direct demo lifecycle records as observational", () => {
    const timeline = projectAuditTimeline(bundle(approvedDemoSource()));
    for (const eventType of [
      "PROPOSAL_CREATED",
      "POLICY_DECISION_RECORDED",
      "SIGNED_AUTHORIZATION_CREATED",
    ] as const) {
      expect(
        timeline.events.find((event) => event.eventType === eventType),
      ).toMatchObject({ evidenceClass: "OBSERVATIONAL_DEMO_AUDIT" });
    }
  });

  it("derives only the complete fixed compromised-proposer rejection", () => {
    const timeline = projectAuditTimeline(bundle(rejectedDemoSource()));
    expect(timeline.events.map(({ eventType }) => eventType)).toEqual([
      "PROPOSAL_CREATED",
      "POLICY_DECISION_RECORDED",
      "INDIRECT_PROMPT_INJECTION_REJECTED",
    ]);
    const decision = eventAt(timeline.events, 1);
    expect(decision.outcome).toBe("REJECTED");
    const derived = eventAt(timeline.events, 2);
    expect(derived.evidenceClass).toBe("DERIVED_SECURITY_SCENARIO_EVIDENCE");
    expect(derived.claimScope).toBe("FIXED_COMPROMISED_PROPOSER_REJECTION");
    expect(derived.causes).toHaveLength(2);
    expect(JSON.stringify(derived.details)).toContain(
      "FIXED_COMPROMISED_PROPOSER_SCENARIO_ONLY",
    );
    expect(derived.details.sourceEventIds).toHaveLength(3);
    expect(
      timeline.events.some(
        ({ stage }) =>
          stage === "SIGNED_AUTHORIZATION" ||
          stage === "TRANSPORT_PREPARATION" ||
          stage === "TRANSPORT_ACCEPTANCE" ||
          stage === "TRANSACTION_SUBMISSION" ||
          stage === "EXECUTION_EVIDENCE" ||
          stage === "SETTLEMENT_EVIDENCE",
      ),
    ).toBe(false);
  });

  it("does not use occurredAt to order or identify events", () => {
    const source = approvedDemoSource();
    const reversedTimes = structuredClone(source);
    for (const [index, event] of reversedTimes.events.entries()) {
      event.occurredAt = String(99_999 - index);
      const scenarioId = "scenarioId" in event ? event.scenarioId : "";
      event.eventId = keccak256(
        stringToHex(
          [
            event.schemaVersion,
            event.runtimeId,
            event.sequence,
            event.eventType,
            scenarioId,
          ].join(":"),
        ),
      );
    }
    const original = projectAuditTimeline(bundle(source));
    const changed = projectAuditTimeline(bundle(reversedTimes));
    expect(changed.events.map(({ eventType }) => eventType)).toEqual(
      original.events.map(({ eventType }) => eventType),
    );
    expect(changed.events.map(({ eventId }) => eventId)).toEqual(
      original.events.map(({ eventId }) => eventId),
    );
    expect(projectAuditTimelineJson(bundle(reversedTimes))).not.toBe(
      projectAuditTimelineJson(bundle(source)),
    );
  });

  it("rejects a decision whose covenant differs from its proposal", () => {
    const source = approvedDemoSource();
    recordFor(source, "DECISION_APPROVED").covenantId = alternateId;
    expect(projectionErrorCode(bundle(source))).toBe("AUDIT_SOURCE_CONFLICT");
  });

  it.each(["intentId", "decisionId"] as const)(
    "rejects an authorization with a different %s",
    (field) => {
      const source = approvedDemoSource();
      recordFor(source, "AUTHORIZATION_ISSUED")[field] = alternateId;
      expect(projectionErrorCode(bundle(source))).toBe("AUDIT_SOURCE_CONFLICT");
    },
  );

  it.each(["intentId", "authorizationId"] as const)(
    "rejects executor preparation with a different %s",
    (field) => {
      const source = approvedDemoSource();
      recordFor(source, "EXECUTOR_REQUEST_PREPARED")[field] = alternateId;
      expect(projectionErrorCode(bundle(source))).toBe("AUDIT_SOURCE_CONFLICT");
    },
  );

  it.each(["SIMULATION_ACCEPTED", "SUBMISSION_SIMULATED"] as const)(
    "rejects %s with a different execution ID",
    (eventType) => {
      const source = approvedDemoSource();
      recordFor(source, eventType).executionId = alternateId;
      expect(projectionErrorCode(bundle(source))).toBe("AUDIT_SOURCE_CONFLICT");
    },
  );

  it("rejects a conflicting duplicate logical proposal", () => {
    const source = approvedDemoSource();
    const duplicate = structuredClone(
      recordFor(source, "PAYMENT_INTENT_PROPOSED"),
    );
    duplicate.sequence = "9";
    duplicate.occurredAt = "10009";
    duplicate.amount = "2";
    refreshDemoEventId(duplicate);
    source.events.push(duplicate as unknown as (typeof source.events)[number]);
    expect(projectionErrorCode(bundle(source))).toBe("AUDIT_SOURCE_CONFLICT");
  });

  it("rejects a conflicting duplicate logical decision", () => {
    const source = approvedDemoSource();
    const duplicate = structuredClone(recordFor(source, "DECISION_APPROVED"));
    duplicate.sequence = "9";
    duplicate.occurredAt = "10009";
    duplicate.eventType = "DECISION_REJECTED";
    refreshDemoEventId(duplicate);
    source.events.push(duplicate as unknown as (typeof source.events)[number]);
    expect(projectionErrorCode(bundle(source))).toBe("AUDIT_SOURCE_CONFLICT");
  });

  it("rejects a changed demo source identity body across wrappers independent of wrapper order", () => {
    const original = approvedDemoSource();
    const changed = structuredClone(original);
    recordFor(changed, "PAYMENT_INTENT_PROPOSED").covenantId = alternateId;
    const forward = projectionErrorCode(bundle(original, changed));
    const reversed = projectionErrorCode(bundle(changed, original));
    expect(forward).toBe("AUDIT_SOURCE_CONFLICT");
    expect(reversed).toBe(forward);
  });

  it("does not derive the fixed compromise event when another rule fails", () => {
    const source = rejectedDemoSource();
    const ruleResults = recordFor(source, "RULES_EVALUATED").ruleResults;
    if (!Array.isArray(ruleResults)) throw new Error("Expected rule fixture");
    const extraRule = ruleResults.find(
      (rule: unknown): rule is Record<string, unknown> =>
        rule !== null &&
        typeof rule === "object" &&
        "ruleId" in rule &&
        rule.ruleId === "amount_within_limit",
    );
    if (extraRule === undefined) throw new Error("Expected canonical rule");
    extraRule.status = "FAIL";
    const timeline = projectAuditTimeline(bundle(source));
    expect(
      timeline.events.some(
        (event) => event.eventType === "INDIRECT_PROMPT_INJECTION_REJECTED",
      ),
    ).toBe(false);
  });

  it("rejects the compromised pattern when proposal and decision covenants differ", () => {
    const source = rejectedDemoSource();
    recordFor(source, "DECISION_REJECTED").covenantId = alternateId;
    expect(projectionErrorCode(bundle(source))).toBe("AUDIT_SOURCE_CONFLICT");
  });

  it("rejects authorization or transport descendants in the compromised scenario", () => {
    const source = rejectedDemoSource();
    const approved = approvedDemoSource();
    const authorization = structuredClone(
      recordFor(approved, "AUTHORIZATION_ISSUED"),
    );
    authorization.scenarioId = "compromised-proposer-v1";
    authorization.sequence = "23";
    authorization.occurredAt = "10023";
    refreshDemoEventId(authorization);
    source.events.push(
      authorization as unknown as (typeof source.events)[number],
    );
    expect(projectionErrorCode(bundle(source))).toBe("AUDIT_SOURCE_CONFLICT");
  });
});
