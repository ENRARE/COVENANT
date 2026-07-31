import { spawnSync } from "node:child_process";
import { realpathSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const rootPackagePath = resolve(root, "package.json");
const rootRequire = createRequire(rootPackagePath);
const expectedPnpmVersion = "11.7.0";
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

const forbiddenEnvironmentKeys = new Set([
  "ALL_PROXY",
  "ARC_RPC_URL",
  "CIRCLE_API_KEY",
  "ETH_RPC_URL",
  "FOUNDRY_ETH_RPC_URL",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NO_PROXY",
  "NPM_EXECPATH",
  "RPC_URL",
]);

function isWithin(parent, candidate) {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith("..") && !isAbsolute(pathFromParent))
  );
}

function childEnvironment(additions = {}) {
  const environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!forbiddenEnvironmentKeys.has(key.toUpperCase())) {
      environment[key] = value;
    }
  }
  return { ...environment, ...additions };
}

function commandOptions(environment = childEnvironment()) {
  return {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: environment,
  };
}

export function resolveRepositoryPnpmCli() {
  const rootManifest = JSON.parse(readFileSync(rootPackagePath, "utf8"));
  if (
    rootManifest.packageManager !== `pnpm@${expectedPnpmVersion}` ||
    rootManifest.devDependencies?.pnpm !== expectedPnpmVersion
  ) {
    throw new Error("Invalid repository package-manager pin");
  }

  const nodeModulesRoot = realpathSync(resolve(root, "node_modules"));
  const pnpmManifestPath = realpathSync(rootRequire.resolve("pnpm"));
  const pnpmPackageRoot = dirname(pnpmManifestPath);
  if (
    !isWithin(nodeModulesRoot, pnpmPackageRoot) ||
    resolve(pnpmPackageRoot, "package.json") !== pnpmManifestPath
  ) {
    throw new Error("Invalid repository package-manager location");
  }

  const pnpmManifest = JSON.parse(readFileSync(pnpmManifestPath, "utf8"));
  if (
    pnpmManifest.name !== "pnpm" ||
    pnpmManifest.version !== expectedPnpmVersion ||
    !/^bin[\\/]pnpm\.[cm]js$/u.test(pnpmManifest.main)
  ) {
    throw new Error("Invalid repository package-manager metadata");
  }

  const pnpmCli = realpathSync(resolve(pnpmPackageRoot, pnpmManifest.main));
  if (!isWithin(pnpmPackageRoot, pnpmCli)) {
    throw new Error("Invalid repository package-manager entrypoint");
  }
  return pnpmCli;
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
  if (typeof output !== "string") return [];
  return output
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(marker))
    .map((line) => line.slice(marker.length));
}

export function runContractEvidence(options = {}) {
  const runCommand = options.runCommand ?? spawnSync;
  const write = options.write ?? ((value) => process.stdout.write(value));
  const commandArguments = options.commandArguments ?? [];
  const fail = (error = sanitizedFailure) => {
    write(`${JSON.stringify(error)}\n`);
    return 1;
  };

  if (!Array.isArray(commandArguments) || commandArguments.length !== 0) {
    return fail();
  }

  let packageManagerEntry;
  try {
    packageManagerEntry = resolveRepositoryPnpmCli();

    const dependencyCheck = runCommand(
      process.execPath,
      ["scripts/verify-contract-dependencies.mjs"],
      commandOptions(),
    );
    if (dependencyCheck.status !== 0) return fail();

    const workspaceBuild = runCommand(
      process.execPath,
      [packageManagerEntry, ...productionBuildArguments],
      commandOptions(),
    );
    if (workspaceBuild.status !== 0) {
      return fail(
        toolIsMissing(workspaceBuild) ? missingToolFailure : sanitizedFailure,
      );
    }

    const contractBuild = runCommand(
      "forge",
      ["build", "--force", "--build-info", "--root", "packages/contracts"],
      commandOptions(),
    );
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
      commandOptions(childEnvironment({ COVENANT_EVIDENCE_COMMAND: "1" })),
    );
    if (test.status !== 0) {
      const errors = markerValues(
        test.stdout,
        "COVENANT_LOCAL_EVIDENCE_ERROR=",
      );
      if (errors.length === 1) {
        try {
          return fail(JSON.parse(errors[0]));
        } catch {
          return fail();
        }
      }
      return fail();
    }

    const results = markerValues(
      test.stdout,
      "COVENANT_LOCAL_EVIDENCE_RESULT=",
    );
    if (results.length !== 1) return fail();
    const parsed = JSON.parse(results[0]);
    write(`${JSON.stringify(parsed)}\n`);
    return 0;
  } catch {
    return fail(
      packageManagerEntry === undefined ? missingToolFailure : undefined,
    );
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = runContractEvidence({
    commandArguments: process.argv.slice(2),
  });
}
