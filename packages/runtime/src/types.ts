import type { ExecutionEvidence, PlatformCovenant } from "@covenant/core";
import type {
  NoResubmitReason,
  RetryReason,
  RuntimeOutboxEvent,
  RuntimeState,
} from "./constants.js";

export type RuntimeClock = Readonly<{ now: () => number }>;

export type RuntimeCovenant = Readonly<{
  projectId: string;
  covenantId: string;
  resource: PlatformCovenant;
  createdAt: number;
  updatedAt: number;
}>;

export type RuntimeOperation = Readonly<{
  operationKey: string;
  projectId: string;
  covenantId: string;
  executionId: string;
  authorizationId: string;
  intentId: string;
  intentHash: string;
  amount: string;
  beneficiary: string;
  state: RuntimeState;
  attemptCount: number;
  nextAttemptAt: number | null;
  lastAttemptAt: number | null;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  version: number;
  submissionBoundary: boolean;
  providerTransactionId: string | null;
  providerState: string | null;
  providerEvidence: unknown;
  arcEvidence: unknown;
  retryReason: RetryReason | null;
  noResubmitReason: NoResubmitReason | null;
  failureReason: string | null;
  createdAt: number;
  updatedAt: number;
}>;

export type RuntimeOutboxRecord = Readonly<{
  id: number;
  operationKey: string;
  projectId: string;
  covenantId: string;
  eventType: RuntimeOutboxEvent;
  version: number;
  payload: Readonly<Record<string, unknown>>;
  createdAt: number;
  deliveredAt: number | null;
}>;

export type ExecutionStartInput = Readonly<{
  projectId: string;
  covenantId: string;
  executionId: string;
  operationKey: string;
  at: string;
}>;

export type SimulationOutcome =
  | Readonly<{ status: "READY" }>
  | Readonly<{ status: "NO_SUBMISSION"; reason: string }>;

export type SubmissionOutcome =
  | Readonly<{
      status: "ACCEPTED";
      transactionId: string;
      providerState?: string;
    }>
  | Readonly<{ status: "NO_SUBMISSION"; reason: string }>;

/**
 * Narrow adapter for the existing executor. It receives only the persisted
 * operation identity; the executor owns signed fields, transaction creation,
 * Circle credentials, and the reviewed CovenantVault call.
 */
export type ExecutionAdapter = Readonly<{
  simulate: (operation: RuntimeOperation) => Promise<SimulationOutcome>;
  submit: (operation: RuntimeOperation) => Promise<SubmissionOutcome>;
}>;

export type ReconciliationInput = Readonly<{
  operationKey: string;
  projectId: string;
  workerId: string;
  at: string;
  providerState?: string;
  providerTransactionId?: string;
  arc: ExecutionEvidence["arc"];
}>;
