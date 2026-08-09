# Audit console

**MVP:** COV-020 provides a judge-facing, read-only console over exactly one committed audit-schema-v2 fixture. The fixture combines the frozen demonstration flow, local security-control evidence, Arc deployment evidence, separate Circle provider observation, independently observed Arc Testnet execution, and deterministic reconciliation.

**MVP:** The server imports the fixture as `unknown`, strictly parses its complete schema, reconstructs an explicit allowlisted display model, and deeply freezes that model. Any malformed identity, sequence, source, causal link, evidence detail, classification, or claim boundary returns one fixed sanitized unavailable page with no partial timeline or raw parser error.

**MVP:** Circle durable state remains `UNKNOWN`; it proves only that a submission attempt was observed and never proves Arc execution. Arc success is shown only from the independently verified COV-019 receipt, `PaymentExecuted` log, ERC-20 `Transfer`, exact identifiers and values, and read-only vault state. Reconciliation is `ARC_EXECUTION_SUCCEEDED`; it is not called settlement or finality and performs no retry or resubmission.

**MVP:** The browser is an untrusted, ephemeral presentation boundary. It has no API route, server action, URL-fragment state, persistence, RPC, Circle integration, Supabase dependency, signer, wallet, payment command, transaction broadcast, contract write, or financial authority. Native timeline disclosure controls reset on reload and cannot change canonical evidence.

**MVP:** Browser verification uses the repository-owned production-server runner at `http://127.0.0.1:3100` and fixed desktop and mobile Chromium projects. Test routing rejects non-loopback HTTP traffic and every WebSocket attempt; normal verification performs no browser download.

**Production:** Authenticated access, CSP and deployment hardening, tamper-evident evidence distribution and retention, independent live observation, monitoring, and incident response remain deferred.

**V2:** Additional payments, fixtures, organizations, actors, assets, chains, saved views, and operator workflows require separately approved scope.

**Protocol:** Generic event ingestion, arbitrary RPC, payment controls, arbitrary calls, and generalized execution are excluded.
