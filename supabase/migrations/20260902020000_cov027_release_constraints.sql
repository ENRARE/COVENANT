-- COV-027: bounded query indexes for the developer release.
-- These tables remain non-authoritative projections; CovenantVault/Arc owns
-- spend, replay, revocation, and payment state.

create index if not exists covenants_project_created_idx
  on public.covenants (project_id, created_at, covenant_id);

create index if not exists execution_operations_project_state_idx
  on public.execution_operations (project_id, state, next_attempt_at);

create index if not exists http_idempotency_project_updated_idx
  on public.http_idempotency (project_id, updated_at);

create index if not exists webhook_deliveries_project_due_idx
  on public.webhook_deliveries (project_id, status, next_attempt_at);

-- A delivery must never cross project boundaries. The existing endpoint and
-- project foreign keys plus this composite uniqueness guard make the intended
-- relationship explicit for future adapters.
create unique index if not exists webhook_delivery_project_identity_idx
  on public.webhook_deliveries (project_id, endpoint_id, event_id);
