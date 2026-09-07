-- ==========================================================================
-- ICONS · goods.sale_restriction 도입과 주문 단위 provider 파생 (#392)
--
-- 판매 제한 상품(현재는 성인 대상 19+ 한 종류)을 카탈로그의 축으로 세우고,
-- 그 축이 카드 결제 provider를 파생하게 만든다. 토스 기본 PG 재전환(#384)의
-- 전제가 "일반 상품은 토스, 판매 제한 상품만 전용 PG(코페이)"인데, 이 경계는
-- 앱 라우팅에 맡길 수 없다 — 분기 한 줄이 어긋나면 업종 제한을 위반한 결제가
-- 그대로 승인되고, 그 승인은 되돌려도 기록이 남는다.
--
-- 이 마이그레이션이 DB 안에서 고정하는 것:
--   1. 제한 축은 goods의 컬럼이다 — 상품 단위로 켜고 끄는 운영 스위치이고,
--      고시정보 폼과 분리된 setter로만 바뀐다
--   2. 제한 상품 구매는 성인인증(#209·#210)이 붙기 전까지 주문 생성에서
--      서버가 막는다 — 스토어 비노출은 쿼리 레이어라 보안 경계가 아니다
--   3. 카드 provider는 주문 구성에서 파생된다 — 클라이언트가 고르지 않고,
--      결제 준비뿐 아니라 캡처 직전 선점에서도 같은 파생을 다시 확인한다.
--      prepare에서만 보면 attempt가 사는 10분이 그대로 우회 창이 된다
--   4. 비노출은 /search까지 같은 축이다 — 목록·상세·캠페인·카트가 앱 쿼리에서
--      거르는 sale_restriction = 'none'을 검색 RPC 본문에도 둔다. 여전히 쿼리
--      레이어이고 보안 경계는 2번이다
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 1. 판매 제한 유형
-- ---------------------------------------------------------------------------
-- 'random_box'(이치방쿠지형)는 지금 넣지 않는다. 도입이 확정되면 값 추가는
-- 1줄 migration이고, enum은 추가가 사소한 대신 제거가 어렵다 — 미확정 값을
-- 미리 등록해 두면 앱과 운영 화면이 그 값을 분기하기 시작하고, 그 시점부터는
-- 되돌리는 쪽이 더 비싸진다.
create type public.goods_sale_restriction as enum ('none', 'adult');

-- 타입은 ambient public API가 아니다(20260813182100 규율: revoke 후 필요한
-- 롤에만 usage). 다만 goods는 goods_read 정책이 `using (true)`인 공개 읽기
-- 테이블이라 anon 세션이 이 컬럼을 그대로 select하고, 스토어 쿼리가
-- `sale_restriction = 'none'`으로 거르는 것도 그 anon 세션이다. usage가 없으면
-- 로그인하지 않은 방문자의 상품 목록 자체가 깨진다. 값은 비밀이 아니고 읽기
-- 경계는 RLS와 테이블 grant가 이미 정하므로, anon에도 usage를 준다.
revoke all on type public.goods_sale_restriction
  from public, anon, authenticated, service_role;
grant usage on type public.goods_sale_restriction
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. 굿즈 컬럼
-- ---------------------------------------------------------------------------
-- 기본값은 제한 없음이다. default expand라 backfill이 필요 없고
-- (allow_bank_transfer 선례), 기존 상품은 전부 none이 맞는 값이다.
alter table public.goods
  add column sale_restriction public.goods_sale_restriction not null default 'none';

comment on column public.goods.sale_restriction is
  '판매 제한 유형. none이 아니면 스토어에서 감추고 주문 생성에서 막으며, 카드 결제는 전용 PG로 파생된다.';

-- ---------------------------------------------------------------------------
-- 3. 판매 제한 setter
-- ---------------------------------------------------------------------------
-- admin_upsert_good에 인자를 더하지 않는 이유는 admin_set_good_bank_transfer와
-- 같다 — 그 RPC가 고시정보 7칸을 필수로 받기 때문이다. 운영 스위치 하나를
-- 뒤집으려고 상품 정보 전체를 다시 제출하게 만들면, 정작 급하게 내려야 할 때
-- 못 내린다.
create function public.admin_set_good_sale_restriction(
  target_id text,
  target_restriction public.goods_sale_restriction
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if target_id is null or target_restriction is null then
    raise check_violation using message = 'invalid sale restriction';
  end if;

  update public.goods
  set sale_restriction = target_restriction,
      updated_at = now()
  where id = target_id;

  if not found then
    raise no_data_found using message = 'catalog_record_missing';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'catalog.good.sale_restriction_changed',
    'goods:' || target_id,
    jsonb_build_object('saleRestriction', target_restriction)
  );
end;
$function$;

-- Supabase default privileges가 신규 public 함수에 anon/authenticated/service_role
-- execute를 자동 부여한다. `from public`만으로는 봉인되지 않는다.
revoke all on function public.admin_set_good_sale_restriction(
  text, public.goods_sale_restriction
) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_good_sale_restriction(
  text, public.goods_sale_restriction
) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. 주문 생성 — 판매 제한 상품 차단
-- ---------------------------------------------------------------------------
-- 20260831090000(쿠폰) 사본에 판매 제한 차단만 더한 재정의다. 시그니처·주소
-- 검증·재고 흐름·쿠폰 확정·멱등 계약·배송비 판정은 그대로다 — 제한 상품이
-- 카트에 없으면 이 함수는 한 줄도 다르게 동작하지 않는다.
--
-- 이 가드가 여기 있는 이유: 스토어 비노출(lib/catalog.ts의
-- `sale_restriction = 'none'` 필터)은 쿼리 레이어이지 RLS가 아니다. 직접
-- 호출하거나 이미 담아 둔 카트로 우회할 수 있으므로 최종 차단은 주문 생성이다.
-- 19금 오픈 트랙에서 성인인증(#209·#210)이 붙으면, 이 무조건 차단이 인증된
-- 성인인지 확인하는 검증으로 대체된다.
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

-- create or replace는 기존 ACL을 보존하지만, 봉인 상태를 파일 안에서 읽을 수
-- 있도록 명시한다(20260707090001 규율). 주문 생성 본문은 어떤 브라우저 롤도
-- 부를 수 없다 — service role 래퍼(4-arg)만 열려 있다.
revoke all on function public.place_order(jsonb, uuid, public.order_payment_method)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. 결제 준비 — 주문 단위 provider 파생
-- ---------------------------------------------------------------------------
-- 20260901100000(토스 허용목록) 사본에 provider 파생 강제만 더한 재정의다.
-- 상태 기계, 잠금 순서, attempt TTL, 멱등 계약은 한 줄도 건드리지 않는다.
--
-- place_order가 제한 상품 주문을 막고 있는데도 여기에 같은 축의 검사를 두는
-- 이유는, provider 파생이 주문 생성과 다른 계약이기 때문이다. 성인인증이 붙어
-- 4번의 무조건 차단이 걷히는 순간 제한 주문이 실제로 만들어지고, 그때 이
-- 함수가 유일한 provider 경계가 된다. 운영자가 손으로 만든 주문도 같은 경계를
-- 지나야 한다.
create or replace function public.prepare_goods_payment_attempt(
  p_user_id uuid,
  p_order_id uuid,
  p_provider public.payment_provider
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_order public.orders%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_attempt_id uuid;
  v_attempt_expires_at timestamptz;
begin
  if p_user_id is null
    or p_order_id is null
    or p_provider not in ('toss', 'korpay', 'bank_transfer')
  then
    raise exception 'goods_payment_unavailable' using errcode = '55000';
  end if;

  select order_record.*
  into v_order
  from public.orders as order_record
  where order_record.id = p_order_id
  for update;

  if not found or v_order.user_id is distinct from p_user_id then
    raise no_data_found using message = 'goods_order_not_found';
  end if;

  -- 결제수단은 주문 생성 시점에 고정된다. 선점 창(카드 15분 · 무통장 24시간)이
  -- 그때 결정되므로, 여기서 수단을 갈아타게 두면 재고 보유 시간이 주문 기록과
  -- 어긋난다. 바꾸려면 취소하고 다시 주문해야 한다.
  if (p_provider = 'bank_transfer' and v_order.payment_method <> 'bank_transfer')
    or (p_provider <> 'bank_transfer' and v_order.payment_method <> 'card')
  then
    raise object_not_in_prerequisite_state using message = 'goods_payment_method_mismatch';
  end if;

  if v_order.status is distinct from 'pending'
    or v_order.expires_at is null
    or v_order.expires_at <= pg_catalog.clock_timestamp()
    or v_order.total <= 0
  then
    raise object_not_in_prerequisite_state using message = 'goods_order_not_payable';
  end if;

  -- 판매 제한 상품 포함 여부가 카드 provider를 파생한다(#392). 제한 주문은
  -- 전용 PG(korpay), 일반 주문은 toss만 카드 경로다. 무통장(bank_transfer)은
  -- PG가 아니라 업종 제한과 무관하므로 양쪽 모두 허용된다.
  if p_provider <> 'bank_transfer' then
    if exists (
      select 1
      from public.order_items as item
      join public.goods as good on good.id = item.good_id
      where item.order_id = v_order.id
        and good.sale_restriction <> 'none'
    ) then
      if p_provider <> 'korpay' then
        raise exception 'goods_payment_provider_mismatch' using errcode = '55000';
      end if;
    elsif p_provider <> 'toss' then
      raise exception 'goods_payment_provider_mismatch' using errcode = '55000';
    end if;
  end if;

  if private.is_account_write_fenced(p_user_id)
    or exists (
      select 1
      from public.profiles as profile
      where profile.id = p_user_id
        and profile.suspended_at is not null
    )
  then
    raise insufficient_privilege using message = 'goods_payment_account_blocked';
  end if;

  if not private.goods_order_snapshot_matches(
    v_order.id,
    v_order.total,
    v_order.shipping_fee
  ) then
    raise check_violation using message = 'goods_order_snapshot_mismatch';
  end if;

  if exists (
    select 1
    from public.order_cancellation_requests as request
    where request.order_id = v_order.id
      and request.status in ('requested', 'processing', 'needs_review')
  ) or exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = v_order.id
      and payment.status in ('pending', 'paid')
  ) then
    raise object_not_in_prerequisite_state using message = 'goods_order_not_payable';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = v_order.id
  for update;

  if found then
    if v_attempt.user_id is distinct from p_user_id
      or v_attempt.provider is distinct from p_provider
      or v_attempt.amount is distinct from v_order.total
      or v_attempt.currency is distinct from 'KRW'
      or v_attempt.state is distinct from 'prepared'
      or v_attempt.expires_at <= pg_catalog.clock_timestamp()
    then
      raise object_not_in_prerequisite_state using message = 'goods_payment_attempt_not_preparable';
    end if;
    return private.goods_payment_attempt_json(v_attempt);
  end if;

  v_attempt_id := extensions.gen_random_uuid();
  -- 카드 action은 10분이면 충분하고 짧을수록 안전하다. 무통장은 attempt TTL이
  -- 곧 입금 기한이라 주문 선점 창과 같아야 한다 — 짧게 잡으면 입금 확인이
  -- 만료된 attempt를 붙잡고 실패한다.
  v_attempt_expires_at := case
    when p_provider = 'bank_transfer' then v_order.expires_at
    else least(
      v_order.expires_at,
      pg_catalog.clock_timestamp() + interval '10 minutes'
    )
  end;

  insert into public.payment_attempts (
    id,
    provider,
    user_id,
    purpose,
    ref_id,
    amount,
    currency,
    state,
    idempotency_key,
    provider_order_id,
    provider_product_code,
    expires_at
  )
  values (
    v_attempt_id,
    p_provider,
    p_user_id,
    'order',
    v_order.id,
    v_order.total,
    'KRW',
    'prepared',
    'goods:' || v_order.id::text,
    'O' || pg_catalog.replace(v_attempt_id::text, '-', ''),
    'P' || pg_catalog.replace(v_attempt_id::text, '-', ''),
    v_attempt_expires_at
  )
  returning * into v_attempt;

  return private.goods_payment_attempt_json(v_attempt);
end;
$function$;

revoke all on function public.prepare_goods_payment_attempt(
  uuid, uuid, public.payment_provider
) from public, anon, authenticated, service_role;
grant execute on function public.prepare_goods_payment_attempt(
  uuid, uuid, public.payment_provider
) to service_role;

-- ---------------------------------------------------------------------------
-- 6. 결제 선점 — 캡처 직전 provider 파생 재검증
-- ---------------------------------------------------------------------------
-- 20260901100000(토스 허용목록) 사본에 파생 재검증만 더한 재정의다. 시그니처,
-- 잠금 순서(order → attempt), 재조회·멱등·재생 계약, 상태 전이는 그대로다.
--
-- 5번의 파생은 prepare 시점의 판정이고, attempt는 그 뒤로 최대 10분을 더 산다.
-- prepare에만 검사가 있으면 그 창 안에서 staff가 굿즈를 none → adult로 내려도
-- 이미 열린 토스 attempt는 그대로 캡처까지 완주한다 — 이 파일 머리말이 막겠다고
-- 적은 "업종 제한을 위반한 결제가 그대로 승인되는" 일이 마지막 관문에서
-- 벌어진다. claim은 provider 승인 API를 부르기 직전의 마지막 DB 관문이므로,
-- 여기서 다시 판정해 그 창을 10분에서 0으로 줄인다.
--
-- 재검증은 한 방향이다. toss attempt에 제한 상품이 섞이면 거절하고, korpay
-- attempt는 검사하지 않는다 — 전용 PG가 일반 상품을 결제하는 것은 업종 위반이
-- 아니라서, adult → none 전환이 이미 열린 korpay 결제를 깨뜨릴 이유가 없다.
--
-- 같은 검사를 finalize에 두지 않는 이유는 시점이다. finalize가 도는 시점에는
-- provider 승인 API가 이미 돈을 잡은 뒤라, 거기서 거절하면 캡처된 결제를 원장
-- 없이 버리게 된다. 제한을 지키는 관문은 캡처 앞이어야 한다.
--
-- setter에서 pending 주문을 원자 취소하는 안은 택하지 않았다. 3번 setter가
-- 존재하는 이유가 "급하게 내려야 할 때 못 내리는" 상황을 없애는 것인데, 스위치
-- 하나에 진행 중 주문 취소까지 묶으면 운영자가 그 스위치를 무서워하게 된다.
create or replace function public.claim_goods_payment_attempt(
  p_provider public.payment_provider,
  p_provider_order_id text,
  p_callback_nonce_digest text,
  p_claim_token uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_attempt public.payment_attempts%rowtype;
  v_order public.orders%rowtype;
begin
  if p_provider not in ('toss', 'korpay')
    or p_provider_order_id is null
    or pg_catalog.length(p_provider_order_id) not between 1 and 200
    or p_callback_nonce_digest is null
    or p_callback_nonce_digest !~ '^[0-9a-f]{64}$'
    or p_claim_token is null
  then
    raise invalid_parameter_value using message = 'goods_payment_callback_invalid';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.provider = p_provider
    and attempt.provider_order_id = p_provider_order_id
    and attempt.purpose = 'order';

  if not found
    or v_attempt.callback_nonce_digest is null
    or v_attempt.callback_nonce_digest is distinct from p_callback_nonce_digest
  then
    raise no_data_found using message = 'goods_payment_callback_invalid';
  end if;

  if v_attempt.state in ('approved', 'declined', 'canceled', 'unknown', 'needs_review') then
    return pg_catalog.jsonb_build_object(
      'claim_status', 'terminal',
      'attempt', private.goods_payment_attempt_json(v_attempt),
      'outcome', v_attempt.state
    );
  end if;

  if v_attempt.state = 'confirming' then
    return pg_catalog.jsonb_build_object(
      'claim_status', 'in_progress',
      'attempt', private.goods_payment_attempt_json(v_attempt)
    );
  end if;

  if v_attempt.state is distinct from 'prepared'
    or v_attempt.expires_at <= pg_catalog.clock_timestamp()
  then
    raise object_not_in_prerequisite_state using message = 'goods_payment_attempt_expired';
  end if;

  -- All goods transitions lock order before attempt. This matches prepare,
  -- cancellation, and expiry ordering and avoids an order/attempt deadlock.
  select order_record.*
  into v_order
  from public.orders as order_record
  where order_record.id = v_attempt.ref_id
  for update;

  if not found then
    raise no_data_found using message = 'goods_order_not_found';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.provider = p_provider
    and attempt.provider_order_id = p_provider_order_id
    and attempt.purpose = 'order'
  for update;

  if not found
    or v_attempt.callback_nonce_digest is null
    or v_attempt.callback_nonce_digest is distinct from p_callback_nonce_digest
  then
    raise no_data_found using message = 'goods_payment_callback_invalid';
  end if;

  if v_attempt.state in ('approved', 'declined', 'canceled', 'unknown', 'needs_review') then
    return pg_catalog.jsonb_build_object(
      'claim_status', 'terminal',
      'attempt', private.goods_payment_attempt_json(v_attempt),
      'outcome', v_attempt.state
    );
  end if;

  if v_attempt.state = 'confirming' then
    return pg_catalog.jsonb_build_object(
      'claim_status', 'in_progress',
      'attempt', private.goods_payment_attempt_json(v_attempt)
    );
  end if;

  if v_attempt.state is distinct from 'prepared'
    or v_attempt.expires_at <= pg_catalog.clock_timestamp()
  then
    raise object_not_in_prerequisite_state using message = 'goods_payment_attempt_expired';
  end if;

  if v_order.user_id is distinct from v_attempt.user_id
    or v_order.status is distinct from 'pending'
    or v_order.expires_at is null
    or v_order.expires_at <= pg_catalog.clock_timestamp()
    or v_order.total is distinct from v_attempt.amount
    or v_attempt.currency is distinct from 'KRW'
    or private.is_account_write_fenced(v_attempt.user_id)
    or exists (
      select 1
      from public.profiles as profile
      where profile.id = v_attempt.user_id
        and profile.suspended_at is not null
    )
    or not private.goods_order_snapshot_matches(
      v_order.id,
      v_order.total,
      v_order.shipping_fee
    )
    or exists (
      select 1
      from public.order_cancellation_requests as request
      where request.order_id = v_order.id
        and request.status in ('requested', 'processing', 'needs_review')
    )
    or exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = v_order.id
        and payment.status in ('pending', 'paid')
    )
  then
    raise object_not_in_prerequisite_state using message = 'goods_order_not_payable';
  end if;

  -- 판매 제한 재검증(#392). prepare가 파생한 provider가 지금도 유효한지 캡처
  -- 직전에 한 번 더 본다. 5번과 같은 파생 위반이므로 에러 어휘도 같다.
  --
  -- 거절해도 attempt 상태는 손대지 않는다 — prepared로 남아야 TTL이 지난 뒤
  -- 만료 경로(reconcile_expired_prepared_goods_cancellation · 주문
  -- expire_stale_checkouts)가 attempt를 canceled로 닫으면서 재고까지 함께
  -- 되돌린다. 여기서 attempt를 종결시키면 그 정리 경로가 대상을 잃는다.
  if v_attempt.provider = 'toss'
    and exists (
      select 1
      from public.order_items as item
      join public.goods as good on good.id = item.good_id
      where item.order_id = v_order.id
        and good.sale_restriction <> 'none'
    )
  then
    raise exception 'goods_payment_provider_mismatch' using errcode = '55000';
  end if;

  update public.payment_attempts
  set
    state = 'confirming',
    claim_token = p_claim_token,
    claim_expires_at = pg_catalog.clock_timestamp() + interval '10 minutes'
  where id = v_attempt.id
  returning * into v_attempt;

  return pg_catalog.jsonb_build_object(
    'claim_status', 'claimed',
    'attempt', private.goods_payment_attempt_json(v_attempt)
  );
end;
$function$;

revoke all on function public.claim_goods_payment_attempt(
  public.payment_provider, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.claim_goods_payment_attempt(
  public.payment_provider, text, text, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- 7. 검색 비노출 — /search RPC도 같은 축으로 거른다
-- ---------------------------------------------------------------------------
-- 20260717120001(카탈로그 보관) 사본에 goods 분기의 `sale_restriction = 'none'`
-- 한 줄만 더한 재정의다. 시그니처·반환 컬럼·security definer·search_path·점수
-- 계산·정렬과 IP·카드·포스트·태그 분기는 바이트 단위로 같다 — 제한 상품이 없으면
-- 이 함수는 한 행도 다르게 내지 않는다.
--
-- 이 재정의가 여기 있는 이유: 스토어 목록(카탈로그 스냅샷)·상세·캠페인 섹션·
-- 카트 담기는 앱 쿼리가 `sale_restriction = 'none'`으로 거르지만(#392), /search는
-- 그 쿼리를 지나지 않는다. lib/search.ts가 이 RPC를 방문자 세션으로 바로 부르고
-- 결과를 그대로 그리므로 함수 본문이 곧 노출 규칙인데, 최신 정의는 archived_at만
-- 걸러서 목록에서 감춘 19금 굿즈가 검색 한 번에 다시 나온다. 축을 도입한 이
-- 마이그레이션이 그 축의 마지막 공개 읽기 표면도 함께 닫는다.
--
-- 여전히 쿼리 레이어 비노출이다. 보안 경계는 4번(주문 생성 차단)과 5·6번
-- (provider 파생)이고, 여기서 거른다고 그 관문이 느슨해질 이유는 없다.
-- 성인인증(#209·#210)이 붙어 19금 오픈 트랙이 열리면 이 필터도 목록·상세와
-- 같은 시점에 인증된 성인 조건으로 바뀐다.
create or replace function public.search_public_content(
  search_query text,
  per_group_limit integer default 6
)
returns table (
  kind text,
  id text,
  label text,
  subtitle text,
  ip_id text,
  ip_title text,
  image_path text,
  bg text,
  accent text,
  score real
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  with raw_params as (
    select
      nullif(left(btrim(search_query), 80), '') as q,
      greatest(1, least(coalesce(per_group_limit, 6), 20)) as result_limit,
      auth.uid() as actor_id
  ),
  params as (
    select
      raw_params.q,
      case
        when raw_params.q is null then null
        else '%' || replace(replace(replace(raw_params.q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%'
      end as q_like,
      raw_params.result_limit,
      raw_params.actor_id
    from raw_params
  ),
  visible_posts as (
    select
      posts.id,
      posts.user_id,
      posts.ip_id,
      posts.text,
      posts.tag,
      posts.image_path,
      ips.title as ip_title,
      verticals.color as accent
    from public.posts
    left join public.ips on ips.id = posts.ip_id
    left join public.verticals on verticals.key = ips.vertical_key
    cross join params
    where params.q is not null
      and posts.status = 'visible'
      and not exists (
        select 1
        from public.blocks
        where blocks.user_id = params.actor_id
          and blocks.blocked_user_id = posts.user_id
      )
  ),
  all_matches as (
    select
      'ip'::text as kind,
      ips.id::text as id,
      ips.title as label,
      concat_ws(' · ', verticals.label, ips.sub) as subtitle,
      ips.id::text as ip_id,
      ips.title as ip_title,
      ips.image_path,
      ips.bg,
      verticals.color as accent,
      greatest(
        extensions.similarity(ips.title, params.q),
        case when ips.title ilike params.q_like escape E'\\' then 1 else 0 end,
        case when coalesce(ips.sub, '') ilike params.q_like escape E'\\' then 0.7 else 0 end,
        case when coalesce(ips.tagline, '') ilike params.q_like escape E'\\' then 0.6 else 0 end,
        case when coalesce(ips.synopsis, '') ilike params.q_like escape E'\\' then 0.4 else 0 end
      )::real as score,
      params.result_limit
    from params
    join public.ips on params.q is not null
    join public.verticals on verticals.key = ips.vertical_key
    where ips.archived_at is null
      and (
        ips.title ilike params.q_like escape E'\\'
        or coalesce(ips.sub, '') ilike params.q_like escape E'\\'
        or coalesce(ips.tagline, '') ilike params.q_like escape E'\\'
        or coalesce(ips.synopsis, '') ilike params.q_like escape E'\\'
        or extensions.similarity(ips.title, params.q) > 0.15
      )

    union all

    select
      'good'::text as kind,
      goods.id::text as id,
      goods.name as label,
      concat_ws(' · ', ips.title, goods.type) as subtitle,
      goods.ip_id::text,
      ips.title as ip_title,
      goods.image_path,
      goods.bg,
      verticals.color as accent,
      greatest(
        extensions.similarity(goods.name, params.q),
        case when goods.name ilike params.q_like escape E'\\' then 1 else 0 end,
        case when goods.type ilike params.q_like escape E'\\' then 0.7 else 0 end,
        case when coalesce(goods.badge, '') ilike params.q_like escape E'\\' then 0.4 else 0 end,
        case when ips.title ilike params.q_like escape E'\\' then 0.35 else 0 end
      )::real as score,
      params.result_limit
    from params
    join public.goods on params.q is not null
    join public.ips on ips.id = goods.ip_id
    join public.verticals on verticals.key = ips.vertical_key
    where goods.archived_at is null
      and ips.archived_at is null
      and goods.sale_restriction = 'none'
      and (
        goods.name ilike params.q_like escape E'\\'
        or goods.type ilike params.q_like escape E'\\'
        or coalesce(goods.badge, '') ilike params.q_like escape E'\\'
        or ips.title ilike params.q_like escape E'\\'
        or extensions.similarity(goods.name, params.q) > 0.15
      )

    union all

    select
      'card'::text as kind,
      cards.id::text as id,
      cards.name as label,
      concat_ws(' · ', ips.title, cards.rarity::text, cards.no) as subtitle,
      cards.ip_id::text,
      ips.title as ip_title,
      cards.image_path,
      cards.bg,
      verticals.color as accent,
      greatest(
        extensions.similarity(cards.name, params.q),
        case when cards.name ilike params.q_like escape E'\\' then 1 else 0 end,
        case when coalesce(cards.no, '') ilike params.q_like escape E'\\' then 0.5 else 0 end,
        case when cards.rarity::text ilike params.q_like escape E'\\' then 0.5 else 0 end,
        case when ips.title ilike params.q_like escape E'\\' then 0.35 else 0 end
      )::real as score,
      params.result_limit
    from params
    join public.cards on params.q is not null
    join public.ips on ips.id = cards.ip_id
    join public.verticals on verticals.key = ips.vertical_key
    where cards.archived_at is null
      and ips.archived_at is null
      and (
        cards.name ilike params.q_like escape E'\\'
        or coalesce(cards.no, '') ilike params.q_like escape E'\\'
        or cards.rarity::text ilike params.q_like escape E'\\'
        or ips.title ilike params.q_like escape E'\\'
        or extensions.similarity(cards.name, params.q) > 0.15
      )

    union all

    select
      'post'::text as kind,
      visible_posts.id::text as id,
      visible_posts.text as label,
      concat_ws(' · ', visible_posts.ip_title, case when visible_posts.tag is null then null else '#' || visible_posts.tag end) as subtitle,
      visible_posts.ip_id::text,
      visible_posts.ip_title,
      null::text as image_path,
      null::text as bg,
      visible_posts.accent,
      greatest(
        extensions.similarity(visible_posts.text, params.q),
        case when visible_posts.text ilike params.q_like escape E'\\' then 1 else 0 end,
        case when coalesce(visible_posts.tag, '') ilike params.q_like escape E'\\' then 0.8 else 0 end,
        case when coalesce(visible_posts.ip_title, '') ilike params.q_like escape E'\\' then 0.35 else 0 end
      )::real as score,
      params.result_limit
    from params
    join visible_posts on true
    where visible_posts.text ilike params.q_like escape E'\\'
      or coalesce(visible_posts.tag, '') ilike params.q_like escape E'\\'
      or coalesce(visible_posts.ip_title, '') ilike params.q_like escape E'\\'
      or extensions.similarity(visible_posts.text, params.q) > 0.15

    union all

    select
      'tag'::text as kind,
      visible_posts.tag as id,
      '#' || visible_posts.tag as label,
      '커뮤니티 태그'::text as subtitle,
      null::text as ip_id,
      null::text as ip_title,
      null::text as image_path,
      null::text as bg,
      max(visible_posts.accent) as accent,
      max(greatest(
        extensions.similarity(visible_posts.tag, params.q),
        case when visible_posts.tag ilike params.q_like escape E'\\' then 1 else 0 end
      ))::real as score,
      params.result_limit
    from params
    join visible_posts on visible_posts.tag is not null
    where visible_posts.tag ilike params.q_like escape E'\\'
      or extensions.similarity(visible_posts.tag, params.q) > 0.15
    group by visible_posts.tag, params.result_limit
  ),
  ranked as (
    select
      all_matches.*,
      row_number() over (
        partition by all_matches.kind
        order by all_matches.score desc, all_matches.label asc, all_matches.id asc
      ) as group_rank
    from all_matches
  )
  select
    ranked.kind,
    ranked.id,
    ranked.label,
    ranked.subtitle,
    ranked.ip_id,
    ranked.ip_title,
    ranked.image_path,
    ranked.bg,
    ranked.accent,
    ranked.score
  from ranked
  where ranked.group_rank <= ranked.result_limit
  order by
    case ranked.kind
      when 'ip' then 1
      when 'good' then 2
      when 'card' then 3
      when 'post' then 4
      when 'tag' then 5
      else 6
    end,
    ranked.score desc,
    ranked.label asc,
    ranked.id asc;
$$;

-- create or replace는 기존 ACL을 보존하지만, 봉인 상태를 파일 안에서 읽을 수
-- 있도록 명시한다(20260707090001 규율). 검색은 공개 브라우징이라 anon과
-- authenticated에 열리고, service role은 부르지 않는다.
revoke all on function public.search_public_content(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.search_public_content(text, integer)
  to anon, authenticated;
