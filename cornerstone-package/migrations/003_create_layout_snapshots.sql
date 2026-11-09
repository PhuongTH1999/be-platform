-- Apply once via Supabase SQL Editor, before deploying the code that serves /layout-snapshots.
-- Additive: creates one table for short-lived CNS layout snapshots (24 h TTL, enforced by the API on read).
begin;

create table if not exists public.cornerstone_layout_snapshots (
  id uuid primary key,
  layout jsonb not null,
  meta jsonb not null default '{}'::jsonb,
  size_bytes integer not null check (size_bytes > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists cornerstone_layout_snapshots_expires_at_idx
  on public.cornerstone_layout_snapshots (expires_at);

alter table public.cornerstone_layout_snapshots enable row level security;
revoke all on public.cornerstone_layout_snapshots from anon, authenticated;
grant select, insert, delete on public.cornerstone_layout_snapshots to service_role;

-- The API deletes rows that expired more than 1 day ago on every create. Optional extra purge (pg_cron):
--   select cron.schedule('purge-layout-snapshots', '0 * * * *',
--     $$delete from public.cornerstone_layout_snapshots where expires_at < now() - interval '1 day'$$);
notify pgrst, 'reload schema';
commit;
