# ADR 0019: Read-only audit console

- Status: Proposed
- Date: 2026-08-05
- Scope: MVP

## Decision

**MVP:** COV-016 renders exactly one committed COV-015 `AuditTimeline` fixture in `apps/web`. The fixture is deterministic demonstration evidence, not a database, API response, or authoritative state source.

**MVP:** A server-only adapter accepts the imported JSON as `unknown`, parses it with `auditTimelineSchema`, and reconstructs an explicit deeply frozen display model. The browser receives no raw source bundle, signatures, receipts, calldata, credentials, paths, stack traces, or provider responses. Any parse, identity, ordering, or classification failure returns one fixed sanitized unavailable page and no partial timeline.

**MVP:** The UI preserves canonical event order and visibly separates evidence class, claim scope, source identity, and allowlisted event details. Local Anvil settlement observation remains `LOCAL_ANVIL_SETTLEMENT_OBSERVATION`; Arc finality remains `ARC_DEPLOYMENT_TRANSACTION_ONLY`; the compromised-proposer claim remains `FIXED_COMPROMISED_PROPOSER_REJECTION`.

**MVP:** Search and stage selection are ephemeral client-side view controls over the validated model. They do not mutate, persist, fetch, submit, authorize, execute, settle, revoke, or alter canonical evidence. The console contains no command buttons, API routes, server actions, network integrations, wallets, keys, or credentials.

**MVP:** Deterministic browser verification uses only Playwright-managed Chromium in fixed `chromium-desktop` (`1440 x 900`) and `chromium-mobile` (`390 x 844`) projects. The repository provisions Chromium explicitly with `pnpm e2e:install-browser`; `pnpm test:e2e` only checks the exact executable reported by local Playwright and never installs or downloads a browser.

**MVP:** A cross-platform repository-owned Node runner resolves the `apps/web`-local Next.js CLI, performs `next build`, directly owns `next start --hostname 127.0.0.1 --port 3100`, waits for an HTTP 200 response from the exact root, runs local Playwright, and stops its exact server child in bounded cleanup. It refuses an occupied origin and verifies release afterward, so an ambient server is never reused.

**MVP:** Playwright's shell-owned `webServer` plugin is intentionally excluded because teardown semantics differ on Windows. Collection-only commands skip build and startup; executable commands use the same owned lifecycle on Windows and CI. Each test still installs HTTP and WebSocket blocking before navigation, and browser verification requires no internet after Chromium provisioning.

**MVP:** `NEXT_TELEMETRY_DISABLED=1` is injected while preserving the existing environment for the Playwright test process, production build, and production server. No platform-specific shell environment syntax is used.

## Consequences

**MVP:** The browser remains an untrusted presentation boundary. It can mislead its viewer if compromised, but it cannot establish authorization or settlement truth and gains no financial capability.

**MVP:** Verification fails with a fixed actionable error when Chromium is missing and fails if the page attempts non-loopback HTTP or any WebSocket traffic. Service workers are blocked so they cannot evade request routing.

**Production:** Authenticated distribution, CSP, signed builds, tamper-evident retention, independent evidence verification, reconciliation, monitoring, and incident response remain deferred.

**V2:** Additional fixtures, organizations, live sources, filters with persistence, or operator workflows require separately approved scope and closed adapters.

**Protocol:** Generic event ingestion, arbitrary schemas, payment controls, and generalized execution are excluded.
