import {
  COV020_HISTORICAL_EXECUTION,
  auditSourceBundleSchema,
  auditTimelineSchema,
  createCov020AuditSourceBundle,
  projectAuditTimeline,
  projectAuditTimelineJson,
} from "../src/index.js";
import {
  canonicalDigest,
  type CanonicalJsonValue,
} from "../src/canonical-json.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  IDS,
  approvedDemoSource,
  arcExecutionSource,
  bundle,
} from "./fixtures.js";

const classifications = [
  "PROVIDER_ONLY",
  "ARC_NOT_OBSERVED",
  "ARC_EXECUTION_SUCCEEDED",
  "ARC_EXECUTION_REVERTED",
  "EVIDENCE_CONFLICT",
  "OBSERVATION_UNAVAILABLE",
] as const;

function project(
  classification: (typeof classifications)[number] = "ARC_EXECUTION_SUCCEEDED",
) {
  return projectAuditTimeline(
    bundle(approvedDemoSource(), arcExecutionSource(classification)),
  );
}

function event(
  timeline: ReturnType<typeof projectAuditTimeline>,
  eventType: string,
) {
  const found = timeline.events.find((item) => item.eventType === eventType);
  if (found === undefined) throw new Error(`Missing ${eventType}`);
  return found;
}

describe("COV-020 Arc execution audit source", () => {
  it("projects the byte-identical committed historical timeline", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(
        resolve(
          import.meta.dirname,
          "../../../evidence/arc-testnet/cov-010/deployment-manifest.json",
        ),
        "utf8",
      ),
    );
    const projected = projectAuditTimelineJson(
      createCov020AuditSourceBundle(manifest),
    );
    expect(projected).toBe(
      readFileSync(
        resolve(
          import.meta.dirname,
          "../../../apps/web/data/audit-timeline.json",
        ),
        "utf8",
      ),
    );
    expect(projected).toContain(COV020_HISTORICAL_EXECUTION.transactionHash);
    expect(projected).toContain(COV020_HISTORICAL_EXECUTION.executionId);
  });

  it("accepts schema v2 without reinterpreting schema v1", () => {
    const input = bundle(approvedDemoSource(), arcExecutionSource());
    expect(auditSourceBundleSchema.safeParse(input).success).toBe(true);
    expect(
      auditSourceBundleSchema.safeParse({ ...input, schemaVersion: "1" })
        .success,
    ).toBe(false);
    expect(projectAuditTimeline(input).schemaVersion).toBe("2");
  });

  it.each(classifications)("projects %s exactly", (classification) => {
    const timeline = project(classification);
    expect(auditTimelineSchema.safeParse(timeline).success).toBe(true);
    expect(
      event(timeline, "EXECUTION_RECONCILIATION_RECORDED").details,
    ).toMatchObject({ classification });
  });

  it("keeps provider UNKNOWN separate from independently observed Arc success", () => {
    const timeline = project();
    const provider = event(timeline, "CIRCLE_PROVIDER_OBSERVATION_RECORDED");
    const arc = event(timeline, "ARC_EXECUTION_OBSERVATION_RECORDED");
    const reconciliation = event(timeline, "EXECUTION_RECONCILIATION_RECORDED");
    expect(provider).toMatchObject({
      stage: "PROVIDER_OBSERVATION",
      evidenceClass: "CIRCLE_PROVIDER_OBSERVATION_EVIDENCE",
      claimScope: "CIRCLE_PROVIDER_STATE_ONLY",
      details: { providerState: "UNKNOWN", automaticRetry: false },
    });
    expect(arc).toMatchObject({
      evidenceClass: "ARC_TESTNET_RECEIPT_LOG_STATE_EVIDENCE",
      claimScope: "ARC_TESTNET_EXECUTION_OBSERVATION_ONLY",
      details: { status: "OBSERVED_SUCCESS" },
    });
    expect(reconciliation.causes).toEqual(
      [provider.eventId, arc.eventId].sort(),
    );
    expect(reconciliation.details).toMatchObject({
      classification: "ARC_EXECUTION_SUCCEEDED",
      providerStatus: "UNKNOWN",
      providerEvidenceEstablishesArcSuccess: false,
    });
  });

  it("never promotes provider-only evidence to Arc success", () => {
    const timeline = project("PROVIDER_ONLY");
    expect(
      event(timeline, "EXECUTION_RECONCILIATION_RECORDED").details,
    ).toMatchObject({ classification: "PROVIDER_ONLY" });
    expect(
      event(timeline, "ARC_EXECUTION_OBSERVATION_RECORDED").details,
    ).toEqual({ status: "NOT_OBSERVED" });
  });

  it("preserves exact transaction and execution identifiers", () => {
    const timeline = project();
    const arc = event(timeline, "ARC_EXECUTION_OBSERVATION_RECORDED");
    expect(arc.subject).toMatchObject({
      covenantId: IDS.covenant,
      intentId: IDS.intent,
      authorizationId: IDS.authorization,
      executionId: IDS.execution,
    });
    expect(arc.details).toMatchObject({ transactionHash: IDS.transaction });
  });

  it("rejects unknown, malformed provider, and malformed Arc fields", () => {
    const extra = arcExecutionSource() as Record<string, unknown>;
    extra.rpcUrl = "https://forbidden.invalid";
    expect(auditSourceBundleSchema.safeParse(bundle(extra)).success).toBe(
      false,
    );
    const malformedProvider = structuredClone(arcExecutionSource());
    Object.assign(malformedProvider.provider, { raw: "provider-body" });
    expect(
      auditSourceBundleSchema.safeParse(bundle(malformedProvider)).success,
    ).toBe(false);
    const malformedArc = structuredClone(arcExecutionSource());
    Object.assign(malformedArc.arc, { amount: "1250001" });
    expect(
      auditSourceBundleSchema.safeParse(bundle(malformedArc)).success,
    ).toBe(false);
  });

  it("rejects a recomputed but semantically conflicting normalized timeline", () => {
    const changed = structuredClone(project());
    const reconciliation = changed.events.find(
      ({ eventType }) => eventType === "EXECUTION_RECONCILIATION_RECORDED",
    );
    if (reconciliation === undefined) throw new Error("Missing reconciliation");
    reconciliation.details = {
      ...reconciliation.details,
      classification: "PROVIDER_ONLY",
    };
    const { projectionId: _projectionId, ...body } = changed;
    expect(_projectionId).toMatch(/^0x[0-9a-f]{64}$/u);
    changed.projectionId = canonicalDigest(body as CanonicalJsonValue);
    expect(auditTimelineSchema.safeParse(changed).success).toBe(false);
  });

  it("requires the exact prepared execution linkage", () => {
    expect(() =>
      projectAuditTimeline(bundle(arcExecutionSource())),
    ).toThrowError(/Audit source is incomplete/u);
    const changed = arcExecutionSource();
    changed.expected.executionId = `0x${"f".repeat(64)}`;
    expect(() =>
      projectAuditTimeline(bundle(approvedDemoSource(), changed)),
    ).toThrowError(/Audit source is incomplete/u);
  });

  it("is deterministic across source ordering and duplicate evidence", () => {
    const sources = [approvedDemoSource(), arcExecutionSource()] as const;
    const first = projectAuditTimelineJson(bundle(...sources));
    expect(
      projectAuditTimelineJson(
        bundle(sources[1], sources[0], sources[1], sources[0]),
      ),
    ).toBe(first);
    expect(projectAuditTimelineJson(bundle(...sources))).toBe(first);
  });

  it("uses only execution-observation language for Arc payment evidence", () => {
    const arcEvents = project().events.filter(
      ({ source }) => source.kind === "ARC_EXECUTION_EVIDENCE",
    );
    expect(JSON.stringify(arcEvents)).not.toMatch(
      /irreversible|payment.finality|circle.settlement|bridge.settlement/iu,
    );
  });
});
