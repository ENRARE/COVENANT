import { CovenantValidationError } from "./errors.js";
import type {
  Bytes32,
  CovenantConditions,
  CreateCovenantInput,
  WebhookEndpointCreated,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new CovenantValidationError({
    type: "invalid_request",
    code: "INVALID_INPUT",
    message,
  });
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "")
    invalid(`${field} must be a non-empty string.`);
  return value;
}

export function assertBytes32(
  value: string,
  field: string,
): asserts value is Bytes32 {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(value))
    invalid(`${field} must be a 32-byte hexadecimal identifier.`);
}

function assertTimestamp(value: unknown, field: string): void {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/u.test(value))
    invalid(`${field} must be an unsigned decimal timestamp string.`);
}

function assertConditions(
  value: unknown,
  field: string,
): asserts value is CovenantConditions {
  if (!isRecord(value)) invalid(`${field} must be an object.`);
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "policyHash,policyVersion")
    invalid(`${field} contains unsupported fields.`);
  assertBytes32(String(value.policyHash), `${field}.policyHash`);
  nonEmptyString(value.policyVersion, `${field}.policyVersion`);
}

export function assertCreateCovenantInput(
  value: unknown,
): asserts value is CreateCovenantInput {
  if (!isRecord(value)) invalid("Covenant input must be an object.");
  const allowed = new Set([
    "id",
    "payer",
    "beneficiary",
    "amount",
    "conditions",
    "policy",
    "createdAt",
    "expiresAt",
    "auditReference",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    invalid("Covenant input contains unsupported fields.");
  if (value.id !== undefined) {
    if (typeof value.id !== "string") invalid("id must be a string.");
    assertBytes32(value.id, "id");
  }
  nonEmptyString(value.payer, "payer");
  nonEmptyString(value.beneficiary, "beneficiary");
  if (typeof value.amount !== "string" || value.amount.length === 0)
    invalid("amount must be a non-empty decimal string.");
  if (value.conditions === undefined && value.policy === undefined)
    invalid("conditions or policy is required.");
  if (value.conditions !== undefined)
    assertConditions(value.conditions, "conditions");
  if (value.policy !== undefined) assertConditions(value.policy, "policy");
  if (
    value.conditions !== undefined &&
    value.policy !== undefined &&
    (value.conditions.policyHash !== value.policy.policyHash ||
      value.conditions.policyVersion !== value.policy.policyVersion)
  )
    invalid("conditions and policy must agree.");
  if (value.createdAt !== undefined)
    assertTimestamp(value.createdAt, "createdAt");
  assertTimestamp(value.expiresAt, "expiresAt");
  if (value.auditReference !== undefined)
    nonEmptyString(value.auditReference, "auditReference");
}

export function assertId(value: string, field: string): void {
  if (typeof value !== "string") invalid(`${field} must be a string.`);
  assertBytes32(value, field);
}

export function assertListParams(
  value: Readonly<{ limit?: number; after?: string }> | undefined,
): void {
  if (value === undefined) return;
  if (
    value.limit !== undefined &&
    (!Number.isSafeInteger(value.limit) || value.limit < 1 || value.limit > 100)
  )
    invalid("limit must be an integer between 1 and 100.");
  if (value.after !== undefined) assertBytes32(value.after, "after");
}

export function assertWebhookInput(
  value: unknown,
): asserts value is Readonly<{ url: string }> {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== "url"))
    invalid("Webhook endpoint input contains unsupported fields.");
  const url = nonEmptyString(value.url, "url");
  try {
    new URL(url);
  } catch {
    invalid("url must be a valid absolute URL.");
  }
}

export function assertCreatedWebhook(
  value: unknown,
): asserts value is WebhookEndpointCreated {
  if (!isRecord(value)) invalid("Webhook endpoint response is invalid.");
  if (
    typeof value.endpointId !== "string" ||
    typeof value.secret !== "string" ||
    typeof value.url !== "string"
  )
    invalid("Webhook endpoint response is invalid.");
}

export function assertResponseObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value))
    throw new CovenantValidationError({
      type: "server_error",
      code: "INVALID_RESPONSE",
      message: `The Covenant API returned an invalid ${label} response.`,
    });
  return value;
}

export function assertResponseList(
  value: unknown,
  label: string,
): readonly unknown[] {
  if (!isRecord(value) || !Array.isArray(value.data))
    throw new CovenantValidationError({
      type: "server_error",
      code: "INVALID_RESPONSE",
      message: `The Covenant API returned an invalid ${label} response.`,
    });
  return value.data;
}
