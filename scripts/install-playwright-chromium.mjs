import { exitWithChild, runLocalPlaywright } from "./playwright-local-cli.mjs";

exitWithChild(runLocalPlaywright(["install", "chromium"]));
