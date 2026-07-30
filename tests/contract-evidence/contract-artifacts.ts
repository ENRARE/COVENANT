import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAddress, type Abi, type Address, type Hex } from "viem";
import { evidenceFailure } from "./errors.js";

type ImmutableReference = Readonly<{ start: number; length: number }>;

type FoundryArtifact = Readonly<{
  abi: Abi;
  bytecode: Readonly<{ object: Hex }>;
  deployedBytecode: Readonly<{
    object: Hex;
    immutableReferences?: Readonly<
      Record<string, readonly ImmutableReference[]>
    >;
  }>;
  metadata: Readonly<{
    compiler: Readonly<{ version: string }>;
    settings: Readonly<{
      compilationTarget: Readonly<Record<string, string>>;
    }>;
  }>;
}>;

export type ValidatedArtifact = Readonly<{
  contractName: "MockUSDC" | "CovenantVault";
  abi: Abi;
  bytecode: Hex;
  deployedBytecode: Hex;
  immutableReferences: readonly ImmutableReference[];
}>;

const root = resolve(import.meta.dirname, "../..");

function parseArtifact(
  relativePath: string,
  contractName: ValidatedArtifact["contractName"],
): ValidatedArtifact {
  let artifact: FoundryArtifact;
  try {
    artifact = JSON.parse(
      readFileSync(resolve(root, relativePath), "utf8"),
    ) as FoundryArtifact;
  } catch {
    evidenceFailure("DEPLOYMENT_FAILURE");
  }
  const targets = Object.values(artifact.metadata.settings.compilationTarget);
  if (
    targets.length !== 1 ||
    targets[0] !== contractName ||
    !artifact.metadata.compiler.version.startsWith("0.8.28+") ||
    !Array.isArray(artifact.abi) ||
    artifact.abi.length === 0 ||
    !artifact.bytecode.object.startsWith("0x") ||
    artifact.bytecode.object.length <= 2 ||
    !artifact.deployedBytecode.object.startsWith("0x") ||
    artifact.deployedBytecode.object.length <= 2
  ) {
    evidenceFailure("DEPLOYMENT_FAILURE");
  }
  const immutableReferences = Object.values(
    artifact.deployedBytecode.immutableReferences ?? {},
  ).flat();
  return Object.freeze({
    contractName,
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    deployedBytecode: artifact.deployedBytecode.object,
    immutableReferences,
  });
}

export function loadContractArtifacts(): Readonly<{
  mockUsdc: ValidatedArtifact;
  covenantVault: ValidatedArtifact;
}> {
  const mockUsdc = parseArtifact(
    "packages/contracts/out/MockUSDC.sol/MockUSDC.json",
    "MockUSDC",
  );
  const covenantVault = parseArtifact(
    "packages/contracts/out/CovenantVault.sol/CovenantVault.json",
    "CovenantVault",
  );
  let committedVaultAbi: Abi;
  try {
    committedVaultAbi = JSON.parse(
      readFileSync(
        resolve(root, "packages/contracts/abi/CovenantVault.json"),
        "utf8",
      ),
    ) as Abi;
  } catch {
    evidenceFailure("DEPLOYMENT_FAILURE");
  }
  if (JSON.stringify(committedVaultAbi) !== JSON.stringify(covenantVault.abi)) {
    evidenceFailure("CODE_MISMATCH");
  }
  return Object.freeze({ mockUsdc, covenantVault });
}

function normalizedCode(code: Hex): string {
  return code.slice(2).toLowerCase();
}

export function verifyExactRuntimeCode(
  actual: Hex,
  artifact: ValidatedArtifact,
): void {
  if (normalizedCode(actual) !== normalizedCode(artifact.deployedBytecode)) {
    evidenceFailure("CODE_MISMATCH");
  }
}

export function verifyImmutableAwareRuntimeCode(
  actual: Hex,
  artifact: ValidatedArtifact,
): void {
  const actualBytes = normalizedCode(actual);
  const expectedBytes = normalizedCode(artifact.deployedBytecode);
  if (actualBytes.length !== expectedBytes.length) {
    evidenceFailure("CODE_MISMATCH");
  }
  const ignored = new Uint8Array(actualBytes.length / 2);
  for (const reference of artifact.immutableReferences) {
    if (
      !Number.isSafeInteger(reference.start) ||
      !Number.isSafeInteger(reference.length) ||
      reference.start < 0 ||
      reference.length <= 0 ||
      reference.start + reference.length > ignored.length
    ) {
      evidenceFailure("CODE_MISMATCH");
    }
    ignored.fill(1, reference.start, reference.start + reference.length);
  }
  for (let index = 0; index < ignored.length; index += 1) {
    if (
      ignored[index] === 0 &&
      actualBytes.slice(index * 2, index * 2 + 2) !==
        expectedBytes.slice(index * 2, index * 2 + 2)
    ) {
      evidenceFailure("CODE_MISMATCH");
    }
  }
}

export function requireAddress(value: unknown): Address {
  try {
    if (typeof value !== "string") evidenceFailure("IMMUTABLE_MISMATCH");
    return getAddress(value);
  } catch {
    evidenceFailure("IMMUTABLE_MISMATCH");
  }
}
