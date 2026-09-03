# ADR 0025: Developer REST API, Authentication, and Webhooks

**Scope:** V2 — Platform v1 developer HTTP surface.

## Decision

`apps/api` is the single developer-facing REST boundary. It authenticates a
test/development `cov_test_...` API key to exactly one developer project,
validates strict public request shapes, applies bounded HTTP idempotency, and
delegates Covenant lifecycle transitions to `@covenant/core` and durable
execution to `@covenant/runtime`. API authentication identifies a project; it
never supplies financial authorization.

Developer projects, API-key digests, webhook endpoints/deliveries, and HTTP
idempotency records share the durable runtime store and its PostgreSQL-portable
schema direction. Query predicates always include the authenticated project.

The public resources are Covenants and execution operations. Mutations accept
`Idempotency-Key`; a project, route, key digest, and canonical request
fingerprint must agree before a recorded response is replayed. Credential
creation responses (API keys and webhook secrets) are intentionally excluded
from response persistence so plaintext credentials never enter the durable
idempotency table. This key is external request coordination and is never an
execution or signing identity.

Responses use a bounded error envelope with a fresh `X-Request-Id` on every
request. Pagination is deterministic and capped at 100 records. The audit
route is read-only, observational, sanitized, and non-authoritative.

Webhook events are integration projections of the COV-023 transactional
outbox. Delivery IDs remain stable across retries. Payloads are signed with
HMAC-SHA256 over `timestamp.deliveryId.rawBody`; signatures include a five
minute replay window. Endpoint secrets are returned only at creation and are
encrypted at rest with an injected stable 32-byte master key. Startup fails
closed when that key is absent or invalid; no random production fallback is
allowed. Delivery retries are bounded and cannot alter financial execution.

The first project and API key are created only through the non-HTTP
`CovenantApi.provisionProject(name)` bootstrap method. It is an internal or
administrative provisioning control, not an anonymous public route. It
generates both records, returns the plaintext key once, and persists only its
digest; all later key management requires project authentication.

`apps/api/openapi.json` is the machine-readable public contract. The API does
not add SDK runtime behavior; SDK helpers remain deferred to COV-025.

## Consequences and boundaries

The API has no authorization private key, Circle credential, wallet key,
transaction builder, arbitrary calldata, or chain/token selector. Arc Testnet
(`5042002`) and six-decimal USDC are forced by core construction. Reviewed
authority/signer evidence remains the only path to `AUTHORIZED`; the executor
and CovenantVault retain settlement and replay authority.
