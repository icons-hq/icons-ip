\set ON_ERROR_STOP on
-- TKT-033(ADR-0040) 즉시할인 기간: 즉시할인과 기간 할인 계약을 합친다. 진실원은 옵션별 기간 할인 원장 하나다.
-- 고정하는 계약:
-- 1. 상품 저장(instant_discount_period)이 판매 중인 옵션마다 같은 할인 금액의 기간 할인 행을 쓰고(promotion_id 없음),
--    기간 전에는 판매가, 기간 중에는 할인가, 끝나면 판매가가 고객 가격·장바구니·체크아웃 견적·주문에 같게 나온다(반열린 구간).
-- 2. 같은 값으로 다시 저장하면 원장이 그대로이고, 화면이 본 할인 묶음 지문이 다르면 거절한다. 판매가가 바뀌면 이전 행을 멈추고 새로 쓴다.
-- 3. 할인 프로모션(T08)과 서로 덮지 않는다: 프로모션 할인이 있는 상품은 상품 편집이 다루지 않고(managed), 상품 편집의 기간 할인과
--    겹치는 프로모션 상품은 건너뛰고 이유를 남긴다. 기간 없는 즉시할인 상품은 일괄 즉시할인·프로모션이 건너뛴다(한 상품 할인 하나).
-- 4. 목록 '할인 중지 후 판매가 변경'(T17b)은 상품 편집의 기간 할인을 멈추고, includeInstant면 기간 없는 즉시할인도 멈춘다.
-- 5. 엑셀 반입 기록은 진행·예정 기간 할인 요약을 싣는다.
begin;
create function pg_temp.idp_assert(p_ok boolean,p_message text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception '%',p_message;end if;end $$;
create function pg_temp.idp_error(p_sql text,p_error text) returns void language plpgsql as $$
begin begin execute p_sql;exception when others then if position(p_error in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected %',p_error;end $$;
create function pg_temp.idp_at(p_interval interval) returns text language sql as $$
 select to_char((now()+p_interval) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"');$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('b9400000-0000-4000-8000-000000000001','authenticated','authenticated','idp-admin@example.test',now(),'{}','{}',now(),now()),
 ('b9400000-0000-4000-8000-000000000002','authenticated','authenticated','idp-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin',nickname='즉시할인기간검증관리자' where id='b9400000-0000-4000-8000-000000000001';
update public.profiles set nickname='즉시할인기간구매자',birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id='b9400000-0000-4000-8000-000000000002';
insert into private.operator_memberships(profile_id,manager_role) values('b9400000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at) values('b9400000-0000-4000-8000-000000000011','b9400000-0000-4000-8000-000000000001',now(),now());
insert into public.verticals(key,label,color) values('idp-tests','즉시할인 기간 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('idp-tests','TEST 즉시할인 기간','idp-tests',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active)
 values('b9400000-0000-4000-8000-000000000030','idp-tests','검증 출고지','hanjin',3000,1000000,'배송 금지 검증 주소',true);

-- 상품 저장 페이로드: 상품 편집과 같은 모양(옵션은 추가금, 판매가는 할인 전 가격)에 즉시할인 기간 지시를 붙인다.
create function pg_temp.idp_payload(p_good text,p_price integer,p_compare integer,p_period jsonb,p_extra integer default 2000,p_previous boolean default true)
returns jsonb language sql as $$
 select jsonb_build_object('id',p_good,'ip_id','idp-tests','name','TEST 즉시할인 기간 '||p_good,'price',p_price,'compare_at_price',p_compare,
  'variant_baseline',coalesce((select jsonb_agg(id::text order by id) from public.goods_variants where good_id=p_good and archived_at is null),'[]'),
  'variants',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'code',v.code,'attributes',v.attributes,
     'extraPrice',v.price-g.price,'stockQty',v.stock_qty,'expectedStockQty',v.stock_qty,'isActive',v.archived_at is null)
     order by v.is_default desc,v.sort_order,v.id) from public.goods_variants v join public.goods g on g.id=v.good_id where v.good_id=p_good),
   jsonb_build_array(jsonb_build_object('name','기본','attributes','{}'::jsonb,'extraPrice',0,'stockQty',50),
    jsonb_build_object('name','파랑','attributes','{"색상":"파랑"}'::jsonb,'extraPrice',p_extra,'stockQty',50))))
 ||case when p_previous and exists(select 1 from public.goods where id=p_good) then jsonb_build_object('previous_id',p_good) else '{}'::jsonb end
 ||case when p_period is null then '{}'::jsonb else jsonb_build_object('instant_discount_period',p_period) end;$$;
create function pg_temp.idp_fp(p_good text) returns text language sql as $$
 select coalesce(public.admin_goods_instant_discount_period(p_good)->>'fingerprint','none');$$;
create function pg_temp.idp_period(p_good text,p_amount integer,p_from interval,p_to interval) returns jsonb language sql as $$
 select jsonb_build_object('mode','period','amount',p_amount,'startsAt',pg_temp.idp_at(p_from),'endsAt',pg_temp.idp_at(p_to),'expectedFingerprint',pg_temp.idp_fp(p_good));$$;
create function pg_temp.idp_none(p_good text) returns jsonb language sql as $$
 select jsonb_build_object('mode','none','expectedFingerprint',pg_temp.idp_fp(p_good));$$;
create function pg_temp.idp_rows(p_good text,p_state text default 'active') returns integer[] language sql as $$
 select coalesce(array_agg(p.discount_price order by v.price,p.id),'{}') from private.goods_variant_price_periods p join public.goods_variants v on v.id=p.variant_id
 where p.good_id=p_good and p.state=p_state;$$;
create function pg_temp.idp_bulk_preview(p_number integer,p_command text,p_values jsonb,p_ids jsonb,p_kind text default 'goods') returns jsonb language sql as $$
 select public.admin_preview_goods_bulk(md5('idp-bulk:'||p_number)::uuid,jsonb_build_object('kind',p_kind,'ids',p_ids,'command',p_command,'values',p_values),
  'b9400000-0000-4000-8000-000000000001','b9400000-0000-4000-8000-000000000011');$$;
create function pg_temp.idp_bulk_commit(p_number integer) returns jsonb language sql as $$
 select public.admin_commit_goods_bulk(md5('idp-bulk:'||p_number)::uuid,'b9400000-0000-4000-8000-000000000001','b9400000-0000-4000-8000-000000000011');$$;

set local role authenticated;
select set_config('request.jwt.claim.sub','b9400000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"b9400000-0000-4000-8000-000000000001","session_id":"b9400000-0000-4000-8000-000000000011","role":"authenticated"}',true);

-- 1. 새 상품을 즉시할인 10%(1,000원)·기간(내일~모레)으로 저장 ----------------------------------------------------------------
select public.admin_save_good(pg_temp.idp_payload('idp-main',10000,null,pg_temp.idp_period('idp-main',1000,interval '1 day',interval '3 days'))) as saved \gset
reset role;
select pg_temp.idp_assert((select price=10000 and compare_at_price is null from public.goods where id='idp-main'),'period instant discount keeps the regular sale price');
select pg_temp.idp_assert(pg_temp.idp_rows('idp-main')=array[9000,11000],'one period row per selling option, same discount amount');
select pg_temp.idp_assert((select bool_and(promotion_id is null and regular_price-discount_price=1000) and count(distinct (starts_at,ends_at))=1
 from private.goods_variant_price_periods where good_id='idp-main'),'period rows are individual discounts in one window');
select pg_temp.idp_assert(:'saved'::jsonb#>>'{instantDiscountPeriod,state}'='editable'
 and (:'saved'::jsonb#>>'{instantDiscountPeriod,period,amount}')::int=1000,'save reports the editable period back');
select pg_temp.idp_assert((select count(*)=1 from public.audit_log where action='admin.good.instant_discount_period_saved' and target='goods:idp-main'),'period save audited once');
select pg_temp.idp_assert((select count(*)=2 from public.audit_log where action='admin.good.price_period_saved' and target='goods:idp-main'),'each ledger row audited');
-- 기간 경계(반열린 구간): 시작 직전은 판매가, 시작부터 종료 직전까지 할인가, 종료부터 판매가.
select starts_at as main_starts,ends_at as main_ends from private.goods_variant_price_periods where good_id='idp-main' limit 1 \gset
select pg_temp.idp_assert((select array_agg(r.effective_price order by v.price) from public.goods_variants v
  cross join lateral private.resolve_goods_variant_price(v.id,:'main_starts'::timestamptz-interval '1 microsecond') r where v.good_id='idp-main')=array[10000,12000]
 and (select array_agg(r.effective_price order by v.price) from public.goods_variants v
  cross join lateral private.resolve_goods_variant_price(v.id,:'main_starts'::timestamptz) r where v.good_id='idp-main')=array[9000,11000]
 and (select array_agg(r.effective_price order by v.price) from public.goods_variants v
  cross join lateral private.resolve_goods_variant_price(v.id,:'main_ends'::timestamptz-interval '1 microsecond') r where v.good_id='idp-main')=array[9000,11000]
 and (select array_agg(r.effective_price order by v.price) from public.goods_variants v
  cross join lateral private.resolve_goods_variant_price(v.id,:'main_ends'::timestamptz) r where v.good_id='idp-main')=array[10000,12000],
 'half-open window: regular before, discount during, regular again from the end');
set local role authenticated;

-- 2. 같은 값 다시 저장은 원장을 바꾸지 않고, 낡은 화면(지문)은 거절한다 ------------------------------------------------------
select public.admin_save_good(pg_temp.idp_payload('idp-main',10000,null,
 jsonb_build_object('mode','period','amount',1000,'startsAt',:'main_starts'::timestamptz,'endsAt',:'main_ends'::timestamptz,'expectedFingerprint',pg_temp.idp_fp('idp-main'))));
reset role;
select pg_temp.idp_assert((select count(*)=2 and bool_and(state='active' and revision=1) from private.goods_variant_price_periods where good_id='idp-main'),'same save keeps the ledger rows');
select pg_temp.idp_assert((select count(*)=1 from public.audit_log where action='admin.good.instant_discount_period_saved' and target='goods:idp-main'),'no-op save is not audited');
set local role authenticated;
select pg_temp.idp_error($q$select public.admin_save_good(pg_temp.idp_payload('idp-main',10000,null,
 jsonb_build_object('mode','none','expectedFingerprint','none')))$q$,'instant_discount_period_changed');
select pg_temp.idp_error($q$select public.admin_save_good(pg_temp.idp_payload('idp-main',10000,null,
 pg_temp.idp_period('idp-main',1000,interval '-3 days',interval '-1 day')))$q$,'instant_discount_period_ended');
select pg_temp.idp_error($q$select public.admin_save_good(pg_temp.idp_payload('idp-main',10000,null,
 pg_temp.idp_period('idp-main',10000,interval '1 day',interval '3 days')))$q$,'instant_discount_period_price_invalid');
select pg_temp.idp_error($q$select public.admin_save_good(pg_temp.idp_payload('idp-main',10000,null,
 pg_temp.idp_period('idp-main',1000,interval '3 days',interval '1 day')))$q$,'invalid_instant_discount_period');
select pg_temp.idp_error($q$select public.admin_save_good(pg_temp.idp_payload('idp-main',10000,null,
 pg_temp.idp_period('idp-main',1000,interval '1 day',interval '3 days')||'{"rate":10}'))$q$,'invalid_instant_discount_period');
-- 기간 즉시할인과 정가 표시(기간 없는 즉시할인)는 함께 저장하지 않는다.
select pg_temp.idp_error($q$select public.admin_save_good(pg_temp.idp_payload('idp-main',9000,10000,
 pg_temp.idp_period('idp-main',1000,interval '1 day',interval '3 days')))$q$,'instant_discount_period_conflict');
-- 지시 없는 저장(일괄·엑셀·이전 화면)도 진행·예정 기간 할인 위에 기간 없는 즉시할인을 새로 걸지 못한다.
select pg_temp.idp_error($q$select public.admin_save_good(pg_temp.idp_payload('idp-main',9000,10000,null))$q$,'instant_discount_period_conflict');
-- 지시 없는 같은 값 저장은 그대로 통과한다(다른 입력만 바꾸는 저장).
select public.admin_save_good(pg_temp.idp_payload('idp-main',10000,null,null)||'{"name":"TEST 즉시할인 기간 idp-main 이름만"}');
reset role;
select pg_temp.idp_assert(pg_temp.idp_rows('idp-main')=array[9000,11000],'legacy save keeps the period rows');
set local role authenticated;

-- 3. 판매가를 바꾸면 이 상품 편집이 다루는 기간 할인을 멈추고 새 판매가로 다시 쓴다 -----------------------------------------
select public.admin_save_good(pg_temp.idp_payload('idp-main',12000,null,
 jsonb_build_object('mode','period','amount',1200,'startsAt',:'main_starts'::timestamptz,'endsAt',:'main_ends'::timestamptz,'expectedFingerprint',pg_temp.idp_fp('idp-main'))));
reset role;
select pg_temp.idp_assert((select array_agg(price order by price)=array[12000,14000] from public.goods_variants where good_id='idp-main'),'option prices follow the new sale price');
select pg_temp.idp_assert(pg_temp.idp_rows('idp-main')=array[10800,12800] and pg_temp.idp_rows('idp-main','disabled')=array[9000,11000],
 'old rows stopped (kept for orders), new rows written at the new price');
set local role authenticated;
-- 기간만 바꾸면 판매가 저장 없이 행만 바꾼다.
select public.admin_save_good(pg_temp.idp_payload('idp-main',12000,null,pg_temp.idp_period('idp-main',1200,interval '2 days',interval '4 days')));
reset role;
select pg_temp.idp_assert(pg_temp.idp_rows('idp-main')=array[10800,12800] and cardinality(pg_temp.idp_rows('idp-main','disabled'))=4,'window change writes a new version');
set local role authenticated;

-- 4. 끄기(설정안함)와 기간 없는 즉시할인으로 전환 ---------------------------------------------------------------------------
select public.admin_save_good(pg_temp.idp_payload('idp-main',12000,null,pg_temp.idp_none('idp-main'))) as off_saved \gset
reset role;
select pg_temp.idp_assert(pg_temp.idp_rows('idp-main')='{}' and :'off_saved'::jsonb#>>'{instantDiscountPeriod,state}'='none','turning the discount off stops the period');
set local role authenticated;
select public.admin_save_good(pg_temp.idp_payload('idp-main',12000,null,pg_temp.idp_period('idp-main',1200,interval '1 day',interval '3 days')));
select public.admin_save_good(pg_temp.idp_payload('idp-main',10800,12000,pg_temp.idp_none('idp-main')));
reset role;
select pg_temp.idp_assert(pg_temp.idp_rows('idp-main')='{}' and (select price=10800 and compare_at_price=12000 from public.goods where id='idp-main')
 and (select array_agg(price order by price)=array[10800,12800] from public.goods_variants where good_id='idp-main'),'switch to the no-period instant discount in one save');
set local role authenticated;
-- 기간 없는 즉시할인 → 기간 즉시할인 전환도 한 번에(정가 표시를 비우고 판매가를 할인 전으로).
select public.admin_save_good(pg_temp.idp_payload('idp-main',12000,null,pg_temp.idp_period('idp-main',1200,interval '1 day',interval '3 days')));
reset role;
select pg_temp.idp_assert(pg_temp.idp_rows('idp-main')=array[10800,12800] and (select price=12000 and compare_at_price is null from public.goods where id='idp-main'),
 'switch back to the period discount in one save');
set local role authenticated;

-- 5. 진행 중 기간 할인: 고객 가격·장바구니·체크아웃 견적·주문이 같은 할인가를 본다 --------------------------------------------
select public.admin_save_good(pg_temp.idp_payload('idp-live',20000,null,pg_temp.idp_period('idp-live',2000,interval '-1 hour',interval '1 day')));
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','',true);
update public.goods set type='문구',image_path='public-media/idp-fixture.webp',notice_maker='제조사',notice_origin='한국',notice_material='종이',
 notice_size='A5',notice_made_on='2026-11',notice_as_manager='CS',notice_as_contact='02-000',origin_id='b9400000-0000-4000-8000-000000000030'
 where id in ('idp-main','idp-live');
-- KC 합성 검토자도 운영자 멤버십이 있어야 한다(운영자 접근 설정이 켜진 DB).
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','idp-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where id in ('idp-main','idp-live');
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id in ('idp-main','idp-live');
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in ('idp-main','idp-live');
select id as live_default from public.goods_variants where good_id='idp-live' and is_default \gset
select id as main_default from public.goods_variants where good_id='idp-main' and is_default \gset
select id as live_period from private.goods_variant_price_periods where good_id='idp-live' and variant_id=:'live_default' and state='active' \gset
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.idp_assert((select public.goods_variant_pricing(v)->>'effectivePrice' from public.goods_variants v where v.id=:'live_default')='18000'
 and (select public.goods_variant_pricing(v)->>'regularPrice' from public.goods_variants v where v.id=:'live_default')='20000',
 'customer detail sees the running discount over the regular price');
select pg_temp.idp_assert((select public.goods_variant_pricing(v)->>'effectivePrice' from public.goods_variants v where v.id=:'main_default')='12000'
 and (select public.goods_variant_pricing(v)->>'pricePeriodId' from public.goods_variants v where v.id=:'main_default') is null,
 'before the window the customer sees the regular price');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','b9400000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"b9400000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select public.set_cart_item_quantity('idp-live',:'live_default',2);
select public.set_cart_item_quantity('idp-main',:'main_default',1);
select public.quote_goods_sales(jsonb_build_array(jsonb_build_object('goodId','idp-live','variantId',:'live_default','qty',2),
 jsonb_build_object('goodId','idp-main','variantId',:'main_default','qty',1))) as quote \gset
reset role;
select pg_temp.idp_assert(private.cart_subtotal('b9400000-0000-4000-8000-000000000002')=2*18000+12000,'cart subtotal uses the period price');
select pg_temp.idp_assert((select array_agg((line->>'effectivePrice')::int order by line->>'goodId') from jsonb_array_elements(:'quote'::jsonb->'lines') line)=array[18000,12000]
 and (select array_agg((line->>'regularPrice')::int order by line->>'goodId') from jsonb_array_elements(:'quote'::jsonb->'lines') line)=array[20000,12000]
 and (:'quote'::jsonb->>'subtotal')::int=2*18000+12000,
 'checkout quote: discount during the window, regular price before it');
set local role service_role;
select public.place_order('b9400000-0000-4000-8000-000000000002'::uuid,'{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 'b9400000-0000-4000-8000-000000000021'::uuid,'card'::public.order_payment_method) as order_id \gset
reset role;
select pg_temp.idp_assert((select unit_price=18000 and price_period_id=:'live_period'::uuid from public.order_items where order_id=:'order_id'::uuid and good_id='idp-live')
 and (select unit_price=12000 and price_period_id is null from public.order_items where order_id=:'order_id'::uuid and good_id='idp-main'),
 'order keeps the period price and the ledger row id');
set local role authenticated;
select set_config('request.jwt.claim.sub','b9400000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"b9400000-0000-4000-8000-000000000001","session_id":"b9400000-0000-4000-8000-000000000011","role":"authenticated"}',true);

-- 6. 할인 프로모션(T08)과 서로 덮지 않는다 ------------------------------------------------------------------------------------
select public.admin_save_good(pg_temp.idp_payload('idp-promo',10000,null,null,0));
select public.admin_save_good(pg_temp.idp_payload('idp-instant',9000,10000,null,0));
select public.admin_preview_discount_promotion(md5('idp-promo:1')::uuid,jsonb_build_object('name','TEST 즉시할인 기간 공존','startsAt',pg_temp.idp_at(interval '1 day'),
 'endsAt',pg_temp.idp_at(interval '2 days'),'target',jsonb_build_object('kind','goods','ids',jsonb_build_array('idp-promo','idp-main','idp-instant')),
 'rule','{"mode":"rate","value":10}'::jsonb,'exceptions','[]'::jsonb),'b9400000-0000-4000-8000-000000000001','b9400000-0000-4000-8000-000000000011') as promo_preview \gset
select pg_temp.idp_assert((select jsonb_object_agg(r->>'id',r->>'skip') from jsonb_array_elements(:'promo_preview'::jsonb->'goods') r where r->>'skip' is not null)
 ='{"idp-main":"price_period_overlap","idp-instant":"instant_discount_active"}'::jsonb,'promotion skips the editor period (overlap) and the no-period instant discount');
select pg_temp.idp_assert((select r->'overlap'->'promotionId'='null'::jsonb from jsonb_array_elements(:'promo_preview'::jsonb->'goods') r where r->>'id'='idp-main'),
 'overlap names the individual (editor) discount');
select pg_temp.idp_assert(public.admin_commit_discount_promotion(md5('idp-promo:1')::uuid,'b9400000-0000-4000-8000-000000000001','b9400000-0000-4000-8000-000000000011')->>'state'='completed','promotion committed');
select pg_temp.idp_assert(public.admin_goods_instant_discount_period('idp-promo')->>'state'='managed'
 and public.admin_goods_instant_discount_period('idp-promo')->>'reason'='promotion'
 and public.admin_goods_instant_discount_period('idp-promo')#>>'{promotions,0,name}'='TEST 즉시할인 기간 공존','promotion discount is not editable in the good editor');
select pg_temp.idp_error($q$select public.admin_save_good(pg_temp.idp_payload('idp-promo',10000,null,pg_temp.idp_none('idp-promo'),0))$q$,'instant_discount_period_managed');
select pg_temp.idp_error($q$select public.admin_save_good(pg_temp.idp_payload('idp-promo',10000,null,pg_temp.idp_period('idp-promo',500,interval '3 days',interval '4 days'),0))$q$,
 'instant_discount_period_managed');
-- 다른 입력만 바꾸는 지시 없는 저장은 프로모션 할인을 건드리지 않는다.
select public.admin_save_good(pg_temp.idp_payload('idp-promo',10000,null,null,0)||'{"name":"TEST 프로모션 상품 이름만"}');
reset role;
select pg_temp.idp_assert((select count(*)=2 and bool_and(promotion_id is not null) from private.goods_variant_price_periods where good_id='idp-promo' and state='active'),
 'promotion row untouched');
set local role authenticated;

-- 7. 일괄 즉시할인은 기간 없는 즉시할인 상품을 건너뛴다 -----------------------------------------------------------------------
select pg_temp.idp_bulk_preview(1,'discount',jsonb_build_object('mode','rate','value',10,'startsAt',pg_temp.idp_at(interval '5 days'),'endsAt',pg_temp.idp_at(interval '6 days')),
 '["idp-instant","idp-live"]'::jsonb) as bulk_discount \gset
select pg_temp.idp_assert((select jsonb_object_agg(r->>'id',coalesce(r->>'skip','')) from jsonb_array_elements(:'bulk_discount'::jsonb->'goods') r)
 ='{"idp-instant":"instant_discount_active","idp-live":""}'::jsonb,'bulk period discount skips the no-period instant discount');
select pg_temp.idp_assert(pg_temp.idp_bulk_commit(1)->>'state'='completed','bulk discount on the rest');
-- 일괄 즉시할인을 더한 상품은 같은 할인 금액·같은 기간 한 묶음이 아니므로 상품 편집이 다루지 않는다(mixed).
select pg_temp.idp_assert(public.admin_goods_instant_discount_period('idp-live')->>'reason'='mixed','two windows are managed outside the editor');

-- 8. 목록 '할인 중지 후 판매가 변경'(T17b) -----------------------------------------------------------------------------------
-- 8-1. 상품 편집의 기간 할인도 기존 할인 중지가 멈춘다.
select pg_temp.idp_assert((select (r->'discounts'->>'count')::int=2 and r->'instantDiscount' is null from jsonb_array_elements(pg_temp.idp_bulk_preview(2,'discount_stop','{}','["idp-main"]')->'goods') r),
 'stop review counts the editor period');
select pg_temp.idp_assert(pg_temp.idp_bulk_commit(2)->>'state'='completed','editor period stopped from the list');
select pg_temp.idp_assert(public.admin_goods_instant_discount_period('idp-main')->>'state'='none','nothing live after the stop');
-- 8-2. 기간 없는 즉시할인 상품은 includeInstant로 같은 창에서 멈춘다(상품 1개만).
select pg_temp.idp_error($q$select pg_temp.idp_bulk_preview(3,'discount_stop','{"includeInstant":true}','["idp-instant","idp-main"]')$q$,'goods_bulk_invalid');
select pg_temp.idp_error($q$select pg_temp.idp_bulk_preview(3,'discount_stop','{"includeInstant":true}','["idp-tests"]','ip')$q$,'goods_bulk_invalid');
select pg_temp.idp_error($q$select pg_temp.idp_bulk_preview(3,'discount_stop','{"includeInstant":false}','["idp-instant"]')$q$,'goods_bulk_invalid');
select pg_temp.idp_error($q$select pg_temp.idp_bulk_preview(3,'discount_stop','{}','["idp-instant"]')$q$,'goods_bulk_no_active_discount');
select pg_temp.idp_bulk_preview(4,'discount_stop','{"includeInstant":true}','["idp-instant"]') as instant_stop \gset
select pg_temp.idp_assert((select r->'instantDiscount'='{"regularPrice":10000,"salePrice":9000}'::jsonb and r->'discounts'='null'::jsonb
 and (r->>'price')::int=9000 and (r->>'nextPrice')::int=10000 and r->'skip'='null'::jsonb from jsonb_array_elements(:'instant_stop'::jsonb->'goods') r),
 'stop review shows the no-period instant discount');
reset role;
update public.goods_variants set stock_qty=7 where good_id='idp-instant';
set local role authenticated;
select pg_temp.idp_assert(pg_temp.idp_bulk_commit(4)->>'state'='completed','instant discount stopped');
reset role;
select pg_temp.idp_assert((select price=10000 and compare_at_price is null from public.goods where id='idp-instant')
 and (select array_agg(price)=array[10000,10000] and array_agg(stock_qty)=array[7,7] from public.goods_variants where good_id='idp-instant'),'price back to the regular price, stock kept');
set local role authenticated;
select pg_temp.idp_assert((select (r->>'price')::int=10000 from jsonb_array_elements(pg_temp.idp_bulk_preview(5,'price','{"mode":"set","value":11000}','["idp-instant"]')->'goods') r),
 'price review sees the regular price the dialog showed');
select pg_temp.idp_assert(pg_temp.idp_bulk_commit(5)->>'state'='completed','price change after the instant stop');
-- 8-3. 비교 뒤 정가 표시가 바뀌면(지문) 확정이 멈춘다.
select public.admin_save_good(pg_temp.idp_payload('idp-instant',9900,11000,null,0));
select pg_temp.idp_bulk_preview(6,'discount_stop','{"includeInstant":true}','["idp-instant"]');
reset role;
update public.goods set compare_at_price=12000 where id='idp-instant';
set local role authenticated;
select pg_temp.idp_assert(pg_temp.idp_bulk_commit(6)->>'error'='goods_bulk_changed','compare-at change after review rejects the stop');

-- 9. 엑셀 반입 기록의 진행·예정 기간 할인 요약 -------------------------------------------------------------------------------
select pg_temp.idp_assert((select record->'livePriceDiscount'->>'count'='4' from public.admin_goods_import_records('{}',array['idp-live']) record)
 and (select record->'livePriceDiscount'='null'::jsonb from public.admin_goods_import_records('{}',array['idp-main']) record),'import records carry the live period summary');

reset role;
select pg_temp.idp_assert(not has_function_privilege('anon','public.admin_goods_instant_discount_period(text)','execute')
 and not has_function_privilege('service_role','public.admin_goods_instant_discount_period(text)','execute')
 and not has_function_privilege('authenticated','private.goods_instant_discount_schedule(text)','execute')
 and not has_function_privilege('authenticated','private.admin_save_good_before_instant_discount_period(jsonb)','execute'),'new functions sealed');
select pg_temp.idp_assert((select r.rolname='postgres' and p.prosecdef and p.proconfig=array['search_path=""'] from pg_proc p join pg_roles r on r.oid=p.proowner
 where p.oid='public.admin_save_good(jsonb)'::regprocedure),'goods writer is a postgres-owned definer');
rollback;
