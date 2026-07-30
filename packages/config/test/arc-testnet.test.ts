import { describe, expect, it } from "vitest";
import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_PROFILE,
  ARC_TESTNET_SECURITY_PROFILE_DIGEST,
  ARC_TESTNET_USDC_INTERFACE,
  arcTestnetProfileSchema,
  deriveChainIdHex,
  securityProfileDigest,
} from "../src/arc-testnet.js";

describe("trusted Arc Testnet profile", () => {
  it("freezes the canonical security and provenance fields deeply", () => {
    expect(arcTestnetProfileSchema.parse(ARC_TESTNET_PROFILE)).toEqual(
      ARC_TESTNET_PROFILE,
    );
    expect(Object.isFrozen(ARC_TESTNET_PROFILE)).toBe(true);
    expect(Object.isFrozen(ARC_TESTNET_PROFILE.sourceVerification)).toBe(true);
    expect(Object.isFrozen(ARC_TESTNET_PROFILE.sourceVerification.arc)).toBe(
      true,
    );
  });

  it("derives the only accepted hexadecimal chain ID from decimal", () => {
    expect(deriveChainIdHex(ARC_TESTNET_CHAIN_ID)).toBe("0x4cef52");
    expect(() =>
      arcTestnetProfileSchema.parse({
        ...ARC_TESTNET_PROFILE,
        chainIdHex: "0x4CF4B2",
      }),
    ).toThrow();
  });

  it("keeps native, display, and ERC-20 decimal meanings separate", () => {
    expect(ARC_TESTNET_PROFILE.nativeRpcDecimals).toBe(18);
    expect(ARC_TESTNET_PROFILE.walletDisplayDecimals).toBe(6);
    expect(ARC_TESTNET_PROFILE.erc20Decimals).toBe(6);
    expect(ARC_TESTNET_PROFILE.usdcInterfaceAddress).toBe(
      ARC_TESTNET_USDC_INTERFACE,
    );
  });

  it("records Osaka separately from the reviewed Prague artifact", () => {
    expect(ARC_TESTNET_PROFILE.networkEvmTarget).toBe("osaka");
    expect(ARC_TESTNET_PROFILE.artifactEvmTarget).toBe("prague");
  });

  it("rejects unknown fields and operational overrides", () => {
    expect(() =>
      arcTestnetProfileSchema.parse({
        ...ARC_TESTNET_PROFILE,
        wallet: "browser",
      }),
    ).toThrow();
    expect(() =>
      arcTestnetProfileSchema.parse({
        ...ARC_TESTNET_PROFILE,
        primaryHttpsRpc: "http://localhost:8545",
      }),
    ).toThrow();
  });

  it("excludes provenance dates from the security digest", () => {
    const rechecked = {
      ...ARC_TESTNET_PROFILE,
      sourceVerification: {
        ...ARC_TESTNET_PROFILE.sourceVerification,
        verifiedOn: "2026-07-31",
      },
    };
    expect(arcTestnetProfileSchema.parse(rechecked)).toEqual(rechecked);
    expect(securityProfileDigest(rechecked)).toBe(
      ARC_TESTNET_SECURITY_PROFILE_DIGEST,
    );
  });

  it("does not read environment configuration", () => {
    const before = ARC_TESTNET_SECURITY_PROFILE_DIGEST;
    process.env.ARC_RPC_URL = "https://attacker.invalid";
    process.env.ETH_RPC_URL = "https://attacker.invalid";
    try {
      expect(securityProfileDigest()).toBe(before);
      expect(ARC_TESTNET_PROFILE.primaryHttpsRpc).toBe(
        "https://rpc.testnet.arc.io",
      );
    } finally {
      delete process.env.ARC_RPC_URL;
      delete process.env.ETH_RPC_URL;
    }
  });
});
