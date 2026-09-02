# ADR 0024: Durable execution runtime and persistence

- **Status:** Accepted for COV-023
- **Scope:** V2 — Platform v1
- **Date:** 2026-09-02

## Context

ADR 0022 and ADR 0023 establish a project-isolated Platform v1 and a pure
generalized Covenant core. A production-style runtime is needed to survive
worker restarts and coordinate the existing least-authority executor without
moving financial authority off Arc.

## Decision

1. **V2:** `packages/runtime` owns operational orchestration and durable
   projections. It calls `@covenant/core` for Covenant parsing, ownership, and
   lifecycle/evidence transitions; it does not duplicate those rules.
2. **V2:** The PostgreSQL-compatible schema is `covenants`,
   `execution_operations`, and `runtime_outbox`. A self-contained SQLite
   adapter mirrors the schema for offline tests and local development.
3. **V2:** Persistence is non-authoritative. It may record project/Covenant
   association, lifecycle projections, operation identity, retry/lease state,
   provider and Arc evidence, sanitized failures, and outbox records. It never
   records private keys, Circle credentials, wallet/entity secrets, signing
   material, or arbitrary transaction payloads.
4. **V2:** An operation is keyed by the reviewed execution identity and has
   database uniqueness on `(project_id, covenant_id, execution_id)` and
   `operation_key`. Repeated identical requests join; a changed financial or
   authorization fingerprint fails closed; cross-project and cross-Covenant
   access is rejected.
5. **V2:** Runtime operational states are
   `QUEUED`, `PREPARING`, `SIMULATING`, `READY_TO_SUBMIT`,
   `SUBMISSION_STARTED`, `SUBMITTED`, `AMBIGUOUS`, `RECONCILING`,
   `SUCCEEDED`, and `TERMINAL_FAILED`.
6. **V2:** A worker claim is a leased compare-and-set version. Only one active
   lease is permitted; stale or expired writes are rejected. Pre-boundary lease
   expiry returns work to `QUEUED`; post-boundary expiry becomes
   `AMBIGUOUS` and cannot be submitted automatically.
7. **V2:** The `SUBMISSION_STARTED` boundary commits before the external
   executor call. A crash, timeout, exception, dispatch-unknown result, or
   unknown provider outcome requires reconciliation. Only an explicit provider
   assertion that no submission occurred is retryable.
8. **V2:** Provider acceptance and Arc observation are stored separately.
   Provider acceptance alone leaves the Covenant `EXECUTING`; only matching
   independent Arc success evidence allows `@covenant/core` to produce
   `EXECUTED`. Unknown Arc observation is retryable reconciliation; conflicting
   evidence fails closed.
9. **V2:** The outbox is transactional storage only. Delivery, webhooks, HTTP,
   API authentication, public SDK behavior, and external event contracts are
   deferred to later COVs.
10. **V2:** The executor integration is a narrow identity adapter. Existing
    Circle/Vault transaction construction, signing, credentials, target, token,
    chain, and calldata restrictions remain in the executor boundary.

## Consequences and limitation

The runtime provides durable idempotency, concurrency control, restart
recovery, and explicit reconciliation without claiming exactly-once external
execution. A database commit and an external Circle/Arc call are not atomic
with one another. The durable submission boundary therefore intentionally
prefers an ambiguous, operator-reconcilable operation over an unsafe automatic
resubmission.

## Rejected alternatives

- **Protocol:** Redis, MongoDB, Firebase, or an off-chain financial ledger are
  rejected; they do not match the approved PostgreSQL boundary and could be
  mistaken for spend authority.
- **V2:** A second executor or a runtime-owned signing path is rejected; it
  would duplicate and weaken the existing signer/Circle/Vault separation.
- **V2:** Webhooks and public routes are rejected for COV-023 and remain
  deferred to COV-024.
