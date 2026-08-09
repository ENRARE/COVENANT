import { createHash } from "node:crypto";
import { TextEncoder } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
  CIRCLE_CONTRACT_EXECUTION_URL,
  CIRCLE_MAX_RESPONSE_BYTES,
  ExecutorError,
  InMemoryCircleOperationRepository,
  createCircleContractExecutionTransport,
  createExecutorService,
  type CircleContractExecutionTransportDependencies,
  type CircleHttpRequest,
} from "../src/index.js";
import { createTestHarness } from "./fixtures.js";

const textEncoder = new TextEncoder();

function expectedOperationKey(executionId: `0x${string}`): `0x${string}` {
  const digest = createHash("sha256")
    .update(textEncoder.encode("COVENANT:CIRCLE:EXECUTION:V1"))
    .update(Uint8Array.of(0))
    .update(Buffer.from(executionId.slice(2), "hex"))
    .digest("hex");
  return `0x${digest}`;
}
const textDecoder = new TextDecoder();
const WALLET_ID = "11111111-1111-5111-8111-111111111111";
const IDEMPOTENCY_KEY = "22222222-2222-4222-8222-222222222222";
const NON_V4_IDEMPOTENCY_KEY = "55555555-5555-5555-8555-555555555555";
const TRANSACTION_ID = "33333333-3333-4333-8333-333333333333";
const RESTART_UUID = "44444444-4444-4444-8444-444444444444";
const auth = "test";
const cipher = "fake";

function jsonResponse(
  body: string,
  overrides: Partial<{
    status: number;
    headers: Record<string, string>;
  }> = {},
) {
  return Object.freeze({
    status: overrides.status ?? 201,
    headers: Object.freeze(
      overrides.headers ?? { "content-type": "application/json" },
    ),
    body: textEncoder.encode(body),
  });
}

function acceptedResponse(id = TRANSACTION_ID, state = "INITIATED") {
  return jsonResponse(JSON.stringify({ data: { id, state } }));
}

async function createCircleHarness(
  options: {
    response?: unknown;
    post?: (request: CircleHttpRequest) => Promise<unknown>;
    apiKey?: unknown;
    ciphertext?: unknown;
    uuid?: unknown;
    operations?: CircleContractExecutionTransportDependencies["operations"];
    config?: unknown;
  } = {},
) {
  const base = await createTestHarness();
  const requests: CircleHttpRequest[] = [];
  const post = vi.fn(
    options.post ??
      ((request: CircleHttpRequest) => {
        requests.push(request);
        return Promise.resolve(options.response ?? acceptedResponse());
      }),
  );
  const getApiKey = vi.fn(() => options.apiKey ?? auth);
  const createEntitySecretCiphertext = vi.fn(
    () => options.ciphertext ?? cipher,
  );
  const generateUuid = vi.fn(() => options.uuid ?? IDEMPOTENCY_KEY);
  const operations =
    options.operations ?? new InMemoryCircleOperationRepository();
  const transport = createCircleContractExecutionTransport({
    config:
      options.config ??
      Object.freeze({
        walletId: WALLET_ID,
        contractAddress: base.covenant.vaultAddress,
        feeLevel: "MEDIUM",
      }),
    credentials: { getApiKey, createEntitySecretCiphertext },
    http: { postContractExecution: post },
    operations,
    generateUuid,
  });
  const service = createExecutorService({
    ...base.dependencies,
    transport,
  });
  return {
    ...base,
    service,
    requests,
    post,
    getApiKey,
    createEntitySecretCiphertext,
    generateUuid,
    operations,
    transport,
  };
}

async function expectExecutorCode(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(operation).rejects.toMatchObject({
    name: "ExecutorError",
    code,
  });
}

describe("Circle contract execution transport", () => {
  it("submits only the fixed Circle contract-execution request", async () => {
    const harness = await createCircleHarness();
    const prepared = await harness.service.prepareExecution(harness.request);

    const result = await harness.service.executeAuthorizedPayment(
      harness.request,
    );

    expect(prepared.value).toBe(0n);
    expect(result).toMatchObject({
      status: "SUBMITTED",
      transactionId: TRANSACTION_ID,
    });
    expect(harness.post).toHaveBeenCalledTimes(1);
    expect(harness.getApiKey).toHaveBeenCalledTimes(1);
    expect(harness.createEntitySecretCiphertext).toHaveBeenCalledTimes(1);
    expect(harness.generateUuid).toHaveBeenCalledTimes(1);
    const providerRequest = harness.post.mock.calls[0]?.[0];
    expect(providerRequest).toMatchObject({
      method: "POST",
      url: CIRCLE_CONTRACT_EXECUTION_URL,
      maximumResponseBytes: CIRCLE_MAX_RESPONSE_BYTES,
      redirects: 0,
      acceptContentEncoding: "identity",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${auth}`,
        "content-type": "application/json",
      },
    });
    const body = JSON.parse(
      textDecoder.decode(providerRequest?.body),
    ) as Record<string, unknown>;
    expect(body).toStrictEqual({
      walletId: WALLET_ID,
      contractAddress: harness.covenant.vaultAddress,
      callData: prepared.data,
      idempotencyKey: IDEMPOTENCY_KEY,
      entitySecretCiphertext: cipher,
      feeLevel: "MEDIUM",
    });
    expect(body).not.toHaveProperty("blockchain");
    expect(body).not.toHaveProperty("amount");
    expect(body).not.toHaveProperty("abiFunctionSignature");
    expect(body).not.toHaveProperty("abiParameters");
    expect(body).not.toHaveProperty("walletAddress");
  });

  it("accepts a canonical non-v4 wallet UUID but rejects a non-v4 idempotency key", async () => {
    const harness = await createCircleHarness({ uuid: NON_V4_IDEMPOTENCY_KEY });

    await expectExecutorCode(
      harness.service.executeAuthorizedPayment(harness.request),
      "INTERNAL_UNAVAILABLE",
    );
    expect(harness.post).not.toHaveBeenCalled();
    expect(harness.getApiKey).not.toHaveBeenCalled();
    expect(harness.createEntitySecretCiphertext).not.toHaveBeenCalled();
  });
  it.each([
    "INITIATED",
    "CLEARED",
    "QUEUED",
    "SENT",
    "STUCK",
    "CONFIRMED",
    "COMPLETE",
    "FAILED",
    "DENIED",
    "CANCELLED",
  ])("accepts the documented %s provider state", async (state) => {
    const harness = await createCircleHarness({
      response: acceptedResponse(TRANSACTION_ID, state),
    });

    await expect(
      harness.service.executeAuthorizedPayment(harness.request),
    ).resolves.toMatchObject({
      status: "SUBMITTED",
      transactionId: TRANSACTION_ID,
    });
  });

  it.each([
    ["transport rejection", () => Promise.reject(new Error("secret detail"))],
    ["malformed JSON", () => Promise.resolve(jsonResponse('{"data":'))],
    [
      "duplicate JSON keys",
      () =>
        Promise.resolve(
          jsonResponse(
            `{"data":{"id":"${TRANSACTION_ID}","id":"${TRANSACTION_ID}","state":"INITIATED"}}`,
          ),
        ),
    ],
    [
      "unknown response field",
      () =>
        Promise.resolve(
          jsonResponse(
            JSON.stringify({
              data: {
                id: TRANSACTION_ID,
                state: "INITIATED",
                url: "https://example.invalid",
              },
            }),
          ),
        ),
    ],
    [
      "unknown provider state",
      () => Promise.resolve(acceptedResponse(TRANSACTION_ID, "UNKNOWN")),
    ],
    [
      "wrong content type",
      () =>
        Promise.resolve(
          jsonResponse(JSON.stringify({ data: {} }), {
            headers: { "content-type": "text/plain" },
          }),
        ),
    ],
    [
      "compressed response",
      () =>
        Promise.resolve(
          jsonResponse(JSON.stringify({ data: {} }), {
            headers: {
              "content-type": "application/json",
              "content-encoding": "gzip",
            },
          }),
        ),
    ],
    [
      "oversized response",
      () =>
        Promise.resolve({
          status: 201,
          headers: { "content-type": "application/json" },
          body: new Uint8Array(CIRCLE_MAX_RESPONSE_BYTES + 1),
        }),
    ],
    [
      "provider rejection",
      () =>
        Promise.resolve(
          jsonResponse(JSON.stringify({ code: 400, message: "rejected" }), {
            status: 400,
          }),
        ),
    ],
    [
      "authentication failure",
      () =>
        Promise.resolve(
          jsonResponse(JSON.stringify({ code: 401, message: "bad key" }), {
            status: 401,
          }),
        ),
    ],
    [
      "rate limit",
      () =>
        Promise.resolve(
          jsonResponse(JSON.stringify({ code: 429, message: "slow down" }), {
            status: 429,
          }),
        ),
    ],
    [
      "server failure",
      () =>
        Promise.resolve(
          jsonResponse(JSON.stringify({ code: 500, message: "failed" }), {
            status: 500,
          }),
        ),
    ],
  ])("retains %s as ambiguity after one POST", async (_name, responder) => {
    const harness = await createCircleHarness({ post: responder });

    await expectExecutorCode(
      harness.service.executeAuthorizedPayment(harness.request),
      "EXECUTION_RESULT_AMBIGUOUS",
    );
    await expectExecutorCode(
      harness.service.executeAuthorizedPayment(harness.request),
      "EXECUTION_RESULT_AMBIGUOUS",
    );
    expect(harness.post).toHaveBeenCalledTimes(1);
    expect(harness.createEntitySecretCiphertext).toHaveBeenCalledTimes(1);
  });

  it("rejects response BOM, malformed UTF-8, and unsupported media parameters", async () => {
    const responses = [
      {
        status: 201,
        headers: { "content-type": "application/json" },
        body: textEncoder.encode(`\uFEFF${JSON.stringify({ data: {} })}`),
      },
      {
        status: 201,
        headers: { "content-type": "application/json" },
        body: new Uint8Array([0xff]),
      },
      jsonResponse(JSON.stringify({ data: {} }), {
        headers: { "content-type": "application/json; charset=ascii" },
      }),
    ];

    for (const response of responses) {
      const harness = await createCircleHarness({ response });
      await expectExecutorCode(
        harness.service.executeAuthorizedPayment(harness.request),
        "EXECUTION_RESULT_AMBIGUOUS",
      );
      expect(harness.post).toHaveBeenCalledTimes(1);
    }
  });

  it("joins concurrent identical executions into one provider request", async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const harness = await createCircleHarness({
      post: () => pending,
    });

    const first = harness.service.executeAuthorizedPayment(harness.request);
    const second = harness.service.executeAuthorizedPayment(harness.request);
    await vi.waitFor(() => {
      expect(harness.post).toHaveBeenCalledTimes(1);
    });
    release(acceptedResponse());

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toStrictEqual(secondResult);
    expect(harness.post).toHaveBeenCalledTimes(1);
    expect(harness.generateUuid).toHaveBeenCalledTimes(1);
  });

  it("persists acceptance and returns it without another provider request", async () => {
    const harness = await createCircleHarness();
    const first = await harness.service.executeAuthorizedPayment(
      harness.request,
    );
    const second = await harness.service.executeAuthorizedPayment(
      harness.request,
    );

    expect(second).toStrictEqual(first);
    expect(harness.post).toHaveBeenCalledTimes(1);
  });

  it("reuses accepted provider identity after transport recreation with the same repository", async () => {
    const operations = new InMemoryCircleOperationRepository();
    const first = await createCircleHarness({ operations });
    const firstResult = await first.service.executeAuthorizedPayment(
      first.request,
    );
    const restartedPost = vi.fn(() => Promise.resolve(acceptedResponse()));
    const authFn = vi.fn(() => auth);
    const cipherFn = vi.fn(() => cipher);
    const restartedGenerateUuid = vi.fn(() => RESTART_UUID);
    const restartedTransport = createCircleContractExecutionTransport({
      config: {
        walletId: WALLET_ID,
        contractAddress: first.covenant.vaultAddress,
        feeLevel: "MEDIUM",
      },
      credentials: {
        getApiKey: authFn,
        createEntitySecretCiphertext: cipherFn,
      },
      http: { postContractExecution: restartedPost },
      operations,
      generateUuid: restartedGenerateUuid,
    });
    const restartedService = createExecutorService({
      ...first.dependencies,
      transport: restartedTransport,
    });

    const restartedResult = await restartedService.executeAuthorizedPayment(
      first.request,
    );

    expect(restartedResult).toStrictEqual(firstResult);
    expect(restartedResult).toMatchObject({
      status: "SUBMITTED",
      transactionId: TRANSACTION_ID,
    });
    expect(first.post).toHaveBeenCalledTimes(1);
    expect(restartedPost).not.toHaveBeenCalled();
    expect(authFn).not.toHaveBeenCalled();
    expect(cipherFn).not.toHaveBeenCalled();
    expect(restartedGenerateUuid).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the stored operation fingerprint conflicts", async () => {
    const operations = new InMemoryCircleOperationRepository();
    const harness = await createCircleHarness({ operations });
    const prepared = await harness.service.prepareExecution(harness.request);
    await operations.prepare(
      {
        operationKey: expectedOperationKey(prepared.executionId),
        executionId: prepared.executionId,
        transactionDigest: `0x${"aa".repeat(32)}`,
        walletId: WALLET_ID,
        contractAddress: harness.covenant.vaultAddress,
        feeLevel: "MEDIUM",
      },
      IDEMPOTENCY_KEY,
    );

    await expectExecutorCode(
      harness.service.executeAuthorizedPayment(harness.request),
      "EXECUTION_CONFLICT",
    );
    expect(harness.post).not.toHaveBeenCalled();
    expect(harness.getApiKey).not.toHaveBeenCalled();
  });

  it("rejects missing credentials before a submission attempt", async () => {
    const harness = await createCircleHarness({ apiKey: "" });

    await expectExecutorCode(
      harness.service.executeAuthorizedPayment(harness.request),
      "CREDENTIAL_UNAVAILABLE",
    );
    expect(harness.post).not.toHaveBeenCalled();
    expect(harness.createEntitySecretCiphertext).not.toHaveBeenCalled();
  });

  it("rejects invalid fixed configuration at construction", async () => {
    const base = await createTestHarness();

    let observed: unknown;
    try {
      createCircleContractExecutionTransport({
        config: {
          walletId: WALLET_ID,
          contractAddress: base.covenant.vaultAddress,
          feeLevel: "CALLER_SELECTED",
        },
        credentials: {
          getApiKey: () => auth,
          createEntitySecretCiphertext: () => cipher,
        },
        http: {
          postContractExecution: () => Promise.resolve(acceptedResponse()),
        },
        operations: new InMemoryCircleOperationRepository(),
        generateUuid: () => IDEMPOTENCY_KEY,
      });
    } catch (error) {
      observed = error;
    }
    expect(observed).toMatchObject({
      name: "ExecutorError",
      code: "CONFIGURATION_UNAVAILABLE",
    });
  });

  it("rejects direct transport use without the verified service context", async () => {
    const harness = await createCircleHarness();
    const prepared = await harness.service.prepareExecution(harness.request);
    const transaction = {
      chainId: prepared.chainId,
      to: prepared.target,
      value: prepared.value,
      data: prepared.data,
    };
    const malformedTransport = harness.transport as unknown as {
      submit(
        request: unknown,
        context?: { executionId: `0x${string}` },
      ): Promise<unknown>;
    };

    await expectExecutorCode(
      harness.transport.submit(transaction),
      "REQUEST_INVALID",
    );
    await expectExecutorCode(
      harness.transport.submit(
        { ...transaction, to: harness.intent.recipient },
        { executionId: prepared.executionId },
      ),
      "REQUEST_INVALID",
    );
    await expectExecutorCode(
      malformedTransport.submit(
        { ...transaction, chainId: 1n },
        { executionId: prepared.executionId },
      ),
      "REQUEST_INVALID",
    );
    await expectExecutorCode(
      malformedTransport.submit(
        { ...transaction, value: 1n },
        { executionId: prepared.executionId },
      ),
      "REQUEST_INVALID",
    );
    await expectExecutorCode(
      harness.transport.submit(
        { ...transaction, data: "0x1234" },
        { executionId: prepared.executionId },
      ),
      "REQUEST_INVALID",
    );
    expect(harness.post).not.toHaveBeenCalled();
  });

  it("does not expose dependency details or credential material in public errors", async () => {
    const secret = "credential-material-must-not-leak";
    const harness = await createCircleHarness({
      post: () => Promise.reject(new Error(`${secret} ${auth} ${cipher}`)),
    });

    let observed: unknown;
    try {
      await harness.service.executeAuthorizedPayment(harness.request);
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(ExecutorError);
    const serialized = JSON.stringify(observed);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(auth);
    expect(serialized).not.toContain(cipher);
    expect((observed as Error).stack).toBeUndefined();
  });
});
