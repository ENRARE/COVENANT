import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { runContractEvidence } from "./run-contract-evidence.mjs";

const safeResult = Object.freeze({
  schemaVersion: "1",
  mode: "LOCAL_ANVIL",
  chainId: "5042002",
  status: "VERIFIED",
  evidence: [],
  counts: {
    submittedTransactions: "0",
    successfulReceipts: "0",
    revertedReceipts: "0",
  },
});
const packageManagerEntry = "C:\\fixed\\node_modules\\pnpm\\bin\\pnpm.mjs";

function successfulRun() {
  const calls = [];
  const output = [];
  const status = runContractEvidence({
    packageManagerEntry,
    runCommand(command, args, options) {
      calls.push({ command, args: [...args], options });
      const isHarness = args.includes(
        "tests/contract-evidence/vitest.config.ts",
      );
      return {
        status: 0,
        stdout: isHarness
          ? `COVENANT_LOCAL_EVIDENCE_RESULT=${JSON.stringify(safeResult)}\n`
          : "",
        stderr: "",
      };
    },
    write(value) {
      output.push(value);
    },
  });
  return { calls, output, status };
}

test("contract evidence static types resolve only through public workspace source entry points", () => {
  const configuration = JSON.parse(
    readFileSync(resolve("tests/contract-evidence/tsconfig.json"), "utf8"),
  );
  assert.deepEqual(configuration.compilerOptions.paths, {
    "@covenant/agent": ["apps/agent/src/index.ts"],
    "@covenant/authority": ["apps/authority/src/index.ts"],
    "@covenant/executor": ["apps/executor/src/index.ts"],
    "@covenant/spec": ["packages/spec/src/index.ts"],
  });
  assert.doesNotMatch(
    JSON.stringify(configuration.compilerOptions.paths),
    /dist/u,
  );
});

test("standalone evidence always builds every production prerequisite before the harness", () => {
  const { calls, status } = successfulRun();
  assert.equal(status, 0);
  assert.deepEqual(calls[1].args, [
    packageManagerEntry,
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
  assert.ok(calls[1].args.indexOf("build") >= 0);
  assert.ok(calls[3].args.includes("tests/contract-evidence/vitest.config.ts"));
  assert.equal(
    calls
      .slice(0, 3)
      .some((call) =>
        call.args.includes("tests/contract-evidence/vitest.config.ts"),
      ),
    false,
  );
});

test("production build failure prevents harness and Anvil startup", () => {
  const calls = [];
  const output = [];
  const status = runContractEvidence({
    packageManagerEntry,
    runCommand(command, args) {
      calls.push({ command, args: [...args] });
      return { status: calls.length === 2 ? 1 : 0, stdout: "", stderr: "" };
    },
    write(value) {
      output.push(value);
    },
  });
  assert.equal(status, 1);
  assert.equal(calls.length, 2);
  assert.equal(
    calls.some((call) =>
      call.args.includes("tests/contract-evidence/vitest.config.ts"),
    ),
    false,
  );
  assert.deepEqual(JSON.parse(output.join("")), {
    name: "ContractEvidenceError",
    code: "HARNESS_EXECUTION_FAILED",
    message: "Local contract evidence could not be verified",
  });
});

test("successful orchestration emits one sanitized JSON line without external commands", () => {
  const { calls, output, status } = successfulRun();
  assert.equal(status, 0);
  assert.equal(output.length, 1);
  assert.deepEqual(JSON.parse(output[0]), safeResult);
  assert.equal(
    calls.some((call) =>
      /arc|circle|https?:|rpc/i.test(`${call.command} ${call.args.join(" ")}`),
    ),
    false,
  );
});
