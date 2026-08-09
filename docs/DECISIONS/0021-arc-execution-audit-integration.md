# ADR 0021: Arc execution evidence in the MVP audit console

- Status: Proposed
- Date: 2026-08-09
- Scope: MVP

## Decision

**MVP:** COV-020 advances the audit source bundle and normalized timeline to schema version `2`. Version `1` is not silently reinterpreted. The one new closed source family is `ARC_EXECUTION_EVIDENCE`, and its public input is strictly parsed from `unknown` without importing payment, signer, transport, or generic RPC capabilities into `@covenant/audit`.

**MVP:** The source preserves three distinct facts as three distinct normalized events: `CIRCLE_PROVIDER_OBSERVATION_RECORDED`, `ARC_EXECUTION_OBSERVATION_RECORDED`, and `EXECUTION_RECONCILIATION_RECORDED`. Provider observation depends on prepared execution evidence; Arc observation is independently sourced; reconciliation causally references both observations and deterministically recomputes its closed classification.

**MVP:** Provider evidence is limited to a strict durable-state progression, optional known transaction hash, one observed submission attempt, and `automaticRetry: false`. Provider state alone never establishes Arc execution. Provider `UNKNOWN` plus independently proven Arc success classifies as `ARC_EXECUTION_SUCCEEDED` without another Circle POST.

**MVP:** Successful Arc observation preserves the exact chain ID, transaction and block identifiers, CovenantVault target, covenant, intent and authorization identifiers, recipient, amount, token, ERC-20 transfer source/recipient/amount, receipt status, and allowlisted read-only vault accounting. Malformed, removed, duplicate, missing, or conflicting upstream evidence is represented only by COV-019's closed results and fails source or reconciliation consistency checks closed.

**MVP:** The committed browser fixture is generated offline from repository-owned static sanitized inputs. Its historical payment evidence identifies COV-018 transaction `0x1429af87afb5865933cb4bc3870100c8c4d0cde8795efc54e07a9460f8acea55`, Arc Testnet chain ID `5042002`, and the exact reviewed COV-019 execution facts. The browser never runs the projector and never observes a live network.

**MVP:** The console presents the frozen product sequence as: “AI proposes. Covenant authorizes. Circle submits. Arc execution is independently verified.” It also displays the exact invariant: “No component capable of generating payment requests shall possess authority to execute payments.”

**MVP:** The top-level claim boundary records a Circle submission attempt and independent Arc execution observation while fixing Circle provider outcome known, Arc payment settlement, payment finality, database financial authority, and automatic resubmission to `false`. Observed execution is never described as settlement, confirmation finality, or irreversibility.

## Consequences

**MVP:** `@covenant/audit` remains a pure, deterministic, offline, non-authoritative observer. It has no Circle POST, retry, resubmission, signer, private key, wallet transfer, contract write, transaction broadcast, network query, database client, or generic RPC interface.

**MVP:** `apps/web` remains a static read-only presentation boundary with no command surface or persistence. A judge can inspect source identity, exact normalized facts, causal parents, security rejections, provider ambiguity, independent Arc execution, and the bounded reconciliation result on desktop and mobile.

**MVP:** COV-020 does not change signed schemas, EIP-712 definitions, CovenantVault, Circle mutating transport behavior, executor authorization, calldata construction, idempotency, signing, or payment-submission authority.

**Production:** Live evidence acquisition, redundant Arc providers, reorganization policy, confirmation policy, tamper-evident distribution, authenticated access, monitoring, retention, and incident response remain deferred.

**V2:** Additional executions, providers, assets, chains, organizations, saved console state, and operational workflows require separately reviewed scope and closed adapters.

**Protocol:** Generic RPC, generic provider ingestion, arbitrary contract calls, generalized payment execution, and multichain reconciliation are excluded.
