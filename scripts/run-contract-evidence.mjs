import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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

function toolIsMissing(result) {
  return result.error?.code === "ENOENT";
}

const productionBuildArguments = Object.freeze([
  "--silent",
  "--filter",
  "@covenant/spec",
  "--filter",
  "@covenant/agent...",
  "--filter",
  "@covenant/authority...",
  "--filter",
  "@covenant/executor...",
  "build",
]);

function markerValues(output, marker) {
  return output
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(marker))
    .map((line) => line.slice(marker.length));
}

export function runContractEvidence(options = {}) {
  const runCommand = options.runCommand ?? run;
  const write = options.write ?? ((value) => process.stdout.write(value));
  const packageManagerEntry =
    options.packageManagerEntry ?? process.env.npm_execpath;
  const fail = (error = sanitizedFailure) => {
    write(`${JSON.stringify(error)}\n`);
    return 1;
  };

  const dependencyCheck = runCommand(process.execPath, [
    "scripts/verify-contract-dependencies.mjs",
  ]);
  if (dependencyCheck.status !== 0) return fail();

  if (
    typeof packageManagerEntry !== "string" ||
    !/[\\/]node_modules[\\/]pnpm[\\/]bin[\\/]pnpm\.[cm]js$/u.test(
      packageManagerEntry,
    )
  ) {
    return fail(missingToolFailure);
  }
  const workspaceBuild = runCommand(process.execPath, [
    packageManagerEntry,
    ...productionBuildArguments,
  ]);
  if (workspaceBuild.status !== 0) {
    return fail(
      toolIsMissing(workspaceBuild) ? missingToolFailure : sanitizedFailure,
    );
  }

  const contractBuild = runCommand("forge", [
    "build",
    "--root",
    "packages/contracts",
  ]);
  if (contractBuild.status !== 0) {
    return fail(
      toolIsMissing(contractBuild) ? missingToolFailure : sanitizedFailure,
    );
  }

  const test = runCommand(
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
    const errors = markerValues(test.stdout, "COVENANT_LOCAL_EVIDENCE_ERROR=");
    if (errors.length === 1) {
      try {
        return fail(JSON.parse(errors[0]));
      } catch {
        return fail();
      }
    }
    return fail();
  }

  const results = markerValues(test.stdout, "COVENANT_LOCAL_EVIDENCE_RESULT=");
  if (results.length !== 1) return fail();
  try {
    const parsed = JSON.parse(results[0]);
    write(`${JSON.stringify(parsed)}\n`);
    return 0;
  } catch {
    return fail();
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = runContractEvidence();
}
