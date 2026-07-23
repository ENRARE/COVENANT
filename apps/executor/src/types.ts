import type { Address, Hex } from "viem";

export type AuthorizedTransactionRequest = Readonly<{
  chainId: 5_042_002n;
  to: Address;
  value: 0n;
  data: Hex;
}>;

export type PreparedExecution = Readonly<{
  executionId: Hex;
  intentDigest: Hex;
  decisionDigest: Hex;
  authorizationDigest: Hex;
  chainId: 5_042_002n;
  target: Address;
  value: 0n;
  data: Hex;
  covenantValidUntil: bigint;
  intentExpiresAt: bigint;
  authorizationValidUntil: bigint;
}>;

export type SimulationResult = Readonly<{
  status: "SIMULATED";
  execution: PreparedExecution;
}>;

export type ExecutionResult = Readonly<{
  status: "SUBMITTED";
  execution: PreparedExecution;
  transactionId: string;
}>;
