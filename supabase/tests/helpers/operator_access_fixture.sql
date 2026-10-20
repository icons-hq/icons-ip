-- TEST ONLY. Install through scripts/with-legacy-operator-fixtures.mjs in its
-- explicitly verified local FRESH/CI Docker database or freshly owned disposable
-- clone with the wrapper's identity lease. Never deploy this helper,
-- include it in a migration, or install it in the browser QA/production DB.
-- The wrapper removes this lease, trigger and function in finally, including a
-- failed test. New capability/lifecycle tests run without this helper.
do $$ begin
 if (select configured from private.operator_access_state where id) then
  raise exception 'Legacy fixture helper requires an unconfigured isolated test database';end if;
 if to_regclass('private.operator_legacy_fixture_control') is not null then
  raise exception 'Another legacy fixture lease already exists';end if;
end $$;
create table private.operator_legacy_fixture_control (
 singleton boolean primary key check(singleton),project_id text not null,lease uuid not null,expires_at timestamptz not null
);
alter table private.operator_legacy_fixture_control enable row level security;
revoke all on private.operator_legacy_fixture_control from public,anon,authenticated,service_role;
insert into private.operator_legacy_fixture_control values(true,:'operator_fixture_project',:'operator_fixture_lease'::uuid,clock_timestamp()+interval '2 hours');
create function private.capture_operator_legacy_fixture() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.role in ('staff','admin') then
  if session_user not in ('postgres','supabase_admin')
   or not exists(select 1 from private.operator_legacy_fixture_control where singleton and expires_at>clock_timestamp())
   or (select configured from private.operator_access_state where id) then
   raise exception 'Legacy operator fixture capture is outside its isolated test scope';end if;
  insert into private.operator_legacy_cohort(profile_id,legacy_role) values(new.id,new.role) on conflict(profile_id) do nothing;
 end if;
 return new;
end $$;
revoke all on function private.capture_operator_legacy_fixture() from public,anon,authenticated,service_role;
create trigger test_operator_legacy_fixture after insert or update of role on public.profiles
 for each row execute function private.capture_operator_legacy_fixture();
-- Existing committed rehearsal fixtures in this isolated DB are also explicit
-- legacy fixtures; the application and deployed migration never run this query.
insert into private.operator_legacy_cohort(profile_id,legacy_role)
 select id,role from public.profiles where role in ('staff','admin') on conflict(profile_id) do nothing;
