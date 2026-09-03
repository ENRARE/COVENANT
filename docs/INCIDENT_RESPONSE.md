# Platform v1 incident response

**V2:** This runbook covers the Arc Testnet developer release. It does not
invent automatic remediation and never treats an operational projection as
financial truth. When evidence is ambiguous, stop execution and reconcile with
the existing identity; never resubmit blindly.

## Immediate rules

1. Declare the incident, record UTC time, request IDs, project IDs, operation
   IDs, and the last known lifecycle state.
2. Enter safe mode: stop new authorization-evidence submissions and execution
   requests while preserving durable records and outbox state.
3. Do not print or copy API keys, webhook secrets, master keys, Circle
   credentials, private keys, signed envelopes, or database credentials.
4. CovenantVault/Arc evidence is authoritative for spend, replay, revocation,
   and payment state; API/runtime records are operational projections.

| Incident                        | Containment                                                                                                     | Investigation and recovery                                                                                  | Stop execution when                                                           |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Suspected API-key leak          | Revoke the affected key; issue a replacement through private bootstrap/admin control.                           | Review request IDs and project activity; do not assume a key authorized money.                              | Key ownership or project boundary cannot be established.                      |
| Webhook master-key loss         | Stop webhook dispatch and preserve ciphertext; do not generate a replacement key over existing ciphertext.      | Restore the same key from the approved secret backup, or recreate endpoints after explicit operator review. | The original key cannot be recovered and endpoint secret identity is unknown. |
| Circle/provider outage          | Pause submission workers; keep `SUBMITTED`/`AMBIGUOUS` identities.                                              | Reconcile known provider IDs read-only after service recovery.                                              | Provider outcome is unknown or a status conflicts with Arc evidence.          |
| Arc RPC/observer outage         | Do not convert provider acceptance to `EXECUTED`; pause reconciliation promotion.                               | Retry observation through the reviewed Arc Testnet endpoint when available.                                 | Matching Arc receipt/effect evidence is unavailable.                          |
| Database outage                 | Stop mutations and workers; preserve the database volume.                                                       | Restore/repair the non-authoritative projection, then verify migration and identity uniqueness.             | Durable submission boundary cannot be read consistently.                      |
| Worker crash loop               | Disable the worker process and retain leases/ambiguous rows.                                                    | Inspect bounded redacted failure reasons, recover expired leases, and restart one reviewed worker.          | A lease or state transition cannot be proven exclusive.                       |
| Suspected duplicate submission  | Quiesce the operation key; never issue a second provider POST.                                                  | Compare durable operation identity, provider ID, and Arc evidence; escalate conflicting evidence.           | Two provider dispatches or conflicting chain effects are possible.            |
| Conflicting execution evidence  | Mark the operation terminally failed/reconciliation-required; preserve both observations.                       | Have an authorized operator review source provenance and onchain facts.                                     | Conflict cannot be resolved by matching reviewed Arc evidence.                |
| Secret accidentally logged      | Quiesce affected integration, redact retention copies, rotate/revoke the exposed secret.                        | Search logs and access history; document scope and impact without reproducing the secret.                   | Secret exposure or rotation status is unknown.                                |
| Authorization-signer compromise | Stop authorization issuance and evidence acceptance; revoke/rotate signer through its separate custody process. | Re-verify affected evidence against the approved signer set and inspect Arc state.                          | Signer provenance or receipt validity cannot be established.                  |

## Recovery invariants

- Restores may reconstruct non-authoritative projects, idempotency, outbox, and
  execution metadata; they cannot reconstruct private keys or onchain state.
- An operation with `SUBMISSION_STARTED`, `SUBMITTED`, or `AMBIGUOUS` status
  remains non-resubmittable after restart or restore until reconciliation.
- Webhook failure never changes Covenant financial state. Delivery retries may
  be replayed with the same delivery identity and signed raw payload.
