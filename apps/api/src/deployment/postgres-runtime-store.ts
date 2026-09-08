import pg from "pg";
import { PostgresRuntimeStore, type RuntimeStore } from "@covenant/runtime";
import { createNodePostgresClient } from "../postgres-client.js";

const databaseUrl = process.env.COVENANT_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("COVENANT_DATABASE_URL is required.");

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 10,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});

// node-postgres requires an error listener for failures on idle clients. The
// API readiness probe performs the observable health check; credentials and
// raw driver diagnostics are deliberately never logged here.
pool.on("error", () => undefined);

const store: RuntimeStore = new PostgresRuntimeStore({
  client: createNodePostgresClient(pool),
});

export default store;
