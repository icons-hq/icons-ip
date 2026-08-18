-- ============================================================================
-- ICONS · 주문 상태 사다리 확장 (#250)
--
--   pending ─결제확정─▶ paid ─발주확인─▶ confirmed ─발송처리─▶ shipping
--           ─배송완료─▶ delivered ─+8일 자동─▶ done(거래확정)
--           └──────────────────────────────────▶ canceled
--
-- enum 값 자체는 20260818090000이 먼저 커밋한다(같은 트랜잭션에서 새 enum 값을
-- 쓸 수 없다). 이 파일은 컬럼 추가, 상태 게이트 전수 갱신, 자동 거래확정 잡을 담는다.
--
-- ## 이전 상태값과의 대응
--
-- 기존 게이트를 기계적으로 넓히는 기준은 "옛 상태가 새 사다리의 어디에
-- 해당하는가"다. 이 대응을 벗어나는 게이트는 아래에 개별 근거를 남긴다.
--
--   옛 paid     → 새 paid · confirmed        (결제됐고 아직 발송 전)
--   옛 shipping → 새 shipping                (배송 중)
--   옛 done     → 새 delivered · done        (공급 완료 이후)
--
-- ## delivered_at 의 의미와 기록 시점
--
-- delivered_at은 #189가 "재화를 공급받은 날"(전자상거래법 제17조 청약철회
-- 기산점)로 도입했다. 의미는 그대로다. 다만 지금까지는 사다리에 배송완료
-- 단계가 없어 done 전이에서 찍혔고, 이제 shipping→delivered 전이에서 찍는다.
-- 기산점이 앞당겨지는 것이 아니라, 실제 공급 시점을 기록하던 자리가 제자리를
-- 찾는 것이다.
--
-- 기존 행은 백필하지 않는다. 프리런치라 실주문이 없고, 잘못된 기산점으로
-- 환급 의무를 조기 종료시키는 것보다 비어 있는 편이 안전하다
-- (20260810120001 헤더의 판단을 그대로 계승한다).
--
-- ## order_withdrawal_deadline_passed 는 바꾸지 않는다
--
-- 그 함수는 주문 상태를 보지 않고 delivered_at·사유·기준시각만 본다. 사다리가
-- 늘어도 판정 규칙(변심 7일 · 하자 3개월)과 입력이 그대로이므로 변경할 것이
-- 없다. 상태를 인자로 받지 않는 설계가 이번 확장을 그냥 통과시킨다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 새 단계의 시점 기록
-- ---------------------------------------------------------------------------
-- shipped_at·delivered_at과 같은 이유로 단계별 시점을 남긴다. confirmed_at은
-- 신규주문 적체(발주확인까지 걸린 시간) 판단에, done_at은 거래확정 내역과
-- 하자 클레임 잔여 기한 표시에 쓴다.
alter table public.orders
  add column confirmed_at timestamptz,
  add column done_at timestamptz;

-- 자동 거래확정 잡이 delivered 주문만 훑도록 부분 인덱스를 둔다
-- (orders_pending_expiry_idx와 같은 이유).
create index orders_delivered_settlement_idx
  on public.orders (delivered_at)
  where status = 'delivered';

-- ---------------------------------------------------------------------------
-- 2. durable claim의 원상태 허용값
-- ---------------------------------------------------------------------------
-- claim은 승인 시점의 주문 상태를 그대로 적는다. 새 단계에서 승인이 나면
-- 그 값이 그대로 들어오므로 CHECK를 함께 넓히지 않으면 승인이 막힌다.
alter table public.order_cancellation_claims
  drop constraint order_cancellation_claims_previous_status_check;
alter table public.order_cancellation_claims
  add constraint order_cancellation_claims_previous_status_check
  check (
    previous_status in (
      'pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done'
    )
  );

-- ---------------------------------------------------------------------------
-- 3. 알림 타입 확장
-- ---------------------------------------------------------------------------
-- order_delivered만 추가한다. order_confirmed는 넣지 않는다 — 발주확인은
-- 운영자가 주문을 인지했다는 내부 단계이고, 구매자에게는 "결제완료" 이후
-- 아무것도 달라지지 않아 알림 가치가 없다. 알릴 것이 없는 알림은 다음 알림의
-- 신뢰를 깎는다.
alter table public.notifications
  drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (
    type in (
      'order_paid',
      'order_shipping',
      'order_delivered',
      'draw_ticket_issued',
      'drop_published',
      'event_published',
      'announcement'
    )
  );

-- 배송완료 알림은 청약철회 기한이 시작됐다는 고지이기도 하다. 링크는 기한과
-- 철회 버튼이 함께 있는 주문 상세로 보낸다.
create or replace function private.notify_order_status_change()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'paid' then
    insert into public.notifications (
      user_id,
      type,
      title,
      body,
      link_path,
      source_type,
      source_id,
      dedupe_key
    )
    values (
      new.user_id,
      'order_paid',
      '결제가 확인됐어요',
      '주문 결제가 완료됐습니다.',
      '/orders/' || new.id::text,
      'order',
      new.id::text,
      'order:paid:' || new.id::text
    )
    on conflict (user_id, dedupe_key) do nothing;
  elsif new.status = 'shipping' then
    insert into public.notifications (
      user_id,
      type,
      title,
      body,
      link_path,
      source_type,
      source_id,
      dedupe_key
    )
    values (
      new.user_id,
      'order_shipping',
      '배송이 시작됐어요',
      '주문한 굿즈의 배송이 시작됐습니다.',
      '/orders/' || new.id::text,
      'order',
      new.id::text,
      'order:shipping:' || new.id::text
    )
    on conflict (user_id, dedupe_key) do nothing;
  elsif new.status = 'delivered' then
    insert into public.notifications (
      user_id,
      type,
      title,
      body,
      link_path,
      source_type,
      source_id,
      dedupe_key
    )
    values (
      new.user_id,
      'order_delivered',
      '배송이 완료됐어요',
      '주문한 굿즈가 배송 완료됐습니다. 문제가 있으면 주문 상세에서 알려주세요.',
      '/orders/' || new.id::text,
      'order',
      new.id::text,
      'order:delivered:' || new.id::text
    )
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  return new;
end;
$function$;

revoke all on function private.notify_order_status_change()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. 어드민 상태 전이
-- ---------------------------------------------------------------------------
-- 허용 전이는 세 개뿐이다.
--   paid      → confirmed  발주확인. 활성 취소 클레임이 있으면 거부한다.
--   confirmed → shipping   발송처리. 운송장 필수(#178)를 그대로 유지한다.
--   shipping  → delivered  배송완료. 여기서 delivered_at을 찍는다.
-- done은 어드민 전이에서 빠진다 — 거래확정은 settle_delivered_orders()가
-- delivered + 8일에 자동으로 수행한다. 그 외 조합은 계속 거부한다.
--
-- 활성 취소 요청 검사는 기존과 같이 모든 전이에 걸린다. 발주확인만 따로
-- 막을 이유가 없다 — 취소 처리 중인 주문을 어느 방향으로도 밀지 않는 것이
-- 기존 계약이고, 발주확인도 예외가 아니다.
create or replace function public.admin_update_order_status(
  p_order_id uuid,
  p_status public.order_status,
  p_carrier text,
  p_tracking_number text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_current_status public.order_status;
  v_current_carrier text;
  v_current_tracking text;
  v_carrier text := nullif(btrim(coalesce(p_carrier, '')), '');
  v_tracking text := nullif(btrim(coalesce(p_tracking_number, '')), '');
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  select orders.status, orders.shipping_carrier, orders.tracking_number
  into v_current_status, v_current_carrier, v_current_tracking
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order_not_found';
  end if;

  if p_status not in ('confirmed', 'shipping', 'delivered') then
    raise check_violation using message = 'invalid_order_status';
  end if;

  if v_current_status = p_status then
    return;
  end if;

  if not (
    (v_current_status = 'paid' and p_status = 'confirmed')
    or (v_current_status = 'confirmed' and p_status = 'shipping')
    or (v_current_status = 'shipping' and p_status = 'delivered')
  ) then
    raise exception using message = 'invalid_order_transition';
  end if;

  if exists (
    select 1
    from public.order_cancellation_requests as request
    where request.order_id = p_order_id
      and request.status in ('requested', 'processing', 'needs_review')
  ) then
    raise check_violation using message = 'order cancellation in progress';
  end if;

  -- 승인된 청약철회는 durable claim으로 남아 finalizer를 기다린다. 그 사이
  -- 주문을 앞으로 미는 것은 환불 대상 주문을 계속 처리하는 것이라 막는다.
  if exists (
    select 1
    from public.order_cancellation_claims as claim
    where claim.order_id = p_order_id
  ) then
    raise check_violation using message = 'order cancellation in progress';
  end if;

  -- 입력을 생략하면 이미 등록된 운송장을 유지한다. 배송 완료 전이가 송장을
  -- 조용히 지우지 않게 하는 장치다.
  v_carrier := coalesce(v_carrier, v_current_carrier);
  v_tracking := coalesce(v_tracking, v_current_tracking);

  if (v_carrier is null) <> (v_tracking is null) then
    raise check_violation using message = 'invalid_tracking_input';
  end if;

  -- 운송장 없이 배송을 시작하면 고객이 배송을 추적할 수 없다. fail closed한다.
  if p_status = 'shipping' and v_tracking is null then
    raise check_violation using message = 'tracking_required';
  end if;

  update public.orders
  set
    status = p_status,
    shipping_carrier = v_carrier,
    tracking_number = v_tracking,
    confirmed_at = case when p_status = 'confirmed' then now() else confirmed_at end,
    shipped_at = case when p_status = 'shipping' then now() else shipped_at end,
    delivered_at = case when p_status = 'delivered' then now() else delivered_at end
  where id = p_order_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.status_updated',
    'order:' || p_order_id::text,
    jsonb_build_object(
      'from', v_current_status::text,
      'to', p_status::text,
      'carrier', v_carrier,
      'trackingNumber', v_tracking
    )
  );
end;
$$;

revoke all on function public.admin_update_order_status(
  uuid, public.order_status, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_order_status(
  uuid, public.order_status, text, text
) to authenticated;

-- 운송장 정정은 출고된 주문만 대상이다. 옛 done이 delivered·done으로 갈라졌으므로
-- 두 값을 함께 허용한다.
create or replace function public.admin_update_order_tracking(
  p_order_id uuid,
  p_carrier text,
  p_tracking_number text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_current_status public.order_status;
  v_current_carrier text;
  v_current_tracking text;
  v_carrier text := nullif(btrim(coalesce(p_carrier, '')), '');
  v_tracking text := nullif(btrim(coalesce(p_tracking_number, '')), '');
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if v_carrier is null or v_tracking is null then
    raise check_violation using message = 'tracking_required';
  end if;

  select orders.status, orders.shipping_carrier, orders.tracking_number
  into v_current_status, v_current_carrier, v_current_tracking
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order_not_found';
  end if;

  -- 출고 전 주문에는 운송장이 없다. 배송이 시작된 주문만 정정 대상이다.
  if v_current_status not in ('shipping', 'delivered', 'done') then
    raise check_violation using message = 'order_not_shipped';
  end if;

  if v_current_carrier is not distinct from v_carrier
    and v_current_tracking is not distinct from v_tracking
  then
    return;
  end if;

  update public.orders
  set
    shipping_carrier = v_carrier,
    tracking_number = v_tracking
  where id = p_order_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.tracking_updated',
    'order:' || p_order_id::text,
    jsonb_build_object(
      'fromCarrier', v_current_carrier,
      'fromTrackingNumber', v_current_tracking,
      'toCarrier', v_carrier,
      'toTrackingNumber', v_tracking
    )
  );
end;
$$;

revoke all on function public.admin_update_order_tracking(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_update_order_tracking(uuid, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. 청약철회 경로의 상태 게이트
-- ---------------------------------------------------------------------------
-- 취소 가능 상태는 canceled를 뺀 전부다. 새 단계가 빠지면 발주확인·배송완료된
-- 주문의 철회 요청이 not_cancelable로 조용히 막힌다.
-- 본문은 20260813221000(#205)을 그대로 유지하고 상태 목록만 넓힌다.
create or replace function public.request_order_cancellation(
  p_order_id uuid,
  p_user_id uuid,
  p_reason text,
  p_reason_type text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
  v_status public.order_status;
  v_delivered_at timestamptz;
  v_request_id uuid;
  v_has_unresolved_attempt boolean;
begin
  if p_reason_type is null
    or p_reason_type not in ('change_of_mind', 'defect')
  then
    raise check_violation using message = 'invalid cancellation reason type';
  end if;

  -- Shared ordering invariant: order first, then every goods attempt in a
  -- deterministic order. Claim/finalize use the same ordering.
  select order_record.user_id, order_record.status, order_record.delivered_at
  into v_user_id, v_status, v_delivered_at
  from public.orders as order_record
  where order_record.id = p_order_id
  for update;

  if not found or p_user_id is null or v_user_id is distinct from p_user_id then
    return 'not_found';
  end if;

  perform attempt.id
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = p_order_id
  order by attempt.id
  for update;

  select exists (
    select 1
    from public.payment_attempts as attempt
    where attempt.purpose = 'order'
      and attempt.ref_id = p_order_id
      and attempt.state in (
        'prepared',
        'confirming',
        'unknown',
        'needs_review',
        'approved'
      )
  )
  into v_has_unresolved_attempt;

  if v_status = 'canceled' then
    return 'already_canceled';
  end if;

  if v_status not in (
    'pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done'
  ) then
    return 'not_cancelable';
  end if;

  if p_reason is null
    or pg_catalog.btrim(p_reason) <> p_reason
    or pg_catalog.length(p_reason) not between 1 and 200
  then
    raise check_violation using message = 'invalid cancellation reason';
  end if;

  if public.order_withdrawal_deadline_passed(
    v_delivered_at,
    p_reason_type,
    pg_catalog.now()
  ) then
    return 'deadline_expired';
  end if;

  if exists (
    select 1
    from public.order_cancellation_requests as request
    where request.order_id = p_order_id
      and request.status in ('requested', 'processing', 'needs_review')
  ) then
    return 'already_requested';
  end if;

  insert into public.order_cancellation_requests (
    order_id,
    requested_by,
    reason,
    reason_type,
    status
  )
  values (
    p_order_id,
    p_user_id,
    p_reason,
    p_reason_type,
    'requested'
  )
  returning id into v_request_id;

  -- A provider result can no longer be inferred from a payment row alone.
  -- Preserve stock and the order until staff reconciliation resolves the
  -- attempt. Clearly terminal declined/canceled attempts may use the existing
  -- immediate cancellation path.
  if v_status = 'pending'
    and not v_has_unresolved_attempt
    and not exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = p_order_id
    )
  then
    perform public.finalize_order_cancellation_with_provider_evidence(
      p_order_id,
      p_reason,
      array[]::text[]
    );

    update public.order_cancellation_requests as request
    set
      status = 'completed',
      completed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
    where request.id = v_request_id;

    return 'completed';
  end if;

  return 'requested';
end;
$function$;

revoke all on function public.request_order_cancellation(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.request_order_cancellation(uuid, uuid, text, text)
  to service_role;

-- staff 결정. 돈이 걸린 판정은 승인 단계에서 다시 본다(#189). 상태 목록만 넓힌다.
create or replace function public.admin_decide_order_cancellation(
  p_request_id uuid,
  p_decision text,
  p_note text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_order_id uuid;
  v_order_status public.order_status;
  v_delivered_at timestamptz;
  v_request record;
  v_payment_count integer;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise check_violation using message = 'invalid cancellation decision';
  end if;

  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  select orders.status, orders.delivered_at
  into v_order_status, v_delivered_at
  from public.orders
  where orders.id = v_order_id
  for update;

  select request.*
  into v_request
  from public.order_cancellation_requests as request
  where request.id = p_request_id
  for update;

  if v_request.status <> 'requested' then
    raise exception using message = 'cancellation_request_not_decidable';
  end if;

  if v_order_status not in (
    'pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done'
  ) then
    raise exception using message = 'order_not_cancelable';
  end if;

  if p_decision = 'reject' then
    if p_note is null
      or btrim(p_note) <> p_note
      or length(p_note) not between 10 and 200
    then
      raise check_violation using message = 'invalid rejection reason';
    end if;

    update public.order_cancellation_requests
    set
      status = 'rejected',
      decided_by = v_actor,
      decision_note = p_note,
      decided_at = now(),
      updated_at = now()
    where id = p_request_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.cancellation_rejected',
      'order:' || v_order_id::text,
      jsonb_build_object(
        'requestId', p_request_id,
        'from', 'requested',
        'to', 'rejected',
        'reason', p_note
      )
    );
    return;
  end if;

  if public.order_withdrawal_deadline_passed(
    v_delivered_at,
    v_request.reason_type,
    v_request.requested_at
  ) then
    raise check_violation using message = 'withdrawal_deadline_expired';
  end if;

  insert into public.order_cancellation_claims (
    order_id,
    requested_by,
    previous_status
  )
  values (
    v_order_id,
    v_request.requested_by,
    v_order_status
  )
  on conflict (order_id) do nothing;

  insert into public.refunds (
    payment_id,
    amount,
    reason,
    status,
    cancellation_request_id
  )
  select
    payment.id,
    payment.amount,
    v_request.reason,
    case when refund.status = 'done' then 'done' else 'requested' end,
    p_request_id
  from public.payments as payment
  left join public.refunds as refund on refund.payment_id = payment.id
  where payment.purpose = 'order'
    and payment.ref_id = v_order_id
    and payment.status in ('pending', 'paid', 'canceled', 'refunded')
  on conflict (payment_id) do update
  set
    cancellation_request_id = excluded.cancellation_request_id,
    reason = coalesce(public.refunds.reason, excluded.reason),
    status = case
      when public.refunds.status = 'done' then 'done'
      else 'requested'
    end;

  select count(*)::integer
  into v_payment_count
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = v_order_id
    and payment.status in ('pending', 'paid', 'canceled', 'refunded');

  update public.order_cancellation_requests
  set
    status = 'processing',
    decided_by = v_actor,
    decision_note = null,
    decided_at = now(),
    provider_started_at = now(),
    updated_at = now()
  where id = p_request_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.cancellation_approved',
    'order:' || v_order_id::text,
    jsonb_build_object(
      'requestId', p_request_id,
      'from', 'requested',
      'to', 'processing',
      'previousOrderStatus', v_order_status::text,
      'reasonType', v_request.reason_type,
      'paymentCount', v_payment_count
    )
  );
end;
$$;

revoke all on function public.admin_decide_order_cancellation(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_decide_order_cancellation(uuid, text, text)
  to authenticated;

-- finalizer. 배송이 나간 뒤의 취소는 staff 승인이 남긴 durable claim이 반드시
-- 선행한다(#176 D10·D11 · 20260807140002). 옛 done이 delivered·done으로
-- 갈라졌으므로 claim 요구 집합에 delivered를 더한다.
--
-- confirmed는 claim을 요구하지 않는다 — 옛 paid에 해당하는 발송 전 단계이고,
-- 결제사 취소 웹훅이 만드는 즉시 취소 경로가 paid와 동일하게 유효하다.
-- 여기서 claim을 요구하면 발송 전 주문의 결제사 취소가 통째로 막힌다.
create or replace function public.finalize_order_cancellation_with_provider_evidence(
  p_order_id uuid,
  p_reason text,
  p_provider_payment_keys text[]
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
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
      update public.goods
      set stock_qty = stock_qty + v_item.qty
      where id = v_item.good_id;
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
$$;

-- finalizer는 검증된 내부 경로에서만 호출한다. 공개 grant를 만들지 않는다.
revoke all on function public.finalize_order_cancellation_with_provider_evidence(
  uuid, text, text[]
) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. 메일 재발송 게이트
-- ---------------------------------------------------------------------------
-- 본문이 지금도 사실인 상태 집합을 새 사다리로 옮긴다(#180 후속).
--   order_confirmation "결제가 확인됐고 배송 준비를 시작합니다"
--     → paid·confirmed·shipping·delivered·done
--   order_shipped      "주문한 굿즈가 배송지로 이동하고 있습니다"
--     → shipping·delivered·done
-- 앱 훅(lib/email/transactional.server.ts ACCURATE_ORDER_STATUSES)이 같은
-- 집합을 봐야 한다 — 웹훅 경로는 이 게이트를 지나지 않는다.
create or replace function public.admin_request_email_resend(p_dedupe_key text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_key text := nullif(btrim(coalesce(p_dedupe_key, ''), E' \t\n\r\f\v'), '');
  v_template text;
  v_status text;
  v_attempt_count integer;
  v_order_id text;
  v_order_status text;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if v_key is null then
    raise check_violation using message = 'invalid_dedupe_key';
  end if;

  select delivery.template, delivery.status, delivery.attempt_count
  into v_template, v_status, v_attempt_count
  from public.email_deliveries as delivery
  where delivery.dedupe_key = v_key
  for update;

  if not found then
    raise no_data_found using message = 'email_delivery_not_found';
  end if;

  -- 이미 도착한 메일을 다시 보내지 않는다. claim_email_delivery도 같은 판단을 하지만,
  -- 운영자에게는 발송 훅을 부르기 전에 이유를 알려주는 편이 낫다.
  if v_status = 'sent' then
    raise check_violation using message = 'email_already_sent';
  end if;

  -- dedupe_key는 '<template>:<order uuid>'다(lib/email/dedupe.ts).
  -- 현재 템플릿은 둘 다 주문 메일이다. 주문에 매이지 않는 템플릿이 생기면 이 함수를
  -- 함께 고쳐야 한다 — 그때까지는 형식을 벗어난 키를 fail-closed로 막는다.
  v_order_id := split_part(v_key, ':', 2);
  if v_order_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise check_violation using message = 'email_delivery_target_unresolved';
  end if;

  select target.status::text
  into v_order_status
  from public.orders as target
  where target.id = lower(v_order_id)::uuid;

  if not found then
    raise no_data_found using message = 'order_missing';
  end if;

  -- 본문이 지금도 사실인 상태에서만 통과시킨다.
  -- lib/email/transactional.server.ts의 ACCURATE_ORDER_STATUSES와 같은 집합이다.
  if v_template = 'order_confirmation' and v_order_status not in (
    'paid', 'confirmed', 'shipping', 'delivered', 'done'
  ) then
    raise check_violation using message = 'email_no_longer_accurate';
  end if;
  if v_template = 'order_shipped' and v_order_status not in (
    'shipping', 'delivered', 'done'
  ) then
    raise check_violation using message = 'email_no_longer_accurate';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.email_delivery.resend_requested',
    'email_delivery:' || v_key,
    jsonb_build_object(
      'template', v_template,
      'status', v_status,
      'attemptCount', v_attempt_count,
      'orderStatus', v_order_status
    )
  );

  return v_template;
end;
$$;

revoke all on function public.admin_request_email_resend(text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_request_email_resend(text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 7. 어드민 주문 조회의 단계별 시점
-- ---------------------------------------------------------------------------
-- 상태 필터는 enum_range로 검증하므로 사다리가 늘어도 그대로 동작한다. 바꾸는
-- 것은 반환 컬럼뿐이다 — 신규주문 적체(발주확인까지의 경과), 거래확정 내역의
-- 확정일, 하자 클레임 잔여 기한(delivered_at + 3개월)을 운영 화면이 보려면
-- 단계별 시점이 목록 응답에 있어야 한다. 지금은 어느 것도 반환되지 않는다.
-- 반환 타입이 바뀌므로 drop 후 재생성한다(20260810120004 선례).
drop function if exists public.admin_search_orders(text, date, date, text, integer, integer);

create or replace function public.admin_search_orders(
  p_status text default null,
  p_from date default null,
  p_to date default null,
  p_query text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  user_id uuid,
  buyer_name text,
  buyer_email text,
  status public.order_status,
  total bigint,
  address jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  shipping_carrier text,
  tracking_number text,
  confirmed_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  done_at timestamptz,
  cancellation_request_id uuid,
  cancellation_request_status text,
  cancellation_reason_type text,
  cancellation_requested_at timestamptz,
  cancellation_decided_at timestamptz,
  cancellation_decision_note text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_status is not null
    and not exists (
      select 1
      from unnest(enum_range(null::public.order_status)) as allowed(value)
      where allowed.value::text = p_status
    )
  then
    raise check_violation using message = 'invalid order status filter';
  end if;

  if p_from is not null and p_to is not null and p_from > p_to then
    raise check_violation using message = 'invalid order date range';
  end if;

  if v_query is not null and length(v_query) > 100 then
    raise check_violation using message = 'order search query too long';
  end if;

  return query
  select
    orders.id,
    orders.user_id,
    profile.nickname as buyer_name,
    profile.email as buyer_email,
    orders.status,
    orders.total,
    orders.address,
    orders.created_at,
    orders.updated_at,
    orders.shipping_carrier,
    orders.tracking_number,
    orders.confirmed_at,
    orders.shipped_at,
    orders.delivered_at,
    orders.done_at,
    cancellation.id as cancellation_request_id,
    cancellation.status as cancellation_request_status,
    cancellation.reason_type as cancellation_reason_type,
    cancellation.requested_at as cancellation_requested_at,
    cancellation.decided_at as cancellation_decided_at,
    cancellation.decision_note as cancellation_decision_note,
    count(*) over()::bigint as total_count
  from public.orders as orders
  join public.profiles as profile on profile.id = orders.user_id
  left join lateral (
    select
      request.id,
      request.status,
      request.reason_type,
      request.requested_at,
      request.decided_at,
      request.decision_note
    from public.order_cancellation_requests as request
    where request.order_id = orders.id
    order by request.requested_at desc, request.id desc
    limit 1
  ) as cancellation on true
  where (p_status is null or orders.status::text = p_status)
    and (
      p_from is null
      or orders.created_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    )
    and (
      p_to is null
      or orders.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
    )
    and (
      v_query is null
      or position(lower(v_query) in lower(orders.id::text)) > 0
      or position(lower(v_query) in lower(coalesce(profile.email, ''))) > 0
      or position(lower(v_query) in lower(coalesce(profile.nickname, ''))) > 0
    )
  order by orders.created_at desc, orders.id desc
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.admin_search_orders(text, date, date, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_search_orders(text, date, date, text, integer, integer)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 8. 탈퇴 차단 사유
-- ---------------------------------------------------------------------------
-- active_order는 "아직 이행 중인 주문"이다. 옛 paid가 paid·confirmed로
-- 갈라졌으므로 confirmed를 더한다. delivered는 더하지 않는다 — 옛 done에
-- 해당하고, 공급이 끝난 주문을 차단 사유로 보지 않던 기존 판단을 유지한다
-- (남은 환불·클레임은 active_cancellation/active_order_refund가 잡는다).
-- 본문은 20260813204000을 그대로 유지하고 상태 목록만 넓힌다.
create or replace function private.account_deletion_blockers(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with unresolved_payments as (
    select
      coalesce(attempt.payment_id::text, 'attempt:' || attempt.id::text) as blocker_ref,
      coalesce(payment.purpose, attempt.purpose) as purpose
    from public.payment_attempts as attempt
    left join public.payments as payment on payment.id = attempt.payment_id
    where attempt.user_id = p_user_id
      and (
        attempt.state in ('prepared', 'confirming', 'unknown', 'needs_review')
        or (attempt.state = 'approved' and attempt.payment_id is null)
      )

    union

    -- An attempt linked to the same legacy pending payment represents one
    -- obligation, not two public blockers.
    select payment.id::text, payment.purpose
    from public.payments as payment
    where payment.user_id = p_user_id
      and payment.status = 'pending'
  ),
  unresolved_refunds as (
    select refund.id::text as blocker_ref, payment.purpose
    from public.refunds as refund
    join public.payments as payment on payment.id = refund.payment_id
    where payment.user_id = p_user_id
      and refund.status in ('requested', 'failed')
  ),
  blocker_counts as (
    select
      1 as priority,
      'active_order'::text as code,
      pg_catalog.count(*)::integer as blocker_count,
      '/orders'::text as path
    from public.orders as order_record
    where order_record.user_id = p_user_id
      and order_record.status in ('pending', 'paid', 'confirmed', 'shipping')

    union all

    select
      2,
      'active_cancellation',
      pg_catalog.count(*)::integer,
      '/orders'
    from (
      select request.order_id::text as blocker_ref
      from public.order_cancellation_requests as request
      join public.orders as order_record on order_record.id = request.order_id
      where order_record.user_id = p_user_id
        and request.status in ('requested', 'processing', 'needs_review')

      union

      select claim.order_id::text
      from public.order_cancellation_claims as claim
      join public.orders as order_record on order_record.id = claim.order_id
      where order_record.user_id = p_user_id
    ) as active_cancellation

    union all

    select 3, 'active_order_payment', pg_catalog.count(*)::integer, '/orders'
    from unresolved_payments
    where purpose = 'order'

    union all

    select 4, 'active_ticket_payment', pg_catalog.count(*)::integer, '/tickets'
    from unresolved_payments
    where purpose = 'ticket'

    union all

    select 5, 'active_payment_attempt', pg_catalog.count(*)::integer, '/settings'
    from unresolved_payments
    where purpose not in ('order', 'ticket')

    union all

    select 6, 'active_order_refund', pg_catalog.count(*)::integer, '/orders'
    from unresolved_refunds
    where purpose = 'order'

    union all

    select 7, 'active_ticket_refund', pg_catalog.count(*)::integer, '/tickets'
    from unresolved_refunds
    where purpose = 'ticket'

    union all

    select 8, 'active_refund', pg_catalog.count(*)::integer, '/settings'
    from unresolved_refunds
    where purpose not in ('order', 'ticket')

    union all

    select
      9,
      'active_ticket',
      pg_catalog.count(*)::integer,
      '/tickets'
    from public.ticket_orders as ticket_order
    join public.events as event on event.id = ticket_order.event_id
    where ticket_order.user_id = p_user_id
      and (
        ticket_order.status = 'pending'
        or (
          ticket_order.status = 'paid'
          and (event.ends_at is null or event.ends_at > pg_catalog.now())
          and exists (
            select 1
            from public.tickets as ticket
            where ticket.ticket_order_id = ticket_order.id
              and ticket.status = 'valid'
          )
        )
      )

    union all

    select
      10,
      'active_ticket_cancellation',
      pg_catalog.count(*)::integer,
      '/tickets'
    from public.ticket_cancellation_requests as request
    join public.ticket_orders as ticket_order
      on ticket_order.id = request.ticket_order_id
    where ticket_order.user_id = p_user_id
      and request.status in ('requested', 'processing', 'needs_review')

    union all

    select
      11,
      'staff_handover',
      pg_catalog.count(*)::integer,
      '/settings'
    from public.profiles as profile
    where profile.id = p_user_id
      and profile.role in ('staff', 'admin')
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'code', blocker.code,
        'count', blocker.blocker_count,
        'path', blocker.path
      )
      order by blocker.priority
    ) filter (where blocker.blocker_count > 0),
    '[]'::jsonb
  )
  from blocker_counts as blocker;
$$;

revoke all on function private.account_deletion_blockers(uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. 자동 거래확정
-- ---------------------------------------------------------------------------
-- delivered + 8일이 지나면 done으로 확정한다.
--
-- 8일인 이유: 변심 청약철회 기한이 공급받은 날(delivered_at)부터 7일이다(#189).
-- 그 창이 완전히 닫힌 다음 날에 확정해 경계에서의 하루를 고객에게 준다.
-- done은 "클레임 불가"가 아니라 "변심 철회 창 종료"다 — 하자·오배송 클레임은
-- 공급받은 날부터 3개월이고, order_withdrawal_deadline_passed가 done 주문에
-- 대해서도 그대로 판정한다.
--
-- 활성 취소 요청이나 승인된 claim이 있으면 확정하지 않는다. 확정 자체가
-- 취소를 막지는 않지만(청약철회 게이트는 done을 계속 허용한다), 처리 중인
-- 건을 "거래확정"으로 표시하면 운영 화면이 거짓말을 한다.
--
-- 후보 조회는 사다리 상태와 기한만 보고, 클레임 검사는 잠금을 잡은 뒤 루프
-- 안에서 새 스냅샷으로 다시 한다(READ COMMITTED에서 문장마다 스냅샷이
-- 갱신된다). expire_stale_checkouts와 같은 배치·잠금 구조다.
create or replace function public.settle_delivered_orders()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_count integer := 0;
  r record;
begin
  /*
   * 클레임이 걸린 주문은 후보 쿼리에서 미리 걸러낸다.
   *
   * 루프 안에서 continue로 건너뛰면 그 행이 limit 예산을 먹는다. delivered_at 오름차순
   * 정렬이라 오래 막힌 행이 늘 맨 앞에 서고, needs_review로 주차된 요청처럼 스스로
   * 풀리지 않는 클레임이 예산만큼 쌓이면 뒤의 멀쩡한 주문이 영원히 확정되지 않는다.
   * (실측: 막힌 행 200건 + 정상 1건이면 반환값이 계속 0이다.)
   *
   * limit은 한 번의 실행이 무한정 길어지지 않게 두는 안전장치다. 초과분은 다음 날
   * 오래된 것부터 빠지므로 밀려도 순서는 지켜진다.
   */
  for r in
    select orders.id
    from public.orders
    where orders.status = 'delivered'
      and orders.delivered_at is not null
      and orders.delivered_at + interval '8 days' < now()
      and not exists (
        select 1
        from public.order_cancellation_requests as request
        where request.order_id = orders.id
          and request.status in ('requested', 'processing', 'needs_review')
      )
      and not exists (
        select 1
        from public.order_cancellation_claims as claim
        where claim.order_id = orders.id
      )
    order by orders.delivered_at, orders.id
    limit 1000
    for update of orders skip locked
  loop
    /* 후보를 고른 뒤 행 잠금을 얻기 전에 클레임이 끼어들 수 있다. 예산과 무관한
       방어용 재확인이라 여기서는 continue가 기아를 만들지 않는다. */
    if exists (
      select 1
      from public.order_cancellation_requests as request
      where request.order_id = r.id
        and request.status in ('requested', 'processing', 'needs_review')
    ) or exists (
      select 1
      from public.order_cancellation_claims as claim
      where claim.order_id = r.id
    ) then
      continue;
    end if;

    -- status 조건을 update에도 남겨 재실행이 done_at을 덮어쓰지 않게 한다.
    update public.orders
    set
      status = 'done',
      done_at = now()
    where id = r.id
      and status = 'delivered';

    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$function$;

-- default privileges 봉인(AGENTS.md) — 스케줄러(postgres)와 수동 운영(service_role)만 실행
revoke all on function public.settle_delivered_orders()
  from public, anon, authenticated, service_role;
grant execute on function public.settle_delivered_orders() to service_role;

-- 스케줄러 선택: 이슈 #250은 `app/api/cron/` 표면을 지목했지만 pg_cron으로 간다.
-- 이 잡은 DB 안에서 완결된다 — 외부 입력도, HTTP 응답도 필요 없다. Vercel cron으로
-- 두면 CRON_SECRET 왕복과 vercel.json 항목이 늘고, 배포 환경이 잡의 실행 여부를
-- 좌우한다. 같은 성격의 `expire_stale_checkouts`가 이미 pg_cron에 있어 운영자가
-- 확인할 자리도 한 곳으로 모인다. 반대로 실행 이력이 Vercel 로그에 안 남는 것이
-- 이 선택의 비용이며, 관측이 필요해지면 잡이 audit_log를 남기게 하는 편이
-- 표면을 옮기는 것보다 싸다.
--
-- UTC 18:00 = KST 03:00. 하루 한 번이면 충분하다 — 8일 경계는 시각 단위로
-- 다투는 값이 아니고, 확정이 늦어지는 쪽이 고객에게 유리하다.
-- cron.schedule은 이름 기준 upsert라 재적용에도 안전하다.
select cron.schedule(
  'settle-delivered-orders',
  '0 18 * * *',
  'select public.settle_delivered_orders()'
);
