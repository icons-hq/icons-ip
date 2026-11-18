\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- ICONS · 문의로 받은 회원 탈퇴의 운영자 처리(원장 CUS-036·CUS-035·OPS-021)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   · 봉인: 새 RPC 3개는 authenticated만 실행하고(platform.manage 가드), 처리 기록 표·세션 삭제 helper는 어느 API 롤에도 열리지 않는다
--   · 권한: 로그인 없음 → auth_required, platform.manage 없는 매니저(계정 부매니저) → operator_capability_required
--   · 입력: 메모 길이·문의 번호, 본인 처리 거절, 다른 회원의 문의 번호 거절
--   · 진행 중 의무(탈퇴 신청과 같은 판정)·운영 권한(프로필 역할·매니저 소속)이 있으면 아무것도 바꾸지 않고 blocked + 남은 의무
--   · 처리: 정지(정지 감사 포함)·주소록·휴대폰 번호(요청·이력 포함)·마케팅 수신 동의 철회(원장 source member_withdrawal)·
--     성별 동의·활동 기록·이메일 변경 요청·재입고 알림·로그인 세션 삭제, 처리 기록과 감사 로그(문의 번호·개수, 메모·개인정보 없음).
--     다른 회원 데이터는 그대로
--   · 멱등: 다시 부르면 처음 기록(already_processed)을 돌려주고 그 사이 생긴 세션만 끊는다. 처리 기록·감사는 한 번
--   · 정지 계정은 주소록 저장·휴대폰 인증 요청이 거절되고, 탈퇴 처리한 계정은 정지 해제가 막힌다
--   · 재로그인 차단 확인: auth.users.banned_until이 장기 차단이 아니면 거절, 차단 뒤에는 기록·감사하고 그 사이 세션을 끊는다. 재호출은 replayed
-- ============================================================================

select 1/case when (
  has_function_privilege('authenticated','public.admin_process_member_withdrawal(uuid,bigint,text)','execute')
  and not has_function_privilege('anon','public.admin_process_member_withdrawal(uuid,bigint,text)','execute')
  and not has_function_privilege('service_role','public.admin_process_member_withdrawal(uuid,bigint,text)','execute')
  and has_function_privilege('authenticated','public.admin_confirm_member_withdrawal_signin_block(uuid)','execute')
  and not has_function_privilege('anon','public.admin_confirm_member_withdrawal_signin_block(uuid)','execute')
  and not has_function_privilege('service_role','public.admin_confirm_member_withdrawal_signin_block(uuid)','execute')
  and has_function_privilege('authenticated','public.admin_member_withdrawal_status(uuid)','execute')
  and not has_function_privilege('anon','public.admin_member_withdrawal_status(uuid)','execute')
  and not has_function_privilege('service_role','public.admin_member_withdrawal_status(uuid)','execute')
  and (select provolatile = 's' from pg_proc where oid = 'public.admin_member_withdrawal_status(uuid)'::regprocedure)
  and not has_function_privilege('authenticated','private.revoke_member_auth_sessions(uuid)','execute')
  and not has_function_privilege('service_role','private.revoke_member_auth_sessions(uuid)','execute')
  and not has_function_privilege('authenticated','private.member_withdrawal_document(uuid)','execute')
  and not has_function_privilege('service_role','private.member_withdrawal_document(uuid)','execute')
  and (select relrowsecurity from pg_class where oid = 'private.member_withdrawal_processings'::regclass)
  and not has_table_privilege('authenticated','private.member_withdrawal_processings','select,insert,update,delete')
  and not has_table_privilege('service_role','private.member_withdrawal_processings','select,insert,update,delete')
  and (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.oid in (
    'public.admin_process_member_withdrawal(uuid,bigint,text)'::regprocedure,
    'public.admin_confirm_member_withdrawal_signin_block(uuid)'::regprocedure,
    'public.admin_member_withdrawal_status(uuid)'::regprocedure,
    'private.revoke_member_auth_sessions(uuid)'::regprocedure,
    'private.member_withdrawal_document(uuid)'::regprocedure))
  and (select count(*) from private.operator_rpc_contracts where capability = 'platform.manage' and not legacy_admin_only and (
    (signature = 'public.admin_process_member_withdrawal(uuid,bigint,text)' and guard_kind = 'write')
    or (signature = 'public.admin_confirm_member_withdrawal_signin_block(uuid)' and guard_kind = 'write')
    or (signature = 'public.admin_member_withdrawal_status(uuid)' and guard_kind = 'read')
    or (signature = 'public.admin_unsuspend_user(uuid)' and guard_kind = 'write'))) = 4
  and to_regproc('private.t10_withdrawal_patch_function') is null
) then 1 else 0 end as assert_sealed_acl_and_contracts;

-- ---------------------------------------------------------------------------
-- 픽스처(합성 값)
-- ---------------------------------------------------------------------------
create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if position(expected in sqlerrm) > 0 then return; end if;
    raise;
  end;
  raise exception 'Expected error: % (statement %)', expected, statement;
end $$;
create function pg_temp.uid(n integer) returns uuid language sql immutable as $$
  select ('a10d0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.as_actor(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  perform set_config('request.jwt.claims', case when p is null then '' else jsonb_build_object('sub', p, 'role', 'authenticated')::text end, true);
end $$;
create function pg_temp.d(label text) returns text language sql immutable as $$
  select rpad(replace(encode(convert_to(label, 'UTF8'), 'hex'), '=', ''), 40, 'x')
$$;

-- 1: 처리하는 운영자(계정 주매니저), 2: 권한 없는 계정 부매니저, 3: 탈퇴 회원(데이터 있음), 4: 결제완료 주문이 있는 회원,
-- 5: staff 역할 회원, 6: 물류 매니저 소속(프로필 역할 user), 7: 다른 일반 회원
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'withdrawal-' || n || '@example.test', now(), '{}', '{}'
from generate_series(1, 7) n;
update public.profiles
set nickname = 'TEST 탈퇴 처리 ' || right(id::text, 1), birth_date = '1990-01-01', onboarded_at = now(),
  consents = '{"terms":true,"privacy":true}'::jsonb,
  role = case when id = pg_temp.uid(1) then 'admin'::public.user_role
    when id in (pg_temp.uid(2), pg_temp.uid(5)) then 'staff'::public.user_role else 'user'::public.user_role end
where id in (select pg_temp.uid(n) from generate_series(1, 7) n);
insert into private.operator_memberships(profile_id, manager_role) values
  (pg_temp.uid(1), 'primary'), (pg_temp.uid(2), 'deputy'), (pg_temp.uid(6), 'logistics');
update private.operator_access_state set configured = true where id;

-- 회원 3의 지울 데이터와 남겨야 할 다른 회원 7의 데이터.
insert into public.address_book_entries(user_id, label, recipient_name, phone, postal_code, address1, is_default) values
  (pg_temp.uid(3), '집', '탈퇴회원', '01011112222', '04524', '서울 중구 세종대로 110', true),
  (pg_temp.uid(3), '회사', '탈퇴회원', '01011112222', '06236', '서울 강남구 테헤란로 152', false),
  (pg_temp.uid(7), '집', '다른회원', '01033334444', '04524', '서울 중구 세종대로 110', true);
insert into private.member_phone_numbers(user_id, phone_e164, verified_at) values
  (pg_temp.uid(3), '+821011112222', now()), (pg_temp.uid(7), '+821033334444', now());
insert into private.member_phone_verification_events(user_id, event, phone_digest) values
  (pg_temp.uid(3), 'verified', pg_temp.d('phone three')), (pg_temp.uid(7), 'verified', pg_temp.d('phone seven'));
insert into private.member_phone_verification_challenges(id, user_id, phone_digest, code_digest, status, created_at, expires_at, resolved_at)
values (gen_random_uuid(), pg_temp.uid(3), pg_temp.d('phone three'), pg_temp.d('code'), 'verified',
  clock_timestamp() - interval '10 minutes', clock_timestamp() - interval '5 minutes', clock_timestamp() - interval '9 minutes');
select private.write_customer_marketing_consent(pg_temp.uid(3), 'email', true, 'marketing-channels-v1', 'onboarding', clock_timestamp() - interval '1 day');
select private.write_customer_marketing_consent(pg_temp.uid(3), 'sms', true, 'marketing-channels-v1', 'onboarding', clock_timestamp() - interval '1 day');
select private.write_customer_marketing_consent(pg_temp.uid(7), 'email', true, 'marketing-channels-v1', 'onboarding', clock_timestamp() - interval '1 day');
update public.profiles set consents = consents || '{"marketing":true}'::jsonb where id in (pg_temp.uid(3), pg_temp.uid(7));
insert into private.customer_demographic_consents(user_id, choice, gender, notice_version, revision, accepted_at)
values (pg_temp.uid(3), 'accepted', 'female', 'customer-demographics-v1', 1, now());
insert into private.member_activity_consents(user_id, choice, notice_version, revision, accepted_at)
values (pg_temp.uid(3), 'accepted', 'member-activity-v1', 1, now());
insert into private.member_activity_events(user_id, event_id, consent_revision, kind, page_kind, target_id)
values (pg_temp.uid(3), gen_random_uuid(), 1, 'visit', 'home', 'home'), (pg_temp.uid(3), gen_random_uuid(), 1, 'visit', 'shop', 'shop');
insert into private.member_email_change_challenges(id, user_id, email, email_digest, code_digest, expires_at)
values (gen_random_uuid(), pg_temp.uid(3), 'new-address@example.test', pg_temp.d('new mail'), pg_temp.d('code'), clock_timestamp() + interval '10 minutes');
insert into public.ips(id, title, vertical_key) values ('withdrawal-ip', 'TEST 탈퇴 처리 IP', 'character');
insert into public.goods(id, ip_id, name, type, price, stock, stock_qty)
values ('withdrawal-goods', 'withdrawal-ip', 'TEST 탈퇴 처리 굿즈', '문구', 10000, 'soldout', 0);
insert into public.restock_alerts(user_id, good_id) values (pg_temp.uid(3), 'withdrawal-goods'), (pg_temp.uid(7), 'withdrawal-goods');
insert into auth.sessions(id, user_id, created_at, updated_at) values
  ('a10d5e55-0000-4000-8000-000000000301', pg_temp.uid(3), now(), now()),
  ('a10d5e55-0000-4000-8000-000000000302', pg_temp.uid(3), now(), now()),
  ('a10d5e55-0000-4000-8000-000000000701', pg_temp.uid(7), now(), now());
insert into auth.refresh_tokens(token, user_id, revoked, created_at, updated_at, session_id) values
  ('withdrawal-token-301', pg_temp.uid(3)::text, false, now(), now(), 'a10d5e55-0000-4000-8000-000000000301'),
  ('withdrawal-token-legacy', pg_temp.uid(3)::text, false, now(), now(), null),
  ('withdrawal-token-701', pg_temp.uid(7)::text, false, now(), now(), 'a10d5e55-0000-4000-8000-000000000701');

-- 회원 4: 결제완료 주문(진행 중 의무).
set local session_replication_role = replica;
insert into public.orders(user_id, total, order_number, status) values (pg_temp.uid(4), 10000, '2026111819990401', 'paid');
set local session_replication_role = origin;

-- 탈퇴 요청 문의(회원마다 하나).
insert into public.inquiries(user_id, category, title)
select pg_temp.uid(n), 'account', '회원 탈퇴 요청합니다' from unnest(array[3, 4, 5, 6, 7]) n;
-- 문의 번호는 운영자 롤로 바꾸기 전에 읽어 둔다(문의 표는 RLS로 본인·CS만 읽는다).
select max(reference) filter (where user_id = pg_temp.uid(3)) as ref3, max(reference) filter (where user_id = pg_temp.uid(4)) as ref4,
  max(reference) filter (where user_id = pg_temp.uid(5)) as ref5, max(reference) filter (where user_id = pg_temp.uid(6)) as ref6,
  max(reference) filter (where user_id = pg_temp.uid(7)) as ref7
from public.inquiries \gset

-- ---------------------------------------------------------------------------
-- 권한
-- ---------------------------------------------------------------------------
select pg_temp.as_actor(null);
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_process_member_withdrawal(%L, %s, %L)', pg_temp.uid(3), :ref3, '고객 요청'), 'auth_required');
reset role;
select pg_temp.as_actor(pg_temp.uid(2));
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_process_member_withdrawal(%L, %s, %L)', pg_temp.uid(3), :ref3, '고객 요청'), 'operator_capability_required');
select pg_temp.expect_error(format('select public.admin_confirm_member_withdrawal_signin_block(%L)', pg_temp.uid(3)), 'operator_capability_required');
select pg_temp.expect_error(format('select public.admin_member_withdrawal_status(%L)', pg_temp.uid(3)), 'operator_capability_required');
reset role;

-- ---------------------------------------------------------------------------
-- 입력·대상 확인
-- ---------------------------------------------------------------------------
select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_process_member_withdrawal(%L, %s, %L)', pg_temp.uid(3), :ref3, ' 가 '), 'invalid_member_withdrawal');
select pg_temp.expect_error(format('select public.admin_process_member_withdrawal(%L, %s, %L)', pg_temp.uid(3), :ref3, repeat('가', 201)), 'invalid_member_withdrawal');
select pg_temp.expect_error(format('select public.admin_process_member_withdrawal(%L, 0, %L)', pg_temp.uid(3), '고객 요청'), 'invalid_member_withdrawal');
select pg_temp.expect_error(format('select public.admin_process_member_withdrawal(%L, %s, %L)', pg_temp.uid(3), :ref3, E'고객\u0001요청'), 'invalid_member_withdrawal');
select pg_temp.expect_error(format('select public.admin_process_member_withdrawal(%L, %s, %L)', pg_temp.uid(1), :ref3, '고객 요청'), 'cannot_withdraw_self');
select pg_temp.expect_error(format('select public.admin_process_member_withdrawal(%L, %s, %L)', 'a10d0000-0000-4000-8000-0000000000ff', :ref3, '고객 요청'), 'profile_not_found');
-- 다른 회원이 쓴 문의 번호·없는 문의 번호는 받지 않는다.
select pg_temp.expect_error(format('select public.admin_process_member_withdrawal(%L, %s, %L)', pg_temp.uid(3), :ref7, '고객 요청'), 'member_withdrawal_inquiry_not_found');
select pg_temp.expect_error(format('select public.admin_process_member_withdrawal(%L, %s, %L)', pg_temp.uid(3), 999999999999, '고객 요청'), 'member_withdrawal_inquiry_not_found');
select 1/case when (public.admin_member_withdrawal_status(pg_temp.uid(3)))
  = '{"processed":false,"processedAt":null,"inquiryReference":null,"signinBlocked":false,"signinBlockedAt":null}'::jsonb
  then 1 else 0 end as status_before_processing;
select pg_temp.expect_error(format('select public.admin_confirm_member_withdrawal_signin_block(%L)', pg_temp.uid(3)), 'member_withdrawal_not_processed');
reset role;

-- ---------------------------------------------------------------------------
-- 진행 중 의무·운영 권한: 아무것도 바꾸지 않고 남은 의무를 돌려준다
-- ---------------------------------------------------------------------------
select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select public.admin_process_member_withdrawal(pg_temp.uid(4), :ref4, '고객 요청') as blocked_order \gset
select public.admin_process_member_withdrawal(pg_temp.uid(5), :ref5, '고객 요청') as blocked_staff \gset
select public.admin_process_member_withdrawal(pg_temp.uid(6), :ref6, '고객 요청') as blocked_member_operator \gset
reset role;
select 1/case when (:'blocked_order'::jsonb)->>'status' = 'blocked'
  and (:'blocked_order'::jsonb)->'blockers' @> '[{"code":"active_order","count":1,"path":"/orders"}]'::jsonb
  and (:'blocked_staff'::jsonb)->'blockers' = '[{"code":"staff_handover","count":1,"path":"/settings"}]'::jsonb
  and (:'blocked_member_operator'::jsonb)->'blockers' = '[{"code":"staff_handover","count":1,"path":"/settings"}]'::jsonb
  and not exists (select 1 from public.profiles where id in (pg_temp.uid(4), pg_temp.uid(5), pg_temp.uid(6)) and suspended_at is not null)
  and not exists (select 1 from private.member_withdrawal_processings)
  and not exists (select 1 from public.audit_log where action like 'admin.member.withdrawal%'
    or (action = 'admin.member.suspended' and target in ('profile:' || pg_temp.uid(4), 'profile:' || pg_temp.uid(5), 'profile:' || pg_temp.uid(6))))
  then 1 else 0 end as blocked_requests_change_nothing;

-- ---------------------------------------------------------------------------
-- 처리
-- ---------------------------------------------------------------------------
select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select public.admin_process_member_withdrawal(pg_temp.uid(3), :ref3, '1:1 문의 탈퇴 요청 확인') as processed \gset
reset role;

select 1/case when (:'processed'::jsonb)->>'status' = 'processed'
  and ((:'processed'::jsonb)->>'processed')::boolean
  and ((:'processed'::jsonb)->>'inquiryReference')::bigint = :ref3
  and not ((:'processed'::jsonb)->>'signinBlocked')::boolean
  and ((:'processed'::jsonb)->>'suspended')::boolean
  and (:'processed'::jsonb)->'erased' = jsonb_build_object('addressBookEntries', 2, 'phoneNumbers', 1, 'marketingConsents', 2,
    'demographicConsents', 1, 'activityEvents', 2, 'activityConsents', 1, 'emailChangeRequests', 1, 'restockAlerts', 1)
  and ((:'processed'::jsonb)->>'revokedSessions')::integer = 2
  then 1 else 0 end as process_result_shape;

select 1/case when (select suspended_at is not null and suspension_reason = '탈퇴 요청 처리 · 문의 #' || :ref3 || ' · 1:1 문의 탈퇴 요청 확인'
    from public.profiles where id = pg_temp.uid(3))
  and not exists (select 1 from public.address_book_entries where user_id = pg_temp.uid(3))
  and not exists (select 1 from private.member_phone_numbers where user_id = pg_temp.uid(3))
  and not exists (select 1 from private.member_phone_verification_challenges where user_id = pg_temp.uid(3))
  and not exists (select 1 from private.member_phone_verification_events where user_id = pg_temp.uid(3))
  and (select bool_and(not agreed and withdrawn_at is not null and source = 'member_withdrawal' and notice_version = 'marketing-channels-v1')
    from private.customer_marketing_consents where user_id = pg_temp.uid(3))
  and (select count(*) from private.customer_marketing_consent_events where user_id = pg_temp.uid(3) and not agreed and source = 'member_withdrawal') = 2
  and (select consents->'marketing' = 'false'::jsonb and consents->>'terms' = 'true' from public.profiles where id = pg_temp.uid(3))
  and (select choice = 'declined' and gender is null from private.customer_demographic_consents where user_id = pg_temp.uid(3))
  and not exists (select 1 from private.member_activity_events where user_id = pg_temp.uid(3))
  and (select choice = 'declined' from private.member_activity_consents where user_id = pg_temp.uid(3))
  and not exists (select 1 from private.member_email_change_challenges where user_id = pg_temp.uid(3))
  and not exists (select 1 from public.restock_alerts where user_id = pg_temp.uid(3))
  and not exists (select 1 from auth.sessions where user_id = pg_temp.uid(3))
  and not exists (select 1 from auth.refresh_tokens where user_id = pg_temp.uid(3)::text)
  -- 프로필·Auth 사용자·문의는 남긴다(hard delete 범위).
  and exists (select 1 from public.profiles where id = pg_temp.uid(3) and email = 'withdrawal-3@example.test')
  and exists (select 1 from auth.users where id = pg_temp.uid(3) and banned_until is null)
  and exists (select 1 from public.inquiries where user_id = pg_temp.uid(3))
  then 1 else 0 end as member_data_erased_and_account_suspended;

select 1/case when exists (select 1 from public.address_book_entries where user_id = pg_temp.uid(7))
  and exists (select 1 from private.member_phone_numbers where user_id = pg_temp.uid(7))
  and exists (select 1 from private.member_phone_verification_events where user_id = pg_temp.uid(7))
  and exists (select 1 from private.customer_marketing_consents where user_id = pg_temp.uid(7) and agreed)
  and exists (select 1 from public.restock_alerts where user_id = pg_temp.uid(7))
  and exists (select 1 from auth.sessions where user_id = pg_temp.uid(7))
  and exists (select 1 from auth.refresh_tokens where user_id = pg_temp.uid(7)::text)
  and (select suspended_at is null from public.profiles where id = pg_temp.uid(7))
  then 1 else 0 end as other_member_untouched;

-- 처리 기록·감사: 문의 번호·처리자·개수만 남고 메모·개인정보 원문은 없다. 정지 감사도 같은 운영자로 남는다.
select 1/case when (select count(*) = 1 and min(inquiry_reference) = :ref3 and bool_and(processed_by = pg_temp.uid(1))
    and bool_and(signin_blocked_at is null) from private.member_withdrawal_processings where user_id = pg_temp.uid(3))
  and (select count(*) from public.audit_log where action = 'admin.member.withdrawal_processed' and target = 'profile:' || pg_temp.uid(3)) = 1
  and (select actor_id = pg_temp.uid(1)
      and diff = jsonb_build_object('inquiryReference', :ref3, 'suspended', true,
        'erased', jsonb_build_object('addressBookEntries', 2, 'phoneNumbers', 1, 'marketingConsents', 2, 'demographicConsents', 1,
          'activityEvents', 2, 'activityConsents', 1, 'emailChangeRequests', 1, 'restockAlerts', 1),
        'revokedSessions', 2)
    from public.audit_log where action = 'admin.member.withdrawal_processed' and target = 'profile:' || pg_temp.uid(3))
  and (select count(*) from public.audit_log where action = 'admin.member.suspended' and target = 'profile:' || pg_temp.uid(3) and actor_id = pg_temp.uid(1)) = 1
  and not exists (select 1 from public.audit_log where target = 'profile:' || pg_temp.uid(3)
    and (diff::text like '%문의 탈퇴 요청 확인%' or diff::text like '%01011112222%' or diff::text like '%821011112222%' or diff::text like '%세종대로%'))
  then 1 else 0 end as processing_record_and_audit;

-- ---------------------------------------------------------------------------
-- 멱등: 다시 부르면 처음 기록을 돌려주고, 그 사이 생긴 세션만 끊는다
-- ---------------------------------------------------------------------------
insert into auth.sessions(id, user_id, created_at, updated_at) values ('a10d5e55-0000-4000-8000-000000000303', pg_temp.uid(3), now(), now());
select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select public.admin_process_member_withdrawal(pg_temp.uid(3), :ref3, '다시 누름') as replayed \gset
select public.admin_process_member_withdrawal(pg_temp.uid(3), :ref7, '다른 문의 번호') as replayed_other_ref \gset
select public.admin_member_withdrawal_status(pg_temp.uid(3)) as status_after \gset
reset role;
select 1/case when (:'replayed'::jsonb)->>'status' = 'already_processed'
  and ((:'replayed'::jsonb)->>'revokedSessions')::integer = 1
  and ((:'replayed'::jsonb)->>'inquiryReference')::bigint = :ref3
  and (:'replayed_other_ref'::jsonb)->>'status' = 'already_processed'
  and ((:'replayed_other_ref'::jsonb)->>'inquiryReference')::bigint = :ref3
  and ((:'replayed_other_ref'::jsonb)->>'revokedSessions')::integer = 0
  and (:'status_after'::jsonb)->>'processed' = 'true' and (:'status_after'::jsonb)->>'signinBlocked' = 'false'
  and (select count(*) from private.member_withdrawal_processings) = 1
  and (select count(*) from public.audit_log where action = 'admin.member.withdrawal_processed') = 1
  and (select count(*) from public.audit_log where action = 'admin.member.suspended' and target = 'profile:' || pg_temp.uid(3)) = 1
  and (select suspension_reason like '%1:1 문의 탈퇴 요청 확인' from public.profiles where id = pg_temp.uid(3))
  and not exists (select 1 from auth.sessions where user_id = pg_temp.uid(3))
  then 1 else 0 end as replay_is_idempotent;

-- ---------------------------------------------------------------------------
-- 정지 계정의 쓰기 거절·정지 해제 차단
-- ---------------------------------------------------------------------------
select pg_temp.as_actor(pg_temp.uid(3));
set local role authenticated;
select pg_temp.expect_error($q$select public.save_my_address_book_entry(null, '본가', jsonb_build_object('recipientName','탈퇴회원','phone','01011112222','postalCode','48058','address1','부산 해운대구 1'), false)$q$, 'account_suspended');
reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select 1/case when (public.service_issue_member_phone_verification(gen_random_uuid(), pg_temp.uid(3), '+821099998888',
    pg_temp.d('phone again'), null, pg_temp.d('code again'), 300))->>'reason' = 'account_unavailable'
  then 1 else 0 end as suspended_member_cannot_verify_phone;
reset role;
select set_config('request.jwt.claim.role', '', true);
select 1/case when not exists (select 1 from public.address_book_entries where user_id = pg_temp.uid(3))
  and not exists (select 1 from private.member_phone_verification_challenges where user_id = pg_temp.uid(3))
  then 1 else 0 end as suspended_member_writes_nothing;

select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_unsuspend_user(%L)', pg_temp.uid(3)), 'member_withdrawn');
reset role;
select 1/case when (select suspended_at is not null from public.profiles where id = pg_temp.uid(3))
  then 1 else 0 end as withdrawn_member_stays_suspended;

-- 정지 해제 자체는 탈퇴하지 않은 회원에게 그대로 동작한다.
update public.profiles set suspended_at = now(), suspension_reason = 'TEST 일반 정지' where id = pg_temp.uid(7);
select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select 1/case when (public.admin_unsuspend_user(pg_temp.uid(7)))->>'changed' = 'true' then 1 else 0 end as ordinary_unsuspend_still_works;
reset role;

-- ---------------------------------------------------------------------------
-- 재로그인 차단 확인
-- ---------------------------------------------------------------------------
-- 차단이 없거나 짧으면 기록하지 않는다.
select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_confirm_member_withdrawal_signin_block(%L)', pg_temp.uid(3)), 'member_withdrawal_signin_not_blocked');
reset role;
update auth.users set banned_until = now() + interval '1 day' where id = pg_temp.uid(3);
select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_confirm_member_withdrawal_signin_block(%L)', pg_temp.uid(3)), 'member_withdrawal_signin_not_blocked');
reset role;

-- Auth 관리 API의 ban_duration 876000h(100년)를 흉내 낸다. 차단 직전에 생긴 세션도 끊는다.
update auth.users set banned_until = now() + interval '876000 hours' where id = pg_temp.uid(3);
insert into auth.sessions(id, user_id, created_at, updated_at) values ('a10d5e55-0000-4000-8000-000000000304', pg_temp.uid(3), now(), now());
select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select public.admin_confirm_member_withdrawal_signin_block(pg_temp.uid(3)) as blocked \gset
select public.admin_confirm_member_withdrawal_signin_block(pg_temp.uid(3)) as blocked_again \gset
select public.admin_member_withdrawal_status(pg_temp.uid(3)) as status_blocked \gset
reset role;
select 1/case when ((:'blocked'::jsonb)->>'signinBlocked')::boolean
  and not ((:'blocked'::jsonb)->>'replayed')::boolean
  and ((:'blocked'::jsonb)->>'revokedSessions')::integer = 1
  and ((:'blocked_again'::jsonb)->>'replayed')::boolean
  and (:'blocked_again'::jsonb)->>'signinBlockedAt' = (:'blocked'::jsonb)->>'signinBlockedAt'
  and ((:'status_blocked'::jsonb)->>'signinBlocked')::boolean
  and not exists (select 1 from auth.sessions where user_id = pg_temp.uid(3))
  and (select signin_blocked_by = pg_temp.uid(1) and signin_blocked_at >= processed_at from private.member_withdrawal_processings where user_id = pg_temp.uid(3))
  and (select count(*) from public.audit_log where action = 'admin.member.withdrawal_signin_blocked' and target = 'profile:' || pg_temp.uid(3)
    and actor_id = pg_temp.uid(1) and diff = jsonb_build_object('inquiryReference', :ref3, 'revokedSessions', 1)) = 1
  then 1 else 0 end as signin_block_confirmed_once;

rollback;
