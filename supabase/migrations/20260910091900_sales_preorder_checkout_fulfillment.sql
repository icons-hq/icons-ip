-- #485/#486: order supply, cancellation and origin-group promises share the
-- existing price/coupon/store-credit/payment contracts. No new PG flow.

create or replace function public.set_cart_item_quantity(p_good_id text,p_variant_id uuid,p_qty integer)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); available_stock integer;
begin
  if actor is null then raise insufficient_privilege using message='auth required'; end if;
  perform private.assert_active_user(actor);
  if nullif(btrim(p_good_id),'') is null or p_variant_id is null or p_qty is null or p_qty<0 then raise invalid_parameter_value using message='invalid cart item'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cart:'||actor::text,0));
  if p_qty=0 then delete from public.cart_items where user_id=actor and good_id=p_good_id and variant_id=p_variant_id; return; end if;
  select supply.available_qty into available_stock from public.goods_variants variant
    join public.goods good on good.id=variant.good_id join public.ips ip on ip.id=good.ip_id
    cross join lateral private.resolve_goods_variant_supply(variant.id,statement_timestamp()) supply
    where variant.id=p_variant_id and variant.good_id=p_good_id and variant.archived_at is null
      and good.published_at is not null and good.archived_at is null and good.sale_restriction='none'
      and good.stock<>'soldout' and (good.allow_card_payment or good.allow_bank_transfer)
      and ip.published_at is not null and ip.archived_at is null;
  if not found then raise check_violation using message='catalog_item_unavailable'; end if;
  if p_qty>available_stock then raise check_violation using message='out of stock'; end if;
  insert into public.cart_items(user_id,good_id,variant_id,qty) values(actor,p_good_id,p_variant_id,p_qty)
    on conflict(user_id,variant_id) do update set qty=excluded.qty;
end $$;
revoke all on function public.set_cart_item_quantity(text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.set_cart_item_quantity(text,uuid,integer) to authenticated,postgres;

create or replace function private.goods_additional_available(p_good_id text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.goods good join public.ips ip on ip.id=good.ip_id
    where good.id=p_good_id and good.published_at is not null and good.archived_at is null
      and good.sale_restriction='none' and good.stock<>'soldout' and (good.allow_card_payment or good.allow_bank_transfer)
      and ip.published_at is not null and ip.archived_at is null
      and exists(select 1 from public.goods_variants variant cross join lateral private.resolve_goods_variant_supply(variant.id,statement_timestamp()) supply
        where variant.good_id=good.id and variant.archived_at is null and supply.available_qty>0));
$$;
revoke all on function private.goods_additional_available(text) from public,anon,authenticated,service_role;
grant execute on function private.goods_additional_available(text) to postgres;

-- Keep the existing shipping calculation unchanged, adding only the visible
-- latest promise for the already-established single group per origin.
alter function public.quote_goods_shipping(jsonb) set schema private;
alter function private.quote_goods_shipping(jsonb) rename to quote_goods_shipping_before_preorder;
revoke all on function private.quote_goods_shipping_before_preorder(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.quote_goods_shipping_before_preorder(jsonb) to postgres;
create function public.quote_goods_shipping(items jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare quote jsonb; groups jsonb:='[]'; group_value jsonb; planned_date date; has_preorder boolean; has_stock boolean;
begin
  quote:=private.quote_goods_shipping_before_preorder(items);
  for group_value in select value from jsonb_array_elements(quote->'groups') loop
    select max(supply.expected_ship_date) filter(where supply.mode='preorder'),bool_or(supply.mode='preorder'),bool_or(supply.mode='stock')
      into planned_date,has_preorder,has_stock
    from jsonb_to_recordset(items) line("goodId" text,"variantId" uuid,qty integer)
    join public.goods good on good.id=line."goodId"
    cross join lateral private.resolve_goods_variant_supply(line."variantId",statement_timestamp()) supply
    where good.origin_id::text=group_value->>'originId';
    groups:=groups||jsonb_build_array(group_value||jsonb_build_object('expectedShipDate',planned_date,
      'hasPreorder',coalesce(has_preorder,false),'hasStockItems',coalesce(has_stock,false)));
  end loop;
  return quote||jsonb_build_object('groups',groups);
end $$;
revoke all on function public.quote_goods_shipping(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quote_goods_shipping(jsonb) to anon,authenticated,postgres;

-- Preserve the latest selected-coupon server quote rather than recopying it.
alter function public.quote_goods_sales(jsonb) set schema private;
alter function private.quote_goods_sales(jsonb) rename to quote_goods_sales_before_preorder;
revoke all on function private.quote_goods_sales_before_preorder(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.quote_goods_sales_before_preorder(jsonb) to postgres;
create function public.quote_goods_sales(items jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare quote jsonb; lines jsonb:='[]'; line jsonb; supply jsonb; next_change timestamptz; selling boolean; shipping_quote jsonb;
begin
  quote:=private.quote_goods_sales_before_preorder(items);
  next_change:=(quote->>'nextChangeAt')::timestamptz;
  for line in select value from jsonb_array_elements(quote->'lines') loop
    select public.goods_variant_supply(variant),good.stock<>'soldout' into supply,selling
      from public.goods_variants variant join public.goods good on good.id=variant.good_id
      where variant.id=(line->>'variantId')::uuid and good.id=line->>'goodId';
    if supply is null then raise check_violation using message='sales_quote_variant_unavailable'; end if;
    lines:=lines||jsonb_build_array(line||jsonb_build_object('supply',supply,'available',selling and (line->>'qty')::bigint<=(supply->>'availableQty')::integer));
    next_change:=least(next_change,(supply->>'nextChangeAt')::timestamptz);
  end loop;
  shipping_quote:=public.quote_goods_shipping(items);
  return quote||jsonb_build_object('lines',lines,'nextChangeAt',next_change,'shipping',shipping_quote,
    'coupon',private.quote_selected_coupon(lines,(quote->>'subtotal')::bigint,(shipping_quote->>'totalFee')::bigint));
end $$;
revoke all on function public.quote_goods_sales(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quote_goods_sales(jsonb) to anon,authenticated,postgres;

create or replace function private.goods_order_snapshot_matches(p_order_id uuid,p_total bigint,p_shipping_fee bigint)
returns boolean language sql stable set search_path='' as $$
  select count(*)>0 and coalesce(sum(item.qty::bigint*item.unit_price::bigint),0)+p_shipping_fee-
    (select purchase.discount_total+purchase.store_credit_total from public.orders purchase where purchase.id=p_order_id)=p_total
    and bool_and(item.supply_source='stock' or exists(select 1 from private.goods_preorder_reservations reservation
      where reservation.order_item_id=item.id and reservation.order_id=item.order_id and reservation.policy_id=item.preorder_policy_id
        and reservation.qty=item.qty and reservation.state in ('reserved','allocated')))
  from public.order_items item where item.order_id=p_order_id;
$$;
revoke all on function private.goods_order_snapshot_matches(uuid,bigint,bigint) from public,anon,authenticated,service_role;
grant execute on function private.goods_order_snapshot_matches(uuid,bigint,bigint) to postgres;


-- Latest #487/#488/#489 core plus one supply-source branch.
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
  v_supply record;
  v_new_order_item uuid;
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

  perform private.assert_first_purchase_checkout(v_user,v_order);
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


    select * into v_supply from private.resolve_goods_variant_supply(v_variant.id,v_price_at);
    if r.stock = 'soldout' then
      raise check_violation using message = format('out of stock: %s', r.good_id);
    end if;
    if v_supply.mode='preorder' then
      if v_supply.state<>'open' then raise check_violation using message='preorder_sale_not_open'; end if;
      if v_supply.available_qty<r.qty then raise check_violation using message='preorder_capacity_exceeded'; end if;
    elsif v_supply.available_qty<r.qty then
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

    if v_supply.mode='stock' then
      perform private.change_goods_variant_stock(r.good_id, r.variant_id, -r.qty::bigint);
    end if;

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
      sales_policy_snapshot,
      supply_source,
      preorder_policy_id,
      preorder_expected_ship_date,
      preorder_snapshot
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
        'memberLifetimeQtyLimit',v_limit_good.member_lifetime_qty_limit),
      v_supply.mode,
      v_supply.policy_id,
      v_supply.expected_ship_date,
      case when v_supply.mode='preorder' then jsonb_build_object('version',1,'policyId',v_supply.policy_id,
        'policyRevision',v_supply.policy_revision,'startsAt',v_supply.starts_at,'endsAt',v_supply.ends_at,
        'expectedShipDate',v_supply.expected_ship_date) end
    ) returning id into v_new_order_item;
    if v_supply.mode='preorder' then
      perform private.reserve_goods_preorder_item(v_new_order_item,v_price_at);
    end if;

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
    from private.evaluate_order_user_coupon(v_selected_coupon, v_user, v_order);
    if v_coupon_eval.o_reason is not null then
      raise check_violation using message = v_coupon_eval.o_reason;
    end if;
    -- 결제사 최소 결제액을 지키도록 할인을 캡한다 — 전액 쿠폰이 주문을
    -- 결제 불가(총액 < 1,000원)로 만들면 혜택이 주문 실패로 둔갑한다.
    v_discount := least(
      v_coupon_eval.o_discount,
      greatest(0, v_subtotal + v_shipping_fee - c_min_payable_total)
    );

    if v_discount<=0 then raise check_violation using message='coupon_no_discount'; end if;
    perform private.reserve_first_purchase_coupon(v_order,v_user,v_coupon_eval.o_coupon_code);

    update public.user_coupons
    set status = 'used',
        used_at = now(),
        used_order_id = v_order
    where id = v_selected_coupon;

    insert into public.coupon_redemptions (
      user_coupon_id, coupon_code, user_id, order_id, discount_amount, eligible_subtotal, terms_snapshot
    )
    values (
      v_selected_coupon, v_coupon_eval.o_coupon_code, v_user, v_order, v_discount, v_coupon_eval.o_eligible_subtotal, v_coupon_eval.o_terms_snapshot
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

-- Provider evidence, collection checks and monetary refunds remain unchanged.
CREATE OR REPLACE FUNCTION public.finalize_order_cancellation_with_provider_evidence(p_order_id uuid, p_reason text, p_provider_payment_keys text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_status public.order_status;
  v_provider_payment_keys text[] := coalesce(
    array_remove(p_provider_payment_keys, null),
    array[]::text[]
  );
  v_item record;
begin
  select orders.status
  into v_status
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order not found';
  end if;

  perform s.id from public.order_shipments s where s.order_id=p_order_id order by s.id for update;
  perform private.assert_order_collections_complete(p_order_id);

  if v_status not in (
    'pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done', 'canceled'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'order not cancelable';
  end if;

  -- 배송이 나간 뒤의 취소는 staff 결정이 남긴 durable claim이 반드시 선행한다.
  -- claim이 없다는 것은 승인 경로 밖에서 들어왔다는 뜻이므로 거절한다.
  if v_status in ('shipping', 'delivered', 'done') and not exists (
    select 1
    from public.order_cancellation_claims as claim
    where claim.order_id = p_order_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'order not cancelable';
  end if;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
  order by payment.id
  for update;

  if exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = p_order_id
      and payment.status in ('pending', 'paid')
      and (
        payment.payment_key is null
        or not (payment.payment_key = any(v_provider_payment_keys))
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'provider cancellation required';
  end if;

  if v_status in ('paid', 'confirmed', 'shipping', 'delivered', 'done')
    and not exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = p_order_id
        and (
          payment.status in ('canceled', 'refunded')
          or payment.payment_key = any(v_provider_payment_keys)
        )
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'payment evidence required';
  end if;

  if v_status <> 'canceled' then
    for v_item in
      select order_item.id, order_item.good_id, order_item.qty, private.order_item_stock_variant(order_item.id) as variant_id
      from public.order_items as order_item
      where order_item.order_id = p_order_id
      order by order_item.good_id, order_item.id
    loop
      perform private.restore_order_item_supply(v_item.id,p_reason);
    end loop;

    perform ticket.id
    from public.draw_tickets as ticket
    where ticket.source = 'order_paid'
      and ticket.source_id = p_order_id
      and ticket.consumed_at is null
      and ticket.revoked_at is null
    order by ticket.id
    for update;

    update public.draw_tickets as ticket
    set revoked_at = now()
    where ticket.source = 'order_paid'
      and ticket.source_id = p_order_id
      and ticket.consumed_at is null
      and ticket.revoked_at is null;
  end if;

  insert into public.refunds (payment_id, amount, reason, status)
  select
    payment.id,
    payment.amount,
    p_reason,
    'done'
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
    and (
      payment.status in ('canceled', 'refunded')
      or payment.payment_key = any(v_provider_payment_keys)
    )
  on conflict (payment_id) do update
  set
    amount = excluded.amount,
    reason = coalesce(public.refunds.reason, excluded.reason),
    status = 'done';

  update public.payments as payment
  set status = 'refunded'
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
    and (
      payment.status in ('canceled', 'refunded')
      or payment.payment_key = any(v_provider_payment_keys)
    );

  if v_status <> 'canceled' then
    update public.orders
    set
      status = 'canceled',
      expires_at = null
    where id = p_order_id;
  end if;

  delete from public.order_cancellation_claims
  where order_id = p_order_id;
end;
$function$;
revoke all on function public.finalize_order_cancellation_with_provider_evidence(uuid,text,text[]) from public,anon,authenticated,service_role;

alter table public.order_shipments
  add column original_expected_ship_date date,
  add column expected_ship_date date;
create table private.order_shipment_promise_changes (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.order_shipments(id) on delete restrict,
  from_date date not null,
  to_date date not null,
  reason text not null check(length(btrim(reason)) between 1 and 2000),
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  check(from_date<>to_date)
);
create index order_shipment_promise_history on private.order_shipment_promise_changes(shipment_id,created_at,id);
revoke all on private.order_shipment_promise_changes from public,anon,authenticated,service_role;
grant select,insert on private.order_shipment_promise_changes to postgres;

alter function private.create_order_shipments(uuid) rename to create_order_shipments_before_preorder;
revoke all on function private.create_order_shipments_before_preorder(uuid) from public,anon,authenticated,service_role;
grant execute on function private.create_order_shipments_before_preorder(uuid) to postgres;
create function private.create_order_shipments(target_order uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  perform private.create_order_shipments_before_preorder(target_order);
  -- Existing orders and checkout retries keep their original/current promises.
  -- A new preorder shipment is initialized once from its original item dates.
  update public.order_shipments shipment set original_expected_ship_date=promise.expected_date,
    expected_ship_date=promise.expected_date,updated_at=clock_timestamp()
  from (select link.shipment_id,max(item.preorder_expected_ship_date) expected_date from public.order_shipment_items link
    join public.order_items item on item.id=link.order_item_id where link.order_id=target_order group by link.shipment_id) promise
  where shipment.id=promise.shipment_id and shipment.original_expected_ship_date is null and promise.expected_date is not null;
end $$;
revoke all on function private.create_order_shipments(uuid) from public,anon,authenticated,service_role;
grant execute on function private.create_order_shipments(uuid) to postgres;

create or replace function public.place_order(p_address jsonb,p_checkout_key uuid,p_payment_method public.order_payment_method)
returns uuid language plpgsql security definer set search_path='' as $$
declare order_key uuid;
begin
  order_key:=private.place_order_before_shipments(p_address,p_checkout_key,p_payment_method);
  perform private.create_order_shipments(order_key);
  return order_key;
end $$;
revoke all on function public.place_order(jsonb,uuid,public.order_payment_method) from public,anon,authenticated,service_role;
grant execute on function public.place_order(jsonb,uuid,public.order_payment_method) to authenticated,postgres;

create function private.freeze_shipment_original_promise() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.original_expected_ship_date is distinct from old.original_expected_ship_date then
    if old.original_expected_ship_date is not null or new.original_expected_ship_date is distinct from
      (select max(item.preorder_expected_ship_date) from public.order_shipment_items link join public.order_items item on item.id=link.order_item_id
        where link.shipment_id=new.id) then raise check_violation using message='shipment_original_promise_immutable'; end if;
  end if;
  if new.original_expected_ship_date is not null and new.expected_ship_date is null then
    raise check_violation using message='shipment_current_promise_required';
  end if;
  return new;
end $$;
revoke all on function private.freeze_shipment_original_promise() from public,anon,authenticated,service_role;
create trigger shipment_original_promise_immutable before update of original_expected_ship_date,expected_ship_date on public.order_shipments
  for each row execute function private.freeze_shipment_original_promise();

create function private.shipment_preorder_allocation_ready(p_shipment_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select not exists(select 1 from public.order_shipment_items link join public.order_items item on item.id=link.order_item_id
    left join private.goods_preorder_reservations reservation on reservation.order_item_id=item.id
    where link.shipment_id=p_shipment_id and item.supply_source='preorder'
      and (reservation.order_item_id is null or reservation.state<>'allocated'));
$$;
revoke all on function private.shipment_preorder_allocation_ready(uuid) from public,anon,authenticated,service_role;
grant execute on function private.shipment_preorder_allocation_ready(uuid) to postgres;

create function public.shipment_preorder_ready(shipment public.order_shipments) returns boolean
language sql stable security definer set search_path='' as $$
  select private.shipment_preorder_allocation_ready(current_shipment.id)
    from public.order_shipments current_shipment join public.orders purchase on purchase.id=current_shipment.order_id
    where current_shipment.id=shipment.id and (auth.role()='service_role' or public.is_staff() or purchase.user_id=auth.uid());
$$;
revoke all on function public.shipment_preorder_ready(public.order_shipments) from public,anon,authenticated,service_role;
grant execute on function public.shipment_preorder_ready(public.order_shipments) to authenticated,service_role,postgres;

create function private.assert_shipment_preorder_ready(p_shipment_id uuid) returns void
language plpgsql stable security invoker set search_path='' as $$
begin
  if not private.shipment_preorder_allocation_ready(p_shipment_id) then
    raise check_violation using message='preorder_allocation_required';
  end if;
end $$;
revoke all on function private.assert_shipment_preorder_ready(uuid) from public,anon,authenticated,service_role;
grant execute on function private.assert_shipment_preorder_ready(uuid) to postgres;

create function private.guard_preorder_dispatch() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (new.status='shipping' and old.status is distinct from new.status)
    or (new.exported_at is not null and new.exported_at is distinct from old.exported_at) then
    perform private.assert_shipment_preorder_ready(new.id);
  end if;
  return new;
end $$;
revoke all on function private.guard_preorder_dispatch() from public,anon,authenticated,service_role;
create trigger shipment_preorder_dispatch_guard before update of status,exported_at on public.order_shipments
  for each row execute function private.guard_preorder_dispatch();

alter function public.admin_shipment_export(uuid[]) set schema private;
alter function private.admin_shipment_export(uuid[]) rename to admin_shipment_export_before_preorder;
revoke all on function private.admin_shipment_export_before_preorder(uuid[]) from public,anon,authenticated,service_role;
grant execute on function private.admin_shipment_export_before_preorder(uuid[]) to postgres;
create function public.admin_shipment_export(target_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; shipment_id uuid;
begin
  -- The previous writer retains staff, status, selection and cancellation checks.
  result:=private.admin_shipment_export_before_preorder(target_ids);
  for shipment_id in select unnest(target_ids) loop perform private.assert_shipment_preorder_ready(shipment_id); end loop;
  return result;
end $$;
revoke all on function public.admin_shipment_export(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_shipment_export(uuid[]) to authenticated;

create function public.admin_change_shipment_preorder_date(p_shipment_id uuid,p_expected_ship_date date,p_reason text,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); shipment public.order_shipments; purchase public.orders; changed_at timestamptz:=clock_timestamp();
begin
  if actor is null or not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff required'; end if;
  if p_expected_ship_date is null or p_expected_ship_date<(statement_timestamp() at time zone 'Asia/Seoul')::date
    or nullif(btrim(p_reason),'') is null or length(btrim(p_reason))>2000 or p_expected_updated_at is null then
    raise invalid_parameter_value using message='invalid_preorder_shipment_promise';
  end if;
  select purchase_row.* into purchase from public.orders purchase_row join public.order_shipments shipment_row on shipment_row.order_id=purchase_row.id
    where shipment_row.id=p_shipment_id for update of purchase_row;
  if not found then raise no_data_found using message='shipment_not_found'; end if;
  select * into shipment from public.order_shipments where id=p_shipment_id for update;
  if shipment.status<>'ready' or purchase.status not in ('pending','paid','confirmed','shipping') then
    raise check_violation using message='preorder_shipment_already_dispatched';
  end if;
  if shipment.original_expected_ship_date is null then raise check_violation using message='shipment_not_preorder'; end if;
  if shipment.updated_at is distinct from p_expected_updated_at then raise sqlstate 'PT409' using message='shipment_promise_changed'; end if;
  perform private.assert_order_dispatch_allowed(purchase.id);
  if shipment.expected_ship_date=p_expected_ship_date then return jsonb_build_object('changed',false,'updatedAt',shipment.updated_at); end if;
  insert into private.order_shipment_promise_changes(shipment_id,from_date,to_date,reason,actor_id,created_at)
    values(shipment.id,shipment.expected_ship_date,p_expected_ship_date,btrim(p_reason),actor,changed_at);
  update public.order_shipments set expected_ship_date=p_expected_ship_date,updated_at=changed_at where id=shipment.id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipment.preorder_promise_changed','order:'||purchase.id,
    jsonb_build_object('shipmentId',shipment.id,'originalDate',shipment.original_expected_ship_date,'fromDate',shipment.expected_ship_date,
      'toDate',p_expected_ship_date,'reason',btrim(p_reason)));
  return jsonb_build_object('changed',true,'updatedAt',changed_at,'orderId',purchase.id);
end $$;
revoke all on function public.admin_change_shipment_preorder_date(uuid,date,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.admin_change_shipment_preorder_date(uuid,date,text,timestamptz) to authenticated;

create function public.admin_list_shipment_promise_changes(p_shipment_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff required'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',change.id,'fromDate',change.from_date,'toDate',change.to_date,
    'reason',change.reason,'actorName',profile.nickname,'changedAt',change.created_at) order by change.created_at desc,change.id),'[]'::jsonb)
    from private.order_shipment_promise_changes change left join public.profiles profile on profile.id=change.actor_id where change.shipment_id=p_shipment_id);
end $$;
revoke all on function public.admin_list_shipment_promise_changes(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_list_shipment_promise_changes(uuid) to authenticated;

create function public.admin_read_shipment_preorder_promise(p_shipment_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff required'; end if;
  return (select jsonb_build_object('shipmentId',shipment.id,'orderId',shipment.order_id,'status',shipment.status,
    'originalExpectedShipDate',shipment.original_expected_ship_date,'expectedShipDate',shipment.expected_ship_date,'updatedAt',shipment.updated_at,
    'changes',public.admin_list_shipment_promise_changes(shipment.id)) from public.order_shipments shipment where shipment.id=p_shipment_id);
end $$;
revoke all on function public.admin_read_shipment_preorder_promise(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_read_shipment_preorder_promise(uuid) to authenticated;

create or replace function private.order_shipment_records(target_order uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',shipment.id,'orderId',shipment.order_id,'originId',shipment.origin_id,
    'originName',shipment.origin_name_snapshot,'shippingFee',shipment.shipping_fee,'status',shipment.status,'carrier',shipment.carrier,
    'carrierLabel',coalesce(carrier.label,shipment.carrier),'trackingNumber',shipment.tracking_number,
    'trackingUrl',case when shipment.tracking_number is not null then replace(carrier.tracking_url_template,'{trackingNumber}',shipment.tracking_number) end,
    'shippedAt',shipment.shipped_at,'deliveredAt',shipment.delivered_at,'exportedAt',shipment.exported_at,
    'originalExpectedShipDate',shipment.original_expected_ship_date,'expectedShipDate',shipment.expected_ship_date,
    'preorderReady',private.shipment_preorder_allocation_ready(shipment.id),
    'orderItemIds',(select coalesce(jsonb_agg(item.order_item_id order by item.order_item_id),'[]')
      from public.order_shipment_items item where item.shipment_id=shipment.id)) order by shipment.created_at,shipment.id),'[]')
  from public.order_shipments shipment left join public.shipping_carriers carrier on carrier.code=shipment.carrier where shipment.order_id=target_order;
$$;
revoke all on function private.order_shipment_records(uuid) from public,anon,authenticated,service_role;
grant execute on function private.order_shipment_records(uuid) to postgres;

alter function public.admin_order_detail(uuid) set schema private;
alter function private.admin_order_detail(uuid) rename to admin_order_detail_before_preorder;
revoke all on function private.admin_order_detail_before_preorder(uuid) from public,anon,authenticated,service_role;
grant execute on function private.admin_order_detail_before_preorder(uuid) to postgres;
create function public.admin_order_detail(target_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; items jsonb;
begin
  result:=private.admin_order_detail_before_preorder(target_order_id);
  if result is null then return null; end if;
  select coalesce(jsonb_agg(line.value||jsonb_build_object('supplySource',item.supply_source,
    'preorderExpectedShipDate',item.preorder_expected_ship_date,'preorderSnapshot',item.preorder_snapshot) order by line.ordinality),'[]') into items
    from jsonb_array_elements(result->'items') with ordinality line(value,ordinality)
    join public.order_items item on item.id=(line.value->>'id')::uuid and item.order_id=target_order_id;
  return result||jsonb_build_object('order',(result->'order')||jsonb_build_object('storeCreditTotal',
    (select store_credit_total from public.orders where id=target_order_id)),
    'shipments',private.order_shipment_records(target_order_id),'items',items);
end $$;
revoke all on function public.admin_order_detail(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_detail(uuid) to authenticated;

-- Preorders become delayed after their current promised date, not three days after payment.
create or replace function public.admin_search_shipments(p_tab text,p_origin_id uuid default null,p_query text default null,
 p_from date default null,p_to date default null,p_limit integer default 100,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;needle text:=nullif(btrim(p_query),'');
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 if p_tab is null or p_tab not in ('new','ready','delayed','transit','delivered') or p_limit is null or p_limit not between 1 and 1000 or p_offset is null or p_offset<0
   or length(needle)>100 or (p_from is not null and p_to is not null and p_from>p_to) then raise invalid_parameter_value using message='invalid_shipment_search';end if;
 with matched as materialized (
  select s.*,o.user_id,o.created_at order_created_at,o.confirmed_at,o.total,o.status order_status,
   coalesce(nullif(p.nickname,''),'fan_'||left(o.user_id::text,6)) buyer_name,o.address->>'recipientName' recipient_name,
   o.payment_method,coalesce((select change.reason from private.order_shipment_promise_changes change where change.shipment_id=s.id order by change.created_at desc,change.id limit 1),delay.reason) delay_reason,
   coalesce(s.expected_ship_date,delay.expected_ship_date) delay_expected_date,
   o.status='paid' and s.status='ready' is_new,
   o.status in ('confirmed','shipping') and s.status='ready' is_ready,
   o.status in ('confirmed','shipping') and s.status='ready' and case when s.original_expected_ship_date is not null
     then s.expected_ship_date<(statement_timestamp() at time zone 'Asia/Seoul')::date
     else o.confirmed_at<now()-interval '3 days' end is_delayed,
   o.status<>'canceled' and s.status='shipping' is_transit,
   o.status<>'canceled' and s.status='delivered' is_delivered
  from public.order_shipments s join public.orders o on o.id=s.order_id
  left join public.profiles p on p.id=o.user_id left join public.order_dispatch_delays delay on delay.order_id=o.id
  where (p_origin_id is null or s.origin_id=p_origin_id)
    and (p_from is null or o.created_at>=p_from::timestamp at time zone 'Asia/Seoul')
    and (p_to is null or o.created_at<(p_to+1)::timestamp at time zone 'Asia/Seoul')
    and (needle is null or s.id::text ilike '%'||needle||'%' or o.id::text ilike '%'||needle||'%'
      or p.nickname ilike '%'||needle||'%' or p.email ilike '%'||needle||'%' or o.address->>'recipientName' ilike '%'||needle||'%')
 ), filtered as materialized (
  select * from matched where case p_tab when 'new' then is_new when 'ready' then is_ready when 'delayed' then is_delayed when 'transit' then is_transit else is_delivered end
 ), page as (select * from filtered order by order_created_at,id limit p_limit offset p_offset), output as (
 select page.*,coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.good_name_snapshot,'variantName',i.variant_name_snapshot,'qty',i.qty) order by i.id)
  from public.order_shipment_items link join public.order_items i on i.id=link.order_item_id where link.shipment_id=page.id),'[]') items from page
 ) select jsonb_build_object('total',(select count(*) from filtered),'counts',(select jsonb_build_object(
   'new',count(*) filter(where is_new),'ready',count(*) filter(where is_ready),'delayed',count(*) filter(where is_delayed),
   'transit',count(*) filter(where is_transit),'delivered',count(*) filter(where is_delivered)) from matched),
   'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'orderId',order_id,'originId',origin_id,'originName',origin_name_snapshot,
    'status',status,'createdAt',order_created_at,'confirmedAt',confirmed_at,'buyerName',buyer_name,'recipientName',recipient_name,
    'total',total,'paymentMethod',payment_method,'shippingFee',shipping_fee,'carrier',carrier,'trackingNumber',tracking_number,
    'shippedAt',shipped_at,'deliveredAt',delivered_at,'exportedAt',exported_at,'updatedAt',updated_at,
    'delayReason',delay_reason,'expectedShipDate',delay_expected_date,'originalExpectedShipDate',original_expected_ship_date,
    'preorderReady',private.shipment_preorder_allocation_ready(id),'items',items) order by order_created_at,id) from output),'[]')) into result;
 return result;
end $$;
revoke all on function public.admin_search_shipments(text,uuid,text,date,date,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_shipments(text,uuid,text,date,date,integer,integer) to authenticated;

-- Only after both supply/cancel and dispatch contracts exist may an operator
-- activate a preorder. This marker has no client-callable runtime grant.
create function private.preorder_checkout_ready() returns boolean language sql immutable set search_path='' as $$ select true; $$;
revoke all on function private.preorder_checkout_ready() from public,anon,authenticated,service_role;
grant execute on function private.preorder_checkout_ready() to postgres;
notify pgrst,'reload schema';
