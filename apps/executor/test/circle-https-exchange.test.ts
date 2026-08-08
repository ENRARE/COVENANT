import { EventEmitter } from "node:events";
import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";

const httpsRequest = vi.hoisted(() => vi.fn());
vi.mock("node:https", () => ({ request: httpsRequest }));

import {
  CIRCLE_CONTRACT_EXECUTION_URL,
  CIRCLE_MAX_RESPONSE_BYTES,
  CIRCLE_ORIGIN,
  CIRCLE_TRANSACTION_STATUS_PATH_PREFIX,
  createCircleHttpsExchange,
  type CircleHttpRequest,
  type CircleTransactionStatusHttpRequest,
} from "../src/index.js";

const TRANSACTION_ID = "33333333-3333-4333-8333-333333333333";
const BODY = new TextEncoder().encode('{"offline":true}');
const bearerAuthorization = [
  "Bearer",
  ["synthetic", "circle", "test"].join("-"),
].join(" ");

class FakeRequest extends EventEmitter {
  readonly chunks: Uint8Array[] = [];

  write(chunk: Uint8Array): void {
    this.chunks.push(chunk);
  }

  end(): void {
    this.emit("finished");
  }

  destroy(error?: Error): void {
    if (error !== undefined) this.emit("error", error);
  }
}

class FakeResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = { "content-type": "application/json" };

  destroy(error?: Error): void {
    if (error !== undefined) this.emit("error", error);
  }
}

function postRequest(): CircleHttpRequest {
  return Object.freeze({
    method: "POST",
    url: CIRCLE_CONTRACT_EXECUTION_URL,
    headers: Object.freeze({
      accept: "application/json",
      authorization: bearerAuthorization,
      "content-type": "application/json",
    }),
    body: BODY,
    maximumResponseBytes: CIRCLE_MAX_RESPONSE_BYTES,
    redirects: 0,
    acceptContentEncoding: "identity",
  });
}

function getRequest(): CircleTransactionStatusHttpRequest {
  return Object.freeze({
    method: "GET",
    url: `${CIRCLE_ORIGIN}${CIRCLE_TRANSACTION_STATUS_PATH_PREFIX}${TRANSACTION_ID}`,
    headers: Object.freeze({
      accept: "application/json",
      authorization: bearerAuthorization,
    }),
    maximumResponseBytes: CIRCLE_MAX_RESPONSE_BYTES,
    redirects: 0,
    acceptContentEncoding: "identity",
  });
}

function successfulExchange() {
  const request = new FakeRequest();
  const response = new FakeResponse();
  httpsRequest.mockImplementation(
    (
      _options: unknown,
      callback: (incoming: FakeResponse) => void,
    ): FakeRequest => {
      callback(response);
      queueMicrotask(() => {
        response.emit("data", Buffer.from(BODY));
        response.emit("end");
      });
      return request;
    },
  );
  return { request };
}

afterEach(() => {
  vi.useRealTimers();
  httpsRequest.mockReset();
});

describe("narrow Circle HTTPS exchange", () => {
  it("sends POST only to the fixed TLS host and contract-execution path", async () => {
    const fake = successfulExchange();

    await expect(
      createCircleHttpsExchange().postContractExecution(postRequest()),
    ).resolves.toMatchObject({ status: 200 });

    expect(httpsRequest).toHaveBeenCalledWith(
      {
        hostname: "api.circle.com",
        port: 443,
        method: "POST",
        path: "/v1/w3s/developer/transactions/contractExecution",
        headers: {
          accept: "application/json",
          authorization: bearerAuthorization,
          "content-type": "application/json",
          "accept-encoding": "identity",
        },
      },
      expect.any(Function),
    );
    expect(
      Buffer.concat(fake.request.chunks.map((chunk) => Buffer.from(chunk))),
    ).toEqual(Buffer.from(BODY));
  });

  it("sends GET only for one validated persisted-provider UUID path", async () => {
    successfulExchange();

    await expect(
      createCircleHttpsExchange().getTransaction(getRequest()),
    ).resolves.toMatchObject({ status: 200 });

    expect(httpsRequest).toHaveBeenCalledWith(
      {
        hostname: "api.circle.com",
        port: 443,
        method: "GET",
        path: `${CIRCLE_TRANSACTION_STATUS_PATH_PREFIX}${TRANSACTION_ID}`,
        headers: {
          accept: "application/json",
          authorization: bearerAuthorization,
          "accept-encoding": "identity",
        },
      },
      expect.any(Function),
    );
  });

  it("rejects caller-selected host, path, method, redirect, and encoding", async () => {
    const exchange = createCircleHttpsExchange();
    const invalidPosts = [
      { ...postRequest(), url: "https://example.invalid/arbitrary" },
      { ...postRequest(), method: "PUT" },
      { ...postRequest(), redirects: 1 },
      { ...postRequest(), acceptContentEncoding: "gzip" },
    ] as unknown as CircleHttpRequest[];
    const invalidGets = [
      {
        ...getRequest(),
        url: `${CIRCLE_ORIGIN}/v1/w3s/transactions/not-a-uuid`,
      },
      {
        ...getRequest(),
        url: `https://user@api.circle.com${CIRCLE_TRANSACTION_STATUS_PATH_PREFIX}${TRANSACTION_ID}`,
      },
      { ...getRequest(), method: "POST" },
      { ...getRequest(), redirects: 1 },
      { ...getRequest(), acceptContentEncoding: "gzip" },
    ] as unknown as CircleTransactionStatusHttpRequest[];

    for (const request of invalidPosts) {
      expect(() => exchange.postContractExecution(request)).toThrow();
    }
    for (const request of invalidGets) {
      await expect(exchange.getTransaction(request)).rejects.toThrow();
    }
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it("bounds time and response bytes while sanitizing dependency failures", async () => {
    vi.useFakeTimers();
    const request = new FakeRequest();
    httpsRequest.mockReturnValue(request);
    const timedOut =
      createCircleHttpsExchange().postContractExecution(postRequest());
    const timeoutRejection = expect(timedOut).rejects.toThrow(
      "Circle HTTPS exchange failed",
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await timeoutRejection;

    vi.useRealTimers();
    const oversizedRequest = new FakeRequest();
    const oversizedResponse = new FakeResponse();
    httpsRequest.mockImplementation(
      (
        _options: unknown,
        callback: (incoming: FakeResponse) => void,
      ): FakeRequest => {
        callback(oversizedResponse);
        queueMicrotask(() => {
          oversizedResponse.emit(
            "data",
            Buffer.alloc(CIRCLE_MAX_RESPONSE_BYTES + 1),
          );
        });
        return oversizedRequest;
      },
    );
    await expect(
      createCircleHttpsExchange().postContractExecution(postRequest()),
    ).rejects.toThrow("Circle HTTPS exchange failed");
  });
});
