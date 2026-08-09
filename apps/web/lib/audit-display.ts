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
    identity: string;
    position: string;
    occurredAt?: string;
  }>;
  subject: readonly DisplayEntry[];
  causes: readonly string[];
  details: readonly DisplayEntry[];
}>;

export type AuditDisplayModel = Readonly<{
  schemaVersion: "2";
  mode: string;
  authoritative: false;
  projectionId: string;
  claimBoundary: Readonly<{
    circleSubmissionAttemptObserved: true;
    circleProviderOutcomeKnown: false;
    arcExecutionObserved: true;
    arcPaymentSettlement: false;
    paymentFinality: false;
    databaseFinancialAuthority: false;
    automaticResubmission: false;
  }>;
  payment: Readonly<{
    amount: string;
    amountBaseUnits: string;
    network: "Arc Testnet";
    recipient: string;
    vault: string;
    token: string;
    transactionHash: string;
    executionClassification: "ARC_EXECUTION_SUCCEEDED";
    providerOutcome: "UNKNOWN";
    automaticRetry: false;
  }>;
  providerEvidence: Readonly<{
    progression: readonly string[];
    outcome: "UNKNOWN";
    submissionAttemptObserved: true;
    automaticRetry: false;
  }>;
  arcEvidence: Readonly<{
    receiptStatus: "SUCCESSFUL";
    blockNumber: string;
    checks: readonly DisplayEntry[];
    accounting: readonly DisplayEntry[];
  }>;
  securityControls: readonly Readonly<{
    label: string;
    status: "REJECTED" | "VERIFIED";
    eventId: string;
  }>[];
  events: readonly DisplayEvent[];
}>;

type ParsedTimeline = ReturnType<typeof auditTimelineSchema.parse>;
type ParsedEvent = ParsedTimeline["events"][number];

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

function requiredEvent(
  timeline: ParsedTimeline,
  eventType: string,
): ParsedEvent {
  const events = timeline.events.filter(
    (event) => event.eventType === eventType,
  );
  if (events.length !== 1 || events[0] === undefined) {
    throw new Error("canonical event unavailable");
  }
  return events[0];
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error("canonical field unavailable");
  return value;
}

function requiredBoolean(
  record: Record<string, unknown>,
  key: string,
): boolean {
  const value = record[key];
  if (typeof value !== "boolean")
    throw new Error("canonical field unavailable");
  return value;
}

function requiredStringArray(
  record: Record<string, unknown>,
  key: string,
): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("canonical field unavailable");
  }
  return value as string[];
}

function flattenEntries(value: unknown, prefix = ""): DisplayEntry[] {
  if (typeof value === "string" || typeof value === "boolean") {
    return [{ label: prefix, value: String(value) }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      flattenEntries(item, `${prefix}[${String(index)}]`),
    );
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, child]) =>
      flattenEntries(child, prefix === "" ? key : `${prefix}.${key}`),
    );
  }
  return [];
}

function displayUsdc(baseUnits: string): string {
  if (!/^(0|[1-9][0-9]*)$/u.test(baseUnits)) {
    throw new Error("canonical amount unavailable");
  }
  const padded = baseUnits.padStart(7, "0");
  const integer = padded.slice(0, -6);
  const fraction = padded.slice(-6).replace(/0+$/u, "");
  return `${integer}${fraction === "" ? "" : `.${fraction}`} USDC`;
}

function displayEvent(event: ParsedEvent): DisplayEvent {
  return {
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
      identity: event.source.identity,
      position: event.source.position,
      ...(event.source.occurredAt === undefined
        ? {}
        : { occurredAt: event.source.occurredAt }),
    },
    subject: flattenEntries(event.subject),
    causes: [...event.causes],
    details: flattenEntries(event.details),
  };
}

function securityControl(
  timeline: ParsedTimeline,
  eventType: string,
  label: string,
  status: "REJECTED" | "VERIFIED",
) {
  const event = requiredEvent(timeline, eventType);
  if (event.outcome !== status) throw new Error("security control unavailable");
  return { label, status, eventId: event.eventId } as const;
}

export function createAuditDisplayModel(input: unknown): AuditDisplayModel {
  const timeline = auditTimelineSchema.parse(input);
  const provider = requiredEvent(
    timeline,
    "CIRCLE_PROVIDER_OBSERVATION_RECORDED",
  );
  const arc = requiredEvent(timeline, "ARC_EXECUTION_OBSERVATION_RECORDED");
  const reconciliation = requiredEvent(
    timeline,
    "EXECUTION_RECONCILIATION_RECORDED",
  );
  const providerDetails = provider.details;
  const arcDetails = arc.details;
  const reconciliationDetails = reconciliation.details;
  if (
    requiredString(providerDetails, "providerState") !== "UNKNOWN" ||
    requiredString(arcDetails, "status") !== "OBSERVED_SUCCESS" ||
    requiredString(arcDetails, "receiptStatus") !== "SUCCESSFUL" ||
    requiredString(reconciliationDetails, "classification") !==
      "ARC_EXECUTION_SUCCEEDED" ||
    requiredBoolean(
      reconciliationDetails,
      "providerEvidenceEstablishesArcSuccess",
    ) ||
    requiredBoolean(providerDetails, "automaticRetry")
  ) {
    throw new Error("canonical evidence unavailable");
  }

  const amountBaseUnits = requiredString(arcDetails, "amountBaseUnits");
  return deepFreeze({
    schemaVersion: timeline.schemaVersion,
    mode: timeline.mode,
    authoritative: timeline.authoritative,
    projectionId: timeline.projectionId,
    claimBoundary: {
      circleSubmissionAttemptObserved:
        timeline.claimBoundary.circleSubmissionAttemptObserved,
      circleProviderOutcomeKnown:
        timeline.claimBoundary.circleProviderOutcomeKnown,
      arcExecutionObserved: timeline.claimBoundary.arcExecutionObserved,
      arcPaymentSettlement: timeline.claimBoundary.arcPaymentSettlement,
      paymentFinality: timeline.claimBoundary.paymentFinality,
      databaseFinancialAuthority:
        timeline.claimBoundary.databaseFinancialAuthority,
      automaticResubmission: timeline.claimBoundary.automaticResubmission,
    },
    payment: {
      amount: displayUsdc(amountBaseUnits),
      amountBaseUnits,
      network: "Arc Testnet",
      recipient: requiredString(arcDetails, "recipient"),
      vault: requiredString(arcDetails, "vault"),
      token: requiredString(arcDetails, "token"),
      transactionHash: requiredString(arcDetails, "transactionHash"),
      executionClassification: "ARC_EXECUTION_SUCCEEDED",
      providerOutcome: "UNKNOWN",
      automaticRetry: false,
    },
    providerEvidence: {
      progression: requiredStringArray(providerDetails, "progression"),
      outcome: "UNKNOWN",
      submissionAttemptObserved: true,
      automaticRetry: false,
    },
    arcEvidence: {
      receiptStatus: "SUCCESSFUL",
      blockNumber: requiredString(arcDetails, "blockNumber"),
      checks: [
        {
          label: "Transaction observed",
          value: requiredString(arcDetails, "transactionHash"),
        },
        { label: "Receipt observed successful", value: "SUCCESSFUL" },
        { label: "Vault matched", value: requiredString(arcDetails, "vault") },
        {
          label: "Covenant ID matched",
          value: requiredString(arcDetails, "covenantId"),
        },
        {
          label: "Intent ID matched",
          value: requiredString(arcDetails, "intentId"),
        },
        {
          label: "Authorization ID matched",
          value: requiredString(arcDetails, "authorizationId"),
        },
        {
          label: "Recipient matched",
          value: requiredString(arcDetails, "recipient"),
        },
        { label: "Amount matched", value: `${amountBaseUnits} base units` },
        { label: "Token matched", value: requiredString(arcDetails, "token") },
        {
          label: "Transfer source matched",
          value: requiredString(arcDetails, "transferSource"),
        },
        {
          label: "Transfer recipient matched",
          value: requiredString(arcDetails, "transferRecipient"),
        },
        {
          label: "Transfer amount matched",
          value: `${requiredString(arcDetails, "transferAmountBaseUnits")} base units`,
        },
      ],
      accounting: [
        {
          label: "totalSpent",
          value: requiredString(arcDetails, "totalSpent"),
        },
        {
          label: "paymentCount",
          value: requiredString(arcDetails, "paymentCount"),
        },
        {
          label: "revoked",
          value: String(requiredBoolean(arcDetails, "revoked")),
        },
        {
          label: "vault token balance",
          value: requiredString(arcDetails, "vaultTokenBalance"),
        },
      ],
    },
    securityControls: [
      securityControl(
        timeline,
        "INDIRECT_PROMPT_INJECTION_REJECTED",
        "Fixed compromised proposer",
        "REJECTED",
      ),
      securityControl(
        timeline,
        "DIRECT_VAULT_BYPASS_REJECTED",
        "Direct vault bypass",
        "REJECTED",
      ),
      securityControl(
        timeline,
        "NON_ISSUER_REVOCATION_REJECTED",
        "Unauthorized revocation",
        "REJECTED",
      ),
      securityControl(
        timeline,
        "REVOCATION_VERIFIED",
        "Valid revocation",
        "VERIFIED",
      ),
      securityControl(
        timeline,
        "POST_REVOCATION_EXECUTION_REJECTED",
        "Post-revocation execution",
        "REJECTED",
      ),
    ],
    events: timeline.events.map(displayEvent),
  });
}

export function isDeeplyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  return Object.isFrozen(value) && Object.values(value).every(isDeeplyFrozen);
}
