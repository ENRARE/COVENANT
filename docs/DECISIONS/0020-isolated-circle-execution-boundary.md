# ADR 0020: Isolated Circle execution and evidence boundary

- **Status:** Proposed
- **Scope:** MVP planning only
- **Issue:** COV-017
- **Date:** 2026-08-05
- **Recommendation:** Proceed only with restrictions

## Context

**MVP:** Covenant's security invariant remains exact: **No component capable of
generating payment requests shall possess authority to execute payments.** The
agent proposes an exact `PaymentIntent`; the authority verifies context; the
isolated signer grants exact short-lived authority; the executor verifies the
signed chain and constructs only `CovenantVault.executePayment`; Circle may
submit that already-constructed transaction; Arc settles; and CovenantVault
remains authoritative for spend, payment count, revocation, authorization
replay, token movement, and settlement enforcement.

**MVP:** The current executor accepts the existing signed PaymentIntent,
DecisionReceipt, and AuthorizationReceipt chain, verifies it through
`@covenant/spec`, loads trusted Covenant fields independently, builds the one
reviewed vault call, decodes it independently, re-encodes it, compares exact
bytes, and passes only the prepared immutable transaction to a narrow transport.
It accepts no caller-selected vault, target, ABI, function, calldata, value,
chain, token, recipient, amount, transport, or idempotency identity. It owns no
proposal capability, authorization key, Circle credential, funded transaction
key, RPC client, or generic transaction builder.

**MVP:** `PREPARED` is the service-level prepared-execution output or state, not a
transport status. The current transport result statuses are `SIMULATED` for
simulation and `SUBMITTED`, `REJECTED`, or `AMBIGUOUS` for submission. The
existing `executionId` is derived internally by the executor's current
keccak256-based repository construction over its reviewed identity fields;
callers cannot provide or select it, and COV-017 does not change that algorithm.
Concurrent identical calls join one in-flight operation; conflicting reuse fails
closed; and an attempt that may have reached a transport is retained as
ambiguous rather than automatically resubmitted.

**MVP:** The current `InMemoryExecutionRepository` stores completed results in a
process-local in-memory `Map`. It implements no eviction, retention bound, or
garbage-collection policy, so that storage is volatile, unbounded, and
non-authoritative. Bounded retention and restart-safe durable coordination
remain future implementation blockers.

**MVP:** COV-016 is a deterministic read-only web console that renders one
committed COV-015 audit fixture and projection. It has no Arc RPC, receipt
observer, settlement observer, payment-finality observer, execution capability,
or mutation capability. It therefore cannot provide the missing Circle
submission evidence.

**MVP:** COV-017 supplies planning, not execution. No Circle API key, entity
secret, ciphertext, recovery file, wallet credential, funded key, request,
transaction, RPC call, receipt poller, webhook, database, queue, or runtime
transport is created here.

## Decision

### Recommendation

**MVP:** **Proceed only with restrictions.** Current official Circle Wallets
documentation shows that the Developer-Controlled Wallets contract-execution
operation schema accepts raw calldata and includes `ARC-TESTNET` in its
blockchain enum, while Circle separately lists Arc Testnet for EOA and SCA
wallets. Together those facts support architectural feasibility only. A future,
separately approved executor issue may implement that operation only if every
fixed-input, custody, idempotency, ambiguity, parsing, evidence, and network
restriction in this ADR is satisfied and the listed blockers are closed.

**MVP:** Circle's Developer-Controlled Wallets direct transfer operation is
rejected. It selects a token, destination, and amount for a wallet transfer and
would bypass `CovenantVault.executePayment`, including its spend limits,
payment-count enforcement, replay protection, revocation checks, signed-payment
semantics, and authoritative accounting.

**MVP:** Agent Wallets, user-controlled challenge operations, generic signing,
and pre-signed arbitrary transactions are also rejected. They either place an
execution capability next to a proposal-generating agent, introduce a user
challenge model that does not match the executor, or preserve more arbitrary
wallet capability than the one fixed vault call requires.

### Frozen Circle product and operation

| Property                    | COV-017 decision                                                                                                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope                       | **MVP:** Planning only; no live request is authorized.                                                                                                                                                                                                                                          |
| Product                     | **MVP:** Circle Wallets, Developer-Controlled Wallets.                                                                                                                                                                                                                                          |
| API family                  | **MVP:** Developer-Controlled Wallets API.                                                                                                                                                                                                                                                      |
| Operation                   | **MVP:** Create a contract execution transaction.                                                                                                                                                                                                                                               |
| Production origin           | **MVP:** `https://api.circle.com`, the sole server in the current operation OpenAPI.                                                                                                                                                                                                            |
| Testnet or sandbox origin   | **MVP:** The official operation publishes no separate sandbox host; testnet use is selected by a test API key, an `ARC-TESTNET` wallet, and server-owned wallet configuration at the same origin. No undocumented host may be invented.                                                         |
| Path and method             | **MVP:** `POST /v1/w3s/developer/transactions/contractExecution`.                                                                                                                                                                                                                               |
| Request content type        | **MVP:** `application/json`.                                                                                                                                                                                                                                                                    |
| Authentication              | **MVP:** HTTP bearer authentication with a server-side Circle API key; the request body also requires a unique entity-secret ciphertext.                                                                                                                                                        |
| Wallet control              | **MVP:** Developer-controlled MPC wallet; Covenant owns and isolates the entity secret while Circle participates in wallet signing.                                                                                                                                                             |
| Network identity            | **MVP:** Circle operation enum `ARC-TESTNET`; Covenant chain ID remains decimal `5042002`. The provider label and chain ID must be independently fixed and cross-checked.                                                                                                                       |
| Contract execution          | **MVP:** The current operation schema accepts `ARC-TESTNET` in its documented `ContractExecutionBlockchain` enum. Together with Circle's separate Arc Testnet wallet listing, this supports architectural feasibility only; it does not conclusively establish live contract-execution support. |
| Required transaction fields | **MVP:** The operation accepts a fixed wallet ID, contract address, raw even-length `0x` calldata, UUID-v4 idempotency key, unique entity-secret ciphertext, and server-owned fee fields. `callData` is mutually exclusive with ABI signature and parameter fields.                             |
| Native value                | **MVP:** Omit the optional `amount`; no native value is authorized. Any future evidence that omission does not mean zero blocks implementation.                                                                                                                                                 |
| Response                    | **MVP:** HTTP `201` returns an object whose `data` requires provider transaction `id` and `state`.                                                                                                                                                                                              |
| Status operation            | **MVP:** `GET /v1/w3s/transactions/{id}` on the same fixed origin, with the provider transaction UUID inserted only after strict parsing.                                                                                                                                                       |

**MVP:** Circle exposes arbitrary contract execution at its API boundary through
caller-supplied `contractAddress`, ABI fields, or `callData`. Covenant therefore
must enforce restrictions before Circle: the Circle-facing process receives no
public request body and constructs every provider field from verified input,
trusted configuration, or local secret generation.

### Official Circle source register

**MVP:** All Circle-specific claims in this ADR use only current official Circle
documentation. Initially accessed 2026-08-05; URLs and relevant claims
revalidated 2026-08-06. The register records both support and limits; repository
implementation and remembered endpoint behavior are not treated as Circle
evidence.

| Official page title                              | Exact official URL                                                                                                               | Product and operation                                                     | What it proves                                                                                                                                                                                                                                                                                                                                            | What it does not prove                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create a contract execution transaction          | https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/create-developer-transaction-contract-execution | Circle Wallets / Developer-Controlled Wallets / create contract execution | **MVP:** `POST`, fixed production origin, exact path, bearer security, JSON body, required UUID-v4 idempotency key and unique ciphertext, wallet selectors, contract address, mutually exclusive raw calldata or ABI fields, fee fields, `ARC-TESTNET` accepted by the operation enum, and `201` response identity/state shape.                           | **MVP:** It does not prove selected-wallet compatibility, wallet funding or gas behavior, successful submission, successful CovenantVault execution, settlement, finality, safe retry across a lost response, a separate sandbox host, or the meaning of omitted native amount beyond the documented optional field. |
| Idempotent requests                              | https://developers.circle.com/api-reference/idempotent-requests                                                                  | Circle API / mutating-request idempotency                                 | **MVP:** Endpoints that require idempotency use a UUID-v4 key to identify retries; reusing a documented successful request's key returns the original response rather than executing the operation again.                                                                                                                                                 | **MVP:** It does not establish end-to-end exactly-once transaction execution or resolve a lost first response, conflicting-payload reuse, retention duration, collision recovery, concurrency ordering, or reuse of the same key with a newly generated mandatory single-use `entitySecretCiphertext`.               |
| Create a transfer transaction                    | https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/create-developer-transaction-transfer           | Circle Wallets / Developer-Controlled Wallets / create transfer           | **MVP:** Direct transfer accepts wallet, token, destination, and amount fields and is a different operation.                                                                                                                                                                                                                                              | **MVP:** It does not invoke CovenantVault or preserve Covenant policy, so it is not an acceptable payment path.                                                                                                                                                                                                      |
| Get a transaction                                | https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/get-transaction                                 | Circle Wallets / Developer-Controlled Wallets / transaction status        | **MVP:** A provider transaction can be queried at `GET /v1/w3s/transactions/{id}` and may expose state and transaction hash.                                                                                                                                                                                                                              | **MVP:** It does not by itself authenticate Arc receipt contents, Covenant events, token deltas, settlement, or Covenant finality.                                                                                                                                                                                   |
| Supported blockchains                            | https://developers.circle.com/wallets/supported-blockchains                                                                      | Circle Wallets / network support                                          | **MVP:** Circle Wallets lists Arc Testnet as `ARC-TESTNET` for EOA and SCA wallets.                                                                                                                                                                                                                                                                       | **MVP:** The general table does not prove selected-wallet compatibility, live contract execution through the operation, wallet funding or gas behavior, successful submission, successful CovenantVault execution, settlement, finality, or mainnet Arc support.                                                     |
| Transaction states and errors                    | https://developers.circle.com/wallets/asynchronous-states-and-statuses                                                           | Circle Wallets / asynchronous transaction lifecycle                       | **MVP:** Current state names and descriptions; terminal labels; `SENT` has a hash in the mempool; `CONFIRMED` is mined; `COMPLETE` is terminal success; Arc may skip `CONFIRMED`; and observations can be omitted or out of order.                                                                                                                        | **MVP:** It does not make a Circle state an independently verified Arc receipt, successful Covenant call, token settlement, or repository finality policy.                                                                                                                                                           |
| Blockchain confirmations                         | https://developers.circle.com/wallets/blockchain-confirmations                                                                   | Circle Wallets / provider confirmation policy                             | **MVP:** Circle uses chain-specific confirmation thresholds before `COMPLETE` and explains reorganization risk.                                                                                                                                                                                                                                           | **MVP:** It does not freeze Covenant's independent Arc payment-finality policy or prove contract-specific effects.                                                                                                                                                                                                   |
| API keys                                         | https://developers.circle.com/api-reference/keys                                                                                 | Circle platform / server authentication                                   | **MVP:** Server-side API keys use `Authorization: Bearer <API_KEY>`, test and live keys are distinct, client exposure is forbidden, and loss can cause financial harm.                                                                                                                                                                                    | **MVP:** It does not establish a least-privilege scope for only this wallet and operation, secret-manager design, or Covenant rotation procedure.                                                                                                                                                                    |
| How the entity secret works                      | https://developers.circle.com/wallets/dev-controlled/entity-secret-management                                                    | Circle Wallets / Developer-Controlled Wallets custody                     | **MVP:** The entity secret is a customer-held random 32-byte private key scoped to the Circle account; API keys authenticate while it authorizes wallet operations; ciphertext is sent in requests and is single-use; losing both secret and recovery path can permanently lose access; rotation invalidates old material and issues a new recovery file. | **MVP:** It does not approve a Covenant production custodian, HSM design, rotation window, recovery ceremony, or safe retry interaction between a reused idempotency key and a fresh ciphertext.                                                                                                                     |
| How-to: Generate and register your entity secret | https://developers.circle.com/wallets/dev-controlled/register-entity-secret                                                      | Circle Wallets / registration                                             | **MVP:** Circle documents SDK-assisted generation and registration and also states non-SDK generation/registration is possible; registration produces a recovery file that must be separated from the entity secret.                                                                                                                                      | **MVP:** It does not authorize COV-017 to generate a secret, install an SDK, create a file, or choose raw HTTP over a reviewed implementation dependency.                                                                                                                                                            |
| Key management                                   | https://developers.circle.com/wallets/key-management                                                                             | Circle Wallets / Developer-Controlled MPC                                 | **MVP:** Developer-controlled wallets use MPC and are controlled by the developer through an entity secret stored on the developer's server.                                                                                                                                                                                                              | **MVP:** It does not prove that Circle cannot submit under a compromised account or replace Covenant's own capability separation.                                                                                                                                                                                    |
| Wallets API rate limits                          | https://developers.circle.com/api-reference/wallets/rate-limits                                                                  | Circle Wallets / transport limits                                         | **MVP:** Wallet endpoints have per-second limits and excess requests return HTTP `429`.                                                                                                                                                                                                                                                                   | **MVP:** It does not document a COV-017-safe POST retry schedule or prove that a rate-limit response means the request had no effect.                                                                                                                                                                                |

### Fixed execution target

**MVP:** A future Circle-capable executor is restricted to one configured Arc
chain identity (`5042002` and `ARC-TESTNET`), one configured developer-controlled
wallet UUID, one trusted CovenantVault address, the exact reviewed
`executePayment` selector, internally encoded calldata, no native value, and the
already-approved immutable signed authorization chain.

**MVP:** Public and upstream callers cannot select or override contract address,
wallet ID, wallet address, blockchain, network, ABI, function name, signature,
parameters, calldata, transaction value, amount, gas, fee policy, endpoint,
method, API version, credential, idempotency key, response classification, or
evidence classification. The provider request omits `walletAddress`,
`blockchain`, `abiFunctionSignature`, `abiParameters`, and `amount`; it uses only
the fixed `walletId`, fixed `contractAddress`, verified `callData`, generated
UUID-v4 idempotency key, fresh ciphertext, and separately approved server-owned
fee configuration.

### Signed-field immutability

**MVP:** The executor strictly parses the signed PaymentIntent, canonical
RuleResults, signed DecisionReceipt, and signed AuthorizationReceipt before
construction, then verifies their complete chain. It consumes PaymentIntent
`version`, `intentId`, `covenantId`, `agentSigner`, `recipient`, `token`,
`amount`, `invoiceHash`, `purpose`, `createdAt`, `expiresAt`, and `nonce`; verifies
the agent signature, DecisionReceipt authority signature and exact decision/rule
binding, and AuthorizationReceipt authorization signature, intent/decision
links, vault, chain, policy, `authorizationNonce`, and `validUntil`.

**MVP:** Trusted Covenant configuration independently supplies chain ID, vault,
issuer, agent signer, authority signer, authorization signer, approved token,
approved recipient, limits, and revocation state or the existing authoritative
read needed by the verification boundary. No signed schema changes.

**MVP:** The exact CovenantVault call is constructed as the existing
`executePayment(intentTuple, intentSignature, authorizationTuple,
authorizationSignature)` ABI requires. DecisionReceipt and RuleResults are
verified offchain and do not enter calldata. The executor encodes from parsed
values, independently decodes with the trusted ABI, compares every tuple field
and signature to the verified chain, re-encodes the decoded value, and requires
byte-for-byte equality before preparation. It then checks the fixed target,
exact selector, zero native value, chain, token, recipient, amount, payment
nonce, intent expiry, authorization nonce and validity, Covenant ID, and vault
identity again before provider-body construction.

**MVP:** Circle receives only opaque raw bytes for the exact reviewed call and a
fixed contract address. Circle is not allowed to choose, decode, reinterpret,
round, normalize, substitute, or modify any signed value. A mismatch is a local
rejection and no provider request begins.

### Proposed internal submission command

**MVP:** Every boundary-crossing value enters as `unknown`, is size-bounded, is
strictly parsed, and is reconstructed field by field into recursively frozen
objects. The conceptual command is the smallest existing verified input:

| Boundary                          | Conceptual fields                                                                                                                                                       | Authority                                                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Verified authorization input      | **MVP:** `signedPaymentIntent`, `ruleResults`, `decisionReceipt`, `authorizationReceipt`                                                                                | **MVP:** Untrusted input until existing strict verification succeeds; Invoice remains authority-only evidence and callers cannot add execution fields. |
| Trusted configuration             | **MVP:** `chainId`, `circleBlockchain`, `circleWalletId`, `vaultAddress`, `executePaymentSelector`, `feePolicy`, signer addresses and Covenant policy anchors           | **MVP:** Deployment-owned, immutable for an operation, unavailable for public override.                                                                |
| Derived execution identity        | **MVP:** existing `executionId`, intent digest, decision digest, authorization digest, exact transaction digest, internal operation-key digest                          | **MVP:** Constructed locally from verified and trusted values.                                                                                         |
| Generated authentication material | **MVP:** bearer header inside the transport, fresh entity-secret ciphertext, random UUID-v4 bound once to the internal operation key                                    | **MVP:** Generated or injected only inside the isolated Circle process; never accepted in the command.                                                 |
| Circle request body               | **MVP:** fixed `walletId`, fixed `contractAddress`, exact `callData`, generated `idempotencyKey`, fresh `entitySecretCiphertext`, fixed fee fields                      | **MVP:** Built internally; no arbitrary JSON or caller headers.                                                                                        |
| Non-authoritative metadata        | **MVP:** local monotonic attempt time, sanitized attempt number, bounded internal state, provider transaction UUID, provider state, optional validated transaction hash | **MVP:** Operational evidence only; never financial authority.                                                                                         |

**MVP:** No command accepts a URL, origin, path, method, headers, arbitrary JSON,
raw caller calldata, wallet selector, contract selector, blockchain, fee policy,
credential, entity secret, ciphertext, or provider classification.

### Proposed Circle response boundary

**MVP:** Responses are untrusted bytes. The future implementation reads at most
64 KiB including error bodies, permits only exact `application/json` with an
optional UTF-8 charset, permits only `identity` content encoding, rejects a byte
order mark and malformed UTF-8, detects and rejects duplicate JSON keys before
normal JSON parsing, and rejects trailing data, malformed JSON, oversized bodies,
unexpected content types, compression, missing required fields, unknown fields,
unknown transaction states, and undocumented nesting.

**MVP:** Provider IDs and Circle request IDs are lowercase canonical UUID text of
36 ASCII characters after strict UUID validation. Timestamps, when retained from
a reviewed status schema, are RFC 3339 strings with an explicit `Z` offset and a
maximum of 35 ASCII characters; they are never trusted ordering clocks.
Transaction hashes are exact `0x` plus 64 hexadecimal characters and are
normalized to lowercase only after validation. URLs, links, metadata objects,
headers, account IDs, wallet IDs returned by the provider, arbitrary details,
and free-form provider messages are rejected or omitted rather than retained.

| Response class            | Strict conceptual accepted shape                                                                                                                                                                                             | Result                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Initial `201`             | **MVP:** top-level `data`; inside, provider transaction `id` and one known `state`; no other fields until separately reviewed                                                                                                | **MVP:** Reconstruct and recursively freeze sanitized acceptance evidence.                                       |
| Status `200`              | **MVP:** top-level `data`; expected provider `id`; known `state`; optional validated `txHash` only in states where official semantics allow it; any separately reviewed immutable identity fields must equal prepared values | **MVP:** Reconstruct and freeze an observation; conflict fails closed.                                           |
| Structured error          | **MVP:** bounded integer `code` and bounded provider `message` accepted only for internal classification; optional canonical request UUID is not public                                                                      | **MVP:** Map from HTTP class plus reviewed code to a fixed local error; discard free text.                       |
| Malformed or undocumented | **MVP:** wrong status/shape/type, duplicate key, unknown field/state, oversized bytes, invalid identifier/hash/time, or conflicting data                                                                                     | **MVP:** `CIRCLE_RESPONSE_INVALID` if submission is known not to have begun; otherwise `CIRCLE_OUTCOME_UNKNOWN`. |

**MVP:** Raw Circle response bodies, raw error messages, and raw headers are not
stored or logged. A possible Production-only encrypted diagnostic retention
facility would require a separate accepted issue, access model, purpose limit,
retention period, and redaction review; COV-017 does not authorize it.

### Credential custody

| Material                                   | Future owner                                                                                                        | COV-017 control                                                                                                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Circle API key                             | **MVP:** Isolated Circle executor transport process only                                                            | **MVP:** Inject at runtime from an approved secret source; use only in a fixed bearer header; never expose to agent, authority, signer, browser, web server, database, command input, logs, errors, fixtures, or repository files. |
| Entity secret                              | **MVP:** Dedicated secret-generation/ciphertext capability inside the isolated Circle boundary                      | **MVP:** Random 32-byte secret registered out of band in a separately approved ceremony; never pass through application objects or telemetry. Every request uses a newly encrypted ciphertext.                                     |
| Entity-secret ciphertext                   | **MVP:** Generated immediately before one provider request and consumed by transport                                | **MVP:** Single-use, request-local, not logged, persisted, retried, placed in evidence, or reused.                                                                                                                                 |
| Recovery file                              | **Production:** Separate recovery custodian, not the runtime executor                                               | **MVP:** Never mounted into the executor and stored separately from the entity secret; registration and recovery are blocked until a separate custody issue approves the ceremony.                                                 |
| Developer-controlled wallet and wallet set | **MVP:** Circle account under founder-approved organizational custody; executor receives only one fixed wallet UUID | **MVP:** No caller selection, creation, derivation, update, recovery, cancellation, acceleration, or generic signing capability.                                                                                                   |

**MVP:** Circle documents both SDK support and a non-SDK route for entity-secret
registration; it does not require the runtime contract-execution call to use an
SDK. Dependency choice remains a separate implementation decision after source,
surface, secret handling, and transport behavior review. COV-017 creates no
credential and installs nothing.

**MVP:** Local development and CI use deterministic offline fake transports and
synthetic non-secret fixtures only. Environment-variable discovery, local secret
stores, Circle Console access, and real credentials are prohibited. Credential
absence yields `CREDENTIAL_UNAVAILABLE` before submission.

**MVP:** Rotation stops new preparation, lets no old ciphertext be reused, marks
every started request whose validity cannot be proven `OUTCOME_UNKNOWN`, swaps
the injected API key or entity-secret generation capability atomically, and
resumes only after a health check that reveals no secret. Official documentation
states old entity-secret material fails after rotation and pending requests
should be reinitialized; it does not prove safe resubmission, so in-flight
ambiguity remains blocked for reconciliation.

### Capability separation

**MVP:** The future Circle-capable component may receive only the minimum verified
immutable execution envelope, fixed trusted configuration, minimum Circle
credential material, fixed-origin Circle access, and narrowly bounded
operational idempotency state.

**MVP:** It receives no proposal generation, procurement-agent tool, vendor
invoice signing key, authority or authorization signing key, browser capability,
generic HTTP client exposed to callers, arbitrary URL or RPC access, generic
wallet interface, arbitrary transaction or calldata builder, deployment
capability, database financial authority, or ability to alter signed fields. The
agent remains proposal-only; the authorization signer cannot submit through
Circle; and the Circle executor cannot generate or authorize a request.

### Idempotency and concurrency

**MVP:** The canonical financial-operation input remains the current executor
transaction identity and its internally derived keccak256-based `executionId`;
it is not replaced by Circle's ID, cannot be selected by a caller, and is not
changed by COV-017. As a future non-authoritative operational lookup proposal,
hash `COVENANT:CIRCLE:EXECUTION:V1 || 0x00 || executionId` with SHA-256. That
separate result is an internal operation-key digest, not the current execution
identity, a caller field, or a Circle key.

**MVP:** Circle requires a UUID-v4 idempotency key. A deterministic digest cannot
honestly be called a randomly generated UUID-v4, so the future boundary must
atomically create one cryptographically random UUID-v4 on first preparation and
bind it to the internal operation-key digest. Every later observation retrieves
that binding. The caller can choose neither value. The Circle UUID is not the
PaymentIntent digest, authorization digest, Circle transaction ID, or Arc hash;
those remain separate linked identifiers.

**MVP:** Same operation key plus byte-identical prepared transaction joins one
pending operation. Same key with different transaction, authorization digest,
wallet, target, calldata, chain, value, or fee-policy version is
`EXECUTION_CONFLICT`; neither first-writer nor last-writer data is submitted.
UUID collision with another operation, one operation returning two Circle IDs,
or one Circle ID returning conflicting immutable data blocks both records for
manual reconciliation.

**MVP:** Process-local single-flight may optimize one healthy process but cannot
establish restart safety. Before implementation, a durable, atomic,
conflict-detecting operation repository must retain PREPARED and every started or
ambiguous attempt across restarts. It is non-authoritative for spend and cannot
approve payment; CovenantVault remains financial authority. A disconnected
caller does not cancel or erase a started operation. Pending ownership uses a
bounded renewable lease, but lease expiry never authorizes POST resubmission.
Terminal operational records use a separately approved bounded retention and
garbage-collection policy; ambiguous records cannot be garbage-collected while
duplicate execution remains possible.

### Retry policy

**MVP:** Circle documents UUID-v4 idempotency keys for safely identifying
retries. Reuse of a documented successful request's key returns the original
response instead of executing the operation again. This does not establish
end-to-end exactly-once transaction execution or resolve a lost first response,
conflicting-payload reuse, retention duration, or reuse of the same key with a
newly generated mandatory single-use `entitySecretCiphertext`. Therefore
submission maximum is one POST attempt, with no automatic POST retry for `429`,
`5xx`, connection loss, timeout, cancellation, malformed success, or missing
response.

| Condition                                                                                   | Classification and action                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local validation, configuration, or credential failure before attempt                       | **MVP:** Safe pre-submission failure; zero provider attempts; caller may correct only through a new verified invocation.                                                                                                             |
| Explicit `400` validation rejection received and strictly parsed                            | **MVP:** `SUBMISSION_REJECTED_NO_EFFECT` only when reviewed Circle semantics prove no transaction was created; otherwise unknown. No blind retry.                                                                                    |
| `401` or `403`                                                                              | **MVP:** Authentication/authorization failure; non-retryable in process; rotate or repair out of band.                                                                                                                               |
| `429`                                                                                       | **MVP:** Rate-limited; no POST retry because official rate-limit text does not prove no effect. Honor a strictly bounded provider delay only for future read-only status polling, never public timing input.                         |
| `5xx`, connection failure, timeout before or after headers, caller cancellation after start | **MVP:** `OUTCOME_UNKNOWN`; no POST retry.                                                                                                                                                                                           |
| Malformed, oversized, wrong-content-type, truncated, or undocumented `2xx`                  | **MVP:** `OUTCOME_UNKNOWN`; retain operation and reconcile by known provider ID only if one was strictly accepted before the conflict.                                                                                               |
| Strictly accepted `201`                                                                     | **MVP:** `SUBMISSION_ACCEPTED`; persist provider ID before returning.                                                                                                                                                                |
| Status `GET` transport failure                                                              | **MVP:** Observation unavailable, not transaction failure. Read-only polling may use at most five attempts, capped exponential backoff of 1, 2, 4, 8, and 10 seconds, full jitter, and a 30-second total deadline per polling cycle. |

**MVP:** Submission has a 15-second total deadline and one attempt. Connection,
TLS, and response-header phases are each capped at 5 seconds; body completion is
capped at 10 seconds within the total limit. Cancellation before the attempt
record is durably marked started leaves `PREPARED`; cancellation after that mark
preserves ambiguity. Restart never resets the attempt counter.

### Uncertain-outcome state machine

| Internal state                  | Entry evidence                                                                                                             | Permitted next states                                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NOT_STARTED`                   | **MVP:** No verified operation exists.                                                                                     | **MVP:** `LOCAL_VALIDATION_REJECTED`, `PREPARED`.                                                                                                    |
| `LOCAL_VALIDATION_REJECTED`     | **MVP:** Strict authorization or immutable-construction rejection before network access.                                   | **MVP:** Terminal for this invocation.                                                                                                               |
| `PREPARED`                      | **MVP:** Verified chain, exact call, operation key, and UUID binding durably stored; no POST started.                      | **MVP:** `SUBMISSION_ATTEMPT_STARTED`.                                                                                                               |
| `SUBMISSION_ATTEMPT_STARTED`    | **MVP:** Durable marker written immediately before network I/O.                                                            | **MVP:** `SUBMISSION_REJECTED_NO_EFFECT`, `SUBMISSION_ACCEPTED`, `OUTCOME_UNKNOWN`.                                                                  |
| `SUBMISSION_REJECTED_NO_EFFECT` | **MVP:** Strict explicit provider rejection whose reviewed semantics prove no transaction creation.                        | **MVP:** Terminal; no automatic retry.                                                                                                               |
| `SUBMISSION_ACCEPTED`           | **MVP:** Strict `201` with one provider transaction UUID and known state.                                                  | **MVP:** `STATUS_OBSERVED`, `TRANSACTION_HASH_OBSERVED`, `TERMINAL_PROVIDER_FAILURE`.                                                                |
| `OUTCOME_UNKNOWN`               | **MVP:** Submission may have occurred but no strict unconflicted acceptance or no-effect rejection exists.                 | **MVP:** `STATUS_OBSERVED` only through separately authenticated reconciliation; never POST retry.                                                   |
| `STATUS_OBSERVED`               | **MVP:** Strict status response for the same provider transaction ID.                                                      | **MVP:** Another `STATUS_OBSERVED`, `TRANSACTION_HASH_OBSERVED`, `TERMINAL_PROVIDER_FAILURE`; regressions or conflicts remain detected observations. |
| `TERMINAL_PROVIDER_FAILURE`     | **MVP:** Provider state `FAILED`, `DENIED`, or `CANCELLED` for the linked ID.                                              | **MVP:** Terminal provider claim; it does not erase possible chain evidence.                                                                         |
| `TRANSACTION_HASH_OBSERVED`     | **MVP:** Strict provider response links a valid hash to the same provider transaction.                                     | **MVP:** `ARC_TRANSACTION_OBSERVED`; hash alone proves no success.                                                                                   |
| `ARC_TRANSACTION_OBSERVED`      | **MVP:** Independent Arc source observes the hash and chain transaction.                                                   | **MVP:** `EXTERNAL_SETTLEMENT_OBSERVED`; observation alone proves no successful Covenant effects.                                                    |
| `EXTERNAL_SETTLEMENT_OBSERVED`  | **MVP:** Separately specified Arc receipt, event, contract-state, and token-delta evidence proves exact execution effects. | **MVP:** `PAYMENT_FINALITY_ESTABLISHED`.                                                                                                             |
| `PAYMENT_FINALITY_ESTABLISHED`  | **MVP:** Separately approved chain-confirmation/finality policy is met for the exact successful payment evidence.          | **MVP:** Terminal payment claim.                                                                                                                     |

### Circle-state mapping

**MVP:** Provider states are observations, not Covenant state. Stale or out-of-
order observations are retained with observation time and never overwrite a
stronger independent claim.

| Circle state | Terminal per Circle | Bounded provider claim                                                                                           | Does not prove                                                                                             |
| ------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `INITIATED`  | No                  | **MVP:** Circle has initiated processing for the provider transaction.                                           | **MVP:** Broadcast, inclusion, success, settlement, finality.                                              |
| `CLEARED`    | No                  | **MVP:** Initial checks/risk screening passed and processing may continue.                                       | **MVP:** Broadcast, inclusion, success, settlement, finality.                                              |
| `QUEUED`     | No                  | **MVP:** Operation is in Circle's processing queue.                                                              | **MVP:** Broadcast, inclusion, success, settlement, finality.                                              |
| `SENT`       | No                  | **MVP:** Circle says it identified the transaction in the mempool and assigned a hash.                           | **MVP:** Inclusion, successful contract execution, settlement, finality.                                   |
| `STUCK`      | No                  | **MVP:** Circle says it sent the transaction but it was not included.                                            | **MVP:** Inclusion, success, settlement, finality.                                                         |
| `CONFIRMED`  | No                  | **MVP:** Circle says it identified the transaction in a mined block.                                             | **MVP:** Exact receipt success, Covenant effects, external settlement, Covenant finality.                  |
| `COMPLETE`   | Yes                 | **MVP:** Circle reports successful completion after its network policy; Arc may transition directly from `SENT`. | **MVP:** Independently decoded receipt/events/token deltas or Covenant's separately frozen finality claim. |
| `FAILED`     | Yes                 | **MVP:** Circle reports failure.                                                                                 | **MVP:** Absence of every chain effect without independent reconciliation.                                 |
| `DENIED`     | Yes                 | **MVP:** Circle denied the transaction.                                                                          | **MVP:** Any chain execution; raw error details remain untrusted.                                          |
| `CANCELLED`  | Yes                 | **MVP:** Circle reports cancellation.                                                                            | **MVP:** Absence of prior or conflicting chain evidence without reconciliation.                            |

**MVP:** Circle documents that `CONFIRMED` can be omitted or arrive out of order
and that Arc can transition from `SENT` directly to `COMPLETE`. The design must
therefore tolerate state reordering, duplicate observations, and stale reads and
must never infer a missing state.

### Evidence taxonomy

| Evidence type                             | Source and authenticity basis                                                                                                               | Claim scope and limitations                                                                              | Authority and transition use                                               | COV-015 eligibility                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Local execution preparation               | **MVP:** Executor; strict signed-chain verification and deterministic construction; local monotonic and trusted wall-clock timestamps       | **MVP:** Exact call prepared, no network claim                                                           | **MVP:** Non-authoritative; may start one attempt                          | **MVP:** Not eligible without a separate audit-schema issue; existing PREPARED output remains unchanged. |
| Local authorization rejection             | **MVP:** Existing verification boundary; local evaluation time and sanitized reason code                                                    | **MVP:** No provider attempt for this invocation                                                         | **MVP:** Authoritative only for local refusal; cannot affect vault state   | **MVP:** Not eligible as a new event.                                                                    |
| Circle submission attempt                 | **MVP:** Durable executor marker keyed by operation digest and attempt number; local time                                                   | **MVP:** Network I/O may begin; proves neither receipt nor acceptance                                    | **MVP:** Prevents automatic duplicate POST                                 | **MVP:** Not eligible.                                                                                   |
| Circle API acceptance                     | **MVP:** Strict TLS response from fixed Circle origin, bearer-authenticated request context, parsed provider UUID/state; local receipt time | **MVP:** Circle accepted/created an asynchronous provider transaction; body has no independent signature | **MVP:** May enable status reads; no financial authority                   | **MVP:** Not eligible.                                                                                   |
| Circle API rejection                      | **MVP:** Strict HTTP/error classification from fixed origin; local receipt time                                                             | **MVP:** Bounded provider rejection only; no-effect only when documented                                 | **MVP:** May stop this attempt; no vault effect                            | **MVP:** Not eligible.                                                                                   |
| Ambiguous submission outcome              | **MVP:** Executor transport boundary; local failure time and operation identity                                                             | **MVP:** Submission may have occurred; no success/failure claim                                          | **MVP:** Blocks resubmission                                               | **MVP:** Not eligible.                                                                                   |
| Provider transaction-state observation    | **MVP:** Strict status GET over fixed TLS origin for known provider UUID; provider timestamp if reviewed plus local observation time        | **MVP:** Circle's current state only; may be stale/reordered                                             | **MVP:** May refine provider evidence, never settlement                    | **MVP:** Not eligible.                                                                                   |
| Circle transaction identifier observation | **MVP:** Strict initial or status response; canonical UUID                                                                                  | **MVP:** Circle resource identity, not a chain identity                                                  | **MVP:** Links provider reads only                                         | **MVP:** Not eligible.                                                                                   |
| Transaction-hash observation              | **MVP:** Strict Circle status response; exact chain hash text and local observation time                                                    | **MVP:** Circle links a hash; no receipt-success claim                                                   | **MVP:** May trigger independent Arc observation                           | **MVP:** Not eligible.                                                                                   |
| Arc transaction observation               | **MVP:** Separately approved independent Arc reader; chain ID, block and transaction identity                                               | **MVP:** Chain transaction observed; no automatic success claim                                          | **MVP:** May trigger receipt/effect verification                           | **MVP:** Not eligible.                                                                                   |
| External Arc execution observation        | **MVP:** Independently fetched and strictly decoded receipt, target, input, status, logs, and code identity                                 | **MVP:** Exact successful vault call observation; reorg risk remains                                     | **MVP:** May contribute to settlement evidence                             | **MVP:** Not eligible.                                                                                   |
| External settlement observation           | **MVP:** Independent receipt/event/state/token-delta cross-check under a separately approved schema                                         | **MVP:** Exact external effects observed; not finality by itself                                         | **MVP:** May enter finality evaluation                                     | **MVP:** Not eligible.                                                                                   |
| Payment-finality evidence                 | **MVP:** Separately approved Arc confirmation/finality policy over exact settlement evidence                                                | **MVP:** Policy-specific final payment claim; does not generalize                                        | **MVP:** Final observational evidence; vault remains enforcement authority | **MVP:** Not eligible.                                                                                   |

**MVP:** No new evidence type may appear in the COV-015 projector until a
separate accepted issue changes its closed audit schema and proves producer
provenance, identity, causality, conflicts, sanitization, and display semantics.
COV-017 changes no audit schema.

### Settlement and finality boundary

- **MVP:** Circle request preparation is not payment execution.
- **MVP:** Circle API acceptance is not Arc execution.
- **MVP:** A Circle transaction ID is not an Arc transaction hash.
- **MVP:** A transaction hash is not proof of successful contract execution.
- **MVP:** Transaction inclusion is not automatically external settlement.
- **MVP:** External settlement observation is not automatically payment finality.
- **MVP:** Circle wallet status is not authoritative for CovenantVault spend,
  replay, revocation, payment count, or token accounting.
- **MVP:** CovenantVault remains authoritative for onchain Covenant enforcement.
- **MVP:** Finality requires separately specified chain evidence and confirmation
  policy.

### Network policy

**MVP:** The future transport uses HTTPS only, exact origin
`https://api.circle.com`, exact POST path, and the exact status path with only a
strict known provider UUID. Redirects are disabled and maximum redirects is
zero. Caller-selected proxies, environment proxy inheritance, alternate DNS,
custom trust roots, IP literals, and arbitrary URLs are prohibited.

**MVP:** Controlled DNS resolution must bind the approved hostname to the
connection decision and reject loopback, private, link-local, multicast,
unspecified, reserved, IPv4-mapped disallowed, and cloud-metadata destinations.
Infrastructure egress must independently allowlist only Circle. TLS certificate
and hostname validation are mandatory; no insecure mode exists.

**MVP:** Connection and TLS deadlines are each 5 seconds, response-header
deadline is 5 seconds, body deadline is 10 seconds, and total POST deadline is
15 seconds. Status polling uses the same per-request caps within its separate
30-second cycle. Maximum response bytes are 64 KiB. Only approved JSON and
identity encoding are accepted; decompression is disabled. Cancellation never
erases a started attempt. Rate limits follow the no-POST-retry rule. All network
failures map to fixed sanitized errors.

### Logging and error boundary

| Code                           | Fixed public meaning                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `CONFIGURATION_UNAVAILABLE`    | **MVP:** Required fixed trusted configuration is absent or inconsistent.                         |
| `CREDENTIAL_UNAVAILABLE`       | **MVP:** Isolated credential material is unavailable or validity is uncertain before submission. |
| `AUTHORIZATION_INVALID`        | **MVP:** Signed-chain validation failed.                                                         |
| `AUTHORIZATION_EXPIRED`        | **MVP:** Intent or authorization is outside its accepted time window.                            |
| `AUTHORIZATION_REVOKED`        | **MVP:** Existing trusted verification reports revocation.                                       |
| `EXECUTION_CONFLICT`           | **MVP:** One execution identity is associated with conflicting immutable or provider data.       |
| `REQUEST_INVALID`              | **MVP:** Internal boundary input or deterministic transaction checks failed.                     |
| `CIRCLE_AUTHENTICATION_FAILED` | **MVP:** Circle rejected authentication; no provider detail is exposed.                          |
| `CIRCLE_REQUEST_REJECTED`      | **MVP:** Circle explicitly rejected a validly parsed request response.                           |
| `CIRCLE_RATE_LIMITED`          | **MVP:** Circle returned a strict rate-limit response.                                           |
| `CIRCLE_TRANSPORT_FAILED`      | **MVP:** Transport failed before any submission could begin.                                     |
| `CIRCLE_RESPONSE_INVALID`      | **MVP:** A response failed the strict parser where no-effect is independently known.             |
| `CIRCLE_OUTCOME_UNKNOWN`       | **MVP:** Submission may have occurred but its outcome is unresolved.                             |
| `CIRCLE_STATUS_UNKNOWN`        | **MVP:** Provider state is unknown, conflicting, stale, or unavailable.                          |
| `EXECUTION_NOT_RETRYABLE`      | **MVP:** Policy forbids another submission attempt.                                              |
| `INTERNAL_UNAVAILABLE`         | **MVP:** A bounded internal dependency failed without a safe public detail.                      |

**MVP:** Logs and errors never expose API keys, entity secrets, ciphertext,
recovery files, authorization headers, wallet IDs, Circle account IDs, raw
provider bodies/messages, dependency stacks or causes, URLs, query strings, IP
addresses, TLS or proxy details, signed envelopes, signatures, calldata, exact
amounts unless a separately approved evidence surface permits them, private
paths, sensitive environment-variable names, or idempotency-repository details.
Only fixed codes, bounded opaque local correlation IDs, state names, and
non-sensitive counters are permitted. Secret-redaction tests inspect all public
and approved internal error surfaces.

## Threat analysis

**MVP:** The focused repository threat register is amended in
`docs/THREAT_MODEL.md`. The controlling design is defense in depth: fixed
capabilities prevent caller-selected execution, custody isolation bounds secret
compromise, strict transport and parsing bound external input, durable ambiguity
state blocks unsafe duplication, and independent Arc evidence prevents provider
claims from becoming settlement or finality.

## Offline test plan

**MVP:** A future implementation must inject a narrow Circle transport test seam
that accepts only the internally built provider request and returns bounded
synthetic bytes/status/headers. It must not expose a generic HTTP client to public
callers. All tests run with no real Circle credential, internet, Arc RPC, funded
wallet, transaction submission, browser, database, or webhook server.

| Test group                   | Required offline cases and assertions                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preparation and immutability | **MVP:** Valid exact call; malformed authorization; expired/revoked authorization; each signed-field mutation; wrong target, wallet, chain, token, recipient, amount, nonce, deadline, Covenant, vault, selector, value, ABI, and calldata; exact decode/re-encode equality; direct-transfer request rejection.                                                                     |
| Initial responses            | **MVP:** Valid accepted response for each permitted state; provider rejection; authentication failure; rate limit; server failure; timeout before I/O, before headers, after headers, and during body; malformed JSON; duplicate keys; body over 64 KiB; truncation; wrong content type/encoding; missing field; unknown field/state; invalid or conflicting Circle transaction ID. |
| Status responses             | **MVP:** Known state sequence; omitted `CONFIRMED`; Arc `SENT` to `COMPLETE`; stale response; state regression/reordering; unknown state; conflicting hash; invalid hash; provider-ID mismatch; terminal provider failure; status timeout and retry cap.                                                                                                                            |
| Idempotency and concurrency  | **MVP:** Stable operation lookup; random UUID-v4 generated once; UUID collision; operation-key conflict; concurrent identical join; concurrent conflicting rejection; caller disconnect; lease expiry; restart before attempt, during attempt, after ambiguous result, and after acceptance; no duplicate POST.                                                                     |
| Credentials                  | **MVP:** Absent/invalid credential capability; fresh ciphertext per request; attempted ciphertext reuse rejection; rotation before preparation, during request, and during ambiguity; no secret fixture; API key, entity secret, ciphertext, recovery material, and authorization header redaction.                                                                                 |
| Network and parsing          | **MVP:** Arbitrary URL, redirect, proxy, private IP, metadata address, DNS-rebinding simulation, TLS failure, decompression bomb, malformed UTF-8, unexpected media parameters, oversized identifiers, URL/metadata fields, and raw dependency error leakage.                                                                                                                       |
| Evidence claims              | **MVP:** Acceptance is not execution; Circle ID is not hash; hash is not success; inclusion is not settlement; settlement is not finality; COV-015 rejects every new unapproved evidence classification.                                                                                                                                                                            |

## Consequences

**MVP:** The recommended operation can preserve current architecture because
Circle is reduced to custody-assisted submission of one already-verified fixed
vault call. The executor remains unable to propose or authorize; the proposer
and signer remain unable to submit; and Circle remains non-authoritative for
Covenant policy.

**MVP:** The restriction has operational cost: a dedicated custody boundary,
atomic durable ambiguity state, no blind POST retries, strict response adapters,
independent Arc settlement evidence, and separate finality policy are required.
Provider availability is sacrificed rather than risking duplicate execution or
policy bypass.

## Implementation blockers

- **MVP:** A separately accepted implementation issue and founder approval are
  required; COV-017 itself authorizes documentation only.
- **MVP:** Fix and independently verify the one Developer-Controlled Wallets
  wallet UUID, wallet-set/account ownership, wallet type compatibility, Arc
  Testnet address, and inability of public callers to select another wallet.
- **MVP:** Fund only the approved test wallet under a separately authorized issue
  and determine Arc gas-token requirements and fixed server-owned fee policy.
- **MVP:** Verify with an offline fixture from the then-current official OpenAPI
  that omitted `amount` is exactly the zero-native-value contract call required.
- **MVP:** Approve API-key scope; current official material does not prove a key
  can be restricted to one wallet and one operation.
- **Production:** Approve entity-secret generation, HSM or secret-manager
  custody, recovery-file separation, registration, rotation, reset, revocation,
  incident response, and access audit. No real material exists in COV-017.
- **MVP:** Freeze the exact SDK or reviewed raw-HTTP dependency choice without
  exposing a generic transport capability.
- **MVP:** Reconfirm exact origin, endpoint, request fields, enum support,
  authentication, and response shape immediately before implementation because
  external API documentation can change.
- **MVP:** Treat Arc Testnet contract execution as a critical blocker. Obtain
  then-current official confirmation or separately approved controlled evidence
  for selected-wallet compatibility, wallet funding and gas behavior, successful
  submission, and successful CovenantVault execution; the documented enum and
  wallet listing alone prove only architectural feasibility, not settlement or
  finality.
- **MVP:** Resolve and test Circle's official idempotency semantics together with
  mandatory fresh ciphertext. Until then, maximum POST attempts remains one.
- **MVP:** Implement an atomic durable operation/UUID/provider-ID repository,
  restart-safe ambiguity retention, leases, collision/conflict behavior,
  bounded terminal retention, and reconciliation. Process-local state alone is
  blocked.
- **MVP:** Freeze status-polling semantics, provider timestamp subset,
  transaction-hash availability by state, stale/reordered-state treatment, and
  reconciliation procedure from then-current official docs.
- **MVP:** Webhooks remain excluded. A future webhook issue would need Circle
  authenticity, replay, ordering, duplicate, endpoint, credential, and recovery
  controls; polling does not inherit webhook trust.
- **MVP:** Specify independent Arc receipt, exact calldata, event, contract-state,
  token-delta, reorganization, external settlement, and payment-finality policy.
- **MVP:** Any COV-015 evidence or timeline addition requires a separately
  accepted audit-schema issue. COV-017 adds none.
- **Production:** Approve durable coordination, availability, monitoring,
  reconciliation, retention, privacy, production secret storage, egress
  enforcement, and incident response before real funds.

## Explicit exclusions

**MVP:** No TypeScript, Solidity, Circle SDK, HTTP transport, live API call,
credential, wallet creation, wallet funding, token approval, transaction
submission, contract execution, Arc RPC, broadcast, receipt polling, webhook,
database, persistent queue, package, lockfile, environment file, signed schema,
audit schema, vault, executor implementation, browser mutation route, commit, or
push is authorized by this ADR.

**V2:** Additional wallets, vendors, agents, assets, chains, Circle products,
fee policies, or execution operations require separately approved scope.

**Production:** Real funds, production credentials, recovery operations, durable
high availability, monitoring, incident response, and compliance operations are
deferred.

**Protocol:** Arbitrary smart-contract execution, arbitrary wallet operations,
generic transaction building, policy markets, and multichain behavior remain
excluded.

## Founder-approval assumptions

**MVP:** This Proposed ADR assumes founder approval is limited to documenting a
future isolated Circle boundary and to the recommendation **Proceed only with
restrictions**. It does not assume approval of credentials, wallets, funding,
transport implementation, external evidence schemas, finality semantics, audit
changes, deployment, live network use, or a later implementation issue.
