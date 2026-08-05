import { auditTimelineSchema } from "@covenant/audit";

export type DisplayEntry = Readonly<{ label: string; value: string }>;

export type DisplayEvent = Readonly<{
  sequence: string;
  eventId: string;
  eventType: string;
  stage: string;
  outcome: string;
  evidenceClass: string;
  claimScope: string;
  source: Readonly<{
    kind: string;
    eventType: string;
    position: string;
  }>;
  causes: readonly string[];
  details: readonly DisplayEntry[];
}>;

export type AuditDisplayModel = Readonly<{
  schemaVersion: string;
  mode: string;
  authoritative: false;
  projectionId: string;
  claimBoundary: Readonly<{
    circleExecution: false;
    arcPaymentSettlement: false;
    paymentFinality: false;
    databaseFinancialAuthority: false;
  }>;
  events: readonly DisplayEvent[];
}>;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function detailString(details: Record<string, unknown>, key: string): string {
  const value = details[key];
  return typeof value === "string" ? value : "";
}

function detailsFor(
  event: ReturnType<typeof auditTimelineSchema.parse>["events"][number],
): DisplayEntry[] {
  const details = event.details;
  switch (event.eventType) {
    case "PROPOSAL_CREATED":
      return [{ label: "amount", value: detailString(details, "amount") }];
    case "POLICY_DECISION_RECORDED":
      return [
        { label: "decision", value: detailString(details, "decision") },
        {
          label: "ruleResults",
          value: Array.isArray(details.ruleResults)
            ? details.ruleResults
                .filter(isRecord)
                .map(
                  (rule) =>
                    `${detailString(rule, "ruleId")}:${detailString(rule, "status")}`,
                )
                .join(" | ")
            : "",
        },
      ];
    case "SIGNED_AUTHORIZATION_CREATED":
      return details.validUntil === undefined
        ? []
        : [{ label: "validUntil", value: detailString(details, "validUntil") }];
    case "TRANSPORT_SUBMISSION_ACCEPTED":
      return [
        {
          label: "transactionId",
          value: detailString(details, "transactionId"),
        },
      ];
    case "SIMULATED_SUBMISSION_REFERENCE_RECORDED":
      return [
        {
          label: "submissionReference",
          value: detailString(details, "submissionReference"),
        },
      ];
    case "INDIRECT_PROMPT_INJECTION_REJECTED":
      return [
        { label: "scenarioId", value: detailString(details, "scenarioId") },
        { label: "failedRuleId", value: detailString(details, "failedRuleId") },
        { label: "limitation", value: detailString(details, "limitation") },
      ];
    case "ARC_DEPLOYMENT_EVIDENCE_VERIFIED":
      return [
        { label: "chainId", value: detailString(details, "chainId") },
        {
          label: "contractAddress",
          value: detailString(details, "contractAddress"),
        },
        {
          label: "receiptStatus",
          value: detailString(details, "receiptStatus"),
        },
        {
          label: "finalityState",
          value: detailString(details, "finalityState"),
        },
        {
          label: "finalityScope",
          value: detailString(details, "finalityScope"),
        },
        {
          label: "providerCorroborationState",
          value: detailString(details, "providerCorroborationState"),
        },
      ];
    case "EXECUTOR_REQUEST_PREPARED":
    case "TRANSPORT_SIMULATION_ACCEPTED":
      return [];
    default:
      return [
        { label: "mode", value: detailString(details, "mode") },
        { label: "status", value: detailString(details, "status") },
      ];
  }
}

export function createAuditDisplayModel(input: unknown): AuditDisplayModel {
  const timeline = auditTimelineSchema.parse(input);
  return deepFreeze({
    schemaVersion: timeline.schemaVersion,
    mode: timeline.mode,
    authoritative: timeline.authoritative,
    projectionId: timeline.projectionId,
    claimBoundary: {
      circleExecution: timeline.claimBoundary.circleExecution,
      arcPaymentSettlement: timeline.claimBoundary.arcPaymentSettlement,
      paymentFinality: timeline.claimBoundary.paymentFinality,
      databaseFinancialAuthority:
        timeline.claimBoundary.databaseFinancialAuthority,
    },
    events: timeline.events.map((event) => ({
      sequence: event.sequence,
      eventId: event.eventId,
      eventType: event.eventType,
      stage: event.stage,
      outcome: event.outcome,
      evidenceClass: event.evidenceClass,
      claimScope: event.claimScope,
      source: {
        kind: event.source.kind,
        eventType: event.source.eventType,
        position: event.source.position,
      },
      causes: event.causes.map((cause) => cause),
      details: detailsFor(event),
    })),
  });
}

export function isDeeplyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  return Object.isFrozen(value) && Object.values(value).every(isDeeplyFrozen);
}
