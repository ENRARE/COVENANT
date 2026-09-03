export type Bytes32 = `0x${string}`;

export type CovenantConditions = Readonly<{
  policyHash: Bytes32;
  policyVersion: string;
}>;

export type CovenantAsset = Readonly<{
  symbol: "USDC";
  decimals: 6;
  address: string;
}>;

export type CovenantNetwork = Readonly<{
  id: "arc-testnet";
  chainId: "5042002";
}>;

export type CovenantResource = Readonly<{
  id: Bytes32;
  projectId: Bytes32;
  version: string;
  status: string;
  payer: string;
  beneficiary: string;
  amount: string;
  asset: CovenantAsset;
  network: CovenantNetwork;
  conditions: CovenantConditions;
  authorizationStatus: string;
  executionStatus: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  auditReference?: string;
}>;

export type CreateCovenantInput = Readonly<{
  id?: Bytes32;
  payer: string;
  beneficiary: string;
  amount: string;
  conditions?: CovenantConditions;
  policy?: CovenantConditions;
  createdAt?: string;
  expiresAt: string;
  auditReference?: string;
}>;

/** Existing authority output transported to the API for verification. */
export type AuthorizationEvidence = Readonly<{
  covenantId: Bytes32;
  policyVersion: string;
  decisionId: Bytes32;
  intentId: Bytes32;
  intentHash: Bytes32;
  decision: "APPROVED" | "REJECTED";
  authorizationId: Bytes32 | null;
  validUntil: string | null;
  signedDecisionReceipt?: unknown;
  decisionReceipt?: unknown;
  signedAuthorizationReceipt?: unknown;
  authorizationReceipt?: unknown;
}>;

/** Evidence plus the unchanged V1 intent and canonical policy observations. */
export type AuthorizationEvidenceSubmission = Readonly<{
  evidence: AuthorizationEvidence;
  signedPaymentIntent: unknown;
  ruleResults: readonly unknown[];
}>;

export type CovenantListParams = Readonly<{
  limit?: number;
  after?: Bytes32;
}>;

export type CovenantPage = Readonly<{
  data: readonly CovenantResource[];
  pagination: Readonly<{ nextCursor: string | null }>;
}>;

export type ProviderExecutionState = Readonly<{
  status: string | null;
  transactionId: string | null;
}>;

export type ExecutionResource = Readonly<{
  id: Bytes32;
  executionId: Bytes32;
  operationKey: string;
  projectId: Bytes32;
  covenantId: Bytes32;
  status: string;
  attemptCount: number;
  submissionBoundary: boolean;
  provider: ProviderExecutionState;
  arc: Readonly<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
}>;

export type ExecutionAccepted = Readonly<{
  covenant: CovenantResource;
  execution: ExecutionResource;
  joined: boolean;
}>;

export type AuditEvent = Readonly<{
  eventId: string;
  eventType: string;
  sequence: string;
  status: string;
  occurredAt: string;
}>;

export type AuditResource = Readonly<{
  projectionId: string;
  authoritative: false;
  covenantId: Bytes32;
  events: readonly AuditEvent[];
}>;

export type ApiKeyCreated = Readonly<{
  keyId: string;
  apiKey: string;
  prefix: string;
}>;

export type ApiKeyResource = Readonly<{
  keyId: string;
  prefix: string;
  status: "active" | "revoked";
  createdAt: string;
  revokedAt: string | null;
}>;

export type WebhookEndpointCreated = Readonly<{
  endpointId: string;
  secret: string;
  url: string;
}>;

export type WebhookEndpointResource = Readonly<{
  endpointId: string;
  url: string;
  createdAt: string;
  status: "active" | "revoked";
}>;

export type RequestOptions = Readonly<{
  idempotencyKey?: string;
}>;

export type WebhookEvent = Readonly<{
  eventId: string;
  eventType: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export type WebhookVerifyInput = Readonly<{
  payload: string;
  signature: string;
  timestamp: number | string;
  deliveryId: string;
  secret: string;
  now?: number;
  replayWindowSeconds?: number;
}>;

export type FetchLike = typeof globalThis.fetch;

export type CovenantOptions = Readonly<{
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  fetch?: FetchLike;
  userAgent?: string;
  maxRetries?: number;
}>;
