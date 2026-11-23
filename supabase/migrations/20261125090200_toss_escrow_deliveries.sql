-- ==========================================================================
-- ICONS · 토스 에스크로(구매안전서비스) 배송 등록·거래 상태 — ADR-0049 결정 6
--
-- 배송이 필요한 상품의 현금성 결제(가상계좌)는 에스크로 적용 대상이고, 주문서형 결제 UI는 가상계좌에 에스크로 선택란을
-- 띄운다(구매자 선택). 구매자가 에스크로를 고른 결제는 상점이 발송 때 배송을 등록해야 전 상품 배송완료 뒤 구매확정
-- (3영업일 자동확정)으로 정산된다(/guides/v2/escrow). 결제 요청에 escrowProducts를 싣지 않으므로 거래 상품은 주문 하나다
-- — 배송 등록도 주문당 한 번이다.
--
-- 이 migration이 고정하는 것:
--   1. 작업 원장(private.toss_escrow_deliveries, 주문당 한 행). 입금 승인된 가상계좌 결제 중 에스크로를 골랐거나 선택을
--      모르는 결제만 대상이다(선택을 모르면 작업자가 결제 조회로 확인해 아니면 건너뛴다).
--   2. 등록 시점: 실물 배송 건(취소·디지털·배송 없음 제외)이 **전부** 발송됐을 때. 택배는 운송장과 함께 배송중·배송완료,
--      퀵·방문수령·직접배송·화물은 배송완료다. 택배가 하나라도 있으면 가장 늦게 발송된 택배의 운송장으로 SHIPMENT, 없으면
--      가장 늦은 배송완료 시각으로 DIRECT 등록이다. 실물이 없는 주문(디지털만)은 승인 즉시 DIRECT다.
--   3. 등록 뒤 그 운송장이 바뀌면 정정(배송 수정 API)을 다시 대기열에 넣는다. 배송 상태를 되돌리는 정정은 토스에서 되돌릴
--      수 없으므로 운영자 확인(manual_required)으로 넘긴다.
--   4. 거래 상태(IN_PROGRESS·CANCEL_REQUESTED·CONFIRMED·CANCELED)를 작업자가 주기적으로 조회해 남기고, 구매자 취소 신청
--      (CANCEL_REQUESTED)은 주문 출고 보류(escrow_cancel_requested)로 운영 할 일에 띄운다. 운영자 전액 취소가 신청을
--      수락하는 API로 환불한다(어댑터).
-- 토스 호출은 앱 작업자(cron /api/cron/toss-escrow)가 하고, 이 migration은 대상·시점·결과 기록만 DB에서 정한다.
-- ==========================================================================

begin;

create table private.toss_escrow_deliveries (
  order_id uuid primary key references public.orders(id) on delete cascade,
  attempt_id uuid not null references public.payment_attempts(id) on delete cascade,
  -- waiting: 아직 발송 전 / ready: 등록(또는 정정) 대기 / registered: 등록 끝 / skipped: 에스크로 결제 아님
  -- manual_required: 자동 등록 불가(택배사 코드 없음·송장 형식 거절·키 권한·되돌림) — 운영자가 토스 상점관리자에서 처리
  state text not null default 'waiting'
    check (state in ('waiting', 'ready', 'registered', 'skipped', 'manual_required')),
  delivery_method text check (delivery_method is null or delivery_method in ('SHIPMENT', 'DIRECT')),
  carrier text,
  tracking_number text,
  shipped_at timestamptz,
  received_at timestamptz,
  -- 토스가 준 값(불투명) — 형식을 검사하지 않고 길이만 막는다.
  escrow_key text check (escrow_key is null or char_length(escrow_key) between 1 and 64),
  toss_delivery_id text check (toss_delivery_id is null or char_length(toss_delivery_id) between 1 and 64),
  revision integer not null default 1 check (revision >= 1),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default pg_catalog.clock_timestamp(),
  last_error_code text check (last_error_code is null or last_error_code ~ '^[A-Za-z0-9_.:-]{1,80}$'),
  escrow_status text check (escrow_status is null or escrow_status in ('IN_PROGRESS', 'CANCEL_REQUESTED', 'CONFIRMED', 'CANCELED')),
  escrow_checked_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);
create index toss_escrow_deliveries_due on private.toss_escrow_deliveries(next_attempt_at)
  where state in ('ready', 'registered', 'waiting');
alter table private.toss_escrow_deliveries enable row level security;
revoke all on private.toss_escrow_deliveries from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 대상·시점 판정
-- ---------------------------------------------------------------------------
create function private.refresh_toss_escrow_delivery(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempt public.payment_attempts%rowtype;
  v_use_escrow boolean;
  v_job private.toss_escrow_deliveries%rowtype;
  v_has_job boolean;
  v_pending integer;
  v_physical integer;
  v_parcel record;
  v_direct_at timestamptz;
  v_method text;
  v_changed boolean;
begin
  select attempt.* into v_attempt
  from public.payment_attempts as attempt
  where attempt.purpose = 'order' and attempt.ref_id = p_order_id and attempt.provider = 'toss' and attempt.state = 'approved'
  limit 1;
  if not found then
    return;
  end if;
  select va.use_escrow into v_use_escrow
  from private.payment_attempt_virtual_accounts as va
  where va.attempt_id = v_attempt.id;
  if not found or v_use_escrow is false then
    return;
  end if;

  select job.* into v_job from private.toss_escrow_deliveries as job where job.order_id = p_order_id for update;
  v_has_job := found;
  if v_has_job and v_job.state in ('skipped', 'manual_required') then
    return;
  end if;

  select
    count(*) filter (where shipment.status <> 'canceled'),
    count(*) filter (where shipment.status <> 'canceled' and not (
      (shipment.delivery_method = 'parcel' and shipment.status in ('shipping', 'delivered') and shipment.tracking_number is not null)
      or (shipment.delivery_method <> 'parcel' and shipment.status = 'delivered')))
  into v_physical, v_pending
  from public.order_shipments as shipment
  where shipment.order_id = p_order_id
    and shipment.delivery_method not in ('none', 'digital');

  if v_pending > 0 then
    if not v_has_job then
      insert into private.toss_escrow_deliveries(order_id, attempt_id) values (p_order_id, v_attempt.id);
    end if;
    return;
  end if;

  select shipment.carrier, shipment.tracking_number, coalesce(shipment.shipped_at, shipment.updated_at) as shipped_at
  into v_parcel
  from public.order_shipments as shipment
  where shipment.order_id = p_order_id and shipment.delivery_method = 'parcel'
    and shipment.status in ('shipping', 'delivered') and shipment.tracking_number is not null
  order by coalesce(shipment.shipped_at, shipment.updated_at) desc, shipment.id desc
  limit 1;

  if v_parcel.tracking_number is not null then
    v_method := 'SHIPMENT';
  else
    v_method := 'DIRECT';
    select max(shipment.delivered_at) into v_direct_at
    from public.order_shipments as shipment
    where shipment.order_id = p_order_id and shipment.status = 'delivered'
      and shipment.delivery_method not in ('none', 'digital');
    if v_physical = 0 then
      v_direct_at := coalesce(v_attempt.updated_at, pg_catalog.clock_timestamp());
    end if;
  end if;

  if not v_has_job then
    insert into private.toss_escrow_deliveries(
      order_id, attempt_id, state, delivery_method, carrier, tracking_number, shipped_at, received_at)
    values (p_order_id, v_attempt.id, 'ready', v_method, v_parcel.carrier, v_parcel.tracking_number,
      v_parcel.shipped_at, v_direct_at);
    return;
  end if;

  v_changed := v_job.delivery_method is distinct from v_method
    or v_job.carrier is distinct from v_parcel.carrier
    or v_job.tracking_number is distinct from v_parcel.tracking_number;
  if v_job.state = 'waiting' or (v_job.state = 'ready' and v_changed) then
    update private.toss_escrow_deliveries
    set state = 'ready', delivery_method = v_method, carrier = v_parcel.carrier, tracking_number = v_parcel.tracking_number,
        shipped_at = v_parcel.shipped_at, received_at = v_direct_at, next_attempt_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where order_id = p_order_id;
  elsif v_job.state = 'registered' and v_changed then
    -- 등록 뒤 운송장 정정은 배송 수정 API로(택배 → 택배만). 방법이 바뀌는 정정은 자동으로 하지 않는다.
    update private.toss_escrow_deliveries
    set state = case when v_job.delivery_method = 'SHIPMENT' and v_method = 'SHIPMENT' then 'ready' else 'manual_required' end,
        carrier = v_parcel.carrier, tracking_number = v_parcel.tracking_number, shipped_at = v_parcel.shipped_at,
        revision = revision + 1, next_attempt_at = pg_catalog.clock_timestamp(),
        last_error_code = case when v_job.delivery_method = 'SHIPMENT' and v_method = 'SHIPMENT' then last_error_code
          else 'delivery_method_changed' end,
        updated_at = pg_catalog.clock_timestamp()
    where order_id = p_order_id;
  end if;
end;
$function$;
revoke all on function private.refresh_toss_escrow_delivery(uuid) from public, anon, authenticated, service_role;

create function private.toss_escrow_delivery_shipment_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- 에스크로 대상(입금 승인된 가상계좌)인 주문만 판정한다. 실패해도 출고 처리는 막지 않는다(작업자가 다음 회차에 다시 본다).
  if exists (
    select 1 from private.payment_attempt_virtual_accounts as va
    join public.payment_attempts as attempt on attempt.id = va.attempt_id
    where va.order_id = new.order_id and attempt.state = 'approved' and va.use_escrow is distinct from false
  ) then
    begin
      perform private.refresh_toss_escrow_delivery(new.order_id);
    exception when others then
      raise warning 'toss escrow delivery refresh failed for order %: %', new.order_id, sqlerrm;
    end;
  end if;
  return null;
end;
$function$;
revoke all on function private.toss_escrow_delivery_shipment_changed() from public, anon, authenticated, service_role;

create trigger order_shipments_toss_escrow_delivery
after insert or update of status, carrier, tracking_number, shipped_at, delivered_at, delivery_method
on public.order_shipments
for each row execute function private.toss_escrow_delivery_shipment_changed();

create function private.toss_escrow_delivery_attempt_approved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.state = 'approved' and old.state is distinct from 'approved' and new.purpose = 'order' and new.provider = 'toss'
    and new.ref_id is not null
    and exists (select 1 from private.payment_attempt_virtual_accounts as va where va.attempt_id = new.id and va.use_escrow is distinct from false)
  then
    begin
      perform private.refresh_toss_escrow_delivery(new.ref_id);
    exception when others then
      raise warning 'toss escrow delivery refresh failed for attempt %: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end;
$function$;
revoke all on function private.toss_escrow_delivery_attempt_approved() from public, anon, authenticated, service_role;

create trigger payment_attempts_toss_escrow_delivery
after update of state on public.payment_attempts
for each row execute function private.toss_escrow_delivery_attempt_approved();

-- ---------------------------------------------------------------------------
-- 작업자(service role) RPC
-- ---------------------------------------------------------------------------
-- 처리할 작업: 등록·정정 대기(ready)와, 거래 상태를 다시 볼 때가 된 등록 끝·발송 전 건(1시간마다, 확정·취소되면 멈춤).
create function public.service_claim_toss_escrow_jobs(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_now timestamptz := pg_catalog.clock_timestamp(); v_result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 20 then
    raise invalid_parameter_value using message = 'invalid_escrow_job_limit';
  end if;
  with picked as (
    select job.order_id
    from private.toss_escrow_deliveries as job
    where job.next_attempt_at <= v_now
      and (job.state = 'ready'
        or (job.state in ('registered', 'waiting') and job.escrow_status is distinct from 'CONFIRMED'
          and job.escrow_status is distinct from 'CANCELED'))
    order by (job.state = 'ready') desc, job.next_attempt_at, job.order_id
    limit p_limit
    for update skip locked
  ), leased as (
    update private.toss_escrow_deliveries as job
    set next_attempt_at = v_now + interval '15 minutes', attempts = job.attempts + 1, updated_at = v_now
    from picked where job.order_id = picked.order_id
    returning job.*
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'orderId', leased.order_id,
    'attemptId', leased.attempt_id,
    'state', leased.state,
    'deliveryMethod', leased.delivery_method,
    'carrier', leased.carrier,
    'trackingNumber', leased.tracking_number,
    'shippedAt', leased.shipped_at,
    'receivedAt', leased.received_at,
    'escrowKey', leased.escrow_key,
    'tossDeliveryId', leased.toss_delivery_id,
    'revision', leased.revision,
    'paymentKey', (select payment.payment_key from public.payments as payment
      join public.payment_attempts as attempt on attempt.payment_id = payment.id
      where attempt.id = leased.attempt_id and payment.status = 'paid'),
    'recipientName', (select order_record.address->>'recipientName' from public.orders as order_record where order_record.id = leased.order_id)
  )), '[]'::jsonb)
  into v_result
  from leased;
  return v_result;
end;
$function$;
revoke all on function public.service_claim_toss_escrow_jobs(integer) from public, anon, authenticated, service_role;
grant execute on function public.service_claim_toss_escrow_jobs(integer) to service_role;

-- 작업 결과 기록. p_outcome: registered | skipped | manual_required | retry | status_only
create function public.service_finish_toss_escrow_job(
  p_order_id uuid,
  p_revision integer,
  p_outcome text,
  p_escrow_key text,
  p_toss_delivery_id text,
  p_escrow_status text,
  p_error_code text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job private.toss_escrow_deliveries%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_hold uuid;
begin
  if p_order_id is null or p_outcome not in ('registered', 'skipped', 'manual_required', 'retry', 'status_only')
    or (p_escrow_status is not null and p_escrow_status not in ('IN_PROGRESS', 'CANCEL_REQUESTED', 'CONFIRMED', 'CANCELED'))
    or (p_error_code is not null and p_error_code !~ '^[A-Za-z0-9_.:-]{1,80}$')
    or (p_escrow_key is not null and char_length(p_escrow_key) not between 1 and 64)
    or (p_toss_delivery_id is not null and char_length(p_toss_delivery_id) not between 1 and 64) then
    raise invalid_parameter_value using message = 'invalid_escrow_job_result';
  end if;
  select job.* into v_job from private.toss_escrow_deliveries as job where job.order_id = p_order_id for update;
  if not found then
    return 'not_found';
  end if;

  update private.toss_escrow_deliveries
  set escrow_key = coalesce(p_escrow_key, escrow_key),
      escrow_status = coalesce(p_escrow_status, escrow_status),
      escrow_checked_at = case when p_escrow_status is not null then v_now else escrow_checked_at end,
      toss_delivery_id = coalesce(p_toss_delivery_id, toss_delivery_id),
      -- 처리하는 사이 운송장이 다시 바뀌었으면(revision 증가) 등록 결과로 덮지 않고 다시 대기열에 둔다.
      state = case
        when p_outcome = 'skipped' then 'skipped'
        when p_outcome = 'manual_required' then 'manual_required'
        when p_outcome = 'registered' and v_job.revision = p_revision then 'registered'
        else state end,
      last_error_code = case when p_outcome in ('retry', 'manual_required') then p_error_code
        when p_outcome = 'registered' then null else last_error_code end,
      next_attempt_at = case
        when p_outcome = 'retry' then v_now + least(interval '6 hours', interval '10 minutes' * power(2, least(v_job.attempts, 6)))
        when p_outcome = 'registered' and v_job.revision <> p_revision then v_now
        else v_now + interval '1 hour' end,
      updated_at = v_now
  where order_id = p_order_id;

  if p_escrow_status = 'CANCEL_REQUESTED' and v_job.escrow_status is distinct from 'CANCEL_REQUESTED' then
    insert into private.order_fulfillment_holds(order_id, reason, evidence_key, payment_attempt_id, detail)
    values (p_order_id, 'escrow_cancel_requested',
      'escrow_cancel_requested:' || v_job.attempt_id::text || ':' || pg_catalog.md5(coalesce(p_escrow_key, v_job.escrow_key, '') || ':' || v_now::text),
      v_job.attempt_id, pg_catalog.jsonb_build_object('escrowStatus', 'CANCEL_REQUESTED'))
    on conflict (order_id, reason, evidence_key) do nothing
    returning id into v_hold;
    if v_hold is not null then
      insert into public.audit_log(actor_id, action, target, diff)
      values (null, 'system.order.fulfillment_hold_placed', 'order:' || p_order_id::text,
        pg_catalog.jsonb_build_object('reason', 'escrow_cancel_requested', 'attemptId', v_job.attempt_id, 'holdId', v_hold));
    end if;
  end if;
  return 'recorded';
end;
$function$;
revoke all on function public.service_finish_toss_escrow_job(uuid, integer, text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.service_finish_toss_escrow_job(uuid, integer, text, text, text, text, text) to service_role;

-- 운영자·구매자 계좌 조회 json에 에스크로 상태를 더한다(주문 패널이 보인다).
create or replace function private.order_virtual_account_json(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'bankCode', va.bank_code,
    'accountNumber', va.account_number,
    'dueAt', va.due_at,
    'amount', attempt.amount,
    'useEscrow', va.use_escrow,
    'state', case
      when attempt.state = 'approved' then 'deposited'
      when attempt.state = 'awaiting_deposit' and va.due_at > pg_catalog.clock_timestamp() then 'awaiting'
      when attempt.state in ('awaiting_deposit', 'confirming', 'unknown', 'needs_review') then 'checking'
      else 'closed'
    end,
    'escrow', (
      select pg_catalog.jsonb_build_object(
        'deliveryState', job.state,
        'escrowStatus', job.escrow_status,
        'lastErrorCode', job.last_error_code)
      from private.toss_escrow_deliveries as job where job.order_id = p_order_id)
  )
  from private.payment_attempt_virtual_accounts as va
  join public.payment_attempts as attempt on attempt.id = va.attempt_id
  where va.order_id = p_order_id
  order by va.issued_at desc
  limit 1;
$function$;
revoke all on function private.order_virtual_account_json(uuid) from public, anon, authenticated, service_role;

commit;

notify pgrst, 'reload schema';
