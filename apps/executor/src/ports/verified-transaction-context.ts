import type { AuthorizedTransactionRequest } from "../types.js";
import type { TransactionTransportContext } from "./transaction-transport.js";

type VerifiedTransactionState = {
  readonly request: AuthorizedTransactionRequest;
  submissionAttemptStarted: boolean;
};

const verifiedRequests = new WeakMap<object, VerifiedTransactionState>();

export function createVerifiedTransactionContext(
  request: AuthorizedTransactionRequest,
  executionId: TransactionTransportContext["executionId"],
): TransactionTransportContext {
  const context = Object.freeze({ executionId });
  verifiedRequests.set(context, { request, submissionAttemptStarted: false });
  return context;
}

export function assertVerifiedTransactionContext(
  request: AuthorizedTransactionRequest,
  context: TransactionTransportContext | undefined,
): asserts context is TransactionTransportContext {
  if (
    context === undefined ||
    verifiedRequests.get(context)?.request !== request
  ) {
    throw new Error("unverified transaction context");
  }
}

export function markVerifiedTransactionSubmissionAttemptStarted(
  request: AuthorizedTransactionRequest,
  context: TransactionTransportContext | undefined,
): void {
  assertVerifiedTransactionContext(request, context);
  const state = verifiedRequests.get(context);
  if (state === undefined) throw new Error("unverified transaction context");
  state.submissionAttemptStarted = true;
}

export function didVerifiedTransactionSubmissionAttemptStart(
  context: TransactionTransportContext,
): boolean {
  return verifiedRequests.get(context)?.submissionAttemptStarted === true;
}
