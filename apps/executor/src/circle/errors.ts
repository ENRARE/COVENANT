import { ExecutorError, type ExecutorErrorCode } from "../errors.js";

export function circleFailure(code: ExecutorErrorCode): never {
  throw new ExecutorError(code);
}

export function sanitizedCircleError(
  error: unknown,
  fallback: ExecutorErrorCode,
): ExecutorError {
  if (error instanceof ExecutorError) return new ExecutorError(error.code);
  return new ExecutorError(fallback);
}
