import { describe, expect, it, vi } from "vitest";
import {
  createExecutorService,
  type ExecutionRepository,
} from "../src/index.js";
import { createTestHarness } from "./fixtures.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("executor coordination and submission state", () => {
  it("joins concurrent simulation and execution operations", async () => {
    const simulationHarness = await createTestHarness();
    const simulationGate = deferred<unknown>();
    simulationHarness.dependencies.transport.simulate = (request) => {
      simulationHarness.transportState.simulations.push(request);
      return simulationGate.promise;
    };
    const simulationService = createExecutorService(
      simulationHarness.dependencies,
    );
    const simulations = [
      simulationService.simulateAuthorizedPayment(simulationHarness.request),
      simulationService.simulateAuthorizedPayment(simulationHarness.request),
    ];
    await vi.waitFor(() => {
      expect(simulationHarness.transportState.simulations).toHaveLength(1);
    });
    simulationGate.resolve({ status: "SIMULATED" });
    await expect(Promise.all(simulations)).resolves.toHaveLength(2);

    const executionHarness = await createTestHarness();
    const submissionGate = deferred<unknown>();
    executionHarness.dependencies.transport.submit = (request) => {
      executionHarness.transportState.submissions.push(request);
      return submissionGate.promise;
    };
    const executionService = createExecutorService(
      executionHarness.dependencies,
    );
    const executions = [
      executionService.executeAuthorizedPayment(executionHarness.request),
      executionService.executeAuthorizedPayment(executionHarness.request),
    ];
    await vi.waitFor(() => {
      expect(executionHarness.transportState.submissions).toHaveLength(1);
    });
    submissionGate.resolve({
      status: "SUBMITTED",
      transactionId: "joined",
    });
    const results = await Promise.all(executions);
    expect(results[0]).toEqual(results[1]);
    expect(executionHarness.transportState.submissions).toHaveLength(1);
  });

  it("returns stored success without another submission", async () => {
    const harness = await createTestHarness();
    const first = await harness.service.executeAuthorizedPayment(
      harness.request,
    );
    const second = await harness.service.executeAuthorizedPayment(
      harness.request,
    );
    expect(second).toEqual(first);
    expect(harness.transportState.submissions).toHaveLength(1);
  });

  it("allows retry after simulation failure and strict no-submission rejection", async () => {
    const simulation = await createTestHarness();
    simulation.transportState.simulationError = new Error("secret");
    await expect(
      simulation.service.executeAuthorizedPayment(simulation.request),
    ).rejects.toMatchObject({ code: "SIMULATION_FAILURE" });
    simulation.transportState.simulationError = undefined;
    await expect(
      simulation.service.executeAuthorizedPayment(simulation.request),
    ).resolves.toMatchObject({ status: "SUBMITTED" });

    const rejection = await createTestHarness();
    rejection.transportState.submissionResult = {
      status: "REJECTED",
      noSubmission: true,
    };
    await expect(
      rejection.service.executeAuthorizedPayment(rejection.request),
    ).rejects.toMatchObject({ code: "SUBMISSION_FAILURE" });
    rejection.transportState.submissionResult = {
      status: "SUBMITTED",
      transactionId: "retry",
    };
    await expect(
      rejection.service.executeAuthorizedPayment(rejection.request),
    ).resolves.toMatchObject({ status: "SUBMITTED" });
    expect(rejection.transportState.submissions).toHaveLength(2);
  });

  it.each(["exception", "malformed", "explicit ambiguity"] as const)(
    "retains %s submission ambiguity without retry",
    async (kind) => {
      const harness = await createTestHarness();
      if (kind === "exception")
        harness.transportState.submissionError = new Error("transport-secret");
      if (kind === "malformed")
        harness.transportState.submissionResult = {
          status: "SUBMITTED",
          debug: "transport-secret",
        };
      if (kind === "explicit ambiguity")
        harness.transportState.submissionResult = { status: "AMBIGUOUS" };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await expect(
          harness.service.executeAuthorizedPayment(harness.request),
        ).rejects.toMatchObject({
          code: "EXECUTION_RESULT_AMBIGUOUS",
          message: "Transaction submission result is ambiguous",
        });
      }
      expect(harness.transportState.submissions).toHaveLength(1);
    },
  );

  it("rechecks time after simulation and before submission", async () => {
    const harness = await createTestHarness();
    harness.dependencies.transport.simulate = (request) => {
      harness.transportState.simulations.push(request);
      harness.clock.value = BigInt(harness.authorizationReceipt.validUntil);
      return Promise.resolve({ status: "SIMULATED" });
    };
    const service = createExecutorService(harness.dependencies);
    await expect(
      service.executeAuthorizedPayment(harness.request),
    ).rejects.toMatchObject({ code: "EXECUTION_EXPIRED" });
    expect(harness.clock.calls).toBe(2);
    expect(harness.transportState.submissions).toHaveLength(0);
  });

  it("turns submission timeout into retained ambiguity", async () => {
    const harness = await createTestHarness();
    const gate = deferred<unknown>();
    harness.dependencies.submissionTimeoutMilliseconds = 10;
    harness.dependencies.transport.submit = (request) => {
      harness.transportState.submissions.push(request);
      return gate.promise;
    };
    const service = createExecutorService(harness.dependencies);
    await expect(
      service.executeAuthorizedPayment(harness.request),
    ).rejects.toMatchObject({ code: "EXECUTION_RESULT_AMBIGUOUS" });
    gate.resolve({ status: "SUBMITTED", transactionId: "too-late" });
    await expect(
      service.executeAuthorizedPayment(harness.request),
    ).rejects.toMatchObject({ code: "EXECUTION_RESULT_AMBIGUOUS" });
    expect(harness.transportState.submissions).toHaveLength(1);
  });

  it("retains completed or ambiguous state across post-submit repository failure", async () => {
    const postOperationFailure: ExecutionRepository = {
      coordinateSimulation: (_id, operation) => operation(),
      coordinateExecution: async (_id, operation) => {
        await operation();
        throw new Error("repository-secret");
      },
    };
    const completed = await createTestHarness();
    const completedService = createExecutorService({
      ...completed.dependencies,
      executionRepository: postOperationFailure,
    });
    await expect(
      completedService.executeAuthorizedPayment(completed.request),
    ).resolves.toMatchObject({ status: "SUBMITTED" });
    await expect(
      completedService.executeAuthorizedPayment(completed.request),
    ).resolves.toMatchObject({ status: "SUBMITTED" });
    expect(completed.transportState.submissions).toHaveLength(1);

    const ambiguous = await createTestHarness();
    ambiguous.transportState.submissionError = new Error("transport-secret");
    const ambiguousService = createExecutorService({
      ...ambiguous.dependencies,
      executionRepository: postOperationFailure,
    });
    await expect(
      ambiguousService.executeAuthorizedPayment(ambiguous.request),
    ).rejects.toMatchObject({ code: "EXECUTION_RESULT_AMBIGUOUS" });
    await expect(
      ambiguousService.executeAuthorizedPayment(ambiguous.request),
    ).rejects.toMatchObject({ code: "EXECUTION_RESULT_AMBIGUOUS" });
    expect(ambiguous.transportState.submissions).toHaveLength(1);
  });

  it("sanitizes a repository failure before all transport side effects", async () => {
    const harness = await createTestHarness();
    const repository: ExecutionRepository = {
      coordinateSimulation: () =>
        Promise.reject(new Error("repository-secret")),
      coordinateExecution: () => Promise.reject(new Error("repository-secret")),
    };
    const service = createExecutorService({
      ...harness.dependencies,
      executionRepository: repository,
    });
    let caught: unknown;
    try {
      await service.executeAuthorizedPayment(harness.request);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "EXECUTION_REPOSITORY_FAILURE" });
    expect(JSON.stringify(caught)).not.toContain("repository-secret");
    expect(harness.transportState.simulations).toHaveLength(0);
    expect(harness.transportState.submissions).toHaveLength(0);
  });
});
