import {
  createWalletClient,
  getAddress,
  http,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem/accounts";
import { ContractEvidenceError, evidenceFailure } from "./errors.js";
import { LOCAL_CHAIN_ID } from "./schemas.js";

export type TransactionRole = Readonly<{
  address: Address;
  walletClient: WalletClient;
}>;

export type LocalRoles = Readonly<{
  deployer: TransactionRole;
  issuer: TransactionRole;
  payer: TransactionRole;
  attacker: TransactionRole;
  recipient: Address;
  agent: PrivateKeyAccount;
  authorization: PrivateKeyAccount;
  vendor: PrivateKeyAccount;
}>;

function transactionRole(address: Address, rpcUrl: string): TransactionRole {
  return Object.freeze({
    address,
    walletClient: createWalletClient({
      account: address,
      transport: http(rpcUrl),
    }),
  });
}

export async function createLocalRoles(
  publicClient: PublicClient,
  rpcUrl: string,
): Promise<LocalRoles> {
  let rawAccounts: readonly Address[];
  try {
    rawAccounts = await publicClient.request({
      method: "eth_accounts",
    } as never);
  } catch {
    evidenceFailure("STARTUP_FAILURE");
  }
  if (rawAccounts.length < 5) evidenceFailure("STARTUP_FAILURE");
  const accounts = rawAccounts
    .slice(0, 5)
    .map((address) => getAddress(address));
  const [deployer, issuer, payer, attacker, recipient] = accounts;
  if (
    deployer === undefined ||
    issuer === undefined ||
    payer === undefined ||
    attacker === undefined ||
    recipient === undefined
  ) {
    evidenceFailure("STARTUP_FAILURE");
  }

  const agent = privateKeyToAccount(generatePrivateKey());
  const authorization = privateKeyToAccount(generatePrivateKey());
  const vendor = privateKeyToAccount(generatePrivateKey());
  const allAddresses = [
    deployer,
    issuer,
    payer,
    attacker,
    recipient,
    agent.address,
    authorization.address,
    vendor.address,
  ].map((address) => address.toLowerCase());
  if (new Set(allAddresses).size !== allAddresses.length) {
    evidenceFailure("STATE_MISMATCH");
  }
  try {
    const balances = await Promise.all([
      publicClient.getBalance({ address: agent.address }),
      publicClient.getBalance({ address: authorization.address }),
      publicClient.getBalance({ address: vendor.address }),
    ]);
    if (balances.some((balance) => balance !== 0n)) {
      evidenceFailure("STATE_MISMATCH");
    }
    if ((await publicClient.getChainId()) !== LOCAL_CHAIN_ID) {
      evidenceFailure("WRONG_CHAIN");
    }
  } catch (error) {
    if (error instanceof ContractEvidenceError) throw error;
    evidenceFailure("STATE_MISMATCH");
  }

  return Object.freeze({
    deployer: transactionRole(deployer, rpcUrl),
    issuer: transactionRole(issuer, rpcUrl),
    payer: transactionRole(payer, rpcUrl),
    attacker: transactionRole(attacker, rpcUrl),
    recipient,
    agent,
    authorization,
    vendor,
  });
}
