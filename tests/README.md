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

**V2:** Additional organizations, agents, vendors, products, tokens, policies,
and chains remain excluded.

**Production:** Real custody, monitoring, reconciliation, compliance, and high
availability remain excluded.

**Protocol:** Generic forwarding, arbitrary calls, upgradeability, and
multichain behavior remain excluded.
