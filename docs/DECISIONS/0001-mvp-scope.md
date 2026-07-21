# ADR 0001: Frozen MVP scope

- Status: Accepted
- Date: 2026-07-21
- Scope: MVP

## Decision

**MVP:** Freeze the demonstration to one organization, procurement agent, Covenant, approved GPU vendor, attacker address, immutable CovenantVault, Arc Testnet deployment, six-decimal USDC asset, successful payment, indirect prompt-injection rejection, malicious-payment rejection, direct bypass failure, revocation, audit timeline, and three-minute demonstration.

**MVP:** COV-001 implements only repository foundations, documentation, schemas, money helpers, typed-data builders, fixtures, tests, and CI.

## Exclusions

- **MVP excluded from COV-001:** Product UI, agent behavior, policy endpoints, signing, execution, Circle integration, Arc deployment, Solidity logic, Supabase migrations, vendor behavior, and attack implementation.
- **V2:** Additional tenants, agents, vendors, assets, chains, and reviewed policy modules.
- **Production:** Real funds, operational infrastructure, compliance, key custody, resilience, and incident response.
- **Protocol:** Generic policies, arbitrary calls, permissionless extensions, and upgradeability.

## Consequence

**MVP:** Scope expansion stops implementation and requires founder approval plus a superseding decision.
