import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { keccak256, stringToHex } from "viem";
import {
  CANONICAL_FOUNDRY_REMAPPINGS,
  isAbsoluteCompilerPath,
  validateCanonicalRemappings,
  validateCovenantBuildEnvironment,
} from "./build-environment.mjs";
import {
  deriveSemanticImmutableMap,
  semanticImmutableMapDigest,
  validateImmutableReferenceMap,
  validateSemanticImmutableMap,
  validateSemanticImmutableValues,
} from "./semantic-immutables.mjs";

export { validateImmutableReferenceMap } from "./semantic-immutables.mjs";

export const REVIEWED_COVENANT_ARTIFACT = Object.freeze({
  contractName: "CovenantVault",
  solidityVersion: "0.8.28",
  compilerVersion: "0.8.28+commit.7893614a",
  forgeVersion: "1.7.1",
  evmTarget: "prague",
  optimizerEnabled: true,
  optimizerRuns: 200,
  viaIr: true,
  metadataBytecodeHash: "ipfs",
  creationBytecodeHash:
    "0xf8397467ac97f7b7bafbd2475bcb3dcfa954177caa670b6bb471e50eb5d9abf6",
  unpatchedRuntimeBytecodeHash:
    "0xc15a104d5ad3440ab65678c50fc37b8e0c4d8fc449da9ce30fb9eb68ce6aebf2",
  canonicalAbiHash:
    "0x6606d1c53a3d8f0fad559849d4108913813cbe6683e1f5f390205066a16dcdc0",
  semanticImmutableMapDigest:
    "0x86bc8b62dbcfa9711069de846d779b2fc2095803f2909ec9944411f8abc68a82",
  canonicalMetadataDigest:
    "0x338e52d378c8823cc0ca3825e7ed3b7d4efb1059edb6d8bc4264a7c818197863",
  creationByteLength: 11_990,
  runtimeByteLength: 8_930,
});

const root = resolve(import.meta.dirname, "../..");
const artifactPath = resolve(
  root,
  "packages/contracts/out/CovenantVault.sol/CovenantVault.json",
);
const committedAbiPath = resolve(
  root,
  "packages/contracts/abi/CovenantVault.json",
);
const buildInfoDirectory = resolve(root, "packages/contracts/out/build-info");

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalArtifactJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function canonicalArtifactDigest(value) {
  return keccak256(stringToHex(canonicalArtifactJson(value)));
}

function normalizedHex(value, allowEmpty = false) {
  if (
    typeof value !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value) ||
    (!allowEmpty && value.length <= 2)
  ) {
    throw new Error("Invalid artifact bytecode");
  }
  return value.toLowerCase();
}

function isEmptyLinkReferences(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.keys(value).length === 0
  );
}

function validateMetadata(artifact) {
  const metadata = artifact?.metadata;
  const settings = metadata?.settings;
  const targets = Object.values(settings?.compilationTarget ?? {});
  const sourceUnits = Object.keys(metadata?.sources ?? {});
  validateCanonicalRemappings(settings?.remappings);
  if (
    metadata?.compiler?.version !==
      REVIEWED_COVENANT_ARTIFACT.compilerVersion ||
    targets.length !== 1 ||
    targets[0] !== REVIEWED_COVENANT_ARTIFACT.contractName ||
    settings?.evmVersion !== REVIEWED_COVENANT_ARTIFACT.evmTarget ||
    settings?.optimizer?.enabled !==
      REVIEWED_COVENANT_ARTIFACT.optimizerEnabled ||
    settings?.optimizer?.runs !== REVIEWED_COVENANT_ARTIFACT.optimizerRuns ||
    settings?.viaIR !== REVIEWED_COVENANT_ARTIFACT.viaIr ||
    settings?.metadata?.bytecodeHash !==
      REVIEWED_COVENANT_ARTIFACT.metadataBytecodeHash ||
    settings?.remappings.length !== CANONICAL_FOUNDRY_REMAPPINGS.length ||
    canonicalArtifactDigest(metadata) !==
      REVIEWED_COVENANT_ARTIFACT.canonicalMetadataDigest ||
    sourceUnits.length === 0 ||
    sourceUnits.some((sourceUnit) => isAbsoluteCompilerPath(sourceUnit)) ||
    !isEmptyLinkReferences(artifact?.bytecode?.linkReferences) ||
    !isEmptyLinkReferences(artifact?.deployedBytecode?.linkReferences)
  ) {
    throw new Error("Unexpected CovenantVault artifact metadata");
  }
}

export function validateCovenantVaultArtifact(
  artifact,
  committedAbi,
  buildInfo,
) {
  validateMetadata(artifact);
  if (!Array.isArray(artifact.abi) || artifact.abi.length === 0) {
    throw new Error("Invalid CovenantVault ABI");
  }
  const creationBytecode = normalizedHex(artifact.bytecode?.object);
  const unpatchedRuntimeBytecode = normalizedHex(
    artifact.deployedBytecode?.object,
  );
  const creationByteLength = (creationBytecode.length - 2) / 2;
  const runtimeByteLength = (unpatchedRuntimeBytecode.length - 2) / 2;
  const immutableReferences = artifact.deployedBytecode?.immutableReferences;
  validateImmutableReferenceMap(immutableReferences, runtimeByteLength);
  const semanticImmutableMap = deriveSemanticImmutableMap(
    immutableReferences,
    buildInfo,
    runtimeByteLength,
  );
  const commitments = {
    creationBytecodeHash: keccak256(creationBytecode),
    unpatchedRuntimeBytecodeHash: keccak256(unpatchedRuntimeBytecode),
    canonicalAbiHash: canonicalArtifactDigest(artifact.abi),
    semanticImmutableMapDigest:
      semanticImmutableMapDigest(semanticImmutableMap),
  };
  if (
    creationByteLength !== REVIEWED_COVENANT_ARTIFACT.creationByteLength ||
    runtimeByteLength !== REVIEWED_COVENANT_ARTIFACT.runtimeByteLength ||
    commitments.creationBytecodeHash !==
      REVIEWED_COVENANT_ARTIFACT.creationBytecodeHash ||
    commitments.unpatchedRuntimeBytecodeHash !==
      REVIEWED_COVENANT_ARTIFACT.unpatchedRuntimeBytecodeHash ||
    commitments.canonicalAbiHash !==
      REVIEWED_COVENANT_ARTIFACT.canonicalAbiHash ||
    commitments.semanticImmutableMapDigest !==
      REVIEWED_COVENANT_ARTIFACT.semanticImmutableMapDigest ||
    canonicalArtifactJson(committedAbi) !== canonicalArtifactJson(artifact.abi)
  ) {
    throw new Error("CovenantVault artifact differs from reviewed commitments");
  }
  return Object.freeze({
    abi: Object.freeze(artifact.abi),
    creationBytecode,
    unpatchedRuntimeBytecode,
    rawImmutableReferences: Object.freeze(immutableReferences),
    semanticImmutableMap,
    ...commitments,
  });
}

export function loadReviewedCovenantVaultArtifact(options = {}) {
  let artifact;
  let committedAbi;
  let buildInfo;
  try {
    (options.validateBuildEnvironment ?? validateCovenantBuildEnvironment)();
    artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    committedAbi = JSON.parse(readFileSync(committedAbiPath, "utf8"));
    const buildInfoFiles = readdirSync(buildInfoDirectory).filter((file) =>
      file.endsWith(".json"),
    );
    if (buildInfoFiles.length !== 1) {
      throw new Error("Expected one fresh compiler build-info document");
    }
    buildInfo = JSON.parse(
      readFileSync(resolve(buildInfoDirectory, buildInfoFiles[0]), "utf8"),
    );
  } catch {
    throw new Error("Reviewed CovenantVault artifact is unavailable");
  }
  return validateCovenantVaultArtifact(artifact, committedAbi, buildInfo);
}

export function patchExpectedImmutableRuntime(
  unpatchedRuntimeBytecode,
  semanticImmutableMap,
  values,
) {
  const runtime = normalizedHex(unpatchedRuntimeBytecode);
  const runtimeLength = (runtime.length - 2) / 2;
  validateSemanticImmutableMap(semanticImmutableMap, runtimeLength);
  const normalizedValues = validateSemanticImmutableValues(
    semanticImmutableMap,
    values,
  );
  const bytes = runtime.slice(2).match(/.{2}/gu);
  if (bytes === null) throw new Error("Invalid runtime bytecode");
  const seen = new Uint8Array(runtimeLength);
  for (const { label, ranges } of semanticImmutableMap) {
    const value = normalizedValues[label];
    for (const range of ranges) {
      const start = Number(range.start);
      const length = Number(range.length);
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(length) ||
        start < 0 ||
        length <= 0 ||
        start + length > runtimeLength
      ) {
        throw new Error("Semantic immutable range is invalid");
      }
      if ((value.length - 2) / 2 !== length) {
        throw new Error("Immutable encoding length mismatch");
      }
      for (let index = start; index < start + length; index += 1) {
        if (seen[index] !== 0) {
          throw new Error("Semantic immutable ranges overlap");
        }
        seen[index] = 1;
      }
      const encoded = value.slice(2).match(/.{2}/gu);
      if (encoded === null) throw new Error("Invalid immutable encoding");
      bytes.splice(start, length, ...encoded);
    }
  }
  return `0x${bytes.join("")}`;
}

export function verifyImmutableAwareRuntime(input) {
  const actual = normalizedHex(input.actualRuntimeBytecode);
  const unpatched = normalizedHex(input.unpatchedRuntimeBytecode);
  if (actual.length !== unpatched.length) {
    throw new Error("Unexpected runtime code length");
  }
  const runtimeLength = (unpatched.length - 2) / 2;
  const ranges = validateSemanticImmutableMap(
    input.semanticImmutableMap,
    runtimeLength,
  );
  const expected =
    input.expectedImmutableValues === undefined
      ? undefined
      : patchExpectedImmutableRuntime(
          unpatched,
          input.semanticImmutableMap,
          input.expectedImmutableValues,
        );
  const ignored = new Uint8Array(runtimeLength);
  for (const { start, length } of ranges) {
    ignored.fill(1, start, start + length);
  }
  for (let index = 0; index < runtimeLength; index += 1) {
    const actualByte = actual.slice(2 + index * 2, 4 + index * 2);
    const unpatchedByte = unpatched.slice(2 + index * 2, 4 + index * 2);
    if (ignored[index] === 0 && actualByte !== unpatchedByte) {
      throw new Error("Non-immutable runtime byte mismatch");
    }
    if (
      ignored[index] === 1 &&
      expected !== undefined &&
      actualByte !== expected.slice(2 + index * 2, 4 + index * 2)
    ) {
      throw new Error("Immutable runtime byte mismatch");
    }
  }
  return Object.freeze({
    runtimeByteLength: runtimeLength,
    actualRuntimeCodeHash: keccak256(actual),
  });
}

export function validateProfileDigest(actual, expected) {
  if (
    normalizedHex(actual) !== normalizedHex(expected) ||
    actual.length !== 66 ||
    expected.length !== 66
  ) {
    throw new Error("Trusted network profile digest mismatch");
  }
}
