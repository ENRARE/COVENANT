import process from "node:process";
import { createDemoRuntimeWithDependencies } from "../../dist/runtime.js";
import { runFrozenComposition } from "../../dist/composition.js";
import { createLocalRuntimeStore } from "../../dist/storage/local-runtime-store.js";
import { createRuntimeMutex } from "../../dist/storage/runtime-mutex.js";

const root = process.argv[2];
const mode = process.argv[3];
const action = process.argv[4];
const now = () => 2_100_000_000n;
const runtimeId =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function send(message) {
  return new Promise((resolve, reject) => {
    process.send?.(message, (error) => (error ? reject(error) : resolve()));
  });
}

function waitFor(type) {
  return new Promise((resolve) => {
    const listener = (message) => {
      if (message?.type === type) {
        process.off("message", listener);
        resolve(message);
      }
    };
    process.on("message", listener);
  });
}

function sanitized(error) {
  return {
    name: error?.name,
    code: error?.code,
    message: error?.message,
  };
}

async function finish(message) {
  await send(message);
  process.disconnect?.();
}

function runtimeWithHooks(testHooks, runComposition = runFrozenComposition) {
  return createDemoRuntimeWithDependencies({
    store: createLocalRuntimeStore({ repositoryRoot: root, testHooks }),
    now,
    createRuntimeId: () => runtimeId,
    runComposition,
  });
}

async function execute(runtime, selectedAction) {
  try {
    const result = await runtime.executeDemoAction(selectedAction);
    await finish({ type: "result", ok: true, result });
  } catch (error) {
    await finish({ type: "result", ok: false, error: sanitized(error) });
  }
}

if (mode === "held-action") {
  const runtime = runtimeWithHooks({
    afterExclusiveLockAcquired: async () => {
      await send({ type: "held" });
      await waitFor("release");
    },
  });
  await execute(runtime, action);
} else if (mode === "barrier-reset") {
  await send({ type: "ready" });
  await waitFor("go");
  const runtime = runtimeWithHooks({
    afterExclusiveLockAcquired: async () => {
      await send({ type: "held" });
      await waitFor("release");
    },
  });
  await execute(runtime, "RESET");
} else if (mode === "action") {
  await execute(runtimeWithHooks(undefined), action);
} else if (mode === "mutex-held") {
  const mutex = createRuntimeMutex({ repositoryRoot: root });
  try {
    const lease = await mutex.acquireExclusive();
    await send({ type: "held" });
    await waitFor("release");
    await lease.release();
    await finish({ type: "result", ok: true });
  } catch (error) {
    await finish({ type: "result", ok: false, error: sanitized(error) });
  }
} else if (mode === "mutex-probe") {
  const mutex = createRuntimeMutex({ repositoryRoot: root });
  try {
    const lease = await mutex.acquireExclusive();
    await lease.release();
    await finish({ type: "result", ok: true });
  } catch (error) {
    await finish({ type: "result", ok: false, error: sanitized(error) });
  }
} else if (mode === "crash-run") {
  const runtime = runtimeWithHooks(undefined, async ({ emit }) => {
    await emit({
      eventType: "INVOICE_RECEIVED",
      scenarioId: "happy-path-v1",
      fields: {
        invoiceId:
          "0x0303030303030303030303030303030303030303030303030303030303030303",
        amount: "1.25",
      },
    });
    await send({ type: "held" });
    await waitFor("release");
  });
  await execute(runtime, "RUN_DEMO");
} else {
  throw new Error("unknown child mode");
}
