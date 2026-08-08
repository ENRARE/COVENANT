import type { Address, Hex } from "viem";

export const CIRCLE_ORIGIN = "https://api.circle.com" as const;
export const CIRCLE_CONTRACT_EXECUTION_PATH =
  "/v1/w3s/developer/transactions/contractExecution" as const;
export const CIRCLE_CONTRACT_EXECUTION_URL =
  `${CIRCLE_ORIGIN}${CIRCLE_CONTRACT_EXECUTION_PATH}` as const;
export const CIRCLE_TRANSACTION_STATUS_PATH_PREFIX =
  "/v1/w3s/transactions/" as const;
export const CIRCLE_MAX_RESPONSE_BYTES = 65_536;

export const CIRCLE_TRANSACTION_STATES = [
  "INITIATED",
  "CLEARED",
  "QUEUED",
  "SENT",
  "STUCK",
  "CONFIRMED",
  "COMPLETE",
  "FAILED",
  "DENIED",
  "CANCELLED",
] as const;

export type CircleTransactionState = (typeof CIRCLE_TRANSACTION_STATES)[number];

export type CircleHttpRequest = Readonly<{
  method: "POST";
  url: typeof CIRCLE_CONTRACT_EXECUTION_URL;
  headers: Readonly<{
    accept: "application/json";
    authorization: string;
    "content-type": "application/json";
  }>;
  body: Uint8Array;
  maximumResponseBytes: typeof CIRCLE_MAX_RESPONSE_BYTES;
  redirects: 0;
  acceptContentEncoding: "identity";
}>;

export type CircleHttpResponse = Readonly<{
  status: number;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
}>;

export type CircleHttpExchange = {
  postContractExecution(request: CircleHttpRequest): Promise<unknown>;
};

export type CircleTransactionStatusHttpRequest = Readonly<{
  method: "GET";
  url: string;
  headers: Readonly<{
    accept: "application/json";
    authorization: string;
  }>;
  maximumResponseBytes: typeof CIRCLE_MAX_RESPONSE_BYTES;
  redirects: 0;
  acceptContentEncoding: "identity";
}>;

export type CircleTransactionStatusHttpExchange = {
  getTransaction(request: CircleTransactionStatusHttpRequest): Promise<unknown>;
};

export type CircleCredentialProvider = {
  getApiKey(): unknown;
  createEntitySecretCiphertext(): unknown;
};

export type CircleApiKeyProvider = Pick<CircleCredentialProvider, "getApiKey">;

export type CircleExecutionFingerprint = Readonly<{
  operationKey: Hex;
  executionId: Hex;
  transactionDigest: Hex;
  walletId: string;
  contractAddress: Address;
  feeLevel: string;
}>;

type CircleOperationRecordBase = Readonly<{
  fingerprint: CircleExecutionFingerprint;
  idempotencyKey: string;
}>;

export type CircleOperationRecord = CircleOperationRecordBase &
  (
    | Readonly<{ state: "PREPARED"; attemptCount: 0 }>
    | Readonly<{ state: "SUBMISSION_ATTEMPT_STARTED"; attemptCount: 1 }>
    | Readonly<{ state: "UNKNOWN"; attemptCount: 1 }>
    | Readonly<{
        state: "ACCEPTED";
        attemptCount: 1;
        providerTransactionId: string;
        providerState: CircleTransactionState;
      }>
  );

export type CircleOperationRepository = {
  get(operationKey: Hex): Promise<unknown>;
  prepare(
    fingerprint: CircleExecutionFingerprint,
    idempotencyKey: string,
  ): Promise<unknown>;
  markSubmissionAttemptStarted(
    operationKey: Hex,
    expectedIdempotencyKey: string,
  ): Promise<unknown>;
  recordAccepted(
    operationKey: Hex,
    expectedIdempotencyKey: string,
    providerTransactionId: string,
    providerState: CircleTransactionState,
  ): Promise<unknown>;
  recordUnknown(
    operationKey: Hex,
    expectedIdempotencyKey: string,
  ): Promise<unknown>;
};

export type CircleTransactionObservation = Readonly<{
  status: "OBSERVED";
  transactionId: string;
  providerState: CircleTransactionState;
  transactionHash?: Hex;
}>;

export type CircleTransactionStatusReader = {
  observeKnownTransaction(
    operationKey: unknown,
  ): Promise<CircleTransactionObservation>;
};

export type CircleTransactionStatusReaderDependencies = Readonly<{
  credentials: CircleApiKeyProvider;
  http: CircleTransactionStatusHttpExchange;
  operations: CircleOperationRepository;
}>;

export type CircleContractExecutionTransportConfig = Readonly<{
  walletId: string;
  contractAddress: Address;
  feeLevel: string;
}>;

export type CircleContractExecutionTransportDependencies = Readonly<{
  config: unknown;
  credentials: CircleCredentialProvider;
  http: CircleHttpExchange;
  operations: CircleOperationRepository;
  generateUuid: () => unknown;
}>;
