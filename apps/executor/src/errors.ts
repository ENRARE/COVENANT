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
