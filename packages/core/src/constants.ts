export const PLATFORM_COVENANT_VERSION = "2" as const;
export const PLATFORM_V1_NETWORK_ID = "arc-testnet" as const;
export const PLATFORM_V1_NETWORK_NAME = "Arc Testnet" as const;
export const PLATFORM_V1_CHAIN_ID = "5042002" as const;
export const PLATFORM_V1_ASSET_SYMBOL = "USDC" as const;
export const PLATFORM_V1_ASSET_DECIMALS = 6 as const;

export const COVENANT_LIFECYCLE_STATES = [
  "CREATED",
  "AWAITING_AUTHORIZATION",
  "AUTHORIZED",
  "EXECUTING",
  "EXECUTED",
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
  "FAILED",
] as const;

export type CovenantLifecycleStatus =
  (typeof COVENANT_LIFECYCLE_STATES)[number];

export const AUTHORIZATION_DECISIONS = [
  "PENDING",
  "APPROVED",
  "REJECTED",
] as const;

export type AuthorizationDecision = (typeof AUTHORIZATION_DECISIONS)[number];

export const AUTHORIZATION_EVIDENCE_STATES = [
  "ABSENT",
  "VALID",
  "INVALID",
  "EXPIRED",
] as const;

export type AuthorizationEvidenceState =
  (typeof AUTHORIZATION_EVIDENCE_STATES)[number];

export const EXECUTION_PREPARATION_STATES = [
  "NOT_REQUESTED",
  "REQUESTED",
  "READY",
] as const;

export type ExecutionPreparationState =
  (typeof EXECUTION_PREPARATION_STATES)[number];

export const PROVIDER_STATES = [
  "NOT_SUBMITTED",
  "ACCEPTED",
  "REJECTED",
  "UNKNOWN",
] as const;

export type ProviderState = (typeof PROVIDER_STATES)[number];

export const ARC_OBSERVATION_STATES = [
  "NOT_OBSERVED",
  "SUCCEEDED",
  "REVERTED",
  "CONFLICT",
  "UNAVAILABLE",
] as const;

export type ArcObservationState = (typeof ARC_OBSERVATION_STATES)[number];

export const COVENANT_TRANSITIONS: Readonly<
  Record<CovenantLifecycleStatus, readonly CovenantLifecycleStatus[]>
> = Object.freeze({
  CREATED: ["AWAITING_AUTHORIZATION", "CANCELLED", "EXPIRED"],
  AWAITING_AUTHORIZATION: ["AUTHORIZED", "REJECTED", "CANCELLED", "EXPIRED"],
  AUTHORIZED: ["EXECUTING", "CANCELLED", "EXPIRED"],
  EXECUTING: ["EXECUTED", "FAILED"],
  EXECUTED: [],
  REJECTED: [],
  CANCELLED: [],
  EXPIRED: [],
  FAILED: [],
});
