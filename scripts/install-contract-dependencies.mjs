import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_MANIFEST,
  dependencyIntegrityErrors,
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

for (const dependency of manifest.dependencies) {
  if (existsSync(dependency.path)) {
    const errors = dependencyIntegrityErrors(dependency);
    if (errors.length === 0) {
      console.log(
        `[OK] ${dependency.name} ${dependency.version} already installed at ${dependency.commit}`,
      );
      continue;
    }
    console.error(
      `[FAILED] ${dependency.directory} exists but is not the exact clean approved checkout: ${errors.join("; ")}. Remove it explicitly before a clean reinstall.`,
    );
    process.exit(1);
  }

  mkdirSync(dirname(dependency.path), { recursive: true });
  const commands = [
    ["init", dependency.path],
    ["-C", dependency.path, "remote", "add", "origin", dependency.repository],
    [
      "-C",
      dependency.path,
      "fetch",
      "--depth",
      "1",
      "origin",
      dependency.commit,
    ],
    ["-C", dependency.path, "checkout", "--detach", "FETCH_HEAD"],
  ];
  for (const command of commands) {
    const result = runGit(command, { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  const errors = dependencyIntegrityErrors(dependency);
  if (errors.length !== 0) {
    console.error(
      `[FAILED] Installed dependency failed integrity verification: ${errors.join("; ")}`,
    );
    process.exit(1);
  }
  console.log(
    `[OK] Installed ${dependency.name} ${dependency.version} at ${dependency.commit}`,
  );
}
