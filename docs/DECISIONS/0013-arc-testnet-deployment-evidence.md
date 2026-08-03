# ADR 0013: Arc Testnet deployment evidence

- Status: Accepted
- Date: 2026-08-03
- Scope: MVP

All capabilities in this decision are **MVP** unless explicitly labeled
otherwise.

## Decision

**MVP:** COV-010 records one completed, founder-authorized CovenantVault
deployment on Arc Testnet as strict public evidence.

**MVP:** COV-010 does not add deployment, signing, broadcast, funding, token
approval, payment execution, revocation, Circle API access, credential access,
or arbitrary transaction capability.

**MVP:** The public deployment manifest is committed at:

`evidence/arc-testnet/cov-010/deployment-manifest.json`

## Public deployment identity

**MVP:** The committed evidence identifies:

- Arc Testnet chain ID `5042002`.
- CovenantVault address `0x2405Da1115B47A9D60499E12aA216874dc44c75a`.
- Deployment transaction `0x7b43a398b54f505131d6edc968a5c491bcdc8136f42e35cff73be1781fbf2ff4`.
- Deployment block `54829529`.
- Deployment block hash `0x50e75512cad861a3bcb693992c22b182f32313cd53349bef3545d50d6b7483d6`.
- Runtime code hash `0x8aa1e18527b2881d48aa6a682dd886665edb7cd0b7d54303e374b98d51c8f3bb`.

These are public onchain identifiers. They are not Circle identifiers,
credentials, authorization material, or recovery material.

## Offline verification

The committed deployment evidence can be verified with:

`pnpm.cmd verify:cov010-evidence`

The verifier validates the strict manifest schema, frozen deployment anchors,
profile and plan linkage, source commit, token identity, runtime hash, and the
canonical digest of the complete manifest.

The verifier performs no network, wallet, signing, funding, payment, Circle,
or transaction operation.

## Evidence boundaries

Successful verification proves that the repository contains the reviewed
public deployment record with the exact frozen commitments.

It does not prove current testnet availability, current contract state,
funding, payment execution, Circle execution, external settlement, or
production settlement.

The deployment must not be rerun for evidence generation.

## Security boundaries

Private operational records remain outside the repository.

The public evidence contains no API keys, authentication headers, entity
secrets, recovery material, private keys, Circle wallet identifiers, Circle
wallet-set identifiers, Circle transaction identifiers, raw Circle responses,
or private bootstrap artifacts.
