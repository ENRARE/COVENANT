import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

function git(cwd, arguments_) {
  const result = spawnSync("git", arguments_, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test("dependency verification rejects an incorrect checked-out commit", () => {
  const root = mkdtempSync(join(tmpdir(), "covenant-dependency-test-"));
  const dependencyDirectory = join(root, "lib", "example");
  git(root, ["init", dependencyDirectory]);
  git(dependencyDirectory, [
    "config",
    "user.email",
    "fixture@covenant.invalid",
  ]);
  git(dependencyDirectory, ["config", "user.name", "Covenant Fixture"]);
  writeFileSync(join(dependencyDirectory, "fixture.txt"), "fixture\n");
  git(dependencyDirectory, ["add", "fixture.txt"]);
  git(dependencyDirectory, ["commit", "-m", "fixture"]);

  const manifestPath = join(root, "dependencies.json");
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      dependencies: [
        {
          name: "example",
          repository: "https://github.com/example/example.git",
          version: "v1.0.0",
          commit: "0000000000000000000000000000000000000000",
          directory: "lib/example",
        },
      ],
    }),
  );

  const script = fileURLToPath(
    new URL("./verify-contract-dependencies.mjs", import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    [script, "--root", root, "--manifest", manifestPath],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /expected 0000000000000000000000000000000000000000 but found/,
  );
});
