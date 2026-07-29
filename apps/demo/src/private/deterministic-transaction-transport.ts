import type {
  AuthorizedTransactionRequest,
  TransactionTransport,
} from "@covenant/executor";
import { FROZEN_DEMO } from "../configuration.js";
import { DemoError } from "../errors.js";

function copy(
  request: AuthorizedTransactionRequest,
): AuthorizedTransactionRequest {
  return Object.freeze({
    chainId: request.chainId,
    to: request.to,
    value: request.value,
    data: request.data,
  });
}

export class DeterministicDemoTransport implements TransactionTransport {
  readonly #simulations: AuthorizedTransactionRequest[] = [];
  readonly #submissions: AuthorizedTransactionRequest[] = [];

  #assertRequest(request: AuthorizedTransactionRequest): void {
    if (request.to !== FROZEN_DEMO.vault) {
      throw new DemoError("TRANSPORT_INVARIANT_FAILED");
    }
    const first = this.#simulations[0];
    if (first !== undefined && first.data !== request.data) {
      throw new DemoError("TRANSPORT_INVARIANT_FAILED");
    }
  }

  simulate(request: AuthorizedTransactionRequest): Promise<unknown> {
    this.#assertRequest(request);
    this.#simulations.push(copy(request));
    return Promise.resolve({ status: "SIMULATED" });
  }

  submit(request: AuthorizedTransactionRequest): Promise<unknown> {
    this.#assertRequest(request);
    this.#submissions.push(copy(request));
    return Promise.resolve({
      status: "SUBMITTED",
      transactionId: FROZEN_DEMO.simulatedSubmissionReference,
    });
  }

  get simulationCount(): number {
    return this.#simulations.length;
  }

  get submissionCount(): number {
    return this.#submissions.length;
  }

  hasExactCompletedCallPattern(): boolean {
    return this.#simulations.length === 2 && this.#submissions.length === 1;
  }
}
