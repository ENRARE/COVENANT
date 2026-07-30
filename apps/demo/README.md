# Local simulated demo runtime

**MVP:** `@covenant/demo` is a private server-only local orchestration
application. It composes the built agent, authority, executor, and specification
packages without changing their public APIs or signer responsibilities.

**MVP:** The public runtime accepts only `RESET`, `SEED`, `RUN_DEMO`,
`GET_HEALTH`, and `GET_STATE`. It accepts no recipient, amount, token, chain,
target, ABI, function, calldata, signer, credential, path, command, or generic
scenario input.

**MVP:** The only mode is `LOCAL_SIMULATED`. The happy path performs two
simulations and one deterministic simulated submission. The returned reference
is not Circle execution, an Arc transaction, vault execution, a receipt,
settlement, finality, or confirmation.

**MVP:** `RUN_DEMO` creates pairwise-distinct ephemeral issuer, agent,
authorization, vendor, and attacker identities. Signing accounts exist only for
that process and are never written to the journal, returned, or logged.

**MVP:** The compromised-proposer scenario is: “Compromised proposer
simulation: a malicious structured payment proposal attempts to redirect
payment to an unauthorized recipient. Covenant rejects it before authorization,
simulation, or submission.”

**MVP:** The scenario represents a possible downstream effect of indirect
prompt injection. It is not an LLM integration and does not prove
prompt-injection resistance.

## Local state

**MVP:** The fixed `.covenant-demo-state/events.v1.jsonl` journal contains only
strict sanitized audit projections. It is append-only, local, mutable,
reconstructable, and non-authoritative.

**MVP:** The journal never owns spend, replay, revocation, policy, execution, or
settlement authority. `CovenantVault` remains the authoritative financial state.

**MVP:** Every read and mutation coordinates through an operating-system lock
bound to an open descriptor for the stable ignored `.covenant-demo.lock`
sentinel at the repository root. The sentinel is never renamed, replaced, or
deleted by the application and remains after reset removes
`.covenant-demo-state`.

**MVP:** The operating system releases descriptor ownership when its process
exits. There is no PID authority or stale-lock stealing. An interrupted
projection is derived only from strict journal replay. This is local-machine
coordination; distributed locking remains Production scope.

**MVP:** Every replay validates strict schemas, deterministic event IDs,
runtime identity, continuous sequence numbers, exact event order, and a complete
newline-terminated JSONL record. Corruption is never repaired or skipped.

**MVP:** An interrupted cryptographic run cannot resume because its signing
accounts no longer exist. Reset is required.

## Commands

```powershell
pnpm.cmd demo:reset
pnpm.cmd demo:health
pnpm.cmd demo:seed
pnpm.cmd demo:run
```

**MVP:** Commands build the demo and its workspace dependencies before invoking
the built CLI. Command output is one JSON document and sanitized failures exit
with code `1`.

## Deferred scope

**MVP:** COV-008 proves vault execution, direct bypass rejection, revocation,
and post-revocation rejection in the separate `tests/contract-evidence`
ephemeral Anvil harness. These records do not enter this application's journal,
and this application's only mode remains `LOCAL_SIMULATED`.

**V2:** Additional actors, assets, scenarios, policies, and chains remain
excluded.

**Production:** Managed custody, distributed state, reconciliation, monitoring,
compliance, incident response, and high availability remain excluded.

**Protocol:** Generic execution, generic policies, upgradeability, and
multichain behavior remain excluded.
