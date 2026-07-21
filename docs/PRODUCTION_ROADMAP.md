# Production roadmap

This document labels direction; it does not authorize implementation.

## MVP

- **MVP:** Complete the frozen single-vendor Arc Testnet demonstration after COV-001.
- **MVP:** Implement immutable vault enforcement, deterministic authority evaluation, isolated authorization, Circle submission, and an honest audit timeline in separate tasks.
- **MVP:** Demonstrate one successful payment, one rejected indirect prompt-injection payment, one failed direct bypass, and one revocation.

## V2

- **V2:** Add multiple approved vendors and procurement agents while retaining signer separation.
- **V2:** Add narrowly enumerated policy modules and additional assets only through explicit schema and contract review.
- **V2:** Add another chain only after replay, finality, address, decimal, and deployment semantics are separately specified.
- **V2:** Add organization administration and richer audit queries without moving authoritative spend state offchain.

## Production

- **Production:** Use hardware-backed, access-controlled signing and wallet credentials with rotation and break-glass procedures.
- **Production:** Add independent monitoring, reconciliation, idempotency controls, rate limits, alerting, incident response, disaster recovery, and external security review.
- **Production:** Add supply-chain controls, pinned build provenance, dependency review, RPC diversity, Circle outage handling, privacy retention rules, and compliance operations.
- **Production:** Establish SLOs, load tests, chaos tests, audit-log integrity guarantees, and formal operational ownership.

## Protocol

- **Protocol:** Explore standardized portable financial-authority receipts and interoperable Covenant discovery.
- **Protocol:** Explore generalized policy composition only after a formally specified safe execution model exists.
- **Protocol:** Explore multichain settlement without weakening per-chain and per-contract domain separation.
