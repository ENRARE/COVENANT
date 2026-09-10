import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createIsolatedExecutorAdapter,
  type ExecutionAdapter,
  type RuntimeOperation,
} from "@covenant/runtime";
import { bytes32Schema } from "@covenant/spec";
import { z } from "zod";

const workerRouteSchema = z
  .object({
    projectId: bytes32Schema,
    covenantId: bytes32Schema,
    workerUrl: z.string().trim().min(1),
  })
  .strict();
const workerRoutesSchema = z
  .object({ entries: z.array(workerRouteSchema).min(1) })
  .strict();

function workerUrl(value: string, transport: string | undefined): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("COVENANT_EXECUTOR_WORKER_URL is invalid");
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("COVENANT_EXECUTOR_WORKER_URL must be an origin URL");
  if (transport === "railway-private") {
    if (url.protocol !== "http:" || !url.hostname.endsWith(".railway.internal"))
      throw new Error(
        "Railway private executor URLs must use HTTP on .railway.internal",
      );
  } else if (
    !["https:", "http:"].includes(url.protocol) ||
    (url.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  )
    throw new Error("COVENANT_EXECUTOR_WORKER_URL must use HTTPS");
  return url;
}

const workerTransportValue =
  process.env.COVENANT_EXECUTOR_WORKER_TRANSPORT?.trim();
if (
  workerTransportValue !== undefined &&
  workerTransportValue !== "" &&
  workerTransportValue !== "railway-private"
)
  throw new Error("COVENANT_EXECUTOR_WORKER_TRANSPORT is invalid");

const workerAuthTokenValue =
  process.env.COVENANT_EXECUTOR_WORKER_AUTH_TOKEN?.trim();
if (workerAuthTokenValue === undefined || workerAuthTokenValue.length < 32)
  throw new Error("COVENANT_EXECUTOR_WORKER_AUTH_TOKEN is required");
const workerAuthToken: string = workerAuthTokenValue;

async function callWorker(
  url: URL,
  path: string,
  request: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(new URL(path, url), {
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

function adapterFor(url: URL): ExecutionAdapter {
  return createIsolatedExecutorAdapter({
    simulateAuthorizedPayment: (request) =>
      callWorker(url, "/simulate-authorized-payment", request),
    executeAuthorizedPayment: (request) =>
      callWorker(url, "/execute-authorized-payment", request),
  });
}

function routeKey(projectId: string, covenantId: string): string {
  return `${projectId}:${covenantId}`.toLowerCase();
}

function routedAdapter(filename: string): ExecutionAdapter {
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(resolve(filename), "utf8"));
  } catch {
    throw new Error("COVENANT_EXECUTOR_WORKER_ROUTES_FILE could not be loaded");
  }
  const parsed = workerRoutesSchema.parse(input);
  const routes = new Map<string, ExecutionAdapter>();
  for (const route of parsed.entries) {
    const key = routeKey(route.projectId, route.covenantId);
    if (routes.has(key)) throw new Error("Duplicate isolated executor route");
    routes.set(
      key,
      adapterFor(workerUrl(route.workerUrl, workerTransportValue)),
    );
  }
  const select = (operation: RuntimeOperation): ExecutionAdapter => {
    const selected = routes.get(
      routeKey(operation.projectId, operation.covenantId),
    );
    if (selected === undefined)
      throw new Error("Isolated executor route is unavailable");
    return selected;
  };
  return Object.freeze({
    async simulate(operation) {
      return select(operation).simulate(operation);
    },
    async submit(operation) {
      return select(operation).submit(operation);
    },
  });
}

const workerRoutesFile =
  process.env.COVENANT_EXECUTOR_WORKER_ROUTES_FILE?.trim();
const adapter =
  workerRoutesFile === undefined || workerRoutesFile === ""
    ? (() => {
        const value = process.env.COVENANT_EXECUTOR_WORKER_URL?.trim();
        if (value === undefined || value === "")
          throw new Error("COVENANT_EXECUTOR_WORKER_URL is required");
        return adapterFor(workerUrl(value, workerTransportValue));
      })()
    : routedAdapter(workerRoutesFile);

export default adapter;
