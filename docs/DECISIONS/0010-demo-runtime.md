# ADR 0010: Local simulated demo runtime

- Status: Accepted
- Date: 2026-07-28
- Scope: MVP

All capabilities in this decision are **MVP** unless explicitly labeled
otherwise.

## Decision

**MVP:** Implement COV-007 as the private server-only `apps/demo` application.
It composes the existing built agent, authority, executor, and specification
packages and does not change their public APIs, signed schemas, EIP-712 fields,
or signer responsibilities.

**MVP:** The runtime exposes one strict dispatcher with exactly `RESET`, `SEED`,
`RUN_DEMO`, `GET_HEALTH`, and `GET_STATE`. Callers cannot provide any scenario,
payment, signer, transaction, network, or filesystem value.

**MVP:** The only mode is `LOCAL_SIMULATED`. One run creates ephemeral
pairwise-distinct signers, executes the approved GPU proposal through an exact
simulated executor submission, and then creates an attacker-recipient proposal
that authority rejects before authorization or transport.

**MVP:** The runtime privately composes narrow capabilities but exposes none of
them. The agent receives only its proposal signer. The authority receives only
its authorization signer. The executor receives only a deterministic
submission-only transport. No proposal-producing component receives execution
authority.

## Projection and persistence

**MVP:** Seed creates a random nonzero lowercase bytes32 runtime identifier and
exactly two events. Run appends the frozen fifteen-event sequence. Every event
has a strict variant schema, continuous canonical sequence, injected timestamp,
and deterministic identifier committing to runtime, sequence, type, and
scenario.

**MVP:** `.covenant-demo-state/events.v1.jsonl` is the sole persisted runtime
state. Projection state is reconstructed by complete strict replay; no separate
mutable state file exists.

**MVP:** Audit events contain safe identifiers, canonical USDC amounts, and
rule identifiers with PASS/FAIL status only. They exclude keys, signer
addresses, signatures, signed bodies, typed data, calldata, raw dependency
output, paths, environment values, responses, stacks, receipts, and
credentials.

**MVP:** Audit projections are append-only, sanitized, local, mutable, and
non-authoritative. They are not hash-chained and never own policy, spend,
replay, revocation, submission, or settlement authority.

**MVP:** Mutation uses one exclusive local lock. Read operations never mutate
the lock or journal. Only reset may remove a valid unchanged stale lock after a
negative process-liveness check.

**MVP:** Strict replay rejects invalid UTF-8, invalid JSON, truncation, unknown
fields or events, unsafe identifiers, malformed amounts, duplicate or gapped
sequences, duplicate or incorrect event IDs, runtime mismatch, illegal order,
and records after completion. It performs no repair.

## Honest demonstration boundary

**MVP:** `SUBMISSION_SIMULATED` means only that the deterministic local
transport accepted the exact executor-built request. It is not Circle
execution, an Arc transaction, vault execution, a transaction hash, a receipt,
settlement, finality, or confirmation.

**MVP:** The compromised-proposer scenario represents a possible downstream
effect of indirect prompt injection but is not an LLM integration and does not
prove prompt-injection resistance.

**MVP:** Ephemeral signers exist for one run and are never persisted.
Interrupted cryptographic runs cannot resume and require reset.

## Scope

**MVP:** Vault execution, direct bypass, revocation, and post-revocation
behavior remain COV-008 scope.

**V2:** Additional actors, assets, scenarios, policies, and chains remain
excluded.

**Production:** Managed custody, distributed state, reconciliation, monitoring,
compliance, incident response, and high availability remain excluded.

**Protocol:** Generic execution, generic policies, upgradeability, and
multichain behavior remain excluded.

## Consequence

**MVP:** COV-007 turns the COV-006 cross-service contract into a deterministic
local demonstration without adding live network authority or weakening the
proposal, authorization, execution, and vault separation.
