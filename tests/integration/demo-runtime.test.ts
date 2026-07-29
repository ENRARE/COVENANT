import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditEventSchema,
  createDemoRuntime,
  runtimeProjectionSchema,
} from "@covenant/demo";
import { describe, expect, it } from "vitest";

describe("COV-007 built demo package integration", () => {
  it("loads the built package and completes one sanitized replayable demo", async () => {
    const originalDirectory = process.cwd();
    const root = await mkdtemp(join(tmpdir(), "covenant-demo-integration-"));
    try {
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ name: "covenant", private: true }),
        "utf8",
      );
      await writeFile(
        join(root, "pnpm-workspace.yaml"),
        "packages: []\n",
        "utf8",
      );
      process.chdir(root);
      const runtime = createDemoRuntime();
      const executeDemoAction = runtime.executeDemoAction.bind(runtime);
      await expect(
        Reflect.apply(executeDemoAction, undefined, ["GET_STATE", {}]),
      ).rejects.toMatchObject({
        name: "DemoError",
        code: "MALFORMED_ACTION",
        message: "Demo action is malformed",
      });
      const seeded = await runtime.executeDemoAction("SEED");
      expect(runtimeProjectionSchema.parse(seeded).status).toBe("SEEDED");
      const completed = await runtime.executeDemoAction("RUN_DEMO");
      expect(runtimeProjectionSchema.parse(completed).status).toBe("COMPLETED");
      expect(completed.timeline).toHaveLength(17);
      for (const event of completed.timeline) auditEventSchema.parse(event);
      const serialized = JSON.stringify(completed);
      expect(serialized).not.toMatch(
        /"(signature|typedData|calldata|privateKey|transactionHash|settlement|finality)"\s*:/i,
      );
      const journal = join(root, ".covenant-demo-state", "events.v1.jsonl");
      const beforeReplay = await readFile(journal, "utf8");
      const replayed = await runtime.executeDemoAction("RUN_DEMO");
      expect(replayed).toEqual(completed);
      expect(await readFile(journal, "utf8")).toBe(beforeReplay);
      await runtime.executeDemoAction("RESET");
    } finally {
      process.chdir(originalDirectory);
      await rm(root, { recursive: true, force: true });
    }
  });
});
