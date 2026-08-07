import type { Hex } from "viem";
import type { AuthorizedTransactionRequest } from "../types.js";

export type TransactionTransportContext = Readonly<{
  executionId: Hex;
}>;

export type TransactionTransport = {
  simulate(
    request: AuthorizedTransactionRequest,
    context?: TransactionTransportContext,
  ): Promise<unknown>;
  submit(
    request: AuthorizedTransactionRequest,
    context?: TransactionTransportContext,
  ): Promise<unknown>;
};
