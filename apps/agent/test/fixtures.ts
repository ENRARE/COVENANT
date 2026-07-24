import {
  EIP712_DOMAIN_NAMES,
  buildInvoiceTypedData,
  deriveSigningDomainForCovenant,
} from "@covenant/spec";
import {
  generatePrivateKey,
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";
import { expect } from "vitest";
import {
  createAgentService,
  InMemoryProposalReservationRepository,
  type AgentDependencies,
  type AgentService,
  type PaymentIntentSigner,
  type ProposalReservationRepository,
} from "../src/index.js";

export const TEST_NOW = 2_000_000_000n;

export class CountingReservationRepository implements ProposalReservationRepository {
  readonly delegate = new InMemoryProposalReservationRepository();
  getCalls = 0;
  reserveCalls = 0;
  completionCalls = 0;

  get(identity: string): Promise<unknown> {
    this.getCalls += 1;
    return this.delegate.get(identity);
  }

  reserve(
    identity: string,
    createReservation: Parameters<ProposalReservationRepository["reserve"]>[1],
  ): Promise<unknown> {
    this.reserveCalls += 1;
    return this.delegate.reserve(identity, createReservation);
  }

  storeCompleted(
    identity: string,
    result: Parameters<ProposalReservationRepository["storeCompleted"]>[1],
  ): Promise<unknown> {
    this.completionCalls += 1;
    return this.delegate.storeCompleted(identity, result);
  }
}

export class TestPaymentIntentSigner implements PaymentIntentSigner {
  calls = 0;
  typedData: unknown[] = [];
  failure: unknown;
  output: unknown;

  constructor(readonly account: PrivateKeyAccount) {}

  get address(): unknown {
    return this.account.address;
  }

  async signPaymentIntent(typedData: unknown): Promise<unknown> {
    this.calls += 1;
    this.typedData.push(typedData);
    if (this.failure !== undefined) {
      throw this.failure instanceof Error
        ? this.failure
        : new Error("Test signer failure");
    }
    if (this.output !== undefined) return this.output;
    return this.account.signTypedData(
      typedData as Parameters<PrivateKeyAccount["signTypedData"]>[0],
    );
  }
}

export type AgentHarness = Awaited<ReturnType<typeof createAgentHarness>>;

export async function createAgentHarness(overrides?: {
  covenant?: Record<string, unknown>;
  clock?: { value: bigint; now(): unknown };
  reservationRepository?: ProposalReservationRepository;
  proposalRepository?: AgentDependencies["proposalRepository"];
  approvedVendor?: unknown;
  approvedProductId?: unknown;
  intentTtlSeconds?: unknown;
  signer?: PaymentIntentSigner;
  identifierGenerator?: AgentDependencies["identifierGenerator"];
}) {
  const issuer = privateKeyToAccount(generatePrivateKey());
  const agentAccount = privateKeyToAccount(generatePrivateKey());
  const authorizationAccount = privateKeyToAccount(generatePrivateKey());
  const vendorAccount = privateKeyToAccount(generatePrivateKey());
  const attackerAccount = privateKeyToAccount(generatePrivateKey());
  const baseCovenant: Record<string, unknown> = {
    version: "1",
    covenantId: `0x${"31".repeat(32)}`,
    issuer: issuer.address,
    agentSigner: agentAccount.address,
    authorizationSigner: authorizationAccount.address,
    vaultAddress: "0x4000000000000000000000000000000000000004",
    chainId: "5042002",
    tokenAddress: "0x5000000000000000000000000000000000000005",
    recipientAddress: "0x6000000000000000000000000000000000000006",
    maxAmountPerPayment: "5000",
    totalBudget: "10000",
    maxPaymentCount: "2",
    validAfter: (TEST_NOW - 100n).toString(),
    validUntil: (TEST_NOW + 2_000n).toString(),
    purpose: "Purchase approved GPU compute",
    policyHash: `0x${"32".repeat(32)}`,
    policyVersion: "gpu-policy-1",
    createdAt: (TEST_NOW - 200n).toString(),
  };
  const covenant = { ...baseCovenant, ...overrides?.covenant };
  const invoice: Record<string, unknown> = {
    version: "1",
    invoiceId: `0x${"33".repeat(32)}`,
    vendor: vendorAccount.address,
    recipient: covenant.recipientAddress,
    token: covenant.tokenAddress,
    amount: "1.25",
    productId: "gpu-h100-hour",
    purpose: covenant.purpose,
    issuedAt: (TEST_NOW - 20n).toString(),
    expiresAt: (TEST_NOW + 1_000n).toString(),
    nonce: "1",
  };
  const clock = overrides?.clock ?? {
    value: TEST_NOW,
    now() {
      return this.value;
    },
  };
  const signer = overrides?.signer ?? new TestPaymentIntentSigner(agentAccount);
  const reservationRepository =
    overrides?.reservationRepository ?? new CountingReservationRepository();
  let covenantCalls = 0;
  let clockCalls = 0;
  let identifierCalls = 0;
  const identifierContexts: string[] = [];
  const identifierGenerator = overrides?.identifierGenerator ?? {
    createId(identity: string) {
      identifierCalls += 1;
      identifierContexts.push(identity);
      return Promise.resolve(`0x${"34".repeat(32)}`);
    },
  };
  const dependencies: AgentDependencies = {
    clock: {
      now() {
        clockCalls += 1;
        return clock.now();
      },
    },
    covenantProvider: {
      getCovenant() {
        covenantCalls += 1;
        return Promise.resolve(covenant);
      },
    },
    signer,
    identifierGenerator,
    reservationRepository,
    approvedVendor: overrides?.approvedVendor ?? vendorAccount.address,
    approvedProductId: overrides?.approvedProductId ?? "gpu-h100-hour",
    intentTtlSeconds: overrides?.intentTtlSeconds ?? 600n,
    ...(overrides?.proposalRepository === undefined
      ? {}
      : { proposalRepository: overrides.proposalRepository }),
  };

  function invoiceDomain(targetCovenant = covenant) {
    return deriveSigningDomainForCovenant(
      targetCovenant,
      EIP712_DOMAIN_NAMES.invoice,
    );
  }

  async function signInvoice(
    payload: Record<string, unknown>,
    account: PrivateKeyAccount = vendorAccount,
    domainCovenant: Record<string, unknown> = covenant,
  ) {
    return {
      payload: { ...payload },
      signature: await account.signTypedData(
        buildInvoiceTypedData(payload, invoiceDomain(domainCovenant)),
      ),
    };
  }

  const signedInvoice = await signInvoice(invoice);
  const request = {
    signedInvoice,
    procurementRequest: {
      productId: "gpu-h100-hour",
      expectedAmount: invoice.amount,
    },
  };
  const service: AgentService = createAgentService(dependencies);

  return {
    service,
    dependencies,
    covenant,
    invoice,
    signedInvoice,
    request,
    clock,
    signer: signer as TestPaymentIntentSigner,
    reservationRepository,
    agentAccount,
    authorizationAccount,
    vendorAccount,
    attackerAccount,
    signInvoice,
    counts: {
      get covenant() {
        return covenantCalls;
      },
      get clock() {
        return clockCalls;
      },
      get identifier() {
        return identifierCalls;
      },
      get signer() {
        return (signer as { calls?: number }).calls ?? 0;
      },
      get reservation() {
        return reservationRepository instanceof CountingReservationRepository
          ? reservationRepository.reserveCalls
          : 0;
      },
      get completion() {
        return reservationRepository instanceof CountingReservationRepository
          ? reservationRepository.completionCalls
          : 0;
      },
    },
    identifierContexts,
  };
}

export function expectNoDependencyCalls(harness: AgentHarness): void {
  expect(harness.counts).toMatchObject({
    covenant: 0,
    clock: 0,
    identifier: 0,
    signer: 0,
    reservation: 0,
    completion: 0,
  });
}

export async function proposalForInvoice(
  harness: AgentHarness,
  payload: Record<string, unknown>,
  account: PrivateKeyAccount = harness.vendorAccount,
  domainCovenant: Record<string, unknown> = harness.covenant,
) {
  return {
    signedInvoice: await harness.signInvoice(payload, account, domainCovenant),
    procurementRequest: {
      productId: "gpu-h100-hour",
      expectedAmount: payload.amount,
    },
  };
}
