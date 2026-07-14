-- 내 티켓 취소/환불 계약 (#95): 정책 snapshot, durable provider reconcile, QR 경합 차단.

create table public.ticket_cancellation_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  ticket_order_id uuid not null references public.ticket_orders(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  source text not null check (source in ('user', 'provider')),
  status text not null default 'requested'
    check (status in ('requested', 'processing', 'needs_review', 'completed')),
  policy_code text not null default 'event_start_full_refund_v1'
    check (policy_code = 'event_start_full_refund_v1'),
  cutoff_at timestamptz,
  gross_amount bigint not null check (gross_amount >= 0),
  fee_amount bigint not null default 0 check (fee_amount = 0),
  refund_amount bigint not null check (
    refund_amount >= 0 and refund_amount = gross_amount - fee_amount
  ),
  reason text not null check (length(reason) between 1 and 200),
  attempt_token uuid,
  provider_started_at timestamptz,
  completed_at timestamptz,
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,64}$'
  ),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index ticket_cancellation_requests_one_active_idx
  on public.ticket_cancellation_requests (ticket_order_id)
  where status in ('requested', 'processing', 'needs_review');
create index ticket_cancellation_requests_owner_created_idx
  on public.ticket_cancellation_requests (requested_by, requested_at desc);
create index ticket_cancellation_requests_order_created_idx
  on public.ticket_cancellation_requests (ticket_order_id, requested_at desc);

create trigger trg_ticket_cancellation_requests_updated
before update on public.ticket_cancellation_requests
for each row execute function public.set_updated_at();

alter table public.ticket_cancellation_requests enable row level security;

create policy ticket_cancellation_requests_owner_staff_read
on public.ticket_cancellation_requests
for select
to authenticated
using (
  requested_by = (select auth.uid())
  or (select public.is_staff())
);

revoke all on table public.ticket_cancellation_requests
  from public, anon, authenticated, service_role;
grant select (
  id,
  ticket_order_id,
  source,
  status,
  policy_code,
  cutoff_at,
  gross_amount,
  fee_amount,
  refund_amount,
  requested_at,
  completed_at,
  updated_at
) on table public.ticket_cancellation_requests to authenticated;
grant select on table public.ticket_cancellation_requests to service_role;

-- QR 원문은 검증 Route의 service role 경계에서만 읽는다. 브라우저는 티켓
-- 식별자·종류·상태·생성 시각만 RLS로 읽을 수 있다.
revoke select on table public.tickets from authenticated;
grant select (id, ticket_order_id, ticket_type_id, status, created_at)
  on table public.tickets to authenticated;

alter table public.refunds
  add column ticket_cancellation_request_id uuid
    references public.ticket_cancellation_requests(id) on delete set null;
create index refunds_ticket_cancellation_request_idx
  on public.refunds (ticket_cancellation_request_id)
  where ticket_cancellation_request_id is not null;

-- 모든 취소 경로의 마지막 allocation 전이는 이 함수 한 곳에서만 수행한다.
-- 호출자가 이미 잠갔더라도 같은 order → request → payment → ticket → type 순서로
-- 다시 잠가 독립 호출에도 동일한 직렬화 계약을 유지한다.
create function public.finalize_ticket_cancellation_request(
  p_request_id uuid,
  p_actor_id uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_order_status public.ticket_order_status;
  v_request_status text;
  v_request_source text;
  v_refund_count integer;
begin
  select request.ticket_order_id
  into v_order_id
  from public.ticket_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null then
    raise no_data_found using message = 'ticket cancellation request not found';
  end if;

  select ticket_order.status
  into v_order_status
  from public.ticket_orders as ticket_order
  where ticket_order.id = v_order_id
  for update of ticket_order;

  if not found then
    raise no_data_found using message = 'ticket order not found';
  end if;

  select request.status, request.source
  into v_request_status, v_request_source
  from public.ticket_cancellation_requests as request
  where request.id = p_request_id
  for update of request;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'ticket'
    and payment.ref_id = v_order_id
  order by payment.id
  for update of payment;

  perform ticket.id
  from public.tickets as ticket
  where ticket.ticket_order_id = v_order_id
  order by ticket.id
  for update of ticket;

  perform ticket_type.id
  from public.ticket_types as ticket_type
  where ticket_type.id in (
    select ticket.ticket_type_id
    from public.tickets as ticket
    where ticket.ticket_order_id = v_order_id
  )
  order by ticket_type.id
  for update of ticket_type;

  if v_request_status = 'completed' then
    return 'completed';
  end if;

  if v_order_status = 'canceled' then
    update public.ticket_cancellation_requests
    set
      status = 'completed',
      attempt_token = null,
      completed_at = coalesce(completed_at, now()),
      last_error_code = null
    where id = p_request_id;
    return 'completed';
  end if;

  if v_order_status not in ('pending', 'paid') then
    raise check_violation using message = 'ticket order not cancelable';
  end if;

  if exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'ticket'
      and payment.ref_id = v_order_id
      and payment.status in ('pending', 'paid')
  ) then
    return 'processing';
  end if;

  if v_order_status = 'paid' and not exists (
    select 1
    from public.payments as payment
    join public.refunds as refund on refund.payment_id = payment.id
    where payment.purpose = 'ticket'
      and payment.ref_id = v_order_id
      and payment.status = 'refunded'
      and refund.status = 'done'
  ) then
    raise check_violation using message = 'payment evidence required';
  end if;

  if exists (
    select 1
    from public.tickets as ticket
    where ticket.ticket_order_id = v_order_id
      and ticket.status = 'used'
  ) then
    update public.ticket_cancellation_requests
    set
      status = 'needs_review',
      attempt_token = null,
      last_error_code = 'used_ticket_after_provider_cancellation'
    where id = p_request_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      p_actor_id,
      'ticket.cancellation.needs_review',
      'ticket_order:' || v_order_id::text,
      jsonb_build_object(
        'requestId', p_request_id,
        'source', v_request_source,
        'to', 'needs_review',
        'errorCode', 'used_ticket_after_provider_cancellation'
      )
    );
    return 'needs_review';
  end if;

  update public.ticket_types as ticket_type
  set sold = ticket_type.sold - allocation.qty
  from (
    select ticket.ticket_type_id, count(*)::integer as qty
    from public.tickets as ticket
    where ticket.ticket_order_id = v_order_id
    group by ticket.ticket_type_id
  ) as allocation
  where ticket_type.id = allocation.ticket_type_id;

  update public.tickets
  set status = 'refunded'
  where ticket_order_id = v_order_id;

  update public.ticket_orders
  set
    status = 'canceled',
    expires_at = null
  where id = v_order_id;

  update public.ticket_cancellation_requests
  set
    status = 'completed',
    attempt_token = null,
    completed_at = coalesce(completed_at, now()),
    last_error_code = null
  where id = p_request_id;

  select count(*)::integer
  into v_refund_count
  from public.refunds as refund
  where refund.ticket_cancellation_request_id = p_request_id
    and refund.status = 'done';

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    p_actor_id,
    'ticket.cancellation.completed',
    'ticket_order:' || v_order_id::text,
    jsonb_build_object(
      'requestId', p_request_id,
      'source', v_request_source,
      'to', 'completed',
      'refundCount', v_refund_count
    )
  );

  return 'completed';
end;
$$;

revoke all on function public.finalize_ticket_cancellation_request(uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.request_ticket_cancellation(
  p_user_id uuid,
  p_ticket_order_id uuid
)
returns table (request_id uuid, result text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_user_id uuid;
  v_order_status public.ticket_order_status;
  v_order_total bigint;
  v_event_id text;
  v_cutoff_at timestamptz;
  v_existing_request record;
begin
  select
    ticket_order.user_id,
    ticket_order.status,
    ticket_order.total,
    ticket_order.event_id
  into
    v_order_user_id,
    v_order_status,
    v_order_total,
    v_event_id
  from public.ticket_orders as ticket_order
  where ticket_order.id = p_ticket_order_id
  for update of ticket_order;

  if not found or p_user_id is null or v_order_user_id is distinct from p_user_id then
    request_id := null;
    result := 'not_found';
    return next;
    return;
  end if;

  if v_order_status = 'canceled' then
    select request.id
    into request_id
    from public.ticket_cancellation_requests as request
    where request.ticket_order_id = p_ticket_order_id
      and request.status = 'completed'
    order by request.requested_at desc, request.id
    limit 1;

    result := case when request_id is null then 'already_canceled' else 'completed' end;
    return next;
    return;
  end if;

  if v_order_status not in ('pending', 'paid') then
    request_id := null;
    result := 'not_cancelable';
    return next;
    return;
  end if;

  select request.id, request.status
  into v_existing_request
  from public.ticket_cancellation_requests as request
  where request.ticket_order_id = p_ticket_order_id
    and request.status in ('requested', 'processing', 'needs_review')
  order by request.requested_at desc, request.id
  limit 1
  for update of request;

  if found then
    request_id := v_existing_request.id;
    result := v_existing_request.status;
    return next;
    return;
  end if;

  select event_record.starts_at
  into v_cutoff_at
  from public.events as event_record
  where event_record.id = v_event_id
  for share of event_record;

  if v_cutoff_at is null or now() >= v_cutoff_at then
    request_id := null;
    result := 'policy_closed';
    return next;
    return;
  end if;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'ticket'
    and payment.ref_id = p_ticket_order_id
  order by payment.id
  for update of payment;

  perform ticket.id
  from public.tickets as ticket
  where ticket.ticket_order_id = p_ticket_order_id
  order by ticket.id
  for update of ticket;

  perform ticket_type.id
  from public.ticket_types as ticket_type
  where ticket_type.id in (
    select ticket.ticket_type_id
    from public.tickets as ticket
    where ticket.ticket_order_id = p_ticket_order_id
  )
  order by ticket_type.id
  for update of ticket_type;

  if not exists (
    select 1
    from public.tickets as ticket
    where ticket.ticket_order_id = p_ticket_order_id
  ) or exists (
    select 1
    from public.tickets as ticket
    where ticket.ticket_order_id = p_ticket_order_id
      and ticket.status <> 'valid'
  ) then
    request_id := null;
    result := 'not_cancelable';
    return next;
    return;
  end if;

  insert into public.ticket_cancellation_requests (
    ticket_order_id,
    requested_by,
    source,
    status,
    policy_code,
    cutoff_at,
    gross_amount,
    fee_amount,
    refund_amount,
    reason
  )
  values (
    p_ticket_order_id,
    p_user_id,
    'user',
    'requested',
    'event_start_full_refund_v1',
    v_cutoff_at,
    v_order_total,
    0,
    v_order_total,
    '사용자 예매 취소 요청'
  )
  returning id into request_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    p_user_id,
    'ticket.cancellation.requested',
    'ticket_order:' || p_ticket_order_id::text,
    jsonb_build_object(
      'requestId', request_id,
      'source', 'user',
      'policyCode', 'event_start_full_refund_v1',
      'to', 'requested'
    )
  );

  if v_order_status = 'pending' and not exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'ticket'
      and payment.ref_id = p_ticket_order_id
  ) then
    result := public.finalize_ticket_cancellation_request(request_id, p_user_id);
  else
    result := 'requested';
  end if;

  return next;
end;
$$;

revoke all on function public.request_ticket_cancellation(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.request_ticket_cancellation(uuid, uuid)
  to service_role;

create function public.begin_ticket_cancellation_reconcile(
  p_request_id uuid,
  p_user_id uuid,
  p_attempt_token uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_requested_by uuid;
  v_status text;
  v_attempt_token uuid;
  v_provider_started_at timestamptz;
begin
  if p_attempt_token is null then
    raise not_null_violation using message = 'attempt token required';
  end if;

  select request.ticket_order_id, request.requested_by
  into v_order_id, v_requested_by
  from public.ticket_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null or p_user_id is null or v_requested_by is distinct from p_user_id then
    raise no_data_found using message = 'ticket cancellation request not found';
  end if;

  perform ticket_order.id
  from public.ticket_orders as ticket_order
  where ticket_order.id = v_order_id
  for update of ticket_order;

  select request.status, request.attempt_token, request.provider_started_at
  into v_status, v_attempt_token, v_provider_started_at
  from public.ticket_cancellation_requests as request
  where request.id = p_request_id
  for update of request;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'ticket'
    and payment.ref_id = v_order_id
  order by payment.id
  for update of payment;

  perform ticket.id
  from public.tickets as ticket
  where ticket.ticket_order_id = v_order_id
  order by ticket.id
  for update of ticket;

  perform ticket_type.id
  from public.ticket_types as ticket_type
  where ticket_type.id in (
    select ticket.ticket_type_id
    from public.tickets as ticket
    where ticket.ticket_order_id = v_order_id
  )
  order by ticket_type.id
  for update of ticket_type;

  if v_status = 'completed' then
    return 'completed';
  end if;

  if v_status = 'processing' then
    if v_attempt_token = p_attempt_token then
      return 'processing';
    end if;

    if v_attempt_token is not null
      and v_provider_started_at is not null
      and v_provider_started_at > now() - interval '5 minutes'
    then
      return 'in_progress';
    end if;

    update public.ticket_cancellation_requests
    set
      attempt_token = p_attempt_token,
      provider_started_at = now(),
      last_error_code = null
    where id = p_request_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      p_user_id,
      'ticket.cancellation.processing_reclaimed',
      'ticket_order:' || v_order_id::text,
      jsonb_build_object(
        'requestId', p_request_id,
        'from', 'processing',
        'to', 'processing'
      )
    );

    return 'processing';
  end if;

  if v_status not in ('requested', 'needs_review') then
    raise check_violation using message = 'ticket cancellation not reconcilable';
  end if;

  update public.ticket_cancellation_requests
  set
    status = 'processing',
    attempt_token = p_attempt_token,
    provider_started_at = now(),
    last_error_code = null
  where id = p_request_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    p_user_id,
    'ticket.cancellation.processing',
    'ticket_order:' || v_order_id::text,
    jsonb_build_object(
      'requestId', p_request_id,
      'from', v_status,
      'to', 'processing'
    )
  );

  return 'processing';
end;
$$;

revoke all on function public.begin_ticket_cancellation_reconcile(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.begin_ticket_cancellation_reconcile(uuid, uuid, uuid)
  to service_role;

create function public.mark_ticket_cancellation_needs_review(
  p_request_id uuid,
  p_attempt_token uuid,
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
  v_requested_by uuid;
  v_status text;
  v_current_attempt_token uuid;
begin
  if p_error_code is null or p_error_code !~ '^[a-z0-9_]{1,64}$' then
    raise check_violation using message = 'invalid review code';
  end if;

  select request.ticket_order_id, request.requested_by
  into v_order_id, v_requested_by
  from public.ticket_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null then
    raise no_data_found using message = 'ticket cancellation request not found';
  end if;

  perform ticket_order.id
  from public.ticket_orders as ticket_order
  where ticket_order.id = v_order_id
  for update of ticket_order;

  select request.status, request.attempt_token
  into v_status, v_current_attempt_token
  from public.ticket_cancellation_requests as request
  where request.id = p_request_id
  for update of request;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'ticket'
    and payment.ref_id = v_order_id
  order by payment.id
  for update of payment;

  perform ticket.id
  from public.tickets as ticket
  where ticket.ticket_order_id = v_order_id
  order by ticket.id
  for update of ticket;

  perform ticket_type.id
  from public.ticket_types as ticket_type
  where ticket_type.id in (
    select ticket.ticket_type_id
    from public.tickets as ticket
    where ticket.ticket_order_id = v_order_id
  )
  order by ticket_type.id
  for update of ticket_type;

  if v_status in ('completed', 'needs_review') then
    return;
  end if;

  if v_status <> 'processing' then
    raise check_violation using message = 'ticket cancellation not processing';
  end if;

  if p_attempt_token is null or v_current_attempt_token is distinct from p_attempt_token then
    raise check_violation using message = 'ticket cancellation attempt mismatch';
  end if;

  update public.ticket_cancellation_requests
  set
    status = 'needs_review',
    attempt_token = null,
    last_error_code = p_error_code
  where id = p_request_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_requested_by,
    'ticket.cancellation.needs_review',
    'ticket_order:' || v_order_id::text,
    jsonb_build_object(
      'requestId', p_request_id,
      'from', 'processing',
      'to', 'needs_review',
      'errorCode', p_error_code
    )
  );
end;
$$;

revoke all on function public.mark_ticket_cancellation_needs_review(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_ticket_cancellation_needs_review(uuid, uuid, text)
  to service_role;

-- webhook 또는 서버의 fresh GET 결과 한 건을 먼저 로컬 durable 장부에 기록한다.
-- provider key는 payments/refunds에만 남고 audit_log에는 상태와 개수만 기록한다.
create function public.record_ticket_provider_cancellation_evidence(
  p_ticket_order_id uuid,
  p_reason text,
  p_provider_payment_key text,
  p_provider_raw jsonb default null,
  p_refund_confirmed boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_user_id uuid;
  v_order_status public.ticket_order_status;
  v_order_total bigint;
  v_event_id text;
  v_cutoff_at timestamptz;
  v_request_id uuid;
  v_request_status text;
  v_payment_id uuid;
  v_payment_user_id uuid;
  v_payment_purpose public.payment_purpose;
  v_payment_ref_id uuid;
  v_payment_amount bigint;
  v_payment_status public.payment_status;
  v_payment_key text;
  v_idempotency_key text;
begin
  if p_refund_confirmed is null
    or (p_refund_confirmed and p_provider_raw is null)
  then
    raise check_violation using message = 'verified refund evidence required';
  end if;

  if p_reason is null
    or btrim(p_reason) <> p_reason
    or length(p_reason) not between 1 and 200
  then
    raise check_violation using message = 'invalid cancellation reason';
  end if;

  if p_provider_payment_key is null
    or nullif(btrim(p_provider_payment_key), '') is null
    or length(p_provider_payment_key) > 200
  then
    raise check_violation using message = 'invalid payment evidence';
  end if;

  select
    ticket_order.user_id,
    ticket_order.status,
    ticket_order.total,
    ticket_order.event_id
  into
    v_order_user_id,
    v_order_status,
    v_order_total,
    v_event_id
  from public.ticket_orders as ticket_order
  where ticket_order.id = p_ticket_order_id
  for update of ticket_order;

  if not found then
    raise no_data_found using message = 'ticket order not found';
  end if;

  select request.id, request.status
  into v_request_id, v_request_status
  from public.ticket_cancellation_requests as request
  where request.ticket_order_id = p_ticket_order_id
    and request.status in ('requested', 'processing', 'needs_review')
  order by request.requested_at desc, request.id
  limit 1
  for update of request;

  if not found then
    select request.id, request.status
    into v_request_id, v_request_status
    from public.ticket_cancellation_requests as request
    where request.ticket_order_id = p_ticket_order_id
      and request.status = 'completed'
    order by request.requested_at desc, request.id
    limit 1
    for update of request;
  end if;

  if v_request_id is null then
    select event_record.starts_at
    into v_cutoff_at
    from public.events as event_record
    where event_record.id = v_event_id
    for share of event_record;

    insert into public.ticket_cancellation_requests (
      ticket_order_id,
      requested_by,
      source,
      status,
      policy_code,
      cutoff_at,
      gross_amount,
      fee_amount,
      refund_amount,
      reason,
      provider_started_at,
      completed_at
    )
    values (
      p_ticket_order_id,
      v_order_user_id,
      'provider',
      case when v_order_status = 'canceled' then 'completed' else 'processing' end,
      'event_start_full_refund_v1',
      v_cutoff_at,
      v_order_total,
      0,
      v_order_total,
      p_reason,
      now(),
      case when v_order_status = 'canceled' then now() else null end
    )
    returning id, status into v_request_id, v_request_status;
  end if;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'ticket'
    and payment.ref_id = p_ticket_order_id
  order by payment.id
  for update of payment;

  perform ticket.id
  from public.tickets as ticket
  where ticket.ticket_order_id = p_ticket_order_id
  order by ticket.id
  for update of ticket;

  perform ticket_type.id
  from public.ticket_types as ticket_type
  where ticket_type.id in (
    select ticket.ticket_type_id
    from public.tickets as ticket
    where ticket.ticket_order_id = p_ticket_order_id
  )
  order by ticket_type.id
  for update of ticket_type;

  select
    payment.id,
    payment.user_id,
    payment.purpose,
    payment.ref_id,
    payment.amount,
    payment.status,
    payment.payment_key,
    payment.idempotency_key
  into
    v_payment_id,
    v_payment_user_id,
    v_payment_purpose,
    v_payment_ref_id,
    v_payment_amount,
    v_payment_status,
    v_payment_key,
    v_idempotency_key
  from public.payments as payment
  where payment.payment_key = p_provider_payment_key;

  if not found
    or v_payment_purpose is distinct from 'ticket'
    or v_payment_ref_id is distinct from p_ticket_order_id
    or v_payment_user_id is distinct from v_order_user_id
    or v_payment_amount is distinct from v_order_total
    or v_payment_key is distinct from p_provider_payment_key
    or v_idempotency_key is distinct from p_provider_payment_key
  then
    raise check_violation using message = 'payment evidence mismatch';
  end if;

  if p_provider_raw is not null then
    update public.payments
    set raw = p_provider_raw
    where id = v_payment_id;
  end if;

  if p_refund_confirmed or v_payment_status in ('paid', 'refunded') then
    insert into public.refunds (
      payment_id,
      amount,
      reason,
      status,
      ticket_cancellation_request_id
    )
    values (
      v_payment_id,
      v_payment_amount,
      p_reason,
      'done',
      v_request_id
    )
    on conflict (payment_id) do update
    set
      amount = excluded.amount,
      reason = coalesce(public.refunds.reason, excluded.reason),
      status = 'done',
      ticket_cancellation_request_id = coalesce(
        public.refunds.ticket_cancellation_request_id,
        excluded.ticket_cancellation_request_id
      );

    update public.payments
    set status = 'refunded'
    where id = v_payment_id;
  elsif v_payment_status in ('pending', 'failed') then
    update public.payments
    set status = 'canceled'
    where id = v_payment_id;
  end if;

  if exists (
    select 1
    from public.tickets as ticket
    where ticket.ticket_order_id = p_ticket_order_id
      and ticket.status = 'used'
  ) and v_request_status <> 'completed' then
    update public.ticket_cancellation_requests
    set
      status = 'needs_review',
      attempt_token = null,
      last_error_code = 'used_ticket_after_provider_cancellation'
    where id = v_request_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      null,
      'ticket.cancellation.needs_review',
      'ticket_order:' || p_ticket_order_id::text,
      jsonb_build_object(
        'requestId', v_request_id,
        'source', 'provider',
        'to', 'needs_review',
        'errorCode', 'used_ticket_after_provider_cancellation'
      )
    );
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    null,
    'ticket.cancellation.provider_evidence_recorded',
    'ticket_order:' || p_ticket_order_id::text,
    jsonb_build_object(
      'requestId', v_request_id,
      'paymentCount', 1,
      'paymentState', v_payment_status::text
    )
  );
end;
$$;

revoke all on function public.record_ticket_provider_cancellation_evidence(uuid, text, text, jsonb, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.record_ticket_provider_cancellation_evidence(uuid, text, text, jsonb, boolean)
  to service_role;

create function public.complete_ticket_cancellation_request(
  p_request_id uuid,
  p_attempt_token uuid,
  p_provider_payment_keys text[]
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_order_user_id uuid;
  v_reason text;
  v_status text;
  v_current_attempt_token uuid;
  v_provider_payment_keys text[];
  v_key text;
begin
  select request.ticket_order_id, request.requested_by, request.reason
  into v_order_id, v_order_user_id, v_reason
  from public.ticket_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null then
    raise no_data_found using message = 'ticket cancellation request not found';
  end if;

  perform ticket_order.id
  from public.ticket_orders as ticket_order
  where ticket_order.id = v_order_id
  for update of ticket_order;

  select request.status, request.attempt_token
  into v_status, v_current_attempt_token
  from public.ticket_cancellation_requests as request
  where request.id = p_request_id
  for update of request;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'ticket'
    and payment.ref_id = v_order_id
  order by payment.id
  for update of payment;

  perform ticket.id
  from public.tickets as ticket
  where ticket.ticket_order_id = v_order_id
  order by ticket.id
  for update of ticket;

  perform ticket_type.id
  from public.ticket_types as ticket_type
  where ticket_type.id in (
    select ticket.ticket_type_id
    from public.tickets as ticket
    where ticket.ticket_order_id = v_order_id
  )
  order by ticket_type.id
  for update of ticket_type;

  if v_status = 'completed' then
    return;
  end if;

  if v_status <> 'processing' then
    raise check_violation using message = 'ticket cancellation not processing';
  end if;

  if p_attempt_token is null or v_current_attempt_token is distinct from p_attempt_token then
    raise check_violation using message = 'ticket cancellation attempt mismatch';
  end if;

  select coalesce(array_agg(keys.payment_key order by keys.payment_key), array[]::text[])
  into v_provider_payment_keys
  from (
    select distinct btrim(input.payment_key) as payment_key
    from unnest(coalesce(p_provider_payment_keys, array[]::text[])) as input(payment_key)
    where input.payment_key is not null
      and btrim(input.payment_key) <> ''
  ) as keys;

  if exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'ticket'
      and payment.ref_id = v_order_id
      and payment.status <> 'failed'
      and (
        payment.payment_key is null
        or not (payment.payment_key = any(v_provider_payment_keys))
      )
  ) or exists (
    select 1
    from unnest(v_provider_payment_keys) as input(payment_key)
    where not exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'ticket'
        and payment.ref_id = v_order_id
        and payment.user_id = v_order_user_id
        and payment.payment_key = input.payment_key
        and payment.idempotency_key = input.payment_key
    )
  ) then
    raise check_violation using message = 'provider cancellation required';
  end if;

  foreach v_key in array v_provider_payment_keys
  loop
    perform public.record_ticket_provider_cancellation_evidence(
      v_order_id,
      v_reason,
      v_key
    );
  end loop;

  perform public.finalize_ticket_cancellation_request(p_request_id, v_order_user_id);
end;
$$;

revoke all on function public.complete_ticket_cancellation_request(uuid, uuid, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.complete_ticket_cancellation_request(uuid, uuid, text[])
  to service_role;

-- 기존 3인자 webhook 호출 계약은 default 인자로 유지한다. 정확한 key의 provider
-- 증거를 먼저 기록한 뒤
-- 다른 live 결제가 없으면 같은 durable request의 allocation을 원자적으로 닫는다.
drop function public.refund_ticket_order_with_provider_evidence(uuid, text, text);

create function public.refund_ticket_order_with_provider_evidence(
  p_ticket_order_id uuid,
  p_reason text,
  p_provider_payment_key text,
  p_provider_raw jsonb default null,
  p_refund_confirmed boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_request_id uuid;
  v_actor_id uuid;
begin
  perform public.record_ticket_provider_cancellation_evidence(
    p_ticket_order_id,
    p_reason,
    p_provider_payment_key,
    p_provider_raw,
    p_refund_confirmed
  );

  select request.id, request.requested_by
  into v_request_id, v_actor_id
  from public.ticket_cancellation_requests as request
  where request.ticket_order_id = p_ticket_order_id
  order by
    case when request.status in ('requested', 'processing', 'needs_review') then 0 else 1 end,
    request.requested_at desc,
    request.id
  limit 1;

  if v_request_id is not null then
    perform public.finalize_ticket_cancellation_request(v_request_id, v_actor_id);
  end if;
end;
$$;

revoke all on function public.refund_ticket_order_with_provider_evidence(uuid, text, text, jsonb, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_ticket_order_with_provider_evidence(uuid, text, text, jsonb, boolean)
  to service_role;

-- provider 승인 API를 호출하기 전에 pending payment placeholder를 먼저 선점한다.
-- 사용자 취소와 같은 order → request → payment 순서로 잠가 둘 중 하나만 먼저
-- 외부 부작용을 시작할 수 있게 한다.
create function public.begin_ticket_payment_approval(
  p_user_id uuid,
  p_ticket_order_id uuid,
  p_payment_key text,
  p_amount bigint
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_user_id uuid;
  v_order_total bigint;
  v_order_status public.ticket_order_status;
  v_expires_at timestamptz;
  v_matching_payment_count integer;
  v_existing_payment public.payments%rowtype;
  v_has_existing_payment boolean := false;
begin
  if p_payment_key is null
    or nullif(btrim(p_payment_key), '') is null
    or btrim(p_payment_key) <> p_payment_key
    or length(p_payment_key) > 200
    or p_amount is null
    or p_amount <= 0
  then
    raise check_violation using message = 'invalid payment approval evidence';
  end if;

  select
    ticket_order.user_id,
    ticket_order.total,
    ticket_order.status,
    ticket_order.expires_at
  into
    v_order_user_id,
    v_order_total,
    v_order_status,
    v_expires_at
  from public.ticket_orders as ticket_order
  where ticket_order.id = p_ticket_order_id
  for update of ticket_order;

  if not found or p_user_id is null or v_order_user_id is distinct from p_user_id then
    raise no_data_found using message = 'ticket order not found';
  end if;

  perform request.id
  from public.ticket_cancellation_requests as request
  where request.ticket_order_id = p_ticket_order_id
    and request.status in ('requested', 'processing', 'needs_review')
  order by request.requested_at desc, request.id
  for update of request;

  if found then
    raise check_violation using message = 'ticket cancellation in progress';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ticket_payment:' || p_payment_key, 0)
  );

  perform payment.id
  from public.payments as payment
  where (
      payment.purpose = 'ticket'
      and payment.ref_id = p_ticket_order_id
    )
    or payment.idempotency_key = p_payment_key
    or payment.payment_key = p_payment_key
  order by payment.id
  for update of payment;

  select count(*)::integer
  into v_matching_payment_count
  from public.payments as payment
  where payment.idempotency_key = p_payment_key
     or payment.payment_key = p_payment_key;

  if v_matching_payment_count > 1 then
    raise unique_violation using message = 'payment approval conflict';
  end if;

  select payment.*
  into v_existing_payment
  from public.payments as payment
  where payment.idempotency_key = p_payment_key
     or payment.payment_key = p_payment_key;

  v_has_existing_payment := found;

  if p_amount is distinct from v_order_total then
    raise check_violation using message = 'amount mismatch';
  end if;

  if v_has_existing_payment then
    if v_existing_payment.purpose <> 'ticket'
      or v_existing_payment.ref_id is distinct from p_ticket_order_id
      or v_existing_payment.user_id is distinct from p_user_id
      or v_existing_payment.amount is distinct from p_amount
      or v_existing_payment.idempotency_key is distinct from p_payment_key
      or (
        v_existing_payment.payment_key is not null
        and v_existing_payment.payment_key is distinct from p_payment_key
      )
    then
      raise unique_violation using message = 'payment approval conflict';
    end if;
  end if;

  if exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'ticket'
      and payment.ref_id = p_ticket_order_id
      and payment.status in ('pending', 'paid', 'refunded')
      and payment.id is distinct from v_existing_payment.id
  ) then
    raise unique_violation using message = 'payment approval conflict';
  end if;

  if v_has_existing_payment then
    if v_existing_payment.status = 'paid' then
      if v_order_status <> 'paid' then
        raise unique_violation using message = 'payment approval conflict';
      end if;
      return 'already_confirmed';
    end if;

    if v_existing_payment.status = 'refunded' then
      if v_order_status <> 'canceled' then
        raise unique_violation using message = 'payment approval conflict';
      end if;
      return 'already_confirmed';
    end if;

    if v_existing_payment.status <> 'pending' then
      raise check_violation using message = 'payment not payable';
    end if;
  end if;

  if v_order_status <> 'pending' then
    raise check_violation using message = 'ticket order not payable';
  end if;

  if v_expires_at is not null and now() >= v_expires_at then
    raise check_violation using message = 'ticket order expired';
  end if;

  if v_has_existing_payment then
    update public.payments
    set payment_key = p_payment_key
    where id = v_existing_payment.id;
  else
    insert into public.payments (
      user_id,
      purpose,
      ref_id,
      amount,
      status,
      payment_key,
      idempotency_key,
      raw
    )
    values (
      p_user_id,
      'ticket',
      p_ticket_order_id,
      p_amount,
      'pending',
      p_payment_key,
      p_payment_key,
      null
    );
  end if;

  return 'pending';
end;
$$;

revoke all on function public.begin_ticket_payment_approval(uuid, uuid, text, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.begin_ticket_payment_approval(uuid, uuid, text, bigint)
  to service_role;

-- 결제 확정도 취소와 같은 order → request → payment 순서로 잠근다. active
-- 취소 요청이 먼저면 승인 replay를 포함한 모든 결제 확정을 fail closed한다.
create or replace function public.confirm_ticket_payment(
  p_idempotency_key text,
  p_ticket_order_id uuid,
  p_payment_key text,
  p_amount bigint,
  p_raw jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_total bigint;
  v_order_status public.ticket_order_status;
  v_expires_at timestamptz;
  v_existing_payment public.payments%rowtype;
  v_has_existing_payment boolean := false;
begin
  if p_idempotency_key is null
    or nullif(btrim(p_idempotency_key), '') is null
    or length(p_idempotency_key) > 200
    or p_payment_key is null
    or nullif(btrim(p_payment_key), '') is null
    or length(p_payment_key) > 200
  then
    raise check_violation using message = 'invalid payment evidence';
  end if;

  if p_idempotency_key is distinct from p_payment_key then
    raise unique_violation using message = 'idempotency conflict';
  end if;

  select
    ticket_order.user_id,
    ticket_order.total,
    ticket_order.status,
    ticket_order.expires_at
  into
    v_user,
    v_total,
    v_order_status,
    v_expires_at
  from public.ticket_orders as ticket_order
  where ticket_order.id = p_ticket_order_id
  for update of ticket_order;

  if not found then
    raise no_data_found using message = 'ticket order not found';
  end if;

  perform request.id
  from public.ticket_cancellation_requests as request
  where request.ticket_order_id = p_ticket_order_id
    and request.status in ('requested', 'processing', 'needs_review')
  order by request.requested_at desc, request.id
  for update of request;

  if found then
    raise check_violation using message = 'ticket cancellation in progress';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ticket_payment:' || p_idempotency_key, 0)
  );

  select payment.*
  into v_existing_payment
  from public.payments as payment
  where payment.idempotency_key = p_idempotency_key
  for update of payment;

  v_has_existing_payment := found;

  if v_has_existing_payment then
    if v_existing_payment.purpose <> 'ticket'
      or v_existing_payment.ref_id is distinct from p_ticket_order_id
      or v_existing_payment.user_id is distinct from v_user
      or v_existing_payment.amount is distinct from p_amount
      or v_existing_payment.payment_key is distinct from p_payment_key
    then
      raise unique_violation using message = 'idempotency conflict';
    end if;

    if v_existing_payment.status in ('paid', 'refunded') then
      return;
    end if;

    if v_existing_payment.status <> 'pending' then
      raise check_violation using message = 'payment not payable';
    end if;
  end if;

  if v_order_status <> 'pending' then
    raise check_violation using message = 'ticket order not payable';
  end if;

  if v_expires_at is not null and now() >= v_expires_at then
    raise check_violation using message = 'ticket order expired';
  end if;

  if p_amount is distinct from v_total then
    raise check_violation using message = 'amount mismatch';
  end if;

  if v_has_existing_payment then
    update public.payments
    set
      status = 'paid',
      raw = p_raw
    where id = v_existing_payment.id;
  else
    insert into public.payments (
      user_id,
      purpose,
      ref_id,
      amount,
      status,
      payment_key,
      idempotency_key,
      raw
    )
    values (
      v_user,
      'ticket',
      p_ticket_order_id,
      p_amount,
      'paid',
      p_payment_key,
      p_idempotency_key,
      p_raw
    );
  end if;

  update public.ticket_orders
  set
    status = 'paid',
    expires_at = null
  where id = p_ticket_order_id;

  update public.tickets
  set qr_token = encode(extensions.gen_random_bytes(16), 'hex')
  where ticket_order_id = p_ticket_order_id
    and qr_token is null;
end;
$$;

revoke all on function public.confirm_ticket_payment(text, uuid, text, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_ticket_payment(text, uuid, text, bigint, jsonb)
  to service_role;

-- 검표는 QR로 order를 찾는 비잠금 lookup 뒤 order → request → ticket 순서로
-- 직렬화한다. 어느 쪽이 먼저 잠겨도 사용과 환불이 동시에 성공할 수 없다.
create or replace function public.check_in_ticket(p_qr_token text)
returns public.ticket_status
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_ticket_id uuid;
  v_status public.ticket_status;
begin
  if not public.is_staff() then
    raise insufficient_privilege using message = 'forbidden';
  end if;

  select ticket.ticket_order_id
  into v_order_id
  from public.tickets as ticket
  where ticket.qr_token = p_qr_token;

  if not found then
    raise no_data_found using message = 'invalid ticket';
  end if;

  perform ticket_order.id
  from public.ticket_orders as ticket_order
  where ticket_order.id = v_order_id
  for update of ticket_order;

  perform request.id
  from public.ticket_cancellation_requests as request
  where request.ticket_order_id = v_order_id
    and request.status in ('requested', 'processing', 'needs_review')
  order by request.requested_at desc, request.id
  for update of request;

  if found then
    raise check_violation using message = 'ticket cancellation in progress';
  end if;

  select ticket.id, ticket.status
  into v_ticket_id, v_status
  from public.tickets as ticket
  where ticket.qr_token = p_qr_token
    and ticket.ticket_order_id = v_order_id
  for update of ticket;

  if not found then
    raise no_data_found using message = 'invalid ticket';
  end if;

  if v_status <> 'valid' then
    return v_status;
  end if;

  update public.tickets
  set status = 'used'
  where id = v_ticket_id;

  insert into public.check_ins (ticket_id, by_staff)
  values (v_ticket_id, (select auth.uid()))
  on conflict (ticket_id) do nothing;

  return 'used'::public.ticket_status;
end;
$$;

revoke all on function public.check_in_ticket(text)
  from public, anon, authenticated, service_role;
grant execute on function public.check_in_ticket(text)
  to authenticated;

-- active 취소 요청은 만료 sweep과 경쟁하지 않는다. needs_review까지 운영 원장을
-- 보존하고 reconcile 경로만 allocation을 닫을 수 있다.
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
      and not exists (
        select 1
        from public.ticket_cancellation_requests as request
        where request.ticket_order_id = ticket_orders.id
          and request.status in ('requested', 'processing', 'needs_review')
      )
    order by ticket_orders.expires_at
    limit 200
    for update of ticket_orders skip locked
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
