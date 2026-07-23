# Authority application core

## Scope

**MVP:** `@covenant/authority` is a pure, dependency-injected application core for one Covenant, one procurement agent, one approved vendor signer, and the approved `gpu-h100-hour` product. It evaluates the frozen policy, signs a `DecisionReceipt` for every schema-valid request, and coordinates an `AuthorizationReceipt` only for a currently valid approval.

**MVP:** The public service is created with `createAuthorityService(dependencies)` and exposes `evaluatePaymentRequest`, `issueAuthorization`, and `processPaymentRequest`. Public requests are strict unknown boundaries containing signed PaymentIntent and Invoice envelopes; separate authorization additionally requires canonical RuleResults and the signed DecisionReceipt.

**MVP:** There is no HTTP transport, Circle integration, executor behavior, vault transaction construction, transaction broadcasting, agent behavior, Supabase, queue, worker, webhook, UI, or live vendor API in COV-003.

## Trust boundary

**MVP:** The one authoritative Covenant is loaded through the injected trusted Covenant provider and strictly parsed on every operation. Callers cannot supply an authoritative Covenant. All EIP-712 domains and hashes are derived and recomputed internally through `@covenant/spec`.

**MVP:** The receipt signer is an isolated injected port exposing its public address plus separate DecisionReceipt and AuthorizationReceipt signing methods. It returns only detached signatures. This package never owns, loads, derives, persists, logs, or exposes a private key. Tests generate ephemeral signing keys at runtime.

**MVP:** Trusted configuration contains exactly one approved vendor signer and the `gpu-h100-hour` product ID. Invoice recovery uses the Covenant-derived Invoice domain, and approval requires both the recovered signer and `Invoice.vendor` to equal that configured vendor.

## Frozen policy

**MVP:** Every schema-valid request evaluates all rules in the frozen `@covenant/spec` order without sorting or early exit:

1. **MVP:** `covenant_active` checks evidence chain and vault, revocation, Covenant time, payment count, non-future evidence, and the 30-second freshness limit.
2. **MVP:** `intent_signature_valid` checks canonical cryptographic recovery only.
3. **MVP:** `agent_authorized` checks the recovered signer, payload agent, and Covenant identity against the configured Covenant.
4. **MVP:** `recipient_allowed` checks the immutable recipient.
5. **MVP:** `token_allowed` checks the immutable token.
6. **MVP:** `amount_within_limit` checks positivity, per-payment maximum, coherent total-spent evidence, and remaining budget.
7. **MVP:** `invoice_signature_valid` checks canonical recovery and the configured vendor.
8. **MVP:** `invoice_matches_intent` checks the Invoice digest, recipient, token, amount, and approved product.
9. **MVP:** `purpose_allowed` checks both intent and Invoice purpose against the Covenant.
10. **MVP:** `intent_not_expired` checks intent, Invoice, and Covenant-relative time boundaries.
11. **MVP:** `nonce_unused` checks authoritative evidence for the intent digest, intent ID, and agent nonce.

**MVP:** RuleResult strings are deterministic and bounded, with stable machine-readable reasons. Structurally malformed requests fail before decision issuance. Schema-valid rejected requests receive a signed `REJECTED` DecisionReceipt and never an AuthorizationReceipt.

## Idempotency and expiry

**MVP:** Only approved decisions are idempotent. Their identity commits to the Covenant ID plus exact PaymentIntent and Invoice digests. Rejected decisions are never cached, so an invalid first submission cannot poison a later valid request.

**MVP:** Authorization identity commits to the Covenant, signed decision identity and digest, PaymentIntent digest, and Invoice digest. Concurrent duplicates share one pending signing operation. A stable authorization ID and nonce reservation survives signer failure and is never reassigned. Detached signature bytes are never replay or idempotency identity.

**MVP:** Authorization validity is the minimum of 300 seconds, PaymentIntent expiry, Invoice expiry, and Covenant expiry. Current evidence and the complete approval chain are independently revalidated before any authorization ID or nonce is reserved.

**MVP:** In-memory repositories coordinate demonstration issuance only. They are not authoritative replay, spend, payment-count, or revocation state. `CovenantVault` remains authoritative and rechecks every hard control at settlement.

## Development

**MVP:** Run the package checks from the repository root:

```powershell
pnpm.cmd --filter @covenant/authority lint
pnpm.cmd --filter @covenant/authority typecheck
pnpm.cmd --filter @covenant/authority test
pnpm.cmd --filter @covenant/authority build
```

**Production:** Durable distributed coordination, RPC freshness and finality controls, managed signer infrastructure, authentication, monitoring, and incident response remain deferred.

**V2:** Additional Covenants, agents, vendors, products, assets, and policy variants require separately approved scope.

**Protocol:** Generic policy languages, arbitrary execution, multichain behavior, and upgradeability remain excluded.
