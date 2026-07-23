# ADR 0006: Authority application core

- Status: Accepted
- Date: 2026-07-23
- Scope: MVP

All capabilities in this decision are **MVP** unless explicitly labeled otherwise.

## Decision

**MVP:** Implement COV-003 as a pure dependency-injected application core under `apps/authority`. It exposes `evaluatePaymentRequest`, `issueAuthorization`, and `processPaymentRequest` without an HTTP transport or any payment-execution behavior.

**MVP:** The application loads the single Covenant only from an injected trusted provider and strictly parses it on every operation. There is no signed CovenantSpec envelope. Caller-supplied Covenant configuration, domains, hashes, receipt fields, identifiers, and authorization nonces are never authoritative.

**MVP:** Signing remains an isolated injected capability with a configured public address and separate DecisionReceipt and AuthorizationReceipt methods. Each method receives exact typed data and returns only a detached signature. The application owns no private key, constructs the payload internally, strictly validates the signature, assembles the envelope, and self-verifies it with `@covenant/spec`.

**MVP:** Trusted procurement configuration contains one approved vendor signer and the `gpu-h100-hour` product. Invoice authorization requires a canonical signature from that vendor, exact Invoice digest linkage, equal recipient, token, and amount, and the approved product. Purpose is checked separately against the Covenant for both the intent and Invoice.

## Canonical policy

**MVP:** Evaluate the frozen 11 rules in `@covenant/spec` order without sorting or early exit. The semantics are:

1. **MVP:** `covenant_active` checks evidence chain and vault, non-revocation, Covenant activation and expiry, payment-count capacity, non-future observation, and a maximum evidence age of 30 seconds.
2. **MVP:** `intent_signature_valid` checks canonical nonzero recovery under the Covenant-derived PaymentIntent domain without granting agent authority.
3. **MVP:** `agent_authorized` checks recovered signer, payload agent, and proposal Covenant identity against the trusted Covenant.
4. **MVP:** `recipient_allowed` checks the configured recipient.
5. **MVP:** `token_allowed` checks the configured token.
6. **MVP:** `amount_within_limit` checks a positive amount, per-payment maximum, coherent total-spent evidence, and remaining total budget.
7. **MVP:** `invoice_signature_valid` checks canonical recovery and both recovered and payload vendor identity against the approved vendor.
8. **MVP:** `invoice_matches_intent` checks digest, recipient, token, amount, and approved product linkage.
9. **MVP:** `purpose_allowed` checks both signed purposes against the Covenant.
10. **MVP:** `intent_not_expired` checks current intent and Invoice time plus intent containment within the Covenant window.
11. **MVP:** `nonce_unused` checks authoritative evidence for unused intent digest, intent ID, and agent nonce.

**MVP:** RuleResult expected, actual, and reason values are stable, bounded, machine-readable, and contain no signatures, typed-data payloads, secrets, raw exceptions, or stack traces. All-PASS is `APPROVED`; any failure is `REJECTED`.

## Decisions and authorizations

**MVP:** Structurally malformed requests fail at the public boundary with no DecisionReceipt. Every schema-valid request receives a signed DecisionReceipt, including malicious, mismatched, expired, and incorrectly signed requests. Rejected decisions never receive authorization.

**MVP:** Only approved decisions are idempotent. Identity includes the Covenant ID and exact PaymentIntent and Invoice digests. Current supplied signatures, vendor authority, Invoice binding, and rule outcome are independently revalidated before returning a cached approval. Rejected decisions are not cached, preventing first-submission poisoning.

**MVP:** Authorization requires the original signed PaymentIntent and Invoice, canonical RuleResults, and signed DecisionReceipt. The application independently recomputes all hashes, verifies all signatures and cross-object linkages, rereads current evidence, and requires the hard financial and replay conditions to remain valid before reserving an authorization ID or nonce.

**MVP:** Authorization identity includes Covenant ID, signed decision identifier and digest, PaymentIntent digest, and Invoice digest. Concurrent duplicates share one pending operation. One stable authorization ID and nonce are retained for the identity across signer failure; the nonce is never reassigned. Candidates already consumed before reservation are skipped. Every retry rechecks the retained candidate, and a subsequently consumed retained nonce terminates issuance with `AUTHORIZATION_NONCE_CONSUMED` without generating a replacement identifier, nonce, signature, or receipt.

**MVP:** All injected calls use a common exception-sanitizing boundary with dependency-specific stable codes and static messages. This includes Covenant loading, clock reads, evidence and nonce-consumption reads, signer address access, both signing operations, identifier generation, and all three repositories. Concurrent joiners observe the same sanitized failure rather than raw adapter details.

**MVP:** Authorization validity is `min(now + 300 seconds, PaymentIntent.expiresAt, Invoice.expiresAt, CovenantSpec.validUntil)` and must follow both current time and DecisionReceipt creation time.

## State and exclusions

**MVP:** In-memory repositories coordinate demonstration issuance only. They do not own authoritative spend, payment-count, revocation, or replay state. CovenantVault remains authoritative and performs final settlement enforcement.

**MVP:** COV-003 excludes Circle integration and credentials, executor and agent behavior, vault transaction construction or broadcasting, HTTP endpoints, webhooks, queues, workers, Supabase, UI, live vendor APIs, and production key infrastructure.

**V2:** Multiple Covenants, agents, vendors, products, assets, or reviewed policy variants require a new approved scope.

**Production:** Durable distributed coordination, managed key custody, signer authentication, finalized/quorum evidence, reorganization policy, monitoring, rate limiting, incident response, and real funds remain deferred.

**Production:** Persistence recovery must durably bind authorization identity, identifier, and nonce across restarts and reconcile retained nonces against finalized vault state before retry or operator intervention.

**Protocol:** Generic policy languages, arbitrary contract execution, multichain behavior, permissionless extensions, and upgradeability remain excluded.

## Consequence

**MVP:** A proposal-producing component still cannot authorize or execute a payment. The authority can produce auditable contextual decisions and exact short-lived authorization requests without possessing execution credentials or authorization private-key material. Final financial integrity remains anchored to the immutable vault.
