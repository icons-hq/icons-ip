-- The service checkout consumes exactly the complete cart the customer saw.
-- Existing trusted checkout RPCs keep their ABI and all pricing/finalizers.
create or replace function public.place_order_with_cart_snapshot(
 p_user_id uuid,p_address jsonb,p_checkout_key uuid,p_payment_method public.order_payment_method,
 p_store_credit_amount bigint,p_expected_user_coupon_id uuid,p_expected_cart jsonb
) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare expected_cart jsonb; actual_cart jsonb; entry jsonb;
begin
 if p_user_id is null or p_checkout_key is null then raise invalid_parameter_value using message='invalid_checkout_cart_snapshot'; end if;
 -- Match the pre-existing checkout/coupon lock order: user, then cart. Replays
 -- validate their original order contract without looking at today's cart.
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 if exists(select 1 from public.orders where user_id=p_user_id and checkout_key=p_checkout_key) then
   return public.place_order_with_store_credits(p_user_id,p_address,p_checkout_key,p_payment_method,p_store_credit_amount,p_expected_user_coupon_id);
 end if;
 if jsonb_typeof(p_expected_cart) is distinct from 'array' then raise invalid_parameter_value using message='invalid_checkout_cart_snapshot'; end if;
 for entry in select value from jsonb_array_elements(p_expected_cart) loop
   if jsonb_typeof(entry)<>'object' or not(entry ?& array['good_id','variant_id','qty','input_revision','input_values'])
     or exists(select 1 from jsonb_object_keys(entry) key where key not in ('good_id','variant_id','qty','input_revision','input_values'))
     or jsonb_typeof(entry->'good_id')<>'string' or nullif(btrim(entry->>'good_id'),'') is null
     or jsonb_typeof(entry->'variant_id')<>'string' or entry->>'variant_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or jsonb_typeof(entry->'qty')<>'number' or entry->>'qty'!~'^[1-9][0-9]*$'
     or jsonb_typeof(entry->'input_revision')<>'number' or entry->>'input_revision'!~'^(0|[1-9][0-9]*)$'
     or jsonb_typeof(entry->'input_values')<>'object' then
     raise invalid_parameter_value using message='invalid_checkout_cart_snapshot';
   end if;
 end loop;
 -- Compare canonical values, not labels or hashes supplied by the browser.
 select coalesce(jsonb_agg(value order by value->>'good_id',(value->>'variant_id')::uuid,value->>'input_revision',(value->'input_values')::text),'[]')
   into expected_cart from jsonb_array_elements(p_expected_cart);
 perform pg_advisory_xact_lock(hashtextextended('cart:'||p_user_id::text,0));
 select coalesce(jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,
   'input_revision',input_revision,'input_values',input_values) order by good_id,variant_id,input_revision::text,input_values::text),'[]')
   into actual_cart from public.cart_items where user_id=p_user_id;
 if expected_cart is distinct from actual_cart then raise sqlstate 'PT409' using message='cart_snapshot_changed'; end if;
 return public.place_order_with_store_credits(p_user_id,p_address,p_checkout_key,p_payment_method,p_store_credit_amount,p_expected_user_coupon_id);
end $$;
revoke all on function public.place_order_with_cart_snapshot(uuid,jsonb,uuid,public.order_payment_method,bigint,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.place_order_with_cart_snapshot(uuid,jsonb,uuid,public.order_payment_method,bigint,uuid,jsonb) to service_role;

-- Fully replace the prior core in the migration chain. Prelock each parent
-- before scanning its cart rows; stock cache updates must not skip later rows.
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
  v_custom_inputs_snapshot jsonb;
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
  -- Lock parents before opening the cart cursor. Locking the same parent in
  -- that cursor while stock triggers update it can make PostgreSQL skip rows
  -- after a cursor fetch boundary. Cart rows themselves remain locked below.
  perform 1 from public.goods good
    join (select distinct good_id from public.cart_items where user_id=v_user) selected on selected.good_id=good.id
    order by good.id for update of good;
  for r in
    select
      cart.id as cart_item_id,
      cart.good_id,
      cart.variant_id,
      cart.qty,
      cart.input_revision,
      cart.input_values,
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
    order by cart.good_id, cart.variant_id, cart.id
    for update of cart
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
    v_custom_inputs_snapshot:=private.resolve_goods_custom_inputs(r.good_id,r.input_revision,r.input_values);

    -- A variant may have several buyer-input lines. Check a good before its
    -- first line is consumed, summing every selected line and optional add-on.
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
      preorder_snapshot,
      custom_inputs_snapshot
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
        'expectedShipDate',v_supply.expected_ship_date) end,
      v_custom_inputs_snapshot
    ) returning id into v_new_order_item;
    if v_supply.mode='preorder' then
      perform private.reserve_goods_preorder_item(v_new_order_item,v_price_at);
    end if;

    -- 조회 시 잠근 스냅샷 행만 지운다. 동시에 새로 담긴 다른 상품까지
    -- 마지막 broad delete가 없애지 않도록 상품 단위로 소비한다.
    delete from public.cart_items
    where user_id = v_user
      and id = r.cart_item_id;

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
grant execute on function private.place_order_before_shipments(jsonb,uuid,public.order_payment_method) to postgres;

notify pgrst,'reload schema';
