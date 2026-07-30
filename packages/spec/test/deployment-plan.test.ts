import { keccak256, type Address } from "viem";
import { describe, expect, it } from "vitest";
import {
  ARC_PLAN_MINIMUM_VALIDITY_BUFFER_SECONDS,
  arcDeploymentPlanInputSchema,
  arcDeploymentPlanSchema,
  canonicalDeploymentDigest,
  covenantVaultConstructorDigest,
  createArcDeploymentPlan,
  encodeCovenantVaultConstructor,
  parseArcDeploymentPlanInput,
  type ArcDeploymentAnchors,
  type ArcDeploymentPlanInput,
  type ReviewedArtifactCommitments,
} from "../src/deployment-plan.js";

const token = "0x3600000000000000000000000000000000000000" as Address;
const anchors: ArcDeploymentAnchors = {
  chainId: "5042002",
  usdcInterfaceAddress: token,
  profileDigest: `0x${"11".repeat(32)}`,
  nowSeconds: 1_780_000_000n,
};
const rawInput = {
  schemaVersion: "1",
  expectedChainId: "5042002",
  usdcInterfaceAddress: token,
  plannedDeployer: "0xef5d9a2082601688fea0161bdc0497a0694c666a",
  plannedTransactionPayer: "0xa6c515eee5c8fb95a47d0853fe4c46d2e6546a09",
  constructor: {
    covenantId: `0x${"01".repeat(32)}`,
    issuer: "0x467800d1a6a6c2a946be3d8e432683283d44852c",
    agentSigner: "0x30586d695f139b45da6b260e504b888bdce1e7d7",
    authorizationSigner: "0xbd2e72ac51d0bb9b68dfef497c0d51e1d93466b5",
    token,
    recipient: "0x4ce20760ef9436767a83e5520edb9dd281fc91bd",
    maxAmountPerPayment: "5000000000",
    totalBudget: "10000000000",
    maxPaymentCount: "3",
    validAfter: "1893456000",
    validUntil: "1894060800",
    purpose: "Purchase approved GPU compute",
    policyHash: `0x${"02".repeat(32)}`,
    policyVersion: "gpu-policy-1",
  },
} as const;
const artifact: ReviewedArtifactCommitments = {
  creationBytecode: "0x60006000",
  creationBytecodeHash: keccak256("0x60006000"),
  unpatchedRuntimeBytecodeHash: `0x${"22".repeat(32)}`,
  immutableReferenceMapDigest: `0x${"33".repeat(32)}`,
  canonicalAbiHash: `0x${"44".repeat(32)}`,
};

type DeepMutableWiden<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends bigint
      ? bigint
      : T extends object
        ? { -readonly [Key in keyof T]: DeepMutableWiden<T[Key]> }
        : T;

function mutableInput(): DeepMutableWiden<typeof rawInput> {
  return JSON.parse(JSON.stringify(rawInput)) as DeepMutableWiden<
    typeof rawInput
  >;
}

function parsed(
  input: unknown = mutableInput(),
  activeAnchors = anchors,
): ArcDeploymentPlanInput {
  return parseArcDeploymentPlanInput(input, activeAnchors);
}

function plan(input: ArcDeploymentPlanInput = parsed()) {
  return createArcDeploymentPlan({
    parsedInput: input,
    anchors,
    artifact,
    toolchain: {
      sourceGitCommit: "a".repeat(40),
      forgeVersion: "1.7.1",
    },
  });
}

describe("Arc deployment plans", () => {
  it("strictly parses the complete operational input", () => {
    expect(arcDeploymentPlanInputSchema.parse(rawInput)).toBeDefined();
    expect(() =>
      parsed({ ...rawInput, vendorSigner: rawInput.plannedDeployer }),
    ).toThrow();
  });

  it("uses exact deterministic Solidity constructor encoding", () => {
    const configuration = parsed().constructor;
    expect(encodeCovenantVaultConstructor(configuration)).toMatch(
      /^0x[0-9a-f]+$/u,
    );
    expect(covenantVaultConstructorDigest(configuration)).toBe(
      "0xeb8b1b26269a16ec4fc41dc20aea2f9ffb79dbcc4f2357fbdb6d135e202f5c1a",
    );
    expect(plan().completeInitCodeHash).toBe(
      "0x3f0562b74be122cc560927cb76d65001652e9b04ec9b3175194c18719d10d01b",
    );
  });

  it("produces a strict deterministic broadcastable plan", () => {
    const first = plan();
    const second = plan();
    expect(first).toEqual(second);
    expect(arcDeploymentPlanSchema.parse(first)).toEqual(first);
    expect(first.planStatus).toBe("BROADCASTABLE");
    expect(first.artifactEvmTarget).toBe("prague");
    expect(first.networkEvmTarget).toBe("osaka");
    const { canonicalPlanDigest, ...core } = first;
    expect(canonicalPlanDigest).toBe(canonicalDeploymentDigest(core as never));
  });

  it("keeps operational roles out of the constructor commitment", () => {
    const first = plan();
    const changedInput = mutableInput();
    changedInput.plannedDeployer = "0x820e038c1ea23f9aee2db4d83ae07c5f23f39b75";
    const changed = plan(parsed(changedInput));
    expect(changed.constructorEncodingDigest).toBe(
      first.constructorEncodingDigest,
    );
    expect(changed.completeInitCodeHash).toBe(first.completeInitCodeHash);
    expect(changed.canonicalPlanDigest).not.toBe(first.canonicalPlanDigest);
    expect("vendorSigner" in changed.constructor).toBe(false);
  });

  it("rejects wrong chain and wrong token anchors", () => {
    expect(() => parsed({ ...rawInput, expectedChainId: "1" })).toThrow();
    const wrongToken = mutableInput();
    wrongToken.usdcInterfaceAddress =
      "0x111111125421ca6dc452d289314280a0f8842a65";
    expect(() => parsed(wrongToken)).toThrow();
    const wrongConstructorToken = mutableInput();
    wrongConstructorToken.constructor.token =
      "0x111111125421ca6dc452d289314280a0f8842a65";
    expect(() => parsed(wrongConstructorToken)).toThrow();
  });

  it("rejects vault-prohibited role collisions", () => {
    const collision = mutableInput();
    collision.constructor.authorizationSigner = collision.constructor.issuer;
    expect(() => parsed(collision)).toThrow();
    const recipientCollision = mutableInput();
    recipientCollision.constructor.recipient =
      recipientCollision.constructor.token;
    expect(() => parsed(recipientCollision)).toThrow();
  });

  it("enforces expiry and the frozen seven-day buffer", () => {
    const insufficient = mutableInput();
    insufficient.constructor.validAfter = anchors.nowSeconds.toString();
    insufficient.constructor.validUntil = (
      anchors.nowSeconds +
      ARC_PLAN_MINIMUM_VALIDITY_BUFFER_SECONDS -
      1n
    ).toString();
    expect(() => parsed(insufficient)).toThrow();
    const exact = structuredClone(insufficient);
    exact.constructor.validUntil = (
      anchors.nowSeconds + ARC_PLAN_MINIMUM_VALIDITY_BUFFER_SECONDS
    ).toString();
    expect(() => parsed(exact)).not.toThrow();
    const expired = mutableInput();
    expired.constructor.validAfter = "1";
    expired.constructor.validUntil = "2";
    expect(() => parsed(expired)).toThrow();
  });

  it("rejects invalid limits, timestamps, and canonical numbers", () => {
    for (const [field, value] of [
      ["maxAmountPerPayment", "0"],
      ["maxPaymentCount", "01"],
      ["totalBudget", "-1"],
      ["validAfter", "1e9"],
    ] as const) {
      const invalid = mutableInput();
      invalid.constructor[field] = value;
      expect(() => parsed(invalid)).toThrow();
    }
    const excessive = mutableInput();
    excessive.constructor.maxAmountPerPayment = "10000000001";
    expect(() => parsed(excessive)).toThrow();
  });

  it("rejects secret-like fields and private-key-shaped free text", () => {
    expect(() =>
      parsed({ ...rawInput, privateKey: `0x${"ab".repeat(32)}` }),
    ).toThrow();
    const hidden = mutableInput();
    hidden.constructor.purpose = `0x${"ab".repeat(32)}`;
    expect(() => parsed(hidden)).toThrow();
  });

  it("rejects placeholder operational addresses", () => {
    const placeholder = mutableInput();
    placeholder.plannedDeployer = "0x1111111111111111111111111111111111111111";
    expect(() => parsed(placeholder)).toThrow();
  });

  it("rejects plan digest and constructor commitment mutation", () => {
    const valid = plan();
    expect(() =>
      arcDeploymentPlanSchema.parse({
        ...valid,
        canonicalPlanDigest: `0x${"ff".repeat(32)}`,
      }),
    ).toThrow();
    expect(() =>
      arcDeploymentPlanSchema.parse({
        ...valid,
        constructorEncodingDigest: `0x${"ff".repeat(32)}`,
      }),
    ).toThrow();
  });
});
