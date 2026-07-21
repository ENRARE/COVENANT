# ADR 0002: Trust boundaries

- Status: Accepted
- Date: 2026-07-21
- Scope: MVP

## Decision

**MVP:** Separate proposal, contextual authorization, exact authorization signing, execution submission, and settlement enforcement.

| Stage         | Scope | Owner               | Authority                                                   |
| ------------- | ----- | ------------------- | ----------------------------------------------------------- |
| Proposal      | MVP   | Untrusted agent     | Create a signed `PaymentIntent`; no payment authority       |
| Decision      | MVP   | Authority service   | Evaluate validated context; no custody or execution         |
| Authorization | MVP   | Isolated signer     | Grant exact short-lived authority; no proposal or execution |
| Execution     | MVP   | Executor and Circle | Submit exact signed fields; no field choice or policy       |
| Settlement    | MVP   | Immutable Arc vault | Enforce authoritative limits and replay state               |

**MVP:** `issuer`, `agentSigner`, and `authorizationSigner` are pairwise distinct. The approved GPU recipient cannot equal any of those roles, the vault, or the token. Recipient equality with issuer is rejected for this MVP.

**MVP:** PaymentIntent, Invoice, DecisionReceipt, and AuthorizationReceipt cross their signing boundaries as strict detached `{ payload, signature }` envelopes. The authority later verifies the agent signature; the vendor signs invoices; the authorization signer signs decisions and exact short-lived authorizations. Signatures never enter their own digest.

**MVP:** Signature recovery establishes only which key signed a payload. It does not establish Covenant authority from a signer field inside that payload. Trusted verification derives the PaymentIntent signer, authorization signer, Arc chain, and verifying vault from the strictly parsed `CovenantSpec`.

**MVP:** Complete authorization-chain verification requires one Covenant-anchored PaymentIntent, one signed approved DecisionReceipt with all canonical rules passing, and one signed AuthorizationReceipt linked by exact Covenant ID, intent ID and digest, decision ID, policy version, vault, chain, signer roles, and validity periods. Supabase remains non-authoritative.

## Consequence

**MVP:** Compromise of the agent or executor alone cannot both choose and authorize a payment. Supabase and the browser remain non-authoritative.

**Production:** Key isolation, dual control, credential rotation, reconciliation, and monitoring must harden these logical boundaries before real funds.
