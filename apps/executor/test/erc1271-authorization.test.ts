import { describe, expect, it, vi } from "vitest";
import {
  createArcTestnetSignatureVerifier,
  type ArcSignatureVerificationClient,
} from "@covenant/core";
import type { Hex } from "viem";
import { createExecutorService, ExecutorError } from "../src/index.js";
import { cloneRequest, createTestHarness } from "./fixtures.js";

function client(
  contractAddress: string | undefined,
  overrides: Partial<ArcSignatureVerificationClient> = {},
): ArcSignatureVerificationClient {
  return {
    getChainId: vi.fn(() => Promise.resolve(5_042_002)),
    getCode: vi.fn(
      ({ address }: { address: `0x${string}` }): Promise<Hex | undefined> =>
        Promise.resolve(
          address.toLowerCase() === contractAddress?.toLowerCase()
            ? "0x6000"
            : undefined,
        ),
    ),
    readContract: vi.fn(() => Promise.resolve("0x1626ba7e")),
    ...overrides,
  };
}

async function expectExecutorCode(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await operation;
    throw new Error("expected executor failure");
  } catch (error) {
    expect(error).toBeInstanceOf(ExecutorError);
    expect((error as ExecutorError).code).toBe(code);
  }
}

describe("executor deployment-owned EOA/ERC-1271 verification", () => {
  it("keeps EOA authorization chains valid through the deployment port", async () => {
    const harness = await createTestHarness();
    const rpc = client(undefined);
    const service = createExecutorService({
      ...harness.dependencies,
      signatureVerifier: createArcTestnetSignatureVerifier(rpc),
    });

    await expect(
      service.prepareExecution(harness.request),
    ).resolves.toMatchObject({
      target: harness.covenant.vaultAddress,
      chainId: 5_042_002n,
    });
    expect(rpc.readContract).not.toHaveBeenCalled();
  });

  it("accepts an ERC-1271 agent intent while retaining EOA receipt verification", async () => {
    const harness = await createTestHarness();
    const rpc = client(harness.covenant.agentSigner);
    const service = createExecutorService({
      ...harness.dependencies,
      signatureVerifier: createArcTestnetSignatureVerifier(rpc),
    });

    await expect(
      service.prepareExecution(harness.request),
    ).resolves.toMatchObject({
      target: harness.covenant.vaultAddress,
      chainId: 5_042_002n,
    });
    expect(rpc.readContract).toHaveBeenCalledTimes(1);
    expect(rpc.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: harness.covenant.agentSigner,
        functionName: "isValidSignature",
      }),
    );
    expect(rpc.getCode).toHaveBeenCalledWith({
      address: harness.covenant.authorizationSigner,
    });
  });

  it("rejects invalid ERC-1271 magic without reaching simulation or submission", async () => {
    const harness = await createTestHarness();
    const rpc = client(harness.covenant.agentSigner, {
      readContract: vi.fn(() => Promise.resolve("0xffffffff")),
    });
    const service = createExecutorService({
      ...harness.dependencies,
      signatureVerifier: createArcTestnetSignatureVerifier(rpc),
    });

    await expectExecutorCode(
      service.executeAuthorizedPayment(harness.request),
      "INVALID_AUTHORIZATION_CHAIN",
    );
    expect(harness.transportState.simulations).toHaveLength(0);
    expect(harness.transportState.submissions).toHaveLength(0);
  });

  it("rejects a signature-verification RPC on the wrong chain", async () => {
    const harness = await createTestHarness();
    const rpc = client(harness.covenant.agentSigner, {
      getChainId: vi.fn(() => Promise.resolve(1)),
    });
    const service = createExecutorService({
      ...harness.dependencies,
      signatureVerifier: createArcTestnetSignatureVerifier(rpc),
    });

    await expectExecutorCode(
      service.prepareExecution(harness.request),
      "EXECUTION_CHAIN_MISMATCH",
    );
  });

  it("rejects when bytecode is not deployed at the configured agent signer", async () => {
    const harness = await createTestHarness();
    const wrongContract = harness.covenant.recipientAddress;
    const rpc = client(wrongContract);
    const service = createExecutorService({
      ...harness.dependencies,
      signatureVerifier: createArcTestnetSignatureVerifier(rpc, {
        requireContractSigners: [harness.covenant.agentSigner],
      }),
    });

    await expectExecutorCode(
      service.prepareExecution(harness.request),
      "INVALID_AUTHORIZATION_CHAIN",
    );
    expect(rpc.getCode).toHaveBeenCalledWith({
      address: harness.covenant.agentSigner,
    });
    expect(rpc.getCode).not.toHaveBeenCalledWith({ address: wrongContract });
    expect(rpc.readContract).not.toHaveBeenCalled();
  });

  it.each(["decisionReceipt", "authorizationReceipt"] as const)(
    "continues to verify the %s EOA signature",
    async (receipt) => {
      const harness = await createTestHarness();
      const request = cloneRequest(harness.request);
      request[receipt].signature = request.signedPaymentIntent.signature;
      const rpc = client(harness.covenant.agentSigner);
      const service = createExecutorService({
        ...harness.dependencies,
        signatureVerifier: createArcTestnetSignatureVerifier(rpc),
      });

      await expectExecutorCode(
        service.prepareExecution(request),
        "INVALID_AUTHORIZATION_CHAIN",
      );
      expect(rpc.readContract).toHaveBeenCalledTimes(1);
    },
  );
});
