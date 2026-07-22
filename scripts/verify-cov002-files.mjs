import { existsSync } from "node:fs";
import { resolve } from "node:path";

const rootIndex = process.argv.indexOf("--root");
const root = resolve(rootIndex === -1 ? "." : process.argv[rootIndex + 1]);
const requiredFiles = [
  "packages/contracts/src/CovenantVault.sol",
  "packages/contracts/src/CovenantTypes.sol",
  "packages/contracts/src/CovenantHashing.sol",
  "packages/contracts/test/CovenantVault.t.sol",
  "packages/contracts/test/CovenantHashParity.t.sol",
  "packages/contracts/test/CovenantVault.invariant.t.sol",
];

const missing = requiredFiles.filter(
  (file) => !existsSync(resolve(root, file)),
);
if (missing.length !== 0) {
  for (const file of missing)
    console.error(`[FAILED] Missing required COV-002 file: ${file}`);
  process.exit(1);
}
console.log("Required COV-002 contract and core test files are present.");
