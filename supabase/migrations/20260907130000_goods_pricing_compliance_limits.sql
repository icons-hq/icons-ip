-- 현업 요청 슬라이스 1 — 할인 · KC 인증 · 구매 수량 상한 · 성인 전용 · 바코드
--
-- 설계: 「ICONS 어드민 현업 요청 설계안 v1」 §2-1.
--
-- `coalesce`·`least`·`greatest` 는 함수가 아니라 SQL 문법이라 `pg_catalog.` 로 한정할 수 없다.

-- ---------------------------------------------------------------------------
-- 1. 열
-- ---------------------------------------------------------------------------
alter table public.goods
  -- 할인. **할인가는 저장하지 않는다** — 아래 good_effective_price 가 조회 시 계산한다.
  add column if not exists discount_kind text not null default 'none',
  add column if not exists discount_value integer not null default 0,
  add column if not exists discount_starts_at timestamptz,
  add column if not exists discount_ends_at timestamptz,
  add column if not exists discount_shows_rate boolean not null default true,
  -- KC 인증. 표시 의무라 「없음」과 「미입력」을 나눈다.
  add column if not exists kc_status text not null default 'unknown',
  add column if not exists kc_type text,
  add column if not exists kc_number text,
  add column if not exists kc_company text,
  -- 구매 수량 상한.
  add column if not exists min_order_qty integer not null default 1,
  add column if not exists max_order_qty integer,
  add column if not exists max_qty_per_account integer,
  -- 성인 전용.
  add column if not exists adult_only boolean not null default false,
  -- 바코드(조회 축).
  add column if not exists barcode text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'goods_discount_kind_check') then
    alter table public.goods add constraint goods_discount_kind_check
      check (discount_kind in ('none', 'percent', 'amount'));
  end if;

  -- 정률은 1~100%, 정액은 0원 초과. 「할인 없음」이면 값은 0이어야 한다 —
  -- 값만 남고 종류가 none 이면 나중에 종류를 켜는 순간 의도하지 않은 할인이 걸린다.
  if not exists (select 1 from pg_constraint where conname = 'goods_discount_value_check') then
    alter table public.goods add constraint goods_discount_value_check check (
      (discount_kind = 'none' and discount_value = 0)
      or (discount_kind = 'percent' and discount_value between 1 and 100)
      or (discount_kind = 'amount' and discount_value between 1 and 100000000)
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'goods_discount_window_check') then
    alter table public.goods add constraint goods_discount_window_check check (
      discount_starts_at is null or discount_ends_at is null or discount_starts_at < discount_ends_at
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'goods_kc_status_check') then
    alter table public.goods add constraint goods_kc_status_check
      check (kc_status in ('unknown', 'none', 'certified', 'exempt'));
  end if;

  -- 인증받았다고 적으면 번호가 있어야 한다. 번호 없는 「인증됨」은 표기로 쓸 수 없다.
  if not exists (select 1 from pg_constraint where conname = 'goods_kc_number_required_check') then
    alter table public.goods add constraint goods_kc_number_required_check check (
      kc_status <> 'certified' or (kc_number is not null and length(btrim(kc_number)) > 0)
    );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'goods_order_qty_check') then
    alter table public.goods add constraint goods_order_qty_check check (
      min_order_qty >= 1
      and (max_order_qty is null or max_order_qty >= min_order_qty)
      and (max_qty_per_account is null or max_qty_per_account >= min_order_qty)
    );
  end if;
end;
$$;

comment on column public.goods.discount_kind is
  '할인 종류. 할인가는 저장하지 않고 public.good_effective_price 가 조회 시 계산한다.';
comment on column public.goods.kc_status is
  'unknown = 아직 확인하지 않음. none 과 구분한다 — 빈 값이 곧 「인증 없음」이 되면 표기 누락이 조용히 생긴다.';

create index if not exists goods_barcode_idx on public.goods (barcode) where barcode is not null;
create index if not exists goods_kc_status_idx on public.goods (kc_status) where archived_at is null;

-- ---------------------------------------------------------------------------
-- 2. 파생 — 지금 팔리는 값
-- ---------------------------------------------------------------------------
-- 정각에 값을 갈아치우는 배치를 두면 그 배치가 늦은 만큼 가격이 틀리고, 늦었는지조차
-- 알기 어렵다(판매 상태·팝업 페이즈와 같은 규율). 조회 시 계산하면 초 단위로 정확하다.
create or replace function public.good_discount_active(good public.goods, at timestamptz default now())
returns boolean
language sql
stable
set search_path = ''
as $$
  select good.discount_kind <> 'none'
    and (good.discount_starts_at is null or good.discount_starts_at <= at)
    and (good.discount_ends_at is null or good.discount_ends_at > at)
$$;

create or replace function public.good_effective_price(good public.goods, at timestamptz default now())
returns integer
language sql
stable
set search_path = ''
as $$
  select case
    when not public.good_discount_active(good, at) then good.price
    when good.discount_kind = 'percent'
      -- 원 단위로 내림한다 — 올림하면 표시가보다 1원 더 받는 일이 생긴다.
      then greatest(good.price - (good.price * good.discount_value) / 100, 0)
    else greatest(good.price - good.discount_value, 0)
  end
$$;

comment on function public.good_effective_price(public.goods, timestamptz) is
  '지금 팔리는 값. 화면(goods_storefront)과 주문(place_order)이 **같은 함수**를 본다 — 표시가와 청구가가 다른 경로로 계산되면 언젠가 갈린다.';

/** 표시용 할인율. 「할인율 노출」을 끈 상품은 0을 돌려준다. */
create or replace function public.good_discount_rate(good public.goods, at timestamptz default now())
returns integer
language sql
stable
set search_path = ''
as $$
  select case
    when not good.discount_shows_rate then 0
    when not public.good_discount_active(good, at) then 0
    when good.price <= 0 then 0
    else ((good.price - public.good_effective_price(good, at)) * 100) / good.price
  end
$$;

-- ---------------------------------------------------------------------------
-- 3. 구매 수량 상한 · 성인 전용 — 문은 하나
-- ---------------------------------------------------------------------------
/**
 * 이 사람이 이 상품을 이만큼 살 수 있는지. 장바구니 담기·결제 준비·주문 생성이 **같은 함수**를
 * 본다 — 문이 셋이면 하나는 반드시 뒤처진다.
 *
 * 계정당 상한은 **취소·반품분을 빼고** 센다. 취소한 만큼 다시 못 사면 그게 더 이상하다.
 * 실패하면 사유 문자열을, 통과하면 null 을 돌려준다(예외를 던지지 않아 부르는 쪽이 문구를 고른다).
 */
create or replace function public.good_purchase_block_reason(
  p_good_id text,
  p_qty integer,
  p_user_id uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_good public.goods;
  v_birth date;
  v_bought bigint;
begin
  select * into v_good from public.goods where id = p_good_id;
  if not found then return 'good_not_found'; end if;

  if p_qty < v_good.min_order_qty then return 'below_min_order_qty'; end if;
  if v_good.max_order_qty is not null and p_qty > v_good.max_order_qty then
    return 'above_max_order_qty';
  end if;

  if v_good.adult_only then
    if p_user_id is null then return 'adult_only'; end if;
    select birth_date into v_birth from public.profiles where id = p_user_id;
    -- 생년월일이 없으면 막는다. 모르는 것을 통과시키면 확인한 적 없는 판매가 된다.
    if v_birth is null then return 'adult_verification_required'; end if;
    if pg_catalog.date_part('year', pg_catalog.age(v_birth)) < 19 then return 'adult_only'; end if;
  end if;

  if v_good.max_qty_per_account is not null and p_user_id is not null then
    select coalesce(sum(item.qty - item.qty_canceled - item.qty_returned), 0)
    into v_bought
    from public.order_items as item
    join public.orders as ord on ord.id = item.order_id
    where ord.user_id = p_user_id
      and item.good_id = p_good_id
      and ord.status <> 'canceled';

    if v_bought + p_qty > v_good.max_qty_per_account then
      return 'above_account_limit';
    end if;
  end if;

  return null;
end;
$$;

revoke all on function public.good_purchase_block_reason(text, integer, uuid) from public, anon;
grant execute on function public.good_purchase_block_reason(text, integer, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. 스토어프론트 뷰 — 지금 팔리는 값과 할인율을 함께 준다
-- ---------------------------------------------------------------------------
create or replace view public.goods_storefront
with (security_invoker = true)
as
select
  goods.id, goods.ip_id, goods.name, goods.type, goods.price, goods.compare_at_price,
  goods.created_at, goods.badge, goods.stock, goods.stock_qty, goods.bg, goods.image_path,
  goods.allow_bank_transfer, goods.summary, goods.image_alt, goods.seo_title, goods.seo_description,
  goods.sale_mode, goods.sale_starts_at, goods.sale_ends_at, goods.preorder_ships_at,
  public.good_sale_state(goods) as sale_state,
  public.good_purchasable(goods) as purchasable,
  -- 새 열은 **끝에만** 붙일 수 있다 — `create or replace view` 는 기존 열의 순서·이름을 못 바꾼다.
  goods.min_order_qty, goods.max_order_qty, goods.adult_only, goods.barcode,
  goods.kc_status, goods.kc_type, goods.kc_number, goods.kc_company,
  public.good_effective_price(goods) as effective_price,
  public.good_discount_rate(goods) as discount_rate
from public.goods as goods
where goods.archived_at is null
  and goods.hidden_at is null;

grant select on public.goods_storefront to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. 어드민 RPC
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_good_discount(
  p_good_id text,
  p_kind text,
  p_value integer,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_shows_rate boolean,
  p_request_id uuid
)
returns public.goods
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_good public.goods;
begin
  perform private.require_staff_actor();

  update public.goods
  set discount_kind = coalesce(p_kind, 'none'),
      discount_value = case when coalesce(p_kind, 'none') = 'none' then 0 else coalesce(p_value, 0) end,
      discount_starts_at = case when coalesce(p_kind, 'none') = 'none' then null else p_starts_at end,
      discount_ends_at = case when coalesce(p_kind, 'none') = 'none' then null else p_ends_at end,
      discount_shows_rate = coalesce(p_shows_rate, true),
      updated_at = now()
  where id = p_good_id
  returning * into v_good;

  if not found then
    raise check_violation using message = 'good_not_found';
  end if;

  perform private.record_admin_action('admin_set_good_discount', p_request_id, p_good_id);
  return v_good;
end;
$$;

create or replace function public.admin_set_good_compliance(
  p_good_id text,
  p_kc_status text,
  p_kc_type text,
  p_kc_number text,
  p_kc_company text,
  p_adult_only boolean,
  p_barcode text,
  p_request_id uuid
)
returns public.goods
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_good public.goods;
begin
  perform private.require_staff_actor();

  update public.goods
  set kc_status = coalesce(p_kc_status, 'unknown'),
      kc_type = nullif(btrim(coalesce(p_kc_type, '')), ''),
      kc_number = nullif(btrim(coalesce(p_kc_number, '')), ''),
      kc_company = nullif(btrim(coalesce(p_kc_company, '')), ''),
      adult_only = coalesce(p_adult_only, false),
      barcode = nullif(btrim(coalesce(p_barcode, '')), ''),
      updated_at = now()
  where id = p_good_id
  returning * into v_good;

  if not found then
    raise check_violation using message = 'good_not_found';
  end if;

  perform private.record_admin_action('admin_set_good_compliance', p_request_id, p_good_id);
  return v_good;
end;
$$;

create or replace function public.admin_set_good_purchase_limits(
  p_good_id text,
  p_min_order_qty integer,
  p_max_order_qty integer,
  p_max_qty_per_account integer,
  p_request_id uuid
)
returns public.goods
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_good public.goods;
begin
  perform private.require_staff_actor();

  update public.goods
  set min_order_qty = greatest(coalesce(p_min_order_qty, 1), 1),
      max_order_qty = p_max_order_qty,
      max_qty_per_account = p_max_qty_per_account,
      updated_at = now()
  where id = p_good_id
  returning * into v_good;

  if not found then
    raise check_violation using message = 'good_not_found';
  end if;

  perform private.record_admin_action('admin_set_good_purchase_limits', p_request_id, p_good_id);
  return v_good;
end;
$$;

revoke all on function public.admin_set_good_discount(text, text, integer, timestamptz, timestamptz, boolean, uuid) from public, anon, service_role;
revoke all on function public.admin_set_good_compliance(text, text, text, text, text, boolean, text, uuid) from public, anon, service_role;
revoke all on function public.admin_set_good_purchase_limits(text, integer, integer, integer, uuid) from public, anon, service_role;

grant execute on function public.admin_set_good_discount(text, text, integer, timestamptz, timestamptz, boolean, uuid) to authenticated;
grant execute on function public.admin_set_good_compliance(text, text, text, text, text, boolean, text, uuid) to authenticated;
grant execute on function public.admin_set_good_purchase_limits(text, integer, integer, integer, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. 주문 생성 — 표시가와 청구가가 같은 함수를 본다
-- ---------------------------------------------------------------------------
-- 라이브 정의를 그대로 두고 **세 곳만** 바꿨다: 단가를 `good_effective_price` 로,
-- 수량·성인 게이트 추가, 그 판정을 담을 변수 선언. 손으로 옮겨 적으면 나머지 300줄에서
-- 조용한 차이가 난다.

CREATE OR REPLACE FUNCTION public.place_order(p_address jsonb, p_checkout_key uuid, p_payment_method order_payment_method)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order_item uuid;
  v_block text;
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

analyze public.goods;
