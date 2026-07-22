import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_COV002_FILES = Object.freeze([
  "packages/contracts/src/CovenantVault.sol",
  "packages/contracts/src/CovenantTypes.sol",
  "packages/contracts/src/CovenantHashing.sol",
  "packages/contracts/foundry.toml",
  "packages/contracts/dependencies.lock.json",
  "packages/contracts/script/DeployCovenantVaultLocal.s.sol",
  "packages/contracts/README.md",
  "packages/contracts/test/CovenantHashParity.t.sol",
  "packages/contracts/test/CovenantVault.t.sol",
  "packages/contracts/test/CovenantVaultConstructor.t.sol",
  "packages/contracts/test/CovenantVaultSignature.t.sol",
  "packages/contracts/test/CovenantVaultTestBase.t.sol",
  "packages/contracts/test/CovenantVaultTokenBehavior.t.sol",
  "packages/contracts/test/CovenantVaultFuzz.t.sol",
  "packages/contracts/test/CovenantVault.invariant.t.sol",
  "packages/contracts/test/mocks/HostileTokens.sol",
  "packages/contracts/test/mocks/MockUSDC.sol",
  "scripts/contract-dependencies.mjs",
  "scripts/install-contract-dependencies.mjs",
  "scripts/verify-contract-dependencies.mjs",
  "scripts/verify-contract-dependencies.test.mjs",
  "scripts/verify-cov002-files.mjs",
  "scripts/verify-cov002-files.test.mjs",
  "scripts/test-contracts.mjs",
  "packages/spec/src/typed-data.ts",
  "packages/spec/src/fixtures.ts",
  "packages/spec/src/primitives.ts",
  "packages/spec/src/schemas.ts",
  "packages/spec/test/schemas.test.ts",
  "packages/spec/test/signatures.test.ts",
  "packages/spec/test/typed-data.test.ts",
  "docs/DECISIONS/0004-typed-data-signing.md",
  "docs/SECURITY_BOUNDARIES.md",
  "docs/THREAT_MODEL.md",
  "package.json",
  ".github/workflows/ci.yml",
]);

export function missingCov002Files(root) {
  return REQUIRED_COV002_FILES.filter(
    (file) => !existsSync(resolve(root, file)),
  );
}

function main() {
  const rootIndex = process.argv.indexOf("--root");
  const root = resolve(rootIndex === -1 ? "." : process.argv[rootIndex + 1]);
  const missing = missingCov002Files(root);
  if (missing.length !== 0) {
    for (const file of missing)
      console.error(`[FAILED] Missing required COV-002 file: ${file}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `All ${REQUIRED_COV002_FILES.length} required COV-002 files are present.`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
