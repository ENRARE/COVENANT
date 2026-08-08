import { ExecutorError } from "../errors.js";
import {
  parseCircleApiKey,
  parseCircleHttpResponse,
  parseCircleOperationKey,
  parseCircleOperationRecord,
  parseCircleStatusBody,
} from "./schemas.js";
import {
  CIRCLE_MAX_RESPONSE_BYTES,
  CIRCLE_ORIGIN,
  CIRCLE_TRANSACTION_STATUS_PATH_PREFIX,
  type CircleTransactionObservation,
  type CircleTransactionStatusReader,
  type CircleTransactionStatusReaderDependencies,
} from "./types.js";

export function createCircleTransactionStatusReader(
  dependencies: CircleTransactionStatusReaderDependencies,
): CircleTransactionStatusReader {
  return Object.freeze({
    async observeKnownTransaction(
      rawOperationKey: unknown,
    ): Promise<CircleTransactionObservation> {
      let operationKey: ReturnType<typeof parseCircleOperationKey>;
      let providerTransactionId: string;
      try {
        operationKey = parseCircleOperationKey(rawOperationKey);
        const operation = parseCircleOperationRecord(
          await dependencies.operations.get(operationKey),
        );
        if (
          operation.fingerprint.operationKey !== operationKey ||
          operation.state !== "ACCEPTED"
        ) {
          throw new ExecutorError("EXECUTION_NOT_RETRYABLE");
        }
        providerTransactionId = operation.providerTransactionId;
      } catch (error) {
        if (error instanceof ExecutorError) {
          throw new ExecutorError(error.code);
        }
        throw new ExecutorError("CIRCLE_STATUS_UNKNOWN");
      }

      let apiCredential: string;
      try {
        apiCredential = parseCircleApiKey(
          await dependencies.credentials.getApiKey(),
        );
      } catch {
        throw new ExecutorError("CREDENTIAL_UNAVAILABLE");
      }

      let rawResponse: unknown;
      try {
        rawResponse = await dependencies.http.getTransaction(
          Object.freeze({
            method: "GET",
            url: `${CIRCLE_ORIGIN}${CIRCLE_TRANSACTION_STATUS_PATH_PREFIX}${providerTransactionId}`,
            headers: Object.freeze({
              accept: "application/json",
              authorization: `Bearer ${apiCredential}`,
            }),
            maximumResponseBytes: CIRCLE_MAX_RESPONSE_BYTES,
            redirects: 0,
            acceptContentEncoding: "identity",
          }),
        );
      } catch {
        throw new ExecutorError("CIRCLE_TRANSPORT_FAILED");
      }

      try {
        const response = parseCircleHttpResponse(rawResponse);
        if (response.status !== 200) {
          throw new ExecutorError("CIRCLE_STATUS_UNKNOWN");
        }
        const observed = parseCircleStatusBody(
          response.body,
          providerTransactionId,
        );
        return Object.freeze({
          status: "OBSERVED",
          transactionId: observed.id,
          providerState: observed.state,
          ...(observed.transactionHash === undefined
            ? {}
            : { transactionHash: observed.transactionHash }),
        });
      } catch (error) {
        if (error instanceof ExecutorError) {
          throw new ExecutorError(error.code);
        }
        throw new ExecutorError("CIRCLE_RESPONSE_INVALID");
      }
    },
  });
}
