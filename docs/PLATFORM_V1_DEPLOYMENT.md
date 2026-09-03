# Platform v1 developer-release deployment

**V2:** This guide deploys the bounded **Covenant Platform v1 Developer
Release — Arc Testnet**. It does not authorize mainnet, real funds, production
credentials, or anonymous project provisioning.

## Runtime

- Node.js 22 or newer and pnpm 11.7.0 (the repository `packageManager`).
- PostgreSQL/Supabase-compatible persistence may use the committed migrations;
  the included Node `node:sqlite` store is a deterministic local/developer
  adapter, not a financial ledger or HA guarantee.
- Apply migrations in filename order: COV-023 durable runtime first, then
  COV-024 developer API tables. Do not move spend, replay, revocation, or
  payment authority into the database.

## Required configuration

Set `COVENANT_MODE=deployment` and provide:

```text
COVENANT_API_HOST
COVENANT_API_PORT
COVENANT_DATABASE_FILENAME
COVENANT_WEBHOOK_MASTER_KEY       # 32 bytes, hex or base64url
COVENANT_AUTHORIZATION_RESOLVER_MODULE
COVENANT_EXECUTION_ADAPTER_MODULE
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
adapter receives only the narrow runtime operation and the resolver verifies
existing V1 authority evidence; neither turns the API into a signer.

## Start and operate

```text
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @covenant/api start
```

`apps/api/src/main.ts` constructs the durable store/runtime, validates config,
starts the Node HTTP server, and handles SIGINT/SIGTERM by stopping new work,
closing the listener, and closing the store. `GET /health` only reports process
liveness. `GET /ready` reports internal configuration/store readiness and never
reports Circle or Arc financial success.

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
