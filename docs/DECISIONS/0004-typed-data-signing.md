# ADR 0004: Typed-data signing

- Status: Accepted
- Date: 2026-07-21
- Scope: MVP

All capabilities in this decision are **MVP** unless explicitly labeled otherwise.

## Decision

**MVP:** CovenantSpec, PaymentIntent, Invoice, DecisionReceipt, and AuthorizationReceipt are EIP-712 payloads. Every public builder, hash, and verification boundary accepts `unknown`, strictly parses version-1 JSON and the signing domain, rejects unknown fields, and explicitly constructs the message from parsed fields.

**MVP:** PaymentIntent, Invoice, DecisionReceipt, and AuthorizationReceipt use a detached envelope containing exactly `payload` and a 65-byte hexadecimal `signature`. The signature is never included in its own digest.

**MVP:** The only domain chain is Arc Testnet `5042002`. Every domain includes `name` for object-family separation, `version` for schema separation, `chainId` for cross-chain replay resistance, and `verifyingContract` for cross-contract replay resistance. CovenantSpec and AuthorizationReceipt deployment fields must match the domain. Trusted PaymentIntent, DecisionReceipt, and AuthorizationReceipt verification derives the domain name, version, chain, and verifying contract from `CovenantSpec`; it never accepts a domain supplied beside the signed payload.

**MVP:** Low-level recovery functions prove cryptographic self-consistency for a strictly parsed envelope and domain. Covenant-anchored verification additionally requires the recovered PaymentIntent signer to equal `CovenantSpec.agentSigner` and both receipt signers to equal `CovenantSpec.authorizationSigner`. Complete authorization-chain verification additionally enforces all cross-object IDs, hashes, policy, deployment, decision, rule, amount, purpose, and temporal relationships.

**Protocol:** Multichain signing is deferred and requires a new specification.

## Signed fields

| Primary type         | Scope | Exact ordered EIP-712 fields                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CovenantSpec         | MVP   | `version:string`, `covenantId:bytes32`, `issuer:address`, `agentSigner:address`, `authorizationSigner:address`, `vaultAddress:address`, `chainId:uint256`, `tokenAddress:address`, `recipientAddress:address`, `maxAmountPerPayment:uint256`, `totalBudget:uint256`, `maxPaymentCount:uint256`, `validAfter:uint256`, `validUntil:uint256`, `purpose:string`, `policyHash:bytes32`, `policyVersion:string`, `createdAt:uint256` |
| PaymentIntent        | MVP   | `version:string`, `intentId:bytes32`, `covenantId:bytes32`, `agentSigner:address`, `recipient:address`, `token:address`, `amount:uint256`, `invoiceHash:bytes32`, `purpose:string`, `createdAt:uint256`, `expiresAt:uint256`, `nonce:uint256`                                                                                                                                                                                   |
| Invoice              | MVP   | `version:string`, `invoiceId:bytes32`, `vendor:address`, `recipient:address`, `token:address`, `amount:uint256`, `productId:string`, `purpose:string`, `issuedAt:uint256`, `expiresAt:uint256`, `nonce:uint256`                                                                                                                                                                                                                 |
| DecisionReceipt      | MVP   | `version:string`, `decisionId:bytes32`, `covenantId:bytes32`, `intentId:bytes32`, `intentHash:bytes32`, `decision:string`, `ruleResultsHash:bytes32`, `policyVersion:string`, `createdAt:uint256`, `signer:address`                                                                                                                                                                                                             |
| AuthorizationReceipt | MVP   | `version:string`, `authorizationId:bytes32`, `decisionId:bytes32`, `covenantId:bytes32`, `intentHash:bytes32`, `vaultAddress:address`, `chainId:uint256`, `policyVersion:string`, `authorizationNonce:uint256`, `validUntil:uint256`, `signer:address`                                                                                                                                                                          |

## Canonical RuleResult commitment

**MVP:** The collection contains exactly this order: `covenant_active`, `intent_signature_valid`, `agent_authorized`, `recipient_allowed`, `token_allowed`, `amount_within_limit`, `invoice_signature_valid`, `invoice_matches_intent`, `purpose_allowed`, `intent_not_expired`, `nonce_unused`. Duplicate, missing, extra, reordered, empty, shorter, or longer input is rejected; it is never sorted.

**MVP:** Each rule hash is:

```text
typeHash = keccak256("RuleResult(string ruleId,string status,string expected,string actual,string reason)")
ruleHash = keccak256(abi.encode(typeHash,
  keccak256(bytes(ruleId)), keccak256(bytes(status)),
  keccak256(bytes(expected)), keccak256(bytes(actual)),
  keccak256(bytes(reason))))
collectionHash = keccak256(concat(ruleHash[0], ..., ruleHash[10]))
```

**MVP:** DecisionReceipt signs `ruleResultsHash`. Verification reparses the envelope and canonical rules, recomputes and compares the hash, requires `APPROVED` exactly when all 11 statuses are `PASS`, recovers the signer, compares it with `payload.signer` for self-consistency, and then requires both values to equal `CovenantSpec.authorizationSigner` for trusted verification. A rejected decision can never enter a valid authorization chain.

## Fixed fixture values

**MVP:** These addresses are deterministic, synthetic, unfunded test identities or inert addresses. No private key is stored.

```text
issuer                0x7564105E977516C53bE337314c7E53838967bDaC
agentSigner           0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A
authorizationSigner   0x1563915e194D8CfBA1943570603F7606A3115508
vendor                 0x5CbDd86a2FA8Dc4bDdd8a8f69dBa48572EeC07FB
vault                  0x4000000000000000000000000000000000000004
token                  0x5000000000000000000000000000000000000005
recipient              0x6000000000000000000000000000000000000006
attacker               0x9000000000000000000000000000000000000009
chainId                5042002
domain version         1
domain names           Covenant CovenantSpec | Covenant PaymentIntent | Covenant Invoice | Covenant DecisionReceipt | Covenant AuthorizationReceipt
```

**MVP CovenantSpec:** `version=1`; `covenantId=0x01` repeated 32 bytes; addresses as above; `maxAmountPerPayment=5000.000000`; `totalBudget=10000`; `maxPaymentCount=2`; `validAfter=1784563200`; `validUntil=1785168000`; `purpose=Purchase approved GPU compute`; `policyHash=0x07` repeated 32 bytes; `policyVersion=gpu-policy-1`; `createdAt=1784563140`; digest `0xa1dd0772ae9fb7371abcef970ff4367958d64de1b7a46dd0992ce85ee58dd431`.

**MVP SignedPaymentIntent:** `version=1`; `intentId=0x02` repeated 32 bytes; Covenant ID above; agent, recipient, and token above; `amount=1.25`; `invoiceHash=0x08` repeated 32 bytes; same purpose; `createdAt=1784563260`; `expiresAt=1784563560`; `nonce=1`; digest `0x83aa530f535bee63287ee8f5b759f618d554290e16af53e4ca3ab44310d70a6a`; signature `0xd8fad9df5ebd761b7469ab590b249fad05a2a971f718cae81205d4ffb5f9236c7bbb9af877aeb54656b61d6fe19a3952f6dfa4da0d12309d546a89fe957778bf1c`.

**MVP SignedInvoice:** `version=1`; `invoiceId=0x03` repeated 32 bytes; vendor, recipient, and token above; `amount=1.25`; `productId=gpu-a100-hour`; same purpose; `issuedAt=1784563200`; `expiresAt=1784563500`; `nonce=1`; digest `0x789f308e11729368021340828de895ca62552af322203d78bd0cfb05a0c2260c`; signature `0x58d28230adc85e6794192f92c06ae48c20eb3f305951088d6bb47e8697648ecb6b5243992ddbb2a2c0507a94cae2a82e0f6fad1418f76361ce770f419992a71a1c`.

**MVP approved rules:** Every canonical rule has `status=PASS`, `expected=policy requirement satisfied`, `actual=policy requirement satisfied`, and `reason=<ruleId> passed`. Collection hash: `0xe8b4ef3da77533268c0df099c47d769f78e55401e759bf5e7fdbd2adda2aa152`.

**MVP rejected rules:** Every rule matches the approved fixture except `recipient_allowed`, which has `status=FAIL`, expected recipient `0x6000000000000000000000000000000000000006`, actual attacker `0x9000000000000000000000000000000000000009`, and reason `Recipient is not the approved GPU vendor`. Collection hash: `0xe280907f5bfae2f313b1d0867b51ec583da74c51801b5dc8c55d75af7c3b3415`.

**MVP approved SignedDecisionReceipt:** `version=1`; `decisionId=0x04` repeated 32 bytes; Covenant and intent IDs above; `intentHash=0x83aa530f535bee63287ee8f5b759f618d554290e16af53e4ca3ab44310d70a6a`; `decision=APPROVED`; approved rules hash above; `policyVersion=gpu-policy-1`; `createdAt=1784563300`; signer above; digest `0x3dbcb2219a4a2b2dd8eae06fdb8c15d322ab0aa206705e5cff3e66c89a8eb77f`; signature `0x6e9729450e49eafc39953bbe7c3671a78c15c0262a075115d526c6eb7ce100677832b9db0affd4073ce4db47c1d40ac66c81810fed9772efd22466e0f9f4fda71c`.

**MVP rejected SignedDecisionReceipt:** same linked fields; `decisionId=0x05` repeated 32 bytes; `decision=REJECTED`; rejected rules hash above; `createdAt=1784563310`; digest `0xe2eca112bfc69f9d9ff3c3f22b31fb3d1d142487f935278afd8d314fea31d38e`; signature `0xb0a2f0be212f2bc27ce568c7270803336ca5dd051701a3f0618d4fc05a2935b2215139d688d45c8b8cdd67e97fa88885760ddae280393d9f987fa8eb003e613d1c`.

**MVP SignedAuthorizationReceipt:** `version=1`; `authorizationId=0x06` repeated 32 bytes; approved decision, Covenant, intent hash, vault, and chain above; `policyVersion=gpu-policy-1`; `authorizationNonce=1`; `validUntil=1784563440`; signer above; digest `0x8d0587bee7b740a10b9ea4ae96568c119f855ab45aa66ef2d7850d49f9303be4`; signature `0xf88740efc167d96127919530780f413ae144c749e00a6423f0d2ec49d3751077165cbac06f828b11ce3a7075d4156f82432a33f9984f865d61871dfb0e35866b1c`.

## Tests and limitation

**MVP:** Tests assert strict parsing at every public boundary, independent frozen schema/typed-field parity, mutation of each mutable signed field, immutable version/chain rejection, detached-signature exclusion, Covenant-anchored signature recovery, attacker self-signing rejection, complete authorization linkage, canonical rule validation, domain separation, malformed signatures, and fixed hashes.

**MVP:** Trusted TypeScript and Solidity verification accept only canonical 65-byte ECDSA signatures with nonzero `r` and `s`, `v` equal to 27 or 28, low-`s`, and a nonzero recovered signer. Solidity uses OpenZeppelin ECDSA; TypeScript performs the equivalent canonical-form checks before viem recovery. High-`s` twins are rejected on both boundaries. Replay identity uses signed message digests, identifiers, and nonces, never signature bytes. No custom cryptography is implemented.

**MVP:** COV-002 proves TypeScript/Solidity runtime parity for PaymentIntent and AuthorizationReceipt struct hashes, EIP-712 digests, domain separators, dynamic string hashing, and canonical low-`s` signature acceptance. Fixed fixtures test pure hashing, while execution tests sign for the actual deployed vault address.

**MVP deferred:** CovenantSpec, Invoice, and DecisionReceipt Solidity hashing parity is not claimed because those objects are not required by CovenantVault runtime behavior.
