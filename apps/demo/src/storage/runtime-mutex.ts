import { open, type FileHandle } from "node:fs/promises";
import { join, resolve } from "node:path";
import { lock, unlock } from "os-lock";
import { DemoError } from "../errors.js";
import {
  fileIdentity,
  pathKind,
  sameIdentity,
  validateRepositoryRoot,
} from "./repository-root.js";

const MUTEX_FILE = ".covenant-demo.lock";
const CONTENTION_CODES = new Set(["EACCES", "EAGAIN", "EBUSY"]);

type MutexLease = Readonly<{ release(): Promise<void> }>;

export type RuntimeMutexTestHooks = Readonly<{
  afterSentinelOpened?(): Promise<void>;
}>;

export function createRuntimeMutex(options: {
  repositoryRoot: string;
  testHooks?: RuntimeMutexTestHooks;
}): {
  acquireExclusive(): Promise<MutexLease>;
  acquireShared(): Promise<MutexLease>;
} {
  const repositoryRoot = resolve(options.repositoryRoot);
  const sentinelPath = join(repositoryRoot, MUTEX_FILE);

  async function acquire(exclusive: boolean): Promise<MutexLease> {
    let handle: FileHandle | undefined;
    try {
      await validateRepositoryRoot(repositoryRoot);
      const initialKind = await pathKind(sentinelPath);
      if (initialKind !== "missing" && initialKind !== "file") {
        throw new DemoError("UNSAFE_STORAGE");
      }
      handle = await open(sentinelPath, "a+", 0o600);
      await options.testHooks?.afterSentinelOpened?.();
      const openedStatus = await handle.stat({ bigint: true });
      if (!openedStatus.isFile()) throw new DemoError("UNSAFE_STORAGE");
      const openedIdentity = {
        device: openedStatus.dev,
        inode: openedStatus.ino,
      };
      if (
        (await pathKind(sentinelPath)) !== "file" ||
        !sameIdentity(await fileIdentity(sentinelPath), openedIdentity)
      ) {
        throw new DemoError("UNSAFE_STORAGE");
      }
      try {
        await lock(handle.fd, { exclusive, immediate: true });
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof error.code === "string" &&
          CONTENTION_CODES.has(error.code)
        ) {
          throw new DemoError("LOCK_BUSY");
        }
        throw new DemoError("STORAGE_FAILURE");
      }
      let released = false;
      const ownedHandle = handle;
      handle = undefined;
      return {
        async release() {
          if (released) return;
          released = true;
          let failed = false;
          try {
            await unlock(ownedHandle.fd);
          } catch {
            failed = true;
          }
          try {
            await ownedHandle.close();
          } catch {
            failed = true;
          }
          if (failed) throw new DemoError("STORAGE_FAILURE");
        },
      };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (error instanceof DemoError) throw new DemoError(error.code);
      throw new DemoError("STORAGE_FAILURE");
    }
  }

  return {
    acquireExclusive: () => acquire(true),
    acquireShared: () => acquire(false),
  };
}
