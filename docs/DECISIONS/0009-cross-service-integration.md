# ADR 0009: Cross-service payment-flow integration contract

- Status: Accepted
- Date: 2026-07-28
- Scope: MVP

All capabilities in this decision are **MVP** unless explicitly labeled otherwise.

## Decision

**MVP:** COV-006 proves deterministic local composition through the built
`@covenant/agent`, `@covenant/authority`, `@covenant/executor`, and
`@covenant/spec` package boundaries. The repository-level integration sequence
is a runtime-signed Invoice, agent proposal, authority approval, explicit
approved-result handoff, executor verification, and exact simulated transaction
submission.

**MVP:** The agent result enters `processPaymentRequest` unchanged. An approved
authority result cannot enter the executor directly because it does not include
the signed PaymentIntent and its `status` field is not part of the strict
executor request. A test-local mapper therefore constructs exactly these four
fields:

1. **MVP:** `signedPaymentIntent` from the agent result.
2. **MVP:** `ruleResults` from the approved authority result.
3. **MVP:** `decisionReceipt` from the approved authority result.
4. **MVP:** `authorizationReceipt` from the approved authority result.

**MVP:** The mapper enumerates every field, accepts no override, reconstructs no
signed payload, preserves the exact envelopes and signatures, and rejects an
authority result whose status is not `APPROVED`. It exists only under the
integration-test boundary and is not an application API.

## Simulated submission boundary

**MVP:** The deterministic test transport implements only the executor's narrow
`simulate` and `submit` dependency methods. It retains defensive copies of the
exact Arc Testnet chain, trusted vault target, zero native value, and generated
`executePayment` calldata. It performs no network operation and returns the
stable opaque identifier `simulated-submission-0001`.

**MVP:** `SUBMITTED` means only that the simulated transport accepted the exact
request. Its `transactionId` is not a transaction hash, receipt, confirmed
transaction, Circle execution, vault execution, Arc settlement, or finality
claim.

## Adversarial integration boundary

**MVP:** Isolated integration fixtures model a compromised proposer by using
only the ephemeral agent proposal-signing identity to construct attacker-
recipient and excessive-amount PaymentIntents. The authority signs deterministic
rejected decisions, issues no AuthorizationReceipt, and the executor transport
is never called.

**MVP:** These fixtures do not expand the production agent API with generic
signing, authorization, execution, target selection, vendor fetching, or LLM
behavior. Private keys are generated only in the test process and are never
stored or logged.

## Scope

**MVP:** COV-006 contains built-package metadata, repository-level integration
fixtures and tests, the explicit test-only handoff, the deterministic
submission-only transport, and verification wiring.

**MVP:** Real Circle submission and real Arc deployment, funding, evidence,
receipts, revocation, bypass, settlement, and finality remain required for the
final live demonstration but are outside COV-006.

**MVP:** A demo runtime, audit event schema, timeline service, web console,
Playwright flow, network access, credentials, and production orchestration are
not implemented.

**V2:** Additional organizations, agents, vendors, products, tokens, policies,
and chains remain excluded.

**Production:** Real custody, operational monitoring, reconciliation,
compliance, incident response, and high availability remain excluded.

**Protocol:** Generic forwarding, arbitrary calls, upgradeability, and
multichain behavior remain excluded.

## Consequence

**MVP:** The repository now proves that the existing proposal, authorization,
and submission cores compose without changing a signed schema, EIP-712 field,
signer responsibility, or execution authority. CovenantVault remains the final
financial authority, and the integration result makes no settlement claim.
