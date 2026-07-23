import { describe, expect, it, vi } from "vitest";
import {
  createExecutorService,
  ExecutorError,
  type ExecutionRepository,
  type ExecutionResult,
} from "../src/index.js";
import { createTestHarness } from "./fixtures.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function invokeThenRejectRepository(): ExecutionRepository {
  return {
    coordinateSimulation: (_id, operation) => operation(),
    coordinateExecution: (_id, operation) => {
      void operation().catch(() => undefined);
      return Promise.reject(
        new Error("repository rejected after invoking operation"),
      );
    },
  };
}

describe("executor coordination and submission state", () => {
  it("keeps invoke-then-reject execution single-flight until the core operation settles", async () => {
    const harness = await createTestHarness();
    const simulationGate = deferred<unknown>();
    harness.dependencies.transport.simulate = (request) => {
      harness.transportState.simulations.push(request);
      return simulationGate.promise;
    };
    const service = createExecutorService({
      ...harness.dependencies,
      executionRepository: invokeThenRejectRepository(),
    });
    const first = service.executeAuthorizedPayment(harness.request);
    const second = service.executeAuthorizedPayment(harness.request);
    await vi.waitFor(() => {
      expect(harness.transportState.simulations).toHaveLength(1);
    });
    simulationGate.resolve({ status: "SIMULATED" });
    const results = await Promise.all([first, second]);
    expect(results[0]).toBe(results[1]);
    expect(results[0]).toMatchObject({ status: "SUBMITTED" });
    expect(harness.transportState.simulations).toHaveLength(1);
    expect(harness.transportState.submissions).toHaveLength(1);
  });

  it("returns one core promise when a repository invokes the callback more than once", async () => {
    const harness = await createTestHarness();
    let callbacksSharedPromise = false;
    const repository: ExecutionRepository = {
      coordinateSimulation: (_id, operation) => operation(),
      coordinateExecution: async (_id, operation) => {
        const first = operation();
        const second = operation();
        callbacksSharedPromise = first === second;
        return first;
      },
    };
    const service = createExecutorService({
      ...harness.dependencies,
      executionRepository: repository,
    });
    await expect(
      service.executeAuthorizedPayment(harness.request),
    ).resolves.toMatchObject({ status: "SUBMITTED" });
    expect(callbacksSharedPromise).toBe(true);
    expect(harness.transportState.simulations).toHaveLength(1);
    expect(harness.transportState.submissions).toHaveLength(1);
  });

  it("settles from the core operation when repository coordination never settles", async () => {
    const harness = await createTestHarness();
    const repository: ExecutionRepository = {
      coordinateSimulation: (_id, operation) => operation(),
      coordinateExecution: (_id, operation) => {
        void operation().catch(() => undefined);
        return new Promise(() => undefined);
      },
    };
    const service = createExecutorService({
      ...harness.dependencies,
      executionRepository: repository,
    });
    await expect(
      service.executeAuthorizedPayment(harness.request),
    ).resolves.toMatchObject({ status: "SUBMITTED" });
    expect(harness.transportState.simulations).toHaveLength(1);
    expect(harness.transportState.submissions).toHaveLength(1);
  });

  it.each(["crafted result", "crafted executor error"] as const)(
    "rejects a repository %s when the core callback was not invoked",
    async (kind) => {
      const harness = await createTestHarness();
      const repository: ExecutionRepository = {
        coordinateSimulation: (_id, operation) => operation(),
        coordinateExecution: () => {
          if (kind === "crafted executor error") {
            return Promise.reject(new ExecutorError("SUBMISSION_FAILURE"));
          }
          return Promise.resolve({
            status: "SUBMITTED",
            execution: {} as ExecutionResult["execution"],
            transactionId: "crafted-result",
          });
        },
      };
      const service = createExecutorService({
        ...harness.dependencies,
        executionRepository: repository,
      });
      await expect(
        service.executeAuthorizedPayment(harness.request),
      ).rejects.toMatchObject({
        code: "EXECUTION_REPOSITORY_FAILURE",
        message: "Execution coordination failed",
      });
      expect(harness.transportState.simulations).toHaveLength(0);
      expect(harness.transportState.submissions).toHaveLength(0);
    },
  );

  it("keeps invoke-then-reject simulation failures retryable without a pending gap", async () => {
    const harness = await createTestHarness();
    harness.transportState.simulationError = new Error("simulation-secret");
    const service = createExecutorService({
      ...harness.dependencies,
      executionRepository: invokeThenRejectRepository(),
    });
    const attempts = [
      service.executeAuthorizedPayment(harness.request),
      service.executeAuthorizedPayment(harness.request),
    ];
    const failures = await Promise.allSettled(attempts);
    expect(failures).toHaveLength(2);
    for (const failure of failures) {
      expect(failure).toMatchObject({
        status: "rejected",
        reason: { code: "SIMULATION_FAILURE" },
      });
    }
    expect(harness.transportState.simulations).toHaveLength(1);
    expect(harness.transportState.submissions).toHaveLength(0);

    harness.transportState.simulationError = undefined;
    await expect(
      service.executeAuthorizedPayment(harness.request),
    ).resolves.toMatchObject({ status: "SUBMITTED" });
    expect(harness.transportState.simulations).toHaveLength(2);
    expect(harness.transportState.submissions).toHaveLength(1);
  });

  it.each(["exception", "malformed"] as const)(
    "retains invoke-then-reject %s submission ambiguity",
    async (kind) => {
      const harness = await createTestHarness();
      if (kind === "exception") {
        harness.transportState.submissionError = new Error("transport-secret");
      } else {
        harness.transportState.submissionResult = {
          status: "SUBMITTED",
          transportReference: "transport-secret",
        };
      }
      const service = createExecutorService({
        ...harness.dependencies,
        executionRepository: invokeThenRejectRepository(),
      });
      const attempts = [
        service.executeAuthorizedPayment(harness.request),
        service.executeAuthorizedPayment(harness.request),
      ];
      for (const attempt of attempts) {
        await expect(attempt).rejects.toMatchObject({
          code: "EXECUTION_RESULT_AMBIGUOUS",
        });
      }
      await expect(
        service.executeAuthorizedPayment(harness.request),
      ).rejects.toMatchObject({ code: "EXECUTION_RESULT_AMBIGUOUS" });
      expect(harness.transportState.simulations).toHaveLength(1);
      expect(harness.transportState.submissions).toHaveLength(1);
    },
  );

  it("retries invoke-then-reject only after strict no-submission rejection", async () => {
    const harness = await createTestHarness();
    harness.transportState.submissionResult = {
      status: "REJECTED",
      noSubmission: true,
    };
    const service = createExecutorService({
      ...harness.dependencies,
      executionRepository: invokeThenRejectRepository(),
    });
    const attempts = [
      service.executeAuthorizedPayment(harness.request),
      service.executeAuthorizedPayment(harness.request),
    ];
    for (const attempt of attempts) {
      await expect(attempt).rejects.toMatchObject({
        code: "SUBMISSION_FAILURE",
      });
    }
    expect(harness.transportState.simulations).toHaveLength(1);
    expect(harness.transportState.submissions).toHaveLength(1);

    harness.transportState.submissionResult = {
      status: "SUBMITTED",
      transactionId: "retry-after-confirmed-rejection",
    };
    await expect(
      service.executeAuthorizedPayment(harness.request),
    ).resolves.toMatchObject({ status: "SUBMITTED" });
    expect(harness.transportState.simulations).toHaveLength(2);
    expect(harness.transportState.submissions).toHaveLength(2);
  });

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

  it.each([
    ["false noSubmission", { status: "REJECTED", noSubmission: false }],
    ["missing noSubmission", { status: "REJECTED" }],
    ["string noSubmission", { status: "REJECTED", noSubmission: "true" }],
    ["numeric noSubmission", { status: "REJECTED", noSubmission: 1 }],
    [
      "extra rejection field",
      { status: "REJECTED", noSubmission: true, debug: "transport-secret" },
    ],
    ["unknown status", { status: "UNKNOWN", detail: "transport-secret" }],
    ["missing status", { transactionId: "transport-secret" }],
    ["null result", null],
    ["array result", [{ status: "SUBMITTED" }]],
    [
      "malformed transport reference",
      { status: "SUBMITTED", transactionId: "" },
    ],
  ] as const)(
    "retains ambiguity for malformed submission result: %s",
    async (_name, submissionResult) => {
      const harness = await createTestHarness();
      harness.transportState.submissionResult = submissionResult;
      let caught: unknown;
      try {
        await harness.service.executeAuthorizedPayment(harness.request);
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        code: "EXECUTION_RESULT_AMBIGUOUS",
        message: "Transaction submission result is ambiguous",
      });
      expect(caught).not.toHaveProperty("cause");
      expect(caught).not.toHaveProperty("stack");
      expect(JSON.stringify(caught)).toBe(
        '{"name":"ExecutorError","code":"EXECUTION_RESULT_AMBIGUOUS","message":"Transaction submission result is ambiguous"}',
      );
      await expect(
        harness.service.executeAuthorizedPayment(harness.request),
      ).rejects.toMatchObject({ code: "EXECUTION_RESULT_AMBIGUOUS" });
      expect(harness.transportState.submissions).toHaveLength(1);
      expect(JSON.stringify(caught)).not.toContain("transport-secret");
      expect(JSON.stringify(caught)).not.toContain(
        harness.request.signedPaymentIntent.signature,
      );
    },
  );

  it.each(["thrown exception", "timeout-shaped rejection"] as const)(
    "sanitizes and retains submission ambiguity for %s",
    async (kind) => {
      const harness = await createTestHarness();
      if (kind === "thrown exception") {
        harness.dependencies.transport.submit = (request) => {
          harness.transportState.submissions.push(request);
          throw new Error("https://secret.invalid rpc-token");
        };
      } else {
        harness.transportState.submissionError = new Error(
          "ETIMEDOUT https://secret.invalid",
        );
      }
      const service = createExecutorService(harness.dependencies);
      let caught: unknown;
      try {
        await service.executeAuthorizedPayment(harness.request);
      } catch (error) {
        caught = error;
      }
      expect(JSON.stringify(caught)).toBe(
        '{"name":"ExecutorError","code":"EXECUTION_RESULT_AMBIGUOUS","message":"Transaction submission result is ambiguous"}',
      );
      await expect(
        service.executeAuthorizedPayment(harness.request),
      ).rejects.toMatchObject({ code: "EXECUTION_RESULT_AMBIGUOUS" });
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
    expect(caught).toMatchObject({
      code: "EXECUTION_REPOSITORY_FAILURE",
      message: "Execution coordination failed",
    });
    expect(caught).not.toHaveProperty("cause");
    expect(caught).not.toHaveProperty("stack");
    expect(JSON.stringify(caught)).toBe(
      '{"name":"ExecutorError","code":"EXECUTION_REPOSITORY_FAILURE","message":"Execution coordination failed"}',
    );
    expect(harness.transportState.simulations).toHaveLength(0);
    expect(harness.transportState.submissions).toHaveLength(0);
  });
});
