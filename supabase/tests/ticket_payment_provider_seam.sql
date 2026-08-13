\set ON_ERROR_STOP on

begin;

select 1 / case when (
  has_function_privilege('service_role', 'public.prepare_ticket_payment_attempt(uuid,uuid,public.payment_provider)', 'execute')
  and has_function_privilege('service_role', 'public.bind_ticket_payment_callback_nonce(uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.claim_ticket_payment_attempt(public.payment_provider,text,text,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.finalize_ticket_payment_attempt(uuid,uuid,public.payment_attempt_state,text,text,text,text,text,text,timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.claim_ticket_payment_refund(uuid,uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.finalize_ticket_payment_refund(uuid,uuid,uuid,public.payment_attempt_state,bigint,text,text,text,text,text,text,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.prepare_ticket_payment_attempt(uuid,uuid,public.payment_provider)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_ticket_payment_attempt(public.payment_provider,text,text,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.finalize_ticket_payment_refund(uuid,uuid,uuid,public.payment_attempt_state,bigint,text,text,text,text,text,text,timestamptz)', 'execute')
) then 1 else 0 end as assert_ticket_payment_rpcs_are_service_only;

select 1 / case when (
  not has_function_privilege('service_role', 'private.ticket_payment_attempt_json(public.payment_attempts)', 'execute')
  and not has_function_privilege('service_role', 'private.ticket_order_snapshot_matches(uuid,text,bigint)', 'execute')
  and not has_function_privilege('service_role', 'public.begin_ticket_payment_approval(uuid,uuid,text,bigint)', 'execute')
  and has_function_privilege('service_role', 'public.confirm_ticket_payment(text,uuid,text,bigint,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.confirm_ticket_payment(text,uuid,text,bigint,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.confirm_ticket_payment(text,uuid,text,bigint,jsonb)', 'execute')
) then 1 else 0 end as assert_private_helpers_and_new_toss_begin_are_closed;

select 1 / case when not exists (
  select 1
  from pg_catalog.pg_proc as procedure
  where procedure.oid in (
    'public.finalize_ticket_payment_attempt(uuid,uuid,public.payment_attempt_state,text,text,text,text,text,text,timestamptz)'::regprocedure,
    'public.finalize_ticket_payment_refund(uuid,uuid,uuid,public.payment_attempt_state,bigint,text,text,text,text,text,text,timestamptz)'::regprocedure
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
  ('10000000-0000-4000-8000-000000002066', 'ticket-payment-seam-event', 'unknown Toss 회차', 17000, 10, 0, 4, null)
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

select request_id as refund_request_id, result as refund_request_result
from public.request_ticket_cancellation(
  '00000000-0000-4000-8000-000000002061', :'approved_order_id'
) \gset

do $ticket_refund_contract$
declare
  first_claim jsonb;
  duplicate_claim jsonb;
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
    raise exception 'ticket refund did not finalize';
  end if;

  if public.finalize_ticket_payment_refund(
    selected_request.id,
    selected_attempt.id,
    '50000000-0000-4000-8000-000000002061',
    'approved',
    24000
  ) <> 'approved' then
    raise exception 'ticket refund terminal replay failed';
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
) then 1 else 0 end as assert_approved_refund_closes_once_and_restores_capacity;

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
