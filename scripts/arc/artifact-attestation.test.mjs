import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  loadReviewedCovenantVaultArtifact,
  patchExpectedImmutableRuntime,
  REVIEWED_COVENANT_ARTIFACT,
  validateCovenantVaultArtifact,
  validateImmutableReferenceMap,
  validateProfileDigest,
  verifyImmutableAwareRuntime,
} from "./artifact-attestation.mjs";
import { ARC_TESTNET_SECURITY_PROFILE_DIGEST } from "../../packages/config/src/arc-testnet.ts";

const artifactPath = resolve(
  "packages/contracts/out/CovenantVault.sol/CovenantVault.json",
);
const abiPath = resolve("packages/contracts/abi/CovenantVault.json");

function rawArtifact() {
  return JSON.parse(readFileSync(artifactPath, "utf8"));
}

function committedAbi() {
  return JSON.parse(readFileSync(abiPath, "utf8"));
}

function immutableValues(references, byte = "11") {
  return Object.fromEntries(
    Object.keys(references).map((identifier) => [
      identifier,
      `0x${byte.repeat(references[identifier][0].length)}`,
    ]),
  );
}

function mutateByte(code, byteIndex) {
  const offset = 2 + byteIndex * 2;
  const original = code.slice(offset, offset + 2);
  const replacement = original === "ff" ? "00" : "ff";
  return `${code.slice(0, offset)}${replacement}${code.slice(offset + 2)}`;
}

test("reviewed CovenantVault artifact commitments remain exact", () => {
  const artifact = loadReviewedCovenantVaultArtifact();
  assert.equal(
    artifact.creationBytecodeHash,
    REVIEWED_COVENANT_ARTIFACT.creationBytecodeHash,
  );
  assert.equal(
    artifact.unpatchedRuntimeBytecodeHash,
    REVIEWED_COVENANT_ARTIFACT.unpatchedRuntimeBytecodeHash,
  );
  assert.equal(
    artifact.canonicalAbiHash,
    REVIEWED_COVENANT_ARTIFACT.canonicalAbiHash,
  );
  assert.equal(
    artifact.immutableReferenceMapDigest,
    REVIEWED_COVENANT_ARTIFACT.immutableReferenceMapDigest,
  );
  assert.equal(
    (artifact.creationBytecode.length - 2) / 2,
    REVIEWED_COVENANT_ARTIFACT.creationByteLength,
  );
  assert.equal(
    (artifact.unpatchedRuntimeBytecode.length - 2) / 2,
    REVIEWED_COVENANT_ARTIFACT.runtimeByteLength,
  );
});

test("Foundry configuration explicitly freezes Prague", () => {
  const configuration = readFileSync(
    resolve("packages/contracts/foundry.toml"),
    "utf8",
  );
  assert.match(configuration, /^evm_version = "prague"$/mu);
  assert.equal(
    rawArtifact().metadata.settings.evmVersion,
    REVIEWED_COVENANT_ARTIFACT.evmTarget,
  );
});

test("immutable reference validation rejects overlap and bounds errors", () => {
  assert.throws(() =>
    validateImmutableReferenceMap(
      { 1: [{ start: 0, length: 2 }], 2: [{ start: 1, length: 2 }] },
      4,
    ),
  );
  assert.throws(() =>
    validateImmutableReferenceMap({ 1: [{ start: 3, length: 2 }] }, 4),
  );
  assert.throws(() =>
    validateImmutableReferenceMap({ 1: [{ start: 0, length: 0 }] }, 4),
  );
});

test("runtime attestation preserves metadata and every non-immutable byte", () => {
  const artifact = loadReviewedCovenantVaultArtifact();
  const ignored = new Set();
  for (const references of Object.values(artifact.immutableReferences)) {
    for (const { start, length } of references) {
      for (let index = start; index < start + length; index += 1) {
        ignored.add(index);
      }
    }
  }
  const firstComparedByte = Array.from(
    { length: REVIEWED_COVENANT_ARTIFACT.runtimeByteLength },
    (_, index) => index,
  ).find((index) => !ignored.has(index));
  assert.notEqual(firstComparedByte, undefined);
  assert.throws(() =>
    verifyImmutableAwareRuntime({
      actualRuntimeBytecode: mutateByte(
        artifact.unpatchedRuntimeBytecode,
        firstComparedByte,
      ),
      unpatchedRuntimeBytecode: artifact.unpatchedRuntimeBytecode,
      immutableReferences: artifact.immutableReferences,
    }),
  );
  assert.throws(() =>
    verifyImmutableAwareRuntime({
      actualRuntimeBytecode: mutateByte(
        artifact.unpatchedRuntimeBytecode,
        REVIEWED_COVENANT_ARTIFACT.runtimeByteLength - 1,
      ),
      unpatchedRuntimeBytecode: artifact.unpatchedRuntimeBytecode,
      immutableReferences: artifact.immutableReferences,
    }),
  );
});

test("runtime attestation verifies exact immutable encodings", () => {
  const artifact = loadReviewedCovenantVaultArtifact();
  const values = immutableValues(artifact.immutableReferences);
  const patched = patchExpectedImmutableRuntime(
    artifact.unpatchedRuntimeBytecode,
    artifact.immutableReferences,
    values,
  );
  assert.equal(
    verifyImmutableAwareRuntime({
      actualRuntimeBytecode: patched,
      unpatchedRuntimeBytecode: artifact.unpatchedRuntimeBytecode,
      immutableReferences: artifact.immutableReferences,
      expectedImmutableValues: values,
    }).runtimeByteLength,
    REVIEWED_COVENANT_ARTIFACT.runtimeByteLength,
  );
  const firstRange = artifact.immutableRanges[0];
  assert.throws(() =>
    verifyImmutableAwareRuntime({
      actualRuntimeBytecode: mutateByte(patched, firstRange.start),
      unpatchedRuntimeBytecode: artifact.unpatchedRuntimeBytecode,
      immutableReferences: artifact.immutableReferences,
      expectedImmutableValues: values,
    }),
  );
  assert.throws(() =>
    patchExpectedImmutableRuntime(
      artifact.unpatchedRuntimeBytecode,
      artifact.immutableReferences,
      { ...values, unexpected: `0x${"11".repeat(32)}` },
    ),
  );
});

test("artifact validation rejects compiler, EVM, metadata, and ABI drift", () => {
  const mutations = [
    (artifact) => {
      artifact.metadata.compiler.version = "0.8.29+commit.invalid";
    },
    (artifact) => {
      artifact.metadata.settings.evmVersion = "osaka";
    },
    (artifact) => {
      artifact.metadata.settings.metadata.bytecodeHash = "none";
    },
    (artifact) => {
      artifact.deployedBytecode.object = mutateByte(
        artifact.deployedBytecode.object,
        REVIEWED_COVENANT_ARTIFACT.runtimeByteLength - 1,
      );
    },
  ];
  for (const mutate of mutations) {
    const artifact = rawArtifact();
    mutate(artifact);
    assert.throws(() =>
      validateCovenantVaultArtifact(artifact, committedAbi()),
    );
  }
  const wrongAbi = committedAbi();
  wrongAbi.pop();
  assert.throws(() => validateCovenantVaultArtifact(rawArtifact(), wrongAbi));
});

test("profile commitment validation requires the exact digest", () => {
  assert.doesNotThrow(() =>
    validateProfileDigest(
      ARC_TESTNET_SECURITY_PROFILE_DIGEST,
      ARC_TESTNET_SECURITY_PROFILE_DIGEST,
    ),
  );
  assert.throws(() =>
    validateProfileDigest(
      `0x${"ff".repeat(32)}`,
      ARC_TESTNET_SECURITY_PROFILE_DIGEST,
    ),
  );
});
