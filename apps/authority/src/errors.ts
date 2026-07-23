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
  "COVENANT_PROVIDER_FAILURE",
  "CLOCK_FAILURE",
  "EVIDENCE_READER_FAILURE",
  "SIGNER_ADDRESS_FAILURE",
  "IDENTIFIER_GENERATION_FAILURE",
  "DECISION_SIGNING_FAILURE",
  "AUTHORIZATION_SIGNING_FAILURE",
  "DECISION_REPOSITORY_FAILURE",
  "AUTHORIZATION_REPOSITORY_FAILURE",
  "NONCE_REPOSITORY_FAILURE",
  "AUTHORIZATION_NONCE_CONSUMED",
  "DECISION_COVENANT_MISMATCH",
  "DECISION_INTENT_ID_MISMATCH",
  "DECISION_INTENT_HASH_MISMATCH",
  "DECISION_POLICY_VERSION_MISMATCH",
  "DECISION_RULE_RESULTS_MISMATCH",
  "DECISION_CREATED_IN_FUTURE",
  "DECISION_STATUS_MISMATCH",
  "DECISION_SIGNER_MISMATCH",
  "DECISION_SIGNATURE_INVALID",
  "AUTHORIZATION_DECISION_MISMATCH",
  "AUTHORIZATION_COVENANT_MISMATCH",
  "AUTHORIZATION_INTENT_HASH_MISMATCH",
  "AUTHORIZATION_VAULT_MISMATCH",
  "AUTHORIZATION_CHAIN_MISMATCH",
  "AUTHORIZATION_POLICY_VERSION_MISMATCH",
  "AUTHORIZATION_SIGNER_MISMATCH",
  "AUTHORIZATION_VALIDITY_INVALID",
  "AUTHORIZATION_SIGNATURE_INVALID",
] as const;

export type AuthorityErrorCode = (typeof AUTHORITY_ERROR_CODES)[number];

export const AUTHORITY_ERROR_MESSAGES: Record<AuthorityErrorCode, string> = {
  MALFORMED_INPUT: "Public request is malformed",
  MALFORMED_EVIDENCE: "Authority evidence is malformed",
  SIGNER_MISMATCH: "Configured signer does not match the Covenant",
  INVALID_DECISION: "Authorization requires a currently valid approval",
  EXPIRED_REQUEST: "Request validity window is exhausted",
  IDEMPOTENCY_CONFLICT: "Idempotency operation failed",
  IDENTIFIER_INVALID: "Generated identifier is invalid",
  NONCE_EXHAUSTED: "No unused authorization nonce is available",
  SIGNING_FAILURE: "Receipt signing failed",
  SELF_VERIFICATION_FAILED: "Issued receipt failed self-verification",
  DEPENDENCY_FAILURE: "Injected dependency failed",
  COVENANT_PROVIDER_FAILURE: "Trusted Covenant provider failed",
  CLOCK_FAILURE: "Authority clock failed",
  EVIDENCE_READER_FAILURE: "Authority evidence reader failed",
  SIGNER_ADDRESS_FAILURE: "Receipt signer address access failed",
  IDENTIFIER_GENERATION_FAILURE: "Identifier generation failed",
  DECISION_SIGNING_FAILURE: "Decision signing failed",
  AUTHORIZATION_SIGNING_FAILURE: "Authorization signing failed",
  DECISION_REPOSITORY_FAILURE: "Approved decision repository failed",
  AUTHORIZATION_REPOSITORY_FAILURE: "Authorization repository failed",
  NONCE_REPOSITORY_FAILURE: "Authorization nonce repository failed",
  AUTHORIZATION_NONCE_CONSUMED:
    "Retained authorization nonce is already consumed",
  DECISION_COVENANT_MISMATCH: "Decision Covenant linkage is invalid",
  DECISION_INTENT_ID_MISMATCH: "Decision intent identifier linkage is invalid",
  DECISION_INTENT_HASH_MISMATCH: "Decision intent digest linkage is invalid",
  DECISION_POLICY_VERSION_MISMATCH: "Decision policy linkage is invalid",
  DECISION_RULE_RESULTS_MISMATCH: "Decision rule commitment is invalid",
  DECISION_CREATED_IN_FUTURE: "Decision creation time is in the future",
  DECISION_STATUS_MISMATCH: "Decision status does not match canonical rules",
  DECISION_SIGNER_MISMATCH: "Decision signer is not authorized",
  DECISION_SIGNATURE_INVALID: "Decision signature is invalid",
  AUTHORIZATION_DECISION_MISMATCH: "Authorization decision linkage is invalid",
  AUTHORIZATION_COVENANT_MISMATCH: "Authorization Covenant linkage is invalid",
  AUTHORIZATION_INTENT_HASH_MISMATCH:
    "Authorization intent digest linkage is invalid",
  AUTHORIZATION_VAULT_MISMATCH: "Authorization vault linkage is invalid",
  AUTHORIZATION_CHAIN_MISMATCH: "Authorization chain linkage is invalid",
  AUTHORIZATION_POLICY_VERSION_MISMATCH:
    "Authorization policy linkage is invalid",
  AUTHORIZATION_SIGNER_MISMATCH: "Authorization signer is not authorized",
  AUTHORIZATION_VALIDITY_INVALID: "Authorization validity linkage is invalid",
  AUTHORIZATION_SIGNATURE_INVALID: "Authorization signature is invalid",
};

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

export type DependencyCall<T> = {
  operation: () => T | Promise<T>;
  code: AuthorityErrorCode;
  preserveAuthorityError?: boolean;
};

export async function callDependency<T>(input: DependencyCall<T>): Promise<T> {
  try {
    return await input.operation();
  } catch (error) {
    if (
      input.preserveAuthorityError === true &&
      error instanceof AuthorityError
    ) {
      throw new AuthorityError(
        error.code,
        AUTHORITY_ERROR_MESSAGES[error.code],
      );
    }
    throw new AuthorityError(input.code, AUTHORITY_ERROR_MESSAGES[input.code]);
  }
}
