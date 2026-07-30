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
creation/runtime/ABI/reference-map commitments, exact Solidity ABI constructor
encoding, separate constructor and init-code hashes, canonical plan hashing,
explicit Prague metadata, and rejection of compiler, optimizer, metadata, ABI,
or EVM-target drift.

**MVP:** Runtime substitution is bounded by exact code length, every
non-immutable byte including compiler metadata, complete non-overlapping
immutable ranges, and exact expected immutable encodings. Metadata stripping
is prohibited.

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
