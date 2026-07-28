export const DEMO_ERROR_CODES = [
  "MALFORMED_ACTION",
  "INVALID_REPOSITORY_ROOT",
  "UNSAFE_STORAGE",
  "STORAGE_CORRUPT",
  "STORAGE_FAILURE",
  "LOCK_BUSY",
  "LOCK_MALFORMED",
  "RUNTIME_UNINITIALIZED",
  "RUNTIME_INTERRUPTED",
  "RUNTIME_COMPLETED",
  "RUNTIME_FAILURE",
  "HAPPY_PATH_REJECTED",
  "MALICIOUS_PATH_APPROVED",
  "AUTHORIZATION_MISSING",
  "TRANSPORT_INVARIANT_FAILED",
] as const;

export type DemoErrorCode = (typeof DEMO_ERROR_CODES)[number];

export const DEMO_ERROR_MESSAGES: Record<DemoErrorCode, string> = {
  MALFORMED_ACTION: "Demo action is malformed",
  INVALID_REPOSITORY_ROOT:
    "Current directory is not the Covenant repository root",
  UNSAFE_STORAGE: "Demo storage failed safety validation",
  STORAGE_CORRUPT: "Demo audit journal is corrupt",
  STORAGE_FAILURE: "Demo storage operation failed",
  LOCK_BUSY: "Demo runtime is busy",
  LOCK_MALFORMED: "Demo runtime lock is malformed",
  RUNTIME_UNINITIALIZED: "Demo runtime must be seeded",
  RUNTIME_INTERRUPTED: "Interrupted demo runtime must be reset",
  RUNTIME_COMPLETED: "Completed demo runtime must be reset before seeding",
  RUNTIME_FAILURE: "Local demo runtime failed",
  HAPPY_PATH_REJECTED: "Frozen happy-path request was not approved",
  MALICIOUS_PATH_APPROVED: "Compromised proposer request was not rejected",
  AUTHORIZATION_MISSING: "Approved request did not produce authorization",
  TRANSPORT_INVARIANT_FAILED: "Simulated transport invariant failed",
};

export class DemoError extends Error {
  override readonly name = "DemoError";

  constructor(
    readonly code: DemoErrorCode,
    message = DEMO_ERROR_MESSAGES[code],
  ) {
    super(message);
    Object.defineProperty(this, "stack", {
      value: undefined,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }

  toJSON(): { name: string; code: DemoErrorCode; message: string } {
    return { name: this.name, code: this.code, message: this.message };
  }
}

export function sanitizeDemoError(error: unknown): DemoError {
  return error instanceof DemoError
    ? new DemoError(error.code)
    : new DemoError("RUNTIME_FAILURE");
}
