# ADR 0018: Deterministic non-authoritative audit timeline

- Status: Proposed
- Date: 2026-08-04
- Scope: MVP

## Decision

**MVP:** Implement COV-015 as a pure offline projector in `@covenant/audit`.
It accepts one strict versioned source bundle as `unknown`, reconstructs every
supported event field by field, validates causal relationships, deduplicates
identical evidence, performs a deterministic topological sort, and returns one
deeply frozen sanitized timeline.

**MVP:** The projection is observational and non-authoritative. It cannot
propose, decide, authorize, sign, prepare calldata, simulate, submit, execute,
deploy, fund, query, settle, revoke, reconcile, or establish finality.

## Source ownership

**MVP:** The exact source definitions are
`apps/demo/src/schemas.ts`, `packages/spec/src/schemas.ts`,
`apps/executor/src/schemas.ts`, `apps/executor/src/errors.ts`,
`packages/spec/src/local-contract-evidence.ts`, and
`packages/spec/src/cov010-deployment-evidence.ts`. COV-015 does not change the
claim meaning of any source.

**MVP:** The closed source kinds are exactly `DEMO_AUDIT`,
`VALIDATED_SIGNED_FLOW`, `EXECUTOR_RESULT`, `LOCAL_CONTRACT_EVIDENCE`, and
`ARC_DEPLOYMENT_EVIDENCE`. Unknown kinds and unknown properties fail closed.

**MVP:** `DEMO_AUDIT` uses the existing `@covenant/demo/audit-schema`
subpath. Its source event ID, type, sequence, scenario, allowlisted subject
identifiers, rule summaries, and optional source time are retained. Runtime
storage, locks, paths, and filesystem metadata are excluded. Demo journal
records are observational: they do not contain signed envelopes and do not
prove signatures or independently verify policy. The projector trusts the
strict demo schema and the upstream journal's provenance while globally
rejecting one source event ID or runtime/sequence position paired with
different canonical bodies across wrappers.

**MVP:** `VALIDATED_SIGNED_FLOW` contains the existing signed PaymentIntent,
canonical RuleResults, signed DecisionReceipt, optional approved
AuthorizationReceipt, and the validated digest identities produced by the
upstream verification boundary. The adapter reparses every artifact and
rechecks exact cross-links, rule hash, decision semantics, and authorization
presence. It makes no policy decision and creates no signature. Full envelopes
and signatures never enter output.

**MVP:** `EXECUTOR_RESULT` accepts only the repository's faithfully sourced
`PREPARED`, `SIMULATED`, and `SUBMITTED` successful outputs. The representation
keeps only the stable execution link, validated signed-flow digests, and, for
`SUBMITTED`, an allowlisted opaque transaction identifier. Executor failures
are thrown sanitized errors and no repository-owned producer supplies the
complete stable audit link required by COV-015, so rejection, ambiguity, and
generic error source variants are not accepted. The adapter excludes calldata,
transactions, receipts, provider bodies, exceptions, stacks, causes, and raw
dependency messages.

**MVP:** `LOCAL_CONTRACT_EVIDENCE` uses the exact ordered COV-008 result schema.
The unchanged schema is owned by `@covenant/spec` and re-exported from the
existing harness module so the evidence producer and projector cannot drift.
No internal receipt, hash, account, address, RPC, process, key, or path enters
the adapter.
The projector trusts that the upstream COV-008 harness produced the strict
public result after performing its private receipt, event, balance, and state
checks; COV-015 does not rerun Anvil or independently reconstruct those checks.

**MVP:** `ARC_DEPLOYMENT_EVIDENCE` uses the existing strict COV-010 manifest
schema and offline anchor/digest verifier. The timeline includes only the
allowlisted deployment identifiers and commitments. It omits the deployer and
complete constructor object.

## Lifecycle and normalized taxonomy

**MVP:** The normalized event taxonomy is closed in code. Direct demo journal
events use `OBSERVATIONAL_DEMO_AUDIT`; only `VALIDATED_SIGNED_FLOW` may use
`VERIFIED_SIGNED_ARTIFACT` and `VERIFIED_POLICY_OUTPUT` for proposal, policy,
and authorization evidence. The derived compromised-scenario event retains its
separate derived-evidence classification.

**MVP:** Proposal, policy decision, signed authorization, transport
preparation, transport acceptance, transaction submission, execution evidence,
settlement evidence, security control, revocation, and deployment evidence are
distinct stages. Existing `APPROVED`, `REJECTED`, `PASS`, `FAIL`, source event
types retain their original meanings.

**MVP:** `SUBMITTED` means only that the configured executor transport returned
a validated accepted result. It permits no execution, settlement, or finality
descendant without a separate source. Unsupported executor failure-shaped audit
inputs fail strict parsing rather than being assigned provenance COV-015 cannot
prove.

**MVP:** `SUBMISSION_SIMULATED` produces only
`SIMULATED_SUBMISSION_REFERENCE_RECORDED`. It is never parsed or displayed as a
transaction hash and never becomes transaction-submission evidence.

**MVP:** `LOCAL_VAULT_EXECUTION_SUBMITTED` and
`LOCAL_VAULT_EXECUTION_VERIFIED` remain distinct. The latter additionally
supports a local-only settlement observation because the complete COV-008
harness already verified token movement and vault accounting. Its claim scope
is exactly `LOCAL_ANVIL_SETTLEMENT_OBSERVATION`.

**MVP:** The fixed compromised-proposer event is derived only from exactly one
malicious proposal, exactly one canonically ordered rule collection with
`recipient_allowed: FAIL` and every other rule `PASS`, exactly one rejected
decision, matching scenario/covenant/intent links, and no authorization,
preparation, simulation, or submission. It claims only rejection of that fixed
scenario, not general prompt-injection resistance. Its details list the exact
three demo source event IDs, while its normalized causes reference the proposal
and the policy event that carries the canonical rule outcomes.

**MVP:** COV-010 `FINAL_ARC_TRANSACTION` is exposed only with
`finalityScope: ARC_DEPLOYMENT_TRANSACTION_ONLY`. No normalized generic success,
payment-completed, settled, finalized, external settlement, or payment-finality
event exists.

## Identity and deduplication

**MVP:** A normalized event ID is lowercase Keccak-256 over canonical JSON
containing only audit schema version, normalized event type, source kind, exact
source event type, canonical source identity, and canonical subject identity.
Sequence, source times, ingestion order, paths, display wording, signatures,
receipts, and nondeterministic metadata are excluded.

**MVP:** Demo identity uses the existing source event ID; COV-015 verifies the
unchanged upstream ID formula but does not treat that deterministic identifier
as cryptographic evidence of the event's claim. Signed-flow identity
uses validated intent, decision, and authorization digests. Executor identity
uses the execution ID. COV-008 identity commits to the canonical complete result,
exact evidence type, and fixed evidence index. COV-010 identity hashes the source
commit, deployment transaction hash, deployment block hash, and existing
canonical manifest digest.

**MVP:** Identical normalized ID and identical canonical normalized body
collapse. A normalized ID with a different body fails
`AUDIT_EVENT_IDENTITY_CONFLICT`. A demo source event ID with a changed complete
parsed body, a duplicate logical lifecycle record with a changed body,
conflicting outcomes for a decision ID, or conflicting transaction identifiers
for an execution ID fails `AUDIT_SOURCE_CONFLICT`. Checks span all wrappers and
no first-writer-wins behavior exists.

## Causality and ordering

**MVP:** Policy depends on proposal; authorization depends on an approved
decision; transport preparation depends on authorization; transport results
depend on preparation; local execution verification depends on local
transaction submission; the local settlement observation depends on local
execution verification; and post-revocation rejection depends on verified
revocation. Missing parents and cycles fail closed.

**MVP:** Demo continuity compares every identifier shared by adjacent records,
including runtime, scenario, covenant, intent, decision, authorization, and
execution identifiers where present. Conflicting logical duplicates or later
records that disagree with a predecessor reject the whole projection.

**MVP:** A deterministic Kahn topological sort selects among available events
using the fixed tuple `trackRank`, `stageRank`, `sourceKindRank`, canonical
source position, and normalized event ID. Tracks are `DEPLOYMENT`,
`PAYMENT_FLOW`, `SECURITY_CONTROL`, and `REVOCATION` in that order. All ranks are
frozen in code.

**MVP:** Demo position is source sequence, COV-008 position is exact evidence
array index, COV-010 position is one, and signed/executor positions are frozen
lifecycle positions. Output sequence is assigned only after sorting as canonical
positive decimal strings beginning at `"1"`.

**MVP:** Optional source times are metadata only. They do not determine identity,
causality, or ordering. The projector reads no clock and emits no `generatedAt`.

## Canonical output and claim boundary

**MVP:** Canonical JSON recursively sorts object keys, preserves array order,
uses no whitespace, and ends with one LF byte. `projectionId` is Keccak-256 over
the canonical projection body without `projectionId`. The same validated input
therefore produces byte-identical output independent of ingestion order, time,
locale, and platform.

**MVP:** The top-level claim boundary fixes `circleExecution`,
`arcPaymentSettlement`, `paymentFinality`, and `databaseFinancialAuthority` to
`false`. Output and nested event schemas reject unknown properties.

## Failure and sanitization

**MVP:** Public failures are limited to `MALFORMED_AUDIT_SOURCE`,
`UNSUPPORTED_AUDIT_SOURCE`, `AUDIT_SOURCE_INCOMPLETE`,
`AUDIT_SOURCE_CONFLICT`, `AUDIT_EVENT_IDENTITY_CONFLICT`,
`AUDIT_CAUSALITY_FAILURE`, `AUDIT_ORDERING_FAILURE`,
`AUDIT_SANITIZATION_FAILURE`, and `AUDIT_SERIALIZATION_FAILURE`, each with one
fixed message and no raw value, dependency message, stack, cause, path,
signature, receipt, transaction body, or credential.

**MVP:** Any malformed, incomplete, conflicting, causally impossible, or
unsanitizable source rejects the entire projection. Partial timelines are never
returned.

## Command and storage

**MVP:** The command accepts no arguments or caller-selected path. It reads one
bounded JSON document from standard input and writes exactly one canonical JSON
document to standard output. It performs no network operation and writes no
file or database record.

**MVP:** A caller may explicitly redirect output to a local file. Such a file is
observational, replaceable, reconstructable, and non-authoritative. The existing
demo journal and COV-008/COV-010 evidence remain unchanged.

**MVP:** CovenantVault remains authoritative for spend, remaining budget,
payment count, financial replay, revocation, token movement, and settlement
enforcement.

## Consequences and exclusions

**MVP:** COV-015 makes existing evidence understandable without adding payment
or observation authority. It does not establish Circle execution, external Arc
payment execution, settlement, confirmation, reconciliation, or payment
finality.

**Production:** Centralized retention, tamper-evident storage, reconciliation,
monitoring, backup, access control, and incident response remain deferred.

**V2:** Additional sources, organizations, agents, vendors, assets, products,
policies, and chains require separately reviewed closed adapters.

**Protocol:** Generic event ingestion, arbitrary schemas, policy composition,
arbitrary calls, and generalized execution remain excluded.
