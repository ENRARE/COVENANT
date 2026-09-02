import { CovenantDomainError } from "@covenant/core";
import { RuntimeError } from "@covenant/runtime";
import { ZodError } from "zod";

export type ApiErrorType =
  | "invalid_request"
  | "unauthorized"
  | "not_found"
  | "conflict"
  | "invalid_state"
  | "server_error";

export class ApiError extends Error {
  constructor(
    readonly type: ApiErrorType,
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiError(
  type: ApiErrorType,
  code: string,
  message: string,
  status: number,
): never {
  throw new ApiError(type, code, message, status);
}

const CORE_MESSAGES: Record<string, string> = {
  INVALID_COVENANT: "Covenant request is invalid.",
  INVALID_TIMESTAMP: "Timestamp is invalid.",
  INVALID_TRANSITION: "The requested lifecycle transition is not allowed.",
  PROJECT_MISMATCH: "The resource does not belong to this project.",
  AUTHORIZATION_REQUIRED: "Valid authorization evidence is required.",
  AUTHORIZATION_EXPIRED: "Authorization evidence is expired.",
  EXECUTION_ALREADY_STARTED: "Covenant execution has already started.",
  CANCELLATION_NOT_ALLOWED: "Covenant cancellation is not allowed.",
  COVENANT_EXPIRED: "The Covenant has expired.",
  EVIDENCE_MISMATCH: "Evidence does not match the Covenant.",
  EVIDENCE_CONFLICT: "Evidence contains conflicting observations.",
  UNSUPPORTED_NETWORK: "Only Arc Testnet is supported.",
  UNSUPPORTED_ASSET: "Only six-decimal USDC is supported.",
};

export function mapError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError)
    return new ApiError(
      "invalid_request",
      "INVALID_REQUEST",
      "Request validation failed.",
      400,
    );
  if (error instanceof CovenantDomainError) {
    const code = error.code;
    const status: ApiErrorType = ["PROJECT_MISMATCH"].includes(code)
      ? "conflict"
      : [
            "AUTHORIZATION_REQUIRED",
            "AUTHORIZATION_EXPIRED",
            "CANCELLATION_NOT_ALLOWED",
            "EXECUTION_ALREADY_STARTED",
            "INVALID_TRANSITION",
            "COVENANT_EXPIRED",
          ].includes(code)
        ? "invalid_state"
        : "invalid_request";
    return new ApiError(
      status,
      code,
      CORE_MESSAGES[code] ?? "Covenant operation failed.",
      status === "conflict" ? 404 : status === "invalid_state" ? 409 : 400,
    );
  }
  if (error instanceof RuntimeError) {
    const status: ApiErrorType =
      error.code === "RUNTIME_NOT_FOUND"
        ? "not_found"
        : error.code === "RUNTIME_CONFLICT"
          ? "conflict"
          : "invalid_state";
    return new ApiError(
      status,
      error.code,
      error.code === "RUNTIME_NOT_FOUND"
        ? "Resource was not found."
        : error.code === "RUNTIME_CONFLICT"
          ? "The request conflicts with the current resource."
          : "Runtime operation is not currently available.",
      status === "not_found" ? 404 : 409,
    );
  }
  return new ApiError(
    "server_error",
    "INTERNAL_ERROR",
    "An unexpected server error occurred.",
    500,
  );
}
