import { CANONICAL_RULE_IDS, hashRuleResults } from "@covenant/spec";
import { keccak256, stringToHex } from "viem";

const id = (byte: string): `0x${string}` => `0x${byte.repeat(64)}`;
const signature = (byte: string): `0x${string}` => `0x${byte.repeat(130)}`;

export const IDS = Object.freeze({
  covenant: id("1"),
  invoice: id("2"),
  intent: id("3"),
  intentDigest: id("4"),
  decision: id("5"),
  decisionDigest: id("6"),
  authorization: id("7"),
  authorizationDigest: id("8"),
  execution: id("9"),
  runtime: id("a"),
  transaction: id("d"),
  block: id("e"),
});

export const ADDRESSES = Object.freeze({
  agent: "0x1000000000000000000000000000000000000001",
  authorization: "0x2000000000000000000000000000000000000002",
  recipient: "0x3000000000000000000000000000000000000003",
  token: "0x4000000000000000000000000000000000000004",
  vault: "0x5000000000000000000000000000000000000005",
});

export function canonicalRules(failedRule?: string) {
  return CANONICAL_RULE_IDS.map((ruleId) => ({
    ruleId,
    status: ruleId === failedRule ? ("FAIL" as const) : ("PASS" as const),
    expected: "expected",
    actual: ruleId === failedRule ? "malicious" : "expected",
    reason: ruleId === failedRule ? "Rejected by fixed rule" : "Rule passed",
  }));
}

export function signedFlowSource(options?: { rejected?: boolean }) {
  const rejected = options?.rejected ?? false;
  const rules = canonicalRules(rejected ? "recipient_allowed" : undefined);
  const decision = rejected ? ("REJECTED" as const) : ("APPROVED" as const);
  return {
    kind: "VALIDATED_SIGNED_FLOW" as const,
    intentDigest: IDS.intentDigest,
    decisionDigest: IDS.decisionDigest,
    ...(rejected ? {} : { authorizationDigest: IDS.authorizationDigest }),
    signedPaymentIntent: {
      payload: {
        version: "1",
        intentId: IDS.intent,
        covenantId: IDS.covenant,
        agentSigner: ADDRESSES.agent,
        recipient: ADDRESSES.recipient,
        token: ADDRESSES.token,
        amount: "1.25",
        invoiceHash: IDS.invoice,
        purpose: "Purchase approved GPU compute",
        createdAt: "1000",
        expiresAt: "1300",
        nonce: "1",
      },
      signature: signature("1"),
    },
    ruleResults: rules,
    signedDecisionReceipt: {
      payload: {
        version: "1",
        decisionId: IDS.decision,
        covenantId: IDS.covenant,
        intentId: IDS.intent,
        intentHash: IDS.intentDigest,
        decision,
        ruleResultsHash: hashRuleResults(rules),
        policyVersion: "gpu-policy-1",
        createdAt: "1010",
        signer: ADDRESSES.authorization,
      },
      signature: signature("2"),
    },
    ...(rejected
      ? {}
      : {
          signedAuthorizationReceipt: {
            payload: {
              version: "1",
              authorizationId: IDS.authorization,
              decisionId: IDS.decision,
              covenantId: IDS.covenant,
              intentHash: IDS.intentDigest,
              vaultAddress: ADDRESSES.vault,
              chainId: "5042002",
              policyVersion: "gpu-policy-1",
              authorizationNonce: "1",
              validUntil: "1200",
              signer: ADDRESSES.authorization,
            },
            signature: signature("3"),
          },
        }),
  };
}

export const executorLink = Object.freeze({
  executionId: IDS.execution,
  intentDigest: IDS.intentDigest,
  decisionDigest: IDS.decisionDigest,
  authorizationDigest: IDS.authorizationDigest,
});

export function executorSource(
  result:
    | { status: "PREPARED" | "SIMULATED" }
    | { status: "SUBMITTED"; transactionId: string },
) {
  return {
    kind: "EXECUTOR_RESULT" as const,
    result: { ...result, execution: executorLink },
  };
}

export const localEvidenceSource = Object.freeze({
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

function demoEvent(input: {
  sequence: string;
  eventType: string;
  scenarioId?: string;
  fields?: Readonly<Record<string, unknown>>;
}) {
  const eventId = keccak256(
    stringToHex(
      [
        "1",
        IDS.runtime,
        input.sequence,
        input.eventType,
        input.scenarioId ?? "",
      ].join(":"),
    ),
  );
  return {
    schemaVersion: "1",
    runtimeId: IDS.runtime,
    eventId,
    sequence: input.sequence,
    occurredAt: String(10_000 + Number(input.sequence)),
    eventType: input.eventType,
    ...(input.scenarioId === undefined ? {} : { scenarioId: input.scenarioId }),
    ...(input.fields ?? {}),
  };
}

export function approvedDemoSource() {
  const scenarioId = "happy-path-v1";
  return {
    kind: "DEMO_AUDIT" as const,
    events: [
      demoEvent({ sequence: "1", eventType: "RUNTIME_INITIALIZED" }),
      demoEvent({
        sequence: "2",
        eventType: "PAYMENT_INTENT_PROPOSED",
        scenarioId,
        fields: {
          covenantId: IDS.covenant,
          invoiceId: IDS.invoice,
          intentId: IDS.intent,
          amount: "1.25",
        },
      }),
      demoEvent({
        sequence: "3",
        eventType: "RULES_EVALUATED",
        scenarioId,
        fields: {
          intentId: IDS.intent,
          ruleResults: canonicalRules().map(({ ruleId, status }) => ({
            ruleId,
            status,
          })),
        },
      }),
      demoEvent({
        sequence: "4",
        eventType: "DECISION_APPROVED",
        scenarioId,
        fields: {
          covenantId: IDS.covenant,
          intentId: IDS.intent,
          decisionId: IDS.decision,
        },
      }),
      demoEvent({
        sequence: "5",
        eventType: "AUTHORIZATION_ISSUED",
        scenarioId,
        fields: {
          covenantId: IDS.covenant,
          intentId: IDS.intent,
          decisionId: IDS.decision,
          authorizationId: IDS.authorization,
        },
      }),
      demoEvent({
        sequence: "6",
        eventType: "EXECUTOR_REQUEST_PREPARED",
        scenarioId,
        fields: {
          intentId: IDS.intent,
          authorizationId: IDS.authorization,
          executionId: IDS.execution,
        },
      }),
      demoEvent({
        sequence: "7",
        eventType: "SIMULATION_ACCEPTED",
        scenarioId,
        fields: { executionId: IDS.execution },
      }),
      demoEvent({
        sequence: "8",
        eventType: "SUBMISSION_SIMULATED",
        scenarioId,
        fields: {
          executionId: IDS.execution,
          submissionReference: "simulated-submission-0001",
        },
      }),
    ],
  };
}

export function rejectedDemoSource() {
  const scenarioId = "compromised-proposer-v1";
  return {
    kind: "DEMO_AUDIT" as const,
    events: [
      demoEvent({
        sequence: "20",
        eventType: "PAYMENT_INTENT_PROPOSED",
        scenarioId,
        fields: {
          covenantId: IDS.covenant,
          invoiceId: IDS.invoice,
          intentId: IDS.intent,
          amount: "1.25",
        },
      }),
      demoEvent({
        sequence: "21",
        eventType: "RULES_EVALUATED",
        scenarioId,
        fields: {
          intentId: IDS.intent,
          ruleResults: canonicalRules("recipient_allowed").map(
            ({ ruleId, status }) => ({ ruleId, status }),
          ),
        },
      }),
      demoEvent({
        sequence: "22",
        eventType: "DECISION_REJECTED",
        scenarioId,
        fields: {
          covenantId: IDS.covenant,
          intentId: IDS.intent,
          decisionId: IDS.decision,
        },
      }),
    ],
  };
}

export function bundle(...sources: readonly unknown[]) {
  return { schemaVersion: "2", sources };
}

type ReconciliationClassification =
  | "PROVIDER_ONLY"
  | "ARC_NOT_OBSERVED"
  | "ARC_EXECUTION_SUCCEEDED"
  | "ARC_EXECUTION_REVERTED"
  | "EVIDENCE_CONFLICT"
  | "OBSERVATION_UNAVAILABLE";

export function arcExecutionSource(
  classification: ReconciliationClassification = "ARC_EXECUTION_SUCCEEDED",
) {
  const provider =
    classification === "PROVIDER_ONLY"
      ? ({ status: "OBSERVED", providerState: "COMPLETE" } as const)
      : ({ status: "UNKNOWN" } as const);
  const common = {
    chainId: 5_042_002 as const,
    transactionHash: IDS.transaction,
    blockNumber: "56117505",
    blockHash: IDS.block,
    vault: ADDRESSES.vault,
  };
  const arc =
    classification === "ARC_EXECUTION_SUCCEEDED"
      ? ({
          status: "OBSERVED_SUCCESS",
          ...common,
          covenantId: IDS.covenant,
          intentId: IDS.intent,
          authorizationId: IDS.authorization,
          recipient: ADDRESSES.recipient,
          amount: "1250000",
          token: ADDRESSES.token,
          transfer: {
            source: ADDRESSES.vault,
            recipient: ADDRESSES.recipient,
            amount: "1250000",
          },
          vaultState: {
            totalSpent: "1250000",
            paymentCount: "1",
            revoked: false,
            tokenBalance: "2750000",
          },
        } as const)
      : classification === "ARC_EXECUTION_REVERTED"
        ? ({ status: "OBSERVED_REVERTED", ...common } as const)
        : classification === "EVIDENCE_CONFLICT"
          ? ({
              status: "EVIDENCE_CONFLICT",
              reason: "WRONG_AMOUNT",
            } as const)
          : classification === "OBSERVATION_UNAVAILABLE"
            ? ({ status: "OBSERVATION_UNAVAILABLE" } as const)
            : ({ status: "NOT_OBSERVED" } as const);
  return {
    kind: "ARC_EXECUTION_EVIDENCE" as const,
    expected: {
      chainId: 5_042_002 as const,
      transactionHash: IDS.transaction,
      vault: ADDRESSES.vault,
      covenantId: IDS.covenant,
      intentId: IDS.intent,
      authorizationId: IDS.authorization,
      executionId: IDS.execution,
      recipient: ADDRESSES.recipient,
      amount: "1250000",
      token: ADDRESSES.token,
    },
    providerProgression: [
      "PREPARED",
      "SUBMISSION_ATTEMPT_STARTED",
      provider.status === "UNKNOWN" ? "UNKNOWN" : provider.providerState,
    ],
    submissionAttemptObserved: true as const,
    automaticRetry: false as const,
    provider,
    arc,
    reconciliation: { classification },
  };
}
