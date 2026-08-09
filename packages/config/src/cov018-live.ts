import { getAddress, isAddress, zeroAddress } from "viem";
import { z } from "zod";

const CIRCLE_EXECUTION_WALLET_ID = [
  "ce56ce38",
  "bf72",
  "5b3f",
  "b20c",
  "0bef860a06f2",
].join("-") as "ce56ce38-bf72-5b3f-b20c-0bef860a06f2";

export const COV018_LIVE_FIXED_CONFIGURATION = Object.freeze({
  chainId: "5042002",
  tokenAddress: "0x3600000000000000000000000000000000000000",
  recipientAddress: "0xDbf314C646792dbbD48070e799E7B1EE5d913aB1",
  maxAmountPerPayment: "1",
  maxAmountPerPaymentBaseUnits: "1000000",
  totalBudget: "3",
  totalBudgetBaseUnits: "3000000",
  maxPaymentCount: "3",
  purpose: "COVENANT Arc Testnet approved payment demonstration",
  policyVersion: "cov-018-testnet-1",
  approvedProductId: "gpu-h100-hour",
  plannedAmount: "0.01",
  plannedAmountBaseUnits: "10000",
  circleWalletId: CIRCLE_EXECUTION_WALLET_ID,
  circleWalletAddress: "0x58F2C55A4E409ee4C5544F2756073449ee41F403",
  circleNetwork: "ARC-TESTNET",
  circleAccountType: "EOA",
  feeLevel: "MEDIUM",
} as const);

export const COV018_LIVE_CONFIGURATION_TEMPLATE = Object.freeze({
  ...COV018_LIVE_FIXED_CONFIGURATION,
  covenantId: "<NEW_COVENANT_ID_BYTES32>",
  issuer: "<NEW_ISSUER_PUBLIC_ADDRESS>",
  approvedVendor: "<NEW_VENDOR_PUBLIC_ADDRESS>",
  agentSigner: "<NEW_AGENT_PUBLIC_ADDRESS>",
  authorizationSigner: "<NEW_AUTH_PUBLIC_ADDRESS>",
  vaultAddress: "<NEW_COVENANT_VAULT_ADDRESS>",
  policyHash: "<COV_018_CANONICAL_11_RULE_POLICY_HASH>",
  createdAt: "<DEPLOYMENT_PLAN_CREATED_AT>",
  validAfter: "<DEPLOYMENT_VALID_AFTER>",
  validUntil: "<DEPLOYMENT_VALID_UNTIL>",
} as const);

function strictAddress(value: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value)) return false;
  return value === value.toLowerCase()
    ? isAddress(value, { strict: false })
    : isAddress(value, { strict: true });
}

const addressSchema = z
  .string()
  .refine(strictAddress, "Expected a lowercase or checksummed EVM address")
  .transform((value) => getAddress(value))
  .refine((value) => value !== zeroAddress, "Zero address is forbidden");
const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/u)
  .transform((value) => value.toLowerCase() as `0x${string}`);
const timestampSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/u)
  .transform((value) => BigInt(value));

export const cov018LivePublicConfigurationSchema = z
  .object({
    covenantId: bytes32Schema,
    issuer: addressSchema,
    approvedVendor: addressSchema,
    agentSigner: addressSchema,
    authorizationSigner: addressSchema,
    vaultAddress: addressSchema,
    policyHash: bytes32Schema,
    createdAt: timestampSchema,
    validAfter: timestampSchema,
    validUntil: timestampSchema,
    chainId: z.literal(COV018_LIVE_FIXED_CONFIGURATION.chainId),
    tokenAddress: z.literal(COV018_LIVE_FIXED_CONFIGURATION.tokenAddress),
    recipientAddress: z.literal(
      COV018_LIVE_FIXED_CONFIGURATION.recipientAddress,
    ),
    maxAmountPerPayment: z.literal(
      COV018_LIVE_FIXED_CONFIGURATION.maxAmountPerPayment,
    ),
    maxAmountPerPaymentBaseUnits: z.literal(
      COV018_LIVE_FIXED_CONFIGURATION.maxAmountPerPaymentBaseUnits,
    ),
    totalBudget: z.literal(COV018_LIVE_FIXED_CONFIGURATION.totalBudget),
    totalBudgetBaseUnits: z.literal(
      COV018_LIVE_FIXED_CONFIGURATION.totalBudgetBaseUnits,
    ),
    maxPaymentCount: z.literal(COV018_LIVE_FIXED_CONFIGURATION.maxPaymentCount),
    purpose: z.literal(COV018_LIVE_FIXED_CONFIGURATION.purpose),
    policyVersion: z.literal(COV018_LIVE_FIXED_CONFIGURATION.policyVersion),
    approvedProductId: z.literal(
      COV018_LIVE_FIXED_CONFIGURATION.approvedProductId,
    ),
    plannedAmount: z.literal(COV018_LIVE_FIXED_CONFIGURATION.plannedAmount),
    plannedAmountBaseUnits: z.literal(
      COV018_LIVE_FIXED_CONFIGURATION.plannedAmountBaseUnits,
    ),
    circleWalletId: z.literal(COV018_LIVE_FIXED_CONFIGURATION.circleWalletId),
    circleWalletAddress: z.literal(
      COV018_LIVE_FIXED_CONFIGURATION.circleWalletAddress,
    ),
    circleNetwork: z.literal(COV018_LIVE_FIXED_CONFIGURATION.circleNetwork),
    circleAccountType: z.literal(
      COV018_LIVE_FIXED_CONFIGURATION.circleAccountType,
    ),
    feeLevel: z.literal(COV018_LIVE_FIXED_CONFIGURATION.feeLevel),
  })
  .strict()
  .superRefine((value, context) => {
    const roles = [
      value.issuer,
      value.approvedVendor,
      value.agentSigner,
      value.authorizationSigner,
    ];
    if (new Set(roles).size !== roles.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authorizationSigner"],
        message: "Issuer, vendor, agent, and authorization roles must differ",
      });
    }
    if (
      roles.includes(value.recipientAddress) ||
      value.vaultAddress === value.recipientAddress
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recipientAddress"],
        message: "Recipient collides with a protected role",
      });
    }
    if (
      value.createdAt > value.validAfter ||
      value.validUntil <= value.validAfter
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["validUntil"],
        message: "COV-018 validity window is invalid",
      });
    }
  });

export type Cov018LivePublicConfiguration = z.infer<
  typeof cov018LivePublicConfigurationSchema
>;

export function parseCov018LivePublicConfiguration(
  value: unknown,
): Cov018LivePublicConfiguration {
  return cov018LivePublicConfigurationSchema.parse(value);
}
