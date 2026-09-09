-- #410: hiding an IP also closes fresh order/reservation creation, including
-- forms opened before unpublishing. Read filters are not purchase authorization.
--
-- Existing order/reservation idempotency returns remain before the new guard.
-- Confirmation, reconciliation, expiration, cancellation and history reads are
-- unchanged: catalog availability never rewrites frozen commercial records.
--
-- Lock order is the existing good/event row, then its IP FOR SHARE. Holding the
-- child prevents parent reassignment. set_ip_published takes only the IP UPDATE
-- lock and writes audit_log, so it never takes the child lock in reverse order.
-- A SHARE lock (not KEY SHARE) also conflicts with ordinary non-key IP updates.
create function private.assert_ip_purchasable(target_id text)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  ip_archived_at timestamptz;
  ip_published_at timestamptz;
begin
  -- Platform events intentionally have no parent IP.
  if target_id is null then return; end if;
  select ip.archived_at, ip.published_at
    into ip_archived_at, ip_published_at
  from public.ips as ip
  where ip.id = target_id
  for share of ip;
  if not found or ip_archived_at is not null or ip_published_at is null then
    raise check_violation using message = 'catalog_item_unavailable';
  end if;
end;
$$;
revoke all on function private.assert_ip_purchasable(text)
  from public, anon, authenticated, service_role;

-- Preserve the latest coupon, sale-restriction and payment-provider behavior.
create or replace function public.place_order(
  p_address jsonb,
  p_checkout_key uuid,
  p_payment_method public.order_payment_method
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
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

  -- 카트와 재고를 같은 결정적 순서로 잠근 뒤 DB 값만으로 주문 스냅샷을 만든다.
  for r in
    select
      cart.good_id,
      cart.qty,
      good.price,
      good.stock,
      good.stock_qty,
      good.name,
      good.type,
      good.ip_id,
      good.allow_bank_transfer,
      good.sale_restriction
    from public.cart_items as cart
    join public.goods as good on good.id = cart.good_id
    where cart.user_id = v_user
    order by cart.good_id
    for update of cart, good
  loop
    -- The locked good fixes its parent association. Keep the IP SHARE lock until
    -- this order commits, serializing new purchases with an unpublish UPDATE.
    perform private.assert_ip_purchasable(r.ip_id);
    v_item_count := v_item_count + 1;

    if r.stock = 'soldout' or r.stock_qty < r.qty then
      raise check_violation using message = format('out of stock: %s', r.good_id);
    end if;

    if p_payment_method = 'bank_transfer' and not r.allow_bank_transfer then
      raise check_violation using message = format('bank transfer blocked: %s', r.good_id);
    end if;

    -- 성인인증(#209·#210)이 도입되기 전까지 판매 제한 상품은 서버가 구매를
    -- 차단한다. 결제수단과 무관한 상품 축이라 무통장 검사와 별개로 판정한다.
    if r.sale_restriction <> 'none' then
      raise check_violation using message = format('restricted good blocked: %s', r.good_id);
    end if;

    update public.goods
    set stock_qty = stock_qty - r.qty
    where id = r.good_id;

    insert into public.order_items (
      order_id,
      good_id,
      qty,
      unit_price,
      good_name_snapshot,
      good_type_snapshot,
      good_ip_id_snapshot
    )
    values (
      v_order,
      r.good_id,
      r.qty,
      r.price,
      r.name,
      r.type,
      r.ip_id
    );

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
$$;

create or replace function public.reserve_tickets(
  p_user_id uuid,
  p_ticket_type_id uuid,
  p_qty integer,
  p_reservation_key uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := p_user_id;
  v_event_id text;
  v_locked_event_id text;
  v_event_status text;
  v_ip_id text;
  v_capacity integer;
  v_sold integer;
  v_price integer;
  v_per_user_limit integer;
  v_sales_open_at timestamptz;
  v_existing_order public.ticket_orders%rowtype;
  v_existing_reservation public.ticket_order_reservations%rowtype;
  v_already_reserved bigint;
  v_order_id uuid;
begin
  if v_user is null then
    raise not_null_violation using message = 'user required';
  end if;

  perform private.assert_active_user(v_user);

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
  ) or private.is_account_write_fenced(v_user) then
    raise insufficient_privilege using message = 'onboarding required';
  end if;

  if p_qty is null or p_qty < 1 then
    raise check_violation using message = 'quantity must be positive';
  end if;
  if p_reservation_key is null then
    raise not_null_violation using message = 'reservation key required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ticket_reservation:' || v_user::text || ':' || p_reservation_key::text,
      0
    )
  );

  select ticket_order.*
  into v_existing_order
  from public.ticket_orders as ticket_order
  where ticket_order.user_id = v_user
    and ticket_order.reservation_key = p_reservation_key
  for share;

  if found then
    select reservation.*
    into v_existing_reservation
    from public.ticket_order_reservations as reservation
    where reservation.ticket_order_id = v_existing_order.id;

    if found
      and v_existing_reservation.ticket_type_id = p_ticket_type_id
      and v_existing_reservation.quantity = p_qty
    then
      return v_existing_order.id;
    end if;
    raise unique_violation using message = 'reservation conflict';
  end if;

  select ticket_type.event_id
  into v_event_id
  from public.ticket_types as ticket_type
  where ticket_type.id = p_ticket_type_id;
  if not found then
    raise no_data_found using message = 'ticket type not found';
  end if;

  select event_record.status, event_record.ip_id
  into v_event_status, v_ip_id
  from public.events as event_record
  where event_record.id = v_event_id
  for share of event_record;
  if not found then
    raise no_data_found using message = 'event not found';
  end if;

  -- Event SHARE fixes ip_id; the parent SHARE lock lives through reservation
  -- commit. Platform events without an IP remain bookable.
  perform private.assert_ip_purchasable(v_ip_id);

  select
    ticket_type.event_id,
    ticket_type.capacity,
    ticket_type.sold,
    ticket_type.price,
    ticket_type.per_user_limit,
    ticket_type.sales_open_at
  into
    v_locked_event_id,
    v_capacity,
    v_sold,
    v_price,
    v_per_user_limit,
    v_sales_open_at
  from public.ticket_types as ticket_type
  where ticket_type.id = p_ticket_type_id
  for update of ticket_type;

  if not found then
    raise no_data_found using message = 'ticket type not found';
  end if;
  if v_locked_event_id is distinct from v_event_id then
    raise serialization_failure using message = 'ticket type changed';
  end if;
  if v_event_status <> '예매중' then
    raise check_violation using message = 'event not bookable';
  end if;
  if v_price <= 0 then
    raise check_violation using message = 'paid ticket required';
  end if;
  if v_sales_open_at is not null and now() < v_sales_open_at then
    raise check_violation using message = 'sales not open';
  end if;
  if p_qty::bigint > v_capacity::bigint - v_sold::bigint then
    raise check_violation using message = 'sold out';
  end if;

  select coalesce(sum(reservation.quantity), 0)
  into v_already_reserved
  from public.ticket_order_reservations as reservation
  join public.ticket_orders as ticket_order
    on ticket_order.id = reservation.ticket_order_id
  where reservation.ticket_type_id = p_ticket_type_id
    and ticket_order.user_id = v_user
    and ticket_order.status <> 'canceled';

  if v_already_reserved + p_qty::bigint > v_per_user_limit::bigint then
    raise check_violation using message = 'per-user limit exceeded';
  end if;

  update public.ticket_types
  set sold = sold + p_qty
  where id = p_ticket_type_id;

  insert into public.ticket_orders (
    user_id,
    event_id,
    status,
    total,
    expires_at,
    reservation_key
  )
  values (
    v_user,
    v_event_id,
    'pending',
    v_price::bigint * p_qty::bigint,
    now() + interval '10 minutes',
    p_reservation_key
  )
  returning id into v_order_id;

  insert into public.ticket_order_reservations (
    ticket_order_id,
    ticket_type_id,
    quantity,
    unit_price
  )
  values (v_order_id, p_ticket_type_id, p_qty, v_price);

  return v_order_id;
end;
$function$;

-- These are existing boundaries: the inner order function stays closed, and
-- the user-scoped reservation API stays service-only.
revoke all on function public.place_order(jsonb,uuid,public.order_payment_method)
  from public, anon, authenticated, service_role;
revoke all on function public.reserve_tickets(uuid,uuid,integer,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_tickets(uuid,uuid,integer,uuid) to service_role;
