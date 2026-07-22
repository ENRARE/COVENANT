# Covenant contracts

## Scope

**MVP:** `CovenantVault` is one immutable Arc Testnet vault representing one Covenant. It verifies one signed `PaymentIntent` and one linked signed `AuthorizationReceipt`, enforces hard recipient, token, amount, budget, count, time, revocation, and replay limits, and transfers only the configured ERC-20 token.

**MVP:** Execution is permissionless to submit and fully signature-gated. Invoice verification, RuleResult evaluation, DecisionReceipt verification, procurement interpretation, vendor delivery, Circle integration, broadcasting deployment, services, agents, Supabase, and UI are not implemented here.

**MVP:** The only token outflow paths are an authorized payment to the immutable recipient and an issuer withdrawal to the immutable issuer after revocation or expiry. The only funding path is issuer-controlled `safeTransferFrom` for the immutable token.

## Pinned dependencies

**MVP:** OpenZeppelin Contracts is pinned to `v5.6.1`, and forge-std is pinned to `v1.9.7`. Dependency source directories are local build inputs under the ignored repository-root `lib/` directory and are not committed.

**MVP:** Install both exact versions from the repository root:

```powershell
forge install --no-git --shallow openzeppelin-contracts=OpenZeppelin/openzeppelin-contracts@tag=v5.6.1 forge-std=foundry-rs/forge-std@tag=v1.9.7
```

**MVP:** The vault uses OpenZeppelin `EIP712`, `ECDSA`, `SafeERC20`, and `ReentrancyGuard`. Canonical 65-byte low-`s` signatures are required, and replay identity never uses signature bytes.

## Build and test

**MVP:** Run the contract suite from the repository root:

```powershell
forge build --root packages/contracts
forge test --root packages/contracts
```

**MVP:** Foundry tests set the chain ID to Arc Testnet `5042002`. The constructor rejects every other chain ID.

## Local simulation

**MVP:** Start local Anvil with the frozen Arc chain ID:

```powershell
anvil --chain-id 5042002
```

**MVP:** The local script uses only synthetic fixture addresses and does not call `vm.startBroadcast`. Run its simulation without `--broadcast`:

```powershell
Push-Location packages/contracts
forge script --root . script/DeployCovenantVaultLocal.s.sol:DeployCovenantVaultLocal --chain-id 5042002
Pop-Location
```

**MVP:** A later approved deployment should use the issuer wallet when practical, but vault authority never depends on `msg.sender` during construction.

## Parity boundary

**MVP:** Solidity and TypeScript parity is proven for PaymentIntent struct hashes and EIP-712 digests, AuthorizationReceipt struct hashes and EIP-712 digests, both runtime domain separators, dynamic string hashing, and canonical low-`s` signature acceptance.

**MVP:** Execution tests sign for the actual deployed test vault address. Frozen fixture digests are verified through pure hashing.

**MVP deferred:** CovenantSpec, Invoice, and DecisionReceipt Solidity hashing parity is not claimed because those objects are not verified by the runtime vault.

**Production:** Broadcast deployment, real funds, managed keys, operational monitoring, incident response, and independent audit remain deferred.

**Protocol:** Upgradeability, arbitrary calls, generalized policies, and multichain operation remain excluded.
