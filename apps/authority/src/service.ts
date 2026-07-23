import {
  CovenantVerificationError,
  EIP712_DOMAIN_NAMES,
  deriveSigningDomainForCovenant,
  hashDecisionReceipt,
  hashInvoice,
  hashPaymentIntent,
  hashRuleResults,
  verifySignedDecisionReceiptForCovenant,
  verifySignedPaymentIntentForCovenant,
} from "@covenant/spec";
import {
  issueAuthorizationReceipt,
  verifyAuthorizationReceiptLinkage,
} from "./authorizations/issue-authorization.js";
import { issueDecision } from "./decisions/issue-decision.js";
import {
  AUTHORITY_ERROR_MESSAGES,
  AuthorityError,
  callDependency,
  type AuthorityErrorCode,
} from "./errors.js";
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

function decisionVerificationError(error: unknown): AuthorityError {
  let code: AuthorityErrorCode = "INVALID_DECISION";
  if (error instanceof CovenantVerificationError) {
    switch (error.code) {
      case "COVENANT_ID_MISMATCH":
        code = "DECISION_COVENANT_MISMATCH";
        break;
      case "POLICY_VERSION_MISMATCH":
        code = "DECISION_POLICY_VERSION_MISMATCH";
        break;
      case "RULE_RESULTS_MISMATCH":
        code = "DECISION_RULE_RESULTS_MISMATCH";
        break;
      case "RULE_RESULTS_NOT_ALL_PASSING":
      case "DECISION_NOT_APPROVED":
        code = "DECISION_STATUS_MISMATCH";
        break;
      case "UNTRUSTED_AUTHORIZATION_SIGNER":
        code = "DECISION_SIGNER_MISMATCH";
        break;
      case "SIGNATURE_INVALID":
        code = "DECISION_SIGNATURE_INVALID";
        break;
      default:
        code = "INVALID_DECISION";
    }
  }
  return new AuthorityError(code, AUTHORITY_ERROR_MESSAGES[code]);
}

export function createAuthorityService(
  dependencies: AuthorityDependencies,
): AuthorityService {
  const approvedVendor = parseConfiguredVendor(dependencies.approvedVendor);
  const approvedProductId = parseConfiguredProduct(
    dependencies.approvedProductId,
  );
  const decisionRepository =
    dependencies.decisionRepository ?? new InMemoryDecisionRepository();
  const authorizationRepository =
    dependencies.authorizationRepository ??
    new InMemoryAuthorizationRepository();
  const nonceRepository =
    dependencies.nonceRepository ?? new InMemoryNonceRepository();

  async function loadCovenant(): Promise<LoadedCovenant> {
    const raw = await callDependency({
      operation: () => dependencies.covenantProvider.getCovenant(),
      code: "COVENANT_PROVIDER_FAILURE",
    });
    const covenant = parseTrustedCovenant(raw);
    const rawSignerAddress = await callDependency({
      operation: () => dependencies.signer.address,
      code: "SIGNER_ADDRESS_FAILURE",
    });
    let signerAddress: ReturnType<typeof parseSignerAddress>;
    try {
      signerAddress = parseSignerAddress(rawSignerAddress);
    } catch {
      throw new AuthorityError(
        "SIGNER_ADDRESS_FAILURE",
        AUTHORITY_ERROR_MESSAGES.SIGNER_ADDRESS_FAILURE,
      );
    }
    if (signerAddress !== covenant.parsed.authorizationSigner) {
      throw new AuthorityError(
        "SIGNER_MISMATCH",
        AUTHORITY_ERROR_MESSAGES.SIGNER_MISMATCH,
      );
    }
    return covenant;
  }

  async function now(): Promise<bigint> {
    return callDependency({
      operation: () => parseClockValue(dependencies.clock.now()),
      code: "CLOCK_FAILURE",
    });
  }

  async function createIdentifier(
    kind: "decision" | "authorization",
    stableContext: string,
  ) {
    const raw = await callDependency({
      operation: () =>
        dependencies.identifierGenerator.createId(kind, stableContext),
      code: "IDENTIFIER_GENERATION_FAILURE",
    });
    return parseGeneratedIdentifier(raw);
  }

  async function isAuthorizationNonceConsumed(nonce: bigint): Promise<boolean> {
    const raw = await callDependency({
      operation: () =>
        dependencies.evidenceReader.isAuthorizationNonceUsed(nonce),
      code: "EVIDENCE_READER_FAILURE",
    });
    return parseConsumedNonceResult(raw);
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
    const rawEvidence = await callDependency({
      operation: () =>
        dependencies.evidenceReader.readEvidence({
          covenantId: covenant.parsed.covenantId,
          intentHash,
          intentId: request.signedPaymentIntent.payload.intentId,
          agentNonce: request.signedPaymentIntent.payload.nonce,
        }),
      code: "EVIDENCE_READER_FAILURE",
    });
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
    const currentTime = await now();
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
          createIdentifier("decision", stableContext),
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

    const record = await callDependency({
      operation: () => decisionRepository.getOrCreate(identity, create),
      code: "DECISION_REPOSITORY_FAILURE",
      preserveAuthorityError: true,
    });
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
    const currentTime = await now();
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
    } catch {
      throw new AuthorityError(
        "INVALID_DECISION",
        AUTHORITY_ERROR_MESSAGES.INVALID_DECISION,
      );
    }

    let verifiedDecision: Awaited<
      ReturnType<typeof verifySignedDecisionReceiptForCovenant>
    >;
    try {
      verifiedDecision = await verifySignedDecisionReceiptForCovenant(
        request.rawDecisionReceipt,
        request.ruleResults,
        covenant.raw,
      );
    } catch (error) {
      throw decisionVerificationError(error);
    }

    const verifiedDecisionPayload = verifiedDecision.envelope.payload;
    const verifiedIntentPayload = request.signedPaymentIntent.payload;
    if (verifiedDecisionPayload.covenantId !== covenant.parsed.covenantId) {
      throw new AuthorityError(
        "DECISION_COVENANT_MISMATCH",
        AUTHORITY_ERROR_MESSAGES.DECISION_COVENANT_MISMATCH,
      );
    }
    if (verifiedDecisionPayload.intentId !== verifiedIntentPayload.intentId) {
      throw new AuthorityError(
        "DECISION_INTENT_ID_MISMATCH",
        AUTHORITY_ERROR_MESSAGES.DECISION_INTENT_ID_MISMATCH,
      );
    }
    if (verifiedDecisionPayload.intentHash !== evaluation.intentHash) {
      throw new AuthorityError(
        "DECISION_INTENT_HASH_MISMATCH",
        AUTHORITY_ERROR_MESSAGES.DECISION_INTENT_HASH_MISMATCH,
      );
    }
    if (
      verifiedDecisionPayload.policyVersion !== covenant.parsed.policyVersion
    ) {
      throw new AuthorityError(
        "DECISION_POLICY_VERSION_MISMATCH",
        AUTHORITY_ERROR_MESSAGES.DECISION_POLICY_VERSION_MISMATCH,
      );
    }
    if (verifiedDecisionPayload.createdAt > currentTime) {
      throw new AuthorityError(
        "DECISION_CREATED_IN_FUTURE",
        AUTHORITY_ERROR_MESSAGES.DECISION_CREATED_IN_FUTURE,
      );
    }
    if (
      verifiedDecisionPayload.decision !== "APPROVED" ||
      verifiedDecisionPayload.createdAt < verifiedIntentPayload.createdAt ||
      verifiedDecisionPayload.createdAt >= verifiedIntentPayload.expiresAt ||
      evaluation.status !== "APPROVED"
    ) {
      throw new AuthorityError(
        "DECISION_STATUS_MISMATCH",
        AUTHORITY_ERROR_MESSAGES.DECISION_STATUS_MISMATCH,
      );
    }
    if (
      hashRuleResults(request.ruleResults) !==
      hashRuleResults(evaluation.ruleResults)
    ) {
      throw new AuthorityError(
        "DECISION_RULE_RESULTS_MISMATCH",
        AUTHORITY_ERROR_MESSAGES.DECISION_RULE_RESULTS_MISMATCH,
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

    const receipt = await callDependency({
      operation: () =>
        authorizationRepository.getOrCreate(
          identity,
          async () => {
            const authorizationId = await createIdentifier(
              "authorization",
              identity,
            );
            const authorizationNonce = await callDependency({
              operation: () =>
                nonceRepository.reserve(identity, isAuthorizationNonceConsumed),
              code: "NONCE_REPOSITORY_FAILURE",
              preserveAuthorityError: true,
            });
            return { authorizationId, authorizationNonce };
          },
          async (reservation) => {
            if (
              await isAuthorizationNonceConsumed(reservation.authorizationNonce)
            ) {
              throw new AuthorityError(
                "AUTHORIZATION_NONCE_CONSUMED",
                AUTHORITY_ERROR_MESSAGES.AUTHORIZATION_NONCE_CONSUMED,
              );
            }
            return issueAuthorizationReceipt({
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
            });
          },
        ),
      code: "AUTHORIZATION_REPOSITORY_FAILURE",
      preserveAuthorityError: true,
    });

    try {
      const verified = await verifyAuthorizationReceiptLinkage({
        rawCovenant: covenant.raw,
        rawSignedPaymentIntent: request.rawSignedPaymentIntent,
        rawDecisionReceipt: request.rawDecisionReceipt,
        ruleResults: request.ruleResults,
        authorizationReceipt: receipt,
      });
      if (
        verified.signedAuthorizationReceipt.payload.validUntil <= currentTime ||
        verified.signedAuthorizationReceipt.payload.validUntil >
          invoice.expiresAt
      )
        throw new Error("Stored authorization expired");
    } catch (error) {
      if (error instanceof AuthorityError) throw error;
      throw new AuthorityError(
        "SELF_VERIFICATION_FAILED",
        AUTHORITY_ERROR_MESSAGES.SELF_VERIFICATION_FAILED,
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
