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

function gitOutput(dependency, arguments_) {
  const result = runGit([
    "-c",
    `safe.directory=${dependency.path}`,
    "-C",
    dependency.path,
    ...arguments_,
  ]);
  return {
    ok: result.status === 0,
    output: result.status === 0 ? result.stdout.trim() : result.stderr.trim(),
  };
}

export function dependencyIntegrityErrors(dependency) {
  const errors = [];
  const head = gitOutput(dependency, ["rev-parse", "HEAD"]);
  if (!head.ok || head.output !== dependency.commit) {
    errors.push(
      `expected HEAD ${dependency.commit} but found ${head.output || "unreadable"}`,
    );
  }
  const origin = gitOutput(dependency, ["remote", "get-url", "origin"]);
  if (!origin.ok || origin.output !== dependency.repository) {
    errors.push(
      `expected origin ${dependency.repository} but found ${origin.output || "unreadable"}`,
    );
  }
  const worktree = gitOutput(dependency, ["diff", "--exit-code", "--"]);
  if (!worktree.ok) errors.push("tracked worktree differs from HEAD");
  const index = gitOutput(dependency, [
    "diff",
    "--cached",
    "--exit-code",
    "--",
  ]);
  if (!index.ok) errors.push("Git index differs from HEAD");
  const deleted = gitOutput(dependency, ["ls-files", "--deleted"]);
  if (!deleted.ok || deleted.output !== "")
    errors.push("tracked files are deleted");
  const untracked = gitOutput(dependency, [
    "ls-files",
    "--others",
    "--exclude-standard",
  ]);
  if (!untracked.ok || untracked.output !== "") {
    errors.push(
      `untracked files are present${untracked.output ? `: ${untracked.output}` : ""}`,
    );
  }
  return errors;
}
