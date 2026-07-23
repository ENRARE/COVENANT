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

## Deferred controls

- **Production:** Hardware-backed keys, dual control, credential rotation, network isolation, tamper-evident centralized audit storage, and incident response are deferred.
- **Production:** Continuous Circle/onchain reconciliation, redundant Arc RPCs, and formal recovery procedures are deferred.
- **Production:** Durable reservation persistence and restart recovery must preserve identity-to-nonce bindings and reconcile them against finalized vault state.
- **Production:** No external audit or formal verification has occurred; both remain required before production use.
- **Protocol:** Cross-chain and generalized policy boundaries require new specifications and are not inherited from the MVP.
