const SENSITIVE_KEY =
  /(api[-_]?key|authorization|credential|database|password|private[-_]?key|secret|token)/iu;
const SENSITIVE_VALUE =
  /(cov_test_[A-Za-z0-9_-]+|whsec_[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._~+/=-]+|-----BEGIN [^-]+-----)/giu;

/** Replace credential-shaped values before they cross an operational boundary. */
export function redactSensitiveText(value: string): string {
  return value.replace(SENSITIVE_VALUE, "[REDACTED]").slice(0, 512);
}

/** Produce a bounded, JSON-safe diagnostic with known secret fields removed. */
export function redactSensitive(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactSensitive(item),
      ]),
    );
  }
  return value;
}

export function safeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const message = redactSensitiveText(error.message.trim());
  return message.length === 0 ? fallback : message;
}
