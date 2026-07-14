-- ============================================================================
-- ICONS · 어드민 주문·배송·청약철회 계약 (#93)
-- durable request → staff 결정 → provider 정합화 → 감사 가능한 주문 상태 전이
-- ============================================================================

-- paymentKey는 provider 결제의 식별자이자 취소 증거 키다. 중복이 있으면 한 증거가
-- 여러 로컬 장부를 환불시킬 수 있으므로 배포 전에 fail closed하고 유일성을 고정한다.
do $$
begin
  if exists (
    select payment.payment_key
    from public.payments as payment
    where payment.payment_key is not null
    group by payment.payment_key
    having count(*) > 1
  ) then
    raise exception using message = 'payments.payment_key contains duplicates';
  end if;
end;
$$;

create unique index payments_payment_key_unique_idx
  on public.payments (payment_key)
  where payment_key is not null;

-- 청약철회 요청은 provider 호출을 직렬화하는 기술 claim과 별도로 보존한다.
-- 거절 뒤 배송이 시작되기 전 재요청할 수 있으므로 주문당 active 요청만 하나로 제한한다.
create table public.order_cancellation_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (length(reason) between 1 and 200),
  status text not null default 'requested'
    check (status in ('requested', 'processing', 'needs_review', 'completed', 'rejected')),
  decided_by uuid references public.profiles(id) on delete set null,
  decision_note text check (
    decision_note is null or length(decision_note) between 10 and 200
  ),
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  decided_at timestamptz,
  provider_started_at timestamptz,
  completed_at timestamptz,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index order_cancellation_requests_one_active_idx
  on public.order_cancellation_requests (order_id)
  where status in ('requested', 'processing', 'needs_review');
create index order_cancellation_requests_status_created_idx
  on public.order_cancellation_requests (status, requested_at desc);
create index order_cancellation_requests_order_created_idx
  on public.order_cancellation_requests (order_id, requested_at desc);

create trigger trg_order_cancellation_requests_updated
before update on public.order_cancellation_requests
for each row execute function public.set_updated_at();

alter table public.order_cancellation_requests enable row level security;

create policy order_cancellation_requests_owner_staff_read
on public.order_cancellation_requests
for select
to authenticated
using (
  requested_by = (select auth.uid())
  or (select public.is_staff())
);

revoke all on table public.order_cancellation_requests
  from public, anon, authenticated, service_role;
grant select (
  id,
  order_id,
  status,
  requested_at,
  decided_at,
  decision_note,
  completed_at,
  updated_at
) on table public.order_cancellation_requests to authenticated;
grant select on table public.order_cancellation_requests to service_role;

-- 환불 intent와 해당 업무 요청을 연결한다. 결제별 전액 환불 1건이라는 #92의
-- unique payment 계약은 유지하고, 기존 webhook/cron 환불은 nullable로 남긴다.
alter table public.refunds
  add column cancellation_request_id uuid
    references public.order_cancellation_requests(id) on delete set null;
create index refunds_cancellation_request_idx
  on public.refunds (cancellation_request_id)
  where cancellation_request_id is not null;

-- 배포 시점에 남은 #92 claim은 provider 결과가 불확실한 in-flight 작업이다.
-- claim을 지우지 않고 durable 운영 검토 요청으로 승격해 fail closed 상태를 보존한다.
insert into public.order_cancellation_requests (
  order_id,
  requested_by,
  reason,
  status,
  last_error_code,
  provider_started_at,
  requested_at,
  updated_at
)
select
  claim.order_id,
  claim.requested_by,
  '기존 취소 처리 상태를 운영 검토로 이관',
  'needs_review',
  'legacy_claim_migration',
  claim.claimed_at,
  claim.claimed_at,
  now()
from public.order_cancellation_claims as claim
where not exists (
  select 1
  from public.order_cancellation_requests as request
  where request.order_id = claim.order_id
    and request.status in ('requested', 'processing', 'needs_review')
);

update public.refunds as refund
set cancellation_request_id = request.id
from public.payments as payment
join public.order_cancellation_requests as request
  on request.order_id = payment.ref_id
 and request.status = 'needs_review'
where refund.payment_id = payment.id
  and payment.purpose = 'order'
  and refund.cancellation_request_id is null;

-- #92 finalizer 구현을 내부 함수로 봉인한다. 기존 공개 서버 RPC는 checkout/webhook
-- 호환 경로이므로 active 청약철회 요청을 완료할 수 없고, 검증 전용 RPC만 내부
-- finalizer를 직접 호출한다.
alter function public.cancel_order_with_provider_evidence(uuid, text, text[])
  rename to finalize_order_cancellation_with_provider_evidence;

revoke all on function public.finalize_order_cancellation_with_provider_evidence(uuid, text, text[])
  from public, anon, authenticated, service_role;

create or replace function public.cancel_order_with_provider_evidence(
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
  v_request_id uuid;
begin
  perform orders.id
  from public.orders
  where orders.id = p_order_id
  for update;

  if exists (
    select 1
    from public.order_cancellation_requests as request
    where request.order_id = p_order_id
      and request.status in ('requested', 'processing', 'needs_review')
  ) then
    raise exception using message = 'verified cancellation completion required';
  end if;

  perform public.finalize_order_cancellation_with_provider_evidence(
    p_order_id,
    p_reason,
    p_provider_payment_keys
  );

  select request.id
  into v_request_id
  from public.order_cancellation_requests as request
  where request.order_id = p_order_id
    and request.status = 'completed'
  order by request.requested_at desc, request.id desc
  limit 1
  for update;

  if v_request_id is null then
    return;
  end if;

  update public.refunds as refund
  set cancellation_request_id = v_request_id
  from public.payments as payment
  where refund.payment_id = payment.id
    and payment.purpose = 'order'
    and payment.ref_id = p_order_id
    and (
      refund.cancellation_request_id is null
      or refund.cancellation_request_id = v_request_id
    );

end;
$$;

revoke all on function public.cancel_order_with_provider_evidence(uuid, text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_order_with_provider_evidence(uuid, text, text[])
  to service_role;

-- 기존 만료 cron의 empty-evidence wrapper도 compatibility 경계를 명시적으로
-- 다시 가리킨다. active 요청은 아래 sweep 필터와 wrapper 양쪽에서 차단한다.
create or replace function public.cancel_order(
  p_order_id uuid,
  p_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.cancel_order_with_provider_evidence(
    p_order_id,
    p_reason,
    array[]::text[]
  );
end;
$$;

revoke all on function public.cancel_order(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_order(uuid, text)
  to service_role;

-- 만료 sweep은 provider 전체 검증이 필요한 active 청약철회 요청을 건드리지 않는다.
-- 요청이 완료/거절된 뒤에는 기존 만료 정리 경로가 다시 처리할 수 있다.
create or replace function public.expire_stale_checkouts()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select orders.id
    from public.orders
    where orders.status = 'pending'
      and orders.expires_at is not null
      and orders.expires_at < now() - interval '5 minutes'
      and not exists (
        select 1
        from public.payments as payment
        where payment.purpose = 'order'
          and payment.ref_id = orders.id
          and payment.status in ('pending', 'paid')
      )
      and not exists (
        select 1
        from public.order_cancellation_requests as request
        where request.order_id = orders.id
          and request.status in ('requested', 'processing', 'needs_review')
      )
    order by orders.expires_at
    limit 200
    for update of orders skip locked
  loop
    perform public.cancel_order(r.id, '결제 시간 만료 자동 취소');
    v_count := v_count + 1;
  end loop;

  for r in
    select ticket_orders.id
    from public.ticket_orders
    where ticket_orders.status = 'pending'
      and ticket_orders.expires_at is not null
      and ticket_orders.expires_at < now() - interval '5 minutes'
      and not exists (
        select 1
        from public.payments as payment
        where payment.purpose = 'ticket'
          and payment.ref_id = ticket_orders.id
          and payment.status in ('pending', 'paid')
      )
    order by ticket_orders.expires_at
    limit 200
  loop
    perform public.refund_ticket_order(r.id, '결제 시간 만료 자동 취소');
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.expire_stale_checkouts()
  from public, anon, authenticated, service_role;
grant execute on function public.expire_stale_checkouts()
  to service_role;

-- 신규 요청은 사용자 소유권과 주문 상태를 주문 행 잠금 아래 다시 확인한다.
-- 결제 행이 전혀 없는 pending만 즉시 정리하고, 그 외에는 provider 호출 없이
-- requested 상태로 남겨 배송/결제 확정을 차단한다.
create or replace function public.request_order_cancellation(
  p_order_id uuid,
  p_user_id uuid,
  p_reason text
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
  v_request_id uuid;
begin
  select orders.user_id, orders.status
  into v_user_id, v_status
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found or p_user_id is null or v_user_id is distinct from p_user_id then
    return 'not_found';
  end if;

  if v_status = 'canceled' then
    return 'already_canceled';
  end if;

  if v_status not in ('pending', 'paid') then
    return 'not_cancelable';
  end if;

  if p_reason is null
    or btrim(p_reason) <> p_reason
    or length(p_reason) not between 1 and 200
  then
    raise check_violation using message = 'invalid cancellation reason';
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
    status
  )
  values (
    p_order_id,
    p_user_id,
    p_reason,
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

revoke all on function public.request_order_cancellation(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.request_order_cancellation(uuid, uuid, text)
  to service_role;

-- durable 요청도 claim과 동일하게 모든 주문 상태 writer에 적용한다. canceled 전이는
-- provider finalizer의 정상 종결이므로 허용한다.
create or replace function public.guard_order_transition_during_cancellation()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status
    and new.status <> 'canceled'
    and (
      exists (
        select 1
        from public.order_cancellation_claims as claim
        where claim.order_id = old.id
      )
      or exists (
        select 1
        from public.order_cancellation_requests as request
        where request.order_id = old.id
          and request.status in ('requested', 'processing', 'needs_review')
      )
    )
  then
    raise exception using
      errcode = '23514',
      message = 'order cancellation in progress';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_order_transition_during_cancellation()
  from public, anon, authenticated, service_role;

-- #92의 직접 claim 진입점은 새 durable request 계약으로 완전히 대체한다.
drop function public.claim_order_cancellation(uuid, uuid);

-- staff 결정은 DB에서도 auth.uid()와 역할을 검증한다. approve 시에만 claim과
-- 결제별 환불 intent를 만들며, provider 원문이나 payment key는 감사 로그에 쓰지 않는다.
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

  select orders.status
  into v_order_status
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

  if v_order_status not in ('pending', 'paid') then
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
      'paymentCount', v_payment_count
    )
  );
end;
$$;

revoke all on function public.admin_decide_order_cancellation(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_decide_order_cancellation(uuid, text, text)
  to authenticated;

-- provider 호출 결과가 불확실하면 claim과 주문/재고를 그대로 두고 운영 검토로 전환한다.
create or replace function public.mark_order_cancellation_needs_review(
  p_request_id uuid,
  p_actor_id uuid,
  p_error_code text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_request_status text;
begin
  if p_actor_id is null or not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_actor_id
      and profile.role in ('staff', 'admin')
  ) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_error_code is null or p_error_code !~ '^[a-z0-9_]{1,64}$' then
    raise check_violation using message = 'invalid review code';
  end if;

  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  perform orders.id
  from public.orders
  where orders.id = v_order_id
  for update;

  select request.status
  into v_request_status
  from public.order_cancellation_requests as request
  where request.id = p_request_id
  for update;

  if v_request_status = 'needs_review' then
    return;
  end if;

  if v_request_status <> 'processing' then
    raise exception using message = 'cancellation_request_not_processing';
  end if;

  if not exists (
    select 1
    from public.order_cancellation_claims as claim
    where claim.order_id = v_order_id
  ) then
    raise exception using message = 'cancellation_claim_missing';
  end if;

  update public.refunds
  set status = 'failed'
  where cancellation_request_id = p_request_id
    and status <> 'done';

  update public.order_cancellation_requests
  set
    status = 'needs_review',
    last_error_code = p_error_code,
    updated_at = now()
  where id = p_request_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    p_actor_id,
    'admin.order.cancellation_needs_review',
    'order:' || v_order_id::text,
    jsonb_build_object(
      'requestId', p_request_id,
      'from', 'processing',
      'to', 'needs_review',
      'errorCode', p_error_code
    )
  );
end;
$$;

revoke all on function public.mark_order_cancellation_needs_review(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_order_cancellation_needs_review(uuid, uuid, text)
  to service_role;

-- needs_review는 삭제/거절하지 않고 같은 claim·refund intent로만 재조회/재시도한다.
create or replace function public.admin_begin_order_cancellation_reconcile(
  p_request_id uuid
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
  v_request_status text;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  perform orders.id
  from public.orders
  where orders.id = v_order_id
  for update;

  select request.status
  into v_request_status
  from public.order_cancellation_requests as request
  where request.id = p_request_id
  for update;

  if v_request_status = 'processing' then
    return;
  end if;

  if v_request_status <> 'needs_review' then
    raise exception using message = 'cancellation_request_not_reconcilable';
  end if;

  if not exists (
    select 1
    from public.order_cancellation_claims as claim
    where claim.order_id = v_order_id
  ) then
    raise exception using message = 'cancellation_claim_missing';
  end if;

  update public.refunds
  set status = 'requested'
  where cancellation_request_id = p_request_id
    and status = 'failed';

  update public.order_cancellation_requests
  set
    status = 'processing',
    decided_by = coalesce(decided_by, v_actor),
    decided_at = coalesce(decided_at, now()),
    provider_started_at = coalesce(provider_started_at, now()),
    updated_at = now()
  where id = p_request_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.cancellation_reconcile_started',
    'order:' || v_order_id::text,
    jsonb_build_object(
      'requestId', p_request_id,
      'from', 'needs_review',
      'to', 'processing'
    )
  );
end;
$$;

revoke all on function public.admin_begin_order_cancellation_reconcile(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_begin_order_cancellation_reconcile(uuid)
  to authenticated;

-- fresh provider GET으로 모든 active 결제의 전액 취소를 확인한 뒤에만 #92 finalizer를
-- 호출한다. payment key 배열은 증거 비교에만 쓰고 테이블/감사 로그에는 남기지 않는다.
create or replace function public.complete_order_cancellation_request(
  p_request_id uuid,
  p_provider_payment_keys text[],
  p_actor_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_reason text;
  v_request_status text;
  v_provider_payment_keys text[];
  v_refund_count integer;
begin
  if p_actor_id is null or not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_actor_id
      and profile.role in ('staff', 'admin')
  ) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  perform orders.id
  from public.orders
  where orders.id = v_order_id
  for update;

  select request.status, request.reason
  into v_request_status, v_reason
  from public.order_cancellation_requests as request
  where request.id = p_request_id
  for update;

  if v_request_status = 'completed' then
    return;
  end if;

  if v_request_status <> 'processing' then
    raise exception using message = 'cancellation_request_not_processing';
  end if;

  if not exists (
    select 1
    from public.order_cancellation_claims as claim
    where claim.order_id = v_order_id
  ) then
    raise exception using message = 'cancellation_claim_missing';
  end if;

  select coalesce(array_agg(keys.payment_key order by keys.payment_key), array[]::text[])
  into v_provider_payment_keys
  from (
    select distinct btrim(payment_key) as payment_key
    from unnest(coalesce(p_provider_payment_keys, array[]::text[])) as input(payment_key)
    where payment_key is not null
      and btrim(payment_key) <> ''
  ) as keys;

  -- 로컬 장부가 canceled/refunded여도 provider 취소 완료의 진실원은 fresh GET이다.
  -- 실제 capture가 없었던 failed 결제만 증거 대상에서 제외한다.
  if exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = v_order_id
      and payment.status <> 'failed'
      and (
        payment.payment_key is null
        or not (payment.payment_key = any(v_provider_payment_keys))
      )
  ) then
    raise exception using message = 'provider cancellation required';
  end if;

  perform public.finalize_order_cancellation_with_provider_evidence(
    v_order_id,
    v_reason,
    v_provider_payment_keys
  );

  update public.refunds as refund
  set cancellation_request_id = p_request_id
  from public.payments as payment
  where refund.payment_id = payment.id
    and payment.purpose = 'order'
    and payment.ref_id = v_order_id
    and (
      refund.cancellation_request_id is null
      or refund.cancellation_request_id = p_request_id
    );

  if exists (
    select 1
    from public.refunds as refund
    where refund.cancellation_request_id = p_request_id
      and refund.status <> 'done'
  ) then
    raise exception using message = 'provider cancellation required';
  end if;

  select count(*)::integer
  into v_refund_count
  from public.refunds as refund
  where refund.cancellation_request_id = p_request_id
    and refund.status = 'done';

  update public.order_cancellation_requests
  set
    status = 'completed',
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
  where id = p_request_id
    and status = 'processing';

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    p_actor_id,
    'admin.order.cancellation_completed',
    'order:' || v_order_id::text,
    jsonb_build_object(
      'requestId', p_request_id,
      'to', 'completed',
      'refundCount', v_refund_count
    )
  );
end;
$$;

revoke all on function public.complete_order_cancellation_request(uuid, text[], uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_order_cancellation_request(uuid, text[], uuid)
  to service_role;

-- 배송 상태는 명시된 단방향 상태기계만 허용하고, 실제 전이만 감사한다.
create or replace function public.admin_update_order_status(
  p_order_id uuid,
  p_status public.order_status
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
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  select orders.status
  into v_current_status
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order_not_found';
  end if;

  if p_status not in ('shipping', 'done') then
    raise check_violation using message = 'invalid_order_status';
  end if;

  if v_current_status = p_status then
    return;
  end if;

  if not (
    (v_current_status = 'paid' and p_status = 'shipping')
    or (v_current_status = 'shipping' and p_status = 'done')
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

  update public.orders
  set status = p_status
  where id = p_order_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.status_updated',
    'order:' || p_order_id::text,
    jsonb_build_object(
      'from', v_current_status::text,
      'to', p_status::text
    )
  );
end;
$$;

revoke all on function public.admin_update_order_status(uuid, public.order_status)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_update_order_status(uuid, public.order_status)
  to authenticated;

-- 목록 검색은 이메일·닉네임·주문번호·상태·KST 일자를 DB에서 필터링한다.
-- payment key/raw는 반환하지 않고 staff 화면에 필요한 배송지만 포함한다.
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
  cancellation_request_id uuid,
  cancellation_request_status text,
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
    cancellation.id as cancellation_request_id,
    cancellation.status as cancellation_request_status,
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
