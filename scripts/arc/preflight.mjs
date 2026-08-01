import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { decodeAbiParameters, keccak256 } from "viem";
import { ARC_TESTNET_PROFILE } from "../../packages/config/src/arc-testnet.ts";

const ALLOWED_METHODS = Object.freeze([
  "eth_chainId",
  "eth_getBlockByNumber",
  "eth_getCode",
  "eth_call",
]);
const allowedMethodSet = new Set(ALLOWED_METHODS);
const DECIMALS_CALL = "0x313ce567";
const SYMBOL_CALL = "0x95d89b41";
const NAME_CALL = "0x06fdde03";
const PACING_DELAY_MS = 1_000;
const PER_REQUEST_TIMEOUT_MS = 5_000;
const TOTAL_TIMEOUT_MS = 20_000;
const MAXIMUM_RESPONSE_BYTES = 1024 * 1024;

const sanitizedFailure = Object.freeze({
  name: "ArcPreflightError",
  code: "PREFLIGHT_VALIDATION_FAILED",
  message: "Arc read-only preflight could not be verified",
});

function strictObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Malformed JSON-RPC response");
  }
  return value;
}

function hexQuantity(value) {
  if (
    typeof value !== "string" ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value)
  ) {
    throw new Error("Malformed JSON-RPC quantity");
  }
  return BigInt(value);
}

function bytes32(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value)) {
    throw new Error("Malformed bytes32 value");
  }
  return value;
}

function bytecode(value) {
  if (
    typeof value !== "string" ||
    !/^0x(?:[0-9a-f]{2})+$/u.test(value) ||
    value === "0x"
  ) {
    throw new Error("Missing Arc USDC code");
  }
  return value;
}

function abiUint256(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value)) {
    throw new Error("Malformed ABI uint256");
  }
  return BigInt(value);
}

function abiString(value) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-f]{2})+$/u.test(value)) {
    throw new Error("Malformed ABI string");
  }
  const decoded = decodeAbiParameters([{ type: "string" }], value)[0];
  if (typeof decoded !== "string") throw new Error("Malformed ABI string");
  return decoded;
}

async function readResponseBody(response) {
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) > MAXIMUM_RESPONSE_BYTES) {
    throw new Error("JSON-RPC response is too large");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAXIMUM_RESPONSE_BYTES) {
    throw new Error("JSON-RPC response is too large");
  }
  return JSON.parse(text);
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, milliseconds);
  });
}

export async function requestPrimaryArcRpc(call) {
  if (!allowedMethodSet.has(call.method)) {
    throw new Error("JSON-RPC method is not allowlisted");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), call.timeoutMs);
  try {
    const response = await fetch(ARC_TESTNET_PROFILE.primaryHttpsRpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: call.id,
        method: call.method,
        params: call.params,
      }),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Arc primary RPC rejected the request");
    const payload = strictObject(await readResponseBody(response));
    const keys = Object.keys(payload).sort();
    const expectedKeys =
      "error" in payload
        ? ["error", "id", "jsonrpc"]
        : ["id", "jsonrpc", "result"];
    if (
      keys.length !== expectedKeys.length ||
      keys.some((key, index) => key !== expectedKeys[index]) ||
      payload.jsonrpc !== "2.0" ||
      payload.id !== call.id ||
      "error" in payload
    ) {
      throw new Error("Malformed JSON-RPC response");
    }
    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

export async function performArcPreflight(options = {}) {
  const request = options.request ?? requestPrimaryArcRpc;
  const nowMilliseconds = options.nowMilliseconds ?? (() => Date.now());
  const pace = options.sleep ?? sleep;
  const started = nowMilliseconds();
  let id = 1;
  const call = async (method, params) => {
    if (!allowedMethodSet.has(method)) {
      throw new Error("JSON-RPC method is not allowlisted");
    }
    if (id > 1) await pace(PACING_DELAY_MS);
    const remaining = TOTAL_TIMEOUT_MS - (nowMilliseconds() - started);
    if (remaining <= 0) throw new Error("Arc preflight timed out");
    const result = await request({
      id,
      method,
      params,
      timeoutMs: Math.min(PER_REQUEST_TIMEOUT_MS, remaining),
    });
    id += 1;
    return result;
  };

  const chainIdResult = await call("eth_chainId", []);
  const chainId = hexQuantity(chainIdResult);
  if (chainId.toString() !== ARC_TESTNET_PROFILE.chainId) {
    throw new Error("Unexpected Arc chain");
  }

  const block = strictObject(
    await call("eth_getBlockByNumber", ["latest", false]),
  );
  const blockNumber = hexQuantity(block.number);
  const blockHash = bytes32(block.hash);
  if (blockNumber <= 0n || blockHash === `0x${"0".repeat(64)}`) {
    throw new Error("Malformed committed Arc block");
  }

  const code = bytecode(
    await call("eth_getCode", [
      ARC_TESTNET_PROFILE.usdcInterfaceAddress,
      "latest",
    ]),
  );
  const tokenCall = async (data) =>
    call("eth_call", [
      { to: ARC_TESTNET_PROFILE.usdcInterfaceAddress, data },
      "latest",
    ]);
  const decimals = abiUint256(await tokenCall(DECIMALS_CALL));
  const symbol = abiString(await tokenCall(SYMBOL_CALL));
  const name = abiString(await tokenCall(NAME_CALL));
  if (
    decimals.toString() !== String(ARC_TESTNET_PROFILE.erc20Decimals) ||
    symbol !== "USDC" ||
    name !== "USDC"
  ) {
    throw new Error("Unexpected Arc USDC interface response");
  }
  if (nowMilliseconds() - started > TOTAL_TIMEOUT_MS) {
    throw new Error("Arc preflight exceeded its total timeout");
  }

  return Object.freeze({
    schemaVersion: "1",
    mode: "ARC_TESTNET_READ_ONLY",
    status: "PASS",
    observedAt: (options.observedAt ?? new Date()).toISOString(),
    chainId: ARC_TESTNET_PROFILE.chainId,
    latestBlock: Object.freeze({
      number: blockNumber.toString(),
      hash: blockHash,
    }),
    usdc: Object.freeze({
      address: ARC_TESTNET_PROFILE.usdcInterfaceAddress,
      codePresent: true,
      codeHash: keccak256(code),
      decimals: decimals.toString(),
      symbol,
      name,
    }),
  });
}

export async function runArcPreflight(options = {}) {
  const write = options.write ?? ((value) => process.stdout.write(value));
  if ((options.commandArguments ?? process.argv.slice(2)).length !== 0) {
    write(`${JSON.stringify(sanitizedFailure)}\n`);
    return 1;
  }
  try {
    const result = await performArcPreflight(options);
    write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch {
    write(`${JSON.stringify(sanitizedFailure)}\n`);
    return 1;
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = await runArcPreflight();
}

export const ARC_PREFLIGHT_ALLOWED_METHODS = ALLOWED_METHODS;
