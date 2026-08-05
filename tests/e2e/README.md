# End-to-end tests

**MVP:** Playwright builds and starts the production `apps/web` server, then verifies the COV-016 read-only audit console at desktop and mobile widths. Coverage is limited to deterministic rendering, evidence classification, claim-boundary labels, local-only requests, and ephemeral filtering; it does not exercise or imply payment authority, live execution, settlement, or finality.

**MVP:** Provision the lockfile-pinned Playwright-managed Chromium once with `pnpm e2e:install-browser`. The command invokes the repository-local `@playwright/test` CLI and installs Chromium only. After provisioning, the suite needs no internet access and never downloads a browser during verification.

**MVP:** Run the suite with `pnpm test:e2e`. It first runs the repository-owned preflight against the exact Chromium executable path reported by the installed Playwright version. An absent executable fails without downloading or exposing its expected path and prints exactly: `Playwright Chromium is not provisioned. Run "pnpm e2e:install-browser" before "pnpm test:e2e".` The standalone check is `pnpm e2e:preflight`.

**MVP:** The `chromium-desktop` project uses a fixed `1440 x 900` viewport and `chromium-mobile` uses `390 x 844`. Both use Playwright-managed Chromium; no system browser, browser channel, `executablePath`, Firefox, or WebKit is configured.

**MVP:** The repository-owned E2E runner invokes the `apps/web`-local Next.js CLI directly to run `next build` and then `next start --hostname 127.0.0.1 --port 3100`. It requires an HTTP 200 response from exactly `http://127.0.0.1:3100/` before Playwright starts, never uses `next dev`, and always stops only the Next.js child it created.

**MVP:** Playwright's `webServer` plugin is intentionally not used because its shell-owned teardown differs across platforms. The same repository-owned lifecycle runs on Windows and CI, never reuses a server, and fails with `COV-016 E2E origin is already in use. Stop the process listening on http://127.0.0.1:3100 and retry.` when the fixed origin is occupied.

**MVP:** The repository-owned Node runner preserves the caller environment while setting `NEXT_TELEMETRY_DISABLED=1` for Playwright, the production build, and the production server. Collection-only commands skip build and server startup. Executable commands use bounded readiness and cleanup checks, require the fixed origin to be free before startup and released afterward, and use no Unix-only or PowerShell-only assignment syntax.

**MVP:** An automatic fixture installs HTTP and WebSocket interception before each test body can navigate. It permits only HTTP requests with the exact `http://127.0.0.1:3100` origin, including same-origin paths, queries, and Next.js assets. It aborts and fails on every other origin or protocol, all WebSockets, and external workers, fonts, images, analytics, APIs, scripts, or styles; service workers are disabled in configuration.
