import { createKeystorePaymentIntentSigner } from "@covenant/agent";
import { createKeystoreReceiptSigner } from "@covenant/authority";
import { COV018_LIVE_FIXED_CONFIGURATION } from "@covenant/config";
import { createKeystoreInvoiceSigner } from "@covenant/vendor";
import { decodeFunctionData, getAddress, type Abi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import covenantVaultAbi from "../../packages/contracts/abi/CovenantVault.json";
import { createFakeKeystore } from "../../apps/vendor/test/fake-keystore.js";
// The production entry point is intentionally JavaScript so it can run after package builds.
// @ts-expect-error The checked implementation has no handwritten declaration file.
import {
  assertExecutorProcessEnvironment,
  prepareLiveSignedFlow,
} from "../../scripts/cov018/prepare-live-signed-flow.mjs";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () =>
  Promise.all(cleanups.splice(0).map((cleanup) => cleanup())),
);

function bytes32(value: number): `0x${string}` {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

describe("COV-018 isolated live signed-flow preparation", () => {
  it("verifies the exact chain and prepares immutable calldata without network or submission", async () => {
    const [vendor, agent, authorization] = await Promise.all([
      createFakeKeystore(),
      createFakeKeystore(),
      createFakeKeystore(),
    ]);
    cleanups.push(vendor.cleanup, agent.cleanup, authorization.cleanup);
    const issuer = privateKeyToAccount(generatePrivateKey()).address;
    const configuration = {
      ...COV018_LIVE_FIXED_CONFIGURATION,
      covenantId: bytes32(1),
      issuer,
      approvedVendor: vendor.account.address,
      agentSigner: agent.account.address,
      authorizationSigner: authorization.account.address,
      vaultAddress: "0x2405Da1115B47A9D60499E12aA216874dc44c75a",
      policyHash: bytes32(2),
      createdAt: "2099999900",
      validAfter: "2099999950",
      validUntil: "2100001000",
    };
    let nextIdentifier = 10;
    let preparedTransaction: Readonly<Record<string, unknown>> | undefined;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network access forbidden"));
    const result = await prepareLiveSignedFlow({
      configuration,
      now: 2_100_000_000n,
      identifiers: { create: async () => bytes32(nextIdentifier++) },
      nonces: { create: async () => 7n },
      vendorSigner: createKeystoreInvoiceSigner({
        keystorePath: vendor.keystorePath,
        passwordFilePath: vendor.passwordFilePath,
        expectedAddress: vendor.account.address,
        recipient: configuration.recipientAddress,
        token: configuration.tokenAddress,
        productId: configuration.approvedProductId,
        purpose: configuration.purpose,
        maximumAmountBaseUnits: 1_000_000n,
      }),
      agentSigner: createKeystorePaymentIntentSigner({
        keystorePath: agent.keystorePath,
        passwordFilePath: agent.passwordFilePath,
        expectedAddress: agent.account.address,
      }),
      authorizationSigner: createKeystoreReceiptSigner({
        keystorePath: authorization.keystorePath,
        passwordFilePath: authorization.passwordFilePath,
        expectedAddress: authorization.account.address,
      }),
      observePreparedTransaction: (
        transaction: Readonly<Record<string, unknown>>,
      ) => {
        preparedTransaction = transaction;
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).not.toHaveProperty("signature");
    expect(JSON.stringify(result)).not.toContain("signature");
    expect(result).toMatchObject({
      covenantId: configuration.covenantId,
      target: getAddress(configuration.vaultAddress),
      chainId: "5042002",
      value: "0",
      token: getAddress(configuration.tokenAddress),
      recipient: configuration.recipientAddress,
      amount: "10000",
    });
    expect(result.calldataByteLength).toBeGreaterThan(4);
    expect(preparedTransaction).toBeDefined();
    expect(Object.isFrozen(preparedTransaction)).toBe(true);
    const decoded = decodeFunctionData({
      abi: covenantVaultAbi as Abi,
      data: preparedTransaction!.data as `0x${string}`,
    });
    expect(decoded.functionName).toBe("executePayment");
    expect(preparedTransaction).toMatchObject({
      chainId: 5_042_002n,
      to: getAddress(configuration.vaultAddress),
      value: 0n,
    });
  });

  it("rejects a vendor key that is not the configured approved vendor", async () => {
    const vendor = await createFakeKeystore();
    cleanups.push(vendor.cleanup);
    const wrongVendor = privateKeyToAccount(generatePrivateKey()).address;
    const signer = createKeystoreInvoiceSigner({
      keystorePath: vendor.keystorePath,
      passwordFilePath: vendor.passwordFilePath,
      expectedAddress: vendor.account.address,
      recipient: COV018_LIVE_FIXED_CONFIGURATION.recipientAddress,
      token: COV018_LIVE_FIXED_CONFIGURATION.tokenAddress,
      productId: COV018_LIVE_FIXED_CONFIGURATION.approvedProductId,
      purpose: COV018_LIVE_FIXED_CONFIGURATION.purpose,
      maximumAmountBaseUnits: 1_000_000n,
    });
    await expect(
      signer.signInvoice({
        domain: {},
        types: {},
        primaryType: "Invoice",
        message: { vendor: wrongVendor },
      }),
    ).rejects.toThrow();
  });

  it("rejects signer material in the executor environment", () => {
    expect(() =>
      assertExecutorProcessEnvironment({
        ["CIRCLE_API_" + "KEY"]: "allowed-in-executor-only",
        COVENANT_AGENT_KEYSTORE_PATH: "forbidden",
      }),
    ).toThrow("forbidden");
    expect(() =>
      assertExecutorProcessEnvironment({
        ["CIRCLE_API_" + "KEY"]: "allowed",
      }),
    ).not.toThrow();
  });
});
