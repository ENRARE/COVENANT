import { CANONICAL_RULE_IDS } from "@covenant/spec";
import { keccak256, stringToHex } from "viem";

const hex32 = (nibble: string): `0x${string}` => `0x${nibble.repeat(64)}`;

export const COV020_HISTORICAL_EXECUTION = Object.freeze({
  chainId: 5_042_002 as const,
  transactionHash:
    "0x1429af87afb5865933cb4bc3870100c8c4d0cde8795efc54e07a9460f8acea55",
  blockNumber: "56117505",
  blockHash: `0x${"ab".repeat(32)}` as const,
  vault: "0x39400A08b37B1121a8cc5AB9102943236eB58ECe",
  token: "0x3600000000000000000000000000000000000000",
  recipient: "0xDbf314C646792dbbD48070e799E7B1EE5d913aB1",
  amount: "10000",
  covenantId:
    "0x1b3ab98ee8e6f18c8710ad37dcffcc845531130c04b045d0f520d21824f57120",
  intentId:
    "0x628514c667ea8d74d943e85857ab4e996ee5d07d846dc420a6e8deacd8fe4b23",
  authorizationId:
    "0x5462cb6b986b01d5f502c3c6f095d52d9e3f162047daf1e644d5666be9f3b496",
  executionId:
    "0x70d4f830b69158fff8ad09b04c7ccddc57882a120c35ef57c2df687f8aa44da4",
  totalSpent: "10000",
  paymentCount: "1",
  vaultTokenBalance: "2990000",
});

const runtimeId = hex32("f");

function demoEvent(input: {
  sequence: string;
  eventType: string;
  scenarioId?: string;
  fields?: Readonly<Record<string, unknown>>;
}) {
  return {
    schemaVersion: "1",
    runtimeId,
    eventId: keccak256(
      stringToHex(
        [
          "1",
          runtimeId,
          input.sequence,
          input.eventType,
          input.scenarioId ?? "",
        ].join(":"),
      ),
    ),
    sequence: input.sequence,
    occurredAt: String(20_000 + Number(input.sequence)),
    eventType: input.eventType,
    ...(input.scenarioId === undefined ? {} : { scenarioId: input.scenarioId }),
    ...(input.fields ?? {}),
  };
}

function ruleResults(failedRule?: string) {
  return CANONICAL_RULE_IDS.map((ruleId) => ({
    ruleId,
    status: ruleId === failedRule ? ("FAIL" as const) : ("PASS" as const),
  }));
}

function canonicalDemoSource() {
  const approvedScenario = "happy-path-v1";
  const rejectedScenario = "compromised-proposer-v1";
  const historical = COV020_HISTORICAL_EXECUTION;
  const approvedDecisionId = hex32("a");
  const maliciousIntentId = hex32("c");
  const maliciousDecisionId = hex32("d");
  return {
    kind: "DEMO_AUDIT" as const,
    events: [
      demoEvent({ sequence: "1", eventType: "RUNTIME_INITIALIZED" }),
      demoEvent({
        sequence: "2",
        eventType: "PAYMENT_INTENT_PROPOSED",
        scenarioId: approvedScenario,
        fields: {
          covenantId: historical.covenantId,
          invoiceId: hex32("8"),
          intentId: historical.intentId,
          amount: "0.01",
        },
      }),
      demoEvent({
        sequence: "3",
        eventType: "RULES_EVALUATED",
        scenarioId: approvedScenario,
        fields: { intentId: historical.intentId, ruleResults: ruleResults() },
      }),
      demoEvent({
        sequence: "4",
        eventType: "DECISION_APPROVED",
        scenarioId: approvedScenario,
        fields: {
          covenantId: historical.covenantId,
          intentId: historical.intentId,
          decisionId: approvedDecisionId,
        },
      }),
      demoEvent({
        sequence: "5",
        eventType: "AUTHORIZATION_ISSUED",
        scenarioId: approvedScenario,
        fields: {
          covenantId: historical.covenantId,
          intentId: historical.intentId,
          decisionId: approvedDecisionId,
          authorizationId: historical.authorizationId,
        },
      }),
      demoEvent({
        sequence: "6",
        eventType: "EXECUTOR_REQUEST_PREPARED",
        scenarioId: approvedScenario,
        fields: {
          intentId: historical.intentId,
          authorizationId: historical.authorizationId,
          executionId: historical.executionId,
        },
      }),
      demoEvent({
        sequence: "20",
        eventType: "PAYMENT_INTENT_PROPOSED",
        scenarioId: rejectedScenario,
        fields: {
          covenantId: historical.covenantId,
          invoiceId: hex32("e"),
          intentId: maliciousIntentId,
          amount: "0.01",
        },
      }),
      demoEvent({
        sequence: "21",
        eventType: "RULES_EVALUATED",
        scenarioId: rejectedScenario,
        fields: {
          intentId: maliciousIntentId,
          ruleResults: ruleResults("recipient_allowed"),
        },
      }),
      demoEvent({
        sequence: "22",
        eventType: "DECISION_REJECTED",
        scenarioId: rejectedScenario,
        fields: {
          covenantId: historical.covenantId,
          intentId: maliciousIntentId,
          decisionId: maliciousDecisionId,
        },
      }),
    ],
  };
}

const localEvidenceSource = Object.freeze({
  kind: "LOCAL_CONTRACT_EVIDENCE" as const,
  result: {
    schemaVersion: "1" as const,
    mode: "LOCAL_ANVIL" as const,
    chainId: "5042002" as const,
    status: "VERIFIED" as const,
    evidence: [
      "LOCAL_EVM_DEPLOYMENT_VERIFIED",
      "LOCAL_VAULT_FUNDED_VERIFIED",
      "LOCAL_VAULT_EXECUTION_SUBMITTED",
      "LOCAL_VAULT_EXECUTION_VERIFIED",
      "LOCAL_REPLAY_REJECTED",
      "LOCAL_BYPASS_REJECTED",
      "LOCAL_NON_ISSUER_REVOCATION_REJECTED",
      "LOCAL_COVENANT_REVOCATION_VERIFIED",
      "LOCAL_POST_REVOCATION_EXECUTION_REJECTED",
    ].map((type) => ({ type, status: "PASS" as const })),
    counts: {
      submittedTransactions: "11",
      successfulReceipts: "7",
      revertedReceipts: "4",
    },
  },
});

function historicalExecutionSource() {
  const value = COV020_HISTORICAL_EXECUTION;
  return {
    kind: "ARC_EXECUTION_EVIDENCE" as const,
    expected: {
      chainId: value.chainId,
      transactionHash: value.transactionHash,
      vault: value.vault,
      covenantId: value.covenantId,
      intentId: value.intentId,
      authorizationId: value.authorizationId,
      executionId: value.executionId,
      recipient: value.recipient,
      amount: value.amount,
      token: value.token,
    },
    providerProgression: ["PREPARED", "SUBMISSION_ATTEMPT_STARTED", "UNKNOWN"],
    submissionAttemptObserved: true as const,
    automaticRetry: false as const,
    provider: { status: "UNKNOWN" as const },
    arc: {
      status: "OBSERVED_SUCCESS" as const,
      chainId: value.chainId,
      transactionHash: value.transactionHash,
      blockNumber: value.blockNumber,
      blockHash: value.blockHash,
      vault: value.vault,
      covenantId: value.covenantId,
      intentId: value.intentId,
      authorizationId: value.authorizationId,
      recipient: value.recipient,
      amount: value.amount,
      token: value.token,
      transfer: {
        source: value.vault,
        recipient: value.recipient,
        amount: value.amount,
      },
      vaultState: {
        totalSpent: value.totalSpent,
        paymentCount: value.paymentCount,
        revoked: false,
        tokenBalance: value.vaultTokenBalance,
      },
    },
    reconciliation: {
      classification: "ARC_EXECUTION_SUCCEEDED" as const,
    },
  };
}

export function createCov020AuditSourceBundle(arcDeploymentManifest: unknown) {
  return {
    schemaVersion: "2" as const,
    sources: [
      {
        kind: "ARC_DEPLOYMENT_EVIDENCE" as const,
        manifest: arcDeploymentManifest,
      },
      canonicalDemoSource(),
      localEvidenceSource,
      historicalExecutionSource(),
    ],
  };
}
