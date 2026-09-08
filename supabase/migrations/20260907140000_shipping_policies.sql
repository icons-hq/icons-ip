-- 현업 요청 슬라이스 2 — 배송·교환반품 정책 (D-2 승격)
--
-- 설계: 「어드민 현업 요청 설계안 v1」 §2-2.
--
-- 정책을 **상품마다 적지 않고 템플릿으로** 둔다 — 배송비가 바뀔 때 상품 수천 개를 고칠 수는 없다.
-- 지금까지 배송비는 코드 상수였다(`lib/shipping.ts` · place_order 의 3,000원/5만원).
-- 기본 정책의 값을 그 상수와 같게 심어, **정책을 도입해도 지금과 같은 금액**이 나오게 한다.

create table if not exists public.shipping_policies (
  id text primary key,
  name text not null,
  -- 발송 방법. 출고 객체(D-3b)의 발송 방법과 같은 어휘를 쓴다.
  method text not null default 'parcel',
  -- 묶음배송. 같은 정책끼리 한 번만 받을지, 상품마다 받을지.
  bundling boolean not null default true,
  fee_kind text not null default 'conditional',
  fee_amount integer not null default 0,
  -- 조건부 무료의 임계 금액. 그 정책 그룹의 소계로 본다.
  free_threshold integer,
  -- 도서산간 추가비. 판정표는 통계와 같은 `postal_regions` 를 쓴다.
  remote_surcharge integer not null default 0,
  ship_from_location_id text references public.stock_locations (id),
  exchange_location_id text references public.stock_locations (id),
  return_location_id text references public.stock_locations (id),
  exchange_fee integer not null default 0,
  return_fee integer not null default 0,
  -- 고지 문구. 그대로 소비자 화면에 나간다.
  return_restrictions text,
  support_note text,
  allow_bank_transfer boolean not null default true,
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipping_policies_method_check
    check (method in ('parcel', 'quick', 'pickup', 'freight')),
  constraint shipping_policies_fee_kind_check
    check (fee_kind in ('free', 'conditional', 'paid')),
  constraint shipping_policies_fee_shape_check check (
    (fee_kind = 'free' and fee_amount = 0 and free_threshold is null)
    or (fee_kind = 'conditional' and fee_amount >= 0 and free_threshold is not null and free_threshold > 0)
    or (fee_kind = 'paid' and fee_amount >= 0 and free_threshold is null)
  ),
  constraint shipping_policies_amounts_check check (
    remote_surcharge >= 0 and exchange_fee >= 0 and return_fee >= 0
  )
);

-- 기본 정책은 하나뿐이다. 둘이면 「비워 두면 어느 쪽인가」에 답할 수 없다.
create unique index if not exists shipping_policies_single_default_idx
  on public.shipping_policies ((true))
  where is_default and archived_at is null;

comment on table public.shipping_policies is
  '배송·교환반품 정책 템플릿. 상품이 참조하고, 비우면 기본 정책을 쓴다.';

alter table public.goods
  add column if not exists shipping_policy_id text references public.shipping_policies (id);

create index if not exists goods_shipping_policy_idx
  on public.goods (shipping_policy_id) where shipping_policy_id is not null;

-- 기본 정책 — 지금 코드 상수와 같은 값이라 이관해도 금액이 그대로다.
insert into public.shipping_policies (
  id, name, method, bundling, fee_kind, fee_amount, free_threshold,
  remote_surcharge, is_default, support_note
)
values (
  'default', '기본 배송 정책', 'parcel', true, 'conditional', 3000, 50000,
  0, true, '고객센터 010-9822-8724'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS — 정책은 상품 상세에 표기되는 공개 정보다. 쓰기는 staff 만.
-- ---------------------------------------------------------------------------
alter table public.shipping_policies enable row level security;

drop policy if exists shipping_policies_public_read on public.shipping_policies;
create policy shipping_policies_public_read on public.shipping_policies
  for select using (archived_at is null);

drop policy if exists shipping_policies_staff_all on public.shipping_policies;
create policy shipping_policies_staff_all on public.shipping_policies
  for all using (public.is_staff()) with check (public.is_staff());

grant select on public.shipping_policies to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 파생 — 어느 정책을 쓰는가, 얼마인가
-- ---------------------------------------------------------------------------
/** 이 상품에 걸린 정책. 비어 있으면 기본 정책이다. */
create or replace function public.shipping_policy_for(p_good_id text)
returns public.shipping_policies
language sql
stable
set search_path = ''
as $$
  select policy.*
  from public.goods as good
  left join public.shipping_policies as explicit
    on explicit.id = good.shipping_policy_id and explicit.archived_at is null
  join public.shipping_policies as policy
    on policy.id = coalesce(explicit.id, (
      select fallback.id from public.shipping_policies as fallback
      where fallback.is_default and fallback.archived_at is null limit 1
    ))
  where good.id = p_good_id
$$;

/** 우편번호가 도서산간인지. 통계와 같은 표를 본다 — 두 표로 나뉘면 서로 어긋난다. */
create or replace function public.postal_is_remote(p_postal_code text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select region.remote_area
    from public.postal_regions as region
    where region.prefix = pg_catalog.substr(pg_catalog.regexp_replace(coalesce(p_postal_code, ''), '[^0-9]', '', 'g'), 1, 2)
  ), false)
$$;

/*
 * 배송비.
 *
 * **묶음배송이 켜진 정책은 그 정책끼리 한 번만** 받는다 — 그게 「묶음배송 가능」의 뜻이다.
 * 꺼져 있으면 상품마다 받는다(부피가 커서 따로 나가는 상품).
 *
 * 도서산간 추가비는 **주문에 한 번, 정책들 중 최대값**이다. 그룹 수만큼 곱하면 상자 하나를
 * 보내면서 추가비를 세 번 받는 꼴이 된다.
 *
 * 인자는 `[{"goodId": "...", "qty": 2}, …]` 다.
 */
create or replace function public.shipping_fee_for_lines(
  p_lines jsonb,
  p_postal_code text default null
)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v_total integer := 0;
  v_remote integer := 0;
  v_group record;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return 0;
  end if;

  for v_group in
    with lines as (
      select
        entry ->> 'goodId' as good_id,
        greatest(coalesce((entry ->> 'qty')::integer, 0), 0) as qty
      from jsonb_array_elements(p_lines) as entry
    ),
    priced as (
      select
        lines.good_id,
        lines.qty,
        public.good_effective_price(good) as unit_price,
        policy.*
      from lines
      join public.goods as good on good.id = lines.good_id
      cross join lateral public.shipping_policy_for(lines.good_id) as policy
      where lines.qty > 0
    )
    select
      -- 묶음배송이면 정책 하나가 한 그룹, 아니면 상품마다 한 그룹.
      case when priced.bundling then priced.id else priced.id || ':' || priced.good_id end as group_key,
      min(priced.fee_kind) as fee_kind,
      min(priced.fee_amount) as fee_amount,
      min(priced.free_threshold) as free_threshold,
      max(priced.remote_surcharge) as remote_surcharge,
      sum(priced.unit_price::bigint * priced.qty::bigint) as subtotal
    from priced
    group by group_key, priced.bundling
  loop
    v_remote := greatest(v_remote, v_group.remote_surcharge);

    /*
     * 소계가 0인 그룹은 청구하지 않는다 — 옛 규칙 그대로다(`lib/shipping.ts`:
     * 「빈 장바구니(소계 0)는 청구 대상이 아니다」). 여기서 규칙을 바꾸면 0원 상품만 담은
     * 주문이 배송비만으로 결제 최소액을 넘겨 버린다(checkout_order.sql 이 그 계약을 잠근다).
     */
    if v_group.subtotal <= 0 then
      continue;
    end if;

    if v_group.fee_kind = 'free' then
      continue;
    elsif v_group.fee_kind = 'conditional'
      and v_group.free_threshold is not null
      and v_group.subtotal >= v_group.free_threshold then
      continue;
    end if;

    v_total := v_total + v_group.fee_amount;
  end loop;

  if public.postal_is_remote(p_postal_code) then
    v_total := v_total + v_remote;
  end if;

  return v_total;
end;
$$;

comment on function public.shipping_fee_for_lines(jsonb, text) is
  '배송비. 화면 견적과 주문 청구가 **같은 함수**를 본다 — 갈리면 결제 화면에서 금액이 바뀐다.';

grant execute on function public.shipping_policy_for(text) to anon, authenticated;
grant execute on function public.postal_is_remote(text) to anon, authenticated;
grant execute on function public.shipping_fee_for_lines(jsonb, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 어드민 RPC
-- ---------------------------------------------------------------------------
create or replace function public.admin_upsert_shipping_policy(
  p_id text,
  p_name text,
  p_method text,
  p_bundling boolean,
  p_fee_kind text,
  p_fee_amount integer,
  p_free_threshold integer,
  p_remote_surcharge integer,
  p_ship_from_location_id text,
  p_exchange_location_id text,
  p_return_location_id text,
  p_exchange_fee integer,
  p_return_fee integer,
  p_return_restrictions text,
  p_support_note text,
  p_allow_bank_transfer boolean,
  p_is_default boolean,
  p_request_id uuid
)
returns public.shipping_policies
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_policy public.shipping_policies;
begin

  -- 기본을 새로 지정하면 먼저 기존 기본을 내린다 — 부분 유일 인덱스가 둘을 허용하지 않는다.
  if coalesce(p_is_default, false) then
    update public.shipping_policies set is_default = false, updated_at = now()
    where is_default and archived_at is null and id <> p_id;
  end if;

  insert into public.shipping_policies as policy (
    id, name, method, bundling, fee_kind, fee_amount, free_threshold, remote_surcharge,
    ship_from_location_id, exchange_location_id, return_location_id,
    exchange_fee, return_fee, return_restrictions, support_note,
    allow_bank_transfer, is_default
  )
  values (
    p_id, p_name, coalesce(p_method, 'parcel'), coalesce(p_bundling, true),
    coalesce(p_fee_kind, 'conditional'), coalesce(p_fee_amount, 0), p_free_threshold,
    coalesce(p_remote_surcharge, 0),
    nullif(p_ship_from_location_id, ''), nullif(p_exchange_location_id, ''), nullif(p_return_location_id, ''),
    coalesce(p_exchange_fee, 0), coalesce(p_return_fee, 0),
    nullif(btrim(coalesce(p_return_restrictions, '')), ''), nullif(btrim(coalesce(p_support_note, '')), ''),
    coalesce(p_allow_bank_transfer, true), coalesce(p_is_default, false)
  )
  on conflict (id) do update set
    name = excluded.name,
    method = excluded.method,
    bundling = excluded.bundling,
    fee_kind = excluded.fee_kind,
    fee_amount = excluded.fee_amount,
    free_threshold = excluded.free_threshold,
    remote_surcharge = excluded.remote_surcharge,
    ship_from_location_id = excluded.ship_from_location_id,
    exchange_location_id = excluded.exchange_location_id,
    return_location_id = excluded.return_location_id,
    exchange_fee = excluded.exchange_fee,
    return_fee = excluded.return_fee,
    return_restrictions = excluded.return_restrictions,
    support_note = excluded.support_note,
    allow_bank_transfer = excluded.allow_bank_transfer,
    is_default = excluded.is_default,
    archived_at = null,
    updated_at = now()
  returning * into v_policy;

  perform private.record_admin_action(
    p_request_id, v_actor, 'shipping.policy.upsert', 'shipping_policy:' || p_id,
    jsonb_build_object('fee_kind', v_policy.fee_kind, 'fee_amount', v_policy.fee_amount,
                       'is_default', v_policy.is_default)
  );
  return v_policy;
end;
$$;

create or replace function public.admin_archive_shipping_policy(p_id text, p_request_id uuid)
returns public.shipping_policies
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_policy public.shipping_policies;
begin

  -- 기본 정책은 보관할 수 없다. 비워 둔 상품이 갈 곳을 잃는다.
  if exists (select 1 from public.shipping_policies where id = p_id and is_default) then
    raise check_violation using message = 'default_policy_cannot_be_archived';
  end if;

  update public.shipping_policies
  set archived_at = now(), updated_at = now()
  where id = p_id
  returning * into v_policy;

  if not found then
    raise check_violation using message = 'policy_not_found';
  end if;

  -- 보관한 정책을 쓰던 상품은 기본으로 되돌린다 — 참조가 남으면 조회가 빈 정책을 만난다.
  update public.goods set shipping_policy_id = null where shipping_policy_id = p_id;

  perform private.record_admin_action(
    p_request_id, v_actor, 'shipping.policy.archive', 'shipping_policy:' || p_id, '{}'::jsonb
  );
  return v_policy;
end;
$$;

create or replace function public.admin_set_good_shipping_policy(
  p_good_id text,
  p_policy_id text,
  p_request_id uuid
)
returns public.goods
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff_actor();
  v_good public.goods;
begin

  update public.goods
  set shipping_policy_id = nullif(p_policy_id, ''),
      updated_at = now()
  where id = p_good_id
  returning * into v_good;

  if not found then
    raise check_violation using message = 'good_not_found';
  end if;

  perform private.record_admin_action(
    p_request_id, v_actor, 'shipping.policy.assign', 'good:' || p_good_id,
    jsonb_build_object('policy_id', v_good.shipping_policy_id)
  );
  return v_good;
end;
$$;

revoke all on function public.admin_upsert_shipping_policy(text, text, text, boolean, text, integer, integer, integer, text, text, text, integer, integer, text, text, boolean, boolean, uuid) from public, anon, service_role;
revoke all on function public.admin_archive_shipping_policy(text, uuid) from public, anon, service_role;
revoke all on function public.admin_set_good_shipping_policy(text, text, uuid) from public, anon, service_role;

grant execute on function public.admin_upsert_shipping_policy(text, text, text, boolean, text, integer, integer, integer, text, text, text, integer, integer, text, text, boolean, boolean, uuid) to authenticated;
grant execute on function public.admin_archive_shipping_policy(text, uuid) to authenticated;
grant execute on function public.admin_set_good_shipping_policy(text, text, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 주문 — 배송비도 같은 함수를 본다
-- ---------------------------------------------------------------------------
-- 라이브 정의를 그대로 두고 네 곳만 바꿨다: 라인 수집 변수, 루프의 라인 적재,
-- 배송비 파생, 그리고 더는 쓰지 않는 상수 제거.
CREATE OR REPLACE FUNCTION public.place_order(p_address jsonb, p_checkout_key uuid, p_payment_method order_payment_method)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order_item uuid;
  v_block text;
  v_lines jsonb := '[]'::jsonb;
  -- 배송비 상수는 `shipping_policies` 기본 정책으로 옮겼다(현업 슬라이스 2).
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
      public.good_effective_price(good) as price,
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

    /*
     * 구매 수량 상한·성인 전용은 장바구니와 결제 준비에서도 같은 함수를 본다 — 여기가
     * 마지막 문이다. 카트에 담긴 뒤 상한이 바뀌었을 수 있으므로 주문 시점에 다시 본다.
     */
    v_block := public.good_purchase_block_reason(r.good_id, r.qty, v_user);
    if v_block is not null then
      raise check_violation using message = format('purchase blocked: %s: %s', v_block, r.good_id);
    end if;

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
    v_lines := v_lines || jsonb_build_object('goodId', r.good_id, 'qty', r.qty);
  end loop;

  if v_item_count = 0 then
    raise check_violation using message = 'cart empty';
  end if;

  /*
   * 배송비는 **정책에서 파생**한다(현업 슬라이스 2). 화면 견적과 여기가 같은 함수를 본다 —
   * 갈리면 결제 화면에서 금액이 바뀐다. 기본 정책의 값이 옛 상수(3,000/5만)와 같아
   * 정책을 안 건드린 상품은 금액이 그대로다.
   *
   * 판정은 할인 전 소계 기준 그대로다 — 쿠폰이 무료배송 경계를 흔들면 카트의
   * "얼마 더 담으면 무료배송" 안내가 거짓말이 된다.
   */
  v_shipping_fee := public.shipping_fee_for_lines(v_lines, p_address ->> 'postalCode');

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

analyze public.goods;
