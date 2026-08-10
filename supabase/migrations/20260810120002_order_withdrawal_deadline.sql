-- ============================================================================
-- ICONS · 청약철회 기한 평가 (#189)
-- 지금까지 요청 경로는 주문 상태만 보고 기한을 보지 않아, 환급 의무가 끝난
-- 주문도 전액 환불 경로에 그대로 진입했다.
--
-- 기한은 사유에 따라 다르다(전자상거래법 제17조).
--   · 단순 변심      — 공급받은 날부터 7일
--   · 하자·오배송    — 공급받은 날부터 3개월
-- "그 사실을 안 날부터 30일"은 시스템이 판정할 수 없는 주관적 시점이므로
-- 기계 판정에서 제외한다. 그 바깥은 운영자 재량으로 남는다.
--
-- 공급일(delivered_at)이 없으면 기한은 시작하지 않은 것으로 본다. 운영자가
-- 배송 완료를 기록하지 않은 사이에 고객 권리가 소멸하는 쪽이 더 위험하다.
-- ============================================================================

alter table public.order_cancellation_requests
  add column reason_type text not null default 'change_of_mind';

alter table public.order_cancellation_requests
  add constraint order_cancellation_requests_reason_type_check
  check (reason_type in ('change_of_mind', 'defect'));

-- 기한 판정을 한 곳에 모은다. 요청 접수와 staff 승인이 같은 규칙을 보게 해
-- 폼 우회 요청이 승인 단계를 통과하지 못하게 한다.
create or replace function public.order_withdrawal_deadline_passed(
  p_delivered_at timestamptz,
  p_reason_type text,
  p_at timestamptz
)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_delivered_at is null then false
    when p_reason_type = 'defect' then p_delivered_at + interval '3 months' < p_at
    else p_delivered_at + interval '7 days' < p_at
  end;
$$;

revoke all on function public.order_withdrawal_deadline_passed(timestamptz, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.order_withdrawal_deadline_passed(timestamptz, text, timestamptz)
  to authenticated, service_role;

-- 사유 인자가 늘었다. 기존 3-arg 시그니처를 남기면 기한을 보지 않는 우회
-- 경로가 그대로 남으므로 제거한다.
drop function if exists public.request_order_cancellation(uuid, uuid, text);

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
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_status public.order_status;
  v_delivered_at timestamptz;
  v_request_id uuid;
begin
  if p_reason_type is null or p_reason_type not in ('change_of_mind', 'defect') then
    raise check_violation using message = 'invalid cancellation reason type';
  end if;

  select orders.user_id, orders.status, orders.delivered_at
  into v_user_id, v_status, v_delivered_at
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found or p_user_id is null or v_user_id is distinct from p_user_id then
    return 'not_found';
  end if;

  if v_status = 'canceled' then
    return 'already_canceled';
  end if;

  if v_status not in ('pending', 'paid', 'shipping', 'done') then
    return 'not_cancelable';
  end if;

  if p_reason is null
    or btrim(p_reason) <> p_reason
    or length(p_reason) not between 1 and 200
  then
    raise check_violation using message = 'invalid cancellation reason';
  end if;

  -- 기한 판정은 중복 요청 검사보다 앞선다. 기한이 끝난 주문에 대해 "이미
  -- 요청됨"을 돌려주면 사용자가 처리 중인 요청이 있다고 오해한다.
  if public.order_withdrawal_deadline_passed(v_delivered_at, p_reason_type, now()) then
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

  if v_status = 'pending'
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

    update public.order_cancellation_requests
    set
      status = 'completed',
      completed_at = now(),
      updated_at = now()
    where id = v_request_id;

    return 'completed';
  end if;

  return 'requested';
end;
$$;

revoke all on function public.request_order_cancellation(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.request_order_cancellation(uuid, uuid, text, text)
  to service_role;
