\set ON_ERROR_STOP on

-- D-9 분류 트리·소속·진열 · D-10 판매 기간·상태 파생·주문 게이트 (설계서 v2 §1-2, 보고서 B §5 테스트 포인트)

begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-0000000008a1', 'authenticated', 'authenticated', 'cat-staff@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000008a2', 'authenticated', 'authenticated', 'cat-buyer@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-0000000008a1', 'cat-staff@example.test', 'cat_staff', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'),
  ('00000000-0000-4000-8000-0000000008a2', 'cat-buyer@example.test', 'cat_buyer', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user')
on conflict (id) do update set
  email = excluded.email, nickname = excluded.nickname, birth_date = excluded.birth_date,
  consents = excluded.consents, onboarded_at = excluded.onboarded_at, role = excluded.role;

insert into public.verticals (key, label, color) values ('cat-test', '분류 테스트', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('cat-ip', '분류 테스트 IP', 'cat-test') on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('cat-g1', 'cat-ip', '분류 테스트 굿즈', '아크릴', 12000, 'ok', 10),
  ('cat-g2', 'cat-ip', '품절 굿즈', '키링', 5000, 'ok', 0),
  ('cat-g3', 'cat-ip', '고정 굿즈', '문구', 3000, 'ok', 5)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- A. ACL — authenticated 만 execute, 일반 회원은 RPC 안에서 거부
-- ---------------------------------------------------------------------------
select 1 / case when (
  has_function_privilege('authenticated', 'public.admin_upsert_category(text,text,text,text,text,text,boolean,text,text,boolean,boolean,text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_upsert_category(text,text,text,text,text,text,boolean,text,text,boolean,boolean,text,text,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_set_good_sale_window(text,timestamptz,timestamptz,text,date)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_list_categories(boolean)', 'execute')
  and has_function_privilege('anon', 'public.good_sale_state(public.goods,timestamptz)', 'execute')
  and not has_table_privilege('authenticated', 'public.categories', 'insert')
  and has_table_privilege('anon', 'public.categories', 'select')
) then 1 else 0 end as assert_category_acl;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000008a2', true);
do $$
begin
  perform public.admin_upsert_category('nope', '거부');
  raise exception 'member must not create categories';
exception when insufficient_privilege then null;
end $$;

-- ---------------------------------------------------------------------------
-- B. 트리 — 1~3단은 ERP 노드(정체 잠금), 자체 분류는 ERP 잎 아래 4단째. 깊이 4 상한·순환 거부·서브트리 재계산은
--    트리거의 일이라 동기화 플래그 아래 직접 조작으로 확인한다(ERP 노드를 옮기는 주체가 동기화라서).
-- ---------------------------------------------------------------------------
reset role;
select set_config('icons.erp_category_sync', 'on', true);
insert into public.categories (id, kind, parent_id, name, path, depth, position, source, erp_key) values
  ('cat-root', 'catalog', null, '테스트 대', '', 1, 90, 'erp', 'T > 대'),
  ('cat-acrylic', 'catalog', 'cat-root', '테스트 중', '', 1, 0, 'erp', 'T > 대 > 중'),
  ('cat-stand', 'catalog', 'cat-acrylic', '테스트 소', '', 1, 0, 'erp', 'T > 대 > 중 > 소'),
  ('cat-root2', 'catalog', null, '테스트 대2', '', 1, 91, 'erp', 'T > 대2');

select 1 / case when (
  (select path || ':' || depth from public.categories where id = 'cat-stand') = '/cat-root/cat-acrylic/cat-stand/:3'
  and (select position from public.categories where id = 'cat-root2') = 91
) then 1 else 0 end as assert_tree_path_and_depth;

do $$
begin
  insert into public.categories (id, kind, parent_id, name, path, depth, position, source, erp_key)
  values ('cat-mini', 'catalog', 'cat-stand', '4단', '', 1, 0, 'erp', 'T > 4단');
  insert into public.categories (id, kind, parent_id, name, path, depth, position, source, erp_key)
  values ('cat-too-deep', 'catalog', 'cat-mini', '너무깊음', '', 1, 0, 'erp', 'T > 5단');
  raise exception 'depth 5 must fail';
exception when check_violation then
  if sqlerrm <> 'category_depth_exceeded' then raise; end if;
end $$;

do $$
begin
  update public.categories set parent_id = 'cat-stand' where id = 'cat-root';
  raise exception 'moving a node under its own descendant must fail';
exception when check_violation then
  if sqlerrm <> 'category_cycle' then raise; end if;
end $$;

-- 서브트리를 옮기면 자손 path·depth 가 따라온다.
update public.categories set parent_id = 'cat-root2' where id = 'cat-acrylic';
select 1 / case when (
  (select path || ':' || depth from public.categories where id = 'cat-stand') = '/cat-root2/cat-acrylic/cat-stand/:3'
  and (select depth from public.categories where id = 'cat-acrylic') = 2
) then 1 else 0 end as assert_subtree_move_recomputes_descendants;
select set_config('icons.erp_category_sync', 'off', true);

-- 플래그 없이는 ERP 노드를 못 건드린다 — RPC 도 마찬가지.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000008a1', true);
do $$
begin
  perform public.admin_move_category('cat-acrylic', 'cat-root');
  raise exception 'moving an erp node must fail';
exception when check_violation then
  if sqlerrm <> 'category_erp_locked' then raise; end if;
end $$;
do $$
declare
  v_ids text[];
begin
  select array_agg(id order by position desc, id) into v_ids from public.categories where parent_id is null;
  perform public.admin_reorder_categories(null, v_ids);
  raise exception 'reordering erp roots must fail';
exception when check_violation then
  if sqlerrm <> 'category_erp_locked' then raise; end if;
end $$;

-- 자체 분류: ERP 잎 아래 4단째만. 형제 재정렬은 자체 분류끼리, 형제 전체를 요구하고 0..n-1 로 다시 매긴다.
do $$
begin
  perform public.admin_upsert_category('cat-own-root', '자체 최상위');
  raise exception 'store root must fail';
exception when check_violation then
  if sqlerrm <> 'category_catalog_under_erp_leaf' then raise; end if;
end $$;
select public.admin_upsert_category('cat-own-a', '자체 A', 'cat-stand');
select public.admin_upsert_category('cat-own-b', '자체 B', 'cat-stand');
select 1 / case when (
  (select path || ':' || depth || ':' || source from public.categories where id = 'cat-own-b') = '/cat-root2/cat-acrylic/cat-stand/cat-own-b/:4:store'
  and (select position from public.categories where id = 'cat-own-b') = 1
) then 1 else 0 end as assert_store_leaf_under_erp_leaf;

do $$
begin
  perform public.admin_reorder_categories('cat-stand', array['cat-own-a']);
  raise exception 'partial reorder must fail';
exception when check_violation then
  if sqlerrm <> 'category_reorder_incomplete' then raise; end if;
end $$;
select public.admin_reorder_categories('cat-stand', array['cat-own-b', 'cat-own-a']);
select 1 / case when (
  (select position from public.categories where id = 'cat-own-b') = 0
  and (select position from public.categories where id = 'cat-own-a') = 1
) then 1 else 0 end as assert_reorder_renumbers;

-- 같은 요청 id 의 재전송은 이미 적용으로 읽는다(멱등).
select public.admin_reorder_categories('cat-stand', array['cat-own-a', 'cat-own-b'], '00000000-0000-4000-8000-0000000008b1');
select public.admin_reorder_categories('cat-stand', array['cat-own-b', 'cat-own-a'], '00000000-0000-4000-8000-0000000008b1');
select 1 / case when (select position from public.categories where id = 'cat-own-a') = 0
  then 1 else 0 end as assert_reorder_is_idempotent;

-- ---------------------------------------------------------------------------
-- C. 소속 — 대표 1개 · 집합 교체 · 대표 없이 소속 불가 · 비어 있지 않은 분류 보관 거부 · ERP 노드 보관 거부
-- ---------------------------------------------------------------------------
select public.admin_set_good_categories('cat-g1', 'cat-own-a', array['cat-own-a', 'cat-stand']);
select 1 / case when (
  (select count(*) from public.good_categories where good_id = 'cat-g1') = 2
  and (select category_id from public.good_categories where good_id = 'cat-g1' and is_primary) = 'cat-own-a'
) then 1 else 0 end as assert_primary_and_set;

-- 집합을 줄이면 빠진 소속이 사라진다.
select public.admin_set_good_categories('cat-g1', 'cat-stand', array['cat-stand']);
select 1 / case when (
  (select count(*) from public.good_categories where good_id = 'cat-g1') = 1
  and (select category_id from public.good_categories where good_id = 'cat-g1' and is_primary) = 'cat-stand'
) then 1 else 0 end as assert_set_replacement;

do $$
begin
  perform public.admin_set_good_categories('cat-g1', null, array['cat-stand']);
  raise exception 'membership without a primary must fail';
exception when check_violation then
  if sqlerrm <> 'category_primary_required' then raise; end if;
end $$;

select public.admin_set_good_categories('cat-g3', 'cat-own-b', array['cat-own-b']);
do $$
begin
  perform public.admin_archive_category('cat-own-b');
  raise exception 'archiving a category that still holds goods must fail';
exception when check_violation then
  if sqlerrm <> 'category_not_empty' then raise; end if;
end $$;
do $$
begin
  perform public.admin_archive_category('cat-stand');
  raise exception 'archiving an erp node must fail';
exception when check_violation then
  if sqlerrm <> 'category_erp_locked' then raise; end if;
end $$;

-- ---------------------------------------------------------------------------
-- D. 분류별 진열 — 고정 핀 우선 · 품절 뒤로 · 하위 분류 포함 · 진열 기간
--    cat-g1·cat-g2 는 ERP 잎(cat-stand)에 직속, cat-g3 는 그 아래 자체 분류(cat-own-b)에 있다.
-- ---------------------------------------------------------------------------
select public.admin_set_good_categories('cat-g2', 'cat-stand', array['cat-stand']);
select public.admin_reorder_category_goods('cat-stand', array['cat-g2', 'cat-g1']);
select 1 / case when (
  -- 직속(cat-g1) → 하위 분류(cat-g3) → 품절(cat-g2). soldout_last 가 품절을 맨 뒤로 민다.
  (select string_agg(good_id, ',' order by ordinality) from (
     select good_id, row_number() over () as ordinality from public.category_goods('cat-stand')
   ) as ordered) = 'cat-g1,cat-g3,cat-g2'
) then 1 else 0 end as assert_category_display_order;

-- 고정 핀은 품절·순서보다 앞선다.
select public.admin_reorder_category_goods('cat-stand', array['cat-g2', 'cat-g1'], array['cat-g2']);
select 1 / case when (select good_id from public.category_goods('cat-stand') limit 1) = 'cat-g2'
  then 1 else 0 end as assert_pinned_first;

-- 하위 분류를 포함하지 않게 바꾸면 손자 상품(cat-g3)이 빠진다 — ERP 노드라도 진열 설정은 우리 몫이다.
select public.admin_upsert_category('cat-stand', '테스트 소', null, 'catalog', null, 'active', false, 'manual', 'newest', true, false, null, null, null, 'cat-stand');
select 1 / case when (select count(*) from public.category_goods('cat-stand')) = 2
  then 1 else 0 end as assert_include_descendants_toggle;

-- 진열 기간 밖이면 그 분류에서 빠진다.
select public.admin_set_category_good_display_window('cat-stand', 'cat-g1', now() + interval '1 day', null);
select 1 / case when (
  (select count(*) from public.category_goods('cat-stand')) = 1
  and (select count(*) from public.category_goods('cat-stand', now() + interval '2 days')) = 2
) then 1 else 0 end as assert_display_window;
select public.admin_set_category_good_display_window('cat-stand', 'cat-g1', null, null);

do $$
begin
  perform public.admin_set_category_good_display_window('cat-stand', 'cat-g1', now() + interval '2 days', now());
  raise exception 'inverted display window must fail';
exception when check_violation then
  if sqlerrm <> 'display_window_invalid' then raise; end if;
end $$;

-- ---------------------------------------------------------------------------
-- E. 판매 상태 8단 우선순위 (고정 시각으로 전수)
-- ---------------------------------------------------------------------------
reset role;
update public.goods set stock = 'ok', stock_qty = 10, archived_at = null, hidden_at = null, stopped_at = null,
  sale_starts_at = null, sale_ends_at = null, sale_mode = 'regular', preorder_ships_at = null where id = 'cat-g1';

select 1 / case when (
  (select public.good_sale_state(goods, '2026-09-04 12:00+09') from public.goods goods where id = 'cat-g1') = 'on_sale'
) then 1 else 0 end as assert_state_on_sale;

update public.goods set sale_mode = 'preorder', preorder_ships_at = '2026-10-01' where id = 'cat-g1';
select 1 / case when (
  (select public.good_sale_state(goods, '2026-09-04 12:00+09') from public.goods goods where id = 'cat-g1') = 'preorder'
  and (select public.good_purchasable(goods, '2026-09-04 12:00+09') from public.goods goods where id = 'cat-g1')
) then 1 else 0 end as assert_state_preorder_is_purchasable;

update public.goods set stock_qty = 0 where id = 'cat-g1';
select 1 / case when (
  (select public.good_sale_state(goods, '2026-09-04 12:00+09') from public.goods goods where id = 'cat-g1') = 'soldout'
) then 1 else 0 end as assert_state_soldout_beats_preorder;

update public.goods set stock_qty = 10, sale_starts_at = '2026-09-05 00:00+09' where id = 'cat-g1';
select 1 / case when (
  (select public.good_sale_state(goods, '2026-09-04 12:00+09') from public.goods goods where id = 'cat-g1') = 'scheduled'
  and (select public.good_sale_state(goods, '2026-09-05 00:00+09') from public.goods goods where id = 'cat-g1') = 'preorder'
) then 1 else 0 end as assert_state_scheduled_boundary_is_inclusive_at_start;

update public.goods set sale_starts_at = null, sale_ends_at = '2026-09-04 12:00+09' where id = 'cat-g1';
select 1 / case when (
  (select public.good_sale_state(goods, '2026-09-04 12:00+09') from public.goods goods where id = 'cat-g1') = 'ended'
  and (select public.good_sale_state(goods, '2026-09-04 11:59+09') from public.goods goods where id = 'cat-g1') = 'preorder'
) then 1 else 0 end as assert_state_ended_boundary_is_exclusive_at_end;

update public.goods set stopped_at = now() where id = 'cat-g1';
select 1 / case when (
  (select public.good_sale_state(goods, '2026-09-04 11:59+09') from public.goods goods where id = 'cat-g1') = 'stopped'
) then 1 else 0 end as assert_state_stopped_beats_time;

update public.goods set hidden_at = now() where id = 'cat-g1';
select 1 / case when (
  (select public.good_sale_state(goods, '2026-09-04 11:59+09') from public.goods goods where id = 'cat-g1') = 'hidden'
  and (select count(*) from public.goods_storefront where id = 'cat-g1') = 0
) then 1 else 0 end as assert_state_hidden_beats_stopped_and_leaves_storefront;

-- 보관 가드가 재고 남은 상품의 보관을 막는다(기존 계약) — 수량을 비운 뒤 보관한다.
update public.goods set stock_qty = 0, archived_at = now() where id = 'cat-g1';
select 1 / case when (
  (select public.good_sale_state(goods, '2026-09-04 11:59+09') from public.goods goods where id = 'cat-g1') = 'archived'
) then 1 else 0 end as assert_state_archived_beats_all;

-- ---------------------------------------------------------------------------
-- F. 스위치·판매 기간 RPC — 사유 필수 · 창 검증 · 선주문 출고일 필수
-- ---------------------------------------------------------------------------
update public.goods set archived_at = null, hidden_at = null, stopped_at = null, sale_ends_at = null,
  sale_mode = 'regular', preorder_ships_at = null, stock = 'ok', stock_qty = 10 where id = 'cat-g1';
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000008a1', true);

do $$
begin
  perform public.admin_set_good_switch('cat-g1', 'selling', false, null);
  raise exception 'stopping without a reason must fail';
exception when check_violation then
  if sqlerrm <> 'reason_required' then raise; end if;
end $$;
select 1 / case when public.admin_set_good_switch('cat-g1', 'selling', false, '공급 지연') = 'stopped'
  then 1 else 0 end as assert_switch_stops_selling;
select 1 / case when public.admin_set_good_switch('cat-g1', 'selling', true) = 'on_sale'
  then 1 else 0 end as assert_switch_resumes_without_reason;

do $$
begin
  perform public.admin_set_good_sale_window('cat-g1', '2026-10-02 00:00+09', '2026-10-01 00:00+09');
  raise exception 'inverted sale window must fail';
exception when check_violation then
  if sqlerrm <> 'sale_window_invalid' then raise; end if;
end $$;
do $$
begin
  perform public.admin_set_good_sale_window('cat-g1', null, null, 'preorder', null);
  raise exception 'preorder without a ship date must fail';
exception when check_violation then
  if sqlerrm <> 'preorder_ship_date_required' then raise; end if;
end $$;
select 1 / case when public.admin_set_good_sale_window('cat-g1', now() + interval '1 day', null) = 'scheduled'
  then 1 else 0 end as assert_sale_window_returns_state;

-- ---------------------------------------------------------------------------
-- G. 주문 게이트 — 판매 예정·기간 만료·판매 중지는 살 수 없다(품절과 다른 코드)
-- ---------------------------------------------------------------------------
reset role;
insert into public.cart_items (user_id, good_id, qty) values ('00000000-0000-4000-8000-0000000008a2', 'cat-g1', 1);
do $$
begin
  perform public.place_order(
    '00000000-0000-4000-8000-0000000008a2'::uuid,
    '{"recipientName":"분류","phone":"01012345678","postalCode":"06236","address1":"서울시 강남구 테헤란로 1"}'::jsonb,
    '00000000-0000-4000-8000-0000000008c1'::uuid
  );
  raise exception 'scheduled good must not be ordered';
exception when check_violation then
  if sqlerrm not like 'goods_not_purchasable%' then raise; end if;
end $$;

update public.goods set sale_starts_at = null where id = 'cat-g1';
select public.place_order(
  '00000000-0000-4000-8000-0000000008a2'::uuid,
  '{"recipientName":"분류","phone":"01012345678","postalCode":"06236","address1":"서울시 강남구 테헤란로 1"}'::jsonb,
  '00000000-0000-4000-8000-0000000008c2'::uuid
) as ordered \gset
select 1 / case when (select count(*) from public.order_items where order_id = :'ordered') = 1
  then 1 else 0 end as assert_on_sale_good_can_be_ordered;

-- ---------------------------------------------------------------------------
-- H. 검색·SEO — 키워드 정규화·상한 · search_text 갱신 · 갤러리 alt 길이
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000008a1', true);

select public.admin_set_good_search_seo('cat-g1', '한 줄 요약', array['  Ryan ', 'ryan', '키링'], 'SEO 제목', 'SEO 설명', '대표 이미지 설명');
select 1 / case when (
  (select search_keywords from public.goods where id = 'cat-g1') = array['ryan', '키링']
  and (select search_text like '%ryan%' and search_text like '%한 줄 요약%' from public.goods where id = 'cat-g1')
  and (select seo_title from public.goods where id = 'cat-g1') = 'SEO 제목'
) then 1 else 0 end as assert_search_seo_normalizes;

-- 이름을 바꾸면 검색 원문이 따라온다.
reset role;
update public.goods set name = '이름 변경됨' where id = 'cat-g1';
select 1 / case when (select search_text like '이름 변경됨%' from public.goods where id = 'cat-g1')
  then 1 else 0 end as assert_search_text_follows_name;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000008a1', true);
do $$
begin
  perform public.admin_set_good_search_seo('cat-g1', null, (select array_agg('k' || i) from generate_series(1, 51) as i));
  raise exception 'more than 50 keywords must fail';
exception when check_violation then
  if sqlerrm <> 'goods_keywords_limit' then raise; end if;
end $$;
do $$
begin
  perform public.admin_set_good_search_seo('cat-g1', null, '{}', null, null, null, array['하나', '둘']);
  raise exception 'gallery alt length mismatch must fail';
exception when check_violation then
  if sqlerrm <> 'goods_gallery_alts_mismatch' then raise; end if;
end $$;

-- 어드민 목록 RPC 가 판매 상태를 함께 내리고 상태로 거를 수 있다.
select 1 / case when (
  (select sale_state from public.admin_search_goods(p_field => 'id', p_query => 'cat-g2')) = 'soldout'
  and (select count(*) from public.admin_search_goods(p_query => 'cat-g', p_sale_state => 'soldout')) >= 1
  and (select count(*) from public.admin_search_goods(p_query => 'cat-g', p_sale_state => 'archived')) = 0
) then 1 else 0 end as assert_admin_list_carries_sale_state;

do $$
begin
  perform count(*) from public.admin_search_goods(p_sale_state => 'nope');
  raise exception 'invalid sale state filter must fail';
exception when check_violation then null;
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- I. RLS — 숨김·내부 분류는 anon 에게 보이지 않는다
-- ---------------------------------------------------------------------------
update public.categories set status = 'hidden' where id = 'cat-root2';
set local role anon;
-- 역할만 바꾸고 jwt 주체를 남겨 두면 is_staff() 가 계속 참이라 정책이 열린 채로 보인다.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
select 1 / case when (
  (select count(*) from public.categories where id = 'cat-root2') = 0
  and (select count(*) from public.categories where id = 'cat-root') = 1
) then 1 else 0 end as assert_hidden_category_is_invisible_to_anon;
reset role;

rollback;
