# Supabase

**MVP:** Reserved for future non-authoritative audit and application data. No migrations exist in COV-001. Supabase must never be the authoritative spend or replay ledger.

**V2:** COV-023 adds a PostgreSQL-compatible migration for durable Covenant
projections, execution operation state, leases, evidence metadata, and a
transactional runtime outbox. These tables are operational projections only;
Arc/CovenantVault remains authoritative for spend, replay, revocation, and
payment state. The offline `node:sqlite` adapter mirrors the schema for
self-contained tests. COV-023 adds no Supabase client, remote account,
webhook, or delivery worker.

## Platform v1 migration procedure

**V2:** Apply migrations in lexical filename order with a reviewed migration
runner: COV-023 durable runtime tables, COV-024 developer/API/webhook tables,
then COV-027 release indexes. Take a consistent non-authoritative database
backup before applying a migration and verify the uniqueness/index checks after
completion. A failed migration is a deployment incident; do not bypass a
constraint or edit rows manually to make execution proceed.

Back up project metadata, idempotency records, execution/outbox state, webhook
endpoint ciphertext, and delivery history. These records can be reconstructed
or reconciled according to [the backup/restore and incident runbooks](../docs/INCIDENT_RESPONSE.md),
but they cannot recreate private keys or authoritative onchain spend/replay
state. Retain the webhook master key separately; without the same key,
encrypted endpoint secrets cannot be decrypted. An ambiguous submission remains
ambiguous after restore and must be reconciled, never blindly resubmitted.
