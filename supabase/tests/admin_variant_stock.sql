\set ON_ERROR_STOP on

-- D-1a — 출고지 · 옵션 마스터 · 품목 · 품목×출고지 재고 · 이동 기록 · 캐시 브리지 (설계서 v2 §1-1, 보고서 A §5 테스트 포인트)

begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000881', 'authenticated', 'authenticated', 'variant-staff@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-000000000882', 'authenticated', 'authenticated', 'variant-fan@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-000000000881', 'variant-staff@example.test', 'variant_staff', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'),
  ('00000000-0000-4000-8000-000000000882', 'variant-fan@example.test', 'variant_fan', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user')
on conflict (id) do update set email = excluded.email, nickname = excluded.nickname, role = excluded.role;

insert into public.verticals (key, label, color) values ('admin-vs-test', '품목 테스트', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('admin-vs-ip', '품목 테스트 IP', 'admin-vs-test') on conflict (id) do nothing;

-- 레거시 등록 경로: stock·stock_qty 를 직접 넣는다 → 기본 품목·재고 행·initial 이동이 자동으로 생긴다
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('admin-vs-g0', 'admin-vs-ip', '재입고 알림 굿즈', '문구', 1000, 'ok', 0),
  ('admin-vs-g1', 'admin-vs-ip', '옵션 굿즈', '키링', 5000, 'ok', 10),
  ('admin-vs-g2', 'admin-vs-ip', '부족 굿즈', '문구', 1000, 'low', 3),
  ('admin-vs-g3', 'admin-vs-ip', '판매 중지 굿즈', '문구', 1000, 'soldout', 5)
on conflict (id) do nothing;

insert into public.restock_alerts (id, user_id, good_id, status)
values (gen_random_uuid(), '00000000-0000-4000-8000-000000000882', 'admin-vs-g0', 'pending');

-- ---------------------------------------------------------------------------
-- A. 등록 시 기본 품목 자동 생성 + 캐시 정규화
-- ---------------------------------------------------------------------------
select 1 / case when (
  (select count(*) from public.good_variants where good_id = 'admin-vs-g1' and is_default and code = 'admin-vs-g1-01') = 1
  and (select count(*) from public.variant_stocks s join public.good_variants v on v.id = s.variant_id where v.good_id = 'admin-vs-g1') = (select count(*) from public.stock_locations where active)
  and (select on_hand_qty from public.variant_stocks s join public.good_variants v on v.id = s.variant_id where v.good_id = 'admin-vs-g1' and s.location_id = 'gimpo') = 10
  and (select count(*) from public.stock_movements m join public.good_variants v on v.id = m.variant_id where v.good_id = 'admin-vs-g1' and m.reason_code = 'initial' and m.delta_on_hand = 10) = 1
  and (select stock || ':' || stock_qty || ':' || stock_override from public.goods where id = 'admin-vs-g1') = 'ok:10:auto'
  and (select stock || ':' || stock_qty || ':' || stock_override from public.goods where id = 'admin-vs-g2') = 'low:3:low'
  and (select stock || ':' || stock_qty || ':' || stock_override from public.goods where id = 'admin-vs-g3') = 'soldout:5:soldout'
) then 1 else 0 end as assert_default_variant_created_on_insert;

-- ---------------------------------------------------------------------------
-- B. 레거시 직접 쓰기 브리지 — stock_qty → 기본 품목 이동, stock → 덮어쓰기
-- ---------------------------------------------------------------------------
update public.goods set stock_qty = 15 where id = 'admin-vs-g1';
update public.goods set stock = 'soldout' where id = 'admin-vs-g1';
select 1 / case when (
  (select on_hand_qty from public.variant_stocks s join public.good_variants v on v.id = s.variant_id where v.good_id = 'admin-vs-g1' and s.location_id = 'gimpo') = 15
  and (select count(*) from public.stock_movements m join public.good_variants v on v.id = m.variant_id where v.good_id = 'admin-vs-g1' and m.reason_code = 'legacy_write' and m.delta_on_hand = 5) = 1
  and (select stock || ':' || stock_qty || ':' || stock_override from public.goods where id = 'admin-vs-g1') = 'soldout:15:soldout'
) then 1 else 0 end as assert_legacy_writes_are_bridged;
update public.goods set stock = 'ok' where id = 'admin-vs-g1';
select 1 / case when (select stock || ':' || stock_override from public.goods where id = 'admin-vs-g1') = 'ok:auto'
  then 1 else 0 end as assert_legacy_stock_reset_to_auto;

select id as v_g1_default from public.good_variants where good_id = 'admin-vs-g1' and is_default \gset
select set_config('vs.v_g1_default', :'v_g1_default', true);
select id as v_g0_default from public.good_variants where good_id = 'admin-vs-g0' and is_default \gset
select set_config('vs.v_g0_default', :'v_g0_default', true);
select id as v_g2_default from public.good_variants where good_id = 'admin-vs-g2' and is_default \gset
select set_config('vs.v_g2_default', :'v_g2_default', true);

-- ---------------------------------------------------------------------------
-- C. ACL — authenticated 만 execute · 일반 회원은 RPC 안에서 거부 · anon 은 재고 표를 못 읽는다
-- ---------------------------------------------------------------------------
select 1 / case when (
  has_function_privilege('authenticated', 'public.admin_adjust_variant_stock(uuid,uuid,text,integer,integer,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_adjust_variant_stock(uuid,uuid,text,integer,integer,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_upsert_variants(text,uuid,jsonb,jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_upsert_variants(text,uuid,jsonb,jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_set_variant_stock_bulk(uuid,text,jsonb,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_list_variant_stocks(text,text,text,boolean,boolean,integer,integer)', 'execute')
  and not has_table_privilege('authenticated', 'public.variant_stocks', 'update')
  and not has_table_privilege('anon', 'public.variant_stocks', 'select')
  and has_table_privilege('anon', 'public.good_variants', 'select')
  and not has_table_privilege('service_role', 'public.stock_movements', 'update')
) then 1 else 0 end as assert_variant_stock_acl;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000882', true);
do $$
begin
  perform public.admin_adjust_variant_stock('00000000-0000-4000-8000-00000000a001', null, 'gimpo', 0, 1, 'receive');
  raise exception 'member must not adjust';
exception when insufficient_privilege then null;
end $$;
select 1 / case when (select count(*) from public.variant_stocks) = 0 then 1 else 0 end as assert_member_sees_no_stock_rows;

-- ---------------------------------------------------------------------------
-- D. 품목 재고 조정 — 멱등 · 충돌 · expected · 범위 · 사유
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000881', true);

select 1 / case when (
  select on_hand_qty = 20 and reserved_qty = 0 and available = 20
  from public.admin_adjust_variant_stock('00000000-0000-4000-8000-00000000a001', :'v_g1_default', 'gimpo', 15, 5, 'receive')
) then 1 else 0 end as assert_variant_adjust_applies;
select 1 / case when (
  (select on_hand_qty from public.admin_adjust_variant_stock('00000000-0000-4000-8000-00000000a001', :'v_g1_default', 'gimpo', 15, 5, 'receive')) = 20
  and (select count(*) from public.stock_movements where id = '00000000-0000-4000-8000-00000000a001') = 1
  and (select stock_qty from public.goods where id = 'admin-vs-g1') = 20
) then 1 else 0 end as assert_variant_adjust_is_idempotent;

do $$
begin
  perform public.admin_adjust_variant_stock('00000000-0000-4000-8000-00000000a001', current_setting('vs.v_g1_default')::uuid, 'gimpo', 20, 7, 'receive');
  raise exception 'replay with different delta must conflict';
exception when unique_violation then null;
end $$;
do $$
begin
  perform public.admin_adjust_variant_stock('00000000-0000-4000-8000-00000000a002', current_setting('vs.v_g1_default')::uuid, 'gimpo', 10, 1, 'receive');
  raise exception 'stale expected must fail';
exception when others then
  if sqlerrm <> 'stock_changed' then raise; end if;
end $$;
do $$
begin
  perform public.admin_adjust_variant_stock('00000000-0000-4000-8000-00000000a003', current_setting('vs.v_g1_default')::uuid, 'gimpo', 20, -100, 'damage');
  raise exception 'negative on_hand must fail';
exception when numeric_value_out_of_range then null;
end $$;
do $$
begin
  perform public.admin_adjust_variant_stock('00000000-0000-4000-8000-00000000a004', current_setting('vs.v_g1_default')::uuid, 'gimpo', 20, 1, 'correction');
  raise exception 'correction without note must fail';
exception when invalid_parameter_value then
  if sqlerrm <> 'stock_note_required' then raise; end if;
end $$;
do $$
begin
  perform public.admin_adjust_variant_stock('00000000-0000-4000-8000-00000000a005', current_setting('vs.v_g1_default')::uuid, 'gimpo', 20, 1, 'order_ship');
  raise exception 'order reason must be rejected for admin';
exception when invalid_parameter_value then
  if sqlerrm <> 'invalid_stock_reason' then raise; end if;
end $$;

-- ---------------------------------------------------------------------------
-- E. 상품 단위 래퍼(admin_adjust_stock) — 기존 계약 그대로: 감사 기록 · 멱등 · 캐시
-- ---------------------------------------------------------------------------
-- 상태를 바꾸는 호출은 단언과 같은 문장에 두지 않는다 — AND 피연산자의 평가 순서는 보장되지 않는다.
select public.admin_adjust_stock('00000000-0000-4000-8000-00000000a010', 'admin-vs-g1', 20, -5, '파손') as wrapper_first \gset
select 1 / case when (
  :'wrapper_first'::integer = 15
  and (select stock_qty from public.goods where id = 'admin-vs-g1') = 15
  and (select on_hand_qty from public.variant_stocks where variant_id = :'v_g1_default' and location_id = 'gimpo') = 15
  and public.admin_adjust_stock('00000000-0000-4000-8000-00000000a010', 'admin-vs-g1', 20, -5, '파손') = 15
) then 1 else 0 end as assert_good_level_wrapper_parity;
-- 감사 기록은 스태프 RLS 밖에서 본다
reset role;
select 1 / case when (
  (select reason_code || ':' || note from public.stock_movements where id = '00000000-0000-4000-8000-00000000a010') = 'correction:파손'
  and (select action from public.audit_log where id = '00000000-0000-4000-8000-00000000a010') = 'admin.good.stock_adjusted'
  and (select count(*) from public.stock_movements where id = '00000000-0000-4000-8000-00000000a010') = 1
) then 1 else 0 end as assert_good_level_wrapper_audit;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000881', true);

-- ---------------------------------------------------------------------------
-- F. 옵션 마스터
-- ---------------------------------------------------------------------------
select (public.admin_upsert_option_master(null, '색상', 'select', 1, false, '[{"value":"빨강"},{"value":"파랑"}]'::jsonb)) as color \gset
select (public.admin_upsert_option_master(null, '사이즈', 'button', 2, false, '[{"value":"S"},{"value":"M"}]'::jsonb)) as size \gset
select (:'color'::jsonb ->> 'id') as color_id, (:'size'::jsonb ->> 'id') as size_id \gset
select set_config('vs.color_id', :'color_id', true);
select set_config('vs.size_id', :'size_id', true);
select (select v.id from public.option_values v where v.option_id = :'color_id'::uuid and v.value = '빨강') as red_id,
       (select v.id from public.option_values v where v.option_id = :'color_id'::uuid and v.value = '파랑') as blue_id,
       (select v.id from public.option_values v where v.option_id = :'size_id'::uuid and v.value = 'S') as s_id,
       (select v.id from public.option_values v where v.option_id = :'size_id'::uuid and v.value = 'M') as m_id \gset
select set_config('vs.red_id', :'red_id', true), set_config('vs.blue_id', :'blue_id', true), set_config('vs.s_id', :'s_id', true), set_config('vs.m_id', :'m_id', true);
select 1 / case when (
  (:'color'::jsonb ->> 'code') ~ '^O[0-9]{4}$'
  and jsonb_array_length(:'color'::jsonb -> 'values') = 2
  and (select count(*) from public.option_masters where archived_at is null and id in (:'color_id'::uuid, :'size_id'::uuid)) = 2
) then 1 else 0 end as assert_option_master_upsert;

-- ---------------------------------------------------------------------------
-- G. 품목 일괄 upsert — 옵션 도입: 기본 품목 보관 · 새 품목 2 · 초기 재고 · 캐시 = 판매 중 품목 가용 합 · 멱등
-- ---------------------------------------------------------------------------
select format('[{"option_id":"%s","position":1},{"option_id":"%s","position":2}]', :'color_id', :'size_id') as opts \gset
select set_config('vs.opts', :'opts', true);
select format(
  '[{"values":{"%1$s":"%3$s","%2$s":"%5$s"},"custom_code":"RED-S","initial_stocks":[{"location_id":"gimpo","on_hand_qty":4}]},'
  '{"values":{"%1$s":"%3$s","%2$s":"%6$s"},"initial_stocks":[{"location_id":"gimpo","on_hand_qty":6}]}]',
  :'color_id', :'size_id', :'red_id', :'blue_id', :'s_id', :'m_id') as vars \gset

select public.admin_upsert_variants('admin-vs-g1', '00000000-0000-4000-8000-00000000b001', :'opts'::jsonb, :'vars'::jsonb) as upsert1 \gset
select 1 / case when (
  jsonb_array_length(:'upsert1'::jsonb -> 'variants') = 2
  and (:'upsert1'::jsonb -> 'archived') @> to_jsonb(:'v_g1_default'::uuid)
  and (:'upsert1'::jsonb ->> 'stocks_created')::integer = 2
  and (select count(*) from public.good_variants where good_id = 'admin-vs-g1' and archived_at is null) = 2
  and (select archived_at is not null and not is_default from public.good_variants where id = :'v_g1_default')
  and (select string_agg(code, ',' order by code) from public.good_variants where good_id = 'admin-vs-g1' and archived_at is null) = 'admin-vs-g1-02,admin-vs-g1-03'
  and (select stock_qty from public.goods where id = 'admin-vs-g1') = 10
  and (select count(*) from public.good_options where good_id = 'admin-vs-g1') = 2
  and public.admin_upsert_variants('admin-vs-g1', '00000000-0000-4000-8000-00000000b001', :'opts'::jsonb, :'vars'::jsonb) = :'upsert1'::jsonb
) then 1 else 0 end as assert_variants_upsert_with_options;

select id as v_red_s from public.good_variants where custom_code = 'RED-S' \gset
select set_config('vs.v_red_s', :'v_red_s', true);
select id as v_red_m from public.good_variants where good_id = 'admin-vs-g1' and archived_at is null and custom_code is null \gset
select set_config('vs.v_red_m', :'v_red_m', true);

do $$
begin
  perform public.admin_upsert_variants('admin-vs-g1', '00000000-0000-4000-8000-00000000b002', current_setting('vs.opts')::jsonb,
    format('[{"id":"%s","values":{"%s":"%s","%s":"%s"}},{"values":{"%s":"%s","%s":"%s"}}]',
      current_setting('vs.v_red_s')::uuid, current_setting('vs.color_id')::uuid, current_setting('vs.red_id')::uuid, current_setting('vs.size_id')::uuid, current_setting('vs.s_id')::uuid, current_setting('vs.color_id')::uuid, current_setting('vs.red_id')::uuid, current_setting('vs.size_id')::uuid, current_setting('vs.s_id')::uuid)::jsonb);
  raise exception 'duplicate signature must fail';
exception when unique_violation then
  if sqlerrm <> 'variant_duplicate' then raise; end if;
end $$;
do $$
begin
  perform public.admin_upsert_variants('admin-vs-g1', '00000000-0000-4000-8000-00000000b003', current_setting('vs.opts')::jsonb,
    format('[{"id":"%s","values":{"%s":"%s"}}]', current_setting('vs.v_red_s')::uuid, current_setting('vs.color_id')::uuid, current_setting('vs.red_id')::uuid)::jsonb);
  raise exception 'missing option value must fail';
exception when invalid_parameter_value then
  if sqlerrm <> 'variant_values_required' then raise; end if;
end $$;
do $$
begin
  perform public.admin_upsert_variants('admin-vs-g1', '00000000-0000-4000-8000-00000000b004', current_setting('vs.opts')::jsonb,
    format('[{"id":"%s","values":{"%s":"%s","%s":"%s"},"initial_stocks":[{"location_id":"gimpo","on_hand_qty":1}]}]',
      current_setting('vs.v_red_s')::uuid, current_setting('vs.color_id')::uuid, current_setting('vs.red_id')::uuid, current_setting('vs.size_id')::uuid, current_setting('vs.s_id')::uuid)::jsonb);
  raise exception 'initial stock on existing variant must fail';
exception when invalid_parameter_value then
  if sqlerrm <> 'variant_initial_stock_existing' then raise; end if;
end $$;
-- 품목이 여러 개인 상품: 상품 단위 조정·직접 쓰기는 막힌다
do $$
begin
  perform public.admin_adjust_stock('00000000-0000-4000-8000-00000000a011', 'admin-vs-g1', 10, 1, '금지');
  raise exception 'good-level adjust on multi-variant good must fail';
exception when object_not_in_prerequisite_state then null;
end $$;

-- ---------------------------------------------------------------------------
-- H. 이동 — 보관된 기본 품목 재고(15)를 새 품목으로 · 멱등 · 같은 상품만
-- ---------------------------------------------------------------------------
select from_on_hand as transfer_from, to_on_hand as transfer_to
from public.admin_transfer_variant_stock('00000000-0000-4000-8000-00000000c001', :'v_g1_default', 'gimpo', :'v_red_s', 'gimpo', 15, '옵션 도입 이관') \gset
select 1 / case when (
  :'transfer_from'::integer = 0 and :'transfer_to'::integer = 19
  and (select from_on_hand = 0 and to_on_hand = 19 from public.admin_transfer_variant_stock('00000000-0000-4000-8000-00000000c001', :'v_g1_default', 'gimpo', :'v_red_s', 'gimpo', 15, '옵션 도입 이관'))
  and (select count(*) from public.stock_movements where ref_type = 'transfer' and ref_id = '00000000-0000-4000-8000-00000000c001') = 2
  and (select stock_qty from public.goods where id = 'admin-vs-g1') = 25
) then 1 else 0 end as assert_transfer_between_variants;
do $$
begin
  perform public.admin_transfer_variant_stock('00000000-0000-4000-8000-00000000c002', current_setting('vs.v_red_s')::uuid, 'gimpo', current_setting('vs.v_g2_default')::uuid, 'gimpo', 1, null);
  raise exception 'cross-good transfer must fail';
exception when invalid_parameter_value then
  if sqlerrm <> 'variant_transfer_cross_good' then raise; end if;
end $$;

-- ---------------------------------------------------------------------------
-- I. 안전재고 → 캐시 'low' 파생(덮어쓰기 auto) · 목록 RPC 의 안전재고 이하 필터
-- ---------------------------------------------------------------------------
select public.admin_set_variant_safety(:'v_red_s', 'gimpo', 20);
select 1 / case when (
  (select stock from public.goods where id = 'admin-vs-g1') = 'low'
  and (select count(*) from public.admin_list_variant_stocks(p_query => 'admin-vs-g1', p_only_low => true)) = 1
  and (select option_summary from public.admin_list_variant_stocks(p_query => 'RED-S', p_location_id => 'gimpo')) = '색상: 빨강 / 사이즈: S'
  and (select max(total_count) from public.admin_list_variant_stocks(p_ip_id => 'admin-vs-ip', p_limit => 1)) = 10
  and (select count(*) from public.admin_list_stock_movements(:'v_red_s')) = 2
) then 1 else 0 end as assert_safety_low_and_inventory_reads;
select public.admin_set_variant_safety(:'v_red_s', 'gimpo', 0);
select 1 / case when (select stock from public.goods where id = 'admin-vs-g1') = 'ok' then 1 else 0 end as assert_safety_cleared;

-- ---------------------------------------------------------------------------
-- J. 절대값 일괄 — 오류 1행이면 아무것도 안 쓴다 · 성공 · 멱등
-- ---------------------------------------------------------------------------
select public.admin_set_variant_stock_bulk('00000000-0000-4000-8000-00000000d001', 'excel',
  '[{"ref":"RED-S","on_hand_qty":30},{"ref":"admin-vs-g2","on_hand_qty":0},{"ref":"nope","on_hand_qty":1}]'::jsonb) as bulk1 \gset
select 1 / case when (
  (:'bulk1'::jsonb ->> 'applied')::integer = 0
  and (:'bulk1'::jsonb -> 'errors') = '[{"row":3,"code":"variant_not_found"}]'::jsonb
  and (select on_hand_qty from public.variant_stocks where variant_id = :'v_red_s' and location_id = 'gimpo') = 19
) then 1 else 0 end as assert_bulk_rejects_all_on_error;
select public.admin_set_variant_stock_bulk('00000000-0000-4000-8000-00000000d002', 'excel',
  '[{"ref":"RED-S","location_id":"gimpo","on_hand_qty":30,"safety_qty":5},{"ref":"admin-vs-g2","on_hand_qty":0}]'::jsonb) as bulk2 \gset
select 1 / case when (
  (:'bulk2'::jsonb ->> 'applied')::integer = 2
  and (select on_hand_qty || ':' || safety_qty from public.variant_stocks where variant_id = :'v_red_s' and location_id = 'gimpo') = '30:5'
  and (select stock_qty from public.goods where id = 'admin-vs-g2') = 0
  and (select stock_qty from public.goods where id = 'admin-vs-g1') = 36
  and public.admin_set_variant_stock_bulk('00000000-0000-4000-8000-00000000d002', 'excel', '[{"ref":"RED-S","on_hand_qty":1}]'::jsonb) = :'bulk2'::jsonb
  and (select applied_count from public.stock_upload_batches where id = '00000000-0000-4000-8000-00000000d002') = 2
) then 1 else 0 end as assert_bulk_applies_and_is_idempotent;

-- ---------------------------------------------------------------------------
-- K. 출고지 — 새 출고지에 재고 행 생성 · 기본 출고지 해제 금지 · 재고 남은 출고지 비활성 금지
-- ---------------------------------------------------------------------------
select public.admin_upsert_stock_location('busan', '부산', null, null, null, 'W03', false, true, 3);
select 1 / case when (
  (select count(*) from public.variant_stocks where location_id = 'busan') = (select count(*) from public.good_variants where archived_at is null)
) then 1 else 0 end as assert_new_location_gets_stock_rows;
do $$
begin
  perform public.admin_upsert_stock_location('gimpo', '김포', null, null, null, null, false, true, 1);
  raise exception 'unsetting the default must fail';
exception when invalid_parameter_value then
  if sqlerrm <> 'location_default_required' then raise; end if;
end $$;
select from_on_hand from public.admin_transfer_variant_stock('00000000-0000-4000-8000-00000000c003', :'v_red_s', 'gimpo', :'v_red_s', 'busan', 3, null);
do $$
begin
  perform public.admin_upsert_stock_location('busan', '부산', null, null, null, 'W03', false, false, 3);
  raise exception 'deactivating a location with stock must fail';
exception when invalid_parameter_value then
  if sqlerrm <> 'location_has_stock' then raise; end if;
end $$;
select public.admin_upsert_stock_location('namyangju', '남양주', null, null, null, null, true, true, 2);
select 1 / case when (
  (select is_default from public.stock_locations where id = 'namyangju')
  and not (select is_default from public.stock_locations where id = 'gimpo')
) then 1 else 0 end as assert_default_location_switch;

-- ---------------------------------------------------------------------------
-- L. 재입고 알림 — 캐시가 0 → n 으로 뒤집히면 기존 트리거가 그대로 발화한다
-- ---------------------------------------------------------------------------
select on_hand_qty from public.admin_adjust_variant_stock('00000000-0000-4000-8000-00000000a020', :'v_g0_default', 'gimpo', 0, 5, 'receive');
-- 알림·재입고 신청 행은 본인 RLS 밖에서 본다
reset role;
select 1 / case when (
  (select stock_qty from public.goods where id = 'admin-vs-g0') = 5
  and (select status from public.restock_alerts where good_id = 'admin-vs-g0' and user_id = '00000000-0000-4000-8000-000000000882') = 'notified'
  and (select count(*) from public.notifications where user_id = '00000000-0000-4000-8000-000000000882' and type = 'restock_available' and source_id = 'admin-vs-g0') = 1
) then 1 else 0 end as assert_restock_alert_fires_from_variant_adjust;

-- ---------------------------------------------------------------------------
-- M. 이동 기록은 추가 전용 · 캐시 불변식(모든 상품)
-- ---------------------------------------------------------------------------
do $$
begin
  update public.stock_movements set note = 'x' where id = '00000000-0000-4000-8000-00000000a001';
  raise exception 'movement update must fail';
exception when object_not_in_prerequisite_state then null;
end $$;
select 1 / case when (
  select count(*) = 0
  from public.goods as good
  join private.good_stock_totals(good.id, good.stock_override) as totals on true
  where good.stock_qty is distinct from totals.stock_qty or good.stock is distinct from totals.stock
) then 1 else 0 end as assert_cache_invariant_holds;

set local role anon;
do $$
begin
  perform count(*) from public.variant_stocks;
  raise exception 'anon must not read stocks';
exception when insufficient_privilege then null;
end $$;
select 1 / case when (select count(*) from public.good_variants where good_id = 'admin-vs-g1') = 3 then 1 else 0 end as assert_anon_reads_variants;
reset role;

rollback;
