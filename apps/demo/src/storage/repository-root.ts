import { lstat, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { DemoError } from "../errors.js";

export type PathKind = "missing" | "directory" | "file" | "symlink" | "other";

export type FileIdentity = Readonly<{ device: bigint; inode: bigint }>;

export async function pathKind(path: string): Promise<PathKind> {
  try {
    const status = await lstat(path);
    if (status.isSymbolicLink()) return "symlink";
    if (status.isDirectory()) return "directory";
    if (status.isFile()) return "file";
    return "other";
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return "missing";
    }
    throw error;
  }
}

export async function fileIdentity(path: string): Promise<FileIdentity> {
  const status = await lstat(path, { bigint: true });
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new DemoError("UNSAFE_STORAGE");
  }
  return { device: status.dev, inode: status.ino };
}

export function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

export async function validateRepositoryRoot(root: string): Promise<void> {
  if (resolve(root) !== root || basename(root).length === 0) {
    throw new DemoError("INVALID_REPOSITORY_ROOT");
  }
  if ((await pathKind(root)) !== "directory") {
    throw new DemoError("INVALID_REPOSITORY_ROOT");
  }
  const packagePath = join(root, "package.json");
  const workspacePath = join(root, "pnpm-workspace.yaml");
  if (
    (await pathKind(packagePath)) !== "file" ||
    (await pathKind(workspacePath)) !== "file"
  ) {
    throw new DemoError("INVALID_REPOSITORY_ROOT");
  }
  try {
    const parsed = JSON.parse(await readFile(packagePath, "utf8")) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("name" in parsed) ||
      parsed.name !== "covenant"
    ) {
      throw new Error("wrong package marker");
    }
  } catch (error) {
    if (error instanceof DemoError) throw error;
    throw new DemoError("INVALID_REPOSITORY_ROOT");
  }
}
