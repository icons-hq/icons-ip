\set ON_ERROR_STOP on
-- 1014-109·110·X37 할인 프로모션 묶음과 1014-112 전시 상품 여러 줄 조회.
-- 고정하는 계약: 결과는 기존 기간할인 원장에 출처와 함께 쓰고(가격 계산 순서 불변·한 상품 한 시점 할인가 하나),
-- 겹치는 상품은 건너뛰기로 이유를 남기며, 프로모션 중지는 그 프로모션이 만든 할인만 끄고 개별로 건 할인은 그대로 둔다.
begin;
create function pg_temp.promo_assert(p_ok boolean,p_message text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception '%',p_message;end if;end $$;
create function pg_temp.promo_error(p_sql text,p_error text) returns void language plpgsql as $$
begin begin execute p_sql;exception when others then if position(p_error in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected %',p_error;end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at) values
 ('b9200000-0000-4000-8000-000000000001','authenticated','authenticated','promo-admin@example.test','{}',now(),now()),
 ('b9200000-0000-4000-8000-000000000002','authenticated','authenticated','promo-logistics@example.test','{}',now(),now());
update public.profiles set role='admin',nickname='프로모션검증관리자' where id='b9200000-0000-4000-8000-000000000001';
update public.profiles set role='staff',nickname='프로모션검증물류' where id='b9200000-0000-4000-8000-000000000002';
insert into private.operator_memberships(profile_id,manager_role) values('b9200000-0000-4000-8000-000000000001','primary'),('b9200000-0000-4000-8000-000000000002','logistics');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at) values('b9200000-0000-4000-8000-000000000011','b9200000-0000-4000-8000-000000000001',now(),now());
insert into public.ips(id,title,vertical_key) values('promo-ip-main','TEST 프로모션 IP','character'),('promo-ip-other','TEST 프로모션 다른 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values
 ('promo-a','promo-ip-main','TEST 프로모션 A','문구',10000,'ok',10),
 ('promo-b','promo-ip-main','TEST 프로모션 B 옵션','문구',20000,'ok',10),
 ('promo-c','promo-ip-main','TEST 프로모션 C 저가','문구',900,'ok',10),
 ('promo-d','promo-ip-main','TEST 프로모션 D 겹침','문구',10000,'ok',10),
 ('promo-e','promo-ip-main','TEST 프로모션 E 나중 개별할인','문구',10000,'ok',10),
 ('promo-f','promo-ip-main','TEST 프로모션 F 보관','문구',10000,'ok',0),
 ('promo-g','promo-ip-main','TEST 프로모션 G 제외','문구',10000,'ok',10),
 ('promo-x','promo-ip-other','TEST 프로모션 X 밖','문구',10000,'ok',10);
update public.goods set code='PROMO-CODE-B' where id='promo-b';
update public.goods set archived_at=now() where id='promo-f';
insert into public.goods_variants(id,good_id,name,price,stock_qty,sort_order) values('b9200000-0000-4000-8000-0000000000b2','promo-b','큰 사이즈',25000,5,1);
insert into public.campaigns(id,kind,title,starts_at,ends_at,sections) values('promo-campaign','event','TEST 오픈 기획전',now(),now()+interval '30 days',
 '[{"type":"intro","copy":"오픈"},{"type":"goods","good_ids":["promo-a","promo-b"]},{"type":"goods","good_ids":["promo-c","promo-d","promo-e","promo-f","promo-g","promo-missing","promo-a"]}]');
set local role authenticated;
select set_config('request.jwt.claim.sub','b9200000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"b9200000-0000-4000-8000-000000000001","session_id":"b9200000-0000-4000-8000-000000000011","role":"authenticated"}',true);
-- 개별로 건 할인 세 개: D는 프로모션 기간과 겹치고, E는 나중 기간이라 겹치지 않으며, X는 대상 밖이다.
select public.admin_save_goods_price_period('promo-d',(select id from public.goods_variants where good_id='promo-d'),null,
 jsonb_build_object('state','active','discountPrice',9500,'startsAt',now()+interval '2 days','endsAt',now()+interval '4 days'),null);
select public.admin_save_goods_price_period('promo-e',(select id from public.goods_variants where good_id='promo-e'),null,
 jsonb_build_object('state','active','discountPrice',8800,'startsAt',now()+interval '10 days','endsAt',now()+interval '12 days'),null);
select public.admin_save_goods_price_period('promo-x',(select id from public.goods_variants where good_id='promo-x'),null,
 jsonb_build_object('state','active','discountPrice',9700,'startsAt',now()+interval '2 days','endsAt',now()+interval '4 days'),null);
create function pg_temp.promo_preview(p_number integer,p_request jsonb) returns jsonb language sql as $$
 select public.admin_preview_discount_promotion(md5('promo-test:'||p_number)::uuid,p_request,
  'b9200000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000011');$$;
create function pg_temp.promo_commit(p_number integer) returns jsonb language sql as $$
 select public.admin_commit_discount_promotion(md5('promo-test:'||p_number)::uuid,'b9200000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000011');$$;
create function pg_temp.promo_stop(p_number integer,p_operation integer) returns jsonb language sql as $$
 select public.admin_stop_discount_promotion(md5('promo-test:'||p_number)::uuid,md5('promo-stop:'||p_operation)::uuid,
  'b9200000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000011');$$;
create function pg_temp.promo_request(p_target jsonb,p_rule jsonb,p_exceptions jsonb default '[]',p_name text default 'TEST 오픈 기획전 10%',
 p_from interval default interval '1 day',p_to interval default interval '5 days') returns jsonb language sql as $$
 select jsonb_build_object('name',p_name,'startsAt',to_char((now()+p_from) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'endsAt',to_char((now()+p_to) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'target',p_target,'rule',p_rule,'exceptions',p_exceptions);$$;

-- 1. 기획전 상품 전체 10% + 한두 개만 다른 율(B 20%)·예외가(C 700원)·제외(G).
select pg_temp.promo_request('{"kind":"campaign","ids":["promo-campaign"]}','{"mode":"rate","value":10}',
 '[{"goodId":"promo-b","mode":"rate","value":20},{"goodId":"promo-c","mode":"price","value":700},{"goodId":"promo-g","mode":"exclude"}]') as request \gset
select pg_temp.promo_preview(1,:'request') as preview \gset
select pg_temp.promo_assert((select array_agg(r->>'id' order by ord) from jsonb_array_elements(:'preview'::jsonb->'goods') with ordinality x(r,ord))
 =array['promo-a','promo-b','promo-c','promo-d','promo-e','promo-f','promo-g'],'campaign goods in block order, missing ids dropped, duplicates once');
select pg_temp.promo_assert((select jsonb_object_agg(r->>'id',r->>'skip') from jsonb_array_elements(:'preview'::jsonb->'goods') r where r->>'skip' is not null)
 ='{"promo-d":"price_period_overlap","promo-f":"good_archived","promo-g":"discount_promotion_excluded"}'::jsonb,'skip reasons frozen');
select pg_temp.promo_assert((select r->'overlap'->'promotionId'='null'::jsonb and r->'overlap'->>'startsAt' is not null
 from jsonb_array_elements(:'preview'::jsonb->'goods') r where r->>'id'='promo-d'),'overlap names the individual discount');
select pg_temp.promo_assert((select jsonb_object_agg(r->>'id',jsonb_build_array(r->'nextMin',r->'nextMax',r->'rule'->>'source'))
 from jsonb_array_elements(:'preview'::jsonb->'goods') r where r->>'skip' is null)
 ='{"promo-a":[9000,9000,"default"],"promo-b":[16000,20000,"exception"],"promo-c":[700,700,"exception"],"promo-e":[9000,9000,"default"]}'::jsonb,
 'default rate, exception rate per option, exception price');
select pg_temp.promo_assert(:'preview'::jsonb->'target'='{"kind":"campaign","ids":["promo-campaign"],"label":"TEST 오픈 기획전"}'::jsonb,'target label');
select pg_temp.promo_assert(pg_temp.promo_preview(1,:'request')=:'preview'::jsonb,'same preview id replays the frozen preview');
select pg_temp.promo_error($q$select pg_temp.promo_preview(1,pg_temp.promo_request('{"kind":"campaign","ids":["promo-campaign"]}','{"mode":"rate","value":15}'))$q$,
 'discount_promotion_operation_conflict');
reset role;
-- 판매로 인한 재고 변동은 확정을 막지 않는다.
select private.change_goods_variant_stock('promo-a',(select id from public.goods_variants where good_id='promo-a'),-1);
set local role authenticated;
select pg_temp.promo_commit(1) as receipt \gset
select pg_temp.promo_assert(:'receipt'::jsonb->>'state'='completed' and (:'receipt'::jsonb->>'goodsCount')::int=4 and (:'receipt'::jsonb->>'periodCount')::int=5
 and :'receipt'::jsonb->>'promotionId'=md5('promo-test:1')::uuid::text and jsonb_array_length(:'receipt'::jsonb->'skipped')=3,'commit applies the rest and reports skips');
select pg_temp.promo_assert(pg_temp.promo_commit(1)=:'receipt'::jsonb,'repeat commit returns the stored receipt');
reset role;
select pg_temp.promo_assert((select jsonb_object_agg(good_id||':'||regular_price,discount_price) from private.goods_variant_price_periods
 where promotion_id=md5('promo-test:1')::uuid and state='active')
 ='{"promo-a:10000":9000,"promo-b:20000":16000,"promo-b:25000":20000,"promo-c:900":700,"promo-e:10000":9000}'::jsonb,'periods carry the promotion source');
select pg_temp.promo_assert(not exists(select 1 from private.goods_variant_price_periods where good_id in ('promo-d','promo-f','promo-g','promo-x') and promotion_id is not null),
 'skipped goods untouched');
-- 가격 계산은 같은 resolver다: 기간 안의 시점에는 프로모션 할인가, 밖에서는 정상가.
select pg_temp.promo_assert((select effective_price=9000 and price_period_id is not null from private.resolve_goods_variant_price(
  (select id from public.goods_variants where good_id='promo-a'),now()+interval '2 days'))
 and (select effective_price=10000 from private.resolve_goods_variant_price((select id from public.goods_variants where good_id='promo-a'),now()+interval '6 days'))
 and (select effective_price=8800 from private.resolve_goods_variant_price((select id from public.goods_variants where good_id='promo-e'),now()+interval '11 days')),
 'one effective price per option and instant');
select pg_temp.promo_assert((select goods_count=7 and applied_count=4 and target_label='TEST 오픈 기획전' and state='active' from private.discount_promotions where id=md5('promo-test:1')::uuid)
 and (select count(*)=7 and count(*) filter (where skip_reason is not null)=3 and count(*) filter (where rule->>'source'='exception')=3
  from private.discount_promotion_goods where promotion_id=md5('promo-test:1')::uuid),'promotion and lines recorded');
select pg_temp.promo_assert((select count(*)=1 from public.audit_log where action='catalog.discount_promotion.created' and target='discount_promotion:'||md5('promo-test:1')::uuid::text)
 and (select count(*)=5 from public.audit_log where action='admin.good.price_period_saved' and diff->'after'->>'promotion_id'=md5('promo-test:1')::uuid::text),
 'promotion audit and per-period good history');
select pg_temp.promo_error($q$update private.goods_variant_price_periods set promotion_id=null where promotion_id=md5('promo-test:1')::uuid$q$,'price_period_identity_immutable');
set local role authenticated;

-- 2. 한 상품 한 시점 할인가 하나: 다른 프로모션·개별 할인과 겹치는 상품만 남으면 등록할 수 없다.
select pg_temp.promo_error($q$select pg_temp.promo_preview(3,pg_temp.promo_request('{"kind":"goods","ids":["promo-a","promo-x"]}','{"mode":"amount","value":500}','[]','TEST 겹침',interval '3 days',interval '6 days'))$q$,
 'discount_promotion_all_skipped');

-- 3. 목록·상세.
select public.admin_list_discount_promotions() as list \gset
select pg_temp.promo_assert((:'list'::jsonb->>'total')::int=1 and :'list'::jsonb->'rows'->0->>'id'=md5('promo-test:1')::uuid::text
 and :'list'::jsonb->'rows'->0->'discounts'='{"active":5,"ended":0,"disabled":0}'::jsonb and (:'list'::jsonb->'rows'->0->>'exceptionCount')::int=3
 and :'list'::jsonb->'rows'->0->'target'='{"kind":"campaign","id":"promo-campaign","label":"TEST 오픈 기획전"}'::jsonb
 and :'list'::jsonb->'rows'->0->>'createdByName'='프로모션검증관리자','list summary');
select pg_temp.promo_assert((public.admin_list_discount_promotions('promo-campaign')->>'total')::int=1 and (public.admin_list_discount_promotions('other-campaign')->>'total')::int=0,'campaign filter');
select public.admin_get_discount_promotion(md5('promo-test:1')::uuid) as detail \gset
select pg_temp.promo_assert(jsonb_array_length(:'detail'::jsonb->'goods')=7 and :'detail'::jsonb->'goods'->0->>'id'='promo-a'
 and (select r->'discounts'='{"active":2,"ended":0,"disabled":0,"minPrice":16000,"maxPrice":20000}'::jsonb from jsonb_array_elements(:'detail'::jsonb->'goods') r where r->>'id'='promo-b')
 and (select r->>'skip'='price_period_overlap' and (r->'discounts'->>'active')::int=0 from jsonb_array_elements(:'detail'::jsonb->'goods') r where r->>'id'='promo-d'),'detail lines');

-- 4. 중지: 이 프로모션이 만든 할인만 끈다. 개별로 건 D·E·X 할인은 그대로다.
select pg_temp.promo_stop(1,1) as stop_receipt \gset
select pg_temp.promo_assert(:'stop_receipt'::jsonb->>'state'='completed' and (:'stop_receipt'::jsonb->>'disabledCount')::int=5
 and (:'stop_receipt'::jsonb->>'goodsCount')::int=4,'stop receipt');
reset role;
select pg_temp.promo_assert(not exists(select 1 from private.goods_variant_price_periods where promotion_id=md5('promo-test:1')::uuid and state='active'),
 'promotion discounts stopped');
select pg_temp.promo_assert((select count(*)=3 from private.goods_variant_price_periods where promotion_id is null and state='active' and good_id in ('promo-d','promo-e','promo-x')),
 'individually set discounts survive the promotion stop');
select pg_temp.promo_assert((select effective_price=8800 from private.resolve_goods_variant_price((select id from public.goods_variants where good_id='promo-e'),now()+interval '11 days'))
 and (select effective_price=10000 from private.resolve_goods_variant_price((select id from public.goods_variants where good_id='promo-a'),now()+interval '2 days')),
 'prices after stop');
select pg_temp.promo_assert((select state='stopped' and stopped_by='b9200000-0000-4000-8000-000000000001' and revision=2 from private.discount_promotions where id=md5('promo-test:1')::uuid)
 and (select count(*)=1 from public.audit_log where action='catalog.discount_promotion.stopped'),'stopped and audited');
set local role authenticated;
select pg_temp.promo_assert(pg_temp.promo_stop(1,1)=:'stop_receipt'::jsonb,'repeat stop returns the stored receipt');
select pg_temp.promo_error($q$select pg_temp.promo_stop(1,2)$q$,'discount_promotion_already_stopped');
select pg_temp.promo_assert(public.admin_list_discount_promotions()->'rows'->0->'discounts'='{"active":0,"ended":0,"disabled":5}'::jsonb,'list after stop');

-- 5. IP 전체 금액 할인: 보관 상품은 대상이 아니고, 저가 상품은 할인가가 맞지 않아 건너뛴다. 새 프로모션은 첫 프로모션의 중지된 할인과 겹치지 않는다.
select pg_temp.promo_preview(4,pg_temp.promo_request('{"kind":"ip","ids":["promo-ip-main"]}','{"mode":"amount","value":1000}','[]','TEST IP 1000원')) as ip_preview \gset
select pg_temp.promo_assert((select array_agg(r->>'id' order by r->>'id') from jsonb_array_elements(:'ip_preview'::jsonb->'goods') r)
 =array['promo-a','promo-b','promo-c','promo-d','promo-e','promo-g'] and :'ip_preview'::jsonb->'target'->>'label'='TEST 프로모션 IP','IP expansion excludes archived goods');
select pg_temp.promo_assert((select jsonb_object_agg(r->>'id',r->>'skip') from jsonb_array_elements(:'ip_preview'::jsonb->'goods') r where r->>'skip' is not null)
 ='{"promo-c":"goods_bulk_price_invalid","promo-d":"price_period_overlap"}'::jsonb,'IP skips');
-- 비교 이후 옵션 가격이 바뀌면 확정은 전체를 거절하고 영수증으로 남긴다.
reset role;
update public.goods_variants set price=price+1 where good_id='promo-g';
set local role authenticated;
select pg_temp.promo_assert(pg_temp.promo_commit(4)->>'error'='discount_promotion_changed','price change rejects the batch');
select pg_temp.promo_assert(pg_temp.promo_commit(4)->>'state'='rejected','rejection is terminal');
reset role;
select pg_temp.promo_assert(not exists(select 1 from private.discount_promotions where id=md5('promo-test:4')::uuid),'rejected commit leaves nothing');
set local role authenticated;
select pg_temp.promo_preview(5,pg_temp.promo_request('{"kind":"goods","ids":["promo-g"]}','{"mode":"rate","value":5}','[]','TEST 만료')) as expiring \gset
reset role;
update private.discount_promotion_operations set expires_at=clock_timestamp()-interval '1 second' where id=md5('promo-test:5')::uuid;
set local role authenticated;
select pg_temp.promo_assert(pg_temp.promo_commit(5)->>'error'='discount_promotion_preview_expired','expired preview rejects');
select pg_temp.promo_assert(public.admin_read_discount_promotion_operation(md5('promo-test:5')::uuid,'b9200000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000011')->>'state'='rejected',
 'read returns the stored receipt');
select pg_temp.promo_preview(6,pg_temp.promo_request('{"kind":"goods","ids":["promo-g"]}','{"mode":"rate","value":5}','[]','TEST 봉인'));
select pg_temp.promo_assert(public.admin_read_discount_promotion_operation(md5('promo-test:6')::uuid,'b9200000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000011')->>'state'='unresolved'
 and public.admin_read_discount_promotion_operation(md5('promo-test:6')::uuid,'b9200000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000011',true)->>'state'='sealed'
 and pg_temp.promo_commit(6)->>'state'='sealed','unresolved then sealed, commit never replays');

-- 6. 입력 검증.
select pg_temp.promo_error($q$select pg_temp.promo_preview(7,'{"name":"x"}')$q$,'discount_promotion_invalid');
select pg_temp.promo_error($q$select pg_temp.promo_preview(7,pg_temp.promo_request('{"kind":"goods","ids":["promo-a"]}','{"mode":"rate","value":100}'))$q$,'discount_promotion_invalid');
select pg_temp.promo_error($q$select pg_temp.promo_preview(7,pg_temp.promo_request('{"kind":"goods","ids":["promo-a"]}','{"mode":"price","value":100}'))$q$,'discount_promotion_invalid');
select pg_temp.promo_error($q$select pg_temp.promo_preview(7,pg_temp.promo_request('{"kind":"ip","ids":["promo-ip-main","promo-ip-other"]}','{"mode":"rate","value":10}'))$q$,'discount_promotion_invalid');
select pg_temp.promo_error($q$select pg_temp.promo_preview(7,pg_temp.promo_request('{"kind":"goods","ids":["promo-a"]}','{"mode":"rate","value":10}','[{"goodId":"promo-a","mode":"exclude","value":1}]'))$q$,'discount_promotion_invalid');
select pg_temp.promo_error($q$select pg_temp.promo_preview(7,pg_temp.promo_request('{"kind":"goods","ids":["promo-a"]}','{"mode":"rate","value":10}','[{"goodId":"promo-x","mode":"rate","value":5}]'))$q$,'discount_promotion_exception_outside_target');
select pg_temp.promo_error($q$select pg_temp.promo_preview(7,pg_temp.promo_request('{"kind":"campaign","ids":["no-campaign"]}','{"mode":"rate","value":10}'))$q$,'discount_promotion_campaign_unavailable');
select pg_temp.promo_error($q$select pg_temp.promo_preview(7,pg_temp.promo_request('{"kind":"goods","ids":["promo-a","no-good"]}','{"mode":"rate","value":10}'))$q$,'discount_promotion_good_unavailable');
select pg_temp.promo_error($q$select pg_temp.promo_preview(7,pg_temp.promo_request('{"kind":"goods","ids":["promo-a"]}','{"mode":"rate","value":10}','[]','TEST 지남',interval '-3 days',interval '-1 day'))$q$,'discount_promotion_period_ended');
select pg_temp.promo_error($q$select public.admin_preview_discount_promotion(gen_random_uuid(),pg_temp.promo_request('{"kind":"goods","ids":["promo-a"]}','{"mode":"rate","value":10}'),
 'b9200000-0000-4000-8000-000000000001','b9200000-0000-4000-8000-000000000099')$q$,'goods_group_auth_changed');

-- 7. 전시 상품 여러 줄 조회(1014-112): 상품번호·판매자상품코드·없음·보관.
select public.admin_resolve_goods_references(array['promo-a','promo-code-b','nope-123','promo-f']) as resolved \gset
select pg_temp.promo_assert((select array_agg(r->>'status' order by ord) from jsonb_array_elements(:'resolved'::jsonb) with ordinality x(r,ord))=array['found','found','not_found','found']
 and :'resolved'::jsonb->0->>'matchedBy'='id' and :'resolved'::jsonb->1->>'matchedBy'='code' and :'resolved'::jsonb->1->>'id'='promo-b'
 and :'resolved'::jsonb->3->>'archived'='true' and :'resolved'::jsonb->3->'candidate'='null'::jsonb
 and :'resolved'::jsonb->0->'candidate'->>'id'='promo-a' and :'resolved'::jsonb->0->'candidate' ?& array['reviewCount','wishCount','salesQuantity','freeShipping','discounted','saleType','variants']
 and :'resolved'::jsonb->0->>'published'='false','resolver statuses and candidate rows');
select pg_temp.promo_error($q$select public.admin_resolve_goods_references('{}'::text[])$q$,'invalid_goods_references');
select pg_temp.promo_error($q$select public.admin_resolve_goods_references(array[' promo-a'])$q$,'invalid_goods_references');
select pg_temp.promo_assert((select count(*)=1 from jsonb_array_elements(public.admin_discount_promotion_target_options()->'campaigns') c where c->>'id'='promo-campaign' and (c->>'goodsCount')::int=8)
 and exists(select 1 from jsonb_array_elements(public.admin_discount_promotion_target_options()->'ips') i where i->>'id'='promo-ip-main' and (i->>'goodsCount')::int=6),'target options');

-- 8. 권한: 물류 매니저는 조회도 할 수 없고, 익명·service_role은 실행 권한이 없다.
select set_config('request.jwt.claim.sub','b9200000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"b9200000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.promo_error($q$select public.admin_list_discount_promotions()$q$,'operator_capability_required');
select pg_temp.promo_error($q$select public.admin_resolve_goods_references(array['promo-a'])$q$,'operator_capability_required');
reset role;
select pg_temp.promo_assert(not has_function_privilege('anon','public.admin_preview_discount_promotion(uuid,jsonb,uuid,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_stop_discount_promotion(uuid,uuid,uuid,uuid)','execute')
 and not has_function_privilege('anon','public.admin_resolve_goods_references(text[])','execute')
 and not has_function_privilege('authenticated','private.insert_discount_promotion_period(uuid,text,uuid,integer,timestamptz,timestamptz,uuid)','execute')
 and not has_function_privilege('authenticated','private.discount_promotion_price(integer,integer,jsonb)','execute')
 and not has_table_privilege('authenticated','private.discount_promotions','select'),'ACL');
select pg_temp.promo_assert((select count(*)=8 from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
 where c.signature like '%discount_promotion%' or c.signature='public.admin_resolve_goods_references(text[])'),'operator contracts registered');
rollback;
