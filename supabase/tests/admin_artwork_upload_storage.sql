\set ON_ERROR_STOP on

begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000011201',
    'authenticated', 'authenticated', 'artwork-staff@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000011202',
    'authenticated', 'authenticated', 'artwork-admin@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000011203',
    'authenticated', 'authenticated', 'artwork-user@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000011204',
    'authenticated', 'authenticated', 'artwork-suspended-staff@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000011205',
    'authenticated', 'authenticated', 'artwork-rate-staff@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000011206',
    'authenticated', 'authenticated', 'artwork-late-staff@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (
  id, email, nickname, birth_date, consents, onboarded_at, role,
  suspended_at, suspension_reason
)
values
  (
    '00000000-0000-4000-8000-000000011201',
    'artwork-staff@example.test', 'artwork_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff', null, null
  ),
  (
    '00000000-0000-4000-8000-000000011202',
    'artwork-admin@example.test', 'artwork_admin', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'admin', null, null
  ),
  (
    '00000000-0000-4000-8000-000000011203',
    'artwork-user@example.test', 'artwork_user', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user', null, null
  ),
  (
    '00000000-0000-4000-8000-000000011204',
    'artwork-suspended-staff@example.test', 'artwork_suspended_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff', now(), 'test fixture'
  ),
  (
    '00000000-0000-4000-8000-000000011205',
    'artwork-rate-staff@example.test', 'artwork_rate_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff', null, null
  ),
  (
    '00000000-0000-4000-8000-000000011206',
    'artwork-late-staff@example.test', 'artwork_late_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff', null, null
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role,
  suspended_at = excluded.suspended_at,
  suspension_reason = excluded.suspension_reason;

select 1 / case when exists (
  select 1
  from storage.buckets
  where id = 'public-media'
    and public
    and file_size_limit = 5 * 1024 * 1024
    and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
) then 1 else 0 end as assert_public_media_bucket_contract;

select 1 / case when exists (
  select 1
  from storage.buckets
  where id = 'admin-artwork-staging'
    and not public
    and file_size_limit = 5 * 1024 * 1024
    and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
) then 1 else 0 end as assert_private_staging_bucket_contract;

select 1 / case when (
  select relrowsecurity
  from pg_catalog.pg_class
  where oid = 'public.admin_artwork_upload_claims'::regclass
) then 1 else 0 end as assert_claims_have_rls;

select 1 / case when
  not has_table_privilege('authenticated', 'public.admin_artwork_upload_claims', 'select')
  and not has_table_privilege('authenticated', 'public.admin_artwork_upload_claims', 'insert')
  and has_table_privilege('service_role', 'public.admin_artwork_upload_claims', 'select')
  and has_table_privilege('service_role', 'public.admin_artwork_upload_claims', 'insert')
then 1 else 0 end as assert_claim_table_acl;

select 1 / case when exists (
  select 1
  from pg_catalog.pg_policy as policy
  where policy.polrelid = 'storage.objects'::regclass
    and policy.polname = 'admin_artwork_staging_insert'
    and policy.polcmd = 'a'
    and policy.polroles = array['authenticated'::regrole::oid]
    and position(
      'can_stage_admin_artwork(name)'
      in pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
    ) > 0
) then 1 else 0 end as assert_staging_insert_policy_contract;

select 1 / case when not exists (
  select 1
  from pg_catalog.pg_policy as policy
  where policy.polrelid = 'storage.objects'::regclass
    and (
      coalesce(pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), '') like '%public-media%'
      or coalesce(pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), '') like '%public-media%'
    )
    and policy.polroles && array['anon'::regrole::oid, 'authenticated'::regrole::oid]
) then 1 else 0 end as assert_public_media_has_no_client_write_policy;

select 1 / case when
  has_function_privilege('authenticated', 'public.can_stage_admin_artwork(text)', 'execute')
  and not has_function_privilege(
    'authenticated',
    'public.service_prepare_admin_artwork_upload(uuid,text,text,text,integer,timestamptz)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.service_prepare_admin_artwork_upload(uuid,text,text,text,integer,timestamptz)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.service_begin_admin_artwork_verification(uuid,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.service_begin_admin_artwork_verification(uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.service_get_admin_artwork_upload_claim(uuid,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.service_get_admin_artwork_upload_claim(uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.service_cancel_admin_artwork_upload(uuid,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.service_cancel_admin_artwork_upload(uuid,text)',
    'execute'
  )
then 1 else 0 end as assert_artwork_function_acl;

select 1 / case when (
  select count(*) = 5
    and bool_and((tgtype & 2) = 0)
  from pg_catalog.pg_trigger
  where not tgisinternal
    and tgname = 'enforce_admin_catalog_artwork_claim'
    and tgrelid in (
      'public.ips'::regclass,
      'public.goods'::regclass,
      'public.cards'::regclass,
      'public.events'::regclass,
      'public.home_curations'::regclass
    )
) then 1 else 0 end as assert_catalog_claim_triggers;

set local role service_role;

select 1 / case when public.service_prepare_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011201',
  'catalog/ip/55555555-5555-4555-8555-555555555555.jpg',
  'ip', 'image/jpeg', 10, now() + interval '10 minutes'
) then 1 else 0 end as assert_staff_claim_created;

select 1 / case when public.service_prepare_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011202',
  'catalog/good/77777777-7777-4777-8777-777777777777.png',
  'good', 'image/png', 10, now() + interval '10 minutes'
) then 1 else 0 end as assert_admin_claim_created;

select 1 / case when public.service_prepare_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011203',
  'catalog/ip/22222222-2222-4222-8222-222222222222.png',
  'ip', 'image/png', 10, now() + interval '10 minutes'
) = false then 1 else 0 end as assert_user_claim_rejected;

select 1 / case when public.service_prepare_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011204',
  'catalog/event/99999999-9999-4999-8999-999999999999.webp',
  'event', 'image/webp', 10, now() + interval '10 minutes'
) = false then 1 else 0 end as assert_suspended_staff_claim_rejected;

-- 굿즈 폼은 업로드 칸이 6개다(대표·갤러리 4칸·상세). 동시 활성 클레임 예산은
-- 그 폼 한 장을 채우고 한 번 갈아끼울 수 있어야 한다(20260807140003).
do $$
declare
  slot integer;
begin
  for slot in 1..12 loop
    if not public.service_prepare_admin_artwork_upload(
      '00000000-0000-4000-8000-000000011205',
      'catalog/card/10000000-0000-4000-8000-' || lpad(slot::text, 12, '0') || '.png',
      'card', 'image/png', 10, now() + interval '10 minutes'
    ) then
      raise exception 'active claim budget must cover a full goods form, failed at slot %', slot;
    end if;
  end loop;
end;
$$;

select 1 / case when public.service_prepare_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011205',
  'catalog/card/10000000-0000-4000-8000-000000000013.png',
  'card', 'image/png', 10, now() + interval '10 minutes'
) = false then 1 else 0 end as assert_actor_active_claim_limit;

delete from public.admin_artwork_upload_claims
where actor_id = '00000000-0000-4000-8000-000000011205';

select public.service_prepare_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011205',
  'catalog/card/20000000-0000-4000-8000-000000000001.png',
  'card', 'image/png', 10, now() + interval '10 minutes'
);
select public.service_prepare_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011205',
  'catalog/card/20000000-0000-4000-8000-000000000002.png',
  'card', 'image/png', 10, now() + interval '10 minutes'
);

select 1 / case when public.service_verify_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011205',
  'catalog/card/20000000-0000-4000-8000-000000000001.png',
  10
) = false then 1 else 0 end as assert_pending_claim_cannot_verify_directly;

select 1 / case when (
  select count(*) = 1
  from public.service_get_admin_artwork_upload_claim(
    '00000000-0000-4000-8000-000000011205',
    'catalog/card/20000000-0000-4000-8000-000000000001.png'
  )
) then 1 else 0 end as assert_legacy_get_starts_first_verification;

select 1 / case when not exists (
  select 1
  from public.service_begin_admin_artwork_verification(
    '00000000-0000-4000-8000-000000011205',
    'catalog/card/20000000-0000-4000-8000-000000000002.png'
  )
) then 1 else 0 end as assert_parallel_verification_blocked;

select public.service_reject_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011205',
  'catalog/card/20000000-0000-4000-8000-000000000001.png'
);

select 1 / case when (
  select count(*) = 1
  from public.service_begin_admin_artwork_verification(
    '00000000-0000-4000-8000-000000011205',
    'catalog/card/20000000-0000-4000-8000-000000000002.png'
  )
) then 1 else 0 end as assert_second_verification_started;

select public.service_reject_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011205',
  'catalog/card/20000000-0000-4000-8000-000000000002.png'
);

select public.service_prepare_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011205',
  'catalog/card/20000000-0000-4000-8000-000000000003.png',
  'card', 'image/png', 10, now() + interval '10 minutes'
);
select public.service_prepare_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011205',
  'catalog/card/20000000-0000-4000-8000-000000000004.png',
  'card', 'image/png', 10, now() + interval '10 minutes'
);

select 1 / case when (
  select count(*) = 1
  from public.service_begin_admin_artwork_verification(
    '00000000-0000-4000-8000-000000011205',
    'catalog/card/20000000-0000-4000-8000-000000000003.png'
  )
) then 1 else 0 end as assert_third_verification_started;
select public.service_reject_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011205',
  'catalog/card/20000000-0000-4000-8000-000000000003.png'
);
select 1 / case when (
  select count(*) = 1
  from public.service_begin_admin_artwork_verification(
    '00000000-0000-4000-8000-000000011205',
    'catalog/card/20000000-0000-4000-8000-000000000004.png'
  )
) then 1 else 0 end as assert_fourth_verification_started;
select public.service_reject_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011205',
  'catalog/card/20000000-0000-4000-8000-000000000004.png'
);

select public.service_prepare_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011205',
  'catalog/card/20000000-0000-4000-8000-000000000005.png',
  'card', 'image/png', 10, now() + interval '10 minutes'
);

select 1 / case when not exists (
  select 1
  from public.service_begin_admin_artwork_verification(
    '00000000-0000-4000-8000-000000011205',
    'catalog/card/20000000-0000-4000-8000-000000000005.png'
  )
) then 1 else 0 end as assert_actor_verification_rate_limit;

select public.service_prepare_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011206',
  'catalog/event/30000000-0000-4000-8000-000000000001.webp',
  'event', 'image/webp', 10, now() + interval '10 minutes'
);
select 1 / case when (
  select count(*) = 1
  from public.service_begin_admin_artwork_verification(
    '00000000-0000-4000-8000-000000011206',
    'catalog/event/30000000-0000-4000-8000-000000000001.webp'
  )
) then 1 else 0 end as assert_late_worker_verification_started;
update public.admin_artwork_upload_claims
set expires_at = now() - interval '1 minute'
where path = 'catalog/event/30000000-0000-4000-8000-000000000001.webp';
select 1 / case when public.service_complete_admin_artwork_cleanup(
  '00000000-0000-4000-8000-000000011206',
  'catalog/event/30000000-0000-4000-8000-000000000001.webp',
  'all'
) then 1 else 0 end as assert_processing_expiry_cleanup_completed;

select 1 / case when public.service_reject_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011206',
  'catalog/event/30000000-0000-4000-8000-000000000001.webp'
) then 1 else 0 end as assert_late_worker_can_reclean_expired_claim;

select 1 / case when exists (
  select 1
  from public.admin_artwork_upload_claims
  where path = 'catalog/event/30000000-0000-4000-8000-000000000001.webp'
    and status = 'rejected'
    and cleanup_completed_at is null
) then 1 else 0 end as assert_late_worker_cleanup_reopened_for_retry;

select 1 / case when public.service_prepare_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011201',
  'catalog/ip/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png',
  'ip', 'image/png', 10, now() + interval '10 minutes'
) then 1 else 0 end as assert_cancel_claim_created;

select 1 / case when public.service_cancel_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011201',
  'catalog/ip/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png'
) then 1 else 0 end as assert_active_claim_cancelled_once;

select public.service_complete_admin_artwork_cleanup(
  '00000000-0000-4000-8000-000000011201',
  'catalog/ip/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png',
  'all'
);

select 1 / case when public.service_cancel_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011201',
  'catalog/ip/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png'
) = false then 1 else 0 end as assert_completed_cancel_cannot_reopen_cleanup;

select 1 / case when exists (
  select 1
  from public.admin_artwork_upload_claims
  where path = 'catalog/ip/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png'
    and status = 'rejected'
    and cleanup_completed_at is not null
) then 1 else 0 end as assert_completed_cancel_remains_closed;

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);

do $$
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('admin-artwork-staging', 'catalog/ip/55555555-5555-4555-8555-555555555555.jpg');
  exception when insufficient_privilege then return;
  end;
  raise exception 'anonymous staging upload should be rejected';
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011203', true);

do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'admin-artwork-staging',
      'catalog/ip/22222222-2222-4222-8222-222222222222.png',
      '00000000-0000-4000-8000-000000011203'
    );
  exception when insufficient_privilege then return;
  end;
  raise exception 'ordinary user staging upload should be rejected';
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011201', true);

do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'admin-artwork-staging',
      'catalog/ip/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png',
      '00000000-0000-4000-8000-000000011201'
    );
  exception when insufficient_privilege then return;
  end;
  raise exception 'unclaimed staff staging upload should be rejected';
end;
$$;

insert into storage.objects (bucket_id, name, owner_id)
values (
  'admin-artwork-staging',
  'catalog/ip/55555555-5555-4555-8555-555555555555.jpg',
  '00000000-0000-4000-8000-000000011201'
);

do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'public-media',
      'catalog/ip/55555555-5555-4555-8555-555555555555.jpg',
      '00000000-0000-4000-8000-000000011201'
    );
  exception when insufficient_privilege then return;
  end;
  raise exception 'active staff must not write directly to public-media';
end;
$$;

do $$
declare
  affected_rows integer;
begin
  update storage.objects
  set name = 'catalog/ip/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg'
  where bucket_id = 'admin-artwork-staging';

  get diagnostics affected_rows = row_count;
  if affected_rows <> 0 then
    raise exception 'staging update should affect no rows';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011202', true);

insert into storage.objects (bucket_id, name, owner_id)
values (
  'admin-artwork-staging',
  'catalog/good/77777777-7777-4777-8777-777777777777.png',
  '00000000-0000-4000-8000-000000011202'
);

reset role;
set local role service_role;

select 1 / case when public.service_prepare_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011201',
  'catalog/ip/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png',
  'ip', 'image/png', 8, now() + interval '10 minutes'
) then 1 else 0 end as assert_attach_claim_created;

select 1 / case when (
  select count(*) = 1
  from public.service_begin_admin_artwork_verification(
    '00000000-0000-4000-8000-000000011201',
    'catalog/ip/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png'
  )
) then 1 else 0 end as assert_attach_verification_started;

select 1 / case when public.service_verify_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011201',
  'catalog/ip/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png',
  8
) then 1 else 0 end as assert_attach_claim_verified;

-- 검증이 끝나면 만료가 업로드 창(10분)을 넘어 폼 작성 창까지 늘어난다.
-- 늘어나지 않으면 6칸 폼을 채우는 사이 먼저 올린 이미지의 클레임이 죽어
-- admin_upsert_good 트랜잭션 전체가 롤백된다(20260807140003).
select 1 / case when exists (
  select 1
  from public.admin_artwork_upload_claims
  where path = 'catalog/ip/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png'
    and status = 'verified'
    and expires_at > now() + interval '1 hour'
) then 1 else 0 end as assert_verified_claim_survives_form_editing;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011201', true);

select public.admin_upsert_ip(
  'qa-artwork-ip', 'QA artwork IP', null, 'character', null, null, null, null,
  'public-media/catalog/ip/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png', false
);

select 1 / case when exists (
  select 1
  from public.ips
  where id = 'qa-artwork-ip'
    and image_path = 'public-media/catalog/ip/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png'
) then 1 else 0 end as assert_verified_artwork_attached;

reset role;
set local role service_role;

select 1 / case when exists (
  select 1
  from public.admin_artwork_upload_claims
  where path = 'catalog/ip/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png'
    and status = 'attached'
    and attached_at is not null
) then 1 else 0 end as assert_verified_claim_consumed_atomically;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011201', true);

do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values (
      'admin-artwork-staging',
      'catalog/ip/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png',
      '00000000-0000-4000-8000-000000011201'
    );
  exception when insufficient_privilege then return;
  end;
  raise exception 'attached claim must not authorize a replayed staging upload';
end;
$$;

-- Unchanged current paths remain editable without a second claim.
select public.admin_upsert_ip(
  'qa-artwork-ip', 'QA artwork IP edited', null, 'character', null, null, null, null,
  'public-media/catalog/ip/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png', false, 'qa-artwork-ip'
);

-- Existing rows consume a replacement claim in the conflict UPDATE trigger,
-- not in the speculative INSERT trigger that runs first for an upsert.
reset role;
set local role service_role;

select 1 / case when public.service_prepare_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011201',
  'catalog/ip/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png',
  'ip', 'image/png', 8, now() + interval '10 minutes'
) then 1 else 0 end as assert_replacement_claim_created;

select 1 / case when (
  select count(*) = 1
  from public.service_begin_admin_artwork_verification(
    '00000000-0000-4000-8000-000000011201',
    'catalog/ip/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png'
  )
) then 1 else 0 end as assert_replacement_verification_started;

select 1 / case when public.service_verify_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011201',
  'catalog/ip/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png',
  8
) then 1 else 0 end as assert_replacement_claim_verified;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011201', true);

select public.admin_upsert_ip(
  'qa-artwork-ip', 'QA replacement artwork IP', null, 'character', null, null, null, null,
  'public-media/catalog/ip/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png', false, 'qa-artwork-ip'
);

select 1 / case when exists (
  select 1
  from public.ips
  where id = 'qa-artwork-ip'
    and image_path = 'public-media/catalog/ip/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png'
) then 1 else 0 end as assert_existing_artwork_replaced;

reset role;
set local role service_role;

select 1 / case when exists (
  select 1
  from public.admin_artwork_upload_claims
  where path = 'catalog/ip/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png'
    and status = 'attached'
    and attached_at is not null
) then 1 else 0 end as assert_replacement_claim_consumed_atomically;

select 1 / case when public.service_reject_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011201',
  'catalog/ip/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png'
) = false then 1 else 0 end as assert_attached_claim_cannot_be_cleaned_as_rejected;

update public.admin_artwork_upload_claims
set expires_at = now() - interval '1 minute'
where path = 'catalog/ip/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png';

select 1 / case when exists (
  select 1
  from public.service_list_admin_artwork_cleanup_candidates(100)
  where path = 'catalog/ip/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png'
    and cleanup_mode = 'staging'
) then 1 else 0 end as assert_expired_attached_claim_preserves_public_artwork;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011201', true);

do $$
begin
  begin
    perform public.admin_upsert_ip(
      'qa-unverified-ip', 'QA unverified IP', null, 'character', null, null, null, null,
      'public-media/catalog/ip/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png', false
    );
  exception when check_violation then
    if sqlerrm = 'unverified_artwork' then return; end if;
    raise;
  end;
  raise exception 'unverified catalog artwork should be rejected';
end;
$$;

-- Home curation artwork uses the same verified, kind-isolated, single-use
-- claim contract. Announcement remains valid without an image; hero does not.
reset role;
set local role service_role;

select 1 / case when public.service_prepare_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011201',
  'catalog/curation/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp',
  'curation', 'image/webp', 8, now() + interval '10 minutes'
) then 1 else 0 end as assert_curation_claim_created;

select 1 / case when (
  select count(*) = 1
  from public.service_begin_admin_artwork_verification(
    '00000000-0000-4000-8000-000000011201',
    'catalog/curation/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp'
  )
) then 1 else 0 end as assert_curation_verification_started;

select 1 / case when public.service_verify_admin_artwork_upload(
  '00000000-0000-4000-8000-000000011201',
  'catalog/curation/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp',
  8
) then 1 else 0 end as assert_curation_claim_verified;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011201', true);

select public.admin_upsert_home_curation(
  '00000000-0000-4000-8000-000000011211',
  '00000000-0000-4000-8000-000000011212',
  'hero', null, '검증된 히어로',
  'public-media/catalog/curation/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp',
  '/', 0, now(), null, true
);

-- The unchanged path on the same row does not require a second upload.
select public.admin_upsert_home_curation(
  '00000000-0000-4000-8000-000000011213',
  '00000000-0000-4000-8000-000000011212',
  'hero', null, '검증된 히어로 수정',
  'public-media/catalog/curation/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp',
  '/', 0, now(), null, true
);

reset role;
set local role service_role;

select 1 / case when exists (
  select 1
  from public.admin_artwork_upload_claims
  where path = 'catalog/curation/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp'
    and kind = 'curation'
    and status = 'attached'
    and attached_at is not null
) then 1 else 0 end as assert_curation_claim_consumed_atomically;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000011201', true);

do $$
begin
  begin
    perform public.admin_upsert_home_curation(
      '00000000-0000-4000-8000-000000011214',
      '00000000-0000-4000-8000-000000011215',
      'hero', null, '재사용 히어로',
      'public-media/catalog/curation/dddddddd-dddd-4ddd-8ddd-dddddddddddd.webp',
      '/', 1, now(), null, true
    );
  exception when check_violation then
    if sqlerrm = 'unverified_artwork' then return; end if;
    raise;
  end;
  raise exception 'attached curation path should not be reusable by another row';
end;
$$;

do $$
begin
  begin
    perform public.admin_upsert_home_curation(
      '00000000-0000-4000-8000-000000011216',
      '00000000-0000-4000-8000-000000011217',
      'hero', null, '미검증 히어로',
      'public-media/catalog/curation/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.png',
      '/', 2, now(), null, true
    );
  exception when check_violation then
    if sqlerrm = 'unverified_artwork' then return; end if;
    raise;
  end;
  raise exception 'unverified curation artwork should be rejected';
end;
$$;

do $$
begin
  begin
    perform public.admin_upsert_home_curation(
      '00000000-0000-4000-8000-000000011218',
      '00000000-0000-4000-8000-000000011219',
      'hero', null, '다른 유형 경로',
      'public-media/catalog/ip/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png',
      '/', 3, now(), null, true
    );
  exception when check_violation then return;
  end;
  raise exception 'cross-kind artwork path should be rejected';
end;
$$;

rollback;
