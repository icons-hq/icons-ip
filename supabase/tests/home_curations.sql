\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Schema, indexes, RLS, ACL, and the single staff write boundary.
-- ---------------------------------------------------------------------------
select 1 / case when (
  select count(*)
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'home_curations'
    and column_name in (
      'id', 'kind', 'ip_id', 'title', 'image_path', 'link_path',
      'display_order', 'active_from', 'active_to', 'enabled',
      'created_at', 'updated_at', 'slot', 'payload'
    )
) = 14 then 1 else 0 end as assert_home_curations_schema;

select 1 / case when (
  select pg_catalog.pg_get_constraintdef(constraint_record.oid)
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conrelid = 'public.home_curations'::regclass
    and constraint_record.conname = 'home_curations_kind_check'
) ilike all (array[
  '%''hero''%', '%''featured_ip''%', '%''announcement''%',
  '%''notice_strip''%', '%''editor_pick''%', '%''band_banner''%',
  '%''best_tab''%', '%''benefit''%'
]) then 1 else 0 end as assert_home_curations_kind_families;

select 1 / case when not exists (
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'home_curations'
    and column_name in ('active_from', 'active_to', 'created_at', 'updated_at')
    and data_type <> 'timestamp with time zone'
) then 1 else 0 end as assert_curation_timestamps_are_timestamptz;

select 1 / case when (
  select relrowsecurity
  from pg_catalog.pg_class
  where oid = 'public.home_curations'::regclass
) then 1 else 0 end as assert_home_curations_has_rls;

select 1 / case when (
  select count(*)
  from pg_catalog.pg_indexes
  where schemaname = 'public'
    and indexname in (
      'home_curations_active_read_idx',
      'home_curations_staff_read_idx'
    )
) = 2 then 1 else 0 end as assert_home_curations_read_indexes;

select 1 / case when (
  select count(*)
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename = 'home_curations'
    and policyname in (
      'home_curations_public_read',
      'home_curations_staff_read'
    )
) = 2 then 1 else 0 end as assert_home_curations_read_policies;

select 1 / case when
  has_table_privilege('anon', 'public.home_curations', 'select')
  and has_table_privilege('authenticated', 'public.home_curations', 'select')
  and not has_table_privilege('anon', 'public.home_curations', 'insert')
  and not has_table_privilege('authenticated', 'public.home_curations', 'insert')
  and not has_table_privilege('authenticated', 'public.home_curations', 'update')
  and not has_table_privilege('authenticated', 'public.home_curations', 'delete')
  and not has_table_privilege('service_role', 'public.home_curations', 'insert')
then 1 else 0 end as assert_home_curations_table_acl;

select 1 / case when exists (
  select 1
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.proname = 'admin_upsert_home_curation'
    and pg_catalog.pg_get_function_identity_arguments(proc.oid) =
      'target_operation_id uuid, target_curation_id uuid, target_kind text, target_ip_id text, target_title text, target_image_path text, target_link_path text, target_display_order integer, target_active_from timestamp with time zone, target_active_to timestamp with time zone, target_enabled boolean, target_slot text, target_payload jsonb'
    and pg_catalog.pg_get_function_result(proc.oid) = 'uuid'
    and proc.prosecdef
    and proc.provolatile = 'v'
    and proc.proconfig = array['search_path=""']
) then 1 else 0 end as assert_curation_rpc_security_contract;

select 1 / case when
  has_function_privilege(
    'authenticated',
    'public.admin_upsert_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.admin_upsert_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.admin_upsert_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb)',
    'execute'
  )
  and not exists (
    select 1
    from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
    cross join lateral aclexplode(
      coalesce(proc.proacl, acldefault('f', proc.proowner))
    ) as function_acl
    where namespace.nspname = 'public'
      and proc.proname = 'admin_upsert_home_curation'
      and function_acl.grantee = 0
      and function_acl.privilege_type = 'EXECUTE'
  )
then 1 else 0 end as assert_curation_rpc_acl;

select 1 / case when exists (
  select 1
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'private'
    and proc.proname = 'is_safe_home_curation_link'
    and pg_catalog.pg_get_function_identity_arguments(proc.oid) = 'candidate text'
    and pg_catalog.pg_get_function_result(proc.oid) = 'boolean'
    and proc.proisstrict
    and not proc.prosecdef
    and proc.provolatile = 'i'
    and proc.proconfig = array['search_path=""']
) and not exists (
  select 1
  from pg_catalog.pg_proc as proc
  join pg_catalog.pg_namespace as namespace on namespace.oid = proc.pronamespace
  cross join lateral aclexplode(
    coalesce(proc.proacl, acldefault('f', proc.proowner))
  ) as function_acl
  where namespace.nspname = 'private'
    and proc.proname = 'is_safe_home_curation_link'
    and (
      function_acl.grantee = 0
      or function_acl.grantee in (
        'anon'::regrole,
        'authenticated'::regrole,
        'service_role'::regrole
      )
    )
) then 1 else 0 end as assert_curation_link_validator_contract;

select 1 / case when
  private.is_safe_home_curation_link(
    '/search?q=%ED%99%94%EC%82%B0%20100%25#results'
  )
  and private.is_safe_home_curation_link('/events/%F0%9F%98%80')
  and private.is_safe_home_curation_link('/%252Fevil')
then 1 else 0 end as assert_legitimate_once_decoded_links;

select 1 / case when (
  select pg_catalog.pg_get_constraintdef(constraint_record.oid)
  from pg_catalog.pg_constraint as constraint_record
  where constraint_record.conrelid = 'public.home_curations'::regclass
    and constraint_record.conname = 'home_curations_active_window_check'
) ilike '%isfinite(active_from)%isfinite(active_to)%'
then 1 else 0 end as assert_curation_window_requires_finite_instants;

-- The migration backfills the legacy source once, in a deterministic order.
select 1 / case when not exists (
  select 1
  from public.ips as ip
  where ip.featured
    and ip.archived_at is null
    and not exists (
      select 1
      from public.home_curations as curation
      where curation.id = pg_catalog.md5(
          'home_curations:featured_ip:' || ip.id
        )::uuid
        and curation.kind = 'featured_ip'
        and curation.ip_id = ip.id
        and curation.title = ip.title
        and curation.link_path = '/ip/' || ip.id
        and curation.enabled
        and pg_catalog.isfinite(curation.active_from)
        and curation.active_from = ip.created_at
        and curation.display_order = (
          select ordered.ordinality::integer - 1
          from unnest(array(
            select featured_ip.id
            from public.ips as featured_ip
            where featured_ip.featured
              and featured_ip.archived_at is null
            order by featured_ip.id
          )) with ordinality as ordered(id, ordinality)
          where ordered.id = ip.id
        )
    )
) then 1 else 0 end as assert_featured_ip_backfill;

-- ---------------------------------------------------------------------------
-- Principals and fixtures.
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-4000-8000-000000011401', 'authenticated', 'authenticated', 'curation-staff@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000011402', 'authenticated', 'authenticated', 'curation-user@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000011403', 'authenticated', 'authenticated', 'curation-admin@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (
  id, email, nickname, birth_date, consents, onboarded_at, role,
  suspended_at, suspension_reason
)
values
  ('00000000-0000-4000-8000-000000011401', 'curation-staff@example.test', 'curation_staff', '2000-01-01', '{"terms":true,"privacy":true}', now(), 'staff', null, null),
  ('00000000-0000-4000-8000-000000011402', 'curation-user@example.test', 'curation_user', '2000-01-01', '{"terms":true,"privacy":true}', now(), 'user', null, null),
  ('00000000-0000-4000-8000-000000011403', 'curation-admin@example.test', 'curation_admin', '2000-01-01', '{"terms":true,"privacy":true}', now(), 'admin', null, null)
on conflict (id) do update set
  role = excluded.role,
  suspended_at = null,
  suspension_reason = null;

insert into public.verticals (key, label, color)
values ('home-curation-test', '홈 큐레이션 테스트', '#8B5CFF')
on conflict (key) do update set label = excluded.label, color = excluded.color;

insert into public.ips (id, title, vertical_key, archived_at)
values
  ('curation-active-ip', '활성 큐레이션 IP', 'home-curation-test', null),
  ('curation-archived-ip', '보관 큐레이션 IP', 'home-curation-test', now())
on conflict (id) do update set
  title = excluded.title,
  vertical_key = excluded.vertical_key,
  archived_at = excluded.archived_at;

insert into public.home_curations (
  id, kind, ip_id, title, image_path, link_path,
  display_order, active_from, active_to, enabled
)
values
  ('00000000-0000-4000-8000-000000011411', 'announcement', null, '현재 공지', null, '/events', 1, now() - interval '1 hour', now() + interval '1 hour', true),
  ('00000000-0000-4000-8000-000000011412', 'announcement', null, '예약 공지', null, '/events', 2, now() + interval '1 hour', now() + interval '2 hours', true),
  ('00000000-0000-4000-8000-000000011413', 'announcement', null, '종료 공지', null, '/events', 3, now() - interval '2 hours', now() - interval '1 hour', true),
  ('00000000-0000-4000-8000-000000011414', 'announcement', null, '비활성 공지', null, '/events', 4, now() - interval '1 hour', null, false),
  ('00000000-0000-4000-8000-000000011415', 'featured_ip', 'curation-active-ip', '활성 특집', null, '/ip/curation-active-ip', 5, now() - interval '1 hour', null, true),
  ('00000000-0000-4000-8000-000000011416', 'featured_ip', 'curation-archived-ip', '보관 특집', null, '/ip/curation-archived-ip', 6, now() - interval '1 hour', null, true);

-- ---------------------------------------------------------------------------
-- Public rows are explicit active rows; staff can inspect every state.
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);

select 1 / case when (
  select array_agg(title order by display_order, active_from, id)
  from public.home_curations
  where id in (
    '00000000-0000-4000-8000-000000011411',
    '00000000-0000-4000-8000-000000011412',
    '00000000-0000-4000-8000-000000011413',
    '00000000-0000-4000-8000-000000011414',
    '00000000-0000-4000-8000-000000011415',
    '00000000-0000-4000-8000-000000011416'
  )
) = array['현재 공지', '활성 특집']::text[]
then 1 else 0 end as assert_anon_reads_only_active_curations;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011402', true);

select 1 / case when (
  select count(*)
  from public.home_curations
  where id in (
    '00000000-0000-4000-8000-000000011411',
    '00000000-0000-4000-8000-000000011412',
    '00000000-0000-4000-8000-000000011413',
    '00000000-0000-4000-8000-000000011414',
    '00000000-0000-4000-8000-000000011415',
    '00000000-0000-4000-8000-000000011416'
  )
) = 2 then 1 else 0 end as assert_user_reads_only_active_curations;

do $$
begin
  begin
    insert into public.home_curations (
      id, kind, title, link_path, display_order, active_from
    ) values (
      '00000000-0000-4000-8000-000000011417',
      'announcement', '직접 쓰기', '/', 0, now()
    );
  exception when insufficient_privilege then return;
  end;
  raise exception 'authenticated direct curation insert should be blocked';
end;
$$;

do $$
begin
  begin
    perform public.admin_upsert_home_curation(
      '00000000-0000-4000-8000-000000011421',
      '00000000-0000-4000-8000-000000011422',
      'announcement', null, '사용자 공지', null, '/', 0,
      now(), null, true
    );
  exception when insufficient_privilege then
    if sqlerrm = 'forbidden' then return; end if;
    raise;
  end;
  raise exception 'non-staff curation upsert should be blocked';
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011401', true);

select 1 / case when (
  select count(*)
  from public.home_curations
  where id in (
    '00000000-0000-4000-8000-000000011411',
    '00000000-0000-4000-8000-000000011412',
    '00000000-0000-4000-8000-000000011413',
    '00000000-0000-4000-8000-000000011414',
    '00000000-0000-4000-8000-000000011415',
    '00000000-0000-4000-8000-000000011416'
  )
) = 6 then 1 else 0 end as assert_staff_reads_all_curations;

-- ---------------------------------------------------------------------------
-- Validation and audited/idempotent RPC behavior.
-- ---------------------------------------------------------------------------
select count(*) as notification_count_before_curation_upsert
from public.notifications
\gset

do $$
declare
  invalid_call record;
begin
  for invalid_call in
    select *
    from (values
      ('hero-without-image', 'hero', null::text, '히어로', null::text, '/', 0, now(), null::timestamptz, true),
      ('featured-without-ip', 'featured_ip', null, '특집', null, '/', 0, now(), null, true),
      ('announcement-with-ip', 'announcement', 'curation-active-ip', '공지', null, '/', 0, now(), null, true),
      ('unsafe-link', 'announcement', null, '공지', null, '//outside', 0, now(), null, true),
      ('encoded-scheme-relative-link', 'announcement', null, '공지', null, '/%2F%2Fevil', 0, now(), null, true),
      ('encoded-backslash-link', 'announcement', null, '공지', null, '/safe%5Cevil', 0, now(), null, true),
      ('encoded-control-link', 'announcement', null, '공지', null, '/safe%00evil', 0, now(), null, true),
      ('encoded-line-separator-link', 'announcement', null, '공지', null, '/safe%E2%80%A8evil', 0, now(), null, true),
      ('malformed-percent-link', 'announcement', null, '공지', null, '/safe%', 0, now(), null, true),
      ('malformed-percent-pair-link', 'announcement', null, '공지', null, '/safe%2G', 0, now(), null, true),
      ('invalid-utf8-link', 'announcement', null, '공지', null, '/safe%FF', 0, now(), null, true),
      ('encoded-bidi-link', 'announcement', null, '공지', null, '/safe%E2%80%AEevil', 0, now(), null, true),
      ('negative-order', 'announcement', null, '공지', null, '/', -1, now(), null, true),
      ('infinite-start', 'announcement', null, '공지', null, '/', 0, '-infinity'::timestamptz, null, true),
      ('invalid-window', 'announcement', null, '공지', null, '/', 0, now(), now(), true),
      ('archived-ip', 'featured_ip', 'curation-archived-ip', '특집', null, '/ip/curation-archived-ip', 0, now(), null, true)
    ) as calls(name, kind, ip_id, title, image_path, link_path, display_order, active_from, active_to, enabled)
  loop
    begin
      perform public.admin_upsert_home_curation(
        extensions.gen_random_uuid(), extensions.gen_random_uuid(),
        invalid_call.kind, invalid_call.ip_id, invalid_call.title,
        invalid_call.image_path, invalid_call.link_path,
        invalid_call.display_order, invalid_call.active_from,
        invalid_call.active_to, invalid_call.enabled
      );
    exception
      when invalid_parameter_value or not_null_violation or check_violation or no_data_found then
        continue;
    end;
    raise exception 'invalid curation call should fail: %', invalid_call.name;
  end loop;
end;
$$;

select public.admin_upsert_home_curation(
  '00000000-0000-4000-8000-000000011431',
  '00000000-0000-4000-8000-000000011432',
  'announcement', null, '  감사 공지  ', null, '/events', 7,
  '2026-07-21 10:30:00+09'::timestamptz,
  '2026-07-22 10:30:00+09'::timestamptz,
  true
) as created_curation_id \gset

select 1 / case when :'created_curation_id'::uuid =
  '00000000-0000-4000-8000-000000011432'::uuid
then 1 else 0 end as assert_curation_created;

select public.admin_upsert_home_curation(
  '00000000-0000-4000-8000-000000011431',
  '00000000-0000-4000-8000-000000011432',
  'announcement', null, '감사 공지', null, '/events', 7,
  '2026-07-21 10:30:00+09'::timestamptz,
  '2026-07-22 10:30:00+09'::timestamptz,
  true
) as replayed_curation_id \gset

select 1 / case when :'replayed_curation_id'::uuid = :'created_curation_id'::uuid
then 1 else 0 end as assert_exact_replay_returns_same_id;

select 1 / case when (
  select count(*) = 1
    and bool_and(actor_id = '00000000-0000-4000-8000-000000011401')
    and bool_and(action = 'admin.home_curation.upserted')
    and bool_and(target = 'home_curations:00000000-0000-4000-8000-000000011432')
    and bool_and(diff -> 'request' ->> 'title' = '감사 공지')
    and bool_and(diff -> 'before' = 'null'::jsonb)
    and bool_and(diff -> 'after' ->> 'id' = '00000000-0000-4000-8000-000000011432')
  from public.audit_log
  where id = '00000000-0000-4000-8000-000000011431'
) then 1 else 0 end as assert_curation_audit_snapshot;

do $$
begin
  begin
    perform public.admin_upsert_home_curation(
      '00000000-0000-4000-8000-000000011431',
      '00000000-0000-4000-8000-000000011432',
      'announcement', null, '충돌 공지', null, '/events', 7,
      '2026-07-21 10:30:00+09'::timestamptz,
      '2026-07-22 10:30:00+09'::timestamptz,
      true
    );
  exception when unique_violation then
    if sqlerrm = 'operation_conflict' then return; end if;
    raise;
  end;
  raise exception 'operation payload reuse should conflict';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011403', true);

do $$
begin
  begin
    perform public.admin_upsert_home_curation(
      '00000000-0000-4000-8000-000000011431',
      '00000000-0000-4000-8000-000000011432',
      'announcement', null, '감사 공지', null, '/events', 7,
      '2026-07-21 10:30:00+09'::timestamptz,
      '2026-07-22 10:30:00+09'::timestamptz,
      true
    );
  exception when unique_violation then
    if sqlerrm = 'operation_conflict' then return; end if;
    raise;
  end;
  raise exception 'operation actor reuse should conflict';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011401', true);

select public.admin_upsert_home_curation(
  '00000000-0000-4000-8000-000000011433',
  '00000000-0000-4000-8000-000000011432',
  'announcement', null, '수정 공지', null, '/', 8,
  '2026-07-21 10:30:00+09'::timestamptz,
  null, false
);

select 1 / case when exists (
  select 1
  from public.audit_log
  where id = '00000000-0000-4000-8000-000000011433'
    and diff #>> '{before,title}' = '감사 공지'
    and diff #>> '{after,title}' = '수정 공지'
    and (diff #>> '{after,enabled}')::boolean = false
) then 1 else 0 end as assert_curation_update_before_after_audit;

select 1 / case when not exists (
  select 1
  from public.notifications
  where source_type = 'admin_announcement'
    and source_id in (
      '00000000-0000-4000-8000-000000011431',
      '00000000-0000-4000-8000-000000011433'
    )
) and (
  select count(*)
  from public.notifications
) = :'notification_count_before_curation_upsert'::bigint
then 1 else 0 end as assert_curation_upsert_has_no_notification_side_effect;

-- Authenticated catalog writes remain RPC-only even for staff profiles.
do $$
begin
  begin
    update public.ips
    set archived_at = pg_catalog.clock_timestamp()
    where id = 'curation-active-ip';
  exception when insufficient_privilege then
    if sqlerrm = 'permission denied for table ips' then return; end if;
    raise;
  end;
  raise exception 'authenticated staff direct IP update privilege should remain closed';
end;
$$;

-- Exercise the persistent trigger through a role that really owns direct table
-- UPDATE privilege; authenticated staff reaches the same invariant via the RPC.
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011401', true);

do $$
begin
  begin
    update public.ips
    set archived_at = pg_catalog.clock_timestamp()
    where id = 'curation-active-ip';
  exception when check_violation then
    if sqlerrm = 'ip_has_active_home_curation' then return; end if;
    raise;
  end;
  raise exception 'service-role direct IP archive should be blocked by active home curation';
end;
$$;

reset role;

select 1 / case when
  pg_catalog.pg_get_functiondef(
    'private.guard_ip_archive()'::regprocedure
  ) ilike '%from public.home_curations%'
  and pg_catalog.pg_get_functiondef(
    'private.guard_ip_archive()'::regprocedure
  ) ilike '%curation.enabled%'
  and pg_catalog.pg_get_functiondef(
    'private.guard_ip_archive()'::regprocedure
  ) ilike '%curation.active_to is null%'
then 1 else 0 end as assert_direct_ip_archive_curation_guard;

select pg_catalog.pg_get_functiondef(
  'public.admin_upsert_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb)'::regprocedure
) as curation_rpc_definition \gset

select 1 / case when
  strpos(:'curation_rpc_definition', 'pg_advisory_xact_lock') > 0
  and strpos(:'curation_rpc_definition', 'for update of ip') > 0
  and strpos(:'curation_rpc_definition', 'ip.archived_at') > 0
then 1 else 0 end as assert_curation_upsert_serializes_operation_entity_and_ip;

-- ---------------------------------------------------------------------------
-- S3 kind expansion (#325): slot/payload validation, new band kinds,
-- payload-carried mobile artwork claims, and public reads of the new kinds.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011401', true);

do $$
declare
  invalid_call record;
begin
  for invalid_call in
    select *
    from (values
      ('best-tab-without-slot', 'best_tab', null::text, 'BEST 탭', null::text, '/shop', 0, null::text, null::jsonb),
      ('best-tab-unknown-slot', 'best_tab', null, 'BEST 탭', null, '/shop', 0, 'weekly', null),
      ('slot-on-plain-kind', 'announcement', null, '공지', null, '/events', 0, 'category', null),
      ('payload-on-plain-kind', 'announcement', null, '공지', null, '/events', 0, null, '{"description":"안내"}'::jsonb),
      ('unknown-payload-key', 'benefit', null, '혜택', null, '/packs', 0, null, '{"unknown":"x"}'::jsonb),
      ('notice-strip-without-image', 'notice_strip', null, '공지 스트립', null, '/events', 0, null, null),
      ('editor-pick-without-image', 'editor_pick', null, '에디터 픽', null, '/events', 0, null, null),
      ('band-banner-without-image', 'band_banner', null, '기획전', null, '/shop', 0, null, null),
      ('good-ids-not-array', 'best_tab', null, 'BEST 탭', null, '/shop', 0, 'category', '{"good_ids":"g1"}'::jsonb),
      ('good-ids-empty', 'best_tab', null, 'BEST 탭', null, '/shop', 0, 'category', '{"good_ids":[]}'::jsonb),
      ('good-ids-bad-entry', 'best_tab', null, 'BEST 탭', null, '/shop', 0, 'category', '{"good_ids":["bad id!"]}'::jsonb),
      ('benefit-with-ip', 'benefit', 'curation-active-ip', '혜택', null, '/packs', 0, null, null),
      ('badge-too-long', 'editor_pick', null, '에디터 픽', 'public-media/catalog/curation/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp', '/events', 0, null, '{"badge":"아주아주아주아주아주아주아주아주아주아주긴배지"}'::jsonb),
      ('subtitle-on-benefit', 'benefit', null, '혜택', null, '/packs', 0, null, '{"subtitle":"부제"}'::jsonb)
    ) as calls(name, kind, ip_id, title, image_path, link_path, display_order, slot, payload)
  loop
    begin
      perform public.admin_upsert_home_curation(
        extensions.gen_random_uuid(), extensions.gen_random_uuid(),
        invalid_call.kind, invalid_call.ip_id, invalid_call.title,
        invalid_call.image_path, invalid_call.link_path,
        invalid_call.display_order, now(), null, true,
        invalid_call.slot, invalid_call.payload
      );
    exception
      when invalid_parameter_value or not_null_violation or check_violation or no_data_found then
        continue;
    end;
    raise exception 'invalid expanded curation call should fail: %', invalid_call.name;
  end loop;
end;
$$;

-- band_banner caps good_ids at four entries.
do $$
begin
  begin
    perform public.admin_upsert_home_curation(
      extensions.gen_random_uuid(), extensions.gen_random_uuid(),
      'band_banner', null, '기획전',
      'public-media/catalog/curation/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.webp',
      '/shop', 0, now(), null, true,
      null, '{"good_ids":["g1","g2","g3","g4","g5"]}'::jsonb
    );
  exception when invalid_parameter_value then return;
  end;
  raise exception 'band_banner with five good_ids should fail';
end;
$$;

select public.admin_upsert_home_curation(
  '00000000-0000-4000-8000-000000011501',
  '00000000-0000-4000-8000-000000011502',
  'benefit', null, '카드팩 무료 개봉', null, '/packs', 0,
  now() - interval '1 hour', null, true,
  null, '{"description":"  로그인하면 무료 카드팩을 열 수 있어요  "}'::jsonb
);

select 1 / case when exists (
  select 1
  from public.home_curations
  where id = '00000000-0000-4000-8000-000000011502'
    and kind = 'benefit'
    and slot is null
    and payload = '{"description":"로그인하면 무료 카드팩을 열 수 있어요"}'::jsonb
) then 1 else 0 end as assert_benefit_payload_trimmed_and_stored;

select public.admin_upsert_home_curation(
  '00000000-0000-4000-8000-000000011503',
  '00000000-0000-4000-8000-000000011504',
  'best_tab', null, '키링', null, '/shop', 1,
  now() - interval '1 hour', null, true,
  'category', '{"good_ids":["g1","g2"]}'::jsonb
);

select public.admin_upsert_home_curation(
  '00000000-0000-4000-8000-000000011505',
  '00000000-0000-4000-8000-000000011506',
  'best_tab', null, 'MULTI', null, '/shop', 0,
  now() - interval '1 hour', null, true,
  'popular', '{"good_ids":["g3"]}'::jsonb
);

select 1 / case when (
  select count(*)
  from public.home_curations
  where kind = 'best_tab'
    and (
      (id = '00000000-0000-4000-8000-000000011504' and slot = 'category')
      or (id = '00000000-0000-4000-8000-000000011506' and slot = 'popular')
    )
) = 2 then 1 else 0 end as assert_best_tab_slots_stored;

-- Empty payload objects collapse to null instead of persisting husks.
select public.admin_upsert_home_curation(
  '00000000-0000-4000-8000-000000011507',
  '00000000-0000-4000-8000-000000011508',
  'benefit', null, '게임 참여 안내', null, '/events', 1,
  now() - interval '1 hour', null, true,
  null, '{}'::jsonb
);

select 1 / case when exists (
  select 1
  from public.home_curations
  where id = '00000000-0000-4000-8000-000000011508'
    and payload is null
) then 1 else 0 end as assert_empty_payload_stored_as_null;

-- Image-first kinds still run through the verified artwork claim contract.
reset role;
insert into public.admin_artwork_upload_claims (
  path, actor_id, kind, mime_type, source_size, final_size,
  status, expires_at, processing_started_at, verified_at
)
values
  (
    'catalog/curation/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp',
    '00000000-0000-4000-8000-000000011401', 'curation', 'image/webp',
    1024, 1024, 'verified', now() + interval '10 minutes', now(), now()
  ),
  (
    'catalog/curation/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp',
    '00000000-0000-4000-8000-000000011401', 'curation', 'image/webp',
    1024, 1024, 'verified', now() + interval '10 minutes', now(), now()
  ),
  (
    'catalog/curation/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.webp',
    '00000000-0000-4000-8000-000000011401', 'curation', 'image/webp',
    1024, 1024, 'verified', now() + interval '10 minutes', now(), now()
  );

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011401', true);

select public.admin_upsert_home_curation(
  '00000000-0000-4000-8000-000000011509',
  '00000000-0000-4000-8000-000000011510',
  'notice_strip', null, '배송 공지 스트립',
  'public-media/catalog/curation/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp',
  '/events', 0, now() - interval '1 hour', null, true,
  null, null
);

-- Hero mobile artwork inside payload consumes its own verified claim.
select public.admin_upsert_home_curation(
  '00000000-0000-4000-8000-000000011511',
  '00000000-0000-4000-8000-000000011512',
  'hero', null, '여름 히어로',
  'public-media/catalog/curation/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp',
  '/events', 0, now() - interval '1 hour', null, true,
  null,
  '{"subtitle":"SUMMER DROP","mobile_image_path":"public-media/catalog/curation/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.webp"}'::jsonb
);

reset role;

select 1 / case when exists (
  select 1
  from public.admin_artwork_upload_claims
  where path = 'catalog/curation/cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp'
    and status = 'attached'
) then 1 else 0 end as assert_notice_strip_consumed_image_claim;

select 1 / case when exists (
  select 1
  from public.admin_artwork_upload_claims
  where path = 'catalog/curation/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.webp'
    and status = 'attached'
) then 1 else 0 end as assert_hero_mobile_artwork_consumed_claim;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011401', true);

-- Replaying the identical hero request stays idempotent without a fresh claim.
select public.admin_upsert_home_curation(
  '00000000-0000-4000-8000-000000011511',
  '00000000-0000-4000-8000-000000011512',
  'hero', null, '여름 히어로',
  'public-media/catalog/curation/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp',
  '/events', 0, now() - interval '1 hour', null, true,
  null,
  '{"subtitle":"SUMMER DROP","mobile_image_path":"public-media/catalog/curation/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.webp"}'::jsonb
);

do $$
begin
  begin
    perform public.admin_upsert_home_curation(
      extensions.gen_random_uuid(), extensions.gen_random_uuid(),
      'hero', null, '미검증 모바일 히어로',
      'public-media/catalog/curation/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp',
      '/events', 1, now(), null, true,
      null,
      '{"mobile_image_path":"public-media/catalog/curation/ffffffff-ffff-4fff-8fff-ffffffffffff.webp"}'::jsonb
    );
  exception when check_violation then
    if sqlerrm = 'unverified_artwork' then return; end if;
    raise;
  end;
  raise exception 'hero with unverified mobile artwork should be blocked';
end;
$$;

-- Anonymous readers see the new active kinds, slots, and payloads.
reset role;
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);

select 1 / case when (
  select count(*)
  from public.home_curations
  where id in (
    '00000000-0000-4000-8000-000000011502',
    '00000000-0000-4000-8000-000000011504',
    '00000000-0000-4000-8000-000000011506',
    '00000000-0000-4000-8000-000000011510',
    '00000000-0000-4000-8000-000000011512'
  )
    and (kind <> 'best_tab' or slot in ('category', 'popular'))
) = 5 then 1 else 0 end as assert_anon_reads_new_active_kinds;

select 1 / case when (
  select payload ->> 'mobile_image_path'
  from public.home_curations
  where id = '00000000-0000-4000-8000-000000011512'
) = 'public-media/catalog/curation/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.webp'
then 1 else 0 end as assert_anon_reads_hero_mobile_payload;

reset role;

rollback;
