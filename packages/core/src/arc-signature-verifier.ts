import { ARC_TESTNET_CHAIN_ID } from "@covenant/config";
import {
  CovenantVerificationError,
  recoverDigestSigner,
  verificationFailure,
} from "@covenant/spec";
import {
  createPublicClient,
  getAddress,
  http,
  type Address,
  type Hex,
} from "viem";
import type {
  AuthorizationSignatureVerificationRequest,
  AuthorizationSignatureVerifier,
} from "./core.js";

const ERC1271_MAGIC_VALUE = "0x1626ba7e";
const ERC1271_ABI = [
  {
    type: "function",
    name: "isValidSignature",
    stateMutability: "view",
    inputs: [
      { name: "hash", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "magicValue", type: "bytes4" }],
  },
] as const;

export type ArcSignatureVerificationClient = Readonly<{
  getChainId(): Promise<number>;
  getCode(input: Readonly<{ address: Address }>): Promise<Hex | undefined>;
  readContract(
    input: Readonly<{
      address: Address;
      abi: typeof ERC1271_ABI;
      functionName: "isValidSignature";
      args: readonly [Hex, Hex];
    }>,
  ): Promise<unknown>;
}>;

export type ArcSignatureVerifier = AuthorizationSignatureVerifier &
  Readonly<{ checkReady(): Promise<boolean> }>;

type ArcSignatureVerifierOptions = Readonly<{
  requireContractSigners?: readonly Address[];
}>;

function signerFailureCode(
  kind: AuthorizationSignatureVerificationRequest["kind"],
): "UNTRUSTED_AGENT_SIGNER" | "UNTRUSTED_AUTHORIZATION_SIGNER" {
  return kind === "paymentIntent"
    ? "UNTRUSTED_AGENT_SIGNER"
    : "UNTRUSTED_AUTHORIZATION_SIGNER";
}

function rpcFailure(message: string, cause: unknown): never {
  verificationFailure("SIGNATURE_INVALID", message, cause);
}

export function createArcTestnetSignatureVerifier(
  client: ArcSignatureVerificationClient,
  options: ArcSignatureVerifierOptions = {},
): ArcSignatureVerifier {
  const requiredContracts = new Set(
    (options.requireContractSigners ?? []).map((address) =>
      getAddress(address).toLowerCase(),
    ),
  );

  const assertArcTestnet = async (): Promise<void> => {
    let chainId: number;
    try {
      chainId = await client.getChainId();
    } catch (error) {
      rpcFailure("Arc signature-verification RPC is unavailable", error);
    }
    if (chainId !== Number(ARC_TESTNET_CHAIN_ID)) {
      verificationFailure(
        "CHAIN_MISMATCH",
        "Signature-verification RPC is not Arc Testnet",
      );
    }
  };

  const verify = async (
    request: AuthorizationSignatureVerificationRequest,
  ): Promise<void> => {
    await assertArcTestnet();
    const expectedSigner = getAddress(request.expectedSigner);
    let bytecode: Hex | undefined;
    try {
      bytecode = await client.getCode({ address: expectedSigner });
    } catch (error) {
      rpcFailure("Expected signer bytecode could not be read", error);
    }

    if (bytecode === undefined || bytecode === "0x") {
      if (requiredContracts.has(expectedSigner.toLowerCase())) {
        verificationFailure(
          "SIGNATURE_INVALID",
          "Expected contract signer has no deployed bytecode",
        );
      }
      let recovered: Address;
      try {
        recovered = await recoverDigestSigner(
          request.digest,
          request.signature,
        );
      } catch (error) {
        if (error instanceof CovenantVerificationError) throw error;
        verificationFailure(
          "SIGNATURE_INVALID",
          "EOA signature verification failed",
          error,
        );
      }
      if (recovered !== expectedSigner) {
        verificationFailure(
          signerFailureCode(request.kind),
          "Recovered signer is not the CovenantSpec signer",
        );
      }
      return;
    }

    let result: unknown;
    try {
      result = await client.readContract({
        address: expectedSigner,
        abi: ERC1271_ABI,
        functionName: "isValidSignature",
        args: [request.digest, request.signature],
      });
    } catch (error) {
      rpcFailure("Contract signature verification failed", error);
    }
    if (result !== ERC1271_MAGIC_VALUE) {
      verificationFailure(
        "SIGNATURE_INVALID",
        "Contract signer rejected the authorization digest",
      );
    }
  };

  return Object.freeze({
    verify,
    checkReady: async () => {
      try {
        await assertArcTestnet();
        return true;
      } catch {
        return false;
      }
    },
  });
}

export function createArcTestnetSignatureVerifierFromRpcUrl(
  rpcUrl: string,
): ArcSignatureVerifier {
  let url: URL;
  try {
    url = new URL(rpcUrl);
  } catch {
    throw new Error("COVENANT_ARC_RPC_URL is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("COVENANT_ARC_RPC_URL must be a credential-free HTTPS URL");
  }
  const publicClient = createPublicClient({ transport: http(url.href) });
  return createArcTestnetSignatureVerifier({
    getChainId: () => publicClient.getChainId(),
    getCode: ({ address }) => publicClient.getCode({ address }),
    readContract: (input) => publicClient.readContract(input),
  });
}
