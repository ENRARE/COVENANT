import type { Address, Hex } from "viem";

export const ARC_TESTNET_CHAIN_ID = 5_042_002 as const;

export type KnownArcExecution = Readonly<{
  chainId: typeof ARC_TESTNET_CHAIN_ID;
  transactionHash: Hex;
  vault: Address;
  covenantId: Hex;
  intentId: Hex;
  authorizationId: Hex;
  recipient: Address;
  amount: string;
  token: Address;
  priorVaultState?: Readonly<{
    totalSpent: string;
    paymentCount: string;
    tokenBalance: string;
  }>;
}>;

/**
 * A capability-limited source bound to one already-known execution.
 * Implementations choose the endpoint and fixed call arguments outside this API.
 */
export type KnownArcObservationSource = Readonly<{
  readChainId(): Promise<unknown>;
  readKnownTransactionReceipt(): Promise<unknown>;
  readReceiptBlock(): Promise<unknown>;
  readKnownVaultStateAtReceiptBlock(): Promise<unknown>;
}>;

export const ARC_EVIDENCE_CONFLICT_REASONS = [
  "MALFORMED_ARC_EVIDENCE",
  "MALFORMED_EXPECTATION",
  "WRONG_CHAIN",
  "MALFORMED_RECEIPT",
  "TRANSACTION_HASH_MISMATCH",
  "VAULT_TARGET_MISMATCH",
  "MALFORMED_BLOCK",
  "BLOCK_MISMATCH",
  "REMOVED_LOG",
  "REVERTED_RECEIPT_HAS_LOGS",
  "MISSING_PAYMENT_EXECUTED",
  "DUPLICATE_PAYMENT_EXECUTED",
  "MALFORMED_PAYMENT_EXECUTED",
  "WRONG_PAYMENT_EVENT_VAULT",
  "WRONG_COVENANT_ID",
  "WRONG_INTENT_ID",
  "WRONG_AUTHORIZATION_ID",
  "WRONG_RECIPIENT",
  "WRONG_AMOUNT",
  "MISSING_TOKEN_TRANSFER",
  "DUPLICATE_TOKEN_TRANSFER",
  "MALFORMED_TOKEN_TRANSFER",
  "WRONG_TOKEN",
  "WRONG_TRANSFER_SOURCE",
  "WRONG_TRANSFER_RECIPIENT",
  "WRONG_TRANSFER_AMOUNT",
  "MALFORMED_VAULT_STATE",
  "VAULT_STATE_CONFLICT",
] as const;

export type ArcEvidenceConflictReason =
  (typeof ARC_EVIDENCE_CONFLICT_REASONS)[number];

export type NormalizedVaultState = Readonly<{
  totalSpent: string;
  paymentCount: string;
  revoked: boolean;
  tokenBalance: string;
}>;

export type ObservedArcExecution = Readonly<{
  status: "OBSERVED_SUCCESS";
  chainId: typeof ARC_TESTNET_CHAIN_ID;
  transactionHash: Hex;
  blockNumber: string;
  blockHash: Hex;
  vault: Address;
  covenantId: Hex;
  intentId: Hex;
  authorizationId: Hex;
  recipient: Address;
  amount: string;
  token: Address;
  transfer: Readonly<{
    source: Address;
    recipient: Address;
    amount: string;
  }>;
  vaultState: NormalizedVaultState;
}>;

export type ArcExecutionEvidence =
  | ObservedArcExecution
  | Readonly<{
      status: "OBSERVED_REVERTED";
      chainId: typeof ARC_TESTNET_CHAIN_ID;
      transactionHash: Hex;
      blockNumber: string;
      blockHash: Hex;
      vault: Address;
    }>
  | Readonly<{ status: "NOT_OBSERVED" }>
  | Readonly<{ status: "EVIDENCE_CONFLICT"; reason: ArcEvidenceConflictReason }>
  | Readonly<{ status: "OBSERVATION_UNAVAILABLE" }>;

export type ArcExecutionEvidenceReader = Readonly<{
  observeKnownExecution(expected: unknown): Promise<ArcExecutionEvidence>;
}>;

export type CircleProviderEvidence =
  | Readonly<{ status: "UNKNOWN" }>
  | Readonly<{
      status: "OBSERVED";
      providerState:
        | "INITIATED"
        | "CLEARED"
        | "QUEUED"
        | "SENT"
        | "STUCK"
        | "CONFIRMED"
        | "COMPLETE"
        | "FAILED"
        | "DENIED"
        | "CANCELLED";
      transactionHash?: Hex;
    }>;

export type ExecutionReconciliation = Readonly<{
  classification:
    | "PROVIDER_ONLY"
    | "ARC_NOT_OBSERVED"
    | "ARC_EXECUTION_SUCCEEDED"
    | "ARC_EXECUTION_REVERTED"
    | "EVIDENCE_CONFLICT"
    | "OBSERVATION_UNAVAILABLE";
  provider: CircleProviderEvidence;
  arc: ArcExecutionEvidence;
}>;
