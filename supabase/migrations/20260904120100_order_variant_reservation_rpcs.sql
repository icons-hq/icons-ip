-- D-1b ② — 주문 경로의 재고 효과: 예약 · 출고 차감 · 예약 해제 · 반품 재입고 (설계서 v2 §1-1 RPC 표)
--
-- | 전이 | 재고 효과 | 사유 코드 |
-- | 주문 생성 | 예약 += qty | order_reserve |
-- | 배송중 처리 | 보유 -= qty, 예약 -= qty | order_ship |
-- | 출고 전 취소·만료 | 예약 -= qty | order_release |
-- | 출고 후 취소·반품 | 보유 += qty | return_restock |
--
-- 어느 전이에서도 가용(= 보유 − 예약) 변화량이 옛 즉시 차감 모델과 같아서 `goods.stock/stock_qty`
-- 캐시·재입고 알림·카트 검사·목록 상태는 그대로다. 이동 기록 id 는 (주문 항목, 사유)로 결정되므로
-- 같은 전이가 두 번 실행되면 조용히 두 배가 되는 대신 unique 위반으로 시끄럽게 실패한다.

-- 카트 한 줄이 어느 품목·출고지로 나가는지 결정한다. 항상 1행을 돌려주거나 예외를 던진다.
create or replace function private.resolve_order_variant(p_good_id text, p_variant_id uuid)
returns table (variant_id uuid, location_id text, variant_code text, option_summary text)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_default_location text;
  v_candidates integer;
  v_variant record;
begin
  select good.default_location_id into v_default_location
  from public.goods as good
  where good.id = p_good_id;
  if v_default_location is null then
    raise check_violation using message = pg_catalog.format('out of stock: %s', p_good_id);
  end if;

  if p_variant_id is null then
    select count(*) into v_candidates
    from public.good_variants as variant
    where variant.good_id = p_good_id and variant.archived_at is null and variant.sellable;
    if v_candidates > 1 then
      -- 옵션이 붙은 상품은 어느 품목을 사는지 골라야 한다. 임의로 하나를 고르면 엉뚱한 재고가 나간다.
      raise check_violation using message = pg_catalog.format('variant required: %s', p_good_id);
    end if;
    select * into v_variant
    from public.good_variants as variant
    where variant.good_id = p_good_id and variant.archived_at is null and variant.sellable;
  else
    select * into v_variant
    from public.good_variants as variant
    where variant.id = p_variant_id and variant.good_id = p_good_id;
  end if;

  if v_variant.id is null or v_variant.archived_at is not null or not v_variant.sellable then
    raise check_violation using message = pg_catalog.format('out of stock: %s', p_good_id);
  end if;

  return query
  select
    v_variant.id,
    coalesce(v_variant.location_id, v_default_location),
    v_variant.code,
    coalesce((
      select pg_catalog.string_agg(master.name || ': ' || value.value, ' / ' order by used.position)
      from public.variant_option_values as chosen
      join public.option_values as value on value.id = chosen.value_id
      join public.option_masters as master on master.id = chosen.option_id
      join public.good_options as used on used.good_id = p_good_id and used.option_id = chosen.option_id
      where chosen.variant_id = v_variant.id
    ), '');
end;
$$;

-- 주문 한 줄의 예약. 가용이 모자라면 기존 문구 그대로 실패한다(앱이 'out of stock' 을 읽는다).
create or replace function private.reserve_order_item(
  p_order_id uuid,
  p_order_item_id uuid,
  p_good_id text,
  p_variant_id uuid,
  p_location_id text,
  p_qty integer
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_stock record;
  v_good record;
begin
  select good.stock, good.archived_at into v_good
  from public.goods as good
  where good.id = p_good_id;
  -- 운영자가 판매를 멈춘 상품(stock_override='soldout')과 보관 상품은 수량과 무관하게 팔지 않는다.
  if v_good.archived_at is not null or v_good.stock = 'soldout' then
    raise check_violation using message = pg_catalog.format('out of stock: %s', p_good_id);
  end if;

  insert into public.variant_stocks (variant_id, location_id, last_source)
  values (p_variant_id, p_location_id, 'system')
  on conflict (variant_id, location_id) do nothing;

  select stock.on_hand_qty, stock.reserved_qty into v_stock
  from public.variant_stocks as stock
  where stock.variant_id = p_variant_id and stock.location_id = p_location_id
  for update;

  if v_stock.on_hand_qty - v_stock.reserved_qty < p_qty then
    raise check_violation using message = pg_catalog.format('out of stock: %s', p_good_id);
  end if;

  perform private.apply_stock_movement(
    pg_catalog.gen_random_uuid(),
    p_variant_id, p_location_id, 0, p_qty,
    'order_reserve', 'order', 'order', p_order_id::text, null, null, false
  );
end;
$$;

/*
 * 주문 전체에 같은 재고 효과를 적용한다. 잠금 순서는 (품목, 출고지) 오름차순.
 *
 * 예약된 수량만 풀거나 확정한다 — 예약이 없는 주문 항목(이관 전 데이터·직접 넣은 픽스처)이라도
 * 가용 변화량은 옛 즉시 차감 모델과 같게 맞춘다. 그래서 취소는 「예약 해제 + 남는 만큼 보유 복원」이고,
 * 출고는 「예약된 만큼만 보유 차감」이다. 어느 쪽도 수량을 음수로 만들지 않는다.
 */
create or replace function private.apply_order_stock_effect(p_order_id uuid, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_item record;
  v_reserved integer;
  v_settled integer;
  v_delta_on_hand integer;
  v_delta_reserved integer;
begin
  for v_item in
    select item.id, item.variant_id, item.location_id, item.qty
    from public.order_items as item
    where item.order_id = p_order_id
    order by item.variant_id, item.location_id, item.id
  loop
    insert into public.variant_stocks (variant_id, location_id, last_source)
    values (v_item.variant_id, v_item.location_id, 'system')
    on conflict (variant_id, location_id) do nothing;

    select stock.reserved_qty into v_reserved
    from public.variant_stocks as stock
    where stock.variant_id = v_item.variant_id and stock.location_id = v_item.location_id
    for update;

    v_settled := least(v_item.qty, v_reserved);
    if p_reason = 'order_ship' then
      v_delta_reserved := -v_settled;
      v_delta_on_hand := -v_settled;
    elsif p_reason = 'order_release' then
      v_delta_reserved := -v_settled;
      v_delta_on_hand := v_item.qty - v_settled;
    elsif p_reason = 'return_restock' then
      v_delta_reserved := 0;
      v_delta_on_hand := v_item.qty;
    else
      raise check_violation using message = 'invalid_order_stock_reason';
    end if;

    if v_delta_on_hand = 0 and v_delta_reserved = 0 then
      continue;
    end if;

    /*
     * 이동 기록 id 는 무작위다. 같은 전이가 두 번 일어나지 않게 막는 것은 주문 상태 기계의 몫이고
     * (취소는 canceled 를 다시 취소하지 않고, 출고는 confirmed → shipping 한 번만 지난다),
     * 원장은 실제로 일어난 사건을 순서대로 쌓는다 — 같은 주문이 다시 살아나는 흐름도 기록할 수 있어야 한다.
     */
    perform private.apply_stock_movement(
      pg_catalog.gen_random_uuid(),
      v_item.variant_id, v_item.location_id, v_delta_on_hand, v_delta_reserved,
      p_reason, case when p_reason = 'return_restock' then 'claim' else 'order' end,
      'order', p_order_id::text,
      case when v_settled < v_item.qty and p_reason <> 'return_restock'
        then '예약 없는 수량 ' || (v_item.qty - v_settled)::text || '개 포함(이관 전 주문)'
      end,
      null, false
    );
  end loop;
end;
$$;

create or replace function private.release_order_reservation(p_order_id uuid)
returns void
language sql
set search_path = ''
as $$
  select private.apply_order_stock_effect(p_order_id, 'order_release');
$$;

create or replace function private.consume_order_reservation(p_order_id uuid)
returns void
language sql
set search_path = ''
as $$
  select private.apply_order_stock_effect(p_order_id, 'order_ship');
$$;

create or replace function private.restock_order_items(p_order_id uuid, p_reason text)
returns void
language sql
set search_path = ''
as $$
  select private.apply_order_stock_effect(p_order_id, p_reason);
$$;

revoke all on function private.resolve_order_variant(text, uuid) from public;
revoke all on function private.reserve_order_item(uuid, uuid, text, uuid, text, integer) from public;
revoke all on function private.apply_order_stock_effect(uuid, text) from public;
revoke all on function private.release_order_reservation(uuid) from public;
revoke all on function private.consume_order_reservation(uuid) from public;
revoke all on function private.restock_order_items(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- 주문 RPC 교체 (본문은 현행 정의에서 재고 구간만 바꾼 것)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.place_order(p_address jsonb, p_checkout_key uuid, p_payment_method order_payment_method)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order_item uuid;
  -- lib/shipping.ts의 SHIPPING_FEE · FREE_SHIPPING_THRESHOLD와 같은 값이어야 한다.
  c_shipping_fee constant bigint := 3000;
  c_free_shipping_threshold constant bigint := 50000;
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
  r record;
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

  /*
   * 카트와 재고를 같은 결정적 순서로 잠근 뒤 DB 값만으로 주문 스냅샷을 만든다.
   * D-1b: 주문 생성은 재고를 깎지 않고 **예약**한다(품목 × 출고지의 reserved += qty).
   * 실물이 창고를 떠나는 시점(배송중 처리)에 보유가 줄고, 출고 전 취소·만료는 예약만 푼다.
   * 잠금 순서는 (품목, 출고지) 오름차순 — 재고 조정·이동 RPC 와 같은 순서라 서로 데드락하지 않는다.
   */
  for r in
    select
      cart.good_id,
      cart.qty,
      good.price,
      good.name,
      good.type,
      good.ip_id,
      good.allow_bank_transfer,
      resolved.variant_id,
      resolved.location_id,
      resolved.variant_code,
      resolved.option_summary
    from public.cart_items as cart
    join public.goods as good on good.id = cart.good_id
    cross join lateral private.resolve_order_variant(cart.good_id, cart.variant_id) as resolved
    where cart.user_id = v_user
    order by resolved.variant_id, resolved.location_id
    for update of cart, good
  loop
    v_item_count := v_item_count + 1;

    if p_payment_method = 'bank_transfer' and not r.allow_bank_transfer then
      raise check_violation using message = format('bank transfer blocked: %s', r.good_id);
    end if;

    insert into public.order_items (
      order_id,
      good_id,
      qty,
      unit_price,
      good_name_snapshot,
      good_type_snapshot,
      good_ip_id_snapshot,
      variant_id,
      location_id,
      variant_code_snapshot,
      option_summary_snapshot
    )
    values (
      v_order,
      r.good_id,
      r.qty,
      r.price,
      r.name,
      r.type,
      r.ip_id,
      r.variant_id,
      r.location_id,
      r.variant_code,
      r.option_summary
    )
    returning id into v_order_item;

    perform private.reserve_order_item(v_order, v_order_item, r.good_id, r.variant_id, r.location_id, r.qty);

    -- 조회 시 잠근 스냅샷 행만 지운다. 동시에 새로 담긴 다른 상품까지
    -- 마지막 broad delete가 없애지 않도록 상품 단위로 소비한다.
    delete from public.cart_items
    where user_id = v_user
      and good_id = r.good_id;

    v_subtotal := v_subtotal + (r.price::bigint * r.qty::bigint);
  end loop;

  if v_item_count = 0 then
    raise check_violation using message = 'cart empty';
  end if;

  -- 배송비 판정은 할인 전 소계 기준이다 — 쿠폰이 무료배송 경계를 흔들면
  -- 카트의 "얼마 더 담으면 무료배송" 안내가 거짓말이 된다.
  if v_subtotal > 0 and v_subtotal < c_free_shipping_threshold then
    v_shipping_fee := c_shipping_fee;
  end if;

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

  update public.orders
  set total = v_subtotal + v_shipping_fee - v_discount,
      shipping_fee = v_shipping_fee,
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
        to_char(v_subtotal + v_shipping_fee - v_discount, 'FM999,999,999'),
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

CREATE OR REPLACE FUNCTION public.place_order(p_address jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user  uuid := (select auth.uid());
  v_order uuid;
  v_total bigint := 0;
  r record;
  v_order_item uuid;
begin
  if v_user is null then raise exception 'auth required'; end if;
  if not exists (select 1 from cart_items where user_id = v_user) then
    raise exception 'cart empty';
  end if;

  insert into orders (user_id, status, total, address, expires_at)
  values (v_user, 'pending', 0, p_address, now() + interval '15 minutes')
  returning id into v_order;

  -- 카트 항목을 결정적 순서로 잠가 데드락 회피
  for r in
    select c.good_id, c.qty, g.price, resolved.variant_id, resolved.location_id,
           resolved.variant_code, resolved.option_summary
    from cart_items c
    join goods g on g.id = c.good_id
    cross join lateral private.resolve_order_variant(c.good_id, c.variant_id) as resolved
    where c.user_id = v_user
    order by resolved.variant_id, resolved.location_id
    for update of g
  loop
    insert into order_items (
      order_id, good_id, qty, unit_price, variant_id, location_id,
      variant_code_snapshot, option_summary_snapshot
    )
    values (
      v_order, r.good_id, r.qty, r.price, r.variant_id, r.location_id,
      r.variant_code, r.option_summary
    )
    returning id into v_order_item;
    perform private.reserve_order_item(v_order, v_order_item, r.good_id, r.variant_id, r.location_id, r.qty);
    v_total := v_total + r.price * r.qty;
  end loop;

  update orders set total = v_total where id = v_order;
  delete from cart_items where user_id = v_user;
  return v_order;  -- 클라이언트는 이 주문으로 토스 결제 시작
end; $function$;

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
    /*
     * D-1b: 재고를 되돌리는 방법이 출고 전후로 다르다.
     * 출고 전(pending·paid·confirmed) = 예약만 풀면 실물은 창고에 그대로 있다.
     * 출고 후(shipping·delivered·done) = 실물이 나갔으므로 반품 재입고로 보유를 늘린다.
     * 두 경우 모두 가용(= 보유 − 예약)이 qty 만큼 늘어 goods 캐시는 이전과 같은 값이 된다.
     */
    if v_status in ('shipping', 'delivered', 'done') then
      perform private.restock_order_items(p_order_id, 'return_restock');
    else
      perform private.release_order_reservation(p_order_id);
    end if;

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

CREATE OR REPLACE FUNCTION public.admin_update_order_status(p_order_id uuid, p_status order_status, p_carrier text, p_tracking_number text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_current_status public.order_status;
  v_current_carrier text;
  v_current_tracking text;
  v_carrier text := nullif(btrim(coalesce(p_carrier, '')), '');
  v_tracking text := nullif(btrim(coalesce(p_tracking_number, '')), '');
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  select orders.status, orders.shipping_carrier, orders.tracking_number
  into v_current_status, v_current_carrier, v_current_tracking
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order_not_found';
  end if;

  if p_status not in ('confirmed', 'shipping', 'delivered') then
    raise check_violation using message = 'invalid_order_status';
  end if;

  if v_current_status = p_status then
    return;
  end if;

  if not (
    (v_current_status = 'paid' and p_status = 'confirmed')
    or (v_current_status = 'confirmed' and p_status = 'shipping')
    or (v_current_status = 'shipping' and p_status = 'delivered')
  ) then
    raise exception using message = 'invalid_order_transition';
  end if;

  if exists (
    select 1
    from public.order_cancellation_requests as request
    where request.order_id = p_order_id
      and request.status in ('requested', 'processing', 'needs_review')
  ) then
    raise check_violation using message = 'order cancellation in progress';
  end if;

  -- 승인된 청약철회는 durable claim으로 남아 finalizer를 기다린다. 그 사이
  -- 주문을 앞으로 미는 것은 환불 대상 주문을 계속 처리하는 것이라 막는다.
  if exists (
    select 1
    from public.order_cancellation_claims as claim
    where claim.order_id = p_order_id
  ) then
    raise check_violation using message = 'order cancellation in progress';
  end if;

  -- 입력을 생략하면 이미 등록된 운송장을 유지한다. 배송 완료 전이가 송장을
  -- 조용히 지우지 않게 하는 장치다.
  v_carrier := coalesce(v_carrier, v_current_carrier);
  v_tracking := coalesce(v_tracking, v_current_tracking);

  if (v_carrier is null) <> (v_tracking is null) then
    raise check_violation using message = 'invalid_tracking_input';
  end if;

  -- 운송장 없이 배송을 시작하면 고객이 배송을 추적할 수 없다. fail closed한다.
  if p_status = 'shipping' and v_tracking is null then
    raise check_violation using message = 'tracking_required';
  end if;

  -- D-1b: 실물이 창고를 떠나는 시점 = 배송중 처리(PM 기본안). 예약을 보유 차감으로 확정한다.
  if p_status = 'shipping' then
    perform private.consume_order_reservation(p_order_id);
  end if;

  -- 새로 붙는 택배사만 활성 여부를 본다. 이미 붙어 있던 코드가 그 사이
  -- 비활성화됐다고 배송완료 전이가 막히면 안 된다.
  if v_carrier is not null and v_carrier is distinct from v_current_carrier then
    if not exists (
      select 1
      from public.shipping_carriers as carrier
      where carrier.code = v_carrier
        and carrier.is_active
    ) then
      raise check_violation using message = 'inactive_shipping_carrier';
    end if;
  end if;

  update public.orders
  set
    status = p_status,
    shipping_carrier = v_carrier,
    tracking_number = v_tracking,
    confirmed_at = case when p_status = 'confirmed' then now() else confirmed_at end,
    shipped_at = case when p_status = 'shipping' then now() else shipped_at end,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end
  where id = p_order_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.status_updated',
    'order:' || p_order_id::text,
    jsonb_build_object(
      'from', v_current_status::text,
      'to', p_status::text,
      'carrier', v_carrier,
      'trackingNumber', v_tracking
    )
  );
end;
$function$;
