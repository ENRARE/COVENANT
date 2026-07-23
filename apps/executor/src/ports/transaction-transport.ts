import type { AuthorizedTransactionRequest } from "../types.js";

export type TransactionTransport = {
  simulate(request: AuthorizedTransactionRequest): Promise<unknown>;
  submit(request: AuthorizedTransactionRequest): Promise<unknown>;
};
