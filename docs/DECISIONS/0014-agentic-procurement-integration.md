# ADR 0014: Agentic procurement integration

- Status: Accepted
- Date: 2026-08-03
- Scope: V2

## Decision

**V2:** Implement COV-011 in `apps/agent` as a dependency-injected wrapper around the existing `AgentService`.

**V2:** Export `createProcurementIntegration(dependencies)`. Its only method is `procurePayment(request: unknown)`.

**V2:** The strict public request contains exactly `productId: "gpu-h100-hour"` and `maximumAmount`.

**V2:** An injected `ProcurementInvoiceSource` exposes only `requestSignedInvoice(request)` and returns one untrusted signed-Invoice candidate as `unknown`.

**V2:** The integration strictly parses the public request and candidate. It rejects unknown fields, malformed money, malformed signed objects, unsupported products, and Invoice amounts above `maximumAmount`.

**V2:** After validation, it calls the existing `AgentService.proposePayment` once with the original signed Invoice, the frozen product ID, and the Invoice amount as `expectedAmount`.

**V2:** The result remains exactly `AgentProposalResult`. No signed schema, authority request, executor request, EIP-712 definition, contract, or calldata changes.

## Authority separation

**V2:** The integration and invoice source have no PaymentIntent signer, authorization signer, Circle credential, funded wallet, RPC transport, authority service, executor service, transaction construction, simulation, submission, settlement, or reconciliation capability.

**V2:** The existing agent remains the PaymentIntent generator and continues deriving all payment fields from trusted configuration and the verified Invoice.

**V2:** No component capable of generating payment requests gains authority to execute payments.

## Failure and tests

**V2:** Source failures and malformed output become fixed sanitized agent errors. Raw messages, stacks, URLs, headers, credentials, prompts, and signed contents never cross the public error boundary.

**V2:** One operation makes at most one source call and one agent call. There is no automatic retry or fallback.

**V2:** Tests cover valid handoff, strict parsing, amount-cap enforcement, unsupported products, malicious extra fields, sanitized dependency failures, no agent call after rejection, exact agent input, and absence of authority or execution surfaces.

## Exclusions

**V2:** COV-011 excludes multiple vendors or products, quote ranking, negotiation, dynamic pricing, catalog search, natural-language interpretation, LLM hosting, HTTP, live vendor APIs, queues, persistent procurement state, Circle, RPC, wallets, deployment, token approval, token funding, and real funds.

**Production:** Authentication, rate limits, durable workflows, monitoring, incident response, credential rotation, and reconciliation remain deferred.

**Protocol:** Generalized procurement protocols, arbitrary tools, arbitrary contract execution, generic policy composition, and multichain behavior remain excluded.

## Consequence

**V2:** The procurement integration requests evidence. The agent proposes. The authority decides. The executor reconstructs. The vault enforces.
