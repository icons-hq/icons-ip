\set ON_ERROR_STOP on
-- 상품 기본 칸 동시 수정 보호(CAT-027·CAT-028, 20261118151000). 합성 데이터만 쓰고 끝에서 되돌린다.
begin;
create function pg_temp.base_assert(p_ok boolean, p_message text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception '%', p_message; end if; end $$;
create function pg_temp.base_error(p_sql text, p_error text) returns void language plpgsql as $$
begin begin execute p_sql; exception when others then if position(p_error in sqlerrm) > 0 then return; end if; raise; end;
 raise exception 'Expected %', p_error; end $$;
create function pg_temp.base_revision(p_id text) returns bigint language sql as $$ select base_revision from public.goods where id = p_id $$;

insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at) values
 ('b2000000-0000-4000-8000-000000000001','authenticated','authenticated','base-revision-admin@example.test','{}',now(),now());
update public.profiles set role='admin',nickname='기본칸검증' where id='b2000000-0000-4000-8000-000000000001';
insert into private.operator_memberships(profile_id,manager_role) values('b2000000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at) values('b2000000-0000-4000-8000-000000000011','b2000000-0000-4000-8000-000000000001',now(),now());
insert into public.ips(id,title,vertical_key) values('base-revision-tests','TEST 기본 칸 버전','character');
insert into public.catalog_categories(id,code,name,parent_id,depth) values
 ('b2000000-0000-4000-8000-000000000020','base-revision-root','TEST 기본 칸 가지',null,1),
 ('b2000000-0000-4000-8000-000000000021','base-revision-leaf-a','TEST 기본 칸 말단 A','b2000000-0000-4000-8000-000000000020',2),
 ('b2000000-0000-4000-8000-000000000022','base-revision-leaf-b','TEST 기본 칸 말단 B','b2000000-0000-4000-8000-000000000020',2);

set local role authenticated;
select set_config('request.jwt.claim.sub','b2000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"b2000000-0000-4000-8000-000000000001","session_id":"b2000000-0000-4000-8000-000000000011","role":"authenticated"}',true);

-- 새 상품: 기준값 없이 저장된다(새 상품에는 비교할 버전이 없다). 기준값을 실어 보내도 새 상품(previous_id 없음)은 막지 않는다.
select public.admin_save_good('{"id":"base-a","ip_id":"base-revision-tests","name":"TEST 기본 칸 A","price":29000,"variant_baseline":[],"variants":[{"name":"기본","attributes":{"색상":"빨강"},"extraPrice":0,"stockQty":9},{"name":"추가","attributes":{"색상":"파랑"},"extraPrice":2000,"stockQty":7}]}');
select public.admin_save_good('{"id":"base-new","ip_id":"base-revision-tests","name":"TEST 새 상품","price":1000,"base_expected_revision":7,"variant_baseline":[],"variants":[{"name":"기본","attributes":{},"extraPrice":0,"stockQty":1}]}');
select pg_temp.base_assert(exists(select 1 from public.goods where id='base-new'), 'new good with a stray expected revision still saves');

create function pg_temp.base_payload(p_id text) returns jsonb language sql as $$
  select jsonb_build_object('id', g.id, 'previous_id', g.id, 'ip_id', g.ip_id, 'name', g.name, 'price', g.price,
    'variant_baseline', (select jsonb_agg(v.id order by v.sort_order) from public.goods_variants v where v.good_id = g.id and v.archived_at is null),
    'variants', (select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'attributes', v.attributes, 'code', v.code,
      'extraPrice', v.price - g.price, 'stockQty', v.stock_qty, 'expectedStockQty', v.stock_qty) order by v.sort_order)
      from public.goods_variants v where v.good_id = g.id and v.archived_at is null))
  from public.goods g where g.id = p_id $$;

-- 1. 같은 값을 다시 저장하면 버전이 오르지 않는다(편집 화면의 무변경 저장이 다음 저장을 막지 않는다).
select pg_temp.base_revision('base-a') as rev0 \gset
select public.admin_save_good(pg_temp.base_payload('base-a') || jsonb_build_object('base_expected_revision', :rev0));
select pg_temp.base_assert(pg_temp.base_revision('base-a') = :rev0, 'unchanged save keeps the base revision');

-- 2. 화면 A가 상품명을 저장하면 버전이 오르고, 같은 버전을 본 화면 B의 저장은 전체가 거절된다(옛 값으로 되돌리지 않는다).
select public.admin_save_good(pg_temp.base_payload('base-a') || jsonb_build_object('name', 'TEST 기본 칸 A 수정', 'base_expected_revision', :rev0));
select pg_temp.base_revision('base-a') as rev1 \gset
select pg_temp.base_assert(:rev1 > :rev0, 'base field change bumps the revision');
select pg_temp.base_error(format('select public.admin_save_good(%L::jsonb)',
  (pg_temp.base_payload('base-a') || jsonb_build_object('name', 'TEST 기본 칸 A', 'price', 30000, 'base_expected_revision', :rev0))::text), 'goods_base_changed');
select pg_temp.base_assert((select name = 'TEST 기본 칸 A 수정' and price = 29000 from public.goods where id = 'base-a'), 'stale save writes nothing');

-- 3. 기준값이 없는 요청(배포 순간 열려 있던 옛 화면)은 지금처럼 저장한다. 형식이 틀린 기준값은 거절한다.
select public.admin_save_good(pg_temp.base_payload('base-a') || '{"badge":"NEW"}');
select pg_temp.base_assert((select badge = 'NEW' from public.goods where id = 'base-a') and pg_temp.base_revision('base-a') > :rev1, 'legacy request without a revision saves and bumps');
select pg_temp.base_error(format('select public.admin_save_good(%L::jsonb)', (pg_temp.base_payload('base-a') || '{"base_expected_revision":"3"}')::text), 'invalid_goods_base_revision');
select pg_temp.base_error(format('select public.admin_save_good(%L::jsonb)', (pg_temp.base_payload('base-a') || '{"base_expected_revision":-1}')::text), 'invalid_goods_base_revision');

-- 4. 그사이 URL이 바뀌었거나 없어진 상품을 고치는 저장은 새 상품을 만들지 않고 충돌로 알린다.
select pg_temp.base_error($q$select public.admin_save_good('{"id":"base-gone","previous_id":"base-gone","ip_id":"base-revision-tests","name":"TEST 없음","price":1000,"base_expected_revision":0,"variant_baseline":[],"variants":[{"name":"기본","attributes":{},"extraPrice":0,"stockQty":1}]}')$q$, 'goods_base_changed');
select pg_temp.base_assert(not exists(select 1 from public.goods where id = 'base-gone'), 'missing good is not recreated');

-- 5. 목록 일괄 판매가 변경(CAT-028)도 버전을 올려, 그 전에 연 화면이 옛 판매가로 되돌리지 못한다.
select pg_temp.base_revision('base-a') as rev2 \gset
select public.admin_preview_goods_bulk(md5('base-revision:1')::uuid, '{"kind":"goods","ids":["base-a"],"command":"price","values":{"mode":"set","value":31000}}'::jsonb,
  'b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000011');
select pg_temp.base_assert(public.admin_commit_goods_bulk(md5('base-revision:1')::uuid,'b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000011')->>'state' = 'completed', 'bulk price commit');
select pg_temp.base_assert(pg_temp.base_revision('base-a') > :rev2 and (select price = 31000 from public.goods where id = 'base-a'), 'bulk price change bumps the revision');
select pg_temp.base_error(format('select public.admin_save_good(%L::jsonb)',
  (pg_temp.base_payload('base-a') || jsonb_build_object('price', 29000, 'base_expected_revision', :rev2))::text), 'goods_base_changed');
select pg_temp.base_assert((select price = 31000 from public.goods where id = 'base-a'), 'stale editor keeps the bulk price');

-- 6. 옵션 금액만 바뀌어도(ERP 판매가 반영이 옵션가를 바꾸는 경우) 버전이 오른다.
select pg_temp.base_revision('base-a') as rev3 \gset
reset role;
update public.goods_variants set price = price + 500 where good_id = 'base-a' and not is_default;
select pg_temp.base_assert(pg_temp.base_revision('base-a') = :rev3 + 1, 'option price change bumps the revision once');

-- 7. 판매 중 자동 갱신은 버전을 올리지 않는다: 주문·결제 만료의 재고 증감은 goods.stock_qty 캐시와 updated_at만 바꾼다.
select pg_temp.base_revision('base-a') as rev4 \gset
select updated_at as stamp4 from public.goods where id = 'base-a' \gset
select id as default_variant from public.goods_variants where good_id = 'base-a' and is_default \gset
select private.change_goods_variant_stock('base-a', :'default_variant', -2);
select private.change_goods_variant_stock('base-a', :'default_variant', 1);
select pg_temp.base_assert(pg_temp.base_revision('base-a') = :rev4, 'stock movement keeps the base revision');
select pg_temp.base_assert((select stock_qty = 15 from public.goods where id = 'base-a'), 'stock cache moved');
-- 편집 화면이 쓰지 않는 칸(결제 수단·판매 제한)도 버전을 올리지 않는다.
set local role authenticated;
select public.admin_set_good_bank_transfer('base-a', false);
select pg_temp.base_assert(pg_temp.base_revision('base-a') = :rev4, 'payment-method toggle keeps the base revision');
-- 버전을 직접 정할 수 없다(어떤 값을 넣어도 1만 오른다).
reset role;
update public.goods set base_revision = 999 where id = 'base-a';
select pg_temp.base_assert(pg_temp.base_revision('base-a') = :rev4 + 1, 'explicit write only requests a single bump');

-- 8. 추가 카테고리는 다른 표지만 편집 화면이 다시 보내는 칸이라 집합이 바뀔 때만 버전을 올린다.
set local role authenticated;
select public.admin_save_good(pg_temp.base_payload('base-a') || '{"category_id":"b2000000-0000-4000-8000-000000000021","additional_category_ids":[]}');
select pg_temp.base_revision('base-a') as rev5 \gset
select public.admin_save_good(pg_temp.base_payload('base-a') || jsonb_build_object('category_id','b2000000-0000-4000-8000-000000000021',
  'additional_category_ids', '["b2000000-0000-4000-8000-000000000022"]'::jsonb, 'base_expected_revision', :rev5));
select pg_temp.base_revision('base-a') as rev6 \gset
select pg_temp.base_assert(:rev6 = :rev5 + 1, 'additional category change bumps the revision once');
select public.admin_save_good(pg_temp.base_payload('base-a') || jsonb_build_object('category_id','b2000000-0000-4000-8000-000000000021',
  'additional_category_ids', '["b2000000-0000-4000-8000-000000000022"]'::jsonb, 'base_expected_revision', :rev6));
select pg_temp.base_assert(pg_temp.base_revision('base-a') = :rev6, 'same additional categories keep the revision');

-- 9. 등록 화면 저장(admin_save_good_workspace)도 같은 good 입력을 상품 저장에 넘겨 같은 비교를 받는다.
select pg_temp.base_error(format('select public.admin_save_good_workspace(%L::jsonb)', jsonb_build_object('operationId', 'b2000000-0000-4000-8000-000000000031',
  'good', pg_temp.base_payload('base-a') || jsonb_build_object('name', 'TEST 옛 화면', 'base_expected_revision', :rev0),
  'draft', null, 'sections', '{}'::jsonb)::text), 'goods_base_changed');
select pg_temp.base_assert((select name = 'TEST 기본 칸 A 수정' from public.goods where id = 'base-a'), 'workspace stale save writes nothing');

reset role;
select pg_temp.base_assert(has_function_privilege('authenticated', 'public.admin_save_good(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.admin_save_good(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.track_goods_base_revision()', 'execute')
  and not has_function_privilege('authenticated', 'private.bump_goods_base_revision_from_variant()', 'execute'), 'function grants stay sealed');
rollback;
