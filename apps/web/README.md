# Audit console

**MVP:** COV-016 provides a read-only, responsive console over exactly one committed COV-015 `AuditTimeline` fixture. The server imports the fixture as `unknown`, strictly parses it with the package-owned schema, reconstructs an explicit display model, and returns a fixed unavailable page if validation fails.

**MVP:** The browser is untrusted. It receives a non-authoritative deeply frozen display projection and may only filter that projection in memory. It has no API route, server action, persistence, wallet, signing key, Circle credential, RPC, Supabase dependency, payment command, or authoritative policy/spend state.

**MVP:** Local Anvil settlement observation, Arc deployment-transaction finality, and the fixed compromised-proposer rejection remain visibly separate classifications. The console does not promote any of them to Circle execution, Arc payment settlement, payment finality, or database financial authority.

**MVP:** The COV-016 browser suite uses one cross-platform repository runner to build and directly own a production `next start` child only at `http://127.0.0.1:3100`. It refuses an occupied origin, disables telemetry for build, server, and Playwright without platform-specific shell syntax, and always stops only its owned server; test routing rejects non-loopback HTTP traffic and every WebSocket attempt.

**Production:** Authenticated access, CSP and deployment hardening, independently verifiable builds, durable evidence retention, reconciliation, monitoring, and incident response remain deferred.
