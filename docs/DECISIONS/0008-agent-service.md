# ADR 0008: Procurement agent application core

- Status: Accepted
- Date: 2026-07-23
- Scope: MVP

All capabilities in this decision are **MVP** unless explicitly labeled otherwise.

## Decision

**MVP:** Implement COV-005 under `apps/agent` as a pure dependency-injected application core. `createAgentService` exposes only `proposePayment`. The agent proposes a signed PaymentIntent and has no authorization, execution, transport, or custody capability.

**MVP:** Public input contains exactly a signed Invoice and a strict procurement request for `gpu-h100-hour` with an exact USDC amount. The result contains exactly the signed PaymentIntent and a defensive field-by-field copy of the verified raw signed Invoice.

**MVP:** The caller cannot select the Covenant, approved vendor, approved product, purpose, recipient, token, vault, chain, signing domain, digest, agent signer, intent identifier, nonce, or timestamps. The trusted Covenant and signer address are parsed on every proposal, and every derived value is compared using canonical spec types.

**MVP:** Existing `@covenant/spec` helpers own strict signed-object parsing, exact money conversion, EIP-712 domains, typed-data construction, hashing, canonical signature recovery, and Covenant-anchored PaymentIntent verification. The agent does not duplicate ECDSA or frozen typed-data definitions.

## Invoice and PaymentIntent boundary

**MVP:** Invoice verification requires the recovered signer and `Invoice.vendor` to equal the one configured approved vendor. Product, recipient, token, purpose, and amount must exactly match the frozen product, trusted Covenant, and procurement request. The Invoice must be current and its positive amount must not exceed the Covenant per-payment maximum.

**MVP:** Proposal identity is a structured ABI-encoded keccak256 commitment over a fixed COV-005 tag, Covenant ID, recomputed Invoice digest, product ID, purpose, amount, recipient, and token. Detached signatures, object serialization, generated timestamps, intent ID, and nonce are excluded.

**MVP:** The PaymentIntent uses only frozen schema version `1`, a retained generated ID and nonce, trusted Covenant fields, the verified Invoice amount and digest, a first valid injected clock value, and expiry bounded by 600 seconds, Invoice expiry, and Covenant expiry.

**MVP:** The narrow signer exposes only an address and `signPaymentIntent(typedData)`. The assembled envelope is strictly parsed, recovered, verified against the Covenant, and compared field by field with the retained expected payload before return.

## Coordination and failure

**MVP:** A service-local promise map is the primary concurrency boundary. Identical concurrent calls join one operation before repository coordination can invoke application work.

**MVP:** Repository callbacks are idempotent. If coordination invokes and then rejects or never settles, the service awaits the invoked core operation. Failure before invocation becomes one sanitized repository error.

**MVP:** One atomic reservation retains the intent ID, nonce, and canonical raw PaymentIntent payload. Signing failure never reallocates or changes the payload. An expired retained proposal permanently rejects identical retries; a new Invoice payload digest creates a new identity.

**MVP:** The caller explicitly injects either the in-memory adapter used by isolated tests or `createDurableProposalReservationRepository`, the default adapter documented for the local hackathon demonstration. `createAgentService` performs no implicit filesystem access.

**MVP:** The durable adapter uses a fixed-version append-only journal with strict `RESERVED` and `COMPLETED` records. Canonical JSON SHA-256 digests bind every record, and each completion binds the exact preceding reservation digest. Every append is serialized, flushed, and closed before success is reported. Startup replays and validates the complete journal without repair or record omission.

**MVP:** Restart recovery preserves proposal identity, intent ID, nonce, creation and expiry times, exact raw PaymentIntent payload, and completed result. Completed evidence is fully revalidated before return. One exclusive local lock deliberately permits only one repository process per caller-supplied storage directory; explicit close drains writes and releases it.

**MVP:** The journal is local coordination evidence, not authoritative spend, replay, revocation, or settlement state. CovenantVault remains authoritative for financial replay and spend enforcement. The journal only prevents accidental duplicate proposal allocation across local restarts and makes no distributed-coordination claim.

**MVP:** Completed results and returned values are defensively copied and frozen. Current Invoice, Covenant, and PaymentIntent time are rechecked before every return, including retry and completed-duplicate paths.

**MVP:** Errors expose only fixed name, code, and message values. Dependency causes, stacks, messages, provider output, typed data, signatures, payment contents, URLs, secrets, and repository state do not cross the public boundary.

## Scope

**MVP:** The frozen implementation covers one Covenant, one agent signer, one approved vendor, one product, one token, one recipient, one purpose, and Arc Testnet.

**MVP:** COV-005 excludes HTTP, UI, Circle, RPC, executor, LLM, vendor fetching, pricing, wallet, transaction submission, authorization receipts, decisions, rule evaluation, arbitrary signing, and Invoice signing.

**V2:** Multiple vendors, products, agents, assets, procurement schemas, and pricing models require separately approved scope.

**Production:** Distributed coordination, database replication, backup, operational lock recovery, finalized-vault reconciliation, managed proposal-signing custody, monitoring, rate limits, incident response, credential rotation, and high availability remain deferred.

**Protocol:** Generic policy languages, generalized procurement protocols, arbitrary execution, and multichain behavior remain excluded.

## Consequence

**MVP:** The agent proposes. The authority decides. The executor reconstructs. The vault enforces. No component that generates payment requests gains authority to authorize or execute them.
