-- #489: coupons remain orders.discount_total; credits are a separate snapshot.
alter table public.orders
  add column store_credit_total bigint not null default 0 check(store_credit_total>=0),
  add column store_credit_policy_snapshot jsonb;
create table private.store_credit_checkout_intents (
  user_id uuid not null,
  checkout_key uuid not null,
  amount bigint not null check(amount between 0 and 999999999999),
  primary key(user_id,checkout_key)
);
create table private.store_credit_allocations (
  order_id uuid not null,
  user_id uuid not null,
  lot_id uuid not null,
  amount bigint not null check(amount>0),
  state text not null default 'reserved' check(state in ('reserved','consumed','released')),
  original_expires_at timestamptz not null,
  restore_grace_days integer not null check(restore_grace_days>=0),
  created_at timestamptz not null default clock_timestamp(),
  consumed_at timestamptz,
  released_at timestamptz,
  primary key(order_id,lot_id)
);
alter table private.store_credit_checkout_intents enable row level security;
alter table private.store_credit_allocations enable row level security;
revoke all on private.store_credit_checkout_intents,private.store_credit_allocations from public,anon,authenticated,service_role;

create function public.place_order_with_store_credits(
 p_user_id uuid,p_address jsonb,p_checkout_key uuid,p_payment_method public.order_payment_method,p_store_credit_amount bigint
) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare existing_amount bigint; existing_order public.orders;
begin
  if p_user_id is null or p_checkout_key is null or p_store_credit_amount is null or p_store_credit_amount not between 0 and 999999999999
    then raise invalid_parameter_value using message='store_credit_amount_invalid'; end if;
  -- Same serialization as existing coupon/cart checkout, before any new order.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  select * into existing_order from public.orders where user_id=p_user_id and checkout_key=p_checkout_key;
  if found and existing_order.store_credit_total<>p_store_credit_amount then
    raise exception using errcode='PT409',message='checkout key conflict';
  end if;
  insert into private.store_credit_checkout_intents(user_id,checkout_key,amount) values(p_user_id,p_checkout_key,p_store_credit_amount) on conflict do nothing;
  select amount into existing_amount from private.store_credit_checkout_intents where user_id=p_user_id and checkout_key=p_checkout_key;
  if existing_amount<>p_store_credit_amount then raise exception using errcode='PT409',message='checkout key conflict'; end if;
  return public.place_order(p_user_id,p_address,p_checkout_key,p_payment_method);
end $$;
revoke all on function public.place_order_with_store_credits(uuid,jsonb,uuid,public.order_payment_method,bigint) from public,anon,authenticated,service_role;
grant execute on function public.place_order_with_store_credits(uuid,jsonb,uuid,public.order_payment_method,bigint) to service_role;

-- Order is already locked by its caller. Lock order: order -> policy SHARE ->
-- account -> source lots. No account operation subsequently locks another order.
create function private.reserve_order_store_credits(p_order_id uuid,p_user_id uuid,p_subtotal bigint,p_coupon_discount bigint,p_shipping_fee bigint)
returns bigint language plpgsql volatile security definer set search_path='' as $$
declare requested bigint; policy private.store_credit_policy; balance jsonb; outstanding bigint; take bigint; lot private.store_credit_lots;
begin
  select coalesce(intent.amount,0) into requested from public.orders o
    left join private.store_credit_checkout_intents intent on intent.user_id=o.user_id and intent.checkout_key=o.checkout_key
    where o.id=p_order_id and o.user_id=p_user_id and o.status='pending';
  if not found then raise check_violation using message='store_credit_order_invalid'; end if;
  select * into policy from private.store_credit_policy where singleton for share;
  -- Snapshot promises only for new orders. Enabling later never earns on a
  -- historical order; disabling later does not erase an already promised grant.
  update public.orders set store_credit_policy_snapshot=case when policy.enabled then private.store_credit_policy_json()-'evidence' else null end where id=p_order_id;
  if requested=0 then return 0; end if;
  if not policy.enabled then raise check_violation using message='store_credit_disabled'; end if;
  if requested<policy.min_use or requested>policy.max_use or requested>greatest(0,p_subtotal-p_coupon_discount)
    or p_subtotal+p_shipping_fee-p_coupon_discount-requested<1000 then
    raise check_violation using message='store_credit_amount_invalid';
  end if;
  perform private.expire_store_credit_lots(p_user_id,clock_timestamp());
  balance:=private.store_credit_balance(p_user_id);
  if (balance->>'debt')::bigint>0 then raise check_violation using message='store_credit_debt'; end if;
  if (balance->>'available')::bigint<requested then raise check_violation using message='store_credit_insufficient'; end if;
  outstanding:=requested;
  for lot in select * from private.store_credit_lots where user_id=p_user_id and available_amount>0 and revoked_at is null order by expires_at,id for update loop
    take:=least(outstanding,lot.available_amount);
    update private.store_credit_lots set available_amount=available_amount-take,reserved_amount=reserved_amount+take where id=lot.id;
    insert into private.store_credit_allocations(order_id,user_id,lot_id,amount,original_expires_at,restore_grace_days)
      values(p_order_id,p_user_id,lot.id,take,lot.expires_at,policy.restore_grace_days);
    insert into public.store_credit_ledger(user_id,kind,amount,available_delta,reserved_delta,order_id,lot_id,expires_at)
      values(p_user_id,'reserve',-take,-take,take,p_order_id,lot.id,lot.expires_at);
    outstanding:=outstanding-take; exit when outstanding=0;
  end loop;
  if outstanding<>0 then raise check_violation using message='store_credit_insufficient'; end if;
  return requested;
end $$;
revoke all on function private.reserve_order_store_credits(uuid,uuid,bigint,bigint,bigint) from public,anon,authenticated,service_role;
grant execute on function private.reserve_order_store_credits(uuid,uuid,bigint,bigint,bigint) to postgres;

create or replace function private.goods_order_snapshot_matches(p_order_id uuid,p_total bigint,p_shipping_fee bigint)
returns boolean language sql stable set search_path='' as $$
 select count(*)>0 and coalesce(sum(item.qty::bigint*item.unit_price::bigint),0)+p_shipping_fee-
   (select o.discount_total+o.store_credit_total from public.orders o where o.id=p_order_id)=p_total
 from public.order_items item where item.order_id=p_order_id;
$$;
revoke all on function private.goods_order_snapshot_matches(uuid,bigint,bigint) from public,anon,authenticated,service_role;
grant execute on function private.goods_order_snapshot_matches(uuid,bigint,bigint) to postgres;

create function private.reverse_order_earned_store_credits(p_order_id uuid,p_user_id uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare root private.store_credit_lots; lot private.store_credit_lots; debt bigint:=0;
begin
  perform private.lock_store_credit_account(p_user_id);
  select * into root from private.store_credit_lots where source_order_id=p_order_id and source_kind='order_done' for update;
  if not found or root.revoked_at is not null then return; end if;
  if root.user_id<>p_user_id then raise check_violation using message='store_credit_source_mismatch'; end if;
  -- Descendant restoration lots keep root attribution: refunding a purchase does
  -- not launder its already restored earnings into an unrelated grant.
  for lot in select * from private.store_credit_lots where root_lot_id=root.id order by id for update loop
    debt:=debt+lot.reserved_amount+lot.spent_amount+lot.offset_amount;
    update private.store_credit_lots set available_amount=0,revoked_amount=revoked_amount+lot.available_amount,revoked_at=clock_timestamp() where id=lot.id;
    insert into public.store_credit_ledger(user_id,kind,amount,available_delta,debt_delta,order_id,lot_id)
      values(p_user_id,'earned_reversal',-lot.available_amount,-lot.available_amount,lot.reserved_amount+lot.spent_amount+lot.offset_amount,p_order_id,lot.id);
  end loop;
  update private.store_credit_lots set debt_amount=debt_amount+debt where id=root.id;
end $$;
revoke all on function private.reverse_order_earned_store_credits(uuid,uuid) from public,anon,authenticated,service_role;

create function private.release_order_store_credits(p_order_id uuid,p_user_id uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare allocation private.store_credit_allocations; lot private.store_credit_lots; root private.store_credit_lots;
  release_at timestamptz:=clock_timestamp(); expires timestamptz; debt_reduction bigint; restored bigint;
begin
  perform private.expire_store_credit_lots(p_user_id,release_at);
  for allocation in select * from private.store_credit_allocations where order_id=p_order_id and state<>'released' order by lot_id for update loop
    select * into lot from private.store_credit_lots where id=allocation.lot_id for update;
    if not found or lot.user_id<>p_user_id or allocation.user_id<>p_user_id then raise check_violation using message='store_credit_allocation_mismatch'; end if;
    expires:=case when allocation.original_expires_at>release_at then allocation.original_expires_at
      else release_at+make_interval(days=>allocation.restore_grace_days) end;
    if lot.revoked_at is not null then
      select * into root from private.store_credit_lots where id=lot.root_lot_id for update;
      debt_reduction:=least(allocation.amount,root.debt_amount);
      update private.store_credit_lots set debt_amount=debt_amount-debt_reduction where id=root.id;
      update private.store_credit_lots set
        reserved_amount=reserved_amount-case when allocation.state='reserved' then allocation.amount else 0 end,
        spent_amount=spent_amount-case when allocation.state='consumed' then allocation.amount else 0 end,
        revoked_amount=revoked_amount+allocation.amount where id=lot.id;
      insert into public.store_credit_ledger(user_id,kind,amount,reserved_delta,debt_delta,order_id,lot_id)
        values(p_user_id,'restore',0,case when allocation.state='reserved' then -allocation.amount else 0 end,-debt_reduction,p_order_id,lot.id);
      restored:=allocation.amount-debt_reduction;
      -- A prior future grant already discharged this debt. Return exactly that
      -- discharged part; never fabricate a cash receivable or provider refund.
      if restored>0 then perform private.issue_store_credit_lot(p_user_id,restored,expires,'restoration',p_order_id,null,null,''); end if;
    else
      update private.store_credit_lots set
        reserved_amount=reserved_amount-case when allocation.state='reserved' then allocation.amount else 0 end,
        spent_amount=spent_amount-case when allocation.state='consumed' then allocation.amount else 0 end,
        transferred_amount=transferred_amount+allocation.amount where id=lot.id;
      -- Reserve release is a separate zero-amount movement; the new lot records
      -- the restored value once and retains the original earning root.
      if allocation.state='reserved' then
        insert into public.store_credit_ledger(user_id,kind,amount,reserved_delta,order_id,lot_id) values(p_user_id,'restore',0,-allocation.amount,p_order_id,lot.id);
      end if;
      perform private.issue_store_credit_lot(p_user_id,allocation.amount,expires,'restoration',p_order_id,null,null,'',lot.root_lot_id);
    end if;
    update private.store_credit_allocations set state='released',released_at=release_at where order_id=p_order_id and lot_id=lot.id;
  end loop;
  -- An explicitly configured zero-day grace keeps an expired restoration expired.
  perform private.expire_store_credit_lots(p_user_id,release_at);
end $$;
revoke all on function private.release_order_store_credits(uuid,uuid) from public,anon,authenticated,service_role;

create function private.store_credit_order_transition() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare allocation private.store_credit_allocations; lot private.store_credit_lots; basis bigint; earned bigint; policy jsonb; balance jsonb;
begin
  if new.status is not distinct from old.status then return null; end if;
  if new.status='paid' and new.store_credit_total>0 then
    perform private.lock_store_credit_account(new.user_id);
    for allocation in select * from private.store_credit_allocations where order_id=new.id and state='reserved' order by lot_id for update loop
      select * into lot from private.store_credit_lots where id=allocation.lot_id for update;
      if not found or lot.user_id<>new.user_id or allocation.user_id<>new.user_id or lot.reserved_amount<allocation.amount
        then raise check_violation using message='store_credit_allocation_mismatch'; end if;
      update private.store_credit_lots set reserved_amount=reserved_amount-allocation.amount,spent_amount=spent_amount+allocation.amount where id=allocation.lot_id;
      update private.store_credit_allocations set state='consumed',consumed_at=clock_timestamp() where order_id=new.id and lot_id=allocation.lot_id;
      insert into public.store_credit_ledger(user_id,kind,amount,reserved_delta,order_id,lot_id)
        values(new.user_id,'consume',0,-allocation.amount,new.id,allocation.lot_id);
    end loop;
    if coalesce((select sum(amount) from private.store_credit_allocations where order_id=new.id and state='consumed'),0)<>new.store_credit_total
      then raise check_violation using message='store_credit_allocation_mismatch'; end if;
  elsif new.status='canceled' then
    -- Only authoritative terminal order cancellation reaches this trigger.
    -- Declined/unknown attempts alone do not release a still-payable reservation.
    perform private.expire_store_credit_lots(new.user_id,clock_timestamp());
    perform private.reverse_order_earned_store_credits(new.id,new.user_id);
    perform private.release_order_store_credits(new.id,new.user_id);
  elsif new.status='done' and new.store_credit_policy_snapshot is not null then
    policy:=new.store_credit_policy_snapshot;
    perform private.expire_store_credit_lots(new.user_id,clock_timestamp());
    if exists(select 1 from private.store_credit_lots where source_order_id=new.id and source_kind='order_done') then return null; end if;
    basis:=greatest(0,new.total-new.shipping_fee);
    if basis=0 then return null; end if;
    earned:=case when policy->>'earnKind'='rate_bps' then floor(basis::numeric*(policy->>'earnValue')::numeric/10000)::bigint else (policy->>'earnValue')::bigint end;
    earned:=least(earned,(policy->>'earnMaxPerOrder')::bigint);
    balance:=private.store_credit_balance(new.user_id);
    earned:=least(earned,greatest(0,(policy->>'maxBalance')::bigint-(balance->>'available')::bigint-(balance->>'reserved')::bigint)+(balance->>'debt')::bigint);
    if earned>0 then
      perform private.issue_store_credit_lot(new.user_id,earned,clock_timestamp()+make_interval(days=>(policy->>'validityDays')::integer),'order_done',new.id,null,null,'');
    end if;
  end if;
  return null;
end $$;
revoke all on function private.store_credit_order_transition() from public,anon,authenticated,service_role;
create trigger orders_store_credit_transition after update of status on public.orders for each row execute function private.store_credit_order_transition();

create function public.get_my_store_credit_checkout(p_requested_amount bigint default 0) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); policy private.store_credit_policy; balance jsonb; items jsonb; sales jsonb; subtotal bigint; shipping bigint; coupon bigint:=0; selected uuid; evaluation record; maximum bigint:=0; reason text;
begin
  if actor is null then raise insufficient_privilege using message='auth_required'; end if;
  if p_requested_amount is null or p_requested_amount not between 0 and 999999999999 then raise invalid_parameter_value using message='store_credit_amount_invalid'; end if;
  select * into policy from private.store_credit_policy where singleton;
  perform private.expire_store_credit_lots(actor,clock_timestamp());
  balance:=private.store_credit_balance(actor);
  if not policy.enabled then reason:='store_credit_disabled';
  elsif (balance->>'debt')::bigint>0 then reason:='store_credit_debt';
  else
    select coalesce(jsonb_agg(jsonb_build_object('goodId',good_id,'variantId',variant_id,'qty',qty)),'[]') into items from public.cart_items where user_id=actor;
    sales:=public.quote_goods_sales(items); subtotal:=(sales->>'subtotal')::bigint; shipping:=(sales->'shipping'->>'totalFee')::bigint;
    select user_coupon_id into selected from public.cart_coupon_selections where user_id=actor;
    if selected is not null then
      select * into evaluation from private.evaluate_user_coupon(selected,actor,subtotal);
      if evaluation.o_reason is not null then reason:=evaluation.o_reason;
      else coupon:=least(evaluation.o_discount,greatest(0,subtotal+shipping-1000)); end if;
    end if;
    maximum:=least(policy.max_use,(balance->>'available')::bigint,greatest(0,subtotal-coupon),greatest(0,subtotal+shipping-coupon-1000));
    if reason is null and p_requested_amount>0 and (p_requested_amount<policy.min_use or p_requested_amount>maximum) then reason:='store_credit_amount_invalid'; end if;
  end if;
  return balance||jsonb_build_object('enabled',policy.enabled,'minUse',policy.min_use,'maxUse',maximum,'requestedAmount',p_requested_amount,
    'valid',p_requested_amount=0 or reason is null,'reason',reason);
end $$;
revoke all on function public.get_my_store_credit_checkout(bigint) from public,anon,authenticated,service_role;
grant execute on function public.get_my_store_credit_checkout(bigint) to authenticated;

grant all on private.store_credit_checkout_intents,private.store_credit_allocations to postgres;
grant execute on function private.reverse_order_earned_store_credits(uuid,uuid),private.release_order_store_credits(uuid,uuid),private.store_credit_order_transition() to postgres;

-- Preserve the #476/#483/#484 order core, adding one credit reservation seam.
CREATE OR REPLACE FUNCTION private.place_order_before_shipments(p_address jsonb, p_checkout_key uuid, p_payment_method order_payment_method)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  -- 결제사 최소 결제액(20260813242000 가드·lib/coupons.ts MIN_PAYABLE_TOTAL와 동치).
  -- 할인이 총액을 이 밑으로 내리면 가드가 주문 전체를 롤백하므로, 여기서 캡한다.
  c_min_payable_total constant bigint := 1000;
  v_user uuid := (select auth.uid());
  v_order uuid;
  v_existing_address jsonb;
  v_existing_payment_method public.order_payment_method;
  v_expires_at timestamptz;
  v_subtotal bigint := 0;
  v_shipping_fee bigint := 0;
  v_item_count integer := 0;
  v_recipient_name text;
  v_phone text;
  v_postal_code text;
  v_address1 text;
  v_optional text;
  v_selected_coupon uuid;
  v_coupon_eval record;
  v_discount bigint := 0;
  v_store_credit bigint := 0;
  r record;
  v_variant public.goods_variants;
  v_price record;
  v_price_at timestamptz;
  v_limit_good public.goods;
  v_good_qty bigint;
  v_last_good_id text;
  v_quantity_error text;
begin
  if v_user is null then
    raise insufficient_privilege using message = 'auth required';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    join auth.users as auth_user on auth_user.id = profile.id
    where profile.id = v_user
      and nullif(btrim(coalesce(profile.email, auth_user.email)), '') is not null
      and nullif(btrim(profile.nickname), '') is not null
      and profile.birth_date is not null
      and profile.birth_date <= current_date
      and profile.onboarded_at is not null
      and profile.consents ->> 'terms' = 'true'
      and profile.consents ->> 'privacy' = 'true'
  ) then
    raise insufficient_privilege using message = 'onboarding required';
  end if;

  if p_checkout_key is null then
    raise not_null_violation using message = 'checkout key required';
  end if;

  if p_address is null or jsonb_typeof(p_address) <> 'object' then
    raise check_violation using message = 'invalid checkout address';
  end if;

  if not (p_address ?& array['recipientName', 'phone', 'postalCode', 'address1'])
     or exists (
       select 1
       from jsonb_object_keys(p_address) as address_key(key)
       where address_key.key not in (
         'recipientName', 'phone', 'postalCode', 'address1', 'address2', 'deliveryNote'
       )
     )
     or exists (
       select 1
       from jsonb_each(p_address) as address_value(key, value)
       where jsonb_typeof(address_value.value) <> 'string'
     ) then
    raise check_violation using message = 'invalid checkout address';
  end if;

  v_recipient_name := p_address ->> 'recipientName';
  v_phone := p_address ->> 'phone';
  v_postal_code := p_address ->> 'postalCode';
  v_address1 := p_address ->> 'address1';

  if v_recipient_name <> btrim(v_recipient_name, E' \t\n\r\f\v')
     or length(v_recipient_name) not between 1 and 50
     or v_phone !~ '^[0-9]{8,15}$'
     or v_postal_code !~ '^[0-9]{5}$'
     or v_address1 <> btrim(v_address1, E' \t\n\r\f\v')
     or length(v_address1) not between 1 and 200 then
    raise check_violation using message = 'invalid checkout address';
  end if;

  if p_address ? 'address2' then
    v_optional := p_address ->> 'address2';
    if v_optional <> btrim(v_optional, E' \t\n\r\f\v') or length(v_optional) > 200 then
      raise check_violation using message = 'invalid checkout address';
    end if;
  end if;

  if p_address ? 'deliveryNote' then
    v_optional := p_address ->> 'deliveryNote';
    if v_optional <> btrim(v_optional, E' \t\n\r\f\v') or length(v_optional) > 200 then
      raise check_violation using message = 'invalid checkout address';
    end if;
  end if;

  -- 같은 사용자의 다른 탭 주문을 직렬화한다. 동일 키 재시도는 먼저 생성된
  -- 주문을 반환하고, 다른 키는 첫 주문이 비운 장바구니를 확인하게 된다.
  -- 쿠폰 적용·해제도 같은 잠금을 잡으므로 선택 교체와 소비가 경합하지 않는다.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  select orders.id, orders.address, orders.payment_method
    into v_order, v_existing_address, v_existing_payment_method
  from public.orders
  where orders.user_id = v_user
    and orders.checkout_key = p_checkout_key;

  if found then
    -- 같은 checkout key로 결제수단만 바꿔 다시 부르면 24시간 선점을 15분 주문에
    -- 덧씌우거나 그 반대가 된다. 주소와 같은 등급의 충돌로 막는다.
    if v_existing_address is distinct from p_address
      or v_existing_payment_method is distinct from p_payment_method
    then
      raise unique_violation using message = 'checkout key conflict';
    end if;
    return v_order;
  end if;

  if p_payment_method is null then
    raise invalid_parameter_value using message='payment method required';
  end if;

  -- 카드 15분 · 무통장 24시간. 무통장은 사람이 은행 앱을 열고 이체할 시간을
  -- 줘야 해서 선점 창이 길고, 그만큼 재고가 오래 묶인다 — 한정 드롭은
  -- goods.allow_bank_transfer로 아예 차단한다(ADR-0007).
  v_expires_at := case
    when p_payment_method = 'bank_transfer' then now() + interval '24 hours'
    else now() + interval '15 minutes'
  end;

  insert into public.orders (
    user_id, status, total, shipping_fee, address, expires_at, checkout_key, payment_method
  )
  values (v_user, 'pending', 0, 0, p_address, v_expires_at, p_checkout_key, p_payment_method)
  returning id into v_order;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cart:'||v_user::text,0));
  -- This timestamp is fixed after the member/cart locks. Waiting for a competing
  -- checkout cannot select a stale pre-lock clock value. Each order has one price
  -- boundary, including all its coupon and shipping calculations.
  v_price_at:=clock_timestamp();
  -- Parent goods are locked before their selected options and cache updates.
  for r in
    select
      cart.good_id,
      cart.variant_id,
      cart.qty,
      good.price,
      good.stock,
      good.stock_qty,
      good.name,
      good.type,
      good.ip_id,
      good.allow_bank_transfer,
      good.allow_card_payment,
      good.sale_restriction,
      good.published_at,
      good.archived_at
    from public.cart_items as cart
    join public.goods as good on good.id = cart.good_id
    where cart.user_id = v_user
    order by cart.good_id, cart.variant_id
    for update of cart, good
  loop
    -- The locked good fixes its parent association. Keep the IP SHARE lock until
    -- this order commits, serializing new purchases with an unpublish UPDATE.
    perform private.assert_ip_purchasable(r.ip_id);
    if r.published_at is null or r.archived_at is not null then
      raise check_violation using message='catalog_item_unavailable';
    end if;
    select * into v_variant from public.goods_variants where id=r.variant_id and good_id=r.good_id for update;
    if not found or v_variant.archived_at is not null then raise check_violation using message='catalog_item_unavailable'; end if;
    v_item_count := v_item_count + 1;

    -- Cart has one row per option. Check a good only before its first row is
    -- consumed, summing every selected option and any optional add-on of it.
    if v_last_good_id is distinct from r.good_id then
      select * into v_limit_good from public.goods where id=r.good_id;
      select sum(qty::bigint) into v_good_qty from public.cart_items where user_id=v_user and good_id=r.good_id;
      v_quantity_error:=private.check_goods_purchase_quantity(v_limit_good,v_user,v_good_qty,true);
      if v_quantity_error is not null then
        raise check_violation using message=v_quantity_error||': '||r.good_id;
      end if;
      v_last_good_id:=r.good_id;
    end if;
    select * into v_price from private.resolve_goods_variant_price(v_variant.id,v_price_at);


    if r.stock = 'soldout' or v_variant.stock_qty < r.qty then
      raise check_violation using message = format('out of stock: %s', r.good_id);
    end if;

    if p_payment_method = 'card' and not r.allow_card_payment then
      raise check_violation using message=format('card payment blocked: %s',r.good_id);
    end if;

    if p_payment_method = 'bank_transfer' and not r.allow_bank_transfer then
      raise check_violation using message = format('bank transfer blocked: %s', r.good_id);
    end if;

    -- 성인인증(#209·#210)이 도입되기 전까지 판매 제한 상품은 서버가 구매를
    -- 차단한다. 결제수단과 무관한 상품 축이라 무통장 검사와 별개로 판정한다.
    if r.sale_restriction <> 'none' then
      raise check_violation using message = format('restricted good blocked: %s', r.good_id);
    end if;

    perform private.change_goods_variant_stock(r.good_id, r.variant_id, -r.qty::bigint);

    insert into public.order_items (
      order_id,
      good_id,
      variant_id,
      qty,
      unit_price,
      good_name_snapshot,
      good_type_snapshot,
      good_ip_id_snapshot,
      regular_unit_price_snapshot,
      price_period_id,
      price_evaluated_at,
      sales_policy_snapshot
    )
    values (
      v_order,
      r.good_id,
      r.variant_id,
      r.qty,
      v_price.effective_price,
      r.name,
      r.type,
      r.ip_id,
      v_price.regular_price,
      v_price.price_period_id,
      v_price_at,
      jsonb_build_object('version',1,'allowCardPayment',r.allow_card_payment,'allowBankTransfer',r.allow_bank_transfer,
        'orderQuantityLimitEnabled',v_limit_good.order_quantity_limit_enabled,
        'minOrderQty',v_limit_good.min_order_qty,'maxOrderQty',v_limit_good.max_order_qty,
        'memberPurchaseLimitEnabled',v_limit_good.member_purchase_limit_enabled,
        'memberLifetimeQtyLimit',v_limit_good.member_lifetime_qty_limit)
    );

    -- 조회 시 잠근 스냅샷 행만 지운다. 동시에 새로 담긴 다른 상품까지
    -- 마지막 broad delete가 없애지 않도록 상품 단위로 소비한다.
    delete from public.cart_items
    where user_id = v_user
      and good_id = r.good_id and variant_id = r.variant_id;

    v_subtotal := v_subtotal + (v_price.effective_price::bigint * r.qty::bigint);
  end loop;

  if v_item_count = 0 then
    raise check_violation using message = 'cart empty';
  end if;

  -- Shipping uses the period-adjusted item subtotal before coupon/credit deductions.
  -- Its order-item inputs already contain the immutable effective price.
  v_shipping_fee := private.goods_shipping_fee_for(v_order);

  -- 카트에 적용해 둔 쿠폰을 여기서 최종 검증하고 소비한다. 조건 미달이면 주문
  -- 전체를 거부한다 — 할인을 기대한 사용자를 조용히 정가로 결제시키지 않는다.
  select selection.user_coupon_id
  into v_selected_coupon
  from public.cart_coupon_selections as selection
  where selection.user_id = v_user;

  if v_selected_coupon is not null then
    -- 상태 전이 전에 보유 행을 잠근다. 같은 유저는 advisory lock으로 이미
    -- 직렬화되어 있고, 이 잠금은 향후 다른 경로가 생겨도 이중 사용을 막는 안전벨트다.
    perform held.id
    from public.user_coupons as held
    where held.id = v_selected_coupon
    for update;

    select * into v_coupon_eval
    from private.evaluate_user_coupon(v_selected_coupon, v_user, v_subtotal);
    if v_coupon_eval.o_reason is not null then
      raise check_violation using message = v_coupon_eval.o_reason;
    end if;
    -- 결제사 최소 결제액을 지키도록 할인을 캡한다 — 전액 쿠폰이 주문을
    -- 결제 불가(총액 < 1,000원)로 만들면 혜택이 주문 실패로 둔갑한다.
    v_discount := least(
      v_coupon_eval.o_discount,
      greatest(0, v_subtotal + v_shipping_fee - c_min_payable_total)
    );

    update public.user_coupons
    set status = 'used',
        used_at = now(),
        used_order_id = v_order
    where id = v_selected_coupon;

    insert into public.coupon_redemptions (
      user_coupon_id, coupon_code, user_id, order_id, discount_amount
    )
    values (
      v_selected_coupon, v_coupon_eval.o_coupon_code, v_user, v_order, v_discount
    );

    -- 소비한 선택만 지운다. 주문 진행 중 다른 탭이 교체한 새 선택은 남는다.
    delete from public.cart_coupon_selections
    where user_id = v_user
      and user_coupon_id = v_selected_coupon;
  end if;

  v_store_credit := private.reserve_order_store_credits(v_order,v_user,v_subtotal,v_discount,v_shipping_fee);

  update public.orders
  set total = v_subtotal + v_shipping_fee - v_discount - v_store_credit,
      shipping_fee = v_shipping_fee,
      store_credit_total = v_store_credit,
      discount_total = v_discount
  where id = v_order;

  -- 무통장에는 결제사 왕복이 없다. 그래서 원장 anchor(payment_attempts)를 여기서
  -- 바로 연다 — 없으면 운영자가 입금을 확인할 대상 자체가 없고, "결제 준비" 버튼을
  -- 눌러야 생기는 구조는 구매자가 이미 이체한 뒤에도 확인이 안 되는 창을 만든다.
  -- 새 함수를 두지 않고 카드와 같은 prepare를 부른다: 소유권·금액·스냅샷·정지
  -- 계정 검사가 한 곳에만 있어야 한다.
  if p_payment_method = 'bank_transfer' then
    perform public.prepare_goods_payment_attempt(v_user, v_order, 'bank_transfer');
  end if;

  -- 무통장 주문은 만든 순간이 안내 시점이다. 금액·입금자명 코드·기한이 모두
  -- 정해졌고, 이 알림을 놓치면 구매자는 어디로 얼마를 보낼지 알 수 없다.
  if p_payment_method = 'bank_transfer' then
    insert into public.notifications (
      user_id, type, title, body, link_path, source_type, source_id, dedupe_key
    )
    values (
      v_user,
      'order_bank_transfer_pending',
      '입금 안내를 확인해주세요',
      format(
        '%s원을 기한 안에 입금해주세요. 입금자명 끝에 주문코드 %s를 붙이면 확인이 빨라집니다.',
        to_char(v_subtotal + v_shipping_fee - v_discount - v_store_credit, 'FM999,999,999'),
        private.bank_transfer_deposit_code(v_order)
      ),
      '/checkout/' || v_order::text,
      'order',
      v_order::text,
      'order:bank_transfer_pending:' || v_order::text
    )
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  return v_order;
end;
$function$;
revoke all on function private.place_order_before_shipments(jsonb,uuid,public.order_payment_method) from public,anon,authenticated,service_role;
