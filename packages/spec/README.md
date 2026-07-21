# Specification package

**MVP:** This package is the frozen TypeScript boundary for Covenant objects, six-decimal USDC conversion, EIP-712 construction, deterministic rule-result hashing, and fixed vectors.

**MVP:** All external inputs must be parsed before hashing. JSON money, counters, chain IDs, nonces, and Unix-second timestamps are strings; safe internal forms use `bigint`. This package does not sign, submit, authorize, or settle payments.

**MVP:** Low-level recovery helpers prove cryptographic self-consistency only. Trusted verification derives signer roles and EIP-712 domains from `CovenantSpec`; `verifyAuthorizationChain` additionally verifies the complete signed Covenant-to-intent-to-decision-to-authorization relationship. A signer address inside a payload never establishes authority by itself.
