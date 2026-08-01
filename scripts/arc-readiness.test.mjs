import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { encodeAbiParameters, keccak256 } from "viem";
import {
  ARC_TESTNET_PROFILE,
  ARC_TESTNET_SECURITY_PROFILE_DIGEST,
} from "../packages/config/src/arc-testnet.ts";
import {
  arcDeploymentPlanSchema,
  canonicalDeploymentJson,
} from "../packages/spec/src/deployment-plan.ts";
import { readStrictPlanInput, runArcPlan } from "./arc/plan.mjs";
import {
  ARC_PREFLIGHT_ALLOWED_METHODS,
  performArcPreflight,
  runArcPreflight,
} from "./arc/preflight.mjs";

const fixturePath = resolve("tests/fixtures/arc/deployment-plan-input.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const artifact = Object.freeze({
  creationBytecode: "0x60006000",
  creationBytecodeHash: keccak256("0x60006000"),
  unpatchedRuntimeBytecodeHash: `0x${"22".repeat(32)}`,
  semanticImmutableMapDigest: `0x${"33".repeat(32)}`,
  canonicalAbiHash: `0x${"44".repeat(32)}`,
});
const toolchain = Object.freeze({
  sourceGitCommit: "a".repeat(40),
  forgeVersion: "1.7.1",
});
const fixedDate = new Date("2026-08-01T16:29:33.000Z");
const blockHash = `0x${"12".repeat(32)}`;
const code = "0x60006000";
const encodedUsdc = encodeAbiParameters([{ type: "string" }], ["USDC"]);

function planRun(overrides = {}) {
  const output = [];
  let artifactLoads = 0;
  const status = runArcPlan({
    commandArguments: ["--input", "synthetic.json"],
    readInput: () => structuredClone(fixture),
    loadArtifact: () => {
      artifactLoads += 1;
      return artifact;
    },
    loadToolchain: () => toolchain,
    nowSeconds: 1_780_000_000n,
    write: (value) => output.push(value),
    ...overrides,
  });
  return { output, status, artifactLoads };
}

function successfulRpc() {
  const calls = [];
  const request = async (call) => {
    calls.push(structuredClone(call));
    if (call.method === "eth_chainId") return "0x4cef52";
    if (call.method === "eth_getBlockByNumber") {
      return { number: "0x33ee37a", hash: blockHash };
    }
    if (call.method === "eth_getCode") return code;
    if (call.method === "eth_call") {
      const data = call.params[0].data;
      if (data === "0x313ce567") return `0x${"0".repeat(63)}6`;
      if (data === "0x95d89b41" || data === "0x06fdde03") {
        return encodedUsdc;
      }
    }
    throw new Error("Unexpected test call");
  };
  return { calls, request };
}

test("arc:plan emits one canonical broadcastable plan without network access", () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches += 1;
    throw new Error("Unexpected network access");
  };
  try {
    const { output, status, artifactLoads } = planRun();
    assert.equal(status, 0);
    assert.equal(artifactLoads, 1);
    assert.equal(fetches, 0);
    assert.equal(output.length, 1);
    const parsed = arcDeploymentPlanSchema.parse(JSON.parse(output[0]));
    assert.equal(parsed.planStatus, "BROADCASTABLE");
    assert.equal(parsed.networkEvmTarget, "prague");
    assert.equal(
      parsed.trustedNetworkProfileDigest,
      "0x1675dcd65bbe5bd3d7fd454b6d979c17703139ad5c538bd1483021253f4016d1",
    );
    assert.equal(output[0], `${canonicalDeploymentJson(parsed)}\n`);
    assert.doesNotMatch(
      output[0],
      /(?:private.?key|mnemonic|credential|signature|https?:|[A-Za-z]:[\\/])/iu,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("arc:plan rejects every unexpected argument before loading artifacts", () => {
  for (const commandArguments of [
    [],
    ["--input"],
    ["--input", "a", "extra"],
    ["--rpc-url", "https://attacker.invalid"],
    ["--input=a"],
  ]) {
    const { output, status, artifactLoads } = planRun({ commandArguments });
    assert.equal(status, 1);
    assert.equal(artifactLoads, 0);
    assert.deepEqual(JSON.parse(output[0]), {
      name: "ArcPlanError",
      code: "PLAN_VALIDATION_FAILED",
      message: "Arc deployment plan could not be generated",
    });
  }
});

test("arc:plan accepts only the package-manager separator before --input", () => {
  const { output, status, artifactLoads } = planRun({
    commandArguments: ["--", "--input", "synthetic.json"],
  });
  assert.equal(status, 0);
  assert.equal(artifactLoads, 1);
  assert.equal(
    arcDeploymentPlanSchema.parse(JSON.parse(output[0])).planStatus,
    "BROADCASTABLE",
  );
});

test("arc:plan rejects a symlinked input path", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "cov009-plan-"));
  const realDirectory = resolve(temporaryRoot, "real");
  const linkedDirectory = resolve(temporaryRoot, "linked");
  try {
    mkdirSync(realDirectory);
    writeFileSync(
      resolve(realDirectory, "input.json"),
      JSON.stringify(fixture),
    );
    symlinkSync(realDirectory, linkedDirectory, "junction");
    assert.throws(() =>
      readStrictPlanInput(resolve(linkedDirectory, "input.json")),
    );
  } finally {
    rmSync(temporaryRoot, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    });
  }
});

test("arc:plan rejects non-UTF-8 and oversized input", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "cov009-plan-input-"));
  try {
    const invalidUtf8 = resolve(temporaryRoot, "invalid.json");
    writeFileSync(invalidUtf8, Buffer.from([0xc3, 0x28]));
    assert.throws(() => readStrictPlanInput(invalidUtf8));
    const oversized = resolve(temporaryRoot, "oversized.json");
    writeFileSync(oversized, "x".repeat(64 * 1024 + 1));
    assert.throws(() => readStrictPlanInput(oversized));
  } finally {
    rmSync(temporaryRoot, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    });
  }
});

test("arc:preflight uses the exact sequential read-only allowlist", async () => {
  const { calls, request } = successfulRpc();
  const events = [];
  const pacing = [];
  const result = await performArcPreflight({
    request: async (call) => {
      events.push(call.method);
      return request(call);
    },
    sleep: async (milliseconds) => {
      pacing.push(milliseconds);
      events.push(`sleep:${milliseconds}`);
    },
    nowMilliseconds: () => 0,
    observedAt: fixedDate,
  });
  assert.deepEqual(pacing, [1_000, 1_000, 1_000, 1_000, 1_000]);
  assert.deepEqual(events, [
    "eth_chainId",
    "sleep:1000",
    "eth_getBlockByNumber",
    "sleep:1000",
    "eth_getCode",
    "sleep:1000",
    "eth_call",
    "sleep:1000",
    "eth_call",
    "sleep:1000",
    "eth_call",
  ]);
  assert.deepEqual(
    calls.map(({ method }) => method),
    [
      "eth_chainId",
      "eth_getBlockByNumber",
      "eth_getCode",
      "eth_call",
      "eth_call",
      "eth_call",
    ],
  );
  assert.deepEqual(
    [...new Set(calls.map(({ method }) => method))],
    [...ARC_PREFLIGHT_ALLOWED_METHODS],
  );
  assert.deepEqual(calls[1].params, ["latest", false]);
  assert.deepEqual(calls[2].params, [
    ARC_TESTNET_PROFILE.usdcInterfaceAddress,
    "latest",
  ]);
  assert.deepEqual(
    calls.slice(3).map(({ params }) => params[0]),
    [
      {
        to: ARC_TESTNET_PROFILE.usdcInterfaceAddress,
        data: "0x313ce567",
      },
      {
        to: ARC_TESTNET_PROFILE.usdcInterfaceAddress,
        data: "0x95d89b41",
      },
      {
        to: ARC_TESTNET_PROFILE.usdcInterfaceAddress,
        data: "0x06fdde03",
      },
    ],
  );
  assert.equal(
    calls.every(({ timeoutMs }) => timeoutMs === 5_000),
    true,
  );
  assert.equal(result.chainId, "5042002");
  assert.equal(result.latestBlock.number, "54453114");
  assert.equal(result.usdc.codeHash, keccak256(code));
  assert.equal(result.usdc.decimals, "6");
  assert.equal(result.usdc.symbol, "USDC");
  assert.equal(result.usdc.name, "USDC");
});

test("arc:preflight emits one sanitized JSON result", async () => {
  const { request } = successfulRpc();
  const output = [];
  const status = await runArcPreflight({
    commandArguments: [],
    request,
    sleep: async () => {},
    nowMilliseconds: () => 0,
    observedAt: fixedDate,
    write: (value) => output.push(value),
  });
  assert.equal(status, 0);
  assert.equal(output.length, 1);
  const parsed = JSON.parse(output[0]);
  assert.equal(parsed.status, "PASS");
  assert.doesNotMatch(
    output[0],
    /(?:https?:|rpc\.testnet|headers|client|stack|[A-Za-z]:[\\/])/iu,
  );
});

test("arc:preflight rejects arguments before every request", async () => {
  let requests = 0;
  const output = [];
  const status = await runArcPreflight({
    commandArguments: ["--rpc-url=https://attacker.invalid"],
    request: async () => {
      requests += 1;
    },
    write: (value) => output.push(value),
  });
  assert.equal(status, 1);
  assert.equal(requests, 0);
  assert.equal(output.length, 1);
});

test("arc:preflight rejects wrong or malformed chain values without retry", async () => {
  for (const chainId of ["0x1", "5042002", "0x04cef52", "0x4CF4B2"]) {
    let requests = 0;
    const output = [];
    const status = await runArcPreflight({
      commandArguments: [],
      request: async () => {
        requests += 1;
        return chainId;
      },
      nowMilliseconds: () => 0,
      write: (value) => output.push(value),
    });
    assert.equal(status, 1);
    assert.equal(requests, 1);
    assert.doesNotMatch(output[0], new RegExp(chainId, "u"));
  }
});

test("arc:preflight rejects malformed block, code, and token views", async () => {
  const mutations = [
    { index: 1, result: { number: "0x1", hash: "0x12" } },
    { index: 2, result: "0x" },
    { index: 3, result: `0x${"0".repeat(64)}` },
    {
      index: 4,
      result: encodeAbiParameters([{ type: "string" }], ["ATTACK"]),
    },
    {
      index: 5,
      result: encodeAbiParameters([{ type: "string" }], ["ATTACK"]),
    },
  ];
  for (const mutation of mutations) {
    const { request } = successfulRpc();
    let index = 0;
    const output = [];
    const status = await runArcPreflight({
      commandArguments: [],
      request: async (call) => {
        const current = index;
        index += 1;
        return current === mutation.index ? mutation.result : request(call);
      },
      sleep: async () => {},
      nowMilliseconds: () => 0,
      write: (value) => output.push(value),
    });
    assert.equal(status, 1);
    assert.deepEqual(JSON.parse(output[0]), {
      name: "ArcPreflightError",
      code: "PREFLIGHT_VALIDATION_FAILED",
      message: "Arc read-only preflight could not be verified",
    });
  }
});

test("arc:preflight does not retry after a fifth-call HTTP 429", async () => {
  const { request } = successfulRpc();
  const pacing = [];
  let requests = 0;
  const output = [];
  const status = await runArcPreflight({
    commandArguments: [],
    request: async (call) => {
      requests += 1;
      if (requests === 5) throw new Error("HTTP 429 request limit reached");
      return request(call);
    },
    sleep: async (milliseconds) => pacing.push(milliseconds),
    nowMilliseconds: () => 0,
    write: (value) => output.push(value),
  });
  assert.equal(status, 1);
  assert.equal(requests, 5);
  assert.deepEqual(pacing, [1_000, 1_000, 1_000, 1_000]);
  assert.deepEqual(JSON.parse(output[0]), {
    name: "ArcPreflightError",
    code: "PREFLIGHT_VALIDATION_FAILED",
    message: "Arc read-only preflight could not be verified",
  });
});

test("arc:preflight fails closed when total time expires during pacing", async () => {
  let now = 0;
  let requests = 0;
  const pacing = [];
  const output = [];
  const status = await runArcPreflight({
    commandArguments: [],
    request: async () => {
      requests += 1;
      return "0x4cef52";
    },
    sleep: async (milliseconds) => {
      pacing.push(milliseconds);
      now += 20_000;
    },
    nowMilliseconds: () => now,
    write: (value) => output.push(value),
  });
  assert.equal(status, 1);
  assert.equal(requests, 1);
  assert.deepEqual(pacing, [1_000]);
  assert.deepEqual(JSON.parse(output[0]), {
    name: "ArcPreflightError",
    code: "PREFLIGHT_VALIDATION_FAILED",
    message: "Arc read-only preflight could not be verified",
  });
});

test("arc:preflight sanitizes timeout and rate-limit failures without retry", async () => {
  for (const providerError of [
    new Error("timeout from https://secret.invalid"),
    new Error("HTTP 429 raw provider response"),
  ]) {
    let requests = 0;
    const output = [];
    const status = await runArcPreflight({
      commandArguments: [],
      request: async () => {
        requests += 1;
        throw providerError;
      },
      write: (value) => output.push(value),
    });
    assert.equal(status, 1);
    assert.equal(requests, 1);
    assert.doesNotMatch(output[0], /429|https?:|provider|timeout/iu);
  }
});

test("Arc readiness modules expose no account, signing, or broadcast method", () => {
  const sources = [
    readFileSync(resolve("scripts/arc/plan.mjs"), "utf8"),
    readFileSync(resolve("scripts/arc/preflight.mjs"), "utf8"),
  ].join("\n");
  for (const forbidden of [
    "eth_accounts",
    "eth_sendTransaction",
    "eth_sendRawTransaction",
    "eth_sign",
    "personal_",
    "wallet_",
    "debug_",
    "trace_",
    "admin_",
    "net_version",
    "web3_clientVersion",
  ]) {
    assert.equal(sources.includes(forbidden), false, forbidden);
  }
  assert.equal(sources.includes(ARC_TESTNET_PROFILE.primaryHttpsRpc), false);
  assert.match(ARC_TESTNET_SECURITY_PROFILE_DIGEST, /^0x[0-9a-f]{64}$/u);
});
