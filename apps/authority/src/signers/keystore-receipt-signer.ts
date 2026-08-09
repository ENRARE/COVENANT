import { withIsolatedKeystoreAccount } from "@covenant/config/isolated-keystore";
import {
  buildAuthorizationReceiptTypedData,
  buildDecisionReceiptTypedData,
} from "@covenant/spec";
import { getAddress } from "viem";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { ReceiptSigner } from "../ports/receipt-signer.js";

const decisionSchema = z
  .object({
    domain: z.unknown(),
    types: z.unknown(),
    primaryType: z.literal("DecisionReceipt"),
    message: z.unknown(),
  })
  .strict();
const authorizationSchema = z
  .object({
    domain: z.unknown(),
    types: z.unknown(),
    primaryType: z.literal("AuthorizationReceipt"),
    message: z.unknown(),
  })
  .strict();

function unsigned(value: unknown): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "string" && /^(0|[1-9]\d*)$/u.test(value)) {
    return BigInt(value);
  }
  throw new Error("Receipt typed data numeric value is invalid");
}

export type KeystoreReceiptSignerOptions = Readonly<{
  keystorePath: string;
  passwordFilePath: string;
  expectedAddress: string;
}>;

function assertSigner(exact: { message: { signer: string } }, address: string) {
  if (exact.message.signer !== address) {
    throw new Error("Receipt signer does not match configuration");
  }
}

export function createKeystoreReceiptSigner(
  options: KeystoreReceiptSignerOptions,
): ReceiptSigner {
  const address = getAddress(options.expectedAddress);
  return Object.freeze({
    address,
    async signDecisionReceipt(typedData: unknown) {
      const candidate = decisionSchema.parse(typedData);
      const message = candidate.message as Record<string, unknown>;
      const domain = candidate.domain as Record<string, unknown>;
      const exact = buildDecisionReceiptTypedData(
        { ...message, createdAt: unsigned(message.createdAt).toString() },
        { ...domain, chainId: unsigned(domain.chainId).toString() },
      );
      if (!isDeepStrictEqual(candidate.types, exact.types)) {
        throw new Error("DecisionReceipt typed data is not exact");
      }
      assertSigner(exact, address);
      return withIsolatedKeystoreAccount(
        { ...options, expectedAddress: address },
        (account) => account.signTypedData(exact),
      );
    },
    async signAuthorizationReceipt(typedData: unknown) {
      const candidate = authorizationSchema.parse(typedData);
      const message = candidate.message as Record<string, unknown>;
      const domain = candidate.domain as Record<string, unknown>;
      const exact = buildAuthorizationReceiptTypedData(
        {
          ...message,
          chainId: unsigned(message.chainId).toString(),
          authorizationNonce: unsigned(message.authorizationNonce).toString(),
          validUntil: unsigned(message.validUntil).toString(),
        },
        { ...domain, chainId: unsigned(domain.chainId).toString() },
      );
      if (!isDeepStrictEqual(candidate.types, exact.types)) {
        throw new Error("AuthorizationReceipt typed data is not exact");
      }
      assertSigner(exact, address);
      return withIsolatedKeystoreAccount(
        { ...options, expectedAddress: address },
        (account) => account.signTypedData(exact),
      );
    },
  });
}
