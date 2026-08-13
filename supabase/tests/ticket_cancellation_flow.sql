\set ON_ERROR_STOP on

begin;

select 1 / case when to_regclass('public.ticket_cancellation_requests') is not null
  then 1 else 0 end as assert_durable_ticket_cancellation_ledger_exists;

select 1 / case when to_regprocedure(
  'public.request_ticket_cancellation(uuid,uuid)'
) is not null then 1 else 0 end as assert_user_request_rpc_exists;
select 1 / case when to_regprocedure(
  'public.begin_ticket_cancellation_reconcile(uuid,uuid,uuid)'
) is not null then 1 else 0 end as assert_reconcile_claim_rpc_exists;
select 1 / case when to_regprocedure(
  'public.record_ticket_provider_cancellation_evidence(uuid,text,text,jsonb,boolean)'
) is not null then 1 else 0 end as assert_provider_evidence_rpc_exists;
select 1 / case when (
  select pronargdefaults = 2
  from pg_catalog.pg_proc
  where oid = 'public.record_ticket_provider_cancellation_evidence(uuid,text,text,jsonb,boolean)'::regprocedure
) then 1 else 0 end as assert_provider_evidence_rpc_keeps_three_arg_compatibility;
select 1 / case when to_regprocedure(
  'public.complete_ticket_cancellation_request(uuid,uuid,text[])'
) is not null then 1 else 0 end as assert_completion_rpc_exists;
select 1 / case when to_regprocedure(
  'public.mark_ticket_cancellation_needs_review(uuid,uuid,text)'
) is not null then 1 else 0 end as assert_review_rpc_exists;
select 1 / case when to_regprocedure(
  'public.begin_ticket_payment_approval(uuid,uuid,text,bigint)'
) is not null then 1 else 0 end as assert_payment_approval_claim_rpc_exists;

select 1 / case when (
  not has_function_privilege(
    'anon', 'public.request_ticket_cancellation(uuid,uuid)', 'execute'
  )
  and not has_function_privilege(
    'authenticated', 'public.request_ticket_cancellation(uuid,uuid)', 'execute'
  )
  and has_function_privilege(
    'service_role', 'public.request_ticket_cancellation(uuid,uuid)', 'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.begin_ticket_cancellation_reconcile(uuid,uuid,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.begin_ticket_cancellation_reconcile(uuid,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.record_ticket_provider_cancellation_evidence(uuid,text,text,jsonb,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_ticket_provider_cancellation_evidence(uuid,text,text,jsonb,boolean)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.record_ticket_provider_cancellation_evidence(uuid,text,text,jsonb,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.complete_ticket_cancellation_request(uuid,uuid,text[])',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.complete_ticket_cancellation_request(uuid,uuid,text[])',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.mark_ticket_cancellation_needs_review(uuid,uuid,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.mark_ticket_cancellation_needs_review(uuid,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.begin_ticket_payment_approval(uuid,uuid,text,bigint)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.begin_ticket_payment_approval(uuid,uuid,text,bigint)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.begin_ticket_payment_approval(uuid,uuid,text,bigint)',
    'execute'
  )
) then 1 else 0 end as assert_cancel_service_only_and_legacy_checkout_closed;

select 1 / case when (
  not has_table_privilege('anon', 'public.ticket_cancellation_requests', 'select')
  and not has_any_column_privilege(
    'anon', 'public.ticket_cancellation_requests', 'select'
  )
  and not has_table_privilege(
    'authenticated', 'public.ticket_cancellation_requests', 'select'
  )
  and has_column_privilege(
    'authenticated', 'public.ticket_cancellation_requests', 'id', 'select'
  )
  and has_column_privilege(
    'authenticated', 'public.ticket_cancellation_requests', 'ticket_order_id', 'select'
  )
  and has_column_privilege(
    'authenticated', 'public.ticket_cancellation_requests', 'status', 'select'
  )
  and has_column_privilege(
    'authenticated', 'public.ticket_cancellation_requests', 'policy_code', 'select'
  )
  and not has_column_privilege(
    'authenticated', 'public.ticket_cancellation_requests', 'requested_by', 'select'
  )
  and not has_column_privilege(
    'authenticated', 'public.ticket_cancellation_requests', 'attempt_token', 'select'
  )
  and not has_column_privilege(
    'authenticated', 'public.ticket_cancellation_requests', 'last_error_code', 'select'
  )
  and not has_table_privilege(
    'authenticated', 'public.ticket_cancellation_requests', 'insert'
  )
  and not has_table_privilege(
    'authenticated', 'public.ticket_cancellation_requests', 'update'
  )
  and not has_table_privilege(
    'authenticated', 'public.ticket_cancellation_requests', 'delete'
  )
  and has_table_privilege(
    'service_role', 'public.ticket_cancellation_requests', 'select'
  )
  and not has_table_privilege(
    'service_role', 'public.ticket_cancellation_requests', 'insert'
  )
  and not has_table_privilege(
    'service_role', 'public.ticket_cancellation_requests', 'update'
  )
  and not has_table_privilege(
    'service_role', 'public.ticket_cancellation_requests', 'delete'
  )
) then 1 else 0 end as assert_owner_safe_columns_and_server_only_writes;

select 1 / case when (
  not has_table_privilege('authenticated', 'public.tickets', 'select')
  and has_column_privilege('authenticated', 'public.tickets', 'id', 'select')
  and has_column_privilege(
    'authenticated', 'public.tickets', 'ticket_order_id', 'select'
  )
  and has_column_privilege(
    'authenticated', 'public.tickets', 'ticket_type_id', 'select'
  )
  and has_column_privilege('authenticated', 'public.tickets', 'status', 'select')
  and has_column_privilege('authenticated', 'public.tickets', 'created_at', 'select')
  and not has_column_privilege('authenticated', 'public.tickets', 'qr_token', 'select')
  and has_table_privilege('service_role', 'public.tickets', 'select')
) then 1 else 0 end as assert_qr_token_is_server_only;

select 1 / case when exists (
  select 1
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'refunds'
    and column_name = 'ticket_cancellation_request_id'
) then 1 else 0 end as assert_refunds_link_to_ticket_cancellation_request;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000009501',
    'authenticated', 'authenticated', 'ticket-cancel-owner@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000009502',
    'authenticated', 'authenticated', 'ticket-cancel-other@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000009503',
    'authenticated', 'authenticated', 'ticket-cancel-staff@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (
  id, email, nickname, birth_date, consents, onboarded_at, role
)
values
  (
    '00000000-0000-4000-8000-000000009501',
    'ticket-cancel-owner@example.test', 'ticket_cancel_owner', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  ),
  (
    '00000000-0000-4000-8000-000000009502',
    'ticket-cancel-other@example.test', 'ticket_cancel_other', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  ),
  (
    '00000000-0000-4000-8000-000000009503',
    'ticket-cancel-staff@example.test', 'ticket_cancel_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  )
on conflict (id) do update set role = excluded.role;

insert into public.events (id, title, mode, status, starts_at)
values
  ('ticket-cancel-future', '취소 가능 이벤트', '오프라인', '예매중', now() + interval '7 days'),
  ('ticket-cancel-past', '취소 마감 이벤트', '오프라인', '종료', now() - interval '1 hour'),
  ('ticket-cancel-no-cutoff', '시작 시각 미정 이벤트', '오프라인', '예정', null)
on conflict (id) do update set
  title = excluded.title,
  mode = excluded.mode,
  status = excluded.status,
  starts_at = excluded.starts_at;

insert into public.ticket_types (
  id, event_id, name, price, capacity, sold, per_user_limit, sales_open_at
)
values
  ('95000000-0000-4000-8000-000000000001', 'ticket-cancel-future', '무결제', 10000, 10, 2, 4, null),
  ('95000000-0000-4000-8000-000000000002', 'ticket-cancel-future', '유료', 10000, 10, 2, 4, null),
  ('95000000-0000-4000-8000-000000000003', 'ticket-cancel-future', '사용됨', 10000, 10, 1, 4, null),
  ('95000000-0000-4000-8000-000000000004', 'ticket-cancel-past', '마감됨', 10000, 10, 1, 4, null),
  ('95000000-0000-4000-8000-000000000005', 'ticket-cancel-no-cutoff', '시각 미정', 10000, 10, 1, 4, null),
  ('95000000-0000-4000-8000-000000000006', 'ticket-cancel-future', '다중 결제', 10000, 10, 1, 4, null),
  ('95000000-0000-4000-8000-000000000007', 'ticket-cancel-future', '승인 차단', 10000, 10, 1, 4, null),
  ('95000000-0000-4000-8000-000000000008', 'ticket-cancel-future', '검표 차단', 10000, 10, 1, 4, null),
  ('95000000-0000-4000-8000-000000000009', 'ticket-cancel-future', 'provider 이상', 10000, 10, 1, 4, null),
  ('95000000-0000-4000-8000-000000000010', 'ticket-cancel-future', 'provider 증거', 10000, 10, 1, 4, null),
  ('95000000-0000-4000-8000-000000000011', 'ticket-cancel-future', '티켓 없음', 10000, 10, 0, 4, null),
  ('95000000-0000-4000-8000-000000000012', 'ticket-cancel-future', '비정상 상태', 10000, 10, 1, 4, null),
  ('95000000-0000-4000-8000-000000000013', 'ticket-cancel-future', 'pending 실패 장부', 10000, 10, 1, 4, null),
  ('95000000-0000-4000-8000-000000000014', 'ticket-cancel-future', 'paid 실패 장부', 10000, 10, 1, 4, null),
  ('95000000-0000-4000-8000-000000000015', 'ticket-cancel-future', '취소 선점 우선', 10000, 10, 1, 4, null),
  ('95000000-0000-4000-8000-000000000016', 'ticket-cancel-future', '결제 승인 선점 우선', 10000, 10, 1, 4, null),
  ('95000000-0000-4000-8000-000000000017', 'ticket-cancel-future', '결제 승인 replay', 10000, 10, 1, 4, null),
  ('95000000-0000-4000-8000-000000000018', 'ticket-cancel-future', '만료 승인', 10000, 10, 1, 4, null),
  ('95000000-0000-4000-8000-000000000019', 'ticket-cancel-future', '승인 placeholder 복구', 10000, 10, 1, 4, null),
  ('95000000-0000-4000-8000-000000000020', 'ticket-cancel-future', '승인 충돌', 10000, 10, 1, 4, null),
  ('95000000-0000-4000-8000-000000000021', 'ticket-cancel-future', '취소된 승인 장부', 10000, 10, 1, 4, null)
on conflict (id) do update set sold = excluded.sold;

insert into public.ticket_orders (
  id, user_id, event_id, status, total, expires_at, reservation_key
)
values
  ('95100000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-future', 'pending', 20000, now() + interval '10 minutes', '95200000-0000-4000-8000-000000000001'),
  ('95100000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-future', 'paid', 20000, null, '95200000-0000-4000-8000-000000000002'),
  ('95100000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-future', 'paid', 10000, null, '95200000-0000-4000-8000-000000000003'),
  ('95100000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-past', 'paid', 10000, null, '95200000-0000-4000-8000-000000000004'),
  ('95100000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-no-cutoff', 'paid', 10000, null, '95200000-0000-4000-8000-000000000005'),
  ('95100000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-future', 'paid', 10000, null, '95200000-0000-4000-8000-000000000006'),
  ('95100000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-future', 'pending', 10000, now() + interval '10 minutes', '95200000-0000-4000-8000-000000000007'),
  ('95100000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-future', 'paid', 10000, null, '95200000-0000-4000-8000-000000000008'),
  ('95100000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-future', 'paid', 10000, null, '95200000-0000-4000-8000-000000000009'),
  ('95100000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-future', 'paid', 10000, null, '95200000-0000-4000-8000-000000000010'),
  ('95100000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-future', 'paid', 10000, null, '95200000-0000-4000-8000-000000000011'),
  ('95100000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-future', 'paid', 10000, null, '95200000-0000-4000-8000-000000000012'),
  ('95100000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-future', 'pending', 10000, now() + interval '10 minutes', '95200000-0000-4000-8000-000000000013'),
  ('95100000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-future', 'paid', 10000, null, '95200000-0000-4000-8000-000000000014'),
  ('95100000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-future', 'pending', 10000, now() + interval '10 minutes', '95200000-0000-4000-8000-000000000015'),
  ('95100000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-future', 'pending', 10000, now() + interval '10 minutes', '95200000-0000-4000-8000-000000000016'),
  ('95100000-0000-4000-8000-000000000017', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-future', 'pending', 10000, now() + interval '10 minutes', '95200000-0000-4000-8000-000000000017'),
  ('95100000-0000-4000-8000-000000000018', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-future', 'pending', 10000, now() - interval '1 minute', '95200000-0000-4000-8000-000000000018'),
  ('95100000-0000-4000-8000-000000000019', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-future', 'pending', 10000, now() + interval '10 minutes', '95200000-0000-4000-8000-000000000019'),
  ('95100000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-future', 'pending', 10000, now() + interval '10 minutes', '95200000-0000-4000-8000-000000000020'),
  ('95100000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000009501', 'ticket-cancel-future', 'pending', 10000, now() + interval '10 minutes', '95200000-0000-4000-8000-000000000021');

insert into public.tickets (
  id, ticket_order_id, ticket_type_id, qr_token, status
)
values
  ('95300000-0000-4000-8000-000000000001', '95100000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', null, 'valid'),
  ('95300000-0000-4000-8000-000000000002', '95100000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', null, 'valid'),
  ('95300000-0000-4000-8000-000000000003', '95100000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000002', 'ticket-cancel-paid-qr-1', 'valid'),
  ('95300000-0000-4000-8000-000000000004', '95100000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000002', 'ticket-cancel-paid-qr-2', 'valid'),
  ('95300000-0000-4000-8000-000000000005', '95100000-0000-4000-8000-000000000003', '95000000-0000-4000-8000-000000000003', 'ticket-cancel-used-qr', 'used'),
  ('95300000-0000-4000-8000-000000000006', '95100000-0000-4000-8000-000000000004', '95000000-0000-4000-8000-000000000004', 'ticket-cancel-past-qr', 'valid'),
  ('95300000-0000-4000-8000-000000000007', '95100000-0000-4000-8000-000000000005', '95000000-0000-4000-8000-000000000005', 'ticket-cancel-null-qr', 'valid'),
  ('95300000-0000-4000-8000-000000000008', '95100000-0000-4000-8000-000000000006', '95000000-0000-4000-8000-000000000006', 'ticket-cancel-multi-qr', 'valid'),
  ('95300000-0000-4000-8000-000000000009', '95100000-0000-4000-8000-000000000007', '95000000-0000-4000-8000-000000000007', null, 'valid'),
  ('95300000-0000-4000-8000-000000000010', '95100000-0000-4000-8000-000000000008', '95000000-0000-4000-8000-000000000008', '95300000000040008000000000000010', 'valid'),
  ('95300000-0000-4000-8000-000000000011', '95100000-0000-4000-8000-000000000009', '95000000-0000-4000-8000-000000000009', 'ticket-cancel-provider-used-qr', 'used'),
  ('95300000-0000-4000-8000-000000000012', '95100000-0000-4000-8000-000000000010', '95000000-0000-4000-8000-000000000010', 'ticket-cancel-provider-direct-qr', 'valid'),
  ('95300000-0000-4000-8000-000000000013', '95100000-0000-4000-8000-000000000012', '95000000-0000-4000-8000-000000000012', 'ticket-cancel-non-valid-qr', 'refunded'),
  ('95300000-0000-4000-8000-000000000014', '95100000-0000-4000-8000-000000000013', '95000000-0000-4000-8000-000000000013', null, 'valid'),
  ('95300000-0000-4000-8000-000000000015', '95100000-0000-4000-8000-000000000014', '95000000-0000-4000-8000-000000000014', 'ticket-cancel-paid-failed-qr', 'valid'),
  ('95300000-0000-4000-8000-000000000016', '95100000-0000-4000-8000-000000000015', '95000000-0000-4000-8000-000000000015', null, 'valid'),
  ('95300000-0000-4000-8000-000000000017', '95100000-0000-4000-8000-000000000016', '95000000-0000-4000-8000-000000000016', null, 'valid'),
  ('95300000-0000-4000-8000-000000000018', '95100000-0000-4000-8000-000000000017', '95000000-0000-4000-8000-000000000017', null, 'valid'),
  ('95300000-0000-4000-8000-000000000019', '95100000-0000-4000-8000-000000000018', '95000000-0000-4000-8000-000000000018', null, 'valid'),
  ('95300000-0000-4000-8000-000000000020', '95100000-0000-4000-8000-000000000019', '95000000-0000-4000-8000-000000000019', null, 'valid'),
  ('95300000-0000-4000-8000-000000000021', '95100000-0000-4000-8000-000000000020', '95000000-0000-4000-8000-000000000020', null, 'valid'),
  ('95300000-0000-4000-8000-000000000022', '95100000-0000-4000-8000-000000000021', '95000000-0000-4000-8000-000000000021', null, 'valid');

-- The provider-neutral ticket seam persists capacity separately from issued
-- tickets. These legacy fixtures still carry placeholder tickets, so mirror
-- their exact immutable reservation snapshot explicitly.
insert into public.ticket_order_reservations (
  ticket_order_id,
  ticket_type_id,
  quantity,
  unit_price
)
select
  ticket.ticket_order_id,
  min(ticket.ticket_type_id::text)::uuid,
  count(*)::integer,
  ticket_type.price
from public.tickets as ticket
join public.ticket_types as ticket_type on ticket_type.id = ticket.ticket_type_id
group by ticket.ticket_order_id, ticket_type.price;

insert into public.payments (
  id, user_id, purpose, ref_id, amount, status,
  payment_key, idempotency_key, raw
)
values
  ('95400000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000009501', 'ticket', '95100000-0000-4000-8000-000000000002', 20000, 'paid', 'ticket-cancel-paid-key', 'ticket-cancel-paid-key', '{}'),
  ('95400000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000009501', 'ticket', '95100000-0000-4000-8000-000000000003', 10000, 'paid', 'ticket-cancel-used-key', 'ticket-cancel-used-key', '{}'),
  ('95400000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000009501', 'ticket', '95100000-0000-4000-8000-000000000004', 10000, 'paid', 'ticket-cancel-past-key', 'ticket-cancel-past-key', '{}'),
  ('95400000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000009501', 'ticket', '95100000-0000-4000-8000-000000000005', 10000, 'paid', 'ticket-cancel-null-key', 'ticket-cancel-null-key', '{}'),
  ('95400000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000009501', 'ticket', '95100000-0000-4000-8000-000000000006', 10000, 'paid', 'ticket-cancel-multi-paid-key', 'ticket-cancel-multi-paid-key', '{}'),
  ('95400000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000009501', 'ticket', '95100000-0000-4000-8000-000000000006', 10000, 'pending', 'ticket-cancel-multi-pending-key', 'ticket-cancel-multi-pending-key', '{}'),
  ('95400000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000009501', 'ticket', '95100000-0000-4000-8000-000000000007', 10000, 'pending', 'ticket-cancel-confirm-key', 'ticket-cancel-confirm-key', '{}'),
  ('95400000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-000000009501', 'ticket', '95100000-0000-4000-8000-000000000008', 10000, 'paid', 'ticket-cancel-checkin-key', 'ticket-cancel-checkin-key', '{}'),
  ('95400000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-000000009501', 'ticket', '95100000-0000-4000-8000-000000000009', 10000, 'paid', 'ticket-cancel-provider-used-key', 'ticket-cancel-provider-used-key', '{}'),
  ('95400000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000009501', 'ticket', '95100000-0000-4000-8000-000000000010', 10000, 'paid', 'ticket-cancel-provider-direct-paid-key', 'ticket-cancel-provider-direct-paid-key', '{}'),
  ('95400000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000009501', 'ticket', '95100000-0000-4000-8000-000000000010', 10000, 'pending', 'ticket-cancel-provider-direct-pending-key', 'ticket-cancel-provider-direct-pending-key', '{}'),
  ('95400000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000009501', 'order', '95100000-0000-4000-8000-000000000010', 10000, 'paid', 'ticket-cancel-provider-wrong-purpose', 'ticket-cancel-provider-wrong-purpose', '{}'),
  ('95400000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000009501', 'ticket', '95100000-0000-4000-8000-000000000008', 10000, 'paid', 'ticket-cancel-provider-wrong-ref', 'ticket-cancel-provider-wrong-ref', '{}'),
  ('95400000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000009502', 'ticket', '95100000-0000-4000-8000-000000000010', 10000, 'paid', 'ticket-cancel-provider-wrong-user', 'ticket-cancel-provider-wrong-user', '{}'),
  ('95400000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000009501', 'ticket', '95100000-0000-4000-8000-000000000010', 9000, 'paid', 'ticket-cancel-provider-wrong-amount', 'ticket-cancel-provider-wrong-amount', '{}'),
  ('95400000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000009501', 'ticket', '95100000-0000-4000-8000-000000000013', 10000, 'failed', 'ticket-cancel-pending-failed-key', 'ticket-cancel-pending-failed-key', '{}'),
  ('95400000-0000-4000-8000-000000000017', '00000000-0000-4000-8000-000000009501', 'ticket', '95100000-0000-4000-8000-000000000014', 10000, 'failed', 'ticket-cancel-paid-failed-key', 'ticket-cancel-paid-failed-key', '{}'),
  ('95400000-0000-4000-8000-000000000018', '00000000-0000-4000-8000-000000009501', 'ticket', '95100000-0000-4000-8000-000000000019', 10000, 'pending', null, 'ticket-approval-heal-key', '{"stale":true}'),
  ('95400000-0000-4000-8000-000000000019', '00000000-0000-4000-8000-000000009501', 'ticket', '95100000-0000-4000-8000-000000000021', 10000, 'canceled', 'ticket-approval-canceled-key', 'ticket-approval-canceled-key', '{}');

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);


-- pending + 결제 장부 0건은 요청 트랜잭션에서 즉시 선점과 티켓을 한 번만 닫는다.
select * from public.request_ticket_cancellation(
  '00000000-0000-4000-8000-000000009501',
  '95100000-0000-4000-8000-000000000001'
) \gset no_payment_

select 1 / case when :'no_payment_result' = 'completed'
  then 1 else 0 end as assert_no_payment_pending_completes_immediately;
select 1 / case when (
  select status = 'completed'
    and source = 'user'
    and policy_code = 'event_start_full_refund_v1'
    and cutoff_at > now()
    and gross_amount = 20000
    and fee_amount = 0
    and refund_amount = 20000
    and completed_at is not null
  from public.ticket_cancellation_requests
  where id = :'no_payment_request_id'::uuid
) and (
  select status = 'canceled' and expires_at is null
  from public.ticket_orders
  where id = '95100000-0000-4000-8000-000000000001'
) and (
  select sold = 0
  from public.ticket_types
  where id = '95000000-0000-4000-8000-000000000001'
) and (
  select count(*) = 2 and bool_and(status = 'refunded')
  from public.tickets
  where ticket_order_id = '95100000-0000-4000-8000-000000000001'
) then 1 else 0 end as assert_no_payment_cancellation_snapshot_and_allocation;

select * from public.request_ticket_cancellation(
  '00000000-0000-4000-8000-000000009501',
  '95100000-0000-4000-8000-000000000001'
) \gset no_payment_replay_
select 1 / case when :'no_payment_replay_result' = 'completed'
  and :'no_payment_replay_request_id'::uuid = :'no_payment_request_id'::uuid
  and (select sold = 0 from public.ticket_types where id = '95000000-0000-4000-8000-000000000001')
  then 1 else 0 end as assert_completed_request_replay_does_not_restore_twice;

-- paid 요청은 정책 snapshot만 남기고 provider reconcile claim을 직렬화한다.
select * from public.request_ticket_cancellation(
  '00000000-0000-4000-8000-000000009501',
  '95100000-0000-4000-8000-000000000002'
) \gset paid_
select * from public.request_ticket_cancellation(
  '00000000-0000-4000-8000-000000009501',
  '95100000-0000-4000-8000-000000000002'
) \gset paid_replay_
select 1 / case when :'paid_result' = 'requested'
  and :'paid_replay_result' = 'requested'
  and :'paid_request_id'::uuid = :'paid_replay_request_id'::uuid
  and (select count(*) = 1 from public.ticket_cancellation_requests where ticket_order_id = '95100000-0000-4000-8000-000000000002')
  then 1 else 0 end as assert_paid_request_is_durable_and_idempotent;

select public.begin_ticket_cancellation_reconcile(
  :'paid_request_id'::uuid,
  '00000000-0000-4000-8000-000000009501',
  '95500000-0000-4000-8000-000000000001'
) as paid_begin_result \gset
select public.begin_ticket_cancellation_reconcile(
  :'paid_request_id'::uuid,
  '00000000-0000-4000-8000-000000009501',
  '95500000-0000-4000-8000-000000000002'
) as paid_competing_begin_result \gset
select 1 / case when :'paid_begin_result' = 'processing'
  and :'paid_competing_begin_result' = 'in_progress'
  then 1 else 0 end as assert_attempt_token_serializes_provider_reconcile;

reset role;
update public.ticket_cancellation_requests
set provider_started_at = now() - interval '6 minutes'
where id = :'paid_request_id'::uuid;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.begin_ticket_cancellation_reconcile(
  :'paid_request_id'::uuid,
  '00000000-0000-4000-8000-000000009501',
  '95500000-0000-4000-8000-000000000002'
) as paid_lease_reclaim_result \gset
select 1 / case when :'paid_lease_reclaim_result' = 'processing'
  and (
    select attempt_token = '95500000-0000-4000-8000-000000000002'
    from public.ticket_cancellation_requests
    where id = :'paid_request_id'::uuid
  ) then 1 else 0 end as assert_expired_processing_lease_can_be_reclaimed;

do $$
declare
  target_request_id uuid;
begin
  select id into target_request_id
  from public.ticket_cancellation_requests
  where ticket_order_id = '95100000-0000-4000-8000-000000000002'
    and status = 'processing';

  begin
    perform public.mark_ticket_cancellation_needs_review(
      target_request_id,
      '95500000-0000-4000-8000-000000000001',
      'stale_after_reclaim'
    );
    raise exception 'expired lease owner must not overwrite reclaimed attempt';
  exception
    when check_violation then
      if sqlerrm <> 'ticket cancellation attempt mismatch' then raise; end if;
  end;
end;
$$;

select public.mark_ticket_cancellation_needs_review(
  :'paid_request_id'::uuid,
  '95500000-0000-4000-8000-000000000002',
  'provider_timeout'
);
select 1 / case when (
  select status = 'needs_review' and last_error_code = 'provider_timeout'
  from public.ticket_cancellation_requests
  where id = :'paid_request_id'::uuid
) then 1 else 0 end as assert_indeterminate_provider_result_is_durable;

reset role;
update public.events
set starts_at = now() - interval '1 minute'
where id = 'ticket-cancel-future';
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select * from public.request_ticket_cancellation(
  '00000000-0000-4000-8000-000000009501',
  '95100000-0000-4000-8000-000000000002'
) \gset paid_after_cutoff_
select 1 / case when :'paid_after_cutoff_result' = 'needs_review'
  and :'paid_after_cutoff_request_id'::uuid = :'paid_request_id'::uuid
  then 1 else 0 end as assert_existing_request_replay_uses_policy_snapshot_after_cutoff;
reset role;
update public.events
set starts_at = now() + interval '7 days'
where id = 'ticket-cancel-future';
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);

select public.begin_ticket_cancellation_reconcile(
  :'paid_request_id'::uuid,
  '00000000-0000-4000-8000-000000009501',
  '95500000-0000-4000-8000-000000000003'
) as paid_retry_result \gset
select 1 / case when :'paid_retry_result' = 'processing'
  then 1 else 0 end as assert_needs_review_can_reconcile_with_new_attempt;

do $$
declare
  target_request_id uuid;
begin
  select id into target_request_id
  from public.ticket_cancellation_requests
  where ticket_order_id = '95100000-0000-4000-8000-000000000002'
    and status = 'processing';

  begin
    perform public.mark_ticket_cancellation_needs_review(
      target_request_id,
      '95500000-0000-4000-8000-000000000002',
      'stale_attempt'
    );
    raise exception 'stale attempt must not overwrite a new processing attempt';
  exception
    when check_violation then
      if sqlerrm <> 'ticket cancellation attempt mismatch' then raise; end if;
  end;

  begin
    perform public.complete_ticket_cancellation_request(
      target_request_id,
      '95500000-0000-4000-8000-000000000002',
      array['ticket-cancel-paid-key']
    );
    raise exception 'stale attempt must not complete a new processing attempt';
  exception
    when check_violation then
      if sqlerrm <> 'ticket cancellation attempt mismatch' then raise; end if;
  end;
end;
$$;

select 1 / case when (
  select status = 'processing'
    and attempt_token = '95500000-0000-4000-8000-000000000003'
    and last_error_code is null
  from public.ticket_cancellation_requests
  where id = :'paid_request_id'::uuid
) then 1 else 0 end as assert_stale_attempt_cannot_overwrite_current_attempt;

select public.record_ticket_provider_cancellation_evidence(
  '95100000-0000-4000-8000-000000000002',
  'fresh provider refund evidence',
  'ticket-cancel-paid-key',
  '{"paymentKey":"ticket-cancel-paid-key","status":"CANCELED","trace":"provider-raw-paid"}'::jsonb,
  true
);
select public.record_ticket_provider_cancellation_evidence(
  '95100000-0000-4000-8000-000000000002',
  'fresh provider refund evidence replay',
  'ticket-cancel-paid-key'
);
select public.complete_ticket_cancellation_request(
  :'paid_request_id'::uuid,
  '95500000-0000-4000-8000-000000000003',
  array['ticket-cancel-paid-key']
);
select public.complete_ticket_cancellation_request(
  :'paid_request_id'::uuid,
  '95500000-0000-4000-8000-000000000001',
  array['ticket-cancel-paid-key']
);

select 1 / case when (
  select status = 'completed' and completed_at is not null
  from public.ticket_cancellation_requests
  where id = :'paid_request_id'::uuid
) and (
  select status = 'canceled'
  from public.ticket_orders
  where id = '95100000-0000-4000-8000-000000000002'
) and (
  select sold = 0
  from public.ticket_types
  where id = '95000000-0000-4000-8000-000000000002'
) and (
  select count(*) = 2 and bool_and(status = 'refunded')
  from public.tickets
  where ticket_order_id = '95100000-0000-4000-8000-000000000002'
) and (
  select status = 'refunded'
    and raw = '{"paymentKey":"ticket-cancel-paid-key","status":"CANCELED","trace":"provider-raw-paid"}'::jsonb
  from public.payments
  where id = '95400000-0000-4000-8000-000000000001'
) and (
  select count(*) = 1 and bool_and(status = 'done')
    and bool_and(ticket_cancellation_request_id = :'paid_request_id'::uuid)
  from public.refunds
  where payment_id = '95400000-0000-4000-8000-000000000001'
) then 1 else 0 end as assert_paid_completion_is_exact_and_idempotent;

-- 사용 완료 티켓과 시작 시각이 없거나 지난 이벤트는 사용자 정책에서 닫힌다.
select * from public.request_ticket_cancellation(
  '00000000-0000-4000-8000-000000009501',
  '95100000-0000-4000-8000-000000000003'
) \gset used_
select * from public.request_ticket_cancellation(
  '00000000-0000-4000-8000-000000009501',
  '95100000-0000-4000-8000-000000000004'
) \gset past_
select * from public.request_ticket_cancellation(
  '00000000-0000-4000-8000-000000009501',
  '95100000-0000-4000-8000-000000000005'
) \gset no_cutoff_
select * from public.request_ticket_cancellation(
  '00000000-0000-4000-8000-000000009502',
  '95100000-0000-4000-8000-000000000006'
) \gset foreign_
select * from public.request_ticket_cancellation(
  '00000000-0000-4000-8000-000000009501',
  '95100000-0000-4000-8000-000000000011'
) \gset zero_ticket_
select * from public.request_ticket_cancellation(
  '00000000-0000-4000-8000-000000009501',
  '95100000-0000-4000-8000-000000000012'
) \gset non_valid_
select 1 / case when :'used_result' = 'not_cancelable'
  and :'past_result' = 'policy_closed'
  and :'no_cutoff_result' = 'policy_closed'
  and :'foreign_result' = 'not_found'
  and :'zero_ticket_result' = 'not_cancelable'
  and :'non_valid_result' = 'not_cancelable'
  and not exists (
    select 1 from public.ticket_cancellation_requests
    where ticket_order_id in (
      '95100000-0000-4000-8000-000000000003',
      '95100000-0000-4000-8000-000000000004',
      '95100000-0000-4000-8000-000000000005',
      '95100000-0000-4000-8000-000000000011',
      '95100000-0000-4000-8000-000000000012'
    )
) then 1 else 0 end as assert_used_cutoff_and_ownership_policy;

-- failed-only 장부는 provider-neutral terminal failure로 보아 pending capacity를
-- 즉시 닫고, paid order의 불일치만 계속 fail closed한다.
select * from public.request_ticket_cancellation(
  '00000000-0000-4000-8000-000000009501',
  '95100000-0000-4000-8000-000000000013'
) \gset pending_failed_
select public.begin_ticket_cancellation_reconcile(
  :'pending_failed_request_id'::uuid,
  '00000000-0000-4000-8000-000000009501',
  '95500000-0000-4000-8000-000000000013'
);
select public.complete_ticket_cancellation_request(
  :'pending_failed_request_id'::uuid,
  '95500000-0000-4000-8000-000000000013',
  array[]::text[]
);
select 1 / case when :'pending_failed_result' = 'completed'
  and (
    select status = 'completed'
    from public.ticket_cancellation_requests
    where id = :'pending_failed_request_id'::uuid
  )
  and (
    select status = 'canceled'
    from public.ticket_orders
    where id = '95100000-0000-4000-8000-000000000013'
  )
  and (
    select sold = 0
    from public.ticket_types
    where id = '95000000-0000-4000-8000-000000000013'
  )
  and (
    select status = 'failed'
    from public.payments
    where id = '95400000-0000-4000-8000-000000000016'
  ) then 1 else 0 end as assert_pending_failed_only_requires_explicit_reconcile;

select * from public.request_ticket_cancellation(
  '00000000-0000-4000-8000-000000009501',
  '95100000-0000-4000-8000-000000000014'
) \gset paid_failed_
select public.begin_ticket_cancellation_reconcile(
  :'paid_failed_request_id'::uuid,
  '00000000-0000-4000-8000-000000009501',
  '95500000-0000-4000-8000-000000000014'
);
do $$
declare
  target_request_id uuid;
begin
  select id into target_request_id
  from public.ticket_cancellation_requests
  where ticket_order_id = '95100000-0000-4000-8000-000000000014'
    and status = 'processing';

  begin
    perform public.complete_ticket_cancellation_request(
      target_request_id,
      '95500000-0000-4000-8000-000000000014',
      array[]::text[]
    );
    raise exception 'paid failed-only ledger must not release allocation';
  exception
    when check_violation then
      if sqlerrm <> 'payment evidence required' then raise; end if;
  end;
end;
$$;
select public.mark_ticket_cancellation_needs_review(
  :'paid_failed_request_id'::uuid,
  '95500000-0000-4000-8000-000000000014',
  'paid_without_refund_evidence'
);
select 1 / case when (
  select status = 'needs_review'
  from public.ticket_cancellation_requests
  where id = :'paid_failed_request_id'::uuid
) and (
  select status = 'paid'
  from public.ticket_orders
  where id = '95100000-0000-4000-8000-000000000014'
) and (
  select sold = 1
  from public.ticket_types
  where id = '95000000-0000-4000-8000-000000000014'
) and (
  select status = 'valid'
  from public.tickets
  where ticket_order_id = '95100000-0000-4000-8000-000000000014'
) then 1 else 0 end as assert_paid_failed_only_preserves_allocation_for_review;

-- 모든 non-failed provider key의 fresh 취소 증거가 없으면 다중 결제를 닫지 않는다.
select * from public.request_ticket_cancellation(
  '00000000-0000-4000-8000-000000009501',
  '95100000-0000-4000-8000-000000000006'
) \gset multi_
select public.begin_ticket_cancellation_reconcile(
  :'multi_request_id'::uuid,
  '00000000-0000-4000-8000-000000009501',
  '95500000-0000-4000-8000-000000000006'
);
do $$
declare
  target_request_id uuid;
begin
  select id into target_request_id
  from public.ticket_cancellation_requests
  where ticket_order_id = '95100000-0000-4000-8000-000000000006'
    and status = 'processing';

  begin
    perform public.complete_ticket_cancellation_request(
      target_request_id,
      '95500000-0000-4000-8000-000000000006',
      array['ticket-cancel-multi-paid-key']
    );
    raise exception 'partial provider evidence should fail closed';
  exception
    when check_violation then
      if sqlerrm <> 'provider cancellation required' then raise; end if;
  end;
end;
$$;

select public.complete_ticket_cancellation_request(
  :'multi_request_id'::uuid,
  '95500000-0000-4000-8000-000000000006',
  array['ticket-cancel-multi-pending-key', 'ticket-cancel-multi-paid-key']
);
select 1 / case when (
  select status = 'completed'
  from public.ticket_cancellation_requests
  where id = :'multi_request_id'::uuid
) and (
  select status = 'canceled'
  from public.ticket_orders
  where id = '95100000-0000-4000-8000-000000000006'
) and (
  select count(*) = 2
    and count(*) filter (where status = 'refunded') = 1
    and count(*) filter (where status = 'canceled') = 1
  from public.payments
  where purpose = 'ticket'
    and ref_id = '95100000-0000-4000-8000-000000000006'
) and (
  select sold = 0
  from public.ticket_types
  where id = '95000000-0000-4000-8000-000000000006'
) then 1 else 0 end as assert_multikey_completion_requires_exact_evidence;

-- provider 증거 RPC는 정확한 장부만 받아 paid/pending을 각각 terminal로 수렴한다.
do $$
declare
  invalid_key text;
begin
  foreach invalid_key in array array[
    'ticket-cancel-provider-missing-key',
    'ticket-cancel-provider-wrong-purpose',
    'ticket-cancel-provider-wrong-ref',
    'ticket-cancel-provider-wrong-user',
    'ticket-cancel-provider-wrong-amount'
  ]
  loop
    begin
      perform public.record_ticket_provider_cancellation_evidence(
        '95100000-0000-4000-8000-000000000010',
        'provider evidence validation',
        invalid_key
      );
      raise exception 'invalid provider evidence should be rejected: %', invalid_key;
    exception
      when check_violation then
      if sqlerrm <> 'payment evidence mismatch' then raise; end if;
    end;
  end loop;

  begin
    perform public.record_ticket_provider_cancellation_evidence(
      '95100000-0000-4000-8000-000000000010',
      'missing verified provider raw',
      'ticket-cancel-provider-direct-pending-key',
      null,
      true
    );
    raise exception 'confirmed refund without provider raw must fail';
  exception
    when check_violation then
      if sqlerrm <> 'verified refund evidence required' then raise; end if;
  end;
end;
$$;

select public.record_ticket_provider_cancellation_evidence(
  '95100000-0000-4000-8000-000000000010',
  'provider paid evidence',
  'ticket-cancel-provider-direct-paid-key'
);
select public.record_ticket_provider_cancellation_evidence(
  '95100000-0000-4000-8000-000000000010',
  'provider paid evidence replay',
  'ticket-cancel-provider-direct-paid-key'
);

select 1 / case when (
  select source = 'provider' and status = 'processing' and attempt_token is null
  from public.ticket_cancellation_requests
  where ticket_order_id = '95100000-0000-4000-8000-000000000010'
) then 1 else 0 end as assert_provider_request_starts_without_user_attempt_token;

select public.begin_ticket_cancellation_reconcile(
  (
    select id
    from public.ticket_cancellation_requests
    where ticket_order_id = '95100000-0000-4000-8000-000000000010'
  ),
  '00000000-0000-4000-8000-000000009501',
  '95500000-0000-4000-8000-000000000010'
) as provider_null_attempt_claim_result \gset
select 1 / case when :'provider_null_attempt_claim_result' = 'processing'
  then 1 else 0 end as assert_provider_null_attempt_is_immediately_claimable;

select public.record_ticket_provider_cancellation_evidence(
  '95100000-0000-4000-8000-000000000010',
  'provider pending evidence',
  'ticket-cancel-provider-direct-pending-key',
  '{"paymentKey":"ticket-cancel-provider-direct-pending-key","status":"CANCELED","trace":"provider-raw-direct-pending"}'::jsonb,
  true
);
select public.record_ticket_provider_cancellation_evidence(
  '95100000-0000-4000-8000-000000000010',
  'provider pending evidence replay',
  'ticket-cancel-provider-direct-pending-key'
);

select 1 / case when (
  select status = 'refunded' and raw = '{}'::jsonb
  from public.payments
  where id = '95400000-0000-4000-8000-000000000010'
) and (
  select status = 'refunded'
    and raw = '{"paymentKey":"ticket-cancel-provider-direct-pending-key","status":"CANCELED","trace":"provider-raw-direct-pending"}'::jsonb
  from public.payments
  where id = '95400000-0000-4000-8000-000000000011'
) and (
  select count(*) = 1 and bool_and(status = 'done')
    and bool_and(ticket_cancellation_request_id is not null)
  from public.refunds
  where payment_id = '95400000-0000-4000-8000-000000000010'
) and (
  select count(*) = 1 and bool_and(status = 'done')
    and bool_and(ticket_cancellation_request_id is not null)
  from public.refunds
  where payment_id = '95400000-0000-4000-8000-000000000011'
) and (
  select status = 'paid'
  from public.ticket_orders
  where id = '95100000-0000-4000-8000-000000000010'
) and (
  select sold = 1
  from public.ticket_types
  where id = '95000000-0000-4000-8000-000000000010'
) then 1 else 0 end as assert_direct_provider_evidence_is_exact_durable_and_idempotent;

-- active 요청은 같은 order 잠금 아래 결제 확정과 검표를 모두 차단한다.
select * from public.request_ticket_cancellation(
  '00000000-0000-4000-8000-000000009501',
  '95100000-0000-4000-8000-000000000007'
) \gset confirm_block_
do $$
begin
  begin
    perform public.confirm_ticket_payment(
      'ticket-cancel-confirm-key',
      '95100000-0000-4000-8000-000000000007',
      'ticket-cancel-confirm-key',
      10000,
      '{"status":"DONE"}'::jsonb
    );
    raise exception 'confirmation should be blocked by active cancellation';
  exception
    when check_violation then
      if sqlerrm <> 'ticket cancellation in progress' then raise; end if;
  end;
end;
$$;

select * from public.request_ticket_cancellation(
  '00000000-0000-4000-8000-000000009501',
  '95100000-0000-4000-8000-000000000008'
) \gset checkin_block_

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  begin
    perform *
    from public.check_in_ticket(
      '00000000-0000-4000-8000-000000009503',
      '95300000000040008000000000000010'
    );
    raise exception 'check-in should be blocked by active cancellation';
  exception
    when check_violation then
      if sqlerrm <> 'ticket cancellation in progress' then raise; end if;
  end;
end;
$$;

-- owner RLS은 safe 컬럼만 읽고 다른 사용자의 요청은 숨긴다.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009501', true);
select 1 / case when exists (
  select 1
  from public.ticket_cancellation_requests
  where id = :'checkin_block_request_id'::uuid
) then 1 else 0 end as assert_owner_can_read_safe_request_summary;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000009502', true);
select 1 / case when not exists (
  select 1
  from public.ticket_cancellation_requests
  where id = :'checkin_block_request_id'::uuid
) then 1 else 0 end as assert_other_user_cannot_read_request_summary;

-- webhook 호환 wrapper는 provider 증거를 먼저 남긴 뒤 used 이상을 needs_review로 보존한다.
reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);
select public.refund_ticket_order_with_provider_evidence(
  '95100000-0000-4000-8000-000000000009',
  'provider webhook cancellation',
  'ticket-cancel-provider-used-key'
);
select 1 / case when (
  select source = 'provider' and status = 'needs_review'
    and last_error_code = 'used_ticket_after_provider_cancellation'
  from public.ticket_cancellation_requests
  where ticket_order_id = '95100000-0000-4000-8000-000000000009'
) and (
  select status = 'paid'
  from public.ticket_orders
  where id = '95100000-0000-4000-8000-000000000009'
) and (
  select status = 'used'
  from public.tickets
  where ticket_order_id = '95100000-0000-4000-8000-000000000009'
) and (
  select status = 'refunded'
  from public.payments
  where id = '95400000-0000-4000-8000-000000000009'
) and (
  select count(*) = 1 and bool_and(status = 'done')
    and bool_and(ticket_cancellation_request_id is not null)
  from public.refunds
  where payment_id = '95400000-0000-4000-8000-000000000009'
) and (
  select sold = 1
  from public.ticket_types
  where id = '95000000-0000-4000-8000-000000000009'
) then 1 else 0 end as assert_used_provider_anomaly_preserves_evidence_without_allocation_change;

reset role;

-- audit에는 provider payment key나 원문을 절대 남기지 않는다.
select 1 / case when not exists (
  select 1
  from public.audit_log
  where action like 'ticket.cancellation.%'
    and (
      diff::text like '%ticket-cancel-%-key%'
      or diff::text like '%provider-raw-%'
    )
) then 1 else 0 end as assert_ticket_cancellation_audit_contains_no_provider_secret;

select lower(pg_get_functiondef(
  'public.confirm_ticket_payment(text,uuid,text,bigint,jsonb)'::regprocedure
)) as confirm_definition \gset
select 1 / case when strpos(:'confirm_definition', 'from public.ticket_orders') > 0
  and strpos(:'confirm_definition', 'from public.ticket_cancellation_requests') > 0
  and strpos(:'confirm_definition', 'from public.payments') > 0
  and strpos(:'confirm_definition', 'from public.ticket_orders')
    < strpos(:'confirm_definition', 'from public.ticket_cancellation_requests')
  and strpos(:'confirm_definition', 'from public.ticket_cancellation_requests')
    < strpos(:'confirm_definition', 'from public.payments')
  then 1 else 0 end as assert_confirmation_lock_order_includes_request_before_payment;

select lower(pg_get_functiondef(
  'public.begin_ticket_payment_approval(uuid,uuid,text,bigint)'::regprocedure
)) as approval_definition \gset
select 1 / case when strpos(:'approval_definition', 'from public.ticket_orders') > 0
  and strpos(:'approval_definition', 'from public.ticket_cancellation_requests') > 0
  and strpos(:'approval_definition', 'from public.payments') > 0
  and strpos(:'approval_definition', 'from public.ticket_orders')
    < strpos(:'approval_definition', 'from public.ticket_cancellation_requests')
  and strpos(:'approval_definition', 'from public.ticket_cancellation_requests')
    < strpos(:'approval_definition', 'from public.payments')
  then 1 else 0 end as assert_approval_claim_locks_order_then_request_then_payment;

select lower(pg_get_functiondef(
  'public.check_in_ticket(uuid,text)'::regprocedure
)) as checkin_definition \gset
select 1 / case when strpos(:'checkin_definition', 'from public.ticket_orders') > 0
  and strpos(:'checkin_definition', 'from public.ticket_cancellation_requests') > 0
  and strpos(:'checkin_definition', 'from public.tickets') > 0
  and strpos(:'checkin_definition', 'from public.ticket_orders')
    < strpos(:'checkin_definition', 'from public.ticket_cancellation_requests')
  then 1 else 0 end as assert_checkin_locks_order_before_request_and_ticket;

rollback;
