\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Schema and callable boundary.
-- ---------------------------------------------------------------------------
select 1 / case when exists (
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'ips'
    and column_name = 'public_slug'
    and is_nullable = 'NO'
) then 1 else 0 end as assert_ip_public_slug_column;

select 1 / case when exists (
  select 1 from pg_catalog.pg_indexes
  where schemaname = 'public' and indexname = 'ips_public_slug_key'
) and exists (
  select 1 from pg_catalog.pg_indexes
  where schemaname = 'public' and indexname = 'ip_public_slug_aliases_ip_idx'
) then 1 else 0 end as assert_ip_public_slug_indexes;

-- Legacy internal ids were already public URLs before this migration. The
-- backfill must therefore preserve old values even when they are longer than
-- the new editor contract or end in a hyphen.
select 1 / case when not exists (
  select 1
  from pg_catalog.pg_constraint as constraint_row
  join pg_catalog.pg_class as relation on relation.oid = constraint_row.conrelid
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relname = 'ips'
    and constraint_row.conname = 'ips_public_slug_format'
) then 1 else 0 end as assert_legacy_public_slug_values_are_preservable;

select 1 / case when (
  select count(*)
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.proname = 'admin_update_ip_identity'
    and pg_catalog.pg_get_function_identity_arguments(proc.oid) = 'target_id text, target_public_slug text, target_expected_public_slug text'
    and pg_catalog.pg_get_function_result(proc.oid) = 'boolean'
    and proc.prosecdef
    and proc.provolatile = 'v'
    and proc.proconfig = array['search_path=""']
) = 1 then 1 else 0 end as assert_ip_identity_rpc_security_contract;

select 1 / case when not exists (
  select 1
  from (values
    ('public.admin_update_ip_identity(text, text, text)')
  ) as rpc(signature)
  where not has_function_privilege('authenticated', rpc.signature, 'EXECUTE')
     or has_function_privilege('anon', rpc.signature, 'EXECUTE')
     or has_function_privilege('service_role', rpc.signature, 'EXECUTE')
) then 1 else 0 end as assert_ip_identity_rpc_acl;

select 1 / case when not has_table_privilege('authenticated', 'public.ip_public_slug_aliases', 'INSERT')
  and not has_table_privilege('authenticated', 'public.ip_public_slug_aliases', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.ip_public_slug_aliases', 'DELETE')
  and has_table_privilege('anon', 'public.ip_public_slug_aliases', 'SELECT')
then 1 else 0 end as assert_alias_table_read_only_acl;

-- ---------------------------------------------------------------------------
-- Principals and fixtures.
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-4000-8000-000000047301', 'authenticated', 'authenticated', 'ip-identity-staff@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000047302', 'authenticated', 'authenticated', 'ip-identity-user@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

update public.profiles
set
  nickname = case id
    when '00000000-0000-4000-8000-000000047301' then 'ip_identity_staff'
    else 'ip_identity_user'
  end,
  birth_date = '2000-01-01',
  consents = '{"terms":true,"privacy":true}'::jsonb,
  onboarded_at = now(),
  role = case
    when id = '00000000-0000-4000-8000-000000047301' then 'staff'
    else 'user'
  end::public.user_role,
  suspended_at = null
where id in (
  '00000000-0000-4000-8000-000000047301',
  '00000000-0000-4000-8000-000000047302'
);

insert into public.verticals (key, label, color)
values ('ip-identity-test', 'IP 식별자 테스트', '#8B5CFF')
on conflict (key) do update set label = excluded.label, color = excluded.color;

insert into public.ips (id, title, vertical_key, published_at)
values
  ('identity-473-ip', '식별자 변경 IP', 'ip-identity-test', now()),
  ('identity-473-other', '식별자 중복 IP', 'ip-identity-test', now()),
  ('identity-473-draft', '식별자 초안 IP', 'ip-identity-test', null);

select 1 / case when (
  select public_slug from public.ips where id = 'identity-473-ip'
) = 'identity-473-ip' then 1 else 0 end as assert_legacy_upsert_defaulted_public_slug;

-- ---------------------------------------------------------------------------
-- Staff and stale-write guards.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000047302', true);

do $$
begin
  begin
    perform public.admin_update_ip_identity('identity-473-ip', 'blocked-for-user', 'identity-473-ip');
  exception
    when insufficient_privilege then
      if sqlerrm = 'forbidden' then return; end if;
      raise;
  end;
  raise exception 'non-staff identity update should be rejected';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000047301', true);

select 1 / case when public.admin_update_ip_identity(
  'identity-473-draft', 'identity-473-draft-current', 'identity-473-draft'
) then 1 else 0 end as assert_draft_identity_rename;

-- New internal IDs keep the pre-existing ID contract. The strict 80-character
-- editor rule applies only when an operator chooses a different public slug.
select public.admin_upsert_ip(
  repeat('legacy-', 14) || 'x-', '새 legacy 형식 IP', null, 'ip-identity-test',
  null, null, null, null, null, false, null, null
);
select 1 / case when (
  select public_slug = id
  from public.ips
  where id = repeat('legacy-', 14) || 'x-'
) then 1 else 0 end as assert_new_internal_id_contract_preserved;

select 1 / case when public.admin_update_ip_identity(
  'identity-473-ip', 'identity-473-current', 'identity-473-ip'
) then 1 else 0 end as assert_identity_rename;

select 1 / case when not public.admin_update_ip_identity(
  'identity-473-ip', 'identity-473-current', 'identity-473-current'
) then 1 else 0 end as assert_identity_replay;

select 1 / case when (
  select public_slug from public.ips where id = 'identity-473-ip'
) = 'identity-473-current' and exists (
  select 1 from public.ip_public_slug_aliases
  where slug = 'identity-473-ip' and ip_id = 'identity-473-ip'
) then 1 else 0 end as assert_identity_alias_preserved;

-- A second rename creates an alias whose text is not an internal id. A later
-- legacy admin_upsert_ip can otherwise default a new row to that alias.
select 1 / case when public.admin_update_ip_identity(
  'identity-473-ip', 'identity-473-current-2', 'identity-473-current'
) then 1 else 0 end as assert_identity_second_rename;

select 1 / case when (
  select count(*) from public.audit_log
  where actor_id = '00000000-0000-4000-8000-000000047301'
    and action = 'admin.ip.identity_updated'
    and target = 'ips:identity-473-ip'
) = 2 then 1 else 0 end as assert_identity_renames_audited_once;

-- The legacy metadata upsert is still the writer for title/artwork fields. It
-- must preserve the current public slug when the immutable internal id now
-- also exists as a historical alias.
select public.admin_upsert_ip(
  'identity-473-ip', '메타데이터 유지 IP', null, 'ip-identity-test',
  null, null, null, null, null, false, 'identity-473-ip', null
);
select 1 / case when (
  select public_slug from public.ips where id = 'identity-473-ip'
) = 'identity-473-current-2' then 1 else 0 end as assert_metadata_upsert_preserved_current_slug;

do $$
begin
  begin
    perform public.admin_upsert_ip(
      'identity-473-current', '잘못된 별칭 충돌 IP', null, 'ip-identity-test',
      null, null, null, null, null, false, null, null
    );
  exception
    when unique_violation then
      if sqlerrm = 'ip_public_slug_taken' then return; end if;
      raise;
  end;
  raise exception 'legacy IP creation must not shadow a historical alias';
end;
$$;

do $$
begin
  begin
    perform public.admin_update_ip_identity('identity-473-ip', 'identity-473-other', 'identity-473-current-2');
  exception
    when unique_violation then
      if sqlerrm = 'ip_public_slug_taken' then return; end if;
      raise;
  end;
  raise exception 'canonical slug reuse should be rejected';
end;
$$;

do $$
begin
  begin
    perform public.admin_update_ip_identity('identity-473-other', 'identity-473-ip', 'identity-473-other');
  exception
    when unique_violation then
      if sqlerrm = 'ip_public_slug_taken' then return; end if;
      raise;
  end;
  raise exception 'historical alias reuse should be rejected';
end;
$$;

do $$
begin
  begin
    perform public.admin_update_ip_identity('identity-473-ip', 'identity-473-new', 'identity-473-current');
  exception
    when sqlstate 'PT409' then
      if sqlerrm = 'ip_public_slug_conflict' then return; end if;
      raise;
  end;
  raise exception 'stale expected slug should be rejected';
end;
$$;

do $$
begin
  begin
    perform public.admin_update_ip_identity('identity-473-ip', 'aouad', 'identity-473-current-2');
  exception
    when invalid_parameter_value then
      if sqlerrm = 'invalid_ip_public_slug' then return; end if;
      raise;
  end;
  raise exception 'reserved public slug should be rejected';
end;
$$;

-- Only the alias-preserving RPC may mutate public_slug. This check uses the
-- trusted service role to exercise the trigger even though authenticated table
-- UPDATE is already revoked by the catalog baseline.
reset role;
set local role service_role;
do $$
begin
  begin
    insert into public.ips (id, public_slug, title, vertical_key, published_at)
    values ('identity-473-direct-insert', 'chosen-by-direct-insert', '직접 공개 slug 삽입', 'ip-identity-test', now());
  exception
    when insufficient_privilege then
      if sqlerrm = 'ip_public_slug_write_requires_rpc' then null; else raise; end if;
  end;
  if exists (select 1 from public.ips where id = 'identity-473-direct-insert') then
    raise exception 'direct public_slug insert should be rejected';
  end if;

  begin
    update public.ips
    set public_slug = 'direct-mutated-slug'
    where id = 'identity-473-ip';
  exception
    when insufficient_privilege then
      if sqlerrm = 'ip_public_slug_write_requires_rpc' then return; end if;
      raise;
  end;
  raise exception 'direct public_slug update should be rejected';
end;
$$;

-- ---------------------------------------------------------------------------
-- Public aliases are readable, but physical deletion remains unavailable.
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);

select 1 / case when exists (
  select 1 from public.ip_public_slug_aliases
  where slug = 'identity-473-ip' and ip_id = 'identity-473-ip'
) then 1 else 0 end as assert_public_alias_read;

select 1 / case when not exists (
  select 1 from public.ip_public_slug_aliases
  where slug = 'identity-473-draft' and ip_id = 'identity-473-draft'
) then 1 else 0 end as assert_draft_alias_hidden_from_public;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000047301', true);
select 1 / case when exists (
  select 1 from public.ip_public_slug_aliases
  where slug = 'identity-473-draft' and ip_id = 'identity-473-draft'
) then 1 else 0 end as assert_staff_can_read_draft_alias;

select 1 / case when not has_table_privilege('authenticated', 'public.ips', 'DELETE')
  and not has_table_privilege('authenticated', 'public.ip_public_slug_aliases', 'DELETE')
then 1 else 0 end as assert_identity_hard_delete_closed;

rollback;
