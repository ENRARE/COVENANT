import {
  getAddress,
  isAddress,
  isAddressEqual,
  isHex,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";
import type {
  CircleExecutionFingerprint,
  CircleOperationRecord,
} from "./types.js";
import {
  CIRCLE_MAX_RESPONSE_BYTES,
  CIRCLE_TRANSACTION_STATES,
} from "./types.js";
import { parseStrictJsonBytes } from "./strict-json.js";

const canonicalUuidV4Schema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const apiKeySchema = z.string().min(1).max(4096).refine(noControlCharacters);
const ciphertextSchema = z
  .string()
  .min(1)
  .max(16_384)
  .refine(noControlCharacters);
const feeLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
const transactionStateSchema = z.enum(CIRCLE_TRANSACTION_STATES);
const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-f]{64}$/)
  .transform((value) => value as Hex);
const fixedTransactionRequestSchema = z
  .object({
    chainId: z.literal(5_042_002n),
    to: z.string().refine((value) => isAddress(value, { strict: true })),
    value: z.literal(0n),
    data: z.string().refine((value) => isHex(value, { strict: true })),
  })
  .strict();

const configSchema = z
  .object({
    walletId: canonicalUuidV4Schema,
    contractAddress: z.string(),
    feeLevel: feeLevelSchema,
  })
  .strict();

const responseSchema = z
  .object({
    status: z.number().int().min(100).max(599),
    headers: z.record(z.string(), z.string()),
    body: z.instanceof(Uint8Array),
  })
  .strict();

const acceptedBodySchema = z
  .object({
    data: z
      .object({
        id: canonicalUuidV4Schema,
        state: transactionStateSchema,
      })
      .strict(),
  })
  .strict();
const statusBodySchema = z
  .object({
    data: z
      .object({
        id: canonicalUuidV4Schema,
        state: transactionStateSchema,
        txHash: z
          .string()
          .regex(/^0x[0-9a-fA-F]{64}$/)
          .optional(),
      })
      .strict(),
  })
  .strict();
const executionFingerprintSchema = z
  .object({
    operationKey: bytes32Schema,
    executionId: bytes32Schema,
    transactionDigest: bytes32Schema,
    walletId: canonicalUuidV4Schema,
    contractAddress: z
      .string()
      .refine((value) => isAddress(value, { strict: true })),
    feeLevel: feeLevelSchema,
  })
  .strict();
const operationRecordBase = {
  fingerprint: executionFingerprintSchema,
  idempotencyKey: canonicalUuidV4Schema,
} as const;
const operationRecordSchema = z.discriminatedUnion("state", [
  z
    .object({
      ...operationRecordBase,
      state: z.literal("PREPARED"),
      attemptCount: z.literal(0),
    })
    .strict(),
  z
    .object({
      ...operationRecordBase,
      state: z.literal("SUBMISSION_ATTEMPT_STARTED"),
      attemptCount: z.literal(1),
    })
    .strict(),
  z
    .object({
      ...operationRecordBase,
      state: z.literal("UNKNOWN"),
      attemptCount: z.literal(1),
    })
    .strict(),
  z
    .object({
      ...operationRecordBase,
      state: z.literal("ACCEPTED"),
      attemptCount: z.literal(1),
      providerTransactionId: canonicalUuidV4Schema,
      providerState: transactionStateSchema,
    })
    .strict(),
]);

export type ParsedCircleConfig = Readonly<{
  walletId: string;
  contractAddress: Address;
  feeLevel: "LOW" | "MEDIUM" | "HIGH";
}>;

function noControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

export function parseCircleConfig(value: unknown): ParsedCircleConfig {
  const parsed = configSchema.parse(value);
  if (!isAddress(parsed.contractAddress, { strict: true })) throw new Error();
  return Object.freeze({
    walletId: parsed.walletId,
    contractAddress: getAddress(parsed.contractAddress),
    feeLevel: parsed.feeLevel,
  });
}

export function parseCircleApiKey(value: unknown): string {
  return apiKeySchema.parse(value);
}

export function parseCircleCiphertext(value: unknown): string {
  return ciphertextSchema.parse(value);
}

export function parseCircleUuidV4(value: unknown): string {
  return canonicalUuidV4Schema.parse(value);
}

export function parseCircleOperationKey(value: unknown): Hex {
  return bytes32Schema.parse(value);
}

export function parseFixedCircleTransaction(value: unknown): {
  chainId: 5_042_002n;
  to: Address;
  value: 0n;
  data: Hex;
} {
  const parsed = fixedTransactionRequestSchema.parse(value);
  return {
    chainId: parsed.chainId,
    to: parsed.to,
    value: parsed.value,
    data: parsed.data,
  };
}

export function parseCircleHttpResponse(value: unknown) {
  const parsed = responseSchema.parse(value);
  if (parsed.body.byteLength > CIRCLE_MAX_RESPONSE_BYTES) throw new Error();
  const headers: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const [key, headerValue] of Object.entries(parsed.headers)) {
    const normalizedKey = key.toLowerCase();
    if (Object.hasOwn(headers, normalizedKey)) throw new Error();
    headers[normalizedKey] = headerValue;
  }
  const contentType = headers["content-type"]?.toLowerCase();
  const contentEncoding = headers["content-encoding"]?.toLowerCase();
  if (
    contentType !== "application/json" &&
    contentType !== "application/json; charset=utf-8"
  ) {
    throw new Error();
  }
  if (contentEncoding !== undefined && contentEncoding !== "identity") {
    throw new Error();
  }
  return {
    status: parsed.status,
    body: parseStrictJsonBytes(parsed.body, CIRCLE_MAX_RESPONSE_BYTES),
  } as const;
}

export function parseCircleAcceptedBody(value: unknown) {
  return acceptedBodySchema.parse(value).data;
}

export function parseCircleStatusBody(value: unknown, expectedId: string) {
  const parsed = statusBodySchema.parse(value).data;
  if (parsed.id !== expectedId) throw new Error();
  const hashRequired = ["SENT", "STUCK", "CONFIRMED", "COMPLETE"].includes(
    parsed.state,
  );
  if (hashRequired !== (parsed.txHash !== undefined)) throw new Error();
  return Object.freeze({
    id: parsed.id,
    state: parsed.state,
    ...(parsed.txHash === undefined
      ? {}
      : { transactionHash: parsed.txHash.toLowerCase() as Hex }),
  });
}

export function parseCircleOperationRecord(
  value: unknown,
): CircleOperationRecord {
  const parsed = operationRecordSchema.parse(value);
  const fingerprint = Object.freeze({
    operationKey: parsed.fingerprint.operationKey,
    executionId: parsed.fingerprint.executionId,
    transactionDigest: parsed.fingerprint.transactionDigest,
    walletId: parsed.fingerprint.walletId,
    contractAddress: parsed.fingerprint.contractAddress,
    feeLevel: parsed.fingerprint.feeLevel,
  }) satisfies CircleExecutionFingerprint;
  if (parsed.state === "ACCEPTED") {
    return Object.freeze({
      fingerprint,
      idempotencyKey: parsed.idempotencyKey,
      attemptCount: parsed.attemptCount,
      state: parsed.state,
      providerTransactionId: parsed.providerTransactionId,
      providerState: parsed.providerState,
    }) satisfies CircleOperationRecord;
  }
  if (parsed.state === "PREPARED") {
    return Object.freeze({
      fingerprint,
      idempotencyKey: parsed.idempotencyKey,
      attemptCount: parsed.attemptCount,
      state: parsed.state,
    }) satisfies CircleOperationRecord;
  }
  if (parsed.state === "SUBMISSION_ATTEMPT_STARTED") {
    return Object.freeze({
      fingerprint,
      idempotencyKey: parsed.idempotencyKey,
      attemptCount: parsed.attemptCount,
      state: parsed.state,
    }) satisfies CircleOperationRecord;
  }
  return Object.freeze({
    fingerprint,
    idempotencyKey: parsed.idempotencyKey,
    attemptCount: parsed.attemptCount,
    state: parsed.state,
  }) satisfies CircleOperationRecord;
}

export function assertConfiguredContract(
  configured: Address,
  transactionTarget: Address,
): void {
  if (!isAddressEqual(configured, transactionTarget)) throw new Error();
}
