export const EXECUTOR_ERROR_CODES = [
  "MALFORMED_EXECUTION_REQUEST",
  "COVENANT_PROVIDER_FAILURE",
  "CLOCK_FAILURE",
  "INVALID_AUTHORIZATION_CHAIN",
  "DECISION_NOT_APPROVED",
  "RULES_NOT_APPROVED",
  "EXECUTION_EXPIRED",
  "EXECUTION_TARGET_MISMATCH",
  "EXECUTION_CHAIN_MISMATCH",
  "EXECUTION_TOKEN_MISMATCH",
  "EXECUTION_RECIPIENT_MISMATCH",
  "EXECUTION_CALL_MISMATCH",
  "EXECUTION_REPOSITORY_FAILURE",
  "SIMULATION_FAILURE",
  "SUBMISSION_FAILURE",
  "EXECUTION_RESULT_AMBIGUOUS",
  "CONFIGURATION_UNAVAILABLE",
  "CREDENTIAL_UNAVAILABLE",
  "EXECUTION_CONFLICT",
  "REQUEST_INVALID",
  "CIRCLE_AUTHENTICATION_FAILED",
  "CIRCLE_REQUEST_REJECTED",
  "CIRCLE_RATE_LIMITED",
  "CIRCLE_TRANSPORT_FAILED",
  "CIRCLE_RESPONSE_INVALID",
  "CIRCLE_OUTCOME_UNKNOWN",
  "CIRCLE_STATUS_UNKNOWN",
  "EXECUTION_NOT_RETRYABLE",
  "INTERNAL_UNAVAILABLE",
] as const;

export type ExecutorErrorCode = (typeof EXECUTOR_ERROR_CODES)[number];

export const EXECUTOR_ERROR_MESSAGES: Record<ExecutorErrorCode, string> = {
  MALFORMED_EXECUTION_REQUEST: "Execution request is malformed",
  COVENANT_PROVIDER_FAILURE: "Trusted Covenant provider failed",
  CLOCK_FAILURE: "Executor clock failed",
  INVALID_AUTHORIZATION_CHAIN: "Authorization chain is invalid",
  DECISION_NOT_APPROVED: "Decision is not approved",
  RULES_NOT_APPROVED: "Canonical rules are not approved",
  EXECUTION_EXPIRED: "Authorized execution is not currently valid",
  EXECUTION_TARGET_MISMATCH: "Execution target does not match the Covenant",
  EXECUTION_CHAIN_MISMATCH: "Execution chain does not match Arc Testnet",
  EXECUTION_TOKEN_MISMATCH: "Payment token does not match the Covenant",
  EXECUTION_RECIPIENT_MISMATCH: "Payment recipient does not match the Covenant",
  EXECUTION_CALL_MISMATCH: "Constructed vault call failed verification",
  EXECUTION_REPOSITORY_FAILURE: "Execution coordination failed",
  SIMULATION_FAILURE: "Authorized transaction simulation failed",
  SUBMISSION_FAILURE: "Transaction was rejected before submission",
  EXECUTION_RESULT_AMBIGUOUS: "Transaction submission result is ambiguous",
  CONFIGURATION_UNAVAILABLE: "Circle executor configuration is unavailable",
  CREDENTIAL_UNAVAILABLE: "Circle credential material is unavailable",
  EXECUTION_CONFLICT: "Circle execution identity conflicts with stored state",
  REQUEST_INVALID: "Circle execution request is invalid",
  CIRCLE_AUTHENTICATION_FAILED: "Circle authentication failed",
  CIRCLE_REQUEST_REJECTED: "Circle rejected the execution request",
  CIRCLE_RATE_LIMITED: "Circle rate limited the execution request",
  CIRCLE_TRANSPORT_FAILED: "Circle transport failed before submission",
  CIRCLE_RESPONSE_INVALID: "Circle response is invalid",
  CIRCLE_OUTCOME_UNKNOWN: "Circle submission outcome is unknown",
  CIRCLE_STATUS_UNKNOWN: "Circle transaction status is unknown",
  EXECUTION_NOT_RETRYABLE: "Circle execution cannot be retried",
  INTERNAL_UNAVAILABLE: "Circle executor dependency is unavailable",
};

export class ExecutorError extends Error {
  override readonly name = "ExecutorError";

  constructor(
    readonly code: ExecutorErrorCode,
    message = EXECUTOR_ERROR_MESSAGES[code],
  ) {
    super(message);
    delete this.stack;
  }

  toJSON(): { name: string; code: ExecutorErrorCode; message: string } {
    return { name: this.name, code: this.code, message: this.message };
  }
}

export function executorFailure(code: ExecutorErrorCode): never {
  throw new ExecutorError(code);
}

export function sanitizedExecutorError(error: ExecutorError): ExecutorError {
  return new ExecutorError(error.code);
}
