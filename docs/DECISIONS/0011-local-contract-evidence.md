# ADR 0011: Deterministic local CovenantVault execution evidence

- Status: Accepted
- Date: 2026-07-29
- Scope: MVP

All capabilities in this decision are **MVP** unless explicitly labeled
otherwise.

## Decision

**MVP:** Implement COV-008 as a private repository test harness under
`tests/contract-evidence`, not as a production package or public application
API. The harness starts and owns one ephemeral loopback-only Anvil process with
the frozen chain ID `5042002`.

**MVP:** The standalone command verifies pinned contract dependencies, builds
current Foundry artifacts, runs focused contract-evidence tests, and emits one
strict sanitized JSON result:

```powershell
pnpm.cmd --silent contracts:evidence:local
```

**MVP:** The command requires no credential or external RPC, writes no
deployment state, accesses no Arc or Circle endpoint, and stops its controlled
child in `finally`.

## Roles and capabilities

**MVP:** Distinct unlocked Anvil accounts act only as deployer, issuer,
transaction payer, and attacker transaction sender. Their private keys are
never extracted, parsed, printed, or persisted.

**MVP:** The agent proposal signer, authorization signer, and vendor signer are
distinct unfunded in-process accounts. Each component receives only its narrow
signing capability. The approved recipient is distinct from every privileged
role.

**MVP:** No payment-request generator receives deployment, issuer,
authorization, payer, executor-transport, RPC, or generic-wallet authority.
The authorization signer receives no transaction or deployment capability.

## Deployment and runtime evidence

**MVP:** The harness deploys the current compiled `MockUSDC` and
`CovenantVault`. It validates artifact target and Solidity compiler version,
ABI compatibility, creation and runtime bytecode presence, exact MockUSDC
runtime bytes, and every non-immutable CovenantVault runtime byte.

**MVP:** CovenantVault immutable ranges are identified from Foundry metadata
and validated through every public getter, including hashed purpose and policy
version. The harness records runtime hashes internally but does not expose
addresses or hashes publicly.

**MVP:** The issuer receives the exact local test balance, approves the vault,
and calls the real `fund` function. Funding evidence requires successful
receipts, one exact vault funding event, one exact token transfer, exact balance
deltas, no recipient movement, and zero native value.

## Execution and rejection evidence

**MVP:** The production agent produces PaymentIntents, the production authority
reads live local vault state and produces exact decisions and authorizations,
and the production executor constructs and simulates the real
`executePayment` calldata. A distinct payer submits only that exact request.

**MVP:** Successful execution requires a successful local receipt, exact vault
and token events from exact emitters, exact token deltas, exact accounting, and
all five replay markers.

**MVP:** Replay, direct bypass, non-issuer revocation, and post-revocation
execution each require actual decoded contract revert data, a mined failed
receipt, and unchanged protected state. The post-revocation request is prepared
and authorized while the Covenant is active and submitted unchanged after
issuer revocation.

**MVP:** Local direct-bypass attempt: an attacker directly calls CovenantVault
with an agent-signed payment intent redirected to an unauthorized recipient.
CovenantVault rejects it before token movement.

**MVP:** The exact public evidence vocabulary is
`LOCAL_EVM_DEPLOYMENT_VERIFIED`, `LOCAL_VAULT_FUNDED_VERIFIED`,
`LOCAL_VAULT_EXECUTION_SUBMITTED`, `LOCAL_VAULT_EXECUTION_VERIFIED`,
`LOCAL_REPLAY_REJECTED`, `LOCAL_BYPASS_REJECTED`,
`LOCAL_NON_ISSUER_REVOCATION_REJECTED`,
`LOCAL_COVENANT_REVOCATION_VERIFIED`, and
`LOCAL_POST_REVOCATION_EXECUTION_REJECTED`.

## Honest boundary

**MVP:** These records prove enforcement only on an ephemeral local Anvil EVM.
They do not claim Arc execution, Circle execution, external settlement, Arc
confirmation, finality, production custody, or production reconciliation.

**MVP:** `apps/demo` remains unchanged in behavior with the sole
`LOCAL_SIMULATED` mode. COV-008 evidence does not enter its audit journal. The
receipt reader remains private to the test harness.

**Production:** Custody, RPC redundancy, durable deployment state,
reconciliation, monitoring, incident response, and high availability remain
deferred.

**V2:** Additional Covenants, actors, products, tokens, policies, and chains
remain deferred.

**Protocol:** Generic ABI forwarding, arbitrary calls, generic policies,
multichain execution, and upgradeability remain excluded.
