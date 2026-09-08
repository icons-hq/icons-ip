\set ON_ERROR_STOP on

-- 규모 후속 — 이벤트 축 공개 페이징

begin;

insert into public.verticals (key, label, color) values ('sfe', '이벤트 페이징', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('sfe-ip', '이벤트 페이징 IP', 'sfe') on conflict (id) do nothing;

-- 시드 이벤트는 games 가 참조하므로 지우지 않는다. 내 행끼리의 **상대 순서**와, 표 전체로
-- 계산한 기대값을 본다 — 시드가 몇 건이든 같은 결론이 나야 한다.
insert into public.events (id, ip_id, title, mode, status)
values
  ('sfe-e2', 'sfe-ip', '예정 둘', '오프라인', '예정'),
  ('sfe-e10', 'sfe-ip', '진행 열', '오프라인', '진행중'),
  ('sfe-e1', 'sfe-ip', '예매 하나', '오프라인', '예매중'),
  ('sfe-e3', 'sfe-ip', '온라인 셋', '온라인', '진행중'),
  ('sfe-e4', 'sfe-ip', '보관 넷', '오프라인', '진행중');
update public.events set archived_at = now() where id = 'sfe-e4';

set local role anon;

-- 정렬은 서버가 한다: 진행중 → 예매중 → 예정. 보관은 빠진다. 온라인은 제외 인자로 뺀다.
select 1 / case when (
  (select pg_catalog.string_agg(id, ',' order by ord)
   from (select id, pg_catalog.row_number() over () as ord
         from public.storefront_events_page(p_exclude_mode => '온라인', p_limit => 500)) as page
   where id like 'sfe-%')
  = 'sfe-e10,sfe-e1,sfe-e2'
) then 1 else 0 end as assert_offline_page_is_status_ordered_and_excludes_online;

-- 제외 인자가 없으면 온라인도 담긴다 — 같은 상태 안에서는 자연 순서(e3 < e10).
select 1 / case when (
  (select pg_catalog.string_agg(id, ',' order by ord)
   from (select id, pg_catalog.row_number() over () as ord
         from public.storefront_events_page(p_limit => 500)) as page
   where id like 'sfe-%')
  = 'sfe-e3,sfe-e10,sfe-e1,sfe-e2'
) then 1 else 0 end as assert_all_modes_when_not_excluded;

-- total_count 는 자른 뒤가 아니라 **거른 전체**다 — 「더 보기」가 이 수를 본다.
select 1 / case when (
  (select total_count from public.storefront_events_page(p_exclude_mode => '온라인', p_limit => 1) limit 1)
    = (select count(*) from public.events where archived_at is null and mode is distinct from '온라인')
  and (select count(*) from public.storefront_events_page(p_exclude_mode => '온라인', p_limit => 1)) = 1
  -- offset 으로 넘긴 페이지들을 이어 붙이면 한 번에 읽은 것과 같다.
  and (select pg_catalog.string_agg(id, ',' order by ord) from (
         select id, pg_catalog.row_number() over () as ord from public.storefront_events_page(p_exclude_mode => '온라인', p_limit => 500)) as whole)
    = (select pg_catalog.string_agg(id, ',' order by ord) from (
         select id, 1 as ord from public.storefront_events_page(p_exclude_mode => '온라인', p_limit => 2, p_offset => 0)
         union all
         select id, 2 from public.storefront_events_page(p_exclude_mode => '온라인', p_limit => 500, p_offset => 2)) as stitched)
) then 1 else 0 end as assert_total_counts_filtered_scope_not_page;

-- id 조회: 있는 것만, 보관은 빠진다, 모르는 id 는 조용히 없다.
select 1 / case when (
  (select count(*) from public.storefront_events_by_ids(array['sfe-e1', 'sfe-e4', 'no-such'])) = 1
  and (select id from public.storefront_events_by_ids(array['sfe-e1'])) = 'sfe-e1'
  and (select count(*) from public.storefront_events_by_ids(null)) = 0
) then 1 else 0 end as assert_by_ids_skips_archived_and_unknown;

reset role;

-- 권한 — 공개 표면이라 anon 도 읽는다. service_role 은 다른 public 표와 같은 규율로 제외.
select 1 / case when (
  has_function_privilege('anon', 'public.storefront_events_page(text,integer,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.storefront_events_by_ids(text[])', 'execute')
  and not has_function_privilege('service_role', 'public.storefront_events_page(text,integer,integer)', 'execute')
) then 1 else 0 end as assert_storefront_events_acl;

rollback;
