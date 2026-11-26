\set ON_ERROR_STOP on
begin;
create function pg_temp.check_result(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'admin payment test failed: %', label; end if;
end $$;
create function pg_temp.expect_unavailable(command text, expected text default 'catalog_item_unavailable') returns void language plpgsql as $$
begin
  begin execute command;
  exception when check_violation then
    if sqlerrm = expected then return; end if;
    raise;
  end;
  raise exception 'expected %', expected;
end $$;

select gen_random_uuid() as manager, gen_random_uuid() as member, gen_random_uuid() as staff, gen_random_uuid() as origin \gset
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'authenticated','authenticated',id::text||'@example.test',now(),'{}','{}',now(),now()
from unnest(array[:'manager',:'member',:'staff']::uuid[]) id;
update public.profiles set role = case id when :'manager' then 'admin'::public.user_role
  when :'staff' then 'staff'::public.user_role else 'user'::public.user_role end,
  nickname = 'TEST ' || left(id::text,8), onboarded_at = now(), birth_date = '1990-01-01', consents = '{"terms":true,"privacy":true}'
where id in (:'manager',:'member',:'staff');
insert into private.operator_memberships(profile_id,manager_role) values (:'manager','primary'),(:'staff','primary');
insert into public.ips(id,title,vertical_key,published_at) values ('payment-test-fixture','테스트','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
values (:'origin','payment-test-fixture','테스트','hanjin',3000,'테스트 주소',true);
insert into public.goods(id,ip_id,name,price,stock,stock_qty,origin_id,shipping_fee_type,allow_bank_transfer)
values ('admin-payment-test','payment-test-fixture','관리자 결제 테스트 상품',1000,'ok',100,:'origin','free',false),
       ('another-payment-draft','payment-test-fixture','다른 초안',1000,'ok',10,:'origin','free',false);
select id as variant from public.goods_variants where good_id = 'admin-payment-test' and is_default \gset
select jsonb_build_array(jsonb_build_object('good_id','admin-payment-test','variant_id',:'variant','qty',1)) as lines,
       jsonb_build_array(jsonb_build_object('goodId','admin-payment-test','variantId',:'variant','qty',1)) as items,
       '{"recipientName":"TEST 수취인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}' as address \gset

set local role anon;
select pg_temp.check_result(not exists(select 1 from public.goods where id='admin-payment-test')
  and not exists(select 1 from public.goods_variants where id=:'variant')
  and not exists(select 1 from public.resolve_public_goods_address('admin-payment-test')), 'anonymous reads');
reset role;
select set_config('request.jwt.claim.sub',:'member',true);
set local role authenticated;
select pg_temp.check_result(not public.can_use_admin_payment_test() and not exists(select 1 from public.goods where id='admin-payment-test')
  and not exists(select 1 from public.goods_variants where id=:'variant'), 'member reads');
reset role;
select set_config('request.jwt.claim.sub',:'staff',true);
set local role authenticated;
select pg_temp.check_result(not public.can_use_admin_payment_test() and not exists(select 1 from public.goods where id='admin-payment-test')
  and not exists(select 1 from public.goods_variants where id=:'variant')
  and not exists(select 1 from public.admin_search_goods('admin-payment-test') where id='admin-payment-test'), 'catalog operator reads');
reset role;
select pg_temp.expect_unavailable(format('select public.service_create_checkout_direct_draft(%L,%L,%L)',:'member','admin-payment-test',:'lines'));
select pg_temp.expect_unavailable(format('select public.service_create_checkout_direct_draft(%L,%L,%L)',:'staff','admin-payment-test',:'lines'));

select set_config('request.jwt.claim.sub',:'manager',true);
set local role authenticated;
select pg_temp.check_result(public.can_use_admin_payment_test() and exists(select 1 from public.goods where id='admin-payment-test')
  and exists(select 1 from public.goods_variants where id=:'variant'), 'admin reads');
select public.quote_goods_sales_for_address_with_coupon(:'items',jsonb_build_object('postalCode','12345','address1','TEST 합성 주소'),null) as quote \gset
select pg_temp.check_result((:'quote'::jsonb->>'subtotal')::int=1000,'checkout quote');
reset role;
select pg_temp.check_result(not private.goods_selection_base_available('another-payment-draft',:'manager'), 'ordinary draft remains closed');
select pg_temp.check_result((select goods_count=1 from public.ips where id='payment-test-fixture'), 'test good excluded from public IP count');
savepoint before_order;
set local role service_role;
select public.service_create_checkout_direct_draft(:'manager','admin-payment-test',:'lines') as draft \gset
select public.place_direct_order(:'manager',:'draft',:'address',gen_random_uuid(),'card',0,null) as purchase \gset
select public.prepare_goods_payment_attempt(:'manager',:'purchase','toss') as attempt \gset
reset role;
select pg_temp.check_result(exists(select 1 from public.payment_attempts where id=(:'attempt'::jsonb->>'id')::uuid and amount=1000 and state='prepared')
  and exists(select 1 from public.order_items where order_id=:'purchase' and good_id='admin-payment-test' and qty=1),'Toss order for one unit');
select pg_temp.check_result('admin_payment_test'=any(private.order_fulfillment_hold_reasons(:'purchase'))
  and exists(select 1 from private.order_fulfillment_held_orders() where order_id=:'purchase'), 'fulfillment held');
select pg_temp.expect_unavailable($move$update public.goods set id='renamed-test' where id='admin-payment-test'$move$, 'payment_test_slug_locked');
select pg_temp.expect_unavailable($move$update public.goods set id='admin-payment-test' where id='another-payment-draft'$move$, 'payment_test_slug_locked');
select pg_temp.check_result('admin_payment_test'=any(private.order_fulfillment_hold_reasons(:'purchase')), 'held after attempted rename');
update public.profiles set role='user' where id=:'manager';
select pg_temp.expect_unavailable(format('select public.prepare_goods_payment_attempt(%L,%L,%L)',:'manager',:'purchase','toss'));
rollback to before_order;
update private.goods_transaction_runtime set enabled=true where singleton;
set local role service_role;
select public.service_create_checkout_direct_draft(:'manager','admin-payment-test',:'lines') as tx_draft \gset
select public.quote_direct_goods_transaction(:'manager',:'tx_draft',:'address','{}',null,0) as tx_quote \gset
select public.place_direct_goods_transaction(:'manager',:'tx_draft',:'address',(:'tx_quote'::jsonb->>'quoteId')::uuid,gen_random_uuid(),'card') as tx_order \gset
select public.prepare_goods_payment_attempt(:'manager',:'tx_order','toss') as tx_attempt \gset
reset role;
select pg_temp.check_result(exists(select 1 from public.payment_attempts where id=(:'tx_attempt'::jsonb->>'id')::uuid and amount=1000), 'transaction checkout');
rollback;
