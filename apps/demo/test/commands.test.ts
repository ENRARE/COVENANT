import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestRoot } from "./helpers.js";

function runCli(
  root: string,
  action: string,
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [resolve(import.meta.dirname, "../dist/cli.js"), action],
      { cwd: root, windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      resolvePromise({ code, stdout, stderr });
    });
  });
}

describe("JSON-only CLI", () => {
  it("reports command results as one JSON document with stable exit codes", async () => {
    const fixture = await createTestRoot();
    try {
      for (const [action, expectedStatus] of [
        ["GET_HEALTH", "UNINITIALIZED"],
        ["SEED", "SEEDED"],
        ["RUN_DEMO", "COMPLETED"],
        ["RUN_DEMO", "COMPLETED"],
        ["RESET", "UNINITIALIZED"],
      ] as const) {
        const result = await runCli(fixture.root, action);
        expect(result.code).toBe(0);
        expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout)).toMatchObject({
          status: expectedStatus,
        });
      }
      const failure = await runCli(fixture.root, "UNKNOWN");
      expect(failure.code).toBe(1);
      expect(failure.stderr).toBe("");
      expect(JSON.parse(failure.stdout)).toEqual({
        name: "DemoError",
        code: "MALFORMED_ACTION",
        message: "Demo action is malformed",
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
