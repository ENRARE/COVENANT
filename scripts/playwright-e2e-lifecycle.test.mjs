import assert from "node:assert/strict";
import test from "node:test";
import {
  ORIGIN_OCCUPIED_ERROR,
  SERVER_STARTUP_ERROR,
  isCollectionOnly,
  runE2eLifecycle,
} from "./playwright-e2e-lifecycle.mjs";

function completedHandle(name, code = 0) {
  return {
    name,
    settled: true,
    completion: Promise.resolve({ code, signal: null }),
  };
}

function createRuntime(overrides = {}) {
  const calls = [];
  const listeners = new Map();
  const runtime = {
    addSignalListener: (signal, handler) => {
      listeners.set(signal, handler);
    },
    build: () => {
      calls.push("build");
      return completedHandle("build");
    },
    isOriginOccupied: async () => false,
    log: (message) => calls.push(message),
    preflight: () => true,
    removeSignalListener: (signal, handler) => {
      if (listeners.get(signal) === handler) listeners.delete(signal);
    },
    startPlaywright: () => {
      calls.push("start-playwright");
      return completedHandle("playwright");
    },
    startServer: () => {
      calls.push("start-server");
      return completedHandle("server");
    },
    stop: async (handle) => {
      calls.push(`stop-${handle.name}`);
    },
    verifyOriginReleased: async () => true,
    waitForReadiness: async () => undefined,
    ...overrides,
  };
  return { calls, listeners, runtime };
}

test("detects collection-only Playwright arguments", () => {
  assert.equal(isCollectionOnly(["--list"]), true);
  assert.equal(isCollectionOnly(["--help"]), true);
  assert.equal(isCollectionOnly(["-h"]), true);
  assert.equal(isCollectionOnly(["--version"]), true);
  assert.equal(isCollectionOnly(["--project=chromium-desktop"]), false);
  assert.equal(isCollectionOnly(["--grep", "claim boundary"]), false);
});

test("collection-only execution skips origin, build, and server", async () => {
  const { calls, runtime } = createRuntime();
  assert.equal(await runE2eLifecycle(["--", "--list"], runtime), 0);
  assert.equal(calls.includes("build"), false);
  assert.equal(calls.includes("start-server"), false);
  assert.equal(calls.includes("start-playwright"), true);
});

test("maps an occupied fixed origin to one actionable error", async () => {
  const { runtime } = createRuntime({
    isOriginOccupied: async () => true,
  });
  await assert.rejects(
    runE2eLifecycle([], runtime),
    new Error(ORIGIN_OCCUPIED_ERROR),
  );
});

test("propagates a production build failure", async () => {
  const { runtime } = createRuntime({
    build: () => completedHandle("build", 7),
  });
  assert.equal(await runE2eLifecycle([], runtime), 7);
});

test("fails when the server exits before readiness", async () => {
  const { runtime } = createRuntime({
    waitForReadiness: async () => {
      throw new Error(SERVER_STARTUP_ERROR);
    },
  });
  await assert.rejects(
    runE2eLifecycle([], runtime),
    new Error(SERVER_STARTUP_ERROR),
  );
});

test("propagates the Playwright exit code", async () => {
  const { runtime } = createRuntime({
    startPlaywright: () => completedHandle("playwright", 9),
  });
  assert.equal(await runE2eLifecycle([], runtime), 9);
});

test("cleanup runs after Playwright success", async () => {
  const { calls, runtime } = createRuntime();
  assert.equal(await runE2eLifecycle([], runtime), 0);
  assert.deepEqual(
    calls.filter((call) => call.startsWith("stop-")),
    ["stop-playwright", "stop-server"],
  );
});

test("cleanup runs after Playwright failure", async () => {
  const { calls, runtime } = createRuntime({
    startPlaywright: () => completedHandle("playwright", 3),
  });
  assert.equal(await runE2eLifecycle([], runtime), 3);
  assert.equal(calls.includes("stop-server"), true);
});

test("cleanup runs after Playwright spawn failure", async () => {
  const { calls, runtime } = createRuntime({
    startPlaywright: () => {
      throw new Error("injected spawn failure");
    },
  });
  await assert.rejects(runE2eLifecycle([], runtime), /injected spawn failure/u);
  assert.equal(calls.includes("stop-server"), true);
});

test("signal cleanup is idempotent and stops only owned handles", async () => {
  let resolvePlaywright;
  const playwright = {
    name: "playwright",
    settled: false,
    completion: new Promise((resolveCompletion) => {
      resolvePlaywright = resolveCompletion;
    }),
  };
  const { calls, listeners, runtime } = createRuntime({
    startPlaywright: () => playwright,
    stop: async (handle) => {
      calls.push(`stop-${handle.name}`);
      if (handle === playwright && !handle.settled) {
        handle.settled = true;
        resolvePlaywright({ code: null, signal: "SIGTERM" });
      }
    },
  });
  const execution = runE2eLifecycle([], runtime);
  while (!calls.includes("e2e-runner: Playwright started")) {
    await Promise.resolve();
  }
  listeners.get("SIGTERM")();
  listeners.get("SIGTERM")();
  assert.equal(await execution, 1);
  assert.deepEqual(
    calls.filter((call) => call.startsWith("stop-")),
    ["stop-playwright", "stop-server"],
  );
});

test("normal completion removes all signal listeners", async () => {
  const { listeners, runtime } = createRuntime();
  assert.equal(await runE2eLifecycle([], runtime), 0);
  assert.equal(listeners.size, 0);
});
