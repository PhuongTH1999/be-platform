-- Apply once via Supabase SQL Editor. Additive: no existing tables/data modified.
begin;

create table if not exists public.cornerstone_sdui_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  schema jsonb not null check (
    jsonb_typeof(schema) = 'object'
    and schema ? 'type' and schema ->> 'type' = 'template_widget'
    and schema ? 'templateType' and schema ->> 'templateType' = 'SDUI_WIDGET'
    and schema ? 'data' and jsonb_typeof(schema -> 'data') = 'array'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cornerstone_sdui_templates_created_idx
  on public.cornerstone_sdui_templates (created_at desc, id);

create or replace function public.cornerstone_sdui_set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cornerstone_sdui_updated_at on public.cornerstone_sdui_templates;
create trigger cornerstone_sdui_updated_at
before update on public.cornerstone_sdui_templates
for each row execute function public.cornerstone_sdui_set_updated_at();

alter table public.cornerstone_sdui_templates enable row level security;
revoke all on public.cornerstone_sdui_templates from anon, authenticated;
grant select, insert, update, delete on public.cornerstone_sdui_templates to service_role;
notify pgrst, 'reload schema';
commit;
