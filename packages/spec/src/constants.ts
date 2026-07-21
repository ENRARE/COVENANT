export const SCHEMA_VERSION = "1" as const;

export const ARC_TESTNET_CHAIN_ID_STRING = "5042002" as const;
export const ARC_TESTNET_CHAIN_ID = 5_042_002n;

export const UINT256_MAX = (1n << 256n) - 1n;
export const UINT256_MAX_DECIMAL = UINT256_MAX.toString();
export const UINT256_MAX_DECIMAL_DIGITS = UINT256_MAX_DECIMAL.length;

export const USDC_DECIMALS = 6;
export const USDC_SCALE = 1_000_000n;
export const MAX_USDC_BASE_UNITS = UINT256_MAX;
export const MAX_USDC_WHOLE_DIGITS = (UINT256_MAX / USDC_SCALE).toString()
  .length;
export const MAX_USDC_DECIMAL = `${(UINT256_MAX / USDC_SCALE).toString()}.${(
  UINT256_MAX % USDC_SCALE
)
  .toString()
  .padStart(USDC_DECIMALS, "0")}`;

export const CANONICAL_RULE_IDS = [
  "covenant_active",
  "intent_signature_valid",
  "agent_authorized",
  "recipient_allowed",
  "token_allowed",
  "amount_within_limit",
  "invoice_signature_valid",
  "invoice_matches_intent",
  "purpose_allowed",
  "intent_not_expired",
  "nonce_unused",
] as const;
