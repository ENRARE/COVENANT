# Security boundaries

## Trust rules

- **MVP:** The browser is untrusted; it renders projections and submits user intent but never establishes authorization truth.
- **MVP:** The procurement agent is untrusted; it proposes payments and may be fully compromised.
- **MVP:** Vendor content and invoice transport are untrusted until signature and schema validation succeed.
- **MVP:** Supabase is not the authoritative spend ledger; it stores reconstructable projections and audit records only.
- **MVP:** The authority service decides contextual authorization from validated inputs and current authoritative state.
- **MVP:** The isolated authorization signer grants exact, short-lived authority after an approved decision.
- **MVP:** The executor submits signed fields but cannot choose, replace, or mutate payment fields.
- **MVP:** Circle manages wallet execution credentials and submits the vault transaction.
- **MVP:** The Arc `CovenantVault` enforces hard financial limits.
- **MVP:** The Arc `CovenantVault` owns authoritative spend, payment-count, revocation, and replay state.

## Component ownership and prohibitions

| Component                          | Scope | Secrets owned                                               | Permitted action                                 | Prohibited action                                                                |
| ---------------------------------- | ----- | ----------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------- |
| Browser                            | MVP   | User session token only when later implemented              | Display non-authoritative state; request actions | Hold signing or Circle credentials; decide authorization; claim settlement truth |
| Procurement agent                  | MVP   | Agent identity key only when later implemented              | Sign and propose `PaymentIntent`                 | Hold funds, Circle credentials, or authorization key; authorize or execute       |
| Authority service                  | MVP   | Service authentication material only when later implemented | Validate context and produce `DecisionReceipt`   | Custody funds; submit payments; treat database budget as authoritative           |
| Authorization signer               | MVP   | Authorization signing key only when later implemented       | Sign exact approved `AuthorizationReceipt`       | Generate intents; change decisions; execute payments                             |
| Executor                           | MVP   | Circle API credentials only when later implemented          | Submit an exact authorized transaction           | Alter signed fields; authorize; hold authorization key                           |
| Circle developer-controlled wallet | MVP   | Wallet execution keys managed by Circle                     | Submit the specified vault call                  | Select recipient, token, or amount independently                                 |
| Arc `CovenantVault`                | MVP   | No offchain secret                                          | Enforce hard limits and authoritative state      | Make contextual policy decisions; support arbitrary calls or upgrades            |
| Supabase                           | MVP   | Database service credentials only when later implemented    | Store UI/audit projections                       | Act as authoritative spend/replay ledger or source of authorization truth        |
| GPU vendor                         | MVP   | Vendor invoice signing key                                  | Sign a specific invoice                          | Authorize payment, change Covenant policy, or execute from the vault             |

## Data-boundary rules

- **MVP:** All objects crossing a process or hash boundary are `unknown` and must pass a strict schema before use. Builders construct messages explicitly from parsed fields; unsigned extras fail before hashing.
- **MVP:** PaymentIntent, Invoice, DecisionReceipt, and AuthorizationReceipt use exact detached `{ payload, signature }` envelopes. Signatures are 65-byte hex and are excluded from their own payload digest.
- **MVP:** Money input is a bounded decimal string and becomes `bigint` base units internally; canonical output is the shortest decimal representation.
- **MVP:** Lowercase addresses normalize to EIP-55. Correct checksums are accepted; incorrect mixed-case checksums and zero security addresses fail closed.
- **MVP:** Issuer, agent, authorization signer, GPU recipient, vault, and token follow the separation rules in ADR 0002.
- **MVP:** Arc Testnet `5042002` is the only accepted chain. Protocol multichain types do not cross the public MVP boundary.
- **MVP:** EIP-712 binds object version, chain, verifying contract, and every security-critical field.
- **MVP:** DecisionReceipt is signed and commits to the exact canonical 11-rule collection hash; order is validated and never silently sorted.
- **MVP:** Signature recovery proves who signed but does not grant authority from a payload signer field. Trusted verification anchors agent and authorization signer identities to `CovenantSpec`.
- **MVP:** PaymentIntent, DecisionReceipt, and AuthorizationReceipt trusted domains are derived from the Covenant vault, frozen Arc chain, frozen version, and object-family name.
- **MVP:** Complete authorization-chain verification recomputes the intent and rule hashes; links Covenant, intent, decision, authorization, policy, vault, chain, and signer roles; requires an approved all-PASS decision; and enforces every validity relationship.
- **MVP:** The executor must compare the submitted call with signed authorization fields byte-for-byte.
- **MVP:** The vault supports only its immutable standard Arc Testnet USDC-style token and requires exact destination balance deltas for funding, payment, and withdrawal. Fee-on-transfer, rebasing, success-without-transfer, and malicious token behavior are unsupported; mismatched observable deltas revert settlement and replay/accounting writes.
- **MVP:** Runtime Solidity EIP-712 parity is limited to PaymentIntent and AuthorizationReceipt. CovenantSpec, Invoice, and DecisionReceipt are not runtime vault types.

## Deferred controls

- **Production:** Hardware-backed keys, dual control, credential rotation, network isolation, tamper-evident centralized audit storage, and incident response are deferred.
- **Production:** Continuous Circle/onchain reconciliation, redundant Arc RPCs, and formal recovery procedures are deferred.
- **Production:** No external audit or formal verification has occurred; both remain required before production use.
- **Protocol:** Cross-chain and generalized policy boundaries require new specifications and are not inherited from the MVP.
