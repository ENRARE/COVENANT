import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_MANIFEST,
  loadDependencyManifest,
  parseArguments,
  runGit,
} from "./contract-dependencies.mjs";

const arguments_ = parseArguments(process.argv.slice(2));
const root = resolve(arguments_.get("--root") ?? ".");
const manifest = loadDependencyManifest(
  root,
  arguments_.get("--manifest") ?? DEFAULT_MANIFEST,
);

let failed = false;
for (const dependency of manifest.dependencies) {
  if (!existsSync(dependency.path)) {
    console.error(
      `[FAILED] Missing dependency directory: ${dependency.directory}`,
    );
    failed = true;
    continue;
  }
  const result = runGit([
    "-c",
    `safe.directory=${dependency.path}`,
    "-C",
    dependency.path,
    "rev-parse",
    "HEAD",
  ]);
  const actual =
    result.status === 0 ? result.stdout.trim() : "not-a-git-checkout";
  if (actual !== dependency.commit) {
    console.error(
      `[FAILED] ${dependency.name} expected ${dependency.commit} but found ${actual}`,
    );
    failed = true;
    continue;
  }
  console.log(
    `[OK] ${dependency.name} ${dependency.version} verified at ${dependency.commit}`,
  );
}

if (failed) process.exit(1);
