import {
  decodeAbiParameters,
  getAddress,
  isAddressEqual,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import {
  parseArcBlock,
  parseArcChainId,
  parseArcReceipt,
  parseArcVaultState,
  parseKnownArcExecution,
} from "./schemas.js";
import {
  ARC_TESTNET_CHAIN_ID,
  type ArcEvidenceConflictReason,
  type ArcExecutionEvidenceReader,
  type KnownArcObservationSource,
  type KnownArcExecution,
} from "./types.js";

const PAYMENT_EXECUTED_TOPIC = keccak256(
  stringToHex(
    "PaymentExecuted(bytes32,bytes32,bytes32,bytes32,bytes32,uint256,address,uint256,uint256,uint256)",
  ),
);
const TRANSFER_TOPIC = keccak256(
  stringToHex("Transfer(address,address,uint256)"),
);

type ParsedLog = ReturnType<typeof parseArcReceipt>["logs"][number];

class EvidenceConflict extends Error {
  constructor(readonly reason: ArcEvidenceConflictReason) {
    super(reason);
    delete this.stack;
  }
}

function conflict(reason: ArcEvidenceConflictReason): never {
  throw new EvidenceConflict(reason);
}

function equalHex(left: Hex, right: Hex): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function topicAddress(topic: Hex): Address {
  if (!/^0x0{24}[0-9a-f]{40}$/.test(topic))
    conflict("MALFORMED_TOKEN_TRANSFER");
  return getAddress(`0x${topic.slice(26)}`);
}

function selectSingleLog(
  logs: readonly ParsedLog[],
  topic: Hex,
  missing: ArcEvidenceConflictReason,
  duplicate: ArcEvidenceConflictReason,
): ParsedLog {
  const matches = logs.filter((log) => {
    const candidate = log.topics[0];
    return candidate !== undefined && equalHex(candidate, topic);
  });
  if (matches.length === 0) conflict(missing);
  if (matches.length !== 1) conflict(duplicate);
  const match = matches[0];
  if (match === undefined) conflict(missing);
  return match;
}

function requiredTopic(
  log: ParsedLog,
  index: number,
  reason: ArcEvidenceConflictReason,
): Hex {
  const topic = log.topics[index];
  if (topic === undefined) conflict(reason);
  return topic;
}

function verifyLogIdentity(
  logs: readonly ParsedLog[],
  transactionHash: Hex,
  blockHash: Hex,
  blockNumber: bigint,
): void {
  const indexes = new Set<string>();
  for (const log of logs) {
    if (log.removed) conflict("REMOVED_LOG");
    if (
      !equalHex(log.transactionHash, transactionHash) ||
      !equalHex(log.blockHash, blockHash) ||
      log.blockNumber !== blockNumber
    ) {
      conflict("BLOCK_MISMATCH");
    }
    const index = log.logIndex.toString();
    if (indexes.has(index)) conflict("BLOCK_MISMATCH");
    indexes.add(index);
  }
}

function verifyPaymentLog(log: ParsedLog, expected: KnownArcExecution) {
  if (!isAddressEqual(log.address, expected.vault))
    conflict("WRONG_PAYMENT_EVENT_VAULT");
  if (log.topics.length !== 4) conflict("MALFORMED_PAYMENT_EXECUTED");
  let decoded: readonly [Hex, Hex, bigint, Address, bigint, bigint, bigint];
  try {
    decoded = decodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      log.data as Hex,
    );
  } catch {
    conflict("MALFORMED_PAYMENT_EXECUTED");
  }
  if (
    !equalHex(
      requiredTopic(log, 1, "MALFORMED_PAYMENT_EXECUTED"),
      expected.covenantId,
    )
  )
    conflict("WRONG_COVENANT_ID");
  if (
    !equalHex(
      requiredTopic(log, 2, "MALFORMED_PAYMENT_EXECUTED"),
      expected.intentId,
    )
  )
    conflict("WRONG_INTENT_ID");
  if (
    !equalHex(
      requiredTopic(log, 3, "MALFORMED_PAYMENT_EXECUTED"),
      expected.authorizationId,
    )
  )
    conflict("WRONG_AUTHORIZATION_ID");
  const [, , , recipient, amount, totalSpent, paymentCount] = decoded;
  if (!isAddressEqual(recipient, expected.recipient))
    conflict("WRONG_RECIPIENT");
  if (amount !== BigInt(expected.amount)) conflict("WRONG_AMOUNT");
  return { totalSpent, paymentCount } as const;
}

function verifyTransferLog(log: ParsedLog, expected: KnownArcExecution) {
  if (!isAddressEqual(log.address, expected.token)) conflict("WRONG_TOKEN");
  if (log.topics.length !== 3) conflict("MALFORMED_TOKEN_TRANSFER");
  let amount: bigint;
  try {
    [amount] = decodeAbiParameters([{ type: "uint256" }], log.data as Hex);
  } catch {
    conflict("MALFORMED_TOKEN_TRANSFER");
  }
  const source = topicAddress(
    requiredTopic(log, 1, "MALFORMED_TOKEN_TRANSFER"),
  );
  const recipient = topicAddress(
    requiredTopic(log, 2, "MALFORMED_TOKEN_TRANSFER"),
  );
  if (!isAddressEqual(source, expected.vault))
    conflict("WRONG_TRANSFER_SOURCE");
  if (!isAddressEqual(recipient, expected.recipient))
    conflict("WRONG_TRANSFER_RECIPIENT");
  if (amount !== BigInt(expected.amount)) conflict("WRONG_TRANSFER_AMOUNT");
  return { source, recipient, amount } as const;
}

function verifyVaultState(
  rawState: unknown,
  expected: KnownArcExecution,
  eventState: Readonly<{ totalSpent: bigint; paymentCount: bigint }>,
) {
  let state: ReturnType<typeof parseArcVaultState>;
  try {
    state = parseArcVaultState(rawState);
  } catch {
    conflict("MALFORMED_VAULT_STATE");
  }
  if (
    state.totalSpent !== eventState.totalSpent ||
    state.paymentCount !== eventState.paymentCount
  ) {
    conflict("VAULT_STATE_CONFLICT");
  }
  const prior = expected.priorVaultState;
  const amount = BigInt(expected.amount);
  if (
    prior !== undefined &&
    (BigInt(prior.totalSpent) + amount !== state.totalSpent ||
      BigInt(prior.paymentCount) + 1n !== state.paymentCount ||
      BigInt(prior.tokenBalance) < amount ||
      BigInt(prior.tokenBalance) - amount !== state.tokenBalance)
  ) {
    conflict("VAULT_STATE_CONFLICT");
  }
  return Object.freeze({
    totalSpent: state.totalSpent.toString(),
    paymentCount: state.paymentCount.toString(),
    revoked: state.revoked,
    tokenBalance: state.tokenBalance.toString(),
  });
}

export function createArcExecutionEvidenceReader(
  source: KnownArcObservationSource,
): ArcExecutionEvidenceReader {
  // Retain only the four approved reads. Any additional capability accidentally
  // present on the injected object is not reachable from the returned reader.
  const readChainId = source.readChainId;
  const readKnownTransactionReceipt = source.readKnownTransactionReceipt;
  const readReceiptBlock = source.readReceiptBlock;
  const readKnownVaultStateAtReceiptBlock =
    source.readKnownVaultStateAtReceiptBlock;
  return Object.freeze({
    async observeKnownExecution(rawExpected: unknown) {
      let expected: KnownArcExecution;
      try {
        expected = parseKnownArcExecution(rawExpected);
      } catch {
        return Object.freeze({
          status: "EVIDENCE_CONFLICT",
          reason: "MALFORMED_EXPECTATION",
        });
      }

      try {
        const rawChainId = await readChainId();
        let chainId: bigint;
        try {
          chainId = parseArcChainId(rawChainId);
        } catch {
          conflict("WRONG_CHAIN");
        }
        if (chainId !== BigInt(ARC_TESTNET_CHAIN_ID)) conflict("WRONG_CHAIN");

        const rawReceipt = await readKnownTransactionReceipt();
        if (rawReceipt === null)
          return Object.freeze({ status: "NOT_OBSERVED" });
        let receipt: ReturnType<typeof parseArcReceipt>;
        try {
          receipt = parseArcReceipt(rawReceipt);
        } catch {
          conflict("MALFORMED_RECEIPT");
        }
        if (!equalHex(receipt.transactionHash, expected.transactionHash))
          conflict("TRANSACTION_HASH_MISMATCH");
        if (!isAddressEqual(receipt.to, expected.vault))
          conflict("VAULT_TARGET_MISMATCH");

        const rawBlock = await readReceiptBlock();
        let block: ReturnType<typeof parseArcBlock>;
        try {
          block = parseArcBlock(rawBlock);
        } catch {
          conflict("MALFORMED_BLOCK");
        }
        if (
          block.number !== receipt.blockNumber ||
          !equalHex(block.hash, receipt.blockHash)
        ) {
          conflict("BLOCK_MISMATCH");
        }
        verifyLogIdentity(
          receipt.logs,
          receipt.transactionHash,
          receipt.blockHash,
          receipt.blockNumber,
        );

        const common = {
          chainId: ARC_TESTNET_CHAIN_ID,
          transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber.toString(),
          blockHash: receipt.blockHash,
          vault: receipt.to,
        } as const;
        if (receipt.status === "0x0") {
          if (receipt.logs.length !== 0) conflict("REVERTED_RECEIPT_HAS_LOGS");
          return Object.freeze({ status: "OBSERVED_REVERTED", ...common });
        }

        const paymentLog = selectSingleLog(
          receipt.logs,
          PAYMENT_EXECUTED_TOPIC,
          "MISSING_PAYMENT_EXECUTED",
          "DUPLICATE_PAYMENT_EXECUTED",
        );
        const payment = verifyPaymentLog(paymentLog, expected);
        const transferLog = selectSingleLog(
          receipt.logs,
          TRANSFER_TOPIC,
          "MISSING_TOKEN_TRANSFER",
          "DUPLICATE_TOKEN_TRANSFER",
        );
        const transfer = verifyTransferLog(transferLog, expected);
        const vaultState = verifyVaultState(
          await readKnownVaultStateAtReceiptBlock(),
          expected,
          payment,
        );
        return Object.freeze({
          status: "OBSERVED_SUCCESS",
          ...common,
          covenantId: expected.covenantId,
          intentId: expected.intentId,
          authorizationId: expected.authorizationId,
          recipient: expected.recipient,
          amount: expected.amount,
          token: expected.token,
          transfer: Object.freeze({
            source: transfer.source,
            recipient: transfer.recipient,
            amount: transfer.amount.toString(),
          }),
          vaultState,
        });
      } catch (error) {
        if (error instanceof EvidenceConflict) {
          return Object.freeze({
            status: "EVIDENCE_CONFLICT",
            reason: error.reason,
          });
        }
        return Object.freeze({ status: "OBSERVATION_UNAVAILABLE" });
      }
    },
  });
}
