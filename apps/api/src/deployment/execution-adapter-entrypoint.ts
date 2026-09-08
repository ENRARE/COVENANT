import { createIsolatedExecutorAdapter } from "@covenant/runtime";

const workerUrlValue = process.env.COVENANT_EXECUTOR_WORKER_URL?.trim();
if (workerUrlValue === undefined || workerUrlValue.length === 0)
  throw new Error("COVENANT_EXECUTOR_WORKER_URL is required");

let workerUrl: URL;
try {
  workerUrl = new URL(workerUrlValue);
} catch {
  throw new Error("COVENANT_EXECUTOR_WORKER_URL is invalid");
}
if (
  workerUrl.username ||
  workerUrl.password ||
  workerUrl.pathname !== "/" ||
  workerUrl.search ||
  workerUrl.hash
)
  throw new Error("COVENANT_EXECUTOR_WORKER_URL must be an origin URL");

const workerTransportValue =
  process.env.COVENANT_EXECUTOR_WORKER_TRANSPORT?.trim();
if (
  workerTransportValue !== undefined &&
  workerTransportValue !== "" &&
  workerTransportValue !== "railway-private"
)
  throw new Error("COVENANT_EXECUTOR_WORKER_TRANSPORT is invalid");

if (workerTransportValue === "railway-private") {
  if (
    workerUrl.protocol !== "http:" ||
    !workerUrl.hostname.endsWith(".railway.internal")
  )
    throw new Error(
      "Railway private executor URLs must use HTTP on .railway.internal",
    );
} else if (
  !["https:", "http:"].includes(workerUrl.protocol) ||
  (workerUrl.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(workerUrl.hostname))
)
  throw new Error("COVENANT_EXECUTOR_WORKER_URL must use HTTPS");

const workerAuthTokenValue =
  process.env.COVENANT_EXECUTOR_WORKER_AUTH_TOKEN?.trim();
if (workerAuthTokenValue === undefined || workerAuthTokenValue.length < 32)
  throw new Error("COVENANT_EXECUTOR_WORKER_AUTH_TOKEN is required");
const workerAuthToken: string = workerAuthTokenValue;

const endpoint = (path: string): string => new URL(path, workerUrl).toString();

async function callWorker(path: string, request: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(endpoint(path), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-covenant-worker-auth": workerAuthToken,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Isolated executor worker is unavailable");
  }
  if (!response.ok)
    throw new Error("Isolated executor worker rejected request");
  const contentType = response.headers.get("content-type");
  if (
    contentType === null ||
    contentType.split(";", 1)[0]?.trim() !== "application/json"
  )
    throw new Error("Isolated executor worker returned invalid content type");
  let body: string;
  try {
    body = await response.text();
  } catch {
    throw new Error("Isolated executor worker returned invalid JSON");
  }
  if (body.length > 32_768)
    throw new Error("Isolated executor worker response is too large");
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("Isolated executor worker returned invalid JSON");
  }
}

export default createIsolatedExecutorAdapter({
  simulateAuthorizedPayment: (request) =>
    callWorker("/simulate-authorized-payment", request),
  executeAuthorizedPayment: (request) =>
    callWorker("/execute-authorized-payment", request),
});
