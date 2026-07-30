import { keccak256, stringToHex, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  arcDeploymentManifestSchema,
  parseArcDeploymentManifest,
  type ArcManifestAnchors,
} from "../src/deployment-manifest.js";
import {
  covenantVaultConstructorDigest,
  covenantVaultConstructorConfigurationSchema,
} from "../src/deployment-plan.js";

const token = "0x3600000000000000000000000000000000000000" as Address;
const profileDigest: Hex = `0x${"11".repeat(32)}`;
const planDigest: Hex = `0x${"22".repeat(32)}`;
const anchors: ArcManifestAnchors = {
  chainId: "5042002",
  usdcInterfaceAddress: token,
  profileDigest,
  planDigest,
};
const constructor = covenantVaultConstructorConfigurationSchema.parse({
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
});
const validManifest = {
  schemaVersion: "1",
  trustedNetworkProfileDigest: profileDigest,
  planDigest,
  chainId: "5042002",
  contractAddress: "0x820e038c1ea23f9aee2db4d83ae07c5f23f39b75",
  deploymentTransactionHash: `0x${"03".repeat(32)}`,
  deploymentBlockNumber: "123",
  deploymentBlockHash: `0x${"04".repeat(32)}`,
  deployerAddress: "0xef5d9a2082601688fea0161bdc0497a0694c666a",
  creationBytecodeHash: `0x${"05".repeat(32)}`,
  actualRuntimeCodeHash: `0x${"06".repeat(32)}`,
  canonicalAbiHash: `0x${"07".repeat(32)}`,
  constructorDigest: covenantVaultConstructorDigest(constructor),
  completeInitCodeHash: `0x${"08".repeat(32)}`,
  constructor,
  immutableValues: {
    covenantId: constructor.covenantId,
    issuer: constructor.issuer,
    agentSigner: constructor.agentSigner,
    authorizationSigner: constructor.authorizationSigner,
    token: constructor.token,
    recipient: constructor.recipient,
    maxAmountPerPayment: constructor.maxAmountPerPayment,
    totalBudget: constructor.totalBudget,
    maxPaymentCount: constructor.maxPaymentCount,
    validAfter: constructor.validAfter,
    validUntil: constructor.validUntil,
    purposeHash: keccak256(stringToHex(constructor.purpose)),
    policyHash: constructor.policyHash,
    policyVersionHash: keccak256(stringToHex(constructor.policyVersion)),
  },
  sourceGitCommit: "a".repeat(40),
  solidityVersion: "0.8.28",
  forgeVersion: "1.7.1",
  optimizerEnabled: true,
  optimizerRuns: "200",
  viaIr: true,
  metadataBytecodeHash: "ipfs",
  artifactEvmTarget: "prague",
  receiptStatus: "SUCCESSFUL_EXECUTION",
  finalityState: "FINAL_ARC_TRANSACTION",
  verificationTimestamp: "2026-07-30T16:29:33.000Z",
  providerCorroborationState: "INDEPENDENTLY_CORROBORATED",
} as const;

describe("future Arc deployment manifest", () => {
  it("strictly parses the complete future record", () => {
    expect(parseArcDeploymentManifest(validManifest, anchors)).toEqual(
      arcDeploymentManifestSchema.parse(validManifest),
    );
  });

  it("rejects unknown and secret fields", () => {
    expect(() =>
      arcDeploymentManifestSchema.parse({
        ...validManifest,
        privateKey: `0x${"ab".repeat(32)}`,
      }),
    ).toThrow();
  });

  it("rejects invalid hashes and finality states", () => {
    expect(() =>
      arcDeploymentManifestSchema.parse({
        ...validManifest,
        deploymentBlockHash: "0x12",
      }),
    ).toThrow();
    expect(() =>
      arcDeploymentManifestSchema.parse({
        ...validManifest,
        finalityState: "PENDING",
      }),
    ).toThrow();
  });

  it("rejects wrong chain, profile, plan, and token linkage", () => {
    expect(() =>
      parseArcDeploymentManifest({ ...validManifest, chainId: "1" }, anchors),
    ).toThrow();
    expect(() =>
      parseArcDeploymentManifest(validManifest, {
        ...anchors,
        profileDigest: `0x${"ff".repeat(32)}`,
      }),
    ).toThrow();
    expect(() =>
      parseArcDeploymentManifest(validManifest, {
        ...anchors,
        planDigest: `0x${"ff".repeat(32)}`,
      }),
    ).toThrow();
  });

  it("rejects corrupted immutable values", () => {
    expect(() =>
      arcDeploymentManifestSchema.parse({
        ...validManifest,
        immutableValues: {
          ...validManifest.immutableValues,
          totalBudget: "999",
        },
      }),
    ).toThrow();
    expect(() =>
      arcDeploymentManifestSchema.parse({
        ...validManifest,
        constructorDigest: `0x${"ff".repeat(32)}`,
      }),
    ).toThrow();
  });

  it("accepts only the two frozen provider-evidence states", () => {
    expect(
      arcDeploymentManifestSchema.parse({
        ...validManifest,
        providerCorroborationState: "PRIMARY_ONLY",
      }).providerCorroborationState,
    ).toBe("PRIMARY_ONLY");
    expect(() =>
      arcDeploymentManifestSchema.parse({
        ...validManifest,
        providerCorroborationState: "QUORUM",
      }),
    ).toThrow();
  });
});
