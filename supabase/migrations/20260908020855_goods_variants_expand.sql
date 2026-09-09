-- #419 / ADR-0015 expand. Existing application/RPC signatures remain intact.
-- Cart/order variant references and option CRUD are owned by #439/#440/#441.
create table public.goods_variants (
  id uuid primary key default extensions.gen_random_uuid(),
  good_id text not null references public.goods(id) on delete cascade,
  name text not null default '기본 옵션' check (char_length(btrim(name)) between 1 and 200),
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  price integer not null check (price >= 0),
  stock_qty integer not null default 0 check (stock_qty >= 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint goods_variants_default_active check (not is_default or archived_at is null)
);
create unique index goods_variants_one_default on public.goods_variants(good_id) where is_default;
create index goods_variants_order on public.goods_variants(good_id, sort_order, id);
alter table public.goods_variants enable row level security;
revoke all on public.goods_variants from public, anon, authenticated, service_role;
grant select on public.goods_variants to anon, authenticated;
create policy goods_variants_public_read on public.goods_variants for select to anon, authenticated
  using (archived_at is null and exists (
    select 1 from public.goods good join public.ips ip on ip.id = good.ip_id
    where good.id = goods_variants.good_id and good.archived_at is null
      and good.sale_restriction = 'none' and ip.archived_at is null and ip.published_at is not null
  ));
create policy goods_variants_staff_read on public.goods_variants for select to authenticated
  using ((select public.is_staff()));

-- Existing records, including archived goods, keep exactly their current quantity/price.
insert into public.goods_variants(good_id,price,stock_qty,is_default)
select id,price,stock_qty,true from public.goods;

create function private.sync_goods_default_variant()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.goods_variants(good_id,price,stock_qty,is_default)
    values (new.id,new.price,new.stock_qty,true);
  else
    -- The existing goods editor still accepts one price during expand. Later
    -- option-editing RPCs own per-option prices; the default keeps today's price.
    update public.goods_variants set price = new.price, updated_at = now()
      where good_id = new.id and is_default and price is distinct from new.price;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_goods_default_variant() from public, anon, authenticated, service_role;
create trigger goods_sync_default_variant after insert or update of price on public.goods
  for each row execute function private.sync_goods_default_variant();

create function private.require_goods_default_variant()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_good_id text;
begin
  if tg_table_name = 'goods' then target_good_id := new.id;
  elsif tg_op = 'DELETE' then target_good_id := old.good_id;
  else target_good_id := new.good_id;
  end if;
  if exists(select 1 from public.goods where id=target_good_id)
    and not exists(select 1 from public.goods_variants where good_id=target_good_id and is_default) then
    raise check_violation using message = 'goods_default_variant_required';
  end if;
  return null;
end;
$$;
revoke all on function private.require_goods_default_variant() from public, anon, authenticated, service_role;
create constraint trigger goods_require_default_variant after insert on public.goods
  deferrable initially deferred for each row execute function private.require_goods_default_variant();
create constraint trigger goods_variants_require_default after insert or update or delete on public.goods_variants
  deferrable initially deferred for each row execute function private.require_goods_default_variant();

create function private.guard_goods_variant_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.good_id is distinct from old.good_id then
    raise check_violation using message = 'goods_variant_identity_immutable';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.guard_goods_variant_identity() from public, anon, authenticated, service_role;
create trigger goods_variant_identity before update on public.goods_variants
  for each row execute function private.guard_goods_variant_identity();

-- No session-variable bypass: even privileged stock-cache writes must equal the
-- actual variant sum. Repair is comparison against the source, never an overwrite.
create function private.guard_goods_stock_cache()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.stock_qty::bigint is distinct from (
    select coalesce(sum(variant.stock_qty),0) from public.goods_variants variant where variant.good_id=new.id
  ) then
    raise check_violation using message = 'goods_stock_cache_readonly';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_goods_stock_cache() from public, anon, authenticated, service_role;
create trigger goods_stock_cache_guard before update of stock_qty on public.goods
  for each row execute function private.guard_goods_stock_cache();

create function private.refresh_goods_variant_stock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_good_id text; total_stock bigint;
begin
  target_good_id := case when tg_op='DELETE' then old.good_id else new.good_id end;
  perform 1 from public.goods where id=target_good_id for update;
  if not found then return null; end if; -- parent cascade deletion
  select coalesce(sum(stock_qty),0) into total_stock from public.goods_variants where good_id=target_good_id;
  if total_stock > 2147483647 then raise numeric_value_out_of_range using message='stock_out_of_range'; end if;
  update public.goods set stock_qty=total_stock::integer
    where id=target_good_id and stock_qty is distinct from total_stock::integer;
  return null;
end;
$$;
revoke all on function private.refresh_goods_variant_stock() from public, anon, authenticated, service_role;
create trigger goods_variants_refresh_stock after insert or delete or update of stock_qty on public.goods_variants
  for each row execute function private.refresh_goods_variant_stock();

-- Trusted stock writers always lock goods, then its default variant. This keeps
-- the existing deterministic goods ordering and idempotency of checkout/refunds.
-- The helper has no callable runtime grant: each owning RPC keeps its own auth,
-- sale gate, reason/evidence and audit checks before reaching this write seam.
create function private.change_default_goods_variant_stock(target_good_id text, target_delta bigint)
returns integer language plpgsql security invoker set search_path = '' as $$
declare variant_id uuid; previous_stock integer; next_stock bigint;
begin
  perform 1 from public.goods where id=target_good_id for update;
  if not found then raise no_data_found using message='good_not_found'; end if;
  select id,stock_qty into variant_id,previous_stock from public.goods_variants
    where good_id=target_good_id and is_default for update;
  if not found then raise check_violation using message='goods_default_variant_required'; end if;
  next_stock := previous_stock::bigint + target_delta;
  if target_delta is null or next_stock < 0 or next_stock > 2147483647 then
    raise numeric_value_out_of_range using message='stock_out_of_range';
  end if;
  update public.goods_variants set stock_qty=next_stock::integer where id=variant_id;
  return next_stock::integer;
end;
$$;
revoke all on function private.change_default_goods_variant_stock(text,bigint) from public, anon, authenticated, service_role;

-- Repoint only the stock writes in the current RPC bodies. All public signatures,
-- existing permissions, sale checks, payment evidence and audit formats are retained.

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
    select c.good_id, c.qty, g.price
    from cart_items c
    join goods g on g.id = c.good_id
    where c.user_id = v_user
    order by c.good_id
    for update of g
  loop
    if (select stock_qty from goods where id = r.good_id) < r.qty then
      raise exception 'out of stock: %', r.good_id;
    end if;
    perform private.change_default_goods_variant_stock(r.good_id, -r.qty::bigint);
    insert into order_items (order_id, good_id, qty, unit_price)
    values (v_order, r.good_id, r.qty, r.price);
    v_total := v_total + r.price * r.qty;
  end loop;

  update orders set total = v_total where id = v_order;
  delete from cart_items where user_id = v_user;
  return v_order;  -- 클라이언트는 이 주문으로 토스 결제 시작
end; $function$
;
revoke all on function public.place_order(jsonb) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_adjust_stock(target_adjustment_id uuid, target_good_id text, target_expected_stock_qty integer, target_delta integer, target_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_id uuid := (select auth.uid());
  normalized_reason text;
  previous_stock_qty integer;
  selected_archived_at timestamptz;
  next_stock_qty bigint;
  requested_diff jsonb;
  existing_actor_id uuid;
  existing_action text;
  existing_target text;
  existing_diff jsonb;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  normalized_reason := btrim(target_reason, E' \t\n\r\f\v');

  if target_adjustment_id is null then
    raise exception 'invalid_adjustment_id' using errcode = '22004';
  end if;

  if target_expected_stock_qty is null or target_expected_stock_qty < 0 then
    raise exception 'invalid_expected_stock_qty' using errcode = '22023';
  end if;

  if target_delta is null or target_delta = 0 then
    raise exception 'invalid_stock_delta' using errcode = '22023';
  end if;

  if normalized_reason is null
    or char_length(normalized_reason) < 1
    or char_length(normalized_reason) > 200
  then
    raise exception 'invalid_stock_reason' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_stock_adjustment:' || target_adjustment_id::text, 0)
  );

  next_stock_qty := target_expected_stock_qty::bigint + target_delta::bigint;
  requested_diff := jsonb_build_object(
    'from', target_expected_stock_qty,
    'delta', target_delta,
    'to', next_stock_qty,
    'reason', normalized_reason
  );

  select audit.actor_id, audit.action, audit.target, audit.diff
    into existing_actor_id, existing_action, existing_target, existing_diff
  from public.audit_log as audit
  where audit.id = target_adjustment_id;

  if found then
    if existing_actor_id = actor_id
      and existing_action = 'admin.good.stock_adjusted'
      and existing_target = 'goods:' || target_good_id
      and existing_diff = requested_diff
    then
      return (existing_diff ->> 'to')::integer;
    end if;

    raise exception 'adjustment_conflict' using errcode = '23505';
  end if;

  select good.stock_qty, good.archived_at
    into previous_stock_qty, selected_archived_at
  from public.goods as good
  where good.id = target_good_id
  for update;

  if not found then
    raise exception 'good_not_found' using errcode = 'P0002';
  end if;

  if target_delta > 0 and selected_archived_at is not null then
    raise check_violation using message = 'catalog_item_archived';
  end if;

  if previous_stock_qty <> target_expected_stock_qty then
    raise exception 'stock_changed' using errcode = 'P0001';
  end if;

  next_stock_qty := previous_stock_qty::bigint + target_delta::bigint;

  if next_stock_qty < 0 or next_stock_qty > 2147483647 then
    raise exception 'stock_out_of_range' using errcode = '22003';
  end if;

  perform private.change_default_goods_variant_stock(target_good_id, target_delta::bigint);

  insert into public.audit_log (id, actor_id, action, target, diff)
  values (
    target_adjustment_id,
    actor_id,
    'admin.good.stock_adjusted',
    'goods:' || target_good_id,
    jsonb_build_object(
      'from', previous_stock_qty,
      'delta', target_delta,
      'to', next_stock_qty,
      'reason', normalized_reason
    )
  );

  return next_stock_qty::integer;
end;
$function$
;
revoke all on function public.admin_adjust_stock(uuid,text,integer,integer,text) from public, anon, authenticated, service_role;
grant execute on function public.admin_adjust_stock(uuid,text,integer,integer,text) to authenticated;

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
    for v_item in
      select order_item.good_id, order_item.qty
      from public.order_items as order_item
      where order_item.order_id = p_order_id
      order by order_item.good_id
    loop
      perform private.change_default_goods_variant_stock(v_item.good_id, v_item.qty::bigint);
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
$function$
;
revoke all on function public.finalize_order_cancellation_with_provider_evidence(uuid,text,text[]) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.place_order(p_address jsonb, p_checkout_key uuid, p_payment_method order_payment_method)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

    perform private.change_default_goods_variant_stock(r.good_id, -r.qty::bigint);

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
$function$
;
revoke all on function public.place_order(jsonb,uuid,public.order_payment_method) from public, anon, authenticated, service_role;
