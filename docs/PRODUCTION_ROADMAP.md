# Production roadmap

**V2:** This document records the approved short Platform v1 sequence and its
completion status. It does not authorize implementation beyond the currently
accepted COV.

## MVP

- **MVP:** COV-001 through COV-020 remain the frozen completed proof: one
  bounded Arc Testnet/USDC procurement flow with immutable vault enforcement,
  deterministic authority evaluation, isolated authorization, Circle-backed
  submission, independent Arc observation, rejection/bypass/revocation
  evidence, and an honest audit timeline.

## V2 — Platform v1

- **V2 — COV-021:** Platform architecture and public contract (complete).
- **V2 — COV-022:** Generalized Covenant core (complete).
- **V2 — COV-023:** Durable execution runtime and persistence (complete).
- **V2 — COV-024:** Developer REST API (complete).
- **V2 — COV-025:** `@covenant/sdk` typed server-side API client (complete;
  package publication remains deferred).
- **V2 — COV-026:** Authorization completion and bounded dogfood references
  (complete).
- **V2 — COV-027:** Security, reliability, and Platform v1 Developer Release
  hardening (complete in this repository; external publication is deferred).

**V2:** Platform v1 is limited to multiple developer projects and Covenant
instances on Arc using six-decimal USDC. API authentication is project access,
not financial authorization, and offchain state never replaces onchain spend
or replay authority.

## Production

- **Production:** Use hardware-backed, access-controlled signing and wallet credentials with rotation and break-glass procedures.
- **Production:** Add independent monitoring, reconciliation, disaster recovery, external security review, and formal operational ownership.
- **Production:** Add production credentials, real funds, RPC/provider redundancy, privacy retention rules, and compliance operations.
- **Production:** Establish measured SLOs/SLAs, high availability, chaos testing, and audit-log integrity guarantees.

## Protocol

- **Protocol:** Explore standardized portable financial-authority receipts and interoperable Covenant discovery.
- **Protocol:** Explore generalized policy composition only after a formally specified safe execution model exists.
- **Protocol:** Explore multichain settlement without weakening per-chain and per-contract domain separation.
- **Protocol:** Generic policy languages, arbitrary smart-contract execution, and broad multichain behavior are not part of Platform v1.
