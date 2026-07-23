export const AGENT_ERROR_CODES = [
  "MALFORMED_INPUT",
  "CONFIGURATION_INVALID",
  "COVENANT_PROVIDER_FAILURE",
  "COVENANT_INVALID",
  "CLOCK_FAILURE",
  "INVOICE_SIGNATURE_INVALID",
  "INVOICE_VENDOR_MISMATCH",
  "INVOICE_PRODUCT_MISMATCH",
  "INVOICE_RECIPIENT_MISMATCH",
  "INVOICE_TOKEN_MISMATCH",
  "INVOICE_PURPOSE_MISMATCH",
  "INVOICE_AMOUNT_MISMATCH",
  "AMOUNT_EXCEEDS_LIMIT",
  "INVOICE_NOT_CURRENT",
  "COVENANT_INACTIVE",
  "SIGNER_ADDRESS_FAILURE",
  "SIGNER_MISMATCH",
  "IDENTIFIER_GENERATION_FAILURE",
  "RESERVATION_REPOSITORY_FAILURE",
  "PROPOSAL_REPOSITORY_FAILURE",
  "PAYMENT_INTENT_SIGNING_FAILURE",
  "PAYMENT_INTENT_EXPIRED",
  "SELF_VERIFICATION_FAILED",
  "DURABLE_REPOSITORY_INITIALIZATION_FAILURE",
  "DURABLE_REPOSITORY_PERSISTENCE_FAILURE",
  "DURABLE_REPOSITORY_CLOSE_FAILURE",
  "DURABLE_REPOSITORY_CLOSED",
] as const;

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

export const AGENT_ERROR_MESSAGES: Record<AgentErrorCode, string> = {
  MALFORMED_INPUT: "Public proposal request is malformed",
  CONFIGURATION_INVALID: "Agent configuration is invalid",
  COVENANT_PROVIDER_FAILURE: "Trusted Covenant provider failed",
  COVENANT_INVALID: "Trusted Covenant configuration is invalid",
  CLOCK_FAILURE: "Agent clock failed",
  INVOICE_SIGNATURE_INVALID: "Invoice signature is invalid",
  INVOICE_VENDOR_MISMATCH: "Invoice vendor is not approved",
  INVOICE_PRODUCT_MISMATCH: "Invoice product is not approved",
  INVOICE_RECIPIENT_MISMATCH: "Invoice recipient does not match the Covenant",
  INVOICE_TOKEN_MISMATCH: "Invoice token does not match the Covenant",
  INVOICE_PURPOSE_MISMATCH: "Invoice purpose does not match the Covenant",
  INVOICE_AMOUNT_MISMATCH: "Invoice amount does not match the request",
  AMOUNT_EXCEEDS_LIMIT: "Invoice amount exceeds the Covenant limit",
  INVOICE_NOT_CURRENT: "Invoice is not currently valid",
  COVENANT_INACTIVE: "Covenant is not currently active",
  SIGNER_ADDRESS_FAILURE: "PaymentIntent signer address access failed",
  SIGNER_MISMATCH: "PaymentIntent signer does not match the Covenant",
  IDENTIFIER_GENERATION_FAILURE: "PaymentIntent identifier generation failed",
  RESERVATION_REPOSITORY_FAILURE: "Proposal reservation repository failed",
  PROPOSAL_REPOSITORY_FAILURE: "Proposal coordination repository failed",
  PAYMENT_INTENT_SIGNING_FAILURE: "PaymentIntent signing failed",
  PAYMENT_INTENT_EXPIRED: "Retained PaymentIntent validity is exhausted",
  SELF_VERIFICATION_FAILED: "Signed PaymentIntent failed self-verification",
  DURABLE_REPOSITORY_INITIALIZATION_FAILURE:
    "Durable proposal repository initialization failed",
  DURABLE_REPOSITORY_PERSISTENCE_FAILURE:
    "Durable proposal repository persistence failed",
  DURABLE_REPOSITORY_CLOSE_FAILURE: "Durable proposal repository close failed",
  DURABLE_REPOSITORY_CLOSED: "Durable proposal repository is closed",
};

export class AgentError extends Error {
  override readonly name = "AgentError";

  constructor(
    readonly code: AgentErrorCode,
    message = AGENT_ERROR_MESSAGES[code],
  ) {
    super(message);
    Object.defineProperty(this, "stack", {
      value: undefined,
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }

  toJSON(): { name: string; code: AgentErrorCode; message: string } {
    return { name: this.name, code: this.code, message: this.message };
  }
}

export async function callDependency<T>(input: {
  operation: () => T | Promise<T>;
  code: AgentErrorCode;
  preserveAgentError?: boolean;
}): Promise<T> {
  try {
    return await input.operation();
  } catch (error) {
    if (input.preserveAgentError === true && error instanceof AgentError) {
      throw new AgentError(error.code);
    }
    throw new AgentError(input.code);
  }
}
