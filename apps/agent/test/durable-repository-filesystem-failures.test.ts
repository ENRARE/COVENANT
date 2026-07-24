import * as actualFileSystem from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type FaultKind =
  | "none"
  | "directory"
  | "lock-open"
  | "journal-open"
  | "journal-read"
  | "append-open"
  | "append-write"
  | "append-flush"
  | "append-close"
  | "lock-release";

const fault = vi.hoisted<{ kind: FaultKind }>(() => ({ kind: "none" }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: async (...arguments_: Parameters<typeof actual.mkdir>) => {
      if (fault.kind === "directory") throw new Error("directory secret");
      return actual.mkdir(...arguments_);
    },
    readFile: async (...arguments_: Parameters<typeof actual.readFile>) => {
      if (fault.kind === "journal-read") throw new Error("read secret");
      return actual.readFile(...arguments_);
    },
    unlink: async (...arguments_: Parameters<typeof actual.unlink>) => {
      if (
        fault.kind === "lock-release" &&
        String(arguments_[0]).endsWith(".lock")
      ) {
        throw new Error("release secret");
      }
      return actual.unlink(...arguments_);
    },
    open: async (...arguments_: Parameters<typeof actual.open>) => {
      const [path, flags] = arguments_;
      const pathText = String(path);
      if (
        (fault.kind === "lock-open" &&
          pathText.endsWith(".lock") &&
          flags === "wx") ||
        (fault.kind === "journal-open" &&
          !pathText.endsWith(".lock") &&
          flags === "wx") ||
        (fault.kind === "append-open" && flags === "a")
      ) {
        throw new Error("open secret");
      }
      const handle = await actual.open(...arguments_);
      if (flags !== "a") return handle;
      let closeFaulted = false;
      return new Proxy(handle, {
        get(target, property, receiver) {
          if (property === "writeFile" && fault.kind === "append-write") {
            return () => Promise.reject(new Error("write secret"));
          }
          if (property === "sync" && fault.kind === "append-flush") {
            return () => Promise.reject(new Error("flush secret"));
          }
          if (
            property === "close" &&
            fault.kind === "append-close" &&
            !closeFaulted
          ) {
            return async () => {
              closeFaulted = true;
              await target.close();
              throw new Error("close secret");
            };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          if (typeof value !== "function") return value;
          const method = value as (...arguments_: unknown[]) => unknown;
          return (...arguments_: unknown[]) =>
            Reflect.apply(method, target, arguments_);
        },
      });
    },
  };
});

import {
  AgentError,
  createDurableProposalReservationRepository,
  type DurableProposalReservationRepository,
} from "../src/index.js";

const directories = new Set<string>();
const repositories = new Set<DurableProposalReservationRepository>();

async function temporaryDirectory(): Promise<string> {
  const directory = await actualFileSystem.mkdtemp(
    join(await actualFileSystem.realpath(process.env.TEMP ?? "."), "cov-fs-"),
  );
  directories.add(directory);
  return directory;
}

function expectSafeError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(AgentError);
  expect(error).toMatchObject({ code, stack: undefined });
  const serialized = JSON.stringify(error);
  for (const secret of ["secret", ...directories]) {
    expect(serialized).not.toContain(secret);
  }
}

async function initialize(directory: string) {
  const repository = await createDurableProposalReservationRepository({
    directory,
  });
  repositories.add(repository);
  return repository;
}

async function expectInitializationFailure(directory: string): Promise<void> {
  let caught: unknown;
  try {
    await createDurableProposalReservationRepository({ directory });
  } catch (error) {
    caught = error;
  }
  expectSafeError(caught, "DURABLE_REPOSITORY_INITIALIZATION_FAILURE");
}

async function expectPersistenceFailure(
  repository: DurableProposalReservationRepository,
): Promise<void> {
  let caught: unknown;
  try {
    await repository.reserve(`0x${"71".repeat(32)}`, (nonce) =>
      Promise.resolve({
        intentId: `0x${"72".repeat(32)}`,
        nonce: String(nonce),
        rawPaymentIntentPayload: {
          version: "1",
          intentId: `0x${"72".repeat(32)}`,
          covenantId: `0x${"31".repeat(32)}`,
          agentSigner: "0x182e3c2f89df65b794ebba844c20c3df5a0d91b7",
          recipient: "0x6000000000000000000000000000000000000006",
          token: "0x5000000000000000000000000000000000000005",
          amount: "1",
          invoiceHash: `0x${"33".repeat(32)}`,
          purpose: "Purchase approved GPU compute",
          createdAt: "2000000000",
          expiresAt: "2000000600",
          nonce: String(nonce),
        },
      }),
    );
  } catch (error) {
    caught = error;
  }
  expectSafeError(caught, "DURABLE_REPOSITORY_PERSISTENCE_FAILURE");
}

afterEach(async () => {
  fault.kind = "none";
  await Promise.allSettled(
    [...repositories].map(async (repository) => repository.close()),
  );
  repositories.clear();
  await Promise.all(
    [...directories].map(async (directory) =>
      actualFileSystem.rm(directory, { recursive: true, force: true }),
    ),
  );
  directories.clear();
});

describe("durable repository filesystem failures", () => {
  it("sanitizes directory creation failure", async () => {
    const root = await temporaryDirectory();
    fault.kind = "directory";
    await expectInitializationFailure(join(root, "state"));
  });

  it.each(["lock-open", "journal-open"] as const)(
    "sanitizes %s failure",
    async (kind) => {
      const directory = await temporaryDirectory();
      fault.kind = kind;
      await expectInitializationFailure(directory);
    },
  );

  it("sanitizes journal read failure", async () => {
    const directory = await temporaryDirectory();
    await actualFileSystem.writeFile(
      join(directory, "proposals.v1.jsonl"),
      "",
      "utf8",
    );
    fault.kind = "journal-read";
    await expectInitializationFailure(directory);
  });

  it.each([
    "append-open",
    "append-write",
    "append-flush",
    "append-close",
  ] as const)("sanitizes %s failure", async (kind) => {
    const directory = await temporaryDirectory();
    const repository = await initialize(directory);
    fault.kind = kind;
    await expectPersistenceFailure(repository);
  });

  it("sanitizes lock release failure", async () => {
    const directory = await temporaryDirectory();
    const repository = await initialize(directory);
    fault.kind = "lock-release";
    let caught: unknown;
    try {
      await repository.close();
    } catch (error) {
      caught = error;
      repositories.delete(repository);
    }
    expectSafeError(caught, "DURABLE_REPOSITORY_CLOSE_FAILURE");
  });
});
