\set ON_ERROR_STOP on
-- Run as supabase_admin to LOAD safeupdate, then exercise authenticated/anon.
-- Prepend helpers/goods_kc_fixture.sql. Synthetic ledgers and settings roll back.
begin;
create function pg_temp.expect_detail_error(q text,expected text) returns void language plpgsql as $$
begin begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;raise exception 'expected error: %',expected;end $$;
update private.operator_access_state set configured=false where id;
delete from private.operator_memberships;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','detail-presentation-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,7)n;
update public.profiles set role=case when id='91000000-0000-4000-8000-000000000001' then 'admin'::public.user_role when id='91000000-0000-4000-8000-000000000007' then 'user'::public.user_role else 'staff'::public.user_role end,
 nickname='detail-presentation-'||right(id::text,3),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id::text like '91000000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role)
 select ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,role from unnest(array['owner','primary','deputy','influencer','agency','logistics']) with ordinality r(role,n);
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key,published_at,public_slug) select 'detail-test-ip','상세표시 합성 IP',key,now(),'detail-test-ip' from public.verticals limit 1;
insert into public.catalog_categories(id,code,name) values('91000000-0000-4000-8000-000000010001','detail-test-root','상세 대분류');
insert into public.catalog_categories(id,code,name,parent_id) values('91000000-0000-4000-8000-000000010002','detail-test-leaf','상세 하위분류','91000000-0000-4000-8000-000000010001');
insert into public.goods(id,ip_id,name,type,price,category_id,created_at)
 select 'detail-test-'||n,'detail-test-ip','상세 합성 상품 '||n,'문구',1000,'91000000-0000-4000-8000-000000010002',now()-n*interval '1 hour' from generate_series(0,35)n;
insert into public.goods(id,ip_id,name,type,price) values('detail-test-draft','detail-test-ip','상세 초안','문구',1000);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}',now(),now() from public.goods where id like 'detail-test-%' and id<>'detail-test-draft';
update public.profiles set role='staff' where id in(select ('47c47700'||left(md5(id),24))::uuid from public.goods where id like 'detail-test-%' and id<>'detail-test-draft');
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id like 'detail-test-%' and id<>'detail-test-draft';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id like 'detail-test-%' and id<>'detail-test-draft';
update public.category_activation_control set customer_enabled=true where id='catalog';
select 1/case when not has_table_privilege('anon','private.product_detail_settings','select') and not has_table_privilege('authenticated','private.product_detail_banner_goods','insert')
 and not has_function_privilege('service_role','public.get_product_detail_presentation(text)','execute')
 and not has_function_privilege('anon','public.admin_get_product_detail_presentation()','execute')
 and not has_function_privilege('authenticated','private.product_detail_paid_orders(timestamptz,timestamptz)','execute') then 1 else 0 end as sealed_acl;
-- Match the REST session's guard; direct psql does not preload it by default.
load 'safeupdate';
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.admin_get_product_detail_presentation()->'values'->'banner' as original_banner \gset
select public.admin_get_product_detail_presentation()->'values'->'modules' as original_modules \gset
select (public.admin_get_product_detail_presentation()#>>'{revisions,banner}')::bigint as initial_revision \gset
select :'original_banner'::jsonb||'{"enabled":true,"title":"합성 안내","text":"상세표시 검수","targetType":"all"}'::jsonb as banner \gset
select public.admin_save_product_detail_presentation('banner',:'banner',:'initial_revision','91000000-0000-4000-8000-000000001001') as saved \gset
select 1/case when public.admin_save_product_detail_presentation('banner',:'banner',:'initial_revision','91000000-0000-4000-8000-000000001001')=:'saved'::jsonb then 1 else 0 end as exact_retry;
select pg_temp.expect_detail_error(format($q$select public.admin_save_product_detail_presentation('banner',%L,%s,'91000000-0000-4000-8000-000000001001')$q$,:'banner'::jsonb||'{"title":"다른 요청"}',:'initial_revision'),'operation_conflict');
select pg_temp.expect_detail_error(format($q$select public.admin_save_product_detail_presentation('banner',%L,%s,'91000000-0000-4000-8000-000000001002')$q$,:'banner',:'initial_revision'),'product_detail_conflict');
create function pg_temp.save_detail(section text,p_values jsonb) returns jsonb language sql as $$select public.admin_save_product_detail_presentation(section,p_values,(public.admin_get_product_detail_presentation()->'revisions'->>section)::bigint,gen_random_uuid())$$;
select pg_temp.expect_detail_error(format($q$select pg_temp.save_detail('banner',%L)$q$,:'banner'::jsonb||'{"style":null}'),'invalid_product_detail_presentation');
select pg_temp.expect_detail_error(format($q$select pg_temp.save_detail('banner',%L)$q$,:'banner'::jsonb||'{"title":"12345678901"}'),'invalid_product_detail_presentation');
select pg_temp.expect_detail_error(format($q$select pg_temp.save_detail('banner',%L)$q$,:'banner'::jsonb||'{"text":"123456789012345678901"}'),'invalid_product_detail_presentation');
select pg_temp.expect_detail_error(format($q$select pg_temp.save_detail('banner',%L)$q$,:'banner'::jsonb||'{"title":""}'),'invalid_product_detail_presentation');
select pg_temp.expect_detail_error(format($q$select pg_temp.save_detail('banner',%L)$q$,:'banner'::jsonb||'{"periodEnabled":true,"startsOn":"2026-02-30","endsOn":"2026-03-01"}'),'invalid_product_detail_presentation');
select pg_temp.expect_detail_error(format($q$select pg_temp.save_detail('banner',%L)$q$,:'banner'::jsonb||'{"periodEnabled":true,"startsOn":"2026-10-15","endsOn":"2026-10-14"}'),'invalid_product_detail_presentation');
select pg_temp.expect_detail_error(format($q$select pg_temp.save_detail('banner',%L)$q$,:'banner'::jsonb||'{"targetType":"goods","goodIds":["detail-test-0","detail-test-0"]}'),'invalid_product_detail_presentation');
select pg_temp.expect_detail_error(format($q$select pg_temp.save_detail('banner',%L)$q$,:'banner'::jsonb||'{"targetType":"goods","goodIds":["missing-detail"]}'),'banner_good_missing');
select pg_temp.expect_detail_error(format($q$select pg_temp.save_detail('banner',%L)$q$,:'banner'::jsonb||jsonb_build_object('targetType','goods','goodIds',(select jsonb_agg('detail-over-'||n) from generate_series(1,201)n))),'invalid_product_detail_presentation');
select pg_temp.expect_detail_error(format($q$select pg_temp.save_detail('banner',%L)$q$,:'banner'::jsonb||jsonb_build_object('targetType','categories','categoryIds',(select jsonb_agg('91000000-0000-4000-8000-'||lpad(n::text,12,'0')) from generate_series(1,11)n))),'invalid_product_detail_presentation');
select pg_temp.expect_detail_error($q$select pg_temp.save_detail('modules','{"reviewSummary":true}')$q$,'invalid_product_detail_presentation');
reset role;
set local role anon;
select 1/case when public.get_product_detail_presentation('detail-test-0')#>>'{banner,title}'='합성 안내'
 and public.get_product_detail_presentation('detail-test-draft') is null and public.get_product_detail_presentation('missing') is null
 and not (public.get_product_detail_presentation('detail-test-0')->'banner' ? 'goodIds') then 1 else 0 end as public_only_payload;
reset role;
set local role authenticated;
select pg_temp.save_detail('banner',:'banner'::jsonb||jsonb_build_object('targetType','goods','goodIds',jsonb_build_array('detail-test-0','detail-test-draft')));
select 1/case when public.get_product_detail_presentation('detail-test-1')->'banner'='null'::jsonb then 1 else 0 end as target_only;
reset role;
update public.goods set id='detail-test-renamed' where id='detail-test-draft';
select 1/case when exists(select 1 from private.product_detail_banner_goods where good_id='detail-test-renamed') then 1 else 0 end as draft_id_cascade;
delete from public.goods where id='detail-test-renamed';
select 1/case when not exists(select 1 from private.product_detail_banner_goods where good_id in('detail-test-draft','detail-test-renamed')) then 1 else 0 end as deletion_removes_target;
set local role authenticated;
select pg_temp.save_detail('banner',:'banner'::jsonb||'{"targetType":"categories","categoryIds":["91000000-0000-4000-8000-000000010001"]}');
select 1/case when public.get_product_detail_presentation('detail-test-0')->'banner'<>'null'::jsonb then 1 else 0 end as descendants_match;
reset role;
update public.category_activation_control set customer_enabled=false where id='catalog';
select 1/case when public.get_product_detail_presentation('detail-test-0')->'banner'='null'::jsonb then 1 else 0 end as inactive_category_hidden;
update public.category_activation_control set customer_enabled=true where id='catalog';
set local role authenticated;
select pg_temp.save_detail('banner',:'banner'::jsonb||jsonb_build_object('periodEnabled',true,'startsOn',(statement_timestamp() at time zone 'Asia/Seoul')::date::text,'endsOn',(statement_timestamp() at time zone 'Asia/Seoul')::date::text));
select 1/case when public.get_product_detail_presentation('detail-test-0')->'banner'<>'null'::jsonb and public.get_product_detail_presentation('detail-test-0')->>'nextChangeAt' is not null then 1 else 0 end as inclusive_today_and_next_boundary;
select pg_temp.save_detail('banner',:'banner'::jsonb||jsonb_build_object('periodEnabled',true,'startsOn',((statement_timestamp() at time zone 'Asia/Seoul')::date+1)::text,'endsOn',((statement_timestamp() at time zone 'Asia/Seoul')::date+2)::text));
select 1/case when public.get_product_detail_presentation('detail-test-0')->'banner'='null'::jsonb and public.get_product_detail_presentation('detail-test-0')->>'nextChangeAt' is not null then 1 else 0 end as future_hidden;
select pg_temp.save_detail('banner',:'banner'::jsonb||jsonb_build_object('periodEnabled',true,'startsOn',((statement_timestamp() at time zone 'Asia/Seoul')::date-2)::text,'endsOn',((statement_timestamp() at time zone 'Asia/Seoul')::date-1)::text));
select 1/case when public.get_product_detail_presentation('detail-test-0')->'banner'='null'::jsonb and public.get_product_detail_presentation('detail-test-0')->>'nextChangeAt' is null then 1 else 0 end as past_hidden;
select pg_temp.save_detail('modules','{"reviewSummary":true,"similar":true,"together":true,"categoryPopular":true,"storePopular":true}');
reset role;
-- Real payment evidence on synthetic orders; never create real external charges.
create function pg_temp.detail_order(n integer,partners integer[],approved timestamptz,order_state public.order_status default 'paid',payment_state public.payment_status default 'paid',bank boolean default false)
returns uuid language plpgsql as $$
declare purchase uuid:=('91000000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid;
 payment uuid:=('91000000-0000-4000-8002-'||lpad(n::text,12,'0'))::uuid;attempt uuid:=('91000000-0000-4000-8003-'||lpad(n::text,12,'0'))::uuid;total bigint:=(cardinality(partners)+1)*1000000;
begin
 insert into public.orders(id,user_id,status,total,address,payment_method) values(purchase,'91000000-0000-4000-8000-000000000007',order_state,total,'{}',case when bank then 'bank_transfer'::public.order_payment_method else 'card'::public.order_payment_method end);
 insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select purchase,g.id,v.id,1000,1000,g.name,g.type,g.ip_id from unnest(array_prepend(0,partners)) number join public.goods g on g.id='detail-test-'||number join public.goods_variants v on v.good_id=g.id and v.is_default;
 insert into public.payments(id,user_id,purpose,ref_id,provider,amount,status,idempotency_key) values(payment,'91000000-0000-4000-8000-000000000007','order',purchase,case when bank then 'bank_transfer'::public.payment_provider else 'korpay'::public.payment_provider end,total,payment_state,'detail-payment-'||n);
 insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 values(attempt,case when bank then 'bank_transfer'::public.payment_provider else 'korpay'::public.payment_provider end,'91000000-0000-4000-8000-000000000007','order',purchase,total,'approved','detail-attempt-'||n,'detail-order-'||n,'detail-product-'||n,payment,now()+interval '10 minutes');
 if approved is not null then
  if bank then insert into public.bank_transfer_confirmations(order_id,attempt_id,confirmed_by,confirmed_at,memo) values(purchase,attempt,'91000000-0000-4000-8000-000000000001',approved,'합성 확인');
  else insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,approved_at) values(attempt,'confirm',approved);end if;
 end if;return purchase;
end $$;
select date_trunc('day',statement_timestamp() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as today \gset
select pg_temp.detail_order(1,array[1,2,3,4,5],:'today'::timestamptz-interval '30 days');
select pg_temp.detail_order(2,array[2],:'today'::timestamptz-interval '1 microsecond','done','paid',true);
select pg_temp.detail_order(3,array[31],:'today'::timestamptz);
select pg_temp.detail_order(4,array[31],:'today'::timestamptz-interval '30 days 1 microsecond');
select pg_temp.detail_order(5,array[31],null);
select pg_temp.detail_order(6,array[31],:'today'::timestamptz-interval '1 day','canceled','refunded');
select pg_temp.detail_order(7,array[31],:'today'::timestamptz-interval '1 day','paid','refunded');
select pg_temp.detail_order(8,array[31],:'today'::timestamptz-interval '1 day');
insert into public.order_cancellation_requests(order_id,requested_by,reason,claim_type,stage,status,completed_at) values('91000000-0000-4000-8001-000000000008','91000000-0000-4000-8000-000000000007','합성 완료 반품','return','completed','completed',now());
select pg_temp.detail_order(9,array[31],:'today'::timestamptz-interval '1 day');
update public.payments set user_id='91000000-0000-4000-8000-000000000001' where id='91000000-0000-4000-8002-000000000009';
select pg_temp.detail_order(10,array[31],:'today'::timestamptz-interval '1 day');
update public.payments set amount=amount+100 where id='91000000-0000-4000-8002-000000000010';
update public.payment_attempts set amount=amount+100 where id='91000000-0000-4000-8003-000000000010';
insert into public.wishlists(user_id,good_id) values('91000000-0000-4000-8000-000000000007','detail-test-7');
update public.goods set stock='soldout',stock_qty=0 where id='detail-test-5';
update public.goods set category_id=null,created_at=now() where id='detail-test-35';
select public.get_product_detail_presentation('detail-test-0') as public_data \gset
select 1/case when jsonb_array_length(:'public_data'::jsonb#>'{recommendations,similar}')=30
 and :'public_data'::jsonb#>>'{recommendations,similar,0}'='detail-test-1'
 and not (:'public_data'::jsonb#>'{recommendations,similar}' ? 'detail-test-35')
 and jsonb_array_length(:'public_data'::jsonb#>'{recommendations,together}')=5 and :'public_data'::jsonb#>>'{recommendations,together,0}'='detail-test-2'
 and not (:'public_data'::jsonb#>'{recommendations,together}' ? 'detail-test-31')
 and :'public_data'::jsonb#>'{recommendations,together}' ? 'detail-test-5'
 and jsonb_array_length(:'public_data'::jsonb#>'{recommendations,categoryPopular}')=6
 and not (:'public_data'::jsonb#>'{recommendations,categoryPopular}' ? 'detail-test-31')
 and :'public_data'::jsonb#>>'{recommendations,storePopular,0}'='detail-test-2' then 1 else 0 end as actual_paid_rankings_and_public_soldout;
-- All public reviews count in the ratio, even when the card list is capped.
insert into public.orders(id,user_id,status,total,address)
 select ('91000000-0000-4000-8004-'||lpad(n::text,12,'0'))::uuid,'91000000-0000-4000-8000-000000000007','done',1000,'{}' from generate_series(1,16)n;
insert into public.reviews(id,user_id,good_id,order_id,rating,body,image_paths,status,hidden_reason,hidden_at,created_at)
 select ('91000000-0000-4000-8005-'||lpad(n::text,12,'0'))::uuid,'91000000-0000-4000-8000-000000000007','detail-test-0',('91000000-0000-4000-8004-'||lpad(n::text,12,'0'))::uuid,
 least(n,5),'상세 합성 공개 리뷰 '||n,case when n=4 then array['91000000-0000-4000-8000-000000000007/review/91000000-0000-4000-8005-000000000004.png'] else '{}'::text[] end,
 case when n=16 then 'hidden' else 'visible' end,case when n=16 then '합성 숨김' else null end,case when n=16 then now() else null end,now()-n*interval '1 day' from generate_series(1,16)n;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select public.get_product_detail_presentation('detail-test-0') as anonymous_data \gset
select 1/case when (:'anonymous_data'::jsonb#>>'{reviews,count}')::int=15 and (:'anonymous_data'::jsonb#>>'{reviews,positiveCount}')::int=12
 and jsonb_array_length(:'anonymous_data'::jsonb#>'{reviews,cards}')=10
 and :'anonymous_data'::jsonb#>>'{reviews,cards,0,id}'='91000000-0000-4000-8005-000000000004'
 and position('상세 합성 공개 리뷰 16' in :'anonymous_data')=0 and position('userId' in :'anonymous_data')=0 and position('orderId' in :'anonymous_data')=0 then 1 else 0 end as full_denominator_photo_priority_and_hidden_reviews;
reset role;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select 1/case when public.get_product_detail_presentation('detail-test-0')->'reviews'=:'anonymous_data'::jsonb->'reviews' then 1 else 0 end as staff_hidden_review_safe;
reset role;
update public.goods set sale_restriction='adult' where id='detail-test-5';
select 1/case when jsonb_array_length(public.get_product_detail_presentation('detail-test-0')#>'{recommendations,together}')=0 then 1 else 0 end as minimum_five_rechecked_after_visibility;
update public.goods set published_at=null where id='detail-test-0';
select 1/case when public.get_product_detail_presentation('detail-test-0') is null then 1 else 0 end as current_hidden;
select pg_temp.publish_goods_kc_fixture('detail-test-0');
update public.ips set published_at=null where id='detail-test-ip';
select 1/case when public.get_product_detail_presentation('detail-test-0') is null then 1 else 0 end as parent_hidden;
-- Owner, primary, deputy, influencer and agency can save; logistics and user cannot.
do $$ declare n integer;begin
 for n in 1..5 loop
  perform set_config('request.jwt.claim.sub',('91000000-0000-4000-8000-'||lpad(n::text,12,'0')),true);
  perform public.admin_get_product_detail_presentation();perform pg_temp.save_detail('modules',public.admin_get_product_detail_presentation()->'values'->'modules');
 end loop;
 for n in 6..7 loop
  perform set_config('request.jwt.claim.sub',('91000000-0000-4000-8000-'||lpad(n::text,12,'0')),true);
  perform pg_temp.expect_detail_error('select public.admin_get_product_detail_presentation()','operator_capability_required');
  perform pg_temp.expect_detail_error($q$select public.admin_save_product_detail_presentation('modules','{}',0,gen_random_uuid())$q$,'operator_capability_required');
 end loop;
end $$;
update public.profiles set suspended_at=now(),suspension_reason='합성 권한회수 검수' where id='91000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
select pg_temp.expect_detail_error('select public.admin_get_product_detail_presentation()','operator_capability_required');
select 1/case when (select count(*) from public.audit_log where id='91000000-0000-4000-8000-000000001001')=1 then 1 else 0 end as exact_retry_once;
rollback;
