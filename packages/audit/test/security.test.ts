import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { LOCAL_EVIDENCE_TYPES, localEvidenceTypeSchema } from "@covenant/spec";
import {
  AUDIT_SOURCE_KINDS,
  AUDIT_ERROR_MESSAGES,
  AuditProjectionError,
  CLAIM_SCOPES,
  EVIDENCE_CLASSES,
  EVENT_OUTCOMES,
  LIFECYCLE_STAGES,
  NORMALIZED_EVENT_TYPES,
  SOURCE_EVENT_TYPES,
  SOURCE_KIND_RANK,
  STAGE_RANK,
  TRACK_RANK,
  auditSourceBundleSchema,
  auditTimelineSchema,
  eventClassificationFor,
  projectAuditTimeline,
  projectAuditTimelineJson,
} from "../src/index.js";
import { describe, expect, it } from "vitest";
import {
  approvedDemoSource,
  bundle,
  executorSource,
  localEvidenceSource,
  signedFlowSource,
} from "./fixtures.js";

function expectCode(
  operation: () => unknown,
  code: keyof typeof AUDIT_ERROR_MESSAGES,
) {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AuditProjectionError);
  if (!(thrown instanceof AuditProjectionError)) {
    throw new Error("Expected AuditProjectionError");
  }
  expect(thrown).toMatchObject({
    name: "AuditProjectionError",
    code,
    message: AUDIT_ERROR_MESSAGES[code],
  });
}

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

const MUTATED_ENUM_VALUE = "MUTATED_ENUM_VALUE";

function expectFrozenArrayMutationResistance(values: readonly string[]) {
  const original = [...values];

  expect(Object.isFrozen(values)).toBe(true);
  expect(Reflect.set(values, 0, MUTATED_ENUM_VALUE)).toBe(false);
  expect(Reflect.set(values, values.length, MUTATED_ENUM_VALUE)).toBe(false);
  expect(Reflect.deleteProperty(values, 0)).toBe(false);
  expect(() => {
    Reflect.apply(Array.prototype.reverse, values, []);
  }).toThrow(TypeError);
  expect(() => {
    Reflect.apply(Array.prototype.splice, values, [1, 0, MUTATED_ENUM_VALUE]);
  }).toThrow(TypeError);
  expect(() => {
    Reflect.apply(Array.prototype.push, values, [MUTATED_ENUM_VALUE]);
  }).toThrow(TypeError);
  expect(values).toEqual(original);
}

describe("COV-015 strict and negative-capability boundaries", () => {
  it("deeply freezes exported validation, classification, and rank metadata", () => {
    const input = bundle(signedFlowSource(), localEvidenceSource);
    const projectionBeforeMutation = projectAuditTimelineJson(input);

    for (const values of [
      AUDIT_SOURCE_KINDS,
      NORMALIZED_EVENT_TYPES,
      LIFECYCLE_STAGES,
      EVIDENCE_CLASSES,
      EVENT_OUTCOMES,
      CLAIM_SCOPES,
      SOURCE_EVENT_TYPES,
      LOCAL_EVIDENCE_TYPES,
    ]) {
      expectFrozenArrayMutationResistance(values);
    }

    const signedClassification = eventClassificationFor(
      "PROPOSAL_CREATED",
      "VALIDATED_SIGNED_FLOW",
    );
    const demoClassification = eventClassificationFor(
      "PROPOSAL_CREATED",
      "DEMO_AUDIT",
    );
    expect(Object.isFrozen(signedClassification)).toBe(true);
    expect(Object.isFrozen(demoClassification)).toBe(true);
    expect(Object.isFrozen(TRACK_RANK)).toBe(true);
    expect(Object.isFrozen(STAGE_RANK)).toBe(true);
    expect(Object.isFrozen(SOURCE_KIND_RANK)).toBe(true);
    expect(
      Reflect.set(signedClassification, "stage", "SETTLEMENT_EVIDENCE"),
    ).toBe(false);

    const timeline = projectAuditTimeline(input);
    expect(
      timeline.events.find(({ eventType }) => eventType === "PROPOSAL_CREATED")
        ?.stage,
    ).toBe("PROPOSAL");
    expect(auditTimelineSchema.safeParse(timeline).success).toBe(true);
    expect(auditSourceBundleSchema.safeParse(input).success).toBe(true);
    expect(
      localEvidenceTypeSchema.safeParse("LOCAL_EVM_DEPLOYMENT_VERIFIED")
        .success,
    ).toBe(true);

    const invalidSource = structuredClone(input);
    Object.assign(invalidSource.sources[0] as object, {
      kind: MUTATED_ENUM_VALUE,
    });
    expect(auditSourceBundleSchema.safeParse(invalidSource).success).toBe(
      false,
    );
    expect(localEvidenceTypeSchema.safeParse(MUTATED_ENUM_VALUE).success).toBe(
      false,
    );

    for (const field of [
      "eventType",
      "stage",
      "outcome",
      "evidenceClass",
      "claimScope",
    ] as const) {
      const invalidTimeline = structuredClone(timeline);
      const [event] = invalidTimeline.events;
      if (event === undefined) throw new Error("Expected timeline fixture");
      Object.assign(event, { [field]: MUTATED_ENUM_VALUE });
      expect(auditTimelineSchema.safeParse(invalidTimeline).success).toBe(
        false,
      );
    }

    const invalidSourceEvent = structuredClone(timeline);
    const [event] = invalidSourceEvent.events;
    if (event === undefined) throw new Error("Expected timeline fixture");
    Object.assign(event.source, { eventType: MUTATED_ENUM_VALUE });
    expect(auditTimelineSchema.safeParse(invalidSourceEvent).success).toBe(
      false,
    );

    expect(projectAuditTimelineJson(input)).toBe(projectionBeforeMutation);
  });

  it("rejects unsupported families and unknown fields without partial output", () => {
    expectCode(
      () => projectAuditTimeline(bundle({ kind: "CALLER_DEFINED_ADAPTER" })),
      "UNSUPPORTED_AUDIT_SOURCE",
    );
    expectCode(
      () =>
        projectAuditTimeline({
          ...bundle(signedFlowSource()),
          rpcUrl: "https://forbidden.invalid",
        }),
      "MALFORMED_AUDIT_SOURCE",
    );
    expectCode(
      () =>
        projectAuditTimeline(
          bundle({ ...signedFlowSource(), authorizationHeader: "secret" }),
        ),
      "MALFORMED_AUDIT_SOURCE",
    );
    const hostile = Object.defineProperty({}, "sources", {
      get() {
        throw new Error("dependency-controlled secret");
      },
    });
    expectCode(() => projectAuditTimeline(hostile), "MALFORMED_AUDIT_SOURCE");
  });

  it("rejects incomplete and causally impossible demo sources", () => {
    const source = approvedDemoSource();
    source.events = source.events.filter(
      (event) => event.eventType !== "AUTHORIZATION_ISSUED",
    );
    expectCode(
      () => projectAuditTimeline(bundle(source)),
      "AUDIT_SOURCE_INCOMPLETE",
    );
  });

  it("rejects incomplete or reordered local evidence", () => {
    const incomplete = structuredClone(localEvidenceSource);
    incomplete.result.evidence.pop();
    expectCode(
      () => projectAuditTimeline(bundle(incomplete)),
      "MALFORMED_AUDIT_SOURCE",
    );
    const reordered = structuredClone(localEvidenceSource);
    reordered.result.evidence.reverse();
    expectCode(
      () => projectAuditTimeline(bundle(reordered)),
      "MALFORMED_AUDIT_SOURCE",
    );
  });

  it("rejects changed committed Arc deployment evidence", () => {
    const manifest = arcManifest() as Record<string, unknown>;
    manifest.deploymentBlockNumber = "54829530";
    expectCode(
      () =>
        projectAuditTimeline(
          bundle({ kind: "ARC_DEPLOYMENT_EVIDENCE", manifest }),
        ),
      "MALFORMED_AUDIT_SOURCE",
    );
  });

  it("rejects one normalized identity with a changed canonical body", () => {
    const first = signedFlowSource();
    const changed = structuredClone(first);
    changed.signedPaymentIntent.payload.amount = "1.5";
    expectCode(
      () => projectAuditTimeline(bundle(first, changed)),
      "AUDIT_EVENT_IDENTITY_CONFLICT",
    );
  });

  it("rejects signed-flow conflicts and executor results without stable predecessors", () => {
    const rejected = signedFlowSource({ rejected: true });
    const poisoned = {
      ...rejected,
      authorizationDigest: signedFlowSource().authorizationDigest,
      signedAuthorizationReceipt: signedFlowSource().signedAuthorizationReceipt,
    };
    expectCode(
      () => projectAuditTimeline(bundle(poisoned)),
      "MALFORMED_AUDIT_SOURCE",
    );
    expectCode(
      () =>
        projectAuditTimeline(bundle(executorSource({ status: "SIMULATED" }))),
      "AUDIT_SOURCE_INCOMPLETE",
    );
  });

  it("rejects one decision identifier with approved and rejected outcomes", () => {
    expectCode(
      () =>
        projectAuditTimeline(
          bundle(signedFlowSource(), signedFlowSource({ rejected: true })),
        ),
      "AUDIT_SOURCE_CONFLICT",
    );
  });

  it("keeps source and output schemas strict at every public boundary", () => {
    expect(
      auditSourceBundleSchema.safeParse({
        schemaVersion: "1",
        sources: [],
        extra: true,
      }).success,
    ).toBe(false);
    const source = signedFlowSource();
    source.signedPaymentIntent.payload = {
      ...source.signedPaymentIntent.payload,
      calldata: "0x1234",
    } as typeof source.signedPaymentIntent.payload;
    expectCode(
      () => projectAuditTimeline(bundle(source)),
      "MALFORMED_AUDIT_SOURCE",
    );

    const timeline = structuredClone(
      projectAuditTimeline(
        bundle({ kind: "ARC_DEPLOYMENT_EVIDENCE", manifest: arcManifest() }),
      ),
    );
    const [deployment] = timeline.events;
    if (deployment === undefined)
      throw new Error("Expected deployment fixture");
    deployment.details.contractAddress =
      "0x000000000000000000000000000000000000DEad";
    expect(auditTimelineSchema.safeParse(timeline).success).toBe(false);
  });

  it("rejects self-referential normalized causality", () => {
    const timeline = structuredClone(
      projectAuditTimeline(bundle(signedFlowSource())),
    );
    const [proposal] = timeline.events;
    if (proposal === undefined) throw new Error("Expected proposal fixture");
    proposal.causes = [proposal.eventId];
    expect(auditTimelineSchema.safeParse(timeline).success).toBe(false);
  });

  it("imports no forbidden execution, custody, network, database, or command capability", () => {
    const sourceDirectory = resolve(import.meta.dirname, "../src");
    const sources = readdirSync(sourceDirectory)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(resolve(sourceDirectory, name), "utf8"))
      .join("\n");
    for (const forbiddenImport of [
      "node:http",
      "node:https",
      "node:net",
      "node:tls",
      "node:dns",
      "node:child_process",
      "@circle-fin",
      "@supabase",
      "viem/accounts",
      "viem/actions",
      "@covenant/agent",
      "@covenant/authority",
      "@covenant/executor",
    ]) {
      expect(sources).not.toMatch(
        new RegExp(`from ["']${forbiddenImport.replace("/", "\\/")}`),
      );
    }
    expect(sources).not.toContain("createWalletClient");
    expect(sources).not.toContain("sendTransaction");
    expect(sources).not.toContain("privateKeyToAccount");
    expect(sources).not.toContain("createClient(");
    expect(sources).not.toContain("execFile(");
    expect(sources).not.toContain("spawn(");
  });
});
