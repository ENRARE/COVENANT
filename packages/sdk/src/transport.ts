import {
  CovenantApiError,
  CovenantAuthenticationError,
  CovenantConflictError,
  CovenantConfigurationError,
  CovenantRateLimitError,
  CovenantTimeoutError,
  CovenantTransportError,
  CovenantValidationError,
} from "./errors.js";
import type { CovenantOptions, FetchLike, RequestOptions } from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 25;
const TIMEOUT_MARKER = new Error("covenant-sdk-timeout");

type Method = "GET" | "POST" | "DELETE";

type InternalRequestOptions = RequestOptions &
  Readonly<{ mutationRetrySafe?: boolean }>;

type ParsedError = Readonly<{
  type: string;
  code: string;
  message: string;
  requestId?: string;
}>;

function isLocalhost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]" ||
    normalized === "::1"
  );
}

function normalizeBaseUrl(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new CovenantConfigurationError("baseUrl is required.");
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new CovenantConfigurationError("baseUrl must be a valid URL.");
  }
  if (parsed.username !== "" || parsed.password !== "")
    throw new CovenantConfigurationError(
      "baseUrl must not contain credentials.",
    );
  if (parsed.search !== "" || parsed.hash !== "")
    throw new CovenantConfigurationError(
      "baseUrl must not contain query or hash components.",
    );
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && isLocalhost(parsed.hostname))
  )
    throw new CovenantConfigurationError(
      "HTTPS is required except for localhost development URLs.",
    );
  const path = parsed.pathname.replace(/\/+$/u, "");
  return `${parsed.origin}${path}`;
}

function validateApiKey(value: string): string {
  if (typeof value !== "string" || !/^cov_test_[A-Za-z0-9_-]{8,}$/u.test(value))
    throw new CovenantConfigurationError(
      "apiKey must be a valid cov_test_ development API key.",
    );
  return value;
}

function validateBoundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0 || resolved > maximum)
    throw new CovenantConfigurationError(
      `${label} is outside its allowed range.`,
    );
  return resolved;
}

function safeField(value: unknown, fallback: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    hasControlCharacters(value)
  )
    return fallback;
  return value;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseHeader(response: Response, name: string): string | undefined {
  const value = response.headers.get(name);
  return value ?? undefined;
}

function parseRetryAfter(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (/^\d+$/u.test(value)) return Math.min(60_000, Number(value) * 1000);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.min(60_000, Math.max(0, at - Date.now()));
}

function parseErrorPayload(
  value: unknown,
  apiKey: string,
  fallbackRequestId: string | undefined,
): ParsedError {
  if (!isRecord(value) || !isRecord(value.error))
    return {
      type: "server_error",
      code: "HTTP_ERROR",
      message: "The Covenant API returned an error.",
      ...(fallbackRequestId === undefined
        ? {}
        : { requestId: fallbackRequestId }),
    };
  const error = value.error;
  const rawMessage = safeField(
    error.message,
    "The Covenant API returned an error.",
    512,
  );
  const message = rawMessage.includes(apiKey)
    ? "The Covenant API returned an error."
    : rawMessage;
  const requestId = safeField(error.requestId, "", 128);
  return {
    type: safeField(error.type, "server_error", 64),
    code: safeField(error.code, "HTTP_ERROR", 128),
    message,
    ...(requestId === ""
      ? fallbackRequestId === undefined
        ? {}
        : { requestId: fallbackRequestId }
      : { requestId }),
  };
}

function apiError(
  status: number,
  parsed: ParsedError,
  retryAfterMs: number | undefined,
): CovenantApiError {
  const fields = {
    type: parsed.type,
    code: parsed.code,
    message: parsed.message,
    status,
    ...(parsed.requestId === undefined ? {} : { requestId: parsed.requestId }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  } as const;
  if (status === 401) return new CovenantAuthenticationError(fields);
  if (status === 400 || status === 422)
    return new CovenantValidationError(fields);
  if (status === 409) return new CovenantConflictError(fields);
  if (status === 429) return new CovenantRateLimitError(fields);
  return new CovenantApiError(fields);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class HttpTransport {
  readonly #projectKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;
  readonly #userAgent: string;
  readonly #maxRetries: number;

  constructor(options: CovenantOptions) {
    this.#projectKey = validateApiKey(options.apiKey);
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#timeoutMs = validateBoundedInteger(
      options.timeoutMs,
      DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
      "timeoutMs",
    );
    if (this.#timeoutMs < 1)
      throw new CovenantConfigurationError(
        "timeoutMs must be greater than zero.",
      );
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#userAgent =
      options.userAgent === undefined
        ? "@covenant/sdk/0.1.0"
        : safeField(options.userAgent, "", 256);
    if (options.userAgent !== undefined && this.#userAgent === "")
      throw new CovenantConfigurationError("userAgent is invalid.");
    this.#maxRetries = validateBoundedInteger(
      options.maxRetries,
      DEFAULT_MAX_RETRIES,
      MAX_RETRIES,
      "maxRetries",
    );
  }

  async request<T>(
    method: Method,
    path: string,
    body?: unknown,
    options: InternalRequestOptions = {},
  ): Promise<T> {
    if (!path.startsWith("/") || path.includes("//"))
      throw new CovenantConfigurationError("SDK route path is invalid.");
    const idempotencyKey = options.idempotencyKey;
    if (
      idempotencyKey !== undefined &&
      (idempotencyKey.length < 1 ||
        idempotencyKey.length > 256 ||
        hasControlCharacters(idempotencyKey))
    )
      throw new CovenantValidationError({
        type: "invalid_request",
        code: "INVALID_IDEMPOTENCY_KEY",
        message: "idempotencyKey must be 1-256 printable characters.",
      });
    const headers: Record<string, string> = {
      accept: "application/json",
      "x-api-key": this.#projectKey,
      "user-agent": this.#userAgent,
    };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (idempotencyKey !== undefined)
      headers["idempotency-key"] = idempotencyKey;
    const encodedBody = body === undefined ? undefined : JSON.stringify(body);
    const canRetry =
      method === "GET" ||
      (idempotencyKey !== undefined && options.mutationRetrySafe === true);
    let attempt = 0;
    while (attempt <= this.#maxRetries) {
      try {
        const response = await this.fetchWithTimeout(
          `${this.#baseUrl}${path}`,
          method,
          headers,
          encodedBody,
        );
        if (response.status >= 200 && response.status < 300)
          return (await this.decode(response, undefined)) as T;
        const retryAfterMs = parseRetryAfter(
          responseHeader(response, "retry-after"),
        );
        if (
          canRetry &&
          attempt < this.#maxRetries &&
          isRetryableStatus(response.status)
        ) {
          attempt += 1;
          await delay(retryAfterMs ?? RETRY_DELAY_MS * 2 ** (attempt - 1));
          continue;
        }
        const requestId = responseHeader(response, "x-request-id");
        const payload = await this.decode(response, requestId);
        throw apiError(
          response.status,
          parseErrorPayload(payload, this.#projectKey, requestId),
          retryAfterMs,
        );
      } catch (error) {
        if (error instanceof CovenantApiError) throw error;
        const timedOut = error === TIMEOUT_MARKER;
        if (
          canRetry &&
          attempt < this.#maxRetries &&
          (timedOut || error instanceof Error)
        ) {
          attempt += 1;
          await delay(RETRY_DELAY_MS * 2 ** (attempt - 1));
          continue;
        }
        if (timedOut) throw new CovenantTimeoutError();
        throw new CovenantTransportError();
      }
    }
    throw new CovenantTransportError();
  }

  private async fetchWithTimeout(
    url: string,
    method: Method,
    headers: Record<string, string>,
    body: string | undefined,
  ): Promise<Response> {
    const controller = new AbortController();
    const init: RequestInit = {
      method,
      headers,
      signal: controller.signal,
      ...(body === undefined ? {} : { body }),
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<Response>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(TIMEOUT_MARKER);
      }, this.#timeoutMs);
    });
    try {
      return await Promise.race([this.#fetch(url, init), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async decode(
    response: Response,
    _requestId: string | undefined,
  ): Promise<unknown> {
    if (response.status === 204) return undefined;
    const text = await response.text();
    if (text.trim() === "") return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      if (response.status >= 200 && response.status < 300)
        throw new CovenantApiError({
          type: "server_error",
          code: "INVALID_RESPONSE",
          message: "The Covenant API returned an invalid response.",
          status: response.status,
        });
      return undefined;
    }
  }
}
