export const AUDIT_ERROR_CODES = [
  "MALFORMED_AUDIT_SOURCE",
  "UNSUPPORTED_AUDIT_SOURCE",
  "AUDIT_SOURCE_INCOMPLETE",
  "AUDIT_SOURCE_CONFLICT",
  "AUDIT_EVENT_IDENTITY_CONFLICT",
  "AUDIT_CAUSALITY_FAILURE",
  "AUDIT_ORDERING_FAILURE",
  "AUDIT_SANITIZATION_FAILURE",
  "AUDIT_SERIALIZATION_FAILURE",
] as const;

export type AuditErrorCode = (typeof AUDIT_ERROR_CODES)[number];

export const AUDIT_ERROR_MESSAGES: Readonly<Record<AuditErrorCode, string>> =
  Object.freeze({
    MALFORMED_AUDIT_SOURCE: "Audit source is malformed",
    UNSUPPORTED_AUDIT_SOURCE: "Audit source is unsupported",
    AUDIT_SOURCE_INCOMPLETE: "Audit source is incomplete",
    AUDIT_SOURCE_CONFLICT: "Audit sources conflict",
    AUDIT_EVENT_IDENTITY_CONFLICT: "Audit event identity conflicts",
    AUDIT_CAUSALITY_FAILURE: "Audit event causality is invalid",
    AUDIT_ORDERING_FAILURE: "Audit event ordering failed",
    AUDIT_SANITIZATION_FAILURE: "Audit output sanitization failed",
    AUDIT_SERIALIZATION_FAILURE: "Audit output serialization failed",
  });

export class AuditProjectionError extends Error {
  override readonly name = "AuditProjectionError";

  constructor(readonly code: AuditErrorCode) {
    super(AUDIT_ERROR_MESSAGES[code]);
    delete this.stack;
  }

  toJSON(): { name: string; code: AuditErrorCode; message: string } {
    return { name: this.name, code: this.code, message: this.message };
  }
}

export function auditFailure(code: AuditErrorCode): never {
  throw new AuditProjectionError(code);
}

export function sanitizeAuditError(error: unknown): AuditProjectionError {
  return error instanceof AuditProjectionError
    ? new AuditProjectionError(error.code)
    : new AuditProjectionError("MALFORMED_AUDIT_SOURCE");
}
