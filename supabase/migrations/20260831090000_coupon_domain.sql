-- S7 쿠폰 도메인 (ADR-0011 B1): 정의·발급·보유·사용 원장과 서버 주문 생성 할인 통합.
--
-- 돈의 경계: 이 개편에서 주문 금액에 개입하는 것은 쿠폰뿐이며, 할인은
-- place_order 안에서만 확정된다. PaymentGateway seam·finalizer·웹훅은 손대지
-- 않는다 — prepare/finalize가 의존하는 스냅샷 등식(goods_order_snapshot_matches)만
-- 할인을 인지하도록 확장해, 결제 경로는 "저장된 총액"을 그대로 신뢰한다.
--
-- 어휘: 쿠폰은 CONTEXT.md의 유일한 프로모션 할인 수단이다. 코드 발급형을
-- 포함해 카트 프리셋·쿠폰함·캠페인 경품(S8)이 한 체계로 관통된다(R-05 §5).

-- ── 테이블 ──────────────────────────────────────────────────────────────────

-- 쿠폰 정의. code가 곧 운영 식별자다(어드민 upsert의 catalog 계약과 동형).
create table public.coupons (
  code text primary key
    check (code ~ '^[A-Z0-9][A-Z0-9-]{2,23}$'),
  name text not null
    check (name = btrim(name) and length(name) between 1 and 80),
  discount_type text not null
    check (discount_type in ('fixed', 'percent')),
  discount_value integer not null
    check (discount_value > 0),
  -- 정률 상한. 정액에는 의미가 없어 스키마가 막는다.
  max_discount_amount integer
    check (max_discount_amount > 0),
  min_subtotal integer not null default 0
    check (min_subtotal >= 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  issue_limit integer
    check (issue_limit > 0),
  issued_count integer not null default 0
    check (issued_count >= 0),
  status text not null default 'active'
    check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (discount_type <> 'percent' or discount_value between 1 and 100),
  check (discount_type = 'percent' or max_discount_amount is null),
  check (ends_at is null or ends_at > starts_at)
);

create trigger coupons_set_updated_at
before update on public.coupons
for each row execute function public.set_updated_at();

-- 발급·보유. 만료는 상태 배치 대신 발급 시점 스냅(expires_at)의 파생으로 읽는다 —
-- 배치가 없으면 "만료됐는데 active" 같은 이중 진실이 생기지 않는다.
create table public.user_coupons (
  id uuid primary key default gen_random_uuid(),
  coupon_code text not null references public.coupons (code),
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'used')),
  issued_source text not null
    check (issued_source in ('code_entry', 'grade_benefit', 'admin_grant')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  used_at timestamptz,
  used_order_id uuid references public.orders (id),
  -- 같은 쿠폰은 1인 1장이다. 취소 복구는 이 행의 상태를 되돌리므로 재발급이 아니다.
  unique (coupon_code, user_id),
  check ((status = 'used') = (used_at is not null)),
  check (used_order_id is null or status = 'used')
);

create index user_coupons_user_id_idx on public.user_coupons (user_id);
create index user_coupons_used_order_id_idx on public.user_coupons (used_order_id)
  where used_order_id is not null;

-- 사용 원장. 주문과 할인액을 연결해 정산·감사를 지탱한다. 복구는 행을 지우지
-- 않고 released로 남긴다 — 원장은 append-only에 가깝게 유지한다.
create table public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_coupon_id uuid not null references public.user_coupons (id),
  coupon_code text not null references public.coupons (code),
  user_id uuid not null references public.profiles (id),
  order_id uuid not null references public.orders (id),
  discount_amount bigint not null
    check (discount_amount > 0),
  status text not null default 'applied'
    check (status in ('applied', 'released')),
  applied_at timestamptz not null default now(),
  released_at timestamptz,
  release_reason text,
  check ((status = 'released') = (released_at is not null))
);

-- 주문당 유효 쿠폰 1장, 보유 쿠폰당 유효 사용 1건 — 이중 사용을 스키마가 막는다.
create unique index coupon_redemptions_applied_order_uidx
  on public.coupon_redemptions (order_id)
  where status = 'applied';
create unique index coupon_redemptions_applied_user_coupon_uidx
  on public.coupon_redemptions (user_coupon_id)
  where status = 'applied';
create index coupon_redemptions_user_id_idx on public.coupon_redemptions (user_id);
create index coupon_redemptions_coupon_code_idx on public.coupon_redemptions (coupon_code);

-- 카트에 적용해 둔 쿠폰. user_id가 PK라 "장바구니 쿠폰 1장 제한"(R-05 §4.4)이
-- 스키마에 새겨진다. 주문 생성이 이 선택을 소비하고, 클라이언트 상태는 진실이
-- 아니다(CartProvider 동결 — DESIGN.md §11).
create table public.cart_coupon_selections (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  user_coupon_id uuid not null references public.user_coupons (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 주문 스냅샷에 할인액을 명시 저장한다. total은 이미 할인이 반영된 최종
-- 청구액이고, 정산·환불은 이 두 값으로 역산 없이 읽는다.
alter table public.orders
  add column discount_total bigint not null default 0
    check (discount_total >= 0);

-- ── RLS ─────────────────────────────────────────────────────────────────────

alter table public.coupons enable row level security;
alter table public.user_coupons enable row level security;
alter table public.coupon_redemptions enable row level security;
alter table public.cart_coupon_selections enable row level security;

-- 쿠폰 정의 공개 조회를 열면 코드가 열거된다. 보유자와 staff에게만 보인다.
create policy coupons_select_held_or_staff on public.coupons
  for select using (
    public.is_staff()
    or exists (
      select 1
      from public.user_coupons as held
      where held.coupon_code = coupons.code
        and held.user_id = (select auth.uid())
    )
  );

create policy user_coupons_select_own_or_staff on public.user_coupons
  for select using (
    user_id = (select auth.uid()) or public.is_staff()
  );

create policy coupon_redemptions_select_own_or_staff on public.coupon_redemptions
  for select using (
    user_id = (select auth.uid()) or public.is_staff()
  );

create policy cart_coupon_selections_select_own on public.cart_coupon_selections
  for select using (user_id = (select auth.uid()));

-- 쓰기는 어떤 롤에도 없다 — 발급·적용·사용·복구 전부 security definer 경로만 지난다.
revoke all on table public.coupons from public, anon, authenticated, service_role;
revoke all on table public.user_coupons from public, anon, authenticated, service_role;
revoke all on table public.coupon_redemptions from public, anon, authenticated, service_role;
revoke all on table public.cart_coupon_selections from public, anon, authenticated, service_role;
grant select on table public.coupons to authenticated;
grant select on table public.user_coupons to authenticated;
grant select on table public.coupon_redemptions to authenticated;
grant select on table public.cart_coupon_selections to authenticated;

-- ── 검증·계산 헬퍼 ──────────────────────────────────────────────────────────

-- 담긴 카트의 소계. 카탈로그에서 사라진 굿즈는 join에서 빠진다 — 카트 화면의
-- 표시 소계(components/screens/Cart.tsx)와 같은 정의여야 조건 안내가 어긋나지 않는다.
create function private.cart_subtotal(p_user_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(cart.qty::bigint * good.price::bigint), 0)
  from public.cart_items as cart
  join public.goods as good on good.id = cart.good_id
  where cart.user_id = p_user_id;
$$;

-- 보유 쿠폰 하나를 소계에 대해 평가한다. o_reason이 null이면 사용 가능하고
-- o_discount가 확정 할인액이다. 적용(apply)과 주문 확정(place_order)이 같은
-- 판정을 공유해야 "카트에서는 됐는데 주문에서 다른 이유" 같은 어긋남이 없다.
-- 행 잠금은 호출부 책임이다 — 이 함수는 판정만 한다.
create function private.evaluate_user_coupon(
  p_user_coupon_id uuid,
  p_user_id uuid,
  p_subtotal bigint,
  out o_reason text,
  out o_discount bigint,
  out o_coupon_code text
)
returns record
language plpgsql
stable
set search_path = ''
as $$
declare
  v_held record;
  v_coupon record;
begin
  o_reason := null;
  o_discount := 0;
  o_coupon_code := null;

  select held.coupon_code, held.user_id, held.status, held.expires_at
  into v_held
  from public.user_coupons as held
  where held.id = p_user_coupon_id;

  if not found or v_held.user_id is distinct from p_user_id then
    o_reason := 'coupon_not_owned';
    return;
  end if;

  o_coupon_code := v_held.coupon_code;

  if v_held.status = 'used' then
    o_reason := 'coupon_already_used';
    return;
  end if;

  select coupon.status, coupon.starts_at, coupon.ends_at, coupon.min_subtotal,
         coupon.discount_type, coupon.discount_value, coupon.max_discount_amount
  into v_coupon
  from public.coupons as coupon
  where coupon.code = v_held.coupon_code;

  if not found or v_coupon.status <> 'active' then
    o_reason := 'coupon_not_found';
    return;
  end if;

  if now() < v_coupon.starts_at then
    o_reason := 'coupon_not_started';
    return;
  end if;

  if (v_coupon.ends_at is not null and now() > v_coupon.ends_at)
     or (v_held.expires_at is not null and now() > v_held.expires_at) then
    o_reason := 'coupon_expired';
    return;
  end if;

  if p_subtotal < v_coupon.min_subtotal then
    o_reason := 'coupon_min_subtotal';
    return;
  end if;

  -- 할인은 상품 소계에만 적용된다(배송비 제외 — R-05 §4.4). 정액도 정률 상한도
  -- 소계를 넘지 못하므로 total은 음수가 될 수 없다.
  if v_coupon.discount_type = 'fixed' then
    o_discount := least(v_coupon.discount_value::bigint, p_subtotal);
  else
    o_discount := least(
      (p_subtotal * v_coupon.discount_value::bigint) / 100,
      coalesce(v_coupon.max_discount_amount::bigint, p_subtotal),
      p_subtotal
    );
  end if;
end;
$$;

revoke all on function private.cart_subtotal(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.evaluate_user_coupon(uuid, uuid, bigint)
  from public, anon, authenticated, service_role;

-- ── 사용자 RPC: 발급·카트 적용·해제 ─────────────────────────────────────────

-- 코드 직접 입력: 미보유면 발급까지, 보유면 적용만 — 카트의 "직접 입력"과
-- 캠페인 경품 코드(S8)가 같은 문을 지난다. place_order와 같은 사용자 advisory
-- lock을 잡아 주문 생성 중의 선택 교체 경합을 직렬화한다.
create function public.apply_cart_coupon_code(p_code text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := (select auth.uid());
  v_code text;
  v_coupon record;
  v_user_coupon_id uuid;
  v_subtotal bigint;
  v_eval record;
begin
  if v_user is null then
    raise insufficient_privilege using message = 'auth required';
  end if;

  v_code := upper(btrim(coalesce(p_code, '')));
  if v_code = '' then
    raise check_violation using message = 'coupon_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  -- 발급 한도 경합은 쿠폰 행 잠금으로 직렬화한다.
  select coupon.code, coupon.status, coupon.starts_at, coupon.ends_at,
         coupon.issue_limit, coupon.issued_count
  into v_coupon
  from public.coupons as coupon
  where coupon.code = v_code
  for update;

  -- 없는 코드와 보관된 코드는 같은 사유로 답한다 — 코드 존재를 노출하지 않는다.
  if not found or v_coupon.status <> 'active' then
    raise check_violation using message = 'coupon_not_found';
  end if;

  if now() < v_coupon.starts_at then
    raise check_violation using message = 'coupon_not_started';
  end if;

  if v_coupon.ends_at is not null and now() > v_coupon.ends_at then
    raise check_violation using message = 'coupon_expired';
  end if;

  select held.id into v_user_coupon_id
  from public.user_coupons as held
  where held.coupon_code = v_code and held.user_id = v_user;

  if v_user_coupon_id is null then
    if v_coupon.issue_limit is not null and v_coupon.issued_count >= v_coupon.issue_limit then
      raise check_violation using message = 'coupon_exhausted';
    end if;

    update public.coupons
    set issued_count = issued_count + 1
    where code = v_code;

    insert into public.user_coupons (coupon_code, user_id, issued_source, expires_at)
    values (v_code, v_user, 'code_entry', v_coupon.ends_at)
    returning id into v_user_coupon_id;
  end if;

  -- 최소 주문 금액 미달은 발급·선택을 막지 않는다 — 더 담으면 살아나는 선택이고,
  -- 확정 거부는 place_order 가 한다(카트가 미달 경고를 그린다). 그 밖의 사유
  -- (만료·사용됨 등)는 쓸 수 없는 선택이므로 여기서 거부한다.
  v_subtotal := private.cart_subtotal(v_user);
  select * into v_eval from private.evaluate_user_coupon(v_user_coupon_id, v_user, v_subtotal);
  if v_eval.o_reason is not null and v_eval.o_reason <> 'coupon_min_subtotal' then
    raise check_violation using message = v_eval.o_reason;
  end if;

  insert into public.cart_coupon_selections (user_id, user_coupon_id)
  values (v_user, v_user_coupon_id)
  on conflict (user_id) do update set
    user_coupon_id = excluded.user_coupon_id,
    created_at = now();

  return v_user_coupon_id;
end;
$$;

-- 보유 쿠폰을 카트에 적용한다(쿠폰 select 경로).
create function public.apply_cart_coupon(p_user_coupon_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := (select auth.uid());
  v_subtotal bigint;
  v_eval record;
begin
  if v_user is null then
    raise insufficient_privilege using message = 'auth required';
  end if;

  if p_user_coupon_id is null then
    raise check_violation using message = 'coupon_not_owned';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  -- 코드 입력과 같은 계약: 최소 금액 미달만은 선택으로 받아들인다.
  v_subtotal := private.cart_subtotal(v_user);
  select * into v_eval from private.evaluate_user_coupon(p_user_coupon_id, v_user, v_subtotal);
  if v_eval.o_reason is not null and v_eval.o_reason <> 'coupon_min_subtotal' then
    raise check_violation using message = v_eval.o_reason;
  end if;

  insert into public.cart_coupon_selections (user_id, user_coupon_id)
  values (v_user, p_user_coupon_id)
  on conflict (user_id) do update set
    user_coupon_id = excluded.user_coupon_id,
    created_at = now();
end;
$$;

create function public.clear_cart_coupon()
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise insufficient_privilege using message = 'auth required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  delete from public.cart_coupon_selections where user_id = v_user;
end;
$$;

revoke all on function public.apply_cart_coupon_code(text)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_cart_coupon_code(text) to authenticated;
revoke all on function public.apply_cart_coupon(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_cart_coupon(uuid) to authenticated;
revoke all on function public.clear_cart_coupon()
  from public, anon, authenticated, service_role;
grant execute on function public.clear_cart_coupon() to authenticated;

-- ── 주문 생성 할인 통합 ─────────────────────────────────────────────────────

-- 20260818140001의 본문에 쿠폰 확정 블록만 더한 재정의다. 시그니처·기존 검증·
-- 재고 흐름·멱등 계약은 그대로다 — 쿠폰 선택이 없으면 금액 경로는 한 줄도
-- 다르게 동작하지 않는다(checkout_order.sql 회귀가 이를 지킨다).
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
      good.allow_bank_transfer
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

    if p_payment_method = 'bank_transfer' and not r.allow_bank_transfer then
      raise check_violation using message = format('bank transfer blocked: %s', r.good_id);
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

-- create or replace는 기존 ACL을 보존하지만, 봉인 상태를 파일 안에서 읽을 수
-- 있도록 명시한다(20260707090001 규율).
revoke all on function public.place_order(jsonb, uuid, public.order_payment_method)
  from public, anon, authenticated, service_role;

-- 스냅샷 등식이 할인을 인지한다: sum(items) + shipping - discount = total.
-- 기존 주문은 discount_total 0이라 등식이 그대로 성립한다. prepare/finalize의
-- 호출부는 무변경 — 결제 경로가 할인을 "몰라도" 저장된 총액으로 정합이 검증된다.
create or replace function private.goods_order_snapshot_matches(
  p_order_id uuid,
  p_total bigint,
  p_shipping_fee bigint
)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select
    pg_catalog.count(*) > 0
    and coalesce(
      pg_catalog.sum(item.qty::bigint * item.unit_price::bigint),
      0
    ) + p_shipping_fee - (
      select order_row.discount_total
      from public.orders as order_row
      where order_row.id = p_order_id
    ) = p_total
  from public.order_items as item
  where item.order_id = p_order_id;
$function$;

revoke all on function private.goods_order_snapshot_matches(uuid, bigint, bigint)
  from public, anon, authenticated, service_role;

-- ── 취소 복구 ───────────────────────────────────────────────────────────────

-- 취소 경로는 여러 개다(사용자 요청·어드민 결정·만료 스윕·무통장 미입금 취소).
-- 전부 orders.status = 'canceled' 전이를 지나므로, 상태 전이 한 지점에 트리거로
-- 결합한다 — 새 취소 경로가 생겨도 쿠폰 복구를 잊을 수 없다.
create function private.release_coupons_on_order_cancel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.coupon_redemptions
  set status = 'released',
      released_at = now(),
      release_reason = 'order_canceled'
  where order_id = new.id
    and status = 'applied';

  update public.user_coupons as held
  set status = 'active',
      used_at = null,
      used_order_id = null
  from public.coupon_redemptions as redemption
  where redemption.order_id = new.id
    and redemption.status = 'released'
    and redemption.release_reason = 'order_canceled'
    and held.id = redemption.user_coupon_id
    and held.status = 'used'
    and held.used_order_id = new.id;

  return null;
end;
$$;

revoke all on function private.release_coupons_on_order_cancel()
  from public, anon, authenticated, service_role;

create trigger orders_release_coupons_on_cancel
after update of status on public.orders
for each row
when (new.status = 'canceled' and old.status is distinct from new.status)
execute function private.release_coupons_on_order_cancel();

-- ── 어드민: 쿠폰 정의 upsert ────────────────────────────────────────────────

-- admin_upsert_* 카탈로그 계약과 동형(20260807090001):
--   target_previous_code is null     → 신규. 코드가 이미 있으면 catalog_id_taken.
--   target_previous_code is not null → 선택한 레코드 수정. 없으면
--                                      catalog_record_missing, 코드 변경 시도는
--                                      catalog_id_immutable.
create function public.admin_upsert_coupon(
  target_code text,
  target_name text,
  target_discount_type text,
  target_discount_value integer,
  target_max_discount_amount integer,
  target_min_subtotal integer,
  target_starts_at timestamptz,
  target_ends_at timestamptz,
  target_issue_limit integer,
  target_status text,
  target_previous_code text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_code text := upper(btrim(coalesce(target_code, '')));
  normalized_previous_code text := nullif(upper(btrim(coalesce(target_previous_code, ''))), '');
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_previous_code is not null
     and normalized_previous_code is distinct from normalized_code then
    raise exception 'catalog_id_immutable' using errcode = '22023';
  end if;

  if normalized_previous_code is not null then
    perform coupon.code
    from public.coupons as coupon
    where coupon.code = normalized_previous_code
    for update;

    if not found then
      raise exception 'catalog_record_missing' using errcode = 'P0002';
    end if;
  end if;

  -- 발급 한도를 이미 발급된 수 아래로 줄이면 issued_count 검사가 영구 소진
  -- 상태가 될 뿐 원장은 깨지지 않는다 — 운영 실수로 두고 스키마는 막지 않는다.
  insert into public.coupons (
    code, name, discount_type, discount_value, max_discount_amount,
    min_subtotal, starts_at, ends_at, issue_limit, status
  )
  values (
    normalized_code,
    btrim(coalesce(target_name, '')),
    target_discount_type,
    target_discount_value,
    target_max_discount_amount,
    coalesce(target_min_subtotal, 0),
    coalesce(target_starts_at, now()),
    target_ends_at,
    target_issue_limit,
    coalesce(target_status, 'active')
  )
  on conflict (code) do update set
    name = excluded.name,
    discount_type = excluded.discount_type,
    discount_value = excluded.discount_value,
    max_discount_amount = excluded.max_discount_amount,
    min_subtotal = excluded.min_subtotal,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    issue_limit = excluded.issue_limit,
    status = excluded.status
  where normalized_previous_code is not null;

  if not found then
    raise exception 'catalog_id_taken' using errcode = '23505';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'commerce.coupon.upsert',
    'coupons:' || normalized_code,
    jsonb_build_object(
      'mode', case when normalized_previous_code is null then 'create' else 'update' end,
      'after', jsonb_build_object(
        'name', btrim(coalesce(target_name, '')),
        'discountType', target_discount_type,
        'discountValue', target_discount_value,
        'maxDiscountAmount', target_max_discount_amount,
        'minSubtotal', coalesce(target_min_subtotal, 0),
        'startsAt', coalesce(target_starts_at, now()),
        'endsAt', target_ends_at,
        'issueLimit', target_issue_limit,
        'status', coalesce(target_status, 'active')
      )
    )
  );
end;
$$;

revoke all on function public.admin_upsert_coupon(
  text, text, text, integer, integer, integer, timestamptz, timestamptz, integer, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_coupon(
  text, text, text, integer, integer, integer, timestamptz, timestamptz, integer, text, text
) to authenticated;
