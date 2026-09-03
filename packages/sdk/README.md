# `@covenant/sdk`

**V2:** The Covenant TypeScript SDK is a typed, server-side client for the
COV-024 developer REST API. It ends at the HTTP boundary: it does not evaluate
policy, create receipts, sign messages, call Circle or Arc, construct calldata,
or hold financial authority.

## Install

Publication is deferred until the Platform v1 release gate (COV-027). When the
package is available from the package registry:

```bash
pnpm add @covenant/sdk
```

## Initialize

Use the SDK only from a trusted server-side TypeScript/JavaScript environment.
Never expose a `cov_test_...` API key in browser bundles, mobile applications,
or public frontend code. The application, not the SDK, owns environment
configuration; the SDK does not read `.env` files automatically.

```ts
import { Covenant } from "@covenant/sdk";

const covenant = new Covenant({
  ["apiKey"]: process.env.COVENANT_API_KEY!,
  baseUrl: process.env.COVENANT_API_URL!,
});
```

`baseUrl` is required because no production Covenant API URL has been
approved. HTTPS is required except for localhost development URLs. Requests
use a ten-second timeout by default and accept an injected `fetch` for tests.

## Create and operate a Covenant

The request shape is the COV-024 shape. Arc Testnet and six-decimal USDC are
server-controlled; the SDK exposes no alternate chain, asset, token, or
calldata parameters.

```ts
const agreement = await covenant.covenants.create(
  {
    payer: "0x1111111111111111111111111111111111111111",
    beneficiary: "0x2222222222222222222222222222222222222222",
    amount: "500",
    conditions: {
      policyHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      policyVersion: "1",
    },
    expiresAt: "1900000000",
  },
  { idempotencyKey: "create-order-123" },
);

const requested = await covenant.covenants.authorize(agreement.id, {
  idempotencyKey: "authorize-order-123",
});
// This requests the authority workflow; the SDK does not sign an authorization.

const authorized = await covenant.covenants.submitAuthorizationEvidence(
  agreement.id,
  externallyProducedEvidence,
  { idempotencyKey: "evidence-order-123" },
);

const operation = await covenant.covenants.execute(authorized.id, {
  idempotencyKey: "execute-order-123",
});
const execution = await covenant.executions.retrieve(operation.execution.id);
```

Execution is asynchronous. Provider acceptance, Arc observation, execution,
and finality remain distinct fields. A client timeout is not a payment failure;
retrieve the execution resource when an operation ID is available.

Use `covenant.covenants.list({ limit, after })` for explicit bounded cursor
pagination. The SDK never performs unbounded page traversal.

`submitAuthorizationEvidence` transports an externally produced, signed
authority bundle. It does not approve, sign, evaluate policy, or hold any
financial credential. The API verifies the unchanged V1 signatures and only
then applies the V2 lifecycle transition.

## API keys and webhooks

The first project/API key is provisioned through the private administrative
bootstrap defined by COV-024. The SDK starts after a developer already has a
valid project API key and cannot bootstrap its own credential. Subsequent API
key management is available through `covenant.apiKeys.create()`,
`list()`, and `revoke()`; plaintext keys are returned only by the API at
creation and are never persisted by the SDK.

Webhook endpoint management is available through
`covenant.webhooks.createEndpoint()`, `listEndpoints()`, and
`deleteEndpoint()`. Endpoint secrets are one-time credentials; do not write
them to disk or log them.

Verify a webhook using the raw request body, without JSON reserialization:

```ts
const event = covenant.webhooks.verify({
  payload: rawBody,
  signature: request.headers["x-covenant-signature"],
  timestamp: request.headers["x-covenant-timestamp"],
  deliveryId: request.headers["x-covenant-delivery-id"],
  secret: process.env.COVENANT_WEBHOOK_SECRET!,
});
```

Verification reproduces COV-024 HMAC-SHA256 signing over
`timestamp.deliveryId.rawBody` and enforces the five-minute replay window.

## Errors and safety

The SDK exposes bounded `CovenantError` subclasses for configuration,
validation, authentication, conflict, rate-limit, API, transport, timeout, and
webhook-signature failures. API `code`, `type`, `message`, HTTP status, and
request ID are preserved when safe; raw provider responses and credentials are
not.

HTTP `Idempotency-Key` is request coordination. It is not financial
authorization and is not the durable runtime execution identity. Mutations are
never automatically retried without an idempotency key. Reads have bounded
transient retries; keyed, idempotent Covenant mutations may retry within the
configured limit.

See `apps/api/openapi.json` for the public API contract and ADR 0026 for the
SDK boundary decision.
