import { createHash } from "node:crypto";
import { TextEncoder } from "node:util";
import { isDeepStrictEqual } from "node:util";
import { encodeAbiParameters, hexToBytes, keccak256, type Hex } from "viem";
import { ExecutorError } from "../errors.js";
import type {
  TransactionTransport,
  TransactionTransportContext,
} from "../ports/transaction-transport.js";
import {
  assertVerifiedTransactionContext,
  markVerifiedTransactionSubmissionAttemptStarted,
} from "../ports/verified-transaction-context.js";
import type { AuthorizedTransactionRequest } from "../types.js";
import { sanitizedCircleError } from "./errors.js";
import {
  assertConfiguredContract,
  parseCircleAcceptedBody,
  parseCircleApiKey,
  parseCircleCiphertext,
  parseCircleConfig,
  parseCircleHttpResponse,
  parseCircleOperationRecord,
  parseFixedCircleTransaction,
  parseCircleUuidV4,
} from "./schemas.js";
import {
  CIRCLE_CONTRACT_EXECUTION_URL,
  CIRCLE_MAX_RESPONSE_BYTES,
  type CircleContractExecutionTransportDependencies,
  type CircleExecutionFingerprint,
  type CircleOperationRecord,
} from "./types.js";
import { EXECUTE_PAYMENT_SELECTOR } from "../calldata/prepare-execute-payment.js";

const textEncoder = new TextEncoder();
const circleOperationNamespace = textEncoder.encode(
  "COVENANT:CIRCLE:EXECUTION:V1",
);

function deriveCircleOperationKey(executionId: Hex): Hex {
  const digest = createHash("sha256")
    .update(circleOperationNamespace)
    .update(Uint8Array.of(0))
    .update(hexToBytes(executionId))
    .digest("hex");
  return `0x${digest}`;
}

function assertTrustedRequest(
  request: AuthorizedTransactionRequest,
  context: TransactionTransportContext | undefined,
): AuthorizedTransactionRequest & { data: Hex } {
  assertVerifiedTransactionContext(request, context);
  const parsed = parseFixedCircleTransaction(request);
  if (!parsed.data.startsWith(EXECUTE_PAYMENT_SELECTOR)) {
    throw new ExecutorError("REQUEST_INVALID");
  }
  return parsed;
}

function transactionDigest(request: AuthorizedTransactionRequest): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "bytes" },
      ],
      [request.chainId, request.to, request.value, request.data],
    ),
  );
}

function parseOperationRecord(
  value: unknown,
  expected: CircleExecutionFingerprint,
): CircleOperationRecord {
  const candidate = parseCircleOperationRecord(value);
  if (!isDeepStrictEqual(candidate.fingerprint, expected)) {
    throw new ExecutorError("EXECUTION_CONFLICT");
  }
  return candidate;
}

async function bestEffortRecordUnknown(
  dependencies: CircleContractExecutionTransportDependencies,
  operationKey: Hex,
  idempotencyKey: string,
): Promise<void> {
  try {
    await dependencies.operations.recordUnknown(operationKey, idempotencyKey);
  } catch {
    // The caller still receives an ambiguous result; repository details remain private.
  }
}

export function createCircleContractExecutionTransport(
  dependencies: CircleContractExecutionTransportDependencies,
): TransactionTransport {
  let config: ReturnType<typeof parseCircleConfig>;
  try {
    config = parseCircleConfig(dependencies.config);
  } catch {
    throw new ExecutorError("CONFIGURATION_UNAVAILABLE");
  }

  return Object.freeze({
    simulate(
      request: AuthorizedTransactionRequest,
      context?: TransactionTransportContext,
    ) {
      try {
        const trustedRequest = assertTrustedRequest(request, context);
        assertConfiguredContract(config.contractAddress, trustedRequest.to);
        return Promise.resolve(Object.freeze({ status: "SIMULATED" }));
      } catch (error) {
        return Promise.reject(sanitizedCircleError(error, "REQUEST_INVALID"));
      }
    },

    async submit(
      request: AuthorizedTransactionRequest,
      context?: TransactionTransportContext,
    ): Promise<unknown> {
      let executionId: Hex;
      let fingerprint: CircleExecutionFingerprint;
      let trustedRequest: AuthorizedTransactionRequest & { data: Hex };
      try {
        trustedRequest = assertTrustedRequest(request, context);
        if (context === undefined) throw new ExecutorError("REQUEST_INVALID");
        executionId = context.executionId;
        assertConfiguredContract(config.contractAddress, trustedRequest.to);
        fingerprint = Object.freeze({
          operationKey: deriveCircleOperationKey(executionId),
          executionId,
          transactionDigest: transactionDigest(trustedRequest),
          walletId: config.walletId,
          contractAddress: config.contractAddress,
          feeLevel: config.feeLevel,
        });
      } catch (error) {
        throw sanitizedCircleError(error, "REQUEST_INVALID");
      }

      let proposedUuid: string;
      try {
        proposedUuid = parseCircleUuidV4(dependencies.generateUuid());
      } catch {
        throw new ExecutorError("INTERNAL_UNAVAILABLE");
      }

      let operation: CircleOperationRecord;
      try {
        operation = parseOperationRecord(
          await dependencies.operations.prepare(fingerprint, proposedUuid),
          fingerprint,
        );
      } catch (error) {
        throw sanitizedCircleError(error, "INTERNAL_UNAVAILABLE");
      }
      if (operation.state === "ACCEPTED") {
        return Object.freeze({
          status: "SUBMITTED",
          transactionId: operation.providerTransactionId,
        });
      }
      if (operation.state !== "PREPARED") {
        throw new ExecutorError("EXECUTION_NOT_RETRYABLE");
      }

      let authenticationMaterial: string;
      let ciphertext: string;
      try {
        authenticationMaterial = parseCircleApiKey(
          await dependencies.credentials.getApiKey(),
        );
        ciphertext = parseCircleCiphertext(
          await dependencies.credentials.createEntitySecretCiphertext(),
        );
      } catch {
        throw new ExecutorError("CREDENTIAL_UNAVAILABLE");
      }

      const requestBody = Object.freeze({
        walletId: config.walletId,
        contractAddress: config.contractAddress,
        callData: trustedRequest.data,
        idempotencyKey: operation.idempotencyKey,
        entitySecretCiphertext: ciphertext,
        feeLevel: config.feeLevel,
      });
      let body: Uint8Array;
      try {
        body = textEncoder.encode(JSON.stringify(requestBody));
      } catch {
        throw new ExecutorError("INTERNAL_UNAVAILABLE");
      }

      try {
        const started = parseOperationRecord(
          await dependencies.operations.markSubmissionAttemptStarted(
            fingerprint.operationKey,
            operation.idempotencyKey,
          ),
          fingerprint,
        );
        if (started.state !== "SUBMISSION_ATTEMPT_STARTED") {
          throw new ExecutorError("INTERNAL_UNAVAILABLE");
        }
      } catch (error) {
        throw sanitizedCircleError(error, "INTERNAL_UNAVAILABLE");
      }

      let rawResponse: unknown;
      try {
        markVerifiedTransactionSubmissionAttemptStarted(request, context);
        rawResponse = await dependencies.http.postContractExecution(
          Object.freeze({
            method: "POST",
            url: CIRCLE_CONTRACT_EXECUTION_URL,
            headers: Object.freeze({
              accept: "application/json",
              authorization: `Bearer ${authenticationMaterial}`,
              "content-type": "application/json",
            }),
            body,
            maximumResponseBytes: CIRCLE_MAX_RESPONSE_BYTES,
            redirects: 0,
            acceptContentEncoding: "identity",
          }),
        );
      } catch {
        await bestEffortRecordUnknown(
          dependencies,
          fingerprint.operationKey,
          operation.idempotencyKey,
        );
        return Object.freeze({ status: "AMBIGUOUS" });
      }

      let response: ReturnType<typeof parseCircleHttpResponse>;
      try {
        response = parseCircleHttpResponse(rawResponse);
      } catch {
        await bestEffortRecordUnknown(
          dependencies,
          fingerprint.operationKey,
          operation.idempotencyKey,
        );
        return Object.freeze({ status: "AMBIGUOUS" });
      }

      if (response.status === 201) {
        let accepted: ReturnType<typeof parseCircleAcceptedBody>;
        try {
          accepted = parseCircleAcceptedBody(response.body);
        } catch {
          await bestEffortRecordUnknown(
            dependencies,
            fingerprint.operationKey,
            operation.idempotencyKey,
          );
          return Object.freeze({ status: "AMBIGUOUS" });
        }
        try {
          const persisted = parseOperationRecord(
            await dependencies.operations.recordAccepted(
              fingerprint.operationKey,
              operation.idempotencyKey,
              accepted.id,
              accepted.state,
            ),
            fingerprint,
          );
          if (
            persisted.state !== "ACCEPTED" ||
            persisted.providerTransactionId !== accepted.id ||
            persisted.providerState !== accepted.state
          ) {
            throw new ExecutorError("EXECUTION_CONFLICT");
          }
        } catch {
          await bestEffortRecordUnknown(
            dependencies,
            fingerprint.operationKey,
            operation.idempotencyKey,
          );
          return Object.freeze({ status: "AMBIGUOUS" });
        }
        return Object.freeze({
          status: "SUBMITTED",
          transactionId: accepted.id,
        });
      }

      await bestEffortRecordUnknown(
        dependencies,
        fingerprint.operationKey,
        operation.idempotencyKey,
      );
      return Object.freeze({ status: "AMBIGUOUS" });
    },
  });
}
