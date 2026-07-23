# ADR 0007: Executor application core

- Status: Accepted
- Date: 2026-07-23
- Scope: MVP

All capabilities in this decision are **MVP** unless explicitly labeled otherwise.

## Decision

**MVP:** Implement COV-004 as a pure dependency-injected application core under `apps/executor`. It exposes only `prepareExecution`, `simulateAuthorizedPayment`, and `executeAuthorizedPayment` from `createExecutorService`; it exposes no generic transaction-forwarding method.

**MVP:** Public input contains exactly a signed PaymentIntent, canonical RuleResults, signed DecisionReceipt, and signed AuthorizationReceipt. Invoice remains authority-only evidence. DecisionReceipt and RuleResults are verified offchain and never enter `CovenantVault.executePayment` calldata.

**MVP:** The single authoritative Covenant is loaded only through an injected provider and strictly parsed for every operation. The caller cannot select Covenant data, an EIP-712 domain or digest, target, chain, token, recipient, amount, ABI, function, calldata, or native value.

**MVP:** The executor passes the original raw nested public values and raw provider result to `@covenant/spec` complete-chain verification, then uses only the returned parsed objects. ECDSA recovery, canonical signature checks, EIP-712 construction, hashing, and authorization-chain cryptography are not duplicated.

## Exact call boundary

**MVP:** Foundry output is the source for a generated committed full `CovenantVault` ABI at the contracts boundary. Deterministic repository verification regenerates the ABI and fails when committed bytes differ.

**MVP:** The executor selects only `executePayment`, explicitly constructs PaymentIntent and AuthorizationReceipt tuples in Solidity order, retains the verified detached signatures, targets the trusted vault on Arc Testnet `5042002`, and sets native value to zero.

**MVP:** Constructed calldata must use selector `0x7ee0e4da`. The executor independently decodes the result, requires `executePayment`, re-encodes the decoded values, and requires byte equality before exposing or transporting the immutable scalar request.

## Time, state, and transport

**MVP:** Preparation reads the injected clock once and requires the Covenant, PaymentIntent, DecisionReceipt, and AuthorizationReceipt to be currently valid. Execution reads and validates the clock again after successful simulation and immediately before submission.

**MVP:** The narrow transport accepts only the internally constructed chain, target, zero value, and calldata. It has no policy authority, authorization key, or public generic forwarding surface. The executor owns no authorization key and no funded transaction key.

**MVP:** Execution identity is a structured ABI-encoded keccak256 commitment containing a fixed domain tag, signed identifiers and recomputed digests, authorization nonce, vault, and chain. Detached signature bytes are excluded.

**MVP:** Concurrent duplicates join pending work. Completed execution is returned without resubmission. Simulation failure and an explicit guaranteed-no-submission rejection are retryable after full re-verification.

**MVP:** Submission start is retained in instance-local state independent of repository health. Every exception, timeout, malformed response, explicit ambiguity, or unsafe repository outcome after submission begins becomes retained ambiguity and prevents another submission.

**MVP:** In-memory coordination is volatile and non-authoritative. The immutable vault owns authoritative replay, spend, payment-count, revocation, balance, and settlement state.

## Exclusions

**MVP:** COV-004 excludes Circle APIs and credentials, live Arc broadcasting, funded keys, contract deployment, HTTP endpoints, webhooks, queues, workers, Supabase, UI, agent behavior, and production custody.

**V2:** Multiple Covenants, organizations, agents, recipients, tokens, assets, or execution variants require new approved scope.

**Production:** Durable distributed coordination, restart recovery, settlement reconciliation, finality tracking, KMS or HSM custody, RPC redundancy, monitoring, and incident response remain deferred.

**Protocol:** Arbitrary calldata, generic forwarding, batching, multicall, delegatecall, account abstraction, multichain behavior, and upgradeability remain excluded.

## Consequence

**MVP:** The executor verifies but does not authorize and cannot choose payment fields. A proposal-producing component still cannot execute, the transport cannot decide policy, and `CovenantVault` remains the final financial enforcement boundary.
