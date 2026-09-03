# Covenant Platform v1 developer-release review

**V2:** Internal COV-027 review. This is not an external security audit and
does not certify production readiness.

## Scope and disposition

| Severity | Finding                                                                    | Disposition/evidence                                                                                                                                                    |
| -------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BLOCKER  | A request path could make the proposing application an executor or signer. | PASS: API, SDK, dogfood, and agent expose no signing or Circle capability; authorization evidence is externally produced and verified. See ADRs 0022, 0025, 0026, 0027. |
| BLOCKER  | Offchain state could become spend/replay authority.                        | PASS: runtime and API persist projections/idempotency only; CovenantVault remains authoritative.                                                                        |
| HIGH     | Deployment could start with random or missing webhook encryption material. | FIXED: `loadApiDeploymentConfig` requires exactly 32 bytes; no random fallback.                                                                                         |
| HIGH     | Ambiguous provider submission could be retried automatically.              | PASS: durable `SUBMISSION_STARTED` boundary and runtime ambiguity tests; only explicit `NO_SUBMISSION` retries.                                                         |
| HIGH     | Cross-project API reads or mutations could leak resources.                 | PASS: project-scoped keys, queries, idempotency, webhook records, and evidence tests.                                                                                   |
| HIGH     | Forged authorization evidence could advance lifecycle.                     | PASS: strict V1 verification regression tests reject tampering, wrong signer, intent, policy, Covenant, expiry, and project context.                                    |
| HIGH     | API could be deployed without a bounded HTTP boundary.                     | FIXED: executable Node entrypoint, JSON content-type checks, body/header/time limits, deny-by-default CORS, readiness, and graceful shutdown.                           |
| MEDIUM   | Rate limiting is not distributed across instances.                         | BOUNDED: deterministic in-process project/key limiter for this developer release; distributed production limiting remains deferred.                                     |
| MEDIUM   | Provider/webhook/database outages could leak raw diagnostics.              | FIXED: stable API errors and reusable redaction; webhook/runtime failure reasons are bounded.                                                                           |
| MEDIUM   | OpenAPI and SDK routes could drift.                                        | FIXED: `verify-openapi-sdk.mjs` runs as a release gate.                                                                                                                 |
| MEDIUM   | Package metadata or tarball could include repository material.             | FIXED: restricted `files` list, dry-run inspection, and independent packed-consumer proof.                                                                              |
| LOW      | Operational state is SQLite/PostgreSQL-shaped rather than HA storage.      | DEFERRED Production prerequisite; backup/restore boundaries are documented.                                                                                             |
| LOW      | No external security audit has occurred.                                   | DEFERRED Production prerequisite; no audit claim is made.                                                                                                               |

## Review conclusion

No BLOCKER or HIGH finding requiring a contract, EIP-712, signer-role, chain,
asset, or financial-authority redesign remains within COV-027 scope. The
release is suitable only for the bounded **Covenant Platform v1 Developer
Release — Arc Testnet** classification after the repository verification gates
pass. It is not GA, mainnet, production, or a custody/compliance claim.

## Evidence commands

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:openapi-sdk
pnpm test:sdk-release
pnpm verify
```

Mandatory CI remains offline for Circle/Arc financial calls. Test fakes are
injected explicitly and are not deployment defaults.
