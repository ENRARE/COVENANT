import type {
  AuthorizedTransactionRequest,
  TransactionTransport,
} from "@covenant/executor";

export const SIMULATED_SUBMISSION_ID = "simulated-submission-0001";

function copyRequest(
  request: AuthorizedTransactionRequest,
): AuthorizedTransactionRequest {
  return Object.freeze({
    chainId: request.chainId,
    to: request.to,
    value: request.value,
    data: request.data,
  });
}

export class DeterministicTransactionTransport implements TransactionTransport {
  readonly #simulations: AuthorizedTransactionRequest[] = [];
  readonly #submissions: AuthorizedTransactionRequest[] = [];

  simulate(request: AuthorizedTransactionRequest): Promise<unknown> {
    this.#simulations.push(copyRequest(request));
    return Promise.resolve({ status: "SIMULATED" });
  }

  submit(request: AuthorizedTransactionRequest): Promise<unknown> {
    this.#submissions.push(copyRequest(request));
    return Promise.resolve({
      status: "SUBMITTED",
      transactionId: SIMULATED_SUBMISSION_ID,
    });
  }

  get simulations(): readonly AuthorizedTransactionRequest[] {
    return this.#simulations.map(copyRequest);
  }

  get submissions(): readonly AuthorizedTransactionRequest[] {
    return this.#submissions.map(copyRequest);
  }
}
