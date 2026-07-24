import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  AgentError,
  createAgentService,
  createDurableProposalReservationRepository,
  type DurableProposalReservationRepository,
} from "../src/index.js";
import { createAgentHarness, TEST_NOW, type AgentHarness } from "./fixtures.js";

const JOURNAL_NAME = "proposals.v1.jsonl";
const LOCK_NAME = `${JOURNAL_NAME}.lock`;

const temporaryDirectories = new Set<string>();
const openRepositories = new Set<DurableProposalReservationRepository>();

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "covenant-agent-durable-"));
  temporaryDirectories.add(directory);
  return directory;
}

async function repository(directory: string) {
  const value = await createDurableProposalReservationRepository({ directory });
  openRepositories.add(value);
  return value;
}

async function close(
  value: DurableProposalReservationRepository,
): Promise<void> {
  await value.close();
  openRepositories.delete(value);
}

function serviceWithRepository(
  harness: AgentHarness,
  reservationRepository: DurableProposalReservationRepository,
) {
  return createAgentService({
    ...harness.dependencies,
    reservationRepository,
  });
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

function resignRecord(record: Record<string, unknown>): void {
  const unsigned = Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== "recordDigest"),
  );
  record.recordDigest = `0x${createHash("sha256")
    .update(canonicalJson(unsigned))
    .digest("hex")}`;
}

async function writeJournal(
  directory: string,
  records: readonly Record<string, unknown>[],
  suffix = "\n",
): Promise<void> {
  await writeFile(
    join(directory, JOURNAL_NAME),
    `${records.map((record) => JSON.stringify(record)).join("\n")}${suffix}`,
    "utf8",
  );
}

function cloneRecords(
  records: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  return structuredClone([...records]);
}

function recordAt(
  records: readonly Record<string, unknown>[],
  index: number,
): Record<string, unknown> {
  const record = records[index];
  if (record === undefined) throw new Error("Missing test journal record");
  return record;
}

function expectSafeError(
  error: unknown,
  code: string,
  secrets: string[],
): void {
  expect(error).toBeInstanceOf(AgentError);
  expect(error).toMatchObject({ code, stack: undefined });
  const serialized = JSON.stringify(error);
  expect(Object.keys(JSON.parse(serialized) as object)).toEqual([
    "name",
    "code",
    "message",
  ]);
  for (const secret of secrets.filter((value) => value.length > 0)) {
    expect(serialized).not.toContain(secret);
  }
}

async function expectInitializationFailure(
  directory: string,
  secrets: string[] = [],
): Promise<void> {
  let caught: unknown;
  try {
    await createDurableProposalReservationRepository({ directory });
  } catch (error) {
    caught = error;
  }
  expectSafeError(caught, "DURABLE_REPOSITORY_INITIALIZATION_FAILURE", [
    directory,
    ...secrets,
  ]);
}

afterEach(async () => {
  for (const value of [...openRepositories]) {
    await value.close().catch(() => undefined);
    openRepositories.delete(value);
  }
  vi.restoreAllMocks();
  for (const directory of [...temporaryDirectories]) {
    await rm(directory, { recursive: true, force: true });
    temporaryDirectories.delete(directory);
  }
});

describe("durable proposal restart recovery", () => {
  it("initializes a fresh journal and releases its exclusive lock on close", async () => {
    const directory = await temporaryDirectory();
    const value = await repository(directory);
    expect((await lstat(join(directory, JOURNAL_NAME))).isFile()).toBe(true);
    expect((await lstat(join(directory, LOCK_NAME))).isFile()).toBe(true);

    await close(value);

    await expect(lstat(join(directory, LOCK_NAME))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(join(directory, JOURNAL_NAME), "utf8")).toBe("");
  });

  it("retains the exact proposal payload across signer failure and restart", async () => {
    const directory = await temporaryDirectory();
    const firstRepository = await repository(directory);
    const harness = await createAgentHarness({
      reservationRepository: firstRepository,
    });
    harness.signer.failure = new Error("first signing failure");
    await expect(
      harness.service.proposePayment(harness.request),
    ).rejects.toMatchObject({ code: "PAYMENT_INTENT_SIGNING_FAILURE" });
    const firstTypedData = structuredClone(harness.signer.typedData[0]);
    expect(harness.counts).toMatchObject({ identifier: 1, signer: 1 });
    await close(firstRepository);

    const secondRepository = await repository(directory);
    harness.signer.failure = undefined;
    const retryService = serviceWithRepository(harness, secondRepository);
    const result = await retryService.proposePayment(harness.request);

    expect(harness.signer.typedData[1]).toEqual(firstTypedData);
    expect(result.signedPaymentIntent.payload).toMatchObject({
      intentId: `0x${"34".repeat(32)}`,
      nonce: "0",
      createdAt: TEST_NOW.toString(),
      expiresAt: (TEST_NOW + 600n).toString(),
    });
    expect(harness.counts).toMatchObject({ identifier: 1, signer: 2 });
    expect(
      (await readFile(join(directory, JOURNAL_NAME), "utf8")).split("\n"),
    ).toHaveLength(3);
    await close(secondRepository);
  });

  it("returns a completed proposal after restart without new allocation or signing", async () => {
    const directory = await temporaryDirectory();
    const firstRepository = await repository(directory);
    const harness = await createAgentHarness({
      reservationRepository: firstRepository,
    });
    const first = await harness.service.proposePayment(harness.request);
    expect(harness.counts).toMatchObject({ identifier: 1, signer: 1 });
    await close(firstRepository);

    const secondRepository = await repository(directory);
    const second = await serviceWithRepository(
      harness,
      secondRepository,
    ).proposePayment(harness.request);

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(Object.isFrozen(second)).toBe(true);
    expect(Object.isFrozen(second.signedInvoice.payload)).toBe(true);
    expect(Object.isFrozen(second.signedPaymentIntent.payload)).toBe(true);
    expect(harness.counts).toMatchObject({ identifier: 1, signer: 1 });
    expect(
      (await readFile(join(directory, JOURNAL_NAME), "utf8")).split("\n"),
    ).toHaveLength(3);
    await close(secondRepository);
  });

  it("permanently rejects an expired retained proposal after restart", async () => {
    const directory = await temporaryDirectory();
    const firstRepository = await repository(directory);
    const harness = await createAgentHarness({
      reservationRepository: firstRepository,
    });
    harness.signer.failure = new Error("retain this proposal");
    await expect(
      harness.service.proposePayment(harness.request),
    ).rejects.toMatchObject({ code: "PAYMENT_INTENT_SIGNING_FAILURE" });
    await close(firstRepository);

    harness.signer.failure = undefined;
    harness.clock.value = TEST_NOW + 600n;
    const secondRepository = await repository(directory);
    await expect(
      serviceWithRepository(harness, secondRepository).proposePayment(
        harness.request,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_INTENT_EXPIRED" });
    expect(harness.counts).toMatchObject({ identifier: 1, signer: 1 });
    await close(secondRepository);
  });

  it("serializes concurrent reservations and allocates each nonce once", async () => {
    const directory = await temporaryDirectory();
    const value = await repository(directory);
    const firstIdentity = `0x${"71".repeat(32)}`;
    const secondIdentity = `0x${"72".repeat(32)}`;
    let callbackCalls = 0;
    const create = (intentId: string) => (nonce: unknown) => {
      callbackCalls += 1;
      const value = nonce as bigint;
      return Promise.resolve({
        intentId,
        nonce: value.toString(),
        rawPaymentIntentPayload: {
          version: "1",
          intentId,
          covenantId: `0x${"31".repeat(32)}`,
          agentSigner: "0x182e3c2f89df65b794ebba844c20c3df5a0d91b7",
          recipient: "0x6000000000000000000000000000000000000006",
          token: "0x5000000000000000000000000000000000000005",
          amount: "1",
          invoiceHash: `0x${"33".repeat(32)}`,
          purpose: "Purchase approved GPU compute",
          createdAt: TEST_NOW.toString(),
          expiresAt: (TEST_NOW + 600n).toString(),
          nonce: value.toString(),
        },
      });
    };
    const firstId = `0x${"73".repeat(32)}`;
    const secondId = `0x${"74".repeat(32)}`;

    const [firstA, firstB, second] = await Promise.all([
      value.reserve(firstIdentity, create(firstId)),
      value.reserve(firstIdentity, create(firstId)),
      value.reserve(secondIdentity, create(secondId)),
    ]);

    expect(firstA).toEqual(firstB);
    expect(firstA).toMatchObject({ nonce: "0" });
    expect(second).toMatchObject({ nonce: "1" });
    expect(callbackCalls).toBe(2);
    await close(value);
  });

  it("rejects a second repository instance without deleting the first lock", async () => {
    const directory = await temporaryDirectory();
    const first = await repository(directory);
    await expectInitializationFailure(directory);
    expect((await lstat(join(directory, LOCK_NAME))).isFile()).toBe(true);
    await close(first);
  });

  it("rejects operations after close with a fixed stack-free error", async () => {
    const directory = await temporaryDirectory();
    const value = await repository(directory);
    await close(value);
    let caught: unknown;
    try {
      await value.get(`0x${"71".repeat(32)}`);
    } catch (error) {
      caught = error;
    }
    expectSafeError(caught, "DURABLE_REPOSITORY_CLOSED", [directory]);
  });

  it("runs the explicit A-B-C restart lifecycle without duplicate work", async () => {
    const directory = await temporaryDirectory();
    const instanceA = await repository(directory);
    const harness = await createAgentHarness({
      reservationRepository: instanceA,
    });
    harness.signer.failure = new Error("A retains the reservation");
    await expect(
      harness.service.proposePayment(harness.request),
    ).rejects.toMatchObject({ code: "PAYMENT_INTENT_SIGNING_FAILURE" });
    const retainedPayload = structuredClone(harness.signer.typedData[0]);
    await close(instanceA);

    harness.signer.failure = undefined;
    const instanceB = await repository(directory);
    const completed = await serviceWithRepository(
      harness,
      instanceB,
    ).proposePayment(harness.request);
    expect(harness.signer.typedData[1]).toEqual(retainedPayload);
    await close(instanceB);

    const instanceC = await repository(directory);
    const recovered = await serviceWithRepository(
      harness,
      instanceC,
    ).proposePayment(harness.request);
    expect(recovered).toEqual(completed);
    expect(harness.counts).toMatchObject({ identifier: 1, signer: 2 });
    await close(instanceC);

    expect(await readFile(join(directory, JOURNAL_NAME), "utf8")).toMatch(
      /"recordType":"RESERVED".*"recordType":"COMPLETED"/s,
    );
    await expect(lstat(join(directory, LOCK_NAME))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not allow caller mutation after restart to affect persisted state", async () => {
    const directory = await temporaryDirectory();
    const firstRepository = await repository(directory);
    const harness = await createAgentHarness({
      reservationRepository: firstRepository,
    });
    await harness.service.proposePayment(harness.request);
    await close(firstRepository);

    const secondRepository = await repository(directory);
    const result = await serviceWithRepository(
      harness,
      secondRepository,
    ).proposePayment(harness.request);
    expect(Reflect.set(result.signedInvoice.payload, "amount", "999")).toBe(
      false,
    );
    await close(secondRepository);

    const thirdRepository = await repository(directory);
    const recovered = await serviceWithRepository(
      harness,
      thirdRepository,
    ).proposePayment(harness.request);
    expect(recovered.signedInvoice.payload.amount).toBe("1.25");
    expect(harness.counts).toMatchObject({ identifier: 1, signer: 1 });
    await close(thirdRepository);
  });

  it.each(["signedInvoice", "signedPaymentIntent"] as const)(
    "revalidates a stored %s signature after restart",
    async (field) => {
      const directory = await temporaryDirectory();
      const firstRepository = await repository(directory);
      const harness = await createAgentHarness({
        reservationRepository: firstRepository,
      });
      await harness.service.proposePayment(harness.request);
      await close(firstRepository);

      const journalPath = join(directory, JOURNAL_NAME);
      const records = (await readFile(journalPath, "utf8"))
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const completed = recordAt(records, 1).completedResult as Record<
        string,
        unknown
      >;
      (completed[field] as Record<string, unknown>).signature =
        `0x${"12".repeat(65)}`;
      resignRecord(recordAt(records, 1));
      await writeJournal(directory, records);

      const secondRepository = await repository(directory);
      await expect(
        serviceWithRepository(harness, secondRepository).proposePayment(
          harness.request,
        ),
      ).rejects.toMatchObject({ code: "SELF_VERIFICATION_FAILED" });
      expect(harness.counts).toMatchObject({ identifier: 1, signer: 1 });
      await close(secondRepository);
    },
  );
});

describe("durable journal corruption fails closed", () => {
  let templateDirectory: string;
  let validRecords: Record<string, unknown>[];

  beforeAll(async () => {
    templateDirectory = await temporaryDirectory();
    const value = await repository(templateDirectory);
    const harness = await createAgentHarness({ reservationRepository: value });
    await harness.service.proposePayment(harness.request);
    await close(value);
    validRecords = (
      await readFile(join(templateDirectory, JOURNAL_NAME), "utf8")
    )
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  });

  afterAll(async () => {
    await rm(templateDirectory, { recursive: true, force: true });
    temporaryDirectories.delete(templateDirectory);
  });

  const corruptions: readonly [
    string,
    (records: Record<string, unknown>[]) => string | Record<string, unknown>[],
  ][] = [
    ["invalid JSON", () => "not-json\n"],
    [
      "unknown record type",
      (records) => {
        recordAt(records, 0).recordType = "UNKNOWN";
        return records;
      },
    ],
    [
      "unknown object field",
      (records) => {
        recordAt(records, 0).unknown = true;
        return records;
      },
    ],
    [
      "missing required field",
      (records) => {
        delete recordAt(records, 0).intentId;
        return records;
      },
    ],
    [
      "changed proposal identity",
      (records) => {
        recordAt(records, 0).proposalIdentity = `0x${"91".repeat(32)}`;
        return records;
      },
    ],
    [
      "changed intent ID",
      (records) => {
        recordAt(records, 0).intentId = `0x${"92".repeat(32)}`;
        return records;
      },
    ],
    [
      "changed nonce",
      (records) => {
        recordAt(records, 0).nonce = "9";
        return records;
      },
    ],
    [
      "changed raw payload",
      (records) => {
        (
          recordAt(records, 0).rawPaymentIntentPayload as Record<
            string,
            unknown
          >
        ).amount = "2";
        return records;
      },
    ],
    [
      "incorrect record digest",
      (records) => {
        recordAt(records, 0).recordDigest = `0x${"00".repeat(32)}`;
        return records;
      },
    ],
    [
      "incorrect previous-record digest",
      (records) => {
        recordAt(records, 1).previousRecordDigest = `0x${"00".repeat(32)}`;
        resignRecord(recordAt(records, 1));
        return records;
      },
    ],
    [
      "conflicting duplicate reservation",
      (records) => {
        const duplicate = structuredClone(recordAt(records, 0));
        duplicate.intentId = `0x${"93".repeat(32)}`;
        (
          duplicate.rawPaymentIntentPayload as Record<string, unknown>
        ).intentId = duplicate.intentId;
        resignRecord(duplicate);
        return [recordAt(records, 0), duplicate];
      },
    ],
    [
      "conflicting completed result",
      (records) => {
        const duplicate = structuredClone(recordAt(records, 1));
        (
          (duplicate.completedResult as Record<string, unknown>)
            .signedPaymentIntent as Record<string, unknown>
        ).signature = `0x${"11".repeat(65)}`;
        resignRecord(duplicate);
        return [...records, duplicate];
      },
    ],
    ["truncated final line", (records) => JSON.stringify(records[0])],
    [
      "extra bytes after a record",
      (records) => `${JSON.stringify(records[0])}\nextra-bytes\n`,
    ],
    [
      "invalid decimal string",
      (records) => {
        recordAt(records, 0).nonce = "00";
        resignRecord(recordAt(records, 0));
        return records;
      },
    ],
    [
      "malformed PaymentIntent payload",
      (records) => {
        delete (
          recordAt(records, 0).rawPaymentIntentPayload as Record<
            string,
            unknown
          >
        ).token;
        resignRecord(recordAt(records, 0));
        return records;
      },
    ],
    [
      "malformed completed signed Invoice",
      (records) => {
        (
          (recordAt(records, 1).completedResult as Record<string, unknown>)
            .signedInvoice as Record<string, unknown>
        ).signature = "0x12";
        resignRecord(recordAt(records, 1));
        return records;
      },
    ],
    [
      "malformed completed signed PaymentIntent",
      (records) => {
        (
          (recordAt(records, 1).completedResult as Record<string, unknown>)
            .signedPaymentIntent as Record<string, unknown>
        ).signature = "0x12";
        resignRecord(recordAt(records, 1));
        return records;
      },
    ],
  ];

  it.each(corruptions)("rejects %s", async (_name, mutate) => {
    const directory = await temporaryDirectory();
    const changed = mutate(cloneRecords(validRecords));
    if (typeof changed === "string") {
      await writeFile(join(directory, JOURNAL_NAME), changed, "utf8");
    } else {
      await writeJournal(directory, changed);
    }
    await expectInitializationFailure(directory, [
      "signedPaymentIntent",
      "rawPaymentIntentPayload",
    ]);
  });

  it("rejects invalid UTF-8 without exposing decoder output", async () => {
    const directory = await temporaryDirectory();
    await writeFile(
      join(directory, JOURNAL_NAME),
      Uint8Array.from([0xff, 0xfe, 0xfd, 0x0a]),
    );
    await expectInitializationFailure(directory);
  });
});

describe("durable repository filesystem and path failures", () => {
  it("rejects an empty or null-containing directory", async () => {
    for (const directory of ["", "bad\0path"]) {
      let caught: unknown;
      try {
        await createDurableProposalReservationRepository({ directory });
      } catch (error) {
        caught = error;
      }
      expectSafeError(caught, "DURABLE_REPOSITORY_INITIALIZATION_FAILURE", [
        directory,
      ]);
    }
  });

  it("rejects a file where the storage directory is required", async () => {
    const root = await temporaryDirectory();
    const path = join(root, "not-a-directory");
    await writeFile(path, "not a directory", "utf8");
    await expectInitializationFailure(path);
  });

  it("rejects a symlinked storage directory", async () => {
    const root = await temporaryDirectory();
    const target = join(root, "target");
    const linked = join(root, "linked");
    await mkdir(target);
    await symlink(target, linked, "junction");
    await expectInitializationFailure(linked);
  });

  it("rejects symlinked journal and lock files", async () => {
    for (const name of [JOURNAL_NAME, LOCK_NAME]) {
      const directory = await temporaryDirectory();
      const target = join(directory, "target");
      await mkdir(target);
      await symlink(target, join(directory, name), "junction");
      await expectInitializationFailure(directory);
    }
  });

  it("fails closed when journal append/open cannot target a file", async () => {
    const directory = await temporaryDirectory();
    const value = await repository(directory);
    await unlink(join(directory, JOURNAL_NAME));
    await mkdir(join(directory, JOURNAL_NAME));
    const harness = await createAgentHarness({ reservationRepository: value });
    let caught: unknown;
    try {
      await harness.service.proposePayment(harness.request);
    } catch (error) {
      caught = error;
    }
    expectSafeError(caught, "DURABLE_REPOSITORY_PERSISTENCE_FAILURE", [
      directory,
    ]);
    expect(harness.counts).toMatchObject({ identifier: 1, signer: 0 });
    await close(value);
  });

  it("reports lock-release failure without exposing its path", async () => {
    const directory = await temporaryDirectory();
    const value = await repository(directory);
    await unlink(join(directory, LOCK_NAME));
    await mkdir(join(directory, LOCK_NAME));
    let caught: unknown;
    try {
      await close(value);
    } catch (error) {
      caught = error;
      openRepositories.delete(value);
    }
    expectSafeError(caught, "DURABLE_REPOSITORY_CLOSE_FAILURE", [directory]);
  });
});
