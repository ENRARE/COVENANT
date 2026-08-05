import { spawn } from "node:child_process";
import { request } from "node:http";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { runChromiumPreflight } from "./playwright-browser-preflight.mjs";
import { normalizeForwardedArguments } from "./playwright-arguments.mjs";
import { runLocalPlaywright } from "./playwright-local-cli.mjs";
import {
  NEXT_BUILD_ARGUMENTS,
  NEXT_START_ARGUMENTS,
  nextEnvironment,
  resolveLocalNextCli,
} from "./playwright-next-command.mjs";

export const TEST_ORIGIN = "http://127.0.0.1:3100";
export const ORIGIN_OCCUPIED_ERROR =
  "COV-016 E2E origin is already in use. Stop the process listening on http://127.0.0.1:3100 and retry.";
export const SERVER_STARTUP_ERROR =
  "COV-016 E2E production server did not become ready at http://127.0.0.1:3100.";
export const SERVER_CLEANUP_ERROR =
  "COV-016 E2E production server cleanup failed.";

const collectionOnlyArguments = new Set([
  "--list",
  "--help",
  "-h",
  "--version",
]);

export function isCollectionOnly(arguments_) {
  return arguments_.some((argument) => collectionOnlyArguments.has(argument));
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds);
  });
}

export function probeFixedOriginConnection(options = {}) {
  const connect = options.connect ?? createConnection;
  const timeout = options.timeout ?? 500;
  return new Promise((resolveProbe) => {
    const socket = connect({ host: "127.0.0.1", port: 3100 });
    let complete = false;
    const finish = (occupied) => {
      if (complete) return;
      complete = true;
      socket.destroy();
      resolveProbe(occupied);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeout, () => finish(false));
  });
}

export function probeRootResponse(options = {}) {
  const makeRequest = options.request ?? request;
  const timeout = options.timeout ?? 1_000;
  return new Promise((resolveProbe) => {
    const outgoing = makeRequest(
      {
        hostname: "127.0.0.1",
        method: "GET",
        path: "/",
        port: 3100,
        protocol: "http:",
      },
      (response) => {
        response.resume();
        resolveProbe(response.statusCode === 200);
      },
    );
    outgoing.once("error", () => resolveProbe(false));
    outgoing.setTimeout(timeout, () => {
      outgoing.destroy();
      resolveProbe(false);
    });
    outgoing.end();
  });
}

export async function waitForServerReadiness(server, options = {}) {
  const probe = options.probe ?? probeRootResponse;
  const interval = options.interval ?? 250;
  const timeout = options.timeout ?? 120_000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (server.settled) throw new Error(SERVER_STARTUP_ERROR);
    if (await probe()) return;
    await delay(interval);
  }
  throw new Error(SERVER_STARTUP_ERROR);
}

export function createOwnedProcess(executable, arguments_, options) {
  const child = spawn(executable, arguments_, {
    ...options,
    detached: false,
    shell: false,
  });
  const owned = {
    child,
    settled: false,
    completion: undefined,
    stopPromise: undefined,
  };
  owned.completion = new Promise((resolveCompletion, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      owned.settled = true;
      resolveCompletion({ code, signal });
    });
  });
  return owned;
}

export function stopOwnedProcess(owned, options = {}) {
  if (owned.stopPromise !== undefined) return owned.stopPromise;
  const grace = options.grace ?? 5_000;
  const fallback = options.fallback ?? 2_000;
  owned.stopPromise = (async () => {
    if (owned.settled) return;
    owned.child.kill("SIGTERM");
    const closedDuringGrace = await Promise.race([
      owned.completion.then(() => true),
      delay(grace).then(() => false),
    ]);
    if (closedDuringGrace) return;
    owned.child.kill("SIGKILL");
    const closedAfterKill = await Promise.race([
      owned.completion.then(() => true),
      delay(fallback).then(() => false),
    ]);
    if (!closedAfterKill) throw new Error(SERVER_CLEANUP_ERROR);
  })();
  return owned.stopPromise;
}

function resultExitCode(result) {
  return result.code ?? 1;
}

export function createDefaultLifecycleRuntime() {
  const webRoot = resolve(import.meta.dirname, "../apps/web");
  const nextCli = resolveLocalNextCli(webRoot);
  const environment = nextEnvironment(process.env);
  return {
    addSignalListener: (signal, handler) => process.once(signal, handler),
    build: () =>
      createOwnedProcess(process.execPath, [nextCli, ...NEXT_BUILD_ARGUMENTS], {
        cwd: webRoot,
        env: environment,
        stdio: "inherit",
      }),
    isOriginOccupied: () => probeFixedOriginConnection(),
    log: (message) => console.error(message),
    preflight: () => runChromiumPreflight(),
    removeSignalListener: (signal, handler) =>
      process.removeListener(signal, handler),
    startPlaywright: (arguments_) => {
      const child = runLocalPlaywright(["test", ...arguments_], {
        environment: { NEXT_TELEMETRY_DISABLED: "1" },
      });
      const owned = {
        child,
        settled: false,
        completion: undefined,
        stopPromise: undefined,
      };
      owned.completion = new Promise((resolveCompletion, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => {
          owned.settled = true;
          resolveCompletion({ code, signal });
        });
      });
      return owned;
    },
    startServer: () =>
      createOwnedProcess(process.execPath, [nextCli, ...NEXT_START_ARGUMENTS], {
        cwd: webRoot,
        env: environment,
        stdio: "inherit",
      }),
    stop: (owned) => stopOwnedProcess(owned),
    verifyOriginReleased: async () => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        if (!(await probeFixedOriginConnection())) return true;
        await delay(100);
      }
      return false;
    },
    waitForReadiness: (server) => waitForServerReadiness(server),
  };
}

export async function runE2eLifecycle(rawArguments, runtime) {
  const arguments_ = normalizeForwardedArguments(rawArguments);
  runtime.log("e2e-runner: preflight start");
  if (!runtime.preflight()) return 1;
  runtime.log("e2e-runner: preflight passed");

  let build;
  let server;
  let playwright;
  let cleanupPromise;
  let interrupted = false;

  const cleanup = () => {
    cleanupPromise ??= (async () => {
      if (playwright !== undefined) await runtime.stop(playwright);
      if (server !== undefined) {
        await runtime.stop(server);
        if (!(await runtime.verifyOriginReleased())) {
          throw new Error(SERVER_CLEANUP_ERROR);
        }
        runtime.log("e2e-runner: production server stopped");
      }
      if (build !== undefined) await runtime.stop(build);
    })();
    return cleanupPromise;
  };

  const handleSignal = () => {
    if (interrupted) return;
    interrupted = true;
    cleanup().catch(() => undefined);
  };
  runtime.addSignalListener("SIGINT", handleSignal);
  runtime.addSignalListener("SIGTERM", handleSignal);

  try {
    if (isCollectionOnly(arguments_)) {
      runtime.log("e2e-runner: collection-only invocation");
      playwright = runtime.startPlaywright(arguments_);
      const result = await playwright.completion;
      runtime.log("e2e-runner: Playwright completed");
      return interrupted ? 1 : resultExitCode(result);
    }

    if (await runtime.isOriginOccupied())
      throw new Error(ORIGIN_OCCUPIED_ERROR);
    build = runtime.build();
    runtime.log("e2e-runner: production build started");
    const buildResult = await build.completion;
    runtime.log("e2e-runner: production build completed");
    if (buildResult.code !== 0) return resultExitCode(buildResult);
    build = undefined;

    server = runtime.startServer();
    runtime.log("e2e-runner: production server started");
    await runtime.waitForReadiness(server);
    runtime.log("e2e-runner: production server ready");

    playwright = runtime.startPlaywright(arguments_);
    runtime.log("e2e-runner: Playwright started");
    const result = await playwright.completion;
    runtime.log("e2e-runner: Playwright completed");
    return interrupted ? 1 : resultExitCode(result);
  } finally {
    await cleanup();
    runtime.removeSignalListener("SIGINT", handleSignal);
    runtime.removeSignalListener("SIGTERM", handleSignal);
    runtime.log("e2e-runner: cleanup complete");
  }
}
