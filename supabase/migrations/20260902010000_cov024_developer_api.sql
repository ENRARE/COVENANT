-- COV-024: developer API projections and integration state.
-- These records share the approved persistence boundary. They are never
-- authoritative for spend, replay, revocation, or payment settlement.

create table if not exists public.developer_projects (
  project_id text primary key,
  name text not null,
  created_at timestamptz not null
);

create table if not exists public.api_keys (
  key_id text primary key,
  project_id text not null references public.developer_projects(project_id),
  public_prefix text not null unique,
  digest text not null,
  created_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists api_keys_project_idx
  on public.api_keys (project_id, created_at);

create table if not exists public.webhook_endpoints (
  endpoint_id text primary key,
  project_id text not null references public.developer_projects(project_id),
  url text not null,
  secret_ciphertext text not null,
  created_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists webhook_endpoints_project_idx
  on public.webhook_endpoints (project_id, created_at);

create table if not exists public.webhook_deliveries (
  delivery_id text primary key,
  endpoint_id text not null references public.webhook_endpoints(endpoint_id),
  project_id text not null references public.developer_projects(project_id),
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null check (status in ('PENDING', 'RETRYING', 'DELIVERED', 'FAILED')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (endpoint_id, event_id)
);

create index if not exists webhook_deliveries_due_idx
  on public.webhook_deliveries (status, next_attempt_at, created_at);

create table if not exists public.http_idempotency (
  project_id text not null references public.developer_projects(project_id),
  route text not null,
  key_digest text not null,
  request_fingerprint text not null,
  response_status integer,
  response_json jsonb,
  resource_reference text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (project_id, route, key_digest)
);
