-- ============================================================================
-- 운영자가 시작하는 배송 전 전액 취소 (2026-10-12 점검 OPS-8·OPS-5·REF-1, ADR-0018)
--
-- 고객 직접 취소는 발주확인 전까지만 열린다(ADR-0017). 그 뒤부터 첫 발송 전까지
-- 생기는 일 — 품절·출고 불가, 1:1 문의로 받은 취소 요청, 심사 창 테스트 결제 정리 —
-- 을 시스템 안에서 끝낼 경로가 없었다. 운영자가 토스 상점관리자에서 직접 취소하면
-- 주문·재고·쿠폰·적립금·카드팩이 실제와 어긋난다.
--
-- 이 migration은 staff가 사유와 함께 **모든 배송 건이 발송 전인** 주문의 전액 취소를
-- 시작하는 감사 RPC를 더한다. 만들어진 요청은 고객 취소와 같은 원장 구조
-- (order_cancellation_requests + order_cancellation_claims + refunds)를 쓰고, 서버가
-- 같은 오케스트레이터 → 토스 전액 취소 → finalizer 경로로 곧바로 닫는다.
--
-- 고객 직접 신청 정책은 바꾸지 않는다. 발주확인·출고지시 이후를 막는 판정
-- (order_cancel_eligible)은 staff 발원 활성 요청이 있는 주문에 한해서만 열린다.
-- 출고지시 파일이 이미 나간 배송 건이 있으면 "창고에 출고 중단을 확인했다"는 명시
-- 확인을 요구한다.
--
-- 재정의 함수는 최신 정의를 복사했다:
--   private.order_cancel_eligible  ← 20260909001505:31
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 요청의 발원(고객·운영자)과 운영자 사유
-- ---------------------------------------------------------------------------
-- requested_by는 계속 주문 구매자다. 알림·RLS·기존 대조(요청자 = 주문자)가 그
-- 값을 본다. 운영자는 initiated_by에 남긴다.
alter table public.order_cancellation_requests
  add column origin text not null default 'customer',
  add column staff_reason_code text,
  add column staff_note text,
  add column initiated_by uuid references public.profiles(id) on delete restrict,
  add column warehouse_stop_confirmed boolean not null default false;

alter table public.order_cancellation_requests
  add constraint order_cancellation_requests_origin_check
  check (origin in ('customer', 'staff'));

alter table public.order_cancellation_requests
  add constraint order_cancellation_requests_staff_origin_shape
  check (
    (
      origin = 'customer'
      and staff_reason_code is null
      and staff_note is null
      and initiated_by is null
      and not warehouse_stop_confirmed
    )
    or (
      origin = 'staff'
      and claim_type = 'cancel'
      and initiated_by is not null
      and staff_reason_code in ('out_of_stock', 'customer_request', 'test_payment_cleanup', 'other')
      and (
        staff_note is null
        or (
          staff_note = btrim(staff_note)
          and char_length(staff_note) between 1 and 500
          and translate(staff_note, E'\n\r\t', '') !~ '[[:cntrl:]]'
        )
      )
      and (staff_reason_code <> 'other' or staff_note is not null)
    )
  );

-- 새 컬럼은 구매자 컬럼 grant에 넣지 않는다. 운영 사유와 처리자는 운영 정보다.

-- ---------------------------------------------------------------------------
-- 2. 취소 가능 판정 — staff 발원 요청에 한해 발주확인 이후·발송 전을 연다
-- ---------------------------------------------------------------------------
create or replace function private.order_cancel_eligible(target_order uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce((select
   -- 고객 직접 취소(ADR-0017): 발주확인 전, 발주·발송 이력 없음.
   (o.status in ('pending','paid') and o.confirmed_at is null
   and o.shipped_at is null and o.delivered_at is null and o.done_at is null
   and not exists(select 1 from public.order_shipments s where s.order_id=o.id
     and (s.status<>'ready' or s.shipped_at is not null or s.delivered_at is not null or s.exported_at is not null))
   and not exists(select 1 from public.audit_log a where a.target='order:'||o.id::text
     and ((a.action='admin.order.status_updated' and a.diff->>'to' in ('confirmed','shipping','delivered','done'))
       or a.action in ('admin.shipment.status_updated','admin.shipment.exported'))))
   or
   -- 운영자 전액 취소(ADR-0018): 발주확인 뒤라도 어떤 배송 건도 발송되지 않았고,
   -- 이 주문에 staff가 사유와 함께 연 취소가 진행 중일 때만. 출고지시 여부는
   -- 접수 RPC가 창고 중단 확인으로 따로 묻는다.
   (o.status in ('paid','confirmed')
   and o.shipped_at is null and o.delivered_at is null and o.done_at is null
   and not exists(select 1 from public.order_shipments s where s.order_id=o.id
     and (s.status not in ('ready','canceled') or s.shipped_at is not null or s.delivered_at is not null))
   and exists(select 1 from public.order_cancellation_requests r where r.order_id=o.id
     and r.origin='staff' and r.claim_type='cancel' and r.status in ('processing','needs_review')))
   from public.orders o where o.id=target_order),false);
$$;
revoke all on function private.order_cancel_eligible(uuid) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 3. 운영자 전액 취소 시작
-- ---------------------------------------------------------------------------
create function public.admin_start_order_cancellation(
  p_order_id uuid,
  p_reason_code text,
  p_note text,
  p_warehouse_stop_confirmed boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_order public.orders%rowtype;
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_request_id uuid;
  v_exported_count integer;
  v_payment_count integer;
  v_reason_label text;
  v_notice text;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_reason_code is null
    or p_reason_code not in ('out_of_stock', 'customer_request', 'test_payment_cleanup', 'other')
  then
    raise check_violation using message = 'invalid_staff_cancellation_reason';
  end if;

  if (v_note is not null and (
        char_length(v_note) > 500
        or pg_catalog.translate(v_note, E'\n\r\t', '') ~ '[[:cntrl:]]'
      ))
    or (p_reason_code = 'other' and (v_note is null or char_length(v_note) < 5))
  then
    raise check_violation using message = 'invalid_staff_cancellation_note';
  end if;

  -- 공통 잠금 순서: order → shipments → request → attempts → payments.
  select order_record.*
  into v_order
  from public.orders as order_record
  where order_record.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order_not_found';
  end if;

  perform shipment.id
  from public.order_shipments as shipment
  where shipment.order_id = p_order_id
  order by shipment.id
  for update;

  if v_order.status not in ('paid', 'confirmed')
    or v_order.shipped_at is not null
    or v_order.delivered_at is not null
    or v_order.done_at is not null
  then
    raise check_violation using message = 'order_not_staff_cancelable';
  end if;

  if exists (
    select 1
    from public.order_shipments as shipment
    where shipment.order_id = p_order_id
      and (
        shipment.status not in ('ready', 'canceled')
        or shipment.shipped_at is not null
        or shipment.delivered_at is not null
      )
  ) then
    raise check_violation using message = 'shipment_already_dispatched';
  end if;

  select pg_catalog.count(*)::integer
  into v_exported_count
  from public.order_shipments as shipment
  where shipment.order_id = p_order_id
    and shipment.status = 'ready'
    and shipment.exported_at is not null;

  if v_exported_count > 0 and p_warehouse_stop_confirmed is distinct from true then
    raise check_violation using message = 'warehouse_stop_confirmation_required';
  end if;

  if exists (
    select 1
    from public.order_cancellation_requests as request
    where request.order_id = p_order_id
      and request.status in ('requested', 'processing', 'needs_review')
  ) or exists (
    select 1
    from public.order_cancellation_claims as claim
    where claim.order_id = p_order_id
  ) then
    raise check_violation using message = 'order_claim_in_progress';
  end if;

  perform attempt.id
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = p_order_id
  order by attempt.id
  for update;

  if exists (
    select 1
    from public.payment_attempts as attempt
    where attempt.purpose = 'order'
      and attempt.ref_id = p_order_id
      and attempt.state in ('prepared', 'confirming', 'unknown', 'needs_review')
  ) then
    raise check_violation using message = 'payment_reconciliation_required';
  end if;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
  order by payment.id
  for update;

  /*
   * 이 경로가 결제사 취소까지 닫을 수 있는 결제만 받는다.
   *
   * 토스 결제는 서버 오케스트레이터가 전액 취소를 발행하고 fresh 조회로 검증한다.
   * Korpay(취소 API 없음)와 무통장(계좌 송금 종결 미구현, #279·#280·#281)은 이
   * 경로로 열면 결제확인필요에 영구히 갇히므로 시작 자체를 거절한다.
   */
  select pg_catalog.count(*)::integer
  into v_payment_count
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
    and payment.status <> 'failed';

  if v_payment_count = 0 or exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = p_order_id
      and payment.status <> 'failed'
      and (
        payment.provider <> 'toss'
        or payment.status <> 'paid'
        or nullif(pg_catalog.btrim(payment.payment_key), '') is null
      )
  ) then
    raise check_violation using message = 'staff_cancellation_toss_only';
  end if;

  v_reason_label := case p_reason_code
    when 'out_of_stock' then '품절·출고 불가'
    when 'customer_request' then '고객 요청(CS 접수)'
    when 'test_payment_cleanup' then '테스트 결제 정리'
    else '기타'
  end;

  insert into public.order_cancellation_requests (
    order_id,
    requested_by,
    reason,
    reason_type,
    claim_type,
    stage,
    origin,
    staff_reason_code,
    staff_note,
    initiated_by,
    warehouse_stop_confirmed,
    decided_by,
    decided_at,
    provider_started_at
  )
  values (
    p_order_id,
    v_order.user_id,
    '운영자 전액 취소 · ' || v_reason_label,
    'change_of_mind',
    'cancel',
    'processing',
    'staff',
    p_reason_code,
    v_note,
    v_actor,
    v_exported_count > 0,
    v_actor,
    pg_catalog.now(),
    pg_catalog.now()
  )
  returning id into v_request_id;

  insert into public.order_cancellation_claims (order_id, requested_by, previous_status)
  values (p_order_id, v_order.user_id, v_order.status)
  on conflict (order_id) do nothing;

  insert into public.refunds (payment_id, amount, reason, status, cancellation_request_id)
  select
    payment.id,
    payment.amount,
    '운영자 전액 취소 · ' || v_reason_label,
    'requested',
    v_request_id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
    and payment.status = 'paid'
  on conflict (payment_id) do update
  set
    cancellation_request_id = excluded.cancellation_request_id,
    reason = coalesce(public.refunds.reason, excluded.reason),
    status = case when public.refunds.status = 'done' then 'done' else 'requested' end;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.staff_cancellation_started',
    'order:' || p_order_id::text,
    pg_catalog.jsonb_build_object(
      'claimId', v_request_id,
      'claimType', 'cancel',
      'to', 'processing',
      'reasonCode', p_reason_code,
      'note', v_note,
      'previousOrderStatus', v_order.status::text,
      'exportedShipmentCount', v_exported_count,
      'warehouseStopConfirmed', v_exported_count > 0,
      'paymentCount', v_payment_count
    )
  );

  v_notice := case p_reason_code
    when 'out_of_stock' then '판매자 사정(품절·출고 불가)으로 주문 전체를 취소하고 결제 금액 전액을 환불합니다.'
    when 'customer_request' then '요청하신 주문 취소를 접수해 주문 전체를 취소하고 결제 금액 전액을 환불합니다.'
    when 'test_payment_cleanup' then '테스트 결제로 만들어진 주문이라 주문 전체를 취소하고 결제를 취소합니다.'
    else '주문 전체를 취소하고 결제 금액 전액을 환불합니다. 자세한 사유는 고객센터로 문의해주세요.'
  end;

  perform private.notify_order_claim(
    v_request_id,
    'staff_cancel_started',
    '주문 취소를 진행해요',
    v_notice
  );

  return v_request_id;
end;
$function$;

revoke all on function public.admin_start_order_cancellation(uuid, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_start_order_cancellation(uuid, text, text, boolean)
  to authenticated;
