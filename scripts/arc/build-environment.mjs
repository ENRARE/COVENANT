import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, resolve, win32 } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const contractsRoot = resolve(root, "packages/contracts");

export const CANONICAL_FOUNDRY_REMAPPINGS = Object.freeze([
  "@openzeppelin/=../../lib/openzeppelin-contracts/",
  "forge-std/=../../lib/forge-std/src/",
]);

const REJECTED_ENVIRONMENT_KEYS = new Set([
  "DAPP_ALLOW_PATHS",
  "DAPP_BUILD_OPTIMIZE",
  "DAPP_BUILD_OPTIMIZE_RUNS",
  "DAPP_LIBRARIES",
  "DAPP_REMAPPINGS",
  "DAPP_SOLC_VERSION",
  "FOUNDRY_ALLOW_PATHS",
  "FOUNDRY_AUTO_DETECT_REMAPPINGS",
  "FOUNDRY_BYTECODE_HASH",
  "FOUNDRY_CONFIG",
  "FOUNDRY_EVM_VERSION",
  "FOUNDRY_INCLUDE_PATHS",
  "FOUNDRY_LIBRARIES",
  "FOUNDRY_LIBS",
  "FOUNDRY_OPTIMIZER",
  "FOUNDRY_OPTIMIZER_RUNS",
  "FOUNDRY_PROFILE",
  "FOUNDRY_REMAPPINGS",
  "FOUNDRY_SOLC",
  "FOUNDRY_SOLC_VERSION",
  "FOUNDRY_VIA_IR",
  "SOLC_VERSION",
]);

function exactArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

export function isAbsoluteCompilerPath(value) {
  return (
    typeof value !== "string" ||
    isAbsolute(value) ||
    win32.isAbsolute(value) ||
    value.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/u.test(value)
  );
}

export function validateCanonicalRemappings(remappings) {
  if (!exactArray(remappings, CANONICAL_FOUNDRY_REMAPPINGS)) {
    throw new Error("Unexpected Foundry remappings");
  }
  for (const remapping of remappings) {
    const separator = remapping.indexOf("=");
    if (
      separator <= 0 ||
      separator === remapping.length - 1 ||
      isAbsoluteCompilerPath(remapping.slice(separator + 1))
    ) {
      throw new Error("Unsafe Foundry remapping");
    }
  }
}

export function validateFoundryEnvironment(environment = process.env) {
  for (const key of Object.keys(environment)) {
    if (REJECTED_ENVIRONMENT_KEYS.has(key.toUpperCase())) {
      throw new Error("Foundry build override is not allowed");
    }
  }
}

export function validateResolvedFoundryConfiguration(configuration) {
  if (
    configuration === null ||
    typeof configuration !== "object" ||
    Array.isArray(configuration)
  ) {
    throw new Error("Invalid resolved Foundry configuration");
  }
  validateCanonicalRemappings(configuration.remappings);
  if (
    configuration.auto_detect_remappings !== false ||
    configuration.solc !== "0.8.28" ||
    configuration.evm_version !== "prague" ||
    configuration.optimizer !== true ||
    configuration.optimizer_runs !== 200 ||
    configuration.via_ir !== true ||
    configuration.bytecode_hash !== "ipfs" ||
    configuration.cbor_metadata !== true ||
    !exactArray(configuration.libs, ["../../lib"]) ||
    !exactArray(configuration.allow_paths, []) ||
    !exactArray(configuration.include_paths, []) ||
    !exactArray(configuration.libraries, [])
  ) {
    throw new Error("Unexpected resolved Foundry configuration");
  }
}

function exactForgeCommand(arguments_, options = {}) {
  const runCommand = options.runCommand ?? spawnSync;
  const result = runCommand("forge", arguments_, {
    cwd: contractsRoot,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: options.environment ?? process.env,
  });
  if (
    result.status !== 0 ||
    typeof result.stdout !== "string" ||
    typeof result.stderr !== "string"
  ) {
    throw new Error("Foundry configuration could not be verified");
  }
  return result.stdout.trim();
}

export function validateCovenantBuildEnvironment(options = {}) {
  const environment = options.environment ?? process.env;
  validateFoundryEnvironment(environment);
  for (const candidate of [
    resolve(root, "remappings.txt"),
    resolve(contractsRoot, "remappings.txt"),
  ]) {
    if ((options.exists ?? existsSync)(candidate)) {
      throw new Error("Secondary remapping source is not allowed");
    }
  }
  const version = exactForgeCommand(["--version"], {
    ...options,
    environment,
  });
  if (!/^forge Version: 1\.7\.1(?:\r?\n|$)/u.test(version)) {
    throw new Error("Unexpected Forge version");
  }
  let configuration;
  try {
    configuration = JSON.parse(
      exactForgeCommand(["config", "--json"], {
        ...options,
        environment,
      }),
    );
  } catch {
    throw new Error("Foundry configuration could not be verified");
  }
  validateResolvedFoundryConfiguration(configuration);
  return Object.freeze(configuration);
}
