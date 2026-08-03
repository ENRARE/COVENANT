# ADR 0015: Offline Agentic API invoice-source adapter

- Status: Accepted
- Date: 2026-08-03
- Scope: V2

## Decision

**V2:** Implement COV-012 in `apps/agent` as an offline, provider-agnostic TypeScript adapter that satisfies the existing `ProcurementInvoiceSource` interface.

**V2:** Export `createAgenticApiInvoiceSource(dependencies)`. The returned frozen source exposes exactly `requestSignedInvoice(request)`.

**V2:** Inject an abstract untrusted `AgenticApiInvoiceClient` that exposes only `requestInvoiceCandidate(request)`. The client is an evidence source, not a transport, provider SDK, credential provider, signer, authority, or executor.

**V2:** The adapter strictly accepts exactly `productId: "gpu-h100-hour"` and a canonical positive USDC `maximumAmount`. It parses money with the existing specification helper, canonicalizes it with `formatUsdc`, rejects a different original representation, and constructs a fresh frozen two-field client request.

**V2:** One operation calls the injected client at most once and returns its result unchanged as untrusted `unknown`. The adapter does not parse, clone, normalize, validate, or inspect the candidate. COV-011 remains solely responsible for strict signed-Invoice validation, product compatibility, and amount-cap enforcement.

## Offline and credential boundary

**V2:** COV-012 performs no network request and contains no global or injected `fetch`, HTTP library, URL, endpoint, environment-variable access, credential, header, token, provider SDK, socket, or RPC behavior. No API key is required by this implementation.

**V2:** AgentRouter is only a development model provider for the implementation session and is not called by COV-012. No AgentRouter configuration or credential is part of the repository or adapter.

**V2:** A real provider transport, endpoint, authentication mechanism, or provider SDK requires a separately approved task and threat review. It is not an implicit extension of this adapter.

## Request boundary

**V2:** The client request contains only the fixed product ID and canonical maximum amount.

**V2:** The outbound request cannot contain recipient, token, vault, chain, signer, nonce, purpose, Covenant data, calldata, transaction data, Circle data, wallet data, or authorization material.

**V2:** Invalid adapter requests become the fixed `MALFORMED_INPUT` agent error before any client call. Synchronous client throws and asynchronous rejections become the fixed sanitized `PROCUREMENT_SOURCE_FAILURE` error without preserving raw dependency errors.

## Authority separation

**V2:** The adapter has no PaymentIntent signer, authorization signer, funded wallet, Circle credential, RPC transport, authority service, executor service, transaction construction, simulation, submission, settlement, or reconciliation capability.

**V2:** The injected client supplies only untrusted Invoice evidence. It receives no payment, wallet, signing, authorization, or execution authority.

**V2:** No component capable of generating payment requests gains authority to execute payments.

## Failure and tests

**V2:** Raw client messages, stacks, causes, request or response contents, URLs, credentials, headers, signatures, and dependency details never cross the public error boundary.

**V2:** Automated tests use only an in-memory injected client and make no live network request. Tests cover the frozen one-method surface, exact canonical request construction, fresh frozen client input, one-call limits, response identity, strict malformed-input rejection, canonical-money rejection, lexical uint256 overflow, sanitized synchronous and asynchronous failures, no retry, and absence of network, credential, authority, and execution surfaces.

## Exclusions

**V2:** COV-012 excludes live or sandbox provider calls, HTTP, endpoints, authentication, API keys, multiple products, multiple vendors, quote ranking, negotiation, dynamic pricing, catalog search, natural-language interpretation, arbitrary API tools, retries, fallback, polling, queues, persistent state, Circle, RPC, wallets, deployment, token approval, token funding, and real funds.

**Production:** Secret storage, credential rotation, workload identity, rate limits, durable workflows, monitoring, reconciliation, incident response, audit retention, and provider outage handling remain deferred.

**Protocol:** Generalized tool execution, arbitrary network destinations, arbitrary contract execution, generic procurement protocols, and multichain behavior remain excluded.

## Acceptance boundary

**V2:** Automated verification performs no live network request and requires no API credential.

**V2:** Status remains `Proposed` until focused formatting, type checking, unit tests, lint, build, and repository formatting verification all pass and the complete diff is reviewed.

## Consequence

**V2:** The injected client may supply untrusted Invoice evidence. COV-012 validates only the request and returns the candidate unchanged. COV-011 validates and hands acceptable evidence to the agent. The agent proposes. The authority decides. The executor reconstructs. The vault enforces.
