# Covenant agent instructions

These instructions apply to the entire repository. More specific `AGENTS.md` files may only tighten them.

## Mission and thesis

**MVP:** Covenant is programmable financial authority infrastructure for autonomous software. AI should never receive unrestricted financial authority.

**MVP:** The execution model is: AI proposes; Covenant authorizes; Circle executes; Arc settles.

**MVP security invariant:** No component capable of generating payment requests shall possess authority to execute payments.

## Scope labels

- **MVP:** Frozen four-week demonstration scope and controls required to make it honest.
- **V2:** Candidate capabilities after the MVP; not approved for current implementation.
- **Production:** Operational hardening required before real funds or users; not approved for MVP implementation.
- **Protocol:** Long-horizon, generalized protocol capabilities; not approved for MVP implementation.

Every capability in project documentation must carry exactly one of these labels. Unlabeled future work must not be added.

## Frozen MVP scope

**MVP:** One organization, one procurement agent, one Covenant, one approved GPU vendor, one attacker address, one immutable CovenantVault, one Arc Testnet deployment, one six-decimal USDC asset, one successful payment, one indirect prompt-injection attack, one rejected malicious payment, one direct vault bypass attempt, one revocation, one audit timeline, and one three-minute demonstration.

**MVP:** COV-001 covers repository scaffolding, frozen schemas, money helpers, typed-data construction and vectors, trust boundaries, and the threat model.

## Explicit exclusions

- **MVP excluded from COV-001:** CovenantVault logic, Solidity receipt verification, Circle wallets, Arc deployment, Supabase migrations, service endpoints, authorization signing, executor behavior, vendor behavior, agent behavior, prompt-injection implementation, dashboards, landing pages, production infrastructure, and a generic policy language.
- **V2:** Additional vendors, agents, assets, policies, or chains require a separately approved scope.
- **Production:** Real funds, production credentials, high availability, key-management infrastructure, monitoring, incident response, and compliance operations are deferred.
- **Protocol:** Arbitrary smart-contract execution, generalized policy markets, and multichain protocol behavior are excluded.

## Repository responsibilities

- **MVP:** `apps/web` is the future demo console; the browser remains untrusted.
- **MVP:** `apps/agent` is the future untrusted procurement proposer.
- **MVP:** `apps/authority` is the future deterministic contextual policy and authorization service.
- **MVP:** `apps/executor` is the future submission-only Circle settlement service.
- **MVP:** `packages/contracts` is the future immutable Arc `CovenantVault`; COV-001 is Foundry-only.
- **MVP:** `packages/spec` owns frozen schemas, validation, money helpers, EIP-712 definitions, and vectors.
- **MVP:** `packages/sdk` is scaffolding only.
- **MVP:** `packages/config` owns shared build, TypeScript, lint, and formatting configuration.
- **MVP:** `supabase` may later hold non-authoritative application and audit projections only.

## Trust boundaries

- **MVP:** Browser, agent runtime, vendor content, and Supabase data are untrusted.
- **MVP:** The agent proposes exact payment intent fields and cannot authorize or execute them.
- **MVP:** The authority service evaluates context; an isolated authorization signer grants exact, short-lived authority.
- **MVP:** The executor submits signed fields unchanged and never chooses them.
- **MVP:** Circle owns wallet execution credentials.
- **MVP:** The Arc contract enforces hard limits and owns authoritative spend and replay state.

## Money representation

- **MVP:** JSON money is an unsigned canonical decimal string; internal money is `bigint` base units.
- **MVP:** Arc Testnet USDC uses six decimals. Never use JavaScript `number`, floating point, scientific notation, commas, signs, or implicit rounding for money.
- **MVP:** Payment amounts are positive. Limits may be non-negative only where the schema explicitly permits zero.
- **MVP:** Enforce the documented maximum before conversion and preserve exact formatting through shared helpers.

## Security rules

- **MVP:** Parse all signed objects with strict Zod schemas before hashing; reject unknown fields, malformed addresses, unsupported versions, invalid time ordering, and unsafe numeric representations.
- **MVP:** Normalize every address with one checksum strategy.
- **MVP:** EIP-712 domains always include name, version, chain ID, and verifying contract.
- **MVP:** Signed field definitions and ordering are frozen. Rule results use an ordered deterministic collection hash.
- **MVP:** Never commit secrets, real addresses presented as secrets, funded keys, private keys, API keys, or `.env` values.
- **MVP:** Do not claim TypeScript/Solidity hash parity until Solidity hashing and parity tests exist.

## Testing requirements

- **MVP:** Changes must add proportionate success and rejection tests, including schema strictness, address validation, time ordering, money edge cases, typed-data determinism, and domain separation.
- **MVP:** Before completion run formatting validation, lint, strict type checking, unit tests, build, available Foundry tests, and `pnpm verify`.
- **MVP:** Never weaken a test to make a check pass; report every failure.
- **Production:** Integration, end-to-end, live network, load, and operational resilience suites are deferred unless a task explicitly activates them.

## Git process

- **MVP:** Inspect the worktree before editing; preserve unrelated user changes.
- **MVP:** Keep commits scoped, review the complete diff, and never commit generated secrets, build output, or dependency directories.
- **MVP:** Do not amend, force-push, reset, discard changes, push, or open a pull request unless the user explicitly requests it.
- **MVP:** Commit messages should identify the issue and security-relevant intent.

## Definition of done

**MVP:** The requested scope is complete only when required files exist, strict types compile, exported schemas and helpers are tested, documentation is scope-labeled, CI needs no secrets, formatting/lint/typecheck/tests/build/verification pass, the final diff is reviewed, no product implementation is present, and failures or residual risks are reported.

## Stop conditions

Stop and report before making any change that would:

- **MVP:** Give the agent Circle credentials.
- **MVP:** Give the agent a funded wallet.
- **MVP:** Give the agent an authorization signing key.
- **MVP:** Let the executor modify signed payment fields.
- **MVP:** Store authoritative budget state offchain.
- **Protocol:** Add arbitrary smart-contract execution.
- **MVP:** Add upgradeability.
- **MVP:** Change typed-data hashing.
- **MVP:** Change signer responsibilities.
- **V2:** Add another chain.
- **Protocol:** Add another policy system.
- **MVP:** Expand the MVP.

## Completion report format

**MVP:** Completion reports must contain: summary; repository structure; files changed; schema decisions; EIP-712 decisions; threat-model findings; architecture impact; security impact; commands; test results; remaining risks; deferred MVP work; V2, Production, and Protocol items; and founder-approval assumptions. Do not report completion while an acceptance criterion fails.
