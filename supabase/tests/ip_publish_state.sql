\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Schema, backfill, and callable boundaries (20260907130000 / 20260907130001).
-- ---------------------------------------------------------------------------
select 1 / case when exists (
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'ips'
    and column_name = 'published_at'
    and is_nullable = 'YES'
    and data_type = 'timestamp with time zone'
) then 1 else 0 end as assert_ip_published_at_column;

select 1 / case when exists (
  select 1
  from pg_catalog.pg_indexes
  where schemaname = 'public'
    and indexname = 'ips_published_at_idx'
) then 1 else 0 end as assert_ip_published_at_index;

-- Every unarchived baseline IP kept its public exposure through the backfill.
select 1 / case when not exists (
  select 1
  from public.ips
  where id in ('rilakkuma', 'maplestory', 'hong-sil-quest')
    and archived_at is null
    and published_at is null
) then 1 else 0 end as assert_backfill_kept_live_ips_published;

select 1 / case when (
  select count(*)
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.proname = 'admin_set_ip_published'
    and pg_catalog.pg_get_function_identity_arguments(proc.oid) = 'target_id text, target_published boolean'
    and pg_catalog.pg_get_function_result(proc.oid) = 'boolean'
    and proc.prosecdef
    and proc.provolatile = 'v'
    and proc.proconfig = array['search_path=""']
) = 1 then 1 else 0 end as assert_publish_rpc_security_contract;

-- The old 11-argument admin_upsert_ip is gone; only the target_publish overload remains.
select 1 / case when (
  select count(*)
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.proname = 'admin_upsert_ip'
) = 1 and exists (
  select 1
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.proname = 'admin_upsert_ip'
    and pg_catalog.pg_get_function_identity_arguments(proc.oid) like '%target_publish boolean%'
    and proc.prosecdef
) then 1 else 0 end as assert_upsert_ip_single_overload;

select 1 / case when not exists (
  select 1
  from (values
    ('public.admin_set_ip_published(text, boolean)'),
    ('public.admin_upsert_ip(text, text, text, text, text, text, text, text, text, boolean, text, boolean)')
  ) as rpc(signature)
  where not has_function_privilege('authenticated', rpc.signature, 'EXECUTE')
     or has_function_privilege('anon', rpc.signature, 'EXECUTE')
     or has_function_privilege('service_role', rpc.signature, 'EXECUTE')
) and not exists (
  select 1
  from (values
    ('private.set_ip_published(text, boolean)')
  ) as rpc(signature)
  where has_function_privilege('authenticated', rpc.signature, 'EXECUTE')
     or has_function_privilege('anon', rpc.signature, 'EXECUTE')
     or has_function_privilege('service_role', rpc.signature, 'EXECUTE')
) and not exists (
  select 1
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
  cross join lateral aclexplode(
    coalesce(proc.proacl, acldefault('f', proc.proowner))
  ) as function_acl
  where (
      (namespace.nspname = 'public' and proc.proname in ('admin_set_ip_published', 'admin_upsert_ip'))
      or (namespace.nspname = 'private' and proc.proname = 'set_ip_published')
    )
    and function_acl.grantee = 0
    and function_acl.privilege_type = 'EXECUTE'
) then 1 else 0 end as assert_publish_rpc_acls;

-- ---------------------------------------------------------------------------
-- Principals and fixtures.
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-4000-8000-000000013001', 'authenticated', 'authenticated', 'publish-staff@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000013002', 'authenticated', 'authenticated', 'publish-user@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

update public.profiles
set
  nickname = case id
    when '00000000-0000-4000-8000-000000013001' then 'publish_staff'
    else 'publish_user'
  end,
  birth_date = '2000-01-01',
  consents = '{"terms":true,"privacy":true}'::jsonb,
  onboarded_at = now(),
  role = case
    when id = '00000000-0000-4000-8000-000000013001' then 'staff'
    else 'user'
  end::public.user_role,
  suspended_at = null
where id in (
  '00000000-0000-4000-8000-000000013001',
  '00000000-0000-4000-8000-000000013002'
);

insert into public.verticals (key, label, color)
values ('ip-publish-test', 'IP 게시 테스트', '#8B5CFF')
on conflict (key) do update set label = excluded.label, color = excluded.color;

-- A direct insert is a draft: published_at defaults to null.
insert into public.ips (id, title, vertical_key, published_at, archived_at)
values
  ('publish-draft-ip', '게시스모크 초안 IP', 'ip-publish-test', null, null),
  ('publish-live-ip', '게시스모크 공개 IP', 'ip-publish-test', now(), null),
  ('publish-archived-ip', '게시스모크 보관 IP', 'ip-publish-test', null, now()),
  ('publish-blank-ip', '   ', 'ip-publish-test', null, null);

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('publish-draft-good', 'publish-draft-ip', '게시스모크 초안 굿즈', '문구', 1000, 'ok', 1),
  ('publish-live-good', 'publish-live-ip', '게시스모크 공개 굿즈', '문구', 1000, 'ok', 1);

insert into public.cards (id, ip_id, name, no, rarity)
values
  ('publish-draft-card', 'publish-draft-ip', '게시스모크 초안 카드', '001', 'N'),
  ('publish-live-card', 'publish-live-ip', '게시스모크 공개 카드', '002', 'N');

-- ---------------------------------------------------------------------------
-- Public search excludes a draft IP and everything that belongs to it.
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);

select 1 / case when exists (
  select 1 from public.search_public_content('게시스모크', 20)
  where kind = 'ip' and id = 'publish-live-ip'
) and exists (
  select 1 from public.search_public_content('게시스모크', 20)
  where kind = 'good' and id = 'publish-live-good'
) and exists (
  select 1 from public.search_public_content('게시스모크', 20)
  where kind = 'card' and id = 'publish-live-card'
) then 1 else 0 end as assert_published_ip_family_searchable;

select 1 / case when not exists (
  select 1 from public.search_public_content('게시스모크', 20)
  where (kind = 'ip' and id = 'publish-draft-ip')
     or (kind = 'good' and id = 'publish-draft-good')
     or (kind = 'card' and id = 'publish-draft-card')
     or (kind = 'ip' and id = 'publish-archived-ip')
) then 1 else 0 end as assert_draft_ip_family_hidden_from_search;

-- ---------------------------------------------------------------------------
-- The toggle RPC is authenticated staff-only before target handling.
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000013002', true);

do $$
begin
  begin
    perform public.admin_set_ip_published('publish-draft-ip', true);
  exception
    when insufficient_privilege then
      if sqlerrm = 'forbidden' then return; end if;
      raise;
  end;
  raise exception 'admin_set_ip_published should reject non-staff';
end;
$$;

select 1 / case when (
  select published_at is null from public.ips where id = 'publish-draft-ip'
) then 1 else 0 end as assert_non_staff_left_draft_untouched;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000013001', true);

do $$
begin
  begin
    perform public.admin_set_ip_published('missing-publish-target', true);
  exception
    when no_data_found then
      if sqlerrm = 'catalog_not_found' then return; end if;
      raise;
  end;
  raise exception 'missing publish target should fail';
end;
$$;

do $$
begin
  begin
    perform public.admin_set_ip_published('publish-draft-ip', null);
  exception
    when invalid_parameter_value then
      if sqlerrm = 'invalid_publish_state' then return; end if;
      raise;
  end;
  raise exception 'null publish state should fail';
end;
$$;

-- An archived IP cannot change publish state in either direction; restore first.
do $$
declare
  requested boolean;
begin
  foreach requested in array array[true, false] loop
    begin
      perform public.admin_set_ip_published('publish-archived-ip', requested);
    exception
      when check_violation then
        if sqlerrm = 'catalog_item_archived' then continue; end if;
        raise;
    end;
    raise exception 'archived IP should reject publish state %', requested;
  end loop;
end;
$$;

-- Publishing re-checks the minimum form contract at the boundary.
do $$
begin
  begin
    perform public.admin_set_ip_published('publish-blank-ip', true);
  exception
    when check_violation then
      if sqlerrm = 'ip_publish_incomplete' then return; end if;
      raise;
  end;
  raise exception 'blank title should not publish';
end;
$$;

-- ---------------------------------------------------------------------------
-- Transitions are audited once each and replays are idempotent no-ops.
-- ---------------------------------------------------------------------------
select 1 / case when public.admin_set_ip_published('publish-draft-ip', true) then 1 else 0 end
  as assert_publish_transition;
select 1 / case when not public.admin_set_ip_published('publish-draft-ip', true) then 1 else 0 end
  as assert_publish_replay;
select 1 / case when (
  select published_at is not null and archived_at is null from public.ips where id = 'publish-draft-ip'
) then 1 else 0 end as assert_publish_sets_timestamp;

-- Once published, the same IP family shows up in public search.
reset role;
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);

select 1 / case when exists (
  select 1 from public.search_public_content('게시스모크', 20)
  where kind = 'ip' and id = 'publish-draft-ip'
) and exists (
  select 1 from public.search_public_content('게시스모크', 20)
  where kind = 'good' and id = 'publish-draft-good'
) and exists (
  select 1 from public.search_public_content('게시스모크', 20)
  where kind = 'card' and id = 'publish-draft-card'
) then 1 else 0 end as assert_newly_published_family_searchable;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000013001', true);

select 1 / case when public.admin_set_ip_published('publish-draft-ip', false) then 1 else 0 end
  as assert_unpublish_transition;
select 1 / case when not public.admin_set_ip_published('publish-draft-ip', false) then 1 else 0 end
  as assert_unpublish_replay;
select 1 / case when (
  select published_at is null from public.ips where id = 'publish-draft-ip'
) then 1 else 0 end as assert_unpublish_clears_timestamp;

select 1 / case when not exists (
  select expected.action
  from (values ('admin.ip.published'), ('admin.ip.unpublished')) as expected(action)
  left join lateral (
    select count(*) as audit_count
    from public.audit_log as audit
    where audit.actor_id = '00000000-0000-4000-8000-000000013001'
      and audit.action = expected.action
      and audit.target = 'ips:publish-draft-ip'
  ) as actual on true
  where actual.audit_count <> 1
) then 1 else 0 end as assert_publish_transitions_audited_once;

-- ---------------------------------------------------------------------------
-- admin_upsert_ip: target_publish saves and transitions in one transaction.
-- ---------------------------------------------------------------------------
select public.admin_upsert_ip(
  'publish-upsert-live-ip', '게시 업서트 공개 IP', null, 'ip-publish-test',
  null, null, null, null, null, false, null, true
);
select 1 / case when (
  select published_at is not null from public.ips where id = 'publish-upsert-live-ip'
) then 1 else 0 end as assert_upsert_publish_creates_published_ip;

select public.admin_upsert_ip(
  'publish-upsert-draft-ip', '게시 업서트 초안 IP', null, 'ip-publish-test',
  null, null, null, null, null, false, null, null
);
select 1 / case when (
  select published_at is null from public.ips where id = 'publish-upsert-draft-ip'
) then 1 else 0 end as assert_upsert_without_publish_creates_draft;

-- Editing a published IP without a publish intent keeps it published.
select public.admin_upsert_ip(
  'publish-upsert-live-ip', '게시 업서트 공개 IP 수정', null, 'ip-publish-test',
  null, null, null, null, null, false, 'publish-upsert-live-ip', null
);
select 1 / case when (
  select published_at is not null and title = '게시 업서트 공개 IP 수정'
  from public.ips where id = 'publish-upsert-live-ip'
) then 1 else 0 end as assert_upsert_keeps_publish_state;

-- Editing with an explicit false reverts to draft.
select public.admin_upsert_ip(
  'publish-upsert-live-ip', '게시 업서트 공개 IP 수정', null, 'ip-publish-test',
  null, null, null, null, null, false, 'publish-upsert-live-ip', false
);
select 1 / case when (
  select published_at is null from public.ips where id = 'publish-upsert-live-ip'
) then 1 else 0 end as assert_upsert_false_reverts_to_draft;

-- The legacy 11-argument call shape still resolves and leaves publish state alone.
select public.admin_upsert_ip(
  'publish-upsert-draft-ip', '게시 업서트 초안 IP 수정', null, 'ip-publish-test',
  null, null, null, null, null, false, 'publish-upsert-draft-ip'
);
select 1 / case when (
  select published_at is null and title = '게시 업서트 초안 IP 수정'
  from public.ips where id = 'publish-upsert-draft-ip'
) then 1 else 0 end as assert_legacy_upsert_shape_keeps_draft;

select 1 / case when (
  select count(*)
  from public.audit_log as audit
  where audit.actor_id = '00000000-0000-4000-8000-000000013001'
    and audit.action = 'admin.ip.published'
    and audit.target = 'ips:publish-upsert-live-ip'
) = 1 and (
  select count(*)
  from public.audit_log as audit
  where audit.actor_id = '00000000-0000-4000-8000-000000013001'
    and audit.action = 'catalog.ip.upsert'
    and audit.target = 'ips:publish-upsert-live-ip'
) = 3 then 1 else 0 end as assert_upsert_publish_audits_both_events;

-- Publishing an archived IP through the upsert rolls the whole save back.
do $$
begin
  begin
    perform public.admin_upsert_ip(
      'publish-archived-ip', '게시스모크 보관 IP 수정', null, 'ip-publish-test',
      null, null, null, null, null, false, 'publish-archived-ip', true
    );
  exception
    when check_violation then
      if sqlerrm = 'catalog_item_archived' then return; end if;
      raise;
  end;
  raise exception 'publishing an archived IP through upsert should fail';
end;
$$;

select 1 / case when (
  select title = '게시스모크 보관 IP' and published_at is null
  from public.ips where id = 'publish-archived-ip'
) then 1 else 0 end as assert_archived_upsert_publish_rolled_back;

rollback;
