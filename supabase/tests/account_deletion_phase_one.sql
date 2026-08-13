\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, last_sign_in_at
)
values
  (
    '00000000-0000-4000-8000-000000001371', 'authenticated', 'authenticated',
    'deletion-one@example.test', now(), '{}', '{}', now(), now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000001372', 'authenticated', 'authenticated',
    'deletion-two@example.test', now(), '{}', '{}', now(), now(), now()
  );

update public.profiles
set
  nickname = case id
    when '00000000-0000-4000-8000-000000001371' then 'deletion_one'
    else 'deletion_two'
  end,
  birth_date = '2000-01-01',
  consents = '{"terms":true,"privacy":true,"marketing":true}'::jsonb,
  onboarded_at = now()
where id in (
  '00000000-0000-4000-8000-000000001371',
  '00000000-0000-4000-8000-000000001372'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001371', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select 1 / case when public.preview_my_account_deletion() =
  jsonb_build_object(
    'available', false,
    'eligible', false,
    'blockers', jsonb_build_array(
      jsonb_build_object('code', 'not_available', 'count', 1, 'path', '/settings')
    )
  )
then 1 else 0 end as assert_phase_one_is_default_off;

do $$
begin
  begin
    perform public.request_my_account_deletion(
      '회원 탈퇴를 신청합니다',
      '00000000-0000-4000-8000-000000001399'
    );
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm = 'account_deletion_not_available' then return; end if;
      raise;
  end;
  raise exception 'default-off gate should reject deletion requests';
end;
$$;

reset role;

do $$
begin
  begin
    update private.account_deletion_control
    set phase_one_enabled = true;
  exception
    when check_violation then return;
  end;
  raise exception 'account deletion activation should require every retention evidence seam';
end;
$$;

update private.account_deletion_control
set
  transaction_lookup_hmac_ready = true,
  legacy_transaction_evidence_ready = true,
  immutable_ticket_contract_ready = true,
  community_legal_records_ready = true,
  phase_one_enabled = true;

set local role authenticated;

select 1 / case when public.preview_my_account_deletion() =
  jsonb_build_object('available', true, 'eligible', true, 'blockers', '[]'::jsonb)
then 1 else 0 end as assert_empty_self_is_eligible;

reset role;

update auth.users
set last_sign_in_at = now() - interval '11 minutes'
where id = '00000000-0000-4000-8000-000000001371';

set local role authenticated;

do $$
begin
  begin
    perform public.request_my_account_deletion(
      '회원 탈퇴를 신청합니다',
      '00000000-0000-4000-8000-000000001399'
    );
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm = 'account_deletion_reauthentication_required' then return; end if;
      raise;
  end;
  raise exception 'stale authentication should not authorize an account deletion request';
end;
$$;

reset role;

update auth.users
set last_sign_in_at = now()
where id = '00000000-0000-4000-8000-000000001371';

insert into public.payments (
  id, user_id, purpose, ref_id, amount, status, idempotency_key
)
values (
  '00000000-0000-4000-8000-000000001305',
  '00000000-0000-4000-8000-000000001371',
  'order', '00000000-0000-4000-8000-000000001399',
  1000, 'pending', 'legacy-pending-payment'
);

insert into public.payment_attempts (
  id, provider, user_id, purpose, ref_id, amount, state, idempotency_key,
  provider_order_id, provider_product_code, payment_id, expires_at
)
values (
  '00000000-0000-4000-8000-000000001309', 'toss',
  '00000000-0000-4000-8000-000000001371', 'order',
  '00000000-0000-4000-8000-000000001399', 1000, 'unknown',
  'legacy-pending-payment-attempt', 'legacy-pending-order',
  'legacy-pending-product', '00000000-0000-4000-8000-000000001305',
  now() + interval '10 minutes'
);

set local role authenticated;

select 1 / case when public.preview_my_account_deletion() =
  jsonb_build_object(
    'available', true,
    'eligible', false,
    'blockers', jsonb_build_array(
      jsonb_build_object(
        'code', 'active_order_payment',
        'count', 1,
        'path', '/orders'
      )
    )
  )
then 1 else 0 end as assert_legacy_pending_payment_fails_closed;

reset role;

update public.payments
set status = 'failed'
where id = '00000000-0000-4000-8000-000000001305';

update public.payment_attempts
set state = 'declined'
where id = '00000000-0000-4000-8000-000000001309';

insert into public.payments (
  id, user_id, purpose, ref_id, amount, status, idempotency_key
)
values (
  '00000000-0000-4000-8000-000000001307',
  '00000000-0000-4000-8000-000000001371',
  'ticket', '00000000-0000-4000-8000-000000001397',
  1000, 'paid', 'pending-ticket-refund-payment'
);

insert into public.refunds (id, payment_id, amount, reason, status)
values (
  '00000000-0000-4000-8000-000000001308',
  '00000000-0000-4000-8000-000000001307',
  1000, 'must-not-be-snapshotted', 'requested'
);

set local role authenticated;

select 1 / case when public.preview_my_account_deletion() =
  jsonb_build_object(
    'available', true,
    'eligible', false,
    'blockers', jsonb_build_array(
      jsonb_build_object(
        'code', 'active_ticket_refund',
        'count', 1,
        'path', '/tickets'
      )
    )
  )
then 1 else 0 end as assert_ticket_refund_uses_ticket_resolution_path;

reset role;

update public.refunds
set status = 'done'
where id = '00000000-0000-4000-8000-000000001308';

set local role authenticated;

do $$
begin
  begin
    perform public.request_my_account_deletion(
      '틀린 확인 문구',
      '00000000-0000-4000-8000-000000001399'
    );
  exception
    when check_violation then
      if sqlerrm = 'account_deletion_confirmation_mismatch' then return; end if;
      raise;
  end;
  raise exception 'exact irreversible confirmation should be required';
end;
$$;

reset role;

insert into public.orders (id, user_id, status, total, address)
values
  (
    '00000000-0000-4000-8000-000000001301',
    '00000000-0000-4000-8000-000000001371',
    'pending', 11000,
    '{"recipient":"do-not-copy","address":"secret"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000001302',
    '00000000-0000-4000-8000-000000001372',
    'done', 22000,
    '{"recipient":"other-private-value"}'::jsonb
  );

insert into public.orders (
  id, user_id, status, total, address, shipping_carrier, tracking_number,
  shipped_at, delivered_at
)
values (
  '00000000-0000-4000-8000-000000001306',
  '00000000-0000-4000-8000-000000001371',
  'done', 33000,
  '{"recipient":"never-snapshot","phone":"010-secret"}'::jsonb,
  'hanjin', '123456789012',
  '2026-08-01T01:00:00Z', '2026-08-02T02:00:00Z'
);

insert into public.order_cancellation_requests (
  id, order_id, requested_by, reason, reason_type, status,
  decided_at, provider_started_at, completed_at, requested_at
)
values (
  '00000000-0000-4000-8000-000000001310',
  '00000000-0000-4000-8000-000000001306',
  '00000000-0000-4000-8000-000000001371',
  'free text must not be snapshotted', 'defect', 'completed',
  '2026-08-03T01:00:00Z', '2026-08-03T02:00:00Z',
  '2026-08-03T03:00:00Z', '2026-08-03T00:00:00Z'
);

insert into public.payments (
  id, user_id, purpose, ref_id, provider, amount, status, idempotency_key
)
values (
  '00000000-0000-4000-8000-000000001311',
  '00000000-0000-4000-8000-000000001371',
  'order', '00000000-0000-4000-8000-000000001306', 'korpay',
  33000, 'paid', 'legal-snapshot-order-payment'
);

insert into public.payment_attempts (
  id, provider, user_id, purpose, ref_id, amount, state, idempotency_key,
  provider_order_id, provider_product_code, payment_id, expires_at
)
values (
  '00000000-0000-4000-8000-000000001312', 'korpay',
  '00000000-0000-4000-8000-000000001371', 'order',
  '00000000-0000-4000-8000-000000001306', 33000, 'approved',
  'legal-snapshot-order-attempt', 'O00000000000040008000000000001312',
  'P00000000000040008000000000001312',
  '00000000-0000-4000-8000-000000001311', now() + interval '10 minutes'
);

insert into private.payment_provider_evidence (
  id, payment_attempt_id, evidence_kind, provider_transaction_id, approved_at
)
values (
  '00000000-0000-4000-8000-000000001313',
  '00000000-0000-4000-8000-000000001312',
  'confirm', 'private-provider-transaction', '2026-08-01T00:30:00Z'
);

insert into public.refunds (
  id, payment_id, amount, reason, status, cancellation_request_id
)
values (
  '00000000-0000-4000-8000-000000001314',
  '00000000-0000-4000-8000-000000001311',
  33000, 'private refund reason', 'done',
  '00000000-0000-4000-8000-000000001310'
);

insert into public.events (
  id, title, mode, status, starts_at, ends_at
)
values (
  'account-deletion-legal-event', '법정 snapshot 이벤트', '오프라인', '종료',
  '2026-08-04T01:00:00Z', '2026-08-04T03:00:00Z'
);

insert into public.ticket_types (
  id, event_id, name, price, capacity
)
values (
  '00000000-0000-4000-8000-000000001315',
  'account-deletion-legal-event', '오후 회차', 15000, 10
);

insert into public.ticket_orders (
  id, user_id, event_id, status, total
)
values (
  '00000000-0000-4000-8000-000000001316',
  '00000000-0000-4000-8000-000000001371',
  'account-deletion-legal-event', 'canceled', 15000
);

insert into public.tickets (
  id, ticket_order_id, ticket_type_id, qr_token, status
)
values (
  '00000000-0000-4000-8000-000000001317',
  '00000000-0000-4000-8000-000000001316',
  '00000000-0000-4000-8000-000000001315',
  'private-qr-token', 'refunded'
);

insert into public.check_ins (ticket_id, checked_at)
values (
  '00000000-0000-4000-8000-000000001317',
  '2026-08-04T01:30:00Z'
);

insert into public.ticket_cancellation_requests (
  id, ticket_order_id, requested_by, source, status, policy_code, cutoff_at,
  gross_amount, fee_amount, refund_amount, reason, provider_started_at,
  completed_at, requested_at
)
values (
  '00000000-0000-4000-8000-000000001318',
  '00000000-0000-4000-8000-000000001316',
  '00000000-0000-4000-8000-000000001371',
  'user', 'completed', 'event_start_full_refund_v1', '2026-08-04T01:00:00Z',
  15000, 0, 15000, 'free text ticket reason',
  '2026-08-03T05:00:00Z', '2026-08-03T06:00:00Z', '2026-08-03T04:00:00Z'
);

insert into public.payments (
  id, user_id, purpose, ref_id, amount, status, idempotency_key
)
values (
  '00000000-0000-4000-8000-000000001319',
  '00000000-0000-4000-8000-000000001371',
  'ticket', '00000000-0000-4000-8000-000000001316',
  15000, 'refunded', 'legal-snapshot-ticket-payment'
);

insert into public.refunds (
  id, payment_id, amount, reason, status, ticket_cancellation_request_id
)
values (
  '00000000-0000-4000-8000-000000001320',
  '00000000-0000-4000-8000-000000001319',
  15000, 'private ticket refund reason', 'done',
  '00000000-0000-4000-8000-000000001318'
);

insert into public.posts (id, user_id, text, status)
values (
  '00000000-0000-4000-8000-000000001303',
  '00000000-0000-4000-8000-000000001371',
  'existing community text',
  'visible'
);

insert into public.payment_attempts (
  id,
  provider,
  user_id,
  purpose,
  ref_id,
  amount,
  state,
  idempotency_key,
  provider_order_id,
  provider_product_code,
  expires_at
)
values (
  '00000000-0000-4000-8000-000000001304',
  'toss',
  '00000000-0000-4000-8000-000000001371',
  'order',
  '00000000-0000-4000-8000-000000001301',
  11000,
  'unknown',
  'deletion-unknown-attempt',
  'legacy-order-unknown',
  'legacy-product-unknown',
  now() + interval '10 minutes'
);

set local role service_role;

select 1 / case when public.service_prepare_profile_avatar_claim(
  '00000000-0000-4000-8000-000000001371',
  '00000000-0000-4000-8000-000000001371/profile/99999999-9999-4999-8999-999999999999.png'
) then 1 else 0 end as assert_profile_upload_is_prepared_before_deletion_fence;

reset role;
set local role authenticated;

select 1 / case when public.preview_my_account_deletion() =
  jsonb_build_object(
    'available', true,
    'eligible', false,
    'blockers', jsonb_build_array(
      jsonb_build_object('code', 'active_order', 'count', 1, 'path', '/orders'),
      jsonb_build_object('code', 'active_order_payment', 'count', 1, 'path', '/orders')
    )
  )
then 1 else 0 end as assert_only_self_obligations_are_evaluated;

select 1 / case when public.request_my_account_deletion(
  '회원 탈퇴를 신청합니다',
  '00000000-0000-4000-8000-000000001399'
) = jsonb_build_object(
  'status', 'blocked',
  'phase', 'fenced',
  'nextAction', '/orders',
  'blockers', jsonb_build_array(
    jsonb_build_object('code', 'active_order', 'count', 1, 'path', '/orders'),
    jsonb_build_object('code', 'active_order_payment', 'count', 1, 'path', '/orders')
  )
)
then 1 else 0 end as assert_request_returns_only_opaque_status;

select 1 / case when public.request_my_account_deletion(
  '회원 탈퇴를 신청합니다',
  '00000000-0000-4000-8000-000000001399'
) ->> 'status' = 'blocked'
then 1 else 0 end as assert_same_key_is_idempotent;

do $$
begin
  begin
    perform public.request_my_account_deletion(
      '회원 탈퇴를 신청합니다',
      '00000000-0000-4000-8000-000000001398'
    );
  exception
    when unique_violation then
      if sqlerrm = 'account_deletion_idempotency_conflict' then return; end if;
      raise;
  end;
  raise exception 'a different key must not replace the durable request';
end;
$$;

select 1 / case when public.get_my_account_deletion_status() =
  jsonb_build_object(
    'status', 'blocked',
    'phase', 'fenced',
    'nextAction', '/orders',
    'blockers', jsonb_build_array(
    jsonb_build_object('code', 'active_order', 'count', 1, 'path', '/orders'),
    jsonb_build_object('code', 'active_order_payment', 'count', 1, 'path', '/orders')
    )
  )
then 1 else 0 end as assert_self_status_has_no_internal_identifier;

reset role;

select 1 / case when (
  select count(*) = 1 from private.account_deletion_requests
  where subject_user_id = '00000000-0000-4000-8000-000000001371'
) and (
  select count(*) = 1 from private.account_action_fences
  where subject_user_id = '00000000-0000-4000-8000-000000001371'
) then 1 else 0 end as assert_request_and_fence_are_atomic_and_unique;

select 1 / case when exists (
  select 1
  from private.account_deletion_legal_snapshots
  where record_type = 'order'
    and record_ref = '00000000-0000-4000-8000-000000001301'
    and legal_basis = 'ecommerce_transaction_v1'
    and retain_until > now() + interval '4 years 11 months'
    and snapshot_data = jsonb_build_object(
      'orderRef', '00000000-0000-4000-8000-000000001301',
      'status', 'pending',
      'total', 11000,
      'shippingFee', 0,
      'contractedAt', (select created_at from public.orders where id = '00000000-0000-4000-8000-000000001301'),
      'items', '[]'::jsonb
    )
) then 1 else 0 end as assert_legal_snapshot_is_allowlisted_and_minimal;

select 1 / case when not exists (
  select 1
  from private.account_deletion_legal_snapshots
  where snapshot_data::text like '%do-not-copy%'
     or snapshot_data::text like '%secret%'
     or snapshot_data::text like '%free text must not be snapshotted%'
     or snapshot_data::text like '%private refund reason%'
     or snapshot_data::text like '%private ticket refund reason%'
     or snapshot_data::text like '%private-qr-token%'
     or snapshot_data ? 'email'
     or snapshot_data ? 'address'
) then 1 else 0 end as assert_raw_pii_is_not_snapshotted;

select 1 / case when (
  select array_agg(distinct record_type order by record_type)
  from private.account_deletion_legal_snapshots
) @> array[
  'order_cancellation', 'shipment', 'payment', 'refund',
  'ticket_order', 'ticket_cancellation', 'ticket_check_in'
]::text[] then 1 else 0 end as assert_required_legal_record_types_are_snapshotted;

select 1 / case when exists (
  select 1
  from private.account_deletion_legal_snapshots
  where record_type = 'order_cancellation'
    and record_ref = '00000000-0000-4000-8000-000000001310'
    and snapshot_data = jsonb_build_object(
      'cancellationRef', '00000000-0000-4000-8000-000000001310',
      'orderRef', '00000000-0000-4000-8000-000000001306',
      'status', 'completed',
      'decision', 'approved',
      'reasonType', 'defect',
      'requestedAt', '2026-08-03T00:00:00+00'::timestamptz,
      'decidedAt', '2026-08-03T01:00:00+00'::timestamptz,
      'providerStartedAt', '2026-08-03T02:00:00+00'::timestamptz,
      'completedAt', '2026-08-03T03:00:00+00'::timestamptz
    )
) then 1 else 0 end as assert_withdrawal_decision_is_allowlisted;

select 1 / case when exists (
  select 1
  from private.account_deletion_legal_snapshots
  where record_type = 'shipment'
    and record_ref = '00000000-0000-4000-8000-000000001306'
    and snapshot_data ->> 'carrier' = 'hanjin'
    and snapshot_data ->> 'shippedAt' is not null
    and snapshot_data ->> 'suppliedAt' is not null
    and snapshot_data ->> 'opaqueTrackingRef' ~ '^[0-9a-f]{64}$'
    and snapshot_data -> 'trackingKeyVersion' = '1'::jsonb
    and snapshot_data::text not like '%123456789012%'
) then 1 else 0 end as assert_shipping_snapshot_uses_opaque_tracking_ref;

select 1 / case when exists (
  select 1
  from private.account_deletion_legal_snapshots
  where record_type = 'payment'
    and record_ref = '00000000-0000-4000-8000-000000001311'
    and (snapshot_data ->> 'approvedAt')::timestamptz = '2026-08-01T00:30:00Z'
    and snapshot_data::text not like '%private-provider-transaction%'
) and exists (
  select 1
  from private.account_deletion_legal_snapshots
  where record_type = 'refund'
    and record_ref = '00000000-0000-4000-8000-000000001314'
    and (snapshot_data ->> 'refundedAt')::timestamptz = '2026-08-03T03:00:00Z'
) then 1 else 0 end as assert_payment_approval_and_refund_times_are_preserved;

select 1 / case when not exists (
  select 1
  from private.account_deletion_legal_snapshots
  where record_type in ('payment', 'refund', 'shipment')
    and (
      (record_type = 'payment' and snapshot_data ->> 'approvedAt' is null)
      or (record_type = 'refund' and snapshot_data ->> 'refundedAt' is null)
      or (record_type = 'shipment' and snapshot_data ->> 'suppliedAt' is null)
    )
) then 1 else 0 end as assert_unverified_approval_refund_and_supply_facts_are_not_snapshotted;

select 1 / case when exists (
  select 1
  from private.account_deletion_legal_snapshots
  where record_type = 'ticket_cancellation'
    and record_ref = '00000000-0000-4000-8000-000000001318'
    and snapshot_data ->> 'policyCode' = 'event_start_full_refund_v1'
    and (snapshot_data ->> 'completedAt')::timestamptz = '2026-08-03T06:00:00Z'
) and exists (
  select 1
  from private.account_deletion_legal_snapshots
  where record_type = 'ticket_check_in'
    and record_ref = '00000000-0000-4000-8000-000000001317'
    and (snapshot_data ->> 'checkedAt')::timestamptz = '2026-08-04T01:30:00Z'
    and not (snapshot_data ? 'byStaff')
) then 1 else 0 end as assert_ticket_cancellation_and_check_in_are_allowlisted;

select 1 / case when not exists (
  select 1
  from private.account_deletion_legal_snapshots
  where record_type = 'ticket_order'
    and (
      snapshot_data ? 'eventTitle'
      or snapshot_data ? 'eventStartsAt'
      or snapshot_data ? 'eventEndsAt'
      or snapshot_data ? 'ticketTypes'
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(snapshot_data -> 'tickets') as ticket
        where ticket ? 'ticketTypeName' or ticket ? 'unitPrice'
      )
    )
) then 1 else 0 end as assert_mutable_ticket_catalog_is_not_legal_evidence;

reset role;

update public.orders
set status = 'done'
where id = '00000000-0000-4000-8000-000000001301';

update public.payment_attempts
set state = 'declined'
where id = '00000000-0000-4000-8000-000000001304';

set local role authenticated;

select 1 / case when public.get_my_account_deletion_status() =
  jsonb_build_object(
    'status', 'processing',
    'phase', 'awaiting_notification',
    'nextAction', 'retry_later',
    'blockers', '[]'::jsonb
  )
then 1 else 0 end as assert_status_reconciles_after_obligations_finish;

reset role;

select 1 / case when exists (
  select 1
  from private.account_deletion_legal_snapshots
  where record_type = 'order'
    and record_ref = '00000000-0000-4000-8000-000000001301'
    and snapshot_data ->> 'status' = 'done'
) then 1 else 0 end as assert_reconcile_refreshes_existing_legal_snapshot;

do $$
begin
  begin
    insert into public.orders (user_id, status, total)
    values ('00000000-0000-4000-8000-000000001371', 'pending', 0);
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm = 'account_deletion_write_fenced' then return; end if;
      raise;
  end;
  raise exception 'new commerce writes should be fenced';
end;
$$;

do $$
begin
  begin
    update public.posts
    set text = 'fenced edit'
    where id = '00000000-0000-4000-8000-000000001303';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm = 'account_deletion_write_fenced' then return; end if;
      raise;
  end;
  raise exception 'community edits should be fenced';
end;
$$;

update public.posts
set status = 'hidden'
where id = '00000000-0000-4000-8000-000000001303';

reset role;
set local role service_role;

do $$
begin
  begin
    perform public.service_prepare_profile_avatar_claim(
      '00000000-0000-4000-8000-000000001371',
      '00000000-0000-4000-8000-000000001371/profile/11111111-1111-4111-8111-111111111111.png'
    );
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm = 'account_deletion_write_fenced' then return; end if;
      raise;
  end;
  raise exception 'new profile Storage claims should be fenced';
end;
$$;

reset role;

update private.community_write_control
set post_create_enabled = true
where singleton;

insert into storage.objects (bucket_id, name, owner_id, metadata)
values (
  'user-uploads',
  '00000000-0000-4000-8000-000000001371/community/88888888-8888-4888-8888-888888888888.png',
  '00000000-0000-4000-8000-000000001371',
  '{"stage":"before-fence-update"}'::jsonb
);

create policy account_deletion_test_user_upload_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'user-uploads'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'user-uploads'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001371', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'user-uploads',
      '00000000-0000-4000-8000-000000001371/profile/99999999-9999-4999-8999-999999999999.png',
      '00000000-0000-4000-8000-000000001371'
    );
  exception
    when insufficient_privilege then return;
  end;
  raise exception 'prepared profile upload redemption after deletion fence should be rejected by Data API RLS';
end;
$$;

do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'user-uploads',
      '00000000-0000-4000-8000-000000001371/community/66666666-6666-4666-8666-666666666666.png',
      '00000000-0000-4000-8000-000000001371'
    );
  exception
    when insufficient_privilege then return;
  end;
  raise exception 'fenced community Storage INSERT should be rejected by Data API RLS';
end;
$$;

do $$
declare
  affected integer;
begin
  update storage.objects
  set metadata = '{"stage":"after-fence-update"}'::jsonb
  where bucket_id = 'user-uploads'
    and name = '00000000-0000-4000-8000-000000001371/community/88888888-8888-4888-8888-888888888888.png';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'fenced community Storage UPDATE should be rejected by Data API RLS';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001372', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into storage.objects (bucket_id, name, owner_id)
values (
  'user-uploads',
  '00000000-0000-4000-8000-000000001372/community/77777777-7777-4777-8777-777777777777.png',
  '00000000-0000-4000-8000-000000001372'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001371', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  begin
    update public.profiles
    set consents = jsonb_set(consents, '{marketing}', 'false'::jsonb)
    where id = '00000000-0000-4000-8000-000000001371';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm = 'account_deletion_write_fenced' then return; end if;
      raise;
  end;
  raise exception 'profile and marketing writes should be fenced';
end;
$$;

reset role;

-- Existing obligations remain reconcilable after the fence.
update public.orders
set updated_at = pg_catalog.now()
where id = '00000000-0000-4000-8000-000000001301';

select 1 / case when not has_table_privilege(
  'anon', 'private.account_deletion_requests', 'SELECT'
)
  and not has_table_privilege('anon', 'private.account_deletion_control', 'SELECT')
  and not has_table_privilege('authenticated', 'private.account_deletion_control', 'SELECT')
  and not has_table_privilege('service_role', 'private.account_deletion_control', 'SELECT')
  and not has_table_privilege('authenticated', 'private.account_deletion_requests', 'SELECT')
  and not has_table_privilege('service_role', 'private.account_deletion_requests', 'SELECT')
  and not has_table_privilege('service_role', 'private.account_deletion_legal_snapshots', 'SELECT')
then 1 else 0 end as assert_private_ledgers_are_not_data_api_readable;

select 1 / case when (
  select count(*) = 2
    and bool_and(not policy.polpermissive)
    and bool_and(policy.polroles = array['authenticated'::regrole::oid])
    and bool_and(policy.polcmd in ('a', 'w'))
  from pg_catalog.pg_policy as policy
  where policy.polrelid = 'storage.objects'::regclass
    and policy.polname in (
      'user_uploads_account_fence_insert',
      'user_uploads_account_fence_update'
    )
) then 1 else 0 end as assert_account_storage_fence_is_restrictive;

select 1 / case when not has_function_privilege(
  'anon', 'public.request_my_account_deletion(text,uuid)', 'EXECUTE'
) and has_function_privilege(
  'authenticated', 'public.request_my_account_deletion(text,uuid)', 'EXECUTE'
) and not has_function_privilege(
  'authenticated', 'private.reconcile_account_deletion_request(uuid)', 'EXECUTE'
) and not has_function_privilege(
  'authenticated', 'private.is_account_write_fenced(uuid)', 'EXECUTE'
) and not has_function_privilege(
  'authenticated', 'private.has_recent_account_authentication(uuid)', 'EXECUTE'
) and not has_function_privilege(
  'anon', 'private.can_write_account_storage_object()', 'EXECUTE'
) and has_function_privilege(
  'authenticated', 'private.can_write_account_storage_object()', 'EXECUTE'
) then 1 else 0 end as assert_self_rpc_grants_are_minimal;

rollback;
