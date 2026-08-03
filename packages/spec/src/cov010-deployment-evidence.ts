import { keccak256, stringToHex, type Hex } from "viem";
import {
  arcDeploymentManifestSchema,
  type ArcDeploymentManifest,
} from "./deployment-manifest.js";

type JsonValue =
  | boolean
  | null
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export const COV010_PUBLIC_EVIDENCE_ANCHORS = Object.freeze({
  chainId: "5042002",
  contractAddress: "0x2405Da1115B47A9D60499E12aA216874dc44c75a",
  deploymentTransactionHash:
    "0x7b43a398b54f505131d6edc968a5c491bcdc8136f42e35cff73be1781fbf2ff4",
  deploymentBlockNumber: "54829529",
  deploymentBlockHash:
    "0x50e75512cad861a3bcb693992c22b182f32313cd53349bef3545d50d6b7483d6",
  actualRuntimeCodeHash:
    "0x8aa1e18527b2881d48aa6a682dd886665edb7cd0b7d54303e374b98d51c8f3bb",
  trustedNetworkProfileDigest:
    "0x1675dcd65bbe5bd3d7fd454b6d979c17703139ad5c538bd1483021253f4016d1",
  planDigest:
    "0x7927a803fd187edd5b87b2a2761cdb91aaad5d9900d06926a192b8941f86796e",
  sourceGitCommit: "6212111a12ed387e529911e6cb8164ae078d4168",
  token: "0x3600000000000000000000000000000000000000",
} as const);

export const COV010_CANONICAL_MANIFEST_DIGEST =
  "0xe9cad77d9357394692f3ce01dc489376de189bb80f7f11206daefa01369cbd4e" as Hex;

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    const items = value as readonly JsonValue[];

    return items.map((item) => canonicalize(item));
  }

  if (value !== null && typeof value === "object") {
    const record = value as Readonly<Record<string, JsonValue>>;

    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key] as JsonValue)]),
    );
  }

  return value;
}

export function cov010CanonicalManifestDigest(
  manifest: ArcDeploymentManifest,
): Hex {
  return keccak256(
    stringToHex(JSON.stringify(canonicalize(manifest as unknown as JsonValue))),
  );
}

export function verifyCov010DeploymentEvidence(
  input: unknown,
): ArcDeploymentManifest {
  const parsed = arcDeploymentManifestSchema.parse(input);

  const anchors = COV010_PUBLIC_EVIDENCE_ANCHORS;

  if (
    parsed.chainId !== anchors.chainId ||
    parsed.contractAddress !== anchors.contractAddress ||
    parsed.deploymentTransactionHash !== anchors.deploymentTransactionHash ||
    parsed.deploymentBlockNumber !== anchors.deploymentBlockNumber ||
    parsed.deploymentBlockHash !== anchors.deploymentBlockHash ||
    parsed.actualRuntimeCodeHash !== anchors.actualRuntimeCodeHash ||
    parsed.trustedNetworkProfileDigest !==
      anchors.trustedNetworkProfileDigest ||
    parsed.planDigest !== anchors.planDigest ||
    parsed.sourceGitCommit !== anchors.sourceGitCommit ||
    parsed.constructor.token !== anchors.token ||
    parsed.immutableValues.token !== anchors.token
  ) {
    throw new Error("COV-010 deployment evidence anchor mismatch");
  }

  if (
    cov010CanonicalManifestDigest(parsed) !== COV010_CANONICAL_MANIFEST_DIGEST
  ) {
    throw new Error("COV-010 deployment evidence digest mismatch");
  }

  return parsed;
}
