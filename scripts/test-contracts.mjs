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

for (const script of [
  "scripts/verify-cov002-files.mjs",
  "scripts/verify-contract-dependencies.mjs",
  "scripts/arc/validate-build-environment.mjs",
]) {
  const verification = spawnSync(process.execPath, [script], {
    stdio: "inherit",
  });
  if (verification.status !== 0) process.exit(verification.status ?? 1);
}

const clean = spawnSync("forge", ["clean", "--root", "packages/contracts"], {
  shell: process.platform === "win32",
  stdio: "inherit",
});
if (clean.status !== 0) process.exit(clean.status ?? 1);

const result = spawnSync(
  "forge",
  ["test", "--build-info", "--root", "packages/contracts"],
  {
    shell: process.platform === "win32",
    stdio: "inherit",
  },
);
if (result.status !== 0) process.exit(result.status ?? 1);

const arcAttestation = spawnSync(
  process.execPath,
  [
    "--test",
    "scripts/arc/build-environment.test.mjs",
    "scripts/arc/semantic-immutables.test.mjs",
    "scripts/arc/artifact-attestation.test.mjs",
  ],
  {
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  },
);
process.exit(arcAttestation.status ?? 1);
