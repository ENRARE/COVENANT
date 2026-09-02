import {
  rawApprovedSignedDecisionReceiptFixture,
  fixtureAddresses,
  rawApprovedDecisionReceiptFixture,
  rawAuthorizationReceiptFixture,
  rawSignedAuthorizationReceiptFixture,
} from "@covenant/spec";
import { describe, expect, it } from "vitest";
import {
  ARC_TESTNET_CHAIN_ID_STRING,
  COVENANT_DOMAIN_ERROR_CODES,
  CovenantDomainError,
  PLATFORM_V1_ASSET,
  PLATFORM_V1_NETWORK,
  applyAuthorizationEvidence,
  applyExecutionEvidence,
  assertCovenantProject,
  authorizationEvidenceSchema,
  cancelCovenant,
  createCovenant,
  deriveCovenantStatus,
  evaluateExpiry,
  executionEvidenceSchema,
  parseCovenantResource,
  requestAuthorization,
  requestExecution,
} from "../src/index.js";

const id = (byte: number) =>
  `0x${byte.toString(16).padStart(2, "0").repeat(32)}`;
const projectId = id(0xa0);
const otherProjectId = id(0xb0);
const payer = "0x1000000000000000000000000000000000000001";
const beneficiary = "0x2000000000000000000000000000000000000002";

function input(overrides: Record<string, unknown> = {}) {
  return {
    version: "2",
    id: id(1),
    projectId,
    payer,
    beneficiary,
    asset: PLATFORM_V1_ASSET,
    amount: "1.250000",
    network: PLATFORM_V1_NETWORK,
    conditions: { policyHash: id(7), policyVersion: "gpu-policy-1" },
    createdAt: "100",
    expiresAt: "1000",
    ...overrides,
  };
}

function approvedEvidence(
  covenantId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    covenantId,
    policyVersion: "gpu-policy-1",
    decisionId: id(4),
    intentId: id(2),
    intentHash: id(8),
    decision: "APPROVED",
    authorizationId: id(6),
    validUntil: "900",
    ...overrides,
  };
}

function authorizedCovenant() {
  const awaiting = requestAuthorization(createCovenant(input()), "101");
  return applyAuthorizationEvidence(
    awaiting,
    approvedEvidence(awaiting.id),
    "102",
  );
}

function executingCovenant() {
  return requestExecution(authorizedCovenant(), {
    executionId: id(9),
    at: "110",
  });
}

function expectCode(
  action: () => unknown,
  code: (typeof COVENANT_DOMAIN_ERROR_CODES)[number],
) {
  try {
    action();
    throw new Error("expected a domain error");
  } catch (error) {
    expect(error).toBeInstanceOf(CovenantDomainError);
    expect((error as CovenantDomainError).code).toBe(code);
  }
}

describe("@covenant/core COV-022 resource and lifecycle", () => {
  it("creates a strict, canonical, immutable V2 resource", () => {
    const covenant = createCovenant(input());
    expect(covenant.amount).toBe("1.25");
    expect(covenant.status).toBe("CREATED");
    expect(covenant.network.chainId).toBe(ARC_TESTNET_CHAIN_ID_STRING);
    expect(Object.isFrozen(covenant)).toBe(true);
    expect(Object.isFrozen(covenant.authorizationStatus)).toBe(true);
    expect(
      () => ((covenant as { status: string }).status = "EXECUTED"),
    ).toThrow();
    expect(() => createCovenant({ ...input(), unexpected: true })).toThrow();
    expect(() => createCovenant({ ...input(), amount: 1.25 })).toThrow();
    expect(() => createCovenant({ ...input(), amount: "0" })).toThrow();
    expectCode(
      () =>
        createCovenant({ ...input(), network: { id: "other", chainId: "1" } }),
      "UNSUPPORTED_NETWORK",
    );
    expectCode(
      () =>
        createCovenant({
          ...input(),
          asset: { ...PLATFORM_V1_ASSET, symbol: "ETH" },
        }),
      "UNSUPPORTED_ASSET",
    );
  });

  it("isolates projects and permits independent Covenant instances", () => {
    const first = createCovenant(input());
    const second = createCovenant(input({ id: id(2) }));
    const third = createCovenant(
      input({ id: id(3), projectId: otherProjectId }),
    );
    expectCode(() => {
      assertCovenantProject(first, otherProjectId);
    }, "PROJECT_MISMATCH");
    expect(() => {
      assertCovenantProject(first, projectId);
    }).not.toThrow();
    expect(first.id).not.toBe(second.id);
    expect(first.projectId).toBe(second.projectId);
    expect(first.projectId).not.toBe(third.projectId);
    const transitioned = requestAuthorization(first, "101");
    expect(transitioned.status).toBe("AWAITING_AUTHORIZATION");
    expect(second.status).toBe("CREATED");
    expect(third.status).toBe("CREATED");
  });

  it("implements the approved -> requested -> provider-accepted -> Arc-observed path", () => {
    const executing = executingCovenant();
    expect(executing.status).toBe("EXECUTING");
    const providerAccepted = applyExecutionEvidence(
      executing,
      {
        covenantId: executing.id,
        executionId: executing.executionStatus.executionId,
        provider: "ACCEPTED",
        arc: "NOT_OBSERVED",
      },
      "111",
    );
    expect(providerAccepted.status).toBe("EXECUTING");
    expect(providerAccepted.executionStatus.provider).toBe("ACCEPTED");
    expect(providerAccepted.executionStatus.arc).toBe("NOT_OBSERVED");

    const executed = applyExecutionEvidence(
      providerAccepted,
      {
        covenantId: executing.id,
        executionId: executing.executionStatus.executionId,
        provider: "ACCEPTED",
        arc: {
          status: "OBSERVED_SUCCESS",
          chainId: ARC_TESTNET_CHAIN_ID_STRING,
          transactionHash: id(10),
          covenantId: executing.id,
          recipient: beneficiary,
          amount: "1.25",
          token: PLATFORM_V1_ASSET.address,
        },
      },
      "112",
    );
    expect(executed.status).toBe("EXECUTED");
    expect(executed.executionStatus.arc).toBe("SUCCEEDED");
  });

  it("keeps rejected, cancelled, expired, failed, and terminal states explicit", () => {
    const awaiting = requestAuthorization(createCovenant(input()), "101");
    const rejected = applyAuthorizationEvidence(
      awaiting,
      approvedEvidence(awaiting.id, {
        decision: "REJECTED",
        authorizationId: null,
        validUntil: null,
      }),
      "102",
    );
    expect(rejected.status).toBe("REJECTED");
    expectCode(
      () => requestExecution(rejected, id(9), "103"),
      "AUTHORIZATION_REQUIRED",
    );

    const cancelled = cancelCovenant(createCovenant(input()), "103");
    expect(cancelled.status).toBe("CANCELLED");
    expectCode(
      () => cancelCovenant(executingCovenant(), "120"),
      "EXECUTION_ALREADY_STARTED",
    );

    const expired = evaluateExpiry(createCovenant(input()), "1000");
    expect(expired.status).toBe("EXPIRED");
    expectCode(
      () => requestAuthorization(expired, "1001"),
      "INVALID_TRANSITION",
    );

    const authorizationExpired = requestAuthorization(
      createCovenant(input({ expiresAt: "5000" })),
      "101",
    );
    expectCode(
      () =>
        applyAuthorizationEvidence(
          authorizationExpired,
          approvedEvidence(authorizationExpired.id, { validUntil: "110" }),
          "110",
        ),
      "AUTHORIZATION_EXPIRED",
    );

    const failed = applyExecutionEvidence(
      executingCovenant(),
      {
        covenantId: id(1),
        executionId: id(9),
        provider: "REJECTED",
        arc: "OBSERVATION_UNAVAILABLE",
        knownTerminalFailure: "Denied by provider",
      },
      "120",
    );
    expect(failed.status).toBe("FAILED");
    const ambiguousProviderFailure = applyExecutionEvidence(
      executingCovenant(),
      {
        covenantId: id(1),
        executionId: id(9),
        provider: "REJECTED",
        arc: "OBSERVATION_UNAVAILABLE",
      },
      "120",
    );
    expect(ambiguousProviderFailure.status).toBe("EXECUTING");
    expectCode(
      () => requestExecution(failed, id(10), "121"),
      "AUTHORIZATION_REQUIRED",
    );
  });

  it("rejects mismatched, conflicting, or incomplete execution evidence", () => {
    const executing = executingCovenant();
    expectCode(
      () =>
        applyExecutionEvidence(
          executing,
          {
            covenantId: id(99),
            executionId: id(9),
            provider: "ACCEPTED",
            arc: "NOT_OBSERVED",
          },
          "111",
        ),
      "EVIDENCE_MISMATCH",
    );
    expectCode(
      () =>
        applyExecutionEvidence(
          executing,
          {
            covenantId: executing.id,
            executionId: id(9),
            provider: "ACCEPTED",
            arc: { status: "EVIDENCE_CONFLICT", reason: "two observations" },
          },
          "111",
        ),
      "EVIDENCE_CONFLICT",
    );
    expectCode(
      () =>
        applyExecutionEvidence(
          executing,
          {
            covenantId: executing.id,
            executionId: id(9),
            provider: "ACCEPTED",
            arc: {
              status: "OBSERVED_SUCCESS",
              chainId: ARC_TESTNET_CHAIN_ID_STRING,
              transactionHash: id(10),
              covenantId: executing.id,
              recipient: beneficiary,
              amount: "2",
              token: PLATFORM_V1_ASSET.address,
            },
          },
          "111",
        ),
      "EVIDENCE_MISMATCH",
    );
  });

  it("associates existing strict V1 signed receipts without changing their meaning", () => {
    const v1Covenant = createCovenant(
      input({
        id: rawApprovedDecisionReceiptFixture.covenantId,
        projectId,
        payer: fixtureAddresses.issuer,
        beneficiary: fixtureAddresses.recipient,
        conditions: {
          policyHash: id(7),
          policyVersion: rawApprovedDecisionReceiptFixture.policyVersion,
        },
        createdAt: "1784563140",
        expiresAt: "1785168000",
      }),
    );
    const awaiting = requestAuthorization(v1Covenant, "1784563261");
    const authorized = applyAuthorizationEvidence(
      awaiting,
      {
        covenantId: awaiting.id,
        policyVersion: rawApprovedDecisionReceiptFixture.policyVersion,
        decisionId: rawApprovedDecisionReceiptFixture.decisionId,
        intentId: rawApprovedDecisionReceiptFixture.intentId,
        intentHash: rawApprovedDecisionReceiptFixture.intentHash,
        decision: "APPROVED",
        authorizationId: rawAuthorizationReceiptFixture.authorizationId,
        validUntil: rawAuthorizationReceiptFixture.validUntil,
        signedDecisionReceipt: rawApprovedSignedDecisionReceiptFixture,
        signedAuthorizationReceipt: rawSignedAuthorizationReceiptFixture,
      },
      "1784563300",
    );
    expect(authorized.status).toBe("AUTHORIZED");
    expect(authorized.authorizationStatus.authorizationId).toBe(
      rawAuthorizationReceiptFixture.authorizationId.toLowerCase(),
    );
  });

  it("does not mutate the input and derives status without a clock or I/O", () => {
    const original = createCovenant(input());
    const snapshot = JSON.stringify(original);
    const awaiting = requestAuthorization(original, "101");
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(deriveCovenantStatus(awaiting, "1000")).toBe("EXPIRED");
    expect(parseCovenantResource(awaiting)).not.toBe(awaiting);
  });
});

describe("strict evidence schemas", () => {
  it("reject unknown fields and require separate provider/Arc evidence", () => {
    expect(
      authorizationEvidenceSchema.safeParse({
        ...approvedEvidence(id(1)),
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      executionEvidenceSchema.safeParse({
        covenantId: id(1),
        executionId: id(2),
        provider: "ACCEPTED",
      }).success,
    ).toBe(false);
  });
});
