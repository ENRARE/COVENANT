import assert from "node:assert/strict";
import { basename, resolve } from "node:path";
import test from "node:test";
import {
  NEXT_BUILD_ARGUMENTS,
  NEXT_START_ARGUMENTS,
  nextEnvironment,
  resolveLocalNextCli,
} from "./playwright-next-command.mjs";

const webRoot = resolve(import.meta.dirname, "../apps/web");

test("resolves the Next.js CLI from the web dependency context", () => {
  assert.equal(basename(resolveLocalNextCli(webRoot)), "next");
});

test("uses the fixed production build and start arguments", () => {
  assert.deepEqual(NEXT_BUILD_ARGUMENTS, ["build"]);
  assert.deepEqual(NEXT_START_ARGUMENTS, [
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
  ]);
});

test("preserves the environment while disabling telemetry", () => {
  assert.deepEqual(
    nextEnvironment({ PRESERVED_VALUE: "yes", NEXT_TELEMETRY_DISABLED: "0" }),
    { PRESERVED_VALUE: "yes", NEXT_TELEMETRY_DISABLED: "1" },
  );
});
