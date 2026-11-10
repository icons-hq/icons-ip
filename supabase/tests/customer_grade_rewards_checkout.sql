\set ON_ERROR_STOP on
-- Prepend goods_kc_fixture.sql. Every amount/address/provider key is synthetic.
begin;
create function pg_temp.transaction_expect_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if position(expected in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('bb140000-0000-4000-8000-000000000001','authenticated','authenticated','transaction-check-admin@example.test',now(),'{}','{}',now(),now()),
 ('bb140000-0000-4000-8000-000000000002','authenticated','authenticated','transaction-check-buyer@example.test',now(),'{}','{}',now(),now()),
 ('bb140000-0000-4000-8000-000000000003','authenticated','authenticated','transaction-check-other@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 등급거래 SQL '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='bb140000-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('bb140000-0000-4000-8000-000000000001','bb140000-0000-4000-8000-000000000002','bb140000-0000-4000-8000-000000000003');
insert into private.operator_memberships(profile_id,manager_role) values('bb140000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
update private.goods_transaction_runtime set enabled=true where singleton;
insert into public.ips(id,title,vertical_key,published_at) values('transaction-check-ip','TEST 거래 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('bb140000-0000-4000-8000-000000000010','transaction-check-origin','TEST 출고지','hanjin',3000,'TEST 합성 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee) values
 ('transaction-check-a','transaction-check-ip','TEST 상품 A','문구',10000,'ok',100,'bb140000-0000-4000-8000-000000000010','policy',0),
 ('transaction-check-b','transaction-check-ip','TEST 상품 B','문구',5000,'ok',100,'bb140000-0000-4000-8000-000000000010','individual',2000);
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','transaction-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where ip_id='transaction-check-ip';
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where ip_id='transaction-check-ip';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where ip_id='transaction-check-ip';
select id as variant_a from public.goods_variants where good_id='transaction-check-a' and is_default \gset
select id as variant_b from public.goods_variants where good_id='transaction-check-b' and is_default \gset

select set_config('request.jwt.claim.sub','bb140000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.admin_save_store_credit_policy(gen_random_uuid(),(public.admin_get_store_credit_policy()->>'version')::integer,
 '{"enabled":true,"earnKind":"fixed","earnValue":999,"earnMaxPerOrder":5000,"maxBalance":100000,"validityDays":30,"minUse":100,"maxUse":30000,"restoreGraceDays":3,"refundEarnedCreditMode":"offset_future_credits","evidence":"TEST ONLY grade snapshot"}');
select public.admin_adjust_store_credit(gen_random_uuid(),'bb140000-0000-4000-8000-000000000002',1000,now()+interval '1 day','TEST 지급',0);
reset role;
-- Policy write/session/replay are tested through the public RPC in customer_rewards.sql.
update private.customer_reward_policy set grade_enabled=true,grade_rates='{"welcome":100,"silver":200,"gold":300,"platinum":400}' where singleton;
update public.profiles set loyalty_grade='silver' where id='bb140000-0000-4000-8000-000000000002';
select 1/case when private.store_credit_policy_for_member('bb140000-0000-4000-8000-000000000002')->>'earnKind'='rate_bps'
 and private.store_credit_policy_for_member('bb140000-0000-4000-8000-000000000002')->>'earnValue'='200' then 1 else 0 end as assert_grade_final_rate_overrides_fixed;
select set_config('request.jwt.claim.sub','bb140000-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.set_cart_item_quantity('transaction-check-a',:'variant_a',1);
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as expected_cart from public.cart_items where user_id='bb140000-0000-4000-8000-000000000002' \gset
select '{"recipientName":"TEST 수취인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}' as address \gset
reset role;
set local role service_role;
select public.quote_cart_goods_transaction('bb140000-0000-4000-8000-000000000002',:'expected_cart',:'address','{}',null,1000) as quote \gset
reset role;
update public.profiles set loyalty_grade='gold' where id='bb140000-0000-4000-8000-000000000002';
set local role service_role;
select pg_temp.transaction_expect_error(format('select public.place_cart_goods_transaction(%L,%L,%L,%L,%L,%L)',
 'bb140000-0000-4000-8000-000000000002',:'expected_cart',:'address',(:'quote'::jsonb->>'quoteId'),'bb140000-0000-4000-8000-000000000031','card'),'transaction_quote_changed');
select public.quote_cart_goods_transaction('bb140000-0000-4000-8000-000000000002',:'expected_cart',:'address','{}',null,1000) as quote \gset
select public.place_cart_goods_transaction('bb140000-0000-4000-8000-000000000002',:'expected_cart',:'address',(:'quote'::jsonb->>'quoteId')::uuid,
 'bb140000-0000-4000-8000-000000000031','card') as order_id \gset
select public.place_cart_goods_transaction('bb140000-0000-4000-8000-000000000002',:'expected_cart',:'address',(:'quote'::jsonb->>'quoteId')::uuid,
 'bb140000-0000-4000-8000-000000000031','card') as replay_id \gset
reset role;
select 1/case when :'order_id'=:'replay_id' and (select store_credit_policy_snapshot->>'earnValue'='300' and store_credit_policy_snapshot#>>'{gradeReward,grade}'='gold'
 and shipping_fee=3000 and store_credit_total=1000 and total=12000 from public.orders where id=:'order_id') then 1 else 0 end as assert_exact_order_snapshot;
-- Changes after placing have no effect on the earned promise.
update public.profiles set loyalty_grade='platinum' where id='bb140000-0000-4000-8000-000000000002';
update private.customer_reward_policy set grade_enabled=false where singleton;
set local role service_role;
select public.prepare_goods_payment_attempt('bb140000-0000-4000-8000-000000000002',:'order_id','toss')->>'id' as attempt_id \gset
select public.bind_goods_payment_callback_nonce(:'attempt_id',repeat('e',64));
reset role;
select provider_order_id from public.payment_attempts where id=:'attempt_id' \gset
set local role service_role;
select public.claim_goods_payment_attempt('toss',:'provider_order_id',repeat('e',64),'bb140000-0000-4000-8000-000000000032');
select public.finalize_goods_payment_attempt(:'attempt_id','bb140000-0000-4000-8000-000000000032','approved',null,'TEST-GRADE-APPROVED');
reset role;
update private.purchase_confirmation_policy set auto_enabled=true,auto_after_days=8 where singleton;
update public.order_shipments set status='delivered',carrier='hanjin',tracking_number='TESTGRADE1234',shipped_at=now()-interval '10 days',delivered_at=now()-interval '9 days' where order_id=:'order_id';
update public.orders set status='delivered',delivered_at=now()-interval '9 days' where id=:'order_id';
set local role service_role;
select public.settle_delivered_orders();
select public.settle_delivered_orders();
reset role;
select 1/case when (select status='done' from public.orders where id=:'order_id')
 and (select count(*)=1 and sum(amount)=270 from public.store_credit_ledger where order_id=:'order_id' and kind='grant') then 1 else 0 end as assert_9000_goods_basis_times_three_percent_once;
rollback;
