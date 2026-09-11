\set ON_ERROR_STOP on
begin;
-- Full lifecycle: earn after settlement -> use on a second purchase -> refund
-- the earning purchase -> future grant offset -> refund second purchase.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000004894','authenticated','authenticated','credit-earned-admin@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000004895','authenticated','authenticated','credit-earned-owner@example.test',now(),'{}','{}',now(),now());
update public.profiles set email='credit-earned-'||right(id::text,4)||'@example.test',nickname='credit_earned_'||right(id::text,4),birth_date='2000-01-01',consents='{"terms":true,"privacy":true}',onboarded_at=now(),role=case when id='00000000-0000-4000-8000-000000004894' then 'admin'::public.user_role else 'user'::public.user_role end
where id in ('00000000-0000-4000-8000-000000004894','00000000-0000-4000-8000-000000004895');
insert into public.ips(id,title,vertical_key,published_at) values('credit-earned-ip','원적립 환불 검증','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
values('00000000-0000-4000-8000-000000004894','credit-earned-origin','합성 출고지','hanjin',0,'합성 반품 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at,origin_id)
values('credit-earned-good','credit-earned-ip','합성 원적립 굿즈','문구',10000,'ok',100,null,'00000000-0000-4000-8000-000000004894');
-- Build reviewed synthetic KC evidence before publishing each fixture.
select pg_temp.publish_goods_kc_fixture('credit-earned-good');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004894',true);
set local role authenticated;
select public.admin_save_store_credit_policy('10000000-0000-4000-8000-000000004894',(public.admin_get_store_credit_policy()->>'version')::integer,
 '{"enabled":true,"earnKind":"rate_bps","earnValue":1000,"earnMaxPerOrder":5000,"maxBalance":100000,"validityDays":30,"minUse":100,"maxUse":30000,"restoreGraceDays":3,"refundEarnedCreditMode":"offset_future_credits","evidence":"synthetic earned refund policy"}');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004895',true);
insert into public.cart_items(user_id,good_id,variant_id,qty) select '00000000-0000-4000-8000-000000004895','credit-earned-good',id,1 from public.goods_variants where good_id='credit-earned-good' and is_default;
reset role;
set local role service_role;
select public.place_order_with_store_credits('00000000-0000-4000-8000-000000004895','{"recipientName":"원적립 검증","phone":"01012345678","postalCode":"12345","address1":"합성 주소"}','20000000-0000-4000-8000-000000004894','card',0) as source_order_id \gset
reset role;
do $$ declare attempt public.payment_attempts; begin
  perform public.prepare_goods_payment_attempt('00000000-0000-4000-8000-000000004895',(select id from public.orders where checkout_key='20000000-0000-4000-8000-000000004894'),'toss');
  select * into attempt from public.payment_attempts where ref_id=(select id from public.orders where checkout_key='20000000-0000-4000-8000-000000004894');
  perform public.bind_goods_payment_callback_nonce(attempt.id,repeat('d',64));
  perform public.claim_goods_payment_attempt('toss',attempt.provider_order_id,repeat('d',64),'30000000-0000-4000-8000-000000004894');
  perform public.finalize_goods_payment_attempt(attempt.id,'30000000-0000-4000-8000-000000004894','approved',null,'credit-earned-source-key');
end $$;
update public.order_shipments set status='delivered',carrier='hanjin',tracking_number='CREDITEARNED1',shipped_at=now()-interval '10 days',delivered_at=now()-interval '9 days' where order_id=:'source_order_id';
update public.orders set status='delivered',delivered_at=now()-interval '9 days' where id=:'source_order_id';
set local role service_role;
select public.settle_delivered_orders();
reset role;
set local role authenticated;
select 1/case when (public.get_my_store_credit_history()->>'available')::bigint=1000 then 1 else 0 end as settled_goods_earn_real_credit;
insert into public.cart_items(user_id,good_id,variant_id,qty) select '00000000-0000-4000-8000-000000004895','credit-earned-good',id,1 from public.goods_variants where good_id='credit-earned-good' and is_default;
reset role;
set local role service_role;
select public.place_order_with_store_credits('00000000-0000-4000-8000-000000004895','{"recipientName":"사용 검증","phone":"01012345678","postalCode":"12345","address1":"합성 주소"}','20000000-0000-4000-8000-000000004895','card',600) as spending_order_id \gset
reset role;
do $$ declare attempt public.payment_attempts; begin
  perform public.prepare_goods_payment_attempt('00000000-0000-4000-8000-000000004895',(select id from public.orders where checkout_key='20000000-0000-4000-8000-000000004895'),'toss');
  select * into attempt from public.payment_attempts where ref_id=(select id from public.orders where checkout_key='20000000-0000-4000-8000-000000004895');
  perform public.bind_goods_payment_callback_nonce(attempt.id,repeat('e',64));
  perform public.claim_goods_payment_attempt('toss',attempt.provider_order_id,repeat('e',64),'30000000-0000-4000-8000-000000004895');
  perform public.finalize_goods_payment_attempt(attempt.id,'30000000-0000-4000-8000-000000004895','approved',null,'credit-earned-spending-key');
end $$;
set local role service_role;
select public.request_order_claim(:'source_order_id','00000000-0000-4000-8000-000000004895','return','원적립 주문 하자 환불','defect');
reset role;
select id as source_claim_id from public.order_cancellation_requests where order_id=:'source_order_id' \gset
select id as source_shipment_id from public.order_shipments where order_id=:'source_order_id' \gset
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004894',true);
set local role authenticated;
select public.admin_decide_order_claim(:'source_claim_id','approve',null);
select public.admin_record_order_claim_origin_collection(:'source_claim_id',:'source_shipment_id','실물 회수 합성 근거');
select public.admin_record_order_claim_refund(:'source_claim_id','pg_cancel','filed',null);
reset role;
set local role service_role;
select public.complete_order_cancellation_request(:'source_claim_id',array['credit-earned-source-key'],'00000000-0000-4000-8000-000000004894');
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004895',true);
set local role authenticated;
select 1/case when (public.get_my_store_credit_history()->>'available')::bigint=0
  and (public.get_my_store_credit_history()->>'reserved')::bigint=0
  and (public.get_my_store_credit_history()->>'debt')::bigint=600 then 1 else 0 end as used_earned_credit_is_preserved_as_future_offset;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004894',true);
select public.admin_adjust_store_credit('40000000-0000-4000-8000-000000004894','00000000-0000-4000-8000-000000004895',200,now()+interval '2 days','후속 지급 합성 근거',0);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004895',true);
select 1/case when (public.get_my_store_credit_history()->>'available')::bigint=0
  and (public.get_my_store_credit_history()->>'debt')::bigint=400 then 1 else 0 end as future_grant_offsets_only_recorded_debt;
reset role;
set local role service_role;
select public.request_order_cancellation(:'spending_order_id','00000000-0000-4000-8000-000000004895','두번째 주문 전액 취소','change_of_mind');
select public.complete_order_cancellation_request((select id from public.order_cancellation_requests where order_id=:'spending_order_id'),array['credit-earned-spending-key'],'00000000-0000-4000-8000-000000004894');
select public.complete_order_cancellation_request((select id from public.order_cancellation_requests where order_id=:'spending_order_id'),array['credit-earned-spending-key'],'00000000-0000-4000-8000-000000004894');
reset role;
set local role authenticated;
select 1/case when (public.get_my_store_credit_history()->>'available')::bigint=200
  and (public.get_my_store_credit_history()->>'reserved')::bigint=0
  and (public.get_my_store_credit_history()->>'debt')::bigint=0 then 1 else 0 end as spent_credit_refund_restores_repaid_part_once;
reset role;
select 1/case when (select amount from public.refunds where payment_id=(select payment_id from public.payment_attempts where ref_id=:'source_order_id'))=10000
  and (select amount from public.refunds where payment_id=(select payment_id from public.payment_attempts where ref_id=:'spending_order_id'))=9400
  then 1 else 0 end as provider_refunds_are_never_reduced_for_credit_debt;
rollback;
