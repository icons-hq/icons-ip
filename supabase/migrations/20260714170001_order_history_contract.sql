-- 주문 내역 계약(#91): 주문 시점의 굿즈 정체성을 보존하고 결제 요약만 공개한다.

alter table public.order_items
  add column good_name_snapshot text,
  add column good_type_snapshot text,
  add column good_ip_id_snapshot text;

-- 공유된 기존 주문에는 현재 카탈로그 행이 유일하게 가능한 backfill 원본이다.
update public.order_items as order_item
set
  good_name_snapshot = good.name,
  good_type_snapshot = good.type,
  good_ip_id_snapshot = good.ip_id
from public.goods as good
where good.id = order_item.good_id;

alter table public.order_items
  alter column good_name_snapshot set not null,
  alter column good_type_snapshot set not null,
  alter column good_ip_id_snapshot set not null;

-- 최신 체크아웃 계약(#90)을 유지하면서 가격과 함께 굿즈 정체성도 원자적으로 고정한다.
create or replace function public.place_order(
  p_address jsonb,
  p_checkout_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := (select auth.uid());
  v_order uuid;
  v_existing_address jsonb;
  v_total bigint := 0;
  v_item_count integer := 0;
  v_recipient_name text;
  v_phone text;
  v_postal_code text;
  v_address1 text;
  v_optional text;
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
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  select orders.id, orders.address
    into v_order, v_existing_address
  from public.orders
  where orders.user_id = v_user
    and orders.checkout_key = p_checkout_key;

  if found then
    if v_existing_address is distinct from p_address then
      raise unique_violation using message = 'checkout key conflict';
    end if;
    return v_order;
  end if;

  insert into public.orders (user_id, status, total, address, expires_at, checkout_key)
  values (v_user, 'pending', 0, p_address, now() + interval '15 minutes', p_checkout_key)
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
      good.ip_id
    from public.cart_items as cart
    join public.goods as good on good.id = cart.good_id
    where cart.user_id = v_user
    order by cart.good_id
    for update of cart, good
  loop
    v_item_count := v_item_count + 1;

    if r.stock = 'soldout' or r.stock_qty < r.qty then
      raise check_violation using message = format('out of stock: %s', r.good_id);
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

    v_total := v_total + (r.price::bigint * r.qty::bigint);
  end loop;

  if v_item_count = 0 then
    raise check_violation using message = 'cart empty';
  end if;

  update public.orders
  set total = v_total
  where id = v_order;

  return v_order;
end;
$$;

-- 기존 overload 폐쇄와 사용자 시작 권한을 최신 체크아웃 계약 그대로 유지한다.
revoke all on function public.place_order(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.place_order(jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.place_order(jsonb, uuid) to authenticated;

-- 결제 확정 시 현재 goods가 아니라 주문 시점 IP 스냅샷으로 카드팩을 귀속한다.
create or replace function public.confirm_order_payment(
  p_idempotency_key text,
  p_order_id uuid,
  p_payment_key text,
  p_amount bigint,
  p_raw jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_total bigint;
  v_status order_status;
  v_expires_at timestamptz;
  v_existing record;
begin
  -- 멱등: 같은 목적/대상으로 이미 처리된 키만 무시한다.
  select id, purpose, ref_id, amount, status
    into v_existing
  from public.payments
  where idempotency_key = p_idempotency_key
  for update;

  if v_existing.id is not null then
    if v_existing.purpose <> 'order' or v_existing.ref_id is distinct from p_order_id then
      raise exception 'idempotency conflict';
    end if;
    if v_existing.status in ('paid', 'refunded') then
      return;
    end if;
    if v_existing.status <> 'pending' then
      raise exception 'payment not payable';
    end if;
  end if;

  select user_id, total, status, expires_at
    into v_user, v_total, v_status, v_expires_at
  from public.orders
  where id = p_order_id
  for update;

  if v_user is null then
    raise exception 'order not found';
  end if;
  if v_status <> 'pending' then
    raise exception 'order not payable';
  end if;
  if v_expires_at is not null and now() >= v_expires_at then
    raise exception 'order expired';
  end if;
  if p_amount <> v_total then
    raise exception 'amount mismatch';
  end if;
  if v_existing.id is not null and v_existing.amount <> p_amount then
    raise exception 'amount mismatch';
  end if;

  insert into public.payments (
    user_id,
    purpose,
    ref_id,
    amount,
    status,
    payment_key,
    idempotency_key,
    raw
  )
  values (
    v_user,
    'order',
    p_order_id,
    p_amount,
    'paid',
    p_payment_key,
    p_idempotency_key,
    p_raw
  )
  on conflict (idempotency_key) do update
    set
      status = 'paid',
      payment_key = excluded.payment_key,
      raw = excluded.raw;

  if v_status = 'pending' then
    update public.orders
    set status = 'paid', expires_at = null
    where id = p_order_id;

    -- 정책 매칭은 주문 시점 IP 굿즈 소계가 min_amount 이상일 때만 수행한다.
    insert into public.draw_tickets (user_id, pool_id, source, source_id, ordinal)
    select
      v_user,
      reward_policy.pool_id,
      'order_paid',
      p_order_id,
      row_number() over (order by reward_policy.id, grant_series.n)
    from public.reward_policies as reward_policy
    join public.card_pools as card_pool on card_pool.id = reward_policy.pool_id
    join lateral (
      select coalesce(sum(order_item.qty * order_item.unit_price), 0) as ip_subtotal
      from public.order_items as order_item
      where order_item.order_id = p_order_id
        and order_item.good_ip_id_snapshot = card_pool.ip_id
    ) as subtotal on true
    cross join lateral generate_series(1, reward_policy.tickets_per_grant) as grant_series(n)
    where reward_policy.trigger = 'order_paid'
      and reward_policy.active
      and subtotal.ip_subtotal > 0
      and subtotal.ip_subtotal >= reward_policy.min_amount
      and now() >= card_pool.active_from
      and (card_pool.active_to is null or now() < card_pool.active_to)
    on conflict (source, source_id, ordinal) do nothing;
  end if;
end;
$$;

revoke all on function public.confirm_order_payment(text, uuid, text, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_order_payment(text, uuid, text, bigint, jsonb)
  to service_role;

-- 결제 원문과 provider 식별자는 서버 신뢰 경계에만 남긴다.
revoke all on table public.payments from public, anon, authenticated;
grant select (
  id,
  user_id,
  purpose,
  ref_id,
  amount,
  status,
  created_at
) on table public.payments to authenticated;

-- 신규 프로젝트의 opt-in Data API 기본값에서도 기존 서버 결제 흐름을 보장한다.
grant select, insert, update, delete on table public.payments to service_role;
