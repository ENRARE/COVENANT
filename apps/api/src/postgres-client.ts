/* eslint-disable @typescript-eslint/no-unnecessary-type-parameters -- PostgresQueryClient requires a caller-selected row type. */
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { PostgresQueryClient } from "@covenant/runtime";

function checkedOutClient(client: PoolClient): PostgresQueryClient {
  return {
    query: async <
      Row extends Record<string, unknown> = Record<string, unknown>,
    >(
      text: string,
      values?: readonly unknown[],
    ) => {
      const result = await client.query<Row & QueryResultRow>(
        text,
        values === undefined ? undefined : [...values],
      );
      return { rows: result.rows };
    },
    transaction: <T>(): Promise<T> =>
      Promise.reject(
        new Error("Nested PostgreSQL transactions are not supported."),
      ),
  };
}

/** Adapt a node-postgres pool to the runtime's explicit transaction boundary. */
export function createNodePostgresClient(pool: Pool): PostgresQueryClient {
  return {
    query: async <
      Row extends Record<string, unknown> = Record<string, unknown>,
    >(
      text: string,
      values?: readonly unknown[],
    ) => {
      const result = await pool.query<Row & QueryResultRow>(
        text,
        values === undefined ? undefined : [...values],
      );
      return { rows: result.rows };
    },
    transaction: async <T>(
      work: (client: PostgresQueryClient) => Promise<T>,
    ): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work(checkedOutClient(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The original failure is safer to expose than driver diagnostics,
          // which may contain connection details.
        }
        throw error;
      } finally {
        client.release();
      }
    },
    close: async () => {
      await pool.end();
    },
  };
}
