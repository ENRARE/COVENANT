# Production roadmap

**V2:** This document records the approved short Platform v1 sequence. It does
not authorize implementation beyond the currently accepted COV.

## MVP

- **MVP:** COV-001 through COV-020 are the frozen completed proof: one bounded
  Arc Testnet/USDC procurement flow with immutable vault enforcement,
  deterministic authority evaluation, isolated authorization, Circle-backed
  submission, independent Arc observation, rejection/bypass/revocation
  evidence, and an honest audit timeline.

## V2

- **V2 — COV-021:** Platform architecture and public contract.
- **V2 — COV-022:** Generalized Covenant core.
- **V2 — COV-023:** Production-style execution runtime and persistence.
- **V2 — COV-024:** Developer REST API.
- **V2 — COV-025:** `@covenant/sdk` as a typed API client.
- **V2 — COV-026:** Dogfood the existing Covenant app and add bounded reference integrations.
- **V2 — COV-027:** Security, reliability, and Platform v1 release.

**V2:** Platform v1 is limited to multiple developer projects and Covenant
instances on Arc using USDC. Each later COV needs separate acceptance and must
preserve signer separation and onchain authoritative spend/replay state.

**V2:** COV-022 is complete in `@covenant/core` as a pure/offline generalized
Covenant domain boundary. COV-023 is the next separately accepted implementation
scope; no runtime or persistence work is implied here.

## Production

- **Production:** Use hardware-backed, access-controlled signing and wallet credentials with rotation and break-glass procedures.
- **Production:** Add independent monitoring, reconciliation, idempotency controls, rate limits, alerting, incident response, disaster recovery, and external security review.
- **Production:** Add supply-chain controls, pinned build provenance, dependency review, RPC diversity, Circle outage handling, privacy retention rules, and compliance operations.
- **Production:** Establish SLOs, load tests, chaos tests, audit-log integrity guarantees, and formal operational ownership.

## Protocol

- **Protocol:** Explore standardized portable financial-authority receipts and interoperable Covenant discovery.
- **Protocol:** Explore generalized policy composition only after a formally specified safe execution model exists.
- **Protocol:** Explore multichain settlement without weakening per-chain and per-contract domain separation.
- **Protocol:** Generic policy languages, arbitrary smart-contract execution,
  and broad multichain behavior are not part of Platform v1.
