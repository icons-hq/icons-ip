\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000001371', 'authenticated', 'authenticated',
    'deletion-one@example.test', now(), '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000001372', 'authenticated', 'authenticated',
    'deletion-two@example.test', now(), '{}', '{}', now(), now()
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

update private.account_deletion_control
set phase_one_enabled = true;

set local role authenticated;

select 1 / case when public.preview_my_account_deletion() =
  jsonb_build_object('available', true, 'eligible', true, 'blockers', '[]'::jsonb)
then 1 else 0 end as assert_empty_self_is_eligible;

reset role;

insert into public.payments (
  id, user_id, purpose, amount, status, idempotency_key
)
values (
  '00000000-0000-4000-8000-000000001305',
  '00000000-0000-4000-8000-000000001371',
  'wallet', 1000, 'pending', 'legacy-pending-payment'
);

set local role authenticated;

select 1 / case when public.preview_my_account_deletion() =
  jsonb_build_object(
    'available', true,
    'eligible', false,
    'blockers', jsonb_build_array(
      jsonb_build_object(
        'code', 'active_payment_attempt',
        'count', 1,
        'path', '/settings'
      )
    )
  )
then 1 else 0 end as assert_legacy_pending_payment_fails_closed;

reset role;

update public.payments
set status = 'failed'
where id = '00000000-0000-4000-8000-000000001305';

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

set local role authenticated;

select 1 / case when public.preview_my_account_deletion() =
  jsonb_build_object(
    'available', true,
    'eligible', false,
    'blockers', jsonb_build_array(
      jsonb_build_object('code', 'active_order', 'count', 1, 'path', '/orders'),
      jsonb_build_object('code', 'active_payment_attempt', 'count', 1, 'path', '/settings')
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
    jsonb_build_object('code', 'active_payment_attempt', 'count', 1, 'path', '/settings')
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
    jsonb_build_object('code', 'active_payment_attempt', 'count', 1, 'path', '/settings')
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
      'createdAt', (select created_at from public.orders where id = '00000000-0000-4000-8000-000000001301'),
      'items', '[]'::jsonb
    )
) then 1 else 0 end as assert_legal_snapshot_is_allowlisted_and_minimal;

select 1 / case when not exists (
  select 1
  from private.account_deletion_legal_snapshots
  where snapshot_data::text like '%do-not-copy%'
     or snapshot_data::text like '%secret%'
     or snapshot_data ? 'email'
     or snapshot_data ? 'address'
) then 1 else 0 end as assert_raw_pii_is_not_snapshotted;

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
set local role authenticated;

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
set status = 'paid'
where id = '00000000-0000-4000-8000-000000001301';

select 1 / case when not has_table_privilege(
  'anon', 'private.account_deletion_requests', 'SELECT'
)
  and not has_table_privilege('authenticated', 'private.account_deletion_requests', 'SELECT')
  and not has_table_privilege('service_role', 'private.account_deletion_requests', 'SELECT')
  and not has_table_privilege('service_role', 'private.account_deletion_legal_snapshots', 'SELECT')
then 1 else 0 end as assert_private_ledgers_are_not_data_api_readable;

select 1 / case when not has_function_privilege(
  'anon', 'public.request_my_account_deletion(text,uuid)', 'EXECUTE'
) and has_function_privilege(
  'authenticated', 'public.request_my_account_deletion(text,uuid)', 'EXECUTE'
) then 1 else 0 end as assert_self_rpc_grants_are_minimal;

rollback;
