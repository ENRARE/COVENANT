import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { createServer } from "node:net";
import test from "node:test";
import {
  assertAnvilCandidatePortsReleased,
  availableAnvilCandidatePorts,
  candidatePortIsBindable,
} from "./contract-evidence-port-cleanup.mjs";
import {
  resolveRepositoryPnpmCli,
  runContractEvidence,
} from "./run-contract-evidence.mjs";
import {
  ANVIL_LOOPBACK_HOST,
  ANVIL_PORT_CANDIDATES,
} from "../tests/contract-evidence/anvil-ports.mjs";

const root = resolve(import.meta.dirname, "..");
const evidenceTypes = Object.freeze([
  "LOCAL_EVM_DEPLOYMENT_VERIFIED",
  "LOCAL_VAULT_FUNDED_VERIFIED",
  "LOCAL_VAULT_EXECUTION_SUBMITTED",
  "LOCAL_VAULT_EXECUTION_VERIFIED",
  "LOCAL_REPLAY_REJECTED",
  "LOCAL_BYPASS_REJECTED",
  "LOCAL_NON_ISSUER_REVOCATION_REJECTED",
  "LOCAL_COVENANT_REVOCATION_VERIFIED",
  "LOCAL_POST_REVOCATION_EXECUTION_REJECTED",
]);
const safeResult = Object.freeze({
  schemaVersion: "1",
  mode: "LOCAL_ANVIL",
  chainId: "5042002",
  status: "VERIFIED",
  evidence: evidenceTypes.map((type) => ({ type, status: "PASS" })),
  counts: {
    submittedTransactions: "11",
    successfulReceipts: "7",
    revertedReceipts: "4",
  },
});
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

function exerciseRunner({ failAt, harnessStdout, harnessStderr = "" } = {}) {
  const calls = [];
  const output = [];
  const status = runContractEvidence({
    runCommand(command, args, options) {
      const callIndex = calls.length;
      calls.push({ command, args: [...args], options });
      const isHarness = callIndex === 3;
      return {
        status: callIndex === failAt ? 1 : 0,
        stdout: isHarness
          ? (harnessStdout ??
            `COVENANT_LOCAL_EVIDENCE_RESULT=${JSON.stringify(safeResult)}\n`)
          : "",
        stderr: isHarness ? harnessStderr : "",
      };
    },
    write(value) {
      output.push(value);
    },
  });
  return { calls, output, status };
}

function expectedCalls() {
  const pnpmCli = resolveRepositoryPnpmCli();
  return [
    {
      command: process.execPath,
      args: ["scripts/verify-contract-dependencies.mjs"],
    },
    {
      command: process.execPath,
      args: [pnpmCli, ...productionBuildArguments],
    },
    {
      command: "forge",
      args: ["build", "--root", "packages/contracts"],
    },
    {
      command: process.execPath,
      args: [
        "node_modules/vitest/vitest.mjs",
        "run",
        "--config",
        "tests/contract-evidence/vitest.config.ts",
      ],
    },
  ];
}

function assertCapturedOptions(call, isHarness) {
  assert.equal(call.options.cwd, root);
  assert.equal(call.options.encoding, "utf8");
  assert.equal(call.options.maxBuffer, 32 * 1024 * 1024);
  assert.equal(call.options.shell, false);
  assert.equal(call.options.windowsHide, true);
  assert.deepEqual(call.options.stdio, ["ignore", "pipe", "pipe"]);
  for (const key of Object.keys(call.options.env)) {
    assert.equal(
      forbiddenEnvironmentKeys.has(key.toUpperCase()),
      false,
      `forbidden environment key forwarded: ${key}`,
    );
  }
  assert.equal(
    call.options.env.COVENANT_EVIDENCE_COMMAND,
    isHarness ? "1" : undefined,
  );
}

function assertExactCalls(calls) {
  const expected = expectedCalls();
  assert.equal(calls.length, expected.length);
  for (const [index, call] of calls.entries()) {
    assert.equal(call.command, expected[index].command);
    assert.deepEqual(call.args, expected[index].args);
    assertCapturedOptions(call, index === 3);
  }
  assert.deepEqual(
    new Set(calls.map(({ command }) => command)),
    new Set([process.execPath, "forge"]),
  );
  assert.equal(
    calls.some(({ command, args }) =>
      /arc|circle|corepack|curl|https?:|npx|powershell|rpc|wget|browser/i.test(
        `${command} ${args.join(" ")}`,
      ),
    ),
    false,
  );
}

function copyTrackedCheckout(destination) {
  const listed = spawnSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  assert.equal(listed.status, 0, listed.stderr);
  for (const trackedPath of listed.stdout.split("\0").filter(Boolean)) {
    const source = resolve(root, trackedPath);
    const target = resolve(destination, trackedPath);
    assert.equal(
      relative(destination, target).startsWith(".."),
      false,
      `tracked path escaped checkout: ${trackedPath}`,
    );
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
  }
}

function copyContractDependencies(checkout) {
  const dependencyRoot = resolve(checkout, "lib");
  mkdirSync(dependencyRoot, { recursive: true });
  for (const dependency of ["forge-std", "openzeppelin-contracts"]) {
    const source = resolve(root, "lib", dependency);
    assert.equal(existsSync(source), true, `missing ${dependency}`);
    cpSync(source, resolve(dependencyRoot, dependency), { recursive: true });
  }
}

function resolveRepositoryPnpmStore() {
  const result = spawnSync(
    process.execPath,
    [resolveRepositoryPnpmCli(), "store", "path"],
    {
      cwd: root,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const store = result.stdout.trim();
  assert.notEqual(store, "");
  return store;
}

async function listenOnCandidate(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(
      { host: ANVIL_LOOPBACK_HOST, port, exclusive: true },
      resolve,
    );
  });
  return server;
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

function assertEvidenceOutput(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stderr, "");
  const lines = result.stdout.split(/\r?\n/u).filter(Boolean);
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), safeResult);
  assert.doesNotMatch(
    result.stdout,
    /(?:[A-Za-z]:[\\/]|privateKey|rpcUrl|https?:|signature|signedEnvelope|calldata|receiptHash|provider|stack)/iu,
  );
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

test("repository pnpm resolution is realpath-bound to the exact pinned package", () => {
  const pnpmCli = resolveRepositoryPnpmCli();
  const nodeModulesRoot = realpathSync(resolve(root, "node_modules"));
  assert.equal(relative(nodeModulesRoot, pnpmCli).startsWith(".."), false);
  assert.match(pnpmCli, /[\\/]pnpm[\\/]bin[\\/]pnpm\.[cm]js$/u);
  const rootManifest = JSON.parse(readFileSync(resolve(root, "package.json")));
  assert.equal(rootManifest.packageManager, "pnpm@11.7.0");
  assert.equal(rootManifest.devDependencies.pnpm, "11.7.0");
});

test("repository pnpm resolution failure is sanitized before every subprocess", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "covenant-resolution-"));
  try {
    mkdirSync(resolve(temporaryRoot, "scripts"), { recursive: true });
    cpSync(
      resolve(root, "scripts", "run-contract-evidence.mjs"),
      resolve(temporaryRoot, "scripts", "run-contract-evidence.mjs"),
    );
    const manifest = JSON.parse(readFileSync(resolve(root, "package.json")));
    manifest.devDependencies.pnpm = "11.7.1";
    writeFileSync(
      resolve(temporaryRoot, "package.json"),
      `${JSON.stringify(manifest)}\n`,
    );
    symlinkSync(
      resolve(root, "node_modules"),
      resolve(temporaryRoot, "node_modules"),
      "junction",
    );
    const result = spawnSync(
      process.execPath,
      ["scripts/run-contract-evidence.mjs"],
      {
        cwd: temporaryRoot,
        encoding: "utf8",
        shell: false,
        windowsHide: true,
      },
    );
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `${JSON.stringify(missingToolFailure)}\n`);
    assert.doesNotMatch(result.stdout, /[A-Za-z]:[\\/]|stack|11\.7\.1/iu);
  } finally {
    rmSync(temporaryRoot, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    });
  }
});

test("successful orchestration uses only the exact allowlisted subprocess sequence", () => {
  const { calls, output, status } = exerciseRunner();
  assert.equal(status, 0);
  assertExactCalls(calls);
  assert.deepEqual(output, [`${JSON.stringify(safeResult)}\n`]);
});

test("production build failure short-circuits before Forge, Vitest, or Anvil", () => {
  const { calls, output, status } = exerciseRunner({ failAt: 1 });
  assert.equal(status, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map(({ command, args }) => ({ command, args })),
    expectedCalls().slice(0, 2),
  );
  assert.deepEqual(output, [`${JSON.stringify(sanitizedFailure)}\n`]);
});

test("Forge failure short-circuits before Vitest or Anvil", () => {
  const { calls, output, status } = exerciseRunner({ failAt: 2 });
  assert.equal(status, 1);
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map(({ command, args }) => ({ command, args })),
    expectedCalls().slice(0, 3),
  );
  assert.deepEqual(output, [`${JSON.stringify(sanitizedFailure)}\n`]);
});

test("harness failure suppresses raw child output and returns fixed JSON", () => {
  const { calls, output, status } = exerciseRunner({
    failAt: 3,
    harnessStdout: "secret path C:\\sensitive\n",
    harnessStderr: "provider stack trace\n",
  });
  assert.equal(status, 1);
  assertExactCalls(calls);
  assert.deepEqual(output, [`${JSON.stringify(sanitizedFailure)}\n`]);
});

test("unexpected command-line arguments are rejected before every subprocess", () => {
  for (const commandArguments of [
    ["unexpected"],
    ["one", "two"],
    ["--rpc-url=http://external.invalid"],
    ["--filter", "@covenant/spec"],
    ["; Write-Host compromised"],
    [""],
    ["   "],
  ]) {
    const output = [];
    const status = runContractEvidence({
      commandArguments,
      runCommand() {
        assert.fail("unexpected subprocess");
      },
      write(value) {
        output.push(value);
      },
    });
    assert.equal(status, 1);
    assert.deepEqual(output, [`${JSON.stringify(sanitizedFailure)}\n`]);
  }
});

test("direct CLI arguments and a matching-suffix npm_execpath cannot select a command", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "covenant-arguments-"));
  const sentinel = resolve(temporaryRoot, "executed");
  const hostileCli = resolve(
    temporaryRoot,
    "node_modules",
    "pnpm",
    "bin",
    "pnpm.mjs",
  );
  try {
    mkdirSync(dirname(hostileCli), { recursive: true });
    writeFileSync(
      hostileCli,
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(sentinel)}, "executed");`,
    );
    for (const commandArguments of [
      ["unexpected"],
      ["one", "two"],
      ["--rpc-url=http://external.invalid"],
      ["--filter", "@covenant/spec"],
      ["; Write-Host compromised"],
      [""],
      ["   "],
    ]) {
      const result = spawnSync(
        process.execPath,
        ["scripts/run-contract-evidence.mjs", ...commandArguments],
        {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, npm_execpath: hostileCli },
          shell: false,
          windowsHide: true,
        },
      );
      assert.equal(result.status, 1);
      assert.equal(result.stderr, "");
      assert.deepEqual(JSON.parse(result.stdout), sanitizedFailure);
      assert.equal(existsSync(sentinel), false);
    }
  } finally {
    rmSync(temporaryRoot, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    });
  }
});

test("a previously free candidate remains free after cleanup assertion", async () => {
  const available = await availableAnvilCandidatePorts();
  assert.notEqual(available.length, 0);
  assert.equal(
    available.every((port) => ANVIL_PORT_CANDIDATES.includes(port)),
    true,
  );
  await assertAnvilCandidatePortsReleased([available[0]]);
  assert.equal(await candidatePortIsBindable(available[0]), true);
});

test("cleanup assertion detects a leaked candidate listener", async () => {
  const [port] = await availableAnvilCandidatePorts();
  assert.notEqual(port, undefined);
  const leaked = await listenOnCandidate(port);
  try {
    await assert.rejects(
      assertAnvilCandidatePortsReleased([port], { releaseTimeoutMs: 0 }),
      /left a candidate port occupied/u,
    );
  } finally {
    await closeServer(leaked);
  }
});

test("a candidate occupied before the snapshot is not attributed to the harness", async () => {
  const [port] = await availableAnvilCandidatePorts();
  assert.notEqual(port, undefined);
  const occupied = await listenOnCandidate(port);
  try {
    const available = await availableAnvilCandidatePorts();
    assert.equal(available.includes(port), false);
    await assertAnvilCandidatePortsReleased(available);
    assert.equal(occupied.listening, true);
  } finally {
    await closeServer(occupied);
  }
});

test("temporary probe sockets close when a cleanup assertion fails", async () => {
  const available = await availableAnvilCandidatePorts();
  assert.ok(available.length >= 2);
  const leaked = await listenOnCandidate(available[0]);
  try {
    await assert.rejects(
      assertAnvilCandidatePortsReleased(available.slice(0, 2), {
        releaseTimeoutMs: 0,
      }),
      /left a candidate port occupied/u,
    );
    assert.equal(await candidatePortIsBindable(available[1]), true);
  } finally {
    await closeServer(leaked);
  }
});

test("cleanup regression does not invoke global process enumeration", () => {
  const source = [
    readFileSync(resolve("scripts/run-contract-evidence.test.mjs"), "utf8"),
    readFileSync(resolve("scripts/contract-evidence-port-cleanup.mjs"), "utf8"),
  ].join("\n");
  const forbiddenCommands = [
    ["task", "list"].join(""),
    ["w", "mic"].join(""),
    ["Get", "-Cim", "Instance"].join(""),
    ["Win32", "_Process"].join(""),
  ];
  assert.doesNotMatch(
    source,
    new RegExp(`(?:${forbiddenCommands.join("|")})`, "iu"),
  );
});

test("isolated documented command regenerates clean outputs and ignores hostile npm_execpath", async () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "covenant-evidence-"));
  const checkout = resolve(temporaryRoot, "checkout");
  const sentinel = resolve(temporaryRoot, "hostile-executed");
  const hostileCli = resolve(
    temporaryRoot,
    "hostile",
    "node_modules",
    "pnpm",
    "bin",
    "pnpm.mjs",
  );
  const availableCandidatePorts = await availableAnvilCandidatePorts();
  try {
    mkdirSync(checkout, { recursive: true });
    copyTrackedCheckout(checkout);
    copyContractDependencies(checkout);

    const install = spawnSync(
      process.execPath,
      [
        resolveRepositoryPnpmCli(),
        "install",
        "--offline",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--store-dir",
        resolveRepositoryPnpmStore(),
        "--reporter=append-only",
      ],
      {
        cwd: checkout,
        encoding: "utf8",
        env: { ...process.env, CI: "true" },
        maxBuffer: 32 * 1024 * 1024,
        shell: false,
        windowsHide: true,
      },
    );
    assert.equal(install.status, 0, `${install.stdout}\n${install.stderr}`);

    const outputDirectories = [
      "packages/spec/dist",
      "apps/agent/dist",
      "apps/authority/dist",
      "apps/executor/dist",
    ];
    for (const outputDirectory of outputDirectories) {
      assert.equal(existsSync(resolve(checkout, outputDirectory)), false);
    }

    mkdirSync(dirname(hostileCli), { recursive: true });
    writeFileSync(
      hostileCli,
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(sentinel)}, "executed");`,
    );
    const localPnpmCommand = resolve(
      checkout,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "pnpm.CMD" : "pnpm",
    );
    const documented =
      process.platform === "win32"
        ? spawnSync(
            resolve(
              process.env.SystemRoot ?? "C:\\Windows",
              "System32",
              "cmd.exe",
            ),
            [
              "/d",
              "/s",
              "/c",
              `${localPnpmCommand} --silent contracts:evidence:local`,
            ],
            {
              cwd: checkout,
              encoding: "utf8",
              env: { ...process.env, npm_execpath: hostileCli },
              maxBuffer: 32 * 1024 * 1024,
              shell: false,
              windowsHide: true,
            },
          )
        : spawnSync(
            localPnpmCommand,
            ["--silent", "contracts:evidence:local"],
            {
              cwd: checkout,
              encoding: "utf8",
              env: { ...process.env, npm_execpath: hostileCli },
              maxBuffer: 32 * 1024 * 1024,
              shell: false,
              windowsHide: true,
            },
          );
    assertEvidenceOutput(documented);
    await assertAnvilCandidatePortsReleased(availableCandidatePorts);
    for (const outputDirectory of outputDirectories) {
      assert.equal(existsSync(resolve(checkout, outputDirectory)), true);
    }
    assert.equal(existsSync(sentinel), false);

    const hostileEnvironment = spawnSync(
      process.execPath,
      ["scripts/run-contract-evidence.mjs"],
      {
        cwd: checkout,
        encoding: "utf8",
        env: { ...process.env, npm_execpath: hostileCli },
        maxBuffer: 32 * 1024 * 1024,
        shell: false,
        windowsHide: true,
      },
    );
    assertEvidenceOutput(hostileEnvironment);
    assert.equal(existsSync(sentinel), false);
    await assertAnvilCandidatePortsReleased(availableCandidatePorts);
  } finally {
    rmSync(temporaryRoot, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    });
  }
});
