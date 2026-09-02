# Supabase

**MVP:** Reserved for future non-authoritative audit and application data. No migrations exist in COV-001. Supabase must never be the authoritative spend or replay ledger.

**V2:** COV-023 adds a PostgreSQL-compatible migration for durable Covenant
projections, execution operation state, leases, evidence metadata, and a
transactional runtime outbox. These tables are operational projections only;
Arc/CovenantVault remains authoritative for spend, replay, revocation, and
payment state. The offline `node:sqlite` adapter mirrors the schema for
self-contained tests. COV-023 adds no Supabase client, remote account,
webhook, or delivery worker.
