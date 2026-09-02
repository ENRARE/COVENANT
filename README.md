# Covenant

**MVP:** COV-001 through COV-020 proved programmable financial authority infrastructure for autonomous software. AI proposes. Covenant authorizes. Circle submits. Arc execution is independently verified.

> No component capable of generating payment requests shall possess authority to execute payments.

**MVP:** The completed proof remains frozen historical evidence under `docs/MVP_CANON.md`.

**V2:** COV-021 approves an API-first Covenant Platform v1 for multiple developer projects and Covenant instances on Arc using six-decimal USDC. The future `@covenant/sdk` is a typed client over the public API, not a second execution architecture. COV-021 is documentation only and implements neither API nor SDK runtime behavior.

## Workspace

- **MVP:** `apps/demo` â€” private server-only local simulated demo runtime.

- **MVP:** `apps/web` â€” read-only Next.js audit and execution-evidence console.
- **MVP:** `apps/agent` â€” untrusted procurement-agent scaffold.
- **MVP:** `apps/authority` â€” deterministic authority-service scaffold.
- **MVP:** `apps/executor` â€” submission-only executor scaffold.
- **MVP:** `packages/spec` â€” strict signed and operational schemas, USDC helpers, typed data, fixtures, and tests.
- **MVP:** `packages/audit` â€” pure offline deterministic non-authoritative audit projection.
- **MVP:** `packages/contracts` â€” Foundry-only immutable-vault scaffold.
- **MVP:** `packages/sdk` â€” empty SDK scaffold.
- **MVP:** `packages/config` â€” shared strict TypeScript configuration and the trusted Arc Testnet operational profile.

**V2:** The existing `packages/sdk` scaffold is the approved future typed client over the Covenant API; it remains runtime-empty in COV-021.

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

**MVP:** Arc currently documents a Prague execution target, matching the
reviewed Covenant artifact target. Arc's decimal chain ID `5042002` derives to
`0x4cef52`; the conflicting published value
`0x4CF4B2` is rejected. Native JSON-RPC USDC accounting uses 18 decimals while
wallet display, ERC-20 transfers, and Covenant business amounts use 6.

**MVP:** Arc Testnet may be unstable, and no deployment-persistence guarantee
is assumed. A successful single-provider preflight is connectivity evidence
only, not deployment, execution, settlement, or independent chain
authenticity.

**MVP:** COV-010 records one completed CovenantVault deployment on Arc Testnet
as strict public evidence at
`evidence/arc-testnet/cov-010/deployment-manifest.json`.

The record identifies contract
`0x2405Da1115B47A9D60499E12aA216874dc44c75a`, deployment transaction
`0x7b43a398b54f505131d6edc968a5c491bcdc8136f42e35cff73be1781fbf2ff4`,
and deployment block `54829529`. It adds no wallet, signing, broadcast,
funding, payment, Circle, or settlement capability.

The committed record can be verified offline with
`pnpm.cmd verify:cov010-evidence`.

The verifier strictly parses the manifest and checks its frozen deployment,
profile, plan, source, token, runtime, and canonical-document commitments. It
performs no network operation and makes no claim about current testnet
persistence, funding, payment execution, or settlement. See ADR 0013.

## Offline audit timeline

**MVP:** COV-020 advances the deterministic non-authoritative audit projector
to schema version `2`. Its closed inputs include validated demonstration,
signed-flow, executor, local-Anvil, committed Arc deployment, separate Circle
provider observation, and independently verified Arc execution evidence. It
emits one canonical sanitized JSON timeline and makes no Arc payment-settlement
or payment-finality claim.

**MVP:** Demo-derived timeline entries are observational journal evidence, not
cryptographically verified signed artifacts or independently verified policy
outputs. Executor inputs are limited to faithfully sourced `PREPARED`,
`SIMULATED`, and `SUBMITTED` outputs; `SUBMITTED` is transport acceptance only.
The projector trusts the provenance of strict upstream demo and COV-008 public
results while checking their closed schemas and supported cross-links.

```sh
pnpm audit:project < audit-source-bundle.json
```

**MVP:** The command accepts no path or network configuration and writes no
file or database. Redirected output remains observational and reconstructable.
`CovenantVault` remains authoritative for financial state.

**MVP:** The committed COV-020 console fixture records Circle durable state as
`UNKNOWN` and independently observed Arc execution as
`ARC_EXECUTION_SUCCEEDED`. Provider status alone never establishes Arc success,
and the observation performs no retry, resubmission, transaction, or contract
write.

**MVP:** The COV-006 authority-to-executor handoff enumerates exactly
`signedPaymentIntent`, `ruleResults`, `decisionReceipt`, and
`authorizationReceipt`. The simulated transport performs no network operation.
Its opaque `transactionId` is not a transaction hash, receipt, Circle execution,
vault execution, Arc settlement, or finality claim.

**MVP:** Security-critical JSON is strictly parsed before hashing. The four signed flows use detached `{ payload, signature }` envelopes, DecisionReceipt commits to the canonical rule collection, and only Arc Testnet chain ID `5042002` is accepted. Trusted verification anchors signer roles and domains to `CovenantSpec`, and complete authorization requires exact linkage through an approved all-PASS decision.

See [MVP canon](docs/MVP_CANON.md), [V2 Platform canon](docs/V2_PLATFORM_CANON.md), [security boundaries](docs/SECURITY_BOUNDARIES.md), and [threat model](docs/THREAT_MODEL.md) before changing architecture.

## Platform direction and future scope

- **V2:** ADR 0022 approves the narrow Platform v1/API/SDK direction and the COV-021 through COV-027 sequence. Each implementation COV still requires its own reviewed scope.
- **V2:** Platform v1 remains Arc-only and USDC-only; API authentication never replaces financial authorization, and offchain platform state never replaces authoritative onchain spend/replay state.
- **Production:** Real credentials, real funds, key-management infrastructure, high availability, monitoring, incident response, external audits, resilience, and compliance remain deferred.
- **Protocol:** Generic policy interpretation, arbitrary smart-contract execution, permissionless extension, and broad multichain behavior remain deferred.
