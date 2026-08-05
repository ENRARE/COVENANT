import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

export const MISSING_CHROMIUM_ERROR =
  'Playwright Chromium is not provisioned. Run "pnpm e2e:install-browser" before "pnpm test:e2e".';

export function isPlaywrightChromiumProvisioned(options = {}) {
  const executablePath =
    options.executablePath ?? (() => chromium.executablePath());
  const pathExists = options.pathExists ?? existsSync;
  return pathExists(executablePath());
}

export function runChromiumPreflight(options = {}) {
  if (isPlaywrightChromiumProvisioned(options)) return true;
  (options.writeError ?? console.error)(MISSING_CHROMIUM_ERROR);
  return false;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (!runChromiumPreflight()) process.exitCode = 1;
}
