import { spawnSync } from "node:child_process";

const probe = spawnSync("forge", ["--version"], {
  shell: process.platform === "win32",
  stdio: "ignore",
});
if (probe.status !== 0) {
  console.error(
    "[FAILED] Foundry is required for test:contracts. Install Forge or run verify:without-contracts explicitly.",
  );
  process.exit(1);
}

const result = spawnSync("forge", ["test", "--root", "packages/contracts"], {
  shell: process.platform === "win32",
  stdio: "inherit",
});
process.exit(result.status ?? 1);
