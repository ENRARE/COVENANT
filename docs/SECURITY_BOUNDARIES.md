# Security boundaries

## Trust rules

- **MVP:** The browser is untrusted; it renders projections and submits user intent but never establishes authorization truth.
- **MVP:** The procurement agent is untrusted; it proposes payments and may be fully compromised.
- **MVP:** Vendor content and invoice transport are untrusted until signature and schema validation succeed.
- **MVP:** Supabase is not the authoritative spend ledger; it stores reconstructable projections and audit records only.
- **MVP:** The authority service decides contextual authorization from validated inputs and current authoritative state.
- **MVP:** The isolated authorization signer grants exact, short-lived authority after an approved decision.
- **MVP:** The executor submits signed fields but cannot choose, replace, or mutate payment fields.
- **MVP:** Circle manages wallet execution credentials and submits the vault transaction.
- **MVP:** The Arc `CovenantVault` enforces hard financial limits.
- **MVP:** The Arc `CovenantVault` owns authoritative spend, payment-count, revocation, and replay state.

## Component ownership and prohibitions

| Component                          | Scope | Secrets owned                                               | Permitted action                                 | Prohibited action                                                                |
| ---------------------------------- | ----- | ----------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------- |
| Browser                            | MVP   | User session token only when later implemented              | Display non-authoritative state; request actions | Hold signing or Circle credentials; decide authorization; claim settlement truth |
| Procurement agent                  | MVP   | Agent identity key only when later implemented              | Sign and propose `PaymentIntent`                 | Hold funds, Circle credentials, or authorization key; authorize or execute       |
| Authority service                  | MVP   | Service authentication material only when later implemented | Validate context and produce `DecisionReceipt`   | Custody funds; submit payments; treat database budget as authoritative           |
| Authorization signer               | MVP   | Authorization signing key only when later implemented       | Sign exact approved `AuthorizationReceipt`       | Generate intents; change decisions; execute payments                             |
| Executor                           | MVP   | Circle API credentials only when later implemented          | Submit an exact authorized transaction           | Alter signed fields; authorize; hold authorization key                           |
| Circle developer-controlled wallet | MVP   | Wallet execution keys managed by Circle                     | Submit the specified vault call                  | Select recipient, token, or amount independently                                 |
| Arc `CovenantVault`                | MVP   | No offchain secret                                          | Enforce hard limits and authoritative state      | Make contextual policy decisions; support arbitrary calls or upgrades            |
| Supabase                           | MVP   | Database service credentials only when later implemented    | Store UI/audit projections                       | Act as authoritative spend/replay ledger or source of authorization truth        |
| GPU vendor                         | MVP   | Vendor invoice signing key                                  | Sign a specific invoice                          | Authorize payment, change Covenant policy, or execute from the vault             |

## Data-boundary rules

- **MVP:** All objects crossing a process or hash boundary are `unknown` and must pass a strict schema before use. Builders construct messages explicitly from parsed fields; unsigned extras fail before hashing.
- **MVP:** PaymentIntent, Invoice, DecisionReceipt, and AuthorizationReceipt use exact detached `{ payload, signature }` envelopes. Signatures are 65-byte hex and are excluded from their own payload digest.
- **MVP:** Money input is a bounded decimal string and becomes `bigint` base units internally; canonical output is the shortest decimal representation.
- **MVP:** Lowercase addresses normalize to EIP-55. Correct checksums are accepted; incorrect mixed-case checksums and zero security addresses fail closed.
- **MVP:** Issuer, agent, authorization signer, GPU recipient, vault, and token follow the separation rules in ADR 0002.
- **MVP:** Arc Testnet `5042002` is the only accepted chain. Protocol multichain types do not cross the public MVP boundary.
- **MVP:** EIP-712 binds object version, chain, verifying contract, and every security-critical field.
- **MVP:** DecisionReceipt is signed and commits to the exact canonical 11-rule collection hash; order is validated and never silently sorted.
- **MVP:** Signature recovery proves who signed but does not grant authority from a payload signer field. Trusted verification anchors agent and authorization signer identities to `CovenantSpec`.
- **MVP:** PaymentIntent, DecisionReceipt, and AuthorizationReceipt trusted domains are derived from the Covenant vault, frozen Arc chain, frozen version, and object-family name.
- **MVP:** Complete authorization-chain verification recomputes the intent and rule hashes; links Covenant, intent, decision, authorization, policy, vault, chain, and signer roles; requires an approved all-PASS decision; and enforces every validity relationship.
- **MVP:** The executor must compare the submitted call with signed authorization fields byte-for-byte.
- **MVP:** The vault supports only its immutable standard Arc Testnet USDC-style token and requires exact destination balance deltas for funding, payment, and withdrawal. Fee-on-transfer, rebasing, success-without-transfer, and malicious token behavior are unsupported; mismatched observable deltas revert settlement and replay/accounting writes.
- **MVP:** Runtime Solidity EIP-712 parity is limited to PaymentIntent and AuthorizationReceipt. CovenantSpec, Invoice, and DecisionReceipt are not runtime vault types.
- **MVP:** Every `AuthorizationReceipt` commits to a nonzero `decisionId` identifying its contextual offchain `DecisionReceipt`. The trusted authorization-chain verifier validates that receipt and its cross-object linkage. The vault validates only the nonzero signed identifier and does not perform onchain `DecisionReceipt` verification.

## COV-003 authority application boundary

**MVP:** The authority application is a pure application core with no transport and no execution capability. It loads the one Covenant only through an injected trusted provider, strictly parses that value on every operation, derives all signing domains from it, and recomputes every PaymentIntent, Invoice, RuleResult, DecisionReceipt, and AuthorizationReceipt digest internally.

**MVP:** The application coordinates an isolated signer through an injected public-address-bearing port. Separate methods sign exact DecisionReceipt and AuthorizationReceipt typed data and return detached signatures only. The application constructs each payload, validates the detached signature, assembles the envelope, and verifies it through `@covenant/spec`. It never owns, loads, derives, persists, logs, or exposes the authorization private key.

**MVP:** The configured vendor boundary contains exactly one approved vendor signer and the `gpu-h100-hour` product. `invoice_signature_valid` requires canonical recovery plus equality of both recovered signer and `Invoice.vendor` with that configuration. `invoice_matches_intent` commits the recomputed Invoice digest, recipient, token, amount, and approved product. Both intent and Invoice purpose are enforced by `purpose_allowed`.

**MVP:** All 11 canonical rules execute in frozen order without early exit. `covenant_active` includes matching evidence deployment, revocation, time, payment-count capacity, and evidence no older than 30 seconds. `amount_within_limit` includes per-payment and authoritative remaining-budget checks. `nonce_unused` includes the intent digest, intent identifier, and agent nonce.

**MVP:** Structurally malformed public input receives no receipt. Every schema-valid rejection receives a signed DecisionReceipt, but only approved decisions are idempotent. Approved decision identity uses Covenant ID plus exact intent and Invoice digests. Authorization identity additionally uses the signed decision identifier and digest. Detached signatures never participate in either identity.

**MVP:** Authorization issuance independently revalidates the original signed PaymentIntent, signed Invoice, canonical RuleResults, signed DecisionReceipt, all exact linkages, current request validity, and newly read authoritative evidence before reserving an ID or nonce. Authorization expires at the earliest of 300 seconds, PaymentIntent expiry, Invoice expiry, or Covenant expiry.

**MVP:** In-memory decision, authorization, and nonce repositories coordinate issuance only. Concurrent duplicates share pending operations; authorization reservations survive signer failure and are never reassigned. A retry rechecks the retained nonce and fails closed with `AUTHORIZATION_NONCE_CONSUMED` if the vault reports it consumed, without advancing to a replacement. The repositories are not authoritative accounting or replay state. CovenantVault remains authoritative for spend, payment count, revocation, intent replay, authorization replay, and settlement.

**MVP:** Every injected call crosses a common sanitizing boundary. Stable dependency-specific codes and static messages replace raw exceptions for providers, clocks, evidence, signer access and signing, identifiers, and repositories, including concurrent callers joined to the same rejected operation.

**MVP:** COV-003 contains no Circle credential, executor behavior, vault transaction construction, transaction broadcasting, HTTP endpoint, webhook, queue, worker, Supabase integration, agent behavior, live vendor API, or product UI.

## COV-004 executor application boundary

**MVP:** The executor is a pure application core that accepts only the signed PaymentIntent, canonical RuleResults, signed DecisionReceipt, and signed AuthorizationReceipt. Invoice remains authority-only evidence; DecisionReceipt and RuleResults are verified offchain and are not vault calldata.

**MVP:** The executor loads and strictly parses the single Covenant through an injected trusted provider, passes original raw signed values to `@covenant/spec` complete-chain verification, and uses the verified parsed result to construct only `CovenantVault.executePayment`. Callers cannot supply deployment data, hashes, an ABI, a function, calldata, or native value.

**MVP:** The full committed vault ABI is generated from Foundry output at the contracts boundary and checked for deterministic parity. The executor selects only `executePayment`, verifies selector `0x7ee0e4da`, independently decodes and re-encodes produced calldata, targets the trusted Arc Testnet vault, and fixes native value at zero.

**MVP:** The executor owns no authorization key or funded transaction key. Its injected transport receives one immutable scalar transaction request for simulation and submission, owns no policy authority, and is not exposed as a generic forwarder.

**MVP:** Current time is checked during preparation and again after successful simulation immediately before submission. Concurrent duplicates join pending work; successful duplicates return the stored result. Post-submit exceptions, timeouts, malformed results, ambiguity, and unsafe repository failures retain instance-local ambiguity and block resubmission.

**MVP:** In-memory coordination is volatile and non-authoritative. CovenantVault remains authoritative for replay, budget, payment count, revocation, token balance, and settlement.

**MVP:** COV-004 adds no Circle API or credential, live broadcasting, funded key, deployment, HTTP endpoint, queue, worker, webhook, Supabase integration, UI, agent behavior, arbitrary calldata, generic forwarding, additional chain, or additional Covenant.

## COV-017 isolated Circle execution and evidence boundary

**MVP:** COV-017 is planning only. The current executor remains unchanged: it
verifies the existing signed chain, constructs and exactly rechecks only
`CovenantVault.executePayment`, and uses a simulated transport. It owns no Circle
credential, entity secret, recovery file, wallet capability, funded transaction
key, live transport, RPC, poller, webhook, database, or queue.

**MVP:** The invariant remains exact: **No component capable of generating
payment requests shall possess authority to execute payments.** The agent stays
proposal-only; the authority and authorization signer receive no Circle
submission capability; and a future Circle executor can neither propose nor
authorize. The browser and web server receive no mutation, credential, wallet,
or transport capability.

**MVP:** A future Circle boundary may hold only one server-side API key, an
isolated entity-secret ciphertext capability, one fixed Developer-Controlled
Wallets wallet UUID, fixed HTTPS access to `https://api.circle.com`, and narrowly
bounded non-authoritative idempotency state. The recovery file is separately
custodied and never mounted into the runtime. Credentials and wallet identifiers
cannot reach callers, other services, repository files, fixtures, logs, or
errors. Local development and CI use no real credentials.

**MVP:** The immutable-field and fixed-contract boundaries bind one Arc chain,
wallet, CovenantVault, exact `executePayment` selector, zero native value, and
internally constructed calldata to the already-verified PaymentIntent and
AuthorizationReceipt. Public callers cannot select wallet, chain, contract,
function, ABI, calldata, amount, fee policy, URL, method, credential,
idempotency identity, or evidence classification. Direct Circle transfer is
forbidden because it would bypass CovenantVault.

**MVP:** The network boundary uses exact HTTPS origin and path, zero redirects,
controlled DNS and egress, mandatory TLS validation, bounded phase and total
deadlines, a 64 KiB response limit, strict JSON/UTF-8/content-encoding rules, and
fixed sanitized failures. It exposes no generic HTTP or arbitrary URL-fetch
capability.

**MVP:** The existing executor `executionId` remains the canonical operation
identity and is bound internally to one random Circle UUID-v4. Identical
concurrent work joins and conflicts fail closed. Operational state cannot
authorize spend. Once submission may have started, timeout, cancellation,
malformed response, or transport failure becomes durable ambiguity and never an
automatic POST retry.

**MVP:** Preparation, Circle attempt, Circle acceptance or rejection, ambiguous
outcome, provider state, Circle transaction ID, Arc transaction hash, Arc
execution, external settlement, and payment finality remain distinct evidence
claims. Circle acceptance is not Arc execution; a transaction hash is not
successful execution; settlement is not finality. No new COV-015 event exists
without a separately accepted audit-schema issue.

**MVP:** CovenantVault remains authoritative for spend, payment count,
revocation, authorization replay, token movement, and settlement enforcement.
Circle status, wallet status, the idempotency repository, audit projections,
browser state, and databases remain non-authoritative. Logs use only fixed
sanitized codes and omit credentials, provider bodies, signed envelopes,
signatures, calldata, network details, stacks, and causes.

**MVP:** COV-017 excludes source and schema changes, SDK installation, real
credentials, wallet operations or funding, HTTP, RPC, broadcast, polling,
webhooks, databases, queues, audit events, execution, and deployment. Future
Circle implementation remains separately gated by Proposed ADR 0020.

**Production:** Secret custody and recovery, rotation, durable coordination,
egress enforcement, monitoring, reconciliation, retention, incident response,
and real-fund operation remain deferred.

**V2:** Additional wallets, Circle operations, assets, actors, chains, or fee
policies require separately accepted scope.

**Protocol:** Generic HTTP, arbitrary wallet or smart-contract execution,
arbitrary calldata, generic transaction building, and multichain behavior remain
excluded.

## COV-005 procurement agent application boundary

**MVP:** The agent is a pure proposal-only application core. It accepts only a strict signed Invoice plus `gpu-h100-hour` and an exact expected USDC amount, and returns only the signed PaymentIntent plus a defensive copy of that verified raw Invoice.

**MVP:** Public callers cannot select the Covenant, approved vendor, approved product, purpose, recipient, token, vault, chain, domain, hash, signer address, intent identifier, nonce, or timestamps. The one trusted Covenant is provider-owned; all fields are strictly parsed and all domains and digests are derived internally.

**MVP:** Both the recovered Invoice signer and `Invoice.vendor` must equal the one approved vendor. Product, recipient, token, purpose, and amount must match the frozen configuration, trusted Covenant, and exact procurement request. Invoice and Covenant time windows and the per-payment maximum are checked before reservation.

**MVP:** The agent signer port exposes only its address and exact PaymentIntent typed-data signing. It has no generic signing, Invoice signing, authorization signing, wallet, funded account, Circle, RPC, calldata, transaction, or executor capability. Every returned PaymentIntent is verified through `@covenant/spec` and compared field by field with the retained payload.

**MVP:** Structured proposal identity excludes detached signatures and generated values. Service-local single-flight owns concurrency safety even when an injected coordinator invokes then rejects or never settles. The caller explicitly injects either the in-memory test repository or the local durable repository. One atomic reservation retains the exact intent ID, nonce, and raw canonical payload across signer failure.

**MVP:** The local demonstration may use a fixed-version append-only proposal journal. Flushed records preserve reservations and completed results across restart, and an exclusive local lock deliberately permits only one repository process per storage directory. Completed results are returned only after full Invoice and PaymentIntent evidence revalidation.

**MVP:** A retained or completed proposal is checked against a fresh clock before use. Expired retained proposals permanently fail for that identity, completed expired proposals are not returned, and a new Invoice payload digest creates a new identity.

**MVP:** Results are copied field by field and frozen. Fixed `AgentError` serialization exposes only name, code, and message; raw dependency output, exceptions, typed data, signatures, Invoice or PaymentIntent contents, URLs, secrets, and repository state are suppressed.

**MVP:** The agent proposes. The authority decides. The executor reconstructs. The vault enforces. The local journal is non-authoritative and cannot approve, execute, or establish spend, replay, revocation, or settlement truth. CovenantVault remains authoritative for financial replay and spend enforcement; the journal only prevents accidental duplicate proposal allocation across local restarts.

**V2:** Multiple vendors, products, agents, assets, procurement schemas, and pricing models are excluded.

**Production:** Distributed coordination, database replication, backup, operational lock recovery, finalized-vault reconciliation, managed proposal-signing custody, monitoring, rate limits, incident response, credential rotation, and high availability are deferred.

**Protocol:** Generic policy languages, generalized procurement protocols, arbitrary execution, and multichain behavior require separate specification.

## COV-006 cross-service integration boundary

**MVP:** COV-006 exercises the built agent, authority, executor, and
specification package exports in one deterministic repository-level suite. It
does not import application source files through relative paths or aliases.

**MVP:** The agent's exact `{ signedPaymentIntent, signedInvoice }` result is
accepted unchanged by the authority. The authority result is not itself an
executor request. A test-local mapper rejects non-approved results and
enumerates exactly the agent `signedPaymentIntent` plus the authority
`ruleResults`, `decisionReceipt`, and `authorizationReceipt`. It accepts no
chain, target, value, function, ABI, calldata, or signed-field override.

**MVP:** The deterministic transport receives defensive copies of the same
internally constructed transaction for simulation and submission. It performs
no network access, selects no field, and returns only an opaque simulated
submission identifier. That identifier is not a transaction hash, receipt,
settlement, or finality claim.

**MVP:** Malicious-proposer fixtures exist only inside the integration suite.
They use the ephemeral agent proposal identity but receive no authorization
signer, transaction transport, execution credential, or generic production
agent method. Unauthorized-recipient and excessive-amount requests are rejected
before transport.

**MVP:** COV-006 creates no audit event schema and no authoritative offchain
state. CovenantVault remains authoritative for spend, replay, payment count,
revocation, token movement, and settlement.

**MVP:** Real Circle and Arc behavior remains required for the final live
demonstration but is outside COV-006.

## Deferred controls

- **Production:** Hardware-backed keys, dual control, credential rotation, network isolation, tamper-evident centralized audit storage, and incident response are deferred.
- **Production:** Continuous Circle/onchain reconciliation, redundant Arc RPCs, and formal recovery procedures are deferred.

## COV-016 audit-console boundary

**MVP:** The web console displays exactly one committed deterministic COV-015 fixture. A server-only adapter strictly parses the import as `unknown`, reconstructs allowlisted fields, and deeply freezes the display model before it crosses into the untrusted browser.

**MVP:** Validation is all-or-nothing. Invalid schema, identity, sequence, classification, or claim-boundary data produces only fixed sanitized unavailable content. No partial evidence, raw error, path, stack, digest detail, source bundle, signature, receipt, calldata, or credential is rendered.

**MVP:** Browser controls only filter the received model in memory and reset on reload. The console has no API route, server action, persistence, RPC, Circle, Supabase, signing, wallet, payment, revocation, or execution capability. It cannot establish authorization, Circle execution, Arc payment settlement, payment finality, or authoritative spend state.

**MVP:** Browser verification uses a repository-owned runner rather than Playwright's platform-dependent `webServer` lifecycle. The runner refuses an occupied `http://127.0.0.1:3100` origin, directly builds and owns the local production Next.js child, waits for the exact root response, always stops only that child, and verifies origin release. Telemetry is disabled in build, server, and test processes.

**MVP:** An automatic pre-navigation route guard permits only the exact `http://127.0.0.1:3100` HTTP origin, blocks service workers, aborts every other request, rejects every WebSocket, and fails the responsible test.

**MVP:** The lockfile-pinned local Playwright CLI provisions Chromium only through the explicit `pnpm e2e:install-browser` command. Normal verification performs a non-mutating executable preflight and never installs a browser, uses an ambient browser, or requires internet access after provisioning.

## COV-008 local contract-evidence boundary

**MVP:** `tests/contract-evidence` starts one controlled loopback-only Anvil
child with chain ID `5042002`. It selects ports from a bounded internal list,
does not connect to an occupied candidate, captures rather than forwards child
output, validates the child through JSON-RPC, and terminates only the child it
started.

**MVP:** Deployer, issuer, transaction payer, attacker transaction sender,
agent proposal signer, authorization signer, vendor signer, and recipient are
distinct. Unlocked Anvil accounts provide transaction-only roles without
extracting keys. Proposal, authorization, and vendor signers are generated
in-process, unfunded, never persisted, and never passed to a transaction
transport.

**MVP:** The agent receives only its exact PaymentIntent signer. The authority
receives only its exact receipt signer and a live read-only vault evidence
adapter. The payer transport receives only the exact executor request or fixed
contract-evidence request. No proposal-producing component receives deployment,
issuer, authorization, payer, RPC, or generic wallet authority.

**MVP:** The executor transport performs actual local `eth_call` and returns
only an opaque transaction hash after submission. The separate harness-local
receipt reader accepts only registered hashes with fixed sender, target,
zero-value, and status expectations. It verifies local receipts and filters
decoded events by the exact vault or token emitter.

**MVP:** Expected rejections require both decoded contract revert data from the
exact pre-transaction state and a mined failed receipt produced with a fixed gas
limit. Protected balances, accounting, revocation, and replay mappings must
remain unchanged.

**MVP:** Public evidence is a strict sanitized local result. It excludes keys,
signer identities, addresses, RPC details, process details, signatures, signed
objects, typed data, calldata, receipts, raw logs, provider errors, paths, and
environment values.

**Production:** External RPC diversity, durable deployment state, transaction
reconciliation, managed custody, monitoring, incident response, and high
availability remain deferred.

**V2:** Additional Covenants, actors, products, tokens, policies, and chains
remain deferred.

**Protocol:** Generic ABI forwarding, arbitrary calls, generic policies,
multichain execution, and upgradeability remain excluded.

## COV-009 Arc readiness boundary

**MVP:** The Arc Testnet operational profile is trusted committed server-side
configuration. Browser, CLI input, environment variables, and public callers
cannot select or replace its RPC, chain, token, explorer, EVM targets, ABI, or
finality policy. Provider injection exists only at the test seam.

**MVP:** The security-profile digest commits to operational fields but excludes
official-source URLs and verification dates. Rechecking provenance therefore
does not silently change an approved deployment commitment. Changing an
endpoint, chain, token, EVM target, or finality field does change the digest and
requires review.

**MVP:** `arc:plan` is offline and read-only. It accepts only `--input` with a
bounded strict UTF-8 regular file, rejects links, unknown fields, secret-like
material, wrong anchors, invalid roles, placeholders, and inadequate validity,
and writes no deployment plan. Deployer and payer are plan metadata, not vault
constructor fields. Vendor identity is absent from both.

**MVP:** `arc:preflight` uses only `eth_chainId`,
`eth_getBlockByNumber("latest", false)`, `eth_getCode` for the fixed USDC
interface, and fixed `eth_call` views for `decimals`, `symbol`, and `name`.
Requests are sequential with bounded timeouts and no retry. Output excludes the
endpoint, raw responses, code, headers, environment, paths, and provider
errors.

**MVP:** One primary-RPC observation proves only connectivity and internally
consistent reported state. It cannot independently prove chain authenticity,
deployed code, receipt truth, balances, execution, or settlement. COV-010 must
define and satisfy independent provider corroboration before making a verified
deployment claim.

**MVP:** COV-009 contains no wallet, signer, account enumeration, faucet,
funding, transaction construction, deployment, manifest persistence, Circle
API, or broadcast authority. COV-010 owns explicitly authorized deployment and
manifest creation. COV-011 separately owns approval, funding, execution,
revocation, and corresponding evidence.

**Production:** Managed RPC credentials, self-operated nodes, quorum policy,
custody, KMS/HSM, nonce operations, monitoring, durable reconciliation,
incident response, and high availability remain deferred.

**Protocol:** Generic RPC routing, arbitrary provider URLs, generic ABI
forwarding, multichain profiles, CREATE2 policy, and upgradeability remain
excluded.

- **Production:** Replicated proposal persistence, operational lock recovery, backup, and restart reconciliation must preserve identity-to-nonce bindings and reconcile them against finalized vault state.
- **Production:** No external audit or formal verification has occurred; both remain required before production use.
- **Protocol:** Cross-chain and generalized policy boundaries require new specifications and are not inherited from the MVP.

## COV-007 local demo boundary

**MVP:** The demo is a private server-only orchestrator with exactly five fixed
actions and one `LOCAL_SIMULATED` mode. It accepts no caller-controlled payment,
signer, network, transaction, target, ABI, function, calldata, path, or shell
value.

**MVP:** One run creates pairwise-distinct ephemeral role accounts. The agent
receives only its proposal signer, authority receives only its receipt signer,
and executor receives only the deterministic simulated transport. Signers are
not persisted, projected, logged, or exported.

**MVP:** The local audit journal is a strict sanitized non-authoritative
projection. It stores no signatures, signed bodies, typed data, calldata, keys,
credentials, raw responses, paths, or dependency-controlled errors and cannot
authorize, execute, revoke, or establish settlement truth.

**MVP:** Runtime state access is confined to `.covenant-demo-state` and the
stable ignored repository-root `.covenant-demo.lock` coordination sentinel.
No-follow metadata checks reject links, non-regular entries, and unknown names.
Every mutation holds an exclusive operating-system descriptor lock through
final state verification; every state read holds a shared descriptor lock
through replay; health uses an exclusive probe.

**MVP:** The application never renames, replaces, or deletes the sentinel.
Descriptor close or process exit releases ownership automatically. There is no
PID ownership or stale-lock stealing; interrupted state is journal-derived.
`STALE` remains reserved for projection-schema compatibility and is not emitted.
This mutex coordinates only local-machine processes; distributed coordination
remains Production scope.

**MVP:** A simulated submission reference proves only local transport
acceptance. Circle execution, Arc transactions, vault execution, receipts,
settlement, and finality remain unclaimed.

## COV-014 RunPod provider-transport boundary

**V2:** COV-014 is documentation-only planning. The evaluated RunPod
interfaces are not approved for implementation because no reviewed official
RunPod documentation establishes a cryptographically authenticated immutable
quote containing the complete COV-013 tuple. The exact recommendation is:
**Do not implement using the evaluated provider interface.**

**V2:** The proposed future component is a narrow quote-source adapter only.
It may fetch and normalize advisory provider data after a separately accepted
issue, but it may not propose, authorize, sign, submit, execute, or settle a
payment. The browser, agent, authority signer, executor, Supabase, and public
callers receive no generic HTTP client or arbitrary URL-fetch capability.

### Trust and capability boundary

**V2:** Public callers cannot select or override the provider, scheme, host,
port, path, query, redirect target, method, headers, credentials, product, GPU
model, quantity, duration, currency, timeout, retry, proxy, DNS, TLS,
response-size policy, normalization rules, or replay namespace. These values
would be fixed by server-owned configuration only in a separately authorized
future review.

**V2:** The future adapter receives no agent signing key, vendor invoice key,
authorization signing key, wallet, funded account, Circle credential, RPC,
transaction builder, calldata builder, executor capability, deployment
capability, or payment capability. It must not construct Invoice,
PaymentIntent, authorization, transaction, or settlement artifacts.

**V2:** The agent remains proposal-only. RunPod data is evidence/advisory
input, never authority. Supabase or another offchain store cannot become
authoritative for Covenant spend, payment count, revocation, financial replay,
authorization replay, or settlement. CovenantVault remains authoritative.

### Authentication and data boundary

**V2:** API-key client authentication means only that RunPod accepted a key for
the request subject to its permissions. TLS endpoint authentication means
that successful certificate and hostname validation authenticates the
configured HTTPS endpoint through the configured PKI trust path. Neither claim
is response-body authentication.

**V2:** No reviewed official RunPod documentation describes a signature, MAC,
signed webhook envelope, canonical signed input, verification-key discovery,
or equivalent response-body control for the evaluated catalog/pricing
responses. Immutable quote authenticity and independent verifiability are
therefore not established. COV-013's `runpod` namespace and local fingerprint
prove neither provider provenance nor authentication.

**V2:** All future external response data enters as `unknown`, is strictly
parsed, rejects duplicate keys and unknown fields where feasible, and is
reconstructed field by field. Exact JSON content type, bounded size, safe
numeric/timestamp representations, canonical USDC handling, and maximum
lengths/collections must be fixed before implementation. The adapter performs
no USD/USDC conversion, FX lookup, quantity or duration pricing, taxes, fees,
or rounding.

RunPod catalog pricing cannot directly populate COV-013: it lacks a documented
immutable quote ID, issue/expiry timestamps, exact quantity/duration binding,
explicit USDC currency, and exact total amount. Supplying these fields would
require invention or prohibited pricing derivation/conversion.

### Credential custody and network policy

**V2:** RunPod documents `Restricted` and `Read Only` API-key choices but does
not establish the exact minimum catalog-read permission. This is a blocker;
no real key may be created, requested, read, stored, or used by COV-014.
Future credentials, if separately approved, belong only to a dedicated
fetcher process injected by a secret manager. They cannot reach browser code,
public input, logs, errors, fixtures, snapshots, committed files, the agent,
authority signer, executor, or Supabase. Production rotation, revocation,
secret management, egress control, and incident response are **Production**
requirements.

**V2:** The conditional, non-authorizing network policy is
HTTPS-only to `https://api.runpod.io`, port `443`, fixed `GET` catalog path,
redirects disabled, no caller-selected proxy, controlled DNS with rejection
of loopback/private/link-local/multicast/metadata/alternate encodings, TLS
verification enabled, connect/header/body/total deadlines of 3/5/5/10
seconds, 64 KiB maximum response, `application/json` with identity encoding,
and one attempt with no automatic retry. `429` maps to a fixed sanitized
rate-limit error. These values are planning analysis only and authorize no
network implementation. Operational enforcement is **Production** scope.

### Replay, errors, and tests

**V2:** No authenticated replay identity currently exists and no quote replay
repository may be introduced. A local fingerprint or unauthenticated quote ID
cannot prevent first-writer poisoning. Only after source authenticity exists
could a separately approved design consider an authenticated
provider-account/endpoint/immutable-quote identity and body digest. Any such
state would be non-authoritative and subordinate to CovenantVault.

**V2:** The conditional sanitized error taxonomy is fixed to:
`INVALID_PROVIDER_RESPONSE`, `SOURCE_AUTHENTICATION_FAILURE`, `STALE_EVIDENCE`,
`UNSUPPORTED_PRODUCT_OR_CURRENCY`, `RATE_LIMITED`, `TIMEOUT`,
`PROVIDER_REJECTED`, `TRANSPORT_FAILURE`, `CONFIGURATION_FAILURE`,
`REPLAY_CONFLICT`, and `RETAINED_AMBIGUITY`, each with a static message and no
raw upstream body, credential, header, URL, ID, amount, stack, cause, or
dependency detail. This taxonomy is planning analysis only.

**V2:** The conditional offline test plan uses fake transport and deterministic
fixtures only, with no live network, API key, provider SDK, or environment
credential. It covers strict schemas, duplicate keys, malformed/truncated/
oversized bodies, content types, SSRF/DNS ranges, redirects, TLS/proxy,
deadlines, cancellation, sanitized errors, redaction, freshness, canonical
money, prohibited price derivation, concurrency, replay poisoning, and scans
for forbidden signer, wallet, Circle, RPC, transaction, calldata, deployment,
authorization, execution, and payment capabilities.

**Production:** Live provider operation, durable non-authoritative retention,
monitoring, reconciliation, outage handling, and incident response remain
deferred.

**Protocol:** Additional providers, products, currencies, chains, generalized
quote protocols, arbitrary execution, and policy markets remain excluded.

## COV-015 deterministic audit-projection boundary

**MVP:** COV-015 is a pure offline observer. It may strictly parse the five
closed source kinds, reconstruct allowlisted fields, verify source links and
causal consistency, compute deterministic identities, deduplicate identical
events, topologically sort them, deeply freeze the result, and serialize one
canonical JSON document. It cannot generate a proposal, evaluate policy, issue
a receipt, sign, construct calldata, simulate, submit, execute, deploy, fund,
query a network, settle, reconcile, or establish finality.

**MVP:** Demo events enter only through the existing strict demo audit schema.
They are observational journal records, not signed envelopes or independently
verified policy artifacts. Direct demo-derived events use
`OBSERVATIONAL_DEMO_AUDIT`. The projector verifies the unchanged demo event-ID
formula, tracks every source ID and complete body across all wrappers, rejects
runtime/sequence or logical-lifecycle conflicts, and enforces all shared
predecessor identifiers. It still trusts the upstream journal's provenance.
Signed-flow evidence enters only as already validated artifacts plus validated
digest identities and is reparsed before use. Executor evidence accepts only
faithfully sourced `PREPARED`, `SIMULATED`, and `SUBMITTED` outputs with stable
execution/digest links and an allowlisted opaque identifier where applicable.
Unsupported failure shapes fail strict parsing. COV-008 uses the shared exact
ordered result schema and trusts the upstream harness provenance after its
private receipt, event, balance, and state checks. COV-010 must pass the
existing offline anchor and canonical-digest verifier.

**MVP:** Every normalized event retains its exact source event type. Proposal,
policy decision, signed authorization, transport preparation, transport
acceptance, transaction submission, execution evidence, settlement evidence,
security control, revocation, and deployment evidence remain separate stages.
An earlier stage never implies a later stage.

**MVP:** `SUBMISSION_SIMULATED` remains a simulated opaque reference.
Executor `SUBMITTED` remains transport acceptance and has no downstream success
event. Executor rejection, ambiguity, and generic error audit variants are not
accepted because COV-015 has no repository-owned producer that can prove their
complete provenance and stable execution link. No accepted transport result
proves a transaction hash, receipt, Circle execution, Arc inclusion, vault
execution, settlement, or finality.

**MVP:** COV-008 execution and settlement events are explicitly scoped to
`LOCAL_ANVIL`. The settlement event is only a local token-movement and
vault-accounting observation. COV-010 finality is explicitly scoped to the
recorded deployment transaction. No current source supports external payment
settlement or payment finality, and the taxonomy contains no payment-finality
event.

**MVP:** Normalized identity excludes sequence, time, ingestion order, paths,
signatures, receipts, display text, and nondeterministic metadata. Identical
identity/body pairs collapse; identity/body conflicts, semantic source
conflicts, missing parents, and cycles fail the entire projection. Ordering uses
only frozen ranks, canonical source position, and event identity.

**MVP:** The output schemas reconstruct every object field by field and reject
unknown properties. Output contains no full signed envelope, signature,
typed-data document, calldata, raw transaction, receipt, log, provider body,
dependency error, stack, cause, RPC URL, port, PID, path, lock detail,
environment value, credential, or repository state.

**MVP:** The command reads one bounded JSON document from standard input,
accepts no arguments or caller-selected path, writes one JSON document to
standard output, performs no network call, and persists nothing. The existing
demo journal remains unchanged.

**MVP:** Every audit projection and redirected local output is observational,
replaceable, reconstructable, and non-authoritative. No local file, Supabase
table, or database owns spend, remaining budget, payment count, financial
replay, revocation, token movement, settlement, or finality. CovenantVault
remains authoritative for financial enforcement.

**Production:** Centralized retention, tamper-evident storage, reconciliation,
monitoring, backup, access control, privacy retention, and incident response
remain deferred.

**V2:** Additional source families, organizations, agents, vendors, assets,
products, policies, or chains require a separately reviewed closed adapter.

**Protocol:** Generic event ingestion, arbitrary schemas, generalized policy,
arbitrary calls, and generalized execution remain excluded.
