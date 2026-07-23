import {
  ARC_TESTNET_CHAIN_ID,
  CovenantVerificationError,
  EIP712_DOMAIN_NAMES,
  covenantSpecSchema,
  deriveSigningDomainForCovenant,
  hashAuthorizationReceipt,
  hashDecisionReceipt,
  verifyAuthorizationChain,
} from "@covenant/spec";
import { encodeAbiParameters, keccak256, stringToHex } from "viem";
import { constructExecutePaymentRequest } from "./calldata/prepare-execute-payment.js";
import {
  ExecutorError,
  executorFailure,
  sanitizedExecutorError,
} from "./errors.js";
import type { Clock } from "./ports/clock.js";
import type { CovenantProvider } from "./ports/covenant-provider.js";
import type { ExecutionRepository } from "./ports/execution-repository.js";
import type { TransactionTransport } from "./ports/transaction-transport.js";
import { InMemoryExecutionRepository } from "./repositories/in-memory-execution-repository.js";
import {
  parseClockValue,
  parseExecutionRequest,
  parseSubmissionTimeout,
  simulationTransportResultSchema,
  submissionTransportResultSchema,
} from "./schemas.js";
import type {
  AuthorizedTransactionRequest,
  ExecutionResult,
  PreparedExecution,
  SimulationResult,
} from "./types.js";

const EXECUTOR_IDENTITY_DOMAIN = keccak256(
  stringToHex("Covenant Executor Execution Identity v1"),
);

type InternalPreparation = {
  public: PreparedExecution;
  transaction: AuthorizedTransactionRequest;
  validAfter: bigint;
  intentCreatedAt: bigint;
  decisionCreatedAt: bigint;
};

type LocalSubmissionState =
  | { status: "STARTED" }
  | { status: "RETRYABLE_REJECTED" }
  | { status: "AMBIGUOUS" }
  | { status: "COMPLETED"; result: ExecutionResult };

function authorizationChainError(error: unknown): ExecutorError {
  if (error instanceof CovenantVerificationError) {
    if (error.code === "DECISION_NOT_APPROVED")
      return new ExecutorError("DECISION_NOT_APPROVED");
    if (error.code === "RULE_RESULTS_NOT_ALL_PASSING")
      return new ExecutorError("RULES_NOT_APPROVED");
    if (error.code === "VAULT_MISMATCH")
      return new ExecutorError("EXECUTION_TARGET_MISMATCH");
    if (error.code === "CHAIN_MISMATCH")
      return new ExecutorError("EXECUTION_CHAIN_MISMATCH");
    if (error.code === "TOKEN_MISMATCH")
      return new ExecutorError("EXECUTION_TOKEN_MISMATCH");
    if (error.code === "RECIPIENT_MISMATCH")
      return new ExecutorError("EXECUTION_RECIPIENT_MISMATCH");
  }
  return new ExecutorError("INVALID_AUTHORIZATION_CHAIN");
}

export type ExecutorDependencies = {
  clock: Clock;
  covenantProvider: CovenantProvider;
  transport: TransactionTransport;
  executionRepository?: ExecutionRepository;
  submissionTimeoutMilliseconds?: unknown;
};

export type ExecutorService = {
  prepareExecution(request: unknown): Promise<PreparedExecution>;
  simulateAuthorizedPayment(request: unknown): Promise<SimulationResult>;
  executeAuthorizedPayment(request: unknown): Promise<ExecutionResult>;
};

function assertCurrentTime(
  preparation: InternalPreparation,
  now: bigint,
): void {
  if (
    now < preparation.validAfter ||
    now >= preparation.public.covenantValidUntil ||
    now < preparation.intentCreatedAt ||
    now >= preparation.public.intentExpiresAt ||
    preparation.decisionCreatedAt > now ||
    now >= preparation.public.authorizationValidUntil
  ) {
    executorFailure("EXECUTION_EXPIRED");
  }
}

function withTimeout<T>(
  operation: Promise<T>,
  milliseconds: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("submission timeout"));
    }, milliseconds);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("submission failed"));
      },
    );
  });
}

export function createExecutorService(
  dependencies: ExecutorDependencies,
): ExecutorService {
  const repository =
    dependencies.executionRepository ?? new InMemoryExecutionRepository();
  const timeout = parseSubmissionTimeout(
    dependencies.submissionTimeoutMilliseconds ?? 10_000,
  );
  const localSubmissions = new Map<string, LocalSubmissionState>();
  const pendingSimulations = new Map<string, Promise<SimulationResult>>();
  const pendingExecutions = new Map<string, Promise<ExecutionResult>>();

  function currentTime(): Promise<bigint> {
    try {
      return Promise.resolve(parseClockValue(dependencies.clock.now()));
    } catch {
      return Promise.reject(new ExecutorError("CLOCK_FAILURE"));
    }
  }

  async function prepareInternal(input: unknown): Promise<InternalPreparation> {
    const request = parseExecutionRequest(input);
    let rawCovenant: unknown;
    try {
      rawCovenant = await dependencies.covenantProvider.getCovenant();
      covenantSpecSchema.parse(rawCovenant);
    } catch {
      throw new ExecutorError("COVENANT_PROVIDER_FAILURE");
    }
    const now = await currentTime();

    let verified: Awaited<ReturnType<typeof verifyAuthorizationChain>>;
    try {
      verified = await verifyAuthorizationChain(
        rawCovenant,
        request.raw.signedPaymentIntent,
        request.raw.decisionReceipt,
        request.raw.ruleResults,
        request.raw.authorizationReceipt,
      );
    } catch (error) {
      throw authorizationChainError(error);
    }

    const covenant = verified.covenantSpec;
    const intent = verified.signedPaymentIntent.payload;
    const decision = verified.signedDecisionReceipt.payload;
    const authorization = verified.signedAuthorizationReceipt.payload;

    if (decision.decision !== "APPROVED") {
      executorFailure("DECISION_NOT_APPROVED");
    }
    if (
      verified.canonicalRuleResults.some((result) => result.status !== "PASS")
    ) {
      executorFailure("RULES_NOT_APPROVED");
    }
    if (
      covenant.chainId !== ARC_TESTNET_CHAIN_ID ||
      authorization.chainId !== ARC_TESTNET_CHAIN_ID
    ) {
      executorFailure("EXECUTION_CHAIN_MISMATCH");
    }
    if (authorization.vaultAddress !== covenant.vaultAddress) {
      executorFailure("EXECUTION_TARGET_MISMATCH");
    }
    if (intent.token !== covenant.tokenAddress) {
      executorFailure("EXECUTION_TOKEN_MISMATCH");
    }
    if (intent.recipient !== covenant.recipientAddress) {
      executorFailure("EXECUTION_RECIPIENT_MISMATCH");
    }

    const decisionDomain = deriveSigningDomainForCovenant(
      rawCovenant,
      EIP712_DOMAIN_NAMES.decisionReceipt,
    );
    const authorizationDomain = deriveSigningDomainForCovenant(
      rawCovenant,
      EIP712_DOMAIN_NAMES.authorizationReceipt,
    );
    const decisionDigest = hashDecisionReceipt(
      (request.raw.decisionReceipt as { payload: unknown }).payload,
      decisionDomain,
    );
    const authorizationDigest = hashAuthorizationReceipt(
      (request.raw.authorizationReceipt as { payload: unknown }).payload,
      authorizationDomain,
    );
    const executionId = keccak256(
      encodeAbiParameters(
        [
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "bytes32" },
          { type: "uint256" },
          { type: "address" },
          { type: "uint256" },
        ],
        [
          EXECUTOR_IDENTITY_DOMAIN,
          covenant.covenantId,
          intent.intentId,
          verified.intentHash,
          decision.decisionId,
          decisionDigest,
          authorization.authorizationId,
          authorizationDigest,
          authorization.authorizationNonce,
          covenant.vaultAddress,
          covenant.chainId,
        ],
      ),
    );
    const transaction = constructExecutePaymentRequest({
      chainId: ARC_TESTNET_CHAIN_ID,
      target: covenant.vaultAddress,
      signedPaymentIntent: verified.signedPaymentIntent,
      signedAuthorizationReceipt: verified.signedAuthorizationReceipt,
    });
    const prepared = Object.freeze({
      executionId,
      intentDigest: verified.intentHash,
      decisionDigest,
      authorizationDigest,
      chainId: ARC_TESTNET_CHAIN_ID,
      target: covenant.vaultAddress,
      value: 0n,
      data: transaction.data,
      covenantValidUntil: covenant.validUntil,
      intentExpiresAt: intent.expiresAt,
      authorizationValidUntil: authorization.validUntil,
    }) satisfies PreparedExecution;
    const internal = {
      public: prepared,
      transaction,
      validAfter: covenant.validAfter,
      intentCreatedAt: intent.createdAt,
      decisionCreatedAt: decision.createdAt,
    };
    assertCurrentTime(internal, now);
    return internal;
  }

  async function simulate(
    preparation: InternalPreparation,
  ): Promise<SimulationResult> {
    try {
      const raw = await dependencies.transport.simulate(
        preparation.transaction,
      );
      simulationTransportResultSchema.parse(raw);
    } catch {
      throw new ExecutorError("SIMULATION_FAILURE");
    }
    return Object.freeze({
      status: "SIMULATED",
      execution: preparation.public,
    });
  }

  async function prepareExecution(input: unknown): Promise<PreparedExecution> {
    return (await prepareInternal(input)).public;
  }

  async function simulateAuthorizedPayment(
    input: unknown,
  ): Promise<SimulationResult> {
    const preparation = await prepareInternal(input);
    const identity = preparation.public.executionId;
    const existing = pendingSimulations.get(identity);
    if (existing !== undefined) return existing;
    const operation = (async () => {
      try {
        return await repository.coordinateSimulation(identity, () =>
          simulate(preparation),
        );
      } catch (error) {
        if (error instanceof ExecutorError) throw sanitizedExecutorError(error);
        throw new ExecutorError("EXECUTION_REPOSITORY_FAILURE");
      }
    })();
    pendingSimulations.set(identity, operation);
    try {
      return await operation;
    } finally {
      if (pendingSimulations.get(identity) === operation)
        pendingSimulations.delete(identity);
    }
  }

  async function executeAuthorizedPayment(
    input: unknown,
  ): Promise<ExecutionResult> {
    const preparation = await prepareInternal(input);
    const identity = preparation.public.executionId;
    const pending = pendingExecutions.get(identity);
    if (pending !== undefined) return pending;
    const existing = localSubmissions.get(identity);
    if (existing?.status === "COMPLETED") return existing.result;
    if (existing?.status === "AMBIGUOUS" || existing?.status === "STARTED") {
      throw new ExecutorError("EXECUTION_RESULT_AMBIGUOUS");
    }

    const operation = (async () => {
      try {
        return await repository.coordinateExecution(identity, async () => {
          const joinedState = localSubmissions.get(identity);
          if (joinedState?.status === "COMPLETED") return joinedState.result;
          if (
            joinedState?.status === "AMBIGUOUS" ||
            joinedState?.status === "STARTED"
          ) {
            throw new ExecutorError("EXECUTION_RESULT_AMBIGUOUS");
          }

          await simulate(preparation);
          assertCurrentTime(preparation, await currentTime());
          localSubmissions.set(identity, { status: "STARTED" });

          let submitted: ReturnType<
            typeof submissionTransportResultSchema.parse
          >;
          try {
            const raw = await withTimeout(
              dependencies.transport.submit(preparation.transaction),
              timeout,
            );
            submitted = submissionTransportResultSchema.parse(raw);
          } catch {
            localSubmissions.set(identity, { status: "AMBIGUOUS" });
            throw new ExecutorError("EXECUTION_RESULT_AMBIGUOUS");
          }

          if (submitted.status === "AMBIGUOUS") {
            localSubmissions.set(identity, { status: "AMBIGUOUS" });
            throw new ExecutorError("EXECUTION_RESULT_AMBIGUOUS");
          }
          if (submitted.status === "REJECTED") {
            localSubmissions.set(identity, { status: "RETRYABLE_REJECTED" });
            throw new ExecutorError("SUBMISSION_FAILURE");
          }

          const result = Object.freeze({
            status: "SUBMITTED",
            execution: preparation.public,
            transactionId: submitted.transactionId,
          }) satisfies ExecutionResult;
          localSubmissions.set(identity, { status: "COMPLETED", result });
          return result;
        });
      } catch (error) {
        const state = localSubmissions.get(identity);
        if (state?.status === "COMPLETED") return state.result;
        if (state?.status === "STARTED") {
          localSubmissions.set(identity, { status: "AMBIGUOUS" });
          throw new ExecutorError("EXECUTION_RESULT_AMBIGUOUS");
        }
        if (state?.status === "AMBIGUOUS") {
          throw new ExecutorError("EXECUTION_RESULT_AMBIGUOUS");
        }
        if (error instanceof ExecutorError) throw sanitizedExecutorError(error);
        throw new ExecutorError("EXECUTION_REPOSITORY_FAILURE");
      }
    })();
    pendingExecutions.set(identity, operation);
    try {
      return await operation;
    } finally {
      if (pendingExecutions.get(identity) === operation)
        pendingExecutions.delete(identity);
    }
  }

  return {
    prepareExecution,
    simulateAuthorizedPayment,
    executeAuthorizedPayment,
  };
}
