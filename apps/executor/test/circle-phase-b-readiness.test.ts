import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CIRCLE_MAX_RESPONSE_BYTES,
  CIRCLE_ORIGIN,
  CIRCLE_TRANSACTION_STATUS_PATH_PREFIX,
  createCircleContractExecutionTransport,
  createCircleTransactionStatusReader,
  createDurableCircleOperationRepository,
  createExecutorService,
  createIsolatedCircleCredentialProvider,
  type CircleHttpRequest,
  type CircleExecutionFingerprint,
  type CircleOperationRepository,
  type CircleTransactionStatusHttpRequest,
  type DurableCircleOperationRepository,
} from "../src/index.js";
import { createTestHarness } from "./fixtures.js";

const WALLET_ID = "11111111-1111-5111-8111-111111111111";
const IDEMPOTENCY_KEY = "22222222-2222-4222-8222-222222222222";
const SECOND_UUID = "44444444-4444-4444-8444-444444444444";
const TRANSACTION_ID = "33333333-3333-4333-8333-333333333333";
const API_KEY = ["synthetic", "circle", "fixture"].join("-");
const CIPHERTEXT = "offline-ciphertext";
const SECOND_CIPHERTEXT = "offline-ciphertext-two";
const JOURNAL_NAME = "circle-operations.v1.jsonl";
const encoder = new TextEncoder();
const temporaryDirectories = new Set<string>();
const repositories = new Set<DurableCircleOperationRepository>();
const bytes32Schema = z.string().regex(/^0x[0-9a-f]{64}$/);
const uuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const uuidV4Schema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const journalOperationKeySchema = z
  .object({
    formatVersion: z.literal("1"),
    recordType: z.literal("STATE"),
    sequence: z.literal("0"),
    previousRecordDigest: z.null(),
    operation: z
      .object({
        fingerprint: z
          .object({
            operationKey: bytes32Schema,
            executionId: bytes32Schema,
            transactionDigest: bytes32Schema,
            walletId: uuidSchema,
            contractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
            feeLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
          })
          .strict(),
        idempotencyKey: uuidV4Schema,
        state: z.literal("PREPARED"),
        attemptCount: z.literal(0),
      })
      .strict(),
    recordDigest: bytes32Schema,
  })
  .strict();

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "covenant-circle-phase-b-"));
  temporaryDirectories.add(directory);
  return directory;
}

async function repository(
  directory: string,
): Promise<DurableCircleOperationRepository> {
  const value = await createDurableCircleOperationRepository({ directory });
  repositories.add(value);
  return value;
}

async function close(value: DurableCircleOperationRepository): Promise<void> {
  await value.close();
  repositories.delete(value);
}

async function firstJournalOperationKey(directory: string): Promise<string> {
  const firstLine = (await readFile(join(directory, JOURNAL_NAME), "utf8"))
    .trim()
    .split("\n")[0];
  return journalOperationKeySchema.parse(JSON.parse(firstLine ?? "{}"))
    .operation.fingerprint.operationKey;
}

function response(status: number, body: unknown) {
  return Object.freeze({
    status,
    headers: Object.freeze({ "content-type": "application/json" }),
    body: encoder.encode(JSON.stringify(body)),
  });
}

async function harness(
  operations: CircleOperationRepository,
  post: (request: CircleHttpRequest) => Promise<unknown>,
  uuid = IDEMPOTENCY_KEY,
  baseInput?: Awaited<ReturnType<typeof createTestHarness>>,
  submissionTimeoutMilliseconds = 5_000,
) {
  const base = baseInput ?? (await createTestHarness());
  const getApiKey = vi.fn(() => API_KEY);
  const createEntitySecretCiphertext = vi.fn(() => CIPHERTEXT);
  const transport = createCircleContractExecutionTransport({
    config: {
      walletId: WALLET_ID,
      contractAddress: base.covenant.vaultAddress,
      feeLevel: "MEDIUM",
    },
    credentials: createIsolatedCircleCredentialProvider({
      getApiKey,
      createEntitySecretCiphertext,
    }),
    http: { postContractExecution: post },
    operations,
    generateUuid: () => uuid,
  });
  return {
    ...base,
    getApiKey,
    createEntitySecretCiphertext,
    service: createExecutorService({
      ...base.dependencies,
      transport,
      submissionTimeoutMilliseconds,
    }),
  };
}

afterEach(async () => {
  for (const value of [...repositories]) {
    await value.close().catch(() => undefined);
    repositories.delete(value);
  }
  for (const directory of [...temporaryDirectories]) {
    await rm(directory, { recursive: true, force: true });
    temporaryDirectories.delete(directory);
  }
  vi.restoreAllMocks();
});

describe("durable Circle operation repository", () => {
  it("recovers accepted identity after restart without a second POST", async () => {
    const directory = await temporaryDirectory();
    const base = await createTestHarness();
    const firstRepository = await repository(directory);
    const firstPost = vi.fn(() =>
      Promise.resolve(
        response(201, {
          data: { id: TRANSACTION_ID, state: "INITIATED" },
        }),
      ),
    );
    const first = await harness(
      firstRepository,
      firstPost,
      IDEMPOTENCY_KEY,
      base,
    );
    const submitted = await first.service.executeAuthorizedPayment(
      first.request,
    );
    await close(firstRepository);

    const secondRepository = await repository(directory);
    const secondPost = vi.fn(() => Promise.reject(new Error("must not post")));
    const restarted = await harness(
      secondRepository,
      secondPost,
      SECOND_UUID,
      base,
    );
    const recovered = await restarted.service.executeAuthorizedPayment(
      restarted.request,
    );

    expect(recovered).toStrictEqual(submitted);
    expect(firstPost).toHaveBeenCalledTimes(1);
    expect(secondPost).not.toHaveBeenCalled();
    const journal = await readFile(join(directory, JOURNAL_NAME), "utf8");
    expect(journal.trim().split("\n")).toHaveLength(3);
    expect(journal).not.toContain(API_KEY);
    expect(journal).not.toContain(CIPHERTEXT);
    await close(secondRepository);
  });

  it("fails closed after crash recovery from a durably started attempt", async () => {
    const directory = await temporaryDirectory();
    const firstRepository = await repository(directory);
    const base = await createTestHarness();
    const prepared = await base.service.prepareExecution(base.request);
    const pendingPost = vi.fn(() => new Promise<unknown>(() => undefined));
    const pendingHarness = await harness(
      firstRepository,
      pendingPost,
      IDEMPOTENCY_KEY,
      base,
      100,
    );
    const pendingExecution = pendingHarness.service.executeAuthorizedPayment(
      pendingHarness.request,
    );
    const pendingRejection = expect(pendingExecution).rejects.toMatchObject({
      code: "EXECUTION_RESULT_AMBIGUOUS",
    });
    await vi.waitFor(async () => {
      const journal = await readFile(join(directory, JOURNAL_NAME), "utf8");
      expect(journal).toContain("SUBMISSION_ATTEMPT_STARTED");
    });
    expect(prepared.executionId).toBeDefined();
    await close(firstRepository);
    await pendingRejection;

    const secondRepository = await repository(directory);
    const restartedPost = vi.fn(() => Promise.resolve(response(201, {})));
    const restarted = await harness(
      secondRepository,
      restartedPost,
      SECOND_UUID,
      base,
    );
    await expect(
      restarted.service.executeAuthorizedPayment(restarted.request),
    ).rejects.toMatchObject({ code: "EXECUTION_RESULT_AMBIGUOUS" });
    expect(restartedPost).not.toHaveBeenCalled();
    await close(secondRepository);
  });

  it("retains a durably unknown outcome without credentials or another POST", async () => {
    const directory = await temporaryDirectory();
    const base = await createTestHarness();
    const firstRepository = await repository(directory);
    const firstPost = vi.fn(() => Promise.reject(new Error("possible send")));
    const first = await harness(
      firstRepository,
      firstPost,
      IDEMPOTENCY_KEY,
      base,
    );

    await expect(
      first.service.executeAuthorizedPayment(first.request),
    ).rejects.toMatchObject({ code: "EXECUTION_RESULT_AMBIGUOUS" });
    await close(firstRepository);

    const secondRepository = await repository(directory);
    const secondPost = vi.fn(() => Promise.resolve(response(201, {})));
    const restarted = await harness(
      secondRepository,
      secondPost,
      SECOND_UUID,
      base,
    );
    await expect(
      restarted.service.executeAuthorizedPayment(restarted.request),
    ).rejects.toMatchObject({ code: "EXECUTION_RESULT_AMBIGUOUS" });
    expect(firstPost).toHaveBeenCalledTimes(1);
    expect(secondPost).not.toHaveBeenCalled();
    expect(restarted.getApiKey).not.toHaveBeenCalled();
    expect(restarted.createEntitySecretCiphertext).not.toHaveBeenCalled();
    await close(secondRepository);
  });

  it("serializes concurrent preparation and rejects a conflicting fingerprint", async () => {
    const directory = await temporaryDirectory();
    const operations = await repository(directory);
    const fingerprint = Object.freeze({
      operationKey: `0x${"11".repeat(32)}`,
      executionId: `0x${"22".repeat(32)}`,
      transactionDigest: `0x${"33".repeat(32)}`,
      walletId: WALLET_ID,
      contractAddress: "0x1111111111111111111111111111111111111111",
      feeLevel: "MEDIUM",
    }) satisfies CircleExecutionFingerprint;

    const [first, concurrent] = await Promise.all([
      operations.prepare(fingerprint, IDEMPOTENCY_KEY),
      operations.prepare(fingerprint, SECOND_UUID),
    ]);
    expect(first).toMatchObject({ idempotencyKey: IDEMPOTENCY_KEY });
    expect(concurrent).toStrictEqual(first);
    await expect(
      operations.prepare(
        { ...fingerprint, transactionDigest: `0x${"44".repeat(32)}` },
        SECOND_UUID,
      ),
    ).rejects.toMatchObject({ code: "EXECUTION_CONFLICT" });
    const journal = await readFile(join(directory, JOURNAL_NAME), "utf8");
    expect(journal.trim().split("\n")).toHaveLength(1);
    await close(operations);
  });

  it("rejects tampered or truncated journals and a concurrent owner", async () => {
    const directory = await temporaryDirectory();
    const firstRepository = await repository(directory);
    await expect(
      createDurableCircleOperationRepository({ directory }),
    ).rejects.toMatchObject({ code: "EXECUTION_REPOSITORY_FAILURE" });
    await close(firstRepository);

    await writeFile(
      join(directory, JOURNAL_NAME),
      '{"tampered":true}\n',
      "utf8",
    );
    await expect(
      createDurableCircleOperationRepository({ directory }),
    ).rejects.toMatchObject({ code: "EXECUTION_REPOSITORY_FAILURE" });

    await writeFile(
      join(directory, JOURNAL_NAME),
      '{"truncated":true}',
      "utf8",
    );
    await expect(
      createDurableCircleOperationRepository({ directory }),
    ).rejects.toMatchObject({ code: "EXECUTION_REPOSITORY_FAILURE" });
  });
});

describe("isolated Circle credential capability", () => {
  it("generates fresh request-scoped ciphertext and rejects reuse", async () => {
    const source = vi
      .fn<() => string>()
      .mockReturnValueOnce(CIPHERTEXT)
      .mockReturnValueOnce(SECOND_CIPHERTEXT)
      .mockReturnValueOnce(CIPHERTEXT);
    const credentials = createIsolatedCircleCredentialProvider({
      getApiKey: () => API_KEY,
      createEntitySecretCiphertext: source,
    });

    await expect(credentials.getApiKey()).resolves.toBe(API_KEY);
    await expect(credentials.createEntitySecretCiphertext()).resolves.toBe(
      CIPHERTEXT,
    );
    await expect(credentials.createEntitySecretCiphertext()).resolves.toBe(
      SECOND_CIPHERTEXT,
    );
    await expect(
      credentials.createEntitySecretCiphertext(),
    ).rejects.toMatchObject({ code: "CREDENTIAL_UNAVAILABLE" });
    expect(source).toHaveBeenCalledTimes(3);
  });

  it("serializes concurrent generation so duplicate ciphertext is consumed once", async () => {
    const credentials = createIsolatedCircleCredentialProvider({
      getApiKey: () => API_KEY,
      createEntitySecretCiphertext: () => CIPHERTEXT,
    });

    const results = await Promise.allSettled([
      credentials.createEntitySecretCiphertext(),
      credentials.createEntitySecretCiphertext(),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
  });
});

describe("Circle read-only status boundary", () => {
  it("queries only the stored provider UUID and parses a bounded observation", async () => {
    const directory = await temporaryDirectory();
    const operations = await repository(directory);
    const submitted = await harness(operations, () =>
      Promise.resolve(
        response(201, { data: { id: TRANSACTION_ID, state: "INITIATED" } }),
      ),
    );
    const prepared = await submitted.service.prepareExecution(
      submitted.request,
    );
    await submitted.service.executeAuthorizedPayment(submitted.request);
    const operationKey = await firstJournalOperationKey(directory);
    const get = vi.fn((_request: CircleTransactionStatusHttpRequest) =>
      Promise.resolve(
        response(200, {
          data: {
            id: TRANSACTION_ID,
            state: "SENT",
            txHash: `0x${"AB".repeat(32)}`,
          },
        }),
      ),
    );
    const reader = createCircleTransactionStatusReader({
      credentials: { getApiKey: () => API_KEY },
      http: { getTransaction: get },
      operations,
    });

    await expect(reader.observeKnownTransaction(operationKey)).resolves.toEqual(
      {
        status: "OBSERVED",
        transactionId: TRANSACTION_ID,
        providerState: "SENT",
        transactionHash: `0x${"ab".repeat(32)}`,
      },
    );
    expect(prepared.executionId).toBeDefined();
    expect(get).toHaveBeenCalledWith({
      method: "GET",
      url: `${CIRCLE_ORIGIN}${CIRCLE_TRANSACTION_STATUS_PATH_PREFIX}${TRANSACTION_ID}`,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${API_KEY}`,
      },
      maximumResponseBytes: CIRCLE_MAX_RESPONSE_BYTES,
      redirects: 0,
      acceptContentEncoding: "identity",
    });
    await close(operations);
  });

  it.each([
    ["unknown operation", `0x${"99".repeat(32)}`, { data: {} }],
    [
      "conflicting provider id",
      undefined,
      { data: { id: SECOND_UUID, state: "INITIATED" } },
    ],
    [
      "unknown field",
      undefined,
      { data: { id: TRANSACTION_ID, state: "INITIATED", walletId: WALLET_ID } },
    ],
    [
      "missing required hash",
      undefined,
      { data: { id: TRANSACTION_ID, state: "COMPLETE" } },
    ],
  ])("fails closed for %s", async (_name, overrideOperationKey, statusBody) => {
    const directory = await temporaryDirectory();
    const operations = await repository(directory);
    const submitted = await harness(operations, () =>
      Promise.resolve(
        response(201, { data: { id: TRANSACTION_ID, state: "INITIATED" } }),
      ),
    );
    await submitted.service.executeAuthorizedPayment(submitted.request);
    const operationKey =
      overrideOperationKey ?? (await firstJournalOperationKey(directory));
    const get = vi.fn(() => Promise.resolve(response(200, statusBody)));
    const reader = createCircleTransactionStatusReader({
      credentials: { getApiKey: () => API_KEY },
      http: { getTransaction: get },
      operations,
    });

    await expect(
      reader.observeKnownTransaction(operationKey),
    ).rejects.toMatchObject({
      name: "ExecutorError",
    });
    if (overrideOperationKey !== undefined) expect(get).not.toHaveBeenCalled();
    await close(operations);
  });
});
