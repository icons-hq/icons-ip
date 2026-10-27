-- ============================================================================
-- 결제가 완료될 때까지 장바구니를 유지한다 (10/14 회의 D3 · S12, ADR-0026)
--
-- 이전 계약: 주문 생성 트랜잭션이 장바구니 줄과 장바구니 쿠폰 선택을 지웠다. 결제창을
-- 닫거나 결제가 실패·만료되면 장바구니가 비어 있었다.
--
-- 새 계약(업계 관행 · LINE FRIENDS SQUARE · 네이버 스마트스토어):
-- 1. 카드 장바구니 주문은 생성할 때 장바구니를 지우지 않는다. 그 주문의 줄을
--    private.cart_order_holds에 'awaiting_payment'로 기록한다.
-- 2. 결제 finalizer가 주문을 paid로 바꾸는 바로 그 트랜잭션에서(orders AFTER 트리거)
--    기록된 줄의 수량만큼 장바구니에서 뺀다. 카트 수량이 더 크면 차감, 같거나 작으면
--    삭제, 이미 없으면 무시한다. 그 주문이 사용한 쿠폰이 장바구니에 선택돼 있으면
--    선택을 지운다. 카트 정리가 실패해도 결제 확정은 절대 되돌리지 않는다.
-- 3. 무통장 입금은 접수 = 주문 완료(입금대기)라 종전처럼 생성 시 장바구니를 지운다.
-- 4. 같은 계정이 장바구니로 새 주문을 만들면, 이전 미결제 카드 장바구니 주문을 기존
--    만료 sweep과 같은 닫기 경로로 닫아 재고 예약·쿠폰·적립금·구매 한도를 돌려준다.
--    결제 시도가 prepared면 TTL과 무관하게 canceled로 바꾸므로 늦게 온 결제창 콜백은
--    claim이 terminal로 거절해 승인 API를 부르지 않는다. 지금 승인 확인이 진행 중
--    (confirming + 유효한 claim)인 이전 주문이 있으면 새 주문을 checkout_payment_in_progress로
--    막는다(이중 결제 방지). 결과를 자동으로 확정할 수 없는 이전 주문(unknown·needs_review·
--    결제 원장 존재)은 닫지 않고, 그 보류만 장바구니에서 떼어 낸다(늦게 확정돼도 새
--    장바구니를 건드리지 않는다).
-- 5. 고객이 장바구니·주문서로 돌아오면 앱이 같은 닫기를 먼저 요청한다
--    (public.release_unpaid_cart_orders). 미결제 주문이 쿠폰·구매 한도를 잡은 채로
--    견적이 막히는 막다른 길을 없앤다.
--
-- 범위: 앱의 장바구니 주문 진입점 두 곳(legacy place_order_with_cart_snapshot ·
-- 거래 런타임 place_cart_goods_transaction)만 새 계약을 쓴다. 기존 신뢰 경로
-- (place_order·place_order_with_store_credits 직접 호출)는 종전처럼 생성 시 소비한다.
-- 선물·정기배송 회차는 장바구니를 읽지 않으므로 보류가 없고 결제 확정도 장바구니를
-- 건드리지 않는다. 운영의 기존 결제 대기 주문(보류 없음)도 그대로다.
--
-- 함수 본문 재정의 기준(최신 정의):
--   place_order_with_cart_snapshot      ← 20261020085146
--   place_order_before_shipments        ← 현재 정의에서 앵커 두 곳만 치환(20261020085146)
--   place_cart_goods_transaction        ← 20261020085509
-- ============================================================================

create table private.cart_order_holds (
  order_id uuid primary key references public.orders(id) on delete cascade,
  user_id uuid not null,
  source text not null check (source in ('legacy_checkout', 'cart_transaction')),
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0),
  state text not null default 'awaiting_payment'
    check (state in ('awaiting_payment', 'consumed', 'released')),
  created_at timestamptz not null default clock_timestamp(),
  settled_at timestamptz,
  release_reason text check (release_reason in ('superseded', 'detached', 'order_closed')),
  consumption jsonb,
  check ((state = 'awaiting_payment') = (settled_at is null)),
  check ((state = 'released') = (release_reason is not null)),
  check ((state = 'consumed') = (consumption is not null))
);
comment on table private.cart_order_holds is
  '카드 장바구니 주문이 결제 확정 때 장바구니에서 뺄 줄(ADR-0026). 결제 확정=consumed, 닫힘=released.';
create index cart_order_holds_awaiting_user_idx
  on private.cart_order_holds (user_id, created_at, order_id)
  where state = 'awaiting_payment';
alter table private.cart_order_holds enable row level security;
revoke all on table private.cart_order_holds from public, anon, authenticated, service_role;

-- legacy 주문 코어가 이번 호출에서 장바구니를 남겨야 하는지. 앱 진입점
-- place_order_with_cart_snapshot만 트랜잭션 로컬로 켜고, 코어를 부른 직후 끈다.
create function private.cart_retention_active()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(pg_catalog.current_setting('icons.cart_order_retention', true), '') = 'on';
$$;
revoke all on function private.cart_retention_active() from public, anon, authenticated, service_role;
grant execute on function private.cart_retention_active() to postgres;

-- 호출자가 계정·장바구니 잠금을 쥔 채 방금 장바구니 전체로 주문을 만들었다. 지금
-- 장바구니가 곧 그 주문의 줄이다(주문 = 장바구니 전체 계약).
create function private.record_cart_order_hold(p_order_id uuid, p_user_id uuid, p_source text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_lines jsonb;
begin
  if not exists (
    select 1 from public.orders as o
    where o.id = p_order_id and o.user_id = p_user_id
      and o.status = 'pending' and o.payment_method = 'card'
  ) then
    raise check_violation using message = 'cart_order_hold_order_invalid';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'goodId', cart.good_id, 'variantId', cart.variant_id, 'inputKey', cart.input_key,
      'inputRevision', cart.input_revision, 'inputValues', cart.input_values, 'qty', cart.qty)
      order by cart.good_id, cart.variant_id, cart.input_key), '[]'::jsonb)
    into v_lines
  from public.cart_items as cart
  where cart.user_id = p_user_id;
  if pg_catalog.jsonb_array_length(v_lines) = 0 then
    raise check_violation using message = 'cart_order_hold_empty';
  end if;
  insert into private.cart_order_holds (order_id, user_id, source, lines)
  values (p_order_id, p_user_id, p_source, v_lines)
  on conflict (order_id) do nothing;
end;
$$;
revoke all on function private.record_cart_order_hold(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function private.record_cart_order_hold(uuid, uuid, text) to postgres;

-- 미결제 카드 장바구니 주문 하나를 결제 없이 닫는다. 만료 sweep(expire_stale_checkouts,
-- 20261013110400)과 같은 잠금 순서(order → request → attempt)와 같은 종결 함수를 쓰고,
-- 차이는 prepared 시도를 TTL과 무관하게 canceled로 바꾼다는 점뿐이다. 호출자는 계정
-- advisory lock을 쥐고 있어야 한다.
-- 반환: closed | payment_confirming | unresolved | not_pending
create function private.close_unpaid_cart_order(p_order_id uuid, p_reason text, p_trigger text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_has_attempt boolean := false;
  v_attempt_canceled boolean := false;
  v_request record;
  v_request_id uuid;
begin
  select o.* into v_order from public.orders as o where o.id = p_order_id for update;
  if not found or v_order.status <> 'pending' or v_order.payment_method <> 'card' then
    return 'not_pending';
  end if;

  -- 같은 임계 구역: order → request → attempt (claim·finalizer·sweep과 같은 순서).
  select request.id, request.reason, request.status
    into v_request
  from public.order_cancellation_requests as request
  where request.order_id = p_order_id
    and request.status in ('requested', 'processing', 'needs_review')
  order by request.requested_at desc, request.id desc
  limit 1
  for update;
  if found and v_request.status <> 'requested' then
    -- 승인된 결제의 취소(환불)가 진행 중이다. 돈이 움직였으므로 닫지 않는다.
    return 'unresolved';
  end if;

  select attempt.* into v_attempt
  from public.payment_attempts as attempt
  where attempt.purpose = 'order' and attempt.ref_id = p_order_id
  for update;
  v_has_attempt := found;

  if v_has_attempt and v_attempt.state = 'confirming'
    and v_attempt.claim_expires_at is not null
    and v_attempt.claim_expires_at > pg_catalog.clock_timestamp()
  then
    return 'payment_confirming';
  end if;
  if (v_has_attempt and v_attempt.state in ('confirming', 'unknown', 'needs_review', 'approved'))
    or exists (
      select 1 from public.payments as payment
      where payment.purpose = 'order' and payment.ref_id = p_order_id
        and payment.status in ('pending', 'paid')
    )
  then
    return 'unresolved';
  end if;

  if v_has_attempt and v_attempt.state = 'prepared' then
    update public.payment_attempts as attempt
    set state = 'canceled', claim_token = null, claim_expires_at = null
    where attempt.id = v_attempt.id and attempt.state = 'prepared';
    v_attempt_canceled := found;
  end if;

  -- 보류를 먼저 닫아야 아래 취소 트리거가 사유를 order_closed로 덮지 않는다.
  update private.cart_order_holds
  set state = 'released', settled_at = pg_catalog.clock_timestamp(), release_reason = 'superseded'
  where order_id = p_order_id and state = 'awaiting_payment';

  if v_request.id is not null then
    -- 결제 중 접수된 고객 취소 요청. 시도가 결제 없이 끝났으므로(방금 canceled로
    -- 바꿨거나 이미 declined/canceled) sweep과 같이 요청을 종결하고 알린다.
    v_request_id := v_request.id;
    perform public.finalize_order_cancellation_with_provider_evidence(
      p_order_id, v_request.reason, array[]::text[]);
    update public.order_cancellation_requests as request
    set status = 'completed',
        completed_at = coalesce(request.completed_at, pg_catalog.clock_timestamp()),
        updated_at = pg_catalog.clock_timestamp()
    where request.id = v_request_id and request.status = 'requested';
    perform private.notify_order_claim(
      v_request_id, 'completed', '주문이 취소됐어요',
      '결제가 완료되지 않은 주문이라 결제 없이 취소했습니다.');
  else
    perform public.cancel_order(p_order_id, p_reason);
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    null,
    'system.order.unpaid_cart_order_closed',
    'order:' || p_order_id::text,
    pg_catalog.jsonb_build_object(
      'trigger', p_trigger,
      'attemptState', case when v_has_attempt then v_attempt.state::text end,
      'attemptCanceled', v_attempt_canceled,
      'requestId', v_request_id,
      'actor', 'system'
    )
  );
  return 'closed';
end;
$$;
revoke all on function private.close_unpaid_cart_order(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function private.close_unpaid_cart_order(uuid, text, text) to postgres;

-- 계정의 미결제 카드 장바구니 주문을 닫는다. 호출자는 계정 advisory lock을 쥐고
-- 장바구니 잠금은 아직 쥐지 않아야 한다(finalizer는 order → cart 순서로 잠근다).
-- p_new_order=true: 새 장바구니 주문 직전. 승인 확인 중인 이전 주문이 있으면 막고,
--   자동으로 확정할 수 없는 이전 주문의 보류는 장바구니에서 떼어 낸다.
-- p_new_order=false: 고객이 장바구니·주문서로 돌아왔을 때. 닫을 수 있는 것만 닫는다.
create function private.supersede_unpaid_cart_orders(p_user_id uuid, p_new_order boolean)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r record;
  v_result text;
  v_closed integer := 0;
begin
  if p_user_id is null or p_new_order is null then
    raise invalid_parameter_value using message = 'cart_order_supersede_invalid';
  end if;
  for r in
    select hold.order_id
    from private.cart_order_holds as hold
    where hold.user_id = p_user_id and hold.state = 'awaiting_payment'
    order by hold.created_at, hold.order_id
  loop
    v_result := private.close_unpaid_cart_order(
      r.order_id,
      case when p_new_order then '같은 장바구니로 새 주문을 만들어 결제 대기 주문 자동 취소'
        else '장바구니로 돌아와 결제 대기 주문 자동 취소' end,
      case when p_new_order then 'new_cart_order' else 'returned_to_cart' end);
    if v_result = 'closed' then
      v_closed := v_closed + 1;
    elsif v_result = 'payment_confirming' and p_new_order then
      raise sqlstate 'PT409' using message = 'checkout_payment_in_progress';
    elsif v_result = 'unresolved' and p_new_order then
      update private.cart_order_holds
      set state = 'released', settled_at = pg_catalog.clock_timestamp(), release_reason = 'detached'
      where order_id = r.order_id and state = 'awaiting_payment';
      insert into public.audit_log (actor_id, action, target, diff)
      values (null, 'system.order.cart_hold_detached', 'order:' || r.order_id::text,
        pg_catalog.jsonb_build_object('trigger', 'new_cart_order', 'actor', 'system'));
    end if;
  end loop;
  return v_closed;
end;
$$;
revoke all on function private.supersede_unpaid_cart_orders(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function private.supersede_unpaid_cart_orders(uuid, boolean) to postgres;

-- 고객이 장바구니·주문서로 돌아왔을 때 앱(service role)이 부른다. 닫힌 주문 수를 돌려준다.
create function public.release_unpaid_cart_orders(p_user_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise invalid_parameter_value using message = 'cart_order_supersede_invalid';
  end if;
  -- 주문 생성·쿠폰 선택과 같은 계정 잠금. 장바구니 잠금은 잡지 않는다.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  if not exists (
    select 1 from private.cart_order_holds as hold
    where hold.user_id = p_user_id and hold.state = 'awaiting_payment'
  ) then
    return 0;
  end if;
  return private.supersede_unpaid_cart_orders(p_user_id, false);
end;
$$;
revoke all on function public.release_unpaid_cart_orders(uuid) from public, anon, authenticated, service_role;
grant execute on function public.release_unpaid_cart_orders(uuid) to service_role;

-- 결제 화면·주문 완료 화면이 "장바구니가 그대로 있는 주문인지" 읽는다. 서버(service role)가
-- 로그인 사용자의 주문에 대해서만 부른다. 보류 줄(상품·수량)은 돌려주지 않는다.
create function public.service_get_order_cart_retention(p_user_id uuid, p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('state', hold.state, 'releaseReason', hold.release_reason)
  from private.cart_order_holds as hold
  where hold.order_id = p_order_id and hold.user_id = p_user_id;
$$;
revoke all on function public.service_get_order_cart_retention(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_get_order_cart_retention(uuid, uuid) to service_role;

-- 결제 확정(pending → paid) 또는 닫힘(pending → canceled)에서 보류를 정산한다. 이름은
-- 다른 AFTER 트리거(적립금·쿠폰·등급 등)보다 먼저 실행되도록 고른다 — finalizer의 잠금
-- 순서가 order → attempt → payments → cart → (적립금·쿠폰)이 되어, 장바구니를 쥔 채 적립금을
-- 기다리는 주문 생성과 교착하지 않는다.
create function private.settle_cart_order_hold()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_hold private.cart_order_holds%rowtype;
  v_line jsonb;
  v_cart public.cart_items%rowtype;
  v_ordered integer;
  v_outcome text;
  v_result jsonb := '[]'::jsonb;
  v_cleared integer := 0;
begin
  if new.status = 'canceled' then
    update private.cart_order_holds
    set state = 'released', settled_at = pg_catalog.clock_timestamp(), release_reason = 'order_closed'
    where order_id = new.id and state = 'awaiting_payment';
    return null;
  end if;

  select hold.* into v_hold
  from private.cart_order_holds as hold
  where hold.order_id = new.id and hold.state = 'awaiting_payment'
  for update;
  if not found then
    return null;
  end if;

  -- 결제는 이미 확정됐다. 장바구니 정리가 어떤 이유로 실패해도 결제 확정을 되돌리지 않는다.
  begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cart:' || v_hold.user_id::text, 0));
    for v_line in select value from pg_catalog.jsonb_array_elements(v_hold.lines) loop
      v_ordered := (v_line ->> 'qty')::integer;
      select cart.* into v_cart
      from public.cart_items as cart
      where cart.user_id = v_hold.user_id
        and cart.variant_id = (v_line ->> 'variantId')::uuid
        and cart.input_key = v_line ->> 'inputKey'
      for update;
      if not found then
        v_outcome := 'absent';
      elsif v_cart.qty > v_ordered then
        begin
          update public.cart_items
          set qty = qty - v_ordered
          where user_id = v_hold.user_id and variant_id = v_cart.variant_id and input_key = v_cart.input_key;
          v_outcome := 'decreased';
        exception when others then
          -- 직접입력 정의가 바뀌어 수량 변경 트리거가 거절하는 경우 등. 줄은 그대로 둔다.
          v_outcome := 'kept';
        end;
      else
        delete from public.cart_items
        where user_id = v_hold.user_id and variant_id = v_cart.variant_id and input_key = v_cart.input_key;
        v_outcome := 'removed';
      end if;
      v_result := v_result || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'variantId', v_line -> 'variantId', 'inputKey', v_line -> 'inputKey', 'orderedQty', v_ordered,
        'cartQtyBefore', case when v_outcome = 'absent' then null else v_cart.qty end, 'outcome', v_outcome));
    end loop;

    delete from public.cart_coupon_selections as selection
    where selection.user_id = v_hold.user_id
      and selection.user_coupon_id in (
        select redemption.user_coupon_id from public.coupon_redemptions as redemption
        where redemption.order_id = new.id and redemption.status = 'applied');
    get diagnostics v_cleared = row_count;

    update private.cart_order_holds
    set state = 'consumed', settled_at = pg_catalog.clock_timestamp(),
        consumption = pg_catalog.jsonb_build_object('lines', v_result, 'couponSelectionCleared', v_cleared > 0)
    where order_id = new.id;
  exception when others then
    update private.cart_order_holds
    set state = 'consumed', settled_at = pg_catalog.clock_timestamp(),
        consumption = pg_catalog.jsonb_build_object('failed', sqlstate)
    where order_id = new.id and state = 'awaiting_payment';
  end;
  return null;
end;
$$;
revoke all on function private.settle_cart_order_hold() from public, anon, authenticated, service_role;
create trigger order_cart_hold_settlement
  after update of status on public.orders
  for each row
  when (old.status = 'pending' and new.status in ('paid', 'canceled'))
  execute function private.settle_cart_order_hold();

-- legacy 주문 코어: 앱 진입점이 장바구니 유지를 켠 카드 주문만 장바구니 줄과 쿠폰 선택을
-- 남긴다. 나머지 본문(가격·재고·쿠폰·적립금·무통장 시도)은 현재 정의 그대로다.
do $$
declare
  v_definition text;
  v_cart_anchor text := E'    delete from public.cart_items\n    where user_id = v_user\n      and id = r.cart_item_id;';
  v_coupon_anchor text := E'    delete from public.cart_coupon_selections\n    where user_id = v_user\n      and user_coupon_id = v_selected_coupon;';
begin
  v_definition := pg_catalog.pg_get_functiondef('private.place_order_before_shipments(jsonb,uuid,public.order_payment_method)'::regprocedure);
  if (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_cart_anchor, ''))) / pg_catalog.length(v_cart_anchor) <> 1
    or (pg_catalog.length(v_definition) - pg_catalog.length(pg_catalog.replace(v_definition, v_coupon_anchor, ''))) / pg_catalog.length(v_coupon_anchor) <> 1
  then
    raise exception 'cart_retention_place_order_anchor_changed';
  end if;
  v_definition := pg_catalog.replace(v_definition, v_cart_anchor,
    E'    -- 카드 장바구니 주문은 결제 확정 때 장바구니에서 뺀다(ADR-0026).\n'
    || E'    if not (p_payment_method = ''card'' and private.cart_retention_active()) then\n'
    || E'      delete from public.cart_items\n      where user_id = v_user\n        and id = r.cart_item_id;\n'
    || E'    end if;');
  v_definition := pg_catalog.replace(v_definition, v_coupon_anchor,
    E'    if not (p_payment_method = ''card'' and private.cart_retention_active()) then\n'
    || E'      delete from public.cart_coupon_selections\n      where user_id = v_user\n        and user_coupon_id = v_selected_coupon;\n'
    || E'    end if;');
  execute v_definition;
end;
$$;
revoke all on function private.place_order_before_shipments(jsonb,uuid,public.order_payment_method) from public,anon,authenticated,service_role;
grant execute on function private.place_order_before_shipments(jsonb,uuid,public.order_payment_method) to postgres;

-- 앱의 legacy 장바구니 주문 진입점. 이전 미결제 장바구니 주문을 먼저 닫고(계정 잠금 →
-- 주문 → 장바구니 잠금 순서), 카드 주문이면 장바구니를 남긴 채 보류를 기록한다.
create or replace function public.place_order_with_cart_snapshot(
 p_user_id uuid,p_address jsonb,p_checkout_key uuid,p_payment_method public.order_payment_method,
 p_store_credit_amount bigint,p_expected_user_coupon_id uuid,p_expected_cart jsonb
) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare expected_cart jsonb; actual_cart jsonb; entry jsonb; placed uuid;
begin
 if p_user_id is null or p_checkout_key is null then raise invalid_parameter_value using message='invalid_checkout_cart_snapshot'; end if;
 -- Match the pre-existing checkout/coupon lock order: user, then cart. Replays
 -- validate their original order contract without looking at today's cart.
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 if exists(select 1 from public.orders where user_id=p_user_id and checkout_key=p_checkout_key) then
   return public.place_order_with_store_credits(p_user_id,p_address,p_checkout_key,p_payment_method,p_store_credit_amount,p_expected_user_coupon_id);
 end if;
 if jsonb_typeof(p_expected_cart) is distinct from 'array' then raise invalid_parameter_value using message='invalid_checkout_cart_snapshot'; end if;
 for entry in select value from jsonb_array_elements(p_expected_cart) loop
   if jsonb_typeof(entry)<>'object' or not(entry ?& array['good_id','variant_id','qty','input_revision','input_values'])
     or exists(select 1 from jsonb_object_keys(entry) key where key not in ('good_id','variant_id','qty','input_revision','input_values'))
     or jsonb_typeof(entry->'good_id')<>'string' or nullif(btrim(entry->>'good_id'),'') is null
     or jsonb_typeof(entry->'variant_id')<>'string' or entry->>'variant_id'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or jsonb_typeof(entry->'qty')<>'number' or entry->>'qty'!~'^[1-9][0-9]*$'
     or jsonb_typeof(entry->'input_revision')<>'number' or entry->>'input_revision'!~'^(0|[1-9][0-9]*)$'
     or jsonb_typeof(entry->'input_values')<>'object' then
     raise invalid_parameter_value using message='invalid_checkout_cart_snapshot';
   end if;
 end loop;
 -- 이전 미결제 장바구니 주문의 재고·쿠폰·적립금·구매 한도를 먼저 돌려준다(ADR-0026).
 perform private.supersede_unpaid_cart_orders(p_user_id,true);
 -- Compare canonical values, not labels or hashes supplied by the browser.
 select coalesce(jsonb_agg(value order by value->>'good_id',(value->>'variant_id')::uuid,value->>'input_revision',(value->'input_values')::text),'[]')
   into expected_cart from jsonb_array_elements(p_expected_cart);
 perform pg_advisory_xact_lock(hashtextextended('cart:'||p_user_id::text,0));
 select coalesce(jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,
   'input_revision',input_revision,'input_values',input_values) order by good_id,variant_id,input_revision::text,input_values::text),'[]')
   into actual_cart from public.cart_items where user_id=p_user_id;
 if expected_cart is distinct from actual_cart then raise sqlstate 'PT409' using message='cart_snapshot_changed'; end if;
 if p_payment_method='card' then perform set_config('icons.cart_order_retention','on',true); end if;
 placed:=public.place_order_with_store_credits(p_user_id,p_address,p_checkout_key,p_payment_method,p_store_credit_amount,p_expected_user_coupon_id);
 perform set_config('icons.cart_order_retention','',true);
 if p_payment_method='card' then perform private.record_cart_order_hold(placed,p_user_id,'legacy_checkout'); end if;
 return placed;
end $$;
revoke all on function public.place_order_with_cart_snapshot(uuid,jsonb,uuid,public.order_payment_method,bigint,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.place_order_with_cart_snapshot(uuid,jsonb,uuid,public.order_payment_method,bigint,uuid,jsonb) to service_role;

-- 거래 런타임 장바구니 어댑터. 계정 잠금 → 이전 미결제 주문 닫기 → 장바구니 잠금 순서.
CREATE OR REPLACE FUNCTION public.place_cart_goods_transaction(p_user_id uuid, p_expected_cart jsonb, p_address jsonb, p_quote_id uuid, p_checkout_key uuid, p_payment_method order_payment_method)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare selection jsonb;source jsonb;selected_coupon uuid;quoted_coupon uuid;combined boolean;result uuid;begin
 selection:=private.cart_goods_transaction_expected_selection(p_expected_cart);source:=private.goods_cart_transaction_source(p_user_id,selection);
 perform private.lock_goods_transaction_actor(p_user_id);
 if exists(select 1 from private.order_goods_transactions where actor_id=p_user_id and checkout_key=p_checkout_key) then
  perform private.lock_goods_transaction_source(p_user_id,source);
  return private.place_goods_transaction(p_user_id,source,selection,p_address,p_quote_id,p_checkout_key,p_payment_method);end if;
 -- 이전 미결제 장바구니 주문의 재고·쿠폰·적립금·구매 한도를 먼저 돌려준다(ADR-0026).
 perform private.supersede_unpaid_cart_orders(p_user_id,true);
 perform private.lock_goods_transaction_source(p_user_id,source);
 perform private.assert_cart_goods_transaction_selection(p_user_id,selection);
 select user_coupon_id into selected_coupon from public.cart_coupon_selections where user_id=p_user_id;
 select user_coupon_id,user_coupon_ids is not null into quoted_coupon,combined from private.goods_transaction_quotes where id=p_quote_id and actor_id=p_user_id;
 if found and not combined and selected_coupon is distinct from quoted_coupon then raise sqlstate 'PT409' using message='coupon_snapshot_changed';end if;
 result:=private.place_goods_transaction(p_user_id,source,selection,p_address,p_quote_id,p_checkout_key,p_payment_method);
 if p_payment_method='bank_transfer' then
  -- 무통장은 접수 = 주문 완료(입금대기)다. 종전처럼 지금 장바구니에서 뺀다.
  -- Only this adapter owns the live cart. Gift/subscription never read it.
  delete from public.cart_items cart where user_id=p_user_id and exists(select 1 from jsonb_array_elements(selection) selected
   where selected->>'goodId'=cart.good_id and (selected->>'variantId')::uuid=cart.variant_id and (selected->>'qty')::integer=cart.qty
    and (selected->>'inputRevision')::integer=cart.input_revision and selected->'inputValues'=cart.input_values);
  delete from public.cart_coupon_selections where user_id=p_user_id and (combined or user_coupon_id=quoted_coupon);
 else
  -- 카드는 결제 확정 때 장바구니에서 뺀다(ADR-0026).
  perform private.record_cart_order_hold(result,p_user_id,'cart_transaction');
 end if;
 return result;
end $function$;
revoke all on function public.place_cart_goods_transaction(uuid,jsonb,jsonb,uuid,uuid,public.order_payment_method) from public,anon,authenticated,service_role;
grant execute on function public.place_cart_goods_transaction(uuid,jsonb,jsonb,uuid,uuid,public.order_payment_method) to service_role;

select private.register_operator_internal_contract('private.place_order_before_shipments(jsonb,uuid,public.order_payment_method)'::regprocedure);
select private.register_operator_internal_contract('public.place_cart_goods_transaction(uuid,jsonb,jsonb,uuid,uuid,public.order_payment_method)'::regprocedure);

notify pgrst, 'reload schema';
