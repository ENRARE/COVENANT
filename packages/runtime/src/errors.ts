export const RUNTIME_ERROR_CODES = [
  "RUNTIME_CONFLICT",
  "RUNTIME_NOT_FOUND",
  "RUNTIME_INVALID_STATE",
  "LEASE_LOST",
  "SUBMISSION_ALREADY_STARTED",
  "RUNTIME_TERMINAL",
  "RUNTIME_PERSISTENCE_FAILURE",
  "RUNTIME_EVIDENCE_CONFLICT",
] as const;

export type RuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number];

export class RuntimeError extends Error {
  override readonly name = "RuntimeError";

  constructor(
    readonly code: RuntimeErrorCode,
    message: string = code,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function runtimeFailure(
  code: RuntimeErrorCode,
  message?: string,
  cause?: unknown,
): never {
  throw new RuntimeError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}
