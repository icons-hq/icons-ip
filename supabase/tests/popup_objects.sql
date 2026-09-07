\set ON_ERROR_STOP on

-- 팝업 객체 · 페이즈 · 진열 예약 (설계서 v2 §1-8)

begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-00000000e001', 'authenticated', 'authenticated', 'pop-staff@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-00000000e002', 'authenticated', 'authenticated', 'pop-fan@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-00000000e001', 'pop-staff@example.test', 'pop_staff', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'),
  ('00000000-0000-4000-8000-00000000e002', 'pop-fan@example.test', 'pop_fan', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user')
on conflict (id) do update set
  email = excluded.email, nickname = excluded.nickname, birth_date = excluded.birth_date,
  consents = excluded.consents, onboarded_at = excluded.onboarded_at, role = excluded.role;

insert into public.verticals (key, label, color) values ('pop', '팝업 테스트', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('pop-ip', '팝업 테스트 IP', 'pop') on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('pop-g1', 'pop-ip', '팝업 굿즈 1', '키링', 10000, 'ok', 50),
  ('pop-g2', 'pop-ip', '팝업 굿즈 2', '문구', 20000, 'ok', 50)
on conflict (id) do nothing;

select set_config('pop.t0', (date_trunc('hour', now()) - interval '2 hours')::text, true);
select set_config('pop.t1', (date_trunc('hour', now()) - interval '1 hour')::text, true);
select set_config('pop.t2', (date_trunc('hour', now()) + interval '1 hour')::text, true);
select set_config('pop.t3', (date_trunc('hour', now()) + interval '3 hours')::text, true);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000e001', true);

-- ---------------------------------------------------------------------------
-- A. 팝업 생성 — 페이즈 없이 게시할 수 없다
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.admin_upsert_popup(
    'pop-demo', 'pop-ip', '지우학 팝업', null, 'published',
    current_setting('pop.t0')::timestamptz, current_setting('pop.t3')::timestamptz
  );
  raise exception 'publishing without phases must fail';
exception when others then
  if sqlerrm <> 'published_without_phases' then raise; end if;
end $$;

select public.admin_upsert_popup(
  'pop-demo', 'pop-ip', '지우학 팝업', '9월 온라인 팝업', 'draft',
  current_setting('pop.t0')::timestamptz, current_setting('pop.t3')::timestamptz
) as popup_id \gset

-- 기간이 뒤집히면 거절한다.
do $$
begin
  perform public.admin_upsert_popup(
    'pop-bad', 'pop-ip', '거꾸로', null, 'draft',
    current_setting('pop.t3')::timestamptz, current_setting('pop.t0')::timestamptz
  );
  raise exception 'inverted period must fail';
exception when others then
  if sqlerrm <> 'invalid_popup_period' then raise; end if;
end $$;

-- 슬러그는 캠페인·이벤트와 한 칸을 다툰다.
reset role;
insert into public.campaigns (id, title, kind, status, starts_at, ends_at)
values ('pop-taken', '이미 쓴 슬러그', 'event', 'draft',
        current_setting('pop.t0')::timestamptz, current_setting('pop.t3')::timestamptz)
on conflict (id) do nothing;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000e001', true);
do $$
begin
  perform public.admin_upsert_popup(
    'pop-taken', 'pop-ip', '겹치는 슬러그', null, 'draft',
    current_setting('pop.t0')::timestamptz, current_setting('pop.t3')::timestamptz
  );
  raise exception 'slug shared with a campaign must fail';
exception when others then
  if sqlerrm <> 'catalog_id_taken' then raise; end if;
end $$;

-- ---------------------------------------------------------------------------
-- B. 페이즈 — 겹치면 막고, 팝업 기간을 넘으면 막는다
-- ---------------------------------------------------------------------------
select public.admin_set_popup_phases('pop-demo', jsonb_build_array(
  jsonb_build_object('key', 'preview', 'label', '프리뷰', 'starts_at', current_setting('pop.t0'), 'ends_at', current_setting('pop.t1'), 'sort', 1, 'default_sale_mode', 'teaser'),
  jsonb_build_object('key', 'live_1', 'label', '1부', 'starts_at', current_setting('pop.t1'), 'ends_at', current_setting('pop.t2'), 'sort', 2, 'default_sale_mode', 'on_sale'),
  jsonb_build_object('key', 'wrapup', 'label', '마무리', 'starts_at', current_setting('pop.t2'), 'ends_at', current_setting('pop.t3'), 'sort', 3, 'default_sale_mode', 'sellout')
)) as phase_ids \gset

select 1 / case when jsonb_array_length(:'phase_ids'::jsonb) = 3
  and (select count(*) from public.popup_phases where popup_id = 'pop-demo') = 3
  then 1 else 0 end as assert_phases_saved;

do $$
begin
  perform public.admin_set_popup_phases('pop-demo', jsonb_build_array(
    jsonb_build_object('key', 'preview', 'label', '프리뷰', 'starts_at', current_setting('pop.t0'), 'ends_at', current_setting('pop.t2')),
    jsonb_build_object('key', 'live_1', 'label', '1부', 'starts_at', current_setting('pop.t1'), 'ends_at', current_setting('pop.t3'))
  ));
  raise exception 'overlapping phases must fail';
exception when exclusion_violation then null;
end $$;

do $$
begin
  perform public.admin_set_popup_phases('pop-demo', jsonb_build_array(
    jsonb_build_object('key', 'preview', 'label', '프리뷰', 'starts_at', current_setting('pop.t0'),
                       'ends_at', (current_setting('pop.t3')::timestamptz + interval '1 hour')::text)
  ));
  raise exception 'phase outside the popup window must fail';
exception when others then
  if sqlerrm <> 'phase_outside_popup' then raise; end if;
end $$;

-- 낙관 잠금 — 남이 먼저 저장했으면 덮어쓰지 않는다.
do $$
begin
  perform public.admin_set_popup_phases('pop-demo', '[]'::jsonb, now() - interval '1 day');
  raise exception 'stale write must fail';
exception when others then
  if sqlerrm <> 'stale_write' then raise; end if;
end $$;

-- ---------------------------------------------------------------------------
-- C. 존 · 연결 — 없는 원본은 걸 수 없다
-- ---------------------------------------------------------------------------
reset role;
insert into public.popup_zones (popup_id, code, kind, name, door, sort)
values ('pop-demo', 'Z1', 'commerce', '상점', '합류', 1),
       ('pop-demo', 'Z2', 'experience', '체험 존', '수색', 2);
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000e001', true);

do $$
begin
  perform public.admin_link_popup_targets('pop-demo', jsonb_build_array(
    jsonb_build_object('target_type', 'good', 'target_id', '없는굿즈')
  ));
  raise exception 'unknown target must fail';
exception when others then
  if sqlerrm <> 'unknown_target' then raise; end if;
end $$;

select public.admin_link_popup_targets('pop-demo', jsonb_build_array(
  jsonb_build_object(
    'zone_code', 'Z1', 'target_type', 'good', 'target_id', 'pop-g1', 'sort', 1,
    'phase_rules', jsonb_build_array(
      jsonb_build_object('phase_key', 'preview', 'sale_mode', 'hidden'),
      jsonb_build_object('phase_key', 'live_1', 'sale_mode', 'on_sale')
    )
  ),
  jsonb_build_object(
    'zone_code', 'Z1', 'target_type', 'good', 'target_id', 'pop-g2', 'sort', 2,
    'default_sale_mode', 'teaser'
  )
), true) as link_ids \gset

select 1 / case when jsonb_array_length(:'link_ids'::jsonb) = 2 then 1 else 0 end as assert_links_saved;

-- 모르는 존·페이즈 키도 막는다.
do $$
begin
  perform public.admin_link_popup_targets('pop-demo', jsonb_build_array(
    jsonb_build_object('zone_code', 'ZZ', 'target_type', 'good', 'target_id', 'pop-g1')
  ));
  raise exception 'unknown zone must fail';
exception when others then
  if sqlerrm <> 'unknown_zone' then raise; end if;
end $$;

-- ---------------------------------------------------------------------------
-- D. 유효 모드 — 규칙 › 연결 기본 › 페이즈 기본
-- ---------------------------------------------------------------------------
select id as link_g1 from public.popup_links where popup_id = 'pop-demo' and target_id = 'pop-g1' \gset
select id as link_g2 from public.popup_links where popup_id = 'pop-demo' and target_id = 'pop-g2' \gset
select set_config('pop.link_g1', :'link_g1', true), set_config('pop.link_g2', :'link_g2', true);

select 1 / case when (
  -- 프리뷰 창: g1 은 규칙이 hidden, g2 는 연결 기본 teaser 가 페이즈 기본(teaser)과 같다.
  public.popup_effective_mode(current_setting('pop.link_g1')::uuid, current_setting('pop.t0')::timestamptz + interval '1 minute') = 'hidden'
  and public.popup_effective_mode(current_setting('pop.link_g2')::uuid, current_setting('pop.t0')::timestamptz + interval '1 minute') = 'teaser'
  -- 1부: g1 은 규칙 on_sale, g2 는 연결 기본 teaser 가 페이즈 기본(on_sale)을 이긴다.
  and public.popup_effective_mode(current_setting('pop.link_g1')::uuid, current_setting('pop.t1')::timestamptz + interval '1 minute') = 'on_sale'
  and public.popup_effective_mode(current_setting('pop.link_g2')::uuid, current_setting('pop.t1')::timestamptz + interval '1 minute') = 'teaser'
  -- 마무리: g1 은 규칙이 없어 페이즈 기본 sellout 으로 떨어진다.
  and public.popup_effective_mode(current_setting('pop.link_g1')::uuid, current_setting('pop.t2')::timestamptz + interval '1 minute') = 'sellout'
) then 1 else 0 end as assert_mode_precedence_is_narrow_over_wide;

-- 팝업 기간 밖: 시작 전은 감추고 끝난 뒤는 닫는다.
select 1 / case when (
  public.popup_effective_mode(current_setting('pop.link_g1')::uuid, current_setting('pop.t0')::timestamptz - interval '1 minute') = 'hidden'
  and public.popup_effective_mode(current_setting('pop.link_g1')::uuid, current_setting('pop.t3')::timestamptz + interval '1 minute') = 'closed'
) then 1 else 0 end as assert_outside_the_window_is_hidden_then_closed;

-- 경계는 반열림이다 — 정각은 다음 페이즈의 것이다.
select 1 / case when (
  (select key from public.popup_current_phase('pop-demo', current_setting('pop.t1')::timestamptz)) = 'live_1'
  and (select key from public.popup_current_phase('pop-demo', current_setting('pop.t1')::timestamptz - interval '1 microsecond')) = 'preview'
) then 1 else 0 end as assert_boundary_belongs_to_the_next_phase;

-- ---------------------------------------------------------------------------
-- E. 표시 상태 — 운영자 의사가 시각보다 세다
-- ---------------------------------------------------------------------------
select public.admin_upsert_popup(
  'pop-demo', 'pop-ip', '지우학 팝업', '9월 온라인 팝업', 'published',
  current_setting('pop.t0')::timestamptz, current_setting('pop.t3')::timestamptz,
  null, null, 'pop-demo'
);
reset role;

select 1 / case when (
  (select public.popup_display_state(popup, now()) from public.popups as popup where popup.id = 'pop-demo') = 'live'
  and (select public.popup_display_state(popup, current_setting('pop.t0')::timestamptz - interval '1 minute')
       from public.popups as popup where popup.id = 'pop-demo') = 'upcoming'
  and (select public.popup_display_state(popup, current_setting('pop.t3')::timestamptz)
       from public.popups as popup where popup.id = 'pop-demo') = 'ended'
) then 1 else 0 end as assert_display_state_follows_the_clock;

update public.popups set status = 'paused' where id = 'pop-demo';
select 1 / case when (
  select public.popup_display_state(popup, now()) from public.popups as popup where popup.id = 'pop-demo'
) = 'paused' then 1 else 0 end as assert_operator_intent_beats_the_clock;
update public.popups set status = 'published' where id = 'pop-demo';

-- ---------------------------------------------------------------------------
-- F. 스냅샷 — 감춘 연결은 아예 안 나간다
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000e002', true);
select public.popup_snapshot('pop-demo') as snap \gset
reset role;

select 1 / case when (
  (:'snap'::jsonb ->> 'displayState') = 'live'
  and (:'snap'::jsonb ->> 'currentPhase') = 'live_1'
  and (:'snap'::jsonb ->> 'serverNow') is not null
  and jsonb_array_length(:'snap'::jsonb -> 'phases') = 3
  and jsonb_array_length(:'snap'::jsonb -> 'zones') = 2
  -- 1부에는 둘 다 나온다(g1 on_sale · g2 teaser).
  and jsonb_array_length(:'snap'::jsonb -> 'links') = 2
) then 1 else 0 end as assert_snapshot_reports_the_current_phase;

-- 프리뷰 시각의 스냅샷은 staff 만 볼 수 있고, 거기서는 g1 이 빠진다(hidden).
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000e002', true);
do $$
begin
  perform public.popup_snapshot('pop-demo', current_setting('pop.t0')::timestamptz + interval '1 minute');
  raise exception 'non-staff must not preview other instants';
exception when others then
  if sqlerrm <> 'forbidden' then raise; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000e001', true);
select public.popup_snapshot('pop-demo', current_setting('pop.t0')::timestamptz + interval '1 minute') as preview \gset
reset role;

select 1 / case when (
  jsonb_array_length(:'preview'::jsonb -> 'links') = 1
  and (:'preview'::jsonb -> 'links' -> 0 ->> 'targetId') = 'pop-g2'
  and (:'preview'::jsonb ->> 'currentPhase') = 'preview'
) then 1 else 0 end as assert_hidden_links_never_leave_the_server;

-- 초안·보관 팝업은 비staff 에게 없는 것과 같다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000e001', true);
select public.admin_upsert_popup(
  'pop-draft', 'pop-ip', '초안 팝업', null, 'draft',
  current_setting('pop.t0')::timestamptz, current_setting('pop.t3')::timestamptz
);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000e002', true);
do $$
begin
  perform public.popup_snapshot('pop-draft');
  raise exception 'draft popup must be invisible to fans';
exception when others then
  if sqlerrm <> 'popup_unavailable' then raise; end if;
end $$;

-- 연결 표는 직접 못 읽는다 — 스냅샷을 지나야 한다.
select count(*) as fan_links from public.popup_links \gset
select 1 / case when :'fan_links'::integer = 0 then 1 else 0 end as assert_links_are_not_publicly_readable;
reset role;

-- ---------------------------------------------------------------------------
-- G. 권한
-- ---------------------------------------------------------------------------
select 1 / case when (
  has_function_privilege('anon', 'public.popup_snapshot(text,timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_upsert_popup(text,text,text,text,text,timestamptz,timestamptz,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_upsert_popup(text,text,text,text,text,timestamptz,timestamptz,text,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_link_popup_targets(text,jsonb,boolean)', 'execute')
  and not has_table_privilege('anon', 'public.popup_links', 'select')
  and not has_table_privilege('authenticated', 'public.popups', 'insert')
) then 1 else 0 end as assert_popup_acl;

rollback;
