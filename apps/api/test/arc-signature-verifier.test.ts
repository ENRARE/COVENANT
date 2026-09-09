import { describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, stringToHex, type Hex } from "viem";
import { CovenantVerificationError } from "@covenant/spec";
import {
  createArcTestnetSignatureVerifier,
  createArcTestnetSignatureVerifierFromRpcUrl,
  type ArcSignatureVerificationClient,
} from "../src/deployment/arc-signature-verifier.js";
import type { AuthorizationSignatureVerificationRequest } from "@covenant/core";

const CONTRACT = "0x1111111111111111111111111111111111111111";
const SIGNATURE: Hex = `0x${"11".repeat(65)}`;
const DIGEST = keccak256(stringToHex("covenant-erc1271-test"));

function request(
  overrides: Partial<AuthorizationSignatureVerificationRequest> = {},
): AuthorizationSignatureVerificationRequest {
  return {
    kind: "paymentIntent",
    expectedSigner: CONTRACT,
    digest: DIGEST,
    signature: SIGNATURE,
    ...overrides,
  };
}

function client(
  overrides: Partial<ArcSignatureVerificationClient> = {},
): ArcSignatureVerificationClient {
  return {
    getChainId: vi.fn(() => Promise.resolve(5_042_002)),
    getCode: vi.fn((): Promise<Hex | undefined> => Promise.resolve("0x6000")),
    readContract: vi.fn(() => Promise.resolve("0x1626ba7e")),
    ...overrides,
  };
}

async function expectVerificationCode(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await operation;
    throw new Error("expected verification failure");
  } catch (error) {
    expect(error).toBeInstanceOf(CovenantVerificationError);
    expect((error as CovenantVerificationError).code).toBe(code);
  }
}

describe("Arc Testnet EOA/ERC-1271 signature verifier", () => {
  it("preserves canonical EOA recovery when the expected signer has no code", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const digest = keccak256(stringToHex("existing-v1-eoa"));
    const signature = await account.sign({ hash: digest });
    const rpc = client({
      getCode: vi.fn(() => Promise.resolve(undefined)),
    });
    await expect(
      createArcTestnetSignatureVerifier(rpc).verify(
        request({ expectedSigner: account.address, digest, signature }),
      ),
    ).resolves.toBeUndefined();
    expect(rpc.readContract).not.toHaveBeenCalled();
  });

  it.each([
    "paymentIntent",
    "decisionReceipt",
    "authorizationReceipt",
  ] as const)(
    "calls the exact expected signer and digest for %s",
    async (kind) => {
      const rpc = client();
      await createArcTestnetSignatureVerifier(rpc).verify(request({ kind }));
      expect(rpc.readContract).toHaveBeenCalledWith({
        address: CONTRACT,
        abi: expect.any(Array),
        functionName: "isValidSignature",
        args: [DIGEST, SIGNATURE],
      });
    },
  );

  it("rejects a different recovered EOA rather than substituting it", async () => {
    const expected = privateKeyToAccount(generatePrivateKey());
    const attacker = privateKeyToAccount(generatePrivateKey());
    const signature = await attacker.sign({ hash: DIGEST });
    await expectVerificationCode(
      createArcTestnetSignatureVerifier(
        client({
          getCode: vi.fn((): Promise<Hex | undefined> => Promise.resolve("0x")),
        }),
      ).verify(request({ expectedSigner: expected.address, signature })),
      "UNTRUSTED_AGENT_SIGNER",
    );
  });

  it.each([
    ["wrong magic", () => Promise.resolve("0xffffffff")],
    ["malformed return", () => Promise.resolve("0x")],
    ["empty return", () => Promise.resolve(undefined)],
    ["contract revert", () => Promise.reject(new Error("provider body"))],
  ] as const)("fails closed on %s", async (_label, readContract) => {
    await expectVerificationCode(
      createArcTestnetSignatureVerifier(client({ readContract })).verify(
        request(),
      ),
      "SIGNATURE_INVALID",
    );
  });

  it("fails closed on RPC, chain, and bytecode lookup failures", async () => {
    await expectVerificationCode(
      createArcTestnetSignatureVerifier(
        client({ getChainId: () => Promise.reject(new Error("rpc secret")) }),
      ).verify(request()),
      "SIGNATURE_INVALID",
    );
    await expectVerificationCode(
      createArcTestnetSignatureVerifier(
        client({ getChainId: () => Promise.resolve(1) }),
      ).verify(request()),
      "CHAIN_MISMATCH",
    );
    await expectVerificationCode(
      createArcTestnetSignatureVerifier(
        client({
          getCode: () => Promise.reject(new Error("provider secret")),
        }),
      ).verify(request()),
      "SIGNATURE_INVALID",
    );
  });

  it("rejects an absent signer contract when deployment requires one", async () => {
    const verifier = createArcTestnetSignatureVerifier(
      client({ getCode: () => Promise.resolve(undefined) }),
      { requireContractSigners: [CONTRACT] },
    );
    await expectVerificationCode(
      verifier.verify(request()),
      "SIGNATURE_INVALID",
    );
  });

  it("reports readiness only for Arc Testnet and validates RPC URLs", async () => {
    await expect(
      createArcTestnetSignatureVerifier(client()).checkReady(),
    ).resolves.toBe(true);
    await expect(
      createArcTestnetSignatureVerifier(
        client({ getChainId: () => Promise.resolve(1) }),
      ).checkReady(),
    ).resolves.toBe(false);
    await expect(
      createArcTestnetSignatureVerifier(
        client({ getChainId: () => Promise.reject(new Error("offline")) }),
      ).checkReady(),
    ).resolves.toBe(false);
    expect(() =>
      createArcTestnetSignatureVerifierFromRpcUrl("not a url"),
    ).toThrow();
    expect(() =>
      createArcTestnetSignatureVerifierFromRpcUrl(
        "https://user:secret@rpc.example.invalid",
      ),
    ).toThrow(/credential-free HTTPS/u);
    expect(() =>
      createArcTestnetSignatureVerifierFromRpcUrl("http://rpc.example.invalid"),
    ).toThrow(/credential-free HTTPS/u);
  });
});
