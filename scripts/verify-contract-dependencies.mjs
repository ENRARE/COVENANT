import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_MANIFEST,
  dependencyIntegrityErrors,
  loadDependencyManifest,
  parseArguments,
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
  const errors = dependencyIntegrityErrors(dependency);
  if (errors.length !== 0) {
    for (const error of errors)
      console.error(`[FAILED] ${dependency.name}: ${error}`);
    failed = true;
    continue;
  }
  console.log(
    `[OK] ${dependency.name} ${dependency.version} verified at ${dependency.commit}`,
  );
}

if (failed) process.exit(1);
