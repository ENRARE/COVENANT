import type { RuntimeOperation } from "./types.js";
import type { ExecutionAdapter } from "./types.js";

/** Narrow capability exposed by an isolated @covenant/executor worker. */
export type IsolatedExecutorPort = Readonly<{
  simulateAuthorizedPayment: (request: unknown) => Promise<unknown>;
  executeAuthorizedPayment: (request: unknown) => Promise<unknown>;
}>;

function requestFor(
  operation: RuntimeOperation,
): Readonly<Record<string, unknown>> | null {
  const submission = operation.authorizationEvidence;
  if (submission === null) return null;
  const evidence = submission.evidence as Record<string, unknown>;
  const decisionReceipt =
    evidence.signedDecisionReceipt ?? evidence.decisionReceipt;
  const authorizationReceipt =
    evidence.signedAuthorizationReceipt ?? evidence.authorizationReceipt;
  if (decisionReceipt === undefined || authorizationReceipt === undefined)
    return null;
  return Object.freeze({
    executionId: operation.executionId,
    signedPaymentIntent: submission.signedPaymentIntent,
    ruleResults: submission.ruleResults,
    decisionReceipt,
    authorizationReceipt,
  });
}

function submittedTransactionId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const result = value as Record<string, unknown>;
  return result.status === "SUBMITTED" &&
    typeof result.transactionId === "string" &&
    result.transactionId.trim().length > 0
    ? result.transactionId
    : null;
}

/**
 * Adapt the durable runtime to an isolated executor process/worker. This
 * adapter has no transport, key, signer, or arbitrary-calldata capability;
 * those remain owned by the injected executor port.
 */
export function createIsolatedExecutorAdapter(
  executor: IsolatedExecutorPort,
): ExecutionAdapter {
  return Object.freeze({
    async simulate(operation: RuntimeOperation) {
      const request = requestFor(operation);
      if (request === null)
        return Object.freeze({
          status: "NO_SUBMISSION" as const,
          reason: "Verified authorization evidence is unavailable",
        });
      const result = await executor.simulateAuthorizedPayment(request);
      if (
        typeof result === "object" &&
        result !== null &&
        (result as Record<string, unknown>).status === "SIMULATED"
      )
        return Object.freeze({ status: "READY" as const });
      return Object.freeze({
        status: "NO_SUBMISSION" as const,
        reason: "Isolated executor simulation was not accepted",
      });
    },

    async submit(operation: RuntimeOperation) {
      const request = requestFor(operation);
      if (request === null)
        return Object.freeze({
          status: "NO_SUBMISSION" as const,
          reason: "Verified authorization evidence is unavailable",
        });
      const result = await executor.executeAuthorizedPayment(request);
      const transactionId = submittedTransactionId(result);
      if (transactionId === null)
        throw new Error("Isolated executor submission outcome is ambiguous");
      return Object.freeze({
        status: "ACCEPTED" as const,
        transactionId,
        providerState: "ACCEPTED",
      });
    },
  });
}
