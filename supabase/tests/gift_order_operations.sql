-- Run inside the financial gift fixture transaction after the private address revision assertion,
-- before its first physical delivery so confirmed_at is still NULL.
-- No provider calls: all mailbox states below are synthetic local database evidence.
reset role;
savepoint gift_operations;
select id as shipment_id from public.order_shipments where order_id=:'order_id' order by id limit 1 \gset
select pg_temp.gift_assert(private.operational_order_address(:'order_id')->>'address1'='GIFT-PRIVATE-ADDRESS-FOUR','operational address uses current private owner');
select pg_temp.gift_assert(not has_function_privilege('authenticated','private.operational_order_address(uuid)','execute'),'private address helper sealed');
set local role service_role;
select pg_temp.gift_assert(public.service_get_order_transaction_receipt(:'order_id')#>>'{display,totals,onlineTotal}'='19200','service original transaction receipt');
reset role;
set local role authenticated;select set_config('request.jwt.claim.sub',pg_temp.gift_id(3)::text,true);
do $$begin begin perform public.admin_get_order_transaction_receipts(array[pg_temp.gift_id(60)]);raise exception 'nonoperator receipt read';exception when insufficient_privilege then null;end;end$$;
select set_config('request.jwt.claim.sub',('47c47700'||left(md5('gift-domain-good'),24))::uuid::text,true);
select pg_temp.gift_assert((select address->>'address1'='GIFT-PRIVATE-ADDRESS-FOUR' from public.admin_search_orders_console(p_query=>'비공개 수취인',p_field=>'recipient') where id=:'order_id'),'admin recipient search returns private operational address');
select pg_temp.gift_assert(public.admin_get_order_transaction_receipts(array[:'order_id'::uuid])#>>'{0,receipt,display,totals,volumeDiscountTotal}'='2000','admin original transaction receipt');
reset role;
update public.orders set status='confirmed',confirmed_at=clock_timestamp()-interval '4 days',delivered_at=null where id=:'order_id';
update public.order_shipments set status='ready',shipped_at=null,delivered_at=null where order_id=:'order_id';
set local role authenticated;select set_config('request.jwt.claim.sub',('47c47700'||left(md5('gift-domain-good'),24))::uuid::text,true);
select public.admin_shipment_export(array[:'shipment_id'::uuid]) as gift_export \gset
select pg_temp.gift_assert(:'gift_export'::jsonb#>>'{shipments,0,isGift}'='true' and :'gift_export'::jsonb#>>'{shipments,0,shippingCollectFee}'='0','native export has gift and separate collect fee');
select pg_temp.gift_assert(:'gift_export'::jsonb#>>'{shipments,0,lines,0,address}' like '%GIFT-PRIVATE-ADDRESS-FOUR%','native export uses real recipient address');
select public.admin_prepare_order_delay_notice(pg_temp.gift_id(71),array[:'shipment_id'::uuid],'배송 지연 안내','상품 준비가 지연되었습니다.',(clock_timestamp() at time zone 'Asia/Seoul')::date+2) as delay_notice \gset
select pg_temp.gift_assert(jsonb_array_length(:'delay_notice'::jsonb->'targets')=2,'delay preview has two audience targets');
reset role;
select pg_temp.gift_assert((select count(distinct audience)=2 and count(distinct buyer_id)=2 from private.order_delay_notice_targets where notice_id=pg_temp.gift_id(71)),'independent target identities');
select pg_temp.gift_assert((select bool_and(private.order_delay_notice_target_current(id)) from private.order_delay_notice_targets where notice_id=pg_temp.gift_id(71)),'both audiences revalidate');
update private.order_delay_notice_delivery_control set enabled=true where singleton;
set local role authenticated;select set_config('request.jwt.claim.sub',('47c47700'||left(md5('gift-domain-good'),24))::uuid::text,true);
select public.admin_request_order_delay_notice(pg_temp.gift_id(71));
reset role;
select pg_temp.gift_assert((select count(*)=2 and bool_and(body not like '%GIFT-PRIVATE%') from public.notifications where source_type='order_delay_notice' and source_id in(select id::text from private.order_delay_notice_targets where notice_id=pg_temp.gift_id(71))),'two private-safe in-app delay notices');
select pg_temp.gift_assert((select link_path='/gifts' from public.notifications where user_id=pg_temp.gift_id(2) and source_type='order_delay_notice'),'recipient delay links to gift inbox');
set local role service_role;
select public.claim_order_delay_email_jobs(25) as delay_jobs \gset
select pg_temp.gift_assert((select count(*)=2 from jsonb_array_elements(:'delay_jobs'::jsonb)j where j->>'orderId'=:'order_id'),'two independent durable delay mail jobs');
reset role;
-- Shipping completion requires BOTH audience rows to be sent.
insert into public.email_deliveries(dedupe_key,template,recipient,subject,status)
values('order_shipped:'||:'order_id'||':'||:'shipment_id','order_shipped','payer@example.test','TEST','sent');
select pg_temp.gift_assert(private.shipment_email_delivery_state(:'order_id',:'shipment_id')='ready','payer sent is not complete');
insert into public.email_deliveries(dedupe_key,template,recipient,subject,status,last_error)
values('order_shipped:'||:'order_id'||':'||:'shipment_id'||':recipient','order_shipped','recipient@example.test','TEST','pending',null);
set local role service_role;
select public.complete_email_delivery('order_shipped:'||:'order_id'||':'||:'shipment_id'||':recipient','failed','provider_http_503');
reset role;
select pg_temp.gift_assert((select last_error='legacy_failure' and safe_error_code='provider_http_503' and recipient='redacted@invalid.local' from public.email_deliveries where dedupe_key='order_shipped:'||:'order_id'||':'||:'shipment_id'||':recipient'),'safe classification preserves legacy privacy redaction');
select pg_temp.gift_assert(private.shipment_email_delivery_state(:'order_id',:'shipment_id')='ready','known retryable recipient failure');
update public.email_deliveries set status='pending' where dedupe_key='order_shipped:'||:'order_id'||':'||:'shipment_id'||':recipient';
set local role service_role;
select public.complete_email_delivery('order_shipped:'||:'order_id'||':'||:'shipment_id'||':recipient','failed','provider_network_error');
reset role;
select pg_temp.gift_assert(private.shipment_email_delivery_state(:'order_id',:'shipment_id')='unknown','uncertain recipient acceptance requires review');
update public.email_deliveries set status='pending',claimed_at=clock_timestamp(),last_error=null where dedupe_key='order_shipped:'||:'order_id'||':'||:'shipment_id'||':recipient';
select pg_temp.gift_assert(private.shipment_email_delivery_state(:'order_id',:'shipment_id')='busy','active recipient claim is not complete');
update public.email_deliveries set status='sent' where dedupe_key='order_shipped:'||:'order_id'||':'||:'shipment_id'||':recipient';
select pg_temp.gift_assert(private.shipment_email_delivery_state(:'order_id',:'shipment_id')='sent','both sent is complete');
-- Admin resend parses the recipient audience and keeps the exact selected row as its audit target.
update public.orders set status='shipping' where id=:'order_id';
update public.order_shipments set status='shipping',shipped_at=clock_timestamp() where id=:'shipment_id';
update public.email_deliveries set status='failed',last_error='provider_http_503' where dedupe_key='order_shipped:'||:'order_id'||':'||:'shipment_id'||':recipient';
insert into public.email_deliveries(dedupe_key,template,recipient,subject,status,last_error)
values('order_confirmation:'||:'order_id'||':recipient','order_confirmation','recipient@example.test','TEST','failed','provider_http_503');
set local role authenticated;select set_config('request.jwt.claim.sub',('47c47700'||left(md5('gift-domain-good'),24))::uuid::text,true);
select pg_temp.gift_assert(public.admin_request_email_resend('order_shipped:'||:'order_id'||':'||:'shipment_id'||':recipient')='order_shipped','recipient shipment resend');
select pg_temp.gift_assert(public.admin_request_email_resend('order_confirmation:'||:'order_id'||':recipient')='order_confirmation','recipient confirmation resend');
reset role;
rollback to gift_operations;
