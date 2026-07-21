import { describe, expect, it } from "vitest";
import {
  MAX_USDC_BASE_UNITS,
  MAX_USDC_DECIMAL,
  formatUsdc,
  parseUsdc,
} from "../src/money.js";

describe("USDC money boundaries", () => {
  it.each([
    ["0.000001", 1n],
    ["1", 1_000_000n],
    ["1.0", 1_000_000n],
    ["1.000000", 1_000_000n],
    ["1.25", 1_250_000n],
    ["5000.000000", 5_000_000_000n],
  ])("parses %s to exact base units", (value, expected) => {
    expect(parseUsdc(value)).toBe(expected);
  });

  it("normalizes padded inputs to the shortest output", () => {
    expect(formatUsdc(parseUsdc("1"))).toBe("1");
    expect(formatUsdc(parseUsdc("1.0"))).toBe("1");
    expect(formatUsdc(parseUsdc("1.000000"))).toBe("1");
    expect(formatUsdc(parseUsdc("0.000000"))).toBe("0");
    expect(formatUsdc(parseUsdc("1.250000"))).toBe("1.25");
  });

  it.each([
    "0.0000001",
    "-1",
    "1e6",
    "1E6",
    "1,000",
    " 1",
    "1 ",
    "",
    ".1",
    "+1",
    "01",
    "00.1",
  ])("rejects noncanonical or unsafe input %j", (value) => {
    expect(() => parseUsdc(value)).toThrow();
  });

  it("rejects a million-character input before conversion", () => {
    expect(() => parseUsdc("9".repeat(1_000_000))).toThrow(/length|maximum/);
  });

  it("accepts uint256 maximum base units and rejects maximum plus one", () => {
    expect(parseUsdc(MAX_USDC_DECIMAL)).toBe(MAX_USDC_BASE_UNITS);
    expect(formatUsdc(MAX_USDC_BASE_UNITS)).toBe(MAX_USDC_DECIMAL);
    const overMaximumWhole = (
      (MAX_USDC_BASE_UNITS + 1n) /
      1_000_000n
    ).toString();
    const overMaximumFraction = ((MAX_USDC_BASE_UNITS + 1n) % 1_000_000n)
      .toString()
      .padStart(6, "0");
    const overMaximum = `${overMaximumWhole}.${overMaximumFraction}`;
    expect(() => parseUsdc(overMaximum)).toThrow(/maximum/);
    expect(() => formatUsdc(MAX_USDC_BASE_UNITS + 1n)).toThrow();
  });

  it("rejects invalid internal values", () => {
    expect(() => formatUsdc(-1n)).toThrow();
    expect(() => formatUsdc(1 as never)).toThrow();
  });
});
