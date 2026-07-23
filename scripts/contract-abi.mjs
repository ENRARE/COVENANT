import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const covenantVaultAbiPath = fileURLToPath(
  new URL("../packages/contracts/abi/CovenantVault.json", import.meta.url),
);

function generatedAbi() {
  const result = spawnSync(
    "forge",
    [
      "inspect",
      "CovenantVault",
      "abi",
      "--root",
      "packages/contracts",
      "--json",
    ],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error("Unable to generate CovenantVault ABI with Foundry.");
  }
  return `${JSON.stringify(JSON.parse(result.stdout), null, 2)}\n`;
}

export function generateCovenantVaultAbi() {
  writeFileSync(covenantVaultAbiPath, generatedAbi(), "utf8");
}

export function verifyCovenantVaultAbi() {
  let committed;
  try {
    committed = readFileSync(covenantVaultAbiPath, "utf8");
  } catch {
    throw new Error("Committed CovenantVault ABI is missing.");
  }
  if (committed !== generatedAbi()) {
    throw new Error(
      "Committed CovenantVault ABI differs from current Foundry output. Run pnpm.cmd generate:contract-abi.",
    );
  }
}
