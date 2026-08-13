\set ON_ERROR_STOP on

begin;

-- This suite verifies the legacy community upload branch independently of the
-- launch gate. Production activation remains a separate reviewed migration.
update private.community_write_control
set post_create_enabled = true;

insert into auth.users (
  id,
  aud,
  role,
  email,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-000000001201',
    'authenticated',
    'authenticated',
    'profile-one@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000001202',
    'authenticated',
    'authenticated',
    'profile-two@example.test',
    now(),
    '{}',
    '{}',
    now(),
    now()
  );

do $$
begin
  begin
    update public.profiles
    set nickname = '   '
    where id = '00000000-0000-4000-8000-000000001201';
  exception
    when check_violation then
      return;
  end;

  raise exception 'blank nickname should violate the profile identity constraint';
end;
$$;

do $$
begin
  begin
    update public.profiles
    set nickname = ' untrimmed '
    where id = '00000000-0000-4000-8000-000000001201';
  exception
    when check_violation then
      return;
  end;

  raise exception 'untrimmed nickname should violate the profile identity constraint';
end;
$$;

do $$
begin
  begin
    update public.profiles
    set nickname = E'\tascii-edge\n'
    where id = '00000000-0000-4000-8000-000000001201';
  exception
    when check_violation then
      return;
  end;

  raise exception 'ASCII tab and newline should violate the profile identity constraint';
end;
$$;

do $$
begin
  begin
    update public.profiles
    set nickname = U&'\00A0unicode-edge\3000'
    where id = '00000000-0000-4000-8000-000000001201';
  exception
    when check_violation then
      return;
  end;

  raise exception 'Unicode no-break and ideographic spaces should violate the profile identity constraint';
end;
$$;

do $$
begin
  begin
    update public.profiles
    set nickname = U&'\FEFFbom-edge\FEFF'
    where id = '00000000-0000-4000-8000-000000001201';
  exception
    when check_violation then
      return;
  end;

  raise exception 'Unicode BOM should violate the profile identity constraint';
end;
$$;

do $$
begin
  begin
    update public.profiles
    set nickname = repeat('a', 513)
    where id = '00000000-0000-4000-8000-000000001201';
  exception
    when check_violation then
      return;
  end;

  raise exception 'nickname longer than the raw ceiling should violate the profile identity constraint';
end;
$$;

do $$
begin
  begin
    update public.profiles
    set avatar_path = '00000000-0000-4000-8000-000000001202/profile/11111111-1111-4111-8111-111111111111.jpg'
    where id = '00000000-0000-4000-8000-000000001201';
  exception
    when check_violation then
      return;
  end;

  raise exception 'non-owned avatar path should violate the profile identity constraint';
end;
$$;

update public.profiles
set
  nickname = 'FanName',
  avatar_path = '00000000-0000-4000-8000-000000001201/profile/11111111-1111-4111-8111-111111111111.jpg'
where id = '00000000-0000-4000-8000-000000001201';

-- 이 사용자는 migration 이후 생성됐으므로 production backfill과 같은 active fixture를 둔다.
insert into public.profile_avatar_claims (
  path,
  user_id,
  status,
  resolved_at
)
values (
  '00000000-0000-4000-8000-000000001201/profile/11111111-1111-4111-8111-111111111111.jpg',
  '00000000-0000-4000-8000-000000001201',
  'active',
  now()
);

do $$
begin
  begin
    update public.profiles
    set nickname = 'fanname'
    where id = '00000000-0000-4000-8000-000000001202';
  exception
    when unique_violation then
      return;
  end;

  raise exception 'normalized duplicate nickname should raise unique_violation';
end;
$$;

update public.profiles
set nickname = 'SecondFan'
where id = '00000000-0000-4000-8000-000000001202';

select 1 / case when exists (
  select 1
  from pg_index
  where indexrelid = 'public.profiles_nickname_normalized_unique_idx'::regclass
    and pg_get_expr(indexprs, indrelid) ~ 'lower\(btrim\(nickname, '
    and pg_get_expr(indexprs, indrelid) !~ 'lower\(btrim\(nickname\)\)'
) then 1 else 0 end as assert_nickname_index_uses_explicit_trim_contract;

select 1 / case when not has_column_privilege(
  'authenticated',
  'public.profiles',
  'nickname',
  'UPDATE'
) then 1 else 0 end as assert_authenticated_cannot_update_nickname_directly;

select 1 / case when not has_column_privilege(
  'authenticated',
  'public.profiles',
  'avatar_path',
  'UPDATE'
) then 1 else 0 end as assert_authenticated_cannot_update_avatar_directly;

select 1 / case when has_column_privilege(
  'authenticated',
  'public.profiles',
  'birth_date',
  'UPDATE'
) and has_column_privilege(
  'authenticated',
  'public.profiles',
  'consents',
  'UPDATE'
) and has_column_privilege(
  'authenticated',
  'public.profiles',
  'onboarded_at',
  'UPDATE'
) then 1 else 0 end as assert_unrelated_profile_update_grants_remain;

select 1 / case when not has_function_privilege(
  'public',
  'public.service_update_profile_identity(uuid,text,text,boolean)',
  'EXECUTE'
) and not has_function_privilege(
  'anon',
  'public.service_update_profile_identity(uuid,text,text,boolean)',
  'EXECUTE'
) and not has_function_privilege(
  'authenticated',
  'public.service_update_profile_identity(uuid,text,text,boolean)',
  'EXECUTE'
) and has_function_privilege(
  'service_role',
  'public.service_update_profile_identity(uuid,text,text,boolean)',
  'EXECUTE'
) then 1 else 0 end as assert_identity_rpc_is_service_role_only;

select 1 / case when not has_function_privilege(
  'public',
  'public.service_prepare_profile_avatar_claim(uuid,text)',
  'EXECUTE'
) and not has_function_privilege(
  'anon',
  'public.service_prepare_profile_avatar_claim(uuid,text)',
  'EXECUTE'
) and not has_function_privilege(
  'authenticated',
  'public.service_prepare_profile_avatar_claim(uuid,text)',
  'EXECUTE'
) and has_function_privilege(
  'service_role',
  'public.service_prepare_profile_avatar_claim(uuid,text)',
  'EXECUTE'
) and not has_function_privilege(
  'public',
  'public.service_reject_profile_avatar_claim(uuid,text)',
  'EXECUTE'
) and not has_function_privilege(
  'anon',
  'public.service_reject_profile_avatar_claim(uuid,text)',
  'EXECUTE'
) and not has_function_privilege(
  'authenticated',
  'public.service_reject_profile_avatar_claim(uuid,text)',
  'EXECUTE'
) and has_function_privilege(
  'service_role',
  'public.service_reject_profile_avatar_claim(uuid,text)',
  'EXECUTE'
) then 1 else 0 end as assert_claim_rpcs_are_service_role_only;

select 1 / case when not has_function_privilege(
  'public',
  'public.service_log_profile_avatar_cleanup_failure(uuid,text,text)',
  'EXECUTE'
) and not has_function_privilege(
  'anon',
  'public.service_log_profile_avatar_cleanup_failure(uuid,text,text)',
  'EXECUTE'
) and not has_function_privilege(
  'authenticated',
  'public.service_log_profile_avatar_cleanup_failure(uuid,text,text)',
  'EXECUTE'
) and has_function_privilege(
  'service_role',
  'public.service_log_profile_avatar_cleanup_failure(uuid,text,text)',
  'EXECUTE'
) then 1 else 0 end as assert_cleanup_audit_rpc_is_service_role_only;

select 1 / case when (
  select relrowsecurity
  from pg_class
  where oid = 'public.profile_avatar_claims'::regclass
) and not has_table_privilege('public', 'public.profile_avatar_claims', 'SELECT')
  and not has_table_privilege('anon', 'public.profile_avatar_claims', 'SELECT')
  and not has_table_privilege('authenticated', 'public.profile_avatar_claims', 'SELECT')
  and has_table_privilege('service_role', 'public.profile_avatar_claims', 'SELECT')
  and not has_table_privilege('service_role', 'public.profile_avatar_claims', 'INSERT')
  and not has_table_privilege('service_role', 'public.profile_avatar_claims', 'UPDATE')
  and not has_table_privilege('service_role', 'public.profile_avatar_claims', 'DELETE')
then 1 else 0 end as assert_claim_ledger_is_service_read_only;

select 1 / case when exists (
  select 1
  from pg_proc
  where oid = 'public.service_update_profile_identity(uuid,text,text,boolean)'::regprocedure
    and prosecdef
    and proconfig = array['search_path=""']
    and pg_get_functiondef(oid) ~* 'for update'
    and pg_get_functiondef(oid) ~* 'get diagnostics v_rejected_count = row_count'
) then 1 else 0 end as assert_identity_rpc_is_hardened_and_locks_row;

select 1 / case when (
  select count(*) = 2
  from pg_proc
  where oid in (
    'public.service_prepare_profile_avatar_claim(uuid,text)'::regprocedure,
    'public.service_reject_profile_avatar_claim(uuid,text)'::regprocedure
  )
    and prosecdef
    and proconfig = array['search_path=""']
) then 1 else 0 end as assert_claim_rpcs_are_hardened;

select 1 / case when exists (
  select 1
  from pg_proc
  where oid = 'public.service_log_profile_avatar_cleanup_failure(uuid,text,text)'::regprocedure
    and prosecdef
    and proconfig = array['search_path=""']
) then 1 else 0 end as assert_cleanup_audit_rpc_is_hardened;

create temporary table profile_claim_prepare_result (
  attempt text primary key,
  prepared boolean not null
);
create temporary table profile_claim_reject_result (
  attempt text primary key,
  rejected boolean not null,
  cleanup_safe boolean not null
);
create temporary table profile_rpc_result (
  attempt text primary key,
  applied boolean not null,
  error_code text,
  cleanup_safe boolean not null,
  previous_avatar_path text
);
create temporary table profile_cleanup_audit_result (
  attempt text primary key,
  logged boolean not null
);
grant insert, select on profile_claim_prepare_result to service_role;
grant insert, select on profile_claim_reject_result to service_role;
grant insert, select on profile_rpc_result to service_role;
grant insert, select on profile_cleanup_audit_result to service_role;

set local role service_role;

insert into profile_claim_prepare_result (attempt, prepared)
select
  'first-success',
  public.service_prepare_profile_avatar_claim(
    '00000000-0000-4000-8000-000000001201',
    '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.webp'
  );

insert into profile_rpc_result (
  attempt,
  applied,
  error_code,
  cleanup_safe,
  previous_avatar_path
)
select
  'first-success',
  applied,
  error_code,
  cleanup_safe,
  previous_avatar_path
from public.service_update_profile_identity(
  '00000000-0000-4000-8000-000000001201',
  'UpdatedFan',
  '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.webp',
  true
);

insert into profile_cleanup_audit_result (attempt, logged)
select
  'valid',
  public.service_log_profile_avatar_cleanup_failure(
    '00000000-0000-4000-8000-000000001201',
    '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.webp',
    'previous'
  );

insert into profile_cleanup_audit_result (attempt, logged)
select
  'invalid-stage',
  public.service_log_profile_avatar_cleanup_failure(
    '00000000-0000-4000-8000-000000001201',
    '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.webp',
    'other'
  );

insert into profile_cleanup_audit_result (attempt, logged)
select
  'null-stage',
  public.service_log_profile_avatar_cleanup_failure(
    '00000000-0000-4000-8000-000000001201',
    '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.webp',
    null
  );

insert into profile_rpc_result (
  attempt,
  applied,
  error_code,
  cleanup_safe,
  previous_avatar_path
)
select
  'unclaimed-strict-path',
  applied,
  error_code,
  cleanup_safe,
  previous_avatar_path
from public.service_update_profile_identity(
  '00000000-0000-4000-8000-000000001201',
  'UnclaimedMustNotApply',
  '00000000-0000-4000-8000-000000001201/profile/55555555-5555-4555-8555-555555555555.png',
  true
);

reset role;

select 1 / case when exists (
  select 1
  from profile_claim_prepare_result
  where attempt = 'first-success'
    and prepared
) then 1 else 0 end as assert_first_candidate_is_prepared;

select 1 / case when exists (
  select 1
  from profile_rpc_result
  where attempt = 'first-success'
    and applied
    and error_code is null
    and not cleanup_safe
    and previous_avatar_path = '00000000-0000-4000-8000-000000001201/profile/11111111-1111-4111-8111-111111111111.jpg'
) then 1 else 0 end as assert_first_finalize_returns_structured_success;

select 1 / case when exists (
  select 1
  from profile_cleanup_audit_result
  where attempt = 'valid'
    and logged
) and exists (
  select 1
  from profile_cleanup_audit_result
  where attempt = 'invalid-stage'
    and not logged
) and exists (
  select 1
  from profile_cleanup_audit_result
  where attempt = 'null-stage'
    and not logged
) and (
  select count(*)
  from public.audit_log
  where actor_id = '00000000-0000-4000-8000-000000001201'
    and action = 'profile_avatar_cleanup_failed'
    and target = '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.webp'
    and diff = '{"stage":"previous"}'::jsonb
) = 1 then 1 else 0 end as assert_cleanup_audit_rpc_writes_only_valid_payload;

select 1 / case when exists (
  select 1
  from public.profiles
  where id = '00000000-0000-4000-8000-000000001201'
    and nickname = 'UpdatedFan'
    and avatar_path = '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.webp'
) then 1 else 0 end as assert_service_rpc_updates_identity;

select 1 / case when exists (
  select 1
  from public.public_profiles
  where id = '00000000-0000-4000-8000-000000001201'
    and nickname = 'UpdatedFan'
    and avatar_path = '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.webp'
) then 1 else 0 end as assert_public_profile_trigger_syncs_identity;

select 1 / case when exists (
  select 1
  from public.profile_avatar_claims
  where path = '00000000-0000-4000-8000-000000001201/profile/11111111-1111-4111-8111-111111111111.jpg'
    and user_id = '00000000-0000-4000-8000-000000001201'
    and status = 'retired'
    and resolved_at is not null
) and exists (
  select 1
  from public.profile_avatar_claims
  where path = '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.webp'
    and user_id = '00000000-0000-4000-8000-000000001201'
    and status = 'active'
    and resolved_at is not null
) then 1 else 0 end as assert_success_activates_candidate_and_retires_previous;

set local role service_role;

insert into profile_rpc_result (
  attempt,
  applied,
  error_code,
  cleanup_safe,
  previous_avatar_path
)
select
  'active-replay',
  applied,
  error_code,
  cleanup_safe,
  previous_avatar_path
from public.service_update_profile_identity(
  '00000000-0000-4000-8000-000000001201',
  'SecondFan',
  '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.webp',
  true
);

insert into profile_rpc_result (
  attempt,
  applied,
  error_code,
  cleanup_safe,
  previous_avatar_path
)
select
  'null-replace-flag',
  applied,
  error_code,
  cleanup_safe,
  previous_avatar_path
from public.service_update_profile_identity(
  '00000000-0000-4000-8000-000000001201',
  'NullFlagMustNotApply',
  null,
  null
);

insert into profile_claim_prepare_result (attempt, prepared)
select
  'nickname-conflict',
  public.service_prepare_profile_avatar_claim(
    '00000000-0000-4000-8000-000000001201',
    '00000000-0000-4000-8000-000000001201/profile/33333333-3333-4333-8333-333333333333.png'
  );

insert into profile_rpc_result (
  attempt,
  applied,
  error_code,
  cleanup_safe,
  previous_avatar_path
)
select
  'nickname-conflict-first',
  applied,
  error_code,
  cleanup_safe,
  previous_avatar_path
from public.service_update_profile_identity(
  '00000000-0000-4000-8000-000000001201',
  'SecondFan',
  '00000000-0000-4000-8000-000000001201/profile/33333333-3333-4333-8333-333333333333.png',
  true
);

insert into profile_rpc_result (
  attempt,
  applied,
  error_code,
  cleanup_safe,
  previous_avatar_path
)
select
  'nickname-conflict-replay',
  applied,
  error_code,
  cleanup_safe,
  previous_avatar_path
from public.service_update_profile_identity(
  '00000000-0000-4000-8000-000000001201',
  'ShouldNotApply',
  '00000000-0000-4000-8000-000000001201/profile/33333333-3333-4333-8333-333333333333.png',
  true
);

insert into profile_rpc_result (
  attempt,
  applied,
  error_code,
  cleanup_safe,
  previous_avatar_path
)
select
  'nickname-only',
  applied,
  error_code,
  cleanup_safe,
  previous_avatar_path
from public.service_update_profile_identity(
  '00000000-0000-4000-8000-000000001201',
  'FinalFan',
  null,
  false
);

insert into profile_claim_prepare_result (attempt, prepared)
select
  'validation-failure',
  public.service_prepare_profile_avatar_claim(
    '00000000-0000-4000-8000-000000001201',
    '00000000-0000-4000-8000-000000001201/profile/44444444-4444-4444-8444-444444444444.jpg'
  );

insert into profile_claim_reject_result (attempt, rejected, cleanup_safe)
select 'validation-failure-first', rejected, cleanup_safe
from public.service_reject_profile_avatar_claim(
  '00000000-0000-4000-8000-000000001201',
  '00000000-0000-4000-8000-000000001201/profile/44444444-4444-4444-8444-444444444444.jpg'
);

insert into profile_claim_reject_result (attempt, rejected, cleanup_safe)
select 'validation-failure-replay', rejected, cleanup_safe
from public.service_reject_profile_avatar_claim(
  '00000000-0000-4000-8000-000000001201',
  '00000000-0000-4000-8000-000000001201/profile/44444444-4444-4444-8444-444444444444.jpg'
);

reset role;

select 1 / case when exists (
  select 1
  from profile_rpc_result
  where attempt = 'active-replay'
    and not applied
    and error_code = 'avatar_replayed'
    and not cleanup_safe
    and previous_avatar_path is null
) and exists (
  select 1
  from public.profiles
  where id = '00000000-0000-4000-8000-000000001201'
    and nickname = 'FinalFan'
    and avatar_path = '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.webp'
) then 1 else 0 end as assert_active_replay_cannot_adopt_conflicting_identity;

select 1 / case when exists (
  select 1
  from profile_rpc_result
  where attempt = 'unclaimed-strict-path'
    and not applied
    and error_code = 'avatar_unclaimed'
    and not cleanup_safe
    and previous_avatar_path is null
) then 1 else 0 end as assert_strict_but_unclaimed_path_cannot_finalize;

select 1 / case when exists (
  select 1
  from profile_rpc_result
  where attempt = 'null-replace-flag'
    and not applied
    and error_code = '22023'
    and not cleanup_safe
    and previous_avatar_path is null
) then 1 else 0 end as assert_null_replace_flag_fails_closed;

select 1 / case when exists (
  select 1
  from profile_rpc_result
  where attempt = 'nickname-conflict-first'
    and not applied
    and error_code = '23505'
    and cleanup_safe
    and previous_avatar_path is null
) and exists (
  select 1
  from public.profile_avatar_claims
  where path = '00000000-0000-4000-8000-000000001201/profile/33333333-3333-4333-8333-333333333333.png'
    and status = 'rejected'
) then 1 else 0 end as assert_known_failure_rejects_claim_and_allows_one_cleanup;

select 1 / case when exists (
  select 1
  from profile_rpc_result
  where attempt = 'nickname-conflict-replay'
    and not applied
    and error_code = 'avatar_replayed'
    and not cleanup_safe
    and previous_avatar_path is null
) then 1 else 0 end as assert_rejected_claim_replay_never_allows_cleanup;

select 1 / case when exists (
  select 1
  from profile_rpc_result
  where attempt = 'nickname-only'
    and applied
    and error_code is null
    and not cleanup_safe
    and previous_avatar_path = '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.webp'
) then 1 else 0 end as assert_nickname_only_onboarding_contract_remains;

select 1 / case when exists (
  select 1
  from profile_claim_reject_result
  where attempt = 'validation-failure-first'
    and rejected
    and cleanup_safe
) and exists (
  select 1
  from profile_claim_reject_result
  where attempt = 'validation-failure-replay'
    and not rejected
    and not cleanup_safe
) then 1 else 0 end as assert_pending_rejection_allows_cleanup_exactly_once;

set local role service_role;

select 1 / case when public.service_prepare_profile_avatar_claim(
  '00000000-0000-4000-8000-000000001201',
  '00000000-0000-4000-8000-000000001201/profile/66666666-6666-4666-8666-666666666666.png'
) then 1 else 0 end as assert_storage_candidate_is_prepared;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001201', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'user-uploads',
      '00000000-0000-4000-8000-000000001201/profile/55555555-5555-4555-8555-555555555555.png',
      '00000000-0000-4000-8000-000000001201'
    );
  exception
    when insufficient_privilege then
      return;
  end;

  raise exception 'unclaimed profile avatar insert should be denied by RLS';
end;
$$;

do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'user-uploads',
      '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.webp',
      '00000000-0000-4000-8000-000000001201'
    );
  exception
    when insufficient_privilege then
      return;
  end;

  raise exception 'active profile avatar claim should not authorize another insert';
end;
$$;

insert into storage.objects (bucket_id, name, owner_id)
values (
  'user-uploads',
  '00000000-0000-4000-8000-000000001201/profile/66666666-6666-4666-8666-666666666666.png',
  '00000000-0000-4000-8000-000000001201'
);

insert into storage.objects (bucket_id, name, owner_id)
values (
  'user-uploads',
  '00000000-0000-4000-8000-000000001201/community/77777777-7777-4777-8777-777777777777.gif',
  '00000000-0000-4000-8000-000000001201'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

select 1 / case when exists (
  select 1
  from storage.objects
  where bucket_id = 'user-uploads'
    and name = '00000000-0000-4000-8000-000000001201/profile/66666666-6666-4666-8666-666666666666.png'
) and exists (
  select 1
  from storage.objects
  where bucket_id = 'user-uploads'
    and name = '00000000-0000-4000-8000-000000001201/community/77777777-7777-4777-8777-777777777777.gif'
) and not exists (
  select 1
  from storage.objects
  where bucket_id = 'user-uploads'
    and name in (
      '00000000-0000-4000-8000-000000001201/profile/55555555-5555-4555-8555-555555555555.png',
      '00000000-0000-4000-8000-000000001201/profile/22222222-2222-4222-8222-222222222222.webp'
    )
) then 1 else 0 end as assert_storage_insert_policy_enforces_claim_state;

select 1 / case when has_schema_privilege(
  'authenticated',
  'private',
  'USAGE'
) and not has_schema_privilege(
  'anon',
  'private',
  'USAGE'
) and has_schema_privilege(
  'service_role',
  'private',
  'USAGE'
) then 1 else 0 end as assert_private_schema_usage_matches_object_scoped_consumers;

select 1 / case when has_function_privilege(
  'authenticated',
  'private.has_pending_profile_avatar_claim(text)',
  'EXECUTE'
) and not has_function_privilege(
  'anon',
  'private.has_pending_profile_avatar_claim(text)',
  'EXECUTE'
) and not has_function_privilege(
  'service_role',
  'private.has_pending_profile_avatar_claim(text)',
  'EXECUTE'
) then 1 else 0 end as assert_profile_upload_predicate_acl;

select 1 / case when exists (
  select 1
  from pg_proc
  where oid = 'private.has_pending_profile_avatar_claim(text)'::regprocedure
    and prosecdef
    and provolatile = 's'
    and proconfig = array['search_path=""']
    and pg_get_functiondef(oid) ~ 'public[.]profile_avatar_claims'
    and pg_get_functiondef(oid) ~ 'auth[.]uid\(\)'
) then 1 else 0 end as assert_profile_upload_predicate_is_hardened;

select 1 / case when exists (
  select 1
  from storage.buckets
  where id = 'user-uploads'
    and file_size_limit = 5 * 1024 * 1024
    and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
) then 1 else 0 end as assert_user_upload_bucket_limits;

select 1 / case when exists (
  select 1
  from pg_policy as policy
  join pg_class as relation on relation.oid = policy.polrelid
  join pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'storage'
    and relation.relname = 'objects'
    and policy.polname = 'user_uploads_write'
    and policy.polcmd = 'a'
    and policy.polroles = array['authenticated'::regrole::oid]
    and policy.polpermissive
    and policy.polqual is null
    and position(
      'bucket_id = ''user-uploads''::text'
      in pg_get_expr(policy.polwithcheck, policy.polrelid)
    ) > 0
    and position(
      'SELECT auth.uid() AS uid'
      in pg_get_expr(policy.polwithcheck, policy.polrelid)
    ) > 0
    and position(
      'profile/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp)$'
      in pg_get_expr(policy.polwithcheck, policy.polrelid)
    ) > 0
    and position(
      'private.has_pending_profile_avatar_claim(name)'
      in pg_get_expr(policy.polwithcheck, policy.polrelid)
    ) > 0
    and position(
      'community/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](jpg|png|webp|gif)$'
      in pg_get_expr(policy.polwithcheck, policy.polrelid)
    ) > 0
) then 1 else 0 end as assert_user_upload_insert_policy_catalog_contract;

select 1 / case when exists (
  select 1
  from pg_policy as policy
  join pg_class as relation on relation.oid = policy.polrelid
  join pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'storage'
    and relation.relname = 'objects'
    and policy.polname = 'user_uploads_delete'
    and policy.polcmd = 'd'
    and policy.polroles = array['authenticated'::regrole::oid]
    and policy.polpermissive
    and policy.polwithcheck is null
    and position(
      'bucket_id = ''user-uploads''::text'
      in pg_get_expr(policy.polqual, policy.polrelid)
    ) > 0
    and position(
      'storage.foldername(name)'
      in pg_get_expr(policy.polqual, policy.polrelid)
    ) > 0
    and position(
      '/profile/'
      in pg_get_expr(policy.polqual, policy.polrelid)
    ) > 0
    and position(
      '!~'
      in pg_get_expr(policy.polqual, policy.polrelid)
    ) > 0
) then 1 else 0 end as assert_authenticated_delete_preserves_owned_non_profile_only;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000001201', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
begin
  begin
    update public.profiles
    set nickname = 'DirectNicknameChange'
    where id = '00000000-0000-4000-8000-000000001201';
  exception
    when insufficient_privilege then
      return;
  end;

  raise exception 'authenticated nickname update should be denied';
end;
$$;

do $$
begin
  begin
    update public.profiles
    set avatar_path = '00000000-0000-4000-8000-000000001201/profile/88888888-8888-4888-8888-888888888888.jpg'
    where id = '00000000-0000-4000-8000-000000001201';
  exception
    when insufficient_privilege then
      return;
  end;

  raise exception 'authenticated avatar update should be denied';
end;
$$;

update public.profiles
set birth_date = '1999-01-01'
where id = '00000000-0000-4000-8000-000000001202';

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', '', true);

select 1 / case when (
  select birth_date
  from public.profiles
  where id = '00000000-0000-4000-8000-000000001202'
) is null then 1 else 0 end as assert_other_user_update_remains_blocked_by_rls;

rollback;
