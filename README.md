# Covenant

**MVP:** Covenant is programmable financial authority infrastructure for autonomous software. AI proposes, Covenant authorizes, Circle executes, and Arc settles.

> No component capable of generating payment requests shall possess authority to execute payments.

COV-001 contains repository scaffolding, frozen schemas, exact money conversion, typed-data vectors, trust boundaries, and a threat model. It contains no contract logic, Circle integration, payment execution, policy service, agent behavior, or product interface.

## Workspace

- **MVP:** `apps/demo` — private server-only local simulated demo runtime.

- **MVP:** `apps/web` — compile-only Next.js demonstration-console scaffold.
- **MVP:** `apps/agent` — untrusted procurement-agent scaffold.
- **MVP:** `apps/authority` — deterministic authority-service scaffold.
- **MVP:** `apps/executor` — submission-only executor scaffold.
- **MVP:** `packages/spec` — strict signed and operational schemas, USDC helpers, typed data, fixtures, and tests.
- **MVP:** `packages/contracts` — Foundry-only immutable-vault scaffold.
- **MVP:** `packages/sdk` — empty SDK scaffold.
- **MVP:** `packages/config` — shared strict TypeScript configuration and the trusted Arc Testnet operational profile.

## Local validation

```sh
pnpm install --frozen-lockfile
pnpm verify
```

**MVP:** `pnpm verify` validates formatting, root and workspace lint/type checks, script and schema tests, builds, environment-file policy, basic repository credential-pattern scanning, and Foundry tests. Missing Forge is a hard failure. `pnpm verify:without-contracts` is the explicitly partial local command.

**MVP:** `pnpm test:integration` runs the COV-006 repository-level suite after
the built workspace packages exist. It proves the local Invoice-to-agent-to-
authority-to-executor flow through package exports and an exact deterministic
submission simulator. `pnpm test:e2e` intentionally remains non-zero because
browser E2E is not implemented.

**MVP:** The local simulated demo lifecycle is:

```powershell
pnpm.cmd demo:reset
pnpm.cmd demo:health
pnpm.cmd demo:seed
pnpm.cmd demo:run
```

**MVP:** Demo commands emit JSON-only sanitized projections. The only runtime
mode is `LOCAL_SIMULATED`; its simulated submission is not Circle execution, an
Arc transaction, vault execution, a receipt, settlement, or finality.

**MVP:** COV-008 separately proves the real `CovenantVault` enforcement path on
an ephemeral loopback-only Anvil process with chain ID `5042002`. The command
builds current Foundry artifacts, composes the production agent, authority, and
executor cores, and verifies local receipts, exact events, token balances,
replay state, bypass rejection, and revocation:

```powershell
pnpm.cmd --silent contracts:evidence:local
```

**MVP:** The command emits one sanitized JSON document. Local Anvil evidence is
not Arc execution, Circle execution, external settlement, confirmation, or
finality. It persists no deployment state or key and does not change the
`LOCAL_SIMULATED` demo runtime.

## Arc readiness

**MVP:** COV-009 freezes the trusted Arc Testnet profile, reviewed Prague
artifact commitments, strict future deployment records, and offline
constructor/init-code commitments. It adds no wallet, signer, transaction,
funding, deployment, or broadcast capability.

```powershell
pnpm.cmd --silent arc:plan -- --input tests/fixtures/arc/deployment-plan-input.json
pnpm.cmd --silent arc:preflight
```

**MVP:** `arc:plan` is offline, accepts only one strict local regular-file
input, writes no plan, and emits one canonical `BROADCASTABLE` synthetic or
operator-supplied plan. Its seven-day minimum remaining-validity buffer is
fixed. A generated plan is not approval to deploy.

**MVP:** `arc:preflight` is an explicit read-only observation against the
committed official primary Arc endpoint. It makes only the six allowlisted
chain, block, code, and USDC view calls documented in ADR 0012. It has no
account, key, signing, transaction, persistence, or endpoint-selection
capability and is deliberately excluded from `pnpm.cmd verify`.

**MVP:** Arc currently documents an Osaka execution target while the reviewed
Covenant artifact remains explicitly compiled for Prague. Arc's decimal chain
ID `5042002` derives to `0x4cef52`; the conflicting published value
`0x4CF4B2` is rejected. Native JSON-RPC USDC accounting uses 18 decimals while
wallet display, ERC-20 transfers, and Covenant business amounts use 6.

**MVP:** Arc Testnet may be unstable, and no deployment-persistence guarantee
is assumed. A successful single-provider preflight is connectivity evidence
only, not deployment, execution, settlement, or independent chain
authenticity.

**MVP:** The COV-006 authority-to-executor handoff enumerates exactly
`signedPaymentIntent`, `ruleResults`, `decisionReceipt`, and
`authorizationReceipt`. The simulated transport performs no network operation.
Its opaque `transactionId` is not a transaction hash, receipt, Circle execution,
vault execution, Arc settlement, or finality claim.

**MVP:** Security-critical JSON is strictly parsed before hashing. The four signed flows use detached `{ payload, signature }` envelopes, DecisionReceipt commits to the canonical rule collection, and only Arc Testnet chain ID `5042002` is accepted. Trusted verification anchors signer roles and domains to `CovenantSpec`, and complete authorization requires exact linkage through an approved all-PASS decision.

See [MVP canon](docs/MVP_CANON.md), [security boundaries](docs/SECURITY_BOUNDARIES.md), and [threat model](docs/THREAT_MODEL.md) before changing architecture.

## Future scope

- **V2:** Multiple actors, assets, and reviewed policy modules are deferred.
- **Production:** Real credentials, real funds, key-management infrastructure, monitoring, resilience, and compliance are deferred.
- **Protocol:** Generalized execution, policy composition, and multichain behavior are deferred.
