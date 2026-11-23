-- ==========================================================================
-- ICONS · 토스 계좌이체 에스크로 배송 등록 — ADR-0049 2026-11-23 보강
--
-- 계좌이체(ICONS MID iconsi0xvd에 에스크로 사용으로 계약)는 가상계좌와 같은 운영 스위치(TOSS_VIRTUAL_ACCOUNT_ENABLED)로 굿즈 주문에
-- 열린다(lib/payments/toss-gateway.server.ts transferAccepted). 주문서형 결제 UI는 계좌이체에도 에스크로 선택란을 띄우고(구매자 선택),
-- 에스크로를 고른 결제는 발송 때 배송을 등록해야 구매확정·정산된다(/guides/v2/escrow).
--
-- 가상계좌는 에스크로 선택을 private.payment_attempt_virtual_accounts.use_escrow에 남기지만 계좌이체는 남기는 곳이 없다. 그래서 승인
-- 증거(private.payment_provider_evidence)의 결제수단이 계좌이체인 승인 시도를 "선택을 모르는" 대상으로 작업 원장에 넣는다 —
-- 작업자(cron /api/cron/toss-escrow)가 결제 조회의 useEscrow로 확인하고 아니면 건너뛴다(skipped). 카드·간편결제 승인은 대상이 아니다.
--
-- 이 migration은 대상 판정 하나(private.toss_escrow_candidate_attempt)를 두고, 20261125090200의 대상 판정 세 곳(refresh 함수·
-- 출고 트리거·승인 트리거)이 그 판정을 쓰게 다시 정의한다. 나머지 본문은 20261125090200 그대로다.
-- 승인 트리거는 증거가 상태 전이보다 먼저 기록되는 확정 경로(finalize_goods_payment_attempt)에서 바로 잡고, 그 밖의 경로는 출고
-- 트리거가 발송 때 잡는다.
-- ==========================================================================

begin;

create function private.toss_escrow_candidate_attempt(p_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
      select 1 from private.payment_attempt_virtual_accounts as va
      where va.attempt_id = p_attempt_id and va.use_escrow is distinct from false)
    or (
      not exists (select 1 from private.payment_attempt_virtual_accounts as va where va.attempt_id = p_attempt_id)
      and exists (
        select 1 from private.payment_provider_evidence as evidence
        where evidence.payment_attempt_id = p_attempt_id and evidence.payment_method = '계좌이체'));
$function$;
revoke all on function private.toss_escrow_candidate_attempt(uuid) from public, anon, authenticated, service_role;

create or replace function private.refresh_toss_escrow_delivery(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempt public.payment_attempts%rowtype;
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
  if not private.toss_escrow_candidate_attempt(v_attempt.id) then
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

create or replace function private.toss_escrow_delivery_shipment_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- 에스크로 대상(입금 승인된 가상계좌·승인된 계좌이체)인 주문만 판정한다. 실패해도 출고 처리는 막지 않는다(작업자가 다음 회차에 다시 본다).
  if exists (
    select 1 from public.payment_attempts as attempt
    where attempt.purpose = 'order' and attempt.ref_id = new.order_id and attempt.provider = 'toss' and attempt.state = 'approved'
      and private.toss_escrow_candidate_attempt(attempt.id)
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

create or replace function private.toss_escrow_delivery_attempt_approved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.state = 'approved' and old.state is distinct from 'approved' and new.purpose = 'order' and new.provider = 'toss'
    and new.ref_id is not null
    and private.toss_escrow_candidate_attempt(new.id)
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

commit;
