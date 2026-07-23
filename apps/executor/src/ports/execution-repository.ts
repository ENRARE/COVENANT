import type { ExecutionResult, SimulationResult } from "../types.js";

export type ExecutionRepository = {
  coordinateSimulation(
    executionId: string,
    operation: () => Promise<SimulationResult>,
  ): Promise<SimulationResult>;
  coordinateExecution(
    executionId: string,
    operation: () => Promise<ExecutionResult>,
  ): Promise<ExecutionResult>;
};
