import { getAddress, isAddress, zeroAddress, type Hex } from "viem";
import { z } from "zod";
import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID_STRING,
  SCHEMA_VERSION,
  UINT256_MAX_DECIMAL,
  UINT256_MAX_DECIMAL_DIGITS,
} from "./constants.js";
import { parseUsdc } from "./money.js";

export { SCHEMA_VERSION } from "./constants.js";

export const versionSchema = z.literal(SCHEMA_VERSION);

function isStrictAddress(value: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return false;
  if (value === value.toLowerCase()) return isAddress(value, { strict: false });
  return isAddress(value, { strict: true });
}

export const nonzeroAddressSchema = z
  .string()
  .refine(
    isStrictAddress,
    "Expected lowercase or correctly checksummed EVM address",
  )
  .transform((value) => getAddress(value))
  .refine((value) => value !== zeroAddress, "Zero address is not allowed");

export const addressSchema = nonzeroAddressSchema;
export const issuerAddressSchema = nonzeroAddressSchema;
export const agentSignerAddressSchema = nonzeroAddressSchema;
export const authorizationSignerAddressSchema = nonzeroAddressSchema;
export const vaultAddressSchema = nonzeroAddressSchema;
export const tokenAddressSchema = nonzeroAddressSchema;
export const recipientAddressSchema = nonzeroAddressSchema;
export const vendorAddressSchema = nonzeroAddressSchema;

export const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Expected 32-byte hex value")
  .transform((value) => value as Hex);

export const signatureSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{130}$/, "Expected 65-byte signature")
  .transform((value) => value as Hex);

const UNSIGNED_INTEGER_PATTERN = /^(0|[1-9]\d*)$/;

const boundedUint256StringSchema = z
  .string()
  .max(UINT256_MAX_DECIMAL_DIGITS, "Value exceeds uint256 decimal length")
  .regex(UNSIGNED_INTEGER_PATTERN, "Expected canonical unsigned integer string")
  .refine(
    (value) =>
      value.length < UINT256_MAX_DECIMAL_DIGITS || value <= UINT256_MAX_DECIMAL,
    "Value exceeds uint256 range",
  );

export const uintStringSchema = boundedUint256StringSchema.transform((value) =>
  BigInt(value),
);

export const positiveUintStringSchema = uintStringSchema.refine(
  (value) => value > 0n,
  "Expected a positive integer",
);

export const timestampSchema = positiveUintStringSchema;

export const mvpChainIdSchema = z
  .literal(ARC_TESTNET_CHAIN_ID_STRING)
  .transform(() => ARC_TESTNET_CHAIN_ID);

export const moneySchema = z.unknown().transform((value, context) => {
  try {
    return parseUsdc(value);
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : "Invalid USDC value",
    });
    return z.NEVER;
  }
});

export const positiveMoneySchema = moneySchema.refine(
  (value) => value > 0n,
  "Payment amount must be greater than zero",
);

export const purposeSchema = z.string().trim().min(1).max(256);
export const policyVersionSchema = z
  .string()
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/);
export const identifierSchema = bytes32Schema;
