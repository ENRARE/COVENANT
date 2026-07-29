import { fork, type ChildProcess } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalRuntimeStore } from "../src/storage/local-runtime-store.js";
import { createTestRoot, createTestRuntime } from "./helpers.js";

const childPath = join(import.meta.dirname, "fixtures", "locking-child.mjs");
const children = new Set<ChildProcess>();

type ChildMessage =
  | { type: "ready" }
  | { type: "held" }
  | {
      type: "result";
      ok: boolean;
      result?: { status?: string };
      error?: { name?: string; code?: string; message?: string };
    };

function spawnChild(root: string, mode: string, action?: string): ChildProcess {
  const child = fork(
    childPath,
    [root, mode, ...(action === undefined ? [] : [action])],
    {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function waitForMessage(
  child: ChildProcess,
  accepted: readonly ChildMessage["type"][],
): Promise<ChildMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: ChildMessage) => {
      if (!accepted.includes(message.type)) return;
      cleanup();
      resolve(message);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`child exited before IPC message: ${String(code)}`));
    };
    const cleanup = () => {
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    child.on("message", onMessage);
    child.on("exit", onExit);
  });
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
}

async function release(child: ChildProcess): Promise<ChildMessage> {
  const result = waitForMessage(child, ["result"]);
  child.send({ type: "release" });
  const message = await result;
  await waitForExit(child);
  return message;
}

function expectLockBusy(message: ChildMessage): void {
  expect(message).toMatchObject({
    type: "result",
    ok: false,
    error: {
      name: "DemoError",
      code: "LOCK_BUSY",
      message: "Demo runtime is busy",
    },
  });
}

afterEach(async () => {
  const active = [...children];
  for (const child of active) child.kill();
  await Promise.all(active.map(waitForExit));
});

describe("descriptor-bound runtime mutex", () => {
  it("serializes reset versus reset without changing the sentinel", async () => {
    const fixture = await createTestRoot();
    try {
      const runtime = createTestRuntime(fixture.root);
      await runtime.executeDemoAction("SEED");
      const sentinel = join(fixture.root, ".covenant-demo.lock");
      const journal = join(
        fixture.root,
        ".covenant-demo-state",
        "events.v1.jsonl",
      );
      const beforeIdentity = await lstat(sentinel, { bigint: true });
      const beforeJournal = await readFile(journal, "utf8");

      const owner = spawnChild(fixture.root, "held-action", "RESET");
      await waitForMessage(owner, ["held"]);
      const loser = spawnChild(fixture.root, "action", "RESET");
      const loserResult = await waitForMessage(loser, ["result"]);
      expectLockBusy(loserResult);
      await waitForExit(loser);
      expect(await readFile(journal, "utf8")).toBe(beforeJournal);

      expect(await release(owner)).toMatchObject({
        type: "result",
        ok: true,
        result: { status: "UNINITIALIZED" },
      });
      await expect(
        lstat(join(fixture.root, ".covenant-demo-state")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      const afterIdentity = await lstat(sentinel, { bigint: true });
      expect(afterIdentity.isFile()).toBe(true);
      expect([afterIdentity.dev, afterIdentity.ino]).toEqual([
        beforeIdentity.dev,
        beforeIdentity.ino,
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("serializes reset versus seed across processes", async () => {
    const fixture = await createTestRoot();
    try {
      const runtime = createTestRuntime(fixture.root);
      await runtime.executeDemoAction("SEED");
      const owner = spawnChild(fixture.root, "held-action", "RESET");
      await waitForMessage(owner, ["held"]);
      const seed = spawnChild(fixture.root, "action", "SEED");
      expectLockBusy(await waitForMessage(seed, ["result"]));
      await waitForExit(seed);
      await release(owner);
      expect((await runtime.executeDemoAction("GET_STATE")).timeline).toEqual(
        [],
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("blocks reset and state reads while a run owns the descriptor", async () => {
    const fixture = await createTestRoot();
    try {
      const runtime = createTestRuntime(fixture.root);
      await runtime.executeDemoAction("SEED");
      const journal = join(
        fixture.root,
        ".covenant-demo-state",
        "events.v1.jsonl",
      );
      const before = await readFile(journal, "utf8");
      const run = spawnChild(fixture.root, "held-action", "RUN_DEMO");
      await waitForMessage(run, ["held"]);
      await expect(runtime.executeDemoAction("RESET")).rejects.toMatchObject({
        code: "LOCK_BUSY",
      });
      await expect(
        runtime.executeDemoAction("GET_STATE"),
      ).rejects.toMatchObject({ code: "LOCK_BUSY" });
      expect(await readFile(journal, "utf8")).toBe(before);
      expect(await release(run)).toMatchObject({
        type: "result",
        ok: true,
        result: { status: "COMPLETED" },
      });
    } finally {
      await fixture.cleanup();
    }
  });

  it("grants exactly one simultaneous reset acquisition", async () => {
    const fixture = await createTestRoot();
    try {
      const runtime = createTestRuntime(fixture.root);
      await runtime.executeDemoAction("SEED");
      const sentinel = join(fixture.root, ".covenant-demo.lock");
      const identity = await lstat(sentinel, { bigint: true });
      const journal = join(
        fixture.root,
        ".covenant-demo-state",
        "events.v1.jsonl",
      );
      const before = await readFile(journal, "utf8");
      const left = spawnChild(fixture.root, "barrier-reset");
      const right = spawnChild(fixture.root, "barrier-reset");
      await Promise.all([
        waitForMessage(left, ["ready"]),
        waitForMessage(right, ["ready"]),
      ]);
      const leftOutcome = waitForMessage(left, ["held", "result"]);
      const rightOutcome = waitForMessage(right, ["held", "result"]);
      left.send({ type: "go" });
      right.send({ type: "go" });
      const outcomes = await Promise.all([leftOutcome, rightOutcome]);
      const winnerIndex = outcomes.findIndex(
        (message) => message.type === "held",
      );
      expect(winnerIndex).not.toBe(-1);
      const loserIndex = winnerIndex === 0 ? 1 : 0;
      expectLockBusy(outcomes[loserIndex]);
      expect(await readFile(journal, "utf8")).toBe(before);
      const winner = winnerIndex === 0 ? left : right;
      const loser = loserIndex === 0 ? left : right;
      await waitForExit(loser);
      await release(winner);
      const finalIdentity = await lstat(sentinel, { bigint: true });
      expect([finalIdentity.dev, finalIdentity.ino]).toEqual([
        identity.dev,
        identity.ino,
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it("allows acquisition only after descriptor-bound owner release", async () => {
    const fixture = await createTestRoot();
    try {
      const owner = spawnChild(fixture.root, "mutex-held");
      await waitForMessage(owner, ["held"]);
      const blocked = spawnChild(fixture.root, "mutex-probe");
      expectLockBusy(await waitForMessage(blocked, ["result"]));
      await waitForExit(blocked);
      await release(owner);
      const acquired = spawnChild(fixture.root, "mutex-probe");
      expect(await waitForMessage(acquired, ["result"])).toMatchObject({
        type: "result",
        ok: true,
      });
      await waitForExit(acquired);
    } finally {
      await fixture.cleanup();
    }
  });

  it("releases ownership on process crash and resets interrupted state", async () => {
    const fixture = await createTestRoot();
    try {
      const runtime = createTestRuntime(fixture.root);
      await runtime.executeDemoAction("SEED");
      const crashed = spawnChild(fixture.root, "crash-run");
      await waitForMessage(crashed, ["held"]);
      expect((await runtime.executeDemoAction("GET_HEALTH")).health.lock).toBe(
        "BUSY",
      );
      await expect(runtime.executeDemoAction("RESET")).rejects.toMatchObject({
        code: "LOCK_BUSY",
      });
      crashed.kill();
      await waitForExit(crashed);
      const interrupted = await runtime.executeDemoAction("GET_STATE");
      expect(interrupted.status).toBe("INTERRUPTED");
      expect(interrupted.health.lock).toBe("AVAILABLE");
      expect((await runtime.executeDemoAction("RESET")).status).toBe(
        "UNINITIALIZED",
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("reports only BUSY or AVAILABLE from descriptor ownership", async () => {
    const fixture = await createTestRoot();
    try {
      const runtime = createTestRuntime(fixture.root);
      const owner = spawnChild(fixture.root, "mutex-held");
      await waitForMessage(owner, ["held"]);
      expect((await runtime.executeDemoAction("GET_HEALTH")).health.lock).toBe(
        "BUSY",
      );
      await release(owner);
      expect((await runtime.executeDemoAction("GET_HEALTH")).health.lock).toBe(
        "AVAILABLE",
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it("fails closed for unsafe sentinels and opened-handle mismatch", async () => {
    const linked = await createTestRoot();
    const target = await createTestRoot();
    try {
      await symlink(
        target.root,
        join(linked.root, ".covenant-demo.lock"),
        "junction",
      );
      await expect(
        createTestRuntime(linked.root).executeDemoAction("GET_STATE"),
      ).rejects.toMatchObject({ code: "UNSAFE_STORAGE" });
    } finally {
      await linked.cleanup();
      await target.cleanup();
    }

    const directory = await createTestRoot();
    try {
      await mkdir(join(directory.root, ".covenant-demo.lock"));
      await expect(
        createTestRuntime(directory.root).executeDemoAction("GET_STATE"),
      ).rejects.toMatchObject({ code: "UNSAFE_STORAGE" });
    } finally {
      await directory.cleanup();
    }

    const mismatch = await createTestRoot();
    try {
      const sentinel = join(mismatch.root, ".covenant-demo.lock");
      const displaced = join(mismatch.root, ".covenant-demo.lock.displaced");
      await writeFile(sentinel, "", "utf8");
      const store = createLocalRuntimeStore({
        repositoryRoot: mismatch.root,
        testHooks: {
          afterSentinelOpened: async () => {
            await rename(sentinel, displaced);
            await writeFile(sentinel, "replacement", "utf8");
          },
        },
      });
      await expect(store.read()).rejects.toMatchObject({
        code: "UNSAFE_STORAGE",
      });
      expect(await readFile(sentinel, "utf8")).toBe("replacement");
    } finally {
      await mismatch.cleanup();
    }
  });
});
