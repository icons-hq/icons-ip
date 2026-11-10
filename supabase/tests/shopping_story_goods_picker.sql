\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql. Test data is private to this transaction.
begin;
create function pg_temp.picker_error(q text,expected text) returns void language plpgsql as $$ begin
 begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected picker error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select ('88000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','picker-'||n||'@example.test',now(),'{}','{}' from generate_series(1,4)n;
update public.profiles set role='staff' where id in ('88000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000004');
insert into private.operator_memberships(profile_id,manager_role) values('88000000-0000-4000-8000-000000000001','primary'),('88000000-0000-4000-8000-000000000004','logistics');
insert into public.ips(id,title,vertical_key,published_at) select 'picker-test-ip','상품 선택기 검수',key,now() from public.verticals limit 1;
insert into public.catalog_categories(id,code,name) values('88000000-0000-4000-8000-000000000101','picker-parent','선물');
insert into public.catalog_categories(id,code,name,parent_id) values('88000000-0000-4000-8000-000000000102','picker-child','문구','88000000-0000-4000-8000-000000000101');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active)
values('88000000-0000-4000-8000-000000000201','picker-origin','선택기 출고지','hanjin',3000,1000,'합성 검수 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at,origin_id,created_at)
select 'picker-test-'||k,'picker-test-ip','선택기 '||k,'문구',case k when 'a' then 1000 when 'b' then 2000 when 'c' then 3000 else 4000 end,
 'ok',10,null,'88000000-0000-4000-8000-000000000201',now()-interval '1 day' from unnest(array['a','b','c','d','e','f'])k;
update public.goods set category_id='88000000-0000-4000-8000-000000000102',shipping_fee_type='free',compare_at_price=2000 where id='picker-test-a';
insert into public.goods_additional_categories(good_id,category_id) values('picker-test-f','88000000-0000-4000-8000-000000000102');
update public.goods set shipping_fee_type='individual',individual_fee=0 where id='picker-test-c';
update public.goods_variants set stock_qty=0 where good_id in ('picker-test-c','picker-test-d','picker-test-e');
update public.goods set archived_at=now() where id='picker-test-d';
insert into private.goods_variant_price_periods(good_id,variant_id,state,regular_price,discount_price,starts_at,ends_at,created_by,updated_by)
select good_id,id,'active',price,500,now()-interval '1 hour',now()+interval '1 hour','88000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000001' from public.goods_variants where good_id='picker-test-b';
set local role authenticated;
select set_config('request.jwt.claim.sub','88000000-0000-4000-8000-000000000001',true);
select public.admin_save_goods_preorder('picker-test-e',(select id from public.goods_variants where good_id='picker-test-e'),null,
 jsonb_build_object('state','active','capacityQty',7,'startsAt',now()-interval '1 hour','endsAt',now()+interval '1 day',
  'expectedShipDate',(now() at time zone 'Asia/Seoul')::date+7,'approvalReference','TEST-ONLY 선택기 공급 승인'));
reset role;
-- KC fixture operators must also be explicit after the role model is configured.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}'
from public.goods where id in ('picker-test-a','picker-test-b','picker-test-e','picker-test-f');
update public.profiles set role='staff' where id in (select ('47c47700'||left(md5(id),24))::uuid from public.goods where id in ('picker-test-a','picker-test-b','picker-test-e','picker-test-f'));
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id in ('picker-test-a','picker-test-b','picker-test-e','picker-test-f');
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in ('picker-test-a','picker-test-b','picker-test-e','picker-test-f');
insert into public.wishlists(user_id,good_id) values('88000000-0000-4000-8000-000000000002','picker-test-a'),('88000000-0000-4000-8000-000000000003','picker-test-a'),('88000000-0000-4000-8000-000000000002','picker-test-b');
create function pg_temp.picker_order(n integer,k text,qty_value integer,approved timestamptz,bank boolean default false)
returns uuid language plpgsql as $$
declare purchase uuid:=('88100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
 payment uuid:=('88200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;attempt uuid:=('88300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
begin
 insert into public.orders(id,user_id,status,total,address,payment_method) values(purchase,'88000000-0000-4000-8000-000000000002','paid',qty_value*1000,'{}',case when bank then 'bank_transfer'::public.order_payment_method else 'card'::public.order_payment_method end);
 insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select purchase,'picker-test-'||k,id,qty_value,1000,'합성 집계 상품','문구','picker-test-ip' from public.goods_variants where good_id='picker-test-'||k and is_default;
 insert into public.payments(id,user_id,purpose,ref_id,provider,amount,status,idempotency_key)
 values(payment,'88000000-0000-4000-8000-000000000002','order',purchase,case when bank then 'bank_transfer'::public.payment_provider else 'korpay'::public.payment_provider end,qty_value*1000,'paid','picker-payment-'||n);
 insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 values(attempt,case when bank then 'bank_transfer'::public.payment_provider else 'korpay'::public.payment_provider end,'88000000-0000-4000-8000-000000000002','order',purchase,qty_value*1000,'approved','picker-attempt-'||n,'picker-order-'||n,'picker-product-'||n,payment,now()+interval '1 hour');
 if approved is not null then
  if bank then insert into public.bank_transfer_confirmations(order_id,attempt_id,confirmed_by,confirmed_at,memo) values(purchase,attempt,'88000000-0000-4000-8000-000000000001',approved,'합성 승인');
  else insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,approved_at) values(attempt,'confirm',approved);end if;
 end if;return purchase;
end $$;
select pg_temp.picker_order(1,'a',3,now()-interval '1 hour');
select pg_temp.picker_order(2,'b',5,now()-interval '1 hour',true);
select pg_temp.picker_order(3,'c',999,null);
select pg_temp.picker_order(4,'e',999,now()-interval '31 days');
select pg_temp.picker_order(5,'e',999,now()+interval '1 hour');
select pg_temp.picker_order(6,'a',999,now()-interval '1 hour');
insert into public.order_cancellation_requests(order_id,requested_by,reason,claim_type,stage,status,completed_at)
values('88100000-0000-4000-8000-000000000006','88000000-0000-4000-8000-000000000002','합성 반품 완료','return','completed','completed',now());
insert into public.reviews(user_id,good_id,order_id,rating,body) values
 ('88000000-0000-4000-8000-000000000002','picker-test-a','88100000-0000-4000-8000-000000000001',4,'공개 검수 후기'),
 ('88000000-0000-4000-8000-000000000002','picker-test-a','88100000-0000-4000-8000-000000000002',5,'공개 검수 후기');
insert into public.reviews(user_id,good_id,order_id,rating,body,status,hidden_reason,hidden_at)
 values('88000000-0000-4000-8000-000000000002','picker-test-b','88100000-0000-4000-8000-000000000002',5,'비공개 검수 후기','hidden','검수 숨김',now());
-- 3.995 rounds to 4.00 for display, but does not meet the true >=4 predicate.
insert into public.orders(id,user_id,status,total,address) select ('88400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'88000000-0000-4000-8000-000000000002','done',1000,'{}' from generate_series(1,200)n;
insert into public.reviews(user_id,good_id,order_id,rating,body) select '88000000-0000-4000-8000-000000000002','picker-test-f',('88400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,case when n=1 then 3 else 4 end,'평점 경계 검수 후기' from generate_series(1,200)n;
set local role authenticated;
select set_config('request.jwt.claim.sub','88000000-0000-4000-8000-000000000001',true);
do $$ declare r jsonb;begin
 r:=public.admin_search_shopping_story_goods_filtered('picker-test-',1,'{"sort":"popular"}');
 if r->>'total'<>'5' or r#>>'{rows,0,id}'<>'picker-test-a' or r#>>'{rows,0,wishCount}'<>'2' then raise exception 'Popular/private/archived scope incorrect';end if;
 r:=public.admin_search_shopping_story_goods_filtered('picker-test-',1,'{"sort":"sales"}');
 if r#>>'{rows,0,id}'<>'picker-test-b' or r#>>'{rows,0,salesQuantity}'<>'5' or r#>>'{rows,1,salesQuantity}'<>'3'
  or exists(select 1 from jsonb_array_elements(r->'rows')row where row->>'id' in ('picker-test-c','picker-test-e') and row->>'salesQuantity'<>'0') then raise exception 'Evidence/return/time sales aggregation incorrect';end if;
 r:=public.admin_search_shopping_story_goods_filtered('picker-test-',1,'{"discounted":true,"sort":"price_asc"}');
 if r->>'total'<>'2' or r#>>'{rows,0,id}'<>'picker-test-b' or r#>>'{rows,0,variants,0,pricing,effectivePrice}'<>'500' then raise exception 'Current period/compare-price discount incorrect';end if;
 if public.admin_search_shopping_story_goods_filtered('picker-test-b',1,'{"freeShipping":true}')->>'total'<>'0'
  or public.admin_search_shopping_story_goods_filtered('picker-test-c',1,'{"freeShipping":true}')->>'total'<>'1'
  or public.admin_search_shopping_story_goods_filtered('picker-test-e',1,'{"freeShipping":true}')->>'total'<>'1' then raise exception 'Single-option parcel policy ignored';end if;
 r:=public.admin_search_shopping_story_goods_filtered('picker-test-',1,'{"saleType":"preorder","stock":"available"}');
 if r->>'total'<>'1' or r#>>'{rows,0,id}'<>'picker-test-e' or r#>>'{rows,0,variants,0,supply,availableQty}'<>'7' then raise exception 'Preorder supply unavailable';end if;
 if public.admin_search_shopping_story_goods_filtered('picker-test-',1,'{"stock":"soldout"}')->>'total'<>'1' then raise exception 'Stock availability mismatch';end if;
 r:=public.admin_search_shopping_story_goods_filtered('picker-test-',1,'{"categoryId":"88000000-0000-4000-8000-000000000101"}');
 if r->>'total'<>'2' then raise exception 'Descendant/additional category omitted';end if;
 if not exists(select 1 from jsonb_array_elements(r->'categories')c where c->>'path'='선물 > 문구') then raise exception 'Category path missing';end if;
 r:=public.admin_search_shopping_story_goods_filtered('picker-test-',1,'{"minRating":4,"reviews":"with","sort":"rating"}');
 if r->>'total'<>'1' or r#>>'{rows,0,ratingAverage}'<>'4.50' then raise exception 'Hidden or rounded-up reviews leaked';end if;
 r:=public.admin_search_shopping_story_goods_filtered('picker-test-',1,'{"sort":"reviews"}');if r#>>'{rows,0,id}'<>'picker-test-f' then raise exception 'Review order incorrect';end if;
 if public.admin_search_shopping_story_goods_filtered('picker-test-',1,'{"visibility":"published"}')->>'total'<>'4'
  or public.admin_search_shopping_story_goods_filtered('picker-test-',1,'{"visibility":"draft"}')->>'total'<>'1' then raise exception 'Visibility scope incorrect';end if;
 if public.admin_search_shopping_story_goods_filtered('picker-test-',1,'{"minPrice":500,"maxPrice":500}')->>'total'<>'1' then raise exception 'Current price range incorrect';end if;
 if public.admin_search_shopping_story_goods_filtered('picker-test-a',1,'{"field":"name"}')->>'total'<>'0'
  or public.admin_search_shopping_story_goods_filtered('picker-test-a',1,'{"field":"id"}')->>'total'<>'1' then raise exception 'Search field ignored';end if;
end $$;
do $$ declare bad jsonb;begin
 for bad in select value from jsonb_array_elements('[null,[],{"minRating":"bad"},{"minRating":4.1},{"freeShipping":"false"},{"categoryId":"bad"},{"minPrice":1.5},{"minPrice":100000001},{"minPrice":4,"maxPrice":3},{"sort":"unsafe"},{"unknown":true}]') loop
  perform pg_temp.picker_error(format('select public.admin_search_shopping_story_goods_filtered(%L,1,%L::jsonb)','',bad::text),'invalid_shopping_story_goods_filter');
 end loop;
end $$;
select set_config('request.jwt.claim.sub','88000000-0000-4000-8000-000000000004',true);
select pg_temp.picker_error($q$select public.admin_search_shopping_story_goods_filtered('',1,'{"minRating":"invalid"}')$q$,'operator_capability_required');
select set_config('request.jwt.claim.sub','88000000-0000-4000-8000-000000000002',true);
select pg_temp.picker_error($q$select public.admin_search_shopping_story_goods_filtered()$q$,'operator_capability_required');
reset role;
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,created_at) select 'picker-page-'||lpad(n::text,2,'0'),'picker-test-ip','동일 제목','문구',1000,'ok',1,now() from generate_series(1,21)n;
set local role authenticated;
select set_config('request.jwt.claim.sub','88000000-0000-4000-8000-000000000001',true);
do $$ declare a jsonb;b jsonb;begin
 a:=public.admin_search_shopping_story_goods_filtered('picker-page-',1,'{"sort":"latest"}');b:=public.admin_search_shopping_story_goods_filtered('picker-page-',2,'{"sort":"latest"}');
 if a->>'total'<>'21' or jsonb_array_length(a->'rows')<>20 or jsonb_array_length(b->'rows')<>1 or a#>>'{rows,0,id}'<>'picker-page-01' or b#>>'{rows,0,id}'<>'picker-page-21' then raise exception 'Stable page boundary incorrect';end if;
end $$;
reset role;
select 1/case when not has_function_privilege('anon','public.admin_search_shopping_story_goods_filtered(text,integer,jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_search_shopping_story_goods_filtered(text,integer,jsonb)','execute')
 and has_function_privilege('authenticated','public.admin_search_shopping_story_goods_filtered(text,integer,jsonb)','execute') then 1 else 0 end as picker_acl;
rollback;
