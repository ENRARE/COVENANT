# ADR 0022: Covenant Platform v1 architecture and public contract

- Status: Accepted
- Date: 2026-09-02
- Scope: V2
- Issue: COV-021

## Context

**MVP:** COV-001 through COV-020 proved one bounded procurement flow end to
end: strict signed schemas and money handling, separated proposal and
authorization, isolated signing, exact executor construction, Circle-backed
submission, immutable CovenantVault enforcement on Arc Testnet, independent
Arc execution observation, reconciliation, and deterministic non-authoritative
audit presentation.

**MVP:** That proof remains frozen historical evidence. COV-021 does not
reinterpret its schemas, hashes, domains, receipts, deployment, audit records,
or settlement claims, and it does not turn the demonstration applications into
public endpoints by documentation alone.

**V2:** Reuse by developer applications requires a stable public API and a
typed TypeScript client. The current application-specific composition must
therefore gain a platform boundary without discarding the authority separation
that made the proof meaningful.

**V2:** Founder approval is recorded for this architecture and governance slice
only. It approves the narrow Platform v1 direction described here, not the
runtime implementation of the platform, API, SDK, credentials, persistence,
or later COVs.

## Decision

1. **V2:** Covenant Platform v1 is API-first. The public API will own the
   developer-facing resource and operation contract.
2. **V2:** `@covenant/sdk` will be a typed client over that API. It will not
   implement an independent authorization or execution architecture.
3. **V2:** Existing MVP proposal, authority, isolated-signer, executor, Circle,
   Arc-observation, reconciliation, contract, specification, and audit
   components will be reused behind reviewed adapters rather than rebuilt.
4. **V2:** Arc is the only Platform v1 settlement network.
5. **V2:** Six-decimal USDC is the only Platform v1 settlement asset.
6. **V2:** CovenantVault remains authoritative for spend, payment count,
   revocation, authorization replay, token movement, and onchain Covenant
   enforcement.
7. **V2:** Offchain databases may store project, operational, application, and
   reconstructable audit projections. They are not authoritative spend or
   replay state and cannot establish financial authorization.
8. **V2:** Payment request creation remains separated from contextual policy
   decision and authorization.
9. **V2:** Authorization signing remains separated from Circle execution
   credentials and transaction submission.
10. **V2:** The executor continues to verify the complete authorized chain and
    submit authorized financial fields unchanged. It cannot silently alter
    recipient, token, amount, Covenant, vault, chain, nonce, or validity.
11. **V2:** Audit remains observational and non-authoritative. Audit data cannot
    authorize, retry, cancel, or execute a payment.
12. **V2:** Existing MVP signed objects retain their exact version-1 meaning.
    They are not silently reinterpreted as public Platform resources.
13. **V2:** Any incompatible Platform v1 signed or public structure must use an
    explicit version and receive a separate schema, trust-boundary, migration,
    and cryptographic review.
14. **V2:** API and SDK convenience never bypasses strict parsing, trusted
    configuration, signer identity, policy, linkage, validity, replay, calldata,
    or onchain enforcement checks.
15. **Protocol:** Platform v1 introduces no arbitrary smart-contract execution,
    generic transaction forwarding, calldata selection, or wallet operation.
16. **Protocol:** Platform v1 introduces no generic policy-language interpreter
    or open-ended policy composition.
17. **Protocol:** COV-021 introduces no multichain behavior. A caller cannot
    select another network through the future API or SDK.

## Public boundary

**V2:** The conceptual public resource, lifecycle, API actions, evidence
semantics, and SDK operations are frozen in `docs/V2_PLATFORM_CANON.md`. They
are architectural targets only; COV-021 adds no route, HTTP client,
authentication mechanism, database, webhook, or runtime behavior.

**V2:** A mutating API request expresses a request for a bounded platform
operation. API authentication proves caller access to a project; it is not
financial authorization. Authorization still requires the reviewed authority
and isolated-signer flow, and execution still requires the reviewed executor
and CovenantVault path.

## Consequences

**V2:** Developer applications gain one intended integration boundary and one
consistent public resource model. Existing internals can evolve behind the API
through explicit adapters and versions while the SDK stays a replaceable client.

**V2:** Platform v1 deliberately carries the operational cost of strict project
isolation, idempotency, stable errors, request correlation, durable workflow
state, and evidence-specific status. A single convenience `success` flag cannot
collapse policy approval, signed authorization, Circle acceptance, Arc
execution observation, settlement, or finality.

**V2:** Multiple projects and Covenant instances expand tenancy and lifecycle
coordination, but not chains, assets, execution types, signer roles, or the
location of authoritative financial state.

## Deferred work

- **V2:** COV-022 may generalize the Covenant domain/core for multiple projects
  and Covenant instances without implementing the public REST API.
- **V2:** COV-023 may add production-style execution runtime coordination and
  persistence while keeping financial authority onchain.
- **V2:** COV-024 may implement the authenticated developer REST API.
- **V2:** COV-025 may implement `@covenant/sdk` as the API client described by
  the canon.
- **V2:** COV-026 may dogfood the platform through the existing Covenant app and
  bounded reference integrations.
- **V2:** COV-027 may perform the security and reliability work approved for a
  Platform v1 release.
- **Production:** Real funds, production credentials, high availability,
  monitoring, incident response, compliance operations, disaster recovery,
  managed custody, and external audits require separate approval.
- **Protocol:** Arbitrary calls, generic policies, additional chains, broad
  multichain behavior, and generalized protocol execution remain deferred.

## Founder-approval assumptions

**V2:** The founder instruction for COV-021 is treated as explicit acceptance
of this documentation-only architecture gate. It is not approval to implement
COV-022 or later work, create credentials or funded wallets, change EIP-712,
change signer responsibilities, modify CovenantVault, deploy, or execute a
payment.
