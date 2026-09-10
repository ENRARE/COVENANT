# Fresh Arc Testnet demo Covenant provisioning

**V2:** This runbook prepares one additional Platform v1 demo Covenant without
changing the frozen V1 schemas, EIP-712 domains, hashes, signer roles, Arc
network, USDC interface, or deployment-owned trust boundary.

## Reviewed identity and terms

**V2:** The preselected Covenant identifier is
`0x9efcc49d65443927f3c4c1bdea6e88b5d72122f8938518fb75c8cafeb955c859`.
The public API accepts this identifier through the existing optional `id` field
on `POST /v1/covenants`; it must not be omitted or regenerated after vault
deployment.

**V2:** The reviewed constructor input is
`deployment/arc-testnet/fresh-demo-deployment-plan-input.json`. It preserves
Arc Testnet chain `5042002`, the official USDC interface, the existing issuer,
agent and authorization signers, the approved recipient, a 1 USDC per-payment
limit, a 3 USDC total budget, three payments, the existing canonical policy
hash, and policy version `cov-018-testnet-1`.

**V2:** The validity window is `[1788998400, 1820534400)`, or
2026-09-10 00:00:00 UTC through 2027-09-10 00:00:00 UTC. A future Platform
Covenant must use `createdAt >= 1788998400` and `expiresAt <= 1820534400`.
The proposed V1 CovenantSpec fixes `createdAt` to `1788998400`, matching
`validAfter`; this is an offchain schema value and must not be described as the
deployment block timestamp.

**V2:** After the vault address is observed, the proposed V1 CovenantSpec is:

- `version`: `1`
- `covenantId`: `0x9efcc49d65443927f3c4c1bdea6e88b5d72122f8938518fb75c8cafeb955c859`
- `issuer`: `0x4B7b728885c6ad716B6e769BDCc13a3D63e19Ece`
- `agentSigner`: `0xa5a0c0B3279085E47E18a3e65583732E5e4000ae`
- `authorizationSigner`: `0x803fA7BDb80C6AF83e40B8Aa530A3cB867E6C967`
- `vaultAddress`: the independently verified deployment output
- `chainId`: `5042002`
- `tokenAddress`: `0x3600000000000000000000000000000000000000`
- `recipientAddress`: `0xDbf314C646792dbbD48070e799E7B1EE5d913aB1`
- `maxAmountPerPayment`: `1`
- `totalBudget`: `3`
- `maxPaymentCount`: `3`
- `validAfter`: `1788998400`
- `validUntil`: `1820534400`
- `purpose`: `COVENANT Arc Testnet approved payment demonstration`
- `policyHash`: `0x426bae23597d4adadceacd3dbef1dc20b3cdfc041693885576f632df9b70915f`
- `policyVersion`: `cov-018-testnet-1`
- `createdAt`: `1788998400`

**V2:** The plan and deployment manifest represent constructor money in base
units (`1000000` and `3000000`). CovenantSpec uses canonical six-decimal USDC
strings (`1` and `3`). Finalization must perform that exact conversion and must
not copy base-unit strings into the CovenantSpec money fields.

## Deployment boundary

**V2:** Generate and review the repository-owned offline plan:

```powershell
pnpm.cmd --silent arc:plan -- --input deployment/arc-testnet/fresh-demo-deployment-plan-input.json
```

**V2:** The command emits canonical JSON and performs no network access,
signing, persistence, or broadcast. Immediately before an approved deployment,
rerun `pnpm.cmd --silent arc:preflight`, regenerate the plan from the reviewed
commit, and compare every constructor field and commitment.

**V2:** The repository intentionally has no live broadcast command. The
existing `DeployCovenantVaultLocal.s.sol` script is synthetic and non-broadcast
only. A later deployment therefore requires a separately approved operator
transaction using the exact reviewed `CREATE` init code. Do not use or modify
the local fixture script for Arc deployment, and do not infer successful
deployment from provider acceptance.

**V2:** After provider acceptance, capture the transaction hash, committed
receipt, block number/hash, and deployed address. Independently read the code
and every immutable getter, and run the existing artifact/semantic-immutable
attestation against the exact constructor and deployed address. Only a
successful committed receipt with matching bytecode and immutables may become
the new deployment manifest.

## Trust-anchor finalization

**V2:** Do not add a placeholder vault address. After deployment verification,
create a strict manifest under a new `evidence/arc-testnet/` identity. Derive a
new runtime trust-anchor document from that manifest, preserving its exact
constructor semantics, converting six-decimal base-unit money as specified
above, and using the deployed contract address as `vaultAddress`. Set
CovenantSpec `createdAt` to the reviewed value `1788998400`; preserve the actual
deployment observation time separately in the manifest.

**V2:** Append the new `{ projectId, covenantSpec }` entry to the API
authorization artifact while retaining the old COV-010 entry byte-for-byte.
The API resolver selects only the exact project and Covenant pair and rejects
duplicates.

**V2:** Package the finalized new runtime trust anchor in
`Dockerfile.executor`. A new executor service must set
`COVENANT_VAULT_ADDRESS` to the new deployed vault and
`COVENANT_EXECUTOR_COVENANT_SPEC_FILE` to that new artifact. Each executor
instance continues to load exactly one vault-matched CovenantSpec.

## Exact executor routing

**V2:** One executor instance cannot serve both vaults: its deployment
composition owns one fixed vault address and exposes one Covenant provider.
Create a second private Railway executor service for the fresh vault. Use
`Dockerfile.executor`, the existing image command `node dist/worker-main.js`,
and port `8788`.

**V2:** The API routes by exact `(projectId, covenantId)` using
`deployment/arc-testnet/executor-worker-routes.json`. Configure
`COVENANT_EXECUTOR_WORKER_ROUTES_FILE` to the packaged route file and keep
`COVENANT_EXECUTOR_WORKER_TRANSPORT=railway-private`. There is no wildcard or
caller-selected destination.

**V2:** The new executor needs the existing secret variable classes
`CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `CIRCLE_WALLET_ID`,
`EXECUTOR_SIGNER_SOURCE`, and `COVENANT_EXECUTOR_WORKER_AUTH_TOKEN`. It also
needs the non-secret variables `ARC_RPC_URL`, `COVENANT_VAULT_ADDRESS`,
`COVENANT_EXECUTOR_COVENANT_SPEC_FILE`,
`COVENANT_EXECUTOR_SERVICE_MODULE`, and the durable operation-store directory
when explicitly configured. Secret values must be copied through Railway's
secret controls and never printed or committed.

## Ordered release sequence

1. **V2:** Review a clean commit and regenerate the offline `arc:plan` output.
2. **V2:** Run the read-only `arc:preflight` and revalidate all plan fields.
3. **V2:** Obtain explicit deployment approval, then have the approved operator
   submit exactly one CREATE deployment for the reviewed init code.
4. **V2:** Capture the transaction and committed block evidence without
   conflating provider acceptance with deployment success.
5. **V2:** Independently verify chain ID, deployed code, artifact commitments,
   and every immutable/public vault field.
6. **V2:** Finalize the deployment manifest and exact CovenantSpec using the
   observed vault address.
7. **V2:** Add the new API trust-anchor entry, new executor trust anchor, and
   exact Dockerfile copy instruction; leave COV-010 unchanged.
8. **V2:** Configure the second private executor and API route file, then
   commit, push, review, and merge the complete evidence/configuration patch.
9. **V2:** Allow Railway auto-deployment; do not invoke `railway up`.
10. **V2:** Verify API and both executors are running the merged commit and pass
    their readiness/runtime checks.
11. **V2:** Exercise the resolver read-only for the exact new project and
    Covenant identity before creating a resource.
12. **V2:** Call the public SDK create method with the exact preselected `id`,
    issuer as payer, recipient as beneficiary, `amount: "0.01"`, the reviewed
    policy hash/version, and bounded timestamps.
13. **V2:** Create and verify one fresh vendor invoice.
14. **V2:** Create and ERC-1271-sign one fresh PaymentIntent.
15. **V2:** verify `isValidSignature` on Arc Testnet returns `0x1626ba7e`.
16. **V2:** Under separate explicit funding authority, fund the new vault with
    sufficient testnet USDC and verify its balance. Vault funding is not a
    Covenant payment and is not authorized by this preparation.
17. **V2:** collect fresh vault evidence, evaluate all 11 canonical rules, sign
    both authority receipts, verify the complete chain, and submit it through
    the public SDK.
18. **V2:** Confirm `AUTHORIZED` and stop for separate payment approval.
