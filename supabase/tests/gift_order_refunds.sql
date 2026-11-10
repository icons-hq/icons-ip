-- Actual recipient return -> warehouse receipt -> original payer refund.
-- Synthetic provider evidence only; no external payment calls.
reset role;
savepoint gift_return_refund;
set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.gift_id(2)::text,true);
select public.request_my_gift_claim(pg_temp.gift_id(10),'return','defect',pg_temp.gift_id(501),pg_temp.gift_id(2)) as return_result \gset
select :'return_result'::jsonb#>>'{receipt,claimId}' as return_claim_id \gset
select set_config('request.jwt.claim.sub',('47c47700'||left(md5('gift-domain-good'),24))::uuid::text,true);
select pg_temp.gift_assert(public.admin_decide_order_claim(:'return_claim_id','approve',null)='collecting','recipient return approved for collection');
select public.admin_record_order_claim_origin_collection(:'return_claim_id',id,'TEST 선물 전체 수량 입고 확인') from public.order_shipments where order_id=:'order_id' order by id;
select pg_temp.gift_assert(public.admin_record_order_claim_refund(:'return_claim_id','pg_cancel','filed',null)='filed','recipient return enters original provider refund');
reset role;
select pg_temp.gift_assert((select requested_by=pg_temp.gift_id(1) from public.order_cancellation_claims where order_id=:'order_id'),'durable cancellation remains bound to original payer');
set local role service_role;
select public.complete_order_cancellation_request(:'return_claim_id',array['TEST-GIFT-APPROVED'],('47c47700'||left(md5('gift-domain-good'),24))::uuid);
select public.complete_order_cancellation_request(:'return_claim_id',array['TEST-GIFT-APPROVED'],('47c47700'||left(md5('gift-domain-good'),24))::uuid);
reset role;
select pg_temp.gift_assert((select status='canceled' from public.orders where id=:'order_id'),'gift return cancels order once');
select pg_temp.gift_assert((select count(*)=1 and bool_and(r.amount=19200 and r.status='done' and p.user_id=pg_temp.gift_id(1)) from public.refunds r join public.payments p on p.id=r.payment_id where p.ref_id=:'order_id'),'refund amount and owner belong only to payer');
select pg_temp.gift_assert((select stock_qty=100 from public.goods_variants where good_id='gift-domain-good' and is_default),'gift return restores allocated supply once');
select pg_temp.gift_assert((select status='active' and used_order_id is null and user_id=pg_temp.gift_id(1) from public.user_coupons where id=:'coupon_id'),'original coupon restored only to payer');
select pg_temp.gift_assert(not exists(select 1 from public.user_coupons where user_id=pg_temp.gift_id(2) and coupon_code='GIFT10P'),'recipient receives no refunded coupon');
select pg_temp.gift_assert((select actual_requester=pg_temp.gift_id(2) from private.gift_claim_parties where claim_id=:'return_claim_id'),'refund keeps original recipient requester evidence');
set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.gift_id(2)::text,true);
select pg_temp.gift_assert(public.get_my_gift(pg_temp.gift_id(10))#>'{order,total}'='null'::jsonb and public.get_my_gift_claim_context(pg_temp.gift_id(10))#>>'{claim,stage}'='completed','recipient sees completion without financial amount');
reset role;
rollback to gift_return_refund;

-- Independently create and pay an ordinary cart order, then repeat the same
-- withdrawal/re-request flow. A live collection must still block cancellation.
savepoint ordinary_return_refund;
update private.goods_transaction_runtime set enabled=true where singleton;
insert into public.cart_items(user_id,good_id,variant_id,qty)
 select pg_temp.gift_id(3),good_id,id,1 from public.goods_variants where good_id='gift-domain-good' and is_default;
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) as ordinary_cart
 from public.cart_items where user_id=pg_temp.gift_id(3) \gset
select '{"recipientName":"일반 주문 고객","phone":"01000007777","postalCode":"54321","address1":"TEST 일반 주문 주소"}' as ordinary_address \gset
set local role service_role;
select public.quote_cart_goods_transaction(pg_temp.gift_id(3),:'ordinary_cart',:'ordinary_address','{}',null,0) as ordinary_quote \gset
select pg_temp.gift_assert(:'ordinary_quote'::jsonb->>'state'='quoted','ordinary independent quote');
select public.place_cart_goods_transaction(pg_temp.gift_id(3),:'ordinary_cart',:'ordinary_address',(:'ordinary_quote'::jsonb->>'quoteId')::uuid,pg_temp.gift_id(601),'card') as ordinary_order \gset
select public.prepare_goods_payment_attempt(pg_temp.gift_id(3),:'ordinary_order','toss')->>'id' as ordinary_attempt \gset
select public.bind_goods_payment_callback_nonce(:'ordinary_attempt',repeat('e',64));
reset role;
select provider_order_id as ordinary_provider from public.payment_attempts where id=:'ordinary_attempt' \gset
select pg_temp.gift_assert(not exists(select 1 from private.gift_intents where order_id=:'ordinary_order'),'ordinary order has no gift binding');
set local role service_role;
select public.claim_goods_payment_attempt('toss',:'ordinary_provider',repeat('e',64),pg_temp.gift_id(602));
select pg_temp.gift_assert(public.finalize_goods_payment_attempt(:'ordinary_attempt',pg_temp.gift_id(602),'approved',null,'TEST-ORDINARY-APPROVED')='approved','ordinary real payment finalizer');
reset role;
update public.order_shipments set status='delivered',shipped_at=clock_timestamp()-interval '1 day',delivered_at=clock_timestamp()-interval '1 hour' where order_id=:'ordinary_order';
update public.orders set status='delivered',delivered_at=clock_timestamp()-interval '1 hour' where id=:'ordinary_order';
set local role service_role;
select pg_temp.gift_assert(public.request_order_claim(:'ordinary_order',pg_temp.gift_id(3),'return','TEST 최초 일반 반품','defect')='requested','ordinary first return requested');
reset role;
select id as ordinary_first_claim from public.order_cancellation_requests where order_id=:'ordinary_order' and stage='requested' \gset
set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.gift_id(3)::text,true);
select pg_temp.gift_assert(public.withdraw_my_order_claim(:'ordinary_first_claim',pg_temp.gift_id(603),0,'TEST 일반 고객 철회',true)->>'stage'='withdrawn','ordinary customer withdraws first return');
reset role;set local role service_role;
select pg_temp.gift_assert(public.request_order_claim(:'ordinary_order',pg_temp.gift_id(3),'return','TEST 재접수 일반 반품','defect')='requested','ordinary customer requests new return');
reset role;
select id as ordinary_second_claim from public.order_cancellation_requests where order_id=:'ordinary_order' and stage='requested' \gset
set local role authenticated;select set_config('request.jwt.claim.sub',('47c47700'||left(md5('gift-domain-good'),24))::uuid::text,true);
select pg_temp.gift_assert(public.admin_decide_order_claim(:'ordinary_second_claim','approve',null)='collecting','ordinary new return approved for collection');
reset role;
insert into gift_test_values values('ordinaryReturnOrder',to_jsonb(:'ordinary_order'::text));
do $$begin
 begin
  perform private.assert_order_collections_complete(((select value from gift_test_values where key='ordinaryReturnOrder')#>>'{}')::uuid);
  raise exception 'new active return bypassed collection';
 exception when check_violation then if sqlerrm<>'claim_collections_incomplete' then raise;end if;end;
end$$;
set local role authenticated;
select public.admin_record_order_claim_origin_collection(:'ordinary_second_claim',id,'TEST 일반 반품 전체 입고') from public.order_shipments where order_id=:'ordinary_order' order by id;
select pg_temp.gift_assert(public.admin_record_order_claim_refund(:'ordinary_second_claim','pg_cancel','filed',null)='filed','ordinary collected return enters refund');
reset role;set local role service_role;
select public.complete_order_cancellation_request(:'ordinary_second_claim',array['TEST-ORDINARY-APPROVED'],('47c47700'||left(md5('gift-domain-good'),24))::uuid);
select public.complete_order_cancellation_request(:'ordinary_second_claim',array['TEST-ORDINARY-APPROVED'],('47c47700'||left(md5('gift-domain-good'),24))::uuid);
reset role;
select pg_temp.gift_assert((select status='canceled' from public.orders where id=:'ordinary_order'),'ordinary return completes after past withdrawal');
select pg_temp.gift_assert((select stage='withdrawn' from public.order_cancellation_requests where id=:'ordinary_first_claim'),'past ordinary withdrawal remains terminal');
select pg_temp.gift_assert((select count(*)=1 and bool_and(r.amount=13000 and r.status='done' and p.user_id=pg_temp.gift_id(3)) from public.refunds r join public.payments p on p.id=r.payment_id where p.ref_id=:'ordinary_order'),'ordinary refund remains exact and idempotent');
select pg_temp.gift_assert((select stock_qty=98 from public.goods_variants where good_id='gift-domain-good' and is_default),'ordinary return restores only its allocated quantity');
rollback to ordinary_return_refund;
