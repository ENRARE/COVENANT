import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("test:contracts fails when Forge is unavailable", () => {
  const script = fileURLToPath(
    new URL("./test-contracts.mjs", import.meta.url),
  );
  const result = spawnSync(process.execPath, [script], {
    env: { ...process.env, PATH: "" },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Foundry is required/);
});
