# ADR 0017: RunPod provider transport boundary

- Status: Proposed
- Date: 2026-08-03
- Scope: V2

## Decision

**V2:** Do not implement using the evaluated provider interface.

This ADR is documentation-only planning for COV-014. It does not authorize
HTTP, an SDK, live RunPod access, a provider credential, quote replay
persistence, Invoice construction or signing, PaymentIntent construction or
signing, authorization signing, payment execution, settlement, or any other
application capability. Any future implementation requires a separately
accepted issue.

The evaluated RunPod interfaces expose API-key-authenticated management or
catalog data, but the reviewed official documentation does not establish a
cryptographically authenticated immutable quote containing the complete
COV-013 evidence tuple. RunPod catalog pricing therefore cannot directly
populate COV-013 evidence: doing so would require missing or invented fields
and prohibited pricing derivation or conversion. The COV-013 local fingerprint
remains deterministic equality evidence only and is not provider
authentication.

## Provider research and source register

Provider-specific claims in this ADR are based only on the following official
RunPod sources, retrieved on **2026-08-03**. A source is cited only for the
facts it documents; no endpoint, credential, HTTPS connection, or catalog
field is treated as stronger provenance than the source establishes.

- [Overview](https://docs.runpod.io/api-reference/overview.md): describes REST
  API v1, gives `https://rest.runpod.io/v1/openapi.json`, says requests require
  a RunPod API key and return JSON, and warns that REST API v1 is deprecated
  and directs new integrations to REST API v2.
- [API v2](https://docs.runpod.io/api-reference-v2/overview.md): gives the REST
  API v2 base URL `https://api.runpod.io/v2`, describes v2 as beta, lists
  catalog and resource-management surfaces, and documents API-key-required
  requests.
- [List GPU types](https://docs.runpod.io/api-reference-v2/catalog/list-gpu-types.md):
  documents `GET /v2/catalog/gpus`, GPU types with pricing, and optional
  availability using `include=AVAILABILITY`; the response schema includes
  catalog identity, pricing, and availability-related fields.
- [Get a GPU type](https://docs.runpod.io/api-reference-v2/catalog/get-a-gpu-type.md):
  documents `GET /v2/catalog/gpus/{id}` as returning one GPU type with pricing
  and optional availability. The documented response is a `GpuType`, not a
  quote envelope.
- [Pricing](https://docs.runpod.io/pods/pricing.md): describes Pod on-demand
  and savings-plan pricing and compute/storage billing; it does not define an
  immutable signed quote protocol.
- [GPU types](https://docs.runpod.io/references/gpu-types.md): provides an
  official GPU reference; it is catalog/reference material, not quote issuance
  or response-authentication evidence.
- [Create a Pod](https://docs.runpod.io/api-reference-v2/pods/create-a-pod.md):
  documents Pod creation through REST API v2. It is a resource-management
  operation and is outside the proposed quote-source boundary.
- [GraphQL Spec](https://docs.runpod.io/references/graphql-spec.md): provides
  the official GraphQL reference/specification; it does not establish a signed
  quote protocol.
- [Manage Pods](https://docs.runpod.io/sdks/graphql/manage-pods.md): documents
  GraphQL Pod management and authentication/operations; it does not establish
  COV-013 quote fields or signed response provenance.
- [Send API requests](https://docs.runpod.io/serverless/endpoints/send-requests.md):
  documents HTTP requests for queue-based Serverless jobs; job invocation is
  not a GPU price-quote interface.
- [Serverless pricing](https://docs.runpod.io/serverless/pricing.md): describes
  Serverless compute and storage billing concepts; it does not define an
  immutable signed quote object.
- [Manage API keys](https://docs.runpod.io/get-started/api-keys.md): documents
  `All`, `Restricted`, and `Read Only` key choices, permission editing,
  disablement, revocation, and treating keys as passwords. It does not
  establish a catalog-specific minimum scope or response-body signature.

## Interface assessment

- **REST v1 management API:** no quote ID, issue time, expiry, complete
  COV-013 tuple, response signature/MAC, or independent verification is
  documented.
- **REST v2 catalog `GET /v2/catalog/gpus`:** no immutable quote ID or quote
  times are documented; catalog identity and rates are not a complete COV-013
  tuple; no response signature/MAC or independent verification is documented.
- **REST v2 catalog `GET /v2/catalog/gpus/{id}`:** no immutable quote ID, quote
  times, complete COV-013 tuple, response signature/MAC, or independent
  verification is documented.
- **REST v2 Pod management:** no quote object, quote times, complete COV-013
  tuple, response signature/MAC, or independent verification is documented.
- **GraphQL management API:** no quote ID, issue time, expiry, complete
  COV-013 tuple, response signature/MAC, or independent verification is
  documented.
- **Serverless job API:** request and job identifiers are not quote IDs; no
  quote times, complete COV-013 tuple, response signature/MAC, or independent
  verification is documented.
- **Pricing and GPU reference pages:** no quote ID, issue time, expiry,
  complete COV-013 tuple, response signature/MAC, or independent verification
  exists in static reference material.

The evaluated catalog exposes GPU identity and numeric catalog pricing, but
does not document a provider-issued immutable quote. A request ID, endpoint
ID, GPU catalog ID, billing record, or local COV-013 fingerprint must not be
substituted for `quoteId`.

## Authentication decision

The following claims remain separate:

1. **API-key client authentication (documented):** a caller presented a
   RunPod API key accepted for the request, subject to the key's permissions.
2. **TLS endpoint authentication (transport property):** successful HTTPS
   certificate and hostname validation authenticates the configured TLS
   endpoint to the client through the configured PKI trust path.
3. **Response-body authentication (not established):** no reviewed official
   RunPod documentation describes a response signature, MAC, signed webhook
   envelope, quote signature, verification-key discovery, canonical signed
   input, or equivalent control for the evaluated catalog/pricing response.
4. **Immutable quote authenticity (not established):** catalog pricing and
   availability are not documented as immutable provider-issued quotes.
5. **Independent verifiability (not established):** a verifier would need to
   trust the configured endpoint, TLS/PKI path, API-key custody, and fetcher.

For a successful catalog fetch, the strongest truthful statement is: "A
controlled service received JSON over a configured HTTPS RunPod endpoint using
a RunPod API key and locally validated the response against the documented
schema at fetch time." This is not a claim of provider-signed origin, immutable
price commitment, invoice, authorization, payment request, or settlement
evidence.

No reviewed official RunPod documentation establishes a cryptographically
authenticated immutable quote containing the complete COV-013 tuple:
`version`, `providerId`, `quoteId`, `productId`, `gpuModel`, `quantity`,
`durationSeconds`, `currency`, `amount`, `quotedAt`, and `expiresAt`.

## COV-013 compatibility and money boundary

- `version`: no provider field; do not invent it as provider evidence.
- `providerId`: the local `runpod` namespace is not provenance.
- `quoteId`: no documented immutable quote ID; do not use a GPU ID, endpoint
  ID, request ID, or local fingerprint.
- `productId`: no fixed COV product binding; do not infer `gpu-h100-hour`.
- `gpuModel`: catalog `id` or `name` may identify a GPU, but identity alone is
  not quote evidence.
- `quantity`: `count` is an availability/query input and `maxCount` is a limit;
  do not treat either as purchased quantity.
- `durationSeconds`: no quote duration; do not invent it.
- `currency`: no documented COV-013 `USDC` quote currency; do not infer
  currency from a dollar sign or context.
- `amount`: a catalog price is a rate, not an exact COV-013 total; perform no
  multiplication, FX, tax, fee, or rounding.
- `quotedAt`: no provider issue timestamp; local retrieval time is not provider
  issue time.
- `expiresAt`: no provider expiry timestamp; a local TTL is not provider
  expiry.

RunPod catalog pricing cannot directly populate COV-013. Producing an exact
USDC total would require selecting pricing mode, quantity, and duration and
could require USD/USDC conversion, FX, fees, taxes, and rounding. Those are
not provider-authenticated quote fields and are prohibited in this planning
scope. The adapter must perform no pricing derivation or conversion.

## Conditional network-policy proposal

**V2:** The following is conditional, non-authorizing planning analysis only;
it does not approve implementation or a live request. If a separately
approved weaker trusted-fetch review occurs, its server-owned policy should
be:

- **Scheme/port:** HTTPS only, port `443` only.
- **Origin:** `https://api.runpod.io` only for REST v2 catalog; deprecated
  `rest.runpod.io` is not approved.
- **Method/path:** `GET` only; a fixed catalog path selected by server
  configuration. Public callers select no URL, host, port, path, query, method,
  headers, credentials, product, GPU, quantity, duration, or currency.
- **Redirects:** disabled; every `3xx` fails closed.
- **Proxy:** no caller-selected proxy; a centrally configured production
  egress proxy requires separate **Production** approval.
- **DNS/IP:** controlled resolution; reject loopback, private, link-local,
  multicast, metadata, unique-local, IPv4-mapped, and alternate IP encodings.
  Accept no IP literal from callers.
- **TLS:** certificate and hostname validation with approved roots; no insecure
  mode.
- **Deadlines:** conditional connect 3s, headers 5s, body inactivity 5s, and
  total 10s; server-owned cancellation only.
- **Response:** maximum 64 KiB; exact `application/json`; `identity` content
  encoding only; no automatic decompression.
- **Retries:** one attempt and no automatic retry/backoff; the operation is not
  documented as a quote-safe idempotent action.
- **Rate limit:** map documented `429` to fixed `RATE_LIMITED`; never expose
  upstream details or caller-controlled retry timing.

These values are **Production** hardening considerations if live network use
is ever separately approved. They are not implementation requirements being
implemented by COV-014.

## Conditional credential custody

**V2:** RunPod documents `Restricted` and `Read Only`, but does not establish
the exact minimum catalog-read permission. That is an implementation blocker.
No real provider key may be created, requested, read, stored, or used for
COV-014.

If a future **V2** issue is separately accepted, a dedicated quote-fetch
process would own only the minimum confirmed read capability. The browser,
agent, authority signer, executor, Supabase, and public input would receive
no credential. Production secret management, rotation, disablement,
revocation, egress controls, access audit, and incident response are
**Production** requirements. Local development and tests must use offline
fixtures and fake transport only.

The future fetcher receives no agent key, vendor key, authorization key,
wallet, funded account, Circle credential, RPC, transaction builder, calldata
builder, executor capability, deployment capability, generic HTTP client, or
arbitrary URL-fetch capability. It may fetch and normalize advisory evidence
only; it cannot propose, authorize, submit, execute, or settle payment.

## Conditional replay and idempotency analysis

**V2:** No authenticated replay identity currently exists. The COV-013 quote
ID and fingerprint are unauthenticated and cannot safely identify provider
evidence. Therefore **no quote replay repository may be introduced**.

Only after source authenticity is established could a separate design consider
an identity such as:

`provider account/tenant + fixed endpoint + provider-issued immutable quoteId`

with an authenticated body digest binding the complete quote tuple. A
conditional state machine is:

```text
ABSENT -> PENDING(authenticated identity)
PENDING -> COMPLETED(authenticated evidence)
PENDING -> AMBIGUOUS(timeout/cancellation/repository uncertainty)
PENDING -> CONFLICT(different authenticated body for one identity)
COMPLETED -> STALE(authenticated expiry/freshness limit)
STALE -> EXPIRED/RETAINED(after bounded retention)
```

Identical concurrent requests may join only after identity authentication;
conflicts fail closed; uncertain outcomes remain non-success; restart recovery
is non-authoritative; and repository failures are sanitized. No offchain state
may become authoritative for Covenant spend, payment count, revocation,
financial replay, or settlement. CovenantVault remains authoritative.

## Conditional sanitized error taxonomy

**V2:** These are planning labels only and authorize no implementation:

- `INVALID_PROVIDER_RESPONSE`: `Provider response was invalid.`
- `SOURCE_AUTHENTICATION_FAILURE`: `Provider source authentication failed.`
- `STALE_EVIDENCE`: `Provider evidence is stale.`
- `UNSUPPORTED_PRODUCT_OR_CURRENCY`:
  `Provider product or currency is unsupported.`
- `RATE_LIMITED`: `Provider rate limit reached.`
- `TIMEOUT`: `Provider request timed out.`
- `PROVIDER_REJECTED`: `Provider rejected the request.`
- `TRANSPORT_FAILURE`: `Provider transport failed.`
- `CONFIGURATION_FAILURE`: `Provider transport is not configured.`
- `REPLAY_CONFLICT`: `Provider evidence conflicted with retained evidence.`
- `RETAINED_AMBIGUITY`: `Provider request outcome is ambiguous.`

Raw bodies, credentials, authorization headers, account identifiers, quote
IDs, amounts, URLs, query strings, redirects, IPs, certificates, proxy
details, upstream messages, stacks, causes, and dependency errors must not
cross a public boundary. Missing provider authentication is not converted
into a successful evidence result.

## Conditional offline test strategy

**V2:** Any future implementation would require deterministic in-memory
fixtures and injected fake transport only, with no API key, live network,
provider SDK, or environment credential. Tests would cover strict schema and
unknown-field rejection, duplicate JSON keys, invalid encodings, truncation,
size limits, content type, DNS/SSRF address classes, redirect and credential
forwarding, TLS/proxy failure, deadlines/cancellation, sanitized errors,
credential redaction, freshness, canonical USDC boundaries, prohibited price
derivation, concurrency, replay poisoning, and absence of signer/wallet/
Circle/RPC/transaction/calldata/deployment/payment capabilities.

## Recommendation and blockers

**V2:** **Do not implement using the evaluated provider interface.** Before
any implementation is reconsidered, RunPod must document an immutable quote
ID; a complete authenticated COV-013 tuple; explicit USDC amount semantics;
provider issue and expiry times; cryptographically verifiable response
authentication with canonical input, key discovery, rotation, revocation, and
downgrade rules; account binding; a minimum read-only scope; and a stabilized
approved endpoint. A separate issue must accept the fixed network policy,
offline tests, and the preserved no-authority/no-execution boundary.

**Production:** Live credentials, secret management, egress control, durable
non-authoritative retention, monitoring, reconciliation, outage handling, and
incident response remain deferred.

**Protocol:** Additional providers, products, currencies, chains, generalized
quote protocols, arbitrary execution, and policy markets remain excluded.
