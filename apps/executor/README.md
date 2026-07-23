# Executor application core

## Scope

**MVP:** `@covenant/executor` is a pure dependency-injected application core for the one trusted Covenant. It accepts exactly one signed PaymentIntent, canonical RuleResults, signed DecisionReceipt, and signed AuthorizationReceipt; verifies the complete authorization chain; and constructs only the exact `CovenantVault.executePayment` call.

**MVP:** Invoice remains authority-only evidence. DecisionReceipt and RuleResults are verified offchain and are not calldata. The vault call contains only the verified PaymentIntent and signature plus the verified AuthorizationReceipt and signature.

## Trust and execution boundaries

**MVP:** The executor loads the Covenant only through an injected trusted provider and strictly parses it on every operation. Public callers cannot supply a Covenant, domain, digest, target, chain, token, recipient, amount override, ABI, function name, calldata, or transaction value.

**MVP:** `@covenant/spec` owns signature recovery, canonical signature validation, EIP-712 construction, hashing, rule commitments, and authorization-chain verification. The executor reuses those boundaries and constructs the two Solidity tuples explicitly from verified parsed fields.

**MVP:** The executor owns no authorization signing key and no funded transaction key. Its narrow injected transport can simulate or submit only an internally constructed immutable transaction request and has no policy authority.

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

**Protocol:** Generic forwarding, arbitrary calldata, batching, multicall, delegatecall, multiple chains, account abstraction, and upgradeability remain excluded.
