import {
  InMemoryProposalReservationRepository,
  PAYMENT_INTENT_TTL_SECONDS,
  createAgentService,
  type RawInvoicePayload,
} from "@covenant/agent";
import {
  createAuthorityService,
  type EvidenceSnapshot,
  type ReceiptSigner,
} from "@covenant/authority";
import { createExecutorService } from "@covenant/executor";
import {
  CANONICAL_RULE_IDS,
  EIP712_DOMAIN_NAMES,
  buildInvoiceTypedData,
  deriveSigningDomainForCovenant,
} from "@covenant/spec";
import type { PrivateKeyAccount } from "viem/accounts";
import {
  COMPROMISED_SCENARIO_ID,
  FROZEN_DEMO,
  HAPPY_SCENARIO_ID,
  type ScenarioId,
} from "./configuration.js";
import { DemoError } from "./errors.js";
import { mapApprovedResult } from "./handoff.js";
import { createCompromisedProposal } from "./private/compromised-proposer.js";
import { DeterministicDemoTransport } from "./private/deterministic-transaction-transport.js";
import {
  ephemeralSignerFactory,
  type SignerFactory,
} from "./private/signer-factory.js";

export type ScenarioEvent = Readonly<{
  eventType:
    | "INVOICE_RECEIVED"
    | "PAYMENT_INTENT_PROPOSED"
    | "RULES_EVALUATED"
    | "DECISION_APPROVED"
    | "DECISION_REJECTED"
    | "AUTHORIZATION_ISSUED"
    | "EXECUTOR_REQUEST_PREPARED"
    | "SIMULATION_ACCEPTED"
    | "SUBMISSION_SIMULATED"
    | "SCENARIO_COMPLETED";
  scenarioId: ScenarioId;
  fields: Readonly<Record<string, unknown>>;
}>;

export type DemoCompositionDependencies = Readonly<{
  now: bigint;
  signerFactory?: SignerFactory;
  compromisedAmount?: string;
  emit(event: ScenarioEvent): Promise<void>;
}>;

class DemoReceiptSigner implements ReceiptSigner {
  constructor(private readonly account: PrivateKeyAccount) {}

  get address(): string {
    return this.account.address;
  }

  signDecisionReceipt(typedData: unknown): Promise<unknown> {
    return this.account.signTypedData(
      typedData as Parameters<PrivateKeyAccount["signTypedData"]>[0],
    );
  }

  signAuthorizationReceipt(typedData: unknown): Promise<unknown> {
    return this.account.signTypedData(
      typedData as Parameters<PrivateKeyAccount["signTypedData"]>[0],
    );
  }
}

function bytes32(value: bigint): `0x${string}` {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function ruleSummaries(results: readonly { ruleId: string; status: string }[]) {
  return results.map((result) =>
    Object.freeze({ ruleId: result.ruleId, status: result.status }),
  );
}

export async function runFrozenComposition(
  dependencies: DemoCompositionDependencies,
): Promise<void> {
  const signers = (
    dependencies.signerFactory ?? ephemeralSignerFactory
  ).create();
  const now = dependencies.now;
  const covenant = Object.freeze({
    version: "1",
    covenantId: FROZEN_DEMO.covenantId,
    issuer: signers.issuer.address,
    agentSigner: signers.agent.address,
    authorizationSigner: signers.authorization.address,
    vaultAddress: FROZEN_DEMO.vault,
    chainId: FROZEN_DEMO.chainId.toString(),
    tokenAddress: FROZEN_DEMO.token,
    recipientAddress: FROZEN_DEMO.recipient,
    maxAmountPerPayment: FROZEN_DEMO.maxAmountPerPayment,
    totalBudget: FROZEN_DEMO.totalBudget,
    maxPaymentCount: "2",
    validAfter: (now - 100n).toString(),
    validUntil: (now + 1_000n).toString(),
    purpose: FROZEN_DEMO.purpose,
    policyHash: FROZEN_DEMO.policyHash,
    policyVersion: FROZEN_DEMO.policyVersion,
    createdAt: (now - 200n).toString(),
  });
  let nextAgentId = 30n;
  const agent = createAgentService({
    clock: { now: () => now },
    covenantProvider: { getCovenant: () => Promise.resolve(covenant) },
    signer: {
      address: signers.agent.address,
      signPaymentIntent: (typedData) =>
        signers.agent.signTypedData(
          typedData as Parameters<PrivateKeyAccount["signTypedData"]>[0],
        ),
    },
    identifierGenerator: {
      createId: () => Promise.resolve(bytes32(nextAgentId++)),
    },
    reservationRepository: new InMemoryProposalReservationRepository(),
    approvedVendor: signers.vendor.address,
    approvedProductId: FROZEN_DEMO.productId,
    intentTtlSeconds: PAYMENT_INTENT_TTL_SECONDS,
  });
  const evidence: EvidenceSnapshot = {
    chainId: FROZEN_DEMO.chainId,
    vaultAddress: FROZEN_DEMO.vault,
    observedAt: now,
    revoked: false,
    totalSpent: 0n,
    paymentCount: 0n,
    usedIntentHash: false,
    usedIntentId: false,
    usedAgentNonce: false,
  };
  let nextAuthorityId = 40n;
  const authority = createAuthorityService({
    clock: { now: () => now },
    covenantProvider: { getCovenant: () => Promise.resolve(covenant) },
    evidenceReader: {
      readEvidence: () => Promise.resolve({ ...evidence }),
      isAuthorizationNonceUsed: () => Promise.resolve(false),
    },
    identifierGenerator: {
      createId: () => Promise.resolve(bytes32(nextAuthorityId++)),
    },
    signer: new DemoReceiptSigner(signers.authorization),
    approvedVendor: signers.vendor.address,
    approvedProductId: FROZEN_DEMO.productId,
  });
  const transport = new DeterministicDemoTransport();
  const executor = createExecutorService({
    clock: { now: () => now },
    covenantProvider: { getCovenant: () => Promise.resolve(covenant) },
    transport,
  });

  const happyInvoice: RawInvoicePayload = Object.freeze({
    version: "1",
    invoiceId:
      "0x0303030303030303030303030303030303030303030303030303030303030303",
    vendor: signers.vendor.address,
    recipient: FROZEN_DEMO.recipient,
    token: FROZEN_DEMO.token,
    amount: FROZEN_DEMO.happyAmount,
    productId: FROZEN_DEMO.productId,
    purpose: FROZEN_DEMO.purpose,
    issuedAt: (now - 10n).toString(),
    expiresAt: (now + 500n).toString(),
    nonce: "3",
  });
  const invoiceDomain = deriveSigningDomainForCovenant(
    covenant,
    EIP712_DOMAIN_NAMES.invoice,
  );
  const happySignedInvoice = Object.freeze({
    payload: happyInvoice,
    signature: await signers.vendor.signTypedData(
      buildInvoiceTypedData(happyInvoice, invoiceDomain),
    ),
  });
  await dependencies.emit({
    eventType: "INVOICE_RECEIVED",
    scenarioId: HAPPY_SCENARIO_ID,
    fields: {
      invoiceId: happyInvoice.invoiceId,
      amount: FROZEN_DEMO.happyAmount,
    },
  });
  const agentResult = await agent.proposePayment({
    signedInvoice: happySignedInvoice,
    procurementRequest: {
      productId: FROZEN_DEMO.productId,
      expectedAmount: FROZEN_DEMO.happyAmount,
    },
  });
  await dependencies.emit({
    eventType: "PAYMENT_INTENT_PROPOSED",
    scenarioId: HAPPY_SCENARIO_ID,
    fields: {
      covenantId: FROZEN_DEMO.covenantId,
      invoiceId: happyInvoice.invoiceId,
      intentId: agentResult.signedPaymentIntent.payload.intentId,
      amount: FROZEN_DEMO.happyAmount,
    },
  });
  const authorityResult = await authority.processPaymentRequest(agentResult);
  await dependencies.emit({
    eventType: "RULES_EVALUATED",
    scenarioId: HAPPY_SCENARIO_ID,
    fields: {
      intentId: agentResult.signedPaymentIntent.payload.intentId,
      ruleResults: ruleSummaries(authorityResult.ruleResults),
    },
  });
  if (
    authorityResult.status !== "APPROVED" ||
    authorityResult.ruleResults.some((result) => result.status !== "PASS") ||
    authorityResult.ruleResults.length !== CANONICAL_RULE_IDS.length
  ) {
    throw new DemoError("HAPPY_PATH_REJECTED");
  }
  const decisionId = authorityResult.decisionReceipt.payload.decisionId;
  const authorizationId =
    authorityResult.authorizationReceipt.payload.authorizationId;
  await dependencies.emit({
    eventType: "DECISION_APPROVED",
    scenarioId: HAPPY_SCENARIO_ID,
    fields: {
      covenantId: FROZEN_DEMO.covenantId,
      intentId: agentResult.signedPaymentIntent.payload.intentId,
      decisionId,
    },
  });
  await dependencies.emit({
    eventType: "AUTHORIZATION_ISSUED",
    scenarioId: HAPPY_SCENARIO_ID,
    fields: {
      covenantId: FROZEN_DEMO.covenantId,
      intentId: agentResult.signedPaymentIntent.payload.intentId,
      decisionId,
      authorizationId,
    },
  });
  const executorRequest = mapApprovedResult(agentResult, authorityResult);
  const prepared = await executor.prepareExecution(executorRequest);
  await dependencies.emit({
    eventType: "EXECUTOR_REQUEST_PREPARED",
    scenarioId: HAPPY_SCENARIO_ID,
    fields: {
      intentId: agentResult.signedPaymentIntent.payload.intentId,
      authorizationId,
      executionId: prepared.executionId,
    },
  });
  await executor.simulateAuthorizedPayment(executorRequest);
  await dependencies.emit({
    eventType: "SIMULATION_ACCEPTED",
    scenarioId: HAPPY_SCENARIO_ID,
    fields: { executionId: prepared.executionId },
  });
  const execution = await executor.executeAuthorizedPayment(executorRequest);
  if (
    !transport.hasExactCompletedCallPattern() ||
    execution.transactionId !== FROZEN_DEMO.simulatedSubmissionReference
  ) {
    throw new DemoError("TRANSPORT_INVARIANT_FAILED");
  }
  await dependencies.emit({
    eventType: "SUBMISSION_SIMULATED",
    scenarioId: HAPPY_SCENARIO_ID,
    fields: {
      executionId: prepared.executionId,
      submissionReference: FROZEN_DEMO.simulatedSubmissionReference,
    },
  });
  await dependencies.emit({
    eventType: "SCENARIO_COMPLETED",
    scenarioId: HAPPY_SCENARIO_ID,
    fields: { decisionId },
  });

  const malicious = await createCompromisedProposal({
    covenant,
    now,
    agent: signers.agent,
    vendor: signers.vendor,
    ...(dependencies.compromisedAmount === undefined
      ? {}
      : { amount: dependencies.compromisedAmount }),
  });
  await dependencies.emit({
    eventType: "INVOICE_RECEIVED",
    scenarioId: COMPROMISED_SCENARIO_ID,
    fields: {
      invoiceId: malicious.signedInvoice.payload.invoiceId,
      amount: FROZEN_DEMO.happyAmount,
    },
  });
  await dependencies.emit({
    eventType: "PAYMENT_INTENT_PROPOSED",
    scenarioId: COMPROMISED_SCENARIO_ID,
    fields: {
      covenantId: FROZEN_DEMO.covenantId,
      invoiceId: malicious.signedInvoice.payload.invoiceId,
      intentId: malicious.signedPaymentIntent.payload.intentId,
      amount: FROZEN_DEMO.happyAmount,
    },
  });
  const simulationCountBefore = transport.simulationCount;
  const submissionCountBefore = transport.submissionCount;
  const rejected = await authority.processPaymentRequest(malicious);
  await dependencies.emit({
    eventType: "RULES_EVALUATED",
    scenarioId: COMPROMISED_SCENARIO_ID,
    fields: {
      intentId: malicious.signedPaymentIntent.payload.intentId,
      ruleResults: ruleSummaries(rejected.ruleResults),
    },
  });
  if (
    rejected.status !== "REJECTED" ||
    rejected.ruleResults.find((result) => result.ruleId === "recipient_allowed")
      ?.status !== "FAIL" ||
    "authorizationReceipt" in rejected
  ) {
    throw new DemoError("MALICIOUS_PATH_APPROVED");
  }
  if (
    transport.simulationCount !== simulationCountBefore ||
    transport.submissionCount !== submissionCountBefore
  ) {
    throw new DemoError("TRANSPORT_INVARIANT_FAILED");
  }
  const rejectedDecisionId = rejected.decisionReceipt.payload.decisionId;
  await dependencies.emit({
    eventType: "DECISION_REJECTED",
    scenarioId: COMPROMISED_SCENARIO_ID,
    fields: {
      covenantId: FROZEN_DEMO.covenantId,
      intentId: malicious.signedPaymentIntent.payload.intentId,
      decisionId: rejectedDecisionId,
    },
  });
  await dependencies.emit({
    eventType: "SCENARIO_COMPLETED",
    scenarioId: COMPROMISED_SCENARIO_ID,
    fields: { decisionId: rejectedDecisionId },
  });
}
