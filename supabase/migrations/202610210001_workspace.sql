-- Run this entire file in Supabase SQL Editor. Safe to run again.
begin;
create schema if not exists workspace_private;
revoke all on schema workspace_private from public, anon, authenticated;
create table if not exists workspace_private.owners (email text primary key);
alter table workspace_private.owners enable row level security;
insert into workspace_private.owners(email) values ('vampir3452@gmail.com') on conflict do nothing;

create or replace function public.is_workspace_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and coalesce(auth.jwt()->'app_metadata'->>'provider', '') = 'google'
    and exists (select 1 from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null)
    and exists (select 1 from workspace_private.owners where email = lower(auth.jwt()->>'email'));
$$;
revoke all on function public.is_workspace_owner() from public, anon;
grant execute on function public.is_workspace_owner() to authenticated;

create table if not exists public.workspace_records (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) <= 300),
  kind text not null check (kind in ('event', 'template')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 2000000),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  primary key(owner_id, id)
);
alter table public.workspace_records enable row level security;
revoke all on public.workspace_records from public, anon, authenticated;
grant select on public.workspace_records to authenticated;
do $policy$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspace_records' and policyname = 'owner_read') then
    create policy owner_read on public.workspace_records for select to authenticated
      using (owner_id = auth.uid() and public.is_workspace_owner());
  end if;
end $policy$;

-- Compare-and-swap is atomic. Stale clients receive the current record, never overwrite it.
create or replace function public.save_workspace_record(record_id text, record_kind text, record_payload jsonb, expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_record public.workspace_records; saved_record public.workspace_records;
begin
  if not public.is_workspace_owner() then raise exception 'Access denied' using errcode = '42501'; end if;
  if expected_version is null or expected_version < 0
    or record_kind is null or record_kind not in ('event', 'template')
    or record_id is null or record_id not like record_kind || ':%'
    or record_payload is null or jsonb_typeof(record_payload) <> 'object' then
    raise exception 'Invalid record' using errcode = '22023';
  end if;
  if record_kind = 'event' and (
    jsonb_typeof(record_payload->'source') is distinct from 'object'
    or jsonb_typeof(record_payload->'body') is distinct from 'object'
    or record_payload->'source'->>'googleId' is null
    or record_id <> 'event:' || (record_payload->'source'->>'googleId')
  ) then raise exception 'Invalid event' using errcode = '22023'; end if;
  if record_kind = 'template' and (
    jsonb_typeof(record_payload->'name') is distinct from 'string'
    or jsonb_typeof(record_payload->'questions') is distinct from 'array'
    or jsonb_typeof(record_payload->'tasks') is distinct from 'array'
  ) then raise exception 'Invalid template' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text || ':' || record_id, 0));
  select * into current_record from public.workspace_records where owner_id = auth.uid() and id = record_id for update;
  if (current_record.id is null and expected_version <> 0) or (current_record.id is not null and current_record.version <> expected_version) then
    return jsonb_build_object('saved', false, 'record', case when current_record.id is null then null else to_jsonb(current_record) - 'owner_id' end);
  end if;
  insert into public.workspace_records(owner_id, id, kind, payload, version)
    values (auth.uid(), record_id, record_kind, record_payload, 1)
    on conflict (owner_id, id) do update set payload = excluded.payload, kind = excluded.kind,
      version = public.workspace_records.version + 1, updated_at = now()
    returning * into saved_record;
  return jsonb_build_object('saved', true, 'record', to_jsonb(saved_record) - 'owner_id');
end;
$$;
revoke all on function public.save_workspace_record(text, text, jsonb, integer) from public, anon;
grant execute on function public.save_workspace_record(text, text, jsonb, integer) to authenticated;

-- Server-only Google credentials. No browser role can read or write this table.
create table if not exists public.workspace_calendar_credentials (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);
alter table public.workspace_calendar_credentials enable row level security;
revoke all on public.workspace_calendar_credentials from public, anon, authenticated;
grant all on public.workspace_calendar_credentials to service_role;
commit;
