\set ON_ERROR_STOP on

begin;

select 1 / case when (
  has_function_privilege(
    'service_role',
    'public.claim_goods_manual_payment_recovery(uuid,uuid,uuid,text,text,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.finalize_goods_manual_payment_recovery(uuid,uuid,uuid,text,text,uuid,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'public',
    'public.claim_goods_manual_payment_recovery(uuid,uuid,uuid,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.claim_goods_manual_payment_recovery(uuid,uuid,uuid,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.finalize_goods_manual_payment_recovery(uuid,uuid,uuid,text,text,uuid,boolean)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.admin_goods_manual_recovery_attempts(uuid[])',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.admin_goods_manual_recovery_attempts(uuid[])',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.admin_goods_manual_recovery_attempts(uuid[])',
    'execute'
  )
) then 1 else 0 end as assert_manual_recovery_is_service_only;

select 1 / case when not exists (
  select 1
  from pg_catalog.pg_proc as procedure
  cross join lateral pg_catalog.unnest(procedure.proargnames) as argument(name)
  where procedure.oid in (
    'public.claim_goods_manual_payment_recovery(uuid,uuid,uuid,text,text,uuid)'::regprocedure,
    'public.finalize_goods_manual_payment_recovery(uuid,uuid,uuid,text,text,uuid,boolean)'::regprocedure
  )
    and argument.name ilike any(array[
      '%payment_key%', '%paymentkey%', '%tid%', '%pan%', '%raw%', '%payload%', '%response%'
    ])
) then 1 else 0 end as assert_manual_recovery_accepts_no_provider_secret_or_raw_payload;

select 1 / case when pg_catalog.strpos(
  pg_catalog.pg_get_functiondef(
    'public.admin_goods_manual_recovery_attempts(uuid[])'::regprocedure
  ),
  'attempt.claim_expires_at is null'
) > 0 then 1 else 0 end as assert_null_confirming_lease_matches_claim_takeover_contract;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000002081',
    'authenticated', 'authenticated', 'goods-manual-owner@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000002082',
    'authenticated', 'authenticated', 'goods-manual-staff@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000002083',
    'authenticated', 'authenticated', 'goods-manual-fan@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000002084',
    'authenticated', 'authenticated', 'goods-manual-decider@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000002085',
    'authenticated', 'authenticated', 'goods-manual-operator@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (
  id, email, nickname, birth_date, consents, onboarded_at, role
)
values
  (
    '00000000-0000-4000-8000-000000002081',
    'goods-manual-owner@example.test', 'goods_manual_owner', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  ),
  (
    '00000000-0000-4000-8000-000000002082',
    'goods-manual-staff@example.test', 'goods_manual_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  ),
  (
    '00000000-0000-4000-8000-000000002083',
    'goods-manual-fan@example.test', 'goods_manual_fan', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  ),
  (
    '00000000-0000-4000-8000-000000002084',
    'goods-manual-decider@example.test', 'goods_manual_decider', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'admin'
  ),
  (
    '00000000-0000-4000-8000-000000002085',
    'goods-manual-operator@example.test', 'goods_manual_operator', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'admin'
  )
on conflict (id) do update set
  role = excluded.role,
  suspended_at = null,
  suspension_reason = null;

insert into public.verticals (key, label, color)
values ('goods-manual-recovery', '굿즈 수동 복구', '#000000')
on conflict (key) do nothing;

insert into public.ips (id, title, vertical_key)
values ('goods-manual-recovery-ip', '굿즈 수동 복구 IP', 'goods-manual-recovery')
on conflict (id) do update set title = excluded.title;

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values (
  'goods-manual-recovery-good',
  'goods-manual-recovery-ip',
  '굿즈 수동 복구 상품',
  '문구',
  107000,
  'ok',
  10
)
on conflict (id) do update set stock_qty = excluded.stock_qty;

insert into public.orders (
  id, user_id, status, total, shipping_fee, expires_at, checkout_key
)
select
  fixture.order_id,
  '00000000-0000-4000-8000-000000002081',
  fixture.status::public.order_status,
  110000,
  3000,
  case when fixture.status = 'pending' then now() + interval '15 minutes' else null end,
  fixture.checkout_key
from (
  values
    ('20000000-0000-4000-8000-000000002081'::uuid, 'pending', '10000000-0000-4000-8000-000000002081'::uuid),
    ('20000000-0000-4000-8000-000000002082'::uuid, 'pending', '10000000-0000-4000-8000-000000002082'::uuid),
    ('20000000-0000-4000-8000-000000002083'::uuid, 'pending', '10000000-0000-4000-8000-000000002083'::uuid),
    ('20000000-0000-4000-8000-000000002084'::uuid, 'paid', '10000000-0000-4000-8000-000000002084'::uuid),
    ('20000000-0000-4000-8000-000000002085'::uuid, 'pending', '10000000-0000-4000-8000-000000002085'::uuid)
) as fixture(order_id, status, checkout_key);

insert into public.order_items (
  order_id, good_id, qty, unit_price,
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot
)
select
  order_record.id,
  'goods-manual-recovery-good',
  1,
  107000,
  '굿즈 수동 복구 상품',
  '문구',
  'goods-manual-recovery-ip'
from public.orders as order_record
where order_record.id between
  '20000000-0000-4000-8000-000000002081'::uuid
  and '20000000-0000-4000-8000-000000002085'::uuid;

insert into public.payment_attempts (
  id, provider, user_id, purpose, ref_id, amount, currency, state,
  idempotency_key, provider_order_id, provider_product_code,
  claim_token, claim_expires_at, expires_at
)
select
  fixture.attempt_id,
  'korpay',
  '00000000-0000-4000-8000-000000002081',
  'order',
  fixture.order_id,
  110000,
  'KRW',
  fixture.state::public.payment_attempt_state,
  'goods-manual:' || fixture.order_id::text,
  'O' || pg_catalog.replace(fixture.attempt_id::text, '-', ''),
  'P' || pg_catalog.replace(fixture.attempt_id::text, '-', ''),
  fixture.claim_token,
  fixture.claim_expires_at,
  now() + interval '10 minutes'
from (
  values
    ('30000000-0000-4000-8000-000000002081'::uuid, '20000000-0000-4000-8000-000000002081'::uuid, 'unknown', null::uuid, null::timestamptz),
    ('30000000-0000-4000-8000-000000002082'::uuid, '20000000-0000-4000-8000-000000002082'::uuid, 'confirming', '40000000-0000-4000-8000-000000002082'::uuid, now() + interval '10 minutes'),
    ('30000000-0000-4000-8000-000000002083'::uuid, '20000000-0000-4000-8000-000000002083'::uuid, 'confirming', '40000000-0000-4000-8000-000000002083'::uuid, now() - interval '1 minute'),
    ('30000000-0000-4000-8000-000000002084'::uuid, '20000000-0000-4000-8000-000000002084'::uuid, 'approved', null::uuid, null::timestamptz),
    ('30000000-0000-4000-8000-000000002085'::uuid, '20000000-0000-4000-8000-000000002085'::uuid, 'prepared', null::uuid, null::timestamptz)
) as fixture(attempt_id, order_id, state, claim_token, claim_expires_at);

insert into public.payments (
  id, user_id, purpose, ref_id, provider, amount, status,
  payment_key, idempotency_key, raw
)
values (
  '50000000-0000-4000-8000-000000002084',
  '00000000-0000-4000-8000-000000002081',
  'order',
  '20000000-0000-4000-8000-000000002084',
  'korpay',
  110000,
  'paid',
  'existing-provider-key-2084',
  'attempt:30000000-0000-4000-8000-000000002084',
  null
);

update public.payment_attempts
set payment_id = '50000000-0000-4000-8000-000000002084'
where id = '30000000-0000-4000-8000-000000002084';

insert into public.order_cancellation_requests (
  id, order_id, requested_by, reason, reason_type, status, decided_by,
  decided_at, provider_started_at, last_error_code
)
select
  fixture.request_id,
  fixture.order_id,
  '00000000-0000-4000-8000-000000002081',
  '결제사 전액 취소 확인 후 정합화',
  'change_of_mind',
  'needs_review',
  '00000000-0000-4000-8000-000000002084',
  now(),
  now(),
  'manual_provider_confirmation_required'
from (
  values
    ('60000000-0000-4000-8000-000000002081'::uuid, '20000000-0000-4000-8000-000000002081'::uuid),
    ('60000000-0000-4000-8000-000000002082'::uuid, '20000000-0000-4000-8000-000000002082'::uuid),
    ('60000000-0000-4000-8000-000000002083'::uuid, '20000000-0000-4000-8000-000000002083'::uuid),
    ('60000000-0000-4000-8000-000000002084'::uuid, '20000000-0000-4000-8000-000000002084'::uuid),
    ('60000000-0000-4000-8000-000000002085'::uuid, '20000000-0000-4000-8000-000000002085'::uuid)
) as fixture(request_id, order_id);

insert into public.order_cancellation_claims (order_id, requested_by, previous_status)
select
  request.order_id,
  request.requested_by,
  order_record.status
from public.order_cancellation_requests as request
join public.orders as order_record on order_record.id = request.order_id
where request.id between
  '60000000-0000-4000-8000-000000002081'::uuid
  and '60000000-0000-4000-8000-000000002085'::uuid;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000002082',
  true
);

do $manual_recovery_safe_summary_requires_admin$
declare
  rejected boolean := false;
begin
  begin
    perform *
    from public.admin_goods_manual_recovery_attempts(array[
      '20000000-0000-4000-8000-000000002081'::uuid
    ]);
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'safe provider summary must require admin'; end if;
end;
$manual_recovery_safe_summary_requires_admin$;

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000002085',
  true
);

select 1 / case when (
  select
    count(*) = 5
    and bool_and(provider_order_id like 'O%')
    and bool_and(currency = 'KRW')
    and bool_and(
      case
        when order_id = '20000000-0000-4000-8000-000000002081' then manual_recovery_available
        when order_id in (
          '20000000-0000-4000-8000-000000002082',
          '20000000-0000-4000-8000-000000002085'
        ) then not manual_recovery_available
        else true
      end
    )
  from public.admin_goods_manual_recovery_attempts(array[
    '20000000-0000-4000-8000-000000002081'::uuid,
    '20000000-0000-4000-8000-000000002082'::uuid,
    '20000000-0000-4000-8000-000000002083'::uuid,
    '20000000-0000-4000-8000-000000002084'::uuid,
    '20000000-0000-4000-8000-000000002085'::uuid
  ])
) then 1 else 0 end as assert_admin_reads_only_related_safe_attempt_summary;

reset role;

do $manual_recovery_order_attempt_invariants$
declare
  rejected boolean;
begin
  update public.payment_attempts
  set user_id = '00000000-0000-4000-8000-000000002083'
  where id = '30000000-0000-4000-8000-000000002081';
  rejected := false;
  begin
    perform public.claim_goods_manual_payment_recovery(
      '30000000-0000-4000-8000-000000002081',
      '00000000-0000-4000-8000-000000002085',
      '60000000-0000-4000-8000-000000002081',
      'case_v1_11111111111111111111111111111111',
      'provider_cancel_confirmed',
      '71000000-0000-4000-8000-000000002081'
    );
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'attempt owner mismatch must fail closed'; end if;
  update public.payment_attempts
  set user_id = '00000000-0000-4000-8000-000000002081'
  where id = '30000000-0000-4000-8000-000000002081';

  update public.payment_attempts
  set amount = 109999
  where id = '30000000-0000-4000-8000-000000002081';
  rejected := false;
  begin
    perform public.claim_goods_manual_payment_recovery(
      '30000000-0000-4000-8000-000000002081',
      '00000000-0000-4000-8000-000000002085',
      '60000000-0000-4000-8000-000000002081',
      'case_v1_22222222222222222222222222222222',
      'provider_cancel_confirmed',
      '72000000-0000-4000-8000-000000002081'
    );
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'attempt amount mismatch must fail closed'; end if;
  update public.payment_attempts
  set amount = 110000
  where id = '30000000-0000-4000-8000-000000002081';

  update public.payment_attempts
  set currency = 'USD'
  where id = '30000000-0000-4000-8000-000000002081';
  rejected := false;
  begin
    perform public.claim_goods_manual_payment_recovery(
      '30000000-0000-4000-8000-000000002081',
      '00000000-0000-4000-8000-000000002085',
      '60000000-0000-4000-8000-000000002081',
      'case_v1_33333333333333333333333333333333',
      'provider_cancel_confirmed',
      '73000000-0000-4000-8000-000000002081'
    );
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'attempt currency mismatch must fail closed'; end if;
  update public.payment_attempts
  set currency = 'KRW'
  where id = '30000000-0000-4000-8000-000000002081';

  update public.order_items
  set unit_price = 106999
  where order_id = '20000000-0000-4000-8000-000000002081';
  rejected := false;
  begin
    perform public.claim_goods_manual_payment_recovery(
      '30000000-0000-4000-8000-000000002081',
      '00000000-0000-4000-8000-000000002085',
      '60000000-0000-4000-8000-000000002081',
      'case_v1_44444444444444444444444444444444',
      'provider_cancel_confirmed',
      '74000000-0000-4000-8000-000000002081'
    );
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'order snapshot mismatch must fail closed'; end if;
  update public.order_items
  set unit_price = 107000
  where order_id = '20000000-0000-4000-8000-000000002081';
end;
$manual_recovery_order_attempt_invariants$;

do $manual_recovery_acl_and_input_guard$
declare
  rejected boolean;
begin
  rejected := false;
  begin
    perform public.claim_goods_manual_payment_recovery(
      '30000000-0000-4000-8000-000000002081',
      '00000000-0000-4000-8000-000000002082',
      '60000000-0000-4000-8000-000000002081',
      'case_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'provider_cancel_confirmed',
      '70000000-0000-4000-8000-000000002081'
    );
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'staff actor must be rejected'; end if;

  rejected := false;
  begin
    perform public.claim_goods_manual_payment_recovery(
      '30000000-0000-4000-8000-000000002081',
      '00000000-0000-4000-8000-000000002085',
      '60000000-0000-4000-8000-000000002081',
      'operator@example.test',
      'provider_cancel_confirmed',
      '70000000-0000-4000-8000-000000002081'
    );
  exception when invalid_parameter_value then rejected := true;
  end;
  if not rejected then raise exception 'unbranded case ref must be rejected'; end if;

  rejected := false;
  begin
    perform public.claim_goods_manual_payment_recovery(
      '30000000-0000-4000-8000-000000002085',
      '00000000-0000-4000-8000-000000002085',
      '60000000-0000-4000-8000-000000002085',
      'case_v1_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      'provider_cancel_confirmed',
      '70000000-0000-4000-8000-000000002085'
    );
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then raise exception 'prepared attempt must not be taken over'; end if;
end;
$manual_recovery_acl_and_input_guard$;

select 1 / case when (
  public.claim_goods_manual_payment_recovery(
    '30000000-0000-4000-8000-000000002082',
    '00000000-0000-4000-8000-000000002085',
    '60000000-0000-4000-8000-000000002082',
    'case_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'provider_cancel_confirmed',
    '70000000-0000-4000-8000-000000002082'
  ) ->> 'claim_status'
) = 'in_progress' then 1 else 0 end as assert_newer_provider_lease_blocks_takeover;

select 1 / case when (
  public.claim_goods_manual_payment_recovery(
    '30000000-0000-4000-8000-000000002083',
    '00000000-0000-4000-8000-000000002085',
    '60000000-0000-4000-8000-000000002083',
    'case_v1_cccccccccccccccccccccccccccccccc',
    'provider_cancel_confirmed',
    '70000000-0000-4000-8000-000000002083'
  ) ->> 'claim_status'
) = 'claimed' then 1 else 0 end as assert_stale_confirming_lease_can_be_taken_over;

do $manual_recovery_blocks_stale_provider_callback$
declare
  rejected boolean := false;
begin
  begin
    perform public.finalize_goods_payment_attempt(
      '30000000-0000-4000-8000-000000002083',
      '40000000-0000-4000-8000-000000002083',
      'canceled'
    );
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then
    raise exception 'superseded provider claim must not race manual recovery';
  end if;
end;
$manual_recovery_blocks_stale_provider_callback$;

select 1 / case when (
  public.claim_goods_manual_payment_recovery(
    '30000000-0000-4000-8000-000000002081',
    '00000000-0000-4000-8000-000000002085',
    '60000000-0000-4000-8000-000000002081',
    'case_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'provider_cancel_confirmed',
    '70000000-0000-4000-8000-000000002081'
  ) ->> 'claim_status'
) = 'claimed' then 1 else 0 end as assert_unknown_attempt_is_claimed_once;

select 1 / case when (
  public.claim_goods_manual_payment_recovery(
    '30000000-0000-4000-8000-000000002081',
    '00000000-0000-4000-8000-000000002085',
    '60000000-0000-4000-8000-000000002081',
    'case_v1_dddddddddddddddddddddddddddddddd',
    'provider_cancel_confirmed',
    '70000000-0000-4000-8000-000000002086'
  ) ->> 'claim_status'
) = 'in_progress' then 1 else 0 end as assert_second_manual_claim_is_blocked;

update private.goods_payment_manual_recovery_claims
set
  claimed_at = pg_catalog.clock_timestamp() - interval '2 minutes',
  expires_at = pg_catalog.clock_timestamp() - interval '1 minute'
where attempt_id = '30000000-0000-4000-8000-000000002081';

update public.payment_attempts
set claim_expires_at = pg_catalog.clock_timestamp() - interval '1 minute'
where id = '30000000-0000-4000-8000-000000002081';

select 1 / case when (
  public.claim_goods_manual_payment_recovery(
    '30000000-0000-4000-8000-000000002081',
    '00000000-0000-4000-8000-000000002085',
    '60000000-0000-4000-8000-000000002081',
    'case_v1_88888888888888888888888888888888',
    'provider_cancel_confirmed',
    '78000000-0000-4000-8000-000000002081'
  ) ->> 'claim_status'
) = 'claimed' and (
  select prior_attempt_state = 'unknown'
  from private.goods_payment_manual_recovery_claims
  where attempt_id = '30000000-0000-4000-8000-000000002081'
) then 1 else 0 end as assert_expired_manual_takeover_preserves_original_attempt_state;

do $manual_recovery_requires_attestation$
declare
  rejected boolean := false;
begin
  begin
    perform public.finalize_goods_manual_payment_recovery(
      '30000000-0000-4000-8000-000000002081',
      '00000000-0000-4000-8000-000000002085',
      '60000000-0000-4000-8000-000000002081',
      'case_v1_88888888888888888888888888888888',
      'provider_cancel_confirmed',
      '78000000-0000-4000-8000-000000002081',
      false
    );
  exception when invalid_parameter_value then rejected := true;
  end;
  if not rejected then raise exception 'operator attestation must be exact'; end if;
end;
$manual_recovery_requires_attestation$;

select public.finalize_goods_manual_payment_recovery(
  '30000000-0000-4000-8000-000000002081',
  '00000000-0000-4000-8000-000000002085',
  '60000000-0000-4000-8000-000000002081',
  'case_v1_88888888888888888888888888888888',
  'provider_cancel_confirmed',
  '78000000-0000-4000-8000-000000002081',
  true
);

select 1 / case when (
  select
    order_record.status = 'canceled'
    and attempt.state = 'canceled'
    and attempt.payment_id is null
    and request.status = 'completed'
    and request.decided_by = '00000000-0000-4000-8000-000000002084'
    and good.stock_qty = 11
    and not exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = order_record.id
    )
    and not exists (
      select 1
      from public.refunds as refund
      join public.payments as payment on payment.id = refund.payment_id
      where payment.purpose = 'order'
        and payment.ref_id = order_record.id
    )
  from public.orders as order_record
  join public.payment_attempts as attempt on attempt.ref_id = order_record.id
  join public.order_cancellation_requests as request on request.order_id = order_record.id
  join public.goods as good on good.id = 'goods-manual-recovery-good'
  where order_record.id = '20000000-0000-4000-8000-000000002081'
) then 1 else 0 end as assert_ambiguous_attempt_cancels_without_inventing_payment_history;

select 1 / case when (
  public.claim_goods_manual_payment_recovery(
    '30000000-0000-4000-8000-000000002081',
    '00000000-0000-4000-8000-000000002085',
    '60000000-0000-4000-8000-000000002081',
    'case_v1_ffffffffffffffffffffffffffffffff',
    'provider_cancel_confirmed',
    '70000000-0000-4000-8000-000000002087'
  ) ->> 'claim_status'
) = 'terminal' then 1 else 0 end as assert_terminal_replay_does_not_depend_on_case_ref;

select 1 / case when (
  select stock_qty = 11
  from public.goods
  where id = 'goods-manual-recovery-good'
) then 1 else 0 end as assert_terminal_replay_does_not_restore_stock_twice;

insert into public.payments (
  id, user_id, purpose, ref_id, provider, amount, status,
  payment_key, idempotency_key, raw
)
values (
  '50000000-0000-4000-8000-000000002086',
  '00000000-0000-4000-8000-000000002081',
  'order',
  '20000000-0000-4000-8000-000000002084',
  'korpay',
  110000,
  'paid',
  'wrong-linked-provider-key-2084',
  'wrong-linked-payment-2084',
  null
);

update public.payments
set status = 'failed'
where id = '50000000-0000-4000-8000-000000002084';

update public.payment_attempts
set payment_id = '50000000-0000-4000-8000-000000002086'
where id = '30000000-0000-4000-8000-000000002084';

do $manual_recovery_rejects_wrong_linked_payment$
declare
  rejected boolean := false;
begin
  begin
    perform public.claim_goods_manual_payment_recovery(
      '30000000-0000-4000-8000-000000002084',
      '00000000-0000-4000-8000-000000002085',
      '60000000-0000-4000-8000-000000002084',
      'case_v1_77777777777777777777777777777777',
      'provider_cancel_confirmed',
      '77000000-0000-4000-8000-000000002084'
    );
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then
    raise exception 'same-order payment without attempt provenance must fail closed';
  end if;
end;
$manual_recovery_rejects_wrong_linked_payment$;

update public.payment_attempts
set payment_id = '50000000-0000-4000-8000-000000002084'
where id = '30000000-0000-4000-8000-000000002084';

update public.payments
set status = 'paid'
where id = '50000000-0000-4000-8000-000000002084';

delete from public.payments
where id = '50000000-0000-4000-8000-000000002086';

select 1 / case when (
  public.claim_goods_manual_payment_recovery(
    '30000000-0000-4000-8000-000000002084',
    '00000000-0000-4000-8000-000000002085',
    '60000000-0000-4000-8000-000000002084',
    'case_v1_99999999999999999999999999999999',
    'provider_cancel_confirmed',
    '70000000-0000-4000-8000-000000002084'
  ) ->> 'claim_status'
) = 'claimed' then 1 else 0 end as assert_approved_attempt_cancellation_uses_manual_claim;

update public.payments
set idempotency_key = 'wrong-finalize-provenance-2084'
where id = '50000000-0000-4000-8000-000000002084';

do $manual_recovery_finalize_rechecks_payment_provenance$
declare
  rejected boolean := false;
begin
  begin
    perform public.finalize_goods_manual_payment_recovery(
      '30000000-0000-4000-8000-000000002084',
      '00000000-0000-4000-8000-000000002085',
      '60000000-0000-4000-8000-000000002084',
      'case_v1_99999999999999999999999999999999',
      'provider_cancel_confirmed',
      '70000000-0000-4000-8000-000000002084',
      true
    );
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then
    raise exception 'finalize must recheck exact attempt payment provenance';
  end if;
end;
$manual_recovery_finalize_rechecks_payment_provenance$;

update public.payments
set idempotency_key = 'attempt:30000000-0000-4000-8000-000000002084'
where id = '50000000-0000-4000-8000-000000002084';

insert into public.order_cancellation_requests (
  id,
  order_id,
  requested_by,
  reason,
  reason_type,
  status,
  decided_by,
  decided_at
)
values (
  '60000000-0000-4000-8000-000000002086',
  '20000000-0000-4000-8000-000000002084',
  '00000000-0000-4000-8000-000000002081',
  '이전 종료 요청',
  'change_of_mind',
  'rejected',
  '00000000-0000-4000-8000-000000002084',
  pg_catalog.now() - interval '1 day'
);

insert into public.refunds (
  payment_id,
  amount,
  reason,
  status,
  cancellation_request_id
)
values (
  '50000000-0000-4000-8000-000000002084',
  110000,
  '이전 종료 요청 환불 intent',
  'requested',
  '60000000-0000-4000-8000-000000002086'
);

do $manual_recovery_preserves_refund_request_association$
declare
  rejected boolean := false;
begin
  begin
    perform public.finalize_goods_manual_payment_recovery(
      '30000000-0000-4000-8000-000000002084',
      '00000000-0000-4000-8000-000000002085',
      '60000000-0000-4000-8000-000000002084',
      'case_v1_99999999999999999999999999999999',
      'provider_cancel_confirmed',
      '70000000-0000-4000-8000-000000002084',
      true
    );
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then
    raise exception 'existing refund request association must fail closed';
  end if;
end;
$manual_recovery_preserves_refund_request_association$;

select 1 / case when (
  select
    payment.status = 'paid'
    and order_record.status = 'paid'
    and refund.status = 'requested'
    and refund.cancellation_request_id = '60000000-0000-4000-8000-000000002086'
  from public.payments as payment
  join public.orders as order_record on order_record.id = payment.ref_id
  join public.refunds as refund on refund.payment_id = payment.id
  where payment.id = '50000000-0000-4000-8000-000000002084'
) then 1 else 0 end as assert_refund_association_conflict_rolls_back_all_ledgers;

delete from public.refunds
where payment_id = '50000000-0000-4000-8000-000000002084';

delete from public.order_cancellation_requests
where id = '60000000-0000-4000-8000-000000002086';

select public.finalize_goods_manual_payment_recovery(
  '30000000-0000-4000-8000-000000002084',
  '00000000-0000-4000-8000-000000002085',
  '60000000-0000-4000-8000-000000002084',
  'case_v1_99999999999999999999999999999999',
  'provider_cancel_confirmed',
  '70000000-0000-4000-8000-000000002084',
  true
);

select 1 / case when (
  select
    order_record.status = 'canceled'
    and attempt.state = 'approved'
    and payment.status = 'refunded'
    and payment.raw is null
    and refund.status = 'done'
    and request.status = 'completed'
    and request.decided_by = '00000000-0000-4000-8000-000000002084'
    and good.stock_qty = 12
  from public.orders as order_record
  join public.payment_attempts as attempt on attempt.ref_id = order_record.id
  join public.payments as payment on payment.id = attempt.payment_id
  join public.refunds as refund on refund.payment_id = payment.id
  join public.order_cancellation_requests as request on request.order_id = order_record.id
  join public.goods as good on good.id = 'goods-manual-recovery-good'
  where order_record.id = '20000000-0000-4000-8000-000000002084'
) then 1 else 0 end as assert_approved_payment_uses_existing_finalizer_without_secret_audit;

select 1 / case when (
  select count(*) = 2
    and bool_and(operation = 'provider_cancel_confirmed')
    and bool_and(case_ref ~ '^case_v1_[0-9a-f]{32}$')
    and bool_and(actor_id = '00000000-0000-4000-8000-000000002085')
    and count(*) filter (where prior_attempt_state = 'unknown') = 1
    and count(*) filter (where prior_attempt_state = 'approved') = 1
    and bool_and(outcome = 'provider_cancel_confirmed')
  from private.goods_payment_manual_recovery_audits
) then 1 else 0 end as assert_manual_recovery_audit_is_allowlisted;

select 1 / case when not exists (
  select 1
  from information_schema.columns
  where table_schema = 'private'
    and table_name in (
      'goods_payment_manual_recovery_claims',
      'goods_payment_manual_recovery_audits'
    )
    and column_name ilike any(array[
      '%payment_key%', '%paymentkey%', '%tid%', '%pan%', '%raw%', '%payload%', '%response%'
    ])
) then 1 else 0 end as assert_manual_tables_have_no_provider_secret_columns;

select 1 / case when (
  select
    count(*) = 10
    and bool_and(column_name = any(array[
      'id', 'attempt_id', 'order_id', 'request_id', 'actor_id',
      'operation', 'case_ref', 'prior_attempt_state', 'outcome', 'recorded_at'
    ]))
  from information_schema.columns
  where table_schema = 'private'
    and table_name = 'goods_payment_manual_recovery_audits'
) then 1 else 0 end as assert_manual_audit_has_only_allowlisted_fields;

select 1 / case when not exists (
  select 1
  from public.audit_log
  where action like 'admin.payment.goods_manual_%'
    and diff::text like '%existing-provider-key-2084%'
) then 1 else 0 end as assert_public_audit_contains_no_provider_key;

rollback;
