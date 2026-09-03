# Platform v1 developer-release checklist

Every PASS below links to executable evidence or a committed document. A
deferred Production item is not represented as a PASS.

| Area           | Check                                                                      | Status/evidence                                                  |
| -------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Security       | Signer/authority/executor separation preserved                             | PASS — ADRs 0022–0027 and security regression suites             |
| Security       | Forged/wrong/expired/cross-project evidence rejected                       | PASS — API authorization evidence tests                          |
| Execution      | Durable duplicate identity and lease exclusivity                           | PASS — runtime idempotency/concurrency tests                     |
| Execution      | Crash/timeout/ambiguous submission never blindly resubmits                 | PASS — runtime failure-injection tests                           |
| Persistence    | Ordered migrations, uniqueness, project scoping, outbox integrity reviewed | PASS — `supabase/migrations` and deployment review               |
| API            | Validated deployment config and executable Node entrypoint                 | PASS — `apps/api/src/configuration.ts`, `main.ts`                |
| API            | Body/header/time limits, JSON content type, safe errors, readiness         | PASS — API release-hardening tests                               |
| API            | Rate limiting is bounded and deterministic                                 | PASS — `InMemoryRateLimiter` tests; distributed limiter deferred |
| Webhooks       | Stable identity, signing, retries, disable/restart behavior                | PASS — webhook/API suites and incident runbook                   |
| SDK            | 0.1.0 metadata, restricted files, dry-run package inspection               | PASS — `npm pack --dry-run` via `test:sdk-release`               |
| SDK            | Independent packed consumer import/initialization                          | PASS — `scripts/sdk-package-consumer.mjs`                        |
| Contracts      | OpenAPI and SDK route set aligned                                          | PASS — `scripts/verify-openapi-sdk.mjs`                          |
| Examples       | Quickstart, dogfood, milestone, marketplace, agent references              | PASS — COV-026 example tests/build                               |
| CI             | Foundry v1.7.1, lockfile/security/private-artifact gates retained          | PASS — workflow and `pnpm verify`                                |
| Documentation  | Deployment, incident, limitations, compatibility, release notes            | PASS — COV-027 docs listed below                                 |
| Release claims | Arc Testnet developer release only                                         | PASS — ADR 0028; no production/GA claim                          |
| Publication    | npm/GitHub publication and tag                                             | DEFERRED — requires post-merge founder authorization             |
