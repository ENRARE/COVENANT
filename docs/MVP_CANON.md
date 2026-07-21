# MVP canon

## Product claim

**MVP:** Covenant demonstrates bounded financial authority for autonomous software: AI proposes, Covenant authorizes, Circle executes, and Arc settles.

**MVP security invariant:** No component capable of generating payment requests shall possess authority to execute payments.

## Frozen demonstration

**MVP:** The demonstration contains exactly one organization, one procurement agent, one Covenant, one approved GPU vendor, one attacker address, one immutable CovenantVault, one Arc Testnet deployment, one USDC asset, one successful payment, one indirect prompt-injection attack, one rejected malicious payment, one direct vault bypass attempt, one revocation, one audit timeline, and one three-minute demonstration.

## COV-001 deliverable

**MVP:** This issue establishes the monorepo, security documents, strict schemas, exact six-decimal money representation, EIP-712 builders, deterministic fixtures, and CI. It intentionally supplies no product or payment behavior.

## Frozen execution sequence

1. **MVP:** The untrusted procurement agent creates a `PaymentIntent` from vendor content.
2. **MVP:** The authority service validates schemas, invoice context, Covenant policy, and current onchain state.
3. **MVP:** The isolated signer creates an exact, short-lived `AuthorizationReceipt` only after approval.
4. **MVP:** The executor submits the exact signed fields through Circle without modifying them.
5. **MVP:** The immutable Arc vault enforces recipient, token, amount, total budget, payment count, validity, revocation, and replay constraints.
6. **MVP:** The audit timeline records proposals, decisions, authorizations, submissions, settlement, rejection, bypass failure, and revocation without becoming authoritative spend state.

## Excluded now

- **V2:** Multiple organizations, agents, vendors, assets, policy variants, and additional chains.
- **Production:** Real-value deployment, production credentials, high availability, managed key custody, compliance operations, incident response, and disaster recovery.
- **Protocol:** Generic policy languages, arbitrary calls, permissionless extension, multichain governance, and upgradeable vaults.

Any change to this canon requires founder approval and a new architecture decision.
