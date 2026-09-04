-- D-10 ② — 판매 상태 파생 · 스토어 뷰 · 주문/결제 게이트 (설계서 v2 §1-2, 리서치 보고서 B §2)
--
-- 상태는 저장하지 않는다. 우선순위: 보관 › 숨김 › 운영 중지 › 기간 만료 › 판매 예정 › 품절 › 선주문 › 판매중.
-- 근거 — 보관은 존재를 지우고, 숨김은 노출을 지우고, 운영 중지는 사람의 명시적 결정이라 시간·재고보다 세다.
-- 기간 만료는 재입고돼도 못 팔고, 판매 예정은 재고가 있어도 못 판다. 품절은 기간 안의 일시 상태다.

create or replace function public.good_sale_state(g public.goods, at timestamptz default now())
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when g.archived_at is not null then 'archived'
    when g.hidden_at is not null then 'hidden'
    when g.stopped_at is not null then 'stopped'
    when g.sale_ends_at is not null and g.sale_ends_at <= at then 'ended'
    when g.sale_starts_at is not null and g.sale_starts_at > at then 'scheduled'
    when g.stock = 'soldout' or g.stock_qty <= 0 then 'soldout'
    when g.sale_mode = 'preorder' then 'preorder'
    else 'on_sale'
  end;
$$;

create or replace function public.good_purchasable(g public.goods, at timestamptz default now())
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.good_sale_state(g, at) in ('on_sale', 'preorder');
$$;

revoke all on function public.good_sale_state(public.goods, timestamptz) from public;
revoke all on function public.good_purchasable(public.goods, timestamptz) from public;
grant execute on function public.good_sale_state(public.goods, timestamptz) to anon, authenticated, service_role;
grant execute on function public.good_purchasable(public.goods, timestamptz) to anon, authenticated, service_role;

-- 스토어가 읽는 창. 보관·숨김은 아예 나오지 않고, 나머지는 상태 배지와 함께 남는다(카페24 판매안함 = 품절 표시).
create or replace view public.goods_storefront
with (security_invoker = true)
as
select
  goods.id, goods.ip_id, goods.name, goods.type, goods.price, goods.compare_at_price,
  goods.created_at, goods.badge, goods.stock, goods.stock_qty, goods.bg, goods.image_path,
  goods.allow_bank_transfer, goods.summary, goods.image_alt, goods.seo_title, goods.seo_description,
  goods.sale_mode, goods.sale_starts_at, goods.sale_ends_at, goods.preorder_ships_at,
  public.good_sale_state(goods) as sale_state,
  public.good_purchasable(goods) as purchasable
from public.goods as goods
where goods.archived_at is null
  and goods.hidden_at is null;

grant select on public.goods_storefront to anon, authenticated;

-- 분류별 진열. 고정 핀 → (품절 뒤로) → 이 분류 직속 → 진열 순서 → 상품 id.
-- 하위 분류를 포함하면 서로 다른 분류의 순서 번호가 섞이므로, 직속 소속을 먼저 놓아 예측 가능하게 만든다.
-- 한 상품이 분류와 그 하위에 동시에 속하면 직속 소속 행 하나로 접는다.
create or replace function public.category_goods(p_category_id text, at timestamptz default now())
returns table (good_id text, display_position integer, pinned boolean, sale_state text)
language sql
stable
set search_path = ''
as $$
  with target as (
    select category.id, category.path, category.include_descendants, category.soldout_last
    from public.categories as category
    where category.id = p_category_id
  ),
  candidates as (
    select distinct on (good.id)
      good.id as good_id,
      membership.position as display_position,
      membership.pinned,
      public.good_sale_state(good, at) as sale_state,
      scope.id = target.id as direct,
      target.soldout_last
    from target
    join public.categories as scope
      on scope.id = target.id
      or (target.include_descendants and scope.path like target.path || '%')
    join public.good_categories as membership on membership.category_id = scope.id
    join public.goods as good on good.id = membership.good_id
    where good.archived_at is null
      and good.hidden_at is null
      and (membership.display_from is null or membership.display_from <= at)
      and (membership.display_until is null or membership.display_until > at)
    order by good.id, (scope.id = target.id) desc, membership.pinned desc, membership.position
  )
  select candidates.good_id, candidates.display_position, candidates.pinned, candidates.sale_state
  from candidates
  order by
    candidates.pinned desc,
    case when candidates.soldout_last and candidates.sale_state = 'soldout' then 1 else 0 end,
    case when candidates.direct then 0 else 1 end,
    candidates.display_position,
    candidates.good_id;
$$;

revoke all on function public.category_goods(text, timestamptz) from public;
grant execute on function public.category_goods(text, timestamptz) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 주문 게이트 — 예약 직전에 판매 가능 여부를 다시 본다.
-- ---------------------------------------------------------------------------
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
  v_good public.goods;
  v_state text;
begin
  select * into v_good from public.goods as good where good.id = p_good_id;
  v_state := public.good_sale_state(v_good);
  /*
   * 품절은 기존 문구를 지킨다 — 앱이 'out of stock' 을 읽어 "재고가 변경됐어요"로 안내한다.
   * 기간 만료·판매 예정·운영 중지·숨김은 재고 문제가 아니라 판매 자격 문제라 다른 코드로 거절한다.
   */
  if v_state = 'soldout' then
    raise check_violation using message = pg_catalog.format('out of stock: %s', p_good_id);
  elsif v_state not in ('on_sale', 'preorder') then
    raise check_violation using message = pg_catalog.format('goods_not_purchasable: %s (%s)', p_good_id, v_state);
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

CREATE OR REPLACE FUNCTION public.prepare_goods_payment_attempt(p_user_id uuid, p_order_id uuid, p_provider payment_provider)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_attempt_id uuid;
  v_attempt_expires_at timestamptz;
begin
  if p_user_id is null
    or p_order_id is null
    or p_provider not in ('korpay', 'bank_transfer')
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

  -- D-10: 결제 준비는 두 번째 관문이다. 주문을 만든 뒤 판매 기간이 끝났거나 운영자가 판매를 멈췄으면
  -- 여기서 막는다 — 스토어 비노출은 쿼리 레이어라 보안 경계가 아니다(PR #403 원칙).
  if exists (
    select 1
    from public.order_items as item
    join public.goods as good on good.id = item.good_id
    where item.order_id = v_order.id
      and not public.good_purchasable(good)
  ) then
    raise object_not_in_prerequisite_state using message = 'goods_not_purchasable';
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
