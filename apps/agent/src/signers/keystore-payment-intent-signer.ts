import { withIsolatedKeystoreAccount } from "@covenant/config/isolated-keystore";
import { buildPaymentIntentTypedData, formatUsdc } from "@covenant/spec";
import { getAddress } from "viem";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { PaymentIntentSigner } from "../ports.js";

const typedDataSchema = z
  .object({
    domain: z.unknown(),
    types: z.unknown(),
    primaryType: z.literal("PaymentIntent"),
    message: z.unknown(),
  })
  .strict();

function unsigned(value: unknown): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "string" && /^(0|[1-9]\d*)$/u.test(value)) {
    return BigInt(value);
  }
  throw new Error("PaymentIntent typed data numeric value is invalid");
}

export type KeystorePaymentIntentSignerOptions = Readonly<{
  keystorePath: string;
  passwordFilePath: string;
  expectedAddress: string;
}>;

export function createKeystorePaymentIntentSigner(
  options: KeystorePaymentIntentSignerOptions,
): PaymentIntentSigner {
  const address = getAddress(options.expectedAddress);
  return Object.freeze({
    address,
    async signPaymentIntent(value: unknown): Promise<unknown> {
      const candidate = typedDataSchema.parse(value);
      const message = candidate.message as Record<string, unknown>;
      const domain = candidate.domain as Record<string, unknown>;
      const exact = buildPaymentIntentTypedData(
        {
          ...message,
          amount: formatUsdc(unsigned(message.amount)),
          createdAt: unsigned(message.createdAt).toString(),
          expiresAt: unsigned(message.expiresAt).toString(),
          nonce: unsigned(message.nonce).toString(),
        },
        { ...domain, chainId: unsigned(domain.chainId).toString() },
      );
      if (!isDeepStrictEqual(candidate.types, exact.types)) {
        throw new Error("PaymentIntent typed data is not exact");
      }
      if (exact.message.agentSigner !== address) {
        throw new Error("PaymentIntent signer does not match configuration");
      }
      return withIsolatedKeystoreAccount(
        { ...options, expectedAddress: address },
        (account) => account.signTypedData(exact),
      );
    },
  });
}
