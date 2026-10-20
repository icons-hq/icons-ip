-- This continuation uses the accepted fixture in gift_order_domain.sql before
-- its manual read-only order rows. The clone harness joins those exact sources.
update private.goods_transaction_runtime set enabled=true where singleton;
insert into public.cart_items(user_id,good_id,variant_id,qty) select pg_temp.gift_id(1),good_id,id,7 from public.goods_variants where good_id='gift-domain-good' and is_default;
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values(pg_temp.gift_id(30),'gift-domain-origin','선물 검증 출고지','hanjin',3000,'TEST 반품주소',true);
update public.goods set origin_id=pg_temp.gift_id(30),shipping_fee_type='policy',individual_fee=0 where id='gift-domain-good';
set local role authenticated;
select set_config('request.jwt.claim.sub',('47c47700'||left(md5('gift-domain-good'),24))::uuid::text,true);
select public.admin_save_good_transaction_terms('gift-domain-good',0,(select updated_at from public.goods where id='gift-domain-good'),
 '{"status":"active","terms":{"condition":"quantity","threshold":2,"discountKind":"fixed","discountValue":1000,"startsAt":null,"endsAt":null},"draftValues":{}}',
 '{"status":"active","paymentMode":"prepaid","quantityTerms":null,"draftValues":{}}',pg_temp.gift_id(31),('47c47700'||left(md5('gift-domain-good'),24))::uuid);
reset role;
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,status)
 values('GIFT10P','선물 10%','percent',10,0,now()-interval '1 day','active');
set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.gift_id(1)::text,true);
select public.apply_cart_coupon_code('GIFT10P') as coupon_id \gset
select public.quote_my_gift(pg_temp.gift_id(10),4,:'coupon_id',0,pg_temp.gift_id(1)) as quote \gset
select pg_temp.gift_assert(:'quote'::jsonb->>'state'='quoted','gift quote is payable');
select pg_temp.gift_assert(:'quote'::jsonb#>'{display,totals}'='{"subtotal":20000,"volumeDiscountTotal":2000,"netGoodsTotal":18000,"couponDiscountTotal":1800,"storeCreditTotal":0,"prepaidShippingTotal":3000,"collectShippingTotal":0,"onlineTotal":19200,"customerTotal":19200}'::jsonb,'gift independent net coupon shipping calculation');
select pg_temp.gift_assert(:'quote' not like '%GIFT-PRIVATE%' and :'quote' not like '%54321%' and :'quote' not like '%01000001234%','quote has no recipient PII');
-- Recipient address mutation makes the old quote unusable, even if amount is identical.
select set_config('request.jwt.claim.sub',pg_temp.gift_id(2)::text,true);
select public.update_my_gift_address(pg_temp.gift_id(10),'{"recipientName":"비공개 수취인","phone":"01000001234","postalCode":"54321","address1":"GIFT-PRIVATE-ADDRESS-THREE"}',4,pg_temp.gift_id(32),pg_temp.gift_id(2));
select set_config('request.jwt.claim.sub',pg_temp.gift_id(1)::text,true);
insert into gift_test_values values('staleQuote',:'quote'::jsonb);
do $$begin begin perform public.place_my_gift(pg_temp.gift_id(10),((select value from gift_test_values where key='staleQuote')->>'quoteId')::uuid,pg_temp.gift_id(33),'card',pg_temp.gift_id(1));
 raise exception 'stale address quote accepted';exception when sqlstate 'PT409' then null;end;end$$;
select public.quote_my_gift(pg_temp.gift_id(10),5,:'coupon_id',0,pg_temp.gift_id(1)) as quote \gset
select public.place_my_gift(pg_temp.gift_id(10),(:'quote'::jsonb->>'quoteId')::uuid,pg_temp.gift_id(34),'card',pg_temp.gift_id(1)) as order_id \gset
select pg_temp.gift_assert((select qty=7 from public.cart_items where user_id=pg_temp.gift_id(1) and good_id='gift-domain-good'),'gift never consumes or overwrites the ordinary cart');
select pg_temp.gift_assert((select user_coupon_id=:'coupon_id'::uuid from public.cart_coupon_selections where user_id=pg_temp.gift_id(1)),'gift never overwrites the cart coupon choice');
select public.get_my_gift_checkout_order(:'order_id') as payer_projection \gset
select pg_temp.gift_assert(:'payer_projection'::jsonb->>'kind'='gift' and :'payer_projection'::jsonb#>>'{order,total}'='19200' and :'payer_projection'::jsonb#>'{order,address}'='null'::jsonb,'strict payer checkout projection');
select pg_temp.gift_assert(:'payer_projection' not like '%GIFT-PRIVATE%' and :'payer_projection' not like '%54321%' and :'payer_projection' not like '%01000001234%','payer whole DTO has no PII');
select pg_temp.gift_assert((select count(*)=0 from public.orders where id=:'order_id'),'raw order closed');
select pg_temp.gift_assert((select count(*)=0 from public.order_items where order_id=:'order_id'),'raw items closed');
select pg_temp.gift_assert((select count(*)=0 from public.order_shipments where order_id=:'order_id'),'raw shipments closed');
select set_config('request.jwt.claim.sub',pg_temp.gift_id(2)::text,true);
select pg_temp.gift_assert(public.get_my_gift_checkout_order(:'order_id')='{"kind":"unavailable"}'::jsonb,'recipient cannot read payer checkout');
select pg_temp.gift_assert(public.get_my_gift(pg_temp.gift_id(10))#>>'{address,address1}'='GIFT-PRIVATE-ADDRESS-THREE','recipient current private snapshot');
reset role;
select pg_temp.gift_assert((select total=19200 and address is null and shipping_fee_breakdown::text not like '%54321%' from public.orders where id=:'order_id'),'public order and shipping snapshot private');
select pg_temp.gift_assert((select address->>'address1'='GIFT-PRIVATE-ADDRESS-THREE' from private.order_delivery_private_snapshots where order_id=:'order_id'),'delivery owner snapshot retained');
select pg_temp.gift_assert(private.goods_order_snapshot_matches(:'order_id',19200,3000),'legacy provider finalizer accepts gift snapshot');
set local role service_role;
select pg_temp.gift_assert(public.service_get_order_delivery_context(:'order_id')->>'recipientId'=pg_temp.gift_id(2)::text,'worker receives real gift recipient');
select public.prepare_goods_payment_attempt(pg_temp.gift_id(1),:'order_id','toss')->>'id' as attempt_id \gset
select public.bind_goods_payment_callback_nonce(:'attempt_id',repeat('d',64));
reset role;
select provider_order_id as provider_id from public.payment_attempts where id=:'attempt_id' \gset
set local role service_role;
select public.claim_goods_payment_attempt('toss',:'provider_id',repeat('d',64),pg_temp.gift_id(40));
select pg_temp.gift_assert(public.finalize_goods_payment_attempt(:'attempt_id',pg_temp.gift_id(40),'approved',null,'TEST-GIFT-APPROVED')='approved','real gift provider finalizer');
reset role;
set local role authenticated;select set_config('request.jwt.claim.sub',('47c47700'||left(md5('gift-domain-good'),24))::uuid::text,true);
select pg_temp.gift_assert(public.admin_get_order_delivery_snapshots(array[:'order_id'::uuid])#>>'{0,address,address1}'='GIFT-PRIVATE-ADDRESS-THREE','authorized admin delivery getter');
select pg_temp.gift_assert(public.admin_order_address_context(:'order_id')->>'isGift'='true','gift address context identifies recipient consent');
select public.admin_change_order_address(pg_temp.gift_id(41),:'order_id',0,'{"recipientName":"비공개 수취인","phone":"01000001234","postalCode":"54321","address1":"GIFT-PRIVATE-ADDRESS-FOUR"}','TEST 수신자 동의',true) as address_receipt \gset
select pg_temp.gift_assert(:'address_receipt'::jsonb->>'currentMatches'='true' and :'address_receipt'::jsonb#>>'{address,address1}'='GIFT-PRIVATE-ADDRESS-FOUR','admin gift address receipt current owner');
reset role;
select pg_temp.gift_assert((select address is null from public.orders where id=:'order_id'),'admin gift change never writes public address');
select pg_temp.gift_assert(private.order_delivery_snapshot(:'order_id')->>'addressRevision'='1','private address revision advanced');
delete from private.goods_transaction_quotes where id=(:'quote'::jsonb->>'quoteId')::uuid;
delete from private.gift_recipient_addresses where gift_id=pg_temp.gift_id(10);
update private.gift_runtime set enabled=false,privacy_ready=false;
update public.profiles set suspended_at=now(),suspension_reason='TEST gift recovery' where id in(pg_temp.gift_id(1),pg_temp.gift_id(2));
set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.gift_id(1)::text,true);
select pg_temp.gift_assert(public.replay_my_gift_order(pg_temp.gift_id(10),(:'quote'::jsonb->>'quoteId')::uuid,pg_temp.gift_id(34),'card',pg_temp.gift_id(1))=:'order_id'::uuid,'durable replay survives deleted quote/address and disabled runtime/account');
select pg_temp.gift_assert(public.place_my_gift(pg_temp.gift_id(10),(:'quote'::jsonb->>'quoteId')::uuid,pg_temp.gift_id(34),'card',pg_temp.gift_id(1))=:'order_id'::uuid,'place replay has same contract');
reset role;
-- Complete physical delivery, then exercise actual recipient claim authorization.
update public.order_shipments set status='delivered',shipped_at=clock_timestamp()-interval '1 day',delivered_at=clock_timestamp() where order_id=:'order_id';
update public.orders set status='delivered',delivered_at=clock_timestamp() where id=:'order_id';
set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.gift_id(2)::text,true);
select public.request_my_gift_claim(pg_temp.gift_id(10),'return','defect',pg_temp.gift_id(50),pg_temp.gift_id(2)) as claim_receipt \gset
select pg_temp.gift_assert(:'claim_receipt'::jsonb#>>'{context,claim,isRequester}'='true' and :'claim_receipt'::jsonb#>>'{context,claim,canWithdraw}'='true','recipient requests own return');
select pg_temp.gift_assert(:'claim_receipt'::jsonb#>>'{context,claim,refundAccountNeeded}'='false' and :'claim_receipt'::jsonb#>'{context,claim,maskedRefundAccount}'='null'::jsonb,'recipient receives no refund account fields');
select :'claim_receipt'::jsonb#>>'{receipt,claimId}' as claim_id \gset
select pg_temp.gift_assert(public.get_my_order_claim_withdrawal_context(:'claim_id')->'orderTotal'='null'::jsonb,'recipient withdrawal context excludes price');
select pg_temp.gift_assert((select count(*)=0 from public.order_cancellation_requests where id=:'claim_id'),'recipient raw claims closed');
select set_config('request.jwt.claim.sub',pg_temp.gift_id(1)::text,true);
select pg_temp.gift_assert(public.get_my_gift_claim_context(pg_temp.gift_id(10))#>>'{claim,isRequester}'='false','payer is not represented as actual requester');
insert into gift_test_values values('claimId',to_jsonb(:'claim_id'::text));
do $$begin begin perform public.withdraw_my_order_claim(((select value from gift_test_values where key='claimId')#>>'{}')::uuid,pg_temp.gift_id(51),0,'테스트 철회',true);raise exception 'payer withdrew recipient request';exception when no_data_found then null;end;end$$;
select pg_temp.gift_assert((select count(*)=0 from public.order_cancellation_requests where id=:'claim_id'),'sender raw claim PII closed');
reset role;
select pg_temp.gift_assert((select requested_by=pg_temp.gift_id(1) from public.order_cancellation_requests where id=:'claim_id'),'financial requested_by retains payer');
select pg_temp.gift_assert((select actual_requester=pg_temp.gift_id(2) from private.gift_claim_parties where claim_id=:'claim_id'),'actual requester separately retained');
select pg_temp.gift_assert(not exists(select 1 from public.notifications where source_id=:'claim_id' and(body like '%19200%' or body like '%GIFT-PRIVATE%' or link_path like '/orders/%')),'gift notifications exclude money/address/order-link');
select pg_temp.gift_assert((select count(distinct user_id)=2 from public.notifications where source_id=:'claim_id'),'both gift parties receive role-safe in-app notification');
select pg_temp.gift_assert(private.gift_account_deletion_blockers(pg_temp.gift_id(2))#>>'{0,code}'='active_received_gift','open received gift claim blocks deletion');
set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.gift_id(2)::text,true);
select public.withdraw_my_gift_claim(pg_temp.gift_id(10),:'claim_id',pg_temp.gift_id(52),0,pg_temp.gift_id(2)) as withdrawn \gset
select pg_temp.gift_assert(:'withdrawn'::jsonb#>>'{context,claim,stage}'='withdrawn','actual recipient withdraws');
select pg_temp.gift_assert(public.request_my_gift_claim(pg_temp.gift_id(10),'return','defect',pg_temp.gift_id(50),pg_temp.gift_id(2))#>>'{context,claim,stage}'='withdrawn','original claim receipt survives later state');
reset role;
select pg_temp.gift_assert(private.gift_account_deletion_blockers(pg_temp.gift_id(2))='[]'::jsonb,'delivered gift without open claim permits deletion');
update public.profiles set suspended_at=null,suspension_reason=null where id in(pg_temp.gift_id(1),pg_temp.gift_id(2));
-- A synthetic bank order isolates refund-account ownership from card provider evidence.
insert into public.orders(id,user_id,status,total,payment_method,address,delivered_at) values(pg_temp.gift_id(60),pg_temp.gift_id(1),'delivered',10000,'bank_transfer',null,clock_timestamp());
insert into private.gift_intents(id,sender_id,recipient_id,state,message,sender_label,recipient_label,expires_at,order_id,ordered_source_revision)
 values(pg_temp.gift_id(61),pg_temp.gift_id(1),pg_temp.gift_id(2),'ordered','테스트','선물검증1','선물검증2',now()+interval '1 day',pg_temp.gift_id(60),'TEST-BANK');
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,reason_type,claim_type,stage) values(pg_temp.gift_id(62),pg_temp.gift_id(60),pg_temp.gift_id(1),'상품 하자','defect','return','requested');
insert into private.gift_claim_parties values(pg_temp.gift_id(62),pg_temp.gift_id(61),pg_temp.gift_id(1),pg_temp.gift_id(2),pg_temp.gift_id(2));
set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.gift_id(2)::text,true);
do $$begin begin perform public.set_my_gift_claim_refund_account(pg_temp.gift_id(61),pg_temp.gift_id(62),pg_temp.gift_id(63),'TEST은행','123456789012','TEST예금주',pg_temp.gift_id(2));raise exception 'recipient supplied payer refund account';exception when no_data_found then null;end;end$$;
select set_config('request.jwt.claim.sub',pg_temp.gift_id(1)::text,true);
select pg_temp.gift_assert(public.get_my_gift_claim_context(pg_temp.gift_id(61))#>>'{claim,refundAccountNeeded}'='true','payer sees bank account confirmation need');
select public.set_my_gift_claim_refund_account(pg_temp.gift_id(61),pg_temp.gift_id(62),pg_temp.gift_id(64),'TEST은행','123456789012','TEST예금주',pg_temp.gift_id(1)) as bank_receipt \gset
select pg_temp.gift_assert(:'bank_receipt'::jsonb#>>'{context,claim,refundAccountNeeded}'='false' and :'bank_receipt' not like '%123456789012%' and :'bank_receipt' not like '%TEST예금주%','payer account returns masked-only');
select set_config('request.jwt.claim.sub',pg_temp.gift_id(2)::text,true);
select pg_temp.gift_assert(public.get_my_gift_claim_context(pg_temp.gift_id(61))#>'{claim,maskedRefundAccount}'='null'::jsonb,'recipient cannot read payer bank account');
reset role;
select pg_temp.gift_assert(not exists(select 1 from public.audit_log where action like 'gift.%' and diff::text like '%123456789012%'),'bank account never enters audit');
set local role authenticated;select set_config('request.jwt.claim.sub',('47c47700'||left(md5('gift-domain-good'),24))::uuid::text,true);
select pg_temp.gift_assert(public.admin_order_claim_detail(:'claim_id')#>>'{gift,requesterRole}'='recipient' and public.admin_order_claim_detail(:'claim_id')#>>'{gift,requesterName}'='선물검증2','admin sees actual recipient requester separately from financial buyer');
reset role;
select jsonb_build_object('giftFinancial',true,'payer',:'payer_projection'::jsonb,'quote',:'quote'::jsonb);
rollback;
