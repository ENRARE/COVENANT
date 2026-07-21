export const VERIFICATION_ERROR_CODES = [
  "UNTRUSTED_AGENT_SIGNER",
  "UNTRUSTED_AUTHORIZATION_SIGNER",
  "DOMAIN_CHAIN_MISMATCH",
  "DOMAIN_CONTRACT_MISMATCH",
  "COVENANT_ID_MISMATCH",
  "INTENT_ID_MISMATCH",
  "INTENT_HASH_MISMATCH",
  "POLICY_VERSION_MISMATCH",
  "VAULT_MISMATCH",
  "CHAIN_MISMATCH",
  "DECISION_NOT_APPROVED",
  "RULE_RESULTS_MISMATCH",
  "RULE_RESULTS_NOT_ALL_PASSING",
  "AUTHORIZATION_DECISION_MISMATCH",
  "AUTHORIZATION_EXPIRED",
  "INTENT_EXPIRED",
  "COVENANT_INACTIVE",
  "RECIPIENT_MISMATCH",
  "TOKEN_MISMATCH",
  "AMOUNT_EXCEEDS_LIMIT",
  "PURPOSE_MISMATCH",
  "SIGNATURE_INVALID",
] as const;

export type VerificationErrorCode = (typeof VERIFICATION_ERROR_CODES)[number];

export class CovenantVerificationError extends Error {
  override readonly name = "CovenantVerificationError";

  constructor(
    readonly code: VerificationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function verificationFailure(
  code: VerificationErrorCode,
  message: string,
  cause?: unknown,
): never {
  throw new CovenantVerificationError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}
