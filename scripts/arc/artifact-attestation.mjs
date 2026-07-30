import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { keccak256, stringToHex } from "viem";

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
    "0x8548849b1bee9c38df175f70cec89856283795b0d572b83b0ace0faefd8ba92a",
  unpatchedRuntimeBytecodeHash:
    "0x07e3e0502870e11043eccebc5ff7b47bb2816c8c954a00563179fb0f719991cc",
  canonicalAbiHash:
    "0x6606d1c53a3d8f0fad559849d4108913813cbe6683e1f5f390205066a16dcdc0",
  immutableReferenceMapDigest:
    "0x38ee98bdf1807194e8b73d2ee277a9dc428bb7ed04cc166e752ec3044026914b",
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

export function validateImmutableReferenceMap(referenceMap, runtimeLength) {
  if (
    referenceMap === null ||
    typeof referenceMap !== "object" ||
    Array.isArray(referenceMap) ||
    Object.keys(referenceMap).length === 0
  ) {
    throw new Error("Invalid immutable reference map");
  }
  const ranges = [];
  for (const [identifier, references] of Object.entries(referenceMap)) {
    if (!/^[1-9]\d*$/u.test(identifier) || !Array.isArray(references)) {
      throw new Error("Invalid immutable reference identifier");
    }
    if (references.length === 0) {
      throw new Error("Empty immutable reference collection");
    }
    for (const reference of references) {
      const { start, length } = reference ?? {};
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(length) ||
        start < 0 ||
        length <= 0 ||
        start + length > runtimeLength
      ) {
        throw new Error("Immutable reference is out of bounds");
      }
      ranges.push({ identifier, start, length });
    }
  }
  ranges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    const previous = ranges[index - 1];
    const current = ranges[index];
    if (current.start < previous.start + previous.length) {
      throw new Error("Immutable reference ranges overlap");
    }
  }
  return Object.freeze(ranges.map((range) => Object.freeze(range)));
}

function validateMetadata(artifact) {
  const metadata = artifact?.metadata;
  const settings = metadata?.settings;
  const targets = Object.values(settings?.compilationTarget ?? {});
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
    !isEmptyLinkReferences(artifact?.bytecode?.linkReferences) ||
    !isEmptyLinkReferences(artifact?.deployedBytecode?.linkReferences)
  ) {
    throw new Error("Unexpected CovenantVault artifact metadata");
  }
}

export function validateCovenantVaultArtifact(artifact, committedAbi) {
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
  const immutableRanges = validateImmutableReferenceMap(
    immutableReferences,
    runtimeByteLength,
  );
  const commitments = {
    creationBytecodeHash: keccak256(creationBytecode),
    unpatchedRuntimeBytecodeHash: keccak256(unpatchedRuntimeBytecode),
    canonicalAbiHash: canonicalArtifactDigest(artifact.abi),
    immutableReferenceMapDigest: canonicalArtifactDigest(immutableReferences),
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
    commitments.immutableReferenceMapDigest !==
      REVIEWED_COVENANT_ARTIFACT.immutableReferenceMapDigest ||
    canonicalArtifactJson(committedAbi) !== canonicalArtifactJson(artifact.abi)
  ) {
    throw new Error("CovenantVault artifact differs from reviewed commitments");
  }
  return Object.freeze({
    abi: Object.freeze(artifact.abi),
    creationBytecode,
    unpatchedRuntimeBytecode,
    immutableReferences: Object.freeze(immutableReferences),
    immutableRanges,
    ...commitments,
  });
}

export function loadReviewedCovenantVaultArtifact() {
  let artifact;
  let committedAbi;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    committedAbi = JSON.parse(readFileSync(committedAbiPath, "utf8"));
  } catch {
    throw new Error("Reviewed CovenantVault artifact is unavailable");
  }
  return validateCovenantVaultArtifact(artifact, committedAbi);
}

function immutableValueMap(values, references) {
  if (values === null || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("Invalid immutable values");
  }
  const expectedIdentifiers = Object.keys(references).sort();
  const actualIdentifiers = Object.keys(values).sort();
  if (
    expectedIdentifiers.length !== actualIdentifiers.length ||
    expectedIdentifiers.some(
      (identifier, index) => identifier !== actualIdentifiers[index],
    )
  ) {
    throw new Error("Immutable values do not cover the artifact map");
  }
  return Object.fromEntries(
    expectedIdentifiers.map((identifier) => [
      identifier,
      normalizedHex(values[identifier]),
    ]),
  );
}

export function patchExpectedImmutableRuntime(
  unpatchedRuntimeBytecode,
  immutableReferences,
  values,
) {
  const runtime = normalizedHex(unpatchedRuntimeBytecode);
  const runtimeLength = (runtime.length - 2) / 2;
  validateImmutableReferenceMap(immutableReferences, runtimeLength);
  const normalizedValues = immutableValueMap(values, immutableReferences);
  const bytes = runtime.slice(2).match(/.{2}/gu);
  if (bytes === null) throw new Error("Invalid runtime bytecode");
  for (const [identifier, references] of Object.entries(immutableReferences)) {
    const value = normalizedValues[identifier];
    for (const { start, length } of references) {
      if ((value.length - 2) / 2 !== length) {
        throw new Error("Immutable encoding length mismatch");
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
  const ranges = validateImmutableReferenceMap(
    input.immutableReferences,
    runtimeLength,
  );
  const expected =
    input.expectedImmutableValues === undefined
      ? undefined
      : patchExpectedImmutableRuntime(
          unpatched,
          input.immutableReferences,
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
