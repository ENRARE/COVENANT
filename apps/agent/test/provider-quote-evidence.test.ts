import { readFile } from "node:fs/promises";
import { encodeAbiParameters, keccak256, stringToHex, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  AgentError,
  createProviderQuoteEvidenceBoundary,
  type NormalizedGpuQuoteEvidenceResultV1,
  type NormalizedGpuQuoteEvidenceV1,
  type ProviderQuoteEvidenceDependencies,
} from "../src/index.js";

const NOW = "2000000100";

function validEvidence(
  overrides: Partial<NormalizedGpuQuoteEvidenceV1> = {},
): Record<string, unknown> {
  return {
    version: "1",
    providerId: "runpod",
    quoteId: "quote_H100-2026.08.03",
    productId: "gpu-h100-hour",
    gpuModel: "H100",
    quantity: "1",
    durationSeconds: "3600",
    currency: "USDC",
    amount: "12.3456",
    quotedAt: "2000000000",
    expiresAt: "2000000200",
    ...overrides,
  };
}

function createHarness(
  overrides: Partial<ProviderQuoteEvidenceDependencies> = {},
) {
  const clock = vi.fn<() => unknown>(() => NOW);
  const dependencies: ProviderQuoteEvidenceDependencies = {
    clock: { now: clock },
    maximumAmount: "20",
    maxQuoteAgeSeconds: "100",
    maxQuoteLifetimeSeconds: "300",
    ...overrides,
  };

  return {
    boundary: createProviderQuoteEvidenceBoundary(dependencies),
    clock,
  };
}

async function normalize(
  input: unknown,
  overrides: Partial<ProviderQuoteEvidenceDependencies> = {},
): Promise<NormalizedGpuQuoteEvidenceResultV1> {
  const result =
    await createHarness(overrides).boundary.normalizeQuoteEvidence(input);
  return result as NormalizedGpuQuoteEvidenceResultV1;
}

function referenceFingerprint(evidence: NormalizedGpuQuoteEvidenceV1): Hex {
  const domainTag = keccak256(
    stringToHex("COV-013:NormalizedGpuQuoteEvidenceV1"),
  );
  const wholeAndFraction = evidence.amount.split(".");
  const amount = BigInt(
    `${wholeAndFraction[0] ?? "0"}${(wholeAndFraction[1] ?? "").padEnd(6, "0")}`,
  );

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
        domainTag,
        evidence.version,
        evidence.providerId,
        evidence.quoteId,
        evidence.productId,
        evidence.gpuModel,
        BigInt(evidence.quantity),
        BigInt(evidence.durationSeconds),
        evidence.currency,
        amount,
        BigInt(evidence.quotedAt),
        BigInt(evidence.expiresAt),
      ],
    ),
  );
}

describe("COV-013 unsigned normalized provider-quote evidence", () => {
  it("exposes exactly one frozen public method and returns an exact frozen result", async () => {
    const harness = createHarness();
    expect(Object.keys(harness.boundary)).toEqual(["normalizeQuoteEvidence"]);
    expect(Object.isFrozen(harness.boundary)).toBe(true);

    const result = (await harness.boundary.normalizeQuoteEvidence(
      validEvidence(),
    )) as NormalizedGpuQuoteEvidenceResultV1;

    expect(Object.keys(result)).toEqual(["evidence", "fingerprint"]);
    expect(Object.keys(result.evidence)).toEqual([
      "version",
      "providerId",
      "quoteId",
      "productId",
      "gpuModel",
      "quantity",
      "durationSeconds",
      "currency",
      "amount",
      "quotedAt",
      "expiresAt",
    ]);
    expect(result.evidence).toEqual(validEvidence());
    expect(result.fingerprint).toMatch(/^0x[0-9a-f]{64}$/);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.evidence)).toBe(true);
    expect(harness.clock).toHaveBeenCalledTimes(1);
  });

  it("reconstructs evidence without retaining the untrusted object", async () => {
    const input = validEvidence();
    const result = await normalize(input);

    expect(result.evidence).not.toBe(input);
    input.quoteId = "mutated-after-normalization";
    expect(result.evidence.quoteId).toBe("quote_H100-2026.08.03");
  });

  it.each([
    ["null", null],
    ["array", []],
    ["string", "quote"],
    ["number", 1],
    ["boolean", true],
    ["undefined", undefined],
    ["function", () => validEvidence()],
    [
      "missing field",
      (() => {
        const input = validEvidence();
        delete input.quoteId;
        return input;
      })(),
    ],
    ["unknown field", { ...validEvidence(), extra: true }],
  ])("rejects malformed input classes: %s", async (_label, input) => {
    const harness = createHarness();
    await expect(
      harness.boundary.normalizeQuoteEvidence(input),
    ).rejects.toEqual(new AgentError("QUOTE_EVIDENCE_INVALID"));
    expect(harness.clock).not.toHaveBeenCalled();
  });

  it.each([
    ["version", "2"],
    ["providerId", "other-provider"],
    ["productId", "gpu-a100-hour"],
    ["gpuModel", "A100"],
    ["quantity", "2"],
    ["durationSeconds", "7200"],
    ["currency", "USD"],
  ])("rejects a fixed literal mismatch: %s", async (field, value) => {
    await expect(
      createHarness().boundary.normalizeQuoteEvidence({
        ...validEvidence(),
        [field]: value,
      }),
    ).rejects.toEqual(new AgentError("QUOTE_EVIDENCE_INVALID"));
  });

  it.each([
    ["one character", "A"],
    ["all approved punctuation", "A.z_0-9"],
    ["maximum length", `A${"z".repeat(127)}`],
  ])("accepts quoteId grammar boundary: %s", async (_label, quoteId) => {
    await expect(normalize(validEvidence({ quoteId }))).resolves.toMatchObject({
      evidence: { quoteId },
    });
  });

  it.each([
    ["empty", ""],
    ["starts with punctuation", "_quote"],
    ["space", "quote id"],
    ["slash", "quote/id"],
    ["colon", "quote:id"],
    ["non-ASCII", "quoté"],
    ["too long", `A${"z".repeat(128)}`],
  ])("rejects quoteId grammar violation: %s", async (_label, quoteId) => {
    await expect(
      createHarness().boundary.normalizeQuoteEvidence(
        validEvidence({ quoteId }),
      ),
    ).rejects.toEqual(new AgentError("QUOTE_EVIDENCE_INVALID"));
  });

  it.each([
    ["1", "1"],
    ["1.0", "1"],
    ["1.000000", "1"],
    ["0.000001", "0.000001"],
    ["12.345600", "12.3456"],
  ])("canonicalizes accepted money %s to %s", async (amount, canonical) => {
    const result = await normalize(validEvidence({ amount }));
    expect(result.evidence.amount).toBe(canonical);
  });

  it.each([
    ["JavaScript number", 1],
    ["zero", "0"],
    ["negative", "-1"],
    ["explicit plus", "+1"],
    ["leading zero", "01"],
    ["scientific notation", "1e3"],
    ["comma", "1,000"],
    ["excess precision", "0.0000001"],
    ["empty", ""],
    ["whitespace", " 1"],
    [
      "uint256 overflow",
      "115792089237316195423570985008687907853269984665640564039457584007913130",
    ],
  ])("rejects unsafe money: %s", async (_label, amount) => {
    await expect(
      createHarness().boundary.normalizeQuoteEvidence({
        ...validEvidence(),
        amount,
      }),
    ).rejects.toEqual(new AgentError("QUOTE_EVIDENCE_INVALID"));
  });

  it("accepts an amount exactly at the trusted maximum", async () => {
    await expect(
      normalize(validEvidence({ amount: "20.000000" })),
    ).resolves.toMatchObject({ evidence: { amount: "20" } });
  });

  it("rejects an amount one base unit above the trusted maximum before reading the clock", async () => {
    const harness = createHarness();
    await expect(
      harness.boundary.normalizeQuoteEvidence(
        validEvidence({ amount: "20.000001" }),
      ),
    ).rejects.toEqual(new AgentError("QUOTE_AMOUNT_EXCEEDS_MAXIMUM"));
    expect(harness.clock).not.toHaveBeenCalled();
  });

  it.each([
    ["zero quotedAt", { quotedAt: "0" }],
    ["leading-zero quotedAt", { quotedAt: "02000000000" }],
    ["fractional quotedAt", { quotedAt: "2000000000.0" }],
    ["number quotedAt", { quotedAt: 2_000_000_000 }],
    ["zero expiresAt", { expiresAt: "0" }],
    ["leading-zero expiresAt", { expiresAt: "02000000200" }],
    ["equal timestamps", { expiresAt: "2000000000" }],
    ["reversed timestamps", { expiresAt: "1999999999" }],
  ])(
    "rejects noncanonical or misordered timestamps: %s",
    async (_label, change) => {
      await expect(
        createHarness().boundary.normalizeQuoteEvidence({
          ...validEvidence(),
          ...change,
        }),
      ).rejects.toEqual(new AgentError("QUOTE_EVIDENCE_INVALID"));
    },
  );

  it.each([
    [
      "quotedAt equal to now",
      validEvidence({ quotedAt: NOW, expiresAt: "2000000101" }),
    ],
    [
      "age equal to maximum",
      validEvidence({ quotedAt: "2000000000", expiresAt: "2000000101" }),
    ],
    [
      "lifetime equal to maximum",
      validEvidence({ quotedAt: "2000000000", expiresAt: "2000000300" }),
    ],
  ])("accepts current-time boundary: %s", async (_label, evidence) => {
    await expect(normalize(evidence)).resolves.toBeDefined();
  });

  it.each([
    [
      "future quote",
      validEvidence({ quotedAt: "2000000101", expiresAt: "2000000200" }),
    ],
    ["expired quote", validEvidence({ expiresAt: NOW })],
    [
      "stale quote",
      validEvidence({ quotedAt: "1999999999", expiresAt: "2000000101" }),
    ],
  ])("rejects evidence that is not current: %s", async (_label, evidence) => {
    await expect(normalize(evidence)).rejects.toEqual(
      new AgentError("QUOTE_EVIDENCE_NOT_CURRENT"),
    );
  });

  it("rejects excessive quote lifetime before reading the clock", async () => {
    const harness = createHarness();
    await expect(
      harness.boundary.normalizeQuoteEvidence(
        validEvidence({ expiresAt: "2000000301" }),
      ),
    ).rejects.toEqual(new AgentError("QUOTE_EVIDENCE_LIFETIME_INVALID"));
    expect(harness.clock).not.toHaveBeenCalled();
  });

  it("matches the deterministic golden ABI/Keccak fingerprint vector", async () => {
    const result = await normalize(validEvidence());
    expect(result.fingerprint).toBe(
      "0xb08244ea36f852e528babc3d0d7520ce618b55893bcd3f1667b1530dc698e84b",
    );
    expect(result.fingerprint).toBe(referenceFingerprint(result.evidence));
  });

  it("gives equivalent amount representations the same normalized evidence and fingerprint", async () => {
    const results = await Promise.all(
      ["1", "1.0", "1.000000"].map((amount) =>
        normalize(validEvidence({ amount })),
      ),
    );
    expect(results.map(({ evidence }) => evidence.amount)).toEqual([
      "1",
      "1",
      "1",
    ]);
    expect(new Set(results.map(({ fingerprint }) => fingerprint))).toHaveLength(
      1,
    );
  });

  it("commits to every normalized evidence field in fixed order", async () => {
    const result = await normalize(validEvidence());
    const baseline = referenceFingerprint(result.evidence);
    const changes: Record<keyof NormalizedGpuQuoteEvidenceV1, string> = {
      version: "2",
      providerId: "other-provider",
      quoteId: "other-quote",
      productId: "gpu-a100-hour",
      gpuModel: "A100",
      quantity: "2",
      durationSeconds: "7200",
      currency: "OTHER",
      amount: "12.345601",
      quotedAt: "2000000001",
      expiresAt: "2000000201",
    };

    for (const field of Object.keys(
      changes,
    ) as (keyof NormalizedGpuQuoteEvidenceV1)[]) {
      const changed = {
        ...result.evidence,
        [field]: changes[field],
      } as NormalizedGpuQuoteEvidenceV1;
      expect(referenceFingerprint(changed), field).not.toBe(baseline);
    }
  });

  it("is independent from raw JSON property order and whitespace", async () => {
    const firstInput = JSON.parse(JSON.stringify(validEvidence()));
    const secondInput = JSON.parse(`{
      "expiresAt": "2000000200", "amount": "12.345600",
      "currency": "USDC", "durationSeconds": "3600", "quantity": "1",
      "gpuModel": "H100", "productId": "gpu-h100-hour",
      "quoteId": "quote_H100-2026.08.03", "providerId": "runpod",
      "version": "1", "quotedAt": "2000000000"
    }`);
    const [first, second] = await Promise.all([
      normalize(firstInput),
      normalize(secondInput),
    ]);
    expect(second.evidence).toEqual(first.evidence);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it.each([
    [
      "synchronous throw",
      () => {
        throw new Error("SENSITIVE_CLOCK_THROW quote-ID amount fingerprint");
      },
    ],
    [
      "rejected promise",
      () =>
        Promise.reject(
          new Error("SENSITIVE_CLOCK_REJECTION provider response"),
        ),
    ],
    ["malformed output", () => ({ raw: "SENSITIVE_CLOCK_OUTPUT" })],
  ])("sanitizes clock %s", async (_label, now) => {
    const harness = createHarness({ clock: { now } });
    let failure: unknown;
    try {
      await harness.boundary.normalizeQuoteEvidence(validEvidence());
    } catch (error) {
      failure = error;
    }

    expect(JSON.parse(JSON.stringify(failure))).toEqual({
      name: "AgentError",
      code: "QUOTE_EVIDENCE_CLOCK_FAILURE",
      message: "Provider quote evidence clock failed",
    });
    expect((failure as Error).stack).toBeUndefined();
    expect(failure).not.toHaveProperty("cause");
    const serialized = JSON.stringify(failure);
    for (const forbidden of [
      "SENSITIVE",
      "quote-ID",
      "amount",
      "fingerprint",
      "provider response",
      "stack",
      "cause",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it.each([
    ["null dependencies", null],
    [
      "missing clock",
      {
        clock: undefined,
        maximumAmount: "1",
        maxQuoteAgeSeconds: "1",
        maxQuoteLifetimeSeconds: "1",
      },
    ],
    [
      "malformed clock",
      {
        clock: {},
        maximumAmount: "1",
        maxQuoteAgeSeconds: "1",
        maxQuoteLifetimeSeconds: "1",
      },
    ],
    [
      "zero maximum",
      {
        clock: { now: () => NOW },
        maximumAmount: "0",
        maxQuoteAgeSeconds: "1",
        maxQuoteLifetimeSeconds: "1",
      },
    ],
    [
      "number maximum",
      {
        clock: { now: () => NOW },
        maximumAmount: 1,
        maxQuoteAgeSeconds: "1",
        maxQuoteLifetimeSeconds: "1",
      },
    ],
    [
      "zero age",
      {
        clock: { now: () => NOW },
        maximumAmount: "1",
        maxQuoteAgeSeconds: "0",
        maxQuoteLifetimeSeconds: "1",
      },
    ],
    [
      "number age",
      {
        clock: { now: () => NOW },
        maximumAmount: "1",
        maxQuoteAgeSeconds: 1,
        maxQuoteLifetimeSeconds: "1",
      },
    ],
    [
      "zero lifetime",
      {
        clock: { now: () => NOW },
        maximumAmount: "1",
        maxQuoteAgeSeconds: "1",
        maxQuoteLifetimeSeconds: "0",
      },
    ],
    [
      "number lifetime",
      {
        clock: { now: () => NOW },
        maximumAmount: "1",
        maxQuoteAgeSeconds: "1",
        maxQuoteLifetimeSeconds: 1,
      },
    ],
  ])(
    "rejects constructor configuration without reading the clock: %s",
    (_label, dependencies) => {
      const clock = vi.fn(() => NOW);
      const input =
        dependencies !== null && typeof dependencies === "object"
          ? { ...dependencies }
          : dependencies;
      expect(() =>
        createProviderQuoteEvidenceBoundary(
          input as ProviderQuoteEvidenceDependencies,
        ),
      ).toThrow(new AgentError("QUOTE_EVIDENCE_CONFIGURATION_INVALID"));
      expect(clock).not.toHaveBeenCalled();
    },
  );

  it("has no network, environment, signing, repository, or execution capability", async () => {
    const harness = createHarness();
    for (const property of [
      "fetch",
      "http",
      "transport",
      "environment",
      "credential",
      "invoice",
      "paymentIntent",
      "signer",
      "wallet",
      "repository",
      "authority",
      "executor",
      "circle",
      "rpc",
      "transaction",
      "calldata",
      "submit",
      "execute",
      "deploy",
    ]) {
      expect(harness.boundary).not.toHaveProperty(property);
    }

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network access prohibited"));
    try {
      await harness.boundary.normalizeQuoteEvidence(validEvidence());
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }

    const source = await readFile(
      new URL("../src/provider-quote-evidence.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /Invoice|PaymentIntent|sign[A-Za-z]*\(|wallet|private.?key|Circle|\bRPC\b|authority|executor|transaction|calldata|deploy|fetch|https?:|process\.env|import\.meta\.env|repository|covenantId|RECORDED|EXACT_REPLAY|CONFLICT|EIP-712/i,
    );
    expect(source.match(/^import .* from |^} from /gm) ?? []).toHaveLength(4);
    expect(source).toContain('from "@covenant/spec"');
    expect(source).toContain('from "viem"');
    expect(source).toContain('from "zod"');
    expect(source).toContain('from "./errors.js"');
  });
});
