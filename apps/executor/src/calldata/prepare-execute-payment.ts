import { readFileSync } from "node:fs";
import {
  decodeFunctionData,
  encodeFunctionData,
  type Abi,
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
    const decoded = decodeFunctionData({
      abi: covenantVaultExecutePaymentAbi,
      data,
    });
    if (
      decoded.functionName !== "executePayment" ||
      decoded.args === undefined
    ) {
      executorFailure("EXECUTION_CALL_MISMATCH");
    }
    const decodedReencoded = encodeFunctionData({
      abi: covenantVaultExecutePaymentAbi,
      functionName: "executePayment",
      args: decoded.args,
    });
    const expectedReencoded = encodeFunctionData({
      abi: covenantVaultExecutePaymentAbi,
      functionName: "executePayment",
      args: expectedArgs,
    });
    if (decodedReencoded !== data || expectedReencoded !== data) {
      executorFailure("EXECUTION_CALL_MISMATCH");
    }
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
