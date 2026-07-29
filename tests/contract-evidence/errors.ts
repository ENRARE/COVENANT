export const CONTRACT_EVIDENCE_ERROR_MESSAGES = {
  MISSING_TOOL: "Required local contract tool is unavailable",
  STARTUP_FAILURE: "Controlled local EVM startup failed",
  WRONG_CHAIN: "Controlled local EVM returned the wrong chain",
  PORT_EXHAUSTION: "No controlled loopback port was available",
  DEPLOYMENT_FAILURE: "Local contract deployment failed",
  CODE_MISMATCH: "Deployed runtime code does not match the current artifact",
  IMMUTABLE_MISMATCH: "Deployed Covenant configuration does not match",
  FUNDING_FAILURE: "Local vault funding could not be verified",
  SIMULATION_FAILURE: "Local authorized transaction simulation failed",
  SUBMISSION_FAILURE: "Local transaction submission failed",
  RECEIPT_TIMEOUT: "Local transaction receipt timed out",
  RECEIPT_MISMATCH: "Local transaction receipt did not match",
  EVENT_MISMATCH: "Local contract event evidence did not match",
  BALANCE_MISMATCH: "Local token balance evidence did not match",
  STATE_MISMATCH: "Local CovenantVault state evidence did not match",
  UNEXPECTED_REVERT: "Local EVM revert evidence did not match",
  PROCESS_CLEANUP_FAILURE: "Controlled local EVM cleanup failed",
  HARNESS_EXECUTION_FAILED: "Local contract evidence could not be verified",
} as const;

export type ContractEvidenceErrorCode =
  keyof typeof CONTRACT_EVIDENCE_ERROR_MESSAGES;

export class ContractEvidenceError extends Error {
  readonly code: ContractEvidenceErrorCode;

  constructor(code: ContractEvidenceErrorCode) {
    super(CONTRACT_EVIDENCE_ERROR_MESSAGES[code]);
    this.name = "ContractEvidenceError";
    this.code = code;
  }

  toJSON() {
    return { name: this.name, code: this.code, message: this.message };
  }
}

export function evidenceFailure(code: ContractEvidenceErrorCode): never {
  throw new ContractEvidenceError(code);
}

export function sanitizedEvidenceError(error: unknown): ContractEvidenceError {
  return error instanceof ContractEvidenceError
    ? new ContractEvidenceError(error.code)
    : new ContractEvidenceError("HARNESS_EXECUTION_FAILED");
}
