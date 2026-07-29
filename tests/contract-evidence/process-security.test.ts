import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  ANVIL_PORT_CANDIDATES,
  assertLocalChain,
  startControlledAnvil,
  type ControlledAnvil,
} from "./anvil-process.js";
import { ContractEvidenceError } from "./errors.js";

describe("controlled Anvil process security", () => {
  let controlled: ControlledAnvil | undefined;

  afterEach(async () => {
    await controlled?.stop();
    controlled = undefined;
  });

  it("starts only on loopback with the exact chain and releases its port", async () => {
    controlled = await startControlledAnvil();
    expect(await controlled.publicClient.getChainId()).toBe(5_042_002);
    const port = controlled.port;
    await controlled.stop();
    controlled = undefined;
    await expect(
      new Promise<void>((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
          server.close(() => {
            resolve();
          });
        });
      }),
    ).resolves.toBeUndefined();
  });

  it("skips an occupied candidate without connecting to its listener", async () => {
    const occupied = createServer();
    await new Promise<void>((resolve, reject) => {
      occupied.once("error", reject);
      occupied.listen(
        {
          host: "127.0.0.1",
          port: ANVIL_PORT_CANDIDATES[0],
          exclusive: true,
        },
        resolve,
      );
    });
    try {
      controlled = await startControlledAnvil();
      expect(controlled.port).not.toBe(ANVIL_PORT_CANDIDATES[0]);
      expect(await controlled.publicClient.getChainId()).toBe(5_042_002);
    } finally {
      await new Promise<void>((resolve) => {
        occupied.close(() => {
          resolve();
        });
      });
    }
  });

  it("cleans up after interruption of only its controlled child", async () => {
    controlled = await startControlledAnvil();
    const port = controlled.port;
    process.kill(controlled.pid);
    await controlled.stop();
    controlled = undefined;
    await expect(
      new Promise<void>((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
          server.close(() => {
            resolve();
          });
        });
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a wrong-chain reader with a fixed sanitized error", async () => {
    await expect(
      assertLocalChain({
        getChainId: () => Promise.resolve(1),
      }),
    ).rejects.toEqual(new ContractEvidenceError("WRONG_CHAIN"));
  });

  it("serializes failures without provider, path, or process detail", () => {
    const serialized = JSON.stringify(
      new ContractEvidenceError("STARTUP_FAILURE"),
    );
    expect(serialized).toBe(
      '{"name":"ContractEvidenceError","code":"STARTUP_FAILURE","message":"Controlled local EVM startup failed"}',
    );
    expect(serialized).not.toMatch(
      /private|signature|calldata|https?:|\\\\|pid|port/i,
    );
  });
});
