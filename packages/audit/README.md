# Audit projection package

**MVP:** `@covenant/audit` is the pure, deterministic, non-authoritative
COV-015 audit projection boundary. It accepts one strict closed source bundle,
projects supported validated evidence into one sanitized timeline, and emits
canonical JSON with a trailing newline.

**MVP:** Demo journal inputs are observational records, not signed artifacts or
independently verified policy outputs. Direct demo-derived events use
`OBSERVATIONAL_DEMO_AUDIT`; the projector verifies the unchanged demo event-ID
formula, rejects changed source bodies globally across wrappers, and enforces
complete lifecycle identifier continuity. It still trusts the upstream demo
journal's provenance.

**MVP:** The package distinguishes proposal, policy decision, signed
authorization, transport preparation, transport acceptance, transaction
submission, execution evidence, settlement evidence, security controls,
revocation, and deployment evidence. It never treats an opaque simulated or
executor transport reference as a transaction hash.

**MVP:** The runtime package imports only the schema-only demo boundary,
`@covenant/spec`, `viem` hashing primitives, and Zod. It owns no signer,
wallet, HTTP client, provider SDK, RPC client, transaction sender, calldata
builder, deployment helper, database client, Supabase client, filesystem path,
or command-execution capability.

**MVP:** The command accepts no arguments or paths. It reads at most one MiB of
strict JSON from standard input and writes exactly one canonical JSON document
to standard output. Errors use fixed sanitized codes and messages.

```sh
pnpm audit:project < audit-source-bundle.json
```

**MVP:** `VALIDATED_SIGNED_FLOW` is an adapter contract for outputs that have
already crossed the existing trusted signature-verification boundary. COV-015
strictly parses signed envelopes, verifies object links, canonical rules,
decision semantics, and supplied validated digest links, but does not create a
signature or make a new policy decision. The projector strips all signatures
and signed envelopes from output.

**MVP:** COV-008 evidence is parsed through the shared unchanged
`localEvidenceResultSchema`. COV-010 evidence is accepted only after the
existing offline anchor and canonical-manifest-digest verifier succeeds.
The projector trusts that the upstream COV-008 harness produced its strict
public result after private receipt, event, balance, and state verification; it
does not start Anvil or recreate those checks.

**MVP:** Executor audit input accepts only faithfully sourced `PREPARED`,
`SIMULATED`, and `SUBMITTED` outputs with their stable execution links.
`SUBMITTED` remains transport acceptance only. Failure, rejection, and
ambiguity shapes are rejected because no repository-owned producer supplies
their complete provenance and stable audit link.

**MVP:** Output files are observational, replaceable, and reconstructable.
They are not authoritative for spend, remaining budget, payment count, replay,
revocation, token movement, settlement, or finality. `CovenantVault` remains
authoritative for financial enforcement.

**Production:** Centralized retention, tamper-evident storage, access control,
monitoring, reconciliation, backup, and incident response remain deferred.

**V2:** Additional source families, actors, assets, products, or chains require
a separately reviewed closed adapter and taxonomy amendment.

**Protocol:** Generic event ingestion, arbitrary schemas, generalized policy,
and arbitrary execution remain excluded.
