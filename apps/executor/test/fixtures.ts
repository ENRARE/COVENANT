import {
  CANONICAL_RULE_IDS,
  EIP712_DOMAIN_NAMES,
  SCHEMA_VERSION,
  buildAuthorizationReceiptTypedData,
  buildDecisionReceiptTypedData,
  buildPaymentIntentTypedData,
  deriveSigningDomainForCovenant,
  hashPaymentIntent,
  hashRuleResults,
} from "@covenant/spec";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  createExecutorService,
  type ExecutorDependencies,
  type TransactionTransport,
} from "../src/index.js";

export const TEST_NOW = 2_000_000_000n;

export async function createTestHarness() {
  const issuer = privateKeyToAccount(generatePrivateKey());
  const agent = privateKeyToAccount(generatePrivateKey());
  const authorization = privateKeyToAccount(generatePrivateKey());
  const token = privateKeyToAccount(generatePrivateKey()).address;
  const recipient = privateKeyToAccount(generatePrivateKey()).address;
  const vault = privateKeyToAccount(generatePrivateKey()).address;
  const clock = { value: TEST_NOW, calls: 0 };
  const provider = { calls: 0 };
  const transportState = {
    simulations: [] as unknown[],
    submissions: [] as unknown[],
    simulationResult: { status: "SIMULATED" } as unknown,
    submissionResult: {
      status: "SUBMITTED",
      transactionId: "synthetic-transaction-1",
    } as unknown,
    simulationError: undefined as unknown,
    submissionError: undefined as unknown,
  };

  const covenant = {
    version: SCHEMA_VERSION,
    covenantId: `0x${"11".repeat(32)}`,
    issuer: issuer.address,
    agentSigner: agent.address,
    authorizationSigner: authorization.address,
    vaultAddress: vault,
    chainId: "5042002",
    tokenAddress: token,
    recipientAddress: recipient,
    maxAmountPerPayment: "5",
    totalBudget: "10",
    maxPaymentCount: "2",
    validAfter: (TEST_NOW - 100n).toString(),
    validUntil: (TEST_NOW + 1_000n).toString(),
    purpose: "Purchase approved GPU compute",
    policyHash: `0x${"12".repeat(32)}`,
    policyVersion: "gpu-policy-1",
    createdAt: (TEST_NOW - 200n).toString(),
  } as const;

  const intent = {
    version: SCHEMA_VERSION,
    intentId: `0x${"21".repeat(32)}`,
    covenantId: covenant.covenantId,
    agentSigner: agent.address,
    recipient,
    token,
    amount: "1.25",
    invoiceHash: `0x${"22".repeat(32)}`,
    purpose: covenant.purpose,
    createdAt: (TEST_NOW - 10n).toString(),
    expiresAt: (TEST_NOW + 600n).toString(),
    nonce: "0",
  } as const;

  const rules = CANONICAL_RULE_IDS.map((ruleId) => ({
    ruleId,
    status: "PASS" as const,
    expected: "expected",
    actual: "expected",
    reason: `${ruleId} passed`,
  }));
  const intentDomain = deriveSigningDomainForCovenant(
    covenant,
    EIP712_DOMAIN_NAMES.paymentIntent,
  );
  const intentTypedData = buildPaymentIntentTypedData(intent, intentDomain);
  const intentSignature = await agent.signTypedData(intentTypedData);
  const intentDigest = hashPaymentIntent(intent, intentDomain);
  const decision = {
    version: SCHEMA_VERSION,
    decisionId: `0x${"31".repeat(32)}`,
    covenantId: covenant.covenantId,
    intentId: intent.intentId,
    intentHash: intentDigest,
    decision: "APPROVED" as const,
    ruleResultsHash: hashRuleResults(rules),
    policyVersion: covenant.policyVersion,
    createdAt: (TEST_NOW - 5n).toString(),
    signer: authorization.address,
  };
  const decisionDomain = deriveSigningDomainForCovenant(
    covenant,
    EIP712_DOMAIN_NAMES.decisionReceipt,
  );
  const decisionSignature = await authorization.signTypedData(
    buildDecisionReceiptTypedData(decision, decisionDomain),
  );
  const authorizationReceipt = {
    version: SCHEMA_VERSION,
    authorizationId: `0x${"41".repeat(32)}`,
    decisionId: decision.decisionId,
    covenantId: covenant.covenantId,
    intentHash: intentDigest,
    vaultAddress: vault,
    chainId: "5042002",
    policyVersion: covenant.policyVersion,
    authorizationNonce: "0",
    validUntil: (TEST_NOW + 300n).toString(),
    signer: authorization.address,
  };
  const authorizationDomain = deriveSigningDomainForCovenant(
    covenant,
    EIP712_DOMAIN_NAMES.authorizationReceipt,
  );
  const authorizationSignature = await authorization.signTypedData(
    buildAuthorizationReceiptTypedData(
      authorizationReceipt,
      authorizationDomain,
    ),
  );

  const request = {
    signedPaymentIntent: { payload: intent, signature: intentSignature },
    ruleResults: rules,
    decisionReceipt: { payload: decision, signature: decisionSignature },
    authorizationReceipt: {
      payload: authorizationReceipt,
      signature: authorizationSignature,
    },
  };

  const transport: TransactionTransport = {
    simulate(transaction) {
      transportState.simulations.push(transaction);
      if (transportState.simulationError instanceof Error)
        return Promise.reject(transportState.simulationError);
      return Promise.resolve(transportState.simulationResult);
    },
    submit(transaction) {
      transportState.submissions.push(transaction);
      if (transportState.submissionError instanceof Error)
        return Promise.reject(transportState.submissionError);
      return Promise.resolve(transportState.submissionResult);
    },
  };
  const dependencies: ExecutorDependencies = {
    clock: {
      now() {
        clock.calls += 1;
        return clock.value;
      },
    },
    covenantProvider: {
      getCovenant() {
        provider.calls += 1;
        return Promise.resolve(covenant);
      },
    },
    transport,
    submissionTimeoutMilliseconds: 100,
  };
  return {
    accounts: { issuer, agent, authorization },
    covenant,
    intent,
    decision,
    authorizationReceipt,
    rules,
    request,
    clock,
    provider,
    transportState,
    dependencies,
    service: createExecutorService(dependencies),
  };
}

export function cloneRequest<T>(value: T): T {
  return structuredClone(value);
}
