import assert from "node:assert/strict";
import test from "node:test";
import {
  MISSING_CHROMIUM_ERROR,
  runChromiumPreflight,
} from "./playwright-browser-preflight.mjs";

test("accepts the exact executable reported by local Playwright", () => {
  const errors = [];
  const result = runChromiumPreflight({
    executablePath: () => "repository-owned-test-path",
    pathExists: (path) => path === "repository-owned-test-path",
    writeError: (message) => errors.push(message),
  });

  assert.equal(result, true);
  assert.deepEqual(errors, []);
});

test("reports one fixed error when the expected executable is absent", () => {
  const errors = [];
  const result = runChromiumPreflight({
    executablePath: () => "private-path-that-must-not-be-printed",
    pathExists: () => false,
    writeError: (message) => errors.push(message),
  });

  assert.equal(result, false);
  assert.deepEqual(errors, [MISSING_CHROMIUM_ERROR]);
  assert.equal(errors[0].includes("private-path"), false);
});
