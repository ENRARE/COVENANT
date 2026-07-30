import { createServer } from "node:net";
import {
  ANVIL_LOOPBACK_HOST,
  ANVIL_PORT_CANDIDATES,
} from "../tests/contract-evidence/anvil-ports.mjs";

const DEFAULT_PROBE_TIMEOUT_MS = 1_000;
const DEFAULT_RELEASE_TIMEOUT_MS = 5_000;
const RELEASE_RETRY_DELAY_MS = 50;

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function closeProbe(server) {
  if (!server.listening) return;
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

export async function candidatePortIsBindable(
  port,
  { probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS } = {},
) {
  if (!ANVIL_PORT_CANDIDATES.includes(port)) {
    throw new Error("Port is outside the contract-evidence candidate set");
  }

  const server = createServer();
  server.unref();
  const controller = new AbortController();
  let timeout;
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback(value);
      };

      timeout = setTimeout(() => {
        settle(reject, new Error("Loopback port probe timed out"));
      }, probeTimeoutMs);
      server.once("error", (error) => {
        if (error?.code === "EADDRINUSE") {
          settle(resolve, false);
        } else {
          settle(reject, error);
        }
      });
      server.listen(
        {
          host: ANVIL_LOOPBACK_HOST,
          port,
          exclusive: true,
          signal: controller.signal,
        },
        () => {
          settle(resolve, true);
        },
      );
    });
  } finally {
    clearTimeout(timeout);
    controller.abort();
    await closeProbe(server);
  }
}

export async function availableAnvilCandidatePorts() {
  const available = [];
  for (const port of ANVIL_PORT_CANDIDATES) {
    if (await candidatePortIsBindable(port)) available.push(port);
  }
  return available;
}

export async function assertAnvilCandidatePortsReleased(
  previouslyAvailablePorts,
  { releaseTimeoutMs = DEFAULT_RELEASE_TIMEOUT_MS } = {},
) {
  for (const port of previouslyAvailablePorts) {
    if (!ANVIL_PORT_CANDIDATES.includes(port)) {
      throw new Error("Port is outside the contract-evidence candidate set");
    }
  }

  const deadline = Date.now() + releaseTimeoutMs;
  let unavailable = [];
  do {
    unavailable = [];
    for (const port of previouslyAvailablePorts) {
      if (!(await candidatePortIsBindable(port))) unavailable.push(port);
    }
    if (unavailable.length === 0) return;
    if (Date.now() >= deadline) break;
    await delay(RELEASE_RETRY_DELAY_MS);
  } while (Date.now() < deadline);

  throw new Error("Contract-evidence command left a candidate port occupied");
}
