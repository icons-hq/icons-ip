\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000501',
    'authenticated', 'authenticated', 'checkout-one@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000502',
    'authenticated', 'authenticated', 'checkout-two@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000503',
    'authenticated', 'authenticated', 'checkout-stock@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000504',
    'authenticated', 'authenticated', 'checkout-incomplete@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000505',
    'authenticated', 'authenticated', 'checkout-auth-email@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at)
values
  (
    '00000000-0000-4000-8000-000000000501',
    'checkout-one@example.test', 'checkout_one', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now()
  ),
  (
    '00000000-0000-4000-8000-000000000502',
    'checkout-two@example.test', 'checkout_two', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now()
  ),
  (
    '00000000-0000-4000-8000-000000000503',
    'checkout-stock@example.test', 'checkout_stock', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now()
  ),
  (
    '00000000-0000-4000-8000-000000000504',
    'checkout-incomplete@example.test', 'checkout_incomplete', null,
    '{"terms":true,"privacy":true}'::jsonb, null
  ),
  (
    '00000000-0000-4000-8000-000000000505',
    null, 'checkout_auth_email', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now()
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at;

select 1 / case when not has_function_privilege('anon', 'public.place_order(jsonb)', 'execute') then 1 else 0 end
  as assert_anon_cannot_use_legacy_place_order;
select 1 / case when not has_function_privilege('authenticated', 'public.place_order(jsonb)', 'execute') then 1 else 0 end
  as assert_authenticated_cannot_use_legacy_place_order;
select 1 / case when not has_function_privilege('service_role', 'public.place_order(jsonb)', 'execute') then 1 else 0 end
  as assert_service_role_cannot_use_legacy_place_order;

select 1 / case when not has_function_privilege('anon', 'public.place_order(jsonb,uuid)', 'execute') then 1 else 0 end
  as assert_anon_cannot_use_browser_place_order;
select 1 / case when not has_function_privilege('authenticated', 'public.place_order(jsonb,uuid)', 'execute') then 1 else 0 end
  as assert_authenticated_cannot_use_browser_place_order;
select 1 / case when not has_function_privilege('service_role', 'public.place_order(jsonb,uuid)', 'execute') then 1 else 0 end
  as assert_service_role_cannot_use_browser_place_order;
select 1 / case when not has_function_privilege('anon', 'public.place_order(uuid,jsonb,uuid)', 'execute') then 1 else 0 end
  as assert_anon_cannot_place_order;
select 1 / case when not has_function_privilege('authenticated', 'public.place_order(uuid,jsonb,uuid)', 'execute') then 1 else 0 end
  as assert_authenticated_cannot_place_order;
select 1 / case when has_function_privilege('service_role', 'public.place_order(uuid,jsonb,uuid)', 'execute') then 1 else 0 end
  as assert_service_role_can_place_order;
select 1 / case when not has_function_privilege('authenticated', 'public.cancel_order(uuid,text)', 'execute') then 1 else 0 end
  as assert_authenticated_cannot_cancel_without_provider;
select 1 / case when has_function_privilege('service_role', 'public.cancel_order(uuid,text)', 'execute') then 1 else 0 end
  as assert_service_role_can_close_canceled_order;
select 1 / case when not has_function_privilege('authenticated', 'public.refund_ticket_order(uuid,text)', 'execute') then 1 else 0 end
  as assert_authenticated_cannot_refund_ticket_without_provider;
select 1 / case when has_function_privilege('service_role', 'public.refund_ticket_order(uuid,text)', 'execute') then 1 else 0 end
  as assert_service_role_can_close_canceled_ticket;

set local role service_role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000501', true);

do $$
begin
  begin
    perform public.place_order(
      '00000000-0000-4000-8000-000000000504',
      '{"recipientName":"미완료","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
      '10000000-0000-4000-8000-000000000504'
    );
    raise exception 'incomplete onboarding should be rejected';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'onboarding required' then raise; end if;
  end;
end;
$$;

select 1 / case when current_setting('request.jwt.claim.sub', true)
  = '00000000-0000-4000-8000-000000000501' then 1 else 0 end
  as assert_subject_restored_after_failed_service_order;

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000505', true);
do $$
begin
  begin
    perform public.place_order(
      '00000000-0000-4000-8000-000000000505',
      '{"recipientName":"인증메일","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
      '10000000-0000-4000-8000-000000000505'
    );
    raise exception 'empty cart should be rejected after auth email fallback passes onboarding';
  exception
    when check_violation then
      if sqlerrm <> 'cart empty' then raise; end if;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000505', true);

-- The database accepts only the normalized fulfillment snapshot contract.
do $$
declare
  invalid_address jsonb;
begin
  for invalid_address in
    select value
    from jsonb_array_elements(jsonb_build_array(
      '{}'::jsonb,
      '{"recipientName":"홍길동","phone":"01012345678","postalCode":"12345"}'::jsonb,
      '{"recipientName":"홍길동","phone":"01012345678","postalCode":"12345","address1":"서울시","unknown":"x"}'::jsonb,
      '{"recipientName":1,"phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
      '{"recipientName":"","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
      jsonb_build_object('recipientName', repeat('가', 51), 'phone', '01012345678', 'postalCode', '12345', 'address1', '서울시'),
      '{"recipientName":"홍길동","phone":"010-1234-5678","postalCode":"12345","address1":"서울시"}'::jsonb,
      '{"recipientName":"홍길동","phone":"1234567","postalCode":"12345","address1":"서울시"}'::jsonb,
      '{"recipientName":"홍길동","phone":"01012345678","postalCode":"1234","address1":"서울시"}'::jsonb,
      '{"recipientName":"홍길동","phone":"01012345678","postalCode":"12345","address1":" 서울시"}'::jsonb,
      '{"recipientName":"홍길동","phone":"01012345678","postalCode":"12345","address1":"서울시","address2":1}'::jsonb,
      jsonb_build_object('recipientName', '홍길동', 'phone', '01012345678', 'postalCode', '12345', 'address1', '서울시', 'address2', repeat('가', 201)),
      jsonb_build_object('recipientName', '홍길동', 'phone', '01012345678', 'postalCode', '12345', 'address1', '서울시', 'deliveryNote', repeat('가', 201))
    ))
  loop
    begin
      perform public.place_order(
        '00000000-0000-4000-8000-000000000501',
        invalid_address,
        '10000000-0000-4000-8000-000000000501'
      );
      raise exception 'invalid address should be rejected: %', invalid_address;
    exception
      when check_violation then null;
    end;
  end loop;
end;
$$;

do $$
begin
  begin
    perform public.place_order(
      '00000000-0000-4000-8000-000000000501',
      '{"recipientName":"홍길동","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
      null
    );
    raise exception 'null checkout key should be rejected';
  exception
    when not_null_violation then null;
  end;
end;
$$;

insert into public.cart_items (user_id, good_id, qty)
values
  ('00000000-0000-4000-8000-000000000501', 'g1', 2),
  ('00000000-0000-4000-8000-000000000501', 'g2', 1);

select stock_qty as g1_stock_before from public.goods where id = 'g1' \gset
select stock_qty as g2_stock_before from public.goods where id = 'g2' \gset

set local role service_role;
select public.place_order(
  '00000000-0000-4000-8000-000000000501',
  '{"recipientName":"홍길동","phone":"01012345678","postalCode":"12345","address1":"서울시 성동구","address2":"101호","deliveryNote":"문 앞"}'::jsonb,
  '10000000-0000-4000-8000-000000000501'
) as first_order_id \gset

select 1 / case when current_setting('request.jwt.claim.sub', true)
  = '00000000-0000-4000-8000-000000000505' then 1 else 0 end
  as assert_subject_restored_after_successful_service_order;
reset role;

select 1 / case when (
  select status = 'pending'
    and total = 99000
    and checkout_key = '10000000-0000-4000-8000-000000000501'
    and address = '{"recipientName":"홍길동","phone":"01012345678","postalCode":"12345","address1":"서울시 성동구","address2":"101호","deliveryNote":"문 앞"}'::jsonb
    and expires_at between now() + interval '14 minutes' and now() + interval '16 minutes'
  from public.orders
  where id = :'first_order_id'::uuid
) then 1 else 0 end as assert_pending_order_uses_db_total_address_and_expiry;

select 1 / case when (
  select jsonb_object_agg(good_id, jsonb_build_object('qty', qty, 'unitPrice', unit_price) order by good_id)
  from public.order_items
  where order_id = :'first_order_id'::uuid
) = '{"g1":{"qty":2,"unitPrice":42000},"g2":{"qty":1,"unitPrice":15000}}'::jsonb
then 1 else 0 end as assert_order_items_snapshot_db_prices;

select 1 / case when (
  select stock_qty from public.goods where id = 'g1'
) = :'g1_stock_before'::integer - 2 then 1 else 0 end as assert_g1_stock_reserved;
select 1 / case when (
  select stock_qty from public.goods where id = 'g2'
) = :'g2_stock_before'::integer - 1 then 1 else 0 end as assert_g2_stock_reserved;
select 1 / case when not exists (
  select 1 from public.cart_items
  where user_id = '00000000-0000-4000-8000-000000000501'
) then 1 else 0 end as assert_cart_cleared;

-- A lost-response retry is idempotent and does not reserve inventory twice.
select public.place_order(
  '00000000-0000-4000-8000-000000000501',
  '{"recipientName":"홍길동","phone":"01012345678","postalCode":"12345","address1":"서울시 성동구","address2":"101호","deliveryNote":"문 앞"}'::jsonb,
  '10000000-0000-4000-8000-000000000501'
) as retry_order_id \gset

select 1 / case when :'retry_order_id'::uuid = :'first_order_id'::uuid then 1 else 0 end
  as assert_same_key_returns_same_order;
select 1 / case when (
  select count(*) from public.orders
  where user_id = '00000000-0000-4000-8000-000000000501'
    and checkout_key = '10000000-0000-4000-8000-000000000501'
) = 1 then 1 else 0 end as assert_same_key_creates_one_order;
select 1 / case when (
  select stock_qty from public.goods where id = 'g1'
) = :'g1_stock_before'::integer - 2 then 1 else 0 end as assert_retry_does_not_reserve_again;

do $$
begin
  begin
    perform public.place_order(
      '00000000-0000-4000-8000-000000000501',
      '{"recipientName":"홍길동","phone":"01012345678","postalCode":"12345","address1":"서울시 성동구","address2":"101호","deliveryNote":"경비실"}'::jsonb,
      '10000000-0000-4000-8000-000000000501'
    );
    raise exception 'same checkout key with different address should be rejected';
  exception
    when unique_violation then
      if sqlerrm <> 'checkout key conflict' then raise; end if;
  end;
end;
$$;

-- Once one distinct key consumes the serialized cart, the next key sees empty.
do $$
begin
  begin
    perform public.place_order(
      '00000000-0000-4000-8000-000000000501',
      '{"recipientName":"홍길동","phone":"01012345678","postalCode":"12345","address1":"서울시 성동구"}'::jsonb,
      '10000000-0000-4000-8000-000000000599'
    );
    raise exception 'a distinct key should not reuse an empty cart';
  exception
    when check_violation then
      if sqlerrm <> 'cart empty' then raise; end if;
  end;
end;
$$;

-- Idempotency is scoped per user, not globally.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000502', true);
insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000502', 'g3', 1);

select public.place_order(
  '00000000-0000-4000-8000-000000000502',
  '{"recipientName":"김아이콘","phone":"0212345678","postalCode":"54321","address1":"서울시 마포구"}'::jsonb,
  '10000000-0000-4000-8000-000000000501'
) as second_user_order_id \gset

select 1 / case when :'second_user_order_id'::uuid <> :'first_order_id'::uuid then 1 else 0 end
  as assert_different_user_can_reuse_checkout_key;

-- An out-of-stock failure rolls back the order and preserves the cart/inventory.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000503', true);
reset role;
update public.goods set stock = 'soldout', stock_qty = 0 where id = 'g6';
reset role;
insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000503', 'g6', 1);

do $$
begin
  begin
    perform public.place_order(
      '00000000-0000-4000-8000-000000000503',
      '{"recipientName":"재고검증","phone":"01098765432","postalCode":"11111","address1":"부산시"}'::jsonb,
      '10000000-0000-4000-8000-000000000503'
    );
    raise exception 'out-of-stock order should be rejected';
  exception
    when check_violation then
      if sqlerrm <> 'out of stock: g6' then raise; end if;
  end;
end;
$$;

select 1 / case when not exists (
  select 1 from public.orders
  where user_id = '00000000-0000-4000-8000-000000000503'
    and checkout_key = '10000000-0000-4000-8000-000000000503'
) then 1 else 0 end as assert_failed_order_rolled_back;
select 1 / case when (
  select stock_qty from public.goods where id = 'g6'
) = 0 then 1 else 0 end as assert_failed_order_preserves_stock;
select 1 / case when (
  select qty from public.cart_items
  where user_id = '00000000-0000-4000-8000-000000000503' and good_id = 'g6'
) = 1 then 1 else 0 end as assert_failed_order_preserves_cart;

-- The display sold-out flag is authoritative even if stock_qty is accidentally positive.
delete from public.cart_items
where user_id = '00000000-0000-4000-8000-000000000503' and good_id = 'g6';
reset role;
update public.goods set stock = 'soldout', stock_qty = 1 where id = 'g11';
reset role;
insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000503', 'g11', 1);

do $$
begin
  begin
    perform public.place_order(
      '00000000-0000-4000-8000-000000000503',
      '{"recipientName":"판매종료","phone":"01098765432","postalCode":"11111","address1":"부산시"}'::jsonb,
      '10000000-0000-4000-8000-000000000511'
    );
    raise exception 'sold-out item with positive quantity should be rejected';
  exception
    when check_violation then
      if sqlerrm <> 'out of stock: g11' then raise; end if;
  end;
end;
$$;

select 1 / case when not exists (
  select 1 from public.orders
  where user_id = '00000000-0000-4000-8000-000000000503'
    and checkout_key = '10000000-0000-4000-8000-000000000511'
) then 1 else 0 end as assert_soldout_order_rolled_back;
select 1 / case when (
  select stock_qty from public.goods where id = 'g11'
) = 1 then 1 else 0 end as assert_soldout_preserves_stock;
select 1 / case when (
  select qty from public.cart_items
  where user_id = '00000000-0000-4000-8000-000000000503' and good_id = 'g11'
) = 1 then 1 else 0 end as assert_soldout_preserves_cart;

-- 배송비(#174)는 서버가 굿즈 소계로 정하고 주문 행에 스냅샷으로 남는다.
-- 5만원 이상이던 위 첫 주문(99,000원)은 무료여야 한다.
select 1 / case when (
  select shipping_fee = 0 and total = 99000
  from public.orders where id = :'first_order_id'::uuid
) then 1 else 0 end as assert_free_shipping_above_threshold;

delete from public.cart_items where user_id = '00000000-0000-4000-8000-000000000501';
insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000501', 'g2', 1);

set local role service_role;
select public.place_order(
  '00000000-0000-4000-8000-000000000501',
  '{"recipientName":"배송비","phone":"01012345678","postalCode":"12345","address1":"서울시 성동구"}'::jsonb,
  '10000000-0000-4000-8000-000000000521'
) as shipping_fee_order_id \gset
reset role;

select 1 / case when (
  select shipping_fee = 3000 and total = 15000 + 3000
  from public.orders where id = :'shipping_fee_order_id'::uuid
) then 1 else 0 end as assert_flat_shipping_fee_below_threshold;

-- A zero-priced catalog item cannot consume inventory into an order that the
-- configured card provider can never prepare.
reset role;
update public.goods set price = 0, stock = 'ok', stock_qty = 2 where id = 'g11';
delete from public.cart_items where user_id = '00000000-0000-4000-8000-000000000503';
insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000503', 'g11', 1);

set local role service_role;
do $$
begin
  begin
    perform public.place_order(
      '00000000-0000-4000-8000-000000000503',
      '{"recipientName":"최소금액","phone":"01098765432","postalCode":"11111","address1":"부산시"}'::jsonb,
      '10000000-0000-4000-8000-000000000512'
    );
    raise exception 'zero-total order should be rejected';
  exception
    when check_violation then
      if sqlerrm <> 'payment amount below provider minimum' then raise; end if;
  end;
end;
$$;
reset role;

select 1 / case when not exists (
  select 1 from public.orders
  where user_id = '00000000-0000-4000-8000-000000000503'
    and checkout_key = '10000000-0000-4000-8000-000000000512'
) then 1 else 0 end as assert_zero_total_order_rolled_back;
select 1 / case when (
  select stock_qty from public.goods where id = 'g11'
) = 2 then 1 else 0 end as assert_zero_total_order_preserves_stock;
select 1 / case when (
  select qty from public.cart_items
  where user_id = '00000000-0000-4000-8000-000000000503' and good_id = 'g11'
) = 1 then 1 else 0 end as assert_zero_total_order_preserves_cart;

rollback;
