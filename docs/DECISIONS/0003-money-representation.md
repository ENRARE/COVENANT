# ADR 0003: Money representation

- Status: Accepted
- Date: 2026-07-21
- Scope: MVP

## Decision

**MVP:** Represent Arc Testnet USDC as six-decimal ERC-20 base units. JSON boundaries accept unsigned decimal strings; validated internal values use `bigint`. JavaScript `number` is forbidden for money.

**MVP:** Accepted input includes `1`, `1.0`, and `1.000000`; all parse to `1_000_000n`. Leading-zero integer forms such as `01` are rejected. Reject signs, exponent notation, commas, surrounding whitespace, empty input, and more than six fractional digits. Payment amounts must be greater than zero where payment occurs.

**MVP:** The maximum is the uint256 maximum in base units: `115792089237316195423570985008687907853269984665640564039457584007913129639935n`, represented as `115792089237316195423570985008687907853269984665640564039457584007913129.639935` USDC. Length and lexical range checks occur before `BigInt` construction.

**MVP:** Canonical output emits the shortest exact decimal form: `1`, `1.25`, and `0.000001`. Trailing fractional zeroes are removed; input formatting is not preserved.

## Consequence

**MVP:** No rounding occurs. The shared parser is the only conversion boundary; schemas transform valid decimal strings to `bigint` before policy or hashing.

**V2:** Supporting a token with different decimals requires token-specific metadata and a new reviewed representation decision.
