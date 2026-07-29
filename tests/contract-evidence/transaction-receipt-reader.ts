import {
  getAddress,
  isAddressEqual,
  isHash,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { evidenceFailure } from "./errors.js";
import { LOCAL_CHAIN_ID } from "./schemas.js";

export type ReceiptExpectation = Readonly<{
  sender: Address;
  target: Address | null;
  status: "success" | "reverted";
  value: 0n;
}>;

export class TransactionReceiptReader {
  readonly #publicClient: PublicClient;
  readonly #expectations = new Map<Hex, ReceiptExpectation>();
  readonly #consumed = new Set<Hex>();

  constructor(publicClient: PublicClient) {
    this.#publicClient = publicClient;
  }

  register(hash: Hex, expectation: ReceiptExpectation): void {
    if (
      !isHash(hash) ||
      this.#expectations.has(hash) ||
      this.#consumed.has(hash)
    ) {
      evidenceFailure("RECEIPT_MISMATCH");
    }
    this.#expectations.set(hash, Object.freeze({ ...expectation }));
  }

  async read(transactionId: string): Promise<TransactionReceipt> {
    if (!isHash(transactionId)) evidenceFailure("RECEIPT_MISMATCH");
    const hash = transactionId;
    const expectation = this.#expectations.get(hash);
    if (expectation === undefined || this.#consumed.has(hash)) {
      evidenceFailure("RECEIPT_MISMATCH");
    }
    try {
      if ((await this.#publicClient.getChainId()) !== LOCAL_CHAIN_ID) {
        evidenceFailure("WRONG_CHAIN");
      }
    } catch {
      evidenceFailure("WRONG_CHAIN");
    }
    let receipt: TransactionReceipt;
    try {
      receipt = await this.#publicClient.waitForTransactionReceipt({
        hash,
        timeout: 15_000,
      });
    } catch {
      evidenceFailure("RECEIPT_TIMEOUT");
    }
    let transaction;
    try {
      transaction = await this.#publicClient.getTransaction({ hash });
    } catch {
      evidenceFailure("RECEIPT_MISMATCH");
    }
    const targetMatches =
      expectation.target === null
        ? transaction.to === null && receipt.contractAddress !== null
        : transaction.to !== null &&
          isAddressEqual(transaction.to, expectation.target) &&
          receipt.contractAddress === null;
    if (
      receipt.transactionHash !== hash ||
      receipt.blockNumber <= 0n ||
      receipt.status !== expectation.status ||
      transaction.value !== expectation.value ||
      !isAddressEqual(getAddress(transaction.from), expectation.sender) ||
      !targetMatches
    ) {
      evidenceFailure("RECEIPT_MISMATCH");
    }
    this.#consumed.add(hash);
    this.#expectations.delete(hash);
    return receipt;
  }
}
