export const RUNTIME_STATES = [
  "QUEUED",
  "PREPARING",
  "SIMULATING",
  "READY_TO_SUBMIT",
  "SUBMISSION_STARTED",
  "SUBMITTED",
  "AMBIGUOUS",
  "RECONCILING",
  "SUCCEEDED",
  "TERMINAL_FAILED",
] as const;

export type RuntimeState = (typeof RUNTIME_STATES)[number];

export const TERMINAL_RUNTIME_STATES = [
  "SUCCEEDED",
  "TERMINAL_FAILED",
] as const;

export const RUNTIME_OUTBOX_EVENTS = [
  "execution.queued",
  "execution.preparing",
  "execution.simulating",
  "execution.ready_to_submit",
  "execution.submission_started",
  "execution.submitted",
  "execution.ambiguous",
  "execution.reconciling",
  "execution.succeeded",
  "execution.retryable_failure",
  "execution.terminal_failed",
] as const;

export type RuntimeOutboxEvent = (typeof RUNTIME_OUTBOX_EVENTS)[number];

export const RETRY_REASONS = [
  "DATABASE_TRANSIENT",
  "SIMULATION_FAILURE",
  "PROVIDER_NO_SUBMISSION",
  "ARC_OBSERVATION_UNAVAILABLE",
] as const;

export type RetryReason = (typeof RETRY_REASONS)[number];

export const NO_RESUBMIT_REASONS = [
  "SUBMISSION_TIMEOUT",
  "SUBMISSION_EXCEPTION",
  "DISPATCH_UNKNOWN",
  "CRASH_AFTER_BOUNDARY",
  "PROVIDER_OUTCOME_UNKNOWN",
  "EVIDENCE_CONFLICT",
] as const;

export type NoResubmitReason = (typeof NO_RESUBMIT_REASONS)[number];
