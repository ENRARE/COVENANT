# ADR 0028 — Covenant Platform v1 Developer Release

- **Status:** Accepted for COV-027 after completion
- **Scope:** **V2 — Platform v1 Developer Release**
- **Date:** 2026-09-03

## Decision

COV-027 establishes the internal readiness baseline for the **Covenant
Platform v1 Developer Release — Arc Testnet**. It hardens the existing core,
durable runtime, REST API, SDK, authorization-evidence flow, and reference
integrations without changing signed V1 schemas, EIP-712 domains, signer roles,
financial authority, or the CovenantVault execution boundary.

## Frozen release boundary

- Arc Testnet chain `5042002` and six-decimal USDC are the only supported
  network and asset.
- API authentication is project access, never financial authorization.
- The API and SDK transport externally produced authorization evidence; neither
  signs, evaluates policy, calls Circle, or executes transactions.
- Runtime/database records are non-authoritative projections. Durable submission
  ambiguity is preserved and never silently retried.
- Deployment requires explicit validated configuration, a retained 32-byte
  webhook master key, and deployment-owned resolver/adapter modules.
- `@covenant/sdk` remains version `0.1.0`; REST `/v1` and public Covenant
  `version: "2"` remain distinct from frozen signed V1 evidence.
- Package, API, and example release gates run offline; no real funds, production
  credentials, mainnet deployment, npm publication, GitHub Release, or tag is
  part of this COV.

## Explicit exclusions

This ADR does not claim GA, production readiness, an SLA/SLO, HA, custody,
compliance, hardware-backed keys, or an external security audit. External
publication requires a separate founder authorization after review and merge.
