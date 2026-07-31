import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
import {
  CANONICAL_FOUNDRY_REMAPPINGS,
  isAbsoluteCompilerPath,
} from "./build-environment.mjs";
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

function rawBuildInfo() {
  const directory = resolve("packages/contracts/out/build-info");
  const files = readdirSync(directory).filter((file) => file.endsWith(".json"));
  assert.equal(files.length, 1);
  return JSON.parse(readFileSync(resolve(directory, files[0]), "utf8"));
}

function immutableValues(semanticMap, byte = "11") {
  return Object.fromEntries(
    semanticMap.map(({ label, ranges }) => [
      label,
      `0x${byte.repeat(Number(ranges[0].length))}`,
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
    artifact.semanticImmutableMapDigest,
    REVIEWED_COVENANT_ARTIFACT.semanticImmutableMapDigest,
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

test("canonical compiler metadata is path independent and keeps IPFS metadata", () => {
  const artifact = rawArtifact();
  assert.deepEqual(
    artifact.metadata.settings.remappings,
    CANONICAL_FOUNDRY_REMAPPINGS,
  );
  assert.equal(artifact.metadata.settings.metadata.bytecodeHash, "ipfs");
  assert.equal(
    Object.keys(artifact.metadata.sources).some((sourceUnit) =>
      isAbsoluteCompilerPath(sourceUnit),
    ),
    false,
  );
  assert.equal(
    artifact.metadata.settings.remappings.some((remapping) =>
      /(?:^[A-Za-z]:[\\/]|^\\\\|^\/)/u.test(remapping.split("=")[1]),
    ),
    false,
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
  for (const { ranges } of artifact.semanticImmutableMap) {
    for (const range of ranges) {
      const start = Number(range.start);
      const length = Number(range.length);
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
      semanticImmutableMap: artifact.semanticImmutableMap,
    }),
  );
  assert.throws(() =>
    verifyImmutableAwareRuntime({
      actualRuntimeBytecode: mutateByte(
        artifact.unpatchedRuntimeBytecode,
        REVIEWED_COVENANT_ARTIFACT.runtimeByteLength - 1,
      ),
      unpatchedRuntimeBytecode: artifact.unpatchedRuntimeBytecode,
      semanticImmutableMap: artifact.semanticImmutableMap,
    }),
  );
});

test("runtime attestation verifies exact immutable encodings", () => {
  const artifact = loadReviewedCovenantVaultArtifact();
  const values = immutableValues(artifact.semanticImmutableMap);
  const patched = patchExpectedImmutableRuntime(
    artifact.unpatchedRuntimeBytecode,
    artifact.semanticImmutableMap,
    values,
  );
  assert.equal(
    verifyImmutableAwareRuntime({
      actualRuntimeBytecode: patched,
      unpatchedRuntimeBytecode: artifact.unpatchedRuntimeBytecode,
      semanticImmutableMap: artifact.semanticImmutableMap,
      expectedImmutableValues: values,
    }).runtimeByteLength,
    REVIEWED_COVENANT_ARTIFACT.runtimeByteLength,
  );
  for (const { ranges } of artifact.semanticImmutableMap) {
    assert.throws(() =>
      verifyImmutableAwareRuntime({
        actualRuntimeBytecode: mutateByte(patched, Number(ranges[0].start)),
        unpatchedRuntimeBytecode: artifact.unpatchedRuntimeBytecode,
        semanticImmutableMap: artifact.semanticImmutableMap,
        expectedImmutableValues: values,
      }),
    );
  }
  assert.throws(() =>
    patchExpectedImmutableRuntime(
      artifact.unpatchedRuntimeBytecode,
      artifact.semanticImmutableMap,
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
    (artifact) => {
      const identifier = Object.keys(
        artifact.deployedBytecode.immutableReferences,
      )[0];
      artifact.deployedBytecode.immutableReferences[identifier].pop();
    },
    (artifact) => {
      const identifier = Object.keys(
        artifact.deployedBytecode.immutableReferences,
      )[0];
      artifact.deployedBytecode.immutableReferences[identifier].push({
        ...artifact.deployedBytecode.immutableReferences[identifier][0],
      });
    },
    (artifact) => {
      const references = Object.values(
        artifact.deployedBytecode.immutableReferences,
      ).flat();
      const occupied = new Set();
      for (const { start, length } of references) {
        for (let index = start; index < start + length; index += 1) {
          occupied.add(index);
        }
      }
      const start = Array.from(
        { length: REVIEWED_COVENANT_ARTIFACT.runtimeByteLength - 31 },
        (_, index) => index,
      ).find((candidate) =>
        Array.from({ length: 32 }, (_, index) => candidate + index).every(
          (index) => !occupied.has(index),
        ),
      );
      assert.notEqual(start, undefined);
      const identifier = Object.keys(
        artifact.deployedBytecode.immutableReferences,
      )[0];
      artifact.deployedBytecode.immutableReferences[identifier].push({
        start,
        length: 32,
      });
    },
  ];
  for (const mutate of mutations) {
    const artifact = rawArtifact();
    mutate(artifact);
    assert.throws(() =>
      validateCovenantVaultArtifact(artifact, committedAbi(), rawBuildInfo()),
    );
  }
  const wrongAbi = committedAbi();
  wrongAbi.pop();
  assert.throws(() =>
    validateCovenantVaultArtifact(rawArtifact(), wrongAbi, rawBuildInfo()),
  );
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
