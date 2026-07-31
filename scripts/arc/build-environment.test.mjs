import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  CANONICAL_FOUNDRY_REMAPPINGS,
  isAbsoluteCompilerPath,
  validateCanonicalRemappings,
  validateCovenantBuildEnvironment,
  validateFoundryEnvironment,
  validateResolvedFoundryConfiguration,
} from "./build-environment.mjs";

function canonicalConfiguration() {
  return {
    remappings: [...CANONICAL_FOUNDRY_REMAPPINGS],
    auto_detect_remappings: false,
    solc: "0.8.28",
    evm_version: "prague",
    optimizer: true,
    optimizer_runs: 200,
    via_ir: true,
    bytecode_hash: "ipfs",
    cbor_metadata: true,
    libs: ["../../lib"],
    allow_paths: [],
    include_paths: [],
    libraries: [],
  };
}

test("Foundry freezes the exact canonical repository-relative remappings", () => {
  const source = readFileSync(
    resolve("packages/contracts/foundry.toml"),
    "utf8",
  );
  assert.match(source, /^auto_detect_remappings = false$/mu);
  assert.deepEqual(CANONICAL_FOUNDRY_REMAPPINGS, [
    "@openzeppelin/=../../lib/openzeppelin-contracts/",
    "forge-std/=../../lib/forge-std/src/",
  ]);
  assert.doesNotThrow(() =>
    validateCanonicalRemappings([...CANONICAL_FOUNDRY_REMAPPINGS]),
  );
});

test("absolute and checkout-specific remapping targets are rejected", () => {
  for (const target of [
    "C:/Users/example/repository/lib/",
    "D:\\temporary checkout\\lib\\",
    "\\\\server\\share\\lib\\",
    "/home/example/repository/lib/",
    "/tmp/covenant checkout/lib/",
  ]) {
    assert.equal(isAbsoluteCompilerPath(target), true);
    assert.throws(() =>
      validateCanonicalRemappings([
        `@openzeppelin/=${target}`,
        CANONICAL_FOUNDRY_REMAPPINGS[1],
      ]),
    );
  }
});

test("resolved Foundry configuration fails closed on compiler input drift", () => {
  assert.doesNotThrow(() =>
    validateResolvedFoundryConfiguration(canonicalConfiguration()),
  );
  const mutations = [
    ["auto_detect_remappings", true],
    ["solc", "0.8.29"],
    ["evm_version", "osaka"],
    ["optimizer", false],
    ["optimizer_runs", 201],
    ["via_ir", false],
    ["bytecode_hash", "none"],
    ["cbor_metadata", false],
    ["libs", ["C:/absolute/lib"]],
    ["allow_paths", ["../../unexpected"]],
    ["include_paths", ["../../unexpected"]],
    [
      "libraries",
      ["Unexpected:Library:0x0000000000000000000000000000000000000001"],
    ],
  ];
  for (const [key, value] of mutations) {
    assert.throws(() =>
      validateResolvedFoundryConfiguration({
        ...canonicalConfiguration(),
        [key]: value,
      }),
    );
  }
});

test("relevant Foundry environment overrides fail closed without disclosure", () => {
  for (const key of [
    "FOUNDRY_REMAPPINGS",
    "FOUNDRY_EVM_VERSION",
    "FOUNDRY_SOLC",
    "FOUNDRY_OPTIMIZER",
    "FOUNDRY_OPTIMIZER_RUNS",
    "FOUNDRY_VIA_IR",
    "FOUNDRY_BYTECODE_HASH",
    "FOUNDRY_LIBRARIES",
    "FOUNDRY_INCLUDE_PATHS",
    "DAPP_REMAPPINGS",
  ]) {
    assert.throws(
      () => validateFoundryEnvironment({ [key]: "sensitive-path-value" }),
      (error) =>
        error instanceof Error &&
        error.message === "Foundry build override is not allowed" &&
        !error.message.includes("sensitive"),
    );
  }
});

test("build-environment validation accepts only the exact Forge resolution", () => {
  const calls = [];
  const runCommand = (command, arguments_) => {
    calls.push([command, arguments_]);
    if (arguments_[0] === "--version") {
      return {
        status: 0,
        stdout: "forge Version: 1.7.1\n",
        stderr: "",
      };
    }
    return {
      status: 0,
      stdout: JSON.stringify(canonicalConfiguration()),
      stderr: "",
    };
  };
  assert.doesNotThrow(() =>
    validateCovenantBuildEnvironment({
      environment: {},
      exists: () => false,
      runCommand,
    }),
  );
  assert.deepEqual(calls, [
    ["forge", ["--version"]],
    ["forge", ["config", "--json"]],
  ]);
});
