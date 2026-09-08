import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDurableCircleOperationRepository,
  installExecutorWorkerShutdownHandlers,
  startExecutorWorker,
  type CircleOperationRepository,
} from "../src/index.js";
import { createExecutorDeploymentService } from "../src/deployment-service-factory.js";

const JOURNAL_NAME = "circle-operations.v1.jsonl";
const AUTH_TOKEN = "worker-secret-".padEnd(32, "x");
const ENV = Object.freeze({
  ARC_RPC_URL: "https://rpc.testnet.arc.network",
  COVENANT_VAULT_ADDRESS: "0x4000000000000000000000000000000000000004",
  CIRCLE_API_KEY: "x",
  CIRCLE_ENTITY_SECRET: "y",
  CIRCLE_WALLET_ID: "11111111-1111-5111-8111-111111111111",
  EXECUTOR_SIGNER_SOURCE: "synthetic-signer-source",
});
const temporaryDirectories = new Set<string>();

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "covenant-shutdown-"));
  temporaryDirectories.add(directory);
  return directory;
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("port allocation failed");
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  return address.port;
}

function deploymentDependencies(circleOperations: CircleOperationRepository) {
  return {
    covenantProvider: { getCovenant: () => Promise.resolve({}) },
    transport: {
      simulate: () => Promise.resolve({ status: "SIMULATED" as const }),
      submit: () =>
        Promise.resolve({
          status: "SUBMITTED" as const,
          transactionId: "synthetic-transaction",
        }),
    },
    circleOperations,
    clock: { now: () => 2_000_000_000n },
    verifyArcChain: vi.fn(() => undefined),
    validateSignerSource: vi.fn(() => undefined),
  };
}

afterEach(async () => {
  for (const directory of temporaryDirectories) {
    await rm(directory, { recursive: true, force: true });
    temporaryDirectories.delete(directory);
  }
});

describe("executor graceful shutdown", () => {
  it("retains the repository close receiver and shares repeated closes", async () => {
    class ReceiverBoundRepository implements CircleOperationRepository {
      #closed = false;
      readonly closeCalls = vi.fn();
      get = () => Promise.resolve(undefined);
      prepare = () => Promise.resolve(undefined);
      markSubmissionAttemptStarted = () => Promise.resolve(undefined);
      recordAccepted = () => Promise.resolve(undefined);
      recordUnknown = () => Promise.resolve(undefined);

      async close(): Promise<void> {
        if (this.#closed) return;
        this.#closed = true;
        this.closeCalls();
        await Promise.resolve();
      }
    }

    const operations = new ReceiverBoundRepository();
    const service = await createExecutorDeploymentService({
      env: ENV,
      dependencies: deploymentDependencies(operations),
    });

    await expect(
      Promise.all([service.close?.(), service.close?.()]),
    ).resolves.toBeDefined();
    expect(operations.closeCalls).toHaveBeenCalledOnce();
  });

  it("holds the journal lock until close and then permits reopening", async () => {
    const directory = await temporaryDirectory();
    const lockPath = join(directory, `${JOURNAL_NAME}.lock`);
    const first = await createDurableCircleOperationRepository({ directory });

    await expect(access(lockPath)).resolves.toBeUndefined();
    await expect(
      createDurableCircleOperationRepository({ directory }),
    ).rejects.toMatchObject({ code: "EXECUTION_REPOSITORY_FAILURE" });

    await first.close();
    await first.close();
    await expect(access(lockPath)).rejects.toMatchObject({ code: "ENOENT" });

    const reopened = await createDurableCircleOperationRepository({
      directory,
    });
    await expect(access(lockPath)).resolves.toBeUndefined();
    await reopened.close();
    await expect(access(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("awaits SIGTERM-style worker shutdown before releasing the lock", async () => {
    const directory = await temporaryDirectory();
    const modulePath = join(directory, "service.mjs");
    const lockPath = join(directory, `${JOURNAL_NAME}.lock`);
    const operations = await createDurableCircleOperationRepository({
      directory,
    });
    const symbolName = `covenant.executor.test.${randomUUID()}`;
    const symbol = Symbol.for(symbolName);
    const service = {
      simulateAuthorizedPayment: () => Promise.resolve({ status: "SIMULATED" }),
      executeAuthorizedPayment: () => Promise.resolve({ status: "SUBMITTED" }),
      close: () => operations.close(),
    };
    Object.defineProperty(globalThis, symbol, {
      configurable: true,
      value: service,
    });
    await writeFile(
      modulePath,
      `export default globalThis[Symbol.for(${JSON.stringify(symbolName)})];\n`,
      "utf8",
    );
    const port = await unusedPort();
    try {
      const running = await startExecutorWorker({
        COVENANT_EXECUTOR_SERVICE_MODULE: modulePath,
        COVENANT_EXECUTOR_WORKER_AUTH_TOKEN: AUTH_TOKEN,
        COVENANT_EXECUTOR_WORKER_HOST: "127.0.0.1",
        COVENANT_EXECUTOR_WORKER_PORT: String(port),
      });
      const signals = new EventEmitter();
      const exited = new Promise<number>((resolve) => {
        installExecutorWorkerShutdownHandlers(running, signals, resolve);
      });

      signals.emit("SIGTERM");
      expect(await exited).toBe(0);
      await expect(access(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(running.close()).resolves.toBeUndefined();
    } finally {
      await operations.close().catch(() => undefined);
      Reflect.deleteProperty(globalThis, symbol);
    }
  });
});
