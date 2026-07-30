# ADR 0012: Arc Testnet readiness and read-only attestation

- Status: Accepted
- Date: 2026-07-30
- Scope: MVP

All capabilities in this decision are **MVP** unless explicitly labeled
otherwise.

## Decision

**MVP:** COV-009 adds offline deployment planning and an optional read-only Arc
Testnet preflight. It introduces no wallet, signer, account enumeration,
faucet, funding, deployment, transaction, manifest persistence, Circle API, or
broadcast authority.

**MVP:** The trusted profile is committed server-side configuration. Browser,
CLI, caller, and environment input cannot choose the endpoint, chain, token,
explorer, EVM target, ABI, or confirmation policy. Tests inject a request
function, never an endpoint.

## Frozen Arc profile

**MVP:** Official Arc and Circle sources were verified on 2026-07-30. The
profile freezes:

- **MVP:** Network `arc-testnet`, named `Arc Testnet`.
- **MVP:** Decimal chain ID `5042002`; its programmatically derived
  hexadecimal form is `0x4cef52`.
- **MVP:** Primary HTTPS `https://rpc.testnet.arc.io` and WebSocket
  `wss://rpc.testnet.arc.io`.
- **MVP:** Explorer `https://testnet.arcscan.app`.
- **MVP:** Native gas asset USDC with 18-decimal JSON-RPC accounting.
- **MVP:** Six wallet-display and ERC-20/business decimals.
- **MVP:** USDC interface
  `0x3600000000000000000000000000000000000000`.
- **MVP:** Arc documented EVM target Osaka and reviewed artifact target Prague.
- **MVP:** Deterministic BFT finality with one required committed block.

**MVP:** Arc's wallet documentation also prints `0x4CF4B2` beside decimal
`5042002`. Those values are not equal, so the hexadecimal value is derived from
the consistently documented decimal identity and `0x4CF4B2` is rejected.

**MVP:** Source URLs and verification date are provenance. They are excluded
from the security-profile digest. Operational endpoint, chain, token, decimal,
EVM, explorer, and finality fields remain inside the digest.

**MVP:** Arc warns that testnet may experience instability or unplanned
downtime. No network-reset schedule, deployment-persistence guarantee,
public-RPC rate limit, or primary-endpoint service guarantee is assumed.

## Reviewed artifact

**MVP:** Foundry explicitly targets Prague with Solidity `0.8.28`, optimizer
enabled for 200 runs, `via_ir`, and IPFS compiler metadata. Arc currently
documents Osaka, which supports the reviewed Prague instruction set. COV-009
does not recompile the vault for Osaka.

**MVP:** Making Prague explicit preserves the reviewed creation bytecode,
unpatched runtime bytecode, canonical ABI, and immutable-reference map
byte-for-byte. Solidity source, constructor, ABI, errors, events, EIP-712
domains, signed fields, and policy behavior remain unchanged.

**MVP:** Artifact validation rejects missing or empty code, linked libraries,
compiler or target drift, optimizer or metadata drift, wrong ABI, wrong code
length, invalid/overlapping/out-of-range immutable references, and any reviewed
commitment mismatch.

**MVP:** Runtime attestation compares exact length and every non-immutable byte,
including compiler metadata. Expected immutable values must cover every
compiler reference and match every repeated range. Metadata is never stripped.

## Offline deployment plan

**MVP:** The only offline command is:

```powershell
pnpm.cmd --silent arc:plan -- --input <local-json-file>
```

**MVP:** It accepts exactly `--input`, reads one bounded strict UTF-8 regular
file without following links, uses no network or environment-selected anchor,
writes no file, and emits one canonical JSON document. Fixed sanitized errors
replace raw tool, filesystem, and input details.

**MVP:** A `BROADCASTABLE` plan contains the exact source commit, profile and
artifact commitments, compiler settings, actual CovenantVault constructor,
constructor encoding digest, complete init-code hash, chain and token anchors,
deployer and payer public addresses, absolute validity, `CREATE`, and canonical
plan digest.

**MVP:** The constructor digest is
`keccak256(abi.encode(configurationTuple))`. The complete init-code hash is
`keccak256(creationBytecode || encodedConstructor)`. JSON hashing is not a
substitute for Solidity constructor encoding.

**MVP:** Deployer and transaction payer are plan metadata and participate only
in the plan digest. Vendor signer is an application identity and appears in
neither the constructor nor the constructor digest.

**MVP:** All uint256 values use canonical unsigned decimal strings. Exact
validity timestamps are caller-supplied and never silently derived. At least
seven days must remain at generation time. A plan does not authorize
broadcast.

## Future deployment manifest

**MVP:** COV-009 defines a strict future manifest schema for profile/plan
linkage, deployment receipt and block identity, contract and deployer,
artifact/constructor/init-code commitments, every immutable, toolchain, final
receipt state, verification time, and provider corroboration.

**MVP:** COV-009 creates, writes, supersedes, or commits no real manifest or Arc
contract address. Atomic persistence, overwrite prevention, historical
supersession, testnet-reset handling, and the real record belong to COV-010.

## Read-only preflight

**MVP:** The only networked command is:

```powershell
pnpm.cmd --silent arc:preflight
```

**MVP:** It has no arguments, credentials, environment overrides, persistence,
or retries. Sequential requests use five-second per-request and twenty-second
total bounds. The exact method sequence is:

1. **MVP:** `eth_chainId`.
2. **MVP:** `eth_getBlockByNumber` with `"latest", false`.
3. **MVP:** `eth_getCode` for the fixed USDC interface.
4. **MVP:** `eth_call` for `decimals()`.
5. **MVP:** `eth_call` for `symbol()`.
6. **MVP:** `eth_call` for `name()`.

**MVP:** Output contains only observation time, decimal chain ID, latest block
number/hash, and validated USDC address/code hash/metadata. It excludes endpoint
details, raw bodies, code, headers, client identity, errors, environment,
filesystem paths, and stacks.

**MVP:** Live preflight is explicitly invoked and excluded from tests, builds,
CI, installation, and `pnpm.cmd verify`. Ordinary tests use a mocked request
function. One primary-RPC result is a `READ-ONLY PRIMARY-RPC OBSERVATION`, not
independent chain authenticity, execution, or settlement proof.

## Finality and evidence vocabulary

**MVP:** `SUBMISSION_ACCEPTED` means an RPC returned a transaction hash; it
makes no execution claim.

**MVP:** `PENDING` means no committed receipt exists.

**MVP:** `RECEIPT_OBSERVED` means a provider returned a receipt.

**MVP:** `FINAL_ARC_TRANSACTION` means a receipt is included in a committed Arc
block; its status may be success or failure.

**MVP:** `SUCCESSFUL_EXECUTION` means a final receipt has successful status.

**MVP:** `FAILED_EXECUTION` means a final receipt has failure status.

**MVP:** `VAULT_EVENT_OBSERVED` means the exact expected vault event was
verified.

**MVP:** `TOKEN_MOVEMENT_OBSERVED` means the exact USDC event and balance delta
were verified.

**MVP:** `COVENANT_EXECUTION_VERIFIED_ON_ARC_TESTNET` requires a successful
final receipt plus exact code, constructor, event, state, replay, and balance
evidence with required provider corroboration.

**MVP:** `ARC_TESTNET_SETTLEMENT_VERIFIED` is reserved for that complete
vault-level evidence.

**MVP:** `EXTERNAL_SETTLEMENT` requires reconciliation with an external
execution system.

**MVP:** `CIRCLE_EXECUTION` requires actual Circle submission reconciled to Arc
evidence.

**MVP:** `PRODUCTION_SETTLEMENT` is prohibited for testnet evidence.

**MVP:** One committed Arc block is protocol-final. Provider corroboration is a
separate evidence-quality requirement, not an additional confirmation count.

## Subsequent boundaries

**MVP:** COV-010 may perform only an explicitly founder-authorized deployment,
independent read-only attestation, and durable deployment-manifest creation. It
must revalidate the exact approved plan immediately before broadcast.

**MVP:** COV-011 may separately perform explicitly authorized USDC approval,
vault funding, payment/rejection evidence, revocation, and post-revocation
evidence.

**MVP:** Circle credentials, Circle submission, and external reconciliation
require a separate approved adapter issue. No COV-009 component receives those
capabilities.

**Production:** Managed custody, KMS/HSM, self-operated nodes or provider
quorum, monitoring, reconciliation, incident response, and high availability
remain deferred.

**V2:** Additional Covenants, actors, assets, tokens, policies, networks, or
providers require separately approved scope.

**Protocol:** Generic RPC routing, arbitrary ABI forwarding, CREATE2 policy,
upgradeability, generalized execution, and multichain behavior remain
excluded.
