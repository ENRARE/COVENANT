import { readFileSync } from "node:fs";
import {
  decodeFunctionData,
  encodeFunctionData,
  isAddressEqual,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { executorFailure } from "../errors.js";
import type { AuthorizedTransactionRequest } from "../types.js";
import type {
  AuthorizationReceipt,
  PaymentIntent,
  SignedAuthorizationReceipt,
  SignedPaymentIntent,
} from "@covenant/spec";

export const EXECUTE_PAYMENT_SELECTOR = "0x7ee0e4da" as const;

const rawCovenantVaultAbi = JSON.parse(
  readFileSync(
    new URL(
      "../../../../packages/contracts/abi/CovenantVault.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { type?: string; name?: string }[];
const executePaymentItem = rawCovenantVaultAbi.find(
  (item) => item.type === "function" && item.name === "executePayment",
);
if (executePaymentItem === undefined) {
  throw new Error("Generated CovenantVault ABI lacks executePayment");
}
export const covenantVaultExecutePaymentAbi = [
  executePaymentItem,
] as unknown as Abi;

function paymentIntentTuple(intent: PaymentIntent) {
  return {
    version: intent.version,
    intentId: intent.intentId,
    covenantId: intent.covenantId,
    agentSigner: intent.agentSigner,
    recipient: intent.recipient,
    token: intent.token,
    amount: intent.amount,
    invoiceHash: intent.invoiceHash,
    purpose: intent.purpose,
    createdAt: intent.createdAt,
    expiresAt: intent.expiresAt,
    nonce: intent.nonce,
  } as const;
}

function authorizationTuple(authorization: AuthorizationReceipt) {
  return {
    version: authorization.version,
    authorizationId: authorization.authorizationId,
    decisionId: authorization.decisionId,
    covenantId: authorization.covenantId,
    intentHash: authorization.intentHash,
    vaultAddress: authorization.vaultAddress,
    chainId: authorization.chainId,
    policyVersion: authorization.policyVersion,
    authorizationNonce: authorization.authorizationNonce,
    validUntil: authorization.validUntil,
    signer: authorization.signer,
  } as const;
}

function executionCallMismatch(): never {
  executorFailure("EXECUTION_CALL_MISMATCH");
}

function decodedTuple(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    executionCallMismatch();
  }
  return value as Record<string, unknown>;
}

function requireExact(value: unknown, expected: string | bigint): void {
  if (value !== expected) executionCallMismatch();
}

function requireAddress(value: unknown, expected: Address): void {
  if (
    typeof value !== "string" ||
    !isAddressEqual(value as Address, expected)
  ) {
    executionCallMismatch();
  }
}

function verifyExecutePaymentCalldataFields(input: {
  data: Hex;
  signedPaymentIntent: SignedPaymentIntent;
  signedAuthorizationReceipt: SignedAuthorizationReceipt;
}): void {
  const intent = paymentIntentTuple(input.signedPaymentIntent.payload);
  const authorization = authorizationTuple(
    input.signedAuthorizationReceipt.payload,
  );
  const decoded = decodeFunctionData({
    abi: covenantVaultExecutePaymentAbi,
    data: input.data,
  });
  if (decoded.functionName !== "executePayment" || decoded.args?.length !== 4) {
    executionCallMismatch();
  }
  const decodedIntent = decodedTuple(decoded.args[0]);
  const decodedAuthorization = decodedTuple(decoded.args[2]);

  requireExact(decodedIntent.version, intent.version);
  requireExact(decodedIntent.intentId, intent.intentId);
  requireExact(decodedIntent.covenantId, intent.covenantId);
  requireAddress(decodedIntent.agentSigner, intent.agentSigner);
  requireAddress(decodedIntent.recipient, intent.recipient);
  requireAddress(decodedIntent.token, intent.token);
  requireExact(decodedIntent.amount, intent.amount);
  requireExact(decodedIntent.invoiceHash, intent.invoiceHash);
  requireExact(decodedIntent.purpose, intent.purpose);
  requireExact(decodedIntent.createdAt, intent.createdAt);
  requireExact(decodedIntent.expiresAt, intent.expiresAt);
  requireExact(decodedIntent.nonce, intent.nonce);
  requireExact(decoded.args[1], input.signedPaymentIntent.signature);

  requireExact(decodedAuthorization.version, authorization.version);
  requireExact(
    decodedAuthorization.authorizationId,
    authorization.authorizationId,
  );
  requireExact(decodedAuthorization.decisionId, authorization.decisionId);
  requireExact(decodedAuthorization.covenantId, authorization.covenantId);
  requireExact(decodedAuthorization.intentHash, authorization.intentHash);
  requireAddress(decodedAuthorization.vaultAddress, authorization.vaultAddress);
  requireExact(decodedAuthorization.chainId, authorization.chainId);
  requireExact(decodedAuthorization.policyVersion, authorization.policyVersion);
  requireExact(
    decodedAuthorization.authorizationNonce,
    authorization.authorizationNonce,
  );
  requireExact(decodedAuthorization.validUntil, authorization.validUntil);
  requireAddress(decodedAuthorization.signer, authorization.signer);
  requireExact(decoded.args[3], input.signedAuthorizationReceipt.signature);

  const decodedReencoded = encodeFunctionData({
    abi: covenantVaultExecutePaymentAbi,
    functionName: "executePayment",
    args: decoded.args,
  });
  if (decodedReencoded !== input.data) executionCallMismatch();
}

export function verifyExecutePaymentCalldata(input: {
  data: Hex;
  signedPaymentIntent: SignedPaymentIntent;
  signedAuthorizationReceipt: SignedAuthorizationReceipt;
}): void {
  try {
    verifyExecutePaymentCalldataFields(input);
  } catch {
    executionCallMismatch();
  }
}

export function constructExecutePaymentRequest(input: {
  chainId: 5_042_002n;
  target: `0x${string}`;
  signedPaymentIntent: SignedPaymentIntent;
  signedAuthorizationReceipt: SignedAuthorizationReceipt;
}): AuthorizedTransactionRequest {
  const expectedArgs = [
    paymentIntentTuple(input.signedPaymentIntent.payload),
    input.signedPaymentIntent.signature,
    authorizationTuple(input.signedAuthorizationReceipt.payload),
    input.signedAuthorizationReceipt.signature,
  ] as const;
  let data: Hex;
  try {
    data = encodeFunctionData({
      abi: covenantVaultExecutePaymentAbi,
      functionName: "executePayment",
      args: expectedArgs,
    });
    if (!data.startsWith(EXECUTE_PAYMENT_SELECTOR)) {
      executorFailure("EXECUTION_CALL_MISMATCH");
    }
    verifyExecutePaymentCalldata({
      data,
      signedPaymentIntent: input.signedPaymentIntent,
      signedAuthorizationReceipt: input.signedAuthorizationReceipt,
    });
  } catch {
    executorFailure("EXECUTION_CALL_MISMATCH");
  }
  return Object.freeze({
    chainId: input.chainId,
    to: input.target,
    value: 0n,
    data,
  });
}
