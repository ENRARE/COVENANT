# Threat model

## Scope and invariant

**MVP:** This model covers the frozen Arc Testnet demonstration. The invariant is: no component capable of generating payment requests shall possess authority to execute payments.

Outcome meanings: **Prevented** means the MVP control blocks the stated outcome; **Bounded** means hard limits cap impact; **Detected** means the MVP primarily exposes evidence; **Accepted** means the risk remains knowingly; **Out of scope** means the scenario is not exercised in the MVP.

## Assets

| Asset                            | Scope | Security objective                                                                                   |
| -------------------------------- | ----- | ---------------------------------------------------------------------------------------------------- |
| Vault USDC                       | MVP   | Preserve funds except exact authorized settlement within hard limits                                 |
| Issuer authority                 | MVP   | Prevent unauthorized Covenant creation or revocation decisions                                       |
| Agent identity key               | MVP   | Authenticate proposals without granting execution authority                                          |
| Authorization signer             | MVP   | Sign only exact, approved, short-lived receipts                                                      |
| Circle credentials               | MVP   | Restrict transaction submission to the isolated executor                                             |
| Covenant configuration           | MVP   | Preserve issuer-approved immutable limits and policy commitment                                      |
| `PaymentIntent` integrity        | MVP   | Bind agent, recipient, token, amount, invoice, purpose, time, and nonce                              |
| `AuthorizationReceipt` integrity | MVP   | Bind a nonzero DecisionReceipt identifier, Covenant, intent, vault, chain, policy, nonce, and expiry |
| Audit records                    | MVP   | Preserve useful evidence without becoming authoritative state                                        |
| Vendor invoice key               | MVP   | Authenticate the approved vendor’s exact invoice fields                                              |

## Components

| Component                           | Scope | Trust posture                                                         |
| ----------------------------------- | ----- | --------------------------------------------------------------------- |
| Browser                             | MVP   | Untrusted display and input boundary                                  |
| Procurement agent                   | MVP   | Untrusted proposal generator                                          |
| Authority service                   | MVP   | Trusted for contextual decisions, not custody or execution            |
| Authorization signer                | MVP   | Trusted for exact authorization; isolated from proposal and execution |
| Executor                            | MVP   | Trusted only to submit signed fields unchanged                        |
| Circle Developer-Controlled Wallets | MVP   | Custodies execution credentials and submits transactions              |
| Arc `CovenantVault`                 | MVP   | Authoritative hard-limit, spend, revocation, and replay enforcement   |
| Supabase                            | MVP   | Non-authoritative projection and audit store                          |
| GPU vendor                          | MVP   | Untrusted content source with a trusted invoice signing key           |

## Threat register

Each row states attack path, affected asset, MVP control, residual risk, deferred Production control, and classified outcome.

| Threat                           | Scope | Attack path                                                              | Affected asset                              | MVP control                                                                                                      | Residual risk                                                                        | Deferred Production control                                                         | Outcome   |
| -------------------------------- | ----- | ------------------------------------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | --------- |
| Direct prompt injection          | MVP   | User instructs the agent to ignore policy and pay an attacker            | Vault USDC; intent integrity                | Agent has no authorization or execution authority; authority and vault independently enforce exact limits        | Agent may emit convincing malicious proposals or disrupt service                     | Model/input isolation, abuse monitoring, and adversarial regression corpus          | Prevented |
| Indirect prompt injection        | MVP   | Malicious vendor content causes an attacker-directed intent              | Vault USDC; intent integrity                | Approved recipient/token policy, invoice verification, isolated authorization, and vault limits reject mismatch  | Allowed vendor content may still manipulate purpose within permitted fields          | Content provenance, sandboxing, taint tracking, and expanded red-team testing       | Prevented |
| Compromised agent runtime        | MVP   | Attacker fully controls agent code and outputs                           | Agent key; intent integrity                 | Agent cannot authorize or execute; exact policy and onchain checks bound proposals                               | Attacker can exhaust evaluation capacity and use the agent key                       | Workload isolation, rate limits, attestation, rotation, and anomaly detection       | Bounded   |
| Stolen agent key                 | MVP   | Attacker signs forged intents as the agent                               | Agent identity key; intent integrity        | Agent signature grants proposal identity only; nonce/expiry and independent authorization remain required        | Forged proposals may look legitimate and cause denial of service                     | Hardware-backed key, rapid rotation, revocation, and behavioral detection           | Bounded   |
| Stolen Circle credentials        | MVP   | Attacker submits arbitrary wallet transactions                           | Circle credentials; Vault USDC              | Vault accepts only valid exact authorization and enforces hard limits/replay; direct bypass fails                | Attacker can spend other wallet-held assets or cause fees if wallet scope is broader | Dedicated wallet, least-privilege API policy, IP controls, rotation, and alerts     | Bounded   |
| Compromised executor             | MVP   | Executor substitutes fields or repeatedly submits                        | Receipt integrity; Vault USDC               | EIP-712 binds fields; executor cannot create authorization; vault replay state rejects reuse                     | Censorship, delayed submission, and operational disruption remain                    | Attested builds, egress allowlists, dual-channel reconciliation, and failover       | Bounded   |
| Compromised authorization signer | MVP   | Signer grants malicious exact receipts                                   | Authorization signer; Vault USDC            | Immutable per-payment, total-budget, count, recipient, token, time, and revocation limits cap loss               | An in-policy malicious payment can be authorized                                     | HSM policy enforcement, quorum/dual control, rate limits, and real-time alerts      | Bounded   |
| Compromised issuer               | MVP   | Issuer creates or revokes a malicious Covenant                           | Issuer authority; Covenant configuration    | No technical control overrides the legitimate issuer inside its authority                                        | Entire configured budget can be exposed within Covenant terms                        | Multisig governance, separation of duties, delayed activation, and alerts           | Accepted  |
| Malicious approved vendor        | MVP   | Vendor signs an inflated or deceptive invoice to its approved recipient  | Vendor invoice key; Vault USDC              | Amount, budget, count, purpose, expiry, and exact authorization remain enforced                                  | A semantically fraudulent but policy-compliant invoice may be paid                   | Procurement attestations, purchase-order matching, reputation, and dispute controls | Bounded   |
| Forged invoice                   | MVP   | Attacker fabricates vendor fields/signature                              | Invoice integrity; Vault USDC               | Strict schema, vendor signer verification in later MVP flow, domain-separated exact fields, and expiry           | COV-001 defines but does not yet execute signature verification                      | Managed vendor key registry, rotation, revocation, and fraud monitoring             | Prevented |
| Invoice replay                   | MVP   | Valid invoice is reused in another intent                                | Vault USDC; invoice integrity               | Invoice nonce/ID, intent nonce, authorization nonce, expiry, and vault replay state bind one flow                | Parallel pre-authorization evaluation may waste resources                            | Durable idempotency store, reconciliation, and replay alerts                        | Prevented |
| PaymentIntent replay             | MVP   | A signed intent is resubmitted                                           | Intent integrity; Vault USDC                | Intent ID/nonce/expiry plus authorization nonce and authoritative vault replay state                             | Replays can cause repeated offchain work before rejection                            | Distributed idempotency and ingress replay cache                                    | Prevented |
| AuthorizationReceipt replay      | MVP   | Exact authorization is submitted more than once                          | Receipt integrity; Vault USDC               | Contract-owned consumed authorization nonce/hash state rejects the second settlement                             | RPC ambiguity can make clients unsure whether first settlement landed                | Reconciliation, finality tracking, replacement policy, and alerts                   | Prevented |
| Payment field substitution       | MVP   | Executor or transport changes recipient, token, amount, or linked hashes | Vault USDC; signed-object integrity         | Strict parsing and EIP-712 exact-field commitment; vault verifies signed fields                                  | Implementation mismatch before parity tests could create divergence                  | TypeScript/Solidity parity tests, formal vectors, and independent audit             | Prevented |
| Cross-chain replay               | MVP   | Valid signature is submitted on another chain                            | Vault USDC; receipt integrity               | EIP-712 domain includes chain ID; authorization also signs chain ID                                              | Chain-ID misconfiguration could sign the wrong environment                           | Deployment registry, config attestation, and automated environment checks           | Prevented |
| Cross-contract replay            | MVP   | Valid signature is submitted to a different contract                     | Vault USDC; receipt integrity               | Trusted domains derive the verifying contract from CovenantSpec; authorization also signs the same vault address | Misconfigured Covenant deployment data could target the wrong vault                  | Allowlisted deployment registry and signer-side contract-code checks                | Prevented |
| Concurrent overspending          | MVP   | Multiple valid payments race against the same remaining budget           | Vault USDC; Covenant state                  | Atomic contract updates own total spend/count and reject transactions exceeding limits                           | Offchain decisions may approve transactions that later revert                        | Reservation protocol, mempool-aware simulation, and reconciliation                  | Prevented |
| Stale Covenant state             | MVP   | Authority evaluates an outdated budget or revocation view                | Covenant configuration; Vault USDC          | Onchain settlement rechecks authoritative limits and revocation                                                  | Approved receipt may fail, harming availability                                      | Finalized-block reads, freshness thresholds, redundant RPCs, and reservations       | Bounded   |
| Revocation race                  | MVP   | Payment is submitted concurrently with revocation                        | Vault USDC; issuer authority                | Chain ordering is authoritative; a mined revocation blocks later settlement                                      | Payment ordered before revocation can settle                                         | Emergency pause governance, private submission, finality policy, and runbooks       | Bounded   |
| Database tampering               | MVP   | Attacker edits Supabase decisions, budgets, or audit projections         | Audit records; Covenant configuration       | Database is non-authoritative; signatures and chain state are independently verifiable                           | Audit presentation can be hidden or reordered                                        | Append-only signed logs, external anchoring, backups, and access monitoring         | Detected  |
| Frontend manipulation            | MVP   | Browser code falsifies approvals or changes form values                  | Audit records; signed-object integrity      | Browser is untrusted; services reparse and verify signed data; chain is authoritative                            | Users can be phished or shown false status                                           | CSP, signed builds, independent transaction preview, and origin monitoring          | Bounded   |
| Arc RPC failure                  | MVP   | RPC returns errors, stale data, or no response                           | Covenant state; availability                | Fail closed on uncertain state; contract remains authoritative                                                   | Demonstration or authorization can be unavailable                                    | Multiple providers, quorum reads, health checks, and circuit breakers               | Accepted  |
| Circle API timeout               | MVP   | Submission response is lost or delayed                                   | Circle credentials; audit records           | Do not infer failure or retry blindly; use deterministic authorization and chain reconciliation                  | COV-001 has no integration or reconciliation implementation                          | Idempotency keys, status polling, bounded retry, and operator runbook               | Accepted  |
| Duplicate Circle submission      | MVP   | Timeout/retry submits the same transaction twice                         | Vault USDC; receipt integrity               | Vault replay state permits at most one settlement for the authorization                                          | Duplicate attempts can consume operational capacity or fees                          | Circle idempotency, transaction tracking, and reconciliation                        | Prevented |
| Wrong USDC decimal handling      | MVP   | UI or service interprets six decimals incorrectly                        | Vault USDC; configuration                   | Shared strict decimal parser, `bigint` base units, maximum, and test vectors; no money `number`                  | External API adapters may later violate the boundary                                 | Adapter contract tests, token metadata verification, and monitoring                 | Prevented |
| Dependency compromise            | MVP   | Malicious package or build tool alters schemas or execution              | All keys, signed objects, and audit records | Minimal dependencies, lockfile, frozen install, lint/tests/build, and no COV-001 secrets                         | Install-time compromise and maintainer takeover remain                               | Provenance verification, SBOM, review bot, artifact signing, and isolated builds    | Bounded   |
| Denial of service                | MVP   | Flooded proposals, RPC/API outage, or signer exhaustion blocks payment   | Availability; audit records                 | Frozen demo limits blast radius and fails closed; financial integrity remains                                    | Legitimate payment and revocation visibility can be delayed                          | Rate limits, queues, autoscaling, redundant providers, and incident response        | Accepted  |

## Findings

- **MVP:** The strongest guarantee is financial integrity under compromise of any single proposer or submitter, provided signer and vault implementations match the frozen specification.
- **MVP:** Strict parse-before-hash blocks unsigned-field injection, malformed nested rules, invalid domains, and type confusion before any digest is produced.
- **MVP:** Detached signature recovery establishes cryptographic identity without recursively hashing a signature; Covenant-anchored verification separately establishes whether that identity is the configured agent or authorization signer. Invoice recovery still requires later approved-vendor context.
- **MVP:** Pairwise role separation and nonzero EIP-55 validation prevent one configured identity from collapsing proposal and authorization boundaries.
- **MVP:** Complete authorization-chain verification rejects self-signed attacker receipts, unrelated objects, rejected decisions, failed approved rules, wrong domains, mismatched IDs/hashes/policy/deployment fields, and invalid temporal relationships.
- **MVP:** The canonical 11-rule order, signed DecisionReceipt `ruleResultsHash`, Covenant-derived Arc-only domains, bounded numeric parsing, and complete contextual validation close the COV-001 review findings.
- **MVP:** COV-001 does not implement runtime controls; rows referencing later MVP verification or vault enforcement describe required controls, not present readiness.
- **MVP:** A compromised issuer or authorization signer remains powerful; immutable hard limits bound signer loss, while legitimate issuer authority is intentionally accepted.
- **Production:** Real funds require key isolation, reconciliation, RPC redundancy, incident response, supply-chain hardening, and independent audit before launch.
- **Protocol:** Generalized execution and multichain behavior are out of scope and must receive separate threat models.

## COV-016 audit-console controls

- **MVP:** Fixture tampering, schema drift, reordered sequence, changed deterministic identities, unknown properties, and promoted authority claims fail strict server-side parsing before any timeline is rendered.
- **MVP:** The display adapter reconstructs an allowlist instead of forwarding the raw timeline or source bundle. Validation failures expose only fixed unavailable text and cannot leak parser paths, dependency messages, stacks, signatures, receipts, calldata, or credentials.
- **MVP:** A compromised browser can still hide, reorder, or falsify what a viewer sees. This remains bounded because the browser has no signing, submission, execution, settlement, revocation, persistence, or authoritative state capability; independent evidence verification is deferred to Production.
- **MVP:** Ephemeral filter controls alter only local visibility and reset on reload. They cannot mutate canonical evidence or produce a financial action.
- **MVP:** Browser-test supply and egress drift are bounded by explicit local Chromium provisioning, a non-downloading executable preflight, fixed desktop and mobile projects, a fresh loopback-only production server, blocked service workers, and automatic pre-navigation rejection of non-origin requests and all WebSockets.
- **MVP:** Next.js telemetry is disabled cross-platform in the browser-test, production-build, and production-server processes so verification does not create an undeclared remote dependency.
- **MVP:** Ambient-server reuse and platform-dependent Playwright teardown are prevented by a repository runner that refuses an occupied fixed origin, directly owns its local Next.js child, bounds readiness and termination, and verifies that the origin is released after every result.
- **Production:** CSP, authenticated access, signed builds, tamper-evident evidence distribution, independent verification, monitoring, and incident response remain required before operational use.

## COV-020 Arc execution audit-integration controls

**MVP:** COV-020 adds no payment or network authority. Every outcome below is
exactly one of `Prevented`, `Bounded`, `Detected`, or `Accepted`.

<!-- prettier-ignore -->
| Threat | Scope | Attack path | Control | Residual risk | Outcome |
| --- | --- | --- | --- | --- | --- |
| Provider state promoted to Arc success | MVP | A Circle status or observed POST attempt is displayed as successful chain execution. | Provider and Arc observations have separate source events, evidence classes, and claim scopes; reconciliation fixes `providerEvidenceEstablishesArcSuccess: false`. | An external consumer can deliberately erase the labels. | Prevented |
| Provider ambiguity triggers duplicate payment | MVP | Circle `UNKNOWN` causes retry or resubmission. | Source, normalized event, claim boundary, display model, and fixture all fix automatic retry/resubmission to false; the audit and browser own no POST capability. | The payment can remain operationally ambiguous until independent evidence is available. | Prevented |
| Transaction hash promoted to execution | MVP | A matching hash is accepted without verifying the transaction effect. | COV-019 strictly correlates receipt status, target, identifiers, `PaymentExecuted`, ERC-20 `Transfer`, and required vault state before emitting observed success. | The static fixture inherits the reviewed COV-019 observation provenance. | Prevented |
| Malformed or conflicting Arc evidence | MVP | Removed, duplicate, missing, malformed, or mismatched receipt, log, transfer, state, target, or identifier data enters the timeline. | COV-019 emits closed fail-closed results; audit-v2 reparses them, checks exact prepared links and subjects, and recomputes reconciliation semantics. | Deliberate conflicts can deny timeline availability. | Detected |
| Provider and Arc observations conflated | MVP | One event or causal edge obscures which trust domain established a fact. | Three distinct normalized events retain exact source event types; Arc observation is independent and reconciliation references both observations. | A compromised browser can visually misrepresent the validated model. | Bounded |
| Arc execution called settlement or finality | MVP | One successful observed execution is labeled settled, irreversible, or final. | Closed claim scopes and top-level booleans limit the claim to Arc Testnet execution observation; settlement and finality remain false. | Future readers can misuse evidence outside the reviewed UI. | Prevented |
| Fixture tampering | MVP | A changed static file preserves plausible values and recomputes only its projection digest. | Strict event schemas, deterministic event identities, exact sequence and cause checks, semantic provider/Arc/reconciliation checks, and a byte-equality generator test fail tampering closed. | A compromised build can replace both code and fixture; signed distribution is Production scope. | Detected |
| Browser gains financial authority | MVP | Presentation code adds a signer, wallet, Circle client, RPC, server action, persistence, or payment control. | Static server rendering, capability-source scans, no form controls, offline route guards, and reload-reset browser tests bound the surface. | A future dependency or deployment compromise can still alter presentation. | Bounded |
| Historical evidence overgeneralized | MVP | The one COV-018 payment is presented as proof for other payments or continuing chain state. | Exact transaction and identifiers are visible, the fixture is singular and static, and all claims are observational and non-authoritative. | Testnet reorganizations or future state changes are not observed by the offline console. | Accepted |

**MVP:** The fixed sequence remains: AI proposes; Covenant authorizes; Circle
submits; Arc execution is independently verified. No component capable of
generating payment requests possesses authority to execute payments.

**Production:** Live acquisition, provider redundancy, reorganization policy,
signed evidence distribution, monitoring, authenticated access, and incident
response remain deferred.

**V2:** Additional executions, providers, organizations, assets, actors, or
chains require separate threat modeling.

**Protocol:** Generic RPC, arbitrary event ingestion, arbitrary calls, and
generalized payment execution remain excluded.

## COV-003 control realization

- **MVP:** COV-003 realizes the deterministic contextual authority boundary as a pure application core. It has no payment wallet, Circle credential, executor function, transaction builder, broadcaster, or transport endpoint.
- **MVP:** The one trusted Covenant, approved vendor, approved product, clock, evidence reader, identifier generator, repositories, and signer capability are injected. Public callers provide only strict signed request artifacts and cannot select Covenant configuration, receipt fields, identifiers, or authorization nonces.
- **MVP:** The isolated signer returns detached signatures only. Signer-address equality is checked against the trusted Covenant before any signing request, and every assembled receipt is verified through the shared specification. No private key is present in source, fixtures, environment examples, errors, logs, or snapshots; tests generate keys at runtime.
- **MVP:** Schema-valid attacks receive signed rejection evidence, while structurally malformed objects fail before a digest or decision can be safely constructed. Rejected decisions are never cached, preventing invalid-signature or mismatched-Invoice poisoning of a later valid request.
- **MVP:** Approval revalidation occurs before authorization reservation and includes current revocation, Covenant and request expiry, Invoice expiry, remaining budget, payment-count capacity, evidence freshness, and intent replay identities. This prevents a formerly valid approval from authorizing after authoritative conditions change.
- **MVP:** Concurrent approved duplicates share pending decision and authorization operations. Authorization ID and nonce reservations survive signing failure and are never reassigned, while already consumed onchain candidates are skipped before reservation. A retained nonce is rechecked on every retry; if it was subsequently consumed, issuance fails closed without allocating a replacement. Detached signature malleability cannot alter idempotency identity.
- **MVP:** All injected calls use one sanitized dependency boundary. Dependency-specific static errors prevent raw adapter messages, stacks, signatures, or typed data from escaping to individual callers or concurrent joiners.
- **MVP:** Authorization expiry is bounded by the earliest of 300 seconds, intent expiry, Invoice expiry, and Covenant expiry, preventing authorization from outliving the vendor evidence used for the decision.
- **MVP:** In-memory coordination can be lost on process restart and cannot establish authoritative replay or budget truth. The immutable CovenantVault remains the final authoritative enforcement boundary.
- **Production:** Durable distributed idempotency, signer authentication and custody, finalized/quorum RPC evidence, reorganization handling, monitoring, rate limiting, and incident response remain required before real funds.
- **Production:** Durable authorization reservations, restart recovery, finalized vault reconciliation, and operator recovery are required to preserve retained identity-to-nonce bindings across process loss.

## COV-004 control realization

- **MVP:** COV-004 realizes the submission-only executor boundary as a pure application core. It verifies the original signed intent, rules, decision, and authorization against a provider-owned Covenant and constructs only the exact vault payment call.
- **MVP:** Invoice remains authority-only evidence. The executor verifies the signed decision commitment and canonical rules offchain, while vault calldata contains only the PaymentIntent and AuthorizationReceipt payloads with their detached signatures.
- **MVP:** A generated committed Foundry ABI plus deterministic parity verification prevents silent TypeScript/Solidity call-shape drift. Selector, tuple order and widths, decode, and exact re-encoding are tested independently.
- **MVP:** Public callers cannot select a target, chain, token, recipient, amount, ABI, function, calldata, or native value. The transport receives the same immutable internally constructed transaction for simulation and submission and has no policy authority.
- **MVP:** The executor owns no authorization signing key or funded transaction key. COV-004 includes no Circle credential and no live Arc broadcast capability.
- **MVP:** Structured digest identity and pending-operation joining prevent concurrent duplicate transport submissions inside one process. Detached signatures do not affect execution identity.
- **MVP:** A second clock check after simulation prevents knowingly submitting an authorization that expired during simulation. Submission exceptions, timeouts, malformed results, and unsafe post-submit repository failures become retained ambiguity rather than blind retries.
- **MVP:** In-memory completion and ambiguity records are volatile. Process loss can erase coordination evidence, while the vault still rejects replay and remains authoritative for budget, count, revocation, balance, and settlement.
- **Production:** Durable idempotency, restart recovery, status reconciliation, finality policy, managed transaction custody, monitoring, and operator procedures are required before real funds.
- **Protocol:** Generic forwarding, arbitrary calldata, batching, multichain execution, and upgradeable settlement require separate threat models.

## COV-005 agent controls

- **MVP:** COV-005 realizes the untrusted proposal boundary as a pure application core. The public caller supplies only a strict signed Invoice, frozen product ID, and exact expected amount. The one Covenant, approved vendor, product, agent signer, recipient, token, purpose, Arc chain, and vault remain trusted or internally derived.
- **MVP:** Vendor evidence is fail-closed. Strict nested parsing rejects unknown or malformed fields before any dependency access. Canonical signature recovery, approved-vendor equality, exact product and Covenant linkage, exact amount agreement, per-payment limit, and current Invoice and Covenant time are required before reservation.
- **MVP:** Proposal identity uses structured ABI encoding and commits to the Covenant, recomputed Invoice digest, product, purpose, amount, recipient, and token without detached signatures or generated values. Concurrent duplicates join one service-local operation before repository coordination.
- **MVP:** A malicious or faulty coordination repository cannot duplicate the core operation: repeated callbacks return the same promise, and invoke-then-reject or invoke-then-never-settle behavior cannot replace or abandon an already-started operation. Failure before invocation is sanitized and fails closed.
- **MVP:** The explicitly injected in-memory test adapter or durable local adapter atomically retains the exact intent ID, nonce, creation time, expiry, and raw PaymentIntent payload across signer failure. The append-only journal survives restart, verifies every strict versioned record and digest before use, and fails closed on corruption. Retry cannot change retained values. Expired retained and completed proposals are never signed or returned.
- **MVP:** The local lock deliberately permits only one repository process per storage directory. The journal is not authoritative spend, replay, revocation, or settlement state. CovenantVault remains authoritative for financial replay and spend enforcement; the journal only prevents accidental duplicate proposal allocation across local restarts.
- **MVP:** The proposal-only signer address must equal the trusted Covenant agent signer. It receives only exact PaymentIntent typed data and cannot sign an Invoice, decision, authorization, transaction, or arbitrary message through this boundary. Every assembled result is recovered, Covenant-verified, digest-linked, and compared field by field before return.
- **MVP:** Defensive copies and recursive freezing prevent caller mutation from changing retained results, future duplicate responses, either payload, or either signature. Static error serialization prevents dependency-controlled content and sensitive proposal artifacts from escaping.
- **MVP:** The agent proposes. The authority decides. The executor reconstructs. The vault enforces. A compromised agent can disrupt availability or emit rejected proposals but cannot approve, authorize, construct vault calldata, submit, or settle a payment.
- **V2:** Multiple vendors, products, agents, assets, procurement schemas, and pricing models require a new threat-model review.
- **Production:** Distributed coordination, database replication, backup, operational lock recovery, finalized-vault reconciliation, managed proposal-key custody, monitoring, rate limiting, credential rotation, incident response, and high availability remain required before real funds.
- **Protocol:** Generic policy languages, generalized procurement protocols, arbitrary execution, and multichain behavior are outside this threat model.

## COV-006 integration controls

- **MVP:** The repository-level suite imports the built agent, authority,
  executor, and specification packages by package name and proves one coherent
  signed flow without introducing a runtime service.
- **MVP:** The approved authority handoff is test-local and enumerates exactly
  four fields. It cannot accept caller overrides, reconstruct signed payloads,
  or map a rejected decision to execution.
- **MVP:** The deterministic transport records defensive copies, preserves the
  exact chain, target, zero value, and calldata, performs no network operation,
  and returns only a stable opaque simulated-submission identifier.
- **MVP:** An opaque executor `transactionId` is not treated as a transaction
  hash, receipt, Circle execution, vault execution, Arc settlement, or finality
  evidence.
- **MVP:** Isolated compromised-proposer fixtures have only the agent proposal
  signing identity. They demonstrate that unauthorized-recipient and
  excessive-amount requests receive signed rejections without authorization,
  simulation, or submission.
- **MVP:** Ephemeral integration keys, detached signatures, complete calldata,
  typed-data objects, stack traces, and dependency-controlled errors are not
  logged or exposed by integration failures.
- **MVP:** No browser, audit projection, database, RPC, Circle credential, or
  funded wallet participates. CovenantVault remains the final authoritative
  enforcement boundary.
- **MVP:** Real Circle and Arc behavior remains required for the final live
  demonstration but is outside COV-006.
- **V2:** Additional organizations, agents, vendors, products, tokens,
  policies, and chains remain excluded.
- **Production:** Real custody, operational monitoring, reconciliation,
  compliance, incident response, and high availability remain excluded.
- **Protocol:** Generic forwarding, arbitrary calls, upgradeability, and
  multichain behavior remain excluded.

## COV-007 local runtime controls

- **MVP:** Public action injection is prevented by an exact string enum with no
  options object or caller-controlled scenario fields.
- **MVP:** Capability confusion is bounded by private composition: proposal,
  authorization, and transport signers remain separate and no capability object
  crosses the public projection.
- **MVP:** Journal substitution, traversal, links, reparse points where
  detectable, unknown entries, malformed records, sequence manipulation,
  runtime mismatch, and illegal transitions fail closed before use.
- **MVP:** Every demo read and mutation uses a nonblocking operating-system lock
  bound to an open descriptor for the stable ignored repository-root
  `.covenant-demo.lock` sentinel. Mutations retain exclusive ownership through
  final state verification; reads retain shared ownership through replay; an
  exclusive health probe reports `BUSY` or `AVAILABLE`.
- **MVP:** The application never renames, replaces, or deletes the sentinel.
  Process exit or descriptor close releases ownership automatically. No PID
  metadata or stale-lock takeover grants authority. Interrupted state is
  derived only from strict journal replay; `STALE` is a reserved schema value
  that the runtime does not emit.
- **MVP:** A crash after scenario events begin leaves an interrupted projection.
  The lost ephemeral signers make cryptographic resume impossible, so seed and
  run fail until reset.
- **MVP:** Local journal deletion and coherent malicious rewriting remain
  possible because audit state is explicitly non-authoritative and not
  hash-chained.
- **MVP:** Compromised-proposer evidence demonstrates rejection of a malicious
  structured redirect. It models a possible downstream prompt-injection effect
  but includes no LLM and proves no general prompt-injection resistance.
- **MVP:** Simulated transport output is labeled only as simulated submission;
  no Circle, Arc, vault execution, receipt, settlement, confirmation, or finality
  inference is permitted.
- **Production:** Tamper-evident centralized audit storage, managed keys,
  distributed coordination, reconciliation, monitoring, and incident response
  remain required before real funds.

## COV-008 local contract-evidence controls

**MVP:** Child-process substitution and port races are bounded by direct
argument-array spawning with `shell: false`, a fixed executable and argument
set, loopback binding, a bounded internal port sequence, preflight exclusion of
occupied listeners, liveness checks, and an exact `eth_chainId` assertion.

**MVP:** Anvil key disclosure is bounded by silent captured child output,
transaction use through unlocked local accounts, in-process unfunded signing
accounts, sanitized errors, and strict public-result schemas. No child output,
provider error, key, signer, RPC URL, port, PID, address, signature, calldata,
receipt, or raw log enters public evidence.

**MVP:** Wrong-code and wrong-deployment risks are bounded by current Foundry
artifact validation, exact MockUSDC runtime comparison, immutable-aware
CovenantVault runtime comparison, every constructor getter, six-decimal token
verification, initial-state checks, and exact expected transaction targets.

**MVP:** Receipt and event spoofing are bounded by registered transaction
hashes, exact sender/target/value/status checks, exact transaction and block
identity, exact emitter filtering, ABI decoding, required-event cardinality,
balance deltas, accounting, revocation state, and all five replay mappings.

**MVP:** The fixed direct-bypass attempt uses a coherent agent-signed intent
redirected to the attacker but receives no new authorization. The actual vault
must return `InvalidPaymentIntent`, mine a failed receipt, emit no token
transfer, and leave protected state unchanged.

**MVP:** Local Anvil evidence does not mitigate malicious external RPCs,
reorganizations, Arc transaction ambiguity, external funding, or custody
failure because COV-008 performs no external network operation.

**Production:** External RPC quorum, reorganization handling, durable
deployment attestation, managed custody, nonce coordination, reconciliation,
monitoring, and incident response remain deferred.

**V2:** Additional Covenants, actors, products, tokens, policies, and chains
remain deferred.

**Protocol:** Generic execution, arbitrary ABI forwarding, multichain behavior,
generic policies, and upgradeability remain excluded.

## COV-009 Arc readiness controls

**MVP:** Wrong-chain risk is bounded by canonical decimal chain ID `5042002`,
programmatic hexadecimal derivation, explicit rejection of the conflicting
published `0x4CF4B2`, contract enforcement, strict plan anchors, and live
preflight equality.

**MVP:** Wrong-token and decimal-conflation risks are bounded by the fixed
official USDC interface, separate native-RPC `18`, wallet-display `6`, and
ERC-20/business `6` fields, strict constructor binding, and fixed USDC view
calls.

**MVP:** Wrong-bytecode and constructor drift are bounded by exact reviewed
creation/runtime/ABI/semantic-immutable-map commitments, exact Solidity ABI
constructor encoding, separate constructor and init-code hashes, canonical
plan hashing, explicit Prague metadata, and rejection of compiler, optimizer,
metadata, ABI, or EVM-target drift. Raw compiler AST IDs remain diagnostic and
cannot affect artifact identity or cross-checkout reproducibility.

**MVP:** Runtime substitution is bounded by exact code length, every
non-immutable byte including compiler metadata, complete non-overlapping
immutable ranges, exact AST resolution to stable semantic labels, and exact
expected immutable encodings including private inherited EIP-712 state.
Metadata stripping is prohibited.

**MVP:** Accidental broadcast and secret leakage are bounded by exposing only
offline `arc:plan` and read-only `arc:preflight`. Neither command accepts a key,
wallet, endpoint, signer, gas field, calldata, transaction, credential, or
environment override. Outputs and failures are fixed and sanitized.

**MVP:** Malicious-RPC risk remains only partially mitigated. Strict response
parsing detects malformed, inconsistent, wrong-chain, missing-code, and wrong
USDC responses, but a single provider may fabricate a coherent view, censor,
or remain stale. Preflight results therefore make no authenticity, deployment,
execution, or settlement claim.

**MVP:** Expired-plan risk is bounded by exact absolute constructor timestamps
and a frozen seven-day minimum remaining-validity buffer. Timestamps are never
silently derived. COV-010 must revalidate the approved plan immediately before
any explicitly authorized broadcast.

**MVP:** Testnet reset and provider-outage risk remain operational. Arc warns of
testnet instability and publishes no persistence guarantee relied upon here.
COV-010 must fail closed on absent code and preserve historical deployment
records rather than overwrite them.

**Production:** Independent nodes or provider diversity, durable monitoring,
custody, nonce/replacement handling, reconciliation, incident response, and
high availability remain required before real funds.

**V2:** Additional networks, assets, Covenants, actors, providers, or policies
require separately reviewed profiles and threat models.

**Protocol:** Generic RPC quorum, arbitrary calls, CREATE2 policy,
upgradeability, and multichain execution remain excluded.

## COV-014 RunPod provider-transport threat register

**V2:** COV-014 is documentation-only planning for a future narrow provider
quote-source adapter. The evaluated RunPod interfaces do not establish a
cryptographically authenticated immutable quote containing the complete
COV-013 tuple. The final recommendation is: **Do not implement using the
evaluated provider interface.** The agent remains proposal-only, and no
component capable of generating payment requests receives payment execution
authority.

Every outcome below is exactly one of `Prevented`, `Bounded`, `Detected`,
`Accepted`, or `Out of scope`. The network policy, replay state machine,
credential model, error taxonomy, and offline tests are conditional,
non-authorizing planning analysis only.

<!-- prettier-ignore -->
| Threat                                           | Scope      | Attack path                                                                                  | Affected asset or boundary                                             | Proposed control                                                                                                            | Residual risk                                                                                              | Deferred Production control                                                                                  | Outcome      |
| ------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------ |
| Stolen provider credential                       | Production | An attacker obtains the dedicated fetcher's RunPod API key.                                  | Provider account, catalog access, and credential-custody boundary      | Isolate the key to a dedicated fetcher; keep it from browser, agent, authority, executor, Supabase, logs, errors, and files. | Compromise exposes every permission granted to the stolen key until it is disabled or revoked.             | Secret-manager custody, access audit, rotation, disablement, revocation, egress control, and incident response | Bounded      |
| Over-scoped provider credential                  | V2         | A key grants permissions beyond the minimum capability needed for catalog reads.             | Least-privilege and provider-account boundary                          | Do not implement while the exact minimum catalog-read permission is undocumented; treat it as an implementation blocker.   | No reviewed official source establishes the exact catalog permission, so least privilege cannot be proven. | Confirm and test an exact read-only permission before any live credential is approved.                        | Out of scope |
| Malicious provider account                       | V2         | The provider account intentionally supplies deceptive catalog data.                          | Advisory provider-evidence boundary                                    | Keep all provider data advisory and unable to authorize, sign, submit, execute, or settle payment.                          | A trusted fetch cannot determine whether the provider account itself is malicious.                          | Provider-account governance, monitoring, reconciliation, and incident response                                | Accepted     |
| Compromised provider account                     | V2         | An attacker controlling the provider account supplies deceptive catalog data.                | Advisory provider-evidence boundary                                    | Keep all provider data advisory and unable to authorize, sign, submit, execute, or settle payment.                          | A trusted fetch cannot determine whether the provider account has been compromised.                         | Provider-account access monitoring, reconciliation, and incident response                                     | Accepted     |
| Compromised agent runtime                        | V2         | An attacker controls the proposal-producing agent and submits malicious inputs or requests.  | Agent proposal-only boundary and service availability                  | Give the agent no provider credential, wallet, Circle, RPC, signer, authorization, transaction, or execution capability.    | The agent can still emit malicious proposals or exhaust allowed availability.                               | Runtime isolation, abuse monitoring, quotas, and incident response                                            | Bounded      |
| Caller-controlled request fields                 | V2         | A caller attempts to choose the URL, host, path, method, headers, body, product, or timing.   | Fixed provider-request and normalization boundary                      | Fix origin, request fields, transport policy, and normalization in server-owned configuration.                             | A defect in server-owned configuration or validation could still select an unsafe request.                  | Configuration governance, deployment review, and egress-policy enforcement                                    | Prevented    |
| Caller-controlled credential                     | V2         | A caller injects, replaces, or selects a provider credential.                                | Credential-custody and provider-account boundary                       | Accept no public credential input or override; only a dedicated fetcher may receive an injected secret.                    | A compromised secret-injection path could still deliver the wrong credential.                               | Secret-manager policy, workload identity, access audit, and rotation                                          | Prevented    |
| Server-side request forgery                      | Production | An attacker attempts to make the fetcher reach localhost, private, link-local, or metadata.  | Network-egress and internal-service boundary                           | Use one fixed HTTPS origin and path, controlled DNS, disallowed-range checks, and no arbitrary URL or IP literal.           | Correct resolver, connection binding, and infrastructure egress enforcement remain necessary.              | Enforced egress allowlist, resolver controls, network monitoring, and SSRF regression tests                    | Bounded      |
| Alternate IP encoding bypass                     | Production | An attacker uses noncanonical, IPv4-mapped, or alternate address syntax to evade IP checks.  | Network-egress address-validation boundary                             | Reject IP literals, alternate encodings, IPv4-mapped disallowed ranges, and all non-approved resolved addresses.            | Parser or resolver disagreement could still create an address-classification bypass.                        | Canonical address library review, egress firewall enforcement, and adversarial regression tests               | Bounded      |
| DNS rebinding                                    | Production | Approved DNS initially resolves safely and later resolves to a disallowed destination.       | DNS resolution, connection, and TLS-origin boundary                    | Bind controlled resolution to the connection decision and verify the fixed hostname with TLS.                              | Provider DNS changes can still cause availability loss or resolver drift.                                    | Resolver pinning policy, egress enforcement, DNS monitoring, and incident response                             | Bounded      |
| Redirect to an unapproved origin                 | V2         | The approved endpoint returns a redirect to an attacker-selected or otherwise unapproved URL. | Fixed-origin and credential-forwarding boundary                        | Disable redirects and fail every `3xx` response closed.                                                                     | A transport implementation defect could still follow or expose credentials to a redirect target.            | Transport conformance tests and egress monitoring                                                              | Prevented    |
| TLS interception                                 | Production | An attacker or unapproved proxy intercepts the HTTPS connection.                             | Transport confidentiality, integrity, and endpoint-authentication boundary | Require HTTPS, certificate and hostname validation, no insecure mode, and no caller-selected proxy.                     | Security still depends on the configured PKI roots and host infrastructure.                                  | Approved-root governance, proxy controls, certificate monitoring, and incident response                        | Bounded      |
| Certificate validation failure                   | Production | An invalid, expired, mismatched, or untrusted certificate is presented.                      | TLS endpoint-authentication boundary                                   | Fail closed on certificate or hostname validation error and provide no insecure bypass.                                    | Misconfigured trust roots can cause outage or trust an unintended issuer.                                    | Trust-store governance, certificate-expiry monitoring, and operational response                                | Bounded      |
| Response tampering                               | V2         | A response body is altered in transit or by compromised infrastructure.                      | Provider-response integrity boundary                                   | Strictly parse `unknown` input and make no cryptographic provenance claim.                                                  | Schema validation cannot detect a semantically valid forged body; no response signature or MAC is documented. | Provider-signed response protocol with canonical input and verifiable key lifecycle                            | Accepted     |
| Response-origin ambiguity                        | V2         | Valid-looking JSON is attributed to RunPod without provider-verifiable body provenance.      | Provider provenance and independent-verification boundary              | Distinguish API-key client authentication and TLS endpoint authentication from response-body authentication.               | A verifier must trust the endpoint, PKI path, credential custody, and fetcher.                               | Provider-signed quote envelope, key discovery, rotation, revocation, and independent verification              | Accepted     |
| Replay of a valid response                       | V2         | Previously observed provider data is presented again as if it were current.                  | Provider-evidence freshness and replay boundary                         | Introduce no replay design until an authenticated quote identity and provider-issued times exist.                          | The evaluated interface supplies neither authenticated replay identity nor provider quote times.             | Authenticated quote identity, body digest, bounded retention, and recovery rules                               | Out of scope |
| First-writer quote-ID poisoning                  | V2         | An attacker stores forged data first under an unauthenticated quote ID or fingerprint.       | Proposed provider-evidence repository and identity boundary             | Permit no quote replay repository while quote ID and fingerprint remain unauthenticated.                                   | There is no retained quote state to poison, but replay protection is also unavailable.                       | Authenticated immutable quote identity and conflict-detecting repository design                                | Prevented    |
| Duplicate concurrent fetches                     | V2         | Concurrent requests fetch mutable catalog data and receive different responses.              | Concurrency, equality, and advisory-evidence boundary                   | Do not claim idempotency or single-flight identity before source identity is authenticated.                                | Concurrent observations may differ and cannot safely be merged as one quote.                                | Authenticated identity, bounded single-flight, conflict handling, and observability                            | Accepted     |
| Stale quote                                      | V2         | Old provider data is presented after its valid period.                                       | Provider-evidence freshness boundary                                    | Require provider-issued issue and expiry times; fail rather than inventing missing times.                                  | The evaluated interface does not provide authenticated quote times, so it cannot be accepted as a quote.      | Signed freshness fields, clock policy, monitoring, and retention limits                                        | Prevented    |
| Future-dated quote                               | V2         | Provider data claims an issue time later than the trusted evaluation time.                   | Provider-evidence time-ordering boundary                                | Require authenticated provider times and strict issue/expiry ordering; fail closed on invalid timing.                      | Clock skew policy cannot compensate for absent or unauthenticated provider times.                             | Trusted-clock monitoring, bounded skew policy, and signed timestamp verification                               | Prevented    |
| Long-lived quote                                 | V2         | Provider data uses an excessive validity window to retain authority or apparent freshness.   | Provider-evidence expiry and policy boundary                            | Require a bounded authenticated expiry and reject absent or excessive validity rather than inventing a local TTL.          | No authenticated provider expiry exists on the evaluated interface.                                          | Approved maximum validity, signed expiry verification, and stale-data monitoring                               | Prevented    |
| Truncated response body                          | Production | The transport or intermediary supplies only a prefix of the JSON response.                   | Response parser and evidence-completeness boundary                      | Enforce complete JSON parsing, strict schema validation, bounded reads, and fail-closed reconstruction.                    | Repeated truncation can still cause service unavailability.                                                  | Transport telemetry, upstream health monitoring, and incident response                                         | Bounded      |
| Oversized response body                          | Production | A provider or intermediary sends excessive bytes to exhaust memory or parser capacity.       | Fetcher availability and resource boundary                              | Enforce a 64 KiB maximum before unbounded buffering and stop the read at the limit.                                         | Repeated connections can still consume network and process resources.                                        | Infrastructure quotas, concurrency limits, resource monitoring, and abuse response                             | Bounded      |
| Decompression bomb                               | Production | A small compressed body expands into excessive data.                                         | Fetcher availability and parser-resource boundary                       | Require `identity` content encoding and perform no automatic decompression.                                                 | Infrastructure or dependency behavior could ignore the application policy.                                  | Proxy/runtime conformance, resource limits, and regression tests                                               | Bounded      |
| Malformed encoding                               | V2         | A response uses invalid UTF-8 or malformed JSON to exploit parser differences.               | External-input parser boundary                                          | Require strict UTF-8 and JSON handling, parse as `unknown`, and fail closed.                                                | Parser defects or inconsistent dependency behavior remain possible.                                         | Dependency review, fuzzing, patch management, and parser differential tests                                    | Prevented    |
| Duplicate JSON keys                              | V2         | A response repeats a key so different parsers or stages select different values.             | Canonical parsing and field-binding boundary                            | Reject duplicate keys before schema acceptance and reconstruct accepted fields explicitly.                                | Provider schema changes or parser limitations can cause a fail-closed outage.                                | Parser conformance tests, fuzzing, and dependency review                                                       | Prevented    |
| Content-type confusion                           | V2         | Non-JSON content is processed as JSON or interpreted differently across layers.              | HTTP response and parser-selection boundary                             | Require the exact approved JSON media type and reject every other content type.                                             | Incorrect intermediary metadata can produce a fail-closed outage.                                            | Gateway conformance monitoring and content-type regression tests                                               | Prevented    |
| Malicious extra response fields                  | V2         | An attacker adds fields intended to influence downstream behavior outside the reviewed schema. | Strict schema and normalization boundary                               | Reject unknown fields and reconstruct the accepted object field by field.                                                  | Provider schema evolution can cause an outage until separately reviewed.                                     | Schema-change monitoring, fixture review, and controlled compatibility process                                 | Prevented    |
| Timeout ambiguity                                | V2         | A deadline expires without proving whether the upstream processed or completed the request.  | Transport result and evidence-status boundary                           | Use bounded deadlines and cancellation; retain every uncertain result as non-success.                                      | The upstream outcome remains unknown after cancellation or timeout.                                          | Correlation telemetry, reconciliation, and retained ambiguity handling                                         | Bounded      |
| Unsafe retry                                     | V2         | Automatic retry repeats an operation without documented quote-safe idempotency.              | Request semantics, concurrency, and upstream-load boundary              | Make one attempt with no automatic retry or caller-controlled retry timing.                                                 | Callers can submit a later independent request, and provider state may have changed.                         | Authenticated idempotency contract, bounded retry policy, and observability                                     | Bounded      |
| Provider rate limiting                           | V2         | RunPod returns `429` after quota or rate limits are reached.                                  | Provider availability and sanitized-error boundary                      | Map `429` to fixed `RATE_LIMITED`, expose no upstream detail, and perform no blind retry.                                   | The control reports but does not restore provider availability.                                              | Capacity planning, quota monitoring, backpressure, and provider escalation                                     | Detected     |
| Denial of service                                | V2         | An attacker, outage, or provider behavior makes catalog fetches unavailable or exhausts capacity. | Provider/fetcher availability boundary                              | Keep provider data non-authoritative and fail requests closed without granting financial authority.                        | External provider and local service availability can still be denied.                                       | Rate limits, quotas, autoscaling, redundancy, monitoring, and incident response                                | Accepted     |
| Sensitive-data leakage                           | Production | Credentials, headers, bodies, IDs, amounts, URLs, or upstream details escape through output. | Credential, privacy, and public-error boundary                          | Use fixed sanitized codes/messages and prohibit raw secrets or upstream data in public errors.                             | Internal telemetry or dependency behavior can still capture sensitive data.                                 | Structured redaction, telemetry review, access controls, retention policy, and leak response                   | Bounded      |
| Dependency-error leakage                         | Production | A transport or parser error exposes stacks, causes, certificates, proxy details, or messages. | Dependency and public-error boundary                                    | Replace dependency failures with fixed sanitized errors and expose no stack or cause.                                      | Reviewed internal diagnostics may still contain operationally sensitive details.                             | Central error handling, log redaction tests, telemetry access control, and retention policy                    | Bounded      |
| Provider data confused with financial authority | V2         | Advisory catalog data is treated as an Invoice, PaymentIntent, authorization, or payment instruction. | Proposal, authorization, execution, and settlement boundaries     | Give the adapter no signer, wallet, Circle, RPC, transaction, calldata, deployment, authorization, execution, or payment capability. | Provider data can still influence an untrusted proposal, which must be independently authorized.        | End-to-end capability audits and production policy monitoring                                                  | Prevented    |

**V2:** No quote replay repository may be introduced. CovenantVault remains
authoritative for spend, payment count, revocation, authorization replay, and
settlement; any future provider replay state is non-authoritative.

**Production:** Live credential custody, egress controls, durable recovery,
monitoring, reconciliation, and incident response remain deferred.

**Protocol:** Additional providers, chains, currencies, products, and
generalized execution remain excluded.

## COV-015 audit-projection threat register

**MVP:** COV-015 exposes only deterministic sanitized observational evidence.
Every outcome below is exactly one of `Prevented`, `Bounded`, `Detected`,
`Accepted`, or `Out of scope`.

<!-- prettier-ignore -->
| Threat | Scope | Attack path | Control | Residual risk | Outcome |
| --- | --- | --- | --- | --- | --- |
| Forged audit input | MVP | A caller supplies structurally plausible but invented source JSON. | Strict closed schemas, unchanged-formula demo ID checks, global demo ID/body conflict detection, signed-flow cross-links and rule hashes, exact COV-008 shape, and COV-010 anchor/digest verification fail malformed or conflicting input closed. | Demo journal provenance and COV-008 harness provenance remain upstream trust assumptions; `VALIDATED_SIGNED_FLOW` still trusts that its digest identities came from the upstream trusted verification boundary; the projection is never financial authority. | Bounded |
| Event omission | MVP | A caller removes a required predecessor to make a later event appear independent. | Required predecessor lookup and topological causality reject the entire projection. | Independent source families intentionally expose only their own bounded claims. | Prevented |
| Event reordering | MVP | Input arrays, filesystem order, source time, or ingestion order attempt to alter presentation. | Fixed source positions, frozen ranks, normalized IDs, and deterministic topological sorting ignore ingestion and wall-clock order. | A defect in frozen rank review could produce an undesirable but still non-authoritative display order. | Prevented |
| Duplicate identity | MVP | The same evidence is repeated to exaggerate activity. | Identical normalized identity and canonical body collapse deterministically. | Duplicate upstream storage may still consume input-processing capacity within the fixed bundle limit. | Prevented |
| Conflicting identity | MVP | One stable identity is paired with a changed body or semantic outcome. | Demo source ID/body and runtime/sequence conflicts are tracked across wrappers; normalized identity/body, logical predecessor, decision-outcome, and execution/transaction conflicts reject the entire projection; no first writer wins. | Deliberate conflict injection can deny timeline availability. | Detected |
| Simulated evidence presented as execution | MVP | A simulated submission reference is labeled as a chain transaction or successful execution. | Closed mapping permits only simulated transport acceptance/reference stages and contains no descendant execution mapping. | Consumers outside this repository could ignore labels. | Prevented |
| Transport acceptance presented as execution | MVP | Executor `SUBMITTED` is treated as a successful receipt or settlement. | `SUBMITTED` maps only to transport acceptance; transaction, execution, and settlement require distinct evidence sources. | Adapter-specific opaque identifiers may resemble transaction hashes but retain only transport meaning. | Prevented |
| Unsupported executor failure provenance | MVP | A caller fabricates rejection, ambiguity, or generic error audit JSON with a stable execution link the executor did not produce. | The closed executor audit schema accepts only faithfully sourced `PREPARED`, `SIMULATED`, and `SUBMITTED` outputs; unsupported failure shapes fail parsing and cannot create timeline events. | External failure recovery and audit projection remain unavailable until a separately reviewed producer can prove operation and link provenance. | Prevented |
| Local evidence presented as external evidence | MVP | COV-008 Anvil receipts and state are displayed as Circle or Arc settlement. | Every local claim uses `LOCAL_ANVIL_*`; top-level Circle/Arc-payment claims remain false. | Consumers could deliberately remove labels after export. | Prevented |
| Deployment finality presented as payment finality | MVP | COV-010 `FINAL_ARC_TRANSACTION` is generalized from deployment to payment. | The field is paired with `ARC_DEPLOYMENT_TRANSACTION_ONLY`; no payment-finality event exists. | The committed manifest says nothing about current deployment persistence. | Prevented |
| Database authority confusion | MVP | A redirected file or future projection table is treated as spend, replay, revocation, or settlement truth. | Output fixes `authoritative: false` and `databaseFinancialAuthority: false`; the projector writes no database; CovenantVault remains authoritative. | External consumers can misuse observational data despite explicit boundaries. | Bounded |
| Raw evidence or secret leakage | MVP | Signatures, envelopes, calldata, receipts, logs, paths, credentials, or dependency errors enter output. | Strict event-specific schemas and field-by-field reconstruction omit all prohibited artifacts; fixed errors expose no raw values, stacks, paths, or causes. | An opaque identifier could itself be sensitive if an upstream adapter violates its sanitization contract; characters and length are bounded. | Bounded |
| Compromised proposer creates misleading descendants | MVP | A malicious proposal attempts to create authorization, simulation, submission, or settlement events after policy rejection. | Rejected decisions prohibit authorization and downstream demo events; the fixed derived rejection requires exactly one proposal, canonical rules with only `recipient_allowed: FAIL`, exactly one rejected decision, matching identifiers, and no authorization or transport descendants. | The fixed scenario does not prove general prompt-injection resistance. | Prevented |
| Causal cycle | MVP | Conflicting source links attempt to create a cycle or impossible successor graph. | Missing parents and incomplete topological output fail `AUDIT_CAUSALITY_FAILURE` without partial output. | Generic adapters are excluded, so current sources cannot caller-define arbitrary cause edges. | Prevented |
| Projection denial of service | MVP | A caller sends many valid or conflicting records to consume resources or force failure. | Strict bundle and source collection limits, bounded command input, closed parsing, and fail-closed behavior bound local work. | The offline command has no production rate limit and can still consume bounded local resources. | Bounded |

**MVP:** No audit event authorizes or executes a payment. The projector owns no
signer, wallet, Circle credential, RPC, transport, transaction builder,
calldata builder, deployment helper, database client, or command-execution
capability.

**Production:** Durable retention, independent reconciliation, monitoring,
access control, backup, privacy policy, and incident response remain deferred.

**V2:** Additional sources and actors require separate threat modeling.

**Protocol:** Generic ingestion, arbitrary schemas, policy composition, and
arbitrary execution remain excluded.

## COV-017 isolated Circle execution threat register

**MVP:** COV-017 is documentation-only planning. The proposed result for every
threat is exactly one of `Prevented`, `Bounded`, `Detected`, `Accepted`,
`Deferred`, or `Blocked`. No Circle credential, wallet operation, transport,
transaction, Arc RPC call, webhook, database, queue, or executor implementation
exists in this scope.

<!-- prettier-ignore -->
| Threat | Scope | Attack path | Responsible control | Remaining risk | Result |
| --- | --- | --- | --- | --- | --- |
| Circle API-key theft | Production | An attacker obtains bearer authority for the Circle account. | Isolate a least-privilege key to the Circle process; fixed egress and operation; no client, log, fixture, or repository exposure; rotation and access audit. | Official sources do not prove one-wallet/one-operation key scope; compromise may enable every granted Circle capability. | Bounded |
| Entity-secret theft | Production | An attacker obtains the 32-byte wallet-authorization secret. | HSM or secret-manager custody inside a narrow ciphertext capability; no application-object, file, log, fixture, or browser exposure; periodic rotation. | Secret plus API/account access may authorize wallet operations until rotation. | Bounded |
| Recovery-file theft | Production | An attacker obtains reset material and attempts recovery takeover. | Separate recovery custodian and storage from runtime, entity secret, and API key; audited recovery ceremony; never mount in executor. | Circle recovery procedures and organizational access remain future operational dependencies. | Deferred |
| Entity-secret ciphertext reuse | MVP | A retry or cache reuses request-specific ciphertext. | Generate immediately before one request; mark consumed; never persist, log, or retry it; fixture asserts uniqueness. | Provider ambiguity can still require reconciliation without another POST. | Prevented |
| Compromised Circle wallet | MVP | Wallet control submits an unauthorized or conflicting transaction. | One fixed wallet; no generic wallet interface; CovenantVault verifies exact authorization and enforces policy onchain; independent Arc reconciliation. | Native-token loss, denial of service, or transactions to other assets/contracts remain possible if Circle account controls are bypassed. | Bounded |
| Compromised Circle account | Production | An attacker changes wallet, keys, policies, or performs out-of-band operations. | Organizational custody, least privilege, access monitoring, fixed local wallet/target binding, and onchain CovenantVault controls. | Account compromise can deny service or exercise capabilities outside the fixed executor. | Bounded |
| Compromised executor runtime | MVP | Runtime steals credentials or alters provider requests. | Isolated process, fixed config, exact calldata decode/re-encode, no proposer/signer capability, egress allowlist, and CovenantVault enforcement. | A fully compromised runtime can use its Circle capabilities and leak runtime secrets; the vault limits but does not eliminate damage. | Bounded |
| Compromised agent runtime | MVP | Proposal generator attempts to execute or inject Circle fields. | Agent has no Circle credential, wallet, RPC, signer, HTTP transport, transaction, calldata, or execution capability; executor accepts only signed envelopes. | Agent can propose malicious payments or deny availability, but cannot execute them. | Prevented |
| Caller-selected wallet, blockchain, contract, function, calldata, amount, or fee policy | MVP | A caller tries to redirect or mutate execution. | Accept none of these fields publicly; load fixed wallet/chain/vault/selector/fee policy; derive exact calldata and zero value from verified input. | A trusted-configuration or implementation defect could still bind a wrong constant. | Prevented |
| Direct-transfer bypass of CovenantVault | MVP | Caller invokes Circle's transfer endpoint to move tokens directly. | No transfer operation or generic Circle client in the process; exact fixed contract-execution path; egress and request-shape tests. | A compromised Circle account outside Covenant can still use capabilities granted there. | Prevented |
| Signer and Circle executor collusion | MVP | Signer and submitter combine authorization and execution capabilities. | Separate runtimes, credentials, interfaces, and audit identities; signer cannot call Circle and executor cannot sign; vault verifies exact authority. | Collusion of both trusted components can authorize and submit within hard vault limits. | Bounded |
| Proposal generator and Circle executor collusion | MVP | Agent and submitter try to bypass authority. | Executor requires the complete verified signed chain and cannot sign; vault independently verifies authorization and policy-hard limits. | Availability attacks and attempts using already-valid authority remain possible. | Bounded |
| Arbitrary HTTP capability or SSRF | MVP | Caller selects a URL or abuses a generic client. | No public HTTP seam; exact HTTPS origin/path; controlled DNS; reject IP literals and disallowed ranges; infrastructure egress allowlist. | Resolver, proxy, runtime, or infrastructure defects can still violate application controls. | Bounded |
| Redirect abuse | MVP | Circle or an intermediary redirects credentials to another origin. | Disable redirects and fail every `3xx`; maximum redirects zero. | A transport dependency defect could still follow redirects. | Prevented |
| DNS rebinding or private-network/metadata access | Production | Approved name resolves to loopback, private, link-local, IPv4-mapped, or cloud metadata. | Bind controlled resolution to connection; reject disallowed ranges and alternate encodings; hostname-validating TLS; network egress enforcement. | DNS and network infrastructure remain trusted operational dependencies. | Bounded |
| Proxy injection | Production | Environment or caller routes traffic through an unapproved proxy. | Ignore proxy environment; accept no public proxy; fixed direct egress and reviewed infrastructure policy. | Host-level compromise can still redirect traffic. | Bounded |
| TLS validation failure | MVP | Invalid certificate, hostname, protocol, or trust chain is accepted. | Mandatory platform TLS and hostname verification; no insecure mode or caller trust roots; fixed origin. | Trust-store or host compromise remains possible. | Bounded |
| Response truncation or oversized body | MVP | Provider/intermediary sends partial or excessive bytes. | Complete bounded read, 64 KiB hard limit, strict JSON and schema reconstruction, fail closed. | Repeated failures can deny availability. | Bounded |
| Decompression bomb | MVP | Compressed response expands beyond limits. | Request and accept only identity encoding; disable decompression; reject any content encoding. | Dependency or proxy nonconformance remains possible. | Bounded |
| Duplicate JSON keys, malformed encoding, or unexpected content type | MVP | Parser differentials alter accepted values. | Duplicate-key scan before parse; strict UTF-8 without BOM; exact JSON media type; trailing-data rejection. | Parser defects can still exist. | Prevented |
| Undocumented response fields or unknown states | MVP | Provider schema drift influences classification. | Strict unknown-field and enum rejection; field-by-field reconstruction; fixed error mapping. | Circle evolution can cause fail-closed outage until separately reviewed. | Detected |
| Idempotency collision | MVP | Two operations receive the same lookup digest or Circle UUID. | Domain-separated SHA-256 operation key; random UUID-v4; atomic uniqueness constraints; block both on collision. | Cryptographic collision is negligible; storage corruption remains possible. | Detected |
| Idempotency poisoning or first-writer conflict | MVP | Attacker stores a changed body under an existing identity. | Bind complete immutable prepared transaction and digests atomically; compare every reuse; no first-writer authority; quarantine conflicts. | Deliberate conflicts can deny service. | Detected |
| Concurrent duplicate submissions | MVP | Identical callers race two POST requests. | Durable single-flight ownership, atomic attempt-start marker, stable UUID binding, one POST maximum, identical callers join. | Coordination failure must fail closed and may deny availability. | Prevented |
| Unsafe automatic retries | MVP | Timeout, `429`, or `5xx` causes a duplicate POST. | One POST maximum; no retry merely because no response arrived; single-use ciphertext; durable ambiguity. | Provider operation can remain unresolved indefinitely. | Prevented |
| Timeout before submission | MVP | Deadline expires before network I/O but state falsely becomes ambiguous. | Durable phase markers distinguish PREPARED from attempt started; bounded phase deadlines. | Crash exactly around the durable/network boundary requires conservative ambiguity. | Bounded |
| Timeout after possible submission | MVP | Provider may have accepted but response is lost. | Enter `OUTCOME_UNKNOWN`, retain identity durably, never resubmit, reconcile only through authenticated known-ID evidence. | If no provider ID was accepted, safe automated resolution may be impossible. | Bounded |
| Process restart during ambiguity | MVP | Volatile state loss permits another POST. | Block implementation until an atomic durable operation repository preserves attempt and ambiguity across restart. | Durable-store outage or corruption can deny service. | Blocked |
| Status polling ambiguity or failure | MVP | Failed/stale GET is interpreted as transaction failure or permission to resubmit. | Read-only bounded polling; observation-unavailable state; known-ID query only; never authorize POST. | Provider can remain stale or unavailable. | Bounded |
| Transaction-state reordering or stale status | MVP | `CONFIRMED` arrives late, Arc skips it, or an older state overwrites newer evidence. | Retain observations, validate known enum, tolerate omissions/order, never infer missing states or erase independent chain evidence. | Provider state alone cannot fully order chain reality. | Detected |
| Webhook spoofing or replay | MVP | Forged or repeated webhook changes operation state. | No webhook endpoint or consumer in COV-017; future webhook work requires separate authenticity/replay review. | Polling availability remains limited. | Prevented |
| Credential rotation during an in-flight request | MVP | Old secret becomes invalid while outcome is uncertain. | Quiesce new work, atomically rotate, consume no old ciphertext, retain started work as ambiguous, and prohibit resubmission. | In-flight provider state may remain unresolved. | Bounded |
| Circle acceptance represented as Arc execution or settlement | MVP | A `201` or provider state is labeled payment success. | Closed evidence taxonomy and fixed claims; separate provider, Arc, settlement, and finality states; no COV-015 additions. | External consumers can ignore labels. | Prevented |
| Transaction hash represented as successful execution | MVP | Hash observation is treated as successful vault call. | Require independent Arc receipt status, exact target/input, events, state, and token-delta evidence. | Arc evidence design remains a separate accepted issue. | Prevented |
| Settlement represented as finality | MVP | One observed successful effect is treated as irreversible. | Separate `EXTERNAL_SETTLEMENT_OBSERVED` and `PAYMENT_FINALITY_ESTABLISHED`; block finality until chain policy is approved. | Payment-finality policy is unresolved. | Blocked |
| Upstream errors leak secrets | Production | Circle or dependency messages expose headers, secrets, IDs, bodies, paths, or network details. | Fixed public codes, discard raw text/body/header, no stack/cause, structured redaction and leakage fixtures. | Unreviewed internal telemetry or host tooling can still capture sensitive material. | Bounded |
| Offchain operational state becomes financial authority | MVP | Idempotency repository or Circle status approves spend, replay, revocation, or settlement. | Repository records attempts only; vault remains authoritative; no operation state can construct or authorize a new call. | Consumers may misuse non-authoritative records outside the reviewed boundary. | Prevented |
| Circle becomes authoritative for Covenant policy | MVP | Wallet rules or provider status replace vault enforcement. | Circle submits only exact fixed calldata; authority and vault retain signed-policy and onchain enforcement; direct transfer prohibited. | Compromised custody can still attack capabilities outside the vault path. | Prevented |
| Exact Arc settlement observation | MVP | Provider claims are accepted without independent receipt/effect checks. | Require a separately accepted Arc evidence schema and reconciliation issue before settlement claims. | COV-017 intentionally creates no such implementation. | Deferred |

**MVP:** The fixed Circle operation can proceed only after every `Blocked` item
relevant to submission is resolved in a separately accepted implementation
issue. `Deferred` and Production controls cannot be silently claimed as present.

**MVP:** CovenantVault remains authoritative for spend, payment count,
revocation, authorization replay, token movement, and settlement enforcement.
Circle, the idempotency repository, audit projection, browser, and database remain
non-authoritative.

**Production:** Real credentials, recovery, wallet funding, durable coordination,
monitoring, reconciliation, retention, privacy controls, egress enforcement,
incident response, and real-fund operations remain deferred.

**V2:** Additional wallets, Circle products, agents, vendors, assets, chains,
fee policies, or operations require a separate threat model.

**Protocol:** Generic HTTP, arbitrary contract or wallet execution, generalized
transaction construction, arbitrary calldata, and multichain execution remain
excluded.

## COV-027 developer-release review

**V2:** The final internal review covered API authentication and project
isolation, evidence authenticity, execution identity and ambiguity, persistence
and leases, webhook retries, secrets, configuration, request limits, logging,
deployment, SDK packaging, OpenAPI drift, examples, migrations, and CI. No
BLOCKER or HIGH finding requiring a contract, signer, EIP-712, chain, asset, or
authority redesign remains open within developer-release scope.

**V2:** Remaining findings are bounded release limitations: the limiter is
in-process rather than distributed, the durable adapter is SQLite/PostgreSQL-
shaped rather than a managed HA service, and no external security audit has
occurred. These are explicitly Production prerequisites, not hidden claims.
