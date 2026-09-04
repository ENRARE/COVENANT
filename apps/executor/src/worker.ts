import { createHash, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { ExecutorError } from "./errors.js";
import type { ExecutorService } from "./service.js";
import { parseExecutionRequest } from "./schemas.js";

const MAX_BODY_BYTES = 262_144;
const AUTH_HEADER = "x-covenant-worker-auth";

export type ExecutorWorkerOptions = Readonly<{
  service: ExecutorService;
  authToken: string;
  maxBodyBytes?: number;
  requestTimeoutMs?: number;
}>;

function tokenDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function validToken(value: string): boolean {
  return value.length >= 32 && value.length <= 512;
}

function authorized(request: IncomingMessage, expected: Buffer): boolean {
  const value = request.headers[AUTH_HEADER];
  if (typeof value !== "string") return false;
  const actual = tokenDigest(value);
  return timingSafeEqual(actual, expected);
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  const encoded = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.setHeader("content-length", Buffer.byteLength(encoded));
  response.end(encoded);
}

async function readBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  const declared = request.headers["content-length"];
  if (
    declared !== undefined &&
    (!/^\d+$/u.test(declared) || Number(declared) > maxBytes)
  )
    throw new ExecutorError("MALFORMED_EXECUTION_REQUEST");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > maxBytes) throw new ExecutorError("MALFORMED_EXECUTION_REQUEST");
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ExecutorError("MALFORMED_EXECUTION_REQUEST");
  }
}

/**
 * HTTP boundary for an independently deployed executor. The API can invoke
 * only the two reviewed operations and must present the internal channel
 * secret. Financial credentials remain in the process that constructs the
 * supplied ExecutorService.
 */
export function createExecutorWorkerServer(
  options: ExecutorWorkerOptions,
): Server {
  if (!validToken(options.authToken))
    throw new Error("EXECUTOR_WORKER_AUTH_TOKEN is invalid");
  const maxBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1024 ||
    maxBytes > MAX_BODY_BYTES
  )
    throw new Error("EXECUTOR_WORKER_MAX_BODY_BYTES is invalid");
  const expected = tokenDigest(options.authToken);
  const server = createServer((request, response) => {
    if (!authorized(request, expected)) {
      writeJson(response, 401, { error: "UNAUTHORIZED" });
      return;
    }
    if (request.method !== "POST") {
      writeJson(response, 404, { error: "NOT_FOUND" });
      return;
    }
    const requestUrl = new URL(request.url ?? "/", "http://executor.local");
    const path = requestUrl.pathname;
    if (requestUrl.search || requestUrl.hash) {
      writeJson(response, 404, { error: "NOT_FOUND" });
      return;
    }
    if (
      path !== "/simulate-authorized-payment" &&
      path !== "/execute-authorized-payment"
    ) {
      writeJson(response, 404, { error: "NOT_FOUND" });
      return;
    }
    if (
      (request.headers["content-type"] ?? "").split(";", 1)[0] !==
      "application/json"
    ) {
      writeJson(response, 415, { error: "UNSUPPORTED_MEDIA_TYPE" });
      return;
    }
    void (async () => {
      try {
        const body = await readBody(request, maxBytes);
        // Parse once at the boundary so unknown top-level fields and malformed
        // signed envelopes never reach the provider transport.
        const parsed = parseExecutionRequest(body);
        const result =
          path === "/simulate-authorized-payment"
            ? options.service.simulateAuthorizedPayment(parsed.raw)
            : options.service.executeAuthorizedPayment(parsed.raw);
        const resolved = await result;
        if (resolved.status === "SIMULATED")
          writeJson(response, 200, { status: "SIMULATED" });
        else
          writeJson(response, 200, {
            status: "SUBMITTED",
            transactionId: resolved.transactionId,
          });
      } catch (error: unknown) {
        const status =
          error instanceof ExecutorError &&
          error.code === "MALFORMED_EXECUTION_REQUEST"
            ? 400
            : 502;
        writeJson(response, status, {
          error:
            status === 400
              ? "MALFORMED_EXECUTION_REQUEST"
              : "EXECUTOR_REQUEST_FAILED",
        });
      }
    })();
  });
  server.requestTimeout = options.requestTimeoutMs ?? 30_000;
  server.headersTimeout = Math.min(server.requestTimeout, 10_000);
  return server;
}
