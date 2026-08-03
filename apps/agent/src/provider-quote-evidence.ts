import { encodeAbiParameters, keccak256, stringToHex, type Hex } from "viem";
import {
  formatUsdc,
  positiveMoneySchema,
  positiveUintStringSchema,
  timestampSchema,
} from "@covenant/spec";
import { z } from "zod";
import { AgentError, callDependency } from "./errors.js";

const PROVIDER_ID = "runpod" as const;
const PRODUCT_ID = "gpu-h100-hour" as const;
const GPU_MODEL = "H100" as const;
const QUANTITY = "1" as const;
const DURATION_SECONDS = "3600" as const;
const CURRENCY = "USDC" as const;

const EVIDENCE_DOMAIN_TAG = keccak256(
  stringToHex("COV-013:NormalizedGpuQuoteEvidenceV1"),
);

const normalizedGpuQuoteEvidenceV1Schema = z
  .object({
    version: z.literal("1"),
    providerId: z.literal(PROVIDER_ID),
    quoteId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
    productId: z.literal(PRODUCT_ID),
    gpuModel: z.literal(GPU_MODEL),
    quantity: z.literal(QUANTITY),
    durationSeconds: z.literal(DURATION_SECONDS),
    currency: z.literal(CURRENCY),
    amount: z.string(),
    quotedAt: z.string(),
    expiresAt: z.string(),
  })
  .strict();

export type NormalizedGpuQuoteEvidenceV1 = Readonly<{
  version: "1";
  providerId: typeof PROVIDER_ID;
  quoteId: string;
  productId: typeof PRODUCT_ID;
  gpuModel: typeof GPU_MODEL;
  quantity: typeof QUANTITY;
  durationSeconds: typeof DURATION_SECONDS;
  currency: typeof CURRENCY;
  amount: string;
  quotedAt: string;
  expiresAt: string;
}>;

export type NormalizedGpuQuoteEvidenceResultV1 = Readonly<{
  evidence: NormalizedGpuQuoteEvidenceV1;
  fingerprint: Hex;
}>;

export type ProviderQuoteEvidenceBoundary = Readonly<{
  normalizeQuoteEvidence(input: unknown): Promise<unknown>;
}>;

export type QuoteEvidenceClock = Readonly<{
  now(): unknown;
}>;

export type ProviderQuoteEvidenceDependencies = Readonly<{
  clock: QuoteEvidenceClock;
  maximumAmount: unknown;
  maxQuoteAgeSeconds: unknown;
  maxQuoteLifetimeSeconds: unknown;
}>;

type ParsedDependencies = Readonly<{
  clock: QuoteEvidenceClock;
  maximumAmount: bigint;
  maxQuoteAgeSeconds: bigint;
  maxQuoteLifetimeSeconds: bigint;
}>;

function isQuoteEvidenceClock(value: unknown): value is QuoteEvidenceClock {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return "now" in value && typeof value.now === "function";
}

function parseDependencies(dependencies: unknown): ParsedDependencies {
  try {
    if (typeof dependencies !== "object" || dependencies === null) {
      throw new Error("invalid dependency shape");
    }

    const candidate = dependencies as {
      clock?: unknown;
      maximumAmount?: unknown;
      maxQuoteAgeSeconds?: unknown;
      maxQuoteLifetimeSeconds?: unknown;
    };

    if (!isQuoteEvidenceClock(candidate.clock)) {
      throw new Error("invalid dependency shape");
    }

    return Object.freeze({
      clock: candidate.clock,
      maximumAmount: positiveMoneySchema.parse(candidate.maximumAmount),
      maxQuoteAgeSeconds: positiveUintStringSchema.parse(
        candidate.maxQuoteAgeSeconds,
      ),
      maxQuoteLifetimeSeconds: positiveUintStringSchema.parse(
        candidate.maxQuoteLifetimeSeconds,
      ),
    });
  } catch {
    throw new AgentError("QUOTE_EVIDENCE_CONFIGURATION_INVALID");
  }
}

function parseEvidence(input: unknown): Readonly<{
  rawAmount: bigint;
  quotedAt: bigint;
  expiresAt: bigint;
  quoteId: string;
}> {
  try {
    const parsed = normalizedGpuQuoteEvidenceV1Schema.parse(input);
    const rawAmount = positiveMoneySchema.parse(parsed.amount);
    const quotedAt = timestampSchema.parse(parsed.quotedAt);
    const expiresAt = timestampSchema.parse(parsed.expiresAt);

    if (expiresAt <= quotedAt) {
      throw new Error("invalid evidence ordering");
    }

    return { rawAmount, quotedAt, expiresAt, quoteId: parsed.quoteId };
  } catch {
    throw new AgentError("QUOTE_EVIDENCE_INVALID");
  }
}

function canonicalEvidence(
  input: Readonly<{
    rawAmount: bigint;
    quotedAt: bigint;
    expiresAt: bigint;
    quoteId: string;
  }>,
): NormalizedGpuQuoteEvidenceV1 {
  return Object.freeze({
    version: "1",
    providerId: PROVIDER_ID,
    quoteId: input.quoteId,
    productId: PRODUCT_ID,
    gpuModel: GPU_MODEL,
    quantity: QUANTITY,
    durationSeconds: DURATION_SECONDS,
    currency: CURRENCY,
    amount: formatUsdc(input.rawAmount),
    quotedAt: input.quotedAt.toString(),
    expiresAt: input.expiresAt.toString(),
  });
}

function fingerprintEvidence(
  input: Readonly<{
    evidence: NormalizedGpuQuoteEvidenceV1;
    amount: bigint;
    quotedAt: bigint;
    expiresAt: bigint;
  }>,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "string" },
        { type: "string" },
        { type: "string" },
        { type: "string" },
        { type: "string" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "string" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [
        EVIDENCE_DOMAIN_TAG,
        input.evidence.version,
        input.evidence.providerId,
        input.evidence.quoteId,
        input.evidence.productId,
        input.evidence.gpuModel,
        BigInt(input.evidence.quantity),
        BigInt(input.evidence.durationSeconds),
        input.evidence.currency,
        input.amount,
        input.quotedAt,
        input.expiresAt,
      ],
    ),
  );
}

async function readClock(dependencies: ParsedDependencies): Promise<bigint> {
  return callDependency({
    operation: async () =>
      timestampSchema.parse(await dependencies.clock.now()),
    code: "QUOTE_EVIDENCE_CLOCK_FAILURE",
  });
}

function assertCurrent(
  input: Readonly<{
    quotedAt: bigint;
    expiresAt: bigint;
    now: bigint;
    maxQuoteAgeSeconds: bigint;
  }>,
): void {
  if (
    input.quotedAt > input.now ||
    input.now >= input.expiresAt ||
    input.now - input.quotedAt > input.maxQuoteAgeSeconds
  ) {
    throw new AgentError("QUOTE_EVIDENCE_NOT_CURRENT");
  }
}

export function createProviderQuoteEvidenceBoundary(
  dependencies: ProviderQuoteEvidenceDependencies,
): ProviderQuoteEvidenceBoundary {
  const parsedDependencies = parseDependencies(dependencies);

  async function normalizeQuoteEvidence(input: unknown): Promise<unknown> {
    const parsed = parseEvidence(input);

    if (
      parsed.expiresAt - parsed.quotedAt >
      parsedDependencies.maxQuoteLifetimeSeconds
    ) {
      throw new AgentError("QUOTE_EVIDENCE_LIFETIME_INVALID");
    }

    if (parsed.rawAmount > parsedDependencies.maximumAmount) {
      throw new AgentError("QUOTE_AMOUNT_EXCEEDS_MAXIMUM");
    }

    const now = await readClock(parsedDependencies);
    assertCurrent({
      quotedAt: parsed.quotedAt,
      expiresAt: parsed.expiresAt,
      now,
      maxQuoteAgeSeconds: parsedDependencies.maxQuoteAgeSeconds,
    });

    const evidence = canonicalEvidence(parsed);
    const result = Object.freeze({
      evidence,
      fingerprint: fingerprintEvidence({
        evidence,
        amount: parsed.rawAmount,
        quotedAt: parsed.quotedAt,
        expiresAt: parsed.expiresAt,
      }),
    });

    return result;
  }

  return Object.freeze({ normalizeQuoteEvidence });
}
