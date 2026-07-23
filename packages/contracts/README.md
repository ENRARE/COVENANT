# Covenant contracts

## Scope

**MVP:** `CovenantVault` is one immutable Arc Testnet vault representing one Covenant. It verifies one signed `PaymentIntent` and one linked signed `AuthorizationReceipt`, enforces hard recipient, token, amount, budget, count, time, revocation, and replay limits, and transfers only the configured ERC-20 token.

**MVP:** Execution is permissionless to submit and fully signature-gated. Invoice verification, RuleResult evaluation, DecisionReceipt verification, procurement interpretation, vendor delivery, Circle integration, broadcasting deployment, services, agents, Supabase, and UI are not implemented here.

**MVP:** The only token outflow paths are an authorized payment to the immutable recipient and an issuer withdrawal to the immutable issuer after revocation or expiry. The only funding path is issuer-controlled `safeTransferFrom` for the immutable token. Every movement requires the destination's observable balance to increase by exactly the requested amount.

**MVP:** Only the configured standard Arc Testnet USDC-style token is supported. Fee-on-transfer, rebasing, success-without-transfer, and malicious token behavior are unsupported and rejected whenever observable balance deltas do not match. This is not generalized ERC-20 support.

## Pinned dependencies

**MVP:** Solidity dependencies are recorded in `packages/contracts/dependencies.lock.json` by repository, reviewed release, full commit SHA, and installation directory. OpenZeppelin Contracts `v5.6.1` is pinned to `5fd1781b1454fd1ef8e722282f86f9293cacf256`; forge-std `v1.9.7` is pinned to `77041d2ce690e692d6e03cc812b57d1ddaa4d505`. Dependency source directories are local build inputs under the ignored repository-root `lib/` directory and are not committed.

**MVP:** Install and verify both exact commits from the repository root:

```powershell
pnpm install:contracts:deps
pnpm verify:contracts:deps
```

**MVP:** Installation fetches and checks out the recorded commits in detached HEAD state. Verification fails if either checkout's `HEAD` differs from the manifest.

**MVP:** The vault uses OpenZeppelin `EIP712`, `ECDSA`, `SafeERC20`, and `ReentrancyGuard`. Canonical 65-byte low-`s` signatures are required, and replay identity never uses signature bytes.

**MVP:** Every `AuthorizationReceipt` must contain a nonzero signed `decisionId` identifying its contextual offchain `DecisionReceipt`. The trusted offchain authorization-chain verifier validates the referenced receipt and its linkage. The vault validates only the signed nonzero identifier and does not verify `DecisionReceipt` contents onchain.

**MVP:** Dependency verification checks the exact commit and origin URL, rejects concealment index flags, independently compares the exact raw bytes of every tracked working file or symbolic-link target with its pinned HEAD blob, verifies supported nested Git state, and rejects staged, ordinary-untracked, and ignored-untracked content before Forge is allowed to compile. Git content filters and line-ending transformations are not trusted as proof of equality. Existing dependency directories with transformed or altered raw content are rejected rather than normalized.

## Build and test

**MVP:** Run the contract suite from the repository root:

```powershell
forge build --root packages/contracts
forge test --root packages/contracts
```

**MVP:** Foundry tests set the chain ID to Arc Testnet `5042002`. The constructor rejects every other chain ID.

## Generated ABI

**MVP:** `packages/contracts/abi/CovenantVault.json` is the committed full ABI generated directly from Foundry output. It is the TypeScript executor's contract-call source of truth and must not be edited by hand.

**MVP:** Regenerate and verify it from the repository root:

```powershell
pnpm.cmd generate:contract-abi
pnpm.cmd verify:contract-abi
```

**MVP:** `pnpm.cmd verify` fails when the committed artifact differs byte-for-byte from current `forge inspect CovenantVault abi --root packages/contracts --json` output.

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

**MVP:** Runtime Solidity and TypeScript parity is proven only for PaymentIntent struct hashes and EIP-712 digests, AuthorizationReceipt struct hashes and EIP-712 digests, both runtime domain separators, dynamic string hashing, and canonical low-`s` signature acceptance.

**MVP:** Execution tests sign for the actual deployed test vault address. Frozen fixture digests are verified through pure hashing.

**MVP deferred:** CovenantSpec, Invoice, and DecisionReceipt Solidity hashing parity is not claimed because those objects are not verified by the runtime vault.

**Production:** Broadcast deployment, real funds, managed keys, operational monitoring, incident response, independent external audit, and formal verification remain deferred. No external audit or formal verification has occurred.

**Protocol:** Upgradeability, arbitrary calls, generalized policies, and multichain operation remain excluded.
