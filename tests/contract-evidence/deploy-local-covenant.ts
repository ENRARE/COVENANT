import {
  getAddress,
  getContractAddress,
  isAddressEqual,
  keccak256,
  parseEventLogs,
  stringToHex,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { evidenceFailure } from "./errors.js";
import {
  verifyExactRuntimeCode,
  verifyImmutableAwareRuntimeCode,
  type ValidatedArtifact,
} from "./contract-artifacts.js";
import type { LocalRoles } from "./role-fixtures.js";

export const LOCAL_COVENANT_ID = `0x${"01".repeat(32)}` as const;
export const LOCAL_POLICY_HASH = `0x${"02".repeat(32)}` as const;
export const LOCAL_PURPOSE = "Purchase approved GPU compute";
export const LOCAL_POLICY_VERSION = "gpu-policy-1";
export const LOCAL_PRODUCT_ID = "gpu-h100-hour";
export const LOCAL_MAX_AMOUNT = 5_000_000_000n;
export const LOCAL_TOTAL_BUDGET = 10_000_000_000n;
export const LOCAL_MAX_PAYMENT_COUNT = 3n;

export type LocalDeployment = Readonly<{
  token: Address;
  vault: Address;
  validAfter: bigint;
  validUntil: bigint;
  createdAt: bigint;
  tokenReceipt: TransactionReceipt;
  vaultReceipt: TransactionReceipt;
  tokenRuntimeHash: Hex;
  vaultRuntimeHash: Hex;
}>;

async function waitForSuccessfulDeployment(
  publicClient: PublicClient,
  hash: Hex,
  deployer: Address,
): Promise<TransactionReceipt> {
  let receipt: TransactionReceipt;
  let transaction;
  try {
    [receipt, transaction] = await Promise.all([
      publicClient.waitForTransactionReceipt({
        hash,
        timeout: 15_000,
      }),
      publicClient.getTransaction({ hash }),
    ]);
  } catch {
    evidenceFailure("DEPLOYMENT_FAILURE");
  }
  const expectedAddress = getContractAddress({
    from: deployer,
    nonce: BigInt(transaction.nonce),
  });
  if (
    receipt.transactionHash !== hash ||
    receipt.status !== "success" ||
    receipt.contractAddress === null ||
    receipt.contractAddress === undefined ||
    receipt.blockNumber <= 0n ||
    transaction.to !== null ||
    transaction.value !== 0n ||
    !isAddressEqual(transaction.from, deployer) ||
    !isAddressEqual(receipt.contractAddress, expectedAddress)
  ) {
    evidenceFailure("DEPLOYMENT_FAILURE");
  }
  return receipt;
}

async function read(
  publicClient: PublicClient,
  address: Address,
  abi: ValidatedArtifact["abi"],
  functionName: string,
  args?: readonly unknown[],
): Promise<unknown> {
  try {
    return await publicClient.readContract({
      address,
      abi,
      functionName,
      ...(args === undefined ? {} : { args }),
    });
  } catch {
    evidenceFailure("IMMUTABLE_MISMATCH");
  }
}

function requireEqual(actual: unknown, expected: unknown): void {
  if (
    typeof actual === "string" &&
    typeof expected === "string" &&
    actual.startsWith("0x") &&
    expected.startsWith("0x")
  ) {
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      evidenceFailure("IMMUTABLE_MISMATCH");
    }
    return;
  }
  if (actual !== expected) evidenceFailure("IMMUTABLE_MISMATCH");
}

export async function deployLocalCovenant(input: {
  publicClient: PublicClient;
  roles: LocalRoles;
  tokenArtifact: ValidatedArtifact;
  vaultArtifact: ValidatedArtifact;
}): Promise<LocalDeployment> {
  const { publicClient, roles, tokenArtifact, vaultArtifact } = input;
  let tokenHash: Hex;
  try {
    tokenHash = await roles.deployer.walletClient.deployContract({
      account: roles.deployer.address,
      chain: null,
      abi: tokenArtifact.abi,
      bytecode: tokenArtifact.bytecode,
      args: [],
    });
  } catch {
    evidenceFailure("DEPLOYMENT_FAILURE");
  }
  const tokenReceipt = await waitForSuccessfulDeployment(
    publicClient,
    tokenHash,
    roles.deployer.address,
  );
  if (
    tokenReceipt.contractAddress === null ||
    tokenReceipt.contractAddress === undefined
  ) {
    evidenceFailure("DEPLOYMENT_FAILURE");
  }
  const token = getAddress(tokenReceipt.contractAddress);
  const latestBlock = await publicClient.getBlock();
  const validAfter = latestBlock.timestamp - 30n;
  const createdAt = validAfter - 10n;
  const validUntil = latestBlock.timestamp + 3_600n;
  const configuration = {
    covenantId: LOCAL_COVENANT_ID,
    issuer: roles.issuer.address,
    agentSigner: roles.agent.address,
    authorizationSigner: roles.authorization.address,
    token,
    recipient: roles.recipient,
    maxAmountPerPayment: LOCAL_MAX_AMOUNT,
    totalBudget: LOCAL_TOTAL_BUDGET,
    maxPaymentCount: LOCAL_MAX_PAYMENT_COUNT,
    validAfter,
    validUntil,
    purpose: LOCAL_PURPOSE,
    policyHash: LOCAL_POLICY_HASH,
    policyVersion: LOCAL_POLICY_VERSION,
  } as const;
  let vaultHash: Hex;
  try {
    vaultHash = await roles.deployer.walletClient.deployContract({
      account: roles.deployer.address,
      chain: null,
      abi: vaultArtifact.abi,
      bytecode: vaultArtifact.bytecode,
      args: [configuration],
    });
  } catch {
    evidenceFailure("DEPLOYMENT_FAILURE");
  }
  const vaultReceipt = await waitForSuccessfulDeployment(
    publicClient,
    vaultHash,
    roles.deployer.address,
  );
  if (
    vaultReceipt.contractAddress === null ||
    vaultReceipt.contractAddress === undefined
  ) {
    evidenceFailure("DEPLOYMENT_FAILURE");
  }
  const vault = getAddress(vaultReceipt.contractAddress);
  const tokenCode = await publicClient.getCode({ address: token });
  const vaultCode = await publicClient.getCode({ address: vault });
  if (tokenCode === undefined || vaultCode === undefined) {
    evidenceFailure("CODE_MISMATCH");
  }
  verifyExactRuntimeCode(tokenCode, tokenArtifact);
  verifyImmutableAwareRuntimeCode(vaultCode, vaultArtifact);

  const getters: readonly [string, unknown][] = [
    ["covenantId", LOCAL_COVENANT_ID],
    ["issuer", roles.issuer.address],
    ["agentSigner", roles.agent.address],
    ["authorizationSigner", roles.authorization.address],
    ["token", token],
    ["recipient", roles.recipient],
    ["maxAmountPerPayment", LOCAL_MAX_AMOUNT],
    ["totalBudget", LOCAL_TOTAL_BUDGET],
    ["maxPaymentCount", LOCAL_MAX_PAYMENT_COUNT],
    ["validAfter", validAfter],
    ["validUntil", validUntil],
    ["purposeHash", keccak256(stringToHex(LOCAL_PURPOSE))],
    ["policyHash", LOCAL_POLICY_HASH],
    ["policyVersionHash", keccak256(stringToHex(LOCAL_POLICY_VERSION))],
    ["revoked", false],
    ["totalSpent", 0n],
    ["paymentCount", 0n],
  ];
  for (const [functionName, expected] of getters) {
    requireEqual(
      await read(publicClient, vault, vaultArtifact.abi, functionName),
      expected,
    );
  }
  requireEqual(
    await read(publicClient, token, tokenArtifact.abi, "decimals"),
    6,
  );
  const zeroHash = `0x${"00".repeat(32)}`;
  const replayChecks: readonly [string, readonly unknown[]][] = [
    ["usedIntentHashes", [zeroHash]],
    ["usedIntentIds", [zeroHash]],
    ["usedAgentNonces", [0n]],
    ["usedAuthorizationIds", [zeroHash]],
    ["usedAuthorizationNonces", [0n]],
  ];
  for (const [functionName, args] of replayChecks) {
    requireEqual(
      await read(publicClient, vault, vaultArtifact.abi, functionName, args),
      false,
    );
  }
  if (
    parseEventLogs({ abi: tokenArtifact.abi, logs: tokenReceipt.logs })
      .length !== 0 ||
    vaultReceipt.to !== null
  ) {
    evidenceFailure("DEPLOYMENT_FAILURE");
  }

  return Object.freeze({
    token,
    vault,
    validAfter,
    validUntil,
    createdAt,
    tokenReceipt,
    vaultReceipt,
    tokenRuntimeHash: keccak256(tokenCode),
    vaultRuntimeHash: keccak256(vaultCode),
  });
}
