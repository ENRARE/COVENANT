# Platform v1 developer quickstart

**V2:** This quickstart targets the **Covenant Platform v1 Developer Release
— Arc Testnet** and a trusted server-side application.

1. Obtain a project and initial `cov_test_...` API key through the private
   administrative bootstrap. There is no anonymous signup.
2. Install `@covenant/sdk` 0.1.0 and configure `COVENANT_API_URL` plus the API
   key in the server environment.
3. Create a Covenant with payer, beneficiary, canonical amount, supported
   policy reference, and expiry.
4. Request authorization. This only starts the authority workflow.
5. Submit the unchanged, externally generated signed authorization evidence.
   The API verifies it; the API key cannot sign or authorize money.
6. Request execution with an idempotency key and retain the returned operation
   identity.
7. Retrieve execution and audit projections. Provider acceptance is not Arc
   execution; only matching reviewed Arc evidence can produce `EXECUTED`.
8. Register a webhook endpoint if needed and verify its raw-body signature with
   the one-time endpoint secret.

Keep all keys and secrets server-side. The SDK is not a browser client, does
not read `.env`, and does not provide a direct execution path.
