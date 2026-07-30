import {
  InMemoryProposalReservationRepository,
  PAYMENT_INTENT_TTL_SECONDS,
  createAgentService,
  type AgentProposalResult,
  type RawInvoicePayload,
} from "@covenant/agent";
import {
  createAuthorityService,
  type ProcessResult,
  type ReceiptSigner,
} from "@covenant/authority";
import { createExecutorService } from "@covenant/executor";
import {
  EIP712_DOMAIN_NAMES,
  authorizationReceiptSchema,
  buildInvoiceTypedData,
  buildPaymentIntentTypedData,
  deriveSigningDomainForCovenant,
  hashInvoice,
  paymentIntentSchema,
} from "@covenant/spec";
import {
  encodeFunctionData,
  isAddressEqual,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { startControlledAnvil } from "./anvil-process.js";
import { loadContractArtifacts } from "./contract-artifacts.js";
import {
  LOCAL_COVENANT_ID,
  LOCAL_MAX_PAYMENT_COUNT,
  LOCAL_POLICY_HASH,
  LOCAL_POLICY_VERSION,
  LOCAL_PRODUCT_ID,
  LOCAL_PURPOSE,
  LOCAL_TOTAL_BUDGET,
  deployLocalCovenant,
  type LocalDeployment,
} from "./deploy-local-covenant.js";
import { evidenceFailure, sanitizedEvidenceError } from "./errors.js";
import {
  eventArgs,
  requireNoEvent,
  requireSingleEvent,
  submitExpectedRevert,
} from "./receipt-evidence.js";
import { createLocalRoles, type LocalRoles } from "./role-fixtures.js";
import {
  LOCAL_CHAIN_ID_STRING,
  LOCAL_EVIDENCE_TYPES,
  localEvidenceResultSchema,
  type LocalEvidenceResult,
} from "./schemas.js";
import {
  TransactionReceiptReader,
  type ReceiptExpectation,
} from "./transaction-receipt-reader.js";
import { ViemTransactionTransport } from "./viem-transaction-transport.js";
import { ViemVaultEvidenceReader } from "./viem-vault-evidence-reader.js";

const FIRST_AMOUNT = "1.25";
const FIRST_AMOUNT_UNITS = 1_250_000n;
const SECOND_AMOUNT = "2";
const BYPASS_WORDING =
  "Local direct-bypass attempt: an attacker directly calls CovenantVault with an agent-signed payment intent redirected to an unauthorized recipient. CovenantVault rejects it before token movement.";

type MutableClock = { value: bigint; now(): bigint };

type ScenarioServices = Readonly<{
  covenant: Readonly<Record<string, unknown>>;
  clock: MutableClock;
  agent: ReturnType<typeof createAgentService>;
  authority: ReturnType<typeof createAuthorityService>;
  executor: ReturnType<typeof createExecutorService>;
  transport: ViemTransactionTransport;
  nextInvoiceId(): Hex;
}>;

type ProtectedState = Readonly<{
  vaultBalance: bigint;
  recipientBalance: bigint;
  attackerBalance: bigint;
  totalSpent: bigint;
  paymentCount: bigint;
  revoked: boolean;
}>;

class LocalReceiptSigner implements ReceiptSigner {
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

function bytes32(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function requireApproved(result: ProcessResult) {
  if (result.status !== "APPROVED") evidenceFailure("STATE_MISMATCH");
  return result;
}

function executorRequest(
  agentResult: AgentProposalResult,
  authorityResult: ProcessResult,
) {
  const approved = requireApproved(authorityResult);
  return Object.freeze({
    signedPaymentIntent: agentResult.signedPaymentIntent,
    ruleResults: approved.ruleResults,
    decisionReceipt: approved.decisionReceipt,
    authorizationReceipt: approved.authorizationReceipt,
  });
}

async function currentTimestamp(publicClient: PublicClient): Promise<bigint> {
  return (await publicClient.getBlock()).timestamp;
}

async function readContract<T>(input: {
  publicClient: PublicClient;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}): Promise<T> {
  try {
    return (await input.publicClient.readContract({
      address: input.address,
      abi: input.abi,
      functionName: input.functionName,
      ...(input.args === undefined ? {} : { args: input.args }),
    })) as T;
  } catch {
    evidenceFailure("STATE_MISMATCH");
  }
}

async function balanceOf(
  publicClient: PublicClient,
  token: Address,
  tokenAbi: Abi,
  owner: Address,
): Promise<bigint> {
  return readContract({
    publicClient,
    address: token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [owner],
  });
}

async function protectedState(input: {
  publicClient: PublicClient;
  deployment: LocalDeployment;
  roles: LocalRoles;
  tokenAbi: Abi;
  vaultAbi: Abi;
}): Promise<ProtectedState> {
  const { publicClient, deployment, roles, tokenAbi, vaultAbi } = input;
  const [
    vaultBalance,
    recipientBalance,
    attackerBalance,
    totalSpent,
    paymentCount,
    revoked,
  ] = await Promise.all([
    balanceOf(publicClient, deployment.token, tokenAbi, deployment.vault),
    balanceOf(publicClient, deployment.token, tokenAbi, roles.recipient),
    balanceOf(publicClient, deployment.token, tokenAbi, roles.attacker.address),
    readContract<bigint>({
      publicClient,
      address: deployment.vault,
      abi: vaultAbi,
      functionName: "totalSpent",
    }),
    readContract<bigint>({
      publicClient,
      address: deployment.vault,
      abi: vaultAbi,
      functionName: "paymentCount",
    }),
    readContract<boolean>({
      publicClient,
      address: deployment.vault,
      abi: vaultAbi,
      functionName: "revoked",
    }),
  ]);
  return Object.freeze({
    vaultBalance,
    recipientBalance,
    attackerBalance,
    totalSpent,
    paymentCount,
    revoked,
  });
}

function requireState(actual: ProtectedState, expected: ProtectedState): void {
  if (
    actual.vaultBalance !== expected.vaultBalance ||
    actual.recipientBalance !== expected.recipientBalance ||
    actual.attackerBalance !== expected.attackerBalance ||
    actual.totalSpent !== expected.totalSpent ||
    actual.paymentCount !== expected.paymentCount ||
    actual.revoked !== expected.revoked
  ) {
    evidenceFailure("STATE_MISMATCH");
  }
}

async function successfulReceipt(input: {
  hash: Hex;
  sender: Address;
  target: Address;
  reader: TransactionReceiptReader;
}): Promise<TransactionReceipt> {
  const expectation: ReceiptExpectation = {
    sender: input.sender,
    target: input.target,
    status: "success",
    value: 0n,
  };
  input.reader.register(input.hash, expectation);
  return input.reader.read(input.hash);
}

async function fundVault(input: {
  publicClient: PublicClient;
  roles: LocalRoles;
  deployment: LocalDeployment;
  tokenAbi: Abi;
  vaultAbi: Abi;
  receiptReader: TransactionReceiptReader;
}): Promise<void> {
  const { publicClient, roles, deployment, tokenAbi, vaultAbi, receiptReader } =
    input;
  const beforeIssuer = await balanceOf(
    publicClient,
    deployment.token,
    tokenAbi,
    roles.issuer.address,
  );
  const beforeVault = await balanceOf(
    publicClient,
    deployment.token,
    tokenAbi,
    deployment.vault,
  );
  const beforeRecipient = await balanceOf(
    publicClient,
    deployment.token,
    tokenAbi,
    roles.recipient,
  );
  try {
    const mintHash = await roles.deployer.walletClient.writeContract({
      account: roles.deployer.address,
      chain: null,
      address: deployment.token,
      abi: tokenAbi,
      functionName: "mint",
      args: [roles.issuer.address, LOCAL_TOTAL_BUDGET],
    });
    await successfulReceipt({
      hash: mintHash,
      sender: roles.deployer.address,
      target: deployment.token,
      reader: receiptReader,
    });
    const approvalHash = await roles.issuer.walletClient.writeContract({
      account: roles.issuer.address,
      chain: null,
      address: deployment.token,
      abi: tokenAbi,
      functionName: "approve",
      args: [deployment.vault, LOCAL_TOTAL_BUDGET],
    });
    await successfulReceipt({
      hash: approvalHash,
      sender: roles.issuer.address,
      target: deployment.token,
      reader: receiptReader,
    });
    const fundHash = await roles.issuer.walletClient.writeContract({
      account: roles.issuer.address,
      chain: null,
      address: deployment.vault,
      abi: vaultAbi,
      functionName: "fund",
      args: [LOCAL_TOTAL_BUDGET],
    });
    const fundReceipt = await successfulReceipt({
      hash: fundHash,
      sender: roles.issuer.address,
      target: deployment.vault,
      reader: receiptReader,
    });
    const funded = eventArgs(
      requireSingleEvent({
        receipt: fundReceipt,
        emitter: deployment.vault,
        abi: vaultAbi,
        eventName: "CovenantFunded",
      }),
    );
    const transfer = eventArgs(
      requireSingleEvent({
        receipt: fundReceipt,
        emitter: deployment.token,
        abi: tokenAbi,
        eventName: "Transfer",
      }),
    );
    if (
      !isAddressEqual(funded.issuer as Address, roles.issuer.address) ||
      funded.amount !== LOCAL_TOTAL_BUDGET ||
      !isAddressEqual(transfer.from as Address, roles.issuer.address) ||
      !isAddressEqual(transfer.to as Address, deployment.vault) ||
      transfer.value !== LOCAL_TOTAL_BUDGET
    ) {
      evidenceFailure("EVENT_MISMATCH");
    }
  } catch (error) {
    throw sanitizedEvidenceError(error);
  }
  const [afterIssuer, afterVault, afterRecipient] = await Promise.all([
    balanceOf(publicClient, deployment.token, tokenAbi, roles.issuer.address),
    balanceOf(publicClient, deployment.token, tokenAbi, deployment.vault),
    balanceOf(publicClient, deployment.token, tokenAbi, roles.recipient),
  ]);
  if (
    beforeIssuer !== 0n ||
    afterIssuer !== 0n ||
    beforeVault !== 0n ||
    afterVault !== LOCAL_TOTAL_BUDGET ||
    afterRecipient !== beforeRecipient
  ) {
    evidenceFailure("BALANCE_MISMATCH");
  }
}

async function createServices(input: {
  publicClient: PublicClient;
  roles: LocalRoles;
  deployment: LocalDeployment;
  vaultAbi: Abi;
}): Promise<ScenarioServices> {
  const { publicClient, roles, deployment, vaultAbi } = input;
  const clock: MutableClock = {
    value: await currentTimestamp(publicClient),
    now() {
      return this.value;
    },
  };
  const covenant = Object.freeze({
    version: "1",
    covenantId: LOCAL_COVENANT_ID,
    issuer: roles.issuer.address,
    agentSigner: roles.agent.address,
    authorizationSigner: roles.authorization.address,
    vaultAddress: deployment.vault,
    chainId: LOCAL_CHAIN_ID_STRING,
    tokenAddress: deployment.token,
    recipientAddress: roles.recipient,
    maxAmountPerPayment: "5000",
    totalBudget: "10000",
    maxPaymentCount: LOCAL_MAX_PAYMENT_COUNT.toString(),
    validAfter: deployment.validAfter.toString(),
    validUntil: deployment.validUntil.toString(),
    purpose: LOCAL_PURPOSE,
    policyHash: LOCAL_POLICY_HASH,
    policyVersion: LOCAL_POLICY_VERSION,
    createdAt: deployment.createdAt.toString(),
  });
  let nextAgentId = 100n;
  const agent = createAgentService({
    clock,
    covenantProvider: { getCovenant: () => Promise.resolve(covenant) },
    signer: {
      address: roles.agent.address,
      signPaymentIntent: (typedData) =>
        roles.agent.signTypedData(
          typedData as Parameters<PrivateKeyAccount["signTypedData"]>[0],
        ),
    },
    identifierGenerator: {
      createId: () => Promise.resolve(bytes32(nextAgentId++)),
    },
    reservationRepository: new InMemoryProposalReservationRepository(),
    approvedVendor: roles.vendor.address,
    approvedProductId: LOCAL_PRODUCT_ID,
    intentTtlSeconds: PAYMENT_INTENT_TTL_SECONDS,
  });
  let nextAuthorityId = 200n;
  const evidenceReader = new ViemVaultEvidenceReader({
    publicClient,
    vault: deployment.vault,
    abi: vaultAbi,
  });
  const authority = createAuthorityService({
    clock,
    covenantProvider: { getCovenant: () => Promise.resolve(covenant) },
    evidenceReader,
    identifierGenerator: {
      createId: () => Promise.resolve(bytes32(nextAuthorityId++)),
    },
    signer: new LocalReceiptSigner(roles.authorization),
    approvedVendor: roles.vendor.address,
    approvedProductId: LOCAL_PRODUCT_ID,
  });
  const transport = new ViemTransactionTransport({
    publicClient,
    walletClient: roles.payer.walletClient,
    payer: roles.payer.address,
    vault: deployment.vault,
  });
  const executor = createExecutorService({
    clock,
    covenantProvider: { getCovenant: () => Promise.resolve(covenant) },
    transport,
  });
  let nextInvoice = 300n;
  return Object.freeze({
    covenant,
    clock,
    agent,
    authority,
    executor,
    transport,
    nextInvoiceId: () => bytes32(nextInvoice++),
  });
}

async function createApprovedPayment(input: {
  publicClient: PublicClient;
  roles: LocalRoles;
  services: ScenarioServices;
  amount: string;
  nonce: bigint;
}): Promise<
  Readonly<{
    agentResult: AgentProposalResult;
    authorityResult: ReturnType<typeof requireApproved>;
    request: ReturnType<typeof executorRequest>;
  }>
> {
  const { publicClient, roles, services, amount, nonce } = input;
  services.clock.value = await currentTimestamp(publicClient);
  const recipient = services.covenant.recipientAddress;
  const token = services.covenant.tokenAddress;
  if (typeof recipient !== "string" || typeof token !== "string") {
    evidenceFailure("STATE_MISMATCH");
  }
  const invoice: RawInvoicePayload = Object.freeze({
    version: "1",
    invoiceId: services.nextInvoiceId(),
    vendor: roles.vendor.address,
    recipient,
    token,
    amount,
    productId: LOCAL_PRODUCT_ID,
    purpose: LOCAL_PURPOSE,
    issuedAt: (services.clock.value - 2n).toString(),
    expiresAt: (services.clock.value + 300n).toString(),
    nonce: nonce.toString(),
  });
  const domain = deriveSigningDomainForCovenant(
    services.covenant,
    EIP712_DOMAIN_NAMES.invoice,
  );
  const signedInvoice = Object.freeze({
    payload: invoice,
    signature: await roles.vendor.signTypedData(
      buildInvoiceTypedData(invoice, domain),
    ),
  });
  const agentResult = await services.agent.proposePayment({
    signedInvoice,
    procurementRequest: {
      productId: LOCAL_PRODUCT_ID,
      expectedAmount: amount,
    },
  });
  services.clock.value = await currentTimestamp(publicClient);
  const authorityResult = requireApproved(
    await services.authority.processPaymentRequest(agentResult),
  );
  return Object.freeze({
    agentResult,
    authorityResult,
    request: executorRequest(agentResult, authorityResult),
  });
}

function paymentTuple(payload: ReturnType<typeof paymentIntentSchema.parse>) {
  return {
    version: payload.version,
    intentId: payload.intentId,
    covenantId: payload.covenantId,
    agentSigner: payload.agentSigner,
    recipient: payload.recipient,
    token: payload.token,
    amount: payload.amount,
    invoiceHash: payload.invoiceHash,
    purpose: payload.purpose,
    createdAt: payload.createdAt,
    expiresAt: payload.expiresAt,
    nonce: payload.nonce,
  };
}

function authorizationTuple(
  payload: ReturnType<typeof authorizationReceiptSchema.parse>,
) {
  return {
    version: payload.version,
    authorizationId: payload.authorizationId,
    decisionId: payload.decisionId,
    covenantId: payload.covenantId,
    intentHash: payload.intentHash,
    vaultAddress: payload.vaultAddress,
    chainId: payload.chainId,
    policyVersion: payload.policyVersion,
    authorizationNonce: payload.authorizationNonce,
    validUntil: payload.validUntil,
    signer: payload.signer,
  };
}

async function maliciousBypassCalldata(input: {
  roles: LocalRoles;
  services: ScenarioServices;
  deployment: LocalDeployment;
  vaultAbi: Abi;
  first: Awaited<ReturnType<typeof createApprovedPayment>>;
  kind?: "WRONG_RECIPIENT" | "EXCESSIVE_AMOUNT";
}): Promise<Hex> {
  const { roles, services, deployment, vaultAbi, first } = input;
  const now = services.clock.value;
  const wrongRecipient = input.kind !== "EXCESSIVE_AMOUNT";
  const recipient = wrongRecipient ? roles.attacker.address : roles.recipient;
  const amount = wrongRecipient ? FIRST_AMOUNT : "5000.000001";
  const invoice: RawInvoicePayload = {
    version: "1",
    invoiceId: bytes32(900n),
    vendor: roles.vendor.address,
    recipient,
    token: deployment.token,
    amount,
    productId: LOCAL_PRODUCT_ID,
    purpose: LOCAL_PURPOSE,
    issuedAt: (now - 2n).toString(),
    expiresAt: (now + 300n).toString(),
    nonce: "900",
  };
  const invoiceDomain = deriveSigningDomainForCovenant(
    services.covenant,
    EIP712_DOMAIN_NAMES.invoice,
  );
  const intent = {
    version: "1",
    intentId: bytes32(901n),
    covenantId: LOCAL_COVENANT_ID,
    agentSigner: roles.agent.address,
    recipient,
    token: deployment.token,
    amount,
    invoiceHash: hashInvoice(invoice, invoiceDomain),
    purpose: LOCAL_PURPOSE,
    createdAt: (now - 1n).toString(),
    expiresAt: (now + 300n).toString(),
    nonce: "901",
  } as const;
  const intentDomain = deriveSigningDomainForCovenant(
    services.covenant,
    EIP712_DOMAIN_NAMES.paymentIntent,
  );
  const signature = await roles.agent.signTypedData(
    buildPaymentIntentTypedData(intent, intentDomain),
  );
  const authorization = first.authorityResult.authorizationReceipt;
  return encodeFunctionData({
    abi: vaultAbi,
    functionName: "executePayment",
    args: [
      paymentTuple(paymentIntentSchema.parse(intent)),
      signature,
      authorizationTuple(
        authorizationReceiptSchema.parse(authorization.payload),
      ),
      authorization.signature,
    ],
  });
}

export async function runInvalidIntentClassification(
  kind: "WRONG_RECIPIENT" | "EXCESSIVE_AMOUNT",
): Promise<void> {
  const anvil = await startControlledAnvil();
  try {
    const artifacts = loadContractArtifacts();
    const roles = await createLocalRoles(anvil.publicClient, anvil.rpcUrl);
    const receiptReader = new TransactionReceiptReader(anvil.publicClient);
    const deployment = await deployLocalCovenant({
      publicClient: anvil.publicClient,
      roles,
      tokenArtifact: artifacts.mockUsdc,
      vaultArtifact: artifacts.covenantVault,
    });
    await fundVault({
      publicClient: anvil.publicClient,
      roles,
      deployment,
      tokenAbi: artifacts.mockUsdc.abi,
      vaultAbi: artifacts.covenantVault.abi,
      receiptReader,
    });
    const services = await createServices({
      publicClient: anvil.publicClient,
      roles,
      deployment,
      vaultAbi: artifacts.covenantVault.abi,
    });
    const first = await createApprovedPayment({
      publicClient: anvil.publicClient,
      roles,
      services,
      amount: FIRST_AMOUNT,
      nonce: 1n,
    });
    services.clock.value = await currentTimestamp(anvil.publicClient);
    const data = await maliciousBypassCalldata({
      roles,
      services,
      deployment,
      vaultAbi: artifacts.covenantVault.abi,
      first,
      kind,
    });
    const before = await protectedState({
      publicClient: anvil.publicClient,
      deployment,
      roles,
      tokenAbi: artifacts.mockUsdc.abi,
      vaultAbi: artifacts.covenantVault.abi,
    });
    const receipt = await submitExpectedRevert({
      publicClient: anvil.publicClient,
      walletClient: roles.attacker.walletClient,
      sender: roles.attacker.address,
      target: deployment.vault,
      data,
      abi: artifacts.covenantVault.abi,
      errorName: "InvalidPaymentIntent",
      receiptReader,
    });
    requireNoEvent({
      receipt,
      emitter: deployment.token,
      abi: artifacts.mockUsdc.abi,
      eventName: "Transfer",
    });
    requireState(
      await protectedState({
        publicClient: anvil.publicClient,
        deployment,
        roles,
        tokenAbi: artifacts.mockUsdc.abi,
        vaultAbi: artifacts.covenantVault.abi,
      }),
      before,
    );
  } catch (error) {
    throw sanitizedEvidenceError(error);
  } finally {
    await anvil.stop();
  }
}

async function requireFirstExecutionEvidence(input: {
  publicClient: PublicClient;
  roles: LocalRoles;
  deployment: LocalDeployment;
  tokenAbi: Abi;
  vaultAbi: Abi;
  receipt: TransactionReceipt;
  first: Awaited<ReturnType<typeof createApprovedPayment>>;
  before: ProtectedState;
}): Promise<void> {
  const {
    publicClient,
    roles,
    deployment,
    tokenAbi,
    vaultAbi,
    receipt,
    first,
  } = input;
  const after = await protectedState({
    publicClient,
    deployment,
    roles,
    tokenAbi,
    vaultAbi,
  });
  if (
    after.recipientBalance - input.before.recipientBalance !==
      FIRST_AMOUNT_UNITS ||
    input.before.vaultBalance - after.vaultBalance !== FIRST_AMOUNT_UNITS ||
    after.attackerBalance !== input.before.attackerBalance ||
    after.totalSpent !== FIRST_AMOUNT_UNITS ||
    after.paymentCount !== 1n ||
    after.revoked
  ) {
    evidenceFailure("BALANCE_MISMATCH");
  }
  const authorization = first.authorityResult.authorizationReceipt.payload;
  const intent = first.agentResult.signedPaymentIntent.payload;
  const paymentEvent = eventArgs(
    requireSingleEvent({
      receipt,
      emitter: deployment.vault,
      abi: vaultAbi,
      eventName: "PaymentExecuted",
    }),
  );
  const transferEvent = eventArgs(
    requireSingleEvent({
      receipt,
      emitter: deployment.token,
      abi: tokenAbi,
      eventName: "Transfer",
    }),
  );
  if (
    paymentEvent.covenantId !== LOCAL_COVENANT_ID ||
    paymentEvent.intentId !== intent.intentId ||
    paymentEvent.intentHash !== authorization.intentHash ||
    paymentEvent.authorizationId !== authorization.authorizationId ||
    paymentEvent.decisionId !== authorization.decisionId ||
    paymentEvent.authorizationNonce !==
      BigInt(authorization.authorizationNonce) ||
    !isAddressEqual(paymentEvent.recipient as Address, roles.recipient) ||
    paymentEvent.amount !== FIRST_AMOUNT_UNITS ||
    paymentEvent.totalSpent !== FIRST_AMOUNT_UNITS ||
    paymentEvent.paymentCount !== 1n ||
    !isAddressEqual(transferEvent.from as Address, deployment.vault) ||
    !isAddressEqual(transferEvent.to as Address, roles.recipient) ||
    transferEvent.value !== FIRST_AMOUNT_UNITS
  ) {
    evidenceFailure("EVENT_MISMATCH");
  }
  const replayValues = await Promise.all([
    readContract<boolean>({
      publicClient,
      address: deployment.vault,
      abi: vaultAbi,
      functionName: "usedIntentHashes",
      args: [authorization.intentHash],
    }),
    readContract<boolean>({
      publicClient,
      address: deployment.vault,
      abi: vaultAbi,
      functionName: "usedIntentIds",
      args: [intent.intentId],
    }),
    readContract<boolean>({
      publicClient,
      address: deployment.vault,
      abi: vaultAbi,
      functionName: "usedAgentNonces",
      args: [BigInt(intent.nonce)],
    }),
    readContract<boolean>({
      publicClient,
      address: deployment.vault,
      abi: vaultAbi,
      functionName: "usedAuthorizationIds",
      args: [authorization.authorizationId],
    }),
    readContract<boolean>({
      publicClient,
      address: deployment.vault,
      abi: vaultAbi,
      functionName: "usedAuthorizationNonces",
      args: [BigInt(authorization.authorizationNonce)],
    }),
  ]);
  if (replayValues.some((value) => !value)) {
    evidenceFailure("STATE_MISMATCH");
  }
}

export async function runLocalVaultScenario(): Promise<LocalEvidenceResult> {
  const anvil = await startControlledAnvil();
  let submittedTransactions = 0n;
  let successfulReceipts = 0n;
  let revertedReceipts = 0n;
  try {
    const artifacts = loadContractArtifacts();
    const roles = await createLocalRoles(anvil.publicClient, anvil.rpcUrl);
    const receiptReader = new TransactionReceiptReader(anvil.publicClient);
    const deployment = await deployLocalCovenant({
      publicClient: anvil.publicClient,
      roles,
      tokenArtifact: artifacts.mockUsdc,
      vaultArtifact: artifacts.covenantVault,
    });
    submittedTransactions += 2n;
    successfulReceipts += 2n;

    await fundVault({
      publicClient: anvil.publicClient,
      roles,
      deployment,
      tokenAbi: artifacts.mockUsdc.abi,
      vaultAbi: artifacts.covenantVault.abi,
      receiptReader,
    });
    submittedTransactions += 3n;
    successfulReceipts += 3n;

    const services = await createServices({
      publicClient: anvil.publicClient,
      roles,
      deployment,
      vaultAbi: artifacts.covenantVault.abi,
    });
    const first = await createApprovedPayment({
      publicClient: anvil.publicClient,
      roles,
      services,
      amount: FIRST_AMOUNT,
      nonce: 1n,
    });
    services.clock.value = await currentTimestamp(anvil.publicClient);
    const preparedFirst = await services.executor.prepareExecution(
      first.request,
    );
    await services.executor.simulateAuthorizedPayment(first.request);
    const beforeFirst = await protectedState({
      publicClient: anvil.publicClient,
      deployment,
      roles,
      tokenAbi: artifacts.mockUsdc.abi,
      vaultAbi: artifacts.covenantVault.abi,
    });
    const execution = await services.executor.executeAuthorizedPayment(
      first.request,
    );
    if (
      !services.transport.submittedHashes.has(execution.transactionId as Hex) ||
      preparedFirst.data !== execution.execution.data
    ) {
      evidenceFailure("SUBMISSION_FAILURE");
    }
    receiptReader.register(execution.transactionId as Hex, {
      sender: roles.payer.address,
      target: deployment.vault,
      status: "success",
      value: 0n,
    });
    submittedTransactions += 1n;
    const successfulExecutionReceipt = await receiptReader.read(
      execution.transactionId,
    );
    successfulReceipts += 1n;
    await requireFirstExecutionEvidence({
      publicClient: anvil.publicClient,
      roles,
      deployment,
      tokenAbi: artifacts.mockUsdc.abi,
      vaultAbi: artifacts.covenantVault.abi,
      receipt: successfulExecutionReceipt,
      first,
      before: beforeFirst,
    });
    const afterFirst = await protectedState({
      publicClient: anvil.publicClient,
      deployment,
      roles,
      tokenAbi: artifacts.mockUsdc.abi,
      vaultAbi: artifacts.covenantVault.abi,
    });

    const replayReceipt = await submitExpectedRevert({
      publicClient: anvil.publicClient,
      walletClient: roles.payer.walletClient,
      sender: roles.payer.address,
      target: deployment.vault,
      data: preparedFirst.data,
      abi: artifacts.covenantVault.abi,
      errorName: "ReplayDetected",
      receiptReader,
    });
    submittedTransactions += 1n;
    revertedReceipts += 1n;
    requireNoEvent({
      receipt: replayReceipt,
      emitter: deployment.vault,
      abi: artifacts.covenantVault.abi,
      eventName: "PaymentExecuted",
    });
    requireState(
      await protectedState({
        publicClient: anvil.publicClient,
        deployment,
        roles,
        tokenAbi: artifacts.mockUsdc.abi,
        vaultAbi: artifacts.covenantVault.abi,
      }),
      afterFirst,
    );

    services.clock.value = await currentTimestamp(anvil.publicClient);
    const bypassData = await maliciousBypassCalldata({
      roles,
      services,
      deployment,
      vaultAbi: artifacts.covenantVault.abi,
      first,
    });
    const bypassReceipt = await submitExpectedRevert({
      publicClient: anvil.publicClient,
      walletClient: roles.attacker.walletClient,
      sender: roles.attacker.address,
      target: deployment.vault,
      data: bypassData,
      abi: artifacts.covenantVault.abi,
      errorName: "InvalidPaymentIntent",
      receiptReader,
    });
    submittedTransactions += 1n;
    revertedReceipts += 1n;
    requireNoEvent({
      receipt: bypassReceipt,
      emitter: deployment.token,
      abi: artifacts.mockUsdc.abi,
      eventName: "Transfer",
    });
    requireState(
      await protectedState({
        publicClient: anvil.publicClient,
        deployment,
        roles,
        tokenAbi: artifacts.mockUsdc.abi,
        vaultAbi: artifacts.covenantVault.abi,
      }),
      afterFirst,
    );
    if (!BYPASS_WORDING.startsWith("Local direct-bypass attempt:")) {
      evidenceFailure("STATE_MISMATCH");
    }

    const revokeData = encodeFunctionData({
      abi: artifacts.covenantVault.abi,
      functionName: "revoke",
    });
    await submitExpectedRevert({
      publicClient: anvil.publicClient,
      walletClient: roles.attacker.walletClient,
      sender: roles.attacker.address,
      target: deployment.vault,
      data: revokeData,
      abi: artifacts.covenantVault.abi,
      errorName: "UnauthorizedCaller",
      receiptReader,
    });
    submittedTransactions += 1n;
    revertedReceipts += 1n;
    requireState(
      await protectedState({
        publicClient: anvil.publicClient,
        deployment,
        roles,
        tokenAbi: artifacts.mockUsdc.abi,
        vaultAbi: artifacts.covenantVault.abi,
      }),
      afterFirst,
    );

    const second = await createApprovedPayment({
      publicClient: anvil.publicClient,
      roles,
      services,
      amount: SECOND_AMOUNT,
      nonce: 2n,
    });
    services.clock.value = await currentTimestamp(anvil.publicClient);
    const preparedSecond = await services.executor.prepareExecution(
      second.request,
    );
    const secondAuthorization =
      second.authorityResult.authorizationReceipt.payload;
    const beforeSecondMappings = await Promise.all([
      readContract<boolean>({
        publicClient: anvil.publicClient,
        address: deployment.vault,
        abi: artifacts.covenantVault.abi,
        functionName: "usedIntentHashes",
        args: [secondAuthorization.intentHash],
      }),
      readContract<boolean>({
        publicClient: anvil.publicClient,
        address: deployment.vault,
        abi: artifacts.covenantVault.abi,
        functionName: "usedAuthorizationNonces",
        args: [BigInt(secondAuthorization.authorizationNonce)],
      }),
    ]);
    if (beforeSecondMappings.some(Boolean)) evidenceFailure("STATE_MISMATCH");

    let revokeHash: Hex;
    try {
      revokeHash = await roles.issuer.walletClient.sendTransaction({
        account: roles.issuer.address,
        chain: null,
        to: deployment.vault,
        data: revokeData,
        value: 0n,
      });
    } catch {
      evidenceFailure("SUBMISSION_FAILURE");
    }
    const revokeReceipt = await successfulReceipt({
      hash: revokeHash,
      sender: roles.issuer.address,
      target: deployment.vault,
      reader: receiptReader,
    });
    submittedTransactions += 1n;
    successfulReceipts += 1n;
    const revokedEvent = eventArgs(
      requireSingleEvent({
        receipt: revokeReceipt,
        emitter: deployment.vault,
        abi: artifacts.covenantVault.abi,
        eventName: "CovenantRevoked",
      }),
    );
    if (!isAddressEqual(revokedEvent.issuer as Address, roles.issuer.address)) {
      evidenceFailure("EVENT_MISMATCH");
    }
    const afterRevocation = await protectedState({
      publicClient: anvil.publicClient,
      deployment,
      roles,
      tokenAbi: artifacts.mockUsdc.abi,
      vaultAbi: artifacts.covenantVault.abi,
    });
    if (!afterRevocation.revoked) evidenceFailure("STATE_MISMATCH");

    await submitExpectedRevert({
      publicClient: anvil.publicClient,
      walletClient: roles.payer.walletClient,
      sender: roles.payer.address,
      target: deployment.vault,
      data: preparedSecond.data,
      abi: artifacts.covenantVault.abi,
      errorName: "CovenantIsRevoked",
      receiptReader,
    });
    submittedTransactions += 1n;
    revertedReceipts += 1n;
    requireState(
      await protectedState({
        publicClient: anvil.publicClient,
        deployment,
        roles,
        tokenAbi: artifacts.mockUsdc.abi,
        vaultAbi: artifacts.covenantVault.abi,
      }),
      afterRevocation,
    );
    const afterSecondMappings = await Promise.all([
      readContract<boolean>({
        publicClient: anvil.publicClient,
        address: deployment.vault,
        abi: artifacts.covenantVault.abi,
        functionName: "usedIntentHashes",
        args: [secondAuthorization.intentHash],
      }),
      readContract<boolean>({
        publicClient: anvil.publicClient,
        address: deployment.vault,
        abi: artifacts.covenantVault.abi,
        functionName: "usedAuthorizationNonces",
        args: [BigInt(secondAuthorization.authorizationNonce)],
      }),
    ]);
    if (afterSecondMappings.some(Boolean)) evidenceFailure("STATE_MISMATCH");
    if (
      afterRevocation.totalSpent !== FIRST_AMOUNT_UNITS ||
      afterRevocation.paymentCount !== 1n
    ) {
      evidenceFailure("STATE_MISMATCH");
    }

    const result = {
      schemaVersion: "1",
      mode: "LOCAL_ANVIL",
      chainId: LOCAL_CHAIN_ID_STRING,
      status: "VERIFIED",
      evidence: LOCAL_EVIDENCE_TYPES.map((type) => ({
        type,
        status: "PASS" as const,
      })),
      counts: {
        submittedTransactions: submittedTransactions.toString(),
        successfulReceipts: successfulReceipts.toString(),
        revertedReceipts: revertedReceipts.toString(),
      },
    } as const;
    return localEvidenceResultSchema.parse(result);
  } catch (error) {
    throw sanitizedEvidenceError(error);
  } finally {
    await anvil.stop();
  }
}
