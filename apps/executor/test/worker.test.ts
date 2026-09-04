import { afterEach, describe, expect, it } from "vitest";
import { createExecutorWorkerServer } from "../src/index.js";
import { createTestHarness } from "./fixtures.js";

const AUTH = "worker-secret-".padEnd(32, "x");
const servers: ReturnType<typeof createExecutorWorkerServer>[] = [];

afterEach(() => {
  for (const server of servers) server.close();
  servers.length = 0;
});

describe("isolated executor worker boundary", () => {
  it("rejects anonymous and unknown requests", async () => {
    const harness = await createTestHarness();
    const server = createExecutorWorkerServer({
      service: harness.service,
      authToken: AUTH,
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("worker did not bind");
    const anonymous = await fetch(
      `http://127.0.0.1:${String(address.port)}/execute-authorized-payment`,
      { method: "POST" },
    );
    expect(anonymous.status).toBe(401);
    const unknown = await fetch(
      `http://127.0.0.1:${String(address.port)}/admin`,
      { headers: { "x-covenant-worker-auth": AUTH } },
    );
    expect(unknown.status).toBe(404);
  });

  it("forwards only reviewed routes and does not submit twice for one identity", async () => {
    const harness = await createTestHarness();
    const execution = await harness.service.prepareExecution(harness.request);
    const server = createExecutorWorkerServer({
      service: harness.service,
      authToken: AUTH,
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("worker did not bind");
    const request = { ...harness.request, executionId: execution.executionId };
    const url = `http://127.0.0.1:${String(address.port)}/execute-authorized-payment`;
    const [first, second] = await Promise.all([
      fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-covenant-worker-auth": AUTH,
        },
        body: JSON.stringify(request),
      }),
      fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-covenant-worker-auth": AUTH,
        },
        body: JSON.stringify(request),
      }),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "SUBMITTED" });
    expect(await second.json()).toMatchObject({ status: "SUBMITTED" });
    expect(harness.transportState.submissions).toHaveLength(1);
  });
});
