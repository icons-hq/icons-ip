\set ON_ERROR_STOP on
-- 상품 목록 바로 수정(T17b — 1014-106·107·1027T-025)이 차례로 부르는 기존 RPC의 계약을 고정한다. 새 DB 함수는 없다.
-- 1. 할인 중지 후 판매가 변경: 진행·예정 기간 할인이 있으면 판매가 변경은 비교에서 거절되고, 같은 상품의 기간 할인 중지를
--    확정한 뒤에는 통과한다(옵션 추가금·재고 보존). 판매가 단계가 실패해도 멈춘 할인은 멈춘 채이고, 그사이 새로 걸린 할인은
--    다시 멈추지 않고 판매가 변경을 막는다.
-- 2. 할인 프로모션이 건 할인을 목록에서 멈춰도 원장 출처(promotion_id)는 그대로이고, 프로모션 상세는 그 상품의 할인을 중지로
--    보이며, 그 뒤 프로모션 중지는 남은 할인만 끈다.
-- 3. 옵션별 재고: 옵션마다 본 수량을 기대값으로 admin_adjust_stock을 부르면 그사이 바뀐 옵션만 stock_changed로 거절되고
--    나머지는 반영되며, 같은 요청번호·같은 값의 재시도는 한 번만 반영된다.
begin;
create function pg_temp.inline_assert(p_ok boolean,p_message text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception '%',p_message;end if;end $$;
create function pg_temp.inline_error(p_sql text,p_error text) returns void language plpgsql as $$
begin begin execute p_sql;exception when others then if position(p_error in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected %',p_error;end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at) values
 ('b9300000-0000-4000-8000-000000000001','authenticated','authenticated','inline-admin@example.test','{}',now(),now());
update public.profiles set role='admin',nickname='목록바로수정검증관리자' where id='b9300000-0000-4000-8000-000000000001';
insert into private.operator_memberships(profile_id,manager_role) values('b9300000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at) values('b9300000-0000-4000-8000-000000000011','b9300000-0000-4000-8000-000000000001',now(),now());
insert into public.ips(id,title,vertical_key) values('inline-tests','TEST 목록 바로 수정','character');
set local role authenticated;
select set_config('request.jwt.claim.sub','b9300000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"b9300000-0000-4000-8000-000000000001","session_id":"b9300000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select public.admin_save_good('{"id":"inline-a","ip_id":"inline-tests","name":"TEST 바로수정 할인","price":10000,"variant_baseline":[],"variants":[{"name":"블루","attributes":{"색상":"블루"},"extraPrice":0,"stockQty":5},{"name":"레드","attributes":{"색상":"레드"},"extraPrice":2000,"stockQty":4}]}');
select public.admin_save_good('{"id":"inline-p","ip_id":"inline-tests","name":"TEST 바로수정 프로모션","price":20000,"variant_baseline":[],"variants":[{"name":"기본","attributes":{},"extraPrice":0,"stockQty":5}]}');
select public.admin_save_good('{"id":"inline-s","ip_id":"inline-tests","name":"TEST 바로수정 옵션 재고","price":10000,"variant_baseline":[],"variants":[{"name":"블루","attributes":{"색상":"블루"},"extraPrice":0,"stockQty":5},{"name":"레드","attributes":{"색상":"레드"},"extraPrice":0,"stockQty":4},{"name":"그린","attributes":{"색상":"그린"},"extraPrice":0,"stockQty":3}]}');
create function pg_temp.inline_preview(p_number integer,p_command text,p_values jsonb default '{}',p_good text default 'inline-a') returns jsonb language sql as $$
 select public.admin_preview_goods_bulk(md5('inline-test:'||p_number)::uuid,jsonb_build_object('kind','goods','ids',jsonb_build_array(p_good),'command',p_command,'values',p_values),
  'b9300000-0000-4000-8000-000000000001','b9300000-0000-4000-8000-000000000011');$$;
create function pg_temp.inline_commit(p_number integer) returns jsonb language sql as $$
 select public.admin_commit_goods_bulk(md5('inline-test:'||p_number)::uuid,'b9300000-0000-4000-8000-000000000001','b9300000-0000-4000-8000-000000000011');$$;
create function pg_temp.inline_discount(p_number integer,p_good text default 'inline-a') returns jsonb language sql as $$
 select pg_temp.inline_preview(p_number,'discount',jsonb_build_object('mode','rate','value',10,
  'startsAt',to_char((now()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'endsAt',to_char((now()+interval '3 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),p_good);$$;
create function pg_temp.inline_list_discount_ends(p_good text) returns timestamptz language sql as $$
 select (public.admin_goods_list_price_states(array[p_good])->0->>'activeDiscountEndsAt')::timestamptz;$$;

-- 1. 할인 중지 후 판매가 변경 ------------------------------------------------------------------------------------------
select pg_temp.inline_discount(1);
select pg_temp.inline_assert(pg_temp.inline_commit(1)->>'state'='completed','individual period discount on both options');
-- 목록은 진행·예정 할인이 있다고 읽고(판매가 칸 = '할인 중지 후 변경'), 판매가만 바꾸는 비교는 거절된다.
select pg_temp.inline_assert(pg_temp.inline_list_discount_ends('inline-a') is not null,'list sees the upcoming discount');
select pg_temp.inline_error($q$select pg_temp.inline_preview(2,'price','{"mode":"set","value":12000}')$q$,'active_price_period_requires_reset');
-- 창이 먼저 읽는 멈출 할인(상품 1개짜리 기간 할인 중지 비교)과 그 비교가 본 기본 판매가.
select pg_temp.inline_preview(3,'discount_stop') as stop_preview \gset
select pg_temp.inline_assert((select (r->>'price')::int=10000 and (r->'discounts'->>'count')::int=2 and (r->'discounts'->>'minPrice')::int=9000
 and (r->'discounts'->>'maxPrice')::int=10800 and r->'skip'='null'::jsonb from jsonb_array_elements(:'stop_preview'::jsonb->'goods') r),'stop review shows the discounts to lose');
select pg_temp.inline_assert(pg_temp.inline_commit(3)->>'state'='completed','discount stop committed first');
select pg_temp.inline_assert(pg_temp.inline_list_discount_ends('inline-a') is null,'list no longer sees a discount');
select pg_temp.inline_assert((select (r->>'price')::int=10000 from jsonb_array_elements(pg_temp.inline_preview(4,'price','{"mode":"set","value":12000}')->'goods') r),
 'price review sees the base price the operator saw');
select pg_temp.inline_assert(pg_temp.inline_commit(4)->>'state'='completed','price change after the stop');
reset role;
select pg_temp.inline_assert((select price=12000 from public.goods where id='inline-a')
 and (select array_agg(price order by sort_order,id)=array[12000,14000] and array_agg(stock_qty order by sort_order,id)=array[5,4] from public.goods_variants where good_id='inline-a'),
 'base price changed, option extra and stock kept');
select pg_temp.inline_assert((select count(*)=2 and bool_and(state='disabled') from private.goods_variant_price_periods where good_id='inline-a'),'stopped discounts stay stopped');
select pg_temp.inline_assert((select count(*)=3 from public.audit_log where action='catalog.goods_bulk.completed' and target in
 ('goods_bulk:'||md5('inline-test:1')::uuid::text,'goods_bulk:'||md5('inline-test:3')::uuid::text,'goods_bulk:'||md5('inline-test:4')::uuid::text)),'each step is audited');
set local role authenticated;

-- 판매가 단계가 실패하면 멈춘 할인은 그대로 멈춰 있다(되돌리지 않음). 그사이 새로 걸린 할인은 다시 멈추지 않고 판매가 변경을 막는다.
select pg_temp.inline_discount(5);select pg_temp.inline_assert(pg_temp.inline_commit(5)->>'state'='completed','second discount');
select pg_temp.inline_preview(6,'discount_stop');select pg_temp.inline_assert(pg_temp.inline_commit(6)->>'state'='completed','second stop');
select public.admin_save_goods_price_period('inline-a',(select id from public.goods_variants where good_id='inline-a' and is_default),null,
 jsonb_build_object('state','active','discountPrice',11000,'startsAt',now()+interval '5 days','endsAt',now()+interval '6 days'),null) as late_period \gset
select pg_temp.inline_error($q$select pg_temp.inline_preview(7,'price','{"mode":"set","value":13000}')$q$,'active_price_period_requires_reset');
reset role;
select pg_temp.inline_assert((select count(*)=1 from private.goods_variant_price_periods where good_id='inline-a' and state='active')
 and (select count(*)=4 from private.goods_variant_price_periods where good_id='inline-a' and state='disabled'),'late discount stays active, stopped ones stay stopped');
select id as late_id,variant_id as late_variant,revision as late_revision,starts_at as late_starts,ends_at as late_ends
 from private.goods_variant_price_periods where good_id='inline-a' and state='active' \gset
set local role authenticated;
-- 운영자가 새 할인을 직접 확인하고 멈춘 뒤에야 판매가를 바꾼다(창은 그 할인을 대신 멈추지 않는다).
select public.admin_save_goods_price_period('inline-a',:'late_variant'::uuid,:'late_id'::uuid,
 jsonb_build_object('state','disabled','discountPrice',11000,'startsAt',:'late_starts'::timestamptz,'endsAt',:'late_ends'::timestamptz),:'late_revision'::integer);
select pg_temp.inline_preview(8,'price','{"mode":"set","value":13000}');
reset role;
-- 비교 뒤 판매로 재고가 바뀌면 판매가 확정은 거절된다(판매가 단계 실패).
select private.change_goods_variant_stock('inline-a',(select id from public.goods_variants where good_id='inline-a' and is_default),-1);
set local role authenticated;
select pg_temp.inline_assert(pg_temp.inline_commit(8)->>'error'='goods_bulk_changed','price step fails after the stop');
reset role;
select pg_temp.inline_assert((select price=12000 from public.goods where id='inline-a')
 and not exists(select 1 from private.goods_variant_price_periods where good_id='inline-a' and state='active'),'failed price step leaves the stopped discounts stopped');
set local role authenticated;
-- 같은 창의 다시 시도는 판매가만 새로 비교·확정한다.
select pg_temp.inline_preview(9,'price','{"mode":"set","value":13000}');
select pg_temp.inline_assert(pg_temp.inline_commit(9)->>'state'='completed','retrying only the price succeeds');
select pg_temp.inline_assert((select price=13000 from public.goods where id='inline-a'),'retried price applied');

-- 2. 할인 프로모션이 건 할인 ------------------------------------------------------------------------------------------
select public.admin_preview_discount_promotion(md5('inline-promo:1')::uuid,jsonb_build_object('name','TEST 목록 바로 수정 프로모션',
 'startsAt',to_char((now()+interval '1 day') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'endsAt',to_char((now()+interval '5 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'target',jsonb_build_object('kind','goods','ids',jsonb_build_array('inline-p')),'rule',jsonb_build_object('mode','rate','value',10),'exceptions','[]'::jsonb),
 'b9300000-0000-4000-8000-000000000001','b9300000-0000-4000-8000-000000000011');
select pg_temp.inline_assert(public.admin_commit_discount_promotion(md5('inline-promo:1')::uuid,'b9300000-0000-4000-8000-000000000001','b9300000-0000-4000-8000-000000000011')->>'state'='completed',
 'promotion discount registered');
select pg_temp.inline_assert(pg_temp.inline_list_discount_ends('inline-p') is not null,'list sees the promotion discount');
select pg_temp.inline_preview(20,'discount_stop','{}','inline-p') as promo_stop_preview \gset
select pg_temp.inline_assert((select (r->'discounts'->>'count')::int=1 and (r->'discounts'->>'minPrice')::int=18000 from jsonb_array_elements(:'promo_stop_preview'::jsonb->'goods') r),
 'stop review includes the promotion discount');
select pg_temp.inline_assert(pg_temp.inline_commit(20)->>'state'='completed','promotion discount stopped from the list');
select pg_temp.inline_preview(21,'price','{"mode":"set","value":25000}','inline-p');
select pg_temp.inline_assert(pg_temp.inline_commit(21)->>'state'='completed','price changed after stopping the promotion discount');
reset role;
select pg_temp.inline_assert((select count(*)=1 and bool_and(state='disabled' and promotion_id=md5('inline-promo:1')::uuid) from private.goods_variant_price_periods where good_id='inline-p'),
 'stopped row keeps its promotion source');
select pg_temp.inline_assert((select state='active' from private.discount_promotions where id=md5('inline-promo:1')::uuid),'the promotion itself is not stopped');
set local role authenticated;
select pg_temp.inline_assert((select r->'discounts'='{"active":0,"ended":0,"disabled":1,"minPrice":18000,"maxPrice":18000}'::jsonb and (r->>'priceMin')::int=25000
 from jsonb_array_elements(public.admin_get_discount_promotion(md5('inline-promo:1')::uuid)->'goods') r where r->>'id'='inline-p'),'promotion detail shows the good as stopped');
select pg_temp.inline_assert((select (receipt->>'state')='completed' and (receipt->>'disabledCount')::int=0 and (receipt->>'goodsCount')::int=0
 from (select public.admin_stop_discount_promotion(md5('inline-promo:1')::uuid,md5('inline-promo-stop:1')::uuid,
  'b9300000-0000-4000-8000-000000000001','b9300000-0000-4000-8000-000000000011') as receipt) stopped),'later promotion stop only touches remaining discounts');
reset role;
select pg_temp.inline_assert((select state='stopped' from private.discount_promotions where id=md5('inline-promo:1')::uuid)
 and (select price=25000 from public.goods where id='inline-p'),'promotion stopped, list price kept');
set local role authenticated;

-- 3. 옵션별 재고 --------------------------------------------------------------------------------------------------------
-- 운영자가 창에서 본 수량: 블루 5 · 레드 4 · 그린 3. 그사이 레드 1개가 팔렸다.
reset role;
select private.change_goods_variant_stock('inline-s',(select id from public.goods_variants where good_id='inline-s' and name='레드'),-1);
set local role authenticated;
select pg_temp.inline_assert(public.admin_adjust_stock('b9300000-0000-4000-8000-0000000000c1','inline-s',(select id from public.goods_variants where good_id='inline-s' and name='블루'),
 5,3,'상품 목록에서 옵션별 재고수량 수정 (5 → 8)')=8,'blue adjusted from the seen quantity');
select pg_temp.inline_error($q$select public.admin_adjust_stock('b9300000-0000-4000-8000-0000000000c2','inline-s',(select id from public.goods_variants where good_id='inline-s' and name='레드'),
 4,5,'입고 반영')$q$,'stock_changed');
select pg_temp.inline_assert(public.admin_adjust_stock('b9300000-0000-4000-8000-0000000000c3','inline-s',(select id from public.goods_variants where good_id='inline-s' and name='그린'),
 3,-3,'실사 반영')=0,'green adjusted to zero');
-- 응답이 끊긴 옵션의 재시도: 같은 요청번호·같은 값은 저장된 결과를 돌려주고 다시 반영하지 않는다.
select pg_temp.inline_assert(public.admin_adjust_stock('b9300000-0000-4000-8000-0000000000c1','inline-s',(select id from public.goods_variants where good_id='inline-s' and name='블루'),
 5,3,'상품 목록에서 옵션별 재고수량 수정 (5 → 8)')=8,'same request replays once');
-- 다시 확인한 옵션은 새 현재 수량(3)을 기대값으로 다시 저장한다.
select pg_temp.inline_assert(public.admin_adjust_stock('b9300000-0000-4000-8000-0000000000c4','inline-s',(select id from public.goods_variants where good_id='inline-s' and name='레드'),
 3,6,'입고 반영')=9,'rechecked option saved against the new quantity');
reset role;
select pg_temp.inline_assert((select jsonb_object_agg(name,stock_qty) from public.goods_variants where good_id='inline-s')='{"블루":8,"레드":9,"그린":0}'::jsonb,'per-option results');
select pg_temp.inline_assert((select count(*)=3 from public.audit_log where action='admin.good.stock_adjusted' and target='goods:inline-s')
 and (select diff->>'reason'='실사 반영' and (diff->>'from')::int=3 and (diff->>'to')::int=0 from public.audit_log where id='b9300000-0000-4000-8000-0000000000c3'),
 'one adjustment record per saved option with its reason');
rollback;
