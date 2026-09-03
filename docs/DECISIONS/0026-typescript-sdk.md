# ADR 0026: TypeScript SDK

**Status:** Accepted for COV-025
**Scope:** V2 — Platform v1

## Context

COV-024 establishes the authenticated, project-isolated Covenant REST API.
Developers need a typed server-side client without another policy, signing, or
execution implementation. The checked-in `apps/api/openapi.json` is the
public contract and the COV-024 API remains authoritative for lifecycle and
operational semantics.

## Decision

`@covenant/sdk` is an API-only TypeScript client. Its dependency direction is
the SDK to HTTPS/REST API; it does not import `@covenant/core`,
`@covenant/runtime`, executor code, Circle clients, Arc RPC libraries, or
contract-writing libraries.

The SDK:

1. validates server-side configuration and sends the project API key over the
   configured API URL;
2. exposes typed Covenant, execution, API-key, and webhook endpoint resources;
3. supports COV-024 `Idempotency-Key` request coordination and bounded safe
   retries;
4. maps bounded API responses to typed errors while preserving request IDs;
5. verifies COV-024 webhook signatures over the raw body with HMAC-SHA256,
   delivery ID, timestamp, constant-time comparison, and a five-minute replay
   window; and
6. uses a deterministic local OpenAPI route-contract test to detect API drift.

The SDK is server-side only. Applications own environment loading and must not
expose API keys to browsers or mobile clients. The initial project/key is
created by the private COV-024 administrative bootstrap; the SDK provides no
credential bootstrap or local key persistence.

## Boundaries

The SDK does not evaluate policy, construct or sign AuthorizationReceipts or
EIP-712 messages, create Circle requests, call Arc RPC, construct
CovenantVault calldata, hold wallet/private keys, reproduce runtime state
transitions, or decide provider acceptance/finality. API authentication grants
project access only and is never financial authorization.

HTTP idempotency remains distinct from durable execution identity and financial
authorization. Mutations are not retried without a caller-supplied key; keyed
retries are bounded and only used for COV-024 idempotent routes. A timeout is a
transport condition and does not claim that an execution failed.

## Consequences

The SDK provides a small ergonomic wrapper while leaving authoritative
validation, signer separation, execution coordination, spend, replay, and
finality to the API and existing platform boundaries. OpenAPI route coverage
and offline fake-fetch tests keep the package deterministic without public
network access.
