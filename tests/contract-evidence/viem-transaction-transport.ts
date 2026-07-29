import type {
  AuthorizedTransactionRequest,
  TransactionTransport,
} from "@covenant/executor";
import {
  getAddress,
  isAddressEqual,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { evidenceFailure } from "./errors.js";
import { LOCAL_CHAIN_ID, LOCAL_CHAIN_ID_BIGINT } from "./schemas.js";

const EXECUTE_PAYMENT_SELECTOR = "0x7ee0e4da";

function sameRequest(
  left: AuthorizedTransactionRequest,
  right: AuthorizedTransactionRequest,
): boolean {
  return isAddressEqual(left.to, right.to) && left.data === right.data;
}

export class ViemTransactionTransport implements TransactionTransport {
  readonly #publicClient: PublicClient;
  readonly #walletClient: WalletClient;
  readonly #payer: Address;
  readonly #vault: Address;
  #lastSimulation: AuthorizedTransactionRequest | undefined;
  readonly submittedHashes = new Set<Hex>();

  constructor(input: {
    publicClient: PublicClient;
    walletClient: WalletClient;
    payer: Address;
    vault: Address;
  }) {
    this.#publicClient = input.publicClient;
    this.#walletClient = input.walletClient;
    this.#payer = getAddress(input.payer);
    this.#vault = getAddress(input.vault);
  }

  async #assertRequest(request: AuthorizedTransactionRequest): Promise<void> {
    const runtimeRequest = request as unknown as Readonly<{
      chainId: bigint;
      value: bigint;
    }>;
    if (
      runtimeRequest.chainId !== LOCAL_CHAIN_ID_BIGINT ||
      !isAddressEqual(request.to, this.#vault) ||
      runtimeRequest.value !== 0n ||
      !request.data.startsWith(EXECUTE_PAYMENT_SELECTOR)
    ) {
      evidenceFailure("SUBMISSION_FAILURE");
    }
    try {
      if ((await this.#publicClient.getChainId()) !== LOCAL_CHAIN_ID) {
        evidenceFailure("WRONG_CHAIN");
      }
    } catch {
      evidenceFailure("WRONG_CHAIN");
    }
  }

  async simulate(request: AuthorizedTransactionRequest): Promise<unknown> {
    await this.#assertRequest(request);
    try {
      await this.#publicClient.call({
        account: this.#payer,
        to: this.#vault,
        data: request.data,
        value: 0n,
      });
    } catch {
      evidenceFailure("SIMULATION_FAILURE");
    }
    this.#lastSimulation = Object.freeze({ ...request });
    return Object.freeze({ status: "SIMULATED" });
  }

  async submit(request: AuthorizedTransactionRequest): Promise<unknown> {
    await this.#assertRequest(request);
    if (
      this.#lastSimulation === undefined ||
      !sameRequest(this.#lastSimulation, request)
    ) {
      evidenceFailure("SUBMISSION_FAILURE");
    }
    let hash: Hex;
    try {
      hash = await this.#walletClient.sendTransaction({
        account: this.#payer,
        chain: null,
        to: this.#vault,
        data: request.data,
        value: 0n,
      });
    } catch {
      evidenceFailure("SUBMISSION_FAILURE");
    }
    this.submittedHashes.add(hash);
    return Object.freeze({ status: "SUBMITTED", transactionId: hash });
  }
}
