import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const playwrightCli = require.resolve("@playwright/test/cli");

export function runLocalPlaywright(arguments_, options = {}) {
  return spawn(process.execPath, [playwrightCli, ...arguments_], {
    cwd: options.cwd,
    env: { ...process.env, ...options.environment },
    stdio: "inherit",
  });
}

export function exitWithChild(child) {
  child.once("error", () => {
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}
