# ADR 0016: Unsigned normalized provider-quote evidence

- Status: Accepted
- Date: 2026-08-03
- Scope: V2

## Decision

**V2:** Implement COV-013 in `apps/agent` as a pure offline boundary that accepts unknown normalized GPU quote evidence, strictly validates and canonicalizes it, applies trusted freshness, lifetime, and amount limits, and returns frozen normalized evidence plus a deterministic fingerprint as `unknown`.

**V2:** The frozen public boundary exposes exactly `normalizeQuoteEvidence(input: unknown): Promise<unknown>`. Its injected dependencies are only a narrow clock and the unknown `maximumAmount`, `maxQuoteAgeSeconds`, and `maxQuoteLifetimeSeconds` configuration values. The constructor parses and retains only those three trusted bigint limits; it does not receive or retain a complete Covenant specification.

## Evidence shape and validation

**V2:** The strict evidence object contains exactly version `"1"`, proposed provider namespace `"runpod"`, an ASCII quote ID, product `"gpu-h100-hour"`, GPU model `"H100"`, quantity `"1"`, duration `"3600"`, currency `"USDC"`, amount, quoted timestamp, and expiry timestamp.

**V2:** Quote IDs use `/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/`. Existing `@covenant/spec` schemas parse positive USDC money and canonical positive uint256 timestamps. Equivalent valid amounts are formatted to the shortest exact USDC decimal representation. The boundary reconstructs evidence field by field and freezes both evidence and result.

**V2:** The boundary requires expiry after quote time, quote time no later than the trusted current time, current time strictly before expiry, age no greater than the trusted maximum age, lifetime no greater than the trusted maximum lifetime, and amount no greater than the trusted maximum amount.

## Fingerprint

**V2:** The fingerprint is Keccak-256 over ABI-encoded evidence in fixed field order. The first value is `keccak256(stringToHex("COV-013:NormalizedGpuQuoteEvidenceV1"))`; string fields follow in evidence order, quantity and duration are `uint256`, canonical USDC base units are `uint256`, and both timestamps are `uint256`.

**V2:** JSON serialization and EIP-712 are not used. Equivalent accepted amount strings such as `"1"`, `"1.0"`, and `"1.000000"` normalize to `"1"` and produce the same fingerprint.

**V2:** The fingerprint proves deterministic local equality only. It is not a signature, attestation, authorization, payment request, or evidence of provider provenance.

## Authenticity and replay amendment

**V2:** This evidence is unauthenticated. `providerId: "runpod"` is only a fixed proposed namespace and does not prove that Runpod authored, signed, served, or transmitted the evidence.

**V2:** COV-013 intentionally has no replay repository, Covenant replay namespace, quote-ID registration, conflict outcome, repository error, persistent state, or authoritative state. Registering unauthenticated quote IDs would permit first-writer conflict poisoning.

**V2:** Replay protection is intentionally deferred until a separately approved authenticated provider-transport task establishes provider-source authenticity. That future task requires a threat review and must not infer provenance from this local fingerprint.

## Failure boundary

**V2:** Public failures use only fixed sanitized codes and messages for invalid evidence, non-current evidence, excessive lifetime, excessive amount, invalid configuration, and clock failure. Raw evidence, quote IDs, amounts, fingerprints, dependency messages, stacks, and causes never cross the boundary.

## Authority separation and exclusions

**V2:** COV-013 constructs or signs no Invoice or PaymentIntent. It has no signer, wallet, private key, Circle, RPC, authority, executor, transaction, calldata, deployment, HTTP, fetch, endpoint, SDK, socket, provider network, environment, credential, or Runpod-key capability.

**V2:** COV-013 performs no USD/USDC conversion, FX, price multiplication, tax, fee, quantity pricing, duration pricing, or rounding. Required bigint subtraction is limited to freshness and lifetime validation.

**V2:** COV-013 changes no signed schema, EIP-712 definition, or `packages/spec` behavior and stores no state. The agent still only proposes; Covenant authorizes; Circle executes; Arc settles.

**Production:** Authenticated provider transport, credential custody, source attestation, durable replay controls, monitoring, audit retention, incident response, and provider outage handling remain deferred.

**Protocol:** Generalized provider evidence, multiple products, currencies, providers, chains, policy systems, and arbitrary execution remain excluded.

## Acceptance boundary

**V2:** Tests are fully offline and cover strict input and output surfaces, freezing, literal constraints, quote-ID grammar, money and timestamp boundaries, freshness, lifetime, maximum amount, deterministic ABI/Keccak fingerprinting, field commitment, canonical equivalence, sanitized clock/configuration failures, and absence of forbidden capability and import surfaces.

**V2:** Status remains `Proposed` until focused formatting, lint, type checking, unit tests, build, diff validation, and complete diff review pass.
