export const COVENANT_DOMAIN_ERROR_CODES = [
  "INVALID_COVENANT",
  "INVALID_TIMESTAMP",
  "INVALID_TRANSITION",
  "PROJECT_MISMATCH",
  "AUTHORIZATION_REQUIRED",
  "AUTHORIZATION_REJECTED",
  "AUTHORIZATION_EXPIRED",
  "EXECUTION_ALREADY_STARTED",
  "CANCELLATION_NOT_ALLOWED",
  "COVENANT_EXPIRED",
  "EVIDENCE_MISMATCH",
  "EVIDENCE_CONFLICT",
  "UNSUPPORTED_EVIDENCE",
  "UNSUPPORTED_NETWORK",
  "UNSUPPORTED_ASSET",
] as const;

export type CovenantDomainErrorCode =
  (typeof COVENANT_DOMAIN_ERROR_CODES)[number];

export const COVENANT_DOMAIN_ERROR_MESSAGES: Readonly<
  Record<CovenantDomainErrorCode, string>
> = Object.freeze({
  INVALID_COVENANT: "Covenant resource is invalid",
  INVALID_TIMESTAMP: "Evaluation timestamp is invalid",
  INVALID_TRANSITION: "Covenant lifecycle transition is not allowed",
  PROJECT_MISMATCH: "Covenant does not belong to the requested project",
  AUTHORIZATION_REQUIRED: "Valid authorization evidence is required",
  AUTHORIZATION_REJECTED: "Authorization evidence was rejected",
  AUTHORIZATION_EXPIRED: "Authorization evidence is expired",
  EXECUTION_ALREADY_STARTED: "Covenant execution has already started",
  CANCELLATION_NOT_ALLOWED: "Covenant cancellation is not allowed",
  COVENANT_EXPIRED: "Covenant validity has expired",
  EVIDENCE_MISMATCH: "Evidence does not match the Covenant",
  EVIDENCE_CONFLICT: "Evidence contains conflicting observations",
  UNSUPPORTED_EVIDENCE: "Evidence type is unsupported",
  UNSUPPORTED_NETWORK: "Only Arc Testnet is supported",
  UNSUPPORTED_ASSET: "Only six-decimal USDC is supported",
});

export class CovenantDomainError extends Error {
  override readonly name = "CovenantDomainError";

  constructor(
    readonly code: CovenantDomainErrorCode,
    message: string = COVENANT_DOMAIN_ERROR_MESSAGES[code],
    options?: ErrorOptions,
  ) {
    super(message, options);
  }

  toJSON(): { name: string; code: CovenantDomainErrorCode; message: string } {
    return { name: this.name, code: this.code, message: this.message };
  }
}

export function covenantFailure(
  code: CovenantDomainErrorCode,
  message?: string,
  cause?: unknown,
): never {
  throw new CovenantDomainError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}
