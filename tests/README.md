# Cross-package tests

**MVP:** `tests/integration` proves the COV-006 flow through the built
`@covenant/agent`, `@covenant/authority`, `@covenant/executor`, and
`@covenant/spec` package exports. Unit tests remain beside their owning package.

**MVP:** A valid runtime-signed Invoice reaches the agent, the agent result
reaches the authority unchanged, and an approved result enters the executor only
through a test-local mapper that enumerates `signedPaymentIntent`,
`ruleResults`, `decisionReceipt`, and `authorizationReceipt`.

**MVP:** The deterministic transport simulates submission only and returns an
opaque identifier. It performs no network operation and provides no transaction
hash, receipt, Circle execution, vault execution, Arc settlement, or finality
evidence.

**MVP:** Isolated compromised-proposer fixtures exercise unauthorized-recipient
and excessive-amount rejection without expanding the production agent API or
granting it authorization or execution capability.

**MVP:** `tests/e2e` remains a non-implemented Playwright scaffold.

**MVP:** `@covenant/demo` unit tests cover strict actions, audit schemas,
production-service composition, fixed-path persistence, locks, corruption,
interruption, sanitized projections, and JSON-only command behavior using
temporary repository roots.

**MVP:** The repository integration suite imports the built `@covenant/demo`
package by package name, executes the exact seventeen-event local demonstration,
and proves a completed replay performs no additional journal write.

**MVP:** `tests/contract-evidence` is the COV-008 local-only execution harness.
It starts and owns an ephemeral loopback Anvil child on chain `5042002`, deploys
current Foundry artifacts, and composes the production agent, authority, and
executor cores. Its exact command is:

```powershell
pnpm.cmd --silent contracts:evidence:local
```

**MVP:** The harness verifies deployment code and getters, funding receipts and
events, successful `executePayment`, all five replay markers, replay rejection,
the fixed direct-bypass rejection, non-issuer revocation rejection, issuer
revocation, and rejection of an authorization prepared before revocation.

**MVP:** The strict result contains only local evidence types and canonical
decimal receipt counts. It contains no key, signer, RPC URL, port, PID,
signature, signed envelope, typed data, calldata, address, receipt, raw log,
provider error, filesystem path, or environment value.

**MVP:** The harness persists no deployment or key. Its receipts, events,
balances, and state are local EVM evidence, not Arc or Circle execution,
external settlement, confirmation, or finality.

**MVP:** `@covenant/audit` tests cover COV-015 strict source and timeline
schemas, deterministic projection and canonical JSON, source shuffling,
deduplication and identity conflicts, approved and rejected paths, executor
successful-output mappings, rejection of unsupported executor failure shapes,
global demo identity conflicts, lifecycle continuity, observational demo
classification, exact compromised-scenario derivation, all nine COV-008
mappings, the committed COV-010 manifest, claim boundaries, deep freezing,
sanitized failures, and structural absence of network, custody, signing,
transaction, deployment, database, and command-execution imports. They run
offline and do not start Anvil.

**V2:** Additional organizations, agents, vendors, products, tokens, policies,
and chains remain excluded.

**Production:** Real custody, monitoring, reconciliation, compliance, and high
availability remain excluded.

**Protocol:** Generic forwarding, arbitrary calls, upgradeability, and
multichain behavior remain excluded.
