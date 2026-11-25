\set ON_ERROR_STOP on
begin;

-- ============================================================================
-- ICONS · 카카오 연결 해제 탈퇴 검토 대기의 어드민 처리(20261119100000)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   · 봉인: 새 RPC 2개는 authenticated만 실행하고(platform.manage 가드), 새 private helper는 어느 API 롤에도 열리지 않는다.
--     새 RPC와 재정의한 두 RPC의 계약 분류가 등록돼 있고 패치 helper는 남지 않는다
--   · 권한: 로그인 없음·platform.manage 없는 매니저(계정 부매니저)는 대기 목록·처리 모두 거절
--   · 대기 목록: 카카오로만 가입해 연결을 끊은 회원만, 알림 시각 순, 가린 이메일·사유·카카오계정 탈퇴 여부
--   · 처리 상태 문서: 대기 중이면 kakaoUnlink를 더하고, 대기 목록에 없는 회원은 이전 모양 그대로
--   · 사유별 근거: 카카오계정 탈퇴(ACCOUNT_DELETE·FORCED_ACCOUNT_DELETE)만 해제 알림으로 처리하고, 연결만 끊은 사유는
--     회원 확인(1:1 문의)이 필요하다고 거절한다. 대기 목록에 없는 회원은 거절. 거절은 아무것도 바꾸지 않는다
--   · 진행 중 의무가 있으면 blocked(카카오 identity도 그대로)
--   · 처리: 문의 탈퇴와 같은 삭제·정지·세션 종료에 카카오 identity·공급자 목록·카카오 user metadata 정리를 더한다. 처리 기록은
--     basis kakao_unlink와 해제 이벤트, 감사는 해제 사유·시각(메모·카카오 회원번호 없음). 비밀번호 없는 이메일 identity는 남는다
--   · 멱등: 카카오·문의 RPC 어느 쪽으로 다시 불러도 처음 기록. 재로그인 차단 확인 감사에 basis. 정지 해제 차단
--   · 연결만 끊은 회원은 1:1 문의로 기존 경로에서 처리되고 그 문서·감사 모양은 문의 탈퇴 그대로, 대기 목록에서 빠진다
--   · 근거 검사: 근거와 다른 칸 조합은 표가 거절하고, 처리 기록이 있는 동안 근거 해제 행은 지울 수 없으며 회원 삭제는 막지 않는다
--   · 20261125233000: 근거와 무관하게 남은 로그인 연결(이메일 identity 포함)·Auth 프로필 정보도 지우고(loginIdentities),
--     카카오 계정은 재가입 차단 값으로 막는다. 이메일 원문은 처리 3일 뒤 정리 잡이 지운다
-- ============================================================================

select 1/case when (
  has_function_privilege('authenticated','public.admin_process_kakao_unlink_withdrawal(uuid,text)','execute')
  and not has_function_privilege('anon','public.admin_process_kakao_unlink_withdrawal(uuid,text)','execute')
  and not has_function_privilege('service_role','public.admin_process_kakao_unlink_withdrawal(uuid,text)','execute')
  and has_function_privilege('authenticated','public.admin_kakao_unlink_withdrawal_queue()','execute')
  and not has_function_privilege('anon','public.admin_kakao_unlink_withdrawal_queue()','execute')
  and not has_function_privilege('service_role','public.admin_kakao_unlink_withdrawal_queue()','execute')
  and (select provolatile = 's' from pg_proc where oid = 'public.admin_kakao_unlink_withdrawal_queue()'::regprocedure)
  and (select provolatile = 's' from pg_proc where oid = 'private.member_withdrawal_document(uuid)'::regprocedure)
  and (select bool_and(not has_function_privilege(r, p, 'execute'))
    from unnest(array['anon', 'authenticated', 'service_role']) r,
      unnest(array['private.process_member_withdrawal(uuid,uuid,text,bigint,text,text)'::regprocedure,
        'private.check_member_withdrawal_request(uuid,uuid,text)'::regprocedure,
        'private.erase_member_kakao_identities(uuid)'::regprocedure,
        'private.kakao_unlink_closes_account(text)'::regprocedure]) p)
  and (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.oid in (
    'public.admin_process_kakao_unlink_withdrawal(uuid,text)'::regprocedure,
    'public.admin_kakao_unlink_withdrawal_queue()'::regprocedure,
    'private.process_member_withdrawal(uuid,uuid,text,bigint,text,text)'::regprocedure,
    'private.check_member_withdrawal_request(uuid,uuid,text)'::regprocedure,
    'private.erase_member_kakao_identities(uuid)'::regprocedure))
  and (select count(*) from private.operator_rpc_contracts where capability = 'platform.manage' and not legacy_admin_only and (
    (signature = 'public.admin_process_kakao_unlink_withdrawal(uuid,text)' and guard_kind = 'write')
    or (signature = 'public.admin_kakao_unlink_withdrawal_queue()' and guard_kind = 'read')
    or (signature = 'public.admin_process_member_withdrawal(uuid,bigint,text)' and guard_kind = 'write')
    or (signature = 'public.admin_confirm_member_withdrawal_signin_block(uuid)' and guard_kind = 'write'))) = 4
  and not has_table_privilege('service_role','private.kakao_unlink_withdrawal_queue','select')
  and not has_table_privilege('authenticated','private.member_withdrawal_processings','select')
  and to_regproc('private.t11_kakao_withdrawal_patch_function') is null
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
  select ('a11c0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.as_actor(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  perform set_config('request.jwt.claims', case when p is null then '' else jsonb_build_object('sub', p, 'role', 'authenticated')::text end, true);
end $$;

-- 1: 처리하는 운영자(계정 주매니저), 2: 권한 없는 계정 부매니저.
-- 카카오로만 가입: 3 카카오계정 탈퇴(지울 데이터 있음), 4 연결된 서비스 관리에서 해제, 5 장기 휴면 강제 탈퇴 + 결제완료 주문,
-- 6 해제 알림 없음, 8 카카오계정 탈퇴 + 비밀번호 없는 이메일 identity. 7: 처리 뒤 남아야 할 다른 회원.
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'kakao-wd-' || n || '@example.test', now(),
  case when n = 8 then '{"provider":"kakao","providers":["email","kakao"]}'::jsonb
       when n between 3 and 8 then '{"provider":"kakao","providers":["kakao"]}'::jsonb else '{}'::jsonb end,
  case when n = 3 then '{"name":"카카오삼","avatar_url":"https://k.kakaocdn.net/3.jpg","sub":"9100000003","email":"kakao-wd-3@example.test","onboarding_note":"keep"}'::jsonb
       else '{}'::jsonb end,
  now() - interval '10 days', now() - interval '10 days'
from generate_series(1, 8) n;
update public.profiles
set nickname = 'TEST 카카오 탈퇴 ' || right(id::text, 1), birth_date = '1990-01-01', onboarded_at = now(),
  consents = '{"terms":true,"privacy":true}'::jsonb,
  role = case when id = pg_temp.uid(1) then 'admin'::public.user_role when id = pg_temp.uid(2) then 'staff'::public.user_role
    else 'user'::public.user_role end
where id in (select pg_temp.uid(n) from generate_series(1, 8) n);
insert into private.operator_memberships(profile_id, manager_role) values (pg_temp.uid(1), 'primary'), (pg_temp.uid(2), 'deputy');
update private.operator_access_state set configured = true where id;

insert into auth.identities(provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select '910000000' || n, pg_temp.uid(n),
  case when n = 3 then '{"sub":"9100000003","provider_id":"9100000003","name":"카카오삼","avatar_url":"https://k.kakaocdn.net/3.jpg","email":"kakao-wd-3@example.test"}'::jsonb
       else jsonb_build_object('sub', '910000000' || n) end,
  'kakao', now() - interval '2 days', now() - interval '10 days', now() - interval '2 days'
from unnest(array[3, 4, 5, 6, 8]) n;
insert into auth.identities(provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (pg_temp.uid(8)::text, pg_temp.uid(8), jsonb_build_object('sub', pg_temp.uid(8)::text, 'email', 'kakao-wd-8@example.test'),
  'email', null, now() - interval '3 days', now() - interval '3 days');

-- 회원 3의 지울 데이터와 남겨야 할 다른 회원 7의 데이터.
insert into public.address_book_entries(user_id, label, recipient_name, phone, postal_code, address1, is_default) values
  (pg_temp.uid(3), '집', '카카오회원', '01055556666', '04524', '서울 중구 세종대로 110', true),
  (pg_temp.uid(7), '집', '다른회원', '01077778888', '04524', '서울 중구 세종대로 110', true);
select private.write_customer_marketing_consent(pg_temp.uid(3), 'email', true, 'marketing-channels-v1', 'onboarding', clock_timestamp() - interval '1 day');
update public.profiles set consents = consents || '{"marketing":true}'::jsonb where id = pg_temp.uid(3);
insert into auth.sessions(id, user_id, created_at, updated_at) values
  ('a11c5e55-0000-4000-8000-000000000301', pg_temp.uid(3), now(), now()),
  ('a11c5e55-0000-4000-8000-000000000701', pg_temp.uid(7), now(), now());

-- 회원 5: 결제완료 주문(진행 중 의무).
set local session_replication_role = replica;
insert into public.orders(user_id, total, order_number, status) values (pg_temp.uid(5), 10000, '2026111919990501', 'paid');
set local session_replication_role = origin;

-- 카카오가 서명한 연결 해제 알림을 웹훅 경로(service_record_kakao_unlink)로 넣는다 — 모두 카카오로만 가입했으므로 탈퇴 검토 대기.
select 1/case when (select bool_and(public.service_record_kakao_unlink('wd-set-' || n, '910000000' || n, reason, now() - make_interval(hours => hours))->>'status' = 'withdrawal_review')
  from (values (3, 'ACCOUNT_DELETE', 4), (4, 'UNLINK_FROM_APPS', 3), (5, 'FORCED_ACCOUNT_DELETE', 2), (8, 'ACCOUNT_DELETE', 1)) as v(n, reason, hours))
  then 1 else 0 end as unlink_events_queued;

-- ---------------------------------------------------------------------------
-- 권한
-- ---------------------------------------------------------------------------
select pg_temp.as_actor(null);
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_process_kakao_unlink_withdrawal(%L, %L)', pg_temp.uid(3), '카카오계정 탈퇴 확인'), 'auth_required');
select pg_temp.expect_error('select public.admin_kakao_unlink_withdrawal_queue()', 'operator_capability_required');
reset role;
select pg_temp.as_actor(pg_temp.uid(2));
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_process_kakao_unlink_withdrawal(%L, %L)', pg_temp.uid(3), '카카오계정 탈퇴 확인'), 'operator_capability_required');
select pg_temp.expect_error('select public.admin_kakao_unlink_withdrawal_queue()', 'operator_capability_required');
reset role;

-- ---------------------------------------------------------------------------
-- 대기 목록·처리 상태 문서
-- ---------------------------------------------------------------------------
select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select public.admin_kakao_unlink_withdrawal_queue() as queue_before \gset
select public.admin_member_withdrawal_status(pg_temp.uid(3)) as status3_before \gset
select public.admin_member_withdrawal_status(pg_temp.uid(4)) as status4_before \gset
select public.admin_member_withdrawal_status(pg_temp.uid(6)) as status6_before \gset
reset role;

select 1/case when jsonb_array_length(:'queue_before'::jsonb) = 4
  and (select array_agg(e->>'userId' order by o) from jsonb_array_elements(:'queue_before'::jsonb) with ordinality as t(e, o))
    = array[pg_temp.uid(3)::text, pg_temp.uid(4)::text, pg_temp.uid(5)::text, pg_temp.uid(8)::text]
  and ((:'queue_before'::jsonb)->0) - 'eventAt' = jsonb_build_object('userId', pg_temp.uid(3), 'nickname', 'TEST 카카오 탈퇴 3',
    'maskedEmail', 'k***@example.test', 'reason', 'ACCOUNT_DELETE', 'accountClosed', true, 'suspended', false)
  and ((:'queue_before'::jsonb)->1->>'accountClosed')::boolean = false
  and ((:'queue_before'::jsonb)->2->>'reason') = 'FORCED_ACCOUNT_DELETE' and ((:'queue_before'::jsonb)->2->>'accountClosed')::boolean
  and not (:'queue_before'::text like '%9100000003%' or :'queue_before'::text like '%kakao-wd-3@%')
  then 1 else 0 end as queue_lists_kakao_only_unlinks_with_masked_email;

select 1/case when (:'status3_before'::jsonb) - 'kakaoUnlink'
    = '{"processed":false,"processedAt":null,"inquiryReference":null,"signinBlocked":false,"signinBlockedAt":null}'::jsonb
  and (:'status3_before'::jsonb)->'kakaoUnlink'->>'reason' = 'ACCOUNT_DELETE'
  and ((:'status3_before'::jsonb)->'kakaoUnlink'->>'accountClosed')::boolean
  and ((:'status4_before'::jsonb)->'kakaoUnlink'->>'accountClosed')::boolean = false
  and (:'status6_before'::jsonb)
    = '{"processed":false,"processedAt":null,"inquiryReference":null,"signinBlocked":false,"signinBlockedAt":null}'::jsonb
  then 1 else 0 end as status_document_adds_pending_unlink_only;

-- ---------------------------------------------------------------------------
-- 입력·근거 확인: 거절은 아무것도 바꾸지 않는다
-- ---------------------------------------------------------------------------
select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_process_kakao_unlink_withdrawal(%L, %L)', pg_temp.uid(3), ' 가 '), 'invalid_member_withdrawal');
select pg_temp.expect_error(format('select public.admin_process_kakao_unlink_withdrawal(%L, %L)', pg_temp.uid(3), repeat('가', 201)), 'invalid_member_withdrawal');
select pg_temp.expect_error(format('select public.admin_process_kakao_unlink_withdrawal(%L, %L)', pg_temp.uid(1), '카카오계정 탈퇴 확인'), 'cannot_withdraw_self');
select pg_temp.expect_error(format('select public.admin_process_kakao_unlink_withdrawal(%L, %L)', 'a11c0000-0000-4000-8000-0000000000ff', '카카오계정 탈퇴 확인'), 'profile_not_found');
-- 연결만 끊은 회원은 회원 확인(1:1 문의)이 필요하고, 해제 알림이 없는 회원은 대기 목록에 없다.
select pg_temp.expect_error(format('select public.admin_process_kakao_unlink_withdrawal(%L, %L)', pg_temp.uid(4), '카카오 연결 해제 확인'), 'kakao_unlink_member_request_required');
select pg_temp.expect_error(format('select public.admin_process_kakao_unlink_withdrawal(%L, %L)', pg_temp.uid(6), '카카오 연결 해제 확인'), 'kakao_unlink_withdrawal_not_queued');
select public.admin_process_kakao_unlink_withdrawal(pg_temp.uid(5), '카카오계정 강제 탈퇴 확인') as blocked5 \gset
reset role;

select 1/case when (:'blocked5'::jsonb)->>'status' = 'blocked'
  and (:'blocked5'::jsonb)->'blockers' @> '[{"code":"active_order","count":1,"path":"/orders"}]'::jsonb
  and not exists (select 1 from private.member_withdrawal_processings)
  and not exists (select 1 from public.profiles where id in (pg_temp.uid(4), pg_temp.uid(5), pg_temp.uid(6)) and suspended_at is not null)
  and (select count(*) from auth.identities where user_id in (pg_temp.uid(4), pg_temp.uid(5), pg_temp.uid(6)) and provider = 'kakao') = 3
  and not exists (select 1 from public.audit_log where action like 'admin.member.withdrawal%')
  then 1 else 0 end as refusals_change_nothing;

-- ---------------------------------------------------------------------------
-- 처리(카카오계정 탈퇴 알림 근거)
-- ---------------------------------------------------------------------------
select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select public.admin_process_kakao_unlink_withdrawal(pg_temp.uid(3), '카카오계정 탈퇴 알림 확인') as processed3 \gset
reset role;

select 1/case when (:'processed3'::jsonb)->>'status' = 'processed'
  and ((:'processed3'::jsonb)->>'processed')::boolean
  and (:'processed3'::jsonb)->'inquiryReference' = 'null'::jsonb
  and (:'processed3'::jsonb)->>'basis' = 'kakao_unlink'
  and (:'processed3'::jsonb)->'kakaoUnlink'->>'reason' = 'ACCOUNT_DELETE'
  and ((:'processed3'::jsonb)->'kakaoUnlink'->>'accountClosed')::boolean
  and ((:'processed3'::jsonb)->>'suspended')::boolean
  and (:'processed3'::jsonb)->'erased' = jsonb_build_object('addressBookEntries', 1, 'phoneNumbers', 0, 'marketingConsents', 1,
    'demographicConsents', 0, 'activityEvents', 0, 'activityConsents', 0, 'emailChangeRequests', 0, 'restockAlerts', 0, 'kakaoIdentities', 1,
    'profileFields', jsonb_build_array('nickname', 'birthDate'), 'adultVerifications', 0,
    'wishlistItems', 0, 'cartItems', 0, 'notifications', 0, 'follows', 0, 'coupons', 0, 'loginIdentities', 0)
  and ((:'processed3'::jsonb)->>'revokedSessions')::integer = 1
  then 1 else 0 end as kakao_process_result_shape;

select 1/case when (select suspended_at is not null and suspension_reason = '탈퇴 처리 · 카카오계정 탈퇴 알림 · 카카오계정 탈퇴 알림 확인'
    from public.profiles where id = pg_temp.uid(3))
  and not exists (select 1 from public.address_book_entries where user_id = pg_temp.uid(3))
  and (select bool_and(not agreed and source = 'member_withdrawal') from private.customer_marketing_consents where user_id = pg_temp.uid(3))
  and not exists (select 1 from auth.sessions where user_id = pg_temp.uid(3))
  -- 카카오 identity와 user metadata 전체를 지우고 공급자 목록을 비운다(20261125233000). 계정과 이메일 원문은 처리 3일 뒤까지 남는다.
  and not exists (select 1 from auth.identities where user_id = pg_temp.uid(3))
  and (select raw_app_meta_data from auth.users where id = pg_temp.uid(3)) = '{"providers":[]}'::jsonb
  and (select raw_user_meta_data from auth.users where id = pg_temp.uid(3)) = '{}'::jsonb
  and (select email from auth.users where id = pg_temp.uid(3)) = 'kakao-wd-3@example.test'
  -- 같은 카카오 계정·이메일의 재가입 차단 값이 남는다.
  and (select count(*) from private.withdrawn_signin_blocks where digest in (
      private.withdrawn_signin_digest('identity', 'kakao:9100000003'), private.withdrawn_signin_digest('email', 'kakao-wd-3@example.test'))) = 2
  and exists (select 1 from public.profiles where id = pg_temp.uid(3) and email = 'kakao-wd-3@example.test')
  -- 다른 회원은 그대로.
  and exists (select 1 from public.address_book_entries where user_id = pg_temp.uid(7))
  and exists (select 1 from auth.sessions where user_id = pg_temp.uid(7))
  and (select count(*) from auth.identities where provider = 'kakao' and user_id in (pg_temp.uid(4), pg_temp.uid(5), pg_temp.uid(6), pg_temp.uid(8))) = 4
  then 1 else 0 end as kakao_member_erased_and_suspended;

select 1/case when (select count(*) = 1 and bool_and(basis = 'kakao_unlink' and inquiry_reference is null and kakao_unlink_event_id = 'wd-set-3'
      and processed_by = pg_temp.uid(1) and signin_blocked_at is null)
    from private.member_withdrawal_processings where user_id = pg_temp.uid(3))
  and (select actor_id = pg_temp.uid(1)
      and diff - 'kakaoUnlinkEventAt' = jsonb_build_object('basis', 'kakao_unlink', 'kakaoUnlinkReason', 'ACCOUNT_DELETE', 'suspended', true,
        'erased', jsonb_build_object('addressBookEntries', 1, 'phoneNumbers', 0, 'marketingConsents', 1, 'demographicConsents', 0,
          'activityEvents', 0, 'activityConsents', 0, 'emailChangeRequests', 0, 'restockAlerts', 0, 'kakaoIdentities', 1,
    'profileFields', jsonb_build_array('nickname', 'birthDate'), 'adultVerifications', 0,
    'wishlistItems', 0, 'cartItems', 0, 'notifications', 0, 'follows', 0, 'coupons', 0, 'loginIdentities', 0),
        'revokedSessions', 1)
      and (diff->>'kakaoUnlinkEventAt')::timestamptz = (select event_at from private.kakao_unlink_events where event_id = 'wd-set-3')
    from public.audit_log where action = 'admin.member.withdrawal_processed' and target = 'profile:' || pg_temp.uid(3))
  and not exists (select 1 from public.audit_log where target = 'profile:' || pg_temp.uid(3)
    and (diff::text like '%탈퇴 알림 확인%' or diff::text like '%9100000003%' or diff::text like '%01055556666%'))
  -- 처리한 회원은 대기 목록에서 빠지고 해제 원장 행은 그대로 남는다.
  and not exists (select 1 from private.kakao_unlink_withdrawal_queue where user_id = pg_temp.uid(3))
  and exists (select 1 from private.kakao_unlink_events where event_id = 'wd-set-3' and outcome = 'withdrawal_review')
  then 1 else 0 end as kakao_processing_record_and_audit;

-- ---------------------------------------------------------------------------
-- 멱등·재로그인 차단 확인·정지 해제 차단
-- ---------------------------------------------------------------------------
insert into auth.sessions(id, user_id, created_at, updated_at) values ('a11c5e55-0000-4000-8000-000000000302', pg_temp.uid(3), now(), now());
select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select public.admin_process_kakao_unlink_withdrawal(pg_temp.uid(3), '다시 누름') as replay3 \gset
select public.admin_process_member_withdrawal(pg_temp.uid(3), 999999999999, '문의 경로로 다시 누름') as replay3_inquiry \gset
select public.admin_member_withdrawal_status(pg_temp.uid(3)) as status3_after \gset
reset role;
select 1/case when (:'replay3'::jsonb)->>'status' = 'already_processed'
  and ((:'replay3'::jsonb)->>'revokedSessions')::integer = 1
  and (:'replay3'::jsonb)->>'basis' = 'kakao_unlink'
  and (:'replay3_inquiry'::jsonb)->>'status' = 'already_processed'
  and (:'replay3_inquiry'::jsonb)->>'basis' = 'kakao_unlink'
  and (:'status3_after'::jsonb) - 'processedAt' - 'kakaoUnlink' = '{"processed":true,"inquiryReference":null,"signinBlocked":false,"signinBlockedAt":null,"avatarErasePending":false,"basis":"kakao_unlink"}'::jsonb
  and (select count(*) from private.member_withdrawal_processings) = 1
  and (select count(*) from public.audit_log where action = 'admin.member.withdrawal_processed') = 1
  and not exists (select 1 from auth.sessions where user_id = pg_temp.uid(3))
  then 1 else 0 end as kakao_replay_is_idempotent;

-- 카카오 근거 처리도 프로필을 익명화한다(닉네임·생년월일; 사진이 없었으니 지울 사진 경로는 없다). 다른 회원은 그대로다.
select 1/case when (select nickname = '탈퇴한 회원 ' || left(md5(pg_temp.uid(3)::text), 6) and birth_date is null and avatar_path is null
    from public.profiles where id = pg_temp.uid(3))
  and (select nickname = 'TEST 카카오 탈퇴 1' and birth_date = date '1990-01-01' from public.profiles where id = pg_temp.uid(1))
  and (select not avatar_erase_pending and avatar_erased_at is null from private.member_withdrawal_processings where user_id = pg_temp.uid(3))
  and (select diff->'erased'->'profileFields' = jsonb_build_array('nickname', 'birthDate') from public.audit_log
    where action = 'admin.member.withdrawal_processed' and target = 'profile:' || pg_temp.uid(3))
  then 1 else 0 end as kakao_withdrawal_anonymizes_profile;

update auth.users set banned_until = now() + interval '100 years' where id = pg_temp.uid(3);
select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select public.admin_confirm_member_withdrawal_signin_block(pg_temp.uid(3)) as blocked3 \gset
select pg_temp.expect_error(format('select public.admin_unsuspend_user(%L)', pg_temp.uid(3)), 'member_withdrawn');
reset role;
select 1/case when ((:'blocked3'::jsonb)->>'signinBlocked')::boolean
  and (select count(*) from public.audit_log where action = 'admin.member.withdrawal_signin_blocked' and target = 'profile:' || pg_temp.uid(3)
    and diff = jsonb_build_object('inquiryReference', null, 'revokedSessions', 0, 'basis', 'kakao_unlink')) = 1
  then 1 else 0 end as kakao_signin_block_audit_has_basis;

-- ---------------------------------------------------------------------------
-- 비밀번호 없는 이메일 identity가 있는 회원: 카카오 identity는 kakaoIdentities로, 남은 이메일 identity는 loginIdentities로 지운다
-- (20261125233000 — 재로그인은 장기 차단이 막고, 로그인 연결은 보존 근거가 없다)
-- ---------------------------------------------------------------------------
select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select public.admin_process_kakao_unlink_withdrawal(pg_temp.uid(8), '카카오계정 탈퇴 알림 확인') as processed8 \gset
reset role;
select 1/case when (:'processed8'::jsonb)->>'status' = 'processed'
  and ((:'processed8'::jsonb)->'erased'->>'kakaoIdentities')::integer = 1
  and ((:'processed8'::jsonb)->'erased'->>'loginIdentities')::integer = 1
  and not exists (select 1 from auth.identities where user_id = pg_temp.uid(8))
  and (select raw_app_meta_data from auth.users where id = pg_temp.uid(8)) = '{"providers":[]}'::jsonb
  then 1 else 0 end as all_login_identities_erased;

-- ---------------------------------------------------------------------------
-- 연결만 끊은 회원: 회원이 쓴 1:1 문의로 기존 경로에서 처리 — 문서·감사는 문의 탈퇴 모양, 대기 목록에서 빠진다
-- ---------------------------------------------------------------------------
insert into public.inquiries(user_id, category, title) values (pg_temp.uid(4), 'account', '회원 탈퇴 요청합니다');
select max(reference) as ref4 from public.inquiries where user_id = pg_temp.uid(4) \gset
select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select public.admin_process_member_withdrawal(pg_temp.uid(4), :ref4, '1:1 문의 탈퇴 요청 확인') as processed4 \gset
select public.admin_kakao_unlink_withdrawal_queue() as queue_after \gset
reset role;
select 1/case when (:'processed4'::jsonb)->>'status' = 'processed'
  and not ((:'processed4'::jsonb) ? 'basis') and not ((:'processed4'::jsonb) ? 'kakaoUnlink')
  and ((:'processed4'::jsonb)->>'inquiryReference')::bigint = :ref4
  and not ((:'processed4'::jsonb)->'erased' ? 'kakaoIdentities')
  -- 문의 근거도 로그인 연결을 지우고(loginIdentities) 같은 카카오 계정의 재가입을 막는다(20261125233000).
  and ((:'processed4'::jsonb)->'erased'->>'loginIdentities')::integer = 1
  and not exists (select 1 from auth.identities where user_id = pg_temp.uid(4))
  and exists (select 1 from private.withdrawn_signin_blocks where digest = private.withdrawn_signin_digest('identity', 'kakao:9100000004'))
  and (select basis = 'inquiry' and inquiry_reference = :ref4 and kakao_unlink_event_id is null
    from private.member_withdrawal_processings where user_id = pg_temp.uid(4))
  and (select diff ? 'inquiryReference' and not diff ? 'basis' from public.audit_log
    where action = 'admin.member.withdrawal_processed' and target = 'profile:' || pg_temp.uid(4))
  and (select suspension_reason = '탈퇴 요청 처리 · 문의 #' || :ref4 || ' · 1:1 문의 탈퇴 요청 확인' from public.profiles where id = pg_temp.uid(4))
  and (select array_agg(e->>'userId') from jsonb_array_elements(:'queue_after'::jsonb) e) = array[pg_temp.uid(5)::text]
  then 1 else 0 end as unlinked_member_processed_by_inquiry;

-- ---------------------------------------------------------------------------
-- 근거 검사·원장 보존·회원 삭제
-- ---------------------------------------------------------------------------
select pg_temp.expect_error(format($q$insert into private.member_withdrawal_processings(user_id, basis, inquiry_reference) values (%L, 'kakao_unlink', null)$q$, pg_temp.uid(7)), 'member_withdrawal_processings_basis_evidence');
select pg_temp.expect_error(format($q$insert into private.member_withdrawal_processings(user_id, basis, inquiry_reference, kakao_unlink_event_id) values (%L, 'inquiry', 5, 'wd-set-5')$q$, pg_temp.uid(7)), 'member_withdrawal_processings_basis_evidence');
select pg_temp.expect_error(format($q$insert into private.member_withdrawal_processings(user_id) values (%L)$q$, pg_temp.uid(7)), 'member_withdrawal_processings_basis_evidence');
select pg_temp.expect_error($q$delete from private.kakao_unlink_events where event_id = 'wd-set-3'$q$, 'member_withdrawal_processings_kakao_unlink_event_id_fkey');
delete from auth.users where id = pg_temp.uid(3);
select 1/case when not exists (select 1 from private.member_withdrawal_processings where user_id = pg_temp.uid(3))
  and not exists (select 1 from private.kakao_unlink_events where event_id = 'wd-set-3')
  then 1 else 0 end as member_delete_cascades_record_and_evidence;

rollback;
