import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sanitizedFailure = Object.freeze({
  name: "ContractEvidenceError",
  code: "HARNESS_EXECUTION_FAILED",
  message: "Local contract evidence could not be verified",
});
const missingToolFailure = Object.freeze({
  name: "ContractEvidenceError",
  code: "MISSING_TOOL",
  message: "Required local contract tool is unavailable",
});

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
    windowsHide: true,
    ...options,
  });
}

function fail(error = sanitizedFailure) {
  process.stdout.write(`${JSON.stringify(error)}\n`);
  process.exitCode = 1;
}

function toolIsMissing(result) {
  return result.error?.code === "ENOENT";
}

const dependencyCheck = run(process.execPath, [
  "scripts/verify-contract-dependencies.mjs",
]);
if (dependencyCheck.status !== 0) {
  fail();
} else {
  const build = run("forge", ["build", "--root", "packages/contracts"]);
  if (build.status !== 0) {
    fail(toolIsMissing(build) ? missingToolFailure : sanitizedFailure);
  } else {
    const test = run(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "--config",
        "tests/contract-evidence/vitest.config.ts",
      ],
      {
        env: { ...process.env, COVENANT_EVIDENCE_COMMAND: "1" },
      },
    );
    if (test.status !== 0) {
      const errorMarker = "COVENANT_LOCAL_EVIDENCE_ERROR=";
      const errorLines = test.stdout
        .split(/\r?\n/u)
        .filter((line) => line.startsWith(errorMarker))
        .map((line) => line.slice(errorMarker.length));
      if (errorLines.length === 1) {
        try {
          fail(JSON.parse(errorLines[0]));
        } catch {
          fail();
        }
      } else {
        fail();
      }
    } else {
      const marker = "COVENANT_LOCAL_EVIDENCE_RESULT=";
      const lines = test.stdout.split(/\r?\n/u);
      const results = lines
        .filter((line) => line.startsWith(marker))
        .map((line) => line.slice(marker.length));
      if (results.length !== 1) {
        fail();
      } else {
        try {
          const parsed = JSON.parse(results[0]);
          process.stdout.write(`${JSON.stringify(parsed)}\n`);
        } catch {
          fail();
        }
      }
    }
  }
}
