import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export const DEFAULT_MANIFEST = "packages/contracts/dependencies.lock.json";

export function parseArguments(arguments_) {
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("Expected --root and --manifest arguments with values");
    }
    values.set(key, value);
  }
  return values;
}

export function loadDependencyManifest(root, manifestArgument) {
  const manifestPath = isAbsolute(manifestArgument)
    ? manifestArgument
    : resolve(root, manifestArgument);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.dependencies)) {
    throw new Error("Unsupported contract dependency manifest");
  }

  for (const dependency of manifest.dependencies) {
    if (
      typeof dependency.name !== "string" ||
      typeof dependency.repository !== "string" ||
      typeof dependency.version !== "string" ||
      typeof dependency.commit !== "string" ||
      !/^[0-9a-f]{40}$/.test(dependency.commit) ||
      typeof dependency.directory !== "string"
    ) {
      throw new Error("Malformed contract dependency entry");
    }
    const dependencyPath = resolve(root, dependency.directory);
    const relativePath = relative(root, dependencyPath);
    if (
      relativePath.startsWith("..") ||
      isAbsolute(relativePath) ||
      !relativePath.replaceAll("\\", "/").startsWith("lib/")
    ) {
      throw new Error(
        `Dependency directory escapes lib/: ${dependency.directory}`,
      );
    }
    dependency.path = dependencyPath;
  }
  return manifest;
}

export function runGit(arguments_, options = {}) {
  return spawnSync("git", arguments_, {
    encoding: "utf8",
    shell: false,
    ...options,
  });
}
