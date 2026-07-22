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
      'created_at', 'updated_at'
    )
) = 12 then 1 else 0 end as assert_home_curations_schema;

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
      'target_operation_id uuid, target_curation_id uuid, target_kind text, target_ip_id text, target_title text, target_image_path text, target_link_path text, target_display_order integer, target_active_from timestamp with time zone, target_active_to timestamp with time zone, target_enabled boolean'
    and pg_catalog.pg_get_function_result(proc.oid) = 'uuid'
    and proc.prosecdef
    and proc.provolatile = 'v'
    and proc.proconfig = array['search_path=""']
) then 1 else 0 end as assert_curation_rpc_security_contract;

select 1 / case when
  has_function_privilege(
    'authenticated',
    'public.admin_upsert_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.admin_upsert_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.admin_upsert_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean)',
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
  'public.admin_upsert_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean)'::regprocedure
) as curation_rpc_definition \gset

select 1 / case when
  strpos(:'curation_rpc_definition', 'pg_advisory_xact_lock') > 0
  and strpos(:'curation_rpc_definition', 'for update of ip') > 0
  and strpos(:'curation_rpc_definition', 'ip.archived_at') > 0
then 1 else 0 end as assert_curation_upsert_serializes_operation_entity_and_ip;

rollback;
