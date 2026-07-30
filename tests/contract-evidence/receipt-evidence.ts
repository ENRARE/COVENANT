import {
  decodeErrorResult,
  decodeEventLog,
  isAddressEqual,
  type Abi,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { evidenceFailure } from "./errors.js";
import type {
  ReceiptExpectation,
  TransactionReceiptReader,
} from "./transaction-receipt-reader.js";

type DecodedEvidenceEvent = Readonly<{
  eventName: string;
  args: unknown;
}>;

function matchingLogs(
  receipt: TransactionReceipt,
  emitter: Address,
  abi: Abi,
  eventName: string,
): readonly DecodedEvidenceEvent[] {
  const decoded: DecodedEvidenceEvent[] = [];
  for (const log of receipt.logs) {
    if (!isAddressEqual(log.address, emitter)) continue;
    try {
      const event = decodeEventLog({
        abi,
        data: log.data,
        topics: log.topics,
      }) as unknown;
      const candidate = event as Partial<DecodedEvidenceEvent>;
      if (candidate.eventName === eventName) {
        decoded.push({ eventName, args: candidate.args });
      }
    } catch {
      // Other events from the exact emitter are not evidence for this record.
    }
  }
  return decoded;
}

export function requireSingleEvent(input: {
  receipt: TransactionReceipt;
  emitter: Address;
  abi: Abi;
  eventName: string;
}): DecodedEvidenceEvent {
  const events = matchingLogs(
    input.receipt,
    input.emitter,
    input.abi,
    input.eventName,
  );
  if (events.length !== 1) evidenceFailure("EVENT_MISMATCH");
  const event = events[0];
  if (event === undefined) evidenceFailure("EVENT_MISMATCH");
  return event;
}

export function requireNoEvent(input: {
  receipt: TransactionReceipt;
  emitter: Address;
  abi: Abi;
  eventName: string;
}): void {
  if (
    matchingLogs(input.receipt, input.emitter, input.abi, input.eventName)
      .length !== 0
  ) {
    evidenceFailure("EVENT_MISMATCH");
  }
}

function extractRevertData(
  value: unknown,
  seen = new Set<object>(),
): Hex | null {
  if (typeof value === "string" && /^0x[0-9a-fA-F]{8,}$/u.test(value)) {
    return value as Hex;
  }
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return null;
  }
  seen.add(value);
  for (const key of ["data", "cause", "error", "details"]) {
    const nested = extractRevertData(
      (value as Record<string, unknown>)[key],
      seen,
    );
    if (nested !== null) return nested;
  }
  return null;
}

export async function requireRevertData(input: {
  publicClient: PublicClient;
  from: Address;
  to: Address;
  data: Hex;
  abi: Abi;
  errorName: string;
}): Promise<void> {
  let reverted = false;
  try {
    await input.publicClient.call({
      account: input.from,
      to: input.to,
      data: input.data,
      value: 0n,
    });
  } catch (error) {
    const data = extractRevertData(error);
    if (data === null) evidenceFailure("UNEXPECTED_REVERT");
    try {
      const decoded = decodeErrorResult({ abi: input.abi, data });
      reverted = decoded.errorName === input.errorName;
    } catch {
      evidenceFailure("UNEXPECTED_REVERT");
    }
  }
  if (!reverted) evidenceFailure("UNEXPECTED_REVERT");
}

export async function submitExpectedRevert(input: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  sender: Address;
  target: Address;
  data: Hex;
  abi: Abi;
  errorName: string;
  receiptReader: TransactionReceiptReader;
}): Promise<TransactionReceipt> {
  await requireRevertData({
    publicClient: input.publicClient,
    from: input.sender,
    to: input.target,
    data: input.data,
    abi: input.abi,
    errorName: input.errorName,
  });
  let hash: Hex;
  try {
    hash = await input.walletClient.sendTransaction({
      account: input.sender,
      chain: null,
      to: input.target,
      data: input.data,
      value: 0n,
      gas: 2_000_000n,
    });
  } catch {
    evidenceFailure("SUBMISSION_FAILURE");
  }
  const expectation: ReceiptExpectation = {
    sender: input.sender,
    target: input.target,
    status: "reverted",
    value: 0n,
  };
  input.receiptReader.register(hash, expectation);
  return input.receiptReader.read(hash);
}

export function eventArgs(
  event: DecodedEvidenceEvent,
): Record<string, unknown> {
  if (
    typeof event.args !== "object" ||
    event.args === null ||
    Array.isArray(event.args)
  ) {
    evidenceFailure("EVENT_MISMATCH");
  }
  return event.args as Record<string, unknown>;
}

export type InternalLog = Log;
