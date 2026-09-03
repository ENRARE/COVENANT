# Platform v1 compatibility and limitations

## REST

`/v1` is the current developer API contract. Breaking changes require a new
reviewed API-version strategy; existing clients must not infer compatibility
from implementation details.

## Public Covenant resource

Public resources use `version: "2"`. This is distinct from frozen signed V1
PaymentIntent, DecisionReceipt, and AuthorizationReceipt evidence. Incompatible
signed structures require explicit new versioning; version 1 is never silently
reinterpreted.

## SDK

`@covenant/sdk` remains `0.1.0`; normal pre-1.0 semver rules apply until a
separate release decision promotes it. REST/API versioning and npm package
semver are separate.

## Release limitations

- Arc Testnet only; USDC only.
- Server-side SDK only; no browser API-key mode.
- Initial project provisioning is a private administrative bootstrap.
- No production custody claim, real funds, or production credentials.
- No external security-audit claim; no formal verification claim.
- No HA, SLA, or SLO guarantee unless separately implemented and measured.
- `EXECUTED` means only matching reviewed Arc evidence and does not
  automatically claim every possible definition of settlement finality or
  irreversibility.
