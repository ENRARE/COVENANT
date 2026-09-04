# `@covenant/runtime`

**V2:** COV-023 adds the durable execution runtime that coordinates the pure
`@covenant/core` resource with the existing submission-only executor. The
runtime stores operational projections and recovery metadata; CovenantVault on
Arc remains authoritative for spend, replay, revocation, and payment state.

The package is private and currently provides an offline, self-contained
PostgreSQL-shaped SQLite adapter (`node:sqlite`) for deterministic tests and
local development. `DurableExecutionRuntime` accepts only a narrow adapter
identified by an execution operation. It never receives keys, Circle
credentials, signed transaction payloads, arbitrary calldata, target
addresses, tokens, or chains.

The durable boundary is committed before `submit` is called. A timeout,
exception, dispatch-unknown result, or crash after that commit becomes
`AMBIGUOUS` and requires reconciliation; it is never automatically submitted
again. An explicit provider assertion that no submission occurred is the only
post-boundary retry path.

The schema migration in `supabase/migrations` is the PostgreSQL deployment
shape. `PostgresRuntimeStore` implements the same synchronous `RuntimeStore`
boundary over a deployment-owned, transaction-capable PostgreSQL client; the
repository intentionally does not bundle a database driver or credentials.
The API selects that adapter only when `COVENANT_DATABASE_DRIVER=postgres` and
an explicit store module/connection URL are configured. The local SQLite
adapter mirrors the same constraints and is not an authoritative financial
ledger. Verified authorization bundles are retained
as immutable operational evidence and can be handed to an isolated executor
through `createIsolatedExecutorAdapter`; the runtime never creates, signs, or
reinterprets them. HTTP/API authentication and webhook delivery remain owned
by `@covenant/api`.
