import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
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
  const { env: environmentOverrides, ...spawnOptions } = options;
  const environment = { ...process.env, ...environmentOverrides };
  delete environment.GIT_EXTERNAL_DIFF;
  delete environment.GIT_DIFF_OPTS;
  return spawnSync("git", arguments_, {
    encoding: "utf8",
    shell: false,
    ...spawnOptions,
    env: environment,
  });
}

function gitResult(repositoryPath, arguments_, options = {}) {
  const safeDirectories = options.safeDirectories ?? [repositoryPath];
  const runOptions = { ...options };
  delete runOptions.safeDirectories;
  const safeArguments = safeDirectories.flatMap((path) => [
    "-c",
    `safe.directory=${path}`,
  ]);
  return runGit(
    [...safeArguments, "-C", repositoryPath, ...arguments_],
    runOptions,
  );
}

function gitOutput(repositoryPath, arguments_, options = {}) {
  const result = gitResult(repositoryPath, arguments_, options);
  return {
    ok: result.status === 0,
    output: result.status === 0 ? result.stdout.trim() : result.stderr.trim(),
  };
}

function nullRecords(output) {
  const records = output.split("\0");
  if (records.at(-1) === "") records.pop();
  return records;
}

function displayPath(path) {
  return JSON.stringify(path);
}

function indexFlagErrors(repositoryPath, safeDirectories) {
  const errors = [];
  const assumeUnchanged = gitResult(repositoryPath, ["ls-files", "-v", "-z"], {
    safeDirectories,
  });
  if (assumeUnchanged.status !== 0) {
    errors.push("unable to inspect assume-unchanged index flags");
  } else {
    for (const entry of nullRecords(assumeUnchanged.stdout)) {
      const flag = entry[0];
      const path = entry.slice(2);
      if (/[a-z]/.test(flag)) {
        errors.push(
          `tracked path ${displayPath(path)} has assume-unchanged index flag`,
        );
      }
    }
  }

  const skipWorktree = gitResult(repositoryPath, ["ls-files", "-t", "-z"], {
    safeDirectories,
  });
  if (skipWorktree.status !== 0) {
    errors.push("unable to inspect skip-worktree index flags");
  } else {
    for (const entry of nullRecords(skipWorktree.stdout)) {
      const flag = entry[0];
      const path = entry.slice(2);
      if (flag.toUpperCase() === "S") {
        errors.push(
          `tracked path ${displayPath(path)} has skip-worktree index flag`,
        );
      }
    }
  }
  return errors;
}

function parseHeadTree(repositoryPath, safeDirectories, errors) {
  const tree = gitResult(
    repositoryPath,
    ["ls-tree", "-r", "-z", "--full-tree", "HEAD"],
    { safeDirectories },
  );
  if (tree.status !== 0) {
    errors.push("unable to enumerate the complete HEAD tree");
    return [];
  }
  const entries = [];
  for (const record of nullRecords(tree.stdout)) {
    const match = /^([0-7]{6}) ([^ ]+) ([0-9a-f]+)\t([\s\S]+)$/.exec(record);
    if (!match) {
      errors.push("unable to parse a null-delimited HEAD tree entry");
      continue;
    }
    entries.push({
      mode: match[1],
      type: match[2],
      objectId: match[3],
      path: match[4],
    });
  }
  return entries;
}

function hashTrackedBlobs(repositoryPath, entries, safeDirectories, errors) {
  const hashes = new Map();
  const batchPaths = [];
  for (const entry of entries) {
    if (entry.type !== "blob") continue;
    try {
      lstatSync(resolve(repositoryPath, entry.path));
    } catch {
      errors.push(`tracked path ${displayPath(entry.path)} is missing`);
      continue;
    }
    if (/[\r\n]/.test(entry.path)) {
      const result = gitOutput(
        repositoryPath,
        ["hash-object", `--path=${entry.path}`, "--", entry.path],
        { safeDirectories },
      );
      if (!result.ok) {
        errors.push(`unable to hash tracked path ${displayPath(entry.path)}`);
      } else {
        hashes.set(entry.path, result.output);
      }
    } else {
      batchPaths.push(entry.path);
    }
  }

  if (batchPaths.length !== 0) {
    const result = gitResult(repositoryPath, ["hash-object", "--stdin-paths"], {
      safeDirectories,
      input: `${batchPaths.join("\n")}\n`,
    });
    const output = result.status === 0 ? result.stdout.trim().split("\n") : [];
    if (result.status !== 0 || output.length !== batchPaths.length) {
      errors.push("unable to hash every tracked working-tree blob");
    } else {
      for (let index = 0; index < batchPaths.length; index++) {
        hashes.set(batchPaths[index], output[index]);
      }
    }
  }

  for (const entry of entries) {
    if (entry.type !== "blob") continue;
    const actual = hashes.get(entry.path);
    if (actual !== undefined && actual !== entry.objectId) {
      const raw = gitOutput(
        repositoryPath,
        ["hash-object", "--no-filters", "--", entry.path],
        { safeDirectories },
      );
      // A byte-for-byte HEAD match is also authoritative. This handles tracked
      // CRLF test vectors whose repository intentionally stores CRLF while a
      // machine-wide core.autocrlf setting would otherwise re-clean them.
      if (!raw.ok || raw.output !== entry.objectId) {
        errors.push(
          `tracked path ${displayPath(entry.path)} differs from HEAD blob ${entry.objectId}`,
        );
      }
    }
  }
}

function untrackedErrors(repositoryPath, safeDirectories) {
  const errors = [];
  for (const [label, arguments_] of [
    ["untracked", ["ls-files", "--others", "--exclude-standard", "-z"]],
    [
      "ignored untracked",
      ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"],
    ],
  ]) {
    const result = gitResult(repositoryPath, arguments_, { safeDirectories });
    if (result.status !== 0) {
      errors.push(`unable to enumerate ${label} paths`);
      continue;
    }
    for (const path of nullRecords(result.stdout)) {
      errors.push(`${label} path is present: ${displayPath(path)}`);
    }
  }
  return errors;
}

function repositoryContentErrors(
  repositoryPath,
  expectedCommit,
  label,
  safeDirectories,
) {
  const errors = [];
  const topLevel = gitOutput(repositoryPath, ["rev-parse", "--show-toplevel"], {
    safeDirectories,
  });
  if (!topLevel.ok || resolve(topLevel.output) !== resolve(repositoryPath)) {
    return [`${label} is not an initialized Git worktree`];
  }
  const head = gitOutput(repositoryPath, ["rev-parse", "HEAD"], {
    safeDirectories,
  });
  if (!head.ok || head.output !== expectedCommit) {
    errors.push(
      `${label} expected HEAD ${expectedCommit} but found ${head.output || "unreadable"}`,
    );
  }

  errors.push(...indexFlagErrors(repositoryPath, safeDirectories));

  const worktree = gitOutput(
    repositoryPath,
    ["diff", "--no-ext-diff", "--exit-code", "--"],
    { safeDirectories },
  );
  if (!worktree.ok) errors.push(`${label} tracked worktree differs from HEAD`);
  const index = gitOutput(
    repositoryPath,
    ["diff", "--cached", "--no-ext-diff", "--exit-code", "HEAD", "--"],
    { safeDirectories },
  );
  if (!index.ok) errors.push(`${label} Git index differs from HEAD`);

  const deleted = gitResult(repositoryPath, ["ls-files", "--deleted", "-z"], {
    safeDirectories,
  });
  if (deleted.status !== 0) {
    errors.push(`${label} tracked deletions could not be enumerated`);
  } else {
    for (const path of nullRecords(deleted.stdout)) {
      errors.push(`${label} tracked path is deleted: ${displayPath(path)}`);
    }
  }
  errors.push(...untrackedErrors(repositoryPath, safeDirectories));

  const entries = parseHeadTree(repositoryPath, safeDirectories, errors);
  hashTrackedBlobs(repositoryPath, entries, safeDirectories, errors);

  for (const entry of entries) {
    if (entry.type === "blob") continue;
    if (entry.type !== "commit" || entry.mode !== "160000") {
      errors.push(
        `${label} contains unsupported HEAD entry ${displayPath(entry.path)} of type ${entry.type}`,
      );
      continue;
    }
    const submodulePath = resolve(repositoryPath, entry.path);
    let children;
    try {
      const stat = lstatSync(submodulePath);
      if (!stat.isDirectory()) {
        errors.push(
          `${label} submodule path ${displayPath(entry.path)} is not a directory`,
        );
        continue;
      }
      children = readdirSync(submodulePath);
    } catch {
      children = [];
    }
    // An empty uninitialized gitlink contributes no working content. Its exact
    // recorded commit is already authenticated by the parent HEAD tree and the
    // clean index check. Any nonempty gitlink must be a verifiable worktree.
    if (children.length === 0) continue;

    const nestedSafeDirectories = [...safeDirectories, submodulePath];
    const nestedTop = gitOutput(
      submodulePath,
      ["rev-parse", "--show-toplevel"],
      {
        safeDirectories: nestedSafeDirectories,
      },
    );
    if (!nestedTop.ok || resolve(nestedTop.output) !== submodulePath) {
      errors.push(
        `${label} submodule ${displayPath(entry.path)} has unsupported nonempty uninitialized state`,
      );
      continue;
    }
    errors.push(
      ...repositoryContentErrors(
        submodulePath,
        entry.objectId,
        `${label} submodule ${displayPath(entry.path)}`,
        nestedSafeDirectories,
      ),
    );
  }
  return errors;
}

export function dependencyIntegrityErrors(dependency) {
  const errors = [];
  const safeDirectories = [dependency.path];
  const origin = gitOutput(dependency.path, ["remote", "get-url", "origin"], {
    safeDirectories,
  });
  if (!origin.ok || origin.output !== dependency.repository) {
    errors.push(
      `expected origin ${dependency.repository} but found ${origin.output || "unreadable"}`,
    );
  }
  errors.push(
    ...repositoryContentErrors(
      dependency.path,
      dependency.commit,
      dependency.name,
      safeDirectories,
    ),
  );
  return errors;
}
