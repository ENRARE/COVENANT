import {
  encodeAbiParameters,
  keccak256,
  pad,
  stringToHex,
  type Address,
} from "viem";

export const COV018_ARC_EXPECTED = Object.freeze({
  chainId: 5_042_002,
  transactionHash:
    "0x1429af87afb5865933cb4bc3870100c8c4d0cde8795efc54e07a9460f8acea55",
  vault: "0x39400A08b37B1121a8cc5AB9102943236eB58ECe",
  token: "0x3600000000000000000000000000000000000000",
  recipient: "0xDbf314C646792dbbD48070e799E7B1EE5d913aB1",
  amount: "10000",
  covenantId:
    "0x1b3ab98ee8e6f18c8710ad37dcffcc845531130c04b045d0f520d21824f57120",
  intentId:
    "0x628514c667ea8d74d943e85857ab4e996ee5d07d846dc420a6e8deacd8fe4b23",
  authorizationId:
    "0x5462cb6b986b01d5f502c3c6f095d52d9e3f162047daf1e644d5666be9f3b496",
  priorVaultState: Object.freeze({
    totalSpent: "0",
    paymentCount: "0",
    tokenBalance: "3000000",
  }),
});

export const COV018_PAYMENT_TOPIC = keccak256(
  stringToHex(
    "PaymentExecuted(bytes32,bytes32,bytes32,bytes32,bytes32,uint256,address,uint256,uint256,uint256)",
  ),
);
export const COV018_TRANSFER_TOPIC = keccak256(
  stringToHex("Transfer(address,address,uint256)"),
);
export const COV018_BLOCK_HASH = `0x${"ab".repeat(32)}` as const;

export function cov018PaymentData(
  recipient: Address = COV018_ARC_EXPECTED.recipient,
  amount = 10_000n,
  totalSpent = 10_000n,
  paymentCount = 1n,
) {
  return encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [
      `0x${"62".repeat(32)}`,
      `0x${"31".repeat(32)}`,
      0n,
      recipient,
      amount,
      totalSpent,
      paymentCount,
    ],
  );
}

export function cov018TransferData(amount = 10_000n) {
  return encodeAbiParameters([{ type: "uint256" }], [amount]);
}

const commonLog = {
  transactionHash: COV018_ARC_EXPECTED.transactionHash,
  blockHash: COV018_BLOCK_HASH,
  blockNumber: "0x3584901",
  removed: false,
} as const;

export const COV018_ARC_RAW_FIXTURE = Object.freeze({
  chainId: "0x4cef52",
  receipt: Object.freeze({
    transactionHash: COV018_ARC_EXPECTED.transactionHash,
    to: COV018_ARC_EXPECTED.vault,
    blockHash: COV018_BLOCK_HASH,
    blockNumber: "0x3584901",
    status: "0x1",
    logs: Object.freeze([
      Object.freeze({
        ...commonLog,
        address: COV018_ARC_EXPECTED.token,
        logIndex: "0x0",
        topics: Object.freeze([
          COV018_TRANSFER_TOPIC,
          pad(COV018_ARC_EXPECTED.vault, { size: 32 }),
          pad(COV018_ARC_EXPECTED.recipient, { size: 32 }),
        ]),
        data: cov018TransferData(),
      }),
      Object.freeze({
        ...commonLog,
        address: COV018_ARC_EXPECTED.vault,
        logIndex: "0x1",
        topics: Object.freeze([
          COV018_PAYMENT_TOPIC,
          COV018_ARC_EXPECTED.covenantId,
          COV018_ARC_EXPECTED.intentId,
          COV018_ARC_EXPECTED.authorizationId,
        ]),
        data: cov018PaymentData(),
      }),
    ]),
  }),
  block: Object.freeze({ number: "0x3584901", hash: COV018_BLOCK_HASH }),
  vaultState: Object.freeze({
    totalSpent: "0x2710",
    paymentCount: "0x1",
    revoked: false,
    tokenBalance: "0x2d9fb0",
  }),
  circleLocalDurableState: "UNKNOWN",
});
