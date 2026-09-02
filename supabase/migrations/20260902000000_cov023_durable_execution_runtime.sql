-- COV-023: durable, non-authoritative runtime projections.
-- CovenantVault/Arc remains authoritative for spend, replay, revocation, and
-- payment state. This migration contains no secrets or signing material.

create table if not exists public.covenants (
  project_id text not null,
  covenant_id text not null,
  resource jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (project_id, covenant_id)
);

create table if not exists public.execution_operations (
  operation_key text primary key,
  project_id text not null,
  covenant_id text not null,
  execution_id text not null,
  authorization_id text not null,
  intent_id text not null,
  intent_hash text not null,
  amount text not null,
  beneficiary text not null,
  state text not null check (state in (
    'QUEUED', 'PREPARING', 'SIMULATING', 'READY_TO_SUBMIT',
    'SUBMISSION_STARTED', 'SUBMITTED', 'AMBIGUOUS', 'RECONCILING',
    'SUCCEEDED', 'TERMINAL_FAILED'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  last_attempt_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  version bigint not null default 0 check (version >= 0),
  submission_boundary boolean not null default false,
  provider_transaction_id text,
  provider_state text,
  provider_evidence jsonb,
  arc_evidence jsonb,
  retry_reason text,
  no_resubmit_reason text,
  failure_reason text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (project_id, covenant_id, execution_id),
  unique (project_id, covenant_id, operation_key),
  foreign key (project_id, covenant_id)
    references public.covenants(project_id, covenant_id)
);

create index if not exists execution_operations_claim_idx
  on public.execution_operations (state, next_attempt_at, lease_expires_at);

create table if not exists public.runtime_outbox (
  id bigint generated always as identity primary key,
  operation_key text not null references public.execution_operations(operation_key),
  project_id text not null,
  covenant_id text not null,
  event_type text not null,
  version bigint not null,
  payload jsonb not null,
  created_at timestamptz not null,
  delivered_at timestamptz,
  unique (operation_key, event_type, version),
  foreign key (project_id, covenant_id, operation_key)
    references public.execution_operations(project_id, covenant_id, operation_key)
);
