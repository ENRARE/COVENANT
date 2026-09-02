# Covenant Platform v1 canon

## Status and relationship to the MVP

**V2:** COV-021 approves this bounded Platform v1 architecture and public
contract as the first post-hackathon evolution of Covenant. It documents future
runtime work; it does not implement the platform API or SDK.

**MVP:** COV-001 through COV-020 remain a frozen completed historical proof.
`docs/MVP_CANON.md` remains its governing record and is not superseded or
rewritten by this document.

## Product claim

**V2:** Covenant Platform allows developers to integrate bounded programmable
USDC authority into applications without giving the proposing software
unrestricted payment execution authority.

> **V2 security invariant:** No component capable of generating payment
> requests shall possess authority to execute payments.

**V2:** Platform v1 supports multiple developer projects and multiple Covenant
instances on Arc using six-decimal USDC. It exposes reusable API and future
TypeScript SDK access while preserving deterministic auditability, isolated
authorization, Circle-backed submission, and CovenantVault enforcement.

## Platform layers and trust boundaries

```text
Application
    |
    v
SDK
    |
    v
API --------------------------> Audit
    |
    v
Covenant domain/core
    |
    v
Authority
    |
    v
Signer
    |
    v
Executor
    |
    v
Circle
    |
    v
CovenantVault
    |
    v
Arc
```

| Layer                | Scope | Responsibility                                                                                                                            | Trust and authority boundary                                                                                       |
| -------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Application          | V2    | Creates product intent and requests Platform operations.                                                                                  | Untrusted for financial authorization; receives no Circle or authorization-signing credential.                     |
| SDK                  | V2    | Provides typed convenience over the public API.                                                                                           | Client-only; API access is not financial authority and the SDK has no execution wallet.                            |
| API                  | V2    | Authenticates project access, strictly validates public input, coordinates domain operations, and returns stable resource/evidence views. | A request is not authorization; the API cannot bypass authority, signer, executor, or vault checks.                |
| Covenant domain/core | V2    | Owns public resource semantics, lifecycle rules, project/Covenant isolation, and mapping to existing bounded services.                    | Operational state may coordinate work but cannot replace onchain spend or replay authority.                        |
| Authority            | V2    | Evaluates validated context and creates deterministic policy decisions using trusted Covenant and onchain evidence.                       | No Circle credential, wallet, or payment submission authority.                                                     |
| Signer               | V2    | Issues exact, short-lived signed authorization only for an approved decision.                                                             | Isolated from proposal generation and execution credentials.                                                       |
| Executor             | V2    | Verifies the signed chain, constructs the one reviewed vault call, and submits authorized fields unchanged.                               | Cannot propose, authorize, select arbitrary transactions, or alter financial intent.                               |
| Circle               | V2    | Provides custody-assisted submission of the reviewed CovenantVault call.                                                                  | Provider acceptance is transport evidence, not Arc execution, settlement, or policy truth.                         |
| CovenantVault        | V2    | Enforces immutable recipient/token/amount/budget/count/time/revocation/replay controls and token movement.                                | Authoritative for onchain financial and replay state; no contextual policy interpreter or arbitrary call surface.  |
| Arc                  | V2    | Hosts CovenantVault and its onchain execution/state evidence.                                                                             | Only Platform v1 settlement network; observation strength is limited by the reviewed evidence and finality policy. |
| Audit                | V2    | Deterministically projects sanitized proposal, decision, authorization, transport, and Arc evidence.                                      | Read-only, observational, reconstructable, and non-authoritative; cannot drive execution or retries.               |

## Initial Platform v1 boundary

- **V2:** Multiple authenticated developer projects are isolated from one
  another at every API, persistence, idempotency, and audit query boundary.
- **V2:** Each project may own multiple conceptual Covenant resources.
- **V2:** Arc is the only network and six-decimal USDC is the only settlement
  asset. These are trusted server-side selections, not arbitrary caller input.
- **V2:** Platform v1 reuses the existing least-authority flow and Circle
  executor boundary.
- **V2:** Offchain storage may hold project metadata, workflows, idempotency
  records, provider observations, and audit projections. It never becomes the
  authoritative budget, spend, payment-count, revocation, or replay ledger.
- **Protocol:** Arbitrary contract execution, generic policies, arbitrary assets,
  and multichain operation are outside Platform v1.

## Conceptual public Covenant resource

**V2:** The future API will expose a public Covenant resource approximately
containing the following semantics. This is a conceptual contract, not a
TypeScript schema or implemented response in COV-021.

| Field                                   | Scope | Meaning                                                                                                                |
| --------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| `id`                                    | V2    | Stable Platform Covenant identifier.                                                                                   |
| `projectId`                             | V2    | Owning developer project; never caller-overridable after creation.                                                     |
| `parties`                               | V2    | Explicit public identities and roles relevant to the Covenant; no private key material.                                |
| `payer`                                 | V2    | Party whose bounded onchain Covenant funds the payment.                                                                |
| `beneficiary`                           | V2    | Authorized USDC recipient for this Covenant/payment intent.                                                            |
| `asset`                                 | V2    | Fixed Platform v1 asset descriptor for six-decimal USDC.                                                               |
| `amount`                                | V2    | Canonical positive USDC decimal string; never a JavaScript floating-point number.                                      |
| `network`                               | V2    | Fixed Arc network identity and chain ID `5042002`.                                                                     |
| `conditions`                            | V2    | Reference to an explicitly supported, versioned Covenant condition/policy configuration; not a generic policy program. |
| `authorizationStatus`                   | V2    | Separate policy-decision and signed-authorization facts, including expiry where applicable.                            |
| `executionStatus`                       | V2    | Separate executor, Circle transport, and independent Arc observation facts.                                            |
| `status`                                | V2    | Derived lifecycle state defined below; never a substitute for evidence-specific status.                                |
| `createdAt` / `updatedAt` / `expiresAt` | V2    | Canonical timestamps with defined ownership and monotonic update rules.                                                |
| `auditReference`                        | V2    | Stable reference to the non-authoritative deterministic audit view.                                                    |

**V2:** The public resource is not identical to `CovenantSpec`,
`PaymentIntent`, `Invoice`, `DecisionReceipt`, or `AuthorizationReceipt`.
Existing signed version-1 schemas remain unchanged and retain their historical
meaning. Any incompatible public or signed representation must be introduced
under an explicit version rather than reinterpreting version `1`.

## Lifecycle and evidence semantics

**V2:** Platform lifecycle state summarizes orchestration; the resource must
also expose evidence-specific authorization and execution status so distinct
facts are not collapsed.

| State                    | Scope | Meaning                                                                                                                                                                                                                              |
| ------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CREATED`                | V2    | The project-scoped resource exists. No policy approval or signed authorization is implied.                                                                                                                                           |
| `AWAITING_AUTHORIZATION` | V2    | The resource is eligible for an authorization request but no valid signed authorization is recorded.                                                                                                                                 |
| `AUTHORIZED`             | V2    | An approved policy decision and linked, valid signed AuthorizationReceipt are present. API authentication alone cannot produce this state.                                                                                           |
| `EXECUTING`              | V2    | Execution has been requested and may be prepared, simulated, submitted, provider-observed, or outcome-unknown. This state makes no Arc success, settlement, or finality claim.                                                       |
| `EXECUTED`               | V2    | Reviewed independent Arc evidence observed the exact successful CovenantVault call and required effects. This means no more than the evidence currently proves; it is not automatically a payment-finality or irreversibility claim. |
| `REJECTED`               | V2    | Contextual policy evaluation produced a signed rejection. No authorization or execution may descend from it.                                                                                                                         |
| `CANCELLED`              | V2    | The platform accepted a cancellation before submission began and will not initiate authorization/execution. It does not revoke onchain authority or reverse/stop an already submitted transaction.                                   |
| `EXPIRED`                | V2    | A controlling Covenant, intent, invoice, or authorization validity window closed before the next permitted action.                                                                                                                   |
| `FAILED`                 | V2    | A terminal operational failure is independently known and no ambiguous submission may be hidden by this state. A possibly submitted operation remains `EXECUTING` with outcome-unknown evidence.                                     |

**V2:** The initial happy-path transition is:

```text
CREATED -> AWAITING_AUTHORIZATION -> AUTHORIZED -> EXECUTING -> EXECUTED
```

**V2:** Policy rejection transitions `AWAITING_AUTHORIZATION` to `REJECTED`.
Cancellation is permitted only before submission starts. Expiry applies when a
controlling validity window closes. A later implementation must freeze the
complete transition table and concurrency rules before exposing mutations.

**V2:** These facts remain separate:

1. **V2:** A policy decision says whether validated context passed the reviewed
   rules; it is not signed payment authority by itself.
2. **V2:** Authorization is the exact linked, short-lived signed grant produced
   after approval.
3. **V2:** Circle submission or provider acceptance says only that transport
   may have accepted an asynchronous operation.
4. **V2:** Independent Arc observation may prove a reverted call, a successful
   exact vault call, conflicting evidence, no observation, or unavailable
   observation.
5. **V2:** Settlement and payment finality are separate claims and require the
   exact evidence and policy approved for those terms. COV-021 adds neither.

## Conceptual REST API v1

**V2:** The intended initial resource-oriented surface is:

| Operation                          | Scope | Architectural mapping                                                                                                                        |
| ---------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/covenants`               | V2    | Create a strict project-scoped Covenant resource; does not authorize or execute it.                                                          |
| `GET /v1/covenants/:id`            | V2    | Retrieve one project-isolated resource and its evidence-specific status.                                                                     |
| `GET /v1/covenants`                | V2    | List only the authenticated project's resources with bounded pagination/filter semantics.                                                    |
| `POST /v1/covenants/:id/authorize` | V2    | Request current authority evaluation and, only after approval, isolated signing. API access is insufficient authorization.                   |
| `POST /v1/covenants/:id/execute`   | V2    | Request execution of an existing valid authorization through the reviewed executor/Circle/vault path. No financial fields may be overridden. |
| `POST /v1/covenants/:id/cancel`    | V2    | Stop future platform orchestration only where no submission has begun; not an onchain reversal or revocation.                                |
| `GET /v1/covenants/:id/audit`      | V2    | Return the deterministic non-authoritative audit view/reference for that resource.                                                           |
| `GET /v1/executions/:id`           | V2    | Retrieve transport and Arc-observation facts without collapsing them into settlement/finality.                                               |

**V2:** Later API implementation must include strict versioned input/output
schemas, API authentication, project isolation, durable idempotency for every
mutation, stable sanitized errors, request IDs, bounded pagination, and
authenticated/replay-resistant webhook or event delivery. COV-021 implements
none of these.

**V2:** Every mutating action must map to a reviewed domain capability.
`authorize` cannot bypass the authority and signer; `execute` cannot construct
new financial intent; and `cancel` cannot pretend to stop an ambiguous or
already submitted chain operation.

## Future TypeScript SDK contract

**V2:** `@covenant/sdk` will be the typed TypeScript client for the REST API.
It may eventually expose `covenants.create`, `covenants.retrieve`,
`covenants.list`, `covenants.authorize`, `covenants.execute`,
`covenants.cancel`, `covenants.audit`, `executions.retrieve`, and
`webhooks.verify`.

**V2:** The SDK will own request construction, response typing, stable error
mapping, request-ID propagation, idempotency-key support, and webhook
verification ergonomics once those contracts are separately implemented. It
will not own policy evaluation, authorization keys, Circle credentials, wallet
execution, generic calldata, or an alternative direct-to-Arc execution path.

## Approved implementation sequence

1. **V2 — COV-021:** Platform architecture and public contract.
2. **V2 — COV-022:** Generalized Covenant core.
3. **V2 — COV-023:** Production-style execution runtime and persistence.
4. **V2 — COV-024:** Developer REST API.
5. **V2 — COV-025:** `@covenant/sdk`.
6. **V2 — COV-026:** Dogfood the existing Covenant app and add bounded
   reference integrations.
7. **V2 — COV-027:** Security, reliability, and Platform v1 release.

## Deferred boundaries

- **V2:** COV-022 through COV-027 require their own reviewed scope and are not
  implemented or implicitly authorized by COV-021.
- **Production:** Real funds, production credentials, hardware-backed custody,
  high availability, monitoring, incident response, compliance, disaster
  recovery, external audits, and production operational claims remain deferred
  until separately authorized.
- **Protocol:** Generic policy languages, arbitrary smart-contract execution,
  arbitrary wallet operations, permissionless extensions, and broad multichain
  behavior remain deferred.
