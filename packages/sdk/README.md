# TypeScript SDK

**MVP:** The existing `@covenant/sdk` package remains the scaffold created by
the frozen MVP. COV-021 does not add runtime behavior, HTTP requests,
authentication, API keys, signing, authorization, wallet, Circle, or Arc
execution capability.

**V2:** Platform v1 approves this package as the future typed client over the
public Covenant API. It must not become a second authority/execution
architecture or a direct-to-Circle/Arc client.

## Intended experience

**V2:** A later COV may implement an experience approximately like:

```ts
import { Covenant } from "@covenant/sdk";

const covenant = new Covenant({
  apiKey: "<project API key>",
});

const agreement = await covenant.covenants.create({
  payer: "...",
  beneficiary: "...",
  amount: "500",
  asset: "USDC",
});
```

**V2:** The example is documentation only. `Covenant` and the shown methods are
not exported or implemented by COV-021.

## Intended operations

- **V2:** `covenants.create`
- **V2:** `covenants.retrieve`
- **V2:** `covenants.list`
- **V2:** `covenants.authorize`
- **V2:** `covenants.execute`
- **V2:** `covenants.cancel`
- **V2:** `covenants.audit`
- **V2:** `executions.retrieve`
- **V2:** `webhooks.verify`

**V2:** These operations will call the public API. API authentication will
establish project access only; it will not replace policy decision or signed
financial authorization. The SDK will never hold the isolated authorization
key or privileged Circle execution credentials.

**V2:** See `docs/V2_PLATFORM_CANON.md` and ADR 0022 for the approved public
contract. Runtime SDK behavior is deferred to COV-025.
