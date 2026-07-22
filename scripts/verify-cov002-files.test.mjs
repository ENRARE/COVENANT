import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  REQUIRED_COV002_FILES,
  missingCov002Files,
} from "./verify-cov002-files.mjs";

function completeFixture() {
  const root = mkdtempSync(join(tmpdir(), "covenant-files-test-"));
  for (const file of REQUIRED_COV002_FILES) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "fixture\n");
  }
  return root;
}

test("complete COV-002 manifest fixture passes", () => {
  assert.deepEqual(missingCov002Files(completeFixture()), []);
});

for (const requiredFile of REQUIRED_COV002_FILES) {
  test(`missing required file fails: ${requiredFile}`, () => {
    const root = completeFixture();
    rmSync(join(root, requiredFile));
    assert.deepEqual(missingCov002Files(root), [requiredFile]);
  });
}
