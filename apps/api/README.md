# `@covenant/api`

**V2:** Developer REST boundary for Covenant Platform v1.

The package exposes `CovenantApi` for offline tests and
`createHttpServer(...)` for a Node HTTP deployment. It accepts only
`cov_test_...` project API keys, validates public requests, and delegates
lifecycle and execution to `@covenant/core` and `@covenant/runtime`.

API authentication identifies a project; it is not a Covenant authorization
receipt and cannot sign or submit a payment. Arc Testnet (`5042002`) and
six-decimal USDC are forced by the core constructor. Circle credentials,
wallet keys, transaction builders, and arbitrary calldata are outside this
package.

`openapi.json` is the public contract. Webhook secrets are returned once and
encrypted at rest with the injected 32-byte `webhookMasterKey`. Delivery
signatures are HMAC-SHA256 over `timestamp.deliveryId.rawBody` and must be
checked within the documented five-minute replay window. Tests use fake
senders; no public-network call is required by CI.

The first developer project and its initial API key are provisioned through
the non-HTTP `CovenantApi.provisionProject(name)` bootstrap method. Deployment
or administrative code must keep this method behind a private control plane;
it is not exposed anonymously by `createHttpServer` or any `/v1` route. It
generates the project and key together, returns the plaintext key once, and
persists only the key digest. Subsequent keys are created through the
authenticated `/v1/api-keys` management routes.

Deployments must inject a stable 32-byte `webhookMasterKey` when constructing
the API. Startup fails closed if it is absent or not exactly 32 bytes; there is
no random production-key fallback. The same key must be retained across
restarts so existing endpoint secrets remain decryptable.

Credential-creation responses are intentionally excluded from HTTP
idempotency response persistence so plaintext API keys and webhook secrets do
not enter the durable store.

`POST /v1/covenants/:id/authorize` requests the reviewed authority workflow and
leaves the Covenant in `AWAITING_AUTHORIZATION`. The authority boundary then
produces the existing signed PaymentIntent, DecisionReceipt, and
AuthorizationReceipt evidence. A caller submits that unchanged output to
`POST /v1/covenants/:id/authorization-evidence`; the API verifies it against
deployment-owned V1 CovenantSpec context and delegates the state transition to
`@covenant/core`. Possession of the project API key never authorizes money, and
the API has no signing key. Deployments without an evidence verifier fail closed.
