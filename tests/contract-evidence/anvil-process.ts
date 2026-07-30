import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { createPublicClient, http, type PublicClient } from "viem";
import {
  ContractEvidenceError,
  evidenceFailure,
  sanitizedEvidenceError,
} from "./errors.js";
import { ANVIL_LOOPBACK_HOST, ANVIL_PORT_CANDIDATES } from "./anvil-ports.mjs";
import { LOCAL_CHAIN_ID, LOCAL_CHAIN_ID_BIGINT } from "./schemas.js";

export { ANVIL_PORT_CANDIDATES } from "./anvil-ports.mjs";
const STARTUP_TIMEOUT_MS = 8_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

export type ControlledAnvil = Readonly<{
  publicClient: PublicClient;
  rpcUrl: string;
  port: number;
  pid: number;
  stop(): Promise<void>;
}>;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => {
      resolve(false);
    });
    server.listen({ host: ANVIL_LOOPBACK_HOST, port, exclusive: true }, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

async function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeout: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, timeout);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function stopChild(
  child: ChildProcessWithoutNullStreams,
  port: number,
): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
    if (!(await waitForExit(child, SHUTDOWN_TIMEOUT_MS))) {
      child.kill("SIGKILL");
      if (!(await waitForExit(child, SHUTDOWN_TIMEOUT_MS))) {
        evidenceFailure("PROCESS_CLEANUP_FAILURE");
      }
    }
  }
  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
  while (!(await portIsFree(port))) {
    if (Date.now() >= deadline) evidenceFailure("PROCESS_CLEANUP_FAILURE");
    await delay(50);
  }
}

function childIsAlive(
  child: ChildProcessWithoutNullStreams,
  spawnState: Readonly<{ failureCode?: "MISSING_TOOL" }>,
): boolean {
  return (
    spawnState.failureCode === undefined &&
    child.exitCode === null &&
    child.signalCode === null
  );
}

async function waitForReady(
  child: ChildProcessWithoutNullStreams,
  publicClient: PublicClient,
  spawnState: Readonly<{ failureCode?: "MISSING_TOOL" }>,
): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (spawnState.failureCode !== undefined) {
      evidenceFailure(spawnState.failureCode);
    }
    if (!childIsAlive(child, spawnState)) {
      evidenceFailure("STARTUP_FAILURE");
    }
    try {
      const chainId = await publicClient.getChainId();
      if (chainId !== LOCAL_CHAIN_ID) evidenceFailure("WRONG_CHAIN");
      await delay(100);
      if (!childIsAlive(child, spawnState)) {
        evidenceFailure("STARTUP_FAILURE");
      }
      return;
    } catch (error) {
      if (error instanceof ContractEvidenceError) throw error;
    }
    await delay(50);
  }
  evidenceFailure("STARTUP_FAILURE");
}

export async function assertLocalChain(
  publicClient: Readonly<{ getChainId(): Promise<number> }>,
): Promise<void> {
  try {
    if ((await publicClient.getChainId()) !== Number(LOCAL_CHAIN_ID_BIGINT)) {
      evidenceFailure("WRONG_CHAIN");
    }
  } catch (error) {
    if (error instanceof ContractEvidenceError) throw error;
    evidenceFailure("WRONG_CHAIN");
  }
}

export async function startControlledAnvil(): Promise<ControlledAnvil> {
  let lastStartupError: ContractEvidenceError | undefined;
  for (const port of ANVIL_PORT_CANDIDATES) {
    if (!(await portIsFree(port))) continue;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(
        "anvil",
        [
          "--host",
          ANVIL_LOOPBACK_HOST,
          "--port",
          String(port),
          "--chain-id",
          String(LOCAL_CHAIN_ID),
          "--silent",
        ],
        {
          cwd: process.cwd(),
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    } catch {
      evidenceFailure("MISSING_TOOL");
    }
    const rpcUrl = `http://${ANVIL_LOOPBACK_HOST}:${String(port)}`;
    const publicClient = createPublicClient({ transport: http(rpcUrl) });
    const spawnState: { failureCode?: "MISSING_TOOL" } = {};
    child.once("error", () => {
      spawnState.failureCode = "MISSING_TOOL";
    });
    try {
      await waitForReady(child, publicClient, spawnState);
      if (child.pid === undefined) evidenceFailure("STARTUP_FAILURE");
      return Object.freeze({
        publicClient,
        rpcUrl,
        port,
        pid: child.pid,
        stop: () => stopChild(child, port),
      });
    } catch (error) {
      try {
        await stopChild(child, port);
      } catch {
        throw new ContractEvidenceError("PROCESS_CLEANUP_FAILURE");
      }
      if (error instanceof ContractEvidenceError) {
        if (error.code === "MISSING_TOOL" || error.code === "WRONG_CHAIN") {
          throw sanitizedEvidenceError(error);
        }
        lastStartupError = sanitizedEvidenceError(error);
      }
    }
  }
  if (lastStartupError !== undefined) throw lastStartupError;
  evidenceFailure("PORT_EXHAUSTION");
}
