import { withIsolatedKeystoreAccount } from "@covenant/config/isolated-keystore";
import { buildInvoiceTypedData, formatUsdc } from "@covenant/spec";
import { getAddress } from "viem";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

const typedDataSchema = z
  .object({
    domain: z.unknown(),
    types: z.unknown(),
    primaryType: z.literal("Invoice"),
    message: z.unknown(),
  })
  .strict();

function unsigned(value: unknown): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "string" && /^(0|[1-9]\d*)$/u.test(value)) {
    return BigInt(value);
  }
  throw new Error("Invoice typed data numeric value is invalid");
}

export type InvoiceSigner = Readonly<{
  address: unknown;
  signInvoice(typedData: unknown): Promise<unknown>;
}>;

export type KeystoreInvoiceSignerOptions = Readonly<{
  keystorePath: string;
  passwordFilePath: string;
  expectedAddress: string;
  recipient: string;
  token: string;
  productId: string;
  purpose: string;
  maximumAmountBaseUnits: bigint;
}>;

export function createKeystoreInvoiceSigner(
  options: KeystoreInvoiceSignerOptions,
): InvoiceSigner {
  const address = getAddress(options.expectedAddress);
  const recipient = getAddress(options.recipient);
  const token = getAddress(options.token);
  return Object.freeze({
    address,
    async signInvoice(value: unknown): Promise<unknown> {
      const candidate = typedDataSchema.parse(value);
      const message = candidate.message as Record<string, unknown>;
      const domain = candidate.domain as Record<string, unknown>;
      const exact = buildInvoiceTypedData(
        {
          ...message,
          amount: formatUsdc(unsigned(message.amount)),
          issuedAt: unsigned(message.issuedAt).toString(),
          expiresAt: unsigned(message.expiresAt).toString(),
          nonce: unsigned(message.nonce).toString(),
        },
        { ...domain, chainId: unsigned(domain.chainId).toString() },
      );
      if (!isDeepStrictEqual(candidate.types, exact.types)) {
        throw new Error("Invoice typed data is not exact");
      }
      const invoice = exact.message;
      if (
        invoice.vendor !== address ||
        invoice.recipient !== recipient ||
        invoice.token !== token ||
        invoice.productId !== options.productId ||
        invoice.purpose !== options.purpose ||
        invoice.amount > options.maximumAmountBaseUnits
      ) {
        throw new Error("Invoice does not match approved configuration");
      }
      return withIsolatedKeystoreAccount(
        { ...options, expectedAddress: address },
        (account) => account.signTypedData(exact),
      );
    },
  });
}
