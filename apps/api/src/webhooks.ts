import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type {
  DurableExecutionRuntime,
  WebhookDeliveryRecord,
} from "@covenant/runtime";
import { canonicalJson } from "./canonical-json.js";
import { redactSensitiveText } from "./redaction.js";

const REPLAY_WINDOW_SECONDS = 300;
const MAX_ATTEMPTS = 5;
const EVENT_MAP: Readonly<Record<string, string>> = {
  "execution.queued": "execution.started",
  "execution.preparing": "execution.started",
  "execution.simulating": "execution.started",
  "execution.ready_to_submit": "execution.started",
  "execution.submission_started": "execution.submitted",
  "execution.submitted": "execution.submitted",
  "execution.ambiguous": "execution.ambiguous",
  "execution.reconciling": "execution.ambiguous",
  "execution.succeeded": "execution.succeeded",
  "execution.retryable_failure": "execution.failed",
  "execution.terminal_failed": "execution.failed",
};

export type WebhookSender = (
  input: Readonly<{
    url: string;
    body: string;
    headers: Readonly<Record<string, string>>;
  }>,
) => Promise<Readonly<{ status: number }>>;

function keyBytes(key: Uint8Array | string): Buffer {
  const value =
    typeof key === "string" ? Buffer.from(key, "utf8") : Buffer.from(key);
  if (value.length !== 32)
    throw new Error("webhookMasterKey must be exactly 32 bytes");
  return value;
}

function protect(secret: string, master: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", master, iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function unprotect(value: string, master: Buffer): string {
  const [ivText, tagText, bodyText] = value.split(".");
  if (ivText === undefined || tagText === undefined || bodyText === undefined)
    throw new Error("Invalid protected webhook secret");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    master,
    Buffer.from(ivText, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(bodyText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function signWebhook(
  secret: string,
  timestamp: number,
  deliveryId: string,
  body: string,
): string {
  return createHmac("sha256", secret)
    .update(`${String(timestamp)}.${deliveryId}.${body}`, "utf8")
    .digest("hex");
}

export function verifyWebhookSignature(
  input: Readonly<{
    secret: string;
    timestamp: number;
    deliveryId: string;
    body: string;
    signature: string;
    now?: number;
  }>,
): boolean {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(input.timestamp) ||
    Math.abs(now - input.timestamp) > REPLAY_WINDOW_SECONDS
  )
    return false;
  const expected = Buffer.from(
    signWebhook(input.secret, input.timestamp, input.deliveryId, input.body),
    "hex",
  );
  const actual = Buffer.from(input.signature, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export class WebhookService {
  readonly #master: Buffer;
  readonly #runtime: DurableExecutionRuntime;
  readonly #send: WebhookSender;
  readonly #now: () => number;

  constructor(
    options: Readonly<{
      runtime: DurableExecutionRuntime;
      webhookMasterKey?: Uint8Array | string;
      sender?: WebhookSender;
      now?: () => number;
    }>,
  ) {
    this.#runtime = options.runtime;
    if (options.webhookMasterKey === undefined)
      throw new Error("WEBHOOK_MASTER_KEY_REQUIRED");
    this.#master = keyBytes(options.webhookMasterKey);
    this.#send =
      options.sender ??
      (async ({ url, body, headers }) => {
        const response = await fetch(url, { method: "POST", body, headers });
        return { status: response.status };
      });
    this.#now = options.now ?? (() => Date.now());
  }

  createEndpoint(
    projectId: string,
    url: string,
  ): Readonly<{ endpointId: string; secret: string; url: string }> {
    const endpointId = `wh_${randomBytes(16).toString("base64url")}`;
    const secret = `whsec_test_${randomBytes(32).toString("base64url")}`;
    this.#runtime.store.createWebhookEndpoint({
      endpointId,
      projectId,
      url,
      secretCiphertext: protect(secret, this.#master),
      at: this.#now(),
    });
    return { endpointId, secret, url };
  }

  listEndpoints(projectId: string) {
    return this.#runtime.store
      .listWebhookEndpoints(projectId)
      .map((endpoint) => ({
        endpointId: endpoint.endpointId,
        url: endpoint.url,
        createdAt: String(endpoint.createdAt),
        status: endpoint.revokedAt === null ? "active" : "revoked",
      }));
  }

  revokeEndpoint(projectId: string, endpointId: string) {
    return this.#runtime.store.revokeWebhookEndpoint(
      projectId,
      endpointId,
      this.#now(),
    );
  }

  emitEvent(
    projectId: string,
    eventType: string,
    payload: Record<string, unknown>,
    eventId = `evt_${randomBytes(16).toString("base64url")}`,
  ): void {
    const body = canonicalJson({ eventId, eventType, payload });
    for (const endpoint of this.#runtime.store.listWebhookEndpoints(
      projectId,
    )) {
      const deliveryId = `whd_${createHash("sha256").update(`${endpoint.endpointId}:${eventId}`, "utf8").digest("hex").slice(0, 32)}`;
      this.#runtime.store.createWebhookDelivery({
        deliveryId,
        endpointId: endpoint.endpointId,
        projectId,
        eventId,
        eventType,
        payloadJson: body,
        at: this.#now(),
      });
    }
  }

  consumeOutbox(): number {
    let count = 0;
    for (const event of this.#runtime.listOutbox(true)) {
      const eventType = EVENT_MAP[event.eventType];
      if (eventType === undefined) continue;
      const eventId = `outbox_${String(event.id)}_${String(event.version)}`;
      this.emitEvent(
        event.projectId,
        eventType,
        {
          covenantId: event.covenantId,
          executionId: event.payload.executionId,
          operationKey: event.operationKey,
          state: event.payload.state,
          ...(event.payload.providerState === undefined
            ? {}
            : { providerStatus: event.payload.providerState }),
        },
        eventId,
      );
      this.#runtime.store.markOutboxDelivered(event.id, this.#now());
      count += 1;
    }
    return count;
  }

  async dispatchDue(now = this.#now()): Promise<WebhookDeliveryRecord[]> {
    const delivered: WebhookDeliveryRecord[] = [];
    for (const delivery of this.#runtime.store.listWebhookDeliveries({
      dueAt: now,
      limit: 100,
    })) {
      const endpoint = this.#runtime.store.getWebhookEndpoint(
        delivery.projectId,
        delivery.endpointId,
      );
      if (endpoint?.revokedAt !== null) continue;
      const timestamp = Math.floor(now / 1000);
      const signature = signWebhook(
        unprotect(endpoint.secretCiphertext, this.#master),
        timestamp,
        delivery.deliveryId,
        delivery.payloadJson,
      );
      const attempt = delivery.attemptCount + 1;
      try {
        const result = await this.#send({
          url: endpoint.url,
          body: delivery.payloadJson,
          headers: {
            "content-type": "application/json",
            "x-covenant-delivery-id": delivery.deliveryId,
            "x-covenant-timestamp": String(timestamp),
            "x-covenant-signature": `v1=${signature}`,
          },
        });
        if (result.status >= 200 && result.status < 300) {
          const next = this.#runtime.store.updateWebhookDelivery({
            deliveryId: delivery.deliveryId,
            status: "DELIVERED",
            attemptCount: attempt,
            nextAttemptAt: now,
            lastAttemptAt: now,
            deliveredAt: now,
            at: now,
          });
          if (next !== undefined) delivered.push(next);
        } else {
          const status = attempt >= MAX_ATTEMPTS ? "FAILED" : "RETRYING";
          const next = this.#runtime.store.updateWebhookDelivery({
            deliveryId: delivery.deliveryId,
            status,
            attemptCount: attempt,
            nextAttemptAt:
              now + Math.min(86_400_000, 1000 * 2 ** (attempt - 1)),
            lastAttemptAt: now,
            lastError: `HTTP_${String(result.status)}`,
            at: now,
          });
          if (next !== undefined) delivered.push(next);
        }
      } catch (error) {
        const status = attempt >= MAX_ATTEMPTS ? "FAILED" : "RETRYING";
        const reason =
          error instanceof Error
            ? redactSensitiveText(error.message).slice(0, 160)
            : "delivery failed";
        const next = this.#runtime.store.updateWebhookDelivery({
          deliveryId: delivery.deliveryId,
          status,
          attemptCount: attempt,
          nextAttemptAt: now + Math.min(86_400_000, 1000 * 2 ** (attempt - 1)),
          lastAttemptAt: now,
          lastError: reason,
          at: now,
        });
        if (next !== undefined) delivered.push(next);
      }
    }
    return delivered;
  }
}
