import { getAddress, isAddress, type Hex } from "viem";
import { z } from "zod";
import {
  ARC_EVIDENCE_CONFLICT_REASONS,
  ARC_TESTNET_CHAIN_ID,
  type ArcExecutionEvidence,
  type KnownArcExecution,
} from "./types.js";

const hex32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value.toLowerCase() as Hex);
const addressSchema = z
  .string()
  .refine((value) => isAddress(value, { strict: true }))
  .transform((value) => getAddress(value));
const positiveDecimalSchema = z.string().regex(/^[1-9][0-9]*$/);
const nonnegativeDecimalSchema = z.string().regex(/^(0|[1-9][0-9]*)$/);
const rpcQuantitySchema = z
  .string()
  .regex(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/)
  .transform((value) => BigInt(value));

const priorVaultStateSchema = z
  .object({
    totalSpent: nonnegativeDecimalSchema,
    paymentCount: nonnegativeDecimalSchema,
    tokenBalance: nonnegativeDecimalSchema,
  })
  .strict();

const knownExecutionSchema = z
  .object({
    chainId: z.literal(ARC_TESTNET_CHAIN_ID),
    transactionHash: hex32Schema,
    vault: addressSchema,
    covenantId: hex32Schema,
    intentId: hex32Schema,
    authorizationId: hex32Schema,
    recipient: addressSchema,
    amount: positiveDecimalSchema,
    token: addressSchema,
    priorVaultState: priorVaultStateSchema.optional(),
  })
  .strict();

const logSchema = z
  .object({
    address: addressSchema,
    transactionHash: hex32Schema,
    blockHash: hex32Schema,
    blockNumber: rpcQuantitySchema,
    logIndex: rpcQuantitySchema,
    removed: z.boolean(),
    topics: z.array(hex32Schema).min(1).max(4),
    data: z
      .string()
      .max(2_048)
      .regex(/^0x(?:[0-9a-fA-F]{2})*$/),
  })
  .strict();

const receiptSchema = z
  .object({
    transactionHash: hex32Schema,
    to: addressSchema,
    blockHash: hex32Schema,
    blockNumber: rpcQuantitySchema,
    status: z.enum(["0x0", "0x1"]),
    logs: z.array(logSchema).max(256),
  })
  .strict();

const blockSchema = z
  .object({ number: rpcQuantitySchema, hash: hex32Schema })
  .strict();

const vaultStateSchema = z
  .object({
    totalSpent: rpcQuantitySchema,
    paymentCount: rpcQuantitySchema,
    revoked: z.boolean(),
    tokenBalance: rpcQuantitySchema,
  })
  .strict();

const providerEvidenceSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("UNKNOWN") }).strict(),
  z
    .object({
      status: z.literal("OBSERVED"),
      providerState: z.enum([
        "INITIATED",
        "CLEARED",
        "QUEUED",
        "SENT",
        "STUCK",
        "CONFIRMED",
        "COMPLETE",
        "FAILED",
        "DENIED",
        "CANCELLED",
      ]),
      transactionHash: hex32Schema.optional(),
    })
    .strict(),
]);

const normalizedVaultStateSchema = z
  .object({
    totalSpent: nonnegativeDecimalSchema,
    paymentCount: nonnegativeDecimalSchema,
    revoked: z.boolean(),
    tokenBalance: nonnegativeDecimalSchema,
  })
  .strict();

const observedSuccessSchema = z
  .object({
    status: z.literal("OBSERVED_SUCCESS"),
    chainId: z.literal(ARC_TESTNET_CHAIN_ID),
    transactionHash: hex32Schema,
    blockNumber: nonnegativeDecimalSchema,
    blockHash: hex32Schema,
    vault: addressSchema,
    covenantId: hex32Schema,
    intentId: hex32Schema,
    authorizationId: hex32Schema,
    recipient: addressSchema,
    amount: positiveDecimalSchema,
    token: addressSchema,
    transfer: z
      .object({
        source: addressSchema,
        recipient: addressSchema,
        amount: positiveDecimalSchema,
      })
      .strict(),
    vaultState: normalizedVaultStateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.transfer.source !== value.vault ||
      value.transfer.recipient !== value.recipient ||
      value.transfer.amount !== value.amount
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom });
    }
  });

const arcExecutionEvidenceSchema = z.union([
  observedSuccessSchema,
  z
    .object({
      status: z.literal("OBSERVED_REVERTED"),
      chainId: z.literal(ARC_TESTNET_CHAIN_ID),
      transactionHash: hex32Schema,
      blockNumber: nonnegativeDecimalSchema,
      blockHash: hex32Schema,
      vault: addressSchema,
    })
    .strict(),
  z.object({ status: z.literal("NOT_OBSERVED") }).strict(),
  z
    .object({
      status: z.literal("EVIDENCE_CONFLICT"),
      reason: z.enum(ARC_EVIDENCE_CONFLICT_REASONS),
    })
    .strict(),
  z.object({ status: z.literal("OBSERVATION_UNAVAILABLE") }).strict(),
]);

export function parseKnownArcExecution(value: unknown): KnownArcExecution {
  const parsed = knownExecutionSchema.parse(value);
  return Object.freeze({
    chainId: parsed.chainId,
    transactionHash: parsed.transactionHash,
    vault: parsed.vault,
    covenantId: parsed.covenantId,
    intentId: parsed.intentId,
    authorizationId: parsed.authorizationId,
    recipient: parsed.recipient,
    amount: parsed.amount,
    token: parsed.token,
    ...(parsed.priorVaultState === undefined
      ? {}
      : { priorVaultState: Object.freeze(parsed.priorVaultState) }),
  });
}

export function parseArcChainId(value: unknown): bigint {
  return rpcQuantitySchema.parse(value);
}

export function parseArcReceipt(value: unknown) {
  return receiptSchema.parse(value);
}

export function parseArcBlock(value: unknown) {
  return blockSchema.parse(value);
}

export function parseArcVaultState(value: unknown) {
  return vaultStateSchema.parse(value);
}

export function parseCircleProviderEvidence(value: unknown) {
  const parsed = providerEvidenceSchema.parse(value);
  if (parsed.status === "UNKNOWN")
    return Object.freeze({ status: "UNKNOWN" as const });
  return Object.freeze({
    status: parsed.status,
    providerState: parsed.providerState,
    ...(parsed.transactionHash === undefined
      ? {}
      : { transactionHash: parsed.transactionHash }),
  });
}

export function parseArcExecutionEvidence(
  value: unknown,
): ArcExecutionEvidence {
  return arcExecutionEvidenceSchema.parse(value);
}
