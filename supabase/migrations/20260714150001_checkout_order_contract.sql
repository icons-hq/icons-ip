-- 체크아웃 주문 계약(#90): 배송지 검증, 요청 멱등성, 동일 사용자 주문 직렬화.
-- 기존 주문은 checkout_key가 없을 수 있고 새 체크아웃 RPC만 키를 필수로 받는다.

alter table public.orders
  add column checkout_key uuid;

create unique index orders_user_checkout_key_uidx
  on public.orders (user_id, checkout_key)
  where checkout_key is not null;

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

  -- 카트와 재고를 같은 결정적 순서로 잠근 뒤 DB 가격·수량만으로 스냅샷을 만든다.
  for r in
    select cart.good_id, cart.qty, good.price, good.stock, good.stock_qty
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

    insert into public.order_items (order_id, good_id, qty, unit_price)
    values (v_order, r.good_id, r.qty, r.price);

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

-- 기존 비멱등 overload는 폐쇄하고 checkout_key를 받는 새 RPC만 사용자에게 연다.
revoke all on function public.place_order(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.place_order(jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.place_order(jsonb, uuid) to authenticated;

-- provider 취소 없이 로컬 환불·재고만 원복할 수 없도록 취소 RPC는 서버 경계로 제한한다.
-- 사용자 취소 UI는 토스 취소 성공 후 service role로 이 함수를 호출해야 한다.
revoke all on function public.cancel_order(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_order(uuid, text) to service_role;

revoke all on function public.refund_ticket_order(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_ticket_order(uuid, text) to service_role;
