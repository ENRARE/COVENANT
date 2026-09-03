# COV-025 SDK quickstart

**V2:** This is a minimal trusted server-side example for `@covenant/sdk`.
Install or link the SDK package before running it; no live API call is required
by the repository test suite.

Set `COVENANT_API_KEY` and `COVENANT_API_URL` in the server environment. Never
place the API key in browser or mobile code. The initial project/key is created
by the private COV-024 administrative bootstrap, not by this SDK.

```bash
pnpm add @covenant/sdk
node --experimental-strip-types index.ts
```
