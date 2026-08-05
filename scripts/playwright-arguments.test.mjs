import assert from "node:assert/strict";
import test from "node:test";
import { normalizeForwardedArguments } from "./playwright-arguments.mjs";

test("preserves an empty argument list", () => {
  assert.deepEqual(normalizeForwardedArguments([]), []);
});

test("removes a leading separator when it is the only argument", () => {
  assert.deepEqual(normalizeForwardedArguments(["--"]), []);
});

test("removes one leading separator before a desktop project", () => {
  assert.deepEqual(
    normalizeForwardedArguments(["--", "--project=chromium-desktop"]),
    ["--project=chromium-desktop"],
  );
});

test("preserves list and project arguments after a leading separator", () => {
  assert.deepEqual(
    normalizeForwardedArguments(["--", "--list", "--project=chromium-desktop"]),
    ["--list", "--project=chromium-desktop"],
  );
});

test("preserves arguments when there is no leading separator", () => {
  assert.deepEqual(normalizeForwardedArguments(["--grep", "claim boundary"]), [
    "--grep",
    "claim boundary",
  ]);
});

test("preserves a separator outside the first position", () => {
  assert.deepEqual(
    normalizeForwardedArguments(["--grep", "--", "claim boundary"]),
    ["--grep", "--", "claim boundary"],
  );
});
