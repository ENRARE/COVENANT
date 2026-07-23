export const AUTHORITY_ERROR_CODES = [
  "MALFORMED_INPUT",
  "MALFORMED_EVIDENCE",
  "SIGNER_MISMATCH",
  "INVALID_DECISION",
  "EXPIRED_REQUEST",
  "IDEMPOTENCY_CONFLICT",
  "IDENTIFIER_INVALID",
  "NONCE_EXHAUSTED",
  "SIGNING_FAILURE",
  "SELF_VERIFICATION_FAILED",
  "DEPENDENCY_FAILURE",
] as const;

export type AuthorityErrorCode = (typeof AUTHORITY_ERROR_CODES)[number];

export class AuthorityError extends Error {
  override readonly name = "AuthorityError";

  constructor(
    readonly code: AuthorityErrorCode,
    message: string,
  ) {
    super(message);
  }

  toJSON(): { name: string; code: AuthorityErrorCode; message: string } {
    return { name: this.name, code: this.code, message: this.message };
  }
}
