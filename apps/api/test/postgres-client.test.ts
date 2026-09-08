import pg, { type Pool, type PoolClient } from "pg";
import { PostgresRuntimeStore } from "@covenant/runtime";
import { describe, expect, it, vi } from "vitest";
import { createNodePostgresClient } from "../src/postgres-client.js";

function fakePool(options: { failWork?: boolean; failReady?: boolean } = {}) {
  const calls: string[] = [];
  const release = vi.fn();
  const end = vi.fn(() => Promise.resolve());
  const poolQuery = vi.fn((text: string) => {
    calls.push(text);
    if (options.failReady)
      return Promise.reject(new Error("database unavailable"));
    return Promise.resolve({ rows: [{ ok: 1 }] });
  });
  const checkedOut = {
    query: vi.fn((text: string) => {
      calls.push(text);
      if (options.failWork && text === "work")
        return Promise.reject(new Error("work failed"));
      return Promise.resolve({ rows: [] });
    }),
    release,
  } as unknown as PoolClient;
  const pool = {
    query: poolQuery,
    connect: vi.fn(() => Promise.resolve(checkedOut)),
    end,
  } as unknown as Pool;
  return { pool, calls, release, end, poolQuery };
}

describe("node-postgres runtime client", () => {
  it("awaits work, commits on the checked-out client, then releases it", async () => {
    const fake = fakePool();
    const client = createNodePostgresClient(fake.pool);

    await expect(
      client.transaction(async (transaction) => {
        await transaction.query("work");
        return "committed";
      }),
    ).resolves.toBe("committed");

    expect(fake.calls).toEqual(["BEGIN", "work", "COMMIT"]);
    expect(fake.poolQuery).not.toHaveBeenCalled();
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("rolls back failed work before releasing the checked-out client", async () => {
    const fake = fakePool({ failWork: true });
    const client = createNodePostgresClient(fake.pool);

    await expect(
      client.transaction(async (transaction) => {
        await transaction.query("work");
      }),
    ).rejects.toThrow("work failed");

    expect(fake.calls).toEqual(["BEGIN", "work", "ROLLBACK"]);
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("reports readiness failure and awaits graceful pool shutdown", async () => {
    const fake = fakePool({ failReady: true });
    const store = new PostgresRuntimeStore({
      client: createNodePostgresClient(fake.pool),
    });

    await expect(store.checkReady()).resolves.toBe(false);
    await store.close();
    expect(fake.end).toHaveBeenCalledOnce();
  });
});

const integrationUrl = process.env.COVENANT_TEST_POSTGRES_URL;
describe.skipIf(integrationUrl === undefined)(
  "real PostgreSQL readiness",
  () => {
    it("connects and disconnects through the production pool adapter", async () => {
      const pool = new pg.Pool({ connectionString: integrationUrl });
      const store = new PostgresRuntimeStore({
        client: createNodePostgresClient(pool),
      });
      try {
        await expect(store.checkReady()).resolves.toBe(true);
      } finally {
        await store.close();
      }
    });
  },
);
