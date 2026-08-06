# Executor application core

## Scope

**MVP:** `@covenant/executor` is a pure dependency-injected application core for the one trusted Covenant. It accepts exactly one signed PaymentIntent, canonical RuleResults, signed DecisionReceipt, and signed AuthorizationReceipt; verifies the complete authorization chain; and constructs only the exact `CovenantVault.executePayment` call.

**MVP:** Invoice remains authority-only evidence. DecisionReceipt and RuleResults are verified offchain and are not calldata. The vault call contains only the verified PaymentIntent and signature plus the verified AuthorizationReceipt and signature.

## Trust and execution boundaries

**MVP:** The executor loads the Covenant only through an injected trusted provider and strictly parses it on every operation. Public callers cannot supply a Covenant, domain, digest, target, chain, token, recipient, amount override, ABI, function name, calldata, or transaction value.

**MVP:** `@covenant/spec` owns signature recovery, canonical signature validation, EIP-712 construction, hashing, rule commitments, and authorization-chain verification. The executor reuses those boundaries and constructs the two Solidity tuples explicitly from verified parsed fields.

**MVP:** The executor owns no authorization signing key and no funded transaction key. Its narrow injected transport can simulate or submit only an internally constructed immutable transaction request and has no policy authority.

**MVP:** COV-009 does not connect this package to Arc. The trusted operational
profile and read-only preflight cannot enumerate accounts, construct a wallet,
sign, broadcast, select a vault, or enter the executor transport. Browser,
caller, CLI, and environment input cannot override RPC, chain, token, ABI, or
transaction fields.

**MVP:** The generated full `CovenantVault` ABI lives under `packages/contracts/abi`. Repository verification regenerates it from Foundry output and fails on byte-level drift. The executor selects only `executePayment`, requires selector `0x7ee0e4da`, independently decodes the calldata, and requires exact re-encoding.

## Coordination

**MVP:** Preparation reserves no state. Concurrent simulations and executions for the same structured digest identity share pending operations. Successful execution is returned idempotently without another submission.

**MVP:** Simulation failure is retryable. A strict transport rejection is retryable only when it explicitly guarantees that no submission occurred. Once submission begins, exceptions, timeouts, malformed responses, explicit ambiguity, and unsafe repository failures retain fail-closed instance-local ambiguity and prevent resubmission.

**MVP:** In-memory coordination is volatile and non-authoritative. `CovenantVault` remains authoritative for replay, budget, payment count, revocation, token balance, and settlement enforcement.

## Development

**MVP:** Run executor checks from the repository root:

```powershell
pnpm.cmd --filter @covenant/executor lint
pnpm.cmd --filter @covenant/executor typecheck
pnpm.cmd --filter @covenant/executor test
pnpm.cmd --filter @covenant/executor build
pnpm.cmd verify:contract-abi
```

## Deferred scope

**MVP:** COV-004 excludes Circle APIs and credentials, live Arc broadcasting, funded keys, deployment, HTTP endpoints, webhooks, queues, workers, Supabase, UI, agent behavior, and production key infrastructure.

**V2:** Multiple Covenants, organizations, agents, recipients, tokens, assets, or reviewed execution variants require separately approved scope.

**Production:** Durable distributed idempotency, restart recovery, settlement reconciliation, finality tracking, managed transaction custody, RPC redundancy, monitoring, and incident response remain deferred.

**MVP deferred to COV-010/COV-011:** Deployment and attestation are separated
from later vault funding and execution evidence. Neither issue may give a
payment-request generator transaction-payer authority.

## COV-008 local transport evidence

**MVP:** COV-008 supplies a harness-local `TransactionTransport` without
changing this package's public API. It accepts only the executor-constructed
Arc-chain-ID, trusted-vault, zero-value `executePayment` request, simulates it
with a local `eth_call`, and submits it from a distinct local payer.

**MVP:** Transport `SUBMITTED` still means only that a transaction hash was
returned. A separate test-harness-local receipt reader verifies the mined local
receipt, exact event emitters, balance movement, and vault state. That reader is
not exported by the executor and makes no Arc confirmation or finality claim.

**Protocol:** Generic forwarding, arbitrary calldata, batching, multicall, delegatecall, multiple chains, account abstraction, and upgradeability remain excluded.

## COV-017 Circle planning boundary

**MVP:** COV-017 is documentation and architecture planning only. This executor
is unchanged and still uses its simulated transport. No Circle API key, entity
secret, ciphertext, recovery file, wallet capability, SDK, HTTP transport,
status poller, funded transaction key, live submission, or Arc RPC capability
has been implemented.

**MVP:** Proposed ADR 0020 recommends that any separately approved future Circle
transport preserve this package's exact fixed `executePayment` construction,
independent decode and byte-for-byte re-encoding, fixed Arc chain, trusted vault,
and zero native value. Direct Circle transfer and caller-selected wallet, chain,
target, ABI, calldata, amount, fee policy, URL, credential, idempotency identity,
or evidence classification remain forbidden.

**MVP:** The current execution identity, identical-request joining, conflict
rejection, and ambiguity boundary must remain intact. Once a Circle submission
may have occurred, absence of a response must never cause automatic
resubmission. Circle API acceptance, provider state, Arc execution, external
settlement, and payment finality remain separate claims. Implementation remains
separately gated by ADR 0020's custody, durable idempotency, retry, Arc evidence,
and finality blockers.
