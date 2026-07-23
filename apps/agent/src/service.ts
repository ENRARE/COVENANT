import {
  EIP712_DOMAIN_NAMES,
  SCHEMA_VERSION,
  buildPaymentIntentTypedData,
  deriveSigningDomainForCovenant,
  formatUsdc,
  hashInvoice,
  paymentIntentSchema,
  recoverInvoiceSigner,
  recoverPaymentIntentSigner,
  verifySignedPaymentIntentForCovenant,
  type CovenantSpec,
  type SignedInvoice,
} from "@covenant/spec";
import {
  encodeAbiParameters,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { AgentError, callDependency } from "./errors.js";
import { InMemoryProposalReservationRepository } from "./in-memory-proposal-reservation-repository.js";
import type {
  Clock,
  CovenantProvider,
  PaymentIntentIdentifierGenerator,
  PaymentIntentSigner,
  ProposalRepository,
  ProposalReservationRepository,
} from "./ports.js";
import {
  parseClock,
  parseConfiguration,
  parseIdentifier,
  parseNonce,
  parseOptionalReservation,
  parsePublicRequest,
  parseReservation,
  parseSignature,
  parseSignerAddress,
  parseTrustedCovenant,
} from "./schemas.js";
import type {
  AgentProposalResult,
  ProposalReservation,
  RawInvoicePayload,
  RawPaymentIntentPayload,
  RawSignedInvoice,
  RawSignedPaymentIntent,
} from "./types.js";

const PROPOSAL_IDENTITY_TAG = keccak256(
  stringToHex("COV-005:procurement-proposal:v1"),
);

export const PAYMENT_INTENT_TTL_SECONDS = 600n;

export type AgentDependencies = {
  clock: Clock;
  covenantProvider: CovenantProvider;
  signer: PaymentIntentSigner;
  identifierGenerator: PaymentIntentIdentifierGenerator;
  reservationRepository?: ProposalReservationRepository;
  proposalRepository?: ProposalRepository;
  approvedVendor: unknown;
  approvedProductId: unknown;
  intentTtlSeconds: unknown;
};

export type AgentService = {
  proposePayment(request: unknown): Promise<AgentProposalResult>;
};

type ParsedRequest = ReturnType<typeof parsePublicRequest>;
type LoadedCovenant = ReturnType<typeof parseTrustedCovenant>;

function minimum(...values: readonly bigint[]): bigint {
  return values.reduce((smallest, value) =>
    value < smallest ? value : smallest,
  );
}

function freezeInvoice(invoice: RawSignedInvoice): RawSignedInvoice {
  const payload: RawInvoicePayload = Object.freeze({
    version: invoice.payload.version,
    invoiceId: invoice.payload.invoiceId,
    vendor: invoice.payload.vendor,
    recipient: invoice.payload.recipient,
    token: invoice.payload.token,
    amount: invoice.payload.amount,
    productId: invoice.payload.productId,
    purpose: invoice.payload.purpose,
    issuedAt: invoice.payload.issuedAt,
    expiresAt: invoice.payload.expiresAt,
    nonce: invoice.payload.nonce,
  });
  return Object.freeze({ payload, signature: invoice.signature });
}

function freezePaymentIntent(
  intent: RawSignedPaymentIntent,
): RawSignedPaymentIntent {
  const payload: RawPaymentIntentPayload = Object.freeze({
    version: intent.payload.version,
    intentId: intent.payload.intentId,
    covenantId: intent.payload.covenantId,
    agentSigner: intent.payload.agentSigner,
    recipient: intent.payload.recipient,
    token: intent.payload.token,
    amount: intent.payload.amount,
    invoiceHash: intent.payload.invoiceHash,
    purpose: intent.payload.purpose,
    createdAt: intent.payload.createdAt,
    expiresAt: intent.payload.expiresAt,
    nonce: intent.payload.nonce,
  });
  return Object.freeze({ payload, signature: intent.signature });
}

function freezeResult(result: AgentProposalResult): AgentProposalResult {
  return Object.freeze({
    signedPaymentIntent: freezePaymentIntent(result.signedPaymentIntent),
    signedInvoice: freezeInvoice(result.signedInvoice),
  });
}

function proposalIdentity(input: {
  covenant: CovenantSpec;
  invoiceHash: Hex;
  productId: string;
  amount: bigint;
}): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "string" },
        { type: "string" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
      ],
      [
        PROPOSAL_IDENTITY_TAG,
        input.covenant.covenantId,
        input.invoiceHash,
        input.productId,
        input.covenant.purpose,
        input.amount,
        input.covenant.recipientAddress,
        input.covenant.tokenAddress,
      ],
    ),
  );
}

function assertCurrent(
  now: bigint,
  invoice: SignedInvoice,
  covenant: CovenantSpec,
): void {
  if (invoice.payload.issuedAt > now || now >= invoice.payload.expiresAt) {
    throw new AgentError("INVOICE_NOT_CURRENT");
  }
  if (now < covenant.validAfter || now >= covenant.validUntil) {
    throw new AgentError("COVENANT_INACTIVE");
  }
}

function assertInvoiceLinkage(input: {
  request: ParsedRequest;
  covenant: CovenantSpec;
  approvedVendor: Address;
  approvedProductId: string;
  recoveredVendor: Address;
}): void {
  const invoice = input.request.signedInvoice.payload;
  if (input.recoveredVendor !== input.approvedVendor) {
    throw new AgentError("INVOICE_SIGNATURE_INVALID");
  }
  if (invoice.vendor !== input.approvedVendor) {
    throw new AgentError("INVOICE_VENDOR_MISMATCH");
  }
  if (
    invoice.productId !== input.approvedProductId ||
    input.request.productId !== input.approvedProductId
  ) {
    throw new AgentError("INVOICE_PRODUCT_MISMATCH");
  }
  if (invoice.recipient !== input.covenant.recipientAddress) {
    throw new AgentError("INVOICE_RECIPIENT_MISMATCH");
  }
  if (invoice.token !== input.covenant.tokenAddress) {
    throw new AgentError("INVOICE_TOKEN_MISMATCH");
  }
  if (invoice.purpose !== input.covenant.purpose) {
    throw new AgentError("INVOICE_PURPOSE_MISMATCH");
  }
  if (invoice.amount !== input.request.expectedAmount) {
    throw new AgentError("INVOICE_AMOUNT_MISMATCH");
  }
  if (invoice.amount > input.covenant.maxAmountPerPayment) {
    throw new AgentError("AMOUNT_EXCEEDS_LIMIT");
  }
}

function assertReservationMatches(input: {
  reservation: ProposalReservation;
  covenant: CovenantSpec;
  invoice: SignedInvoice;
  invoiceHash: Hex;
  signerAddress: Address;
  intentTtlSeconds: bigint;
}): void {
  let parsed: ReturnType<typeof paymentIntentSchema.parse>;
  try {
    parsed = paymentIntentSchema.parse(
      input.reservation.rawPaymentIntentPayload,
    );
  } catch {
    throw new AgentError("RESERVATION_REPOSITORY_FAILURE");
  }
  const expectedExpiry = minimum(
    parsed.createdAt + input.intentTtlSeconds,
    input.invoice.payload.expiresAt,
    input.covenant.validUntil,
  );
  if (
    parsed.intentId !== input.reservation.intentId ||
    parsed.covenantId !== input.covenant.covenantId ||
    parsed.agentSigner !== input.signerAddress ||
    parsed.recipient !== input.covenant.recipientAddress ||
    parsed.token !== input.covenant.tokenAddress ||
    parsed.amount !== input.invoice.payload.amount ||
    parsed.invoiceHash !== input.invoiceHash ||
    parsed.purpose !== input.covenant.purpose ||
    parsed.expiresAt !== expectedExpiry ||
    parsed.nonce.toString() !== input.reservation.nonce
  ) {
    throw new AgentError("RESERVATION_REPOSITORY_FAILURE");
  }
}

function assertEveryIntentField(
  actual: ReturnType<typeof paymentIntentSchema.parse>,
  expected: ReturnType<typeof paymentIntentSchema.parse>,
): void {
  if (
    actual.intentId !== expected.intentId ||
    actual.covenantId !== expected.covenantId ||
    actual.agentSigner !== expected.agentSigner ||
    actual.recipient !== expected.recipient ||
    actual.token !== expected.token ||
    actual.amount !== expected.amount ||
    actual.invoiceHash !== expected.invoiceHash ||
    actual.purpose !== expected.purpose ||
    actual.createdAt !== expected.createdAt ||
    actual.expiresAt !== expected.expiresAt ||
    actual.nonce !== expected.nonce
  ) {
    throw new AgentError("SELF_VERIFICATION_FAILED");
  }
}

export function createAgentService(
  dependencies: AgentDependencies,
): AgentService {
  const configuration = parseConfiguration(dependencies);
  const reservationRepository =
    dependencies.reservationRepository ??
    new InMemoryProposalReservationRepository();
  const proposalRepository = dependencies.proposalRepository;
  const localOperations = new Map<string, Promise<AgentProposalResult>>();

  async function now(): Promise<bigint> {
    return callDependency({
      operation: () => parseClock(dependencies.clock.now()),
      code: "CLOCK_FAILURE",
      preserveAgentError: true,
    });
  }

  async function loadCovenant(): Promise<LoadedCovenant> {
    const raw = await callDependency({
      operation: () => dependencies.covenantProvider.getCovenant(),
      code: "COVENANT_PROVIDER_FAILURE",
    });
    return parseTrustedCovenant(raw);
  }

  async function signerAddress(covenant: CovenantSpec): Promise<Address> {
    const raw = await callDependency({
      operation: () => dependencies.signer.address,
      code: "SIGNER_ADDRESS_FAILURE",
    });
    const address = parseSignerAddress(raw);
    if (address !== covenant.agentSigner) {
      throw new AgentError("SIGNER_MISMATCH");
    }
    return address;
  }

  async function verifyInvoice(input: {
    request: ParsedRequest;
    covenant: LoadedCovenant;
  }): Promise<Hex> {
    const domain = deriveSigningDomainForCovenant(
      input.covenant.raw,
      EIP712_DOMAIN_NAMES.invoice,
    );
    const invoiceHash = hashInvoice(
      input.request.rawSignedInvoice.payload,
      domain,
    );
    let recoveredVendor: Address;
    try {
      recoveredVendor = await recoverInvoiceSigner(
        input.request.rawSignedInvoice,
        domain,
      );
    } catch {
      throw new AgentError("INVOICE_SIGNATURE_INVALID");
    }
    assertInvoiceLinkage({
      request: input.request,
      covenant: input.covenant.parsed,
      approvedVendor: configuration.approvedVendor,
      approvedProductId: configuration.approvedProductId,
      recoveredVendor,
    });
    return invoiceHash;
  }

  async function createReservation(input: {
    identity: string;
    createdAt: bigint;
    request: ParsedRequest;
    covenant: CovenantSpec;
    signerAddress: Address;
    invoiceHash: Hex;
  }): Promise<ProposalReservation> {
    let creation: Promise<ProposalReservation> | undefined;
    return callDependency({
      operation: () =>
        reservationRepository.reserve(input.identity, (rawNonce) => {
          creation ??= (async () => {
            const nonce = parseNonce(rawNonce);
            const rawIdentifier = await callDependency({
              operation: () =>
                dependencies.identifierGenerator.createId(input.identity),
              code: "IDENTIFIER_GENERATION_FAILURE",
              preserveAgentError: true,
            });
            const intentId = parseIdentifier(rawIdentifier);
            const expiresAt = minimum(
              input.createdAt + configuration.intentTtlSeconds,
              input.request.signedInvoice.payload.expiresAt,
              input.covenant.validUntil,
            );
            if (expiresAt <= input.createdAt) {
              throw new AgentError("PAYMENT_INTENT_EXPIRED");
            }
            const rawPaymentIntentPayload: RawPaymentIntentPayload =
              Object.freeze({
                version: SCHEMA_VERSION,
                intentId,
                covenantId: input.covenant.covenantId,
                agentSigner: input.signerAddress,
                recipient: input.covenant.recipientAddress,
                token: input.covenant.tokenAddress,
                amount: formatUsdc(input.request.signedInvoice.payload.amount),
                invoiceHash: input.invoiceHash,
                purpose: input.covenant.purpose,
                createdAt: input.createdAt.toString(),
                expiresAt: expiresAt.toString(),
                nonce: nonce.toString(),
              });
            paymentIntentSchema.parse(rawPaymentIntentPayload);
            return Object.freeze({
              intentId,
              nonce: nonce.toString(),
              rawPaymentIntentPayload,
            });
          })();
          return creation;
        }),
      code: "RESERVATION_REPOSITORY_FAILURE",
      preserveAgentError: true,
    }).then(parseReservation);
  }

  async function verifySignedResult(input: {
    result: AgentProposalResult;
    reservation: ProposalReservation;
    request: ParsedRequest;
    covenant: LoadedCovenant;
    signerAddress: Address;
    invoiceHash: Hex;
  }): Promise<void> {
    try {
      const verified = await verifySignedPaymentIntentForCovenant(
        input.result.signedPaymentIntent,
        input.covenant.raw,
      );
      const expected = paymentIntentSchema.parse(
        input.reservation.rawPaymentIntentPayload,
      );
      assertEveryIntentField(verified.payload, expected);
      const paymentDomain = deriveSigningDomainForCovenant(
        input.covenant.raw,
        EIP712_DOMAIN_NAMES.paymentIntent,
      );
      const recovered = await recoverPaymentIntentSigner(
        input.result.signedPaymentIntent,
        paymentDomain,
      );
      if (recovered !== input.signerAddress) {
        throw new AgentError("SELF_VERIFICATION_FAILED");
      }
      const invoiceDomain = deriveSigningDomainForCovenant(
        input.covenant.raw,
        EIP712_DOMAIN_NAMES.invoice,
      );
      if (
        hashInvoice(input.result.signedInvoice.payload, invoiceDomain) !==
          input.invoiceHash ||
        hashInvoice(input.request.rawSignedInvoice.payload, invoiceDomain) !==
          input.invoiceHash
      ) {
        throw new AgentError("SELF_VERIFICATION_FAILED");
      }
    } catch {
      throw new AgentError("SELF_VERIFICATION_FAILED");
    }
  }

  async function assertFinalTime(
    result: AgentProposalResult,
    covenant: CovenantSpec,
    invoice: SignedInvoice,
  ): Promise<void> {
    const currentTime = await now();
    assertCurrent(currentTime, invoice, covenant);
    const intent = paymentIntentSchema.parse(
      result.signedPaymentIntent.payload,
    );
    if (currentTime >= intent.expiresAt) {
      throw new AgentError("PAYMENT_INTENT_EXPIRED");
    }
  }

  async function coreOperation(input: {
    identity: string;
    initialTime: bigint;
    request: ParsedRequest;
    covenant: LoadedCovenant;
    signerAddress: Address;
    invoiceHash: Hex;
  }): Promise<AgentProposalResult> {
    const existingRaw = await callDependency({
      operation: () => reservationRepository.get(input.identity),
      code: "RESERVATION_REPOSITORY_FAILURE",
    });
    let reservation = parseOptionalReservation(existingRaw);
    reservation ??= await createReservation({
      identity: input.identity,
      createdAt: input.initialTime,
      request: input.request,
      covenant: input.covenant.parsed,
      signerAddress: input.signerAddress,
      invoiceHash: input.invoiceHash,
    });
    assertReservationMatches({
      reservation,
      covenant: input.covenant.parsed,
      invoice: input.request.signedInvoice,
      invoiceHash: input.invoiceHash,
      signerAddress: input.signerAddress,
      intentTtlSeconds: configuration.intentTtlSeconds,
    });

    const retainedExpiry = BigInt(
      reservation.rawPaymentIntentPayload.expiresAt,
    );
    const preSigningTime = await now();
    if (preSigningTime >= retainedExpiry) {
      throw new AgentError("PAYMENT_INTENT_EXPIRED");
    }

    if (reservation.completedResult !== undefined) {
      const stored = freezeResult(reservation.completedResult);
      await verifySignedResult({
        result: stored,
        reservation,
        request: input.request,
        covenant: input.covenant,
        signerAddress: input.signerAddress,
        invoiceHash: input.invoiceHash,
      });
      await assertFinalTime(
        stored,
        input.covenant.parsed,
        input.request.signedInvoice,
      );
      return freezeResult(stored);
    }

    const domain = deriveSigningDomainForCovenant(
      input.covenant.raw,
      EIP712_DOMAIN_NAMES.paymentIntent,
    );
    const typedData = buildPaymentIntentTypedData(
      reservation.rawPaymentIntentPayload,
      domain,
    );
    const rawSignature = await callDependency({
      operation: () => dependencies.signer.signPaymentIntent(typedData),
      code: "PAYMENT_INTENT_SIGNING_FAILURE",
    });
    const signature = parseSignature(rawSignature);
    const signedPaymentIntent = freezePaymentIntent({
      payload: reservation.rawPaymentIntentPayload,
      signature,
    });
    const result = freezeResult({
      signedPaymentIntent,
      signedInvoice: input.request.rawSignedInvoice,
    });
    await verifySignedResult({
      result,
      reservation,
      request: input.request,
      covenant: input.covenant,
      signerAddress: input.signerAddress,
      invoiceHash: input.invoiceHash,
    });
    await assertFinalTime(
      result,
      input.covenant.parsed,
      input.request.signedInvoice,
    );
    await callDependency({
      operation: () =>
        reservationRepository.storeCompleted(input.identity, result),
      code: "RESERVATION_REPOSITORY_FAILURE",
    });
    return freezeResult(result);
  }

  async function coordinate(
    identity: string,
    operation: () => Promise<AgentProposalResult>,
  ): Promise<AgentProposalResult> {
    if (proposalRepository === undefined) return operation();

    let invokedOperation: Promise<AgentProposalResult> | undefined;
    let acceptsInvocation = true;
    let signalInvoked: (() => void) | undefined;
    const invoked = new Promise<"invoked">((resolve) => {
      signalInvoked = () => {
        resolve("invoked");
      };
    });
    const callback = () => {
      if (!acceptsInvocation) {
        return Promise.reject(new AgentError("PROPOSAL_REPOSITORY_FAILURE"));
      }
      invokedOperation ??= operation();
      signalInvoked?.();
      return invokedOperation;
    };
    const repositoryOutcome = Promise.resolve()
      .then(() => proposalRepository.coordinate(identity, callback))
      .then(
        () => "settled" as const,
        () => "rejected" as const,
      );
    const first = await Promise.race([invoked, repositoryOutcome]);
    if (first === "invoked" && invokedOperation !== undefined) {
      return invokedOperation;
    }
    acceptsInvocation = false;
    throw new AgentError("PROPOSAL_REPOSITORY_FAILURE");
  }

  async function proposePayment(
    publicInput: unknown,
  ): Promise<AgentProposalResult> {
    const request = parsePublicRequest(publicInput);
    const covenant = await loadCovenant();
    const invoiceHash = await verifyInvoice({ request, covenant });
    const currentTime = await now();
    assertCurrent(currentTime, request.signedInvoice, covenant.parsed);
    const address = await signerAddress(covenant.parsed);
    const identity = proposalIdentity({
      covenant: covenant.parsed,
      invoiceHash,
      productId: request.productId,
      amount: request.expectedAmount,
    });

    const existing = localOperations.get(identity);
    if (existing !== undefined) return existing;
    const operation = coordinate(identity, () =>
      coreOperation({
        identity,
        initialTime: currentTime,
        request,
        covenant,
        signerAddress: address,
        invoiceHash,
      }),
    );
    localOperations.set(identity, operation);
    try {
      return await operation;
    } finally {
      if (localOperations.get(identity) === operation) {
        localOperations.delete(identity);
      }
    }
  }

  return Object.freeze({ proposePayment });
}
