# ADR 0027: Authorization completion and SDK dogfooding

**Status:** Accepted for COV-026
**Scope:** V2 — Platform v1

## Context

COV-026 dogfooding exposed a lifecycle gap: COV-024 could request authority
(`POST /v1/covenants/:id/authorize`) but no public operation could submit the
resulting externally signed evidence, so a Covenant could not safely leave
`AWAITING_AUTHORIZATION`. A project API key is intentionally not financial
authority.

## Decision

Add `POST /v1/covenants/:id/authorization-evidence`. The request transports the
existing `@covenant/core` `AuthorizationEvidence` together with the unchanged
signed PaymentIntent and canonical rule observations needed to replay the V1
authorization chain. The API authenticates the project, loads the exact
Covenant, requires the awaiting state, strictly parses the bundle, resolves a
deployment-owned V1 `CovenantSpec`, and reuses `@covenant/spec` cryptographic
verification for the existing authority and isolated signer boundary. It then
delegates the lifecycle result to `applyAuthorizationEvidence`, persists the
projection, and emits the existing webhook event. Missing verifier context
fails closed.

`/authorize` remains a request for authority workflow; it is not approval.
`@covenant/sdk` adds `submitAuthorizationEvidence(...)` as a typed transport
method. The SDK never signs, evaluates policy, calls Circle/Arc, or stores a
credential. API authentication and financial authorization remain separate.

## Boundaries

No new signer or key is created. V1 EIP-712 domains, field ordering, signed
schemas, signer responsibilities, and authority architecture are unchanged.
The API verifies but never signs; the SDK transports but never signs. Evidence
is project- and Covenant-bound, idempotent through the existing HTTP table, and
published through the existing webhook delivery path. COV-026 reference
integrations use only the SDK for Platform operations; authority evidence is
provided by deterministic test fixtures and never by application credentials.

## Consequences

The complete developer lifecycle is now explicit:

```text
create → authorize() → AWAITING_AUTHORIZATION
       → external authority evidence → submitAuthorizationEvidence(...)
       → AUTHORIZED/REJECTED → execute()
```

Deployments must provide a trusted V1 CovenantSpec resolver for evidence
verification. This is deployment configuration, not public caller input, and
the endpoint remains unavailable when it is absent. Production publication,
credentials, HA/SLO controls, and release readiness remain COV-027.
