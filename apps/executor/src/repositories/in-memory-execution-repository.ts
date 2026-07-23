import type { ExecutionRepository } from "../ports/execution-repository.js";
import type { ExecutionResult, SimulationResult } from "../types.js";

export class InMemoryExecutionRepository implements ExecutionRepository {
  readonly #simulations = new Map<string, Promise<SimulationResult>>();
  readonly #executions = new Map<string, Promise<ExecutionResult>>();
  readonly #completed = new Map<string, ExecutionResult>();

  coordinateSimulation(
    executionId: string,
    operation: () => Promise<SimulationResult>,
  ): Promise<SimulationResult> {
    const existing = this.#simulations.get(executionId);
    if (existing !== undefined) return existing;
    const pending = Promise.resolve().then(operation);
    this.#simulations.set(executionId, pending);
    const cleanup = () => {
      if (this.#simulations.get(executionId) === pending)
        this.#simulations.delete(executionId);
    };
    void pending.then(cleanup, cleanup);
    return pending;
  }

  coordinateExecution(
    executionId: string,
    operation: () => Promise<ExecutionResult>,
  ): Promise<ExecutionResult> {
    const completed = this.#completed.get(executionId);
    if (completed !== undefined) return Promise.resolve(completed);
    const existing = this.#executions.get(executionId);
    if (existing !== undefined) return existing;

    const pending = Promise.resolve()
      .then(operation)
      .then((result) => {
        this.#completed.set(executionId, result);
        return result;
      });
    this.#executions.set(executionId, pending);
    const cleanup = () => {
      if (this.#executions.get(executionId) === pending)
        this.#executions.delete(executionId);
    };
    void pending.then(cleanup, cleanup);
    return pending;
  }
}
