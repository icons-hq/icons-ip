\set ON_ERROR_STOP on

begin;

select 1 / case when (
  has_function_privilege('service_role', 'public.prepare_ticket_payment_attempt(uuid,uuid,public.payment_provider)', 'execute')
  and has_function_privilege('service_role', 'public.bind_ticket_payment_callback_nonce(uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.claim_ticket_payment_attempt(public.payment_provider,text,text,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.finalize_ticket_payment_attempt(uuid,uuid,public.payment_attempt_state,text,text,text,text,text,text,timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.claim_ticket_payment_reconciliation(uuid,uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.finalize_ticket_payment_reconciliation(uuid,uuid,public.payment_attempt_state,text,text,text,text,text,text,timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.claim_ticket_payment_refund(uuid,uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.finalize_ticket_payment_refund(uuid,uuid,uuid,public.payment_attempt_state,bigint,text,text,text,text,text,text,timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.claim_ticket_refund_reconciliation(uuid,uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.finalize_ticket_refund_reconciliation(uuid,uuid,uuid,public.payment_attempt_state,bigint,text,text,text,text,text,text,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.prepare_ticket_payment_attempt(uuid,uuid,public.payment_provider)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_ticket_payment_attempt(public.payment_provider,text,text,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_ticket_payment_reconciliation(uuid,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.finalize_ticket_payment_refund(uuid,uuid,uuid,public.payment_attempt_state,bigint,text,text,text,text,text,text,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_ticket_refund_reconciliation(uuid,uuid,text)', 'execute')
) then 1 else 0 end as assert_ticket_payment_rpcs_are_service_only;

select 1 / case when (
  not has_function_privilege('service_role', 'private.ticket_payment_attempt_json(public.payment_attempts)', 'execute')
  and not has_function_privilege('service_role', 'private.ticket_order_snapshot_matches(uuid,text,bigint)', 'execute')
  and not has_function_privilege('service_role', 'public.begin_ticket_payment_approval(uuid,uuid,text,bigint)', 'execute')
  and has_function_privilege('service_role', 'public.confirm_ticket_payment(text,uuid,text,bigint,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.confirm_ticket_payment(text,uuid,text,bigint,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.confirm_ticket_payment(text,uuid,text,bigint,jsonb)', 'execute')
) then 1 else 0 end as assert_private_helpers_and_new_toss_begin_are_closed;

select 1 / case when (
  not has_table_privilege(
    'service_role', 'private.ticket_payment_reconciliation_audits', 'select'
  )
  and not has_function_privilege(
    'service_role',
    'private.record_ticket_reconciliation_audit(uuid,text,uuid,text,text,text,public.payment_attempt_state)',
    'execute'
  )
) then 1 else 0 end as assert_ticket_reconciliation_audit_is_not_an_application_surface;

select 1 / case when not exists (
  select 1
  from pg_catalog.pg_proc as procedure
  where procedure.oid in (
    'public.finalize_ticket_payment_attempt(uuid,uuid,public.payment_attempt_state,text,text,text,text,text,text,timestamptz)'::regprocedure,
    'public.finalize_ticket_payment_reconciliation(uuid,uuid,public.payment_attempt_state,text,text,text,text,text,text,timestamptz)'::regprocedure,
    'public.finalize_ticket_payment_refund(uuid,uuid,uuid,public.payment_attempt_state,bigint,text,text,text,text,text,text,timestamptz)'::regprocedure,
    'public.finalize_ticket_refund_reconciliation(uuid,uuid,uuid,public.payment_attempt_state,bigint,text,text,text,text,text,text,timestamptz)'::regprocedure
  )
    and exists (
      select 1
      from pg_catalog.unnest(procedure.proargnames) as argument(name)
      where argument.name ilike any(array['%raw%', '%payload%', '%response%'])
    )
) then 1 else 0 end as assert_ticket_finalizers_have_no_raw_payload_parameter;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000002061',
    'authenticated', 'authenticated', 'ticket-payment-owner@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000002062',
    'authenticated', 'authenticated', 'ticket-payment-other@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at)
values
  (
    '00000000-0000-4000-8000-000000002061',
    'ticket-payment-owner@example.test', 'ticket_payment_owner', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now()
  ),
  (
    '00000000-0000-4000-8000-000000002062',
    'ticket-payment-other@example.test', 'ticket_payment_other', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now()
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  suspended_at = null,
  suspension_reason = null;

insert into public.events (id, title, mode, status, starts_at)
values (
  'ticket-payment-seam-event',
  '티켓 결제 seam 테스트',
  '오프라인',
  '예매중',
  now() + interval '30 days'
)
on conflict (id) do update set
  title = excluded.title,
  mode = excluded.mode,
  status = excluded.status,
  starts_at = excluded.starts_at;

insert into public.ticket_types (
  id, event_id, name, price, capacity, sold, per_user_limit, sales_open_at
)
values
  ('10000000-0000-4000-8000-000000002061', 'ticket-payment-seam-event', '승인·환급 회차', 12000, 10, 0, 4, null),
  ('10000000-0000-4000-8000-000000002062', 'ticket-payment-seam-event', '모호 결제 회차', 13000, 10, 0, 4, null),
  ('10000000-0000-4000-8000-000000002063', 'ticket-payment-seam-event', '거절 회차', 14000, 10, 0, 4, null),
  ('10000000-0000-4000-8000-000000002064', 'ticket-payment-seam-event', '증거 누락 회차', 15000, 10, 0, 4, null),
  ('10000000-0000-4000-8000-000000002065', 'ticket-payment-seam-event', 'legacy Toss 회차', 16000, 10, 0, 4, null),
  ('10000000-0000-4000-8000-000000002066', 'ticket-payment-seam-event', 'unknown Toss 회차', 17000, 10, 0, 4, null),
  ('10000000-0000-4000-8000-000000002067', 'ticket-payment-seam-event', 'stale claim 회차', 18000, 10, 0, 4, null),
  ('10000000-0000-4000-8000-000000002068', 'ticket-payment-seam-event', 'payment ledger guard 회차', 19000, 10, 0, 4, null),
  ('10000000-0000-4000-8000-000000002069', 'ticket-payment-seam-event', '승인 후 환급 회차', 20000, 10, 0, 4, null),
  ('10000000-0000-4000-8000-000000002072', 'ticket-payment-seam-event', '만료 상태행렬 회차', 21000, 20, 0, 20, null)
on conflict (id) do update set
  event_id = excluded.event_id,
  name = excluded.name,
  price = excluded.price,
  capacity = excluded.capacity,
  sold = excluded.sold,
  per_user_limit = excluded.per_user_limit,
  sales_open_at = excluded.sales_open_at;

select public.reserve_tickets(
  '00000000-0000-4000-8000-000000002061',
  '10000000-0000-4000-8000-000000002061',
  2,
  '20000000-0000-4000-8000-000000002061'
) as approved_order_id \gset

select 1 / case when (
  select reservation.quantity = 2
    and reservation.unit_price = 12000
    and ticket_order.total = 24000
    and ticket_type.sold = 2
  from public.ticket_order_reservations as reservation
  join public.ticket_orders as ticket_order on ticket_order.id = reservation.ticket_order_id
  join public.ticket_types as ticket_type on ticket_type.id = reservation.ticket_type_id
  where reservation.ticket_order_id = :'approved_order_id'::uuid
) and not exists (
  select 1 from public.tickets where ticket_order_id = :'approved_order_id'::uuid
) then 1 else 0 end as assert_capacity_reserves_without_ticket_or_qr;

do $ticket_prepare_contract$
declare
  first_prepare jsonb;
  replay_prepare jsonb;
  v_order_id uuid;
  owner_rejected boolean := false;
  toss_rejected boolean := false;
begin
  select id into strict v_order_id
  from public.ticket_orders
  where reservation_key = '20000000-0000-4000-8000-000000002061';

  first_prepare := public.prepare_ticket_payment_attempt(
    '00000000-0000-4000-8000-000000002061',
    v_order_id,
    'korpay'
  );
  replay_prepare := public.prepare_ticket_payment_attempt(
    '00000000-0000-4000-8000-000000002061',
    v_order_id,
    'korpay'
  );

  if first_prepare ->> 'id' is distinct from replay_prepare ->> 'id'
    or first_prepare ->> 'purpose' is distinct from 'ticket'
    or first_prepare ->> 'provider' is distinct from 'korpay'
    or (first_prepare ->> 'amount')::bigint <> 24000
    or first_prepare ->> 'provider_order_id' !~ '^T[0-9a-f]{32}$'
    or first_prepare ->> 'provider_product_code' !~ '^P[0-9a-f]{32}$'
  then
    raise exception 'prepared ticket payment contract mismatch';
  end if;

  begin
    perform public.prepare_ticket_payment_attempt(
      '00000000-0000-4000-8000-000000002062',
      v_order_id,
      'korpay'
    );
  exception when no_data_found then
    owner_rejected := true;
  end;

  begin
    perform public.prepare_ticket_payment_attempt(
      '00000000-0000-4000-8000-000000002061',
      v_order_id,
      'toss'
    );
  exception when object_not_in_prerequisite_state then
    toss_rejected := true;
  end;

  if not owner_rejected or not toss_rejected then
    raise exception 'ticket prepare validation did not fail closed';
  end if;
end;
$ticket_prepare_contract$;

select id as approved_attempt_id, provider_order_id as approved_provider_order_id
from public.payment_attempts
where purpose = 'ticket' and ref_id = :'approved_order_id'::uuid
\gset

select public.bind_ticket_payment_callback_nonce(:'approved_attempt_id', repeat('a', 64));
select public.bind_ticket_payment_callback_nonce(:'approved_attempt_id', repeat('a', 64));

do $ticket_claim_and_approval$
declare
  first_claim jsonb;
  duplicate_claim jsonb;
  terminal_claim jsonb;
  selected_attempt public.payment_attempts%rowtype;
begin
  select attempt.* into strict selected_attempt
  from public.payment_attempts as attempt
  join public.ticket_orders as ticket_order on ticket_order.id = attempt.ref_id
  where ticket_order.reservation_key = '20000000-0000-4000-8000-000000002061';

  first_claim := public.claim_ticket_payment_attempt(
    'korpay', selected_attempt.provider_order_id, repeat('a', 64),
    '40000000-0000-4000-8000-000000002061'
  );
  duplicate_claim := public.claim_ticket_payment_attempt(
    'korpay', selected_attempt.provider_order_id, repeat('a', 64),
    '40000000-0000-4000-8000-000000002069'
  );
  if first_claim ->> 'claim_status' <> 'claimed'
    or duplicate_claim ->> 'claim_status' <> 'in_progress'
  then
    raise exception 'ticket callback claim was not idempotent';
  end if;

  update public.ticket_orders
  set expires_at = now() - interval '10 minutes'
  where id = selected_attempt.ref_id;
  perform public.expire_stale_checkouts();

  if public.finalize_ticket_payment_attempt(
    selected_attempt.id,
    '40000000-0000-4000-8000-000000002061',
    'approved',
    null,
    'ticket-transaction-2061',
    'ticket-approval-2061',
    '0000',
    'CARD',
    '1234-****-****-5678',
    now()
  ) <> 'approved' then
    raise exception 'claimed approval after expiry must finalize';
  end if;

  terminal_claim := public.claim_ticket_payment_attempt(
    'korpay', selected_attempt.provider_order_id, repeat('a', 64),
    '40000000-0000-4000-8000-000000002068'
  );
  if terminal_claim ->> 'claim_status' <> 'terminal'
    or terminal_claim ->> 'outcome' <> 'approved'
  then
    raise exception 'terminal callback did not replay';
  end if;
end;
$ticket_claim_and_approval$;

select 1 / case when (
  select ticket_order.status = 'paid'
    and ticket_order.expires_at is null
    and attempt.state = 'approved'
    and payment.provider = 'korpay'
    and payment.status = 'paid'
    and payment.raw is null
  from public.ticket_orders as ticket_order
  join public.payment_attempts as attempt on attempt.ref_id = ticket_order.id
  join public.payments as payment on payment.id = attempt.payment_id
  where ticket_order.id = :'approved_order_id'::uuid
) and (
  select count(*) = 2
    and count(qr_token) = 2
    and count(distinct qr_token) = 2
    and bool_and(status = 'valid')
  from public.tickets
  where ticket_order_id = :'approved_order_id'::uuid
) then 1 else 0 end as assert_approved_finalization_issues_exact_qr_tickets;

-- A provider may approve after the callback claim but before the database
-- finalizer commits. The callback lease must block an eager retry, then an
-- explicit reconciliation may reclaim the stale lease and converge exactly
-- once without calling confirm again.
select public.reserve_tickets(
  '00000000-0000-4000-8000-000000002061',
  '10000000-0000-4000-8000-000000002067',
  1,
  '20000000-0000-4000-8000-000000002067'
) as stale_order_id \gset
select public.prepare_ticket_payment_attempt(
  '00000000-0000-4000-8000-000000002061', :'stale_order_id', 'korpay'
);
select id as stale_attempt_id, provider_order_id as stale_provider_order_id
from public.payment_attempts where ref_id = :'stale_order_id'::uuid \gset
select public.bind_ticket_payment_callback_nonce(:'stale_attempt_id', repeat('7', 64));
select public.claim_ticket_payment_attempt(
  'korpay', :'stale_provider_order_id', repeat('7', 64),
  '40000000-0000-4000-8000-000000002067'
);

do $ticket_stale_claim_reconciliation$
declare
  active_claim jsonb;
  reclaimed_claim jsonb;
  terminal_claim jsonb;
begin
  active_claim := public.claim_ticket_payment_reconciliation(
    :'stale_attempt_id',
    '41000000-0000-4000-8000-000000002067',
    'case_stale_payment_2067'
  );
  if active_claim ->> 'claim_status' <> 'in_progress' then
    raise exception 'active ticket callback lease must not be reclaimed';
  end if;

  -- Test-only crash simulation: the provider call succeeded but the process
  -- died before finalize. Only the explicit reconciliation path may recover.
  update public.payment_attempts
  set claim_expires_at = now() - interval '1 second'
  where id = :'stale_attempt_id'::uuid;

  reclaimed_claim := public.claim_ticket_payment_reconciliation(
    :'stale_attempt_id',
    '41000000-0000-4000-8000-000000002067',
    'case_stale_payment_2067'
  );
  if reclaimed_claim ->> 'claim_status' <> 'claimed' then
    raise exception 'stale ticket callback lease was not reclaimed';
  end if;

  if public.finalize_ticket_payment_reconciliation(
    :'stale_attempt_id',
    '41000000-0000-4000-8000-000000002067',
    'approved',
    null,
    'ticket-transaction-2067',
    'ticket-approval-2067',
    '0000',
    'CARD',
    '5678-****-****-2067',
    now()
  ) <> 'approved' then
    raise exception 'stale ticket payment reconciliation did not approve';
  end if;

  terminal_claim := public.claim_ticket_payment_reconciliation(
    :'stale_attempt_id',
    '41000000-0000-4000-8000-000000002068',
    'case_stale_payment_replay_2067'
  );
  if terminal_claim ->> 'claim_status' <> 'terminal'
    or terminal_claim ->> 'outcome' <> 'approved'
  then
    raise exception 'ticket payment reconciliation terminal replay failed';
  end if;
end;
$ticket_stale_claim_reconciliation$;

select 1 / case when (
  select ticket_order.status = 'paid'
    and attempt.state = 'approved'
    and payment.status = 'paid'
    and ticket_type.sold = 1
  from public.ticket_orders as ticket_order
  join public.payment_attempts as attempt on attempt.ref_id = ticket_order.id
  join public.payments as payment on payment.id = attempt.payment_id
  join public.ticket_order_reservations as reservation
    on reservation.ticket_order_id = ticket_order.id
  join public.ticket_types as ticket_type on ticket_type.id = reservation.ticket_type_id
  where ticket_order.id = :'stale_order_id'::uuid
) and (
  select count(*) = 1 and count(qr_token) = 1
  from public.tickets
  where ticket_order_id = :'stale_order_id'::uuid
) and (
  select count(*) = 1
  from public.payments
  where purpose = 'ticket' and ref_id = :'stale_order_id'::uuid
) and exists (
  select 1
  from private.ticket_payment_reconciliation_audits as audit
  where audit.claim_token = '41000000-0000-4000-8000-000000002067'::uuid
    and audit.operation = 'payment'
    and audit.target_id = :'stale_attempt_id'::uuid
    and audit.actor_ref = 'payment_reconciliation_service_v1'
    and audit.case_ref = 'case_stale_payment_2067'
    and audit.claim_status = 'terminal'
    and audit.outcome = 'approved'
    and audit.finalized_at is not null
) then 1 else 0 end as assert_stale_claim_reconciliation_converges_once;

select public.reserve_tickets(
  '00000000-0000-4000-8000-000000002061',
  '10000000-0000-4000-8000-000000002062',
  1,
  '20000000-0000-4000-8000-000000002062'
) as unknown_order_id \gset
select public.prepare_ticket_payment_attempt(
  '00000000-0000-4000-8000-000000002061', :'unknown_order_id', 'korpay'
);
select id as unknown_attempt_id, provider_order_id as unknown_provider_order_id
from public.payment_attempts where ref_id = :'unknown_order_id'::uuid \gset
select public.bind_ticket_payment_callback_nonce(:'unknown_attempt_id', repeat('b', 64));
select public.claim_ticket_payment_attempt(
  'korpay', :'unknown_provider_order_id', repeat('b', 64),
  '40000000-0000-4000-8000-000000002062'
);
select public.finalize_ticket_payment_attempt(
  :'unknown_attempt_id',
  '40000000-0000-4000-8000-000000002062',
  'unknown'
);
update public.ticket_orders set expires_at = now() - interval '10 minutes'
where id = :'unknown_order_id'::uuid;
select public.expire_stale_checkouts();

select 1 / case when (
  select ticket_order.status = 'pending'
    and attempt.state = 'unknown'
    and ticket_type.sold = 1
  from public.ticket_orders as ticket_order
  join public.payment_attempts as attempt on attempt.ref_id = ticket_order.id
  join public.ticket_order_reservations as reservation on reservation.ticket_order_id = ticket_order.id
  join public.ticket_types as ticket_type on ticket_type.id = reservation.ticket_type_id
  where ticket_order.id = :'unknown_order_id'::uuid
) and not exists (
  select 1 from public.tickets where ticket_order_id = :'unknown_order_id'::uuid
) then 1 else 0 end as assert_unknown_preserves_capacity_without_qr;

select public.reserve_tickets(
  '00000000-0000-4000-8000-000000002061',
  '10000000-0000-4000-8000-000000002069',
  1,
  '20000000-0000-4000-8000-000000002071'
) as held_approval_order_id \gset
select public.prepare_ticket_payment_attempt(
  '00000000-0000-4000-8000-000000002061', :'held_approval_order_id', 'korpay'
);
select id as held_approval_attempt_id, provider_order_id as held_approval_provider_order_id
from public.payment_attempts where ref_id = :'held_approval_order_id'::uuid \gset
select public.bind_ticket_payment_callback_nonce(:'held_approval_attempt_id', repeat('e', 64));
select public.claim_ticket_payment_attempt(
  'korpay', :'held_approval_provider_order_id', repeat('e', 64),
  '45000000-0000-4000-8000-000000002071'
);
select public.finalize_ticket_payment_attempt(
  :'held_approval_attempt_id',
  '45000000-0000-4000-8000-000000002071',
  'unknown'
);
select request_id as held_approval_request_id, result as held_approval_request_result
from public.request_ticket_cancellation(
  '00000000-0000-4000-8000-000000002061', :'held_approval_order_id'
) \gset

select 1 / case when :'held_approval_request_result' = 'requested'
  then 1 else 0 end as assert_unknown_payment_cancel_is_durable;

select public.claim_ticket_payment_reconciliation(
  :'held_approval_attempt_id',
  '45000000-0000-4000-8000-000000002072',
  'case_held_approval_2071'
);
select public.finalize_ticket_payment_reconciliation(
  :'held_approval_attempt_id',
  '45000000-0000-4000-8000-000000002072',
  'approved',
  null,
  'ticket-held-approval-2071',
  'ticket-held-approval-ref-2071',
  '0000',
  'CARD',
  '2071-****-****-0000',
  now()
);

select 1 / case when (
  select ticket_order.status = 'pending'
    and attempt.state = 'approved'
    and payment.status = 'paid'
    and request.status = 'needs_review'
    and request.last_error_code = 'approved_requires_refund'
    and ticket_type.sold = 1
  from public.ticket_orders as ticket_order
  join public.payment_attempts as attempt on attempt.ref_id = ticket_order.id
  join public.payments as payment on payment.id = attempt.payment_id
  join public.ticket_cancellation_requests as request
    on request.ticket_order_id = ticket_order.id
  join public.ticket_order_reservations as reservation
    on reservation.ticket_order_id = ticket_order.id
  join public.ticket_types as ticket_type on ticket_type.id = reservation.ticket_type_id
  where ticket_order.id = :'held_approval_order_id'::uuid
) and not exists (
  select 1 from public.tickets where ticket_order_id = :'held_approval_order_id'::uuid
) then 1 else 0 end as assert_approved_cancel_request_records_payment_without_qr;

select public.claim_ticket_refund_reconciliation(
  :'held_approval_request_id',
  '45000000-0000-4000-8000-000000002073',
  'case_held_refund_2071'
);
select public.finalize_ticket_refund_reconciliation(
  :'held_approval_request_id',
  :'held_approval_attempt_id',
  '45000000-0000-4000-8000-000000002073',
  'approved',
  20000,
  null,
  'ticket-held-refund-2071',
  'ticket-held-refund-ref-2071',
  '0000',
  'CARD',
  '2071-****-****-0000',
  now()
);

select 1 / case when (
  select ticket_order.status = 'canceled'
    and attempt.state = 'approved'
    and payment.status = 'refunded'
    and request.status = 'completed'
    and ticket_type.sold = 0
  from public.ticket_orders as ticket_order
  join public.payment_attempts as attempt on attempt.ref_id = ticket_order.id
  join public.payments as payment on payment.id = attempt.payment_id
  join public.ticket_cancellation_requests as request
    on request.ticket_order_id = ticket_order.id
  join public.ticket_order_reservations as reservation
    on reservation.ticket_order_id = ticket_order.id
  join public.ticket_types as ticket_type on ticket_type.id = reservation.ticket_type_id
  where ticket_order.id = :'held_approval_order_id'::uuid
) and (
  select count(*) = 1 and bool_and(status = 'done')
  from public.refunds
  where ticket_cancellation_request_id = :'held_approval_request_id'::uuid
) and not exists (
  select 1 from public.tickets where ticket_order_id = :'held_approval_order_id'::uuid
) then 1 else 0 end as assert_held_approval_refund_converges_once;

select public.reserve_tickets(
  '00000000-0000-4000-8000-000000002061',
  '10000000-0000-4000-8000-000000002063',
  1,
  '20000000-0000-4000-8000-000000002063'
) as declined_order_id \gset
select public.prepare_ticket_payment_attempt(
  '00000000-0000-4000-8000-000000002061', :'declined_order_id', 'korpay'
);
select id as declined_attempt_id, provider_order_id as declined_provider_order_id
from public.payment_attempts where ref_id = :'declined_order_id'::uuid \gset
select public.bind_ticket_payment_callback_nonce(:'declined_attempt_id', repeat('c', 64));
select public.claim_ticket_payment_attempt(
  'korpay', :'declined_provider_order_id', repeat('c', 64),
  '40000000-0000-4000-8000-000000002063'
);
select public.finalize_ticket_payment_attempt(
  :'declined_attempt_id',
  '40000000-0000-4000-8000-000000002063',
  'declined'
);
select public.finalize_ticket_payment_attempt(
  :'declined_attempt_id',
  '40000000-0000-4000-8000-000000002063',
  'declined'
);

select 1 / case when (
  select ticket_order.status = 'canceled'
    and ticket_type.sold = 0
    and attempt.state = 'declined'
  from public.ticket_orders as ticket_order
  join public.payment_attempts as attempt on attempt.ref_id = ticket_order.id
  join public.ticket_order_reservations as reservation on reservation.ticket_order_id = ticket_order.id
  join public.ticket_types as ticket_type on ticket_type.id = reservation.ticket_type_id
  where ticket_order.id = :'declined_order_id'::uuid
) and not exists (
  select 1 from public.tickets where ticket_order_id = :'declined_order_id'::uuid
) then 1 else 0 end as assert_declined_releases_capacity_exactly_once;

-- A cancellation request can arrive while confirmation is in flight. If
-- reconciliation proves the provider declined/canceled, the same finalizer
-- must close the durable request while restoring capacity exactly once.
select public.reserve_tickets(
  '00000000-0000-4000-8000-000000002061',
  '10000000-0000-4000-8000-000000002063',
  1,
  '20000000-0000-4000-8000-000000002068'
) as reconcile_declined_order_id \gset
select public.prepare_ticket_payment_attempt(
  '00000000-0000-4000-8000-000000002061', :'reconcile_declined_order_id', 'korpay'
);
select id as reconcile_declined_attempt_id, provider_order_id as reconcile_declined_provider_order_id
from public.payment_attempts where ref_id = :'reconcile_declined_order_id'::uuid \gset
select public.bind_ticket_payment_callback_nonce(:'reconcile_declined_attempt_id', repeat('8', 64));
select public.claim_ticket_payment_attempt(
  'korpay', :'reconcile_declined_provider_order_id', repeat('8', 64),
  '42000000-0000-4000-8000-000000002068'
);
select request_id as reconcile_declined_request_id
from public.request_ticket_cancellation(
  '00000000-0000-4000-8000-000000002061', :'reconcile_declined_order_id'
) \gset
update public.payment_attempts
set claim_expires_at = now() - interval '1 second'
where id = :'reconcile_declined_attempt_id'::uuid;
select public.claim_ticket_payment_reconciliation(
  :'reconcile_declined_attempt_id',
  '43000000-0000-4000-8000-000000002068',
  'case_declined_payment_2068'
);
select public.finalize_ticket_payment_reconciliation(
  :'reconcile_declined_attempt_id',
  '43000000-0000-4000-8000-000000002068',
  'declined'
);

select 1 / case when (
  select ticket_order.status = 'canceled'
    and attempt.state = 'declined'
    and request.status = 'completed'
    and ticket_type.sold = 0
  from public.ticket_orders as ticket_order
  join public.payment_attempts as attempt on attempt.ref_id = ticket_order.id
  join public.ticket_cancellation_requests as request
    on request.ticket_order_id = ticket_order.id
  join public.ticket_order_reservations as reservation
    on reservation.ticket_order_id = ticket_order.id
  join public.ticket_types as ticket_type on ticket_type.id = reservation.ticket_type_id
  where ticket_order.id = :'reconcile_declined_order_id'::uuid
) and not exists (
  select 1 from public.tickets
  where ticket_order_id = :'reconcile_declined_order_id'::uuid
) then 1 else 0 end as assert_declined_reconciliation_closes_active_request_once;

select public.reserve_tickets(
  '00000000-0000-4000-8000-000000002061',
  '10000000-0000-4000-8000-000000002064',
  1,
  '20000000-0000-4000-8000-000000002064'
) as evidence_order_id \gset
select public.prepare_ticket_payment_attempt(
  '00000000-0000-4000-8000-000000002061', :'evidence_order_id', 'korpay'
);
select id as evidence_attempt_id, provider_order_id as evidence_provider_order_id
from public.payment_attempts where ref_id = :'evidence_order_id'::uuid \gset
select public.bind_ticket_payment_callback_nonce(:'evidence_attempt_id', repeat('d', 64));
select public.claim_ticket_payment_attempt(
  'korpay', :'evidence_provider_order_id', repeat('d', 64),
  '40000000-0000-4000-8000-000000002064'
);
select public.finalize_ticket_payment_attempt(
  :'evidence_attempt_id',
  '40000000-0000-4000-8000-000000002064',
  'approved'
) as evidence_outcome \gset

select 1 / case when :'evidence_outcome' = 'needs_review' and (
  select status = 'pending' from public.ticket_orders where id = :'evidence_order_id'::uuid
) and not exists (
  select 1 from public.tickets where ticket_order_id = :'evidence_order_id'::uuid
) then 1 else 0 end as assert_approval_without_provider_identifier_needs_review;

-- A corrupt/non-payable row under the attempt idempotency key must never be
-- upgraded into a paid ticket, and a cross-order provider key race must
-- converge to needs_review instead of escaping as a uniqueness error.
select public.reserve_tickets(
  '00000000-0000-4000-8000-000000002061',
  '10000000-0000-4000-8000-000000002068',
  1,
  '20000000-0000-4000-8000-000000002069'
) as ledger_guard_order_id \gset
select public.prepare_ticket_payment_attempt(
  '00000000-0000-4000-8000-000000002061', :'ledger_guard_order_id', 'korpay'
);
select id as ledger_guard_attempt_id, provider_order_id as ledger_guard_provider_order_id
from public.payment_attempts where ref_id = :'ledger_guard_order_id'::uuid \gset
select public.bind_ticket_payment_callback_nonce(:'ledger_guard_attempt_id', repeat('9', 64));
insert into public.payments (
  user_id, purpose, ref_id, provider, amount, status,
  payment_key, idempotency_key, raw
)
values (
  '00000000-0000-4000-8000-000000002061',
  'ticket', :'ledger_guard_order_id', 'korpay', 19000, 'failed',
  'ticket-ledger-guard-failed-2069',
  'attempt:' || :'ledger_guard_attempt_id',
  '{"unexpected":"raw"}'::jsonb
);
select public.claim_ticket_payment_attempt(
  'korpay', :'ledger_guard_provider_order_id', repeat('9', 64),
  '44000000-0000-4000-8000-000000002069'
);
select public.finalize_ticket_payment_attempt(
  :'ledger_guard_attempt_id',
  '44000000-0000-4000-8000-000000002069',
  'approved',
  'ticket-ledger-guard-failed-2069'
) as ledger_guard_outcome \gset

select 1 / case when :'ledger_guard_outcome' = 'needs_review' and (
  select ticket_order.status = 'pending'
    and attempt.state = 'needs_review'
    and payment.status = 'failed'
    and payment.raw is not null
  from public.ticket_orders as ticket_order
  join public.payment_attempts as attempt on attempt.ref_id = ticket_order.id
  join public.payments as payment
    on payment.idempotency_key = 'attempt:' || attempt.id::text
  where ticket_order.id = :'ledger_guard_order_id'::uuid
) and not exists (
  select 1 from public.tickets where ticket_order_id = :'ledger_guard_order_id'::uuid
) then 1 else 0 end as assert_nonpayable_existing_payment_cannot_issue_ticket;

select public.reserve_tickets(
  '00000000-0000-4000-8000-000000002061',
  '10000000-0000-4000-8000-000000002068',
  1,
  '20000000-0000-4000-8000-000000002070'
) as key_race_order_id \gset
select public.prepare_ticket_payment_attempt(
  '00000000-0000-4000-8000-000000002061', :'key_race_order_id', 'korpay'
);
select id as key_race_attempt_id, provider_order_id as key_race_provider_order_id
from public.payment_attempts where ref_id = :'key_race_order_id'::uuid \gset
select public.bind_ticket_payment_callback_nonce(:'key_race_attempt_id', repeat('0', 64));
insert into public.payments (
  user_id, purpose, ref_id, provider, amount, status,
  payment_key, idempotency_key, raw
)
values (
  '00000000-0000-4000-8000-000000002062',
  'ticket', null, 'korpay', 1, 'paid',
  'ticket-provider-key-race-2070',
  'other-ticket-provider-key-race-2070',
  null
);
select public.claim_ticket_payment_attempt(
  'korpay', :'key_race_provider_order_id', repeat('0', 64),
  '44000000-0000-4000-8000-000000002070'
);
select public.finalize_ticket_payment_attempt(
  :'key_race_attempt_id',
  '44000000-0000-4000-8000-000000002070',
  'approved',
  'ticket-provider-key-race-2070'
) as key_race_outcome \gset

select 1 / case when :'key_race_outcome' = 'needs_review' and (
  select ticket_order.status = 'pending' and attempt.state = 'needs_review'
  from public.ticket_orders as ticket_order
  join public.payment_attempts as attempt on attempt.ref_id = ticket_order.id
  where ticket_order.id = :'key_race_order_id'::uuid
) and not exists (
  select 1 from public.tickets where ticket_order_id = :'key_race_order_id'::uuid
) then 1 else 0 end as assert_provider_key_conflict_converges_to_review;

select request_id as refund_request_id, result as refund_request_result
from public.request_ticket_cancellation(
  '00000000-0000-4000-8000-000000002061', :'approved_order_id'
) \gset

do $ticket_refund_contract$
declare
  first_claim jsonb;
  duplicate_claim jsonb;
  reconciliation_claim jsonb;
  reconciliation_duplicate jsonb;
  terminal_claim jsonb;
  selected_attempt public.payment_attempts%rowtype;
  selected_request public.ticket_cancellation_requests%rowtype;
begin
  select attempt.* into strict selected_attempt
  from public.payment_attempts as attempt
  join public.ticket_orders as ticket_order on ticket_order.id = attempt.ref_id
  where ticket_order.reservation_key = '20000000-0000-4000-8000-000000002061';
  select request.* into strict selected_request
  from public.ticket_cancellation_requests as request
  where request.ticket_order_id = selected_attempt.ref_id;

  if selected_request.status <> 'requested' then
    raise exception 'paid ticket cancellation must request provider refund';
  end if;

  first_claim := public.claim_ticket_payment_refund(
    selected_request.id,
    '00000000-0000-4000-8000-000000002061',
    '50000000-0000-4000-8000-000000002061'
  );
  duplicate_claim := public.claim_ticket_payment_refund(
    selected_request.id,
    '00000000-0000-4000-8000-000000002061',
    '50000000-0000-4000-8000-000000002069'
  );
  if first_claim ->> 'claim_status' <> 'claimed'
    or duplicate_claim ->> 'claim_status' <> 'in_progress'
  then
    raise exception 'ticket refund claim was not idempotent';
  end if;

  if public.finalize_ticket_payment_refund(
    selected_request.id,
    selected_attempt.id,
    '50000000-0000-4000-8000-000000002061',
    'needs_review'
  ) <> 'needs_review' then
    raise exception 'ambiguous ticket refund must wait for reconciliation';
  end if;

  reconciliation_claim := public.claim_ticket_refund_reconciliation(
    selected_request.id,
    '51000000-0000-4000-8000-000000002061',
    'case_refund_reconcile_2061'
  );
  reconciliation_duplicate := public.claim_ticket_refund_reconciliation(
    selected_request.id,
    '51000000-0000-4000-8000-000000002069',
    'case_refund_duplicate_2061'
  );
  if reconciliation_claim ->> 'claim_status' <> 'claimed'
    or reconciliation_duplicate ->> 'claim_status' <> 'in_progress'
  then
    raise exception 'ticket refund reconciliation claim was not idempotent';
  end if;

  if public.finalize_ticket_refund_reconciliation(
    selected_request.id,
    selected_attempt.id,
    '51000000-0000-4000-8000-000000002061',
    'approved',
    24000,
    null,
    'ticket-refund-transaction-2061',
    'ticket-refund-approval-2061',
    '0000',
    'CARD',
    '1234-****-****-5678',
    now()
  ) <> 'approved' then
    raise exception 'ticket refund reconciliation did not finalize';
  end if;

  terminal_claim := public.claim_ticket_refund_reconciliation(
    selected_request.id,
    '51000000-0000-4000-8000-000000002068',
    'case_refund_replay_2061'
  );
  if terminal_claim ->> 'claim_status' <> 'terminal'
    or terminal_claim ->> 'outcome' <> 'approved'
  then
    raise exception 'ticket refund reconciliation terminal replay failed';
  end if;
end;
$ticket_refund_contract$;

select 1 / case when (
  select ticket_order.status = 'canceled'
    and payment.status = 'refunded'
    and cancellation.status = 'completed'
    and ticket_type.sold = 0
  from public.ticket_orders as ticket_order
  join public.payment_attempts as attempt on attempt.ref_id = ticket_order.id
  join public.payments as payment on payment.id = attempt.payment_id
  join public.ticket_cancellation_requests as cancellation
    on cancellation.ticket_order_id = ticket_order.id
  join public.ticket_order_reservations as reservation
    on reservation.ticket_order_id = ticket_order.id
  join public.ticket_types as ticket_type on ticket_type.id = reservation.ticket_type_id
  where ticket_order.id = :'approved_order_id'::uuid
) and (
  select count(*) = 1 and bool_and(status = 'done')
  from public.refunds
  where ticket_cancellation_request_id = :'refund_request_id'::uuid
) and (
  select count(*) = 2 and bool_and(status = 'refunded')
  from public.tickets where ticket_order_id = :'approved_order_id'::uuid
) and exists (
  select 1
  from private.ticket_payment_reconciliation_audits as audit
  where audit.claim_token = '51000000-0000-4000-8000-000000002061'::uuid
    and audit.operation = 'refund'
    and audit.target_id = :'refund_request_id'::uuid
    and audit.actor_ref = 'payment_reconciliation_service_v1'
    and audit.case_ref = 'case_refund_reconcile_2061'
    and audit.claim_status = 'terminal'
    and audit.outcome = 'approved'
) then 1 else 0 end as assert_approved_refund_closes_once_and_restores_capacity;

-- Ticket expiry mirrors the final goods 221 contract. Only the exact critical
-- section that proves attempt TTL and performs prepared→canceled may complete
-- a durable request; absence, failed legacy ledger, fresh/active/ambiguous,
-- approved, and previously terminal attempts remain reserved for review.
insert into public.ticket_orders (
  id, user_id, event_id, status, total, expires_at, reservation_key
)
select
  fixture.order_id,
  '00000000-0000-4000-8000-000000002061',
  'ticket-payment-seam-event',
  'pending',
  21000,
  now() - interval '10 minutes',
  fixture.reservation_key
from (
  values
    ('20000000-0000-4000-8000-000000002080'::uuid, '21000000-0000-4000-8000-000000002080'::uuid),
    ('20000000-0000-4000-8000-000000002081'::uuid, '21000000-0000-4000-8000-000000002081'::uuid),
    ('20000000-0000-4000-8000-000000002082'::uuid, '21000000-0000-4000-8000-000000002082'::uuid),
    ('20000000-0000-4000-8000-000000002083'::uuid, '21000000-0000-4000-8000-000000002083'::uuid),
    ('20000000-0000-4000-8000-000000002084'::uuid, '21000000-0000-4000-8000-000000002084'::uuid),
    ('20000000-0000-4000-8000-000000002085'::uuid, '21000000-0000-4000-8000-000000002085'::uuid),
    ('20000000-0000-4000-8000-000000002086'::uuid, '21000000-0000-4000-8000-000000002086'::uuid),
    ('20000000-0000-4000-8000-000000002087'::uuid, '21000000-0000-4000-8000-000000002087'::uuid),
    ('20000000-0000-4000-8000-000000002088'::uuid, '21000000-0000-4000-8000-000000002088'::uuid)
) as fixture(order_id, reservation_key);

insert into public.ticket_order_reservations (
  ticket_order_id, ticket_type_id, quantity, unit_price
)
select
  ticket_order.id,
  '10000000-0000-4000-8000-000000002072',
  1,
  21000
from public.ticket_orders as ticket_order
where ticket_order.id between
  '20000000-0000-4000-8000-000000002080'::uuid
  and '20000000-0000-4000-8000-000000002088'::uuid;

update public.ticket_types
set sold = 9
where id = '10000000-0000-4000-8000-000000002072';

insert into public.payment_attempts (
  id, provider, user_id, purpose, ref_id, amount, currency, state,
  idempotency_key, provider_order_id, provider_product_code,
  claim_token, claim_expires_at, callback_nonce_digest, expires_at
)
select
  fixture.attempt_id,
  'korpay',
  '00000000-0000-4000-8000-000000002061',
  'ticket',
  fixture.order_id,
  21000,
  'KRW',
  fixture.state::public.payment_attempt_state,
  'ticket-expiry-matrix:' || fixture.order_id::text,
  'T' || pg_catalog.replace(fixture.attempt_id::text, '-', ''),
  'P' || pg_catalog.replace(fixture.attempt_id::text, '-', ''),
  case when fixture.state = 'confirming'
    then '46000000-0000-4000-8000-000000002084'::uuid else null end,
  case when fixture.state = 'confirming'
    then now() + interval '10 minutes' else null end,
  repeat('f', 64),
  case when fixture.order_id = '20000000-0000-4000-8000-000000002082'::uuid
    then now() + interval '10 minutes' else now() - interval '10 minutes' end
from (
  values
    ('30000000-0000-4000-8000-000000002082'::uuid, '20000000-0000-4000-8000-000000002082'::uuid, 'prepared'),
    ('30000000-0000-4000-8000-000000002083'::uuid, '20000000-0000-4000-8000-000000002083'::uuid, 'prepared'),
    ('30000000-0000-4000-8000-000000002084'::uuid, '20000000-0000-4000-8000-000000002084'::uuid, 'confirming'),
    ('30000000-0000-4000-8000-000000002085'::uuid, '20000000-0000-4000-8000-000000002085'::uuid, 'unknown'),
    ('30000000-0000-4000-8000-000000002086'::uuid, '20000000-0000-4000-8000-000000002086'::uuid, 'needs_review'),
    ('30000000-0000-4000-8000-000000002087'::uuid, '20000000-0000-4000-8000-000000002087'::uuid, 'approved'),
    ('30000000-0000-4000-8000-000000002088'::uuid, '20000000-0000-4000-8000-000000002088'::uuid, 'declined')
) as fixture(attempt_id, order_id, state);

insert into public.payments (
  id, user_id, purpose, ref_id, provider, amount, status,
  payment_key, idempotency_key, raw
)
values (
  '50000000-0000-4000-8000-000000002081',
  '00000000-0000-4000-8000-000000002061',
  'ticket',
  '20000000-0000-4000-8000-000000002081',
  'toss',
  21000,
  'failed',
  'ticket-expiry-legacy-failed-2081',
  'ticket-expiry-legacy-failed-2081',
  null
);

insert into public.ticket_cancellation_requests (
  id, ticket_order_id, requested_by, source, status, policy_code,
  cutoff_at, gross_amount, fee_amount, refund_amount, reason
)
select
  fixture.request_id,
  fixture.order_id,
  '00000000-0000-4000-8000-000000002061',
  'user',
  'requested',
  'event_start_full_refund_v1',
  now() + interval '30 days',
  21000,
  0,
  21000,
  '만료 상태행렬 취소 요청'
from (
  values
    ('60000000-0000-4000-8000-000000002080'::uuid, '20000000-0000-4000-8000-000000002080'::uuid),
    ('60000000-0000-4000-8000-000000002081'::uuid, '20000000-0000-4000-8000-000000002081'::uuid),
    ('60000000-0000-4000-8000-000000002082'::uuid, '20000000-0000-4000-8000-000000002082'::uuid),
    ('60000000-0000-4000-8000-000000002083'::uuid, '20000000-0000-4000-8000-000000002083'::uuid),
    ('60000000-0000-4000-8000-000000002084'::uuid, '20000000-0000-4000-8000-000000002084'::uuid),
    ('60000000-0000-4000-8000-000000002085'::uuid, '20000000-0000-4000-8000-000000002085'::uuid),
    ('60000000-0000-4000-8000-000000002086'::uuid, '20000000-0000-4000-8000-000000002086'::uuid),
    ('60000000-0000-4000-8000-000000002087'::uuid, '20000000-0000-4000-8000-000000002087'::uuid),
    ('60000000-0000-4000-8000-000000002088'::uuid, '20000000-0000-4000-8000-000000002088'::uuid)
) as fixture(request_id, order_id);

select 1 / case when public.expire_stale_checkouts() = 1
  then 1 else 0 end as assert_ticket_expiry_only_transitions_expired_prepared;

select 1 / case when (
  select ticket_order.status = 'canceled'
    and attempt.state = 'canceled'
    and request.status = 'completed'
  from public.ticket_orders as ticket_order
  join public.payment_attempts as attempt on attempt.ref_id = ticket_order.id
  join public.ticket_cancellation_requests as request
    on request.ticket_order_id = ticket_order.id
  where ticket_order.id = '20000000-0000-4000-8000-000000002083'
) and (
  select sold = 8
  from public.ticket_types
  where id = '10000000-0000-4000-8000-000000002072'
) then 1 else 0 end as assert_expired_prepared_ticket_request_restores_once;

select 1 / case when (
  select count(*) = 8
  from public.ticket_orders as ticket_order
  join public.ticket_cancellation_requests as request
    on request.ticket_order_id = ticket_order.id
  left join public.payment_attempts as attempt
    on attempt.ref_id = ticket_order.id and attempt.purpose = 'ticket'
  where ticket_order.id in (
    '20000000-0000-4000-8000-000000002080'::uuid,
    '20000000-0000-4000-8000-000000002081'::uuid,
    '20000000-0000-4000-8000-000000002082'::uuid,
    '20000000-0000-4000-8000-000000002084'::uuid,
    '20000000-0000-4000-8000-000000002085'::uuid,
    '20000000-0000-4000-8000-000000002086'::uuid,
    '20000000-0000-4000-8000-000000002087'::uuid,
    '20000000-0000-4000-8000-000000002088'::uuid
  )
    and ticket_order.status = 'pending'
    and request.status = 'requested'
    and (
      attempt.id is null
      or attempt.state in ('prepared', 'confirming', 'unknown', 'needs_review', 'approved', 'declined')
    )
) and (
  select status = 'failed'
  from public.payments
  where id = '50000000-0000-4000-8000-000000002081'
) then 1 else 0 end as assert_ticket_expiry_preserves_unproven_requests;

select 1 / case when public.expire_stale_checkouts() = 0
  then 1 else 0 end as assert_ticket_expiry_matrix_is_idempotent;

select public.reserve_tickets(
  '00000000-0000-4000-8000-000000002061',
  '10000000-0000-4000-8000-000000002065',
  1,
  '20000000-0000-4000-8000-000000002065'
) as legacy_order_id \gset

insert into public.tickets (ticket_order_id, ticket_type_id, qr_token, status)
values (
  :'legacy_order_id',
  '10000000-0000-4000-8000-000000002065',
  null,
  'valid'
);
insert into public.payments (
  user_id, purpose, ref_id, provider, amount, status,
  payment_key, idempotency_key, raw
)
values (
  '00000000-0000-4000-8000-000000002061',
  'ticket', :'legacy_order_id', 'toss', 16000, 'pending',
  'legacy-toss-ticket-2065', 'legacy-toss-ticket-2065', null
);
select public.confirm_ticket_payment(
  'legacy-toss-ticket-2065', :'legacy_order_id',
  'legacy-toss-ticket-2065', 16000, '{"status":"DONE"}'::jsonb
);

select 1 / case when (
  select ticket_order.status = 'paid'
    and payment.provider = 'toss'
    and payment.status = 'paid'
  from public.ticket_orders as ticket_order
  join public.payments as payment on payment.ref_id = ticket_order.id
  where ticket_order.id = :'legacy_order_id'::uuid
) and (
  select count(*) = 1 and count(qr_token) = 1
  from public.tickets where ticket_order_id = :'legacy_order_id'::uuid
) then 1 else 0 end as assert_known_legacy_toss_finalizes_existing_placeholder_only;

select public.reserve_tickets(
  '00000000-0000-4000-8000-000000002061',
  '10000000-0000-4000-8000-000000002066',
  1,
  '20000000-0000-4000-8000-000000002066'
) as unknown_toss_order_id \gset

do $unknown_toss_contract$
declare
  rejected boolean := false;
  v_order_id uuid;
begin
  select id into strict v_order_id
  from public.ticket_orders
  where reservation_key = '20000000-0000-4000-8000-000000002066';
  begin
    perform public.confirm_ticket_payment(
      'unknown-toss-ticket-2066', v_order_id,
      'unknown-toss-ticket-2066', 17000, '{}'::jsonb
    );
  exception when object_not_in_prerequisite_state then
    rejected := sqlerrm = 'legacy_toss_payment_unknown';
  end;
  if not rejected then
    raise exception 'unknown Toss ticket must not create or finalize a payment';
  end if;
end;
$unknown_toss_contract$;

select 1 / case when not exists (
  select 1 from public.payments where payment_key = 'unknown-toss-ticket-2066'
) and not exists (
  select 1 from public.tickets where ticket_order_id = :'unknown_toss_order_id'::uuid
) then 1 else 0 end as assert_unknown_toss_creates_no_ledger_or_ticket;

rollback;
