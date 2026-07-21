import {
  MAX_USDC_BASE_UNITS,
  MAX_USDC_DECIMAL,
  MAX_USDC_WHOLE_DIGITS,
  UINT256_MAX_DECIMAL,
  USDC_DECIMALS,
  USDC_SCALE,
} from "./constants.js";

export {
  MAX_USDC_BASE_UNITS,
  MAX_USDC_DECIMAL,
  MAX_USDC_WHOLE_DIGITS,
  USDC_DECIMALS,
  USDC_SCALE,
} from "./constants.js";

const MAX_USDC_INPUT_LENGTH = MAX_USDC_WHOLE_DIGITS + 1 + USDC_DECIMALS;
const DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/;

export class MoneyParseError extends Error {
  override readonly name = "MoneyParseError";
}

function isAtMostUint256(decimalDigits: string): boolean {
  return (
    decimalDigits.length < UINT256_MAX_DECIMAL.length ||
    (decimalDigits.length === UINT256_MAX_DECIMAL.length &&
      decimalDigits <= UINT256_MAX_DECIMAL)
  );
}

export function parseUsdc(value: unknown): bigint {
  if (typeof value !== "string") {
    throw new MoneyParseError("USDC value must be a decimal string");
  }
  if (value.length === 0) {
    throw new MoneyParseError("USDC value must not be empty");
  }
  if (value.length > MAX_USDC_INPUT_LENGTH) {
    throw new MoneyParseError(`USDC value exceeds maximum ${MAX_USDC_DECIMAL}`);
  }

  const match = DECIMAL_PATTERN.exec(value);
  if (match === null) {
    throw new MoneyParseError(
      "USDC value must use an unsigned decimal with no leading zeroes and at most six fractional digits",
    );
  }

  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(USDC_DECIMALS, "0");
  const baseUnitDigits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "");

  if (!isAtMostUint256(baseUnitDigits)) {
    throw new MoneyParseError(`USDC value exceeds maximum ${MAX_USDC_DECIMAL}`);
  }

  return BigInt(baseUnitDigits);
}

export function formatUsdc(baseUnits: bigint): string {
  if (typeof baseUnits !== "bigint") {
    throw new MoneyParseError("USDC base units must be a bigint");
  }
  if (baseUnits < 0n) {
    throw new MoneyParseError("USDC base units must not be negative");
  }
  if (baseUnits > MAX_USDC_BASE_UNITS) {
    throw new MoneyParseError(`USDC value exceeds maximum ${MAX_USDC_DECIMAL}`);
  }

  const whole = baseUnits / USDC_SCALE;
  const fraction = (baseUnits % USDC_SCALE)
    .toString()
    .padStart(USDC_DECIMALS, "0");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction.length === 0
    ? whole.toString()
    : `${whole.toString()}.${trimmedFraction}`;
}
