\set ON_ERROR_STOP on
-- Prepend goods_kc_fixture.sql. Every amount/address/provider key is synthetic.
begin;
create function pg_temp.transaction_expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('c7160750-0000-4000-8000-000000000001','authenticated','authenticated','review-types-admin@example.test',now(),'{}','{}',now(),now()),
 ('c7160750-0000-4000-8000-000000000002','authenticated','authenticated','review-types-buyer@example.test',now(),'{}','{}',now(),now()),
 ('c7160750-0000-4000-8000-000000000003','authenticated','authenticated','review-types-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 리뷰유형 회귀 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='c7160750-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('c7160750-0000-4000-8000-000000000001','c7160750-0000-4000-8000-000000000002','c7160750-0000-4000-8000-000000000003');
insert into private.operator_memberships(profile_id,manager_role) values('c7160750-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
update private.goods_transaction_runtime set enabled=true where singleton;
insert into public.ips(id,title,vertical_key,published_at) values('review-types-ip','TEST 거래 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('c7160750-0000-4000-8000-000000000010','review-types-origin','TEST 출고지','hanjin',3000,'TEST 합성 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee) values
 ('review-types-a','review-types-ip','TEST 상품 A','문구',10000,'ok',100,'c7160750-0000-4000-8000-000000000010','policy',0),
 ('review-types-b','review-types-ip','TEST 상품 B','문구',5000,'ok',100,'c7160750-0000-4000-8000-000000000010','individual',2000);
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','confirmation-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where ip_id='review-types-ip';
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where ip_id='review-types-ip';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where ip_id='review-types-ip';
select id as variant_a from public.goods_variants where good_id='review-types-a' and is_default \gset
select id as variant_b from public.goods_variants where good_id='review-types-b' and is_default \gset


insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select ('c7160750-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,('c7160750-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now(),now()+interval '1 hour' from generate_series(1,3)n;
create function pg_temp.as_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','c7160750-0000-4000-8000-'||lpad(n::text,12,'0'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','c7160750-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated','session_id','c7160750-0000-4000-9000-'||lpad(n::text,12,'0'))::text,true);
end $$;
create function pg_temp.confirm_order(n integer,delivered_at_value timestamptz default clock_timestamp()-interval '2 days') returns uuid language plpgsql as $$
declare oid uuid:=('c7160750-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid;sid uuid:=gen_random_uuid();item uuid;
begin
 insert into public.orders(id,user_id,status,total,address,store_credit_policy_snapshot) values(oid,'c7160750-0000-4000-8000-000000000002','confirmed',10000,
 '{"recipientName":"TEST 합포장","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}',
 '{"enabled":true,"earnKind":"fixed","earnValue":100,"earnMaxPerOrder":1000,"maxBalance":100000,"validityDays":30,"minUse":100,"maxUse":1000,"restoreGraceDays":3,"refundEarnedCreditMode":"offset_future_credits"}');
 insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select oid,g.id,v.id,1,10000,g.name,g.type,g.ip_id from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default where g.id='review-types-a' returning id into item;
 insert into public.payments(user_id,purpose,ref_id,provider,amount,status,idempotency_key) values('c7160750-0000-4000-8000-000000000002','order',oid,'toss',10000,'paid','review-types-payment-'||n);
 insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
 values(sid,oid,'c7160750-0000-4000-8000-000000000010','TEST 출고지',0,'{}');
 insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(oid,sid,item,1);
 return oid;
end $$;

select pg_temp.confirm_order(n) from generate_series(1,7)n;
update public.orders set status='delivered',created_at=now()-interval '60 days',delivered_at=now()-interval '40 days' where id::text like 'c7160750-0000-4001-%';
update public.orders set created_at=now()-interval '100 days',delivered_at=now()-interval '60 days' where id='c7160750-0000-4001-8000-000000000001';
insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 select gen_random_uuid(),p.provider,p.user_id,p.purpose,p.ref_id,p.amount,'approved','review-types-attempt-'||p.id,'review-types-provider-'||p.id,'review-types-product-'||p.id,p.id,now()+interval '1 hour'
 from public.payments p where p.ref_id::text like 'c7160750-0000-4001-%' and p.ref_id<>'c7160750-0000-4001-8000-000000000007';
insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,approved_at)
 select id,'confirm',now()-interval '45 days' from public.payment_attempts where ref_id::text like 'c7160750-0000-4001-%';
-- Active eligible event and reward policy make disabled monthly rewards a real negative case.
insert into private.review_events(id,title,description,target_type,starts_on,ends_on,announces_on,planned_winners,credit_amount,credit_validity_days,banner_style,created_by)
 values('c7160750-0000-4003-8000-000000000001','TEST 월간 리뷰','TEST 혜택 자격 검증','goods',current_date-1,current_date+1,current_date+4,10,100,30,'basic','c7160750-0000-4000-8000-000000000001');
insert into private.review_event_goods(event_id,good_id) values('c7160750-0000-4003-8000-000000000001','review-types-a');
select pg_temp.as_actor(1);set local role authenticated;
select public.admin_save_store_credit_policy(gen_random_uuid(),(public.admin_get_store_credit_policy()->>'version')::integer,'{"enabled":true,"earnKind":"fixed","earnValue":0,"earnMaxPerOrder":1000,"maxBalance":100000,"validityDays":30,"minUse":1,"maxUse":30000,"restoreGraceDays":3,"refundEarnedCreditMode":"offset_future_credits","evidence":"TEST independent monthly review reward policy"}');
reset role;
update private.customer_reward_policy set best_enabled=true,best_amount=100,best_validity_days=30,best_reversal='revoke' where singleton;
create function pg_temp.policy_values(enabled boolean default true,rewards boolean default false,basis text default 'delivered') returns jsonb language sql as $$
 select jsonb_build_object('enabled',enabled,'basis',basis,'startDays',31,'endDays',90,'maxOrderDays',365,'rewardEligible',rewards,'evidence','TEST 명시적 한달사용 설정','confirmed',true);$$;
select pg_temp.as_actor(1);set local role authenticated;
select (public.admin_get_review_type_policy()->>'revision')::bigint as revision \gset
select public.admin_save_review_type_policy(pg_temp.policy_values(false),:revision,gen_random_uuid(),'c7160750-0000-4000-8000-000000000001','c7160750-0000-4000-9000-000000000001');
reset role;select pg_temp.as_actor(2);set local role authenticated;
select pg_temp.transaction_expect_error($q$select public.create_good_review_v2('c7160750-0000-4001-8000-000000000002','review-types-a',5,'TEST 한달사용 작성 불가','{}','month')$q$,'review_month_window_closed');
select public.create_good_review('c7160750-0000-4001-8000-000000000002','review-types-a',5,'TEST 기존 일반 리뷰') as ordinary \gset
select public.create_good_review('c7160750-0000-4001-8000-000000000007','review-types-a',4,'TEST 과거 결제 증빙 일반 리뷰 유지') as legacy \gset
reset role;select pg_temp.as_actor(1);set local role authenticated;
select (public.admin_get_review_type_policy()->>'revision')::bigint as revision \gset
select public.admin_save_review_type_policy(pg_temp.policy_values(),:revision,'c7160750-0000-4002-8000-000000000001','c7160750-0000-4000-8000-000000000001','c7160750-0000-4000-9000-000000000001') as saved \gset
select 1/case when public.admin_save_review_type_policy(pg_temp.policy_values(),:revision,'c7160750-0000-4002-8000-000000000001','c7160750-0000-4000-8000-000000000001','c7160750-0000-4000-9000-000000000001')=:'saved'::jsonb then 1 else 0 end as policy_replay;
select pg_temp.transaction_expect_error(format($q$select public.admin_save_review_type_policy(pg_temp.policy_values(),%s,gen_random_uuid(),'c7160750-0000-4000-8000-000000000001','c7160750-0000-4000-9000-000000000001')$q$,:revision),'review_type_policy_changed');
reset role;select pg_temp.as_actor(2);set local role authenticated;
select public.create_good_review_v2('c7160750-0000-4001-8000-000000000002','review-types-a',1,'TEST 한달사용 별도 작성','{}','month') as monthly \gset
select pg_temp.transaction_expect_error($q$select public.create_good_review_v2('c7160750-0000-4001-8000-000000000002','review-types-a',5,'TEST 한달사용 중복 차단','{}','month')$q$,'review_already_exists');
select pg_temp.transaction_expect_error($q$select public.create_good_review_v2('c7160750-0000-4001-8000-000000000007','review-types-a',5,'TEST 결제 원본 없는 한달 리뷰','{}','month')$q$,'review_purchase_ineligible');
select 1/case when (select count(*) from public.my_review_targets_v2('c7160750-0000-4001-8000-000000000002'))=2 and (select count(*) from public.my_review_targets('c7160750-0000-4001-8000-000000000002'))=1 then 1 else 0 end as distinct_targets_legacy_preserved;
reset role;
select 1/case when (select repeat_purchase from public.reviews where id=:'monthly') and not(select month_reward_eligible from public.reviews where id=:'monthly') then 1 else 0 end as repeat_snapshot_and_reward_off;
select 1/case when not exists(select 1 from private.review_event_entries where review_id=:'monthly') then 1 else 0 end as no_implicit_event_entry;
select private.review_event_review_fingerprint(r) as monthly_fingerprint from public.reviews r where id=:'monthly' \gset
select pg_temp.as_actor(1);set local role authenticated;
select public.admin_set_review_best(:'monthly',true,'TEST 보상 제외 한달사용 리뷰',0,:'monthly_fingerprint',gen_random_uuid());
select public.admin_process_review_best_reward(:'monthly');
reset role;
select 1/case when not exists(select 1 from private.review_best_rewards where review_id=:'monthly') and exists(select 1 from private.review_best_reward_jobs where review_id=:'monthly' and outcome='disabled') then 1 else 0 end as monthly_best_reward_off;
select write_deadline_at as frozen_deadline from public.reviews where id=:'monthly' \gset
set local role anon;
select public.get_good_group_reviews_v3('review-types-a','recent',false,10,0,'month') as public_month \gset
select 1/case when :'public_month'::jsonb->>'total'='1' and :'public_month'::jsonb#>>'{summary,count}'='3' and :'public_month'::jsonb#>>'{reviews,0,kind}'='month' and :'public_month'::jsonb#>>'{reviews,0,repeatPurchase}'='true' then 1 else 0 end as typed_filtered_global_rating;
reset role;select pg_temp.as_actor(1);set local role authenticated;
select 1/case when (select count(*) from public.admin_search_reviews_typed(p_query=>'review-types-a',p_field=>'good',p_kind=>'month',p_repeat=>'yes'))=1 then 1 else 0 end as admin_typed_filter;
select public.admin_export_reviews_v2('{"from":null,"to":null,"rating":"all","lowRating":false,"status":"all","photo":"all","reply":"all","best":"all","query":"review-types-a","field":"good","sort":"recent","reviewId":null,"kind":"month","repeat":"yes"}') as export \gset
select 1/case when :'export'::jsonb->>'version'='2' and :'export'::jsonb->>'total'='1' and :'export'::jsonb#>>'{rows,0,kind}'='month' then 1 else 0 end as typed_export;
select (public.admin_get_review_type_policy()->>'revision')::bigint as revision \gset
select public.admin_save_review_type_policy(pg_temp.policy_values(false),:revision,gen_random_uuid(),'c7160750-0000-4000-8000-000000000001','c7160750-0000-4000-9000-000000000001');
reset role;select pg_temp.as_actor(2);set local role authenticated;
select public.update_good_review(:'monthly',2,'TEST 작성 당시 수정 기한 유지','{}');
select 1/case when (select count(*) from public.my_review_targets_v2('c7160750-0000-4001-8000-000000000002') where review_kind='month' and editable)=1 then 1 else 0 end as written_month_remains_editable_when_disabled;
reset role;
select 1/case when (select write_deadline_at from public.reviews where id=:'monthly')=:'frozen_deadline'::timestamptz then 1 else 0 end as frozen_deadline;
select pg_temp.transaction_expect_error(format($q$update public.reviews set repeat_purchase=false where id=%L$q$,:'monthly'),'review_type_snapshot_immutable');
update public.payments set status='refunded' where ref_id='c7160750-0000-4001-8000-000000000002';
set local role authenticated;
select pg_temp.transaction_expect_error(format($q$select public.update_good_review(%L,5,'TEST 환불 후 수정 거절','{}')$q$,:'monthly'),'review_purchase_ineligible');
reset role;select pg_temp.as_actor(1);set local role authenticated;
select (public.admin_get_review_type_policy()->>'revision')::bigint as revision \gset
select public.admin_save_review_type_policy(pg_temp.policy_values(true,false,'confirmed'),:revision,gen_random_uuid(),'c7160750-0000-4000-8000-000000000001','c7160750-0000-4000-9000-000000000001');
reset role;select pg_temp.as_actor(2);set local role authenticated;
select pg_temp.transaction_expect_error($q$select public.create_good_review_v2('c7160750-0000-4001-8000-000000000003','review-types-a',5,'TEST 구매확정 기산점 없음','{}','month')$q$,'review_month_window_closed');
reset role;
select pg_temp.as_actor(1);set local role authenticated;
select (public.admin_get_review_type_policy()->>'revision')::bigint as revision \gset
select public.admin_save_review_type_policy(pg_temp.policy_values(true,true,'delivered'),:revision,gen_random_uuid(),'c7160750-0000-4000-8000-000000000001','c7160750-0000-4000-9000-000000000001');
reset role;select pg_temp.as_actor(2);set local role authenticated;
select public.create_good_review_v2('c7160750-0000-4001-8000-000000000004','review-types-a',1,'TEST 한달사용 명시 보상 대상','{}','month') as reward_month \gset
reset role;
select 1/case when exists(select 1 from private.review_event_entries where review_id=:'reward_month') and(select month_reward_eligible from public.reviews where id=:'reward_month') then 1 else 0 end as explicit_month_event_eligibility;
select private.review_event_review_fingerprint(r) as reward_fingerprint from public.reviews r where id=:'reward_month' \gset
select pg_temp.as_actor(1);set local role authenticated;
select public.admin_set_review_best(:'reward_month',true,'TEST 별점 무관 월간 보상',0,:'reward_fingerprint',gen_random_uuid());
select public.admin_process_review_best_reward(:'reward_month');
select public.admin_process_review_best_reward(:'reward_month');
reset role;
select 1/case when (select count(*) from private.review_best_rewards where review_id=:'reward_month' and amount=100)=1 then 1 else 0 end as explicit_month_best_exactly_once;
select 1/case when not has_function_privilege('anon','public.admin_get_review_type_policy()','execute') and not has_function_privilege('service_role','public.create_good_review_v2(uuid,text,integer,text,text[],text)','execute') and not has_function_privilege('authenticated','private.review_type_window(public.orders,text)','execute') then 1 else 0 end as sealed_acl;
rollback;
