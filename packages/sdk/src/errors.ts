export type CovenantErrorFields = Readonly<{
  type: string;
  code: string;
  message: string;
  status?: number;
  requestId?: string;
  retryAfterMs?: number;
}>;

export class CovenantError extends Error {
  readonly type: string;
  readonly code: string;
  readonly status: number | undefined;
  readonly requestId: string | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(fields: CovenantErrorFields) {
    super(fields.message);
    this.name = "CovenantError";
    this.type = fields.type;
    this.code = fields.code;
    this.status = fields.status;
    this.requestId = fields.requestId;
    this.retryAfterMs = fields.retryAfterMs;
  }
}

export class CovenantApiError extends CovenantError {
  constructor(fields: CovenantErrorFields) {
    super(fields);
    this.name = "CovenantApiError";
  }
}

export class CovenantAuthenticationError extends CovenantApiError {
  constructor(fields: CovenantErrorFields) {
    super(fields);
    this.name = "CovenantAuthenticationError";
  }
}

export class CovenantValidationError extends CovenantApiError {
  constructor(fields: CovenantErrorFields) {
    super(fields);
    this.name = "CovenantValidationError";
  }
}

export class CovenantConflictError extends CovenantApiError {
  constructor(fields: CovenantErrorFields) {
    super(fields);
    this.name = "CovenantConflictError";
  }
}

export class CovenantRateLimitError extends CovenantApiError {
  constructor(fields: CovenantErrorFields) {
    super(fields);
    this.name = "CovenantRateLimitError";
  }
}

export class CovenantConfigurationError extends CovenantError {
  constructor(message: string) {
    super({
      type: "invalid_configuration",
      code: "INVALID_CONFIGURATION",
      message,
    });
    this.name = "CovenantConfigurationError";
  }
}

export class CovenantTransportError extends CovenantError {
  constructor(message = "The Covenant API could not be reached.") {
    super({ type: "transport_error", code: "TRANSPORT_ERROR", message });
    this.name = "CovenantTransportError";
  }
}

export class CovenantTimeoutError extends CovenantTransportError {
  constructor(
    message = "The Covenant API request timed out; the operation may still be in progress.",
  ) {
    super(message);
    this.name = "CovenantTimeoutError";
  }
}

export class CovenantWebhookSignatureError extends CovenantError {
  constructor(message = "Webhook signature verification failed.") {
    super({
      type: "webhook_signature_error",
      code: "WEBHOOK_SIGNATURE_INVALID",
      message,
    });
    this.name = "CovenantWebhookSignatureError";
  }
}
