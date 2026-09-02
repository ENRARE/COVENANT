# Protocol vision

## MVP proof

**MVP:** Prove that an autonomous proposer can purchase one approved GPU service without receiving payment execution authority. The proof uses exact signed fields, short-lived authorization, Circle custody, and hard onchain limits.

## V2 direction

**V2:** ADR 0022 approves Covenant Platform v1 as API-first developer
infrastructure for multiple projects and Covenant instances on Arc using USDC.
The future `@covenant/sdk` is a typed API client. Existing proposal, authority,
isolated-signer, executor, Circle, CovenantVault, Arc-evidence, and audit
boundaries remain separated.

**V2:** COV-021 through COV-027 are the concise approved sequence, but each COV
requires its own reviewed implementation scope. Platform v1 does not authorize
additional chains or assets, generic policy interpretation, or arbitrary
execution.

## Production posture

**Production:** Make the model operable with real funds through hardened key custody, reconciled execution, observability, recovery, compliance, and independently reviewed controls.

## Protocol horizon

**Protocol:** Covenant may become a standard format for portable, verifiable, least-authority financial delegation. Protocol evolution must preserve deterministic meaning, explicit domain separation, immutable authorization fields, and onchain authoritative spend/replay state.

**Protocol excluded:** Arbitrary smart-contract execution, open-ended policy interpretation, hidden upgrade paths, and authorization by the proposing agent are incompatible with the current security thesis.
