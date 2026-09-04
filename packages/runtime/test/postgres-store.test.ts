import {
  createCovenant,
  PLATFORM_V1_ASSET,
  PLATFORM_V1_NETWORK,
} from "@covenant/core";
import { describe, expect, it } from "vitest";
import {
  PostgresRuntimeStore,
  type PostgresQueryClient,
} from "../src/index.js";

const projectId = `0x${"a1".repeat(32)}`;
const covenantId = `0x${"b2".repeat(32)}`;

function resource() {
  return createCovenant({
    version: "2",
    id: covenantId,
    projectId,
    payer: "0x1000000000000000000000000000000000000001",
    beneficiary: "0x2000000000000000000000000000000000000002",
    asset: PLATFORM_V1_ASSET,
    amount: "1",
    network: PLATFORM_V1_NETWORK,
    conditions: { policyHash: `0x${"c3".repeat(32)}`, policyVersion: "v1" },
    createdAt: "100",
    expiresAt: "1000",
  });
}

function client(): { client: PostgresQueryClient; sql: string[] } {
  let stored: Record<string, unknown> | undefined;
  const sql: string[] = [];
  const value: PostgresQueryClient = {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    query<Row extends Record<string, unknown>>(
      text: string,
      values: readonly unknown[] = [],
    ) {
      sql.push(text);
      if (text.startsWith("select 1"))
        return { rows: [{ ok: 1 }] as unknown as Row[] };
      if (text.startsWith("insert into public.covenants")) {
        stored = {
          project_id: values[0],
          covenant_id: values[1],
          resource: JSON.parse(String(values[2])),
          created_at: values[3],
          updated_at: values[3],
        };
        return { rows: [] as Row[] };
      }
      if (text.includes("from public.covenants"))
        return {
          rows: (stored !== undefined && stored.project_id === values[0]
            ? [stored]
            : []) as Row[],
        };
      return { rows: [] as Row[] };
    },
    transaction(work) {
      return work(value);
    },
  };
  return { client: value, sql };
}

describe("PostgresRuntimeStore", () => {
  it("uses the canonical PostgreSQL projection and transaction boundary", () => {
    const recorded = client();
    const store = new PostgresRuntimeStore({ client: recorded.client });
    expect(store.checkReady()).toBe(true);
    const saved = store.saveCovenant(projectId, resource(), 200);
    expect(saved.resource.id).toBe(covenantId);
    expect(store.getCovenant(projectId, covenantId)?.resource.id).toBe(
      covenantId,
    );
    expect(
      store.getCovenant(`0x${"d4".repeat(32)}`, covenantId),
    ).toBeUndefined();
    expect(
      recorded.sql.some((query) => query.includes("to_timestamp($4/1000.0)")),
    ).toBe(true);
    expect(recorded.sql.every((query) => !query.includes("${projectId}"))).toBe(
      true,
    );
  });
});
