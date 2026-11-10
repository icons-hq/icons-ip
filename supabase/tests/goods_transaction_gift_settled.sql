-- Continue the actual paid gift fixture after its private address correction.
reset role;
-- Explicit synthetic policy before the delivery freezes its confirmation terms.
update private.purchase_confirmation_policy set auto_enabled=true,auto_after_days=7,
 evidence='TEST ONLY: gift settled export regression' where singleton;
update public.order_shipments set status='delivered',carrier='hanjin',tracking_number='0000143055601',shipped_at=clock_timestamp()-interval '10 days',delivered_at=clock_timestamp()-interval '9 days' where order_id=:'order_id';
update public.orders set status='delivered',delivered_at=clock_timestamp()-interval '9 days' where id=:'order_id';
set local role service_role;
select public.settle_delivered_orders();
reset role;
select 1/case when private.collect_settled_export(null,null,'비공개 수취인')#>>'{orders,0,id}'=:'order_id'
 and private.collect_settled_export_for_date(null,null,'비공개 수취인','ordered')#>>'{orders,0,id}'=:'order_id'
 and private.collect_settled_export_for_search(null,null,'비공개 수취인','ordered','recipient')#>>'{orders,0,id}'=:'order_id'
 and private.collect_settled_export_for_search(null,null,'비공개 수취인','ordered','recipient')#>>'{orders,0,total}'='19200'
 and private.collect_settled_export_for_search(null,null,'비공개 수취인','ordered','recipient')#>>'{orders,0,volumeDiscount}'='2000'
 and private.collect_settled_export_for_search(null,null,'비공개 수취인','ordered','recipient')::text!~'(GIFT-PRIVATE|01000001234|54321)'
 then 1 else 0 end as assert_three_settled_routes_search_gift_operational_recipient_without_exporting_address;
set local role authenticated;
select set_config('request.jwt.claim.sub',('47c47700'||left(md5('gift-domain-good'),24))::uuid::text,true);
select public.admin_create_settled_export(pg_temp.gift_id(90),'{"query":"비공개 수취인","dateField":"ordered","field":"recipient"}')->>'id' as settled_receipt \gset
select 1/case when public.admin_read_settled_export(:'settled_receipt')#>>'{orders,0,id}'=:'order_id'
 and public.admin_read_settled_export(:'settled_receipt')#>>'{orders,0,volumeDiscount}'='2000'
 then 1 else 0 end as assert_download_entry_uses_same_gift_recipient_search;
rollback;
