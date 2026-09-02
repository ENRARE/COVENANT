import {
  applyExecutionEvidence,
  assertProjectOwnership,
  requestExecution,
  type ExecutionEvidence,
  type PlatformCovenant,
} from "@covenant/core";
import { CovenantDomainError } from "@covenant/core";
import { runtimeFailure } from "./errors.js";
import { type RetryReason, type RuntimeState } from "./constants.js";
import { DurableRuntimeStore } from "./store.js";
import type {
  ExecutionAdapter,
  ExecutionStartInput,
  ReconciliationInput,
  RuntimeClock,
  RuntimeOperation,
  RuntimeOutboxRecord,
  SimulationOutcome,
  SubmissionOutcome,
} from "./types.js";

const DEFAULT_CLOCK: RuntimeClock = Object.freeze({ now: () => Date.now() });
const MAX_RETRY_DELAY_MS = 86_400_000;

function positiveAt(value: string): string {
  if (!/^(0|[1-9]\d*)$/u.test(value) || BigInt(value) <= 0n) {
    runtimeFailure(
      "RUNTIME_PERSISTENCE_FAILURE",
      "Core evaluation timestamp is invalid",
    );
  }
  return value;
}

function sanitizedReason(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 256);
  return "Runtime operation failed";
}

function retryAt(now: number, attempt: number): number {
  const delay = Math.min(1000 * 2 ** Math.min(attempt, 10), MAX_RETRY_DELAY_MS);
  return now + delay;
}

export type DurableExecutionRuntimeOptions = Readonly<{
  store: DurableRuntimeStore;
  adapter: ExecutionAdapter;
  clock?: RuntimeClock;
  leaseMs?: number;
}>;

export class DurableExecutionRuntime {
  readonly #store: DurableRuntimeStore;
  readonly #adapter: ExecutionAdapter;
  readonly #clock: RuntimeClock;
  readonly #leaseMs: number;

  constructor(options: DurableExecutionRuntimeOptions) {
    this.#store = options.store;
    this.#adapter = options.adapter;
    this.#clock = options.clock ?? DEFAULT_CLOCK;
    this.#leaseMs = options.leaseMs ?? 30_000;
  }

  get store(): DurableRuntimeStore {
    return this.#store;
  }

  saveCovenant(
    projectId: string,
    resource: unknown,
  ): ReturnType<DurableRuntimeStore["saveCovenant"]> {
    return this.#store.saveCovenant(projectId, resource, this.#clock.now());
  }

  startExecution(input: ExecutionStartInput): Readonly<{
    operation: RuntimeOperation;
    covenant: PlatformCovenant;
    joined: boolean;
  }> {
    const at = positiveAt(input.at);
    const covenantProjection = this.#store.getCovenant(
      input.projectId,
      input.covenantId,
    );
    if (covenantProjection === undefined)
      runtimeFailure("RUNTIME_NOT_FOUND", "Covenant projection was not found");
    assertProjectOwnership(covenantProjection.resource, input.projectId);
    const existing = this.#store.getOperation(input.operationKey);
    if (existing !== undefined) {
      if (
        existing.projectId !== input.projectId ||
        existing.covenantId !== input.covenantId ||
        existing.executionId !== input.executionId
      ) {
        runtimeFailure(
          "RUNTIME_CONFLICT",
          "Execution identity or project conflicts",
        );
      }
      return {
        operation: existing,
        covenant: covenantProjection.resource,
        joined: true,
      };
    }
    const next = requestExecution(covenantProjection.resource, {
      executionId: input.executionId,
      at,
    });
    const authorizationId = next.authorizationStatus.authorizationId;
    const intentId = next.authorizationStatus.intentId;
    const intentHash = next.authorizationStatus.intentHash;
    if (authorizationId === null || intentId === null || intentHash === null) {
      runtimeFailure(
        "RUNTIME_CONFLICT",
        "Executing Covenant is missing authorization identity",
      );
    }
    const result = this.#store.createOrJoinOperation({
      projectId: input.projectId,
      covenantId: input.covenantId,
      executionId: input.executionId,
      operationKey: input.operationKey,
      authorizationId,
      intentId,
      intentHash,
      amount: next.amount,
      beneficiary: next.beneficiary,
      resource: next,
      at: this.#clock.now(),
    });
    if (!result.joined) {
      const projection = this.#store.getCovenant(
        input.projectId,
        input.covenantId,
      );
      if (projection === undefined)
        runtimeFailure("RUNTIME_PERSISTENCE_FAILURE");
      return {
        operation: result.operation,
        covenant: projection.resource,
        joined: false,
      };
    }
    const projection = this.#store.getCovenant(
      input.projectId,
      input.covenantId,
    );
    if (projection === undefined) runtimeFailure("RUNTIME_PERSISTENCE_FAILURE");
    return {
      operation: result.operation,
      covenant: projection.resource,
      joined: true,
    };
  }

  claim(operationKey: string, workerId: string): RuntimeOperation | undefined {
    return this.#store.claimOperation(
      operationKey,
      workerId,
      this.#clock.now(),
      this.#leaseMs,
    );
  }

  recoverExpiredLeases(): RuntimeOperation[] {
    return this.#store.recoverExpiredLeases(this.#clock.now());
  }

  #transition(
    operation: RuntimeOperation,
    workerId: string,
    state: RuntimeState,
    patch = {},
  ) {
    return this.#store.transitionLeased(
      operation.operationKey,
      workerId,
      operation.version,
      state,
      this.#clock.now(),
      patch,
    );
  }

  #release(operation: RuntimeOperation, workerId: string): RuntimeOperation {
    return this.#store.releaseLease(
      operation.operationKey,
      workerId,
      operation.version,
      this.#clock.now(),
    );
  }

  async process(
    operationKey: string,
    workerId: string,
  ): Promise<RuntimeOperation> {
    let operation = this.#store.getOperation(operationKey);
    if (operation === undefined)
      runtimeFailure("RUNTIME_NOT_FOUND", "Execution operation was not found");
    if (
      operation.state === "SUCCEEDED" ||
      operation.state === "TERMINAL_FAILED"
    )
      return operation;
    const claimed = this.#store.claimOperation(
      operationKey,
      workerId,
      this.#clock.now(),
      this.#leaseMs,
    );
    if (claimed === undefined)
      runtimeFailure("LEASE_LOST", "Execution is leased by another worker");
    operation = claimed;
    if (
      operation.state === "AMBIGUOUS" ||
      operation.state === "SUBMITTED" ||
      operation.state === "RECONCILING"
    )
      return operation;

    if (operation.state === "QUEUED")
      operation = this.#transition(operation, workerId, "PREPARING");
    if (operation.state === "PREPARING")
      operation = this.#transition(operation, workerId, "SIMULATING");
    if (operation.state === "SIMULATING") {
      let simulation: SimulationOutcome;
      try {
        simulation = await this.#adapter.simulate(operation);
      } catch (error) {
        return this.#retry(
          operation,
          workerId,
          "SIMULATION_FAILURE",
          sanitizedReason(error),
        );
      }
      if (simulation.status === "NO_SUBMISSION") {
        return this.#retry(
          operation,
          workerId,
          "SIMULATION_FAILURE",
          simulation.reason,
        );
      }
      operation = this.#transition(operation, workerId, "READY_TO_SUBMIT");
    }

    if (operation.state !== "READY_TO_SUBMIT") return operation;
    // This transaction is the durable submission boundary. It must commit
    // before the adapter is called, so a crash cannot lead to an automatic
    // second submission.
    operation = this.#transition(operation, workerId, "SUBMISSION_STARTED", {
      submissionBoundary: true,
      attemptCount: operation.attemptCount + 1,
    });
    let submission: SubmissionOutcome;
    try {
      submission = await this.#adapter.submit(operation);
    } catch (error) {
      return this.#ambiguous(
        operation,
        workerId,
        "SUBMISSION_EXCEPTION",
        sanitizedReason(error),
      );
    }
    if (submission.status === "NO_SUBMISSION") {
      // A provider must explicitly attest that no dispatch occurred before a
      // retry is permitted. Timeout/exception paths are always ambiguous.
      return this.#retry(
        operation,
        workerId,
        "PROVIDER_NO_SUBMISSION",
        submission.reason,
      );
    }
    return this.#release(
      this.#transition(operation, workerId, "SUBMITTED", {
        providerTransactionId: submission.transactionId,
        providerState: submission.providerState ?? "ACCEPTED",
        providerEvidence: {
          status: "ACCEPTED",
          transactionId: submission.transactionId,
        },
      }),
      workerId,
    );
  }

  #retry(
    operation: RuntimeOperation,
    workerId: string,
    reason: RetryReason,
    failureReason: string,
  ): RuntimeOperation {
    if (operation.submissionBoundary && reason !== "PROVIDER_NO_SUBMISSION") {
      return this.#ambiguous(
        operation,
        workerId,
        "PROVIDER_OUTCOME_UNKNOWN",
        failureReason,
      );
    }
    return this.#release(
      this.#transition(operation, workerId, "QUEUED", {
        retryReason: reason,
        noResubmitReason: null,
        submissionBoundary:
          reason === "PROVIDER_NO_SUBMISSION" ? false : undefined,
        failureReason,
        nextAttemptAt: retryAt(this.#clock.now(), operation.attemptCount),
        attemptCount: operation.attemptCount + 1,
      }),
      workerId,
    );
  }

  #ambiguous(
    operation: RuntimeOperation,
    workerId: string,
    reason:
      | "SUBMISSION_TIMEOUT"
      | "SUBMISSION_EXCEPTION"
      | "DISPATCH_UNKNOWN"
      | "CRASH_AFTER_BOUNDARY"
      | "PROVIDER_OUTCOME_UNKNOWN",
    failureReason: string,
  ): RuntimeOperation {
    return this.#release(
      this.#transition(operation, workerId, "AMBIGUOUS", {
        noResubmitReason: reason,
        failureReason,
      }),
      workerId,
    );
  }

  reconcile(
    input: ReconciliationInput,
  ): Readonly<{ operation: RuntimeOperation; covenant: PlatformCovenant }> {
    const operation = this.#store.getOperation(input.operationKey);
    if (operation === undefined)
      runtimeFailure("RUNTIME_NOT_FOUND", "Execution operation was not found");
    if (operation.projectId !== input.projectId)
      runtimeFailure("RUNTIME_CONFLICT", "Project isolation violation");
    if (
      operation.state === "SUCCEEDED" ||
      operation.state === "TERMINAL_FAILED"
    ) {
      const projection = this.#store.getCovenant(
        operation.projectId,
        operation.covenantId,
      );
      if (projection === undefined)
        runtimeFailure("RUNTIME_PERSISTENCE_FAILURE");
      return { operation, covenant: projection.resource };
    }
    const claimed = this.#store.claimOperation(
      operation.operationKey,
      input.workerId,
      this.#clock.now(),
      this.#leaseMs,
    );
    if (claimed === undefined)
      runtimeFailure(
        "LEASE_LOST",
        "Reconciliation is leased by another worker",
      );
    let current = claimed;
    if (current.state === "SUBMITTED" || current.state === "AMBIGUOUS") {
      current = this.#store.transitionLeased(
        current.operationKey,
        input.workerId,
        current.version,
        "RECONCILING",
        this.#clock.now(),
        {
          providerTransactionId:
            input.providerTransactionId ?? current.providerTransactionId,
          providerState:
            input.providerState ?? current.providerState ?? "ACCEPTED",
          providerEvidence: {
            status: "ACCEPTED",
            transactionId:
              input.providerTransactionId ?? current.providerTransactionId,
          },
        },
      );
    }
    const projection = this.#store.getCovenant(
      current.projectId,
      current.covenantId,
    );
    if (projection === undefined) runtimeFailure("RUNTIME_PERSISTENCE_FAILURE");
    const provider = input.providerState ?? current.providerState ?? "ACCEPTED";
    const evidence: ExecutionEvidence = {
      covenantId: current.covenantId as `0x${string}`,
      executionId: current.executionId as `0x${string}`,
      provider: provider === "ACCEPTED" ? "ACCEPTED" : "UNKNOWN",
      arc: input.arc,
    };
    let nextCovenant: PlatformCovenant;
    try {
      nextCovenant = applyExecutionEvidence(
        projection.resource,
        evidence,
        positiveAt(input.at),
      );
    } catch (error) {
      if (
        error instanceof CovenantDomainError &&
        error.code === "EVIDENCE_CONFLICT"
      ) {
        const failed = this.#release(
          this.#store.transitionLeased(
            current.operationKey,
            input.workerId,
            current.version,
            "TERMINAL_FAILED",
            this.#clock.now(),
            {
              noResubmitReason: "EVIDENCE_CONFLICT",
              failureReason: error.message,
            },
          ),
          input.workerId,
        );
        return { operation: failed, covenant: projection.resource };
      }
      throw error;
    }
    if (nextCovenant.status === "EXECUTED") {
      const result = this.#store.updateCovenantAndOperation(
        current.operationKey,
        input.workerId,
        current.version,
        nextCovenant,
        "SUCCEEDED",
        this.#clock.now(),
        {
          arcEvidence: input.arc,
          providerEvidence: {
            status: "ACCEPTED",
            transactionId:
              input.providerTransactionId ?? current.providerTransactionId,
          },
          providerTransactionId:
            input.providerTransactionId ?? current.providerTransactionId,
          providerState: provider,
        },
      );
      return {
        operation: this.#release(result.operation, input.workerId),
        covenant: result.covenant.resource,
      };
    }
    if (nextCovenant.status === "FAILED") {
      const result = this.#store.updateCovenantAndOperation(
        current.operationKey,
        input.workerId,
        current.version,
        nextCovenant,
        "TERMINAL_FAILED",
        this.#clock.now(),
        {
          arcEvidence: input.arc,
          providerState: provider,
          failureReason:
            nextCovenant.executionStatus.failureReason ??
            "Arc execution failed",
        },
      );
      return {
        operation: this.#release(result.operation, input.workerId),
        covenant: result.covenant.resource,
      };
    }
    const retry = this.#store.transitionLeased(
      current.operationKey,
      input.workerId,
      current.version,
      "RECONCILING",
      this.#clock.now(),
      {
        arcEvidence: input.arc,
        providerState: provider,
        retryReason: "ARC_OBSERVATION_UNAVAILABLE",
        nextAttemptAt: retryAt(this.#clock.now(), current.attemptCount),
      },
    );
    return {
      operation: this.#release(retry, input.workerId),
      covenant: projection.resource,
    };
  }

  listOutbox(undeliveredOnly = true): RuntimeOutboxRecord[] {
    return this.#store.listOutbox({ undeliveredOnly });
  }
}
