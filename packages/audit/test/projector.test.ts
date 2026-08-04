import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  auditTimelineSchema,
  projectAuditTimeline,
  projectAuditTimelineJson,
} from "../src/index.js";
import { describe, expect, it } from "vitest";
import {
  bundle,
  executorSource,
  localEvidenceSource,
  signedFlowSource,
} from "./fixtures.js";

function arcManifest(): unknown {
  return JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        "../../../evidence/arc-testnet/cov-010/deployment-manifest.json",
      ),
      "utf8",
    ),
  );
}

function detail(event: { details: unknown }): Record<string, unknown> {
  return event.details as Record<string, unknown>;
}

function requireEvent(
  timeline: ReturnType<typeof projectAuditTimeline>,
  eventType: ReturnType<
    typeof projectAuditTimeline
  >["events"][number]["eventType"],
) {
  const event = timeline.events.find(
    (candidate) => candidate.eventType === eventType,
  );
  if (event === undefined)
    throw new Error(`Expected ${eventType} fixture event`);
  return event;
}

describe("COV-015 deterministic audit projector", () => {
  it("projects the complete approved, local-evidence, and Arc-deployment lifecycle", () => {
    const timeline = projectAuditTimeline(
      bundle(
        signedFlowSource(),
        executorSource({
          status: "SUBMITTED",
          transactionId: "opaque-transport-reference-1",
        }),
        localEvidenceSource,
        { kind: "ARC_DEPLOYMENT_EVIDENCE", manifest: arcManifest() },
      ),
    );

    expect(auditTimelineSchema.parse(timeline)).toEqual(timeline);
    expect(timeline).toMatchObject({
      schemaVersion: "1",
      mode: "OFFLINE_AUDIT_TIMELINE",
      authoritative: false,
      claimBoundary: {
        circleExecution: false,
        arcPaymentSettlement: false,
        paymentFinality: false,
        databaseFinancialAuthority: false,
      },
    });
    expect(timeline.events.map(({ eventType }) => eventType)).toEqual([
      "ARC_DEPLOYMENT_EVIDENCE_VERIFIED",
      "LOCAL_DEPLOYMENT_EVIDENCE_VERIFIED",
      "LOCAL_VAULT_FUNDING_EVIDENCE_VERIFIED",
      "PROPOSAL_CREATED",
      "POLICY_DECISION_RECORDED",
      "SIGNED_AUTHORIZATION_CREATED",
      "EXECUTOR_REQUEST_PREPARED",
      "TRANSPORT_SUBMISSION_ACCEPTED",
      "TRANSACTION_SUBMISSION_RECORDED",
      "EXECUTION_EVIDENCE_VERIFIED",
      "SETTLEMENT_EVIDENCE_RECORDED",
      "REPLAY_REJECTED",
      "DIRECT_VAULT_BYPASS_REJECTED",
      "NON_ISSUER_REVOCATION_REJECTED",
      "REVOCATION_VERIFIED",
      "POST_REVOCATION_EXECUTION_REJECTED",
    ]);
    expect(timeline.events.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: timeline.events.length }, (_, index) =>
        String(index + 1),
      ),
    );

    const accepted = requireEvent(timeline, "TRANSPORT_SUBMISSION_ACCEPTED");
    expect(accepted.stage).toBe("TRANSPORT_ACCEPTANCE");
    expect(detail(accepted).transactionId).toBe("opaque-transport-reference-1");
    expect(timeline.events).not.toContainEqual(
      expect.objectContaining({
        stage: "TRANSACTION_SUBMISSION",
        source: accepted.source,
      }),
    );

    const settlement = requireEvent(timeline, "SETTLEMENT_EVIDENCE_RECORDED");
    expect(settlement.claimScope).toBe("LOCAL_ANVIL_SETTLEMENT_OBSERVATION");
    expect(detail(settlement)).toEqual({ mode: "LOCAL_ANVIL", status: "PASS" });

    const arc = requireEvent(timeline, "ARC_DEPLOYMENT_EVIDENCE_VERIFIED");
    expect(arc.claimScope).toBe("ARC_DEPLOYMENT_TRANSACTION_ONLY");
    expect(detail(arc).finalityScope).toBe("ARC_DEPLOYMENT_TRANSACTION_ONLY");
    const serialized = projectAuditTimelineJson(
      bundle(
        signedFlowSource(),
        executorSource({
          status: "SUBMITTED",
          transactionId: "opaque-transport-reference-1",
        }),
        localEvidenceSource,
        { kind: "ARC_DEPLOYMENT_EVIDENCE", manifest: arcManifest() },
      ),
    );
    expect(serialized.endsWith("\n")).toBe(true);
    expect(serialized).not.toContain("deployerAddress");
    expect(serialized).not.toContain('constructor"');
    expect(serialized).not.toContain(`0x${"1".repeat(130)}`);
    expect(serialized).not.toContain(`0x${"2".repeat(130)}`);
    expect(serialized).not.toContain(`0x${"3".repeat(130)}`);
    expect(serialized).not.toContain("calldata");
    expect(serialized).not.toContain("PAYMENT_FINALITY_RECORDED");
  });

  it("is byte deterministic across source order, duplicates, and invocation time", () => {
    const sources = [
      signedFlowSource(),
      executorSource({ status: "SIMULATED" }),
      localEvidenceSource,
    ];
    const first = projectAuditTimelineJson(bundle(...sources));
    const shuffled = projectAuditTimelineJson(
      bundle(sources[2], sources[0], sources[1], sources[0], sources[2]),
    );
    expect(shuffled).toBe(first);
    expect(JSON.parse(shuffled)).toMatchObject({
      projectionId: projectAuditTimeline(bundle(...sources)).projectionId,
    });
  });

  it("returns a deeply frozen projection", () => {
    const timeline = projectAuditTimeline(bundle(signedFlowSource()));
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== "object") return;
      expect(Object.isFrozen(value)).toBe(true);
      for (const child of Object.values(value)) visit(child);
    };
    visit(timeline);
  });

  it("projects the committed Arc manifest as deployment evidence only", () => {
    const timeline = projectAuditTimeline(
      bundle({ kind: "ARC_DEPLOYMENT_EVIDENCE", manifest: arcManifest() }),
    );
    expect(timeline.events).toHaveLength(1);
    expect(timeline.events[0]).toMatchObject({
      eventType: "ARC_DEPLOYMENT_EVIDENCE_VERIFIED",
      stage: "DEPLOYMENT_EVIDENCE",
      claimScope: "ARC_DEPLOYMENT_TRANSACTION_ONLY",
    });
    expect(
      timeline.events.some(({ stage }) =>
        [
          "PROPOSAL",
          "SIGNED_AUTHORIZATION",
          "TRANSPORT_ACCEPTANCE",
          "TRANSACTION_SUBMISSION",
          "EXECUTION_EVIDENCE",
          "SETTLEMENT_EVIDENCE",
        ].includes(stage),
      ),
    ).toBe(false);
  });

  it("emits only the stages supported by the supplied signed-flow sources", () => {
    const decisionOnly = projectAuditTimeline(
      bundle(signedFlowSource({ rejected: true })),
    );
    expect(decisionOnly.events.map(({ stage }) => stage)).toEqual([
      "PROPOSAL",
      "POLICY_DECISION",
    ]);
    const authorized = projectAuditTimeline(bundle(signedFlowSource()));
    expect(authorized.events.map(({ stage }) => stage)).toEqual([
      "PROPOSAL",
      "POLICY_DECISION",
      "SIGNED_AUTHORIZATION",
    ]);
  });
});
