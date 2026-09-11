\set ON_ERROR_STOP on
-- Test-only amounts/time boundaries; all fixtures are rolled back.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('00000000-0000-4000-8000-000000004891','authenticated','authenticated','credits-check-admin@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000004892','authenticated','authenticated','credits-check-owner@example.test',now(),'{}','{}',now(),now());
update public.profiles set email='credits-check-'||right(id::text,4)||'@example.test',nickname='credits_checkout_'||right(id::text,4),birth_date='2000-01-01',consents='{"terms":true,"privacy":true}',onboarded_at=now(),role=case when id='00000000-0000-4000-8000-000000004891' then 'admin'::public.user_role else 'user'::public.user_role end
where id in ('00000000-0000-4000-8000-000000004891','00000000-0000-4000-8000-000000004892');
insert into public.ips(id,title,vertical_key,published_at) values('credits-check-ip','적립금 주문 검증','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
values('00000000-0000-4000-8000-000000004890','credits-check-origin','검증 출고지','hanjin',3000,'합성 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at,origin_id,shipping_fee_type)
values('credits-check-good','credits-check-ip','합성 적립금 굿즈','문구',10000,'ok',100,null,'00000000-0000-4000-8000-000000004890','policy');
-- Build reviewed synthetic KC evidence before publishing each fixture.
select pg_temp.publish_goods_kc_fixture('credits-check-good');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004891',true);
set local role authenticated;
select public.admin_save_store_credit_policy('10000000-0000-4000-8000-000000004891',(public.admin_get_store_credit_policy()->>'version')::integer,
 '{"enabled":true,"earnKind":"rate_bps","earnValue":1000,"earnMaxPerOrder":5000,"maxBalance":100000,"validityDays":30,"minUse":100,"maxUse":30000,"restoreGraceDays":3,"refundEarnedCreditMode":"offset_future_credits","evidence":"synthetic checkout test policy"}');
select public.admin_adjust_store_credit('20000000-0000-4000-8000-000000004891','00000000-0000-4000-8000-000000004892',30000,now()+interval '1 day','검증 지급',0);
reset role;
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,status)
values('CREDITSTEST2K','적립금 병용 검증','fixed',2000,0,now()-interval '1 day','active');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004892',true);
set local role authenticated;
insert into public.cart_items(user_id,good_id,variant_id,qty) select '00000000-0000-4000-8000-000000004892','credits-check-good',id,1 from public.goods_variants where good_id='credits-check-good' and is_default;
select public.apply_cart_coupon_code('CREDITSTEST2K');
select 1/case when (public.get_my_store_credit_checkout(4000)->>'maxUse')::bigint=8000
  and (public.get_my_store_credit_checkout(4000)->>'valid')::boolean
  and not (public.get_my_store_credit_checkout(9000)->>'valid')::boolean then 1 else 0 end as quote_excludes_shipping_after_coupon;
reset role;
set local role service_role;
select public.place_order_with_store_credits('00000000-0000-4000-8000-000000004892','{"recipientName":"검증","phone":"01012345678","postalCode":"12345","address1":"서울시 합성주소"}','30000000-0000-4000-8000-000000004891','card',4000) as order_id \gset
select public.place_order_with_store_credits('00000000-0000-4000-8000-000000004892','{"recipientName":"검증","phone":"01012345678","postalCode":"12345","address1":"서울시 합성주소"}','30000000-0000-4000-8000-000000004891','card',4000) as retry_order_id \gset
reset role;
select 1/case when :'order_id'=:'retry_order_id' and
  (select total=7000 and discount_total=2000 and store_credit_total=4000 and shipping_fee=3000 from public.orders where id=:'order_id')
  then 1 else 0 end as coupon_credit_and_shipping_snapshot;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004892',true);
set local role authenticated;
select 1/case when (public.get_my_store_credit_history()->>'available')::bigint=26000
  and (public.get_my_store_credit_history()->>'reserved')::bigint=4000 then 1 else 0 end as pending_reserves_once;
reset role;

-- Verified provider-neutral prepare -> claim -> approve, including repeated callback.
do $$ declare attempt public.payment_attempts; prepared jsonb; claim_id uuid:='40000000-0000-4000-8000-000000004891'; begin
  select * into attempt from public.payment_attempts where false;
  prepared:=public.prepare_goods_payment_attempt('00000000-0000-4000-8000-000000004892',(select id from public.orders where checkout_key='30000000-0000-4000-8000-000000004891'),'toss');
  select * into attempt from public.payment_attempts where ref_id=(select id from public.orders where checkout_key='30000000-0000-4000-8000-000000004891');
  perform public.bind_goods_payment_callback_nonce(attempt.id,repeat('c',64));
  perform public.claim_goods_payment_attempt('toss',attempt.provider_order_id,repeat('c',64),claim_id);
  if public.finalize_goods_payment_attempt(attempt.id,claim_id,'approved',null,'credits-check-provider-key')<>'approved' then raise exception 'payment must approve'; end if;
  perform public.finalize_goods_payment_attempt(attempt.id,claim_id,'approved');
end $$;
set local role authenticated;
select 1/case when (public.get_my_store_credit_history()->>'available')::bigint=26000
  and (public.get_my_store_credit_history()->>'reserved')::bigint=0
  and (select count(*) from public.store_credit_ledger where kind='consume')=1 then 1 else 0 end as verified_payment_consumes_once;
reset role;
set local role service_role;
select public.request_order_cancellation(:'order_id','00000000-0000-4000-8000-000000004892','검증 전액 취소','change_of_mind');
select public.complete_order_cancellation_request((select id from public.order_cancellation_requests where order_id=:'order_id'),array['credits-check-provider-key'],'00000000-0000-4000-8000-000000004891');
select public.complete_order_cancellation_request((select id from public.order_cancellation_requests where order_id=:'order_id'),array['credits-check-provider-key'],'00000000-0000-4000-8000-000000004891');
reset role;
set local role authenticated;
select 1/case when (public.get_my_store_credit_history()->>'available')::bigint=30000
  and (public.get_my_store_credit_history()->>'reserved')::bigint=0
  then 1 else 0 end as full_refund_restores_once;

-- Unpaid cancel and expiry-after-reserve preserve the captured grace days.
insert into public.cart_items(user_id,good_id,variant_id,qty) select '00000000-0000-4000-8000-000000004892','credits-check-good',id,1 from public.goods_variants where good_id='credits-check-good' and is_default;
reset role;
set local role service_role;
select public.place_order_with_store_credits('00000000-0000-4000-8000-000000004892','{"recipientName":"검증","phone":"01012345678","postalCode":"12345","address1":"서울시 합성주소"}','30000000-0000-4000-8000-000000004892','card',9000) as expiring_order_id \gset
reset role;
update private.store_credit_lots set expires_at=now()-interval '1 second' where user_id='00000000-0000-4000-8000-000000004892';
update private.store_credit_allocations set original_expires_at=now()-interval '1 second' where order_id=:'expiring_order_id';
set local role service_role;
select public.request_order_cancellation(:'expiring_order_id','00000000-0000-4000-8000-000000004892','미결제 취소','change_of_mind');
reset role;
set local role authenticated;
select 1/case when (public.get_my_store_credit_history()->>'available')::bigint=9000
  and (public.get_my_store_credit_history()->>'reserved')::bigint=0 then 1 else 0 end as expired_source_restores_only_reserved_amount;
reset role;
select 1/case when (select coalesce(sum(available_amount),0) from private.store_credit_lots where user_id='00000000-0000-4000-8000-000000004892' and expires_at>now()+interval '2 days')=9000 then 1 else 0 end as order_snapshot_grace_applies;

-- Current shipping fee does not fund credit redemption. A zero shipping fixture
-- then exercises the pre-existing 1,000 KRW minimum amount without altering it.
update public.fulfillment_origins set base_fee=0 where id='00000000-0000-4000-8000-000000004890';
set local role authenticated;
insert into public.cart_items(user_id,good_id,variant_id,qty) select '00000000-0000-4000-8000-000000004892','credits-check-good',id,1 from public.goods_variants where good_id='credits-check-good' and is_default;
reset role;
set local role service_role;
do $$ begin
  begin
    perform public.place_order_with_store_credits('00000000-0000-4000-8000-000000004892','{"recipientName":"검증","phone":"01012345678","postalCode":"12345","address1":"서울시 합성주소"}','30000000-0000-4000-8000-000000004893','card',9500);
    raise exception 'minimum paid amount must reject';
  exception when check_violation then if sqlerrm<>'store_credit_amount_invalid' then raise; end if; end;
end $$;
select public.place_order_with_store_credits('00000000-0000-4000-8000-000000004892','{"recipientName":"검증","phone":"01012345678","postalCode":"12345","address1":"서울시 합성주소"}','30000000-0000-4000-8000-000000004894','bank_transfer',8000) as bank_order_id \gset
reset role;
select 1/case when (select total=2000 from public.orders where id=:'bank_order_id')
  and (select amount=2000 from public.payment_attempts where ref_id=:'bank_order_id')
  and exists(select 1 from public.notifications where source_id=:'bank_order_id' and body like '%2,000원%') then 1 else 0 end as bank_attempt_and_notice_use_net_total;

-- Settlement grants against cash-paid goods, excluding shipping and spent credits.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004891',true);
set local role authenticated;
select public.admin_confirm_bank_transfer_deposit(:'bank_order_id','합성 입금 근거');
reset role;
-- Fixture represents completed delivery; the public settlement RPC owns 'done'.
update public.order_shipments set status='delivered',carrier='hanjin',tracking_number='SCTEST1234',shipped_at=now()-interval '10 days',delivered_at=now()-interval '9 days' where order_id=:'bank_order_id';
update public.orders set status='delivered',delivered_at=now()-interval '9 days' where id=:'bank_order_id';
set local role service_role;
select public.settle_delivered_orders();
select public.settle_delivered_orders();
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004892',true);
set local role authenticated;
select 1/case when (public.get_my_store_credit_history()->>'available')::bigint=1200
  and (select count(*) from public.store_credit_ledger where order_id=:'bank_order_id' and kind='grant')=1
  then 1 else 0 end as settlement_excludes_spent_credits_and_is_idempotent;
reset role;

-- Explicit zero grace is distinct from unconfigured and does not revive expiry.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004891',true);
set local role authenticated;
select public.admin_save_store_credit_policy('10000000-0000-4000-8000-000000004892',(public.admin_get_store_credit_policy()->>'version')::integer,
 '{"enabled":true,"earnKind":"rate_bps","earnValue":1000,"earnMaxPerOrder":5000,"maxBalance":100000,"validityDays":30,"minUse":100,"maxUse":30000,"restoreGraceDays":0,"refundEarnedCreditMode":"offset_future_credits","evidence":"synthetic zero grace test policy"}');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004892',true);
insert into public.cart_items(user_id,good_id,variant_id,qty) select '00000000-0000-4000-8000-000000004892','credits-check-good',id,1 from public.goods_variants where good_id='credits-check-good' and is_default;
reset role;
set local role service_role;
select public.place_order_with_store_credits('00000000-0000-4000-8000-000000004892','{"recipientName":"검증","phone":"01012345678","postalCode":"12345","address1":"서울시 합성주소"}','30000000-0000-4000-8000-000000004895','card',100) as zero_grace_order_id \gset
reset role;
update private.store_credit_lots set expires_at=now()-interval '1 second' where user_id='00000000-0000-4000-8000-000000004892';
update private.store_credit_allocations set original_expires_at=now()-interval '1 second' where order_id=:'zero_grace_order_id';
set local role service_role;
select public.request_order_cancellation(:'zero_grace_order_id','00000000-0000-4000-8000-000000004892','복원 만료 검증','change_of_mind');
reset role;
set local role authenticated;
select 1/case when (public.get_my_store_credit_history()->>'available')::bigint=0
  and (public.get_my_store_credit_history()->>'reserved')::bigint=0 then 1 else 0 end as explicit_zero_grace_keeps_restored_credits_expired;
reset role;
rollback;
