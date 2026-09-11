\set ON_ERROR_STOP on
begin;

insert into auth.users (id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('00000000-0000-4000-8000-000000004101','authenticated','authenticated','ip-purchase@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000004102','authenticated','authenticated','ip-publisher@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='ip_purchase',birth_date='2000-01-01',
 consents='{"terms":true,"privacy":true}',onboarded_at=now()
where id='00000000-0000-4000-8000-000000004101';
update public.profiles set role='admin' where id='00000000-0000-4000-8000-000000004102';
insert into public.verticals(key,label,color) values ('ip-purchase-guard','게시 구매 경계','#000000');
insert into public.ips(id,title,vertical_key,published_at)
values ('ip-purchase-guard','게시 구매 경계','ip-purchase-guard',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at)
values ('ip-purchase-guard','ip-purchase-guard','게시 상품','문구',12000,'ok',10,null);
-- Build reviewed synthetic KC evidence before publishing each fixture.
select pg_temp.publish_goods_kc_fixture('ip-purchase-guard');
insert into public.events(id,title,mode,status,ip_id)
values ('ip-purchase-guard','게시 이벤트','오프라인','예매중','ip-purchase-guard'),
 ('ip-purchase-platform','플랫폼 이벤트','오프라인','예매중',null);
insert into public.ticket_types(id,event_id,name,price,capacity,sold,per_user_limit)
values ('10000000-0000-4000-8000-000000004101','ip-purchase-guard','게시 회차',12000,10,0,10),
 ('10000000-0000-4000-8000-000000004102','ip-purchase-platform','플랫폼 회차',12000,10,0,10);
insert into public.cart_items(user_id,good_id,qty, variant_id)
values ('00000000-0000-4000-8000-000000004101','ip-purchase-guard',1, (select id from public.goods_variants where good_id='ip-purchase-guard' and is_default));

-- Both pages were opened while public; unpublishing must reject their stale submissions.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004102',true);
select public.admin_set_ip_published('ip-purchase-guard',false);
set local role service_role;
do $$
declare
  goods_blocked boolean := false;
  tickets_blocked boolean := false;
begin
  begin
    perform public.place_order('00000000-0000-4000-8000-000000004101',
      '{"recipientName":"구매자","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
      '20000000-0000-4000-8000-000000004101','card');
  exception when check_violation then
    if sqlerrm <> 'catalog_item_unavailable' then raise; end if;
    goods_blocked := true;
  end;
  begin
    perform public.reserve_tickets('00000000-0000-4000-8000-000000004101',
      '10000000-0000-4000-8000-000000004101',1,'30000000-0000-4000-8000-000000004101');
  exception when check_violation then
    if sqlerrm <> 'catalog_item_unavailable' then raise; end if;
    tickets_blocked := true;
  end;
  if not goods_blocked or not tickets_blocked then
    raise exception 'draft purchase boundary missing: goods blocked=%, tickets blocked=%',goods_blocked,tickets_blocked;
  end if;
  begin
    perform public.place_order('00000000-0000-4000-8000-000000004101',
      '{"recipientName":"구매자","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
      '20000000-0000-4000-8000-000000004102','bank_transfer');
    raise exception 'draft IP bank transfer order was accepted';
  exception when check_violation then
    if sqlerrm <> 'catalog_item_unavailable' then raise; end if;
  end;
end;
$$;
reset role;
select 1 / case when
 (select stock_qty=10 from public.goods where id='ip-purchase-guard')
 and (select sold=0 from public.ticket_types where id='10000000-0000-4000-8000-000000004101')
 and not exists(select 1 from public.orders where user_id='00000000-0000-4000-8000-000000004101')
 and not exists(select 1 from public.ticket_orders where user_id='00000000-0000-4000-8000-000000004101')
 and (select qty=1 from public.cart_items where user_id='00000000-0000-4000-8000-000000004101')
 then 1 else 0 end as assert_rejected_purchase_has_no_side_effects;

select public.admin_set_ip_published('ip-purchase-guard',true);
set local role service_role;
select public.place_order('00000000-0000-4000-8000-000000004101',
 '{"recipientName":"구매자","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
 '20000000-0000-4000-8000-000000004103','card') as goods_order \gset
select public.reserve_tickets('00000000-0000-4000-8000-000000004101',
 '10000000-0000-4000-8000-000000004101',1,'30000000-0000-4000-8000-000000004103') as ticket_order \gset
select public.reserve_tickets('00000000-0000-4000-8000-000000004101',
 '10000000-0000-4000-8000-000000004102',1,'30000000-0000-4000-8000-000000004104') as platform_order \gset
select public.prepare_goods_payment_attempt('00000000-0000-4000-8000-000000004101',:'goods_order','toss') as goods_attempt \gset
select public.prepare_ticket_payment_attempt('00000000-0000-4000-8000-000000004101',:'ticket_order','toss') as ticket_attempt \gset
reset role;
select public.admin_set_ip_published('ip-purchase-guard',false);

-- Existing order/reservation retries are reads, not new purchases. Payment preparation
-- reuses the frozen attempt even after the catalog is unpublished.
set local role service_role;
select 1 / case when public.place_order('00000000-0000-4000-8000-000000004101',
 '{"recipientName":"구매자","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
 '20000000-0000-4000-8000-000000004103','card')=:'goods_order'::uuid then 1 else 0 end as assert_existing_goods_retry;
select 1 / case when public.reserve_tickets('00000000-0000-4000-8000-000000004101',
 '10000000-0000-4000-8000-000000004101',1,'30000000-0000-4000-8000-000000004103')=:'ticket_order'::uuid
 then 1 else 0 end as assert_existing_ticket_retry;
select 1 / case when public.prepare_goods_payment_attempt('00000000-0000-4000-8000-000000004101',:'goods_order','toss')=:'goods_attempt'::jsonb
 then 1 else 0 end as assert_existing_goods_attempt_drain;
select 1 / case when public.prepare_ticket_payment_attempt('00000000-0000-4000-8000-000000004101',:'ticket_order','toss')=:'ticket_attempt'::jsonb
 then 1 else 0 end as assert_existing_ticket_attempt_drain;
reset role;
select 1 / case when
 (select stock_qty=9 from public.goods where id='ip-purchase-guard')
 and (select sold=1 from public.ticket_types where id='10000000-0000-4000-8000-000000004101')
 and (select good_ip_id_snapshot='ip-purchase-guard' and unit_price=12000 from public.order_items where order_id=:'goods_order')
 then 1 else 0 end as assert_retries_keep_frozen_inventory_and_order_history;

select 1 / case when not has_function_privilege('anon','private.assert_ip_purchasable(text)','execute')
 and not has_function_privilege('authenticated','private.assert_ip_purchasable(text)','execute')
 and not has_function_privilege('service_role','private.assert_ip_purchasable(text)','execute')
 then 1 else 0 end as assert_guard_is_private;
rollback;
