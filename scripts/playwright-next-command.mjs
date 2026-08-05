import { createRequire } from "node:module";
import { resolve } from "node:path";

export const NEXT_BUILD_ARGUMENTS = Object.freeze(["build"]);
export const NEXT_START_ARGUMENTS = Object.freeze([
  "start",
  "--hostname",
  "127.0.0.1",
  "--port",
  "3100",
]);

export function resolveLocalNextCli(webRoot) {
  const requireFromWeb = createRequire(resolve(webRoot, "package.json"));
  return requireFromWeb.resolve("next/dist/bin/next");
}

export function nextEnvironment(environment) {
  return { ...environment, NEXT_TELEMETRY_DISABLED: "1" };
}
