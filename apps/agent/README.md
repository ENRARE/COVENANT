# Procurement agent application core

**MVP:** COV-005 implements the untrusted procurement agent as a pure dependency-injected application core. `createAgentService(dependencies)` exposes only `proposePayment(request: unknown)`.

**MVP:** The strict public request is:

```ts
{
  signedInvoice: unknown;
  procurementRequest: {
    productId: "gpu-h100-hour";
    expectedAmount: unknown;
  }
}
```

**MVP:** The result is exactly `{ signedPaymentIntent, signedInvoice }` and is directly accepted by the authority application. The verified raw Invoice is defensively copied without changing its valid raw field representations. The agent constructs and signs only the exact PaymentIntent.

**MVP:** The one Covenant, agent signer, approved vendor, `gpu-h100-hour` product, token, recipient, purpose, and Arc Testnet deployment are trusted configuration or derived from the trusted Covenant. Public input cannot select a recipient, token, vault, chain, domain, hash, signer, identifier, nonce, timestamp, or purpose.

**MVP:** Invoice signature recovery, EIP-712 domains, typed-data construction, canonical signatures, hashing, money parsing, and PaymentIntent verification use `@covenant/spec`. Money, nonce, timestamps, and chain identifiers never use JavaScript `number`.

**MVP:** Process-local single-flight and an explicitly injected proposal reservation repository retain one intent ID, nonce, and exact raw PaymentIntent payload. The in-memory adapter remains available for isolated tests. The default adapter for the local hackathon demonstration is the durable append-only journal:

```ts
const reservationRepository = await createDurableProposalReservationRepository({
  directory: ".covenant-agent-state",
});

const service = createAgentService({
  ...dependencies,
  reservationRepository,
});
```

**MVP:** The durable repository uses fixed-version `RESERVED` and `COMPLETED` records, canonical JSON SHA-256 digests, flushed append writes, and one exclusive local lock per caller-supplied storage directory. Restart recovery preserves proposal identity, intent ID, nonce, creation and expiry times, exact raw PaymentIntent payload, and completed result. Completed evidence is fully revalidated before return. A signer failure keeps the same payload for retry, while an expired retained or completed proposal is never signed or returned.

**MVP:** Call `close()` during normal shutdown to finish pending writes and release the lock. A second process or repository instance cannot use the same directory. For a confirmed stale local lock, first verify that no process owns the directory, then manually remove only `proposals.v1.jsonl.lock`; never delete or edit the journal as lock recovery.

**MVP:** The journal contains proposal coordination evidence only. It is not authoritative spend, replay, revocation, or settlement state and does not provide distributed coordination. CovenantVault remains authoritative for financial replay and spend enforcement. The durable journal only prevents accidental duplicate proposal allocation across local restarts.

**MVP:** The agent proposes. The authority decides. The executor reconstructs. The vault enforces. The agent has no authorization or execution authority.

**MVP:** This package contains no HTTP, UI, LLM, vendor fetching, pricing, Circle, RPC, wallet, funded key, authorization key, calldata construction, transaction submission, DecisionReceipt, AuthorizationReceipt, or RuleResult behavior.

## V2 procurement integration

**V2:** `createProcurementIntegration(dependencies)` is a narrow dependency-injected wrapper around the existing agent. Its only method, `procurePayment(request: unknown)`, accepts exactly `productId: "gpu-h100-hour"` and a positive USDC `maximumAmount` decimal string.

**V2:** The wrapper makes at most one call to an injected, untrusted `ProcurementInvoiceSource`. The source receives only the frozen product ID and canonical maximum amount, and its result is strictly parsed as an existing signed Invoice before any agent handoff.

**V2:** A compatible Invoice is passed unchanged to `proposePayment` with the frozen product ID and the Invoice amount as canonical `expectedAmount`. The wrapper returns the exact agent result and has no authorization, execution, transport, wallet, signing, Circle, RPC, calldata, transaction, retry, ranking, negotiation, catalog, or persistent-state capability.

**V2:** Multiple vendors, products, agents, assets, procurement schemas, and pricing models require separately approved scope.

## V2 offline Agentic API invoice source

**V2:** `createAgenticApiInvoiceSource(dependencies)` is a provider-agnostic reference adapter for the existing `ProcurementInvoiceSource` boundary. Its frozen source exposes only `requestSignedInvoice(request)`, strictly accepts the fixed product and a canonical positive USDC maximum amount, and calls an injected narrow client at most once.

**V2:** The adapter returns the client's untrusted candidate unchanged. COV-011 remains responsible for signed-Invoice validation, product compatibility, and amount-cap enforcement.

**V2:** This adapter contains no network transport, HTTP, endpoint, environment-variable, credential, header, provider SDK, retry, wallet, signer, authority, executor, Circle, RPC, transaction, calldata, submission, execution, queue, or persistent-state capability. A real provider transport requires a separately approved task and threat review.

**Production:** Distributed coordination, database replication, backup, operational lock recovery, finalized-vault reconciliation, managed proposal-signing custody, monitoring, rate limits, incident response, credential rotation, and high availability are deferred.

**Protocol:** Generic policy languages, generalized procurement protocols, arbitrary execution, and multichain behavior are excluded.
