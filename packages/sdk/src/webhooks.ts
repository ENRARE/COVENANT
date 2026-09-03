import { createHmac, timingSafeEqual } from "node:crypto";
import { CovenantWebhookSignatureError } from "./errors.js";
import type { WebhookEvent, WebhookVerifyInput } from "./types.js";

const DEFAULT_REPLAY_WINDOW_SECONDS = 300;
const MAX_PAYLOAD_BYTES = 1_048_576;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTimestamp(value: number | string): number {
  const parsed =
    typeof value === "number"
      ? value
      : /^(0|[1-9]\d*)$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new CovenantWebhookSignatureError("Webhook timestamp is invalid.");
  return parsed;
}

function assertDeliveryId(value: string): void {
  if (!/^[\x21-\x7e]{1,256}$/u.test(value))
    throw new CovenantWebhookSignatureError("Webhook delivery ID is invalid.");
}

function assertSecret(value: string): void {
  if (value.length < 1 || value.length > 512)
    throw new CovenantWebhookSignatureError("Webhook secret is invalid.");
}

/** Verify the exact COV-024 HMAC over `${timestamp}.${deliveryId}.${rawBody}`. */
export function verifyWebhook(input: WebhookVerifyInput): WebhookEvent {
  if (
    typeof input.payload !== "string" ||
    input.payload.length > MAX_PAYLOAD_BYTES
  )
    throw new CovenantWebhookSignatureError("Webhook payload is invalid.");
  if (typeof input.signature !== "string")
    throw new CovenantWebhookSignatureError("Webhook signature is invalid.");
  assertSecret(input.secret);
  assertDeliveryId(input.deliveryId);
  const timestamp = parseTimestamp(input.timestamp);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const replayWindow =
    input.replayWindowSeconds ?? DEFAULT_REPLAY_WINDOW_SECONDS;
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(replayWindow) ||
    replayWindow < 0 ||
    replayWindow > 86_400 ||
    Math.abs(now - timestamp) > replayWindow
  )
    throw new CovenantWebhookSignatureError(
      "Webhook timestamp is outside the replay window.",
    );
  if (!/^v1=[0-9a-f]{64}$/u.test(input.signature))
    throw new CovenantWebhookSignatureError("Webhook signature is malformed.");
  const expected = createHmac("sha256", input.secret)
    .update(`${String(timestamp)}.${input.deliveryId}.${input.payload}`, "utf8")
    .digest();
  const actual = Buffer.from(input.signature.slice(3), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new CovenantWebhookSignatureError();
  let decoded: unknown;
  try {
    decoded = JSON.parse(input.payload);
  } catch {
    throw new CovenantWebhookSignatureError(
      "Webhook payload is not valid JSON.",
    );
  }
  if (!isRecord(decoded))
    throw new CovenantWebhookSignatureError(
      "Webhook payload shape is invalid.",
    );
  if (
    typeof decoded.eventId !== "string" ||
    typeof decoded.eventType !== "string" ||
    !isRecord(decoded.payload)
  )
    throw new CovenantWebhookSignatureError("Webhook event shape is invalid.");
  return Object.freeze({
    eventId: decoded.eventId,
    eventType: decoded.eventType,
    payload: Object.freeze({ ...decoded.payload }),
  });
}
