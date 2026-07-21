# Covenant

**MVP:** Covenant is programmable financial authority infrastructure for autonomous software. AI proposes, Covenant authorizes, Circle executes, and Arc settles.

> No component capable of generating payment requests shall possess authority to execute payments.

COV-001 contains repository scaffolding, frozen schemas, exact money conversion, typed-data vectors, trust boundaries, and a threat model. It contains no contract logic, Circle integration, payment execution, policy service, agent behavior, or product interface.

## Workspace

- **MVP:** `apps/web` — compile-only Next.js demonstration-console scaffold.
- **MVP:** `apps/agent` — untrusted procurement-agent scaffold.
- **MVP:** `apps/authority` — deterministic authority-service scaffold.
- **MVP:** `apps/executor` — submission-only executor scaffold.
- **MVP:** `packages/spec` — strict schemas, USDC helpers, typed data, fixtures, and tests.
- **MVP:** `packages/contracts` — Foundry-only immutable-vault scaffold.
- **MVP:** `packages/sdk` — empty SDK scaffold.
- **MVP:** `packages/config` — shared strict TypeScript configuration.

## Local validation

```sh
pnpm install --frozen-lockfile
pnpm verify
```

**MVP:** `pnpm verify` validates formatting, root and workspace lint/type checks, script and schema tests, builds, environment-file policy, repository credential scanning, and Foundry tests. Missing Forge is a hard failure. `pnpm verify:without-contracts` is the explicitly partial local command.

**MVP:** `pnpm test:integration`, `pnpm test:e2e`, and all `pnpm demo:*` commands intentionally return non-zero because those later MVP subsystems do not exist yet.

**MVP:** Security-critical JSON is strictly parsed before hashing. The four signed flows use detached `{ payload, signature }` envelopes, DecisionReceipt commits to the canonical rule collection, and only Arc Testnet chain ID `5042002` is accepted.

See [MVP canon](docs/MVP_CANON.md), [security boundaries](docs/SECURITY_BOUNDARIES.md), and [threat model](docs/THREAT_MODEL.md) before changing architecture.

## Future scope

- **V2:** Multiple actors, assets, and reviewed policy modules are deferred.
- **Production:** Real credentials, real funds, key-management infrastructure, monitoring, resilience, and compliance are deferred.
- **Protocol:** Generalized execution, policy composition, and multichain behavior are deferred.
