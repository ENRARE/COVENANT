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

Credential-creation responses are intentionally excluded from HTTP
idempotency response persistence so plaintext API keys and webhook secrets do
not enter the durable store.
