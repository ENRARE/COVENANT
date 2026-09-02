import {
  signedAuthorizationReceiptSchema,
  signedDecisionReceiptSchema,
  UINT256_MAX_DECIMAL,
} from "@covenant/spec";
import {
  COVENANT_TRANSITIONS,
  type ArcObservationState,
  type CovenantLifecycleStatus,
  type ProviderState,
} from "./constants.js";
import { CovenantDomainError, covenantFailure } from "./errors.js";
import {
  authorizationEvidenceSchema,
  createCovenantInputSchema,
  executionEvidenceSchema,
  platformCovenantSchema,
  type AuthorizationEvidence,
  type CreateCovenantInput,
  type ExecutionEvidence,
  type PlatformCovenant,
} from "./schemas.js";
import { z } from "zod";

const timestampSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/u)
  .max(78)
  .refine(
    (value) =>
      (value.length < 78 || value <= UINT256_MAX_DECIMAL) && BigInt(value) > 0n,
  );

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function parseCovenant(input: unknown): PlatformCovenant {
  assertPlatformAnchors(input);
  try {
    return platformCovenantSchema.parse(input);
  } catch (error) {
    if (error instanceof CovenantDomainError) throw error;
    covenantFailure("INVALID_COVENANT", undefined, error);
  }
}

function assertPlatformAnchors(input: unknown): void {
  if (input === null || typeof input !== "object") return;
  const candidate = input as Record<string, unknown>;
  const network = candidate.network;
  if (network !== null && typeof network === "object") {
    const networkRecord = network as Record<string, unknown>;
    if (
      (networkRecord.id !== undefined && networkRecord.id !== "arc-testnet") ||
      (networkRecord.chainId !== undefined &&
        networkRecord.chainId !== "5042002" &&
        networkRecord.chainId !== 5042002)
    ) {
      covenantFailure("UNSUPPORTED_NETWORK");
    }
  }
  const asset = candidate.asset;
  if (asset !== null && typeof asset === "object") {
    const assetRecord = asset as Record<string, unknown>;
    if (
      (assetRecord.symbol !== undefined && assetRecord.symbol !== "USDC") ||
      (assetRecord.decimals !== undefined && assetRecord.decimals !== 6) ||
      (assetRecord.address !== undefined &&
        typeof assetRecord.address === "string" &&
        assetRecord.address.toLowerCase() !==
          "0x3600000000000000000000000000000000000000")
    ) {
      covenantFailure("UNSUPPORTED_ASSET");
    }
  }
}

function parseTimestamp(input: unknown): string {
  try {
    return timestampSchema.parse(input);
  } catch (error) {
    covenantFailure("INVALID_TIMESTAMP", undefined, error);
  }
}

function parseEvaluationArgument(input: unknown): string {
  if (typeof input === "string") return parseTimestamp(input);
  if (input !== null && typeof input === "object" && "at" in input) {
    return parseTimestamp(input.at);
  }
  covenantFailure("INVALID_TIMESTAMP");
}

function parseEvidence<T>(
  schema: { parse(input: unknown): T },
  input: unknown,
  code: "EVIDENCE_MISMATCH" | "UNSUPPORTED_EVIDENCE",
): T {
  try {
    return schema.parse(input);
  } catch (error) {
    covenantFailure(code, undefined, error);
  }
}

function updateCovenant(
  covenant: PlatformCovenant,
  at: string,
  patch: Partial<PlatformCovenant>,
): PlatformCovenant {
  const parsed = parseCovenant(covenant);
  if (BigInt(at) < BigInt(parsed.updatedAt)) {
    covenantFailure(
      "INVALID_TIMESTAMP",
      "Evaluation timestamp must not precede updatedAt",
    );
  }
  try {
    return deepFreeze(
      platformCovenantSchema.parse({
        ...parsed,
        ...patch,
        updatedAt: at,
      }),
    );
  } catch (error) {
    covenantFailure("INVALID_COVENANT", undefined, error);
  }
}

function assertTransition(
  from: CovenantLifecycleStatus,
  to: CovenantLifecycleStatus,
): void {
  if (!COVENANT_TRANSITIONS[from].includes(to)) {
    covenantFailure(
      "INVALID_TRANSITION",
      `Cannot transition Covenant from ${from} to ${to}`,
    );
  }
}

function isPreSubmissionStatus(status: CovenantLifecycleStatus): boolean {
  return (
    status === "CREATED" ||
    status === "AWAITING_AUTHORIZATION" ||
    status === "AUTHORIZED"
  );
}

function assertNotExpired(
  covenant: PlatformCovenant,
  at: string,
  code: "COVENANT_EXPIRED" | "AUTHORIZATION_EXPIRED" = "COVENANT_EXPIRED",
): void {
  if (BigInt(at) >= BigInt(covenant.expiresAt)) {
    covenantFailure(code);
  }
}

function assertProject(covenant: PlatformCovenant, projectId: unknown): void {
  if (
    typeof projectId !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/u.test(projectId) ||
    projectId.toLowerCase() !== covenant.projectId.toLowerCase()
  ) {
    covenantFailure("PROJECT_MISMATCH");
  }
}

function normalizeProvider(provider: ExecutionEvidence["provider"]): {
  status: ProviderState;
  transactionId: string | null;
} {
  if (typeof provider === "string") {
    return { status: provider, transactionId: null };
  }
  if (provider.status === "OBSERVED") {
    const rejected = ["FAILED", "DENIED", "CANCELLED"].includes(
      provider.providerState,
    );
    return {
      status: rejected ? "REJECTED" : "ACCEPTED",
      transactionId: provider.transactionId ?? null,
    };
  }
  return {
    status: provider.status,
    transactionId: provider.transactionId ?? null,
  };
}

function arcStatus(arc: ExecutionEvidence["arc"]): ArcObservationState {
  if (typeof arc === "string") {
    return arc === "OBSERVATION_UNAVAILABLE" ? "UNAVAILABLE" : arc;
  }
  switch (arc.status) {
    case "OBSERVED_SUCCESS":
      return "SUCCEEDED";
    case "OBSERVED_REVERTED":
      return "REVERTED";
    case "EVIDENCE_CONFLICT":
      return "CONFLICT";
  }
}

function validateSignedEvidence(
  covenant: PlatformCovenant,
  evidence: AuthorizationEvidence,
): void {
  const decisionEnvelope =
    evidence.signedDecisionReceipt ?? evidence.decisionReceipt;
  if (decisionEnvelope !== undefined) {
    let parsed: ReturnType<typeof signedDecisionReceiptSchema.parse>;
    try {
      parsed = signedDecisionReceiptSchema.parse(decisionEnvelope);
    } catch (error) {
      covenantFailure("EVIDENCE_MISMATCH", undefined, error);
    }
    const payload = parsed.payload;
    if (
      payload.covenantId.toLowerCase() !== covenant.id.toLowerCase() ||
      payload.decisionId.toLowerCase() !== evidence.decisionId.toLowerCase() ||
      payload.intentId.toLowerCase() !== evidence.intentId.toLowerCase() ||
      payload.intentHash.toLowerCase() !== evidence.intentHash.toLowerCase() ||
      payload.decision !== evidence.decision ||
      payload.policyVersion !== evidence.policyVersion
    ) {
      covenantFailure("EVIDENCE_MISMATCH");
    }
  }

  const authorizationEnvelope =
    evidence.signedAuthorizationReceipt ?? evidence.authorizationReceipt;
  if (authorizationEnvelope !== undefined) {
    let parsed: ReturnType<typeof signedAuthorizationReceiptSchema.parse>;
    try {
      parsed = signedAuthorizationReceiptSchema.parse(authorizationEnvelope);
    } catch (error) {
      covenantFailure("EVIDENCE_MISMATCH", undefined, error);
    }
    if (evidence.authorizationId === null || evidence.validUntil === null) {
      covenantFailure("EVIDENCE_MISMATCH");
    }
    const payload = parsed.payload;
    if (
      payload.covenantId.toLowerCase() !== covenant.id.toLowerCase() ||
      payload.decisionId.toLowerCase() !== evidence.decisionId.toLowerCase() ||
      payload.authorizationId.toLowerCase() !==
        evidence.authorizationId.toLowerCase() ||
      payload.policyVersion !== evidence.policyVersion ||
      payload.validUntil.toString() !== evidence.validUntil
    ) {
      covenantFailure("EVIDENCE_MISMATCH");
    }
  }
}

export function createCovenant(input: unknown): PlatformCovenant {
  assertPlatformAnchors(input);
  let parsed: CreateCovenantInput;
  try {
    parsed = createCovenantInputSchema.parse(input);
  } catch (error) {
    covenantFailure("INVALID_COVENANT", undefined, error);
  }
  const conditions = parsed.conditions ?? parsed.policy;
  if (conditions === undefined) covenantFailure("INVALID_COVENANT");
  try {
    return deepFreeze(
      platformCovenantSchema.parse({
        version: parsed.version,
        id: parsed.id,
        projectId: parsed.projectId,
        payer: parsed.payer,
        beneficiary: parsed.beneficiary,
        asset: parsed.asset,
        amount: parsed.amount,
        network: parsed.network,
        conditions,
        authorizationStatus: {
          decision: "PENDING",
          evidence: "ABSENT",
          decisionId: null,
          authorizationId: null,
          intentId: null,
          intentHash: null,
          validUntil: null,
        },
        executionStatus: {
          preparation: "NOT_REQUESTED",
          provider: "NOT_SUBMITTED",
          arc: "NOT_OBSERVED",
          executionId: null,
          transactionId: null,
          failureReason: null,
        },
        status: "CREATED",
        createdAt: parsed.createdAt,
        updatedAt: parsed.createdAt,
        expiresAt: parsed.expiresAt,
        auditReference: parsed.auditReference ?? null,
      }),
    );
  } catch (error) {
    covenantFailure("INVALID_COVENANT", undefined, error);
  }
}

export function parseCovenantResource(input: unknown): PlatformCovenant {
  return deepFreeze(parseCovenant(input));
}

export function deriveCovenantStatus(
  input: unknown,
  evaluationTime?: unknown,
): CovenantLifecycleStatus {
  const covenant = parseCovenant(input);
  const at = parseTimestamp(evaluationTime ?? covenant.updatedAt);
  if (BigInt(at) < BigInt(covenant.updatedAt)) {
    covenantFailure(
      "INVALID_TIMESTAMP",
      "Evaluation timestamp must not precede updatedAt",
    );
  }
  if (
    covenant.status === "EXECUTED" ||
    covenant.status === "REJECTED" ||
    covenant.status === "CANCELLED" ||
    covenant.status === "EXPIRED" ||
    covenant.status === "FAILED"
  ) {
    return covenant.status;
  }
  if (
    isPreSubmissionStatus(covenant.status) &&
    BigInt(at) >= BigInt(covenant.expiresAt)
  ) {
    return "EXPIRED";
  }
  if (
    covenant.status === "AUTHORIZED" &&
    covenant.authorizationStatus.validUntil !== null &&
    BigInt(at) >= BigInt(covenant.authorizationStatus.validUntil)
  ) {
    return "EXPIRED";
  }
  if (
    covenant.authorizationStatus.decision === "APPROVED" &&
    covenant.authorizationStatus.validUntil !== null &&
    BigInt(at) >= BigInt(covenant.authorizationStatus.validUntil) &&
    (covenant.status === "AWAITING_AUTHORIZATION" ||
      covenant.status === "AUTHORIZED")
  ) {
    return "EXPIRED";
  }
  if (covenant.status === "AWAITING_AUTHORIZATION") {
    if (covenant.authorizationStatus.decision === "REJECTED") {
      return "REJECTED";
    }
    if (
      covenant.authorizationStatus.decision === "APPROVED" &&
      covenant.authorizationStatus.evidence === "VALID"
    ) {
      return "AUTHORIZED";
    }
  }
  if (covenant.status === "EXECUTING") {
    if (covenant.executionStatus.arc === "SUCCEEDED") return "EXECUTED";
    if (covenant.executionStatus.arc === "REVERTED") return "FAILED";
  }
  return covenant.status;
}

export function assertProjectOwnership(
  input: unknown,
  projectId: unknown,
): void {
  const covenant = parseCovenant(input);
  assertProject(covenant, projectId);
}

export const assertCovenantProject = assertProjectOwnership;

export function requestAuthorization(
  input: unknown,
  evaluationTime: unknown,
): PlatformCovenant {
  const covenant = parseCovenant(input);
  const at = parseEvaluationArgument(evaluationTime);
  assertTransition(covenant.status, "AWAITING_AUTHORIZATION");
  assertNotExpired(covenant, at);
  return updateCovenant(covenant, at, { status: "AWAITING_AUTHORIZATION" });
}

export function applyAuthorizationEvidence(
  input: unknown,
  rawEvidence: unknown,
  evaluationTime: unknown,
): PlatformCovenant {
  const covenant = parseCovenant(input);
  const at = parseEvaluationArgument(evaluationTime);
  const evidence = parseEvidence(
    authorizationEvidenceSchema,
    rawEvidence,
    "EVIDENCE_MISMATCH",
  );
  assertTransition(
    covenant.status,
    evidence.decision === "APPROVED" ? "AUTHORIZED" : "REJECTED",
  );
  if (evidence.covenantId.toLowerCase() !== covenant.id.toLowerCase()) {
    covenantFailure("EVIDENCE_MISMATCH");
  }
  if (evidence.policyVersion !== covenant.conditions.policyVersion) {
    covenantFailure("EVIDENCE_MISMATCH");
  }
  assertNotExpired(covenant, at, "AUTHORIZATION_EXPIRED");
  validateSignedEvidence(covenant, evidence);
  if (
    evidence.decision === "APPROVED" &&
    evidence.validUntil !== null &&
    BigInt(evidence.validUntil) <= BigInt(at)
  ) {
    covenantFailure("AUTHORIZATION_EXPIRED");
  }
  const authorizationStatus = {
    decision: evidence.decision,
    evidence: "VALID" as const,
    decisionId: evidence.decisionId,
    authorizationId: evidence.authorizationId,
    intentId: evidence.intentId,
    intentHash: evidence.intentHash,
    validUntil: evidence.validUntil,
  };
  return updateCovenant(covenant, at, {
    status: evidence.decision === "APPROVED" ? "AUTHORIZED" : "REJECTED",
    authorizationStatus,
  });
}

type ExecutionRequest = { executionId: unknown; at: unknown };

function parseExecutionRequest(
  requestOrExecutionId: unknown,
  evaluationTime: unknown,
): { executionId: string; at: string } {
  if (typeof requestOrExecutionId === "string") {
    return {
      executionId: parseCovenantId(requestOrExecutionId),
      at: parseEvaluationArgument(evaluationTime),
    };
  }
  if (
    requestOrExecutionId !== null &&
    typeof requestOrExecutionId === "object" &&
    "executionId" in requestOrExecutionId &&
    ("at" in requestOrExecutionId || "requestedAt" in requestOrExecutionId)
  ) {
    const request = requestOrExecutionId as ExecutionRequest;
    return {
      executionId: parseCovenantId(request.executionId),
      at: parseEvaluationArgument(
        request.at ??
          (requestOrExecutionId as { requestedAt?: unknown }).requestedAt,
      ),
    };
  }
  covenantFailure("INVALID_TIMESTAMP");
}

function parseCovenantId(input: unknown): string {
  try {
    return z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/u)
      .parse(input)
      .toLowerCase();
  } catch (error) {
    covenantFailure("INVALID_COVENANT", undefined, error);
  }
}

export function requestExecution(
  input: unknown,
  requestOrExecutionId: unknown,
  evaluationTime?: unknown,
): PlatformCovenant {
  const covenant = parseCovenant(input);
  const request = parseExecutionRequest(requestOrExecutionId, evaluationTime);
  if (covenant.status !== "AUTHORIZED") {
    if (covenant.status === "EXECUTING") {
      covenantFailure("EXECUTION_ALREADY_STARTED");
    }
    covenantFailure("AUTHORIZATION_REQUIRED");
  }
  assertNotExpired(covenant, request.at);
  if (
    covenant.authorizationStatus.validUntil !== null &&
    BigInt(request.at) >= BigInt(covenant.authorizationStatus.validUntil)
  ) {
    covenantFailure("AUTHORIZATION_EXPIRED");
  }
  const executionStatus = {
    preparation: "REQUESTED" as const,
    provider: "NOT_SUBMITTED" as const,
    arc: "NOT_OBSERVED" as const,
    executionId: request.executionId as `0x${string}`,
    transactionId: null,
    failureReason: null,
  };
  return updateCovenant(covenant, request.at, {
    status: "EXECUTING",
    executionStatus,
  });
}

function validateArcSuccess(
  covenant: PlatformCovenant,
  evidence: Extract<
    NonNullable<ExecutionEvidence["arc"]>,
    { status: "OBSERVED_SUCCESS" }
  >,
): void {
  if (
    evidence.covenantId.toLowerCase() !== covenant.id.toLowerCase() ||
    evidence.recipient !== covenant.beneficiary ||
    evidence.amount !== covenant.amount ||
    evidence.token !== covenant.asset.address
  ) {
    covenantFailure("EVIDENCE_MISMATCH");
  }
  const expectedIntent = covenant.authorizationStatus.intentId;
  if (
    evidence.intentId !== undefined &&
    expectedIntent !== null &&
    evidence.intentId !== expectedIntent
  ) {
    covenantFailure("EVIDENCE_MISMATCH");
  }
  const expectedAuthorization = covenant.authorizationStatus.authorizationId;
  if (
    evidence.authorizationId !== undefined &&
    expectedAuthorization !== null &&
    evidence.authorizationId !== expectedAuthorization
  ) {
    covenantFailure("EVIDENCE_MISMATCH");
  }
}

export function applyExecutionEvidence(
  input: unknown,
  rawEvidence: unknown,
  evaluationTime: unknown,
): PlatformCovenant {
  const covenant = parseCovenant(input);
  const at = parseEvaluationArgument(evaluationTime);
  const evidence = parseEvidence(
    executionEvidenceSchema,
    rawEvidence,
    "UNSUPPORTED_EVIDENCE",
  );
  if (covenant.status !== "EXECUTING") {
    if (covenant.status === "AUTHORIZED") {
      covenantFailure("AUTHORIZATION_REQUIRED");
    }
    covenantFailure("INVALID_TRANSITION");
  }
  if (
    evidence.covenantId.toLowerCase() !== covenant.id.toLowerCase() ||
    evidence.executionId.toLowerCase() !==
      covenant.executionStatus.executionId?.toLowerCase()
  ) {
    covenantFailure("EVIDENCE_MISMATCH");
  }
  const provider = normalizeProvider(evidence.provider);
  const arcTransactionId =
    typeof evidence.arc === "object" &&
    (evidence.arc.status === "OBSERVED_SUCCESS" ||
      evidence.arc.status === "OBSERVED_REVERTED")
      ? evidence.arc.transactionHash
      : null;
  const transactionId =
    evidence.transactionId ??
    provider.transactionId ??
    arcTransactionId ??
    covenant.executionStatus.transactionId;
  const observedArc = arcStatus(evidence.arc);
  if (observedArc === "CONFLICT") {
    covenantFailure("EVIDENCE_CONFLICT");
  }
  if (observedArc === "SUCCEEDED") {
    if (
      typeof evidence.arc === "string" ||
      evidence.arc.status !== "OBSERVED_SUCCESS"
    ) {
      covenantFailure("UNSUPPORTED_EVIDENCE");
    }
    validateArcSuccess(covenant, evidence.arc);
    if (provider.status === "REJECTED") {
      covenantFailure("EVIDENCE_CONFLICT");
    }
  }
  const executionStatus = {
    preparation: "READY" as const,
    provider: provider.status,
    arc: observedArc,
    executionId: covenant.executionStatus.executionId,
    transactionId,
    failureReason:
      observedArc === "REVERTED"
        ? "Arc execution reverted"
        : (evidence.knownTerminalFailure ?? null),
  };
  const knownTerminalFailure =
    evidence.knownTerminalFailure !== undefined || observedArc === "REVERTED";
  const nextStatus =
    observedArc === "SUCCEEDED"
      ? "EXECUTED"
      : observedArc === "REVERTED" ||
          (provider.status === "REJECTED" && knownTerminalFailure)
        ? "FAILED"
        : "EXECUTING";
  return updateCovenant(covenant, at, {
    status: nextStatus,
    executionStatus,
  });
}

export function cancelCovenant(
  input: unknown,
  evaluationTime: unknown,
): PlatformCovenant {
  const covenant = parseCovenant(input);
  const at = parseEvaluationArgument(evaluationTime);
  if (!isPreSubmissionStatus(covenant.status)) {
    if (covenant.status === "EXECUTING") {
      covenantFailure("EXECUTION_ALREADY_STARTED");
    }
    covenantFailure("CANCELLATION_NOT_ALLOWED");
  }
  assertNotExpired(covenant, at);
  assertTransition(covenant.status, "CANCELLED");
  return updateCovenant(covenant, at, { status: "CANCELLED" });
}

export function evaluateExpiry(
  input: unknown,
  evaluationTime: unknown,
): PlatformCovenant {
  const covenant = parseCovenant(input);
  const at = parseEvaluationArgument(evaluationTime);
  const status = deriveCovenantStatus(covenant, at);
  if (status === covenant.status) return deepFreeze(covenant);
  if (status !== "EXPIRED") {
    return deepFreeze(covenant);
  }
  assertTransition(covenant.status, "EXPIRED");
  return updateCovenant(covenant, at, { status: "EXPIRED" });
}

export const isCovenantExpired = (
  input: unknown,
  evaluationTime: unknown,
): boolean => evaluateExpiry(input, evaluationTime).status === "EXPIRED";
