-- Apply once via Supabase SQL Editor, after 001 and before deploying the code that sends change_summary / author.
-- Additive: adds two nullable columns to cornerstone_sdui_templates and a version table filled by a trigger.
begin;

-- Who / what made the last change; the trigger copies them into the version row of that save.
alter table public.cornerstone_sdui_templates
  add column if not exists change_summary text check (char_length(change_summary) <= 200),
  add column if not exists updated_by text check (char_length(updated_by) <= 200);

create table if not exists public.cornerstone_sdui_template_versions (
  template_id uuid not null references public.cornerstone_sdui_templates(id) on delete cascade,
  version integer not null check (version > 0),
  name text not null,
  schema jsonb not null,
  change_summary text check (char_length(change_summary) <= 200),
  created_by text check (char_length(created_by) <= 200),
  created_at timestamptz not null default now(),
  primary key (template_id, version)
);

-- Existing templates start with version 1 = their current content. Idempotent.
insert into public.cornerstone_sdui_template_versions (template_id, version, name, schema, change_summary, created_at)
select t.id, 1, t.name, t.schema, 'Initial snapshot', t.updated_at
from public.cornerstone_sdui_templates t
where not exists (select 1 from public.cornerstone_sdui_template_versions v where v.template_id = t.id);

-- One version per insert, and per update that changes name or schema. Same transaction as the template write;
-- an UPDATE holds the template row lock, so concurrent saves of one template get consecutive numbers.
create or replace function public.cornerstone_sdui_record_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.name is not distinct from old.name and new.schema is not distinct from old.schema then
    return null;
  end if;
  insert into public.cornerstone_sdui_template_versions (template_id, version, name, schema, change_summary, created_by, created_at)
  values (
    new.id,
    coalesce((select max(v.version) from public.cornerstone_sdui_template_versions v where v.template_id = new.id), 0) + 1,
    new.name, new.schema, new.change_summary, new.updated_by, new.updated_at
  );
  return null;
end;
$$;

drop trigger if exists cornerstone_sdui_record_version on public.cornerstone_sdui_templates;
create trigger cornerstone_sdui_record_version
after insert or update on public.cornerstone_sdui_templates
for each row execute function public.cornerstone_sdui_record_version();

alter table public.cornerstone_sdui_template_versions enable row level security;
revoke all on public.cornerstone_sdui_template_versions from anon, authenticated;
grant select, insert, delete on public.cornerstone_sdui_template_versions to service_role;
notify pgrst, 'reload schema';
commit;
