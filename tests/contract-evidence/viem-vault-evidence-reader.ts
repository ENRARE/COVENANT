import type { EvidenceQuery, EvidenceReader } from "@covenant/authority";
import { getAddress, type Abi, type Address, type PublicClient } from "viem";
import { ContractEvidenceError, evidenceFailure } from "./errors.js";
import { LOCAL_CHAIN_ID, LOCAL_CHAIN_ID_BIGINT } from "./schemas.js";

export class ViemVaultEvidenceReader implements EvidenceReader {
  readonly #publicClient: PublicClient;
  readonly #vault: Address;
  readonly #abi: Abi;

  constructor(input: { publicClient: PublicClient; vault: Address; abi: Abi }) {
    this.#publicClient = input.publicClient;
    this.#vault = getAddress(input.vault);
    this.#abi = input.abi;
  }

  async #read(functionName: string, args?: readonly unknown[]) {
    try {
      return await this.#publicClient.readContract({
        address: this.#vault,
        abi: this.#abi,
        functionName,
        ...(args === undefined ? {} : { args }),
      });
    } catch {
      evidenceFailure("STATE_MISMATCH");
    }
  }

  async #assertBoundary(): Promise<bigint> {
    try {
      if ((await this.#publicClient.getChainId()) !== LOCAL_CHAIN_ID) {
        evidenceFailure("WRONG_CHAIN");
      }
      const code = await this.#publicClient.getCode({ address: this.#vault });
      if (code === undefined || code === "0x") evidenceFailure("CODE_MISMATCH");
      return (await this.#publicClient.getBlock()).timestamp;
    } catch (error) {
      if (error instanceof ContractEvidenceError) throw error;
      evidenceFailure("STATE_MISMATCH");
    }
  }

  async readEvidence(query: EvidenceQuery): Promise<unknown> {
    const observedAt = await this.#assertBoundary();
    const [
      covenantId,
      revoked,
      totalSpent,
      paymentCount,
      usedIntentHash,
      usedIntentId,
      usedAgentNonce,
    ] = await Promise.all([
      this.#read("covenantId"),
      this.#read("revoked"),
      this.#read("totalSpent"),
      this.#read("paymentCount"),
      this.#read("usedIntentHashes", [query.intentHash]),
      this.#read("usedIntentIds", [query.intentId]),
      this.#read("usedAgentNonces", [query.agentNonce]),
    ]);
    if (
      covenantId !== query.covenantId ||
      typeof revoked !== "boolean" ||
      typeof totalSpent !== "bigint" ||
      typeof paymentCount !== "bigint" ||
      typeof usedIntentHash !== "boolean" ||
      typeof usedIntentId !== "boolean" ||
      typeof usedAgentNonce !== "boolean"
    ) {
      evidenceFailure("STATE_MISMATCH");
    }
    return Object.freeze({
      chainId: LOCAL_CHAIN_ID_BIGINT,
      vaultAddress: this.#vault,
      observedAt,
      revoked,
      totalSpent,
      paymentCount,
      usedIntentHash,
      usedIntentId,
      usedAgentNonce,
    });
  }

  async isAuthorizationNonceUsed(nonce: bigint): Promise<unknown> {
    await this.#assertBoundary();
    const used = await this.#read("usedAuthorizationNonces", [nonce]);
    if (typeof used !== "boolean") evidenceFailure("STATE_MISMATCH");
    return used;
  }
}
