-- Apply once via Supabase SQL Editor, before deploying the code that serves PATCH /packages/:scope/:name/versions/:version.
-- Additive: five nullable release-note columns on public.versions. Existing rows keep null notes; sync never writes
-- summary, service_action or notes_*, and only fills release_type while it is null.
begin;

alter table public.versions
  add column if not exists release_type text check (release_type in ('feature', 'hotfix')),
  -- Markdown documents edited in the Cornerstone tool. Size is capped by the API (256 KB each), not here.
  add column if not exists summary text,
  add column if not exists service_action text,
  add column if not exists notes_updated_at timestamptz,
  -- Self-reported by the client: the API has no auth yet.
  add column if not exists notes_updated_by text check (char_length(notes_updated_by) <= 200);

notify pgrst, 'reload schema';
commit;
