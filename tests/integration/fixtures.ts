import {
  InMemoryProposalReservationRepository,
  PAYMENT_INTENT_TTL_SECONDS,
  createAgentService,
  type AgentProposalResult,
  type AgentService,
  type RawInvoicePayload,
  type RawPaymentIntentPayload,
  type RawSignedInvoice,
} from "@covenant/agent";
import {
  createAuthorityService,
  type AuthorityService,
  type EvidenceSnapshot,
  type ReceiptSigner,
} from "@covenant/authority";
import {
  createExecutorService,
  type ExecutorService,
} from "@covenant/executor";
import {
  EIP712_DOMAIN_NAMES,
  buildInvoiceTypedData,
  buildPaymentIntentTypedData,
  deriveSigningDomainForCovenant,
  hashInvoice,
} from "@covenant/spec";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem/accounts";
import { DeterministicTransactionTransport } from "./deterministic-transaction-transport.js";

export const INTEGRATION_NOW = 2_100_000_000n;
export const EXPECTED_AMOUNT = 1_250_000n;

class TestReceiptSigner implements ReceiptSigner {
  readonly #account: PrivateKeyAccount;

  constructor(account: PrivateKeyAccount) {
    this.#account = account;
  }

  get address(): string {
    return this.#account.address;
  }

  signDecisionReceipt(typedData: unknown): Promise<unknown> {
    return this.#account.signTypedData(
      typedData as Parameters<PrivateKeyAccount["signTypedData"]>[0],
    );
  }

  signAuthorizationReceipt(typedData: unknown): Promise<unknown> {
    return this.#account.signTypedData(
      typedData as Parameters<PrivateKeyAccount["signTypedData"]>[0],
    );
  }
}

export type IntegrationFixture = Readonly<{
  agent: AgentService;
  authority: AuthorityService;
  executor: ExecutorService;
  transport: DeterministicTransactionTransport;
  covenant: Readonly<Record<string, unknown>>;
  invoice: RawInvoicePayload;
  signedInvoice: RawSignedInvoice;
  expectedAmount: string;
  expectedAmountBaseUnits: bigint;
  addresses: Readonly<{
    issuer: string;
    agent: string;
    authorization: string;
    vendor: string;
    attacker: string;
    recipient: string;
    token: string;
    vault: string;
  }>;
  compromisedProposer: Readonly<{
    createPaymentRequest(input: {
      recipient: string;
      amount: string;
    }): Promise<AgentProposalResult>;
  }>;
}>;

function bytes32(value: bigint): `0x${string}` {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

export async function createIntegrationFixture(): Promise<IntegrationFixture> {
  const issuerAccount = privateKeyToAccount(generatePrivateKey());
  const agentAccount = privateKeyToAccount(generatePrivateKey());
  const authorizationAccount = privateKeyToAccount(generatePrivateKey());
  const vendorAccount = privateKeyToAccount(generatePrivateKey());
  const attackerAccount = privateKeyToAccount(generatePrivateKey());
  const addresses = Object.freeze({
    issuer: issuerAccount.address,
    agent: agentAccount.address,
    authorization: authorizationAccount.address,
    vendor: vendorAccount.address,
    attacker: attackerAccount.address,
    recipient: "0x6000000000000000000000000000000000000006",
    token: "0x5000000000000000000000000000000000000005",
    vault: "0x4000000000000000000000000000000000000004",
  });
  const covenant = Object.freeze({
    version: "1",
    covenantId: bytes32(1n),
    issuer: addresses.issuer,
    agentSigner: addresses.agent,
    authorizationSigner: addresses.authorization,
    vaultAddress: addresses.vault,
    chainId: "5042002",
    tokenAddress: addresses.token,
    recipientAddress: addresses.recipient,
    maxAmountPerPayment: "5000",
    totalBudget: "10000",
    maxPaymentCount: "2",
    validAfter: (INTEGRATION_NOW - 100n).toString(),
    validUntil: (INTEGRATION_NOW + 1_000n).toString(),
    purpose: "Purchase approved GPU compute",
    policyHash: bytes32(2n),
    policyVersion: "gpu-policy-1",
    createdAt: (INTEGRATION_NOW - 200n).toString(),
  });

  function invoiceDomain() {
    return deriveSigningDomainForCovenant(
      covenant,
      EIP712_DOMAIN_NAMES.invoice,
    );
  }

  function paymentIntentDomain() {
    return deriveSigningDomainForCovenant(
      covenant,
      EIP712_DOMAIN_NAMES.paymentIntent,
    );
  }

  async function signInvoice(
    payload: RawInvoicePayload,
  ): Promise<RawSignedInvoice> {
    return Object.freeze({
      payload,
      signature: await vendorAccount.signTypedData(
        buildInvoiceTypedData(payload, invoiceDomain()),
      ),
    });
  }

  const invoice: RawInvoicePayload = Object.freeze({
    version: "1",
    invoiceId: bytes32(3n),
    vendor: addresses.vendor,
    recipient: addresses.recipient,
    token: addresses.token,
    amount: "1.25",
    productId: "gpu-h100-hour",
    purpose: covenant.purpose,
    issuedAt: (INTEGRATION_NOW - 20n).toString(),
    expiresAt: (INTEGRATION_NOW + 500n).toString(),
    nonce: "1",
  });
  const signedInvoice = await signInvoice(invoice);
  let nextAgentIdentifier = 10n;
  const agent = createAgentService({
    clock: { now: () => INTEGRATION_NOW },
    covenantProvider: { getCovenant: () => Promise.resolve(covenant) },
    signer: {
      address: addresses.agent,
      signPaymentIntent: (typedData) =>
        agentAccount.signTypedData(
          typedData as Parameters<PrivateKeyAccount["signTypedData"]>[0],
        ),
    },
    identifierGenerator: {
      createId: () => {
        const identifier = bytes32(nextAgentIdentifier);
        nextAgentIdentifier += 1n;
        return Promise.resolve(identifier);
      },
    },
    reservationRepository: new InMemoryProposalReservationRepository(),
    approvedVendor: addresses.vendor,
    approvedProductId: "gpu-h100-hour",
    intentTtlSeconds: PAYMENT_INTENT_TTL_SECONDS,
  });

  const evidence: EvidenceSnapshot = {
    chainId: 5_042_002n,
    vaultAddress: addresses.vault,
    observedAt: INTEGRATION_NOW,
    revoked: false,
    totalSpent: 0n,
    paymentCount: 0n,
    usedIntentHash: false,
    usedIntentId: false,
    usedAgentNonce: false,
  };
  let nextAuthorityIdentifier = 100n;
  const authority = createAuthorityService({
    clock: { now: () => INTEGRATION_NOW },
    covenantProvider: { getCovenant: () => Promise.resolve(covenant) },
    evidenceReader: {
      readEvidence: () => Promise.resolve({ ...evidence }),
      isAuthorizationNonceUsed: () => Promise.resolve(false),
    },
    identifierGenerator: {
      createId: () => {
        const identifier = bytes32(nextAuthorityIdentifier);
        nextAuthorityIdentifier += 1n;
        return Promise.resolve(identifier);
      },
    },
    signer: new TestReceiptSigner(authorizationAccount),
    approvedVendor: addresses.vendor,
    approvedProductId: "gpu-h100-hour",
  });

  const transport = new DeterministicTransactionTransport();
  const executor = createExecutorService({
    clock: { now: () => INTEGRATION_NOW },
    covenantProvider: { getCovenant: () => Promise.resolve(covenant) },
    transport,
  });

  const compromisedProposer = Object.freeze({
    async createPaymentRequest(input: { recipient: string; amount: string }) {
      const maliciousInvoice: RawInvoicePayload = Object.freeze({
        ...invoice,
        invoiceId: bytes32(input.recipient === addresses.attacker ? 20n : 21n),
        recipient: input.recipient,
        amount: input.amount,
        nonce: input.recipient === addresses.attacker ? "20" : "21",
      });
      const maliciousSignedInvoice = await signInvoice(maliciousInvoice);
      const payload: RawPaymentIntentPayload = Object.freeze({
        version: "1",
        intentId: bytes32(input.recipient === addresses.attacker ? 30n : 31n),
        covenantId: covenant.covenantId,
        agentSigner: addresses.agent,
        recipient: input.recipient,
        token: addresses.token,
        amount: input.amount,
        invoiceHash: hashInvoice(maliciousInvoice, invoiceDomain()),
        purpose: covenant.purpose,
        createdAt: (INTEGRATION_NOW - 10n).toString(),
        expiresAt: (INTEGRATION_NOW + 300n).toString(),
        nonce: input.recipient === addresses.attacker ? "30" : "31",
      });
      const signature = await agentAccount.signTypedData(
        buildPaymentIntentTypedData(payload, paymentIntentDomain()),
      );
      return Object.freeze({
        signedPaymentIntent: Object.freeze({ payload, signature }),
        signedInvoice: maliciousSignedInvoice,
      });
    },
  });

  return Object.freeze({
    agent,
    authority,
    executor,
    transport,
    covenant,
    invoice,
    signedInvoice,
    expectedAmount: "1.25",
    expectedAmountBaseUnits: EXPECTED_AMOUNT,
    addresses,
    compromisedProposer,
  });
}
