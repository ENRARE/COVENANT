import type { AuditEvent } from "@covenant/demo/audit-schema";
import {
  CANONICAL_RULE_IDS,
  LOCAL_EVIDENCE_TYPES,
  cov010CanonicalManifestDigest,
  formatUsdc,
  verifyCov010DeploymentEvidence,
} from "@covenant/spec";
import { keccak256, stringToHex } from "viem";
import {
  AUDIT_MODE,
  AUDIT_SCHEMA_VERSION,
  AUDIT_SOURCE_KINDS,
  EVENT_OUTCOMES,
  SOURCE_KIND_RANK,
  STAGE_RANK,
  TRACK_RANK,
} from "./constants.js";
import {
  canonicalDigest,
  canonicalJson,
  deepFreeze,
  type CanonicalJsonValue,
} from "./canonical-json.js";
import { AuditProjectionError, auditFailure } from "./errors.js";
import {
  auditSourceBundleSchema,
  type AuditSourceBundle,
  type ArcDeploymentEvidenceSource,
  type DemoAuditSource,
  type ExecutorResultSource,
  type LocalContractEvidenceSource,
  type ValidatedSignedFlowSource,
} from "./source-schemas.js";
import {
  auditTimelineSchema,
  eventClassificationFor,
  type AuditTimeline,
  type NormalizedAuditEvent,
} from "./timeline-schemas.js";

type Track = keyof typeof TRACK_RANK;
type EventType = NormalizedAuditEvent["eventType"];
type EventOutcome = (typeof EVENT_OUTCOMES)[number];
type EventSource = NormalizedAuditEvent["source"];
type EventSubject = NormalizedAuditEvent["subject"];

type EventDraft = Omit<NormalizedAuditEvent, "sequence" | "details"> & {
  readonly details: CanonicalJsonValue;
  readonly track: Track;
};

type SignedFlowLink = Readonly<{
  authorizationEventId?: string;
  subject: EventSubject;
}>;

type ProjectionContext = {
  events: Map<string, EventDraft>;
  decisions: Map<string, "APPROVED" | "REJECTED">;
  executionTransactions: Map<string, string>;
  signedFlows: Map<string, SignedFlowLink>;
  demoSourceEvents: Map<string, string>;
  demoSourcePositions: Map<string, string>;
};

function asCanonical(value: unknown): CanonicalJsonValue {
  return value as CanonicalJsonValue;
}

function signedFlowKey(input: {
  intentDigest: string;
  decisionDigest: string;
  authorizationDigest: string;
}): string {
  return [
    input.intentDigest,
    input.decisionDigest,
    input.authorizationDigest,
  ].join(":");
}

function eventOutcome(
  eventType: EventType,
  details: CanonicalJsonValue,
  defaultOutcome: EventOutcome,
): EventOutcome {
  if (
    eventType === "POLICY_DECISION_RECORDED" &&
    details !== null &&
    !Array.isArray(details) &&
    typeof details === "object"
  ) {
    const decision = (details as Readonly<Record<string, CanonicalJsonValue>>)
      .decision;
    if (decision === "APPROVED" || decision === "REJECTED") return decision;
  }
  return defaultOutcome;
}

function createEvent(input: {
  eventType: EventType;
  source: EventSource;
  subject: EventSubject;
  causes: readonly string[];
  details: CanonicalJsonValue;
  track: Track;
}): EventDraft {
  const classification = eventClassificationFor(
    input.eventType,
    input.source.kind,
  );
  const eventId = canonicalDigest({
    auditSchemaVersion: AUDIT_SCHEMA_VERSION,
    normalizedEventType: input.eventType,
    sourceKind: input.source.kind,
    sourceEventType: input.source.eventType,
    sourceIdentity: input.source.identity,
    subjectIdentity: asCanonical(input.subject),
  });
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    eventId,
    eventType: input.eventType,
    stage: classification.stage,
    outcome: eventOutcome(
      input.eventType,
      input.details,
      classification.outcome,
    ),
    evidenceClass: classification.evidenceClass,
    claimScope: classification.claimScope,
    source: input.source,
    subject: input.subject,
    causes: [...input.causes].sort(),
    details: input.details,
    track: input.track,
  };
}

function publicDraft(event: EventDraft): CanonicalJsonValue {
  return {
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
    eventType: event.eventType,
    stage: event.stage,
    outcome: event.outcome,
    evidenceClass: event.evidenceClass,
    claimScope: event.claimScope,
    source: asCanonical(event.source),
    subject: asCanonical(event.subject),
    causes: event.causes,
    details: event.details,
  };
}

function addEvent(context: ProjectionContext, event: EventDraft): string {
  const existing = context.events.get(event.eventId);
  if (existing === undefined) {
    context.events.set(event.eventId, event);
    return event.eventId;
  }
  if (
    canonicalJson(publicDraft(existing)) !== canonicalJson(publicDraft(event))
  ) {
    auditFailure("AUDIT_EVENT_IDENTITY_CONFLICT");
  }
  return existing.eventId;
}

function recordDecision(
  context: ProjectionContext,
  decisionId: string,
  decision: "APPROVED" | "REJECTED",
): void {
  const existing = context.decisions.get(decisionId);
  if (existing !== undefined && existing !== decision) {
    auditFailure("AUDIT_SOURCE_CONFLICT");
  }
  context.decisions.set(decisionId, decision);
}

function recordExecutionTransaction(
  context: ProjectionContext,
  executionId: string,
  transactionId: string,
): void {
  const existing = context.executionTransactions.get(executionId);
  if (existing !== undefined && existing !== transactionId) {
    auditFailure("AUDIT_SOURCE_CONFLICT");
  }
  context.executionTransactions.set(executionId, transactionId);
}

function demoEventId(event: AuditEvent): string {
  return keccak256(
    stringToHex(
      [
        event.schemaVersion,
        event.runtimeId,
        event.sequence,
        event.eventType,
        "scenarioId" in event ? event.scenarioId : "",
      ].join(":"),
    ),
  );
}

function demoSource(event: AuditEvent): EventSource {
  if (
    event.eventType !== "PAYMENT_INTENT_PROPOSED" &&
    event.eventType !== "DECISION_APPROVED" &&
    event.eventType !== "DECISION_REJECTED" &&
    event.eventType !== "AUTHORIZATION_ISSUED" &&
    event.eventType !== "EXECUTOR_REQUEST_PREPARED" &&
    event.eventType !== "SIMULATION_ACCEPTED" &&
    event.eventType !== "SUBMISSION_SIMULATED"
  ) {
    auditFailure("AUDIT_SOURCE_INCOMPLETE");
  }
  return {
    kind: "DEMO_AUDIT",
    eventType: event.eventType,
    identity: event.eventId,
    position: event.sequence,
    occurredAt: event.occurredAt,
  };
}

function assertCanonicalDemoRules(event: AuditEvent): void {
  if (event.eventType !== "RULES_EVALUATED") return;
  for (const [index, ruleId] of CANONICAL_RULE_IDS.entries()) {
    if (event.ruleResults[index]?.ruleId !== ruleId) {
      auditFailure("MALFORMED_AUDIT_SOURCE");
    }
  }
}

type DemoProposal = Extract<
  AuditEvent,
  { eventType: "PAYMENT_INTENT_PROPOSED" }
>;
type ScenarioDemoEvent = Extract<AuditEvent, { scenarioId: string }>;
type DemoRules = Extract<AuditEvent, { eventType: "RULES_EVALUATED" }>;
type DemoDecision = Extract<
  AuditEvent,
  { eventType: "DECISION_APPROVED" | "DECISION_REJECTED" }
>;
type DemoAuthorization = Extract<
  AuditEvent,
  { eventType: "AUTHORIZATION_ISSUED" }
>;
type DemoPreparation = Extract<
  AuditEvent,
  { eventType: "EXECUTOR_REQUEST_PREPARED" }
>;
type DemoSimulation = Extract<AuditEvent, { eventType: "SIMULATION_ACCEPTED" }>;
type DemoSubmission = Extract<
  AuditEvent,
  { eventType: "SUBMISSION_SIMULATED" }
>;

function recordCanonicalBody(
  records: Map<string, string>,
  key: string,
  body: string,
): void {
  const existing = records.get(key);
  if (existing !== undefined && existing !== body) {
    auditFailure("AUDIT_SOURCE_CONFLICT");
  }
  records.set(key, body);
}

function insertDemoRecord<T extends ScenarioDemoEvent>(
  records: Map<string, T>,
  key: string,
  event: T,
): void {
  const existing = records.get(key);
  if (
    existing !== undefined &&
    canonicalJson(asCanonical(existing)) !== canonicalJson(asCanonical(event))
  ) {
    auditFailure("AUDIT_SOURCE_CONFLICT");
  }
  records.set(key, existing ?? event);
}

function requireDemoRecord<T extends ScenarioDemoEvent>(
  records: ReadonlyMap<string, T>,
  key: string,
  scenarioId: string,
): T {
  const exact = records.get(key);
  if (exact !== undefined) return exact;
  if ([...records.values()].some((event) => event.scenarioId === scenarioId)) {
    auditFailure("AUDIT_SOURCE_CONFLICT");
  }
  auditFailure("AUDIT_SOURCE_INCOMPLETE");
}

function assertEarlier(predecessor: AuditEvent, successor: AuditEvent): void {
  if (
    predecessor.runtimeId !== successor.runtimeId ||
    BigInt(predecessor.sequence) >= BigInt(successor.sequence)
  ) {
    auditFailure("AUDIT_SOURCE_CONFLICT");
  }
}

function projectDemoSources(
  context: ProjectionContext,
  sources: readonly DemoAuditSource[],
): void {
  const uniqueEvents = new Map<string, AuditEvent>();
  for (const source of sources) {
    if (
      !source.events.some((event) =>
        [
          "PAYMENT_INTENT_PROPOSED",
          "DECISION_APPROVED",
          "DECISION_REJECTED",
          "AUTHORIZATION_ISSUED",
          "EXECUTOR_REQUEST_PREPARED",
          "SIMULATION_ACCEPTED",
          "SUBMISSION_SIMULATED",
        ].includes(event.eventType),
      )
    ) {
      auditFailure("AUDIT_SOURCE_INCOMPLETE");
    }
    if (new Set(source.events.map((event) => event.runtimeId)).size !== 1) {
      auditFailure("AUDIT_SOURCE_CONFLICT");
    }
    for (const event of source.events) {
      if (event.sequence === "0" || event.eventId !== demoEventId(event)) {
        auditFailure("MALFORMED_AUDIT_SOURCE");
      }
      assertCanonicalDemoRules(event);
      const body = canonicalJson(asCanonical(event));
      recordCanonicalBody(context.demoSourceEvents, event.eventId, body);
      recordCanonicalBody(
        context.demoSourcePositions,
        `${event.runtimeId}:${event.sequence}`,
        body,
      );
      uniqueEvents.set(event.eventId, uniqueEvents.get(event.eventId) ?? event);
    }
  }

  const events = [...uniqueEvents.values()].sort((left, right) => {
    if (left.runtimeId !== right.runtimeId) {
      return left.runtimeId < right.runtimeId ? -1 : 1;
    }
    const leftSequence = BigInt(left.sequence);
    const rightSequence = BigInt(right.sequence);
    return leftSequence < rightSequence
      ? -1
      : leftSequence > rightSequence
        ? 1
        : left.eventId < right.eventId
          ? -1
          : left.eventId > right.eventId
            ? 1
            : 0;
  });

  const proposals = new Map<string, DemoProposal>();
  const rules = new Map<string, DemoRules>();
  const decisionsByFlow = new Map<string, DemoDecision>();
  const decisionsById = new Map<string, DemoDecision>();
  const authorizations = new Map<string, DemoAuthorization>();
  const preparations = new Map<string, DemoPreparation>();
  const simulations = new Map<string, DemoSimulation>();
  const submissions = new Map<string, DemoSubmission>();

  for (const event of events) {
    if (event.eventType === "PAYMENT_INTENT_PROPOSED") {
      insertDemoRecord(
        proposals,
        `${event.scenarioId}:${event.intentId}`,
        event,
      );
    } else if (event.eventType === "RULES_EVALUATED") {
      insertDemoRecord(rules, `${event.scenarioId}:${event.intentId}`, event);
    } else if (
      event.eventType === "DECISION_APPROVED" ||
      event.eventType === "DECISION_REJECTED"
    ) {
      insertDemoRecord(
        decisionsByFlow,
        `${event.scenarioId}:${event.intentId}`,
        event,
      );
      insertDemoRecord(decisionsById, event.decisionId, event);
    } else if (event.eventType === "AUTHORIZATION_ISSUED") {
      insertDemoRecord(authorizations, event.authorizationId, event);
    } else if (event.eventType === "EXECUTOR_REQUEST_PREPARED") {
      insertDemoRecord(preparations, event.executionId, event);
    } else if (event.eventType === "SIMULATION_ACCEPTED") {
      insertDemoRecord(simulations, event.executionId, event);
    } else if (event.eventType === "SUBMISSION_SIMULATED") {
      insertDemoRecord(submissions, event.executionId, event);
    }
  }

  const normalizedProposals = new Map<string, string>();
  const normalizedPolicies = new Map<string, string>();
  const normalizedAuthorizations = new Map<string, string>();
  const normalizedPreparations = new Map<string, string>();
  const normalizedSimulations = new Map<string, string>();

  for (const event of proposals.values()) {
    normalizedProposals.set(
      event.eventId,
      addEvent(
        context,
        createEvent({
          eventType: "PROPOSAL_CREATED",
          source: demoSource(event),
          subject: {
            covenantId: event.covenantId,
            invoiceId: event.invoiceId,
            intentId: event.intentId,
          },
          causes: [],
          details: { amount: event.amount },
          track: "PAYMENT_FLOW",
        }),
      ),
    );
  }

  for (const event of rules.values()) {
    const proposalEvent = requireDemoRecord(
      proposals,
      `${event.scenarioId}:${event.intentId}`,
      event.scenarioId,
    );
    assertEarlier(proposalEvent, event);
    if (
      proposalEvent.scenarioId !== event.scenarioId ||
      proposalEvent.intentId !== event.intentId
    ) {
      auditFailure("AUDIT_SOURCE_CONFLICT");
    }
  }

  for (const event of decisionsByFlow.values()) {
    const key = `${event.scenarioId}:${event.intentId}`;
    const proposalEvent = requireDemoRecord(proposals, key, event.scenarioId);
    const ruleEvent = requireDemoRecord(rules, key, event.scenarioId);
    assertEarlier(proposalEvent, ruleEvent);
    assertEarlier(proposalEvent, event);
    assertEarlier(ruleEvent, event);
    if (
      proposalEvent.scenarioId !== event.scenarioId ||
      proposalEvent.covenantId !== event.covenantId ||
      proposalEvent.intentId !== event.intentId ||
      ruleEvent.scenarioId !== event.scenarioId ||
      ruleEvent.intentId !== event.intentId
    ) {
      auditFailure("AUDIT_SOURCE_CONFLICT");
    }
    const decision =
      event.eventType === "DECISION_APPROVED" ? "APPROVED" : "REJECTED";
    const allPass = ruleEvent.ruleResults.every(
      (rule) => rule.status === "PASS",
    );
    if ((decision === "APPROVED") !== allPass) {
      auditFailure("AUDIT_SOURCE_CONFLICT");
    }
    recordDecision(context, event.decisionId, decision);
    const proposalId = normalizedProposals.get(proposalEvent.eventId);
    if (proposalId === undefined) auditFailure("AUDIT_CAUSALITY_FAILURE");
    normalizedPolicies.set(
      event.eventId,
      addEvent(
        context,
        createEvent({
          eventType: "POLICY_DECISION_RECORDED",
          source: demoSource(event),
          subject: {
            covenantId: event.covenantId,
            intentId: event.intentId,
            decisionId: event.decisionId,
          },
          causes: [proposalId],
          details: {
            decision,
            ruleResults: ruleEvent.ruleResults.map(({ ruleId, status }) => ({
              ruleId,
              status,
            })),
          },
          track: "PAYMENT_FLOW",
        }),
      ),
    );
  }

  for (const event of authorizations.values()) {
    const decisionEvent = requireDemoRecord(
      decisionsById,
      event.decisionId,
      event.scenarioId,
    );
    assertEarlier(decisionEvent, event);
    if (
      decisionEvent.scenarioId !== event.scenarioId ||
      decisionEvent.covenantId !== event.covenantId ||
      decisionEvent.intentId !== event.intentId ||
      decisionEvent.decisionId !== event.decisionId ||
      context.decisions.get(event.decisionId) !== "APPROVED"
    ) {
      auditFailure("AUDIT_SOURCE_CONFLICT");
    }
    const policyId = normalizedPolicies.get(decisionEvent.eventId);
    if (policyId === undefined) auditFailure("AUDIT_CAUSALITY_FAILURE");
    normalizedAuthorizations.set(
      event.eventId,
      addEvent(
        context,
        createEvent({
          eventType: "SIGNED_AUTHORIZATION_CREATED",
          source: demoSource(event),
          subject: {
            covenantId: event.covenantId,
            intentId: event.intentId,
            decisionId: event.decisionId,
            authorizationId: event.authorizationId,
          },
          causes: [policyId],
          details: {},
          track: "PAYMENT_FLOW",
        }),
      ),
    );
  }

  for (const event of preparations.values()) {
    const authorizationEvent = requireDemoRecord(
      authorizations,
      event.authorizationId,
      event.scenarioId,
    );
    assertEarlier(authorizationEvent, event);
    if (
      authorizationEvent.scenarioId !== event.scenarioId ||
      authorizationEvent.intentId !== event.intentId ||
      authorizationEvent.authorizationId !== event.authorizationId
    ) {
      auditFailure("AUDIT_SOURCE_CONFLICT");
    }
    const authorizationId = normalizedAuthorizations.get(
      authorizationEvent.eventId,
    );
    if (authorizationId === undefined) auditFailure("AUDIT_CAUSALITY_FAILURE");
    normalizedPreparations.set(
      event.eventId,
      addEvent(
        context,
        createEvent({
          eventType: "EXECUTOR_REQUEST_PREPARED",
          source: demoSource(event),
          subject: {
            intentId: event.intentId,
            authorizationId: event.authorizationId,
            executionId: event.executionId,
          },
          causes: [authorizationId],
          details: {},
          track: "PAYMENT_FLOW",
        }),
      ),
    );
  }

  for (const event of simulations.values()) {
    const preparationEvent = requireDemoRecord(
      preparations,
      event.executionId,
      event.scenarioId,
    );
    assertEarlier(preparationEvent, event);
    if (
      preparationEvent.scenarioId !== event.scenarioId ||
      preparationEvent.executionId !== event.executionId
    ) {
      auditFailure("AUDIT_SOURCE_CONFLICT");
    }
    const preparationId = normalizedPreparations.get(preparationEvent.eventId);
    if (preparationId === undefined) auditFailure("AUDIT_CAUSALITY_FAILURE");
    normalizedSimulations.set(
      event.eventId,
      addEvent(
        context,
        createEvent({
          eventType: "TRANSPORT_SIMULATION_ACCEPTED",
          source: demoSource(event),
          subject: { executionId: event.executionId },
          causes: [preparationId],
          details: {},
          track: "PAYMENT_FLOW",
        }),
      ),
    );
  }

  for (const event of submissions.values()) {
    const preparationEvent = requireDemoRecord(
      preparations,
      event.executionId,
      event.scenarioId,
    );
    const simulationEvent = requireDemoRecord(
      simulations,
      event.executionId,
      event.scenarioId,
    );
    assertEarlier(preparationEvent, event);
    assertEarlier(simulationEvent, event);
    if (
      preparationEvent.scenarioId !== event.scenarioId ||
      preparationEvent.executionId !== event.executionId ||
      simulationEvent.scenarioId !== event.scenarioId ||
      simulationEvent.executionId !== event.executionId
    ) {
      auditFailure("AUDIT_SOURCE_CONFLICT");
    }
    const simulationId = normalizedSimulations.get(simulationEvent.eventId);
    if (simulationId === undefined) auditFailure("AUDIT_CAUSALITY_FAILURE");
    addEvent(
      context,
      createEvent({
        eventType: "SIMULATED_SUBMISSION_REFERENCE_RECORDED",
        source: demoSource(event),
        subject: { executionId: event.executionId },
        causes: [simulationId],
        details: { submissionReference: event.submissionReference },
        track: "PAYMENT_FLOW",
      }),
    );
  }

  const compromised = events.filter(
    (event) =>
      "scenarioId" in event && event.scenarioId === "compromised-proposer-v1",
  );
  if (compromised.length > 0) {
    const proposal = compromised.filter(
      (
        event,
      ): event is Extract<
        AuditEvent,
        { eventType: "PAYMENT_INTENT_PROPOSED" }
      > => event.eventType === "PAYMENT_INTENT_PROPOSED",
    );
    const rules = compromised.filter(
      (event): event is Extract<AuditEvent, { eventType: "RULES_EVALUATED" }> =>
        event.eventType === "RULES_EVALUATED",
    );
    const rejected = compromised.filter(
      (
        event,
      ): event is Extract<AuditEvent, { eventType: "DECISION_REJECTED" }> =>
        event.eventType === "DECISION_REJECTED",
    );
    const forbidden = compromised.filter((event) =>
      [
        "AUTHORIZATION_ISSUED",
        "EXECUTOR_REQUEST_PREPARED",
        "SIMULATION_ACCEPTED",
        "SUBMISSION_SIMULATED",
      ].includes(event.eventType),
    );
    if (forbidden.length > 0) auditFailure("AUDIT_SOURCE_CONFLICT");
    if (proposal.length !== 1 || rules.length !== 1 || rejected.length !== 1) {
      auditFailure("AUDIT_SOURCE_INCOMPLETE");
    }
    const [proposalEvent] = proposal;
    const [rulesEvent] = rules;
    const [rejectedEvent] = rejected;
    if (
      proposalEvent === undefined ||
      rulesEvent === undefined ||
      rejectedEvent === undefined ||
      proposalEvent.intentId !== rulesEvent.intentId ||
      proposalEvent.intentId !== rejectedEvent.intentId ||
      rulesEvent.ruleResults.find((rule) => rule.ruleId === "recipient_allowed")
        ?.status !== "FAIL"
    ) {
      auditFailure("AUDIT_SOURCE_CONFLICT");
    }
    const exactFixedRules = rulesEvent.ruleResults.every(
      (rule) =>
        rule.status === (rule.ruleId === "recipient_allowed" ? "FAIL" : "PASS"),
    );
    if (!exactFixedRules) return;
    if (proposalEvent.covenantId !== rejectedEvent.covenantId) {
      auditFailure("AUDIT_SOURCE_CONFLICT");
    }
    const proposalId = normalizedProposals.get(proposalEvent.eventId);
    const policyId = normalizedPolicies.get(rejectedEvent.eventId);
    if (proposalId === undefined || policyId === undefined) {
      auditFailure("AUDIT_CAUSALITY_FAILURE");
    }
    const derivedSourceIdentity = canonicalDigest({
      proposalEventId: proposalEvent.eventId,
      rulesEventId: rulesEvent.eventId,
      decisionEventId: rejectedEvent.eventId,
    });
    addEvent(
      context,
      createEvent({
        eventType: "INDIRECT_PROMPT_INJECTION_REJECTED",
        source: {
          kind: "DEMO_AUDIT",
          eventType: "DECISION_REJECTED",
          identity: derivedSourceIdentity,
          position: rejectedEvent.sequence,
          occurredAt: rejectedEvent.occurredAt,
        },
        subject: {
          covenantId: rejectedEvent.covenantId,
          intentId: rejectedEvent.intentId,
          decisionId: rejectedEvent.decisionId,
        },
        causes: [proposalId, policyId],
        details: {
          scenarioId: "compromised-proposer-v1",
          failedRuleId: "recipient_allowed",
          limitation: "FIXED_COMPROMISED_PROPOSER_SCENARIO_ONLY",
          sourceEventIds: [
            proposalEvent.eventId,
            rulesEvent.eventId,
            rejectedEvent.eventId,
          ],
        },
        track: "SECURITY_CONTROL",
      }),
    );
  }
}

function projectSignedFlow(
  context: ProjectionContext,
  source: ValidatedSignedFlowSource,
): void {
  const intent = source.signedPaymentIntent.payload;
  const decision = source.signedDecisionReceipt.payload;
  const subject: EventSubject = {
    covenantId: intent.covenantId.toLowerCase(),
    intentId: intent.intentId.toLowerCase(),
  };
  const proposalId = addEvent(
    context,
    createEvent({
      eventType: "PROPOSAL_CREATED",
      source: {
        kind: "VALIDATED_SIGNED_FLOW",
        eventType: "PaymentIntent",
        identity: source.intentDigest,
        position: "1",
        occurredAt: intent.createdAt.toString(),
      },
      subject,
      causes: [],
      details: { amount: formatUsdc(intent.amount) },
      track: "PAYMENT_FLOW",
    }),
  );
  recordDecision(context, decision.decisionId.toLowerCase(), decision.decision);
  const decisionId = addEvent(
    context,
    createEvent({
      eventType: "POLICY_DECISION_RECORDED",
      source: {
        kind: "VALIDATED_SIGNED_FLOW",
        eventType: "DecisionReceipt",
        identity: source.decisionDigest,
        position: "2",
        occurredAt: decision.createdAt.toString(),
      },
      subject: {
        ...subject,
        decisionId: decision.decisionId.toLowerCase(),
      },
      causes: [proposalId],
      details: {
        decision: decision.decision,
        ruleResults: source.ruleResults.map(({ ruleId, status }) => ({
          ruleId,
          status,
        })),
      },
      track: "PAYMENT_FLOW",
    }),
  );

  const authorization = source.signedAuthorizationReceipt?.payload;
  if (authorization !== undefined && source.authorizationDigest !== undefined) {
    const createdAuthorizationEventId = addEvent(
      context,
      createEvent({
        eventType: "SIGNED_AUTHORIZATION_CREATED",
        source: {
          kind: "VALIDATED_SIGNED_FLOW",
          eventType: "AuthorizationReceipt",
          identity: source.authorizationDigest,
          position: "3",
        },
        subject: {
          ...subject,
          decisionId: decision.decisionId.toLowerCase(),
          authorizationId: authorization.authorizationId.toLowerCase(),
        },
        causes: [decisionId],
        details: { validUntil: authorization.validUntil.toString() },
        track: "PAYMENT_FLOW",
      }),
    );
    const key = signedFlowKey({
      intentDigest: source.intentDigest,
      decisionDigest: source.decisionDigest,
      authorizationDigest: source.authorizationDigest,
    });
    const existing = context.signedFlows.get(key);
    const link: SignedFlowLink = {
      authorizationEventId: createdAuthorizationEventId,
      subject: {
        ...subject,
        decisionId: decision.decisionId.toLowerCase(),
        authorizationId: authorization.authorizationId.toLowerCase(),
      },
    };
    if (
      existing !== undefined &&
      canonicalJson(asCanonical(existing.subject)) !==
        canonicalJson(asCanonical(link.subject))
    ) {
      auditFailure("AUDIT_SOURCE_CONFLICT");
    }
    context.signedFlows.set(key, link);
  }
}

function executorSource(
  source: ExecutorResultSource,
  eventType: EventSource["eventType"],
  position: string,
): EventSource {
  return {
    kind: "EXECUTOR_RESULT",
    eventType,
    identity: source.result.execution.executionId,
    position,
  };
}

function projectExecutorResult(
  context: ProjectionContext,
  source: ExecutorResultSource,
): void {
  const execution = source.result.execution;
  const link = context.signedFlows.get(signedFlowKey(execution));
  if (link?.authorizationEventId === undefined) {
    auditFailure("AUDIT_SOURCE_INCOMPLETE");
  }
  const subject: EventSubject = {
    ...link.subject,
    executionId: execution.executionId,
  };

  const preparationId = addEvent(
    context,
    createEvent({
      eventType: "EXECUTOR_REQUEST_PREPARED",
      source: executorSource(source, "PREPARED", "1"),
      subject,
      causes: [link.authorizationEventId],
      details: {},
      track: "PAYMENT_FLOW",
    }),
  );

  if (source.result.status === "PREPARED") return;
  if (source.result.status === "SIMULATED") {
    addEvent(
      context,
      createEvent({
        eventType: "TRANSPORT_SIMULATION_ACCEPTED",
        source: executorSource(source, "SIMULATED", "2"),
        subject,
        causes: [preparationId],
        details: {},
        track: "PAYMENT_FLOW",
      }),
    );
    return;
  }
  recordExecutionTransaction(
    context,
    execution.executionId,
    source.result.transactionId,
  );
  addEvent(
    context,
    createEvent({
      eventType: "TRANSPORT_SUBMISSION_ACCEPTED",
      source: executorSource(source, "SUBMITTED", "2"),
      subject,
      causes: [preparationId],
      details: { transactionId: source.result.transactionId },
      track: "PAYMENT_FLOW",
    }),
  );
}

const LOCAL_EVENT_MAPPING: Readonly<
  Record<
    (typeof LOCAL_EVIDENCE_TYPES)[number],
    Readonly<{
      eventType: EventType;
      track: Track;
    }>
  >
> = deepFreeze({
  LOCAL_EVM_DEPLOYMENT_VERIFIED: {
    eventType: "LOCAL_DEPLOYMENT_EVIDENCE_VERIFIED",
    track: "DEPLOYMENT",
  },
  LOCAL_VAULT_FUNDED_VERIFIED: {
    eventType: "LOCAL_VAULT_FUNDING_EVIDENCE_VERIFIED",
    track: "DEPLOYMENT",
  },
  LOCAL_VAULT_EXECUTION_SUBMITTED: {
    eventType: "TRANSACTION_SUBMISSION_RECORDED",
    track: "PAYMENT_FLOW",
  },
  LOCAL_VAULT_EXECUTION_VERIFIED: {
    eventType: "EXECUTION_EVIDENCE_VERIFIED",
    track: "PAYMENT_FLOW",
  },
  LOCAL_REPLAY_REJECTED: {
    eventType: "REPLAY_REJECTED",
    track: "SECURITY_CONTROL",
  },
  LOCAL_BYPASS_REJECTED: {
    eventType: "DIRECT_VAULT_BYPASS_REJECTED",
    track: "SECURITY_CONTROL",
  },
  LOCAL_NON_ISSUER_REVOCATION_REJECTED: {
    eventType: "NON_ISSUER_REVOCATION_REJECTED",
    track: "REVOCATION",
  },
  LOCAL_COVENANT_REVOCATION_VERIFIED: {
    eventType: "REVOCATION_VERIFIED",
    track: "REVOCATION",
  },
  LOCAL_POST_REVOCATION_EXECUTION_REJECTED: {
    eventType: "POST_REVOCATION_EXECUTION_REJECTED",
    track: "REVOCATION",
  },
});

function projectLocalEvidence(
  context: ProjectionContext,
  result: LocalContractEvidenceSource,
): void {
  const resultDigest = canonicalDigest(asCanonical(result.result));
  const eventIds = new Map<string, string>();
  for (const [index, evidence] of result.result.evidence.entries()) {
    const mapping = LOCAL_EVENT_MAPPING[evidence.type];
    const sourceIdentity = canonicalDigest({
      resultDigest,
      evidenceType: evidence.type,
      evidenceIndex: String(index),
    });
    const causeTypes: readonly string[] =
      evidence.type === "LOCAL_VAULT_FUNDED_VERIFIED"
        ? ["LOCAL_EVM_DEPLOYMENT_VERIFIED"]
        : evidence.type === "LOCAL_VAULT_EXECUTION_SUBMITTED"
          ? ["LOCAL_VAULT_FUNDED_VERIFIED"]
          : evidence.type === "LOCAL_VAULT_EXECUTION_VERIFIED"
            ? ["LOCAL_VAULT_EXECUTION_SUBMITTED"]
            : evidence.type === "LOCAL_REPLAY_REJECTED"
              ? ["LOCAL_VAULT_EXECUTION_VERIFIED"]
              : evidence.type === "LOCAL_BYPASS_REJECTED"
                ? ["LOCAL_EVM_DEPLOYMENT_VERIFIED"]
                : evidence.type === "LOCAL_NON_ISSUER_REVOCATION_REJECTED"
                  ? ["LOCAL_EVM_DEPLOYMENT_VERIFIED"]
                  : evidence.type === "LOCAL_COVENANT_REVOCATION_VERIFIED"
                    ? ["LOCAL_EVM_DEPLOYMENT_VERIFIED"]
                    : evidence.type ===
                        "LOCAL_POST_REVOCATION_EXECUTION_REJECTED"
                      ? ["LOCAL_COVENANT_REVOCATION_VERIFIED"]
                      : [];
    const causes = causeTypes.map((type) => {
      const cause = eventIds.get(type);
      if (cause === undefined) auditFailure("AUDIT_CAUSALITY_FAILURE");
      return cause;
    });
    const eventId = addEvent(
      context,
      createEvent({
        eventType: mapping.eventType,
        source: {
          kind: "LOCAL_CONTRACT_EVIDENCE",
          eventType: evidence.type,
          identity: sourceIdentity,
          position: String(index + 1),
        },
        subject: {},
        causes,
        details: { mode: "LOCAL_ANVIL", status: "PASS" },
        track: mapping.track,
      }),
    );
    eventIds.set(evidence.type, eventId);

    if (evidence.type === "LOCAL_VAULT_EXECUTION_VERIFIED") {
      addEvent(
        context,
        createEvent({
          eventType: "SETTLEMENT_EVIDENCE_RECORDED",
          source: {
            kind: "LOCAL_CONTRACT_EVIDENCE",
            eventType: evidence.type,
            identity: sourceIdentity,
            position: String(index + 1),
          },
          subject: {},
          causes: [eventId],
          details: { mode: "LOCAL_ANVIL", status: "PASS" },
          track: "PAYMENT_FLOW",
        }),
      );
    }
  }
}

function projectArcEvidence(
  context: ProjectionContext,
  source: ArcDeploymentEvidenceSource,
): void {
  let manifest;
  try {
    manifest = verifyCov010DeploymentEvidence(source.manifest);
  } catch {
    throw new AuditProjectionError("MALFORMED_AUDIT_SOURCE");
  }
  const manifestDigest = cov010CanonicalManifestDigest(manifest);
  const sourceIdentity = canonicalDigest({
    sourceGitCommit: manifest.sourceGitCommit,
    deploymentTransactionHash: manifest.deploymentTransactionHash.toLowerCase(),
    deploymentBlockHash: manifest.deploymentBlockHash.toLowerCase(),
    manifestDigest,
  });
  addEvent(
    context,
    createEvent({
      eventType: "ARC_DEPLOYMENT_EVIDENCE_VERIFIED",
      source: {
        kind: "ARC_DEPLOYMENT_EVIDENCE",
        eventType: "COV-010_DEPLOYMENT_MANIFEST",
        identity: sourceIdentity,
        position: "1",
      },
      subject: { covenantId: manifest.constructor.covenantId.toLowerCase() },
      causes: [],
      details: {
        chainId: manifest.chainId,
        contractAddress: manifest.contractAddress,
        deploymentTransactionHash:
          manifest.deploymentTransactionHash.toLowerCase(),
        deploymentBlockNumber: manifest.deploymentBlockNumber,
        deploymentBlockHash: manifest.deploymentBlockHash.toLowerCase(),
        actualRuntimeCodeHash: manifest.actualRuntimeCodeHash.toLowerCase(),
        trustedNetworkProfileDigest:
          manifest.trustedNetworkProfileDigest.toLowerCase(),
        planDigest: manifest.planDigest.toLowerCase(),
        sourceGitCommit: manifest.sourceGitCommit,
        receiptStatus: manifest.receiptStatus,
        finalityState: manifest.finalityState,
        finalityScope: "ARC_DEPLOYMENT_TRANSACTION_ONLY",
        providerCorroborationState: manifest.providerCorroborationState,
        manifestDigest,
      },
      track: "DEPLOYMENT",
    }),
  );
}

function compareDrafts(left: EventDraft, right: EventDraft): number {
  const tupleLeft = [
    TRACK_RANK[left.track],
    STAGE_RANK[left.stage],
    SOURCE_KIND_RANK[left.source.kind],
  ] as const;
  const tupleRight = [
    TRACK_RANK[right.track],
    STAGE_RANK[right.stage],
    SOURCE_KIND_RANK[right.source.kind],
  ] as const;
  for (const index of [0, 1, 2] as const) {
    const difference = tupleLeft[index] - tupleRight[index];
    if (difference !== 0) return difference;
  }
  const leftPosition = BigInt(left.source.position);
  const rightPosition = BigInt(right.source.position);
  if (leftPosition !== rightPosition)
    return leftPosition < rightPosition ? -1 : 1;
  return left.eventId < right.eventId
    ? -1
    : left.eventId > right.eventId
      ? 1
      : 0;
}

function topologicalSort(events: readonly EventDraft[]): EventDraft[] {
  const byId = new Map(events.map((event) => [event.eventId, event]));
  const indegree = new Map(events.map((event) => [event.eventId, 0]));
  const outgoing = new Map<string, string[]>();
  for (const event of events) {
    for (const cause of event.causes) {
      if (!byId.has(cause)) auditFailure("AUDIT_CAUSALITY_FAILURE");
      indegree.set(event.eventId, (indegree.get(event.eventId) ?? 0) + 1);
      const children = outgoing.get(cause) ?? [];
      children.push(event.eventId);
      outgoing.set(cause, children);
    }
  }
  const available = events
    .filter((event) => indegree.get(event.eventId) === 0)
    .sort(compareDrafts);
  const output: EventDraft[] = [];
  while (available.length > 0) {
    const event = available.shift();
    if (event === undefined) auditFailure("AUDIT_ORDERING_FAILURE");
    output.push(event);
    for (const childId of outgoing.get(event.eventId) ?? []) {
      const next = (indegree.get(childId) ?? 0) - 1;
      indegree.set(childId, next);
      if (next === 0) {
        const child = byId.get(childId);
        if (child === undefined) auditFailure("AUDIT_ORDERING_FAILURE");
        available.push(child);
        available.sort(compareDrafts);
      }
    }
  }
  if (output.length !== events.length) auditFailure("AUDIT_CAUSALITY_FAILURE");
  return output;
}

function containsUnsupportedSource(input: unknown): boolean {
  if (input === null || typeof input !== "object") return false;
  const sources = (input as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) return false;
  return sources.some((source) => {
    if (source === null || typeof source !== "object") return false;
    const kind = (source as { kind?: unknown }).kind;
    return (
      typeof kind === "string" &&
      !(AUDIT_SOURCE_KINDS as readonly string[]).includes(kind)
    );
  });
}

function parseBundle(input: unknown): AuditSourceBundle {
  try {
    if (containsUnsupportedSource(input)) {
      throw new AuditProjectionError("UNSUPPORTED_AUDIT_SOURCE");
    }
    return auditSourceBundleSchema.parse(structuredClone(input));
  } catch (error) {
    if (error instanceof AuditProjectionError) {
      throw new AuditProjectionError(error.code);
    }
    throw new AuditProjectionError("MALFORMED_AUDIT_SOURCE");
  }
}

export function projectAuditTimeline(input: unknown): AuditTimeline {
  const bundle = parseBundle(input);
  const context: ProjectionContext = {
    events: new Map(),
    decisions: new Map(),
    executionTransactions: new Map(),
    signedFlows: new Map(),
    demoSourceEvents: new Map(),
    demoSourcePositions: new Map(),
  };

  const demoSources = bundle.sources.filter(
    (source): source is DemoAuditSource => source.kind === "DEMO_AUDIT",
  );
  if (demoSources.length > 0) projectDemoSources(context, demoSources);
  for (const source of bundle.sources) {
    if (source.kind === "VALIDATED_SIGNED_FLOW")
      projectSignedFlow(context, source);
  }
  for (const source of bundle.sources) {
    if (source.kind === "EXECUTOR_RESULT")
      projectExecutorResult(context, source);
    if (source.kind === "LOCAL_CONTRACT_EVIDENCE") {
      projectLocalEvidence(context, source);
    }
    if (source.kind === "ARC_DEPLOYMENT_EVIDENCE") {
      projectArcEvidence(context, source);
    }
  }

  const sorted = topologicalSort([...context.events.values()]);
  const events = sorted.map((event, index) => ({
    schemaVersion: event.schemaVersion,
    sequence: String(index + 1),
    eventId: event.eventId,
    eventType: event.eventType,
    stage: event.stage,
    outcome: event.outcome,
    evidenceClass: event.evidenceClass,
    claimScope: event.claimScope,
    source: event.source,
    subject: event.subject,
    causes: event.causes,
    details: event.details,
  }));
  const claimBoundary = {
    circleExecution: false,
    arcPaymentSettlement: false,
    paymentFinality: false,
    databaseFinancialAuthority: false,
  } as const;
  const projectionId = canonicalDigest({
    schemaVersion: AUDIT_SCHEMA_VERSION,
    mode: AUDIT_MODE,
    authoritative: false,
    claimBoundary,
    events: asCanonical(events),
  });
  try {
    return deepFreeze(
      auditTimelineSchema.parse({
        schemaVersion: AUDIT_SCHEMA_VERSION,
        mode: AUDIT_MODE,
        authoritative: false,
        projectionId,
        claimBoundary,
        events,
      }),
    );
  } catch {
    throw new AuditProjectionError("AUDIT_SANITIZATION_FAILURE");
  }
}
