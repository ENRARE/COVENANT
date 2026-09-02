# Covenant agent instructions

These instructions apply to the entire repository. More specific `AGENTS.md` files may only tighten them.

## Mission and thesis

**MVP:** Covenant proved programmable financial authority infrastructure for autonomous software. AI should never receive unrestricted financial authority.

**V2:** Covenant Platform v1 is the approved API-first evolution: reusable developer infrastructure for multiple projects and Covenant instances on Arc using USDC, while preserving the MVP authority boundaries.

**MVP:** The execution model is: AI proposes; Covenant authorizes; Circle executes; Arc settles.

**MVP security invariant:** No component capable of generating payment requests shall possess authority to execute payments.

## Scope labels

- **MVP:** Frozen four-week demonstration scope and controls required to make it honest.
- **V2:** The bounded Platform v1/API/SDK direction approved by ADR 0022. Only the explicitly accepted COV may be implemented; later V2 work is not implicit.
- **Production:** Operational hardening required before real funds or users; not approved for MVP implementation.
- **Protocol:** Long-horizon, generalized protocol capabilities; not approved for MVP implementation.

Every capability in project documentation must carry exactly one of these labels. Unlabeled future work must not be added.

## Frozen MVP scope

**MVP:** One organization, one procurement agent, one Covenant, one approved GPU vendor, one attacker address, one immutable CovenantVault, one Arc Testnet deployment, one six-decimal USDC asset, one successful payment, one indirect prompt-injection attack, one rejected malicious payment, one direct vault bypass attempt, one revocation, one audit timeline, and one three-minute demonstration.

**MVP:** COV-001 covers repository scaffolding, frozen schemas, money helpers, typed-data construction and vectors, trust boundaries, and the threat model.

**MVP:** COV-001 through COV-020 are the frozen completed historical proof. `docs/MVP_CANON.md` remains intact; V2 direction is governed separately by `docs/V2_PLATFORM_CANON.md` and ADR 0022.

## Explicit exclusions

- **MVP excluded from COV-001:** CovenantVault logic, Solidity receipt verification, Circle wallets, Arc deployment, Supabase migrations, service endpoints, authorization signing, executor behavior, vendor behavior, agent behavior, prompt-injection implementation, dashboards, landing pages, production infrastructure, and a generic policy language.
- **V2:** Platform v1 may support multiple developer projects and Covenant instances only through the approved COV-021 through COV-027 sequence. Additional assets, chains, generic policies, or arbitrary execution remain excluded.
- **Production:** Real funds, production credentials, high availability, key-management infrastructure, monitoring, incident response, and compliance operations are deferred.
- **Protocol:** Arbitrary smart-contract execution, generalized policy markets, and multichain protocol behavior are excluded.

## Repository responsibilities

- **MVP:** `apps/web` is the future demo console; the browser remains untrusted.
- **MVP:** `apps/agent` is the future untrusted procurement proposer.
- **MVP:** `apps/authority` is the future deterministic contextual policy and authorization service.
- **MVP:** `apps/executor` is the future submission-only Circle settlement service.
- **MVP:** `packages/contracts` is the future immutable Arc `CovenantVault`; COV-001 is Foundry-only.
- **MVP:** `packages/spec` owns frozen schemas, validation, money helpers, EIP-712 definitions, and vectors.
- **MVP:** `packages/sdk` remains the existing scaffold and has no runtime SDK behavior.
- **V2:** `packages/sdk` is the approved future typed client over the public Covenant API; it must not become an independent execution architecture.
- **MVP:** `packages/config` owns shared build, TypeScript, lint, and formatting configuration.
- **MVP:** `supabase` may later hold non-authoritative application and audit projections only.

## Trust boundaries

- **MVP:** Browser, agent runtime, vendor content, and Supabase data are untrusted.
- **MVP:** The agent proposes exact payment intent fields and cannot authorize or execute them.
- **MVP:** The authority service evaluates context; an isolated authorization signer grants exact, short-lived authority.
- **MVP:** The executor submits signed fields unchanged and never chooses them.
- **MVP:** Circle owns wallet execution credentials.
- **MVP:** The Arc contract enforces hard limits and owns authoritative spend and replay state.
- **V2:** The public API and SDK do not become financial authority. API authentication grants project access only; authorization and execution still cross the existing separated boundaries.
- **V2:** Arc and six-decimal USDC remain the only Platform v1 network and settlement asset. Offchain platform data remains non-authoritative for spend and replay.

## Money representation

- **MVP:** Accepted JSON money input is an unsigned decimal string with zero to six fractional digits. `1`, `1.0`, and `1.000000` are equivalent inputs; leading-zero integers such as `01` are rejected.
- **MVP:** Internal money is `bigint` base units. Canonical output is the shortest exact decimal form, so all equivalent representations above format as `1`.
- **MVP:** Arc Testnet USDC uses six decimals. Never use JavaScript `number`, floating point, scientific notation, commas, signs, or implicit rounding for money.
- **MVP:** Payment amounts are positive. Limits may be non-negative only where the schema explicitly permits zero.
- **MVP:** Enforce the uint256-derived maximum lexically before `BigInt` conversion. Input formatting is not preserved.

## Security rules

- **MVP:** Parse all signed objects with strict Zod schemas before hashing; reject unknown fields, malformed addresses, unsupported versions, invalid time ordering, and unsafe numeric representations.
- **MVP:** Public typed-data builders, hashes, and verifiers accept `unknown`, parse internally, and construct messages explicitly from parsed fields.
- **MVP:** Normalize lowercase addresses to EIP-55; accept correct mixed-case checksum only; reject incorrect checksum and zero security addresses.
- **MVP:** Issuer, agent signer, and authorization signer are pairwise distinct. The GPU recipient also differs from those roles, the vault, and the token.
- **MVP:** PaymentIntent, Invoice, DecisionReceipt, and AuthorizationReceipt use strict detached `{ payload, signature }` envelopes with 65-byte signatures.
- **MVP:** The only accepted chain is Arc Testnet `5042002`; multichain behavior is Protocol scope.
- **MVP:** EIP-712 domains always include name, version, chain ID, and verifying contract.
- **MVP:** Signed field definitions and ordering are frozen. DecisionReceipt is signed and commits to the exact canonical 11-rule collection hash.
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

**MVP:** The frozen proof's requested scope is complete only when required files exist, strict types compile, exported schemas and helpers are tested, documentation is scope-labeled, CI needs no secrets, formatting/lint/typecheck/tests/build/verification pass, the final diff is reviewed, and failures or residual risks are reported. COV-001's historical no-product-implementation restriction applies to COV-001, not to separately accepted later work.

**V2:** A Platform v1 COV is complete only within its explicitly accepted scope. COV-021 is documentation/governance only; it must not implement COV-022 or later runtime behavior. Every V2 change must preserve signer separation, exact authorized fields, onchain financial/replay authority, explicit schema versioning, and the required repository verification gates.

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
- **V2:** Make the SDK or API a second authorization or execution path.
- **V2:** Reinterpret an existing signed version-1 schema instead of explicitly versioning an incompatible structure.

## Completion report format

**MVP:** Completion reports must contain: summary; repository structure; files changed; schema decisions; EIP-712 decisions; threat-model findings; architecture impact; security impact; commands; test results; remaining risks; deferred MVP work; V2, Production, and Protocol items; and founder-approval assumptions. Do not report completion while an acceptance criterion fails.
