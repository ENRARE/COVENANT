# ADR 0023: Generalized Covenant core

- **Status:** Accepted for COV-022
- **Date:** 2026-09-02
- **Scope:** V2 — Platform v1
- **Owners:** Covenant maintainers

## Context

ADR 0022 established a bounded Platform v1 for multiple developer projects and
multiple Covenant instances on Arc using six-decimal USDC. The existing MVP
schemas and execution path are frozen historical proof and cannot be
reinterpreted as a generic public resource. COV-022 therefore needs a small
domain package that can be reused by a later API without becoming an API,
database, signer, wallet, Circle, or contract implementation.

## Decision

Create the private workspace package `@covenant/core` in `packages/core`.
It owns an explicitly versioned public resource (`version: "2"`) with stable
identity, immutable `projectId` ownership, payer/beneficiary, fixed Arc and
USDC descriptors, canonical amount, versioned condition reference,
authorization status, execution status, lifecycle status, timestamps, and an
audit reference.

The package exposes pure operations for creation, project ownership checks,
authorization requests/evidence, execution requests/evidence, cancellation,
status derivation, and expiry evaluation. Every operation parses strict input,
returns a new deeply frozen value, and requires explicit evaluation timestamps.
The transition table is frozen as:

```text
CREATED -> AWAITING_AUTHORIZATION | CANCELLED | EXPIRED
AWAITING_AUTHORIZATION -> AUTHORIZED | REJECTED | CANCELLED | EXPIRED
AUTHORIZED -> EXECUTING | CANCELLED | EXPIRED
EXECUTING -> EXECUTED | FAILED
```

Terminal states cannot be reopened. Cancellation is accepted only before
execution submission starts. An ambiguous or unavailable provider/Arc result
remains `EXECUTING`; provider acceptance alone never becomes `EXECUTED`.
Independent Arc success evidence must match the Covenant, beneficiary, exact
canonical amount, fixed USDC interface, and chain. Reverted or known provider
failure is terminal `FAILED`; conflicting observations are rejected.

Existing V1 signed DecisionReceipt and AuthorizationReceipt envelopes may be
associated as evidence and are parsed by their unchanged `@covenant/spec`
schemas. Core does not change V1 fields, typed-data domains, hashes, signer
roles, or signature verification semantics.

## Alternatives considered

1. **Put these rules in the future API.** Rejected: lifecycle and ownership
   semantics would be duplicated across transports and harder to test offline.
2. **Reuse `CovenantSpec` as the public resource.** Rejected: V1 is a signed
   immutable-vault specification with different fields and historical meaning.
3. **Let Circle/provider status establish execution.** Rejected: asynchronous
   transport acceptance is not independent Arc execution evidence.
4. **Use a generic policy language, arbitrary assets, or multichain fields.**
   Rejected: these are outside the approved Platform v1 boundary.

## Consequences

- Later API and persistence work can use one deterministic domain boundary for
  project isolation and lifecycle decisions.
- Pure operations are straightforward to replay and test, but they do not
  provide durability, concurrency control, authentication, idempotency,
  polling, retries, or finality guarantees.
- Arc and six-decimal USDC remain intentional constraints; expansion requires a
  new reviewed version and domain separation.
- The package has no authority to sign, submit, move funds, or override
  existing V1 signer boundaries.

## Security impact

Strict schemas reject unknown fields, unsafe money/timestamp representations,
unsupported network/assets, malformed identifiers, and mismatched evidence.
Project ownership is checked against the immutable resource owner. Authorization
and execution evidence are separate, and onchain Arc evidence is required for
the successful terminal state. Domain errors are machine-readable without
exposing credentials or payload secrets.

## Deferred work

**V2:** COV-023 may add production-style runtime and persistence around this
boundary. **V2:** COV-024 and COV-025 may add REST and SDK clients. **Production:**
credentials, durable idempotency, monitoring, retries, incident response, and
operational controls remain deferred. **Protocol:** generic policies,
arbitrary contract execution, arbitrary assets, and multichain settlement are
excluded.
