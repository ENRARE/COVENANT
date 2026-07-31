import { spawnSync } from "node:child_process";
import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  ARC_TESTNET_PROFILE,
  ARC_TESTNET_SECURITY_PROFILE_DIGEST,
} from "../../packages/config/src/arc-testnet.ts";
import {
  canonicalDeploymentJson,
  createArcDeploymentPlan,
  parseArcDeploymentPlanInput,
} from "../../packages/spec/src/deployment-plan.ts";
import { loadReviewedCovenantVaultArtifact } from "./artifact-attestation.mjs";

const MAXIMUM_INPUT_BYTES = 64 * 1024;
const sanitizedFailure = Object.freeze({
  name: "ArcPlanError",
  code: "PLAN_VALIDATION_FAILED",
  message: "Arc deployment plan could not be generated",
});

function parseArguments(arguments_) {
  const normalized =
    Array.isArray(arguments_) && arguments_[0] === "--"
      ? arguments_.slice(1)
      : arguments_;
  if (
    !Array.isArray(normalized) ||
    normalized.length !== 2 ||
    normalized[0] !== "--input" ||
    typeof normalized[1] !== "string" ||
    normalized[1].length === 0
  ) {
    throw new Error("Invalid arc:plan arguments");
  }
  return normalized[1];
}

export function readStrictPlanInput(path) {
  const resolved = resolve(path);
  const before = lstatSync(resolved);
  if (
    realpathSync.native(resolved) !== resolved ||
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.size === 0 ||
    before.size > MAXIMUM_INPUT_BYTES
  ) {
    throw new Error("Invalid arc:plan input file");
  }
  const descriptor = openSync(resolved, "r");
  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    ) {
      throw new Error("Arc plan input changed during validation");
    }
    const bytes = readFileSync(descriptor);
    if (bytes.byteLength !== opened.size) {
      throw new Error("Arc plan input is incomplete");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } finally {
    closeSync(descriptor);
  }
}

function exactCommand(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: resolve(import.meta.dirname, "../.."),
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (result.status !== 0 || result.stderr !== "") {
    throw new Error("Offline toolchain verification failed");
  }
  return result.stdout.trim();
}

export function loadDeploymentToolchain() {
  const sourceGitCommit = exactCommand("git", ["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/u.test(sourceGitCommit)) {
    throw new Error("Invalid repository commit");
  }
  const forgeOutput = exactCommand("forge", ["--version"]);
  if (!/^forge Version: 1\.7\.1(?:\r?\n|$)/u.test(forgeOutput)) {
    throw new Error("Unexpected Forge version");
  }
  return Object.freeze({
    sourceGitCommit,
    forgeVersion: "1.7.1",
  });
}

export function runArcPlan(options = {}) {
  const write = options.write ?? ((value) => process.stdout.write(value));
  const fail = () => {
    write(`${JSON.stringify(sanitizedFailure)}\n`);
    return 1;
  };
  try {
    const inputPath = parseArguments(
      options.commandArguments ?? process.argv.slice(2),
    );
    const rawInput = (options.readInput ?? readStrictPlanInput)(inputPath);
    const nowSeconds =
      options.nowSeconds ?? BigInt(Math.floor(Date.now() / 1_000));
    const anchors = Object.freeze({
      chainId: ARC_TESTNET_PROFILE.chainId,
      usdcInterfaceAddress: ARC_TESTNET_PROFILE.usdcInterfaceAddress,
      profileDigest: ARC_TESTNET_SECURITY_PROFILE_DIGEST,
      nowSeconds,
    });
    const parsedInput = parseArcDeploymentPlanInput(rawInput, anchors);
    const artifact = (
      options.loadArtifact ?? loadReviewedCovenantVaultArtifact
    )();
    const toolchain = (options.loadToolchain ?? loadDeploymentToolchain)();
    const plan = createArcDeploymentPlan({
      parsedInput,
      anchors,
      artifact,
      toolchain,
    });
    write(`${canonicalDeploymentJson(plan)}\n`);
    return 0;
  } catch {
    return fail();
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = runArcPlan();
}
