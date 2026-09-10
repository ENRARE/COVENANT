# Platform v1 developer-release deployment

**V2:** This guide deploys the bounded **Covenant Platform v1 Developer
Release — Arc Testnet**. It does not authorize mainnet, real funds, production
credentials, or anonymous project provisioning.

## Runtime

- Node.js 22 or newer and pnpm 11.7.0 (the repository `packageManager`).
- PostgreSQL/Supabase-compatible persistence uses the committed migrations
  through the packaged deployment module and its `pg` connection pool. The
  included Node `node:sqlite` store is a
  deterministic local/developer adapter, not a financial ledger or HA
  guarantee.
- Apply migrations in filename order: COV-023 durable runtime, COV-024
  developer API tables, then COV-027 release constraints. Do not move spend,
  replay, revocation, or payment authority into the database.

## Provider-neutral container

`Dockerfile` provides a provider-neutral API image. It uses Node 24 and pnpm
11.7.0, installs from the frozen lockfile, builds only the API dependency
closure (`@covenant/api`, `@covenant/runtime`, `@covenant/core`,
`@covenant/spec`, and `@covenant/config`), and runs `dist/main.js` as the
non-root `node` user. Foundry, tests, web assets, and development tooling are
not copied into the final image.

The executor is a separate service (`pnpm --filter @covenant/executor start`).
It loads `COVENANT_EXECUTOR_SERVICE_MODULE`, binds the authenticated worker
routes, and keeps Circle/provider credentials and signer material in that
service's environment only. The API image never imports or receives those
credentials.

When using Railway or another service-based builder, select the Dockerfile per
service: the API uses the existing root `Dockerfile`, while the executor uses
`Dockerfile.executor`. The executor image starts `node dist/worker-main.js`,
exposes only the worker port (`8788` by default), and must receive its
provider-owned service module and secrets only through the worker service.
Set Railway's executor service variable
`COVENANT_EXECUTOR_SERVICE_MODULE=./dist/deployment-service.js`. The module
loads the public CovenantSpec trust anchor named by
`COVENANT_EXECUTOR_COVENANT_SPEC_FILE` and the isolated signer descriptor named
by `EXECUTOR_SIGNER_SOURCE`. For the reviewed COV-010 deployment, the executor
image contains the non-secret trust anchor and Railway must set:

```text
COVENANT_EXECUTOR_COVENANT_SPEC_FILE=/app/deployment/arc-testnet/cov010-runtime-trust-anchor.json
```

The artifact is a reconstructed runtime projection of independently verified
COV-010 immutable deployment evidence. Historical CovenantSpec `createdAt` was
not recovered. Its `createdAt` is deterministically normalized to
`validAfter = 1785615913` only to satisfy the frozen CovenantSpec schema; it is
not historical signed CovenantSpec evidence and must never be represented as
the original `createdAt`. The artifact is unsigned and does not change V1
EIP-712 fields or verification. The signer descriptor remains deployment-owned
secret configuration and is never included in the image.

The API authorization resolver cannot consume this exact single-artifact shape:
it requires a project-bound `entries` wrapper. The API image therefore includes
the reviewed public wrapper derived from this exact CovenantSpec. For the
reviewed Platform v1 Arc Testnet project, set:

```text
COVENANT_AUTHORIZATION_SPEC_FILE=/app/deployment/arc-testnet/cov010-api-authorization-spec.json
```

Do not mutate or reinterpret the executor artifact, and do not add a second
authorization path.

The packaged authorization-resolver entrypoint performs read-only signature
verification against Arc Testnet. It derives the expected signer and the exact
existing EIP-712 digest from the immutable CovenantSpec. An expected signer
without deployed bytecode is verified with the historical V1 ECDSA recovery
rules. An expected signer with deployed bytecode is called through ERC-1271
`isValidSignature(bytes32,bytes)` and must return `0x1626ba7e`. This applies to
the agent signer on PaymentIntent and the authorization signer on both receipt
types; it is not hard-coded to one envelope.

`COVENANT_ARC_RPC_URL` is deployment-owned, credential-free HTTPS configuration
and is never accepted from an API request. The RPC must report Arc Testnet chain
ID `5042002`; startup/readiness and verification fail closed on a missing or
malformed URL, another chain, RPC failure, bytecode-read failure, contract
revert, malformed return, or wrong magic value. These calls are read-only. The
RPC grants no signing, Circle, transaction-writing, policy, or execution
authority to the API.

The service module must construct the existing `ExecutorService` with its
reviewed `CovenantProvider`, `TransactionTransport`, `Clock`, and a durable
`CircleOperationRepository` (for example the existing file journal). The
repository itself does not invent environment names for provider credentials:
the module owns those bindings. Its reviewed inputs are Arc RPC, the fixed
CovenantVault address, Circle/provider API credentials, the Circle wallet
identity, and the isolated executor signer. Values are never committed here.

Build the image from a clean checkout:

```text
docker build -t covenant-api:platform-v1 .
```

The image defaults to `0.0.0.0:8787` and creates `/var/lib/covenant` for a
mounted persistent volume. Supply deployment configuration through the host
secret manager or an untracked environment file; never bake it into the image.
Resolver and execution-adapter modules are deployment-owned and should be
mounted read-only (or supplied by the selected host) with absolute module
paths. Deployment mode intentionally fails closed when either module is
missing or invalid.

The API image includes the reviewed PostgreSQL store entrypoint. For Railway,
set this exact value (relative paths resolve from `/app`):

```text
COVENANT_DATABASE_MODULE=./dist/deployment/postgres-runtime-store.js
```

**V2:** Keep the executor service private in Railway: do not generate a public
domain for it. Railway private-network traffic uses the internal service DNS
name and is encrypted by Railway's WireGuard mesh, so this internal hop uses
`http://` rather than a public TLS endpoint. Configure the API service with
these exact non-secret values:

```text
COVENANT_EXECUTION_ADAPTER_MODULE=./dist/deployment/execution-adapter-entrypoint.js
COVENANT_EXECUTOR_WORKER_TRANSPORT=railway-private
COVENANT_EXECUTOR_WORKER_URL=http://covenant-executor.railway.internal:8788
```

Set `COVENANT_EXECUTOR_WORKER_AUTH_TOKEN` to the same secret of at least 32
characters in the API and executor services. The `railway-private` gate accepts
plain HTTP only for an origin whose hostname ends exactly in
`.railway.internal`; it rejects credentials, non-root paths, queries,
fragments, HTTPS, public hosts, and private IP literals. Without this gate, the
existing HTTPS requirement remains in force for non-loopback hosts.

**V2:** A deployment with more than one immutable CovenantVault must retain one
executor service per exact vault/spec. Configure the API with
`COVENANT_EXECUTOR_WORKER_ROUTES_FILE` instead of the single
`COVENANT_EXECUTOR_WORKER_URL`; the strict file maps exact project/Covenant
identities to private executor origins and rejects duplicates or unmapped
operations. The reviewed preparation procedure for the next Arc Testnet demo
Covenant is in `docs/ARC_TESTNET_FRESH_DEMO_PROVISIONING.md`.

## Required configuration

Set `COVENANT_MODE=deployment` and provide:

```text
COVENANT_API_HOST
COVENANT_API_PORT
COVENANT_DATABASE_DRIVER         # sqlite or postgres; explicit, never inferred
COVENANT_DATABASE_FILENAME       # sqlite only
COVENANT_DATABASE_URL            # postgres only; supplied to the DB module
COVENANT_DATABASE_MODULE         # postgres only; deployment-owned store module
COVENANT_WEBHOOK_MASTER_KEY       # 32 bytes, hex or base64url
COVENANT_AUTHORIZATION_RESOLVER_MODULE
COVENANT_AUTHORIZATION_SPEC_FILE  # mounted, public CovenantSpec trust anchors
COVENANT_EXECUTION_ADAPTER_MODULE
COVENANT_EXECUTOR_WORKER_TRANSPORT # railway-private only for Railway private DNS
COVENANT_EXECUTOR_WORKER_URL      # HTTPS, or gated Railway private HTTP origin
COVENANT_EXECUTOR_WORKER_ROUTES_FILE # exact multi-Covenant routes; replaces URL
COVENANT_EXECUTOR_WORKER_AUTH_TOKEN # internal channel secret, >=32 characters
COVENANT_EXECUTOR_SERVICE_MODULE    # worker-only service factory module
COVENANT_EXECUTOR_COVENANT_SPEC_FILE # mounted public CovenantSpec trust anchor
COVENANT_ARC_RPC_URL              # must be https://rpc.testnet.arc.network
```

Optional bounded controls are `COVENANT_CORS_ORIGINS`,
`COVENANT_REQUEST_TIMEOUT_MS`, `COVENANT_HEADERS_TIMEOUT_MS`,
`COVENANT_MAX_BODY_BYTES`, and the `COVENANT_*_RATE_*` variables. Invalid,
missing, mainnet, or alternate-asset values fail startup without echoing
secrets. The loader fixes chain `5042002`, Arc Testnet, and six-decimal USDC.

The webhook master key must be retained across restarts. Losing it prevents
decryption of existing endpoint secrets; it cannot be regenerated from the
database. Resolver and adapter modules are deployment-owned integrations. The
resolver entrypoint loads a mounted JSON file of strict `{ projectId,
covenantSpec }` trust anchors and selects an exact project/Covenant match. The
file contains public signer identities and frozen V1 configuration only; it
must not contain private keys or signed evidence. The adapter receives only the
narrow runtime operation and the resolver verifies existing V1 authority
evidence; neither turns the API into a signer. The runtime package exports
`createIsolatedExecutorAdapter` for an adapter backed by a narrow RPC/worker
port. The deployment entrypoint posts only to the worker's
`/simulate-authorized-payment` and `/execute-authorized-payment` endpoints;
every request carries the separate `COVENANT_EXECUTOR_WORKER_AUTH_TOKEN`
channel credential. The worker rejects anonymous, non-JSON, oversized, and
unknown-route requests and never logs the credential.
Keep Circle credentials and the `@covenant/executor` service in that isolated
worker; the API-side module must contain only the RPC client and must not
acquire execution credentials.

## Start and operate

```text
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @covenant/api start
```

`apps/api/src/main.ts` constructs the durable store/runtime, validates config,
starts the Node HTTP server, and handles SIGINT/SIGTERM by stopping new work,
closing the listener, and closing the store. `GET /health` only reports process
liveness and performs no RPC or financial operation. `GET /ready` includes the
read-only Arc chain check plus internal configuration/store readiness and never
reports Circle or Arc financial success.

The container does not run migrations automatically. From a one-off Railway
shell built from the repository (with `psql` available and
`COVENANT_DATABASE_URL` injected), run exactly:

```sh
psql "$COVENANT_DATABASE_URL" --set=ON_ERROR_STOP=on --single-transaction \
  --file=supabase/migrations/20260902000000_cov023_durable_execution_runtime.sql \
  --file=supabase/migrations/20260902010000_cov024_developer_api.sql \
  --file=supabase/migrations/20260902020000_cov027_release_constraints.sql
```

Run it once against the intended developer database before starting a
multi-instance deployment, then verify the migration and uniqueness/index
checks. Do not run it automatically during every API start. A single-container local run may
use the file-backed `node:sqlite` adapter with `/var/lib/covenant` persisted;
that remains operational projection storage and is not an HA or financial
ledger guarantee.

The first project and initial test API key are provisioned through the private
administrative `CovenantApi.provisionProject` operation. No anonymous signup or
browser API-key mode exists. Use the server-side SDK only; keep keys and
webhook secrets out of source, logs, browsers, and issue trackers.

## Shutdown/restart

Graceful shutdown drains the HTTP listener and closes storage without deleting
ambiguous operations. On restart, recover expired worker leases, inspect
`AMBIGUOUS`/`SUBMITTED` operations, and reconcile known provider IDs. Never
resubmit merely because the process restarted.

## Network and release limits

Only Arc Testnet and USDC are supported. CI and this guide do not send real
USDC or use production Circle credentials. Provider acceptance is not Arc
execution, and `EXECUTED` means only the reviewed matching Arc evidence; it is
not a universal finality or irreversibility claim.

The container is an artifact, not a hosting-provider selection. No external
account, TLS endpoint, persistent database, resolver, execution adapter, or
Circle credential is bundled or created by this repository. A hosting provider
must supply those separately and classify the service as the **Arc Testnet
Developer Release** before any live smoke test.
