import type { IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { parseCircleUuidV4 } from "./schemas.js";
import {
  CIRCLE_CONTRACT_EXECUTION_PATH,
  CIRCLE_CONTRACT_EXECUTION_URL,
  CIRCLE_MAX_RESPONSE_BYTES,
  CIRCLE_ORIGIN,
  CIRCLE_TRANSACTION_STATUS_PATH_PREFIX,
  type CircleHttpExchange,
  type CircleHttpRequest,
  type CircleHttpResponse,
  type CircleTransactionStatusHttpExchange,
  type CircleTransactionStatusHttpRequest,
} from "./types.js";

const MAX_REQUEST_TIMEOUT_MS = 15_000;

function headersOf(headers: IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== "string")
      throw new Error("Unexpected response header");
    result[key] = value;
  }
  return result;
}

function exchange(
  method: "GET" | "POST",
  path: string,
  headers: Record<string, string>,
  body: Uint8Array | undefined,
): Promise<CircleHttpResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (failure: Error | undefined, value?: CircleHttpResponse) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (failure !== undefined) {
        reject(failure);
        return;
      }
      if (value === undefined) {
        reject(new Error("Circle HTTPS exchange failed"));
        return;
      }
      resolve(value);
    };
    const fail = () => {
      finish(new Error("Circle HTTPS exchange failed"));
    };
    try {
      const request = httpsRequest(
        {
          hostname: "api.circle.com",
          port: 443,
          method,
          path,
          headers: { ...headers, "accept-encoding": "identity" },
        },
        (response) => {
          const chunks: Buffer[] = [];
          let total = 0;
          response.on("data", (chunk: Buffer) => {
            total += chunk.byteLength;
            if (total > CIRCLE_MAX_RESPONSE_BYTES) {
              response.destroy(new Error("Circle response is too large"));
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            try {
              finish(undefined, {
                status: response.statusCode ?? 0,
                headers: headersOf(response.headers),
                body: new Uint8Array(Buffer.concat(chunks)),
              });
            } catch {
              fail();
            }
          });
          response.on("error", fail);
        },
      );
      timer = setTimeout(() => {
        request.destroy(new Error("Circle request timed out"));
      }, MAX_REQUEST_TIMEOUT_MS);
      request.once("error", fail);
      if (body !== undefined) request.write(body);
      request.end();
    } catch {
      fail();
    }
  });
}

function assertPost(request: unknown): asserts request is CircleHttpRequest {
  if (typeof request !== "object" || request === null) {
    throw new Error("Circle POST request is not fixed");
  }
  const candidate = request as Record<string, unknown>;
  if (
    candidate.method !== "POST" ||
    candidate.url !== CIRCLE_CONTRACT_EXECUTION_URL ||
    candidate.maximumResponseBytes !== CIRCLE_MAX_RESPONSE_BYTES ||
    candidate.redirects !== 0 ||
    candidate.acceptContentEncoding !== "identity"
  ) {
    throw new Error("Circle POST request is not fixed");
  }
}

function statusPath(url: string): string {
  const parsed = new URL(url);
  if (
    parsed.origin !== CIRCLE_ORIGIN ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !parsed.pathname.startsWith(CIRCLE_TRANSACTION_STATUS_PATH_PREFIX)
  ) {
    throw new Error("Circle status URL is not fixed");
  }
  parseCircleUuidV4(
    parsed.pathname.slice(CIRCLE_TRANSACTION_STATUS_PATH_PREFIX.length),
  );
  return parsed.pathname;
}

export function createCircleHttpsExchange(): CircleHttpExchange &
  CircleTransactionStatusHttpExchange {
  return Object.freeze({
    postContractExecution(request: CircleHttpRequest) {
      assertPost(request);
      return exchange(
        "POST",
        CIRCLE_CONTRACT_EXECUTION_PATH,
        {
          accept: request.headers.accept,
          authorization: request.headers.authorization,
          "content-type": request.headers["content-type"],
        },
        request.body,
      );
    },
    getTransaction(request: CircleTransactionStatusHttpRequest) {
      const candidate = request as unknown as Record<string, unknown>;
      if (
        candidate.method !== "GET" ||
        candidate.maximumResponseBytes !== CIRCLE_MAX_RESPONSE_BYTES ||
        candidate.redirects !== 0 ||
        candidate.acceptContentEncoding !== "identity"
      ) {
        return Promise.reject(new Error("Circle GET request is not fixed"));
      }
      let path: string;
      try {
        path = statusPath(request.url);
      } catch {
        return Promise.reject(new Error("Circle status URL is not fixed"));
      }
      return exchange(
        "GET",
        path,
        {
          accept: request.headers.accept,
          authorization: request.headers.authorization,
        },
        undefined,
      );
    },
  });
}
