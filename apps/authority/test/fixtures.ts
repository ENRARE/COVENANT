import {
  EIP712_DOMAIN_NAMES,
  buildAuthorizationReceiptTypedData,
  buildDecisionReceiptTypedData,
  buildInvoiceTypedData,
  buildPaymentIntentTypedData,
  deriveSigningDomainForCovenant,
  hashInvoice,
  type CanonicalRuleResults,
} from "@covenant/spec";
import {
  generatePrivateKey,
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";
import {
  createAuthorityService,
  type AuthorityDependencies,
  type AuthorityService,
  type EvidenceSnapshot,
  type ReceiptSigner,
} from "../src/index.js";

export const TEST_NOW = 2_000_000_000n;

type MutableClock = { value: bigint; now(): bigint };

class TestReceiptSigner implements ReceiptSigner {
  decisionCalls = 0;
  authorizationCalls = 0;
  failNextAuthorization = false;

  constructor(readonly account: PrivateKeyAccount) {}

  get address(): string {
    return this.account.address;
  }

  async signDecisionReceipt(typedData: unknown): Promise<unknown> {
    this.decisionCalls += 1;
    return this.account.signTypedData(
      typedData as Parameters<PrivateKeyAccount["signTypedData"]>[0],
    );
  }

  async signAuthorizationReceipt(typedData: unknown): Promise<unknown> {
    this.authorizationCalls += 1;
    if (this.failNextAuthorization) {
      this.failNextAuthorization = false;
      throw new Error("adapter detail must not escape");
    }
    return this.account.signTypedData(
      typedData as Parameters<PrivateKeyAccount["signTypedData"]>[0],
    );
  }
}

export type TestHarness = Awaited<ReturnType<typeof createTestHarness>>;

export async function createTestHarness(): Promise<{
  service: AuthorityService;
  covenant: Record<string, unknown>;
  invoice: Record<string, unknown>;
  intent: Record<string, unknown>;
  request: { signedPaymentIntent: unknown; signedInvoice: unknown };
  evidence: EvidenceSnapshot;
  consumedAuthorizationNonces: Set<bigint>;
  signer: TestReceiptSigner;
  agentAccount: PrivateKeyAccount;
  vendorAccount: PrivateKeyAccount;
  clock: MutableClock;
  generatedIds: { kind: string; context: string; id: string }[];
  dependencies: AuthorityDependencies;
  signInvoice(payload: Record<string, unknown>): Promise<unknown>;
  signIntent(payload: Record<string, unknown>): Promise<unknown>;
  rebuildRequest(input?: {
    invoice?: Record<string, unknown>;
    intent?: Record<string, unknown>;
    invoiceSigner?: PrivateKeyAccount;
    intentSigner?: PrivateKeyAccount;
  }): Promise<{ signedPaymentIntent: unknown; signedInvoice: unknown }>;
}> {
  const issuerAccount = privateKeyToAccount(generatePrivateKey());
  const agentAccount = privateKeyToAccount(generatePrivateKey());
  const authorizationAccount = privateKeyToAccount(generatePrivateKey());
  const vendorAccount = privateKeyToAccount(generatePrivateKey());
  const signer = new TestReceiptSigner(authorizationAccount);
  const clock: MutableClock = {
    value: TEST_NOW,
    now() {
      return this.value;
    },
  };
  const covenant = {
    version: "1",
    covenantId: `0x${"31".repeat(32)}`,
    issuer: issuerAccount.address,
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
    validUntil: (TEST_NOW + 1_000n).toString(),
    purpose: "Purchase approved GPU compute",
    policyHash: `0x${"32".repeat(32)}`,
    policyVersion: "gpu-policy-1",
    createdAt: (TEST_NOW - 200n).toString(),
  };
  const invoice = {
    version: "1",
    invoiceId: `0x${"33".repeat(32)}`,
    vendor: vendorAccount.address,
    recipient: covenant.recipientAddress,
    token: covenant.tokenAddress,
    amount: "1.25",
    productId: "gpu-h100-hour",
    purpose: covenant.purpose,
    issuedAt: (TEST_NOW - 20n).toString(),
    expiresAt: (TEST_NOW + 500n).toString(),
    nonce: "1",
  };

  function invoiceDomain() {
    return deriveSigningDomainForCovenant(
      covenant,
      EIP712_DOMAIN_NAMES.invoice,
    );
  }

  async function signInvoice(
    payload: Record<string, unknown>,
    account = vendorAccount,
  ): Promise<unknown> {
    return {
      payload,
      signature: await account.signTypedData(
        buildInvoiceTypedData(payload, invoiceDomain()),
      ),
    };
  }

  const invoiceHash = hashInvoice(invoice, invoiceDomain());
  const intent = {
    version: "1",
    intentId: `0x${"34".repeat(32)}`,
    covenantId: covenant.covenantId,
    agentSigner: agentAccount.address,
    recipient: covenant.recipientAddress,
    token: covenant.tokenAddress,
    amount: invoice.amount,
    invoiceHash,
    purpose: covenant.purpose,
    createdAt: (TEST_NOW - 10n).toString(),
    expiresAt: (TEST_NOW + 600n).toString(),
    nonce: "1",
  };

  async function signIntent(
    payload: Record<string, unknown>,
    account = agentAccount,
  ): Promise<unknown> {
    const domain = deriveSigningDomainForCovenant(
      covenant,
      EIP712_DOMAIN_NAMES.paymentIntent,
    );
    return {
      payload,
      signature: await account.signTypedData(
        buildPaymentIntentTypedData(payload, domain),
      ),
    };
  }

  async function rebuildRequest(input?: {
    invoice?: Record<string, unknown>;
    intent?: Record<string, unknown>;
    invoiceSigner?: PrivateKeyAccount;
    intentSigner?: PrivateKeyAccount;
  }) {
    const nextInvoice = input?.invoice ?? invoice;
    const signedInvoice = await signInvoice(
      nextInvoice,
      input?.invoiceSigner ?? vendorAccount,
    );
    const nextIntent = {
      ...intent,
      invoiceHash: hashInvoice(nextInvoice, invoiceDomain()),
      ...(input?.intent ?? {}),
    };
    const signedPaymentIntent = await signIntent(
      nextIntent,
      input?.intentSigner ?? agentAccount,
    );
    return { signedPaymentIntent, signedInvoice };
  }

  const request = await rebuildRequest();
  const evidence: EvidenceSnapshot = {
    chainId: 5_042_002n,
    vaultAddress: covenant.vaultAddress as `0x${string}`,
    observedAt: TEST_NOW,
    revoked: false,
    totalSpent: 0n,
    paymentCount: 0n,
    usedIntentHash: false,
    usedIntentId: false,
    usedAgentNonce: false,
  };
  const consumedAuthorizationNonces = new Set<bigint>();
  const generatedIds: { kind: string; context: string; id: string }[] = [];
  let nextId = 1n;
  const dependencies: AuthorityDependencies = {
    clock,
    covenantProvider: { getCovenant: () => Promise.resolve(covenant) },
    evidenceReader: {
      readEvidence: () => Promise.resolve({ ...evidence }),
      isAuthorizationNonceUsed: (nonce) =>
        Promise.resolve(consumedAuthorizationNonces.has(nonce)),
    },
    identifierGenerator: {
      createId: (kind, context) => {
        const id = `0x${nextId.toString(16).padStart(64, "0")}`;
        nextId += 1n;
        generatedIds.push({ kind, context, id });
        return Promise.resolve(id);
      },
    },
    signer,
    approvedVendor: vendorAccount.address,
    approvedProductId: "gpu-h100-hour",
  };
  const service = createAuthorityService(dependencies);

  return {
    service,
    covenant,
    invoice,
    intent,
    request,
    evidence,
    consumedAuthorizationNonces,
    signer,
    agentAccount,
    vendorAccount,
    clock,
    generatedIds,
    dependencies,
    signInvoice: (payload) => signInvoice(payload),
    signIntent: (payload) => signIntent(payload),
    rebuildRequest,
  };
}

export function authorizationInput(
  request: { signedPaymentIntent: unknown; signedInvoice: unknown },
  evaluated: {
    ruleResults: CanonicalRuleResults;
    decisionReceipt: unknown;
  },
) {
  return {
    ...request,
    ruleResults: evaluated.ruleResults,
    decisionReceipt: evaluated.decisionReceipt,
  };
}

export function receiptTypedDataBuilders() {
  return {
    buildDecisionReceiptTypedData,
    buildAuthorizationReceiptTypedData,
  };
}
