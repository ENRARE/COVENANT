# Covenant core

**V2:** `@covenant/core` is the pure, offline, deterministic domain boundary
for the generalized Platform v1 Covenant resource introduced by COV-022. It
supports multiple project-owned Covenant instances while keeping project
ownership, lifecycle transitions, authorization evidence, and execution
evidence explicit.

**V2:** The resource is explicitly versioned as `version: "2"`. It is fixed to
Arc Testnet (`5042002`) and six-decimal USDC. Amounts and timestamps are
canonical strings; no JavaScript floating-point money is accepted.

**V2:** Core operations return new immutable values and accept evaluation times
explicitly. They perform no I/O, network calls, persistence, environment reads,
randomness, signing, credential handling, transaction submission, retries, or
provider polling. Circle acceptance remains transport evidence; only separate
Arc evidence can establish `EXECUTED`.

The package may parse and associate existing strict version-1 signed Decision
and Authorization receipts, but it does not reinterpret, sign, or verify those
receipts. Existing V1 schemas in `@covenant/spec` remain unchanged.

Existing V1 executor provider observations and Arc receipt observations can be
associated through the execution-evidence boundary. Base-unit Arc amounts are
converted exactly to canonical USDC strings, transfer consistency is retained,
and provider observations never establish Arc success by themselves.

**V2:** HTTP/API, database, durable idempotency, webhooks, SDK runtime behavior,
production credentials, and contract changes are deferred to later approved
COVs. This package is not a second authorization or execution path.
