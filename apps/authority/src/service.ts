import {
  EIP712_DOMAIN_NAMES,
  deriveSigningDomainForCovenant,
  hashDecisionReceipt,
  hashInvoice,
  hashPaymentIntent,
  hashRuleResults,
  verifyAuthorizationChain,
  verifySignedDecisionReceiptForCovenant,
  verifySignedPaymentIntentForCovenant,
} from "@covenant/spec";
import { issueAuthorizationReceipt } from "./authorizations/issue-authorization.js";
import { issueDecision } from "./decisions/issue-decision.js";
import { AuthorityError } from "./errors.js";
import { verifyInvoice } from "./invoices/verify-invoice.js";
import {
  evaluatePolicy,
  type PolicyEvaluation,
} from "./policy/evaluate-policy.js";
import type { Clock } from "./ports/clock.js";
import type { CovenantProvider } from "./ports/covenant-provider.js";
import type { EvidenceReader } from "./ports/evidence-reader.js";
import type { IdentifierGenerator } from "./ports/identifier-generator.js";
import type {
  ApprovedDecisionRecord,
  ApprovedDecisionRepository,
  AuthorizationNonceRepository,
  AuthorizationRepository,
} from "./ports/repositories.js";
import type { ReceiptSigner } from "./ports/receipt-signer.js";
import { InMemoryAuthorizationRepository } from "./repositories/in-memory-authorization-repository.js";
import { InMemoryDecisionRepository } from "./repositories/in-memory-decision-repository.js";
import { InMemoryNonceRepository } from "./repositories/in-memory-nonce-repository.js";
import {
  parseAuthorizationRequest,
  parseClockValue,
  parseConfiguredProduct,
  parseConfiguredVendor,
  parseConsumedNonceResult,
  parseEvidence,
  parseGeneratedIdentifier,
  parsePaymentRequest,
  parseSignerAddress,
  parseTrustedCovenant,
} from "./schemas.js";
import type {
  EvaluationResult,
  ProcessResult,
  RawSignedAuthorizationReceipt,
} from "./types.js";

export const AUTHORIZATION_TTL_SECONDS = 300n;

export type AuthorityDependencies = {
  clock: Clock;
  covenantProvider: CovenantProvider;
  evidenceReader: EvidenceReader;
  identifierGenerator: IdentifierGenerator;
  signer: ReceiptSigner;
  approvedVendor: unknown;
  approvedProductId: unknown;
  decisionRepository?: ApprovedDecisionRepository;
  authorizationRepository?: AuthorizationRepository;
  nonceRepository?: AuthorizationNonceRepository;
};

type LoadedCovenant = ReturnType<typeof parseTrustedCovenant>;
type ParsedPaymentRequest = ReturnType<typeof parsePaymentRequest>;

export type AuthorityService = {
  evaluatePaymentRequest(request: unknown): Promise<EvaluationResult>;
  issueAuthorization(request: unknown): Promise<RawSignedAuthorizationReceipt>;
  processPaymentRequest(request: unknown): Promise<ProcessResult>;
};

function minimum(...values: readonly bigint[]): bigint {
  return values.reduce((smallest, value) =>
    value < smallest ? value : smallest,
  );
}

export function createAuthorityService(
  dependencies: AuthorityDependencies,
): AuthorityService {
  const approvedVendor = parseConfiguredVendor(dependencies.approvedVendor);
  const approvedProductId = parseConfiguredProduct(
    dependencies.approvedProductId,
  );
  const signerAddress = parseSignerAddress(dependencies.signer.address);
  const decisionRepository =
    dependencies.decisionRepository ?? new InMemoryDecisionRepository();
  const authorizationRepository =
    dependencies.authorizationRepository ??
    new InMemoryAuthorizationRepository();
  const nonceRepository =
    dependencies.nonceRepository ?? new InMemoryNonceRepository();

  async function loadCovenant(): Promise<LoadedCovenant> {
    let raw: unknown;
    try {
      raw = await dependencies.covenantProvider.getCovenant();
    } catch {
      throw new AuthorityError(
        "DEPENDENCY_FAILURE",
        "Trusted Covenant provider failed",
      );
    }
    const covenant = parseTrustedCovenant(raw);
    if (signerAddress !== covenant.parsed.authorizationSigner) {
      throw new AuthorityError(
        "SIGNER_MISMATCH",
        "Configured signer does not match the Covenant authorization signer",
      );
    }
    return covenant;
  }

  function now(): bigint {
    return parseClockValue(dependencies.clock.now());
  }

  function paymentDigests(
    request: ParsedPaymentRequest,
    covenant: LoadedCovenant,
  ) {
    const paymentDomain = deriveSigningDomainForCovenant(
      covenant.raw,
      EIP712_DOMAIN_NAMES.paymentIntent,
    );
    const invoiceDomain = deriveSigningDomainForCovenant(
      covenant.raw,
      EIP712_DOMAIN_NAMES.invoice,
    );
    return {
      intentHash: hashPaymentIntent(
        (request.rawSignedPaymentIntent as { payload: unknown }).payload,
        paymentDomain,
      ),
      invoiceHash: hashInvoice(
        (request.rawSignedInvoice as { payload: unknown }).payload,
        invoiceDomain,
      ),
    } as const;
  }

  async function readEvidence(
    request: ParsedPaymentRequest,
    covenant: LoadedCovenant,
    intentHash: `0x${string}`,
  ) {
    let rawEvidence: unknown;
    try {
      rawEvidence = await dependencies.evidenceReader.readEvidence({
        covenantId: covenant.parsed.covenantId,
        intentHash,
        intentId: request.signedPaymentIntent.payload.intentId,
        agentNonce: request.signedPaymentIntent.payload.nonce,
      });
    } catch {
      throw new AuthorityError(
        "DEPENDENCY_FAILURE",
        "Authority evidence reader failed",
      );
    }
    return parseEvidence(rawEvidence);
  }

  async function evaluateParsedRequest(
    request: ParsedPaymentRequest,
    covenant: LoadedCovenant,
    currentTime: bigint,
  ): Promise<PolicyEvaluation> {
    const { intentHash } = paymentDigests(request, covenant);
    const evidence = await readEvidence(request, covenant, intentHash);
    return evaluatePolicy({
      rawCovenant: covenant.raw,
      covenant: covenant.parsed,
      rawSignedPaymentIntent: request.rawSignedPaymentIntent,
      signedPaymentIntent: request.signedPaymentIntent,
      rawSignedInvoice: request.rawSignedInvoice,
      signedInvoice: request.signedInvoice,
      evidence,
      now: currentTime,
      approvedVendor,
      approvedProductId,
    });
  }

  async function verifyApprovedRecord(
    record: ApprovedDecisionRecord,
    request: ParsedPaymentRequest,
    covenant: LoadedCovenant,
    evaluation: PolicyEvaluation,
  ): Promise<void> {
    try {
      const verified = await verifySignedDecisionReceiptForCovenant(
        record.decisionReceipt,
        record.ruleResults,
        covenant.raw,
      );
      const payload = verified.envelope.payload;
      if (
        payload.decision !== "APPROVED" ||
        payload.covenantId !== covenant.parsed.covenantId ||
        payload.intentId !== request.signedPaymentIntent.payload.intentId ||
        payload.intentHash !== evaluation.intentHash ||
        hashRuleResults(record.ruleResults) !==
          hashRuleResults(evaluation.ruleResults)
      )
        throw new Error("Approved decision identity mismatch");
    } catch {
      throw new AuthorityError(
        "SELF_VERIFICATION_FAILED",
        "Stored approved decision failed verification",
      );
    }
  }

  async function evaluatePaymentRequest(
    input: unknown,
  ): Promise<EvaluationResult> {
    const request = parsePaymentRequest(input);
    const covenant = await loadCovenant();
    const currentTime = now();
    const evaluation = await evaluateParsedRequest(
      request,
      covenant,
      currentTime,
    );
    const identity = [
      "decision",
      covenant.parsed.covenantId,
      evaluation.intentHash,
      evaluation.invoiceHash,
    ].join(":");
    const create = async (): Promise<ApprovedDecisionRecord> => ({
      ruleResults: evaluation.ruleResults,
      decisionReceipt: await issueDecision({
        rawCovenant: covenant.raw,
        covenant: covenant.parsed,
        intent: request.signedPaymentIntent,
        intentHash: evaluation.intentHash,
        ruleResults: evaluation.ruleResults,
        status: evaluation.status,
        createdAt: currentTime,
        stableContext:
          evaluation.status === "APPROVED"
            ? identity
            : `${identity}:rejected:${currentTime.toString()}`,
        createId: (stableContext) =>
          dependencies.identifierGenerator.createId("decision", stableContext),
        signer: dependencies.signer,
      }),
    });

    if (evaluation.status === "REJECTED") {
      const record = await create();
      return {
        status: "REJECTED",
        ruleResults: record.ruleResults,
        decisionReceipt: record.decisionReceipt,
      };
    }

    let record: ApprovedDecisionRecord;
    try {
      record = await decisionRepository.getOrCreate(identity, create);
    } catch (error) {
      if (error instanceof AuthorityError) throw error;
      throw new AuthorityError(
        "IDEMPOTENCY_CONFLICT",
        "Approved decision repository operation failed",
      );
    }
    await verifyApprovedRecord(record, request, covenant, evaluation);
    return {
      status: "APPROVED",
      ruleResults: record.ruleResults,
      decisionReceipt: record.decisionReceipt,
    };
  }

  async function issueAuthorization(
    input: unknown,
  ): Promise<RawSignedAuthorizationReceipt> {
    const request = parseAuthorizationRequest(input);
    const covenant = await loadCovenant();
    const currentTime = now();
    const paymentRequest = {
      rawSignedPaymentIntent: request.rawSignedPaymentIntent,
      signedPaymentIntent: request.signedPaymentIntent,
      rawSignedInvoice: request.rawSignedInvoice,
      signedInvoice: request.signedInvoice,
    };
    const evaluation = await evaluateParsedRequest(
      paymentRequest,
      covenant,
      currentTime,
    );

    try {
      await verifySignedPaymentIntentForCovenant(
        request.rawSignedPaymentIntent,
        covenant.raw,
      );
      const invoice = await verifyInvoice({
        rawCovenant: covenant.raw,
        covenant: covenant.parsed,
        rawSignedInvoice: request.rawSignedInvoice,
        invoice: request.signedInvoice,
        intent: request.signedPaymentIntent,
        approvedVendor,
        approvedProductId,
      });
      if (!invoice.signatureValid || !invoice.matchesIntent)
        throw new Error("Invoice verification failed");
      const verifiedDecision = await verifySignedDecisionReceiptForCovenant(
        request.rawDecisionReceipt,
        request.ruleResults,
        covenant.raw,
      );
      const decision = verifiedDecision.envelope.payload;
      const intent = request.signedPaymentIntent.payload;
      if (
        decision.decision !== "APPROVED" ||
        decision.covenantId !== covenant.parsed.covenantId ||
        decision.intentId !== intent.intentId ||
        decision.intentHash !== evaluation.intentHash ||
        decision.policyVersion !== covenant.parsed.policyVersion ||
        decision.createdAt > currentTime ||
        decision.createdAt < intent.createdAt ||
        decision.createdAt >= intent.expiresAt ||
        hashRuleResults(request.ruleResults) !==
          hashRuleResults(evaluation.ruleResults) ||
        evaluation.status !== "APPROVED"
      )
        throw new Error("Decision linkage failed");
    } catch {
      throw new AuthorityError(
        "INVALID_DECISION",
        "Authorization requires a currently valid approved decision",
      );
    }

    const decision = request.decisionReceipt.payload;
    const intent = request.signedPaymentIntent.payload;
    const invoice = request.signedInvoice.payload;
    const validUntil = minimum(
      currentTime + AUTHORIZATION_TTL_SECONDS,
      intent.expiresAt,
      invoice.expiresAt,
      covenant.parsed.validUntil,
    );
    if (validUntil <= currentTime || validUntil <= decision.createdAt) {
      throw new AuthorityError(
        "EXPIRED_REQUEST",
        "Authorization validity window is exhausted",
      );
    }

    const decisionDomain = deriveSigningDomainForCovenant(
      covenant.raw,
      EIP712_DOMAIN_NAMES.decisionReceipt,
    );
    const decisionDigest = hashDecisionReceipt(
      (request.rawDecisionReceipt as { payload: unknown }).payload,
      decisionDomain,
    );
    const identity = [
      "authorization",
      covenant.parsed.covenantId,
      decision.decisionId,
      decisionDigest,
      evaluation.intentHash,
      evaluation.invoiceHash,
    ].join(":");

    let receipt: RawSignedAuthorizationReceipt;
    try {
      receipt = await authorizationRepository.getOrCreate(
        identity,
        async () => {
          const authorizationId = parseGeneratedIdentifier(
            await dependencies.identifierGenerator.createId(
              "authorization",
              identity,
            ),
          );
          const authorizationNonce = await nonceRepository.reserve(
            identity,
            async (candidate) => {
              let consumed: unknown;
              try {
                consumed =
                  await dependencies.evidenceReader.isAuthorizationNonceUsed(
                    candidate,
                  );
              } catch {
                throw new AuthorityError(
                  "DEPENDENCY_FAILURE",
                  "Authorization nonce evidence reader failed",
                );
              }
              return parseConsumedNonceResult(consumed);
            },
          );
          return { authorizationId, authorizationNonce };
        },
        (reservation) =>
          issueAuthorizationReceipt({
            rawCovenant: covenant.raw,
            covenant: covenant.parsed,
            rawSignedPaymentIntent: request.rawSignedPaymentIntent,
            rawDecisionReceipt: request.rawDecisionReceipt,
            ruleResults: request.ruleResults,
            intentHash: evaluation.intentHash,
            decisionId: decision.decisionId,
            validUntil,
            reservation,
            signer: dependencies.signer,
          }),
      );
    } catch (error) {
      if (error instanceof AuthorityError) throw error;
      throw new AuthorityError(
        "IDEMPOTENCY_CONFLICT",
        "Authorization repository operation failed",
      );
    }

    try {
      const verified = await verifyAuthorizationChain(
        covenant.raw,
        request.rawSignedPaymentIntent,
        request.rawDecisionReceipt,
        request.ruleResults,
        receipt,
      );
      if (
        verified.signedAuthorizationReceipt.payload.validUntil <= currentTime ||
        verified.signedAuthorizationReceipt.payload.validUntil >
          invoice.expiresAt
      )
        throw new Error("Stored authorization expired");
    } catch {
      throw new AuthorityError(
        "SELF_VERIFICATION_FAILED",
        "Stored AuthorizationReceipt failed verification",
      );
    }
    return receipt;
  }

  async function processPaymentRequest(input: unknown): Promise<ProcessResult> {
    const parsed = parsePaymentRequest(input);
    const evaluation = await evaluatePaymentRequest(input);
    if (evaluation.status === "REJECTED") {
      return {
        status: "REJECTED",
        ruleResults: evaluation.ruleResults,
        decisionReceipt: evaluation.decisionReceipt,
      };
    }
    const authorizationReceipt = await issueAuthorization({
      signedPaymentIntent: parsed.rawSignedPaymentIntent,
      signedInvoice: parsed.rawSignedInvoice,
      ruleResults: evaluation.ruleResults,
      decisionReceipt: evaluation.decisionReceipt,
    });
    return { ...evaluation, authorizationReceipt };
  }

  return {
    evaluatePaymentRequest,
    issueAuthorization,
    processPaymentRequest,
  };
}
