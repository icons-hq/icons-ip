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
--     성별 동의·활동 기록·이메일 변경 요청·대기 중인 재입고 알림·로그인 세션 삭제, 처리 기록과 감사 로그(문의 번호·개수, 메모·개인정보 없음).
--     다른 회원 데이터는 그대로
--   · 멱등: 다시 부르면 처음 기록(already_processed)을 돌려주고 그 사이 생긴 세션만 끊는다. 처리 기록·감사는 한 번
--   · 정지 계정은 주소록 저장·휴대폰 인증 요청이 거절되고, 탈퇴 처리한 계정은 정지 해제가 막힌다
--   · 재로그인 차단 확인: auth.users.banned_until이 장기 차단이 아니면 거절, 차단 뒤에는 기록·감사하고 그 사이 세션을 끊는다. 재호출은 replayed
--   · 처리 전 대조용 문의 요약(그 회원의 문의만, platform.manage만)
--   · 정지 회원(20261118165100): 계정 문의만 글로 접수·이어 쓰기(첨부·주문·굿즈 연결은 거절), 그 문의로 탈퇴 처리 가능. 마케팅 동의는 유지·철회만(새로 켜기·직접 쓰기 거절),
--     재입고 알림 신청 거절. 정지되지 않은 회원의 동의는 그대로
--   · 보존 근거 없는 데이터(20261125233000): 위시·장바구니·알림함·IP 팔로우(팬 수 캐시 함께)·알린 재입고 알림·쓰지 않은 쿠폰·출석 코인·
--     소셜 로그인 연결·Auth 프로필 정보도 처리 때 지운다(다른 회원 것은 그대로, 코인 원장 가드는 다른 회원에게 그대로).
--     재가입 차단 값(이메일·소셜 계정의 HMAC, 원문 없음)을 1년 남기고, 처리 3일 뒤 정리 잡이 이메일 원문(프로필·Auth)을 지운다.
--     차단 기간에는 같은 이메일(대소문자·공백 무관)·소셜 계정의 새 가입이 거절되고 기간이 지나면 풀린다. 처리 1년 뒤 정리 잡이
--     마케팅 동의 원장·성별·활동 기록 동의 행을 지운다
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
    or (signature = 'public.admin_unsuspend_user(uuid)' and guard_kind = 'write')
    or (signature = 'public.admin_member_withdrawal_inquiry(uuid,bigint)' and guard_kind = 'read'))) = 5
  and has_function_privilege('authenticated','public.admin_member_withdrawal_inquiry(uuid,bigint)','execute')
  and not has_function_privilege('anon','public.admin_member_withdrawal_inquiry(uuid,bigint)','execute')
  and not has_function_privilege('service_role','public.admin_member_withdrawal_inquiry(uuid,bigint)','execute')
  and (select provolatile = 's' from pg_proc where oid = 'public.admin_member_withdrawal_inquiry(uuid,bigint)'::regprocedure)
  and has_function_privilege('authenticated','public.admin_member_withdrawal_avatar_prefix(uuid)','execute')
  and has_function_privilege('authenticated','public.admin_confirm_member_withdrawal_avatar_erased(uuid)','execute')
  and not has_function_privilege('anon','public.admin_member_withdrawal_avatar_prefix(uuid)','execute')
  and not has_function_privilege('anon','public.admin_confirm_member_withdrawal_avatar_erased(uuid)','execute')
  and not has_function_privilege('service_role','public.admin_member_withdrawal_avatar_prefix(uuid)','execute')
  and not has_function_privilege('service_role','public.admin_confirm_member_withdrawal_avatar_erased(uuid)','execute')
  and (select count(*) from private.operator_rpc_contracts where capability = 'platform.manage' and not legacy_admin_only and (
    (signature = 'public.admin_member_withdrawal_avatar_prefix(uuid)' and guard_kind = 'read')
    or (signature = 'public.admin_confirm_member_withdrawal_avatar_erased(uuid)' and guard_kind = 'write'))) = 2
  and to_regproc('private.o3i_patch_function') is null
  and not has_function_privilege('authenticated','private.erase_withdrawn_member_profile(uuid)','execute')
  and not has_function_privilege('service_role','private.reconcile_withdrawn_member_profile(uuid,uuid)','execute')
  and to_regproc('private.t10_withdrawal_patch_function') is null
  and to_regproc('private.t10_followup_patch_function') is null
  and to_regproc('private.t5_withdrawal_erasure_patch_function') is null
  and (select bool_and(not has_function_privilege(r, p, 'execute'))
    from unnest(array['anon', 'authenticated', 'service_role']) r,
      unnest(array['private.withdrawn_signin_digest(text,text)'::regprocedure,
        'private.block_withdrawn_member_signin(uuid,timestamptz)'::regprocedure,
        'private.reject_withdrawn_member_signup()'::regprocedure,
        'private.erase_withdrawn_member_signin_data(uuid)'::regprocedure,
        'private.erase_withdrawn_member_personal_data(uuid)'::regprocedure,
        'private.erase_withdrawn_member_email(uuid)'::regprocedure,
        'private.run_member_withdrawal_retention(integer)'::regprocedure]) p)
  and (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.oid in (
        'private.withdrawn_signin_digest(text,text)'::regprocedure,
        'private.block_withdrawn_member_signin(uuid,timestamptz)'::regprocedure,
        'private.reject_withdrawn_member_signup()'::regprocedure,
        'private.erase_withdrawn_member_signin_data(uuid)'::regprocedure,
        'private.erase_withdrawn_member_personal_data(uuid)'::regprocedure,
        'private.erase_withdrawn_member_email(uuid)'::regprocedure,
        'private.run_member_withdrawal_retention(integer)'::regprocedure))
  and (select bool_and(c.relrowsecurity) from pg_class c
    where c.oid in ('private.withdrawn_signin_blocks'::regclass, 'private.withdrawn_signin_digest_keys'::regclass))
  and not has_table_privilege('authenticated', 'private.withdrawn_signin_blocks', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'private.withdrawn_signin_blocks', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'private.withdrawn_signin_digest_keys', 'select')
  and not has_table_privilege('service_role', 'private.withdrawn_signin_digest_keys', 'select')
  and (select count(*) from private.withdrawn_signin_digest_keys) = 1
  and exists (select 1 from pg_trigger t where t.tgrelid = 'auth.users'::regclass
    and t.tgname = 'reject_withdrawn_member_signup' and not t.tgisinternal)
  and (select count(*) from cron.job where jobname = 'member-withdrawal-retention' and schedule = '41 * * * *') = 1
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
-- 5: staff 역할 회원, 6: 물류 매니저 소속(프로필 역할 user), 7: 다른 일반 회원, 8: 제재로 먼저 정지된 회원(정지 중 계정 문의로 탈퇴 요청)
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'withdrawal-' || n || '@example.test', now(), '{}', '{}'
from generate_series(1, 8) n;
update public.profiles
set nickname = 'TEST 탈퇴 처리 ' || right(id::text, 1), birth_date = '1990-01-01', onboarded_at = now(),
  consents = '{"terms":true,"privacy":true}'::jsonb,
  role = case when id = pg_temp.uid(1) then 'admin'::public.user_role
    when id in (pg_temp.uid(2), pg_temp.uid(5)) then 'staff'::public.user_role else 'user'::public.user_role end
where id in (select pg_temp.uid(n) from generate_series(1, 8) n);
-- 프로필 익명화 시험: 3(탈퇴 회원)과 7(다른 회원)은 프로필 사진이 있고(3은 Storage 객체도), 6은 3의 익명 닉네임 첫 후보와 겹치는 닉네임을 쓴다.
update public.profiles set avatar_path = id::text || '/profile/aaaaaaaa-0000-4000-8000-00000000000' || right(id::text, 1) || '.png'
where id in (pg_temp.uid(3), pg_temp.uid(7));
insert into storage.objects (bucket_id, name, owner_id)
values ('user-uploads', pg_temp.uid(3)::text || '/profile/aaaaaaaa-0000-4000-8000-000000000003.png', pg_temp.uid(3)::text),
  -- 사진 교체 때 정리에 실패했거나 업로드만 하고 저장하지 않은 후보 파일도 지울 대상이다.
  ('user-uploads', pg_temp.uid(3)::text || '/profile/aaaaaaaa-0000-4000-8000-0000000000c3.webp', pg_temp.uid(3)::text),
  ('user-uploads', pg_temp.uid(7)::text || '/profile/aaaaaaaa-0000-4000-8000-000000000007.png', pg_temp.uid(7)::text);
insert into public.profile_avatar_claims(path, user_id, status, resolved_at)
values (pg_temp.uid(3)::text || '/profile/aaaaaaaa-0000-4000-8000-0000000000c3.webp', pg_temp.uid(3), 'rejected', now()),
  (pg_temp.uid(7)::text || '/profile/aaaaaaaa-0000-4000-8000-000000000007.png', pg_temp.uid(7), 'active', now());
-- 성인 인증 기록(3과 7): 탈퇴 처리가 3의 것만 지운다.
insert into private.adult_verification_sessions(user_id, provider_mode, provider_order_id, callback_nonce_digest, presentation, return_path,
  registration_key, completion_token_digest, state, created_at, expires_at, completed_at)
select pg_temp.uid(n), 'test', 'IV' || repeat(n::text, 32), repeat(n::text, 64), 'page', '/my', 'REGWD0000000000' || n,
  repeat((n + 1)::text, 64), 'verified', now(), now() + interval '30 minutes', now() from unnest(array[3, 7]) n;
insert into private.adult_verifications(user_id, session_id, provider, provider_mode, subject_digest, transaction_digest, policy_version, verified_at, expires_at)
select s.user_id, s.id, 'kcp', 'test', repeat('d', 63) || right(s.user_id::text, 1), repeat('5', 63) || right(s.user_id::text, 1),
  'adult_19_youth_protection_act@2026-10-23', now(), now() + interval '1 year' from private.adult_verification_sessions s;
update public.profiles set nickname = '탈퇴한 회원 ' || left(md5(pg_temp.uid(3)::text), 6) where id = pg_temp.uid(6);
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
insert into public.goods(id, ip_id, name, price, stock, stock_qty)
values ('withdrawal-goods', 'withdrawal-ip', 'TEST 탈퇴 처리 굿즈', 10000, 'soldout', 0);
insert into public.restock_alerts(user_id, good_id) values (pg_temp.uid(3), 'withdrawal-goods'), (pg_temp.uid(7), 'withdrawal-goods');
insert into public.goods(id, ip_id, name, price, stock, stock_qty)
values ('withdrawal-goods-2', 'withdrawal-ip', 'TEST 탈퇴 처리 굿즈 2', 10000, 'ok', 3);
-- 이미 알린 신청(발송 이력)도 보존 근거가 없어 지운다(20261125233000).
insert into public.restock_alerts(user_id, good_id, status, notified_at) values (pg_temp.uid(3), 'withdrawal-goods-2', 'notified', now());
-- 보존 근거 없는 개인화 데이터와 소셜 로그인 연결(20261125233000). 회원 3의 것은 지우고 7의 것은 남긴다.
update auth.users set raw_app_meta_data = '{"provider":"google","providers":["google"]}'::jsonb,
  raw_user_meta_data = '{"name":"탈퇴회원","sub":"wd-google-3","avatar_url":"https://example.test/3.png"}'::jsonb
where id = pg_temp.uid(3);
insert into auth.identities(provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at) values
  ('wd-google-3', pg_temp.uid(3), '{"sub":"wd-google-3","email":"withdrawal-3@example.test","name":"탈퇴회원"}'::jsonb, 'google', now(), now(), now()),
  ('wd-google-7', pg_temp.uid(7), '{"sub":"wd-google-7","email":"withdrawal-7@example.test"}'::jsonb, 'google', now(), now(), now());
insert into public.wishlists(user_id, good_id) values (pg_temp.uid(3), 'withdrawal-goods'), (pg_temp.uid(7), 'withdrawal-goods');
set local session_replication_role = replica;
insert into public.cart_items(user_id, good_id, variant_id, qty)
select u, 'withdrawal-goods-2', (select v.id from public.goods_variants v where v.good_id = 'withdrawal-goods-2' order by v.is_default desc limit 1), 1
from unnest(array[pg_temp.uid(3), pg_temp.uid(7)]) u;
set local session_replication_role = origin;
insert into public.notifications(user_id, type, title, body, link_path, source_type, source_id, dedupe_key)
select u, 'announcement', 'TEST 공지', 'TEST 탈퇴 처리 알림', '/', 'test', 'withdrawal', 'test:withdrawal-notice'
from unnest(array[pg_temp.uid(3), pg_temp.uid(7)]) u;
insert into public.ip_follows(user_id, ip_id) values (pg_temp.uid(3), 'withdrawal-ip'), (pg_temp.uid(7), 'withdrawal-ip');
update public.ips set fans_count = 2 where id = 'withdrawal-ip';
insert into public.coupons(code, name, discount_type, discount_value, starts_at, recipient_segment)
values ('WD-ERASE-1', 'TEST 탈퇴 처리 쿠폰', 'fixed', 1000, now() - interval '1 day', 'all');
insert into public.user_coupons(coupon_code, user_id, issued_source)
values ('WD-ERASE-1', pg_temp.uid(3), 'admin_grant'), ('WD-ERASE-1', pg_temp.uid(7), 'admin_grant');
insert into public.coin_ledger(user_id, amount, reason, attended_on)
values (pg_temp.uid(3), 10, 'attendance', current_date), (pg_temp.uid(7), 10, 'attendance', current_date);
insert into public.coin_balances(user_id, balance) values (pg_temp.uid(3), 10), (pg_temp.uid(7), 10);
insert into public.coin_attendance(user_id, attended_on) values (pg_temp.uid(3), current_date), (pg_temp.uid(7), current_date);
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
    'demographicConsents', 1, 'activityEvents', 2, 'activityConsents', 1, 'emailChangeRequests', 1, 'restockAlerts', 1,
    'profileFields', jsonb_build_array('nickname', 'birthDate', 'avatar'), 'adultVerifications', 2,
    'wishlistItems', 1, 'cartItems', 1, 'notifications', 1, 'follows', 1, 'coupons', 1, 'loginIdentities', 1)
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
  -- 개인화 데이터·소셜 로그인 연결·Auth 프로필 정보는 지운다(20261125233000). 팬 수 캐시도 함께 줄어든다.
  and not exists (select 1 from public.wishlists where user_id = pg_temp.uid(3))
  and not exists (select 1 from public.cart_items where user_id = pg_temp.uid(3))
  and not exists (select 1 from public.notifications where user_id = pg_temp.uid(3))
  and not exists (select 1 from public.ip_follows where user_id = pg_temp.uid(3))
  and (select fans_count from public.ips where id = 'withdrawal-ip') = 1
  and not exists (select 1 from public.user_coupons where user_id = pg_temp.uid(3))
  and not exists (select 1 from public.coin_ledger where user_id = pg_temp.uid(3))
  and not exists (select 1 from public.coin_balances where user_id = pg_temp.uid(3))
  and not exists (select 1 from public.coin_attendance where user_id = pg_temp.uid(3))
  and not exists (select 1 from auth.identities where user_id = pg_temp.uid(3))
  and (select raw_user_meta_data = '{}'::jsonb and raw_app_meta_data = '{"providers":[]}'::jsonb
    from auth.users where id = pg_temp.uid(3))
  -- 재가입 차단 값: 이메일·소셜 계정(구글) 두 개를 처리 시각부터 1년. 원문은 없다.
  and (select count(*) from private.withdrawn_signin_blocks b
    where b.digest in (private.withdrawn_signin_digest('email', 'withdrawal-3@example.test'),
        private.withdrawn_signin_digest('identity', 'google:wd-google-3'))
      and b.blocked_at = (select processed_at from private.member_withdrawal_processings where user_id = pg_temp.uid(3))
      and b.blocked_until = b.blocked_at + interval '1 year') = 2
  and (select count(*) from private.withdrawn_signin_blocks) = 2
  -- 이메일 원문은 처리 결과 안내를 위해 3일 동안 남는다. Auth 사용자·문의도 남는다.
  and exists (select 1 from public.profiles where id = pg_temp.uid(3) and email = 'withdrawal-3@example.test')
  and exists (select 1 from auth.users where id = pg_temp.uid(3) and banned_until is null and email = 'withdrawal-3@example.test')
  and exists (select 1 from public.inquiries where user_id = pg_temp.uid(3))
  and (select email_erased_at is null and retention_purged_at is null from private.member_withdrawal_processings where user_id = pg_temp.uid(3))
  then 1 else 0 end as member_data_erased_and_account_suspended;

select 1/case when exists (select 1 from public.address_book_entries where user_id = pg_temp.uid(7))
  and exists (select 1 from private.member_phone_numbers where user_id = pg_temp.uid(7))
  and exists (select 1 from private.member_phone_verification_events where user_id = pg_temp.uid(7))
  and exists (select 1 from private.customer_marketing_consents where user_id = pg_temp.uid(7) and agreed)
  and exists (select 1 from public.restock_alerts where user_id = pg_temp.uid(7))
  and exists (select 1 from auth.sessions where user_id = pg_temp.uid(7))
  and exists (select 1 from auth.refresh_tokens where user_id = pg_temp.uid(7)::text)
  and (select suspended_at is null from public.profiles where id = pg_temp.uid(7))
  and exists (select 1 from public.wishlists where user_id = pg_temp.uid(7))
  and exists (select 1 from public.cart_items where user_id = pg_temp.uid(7))
  and exists (select 1 from public.notifications where user_id = pg_temp.uid(7))
  and exists (select 1 from public.ip_follows where user_id = pg_temp.uid(7))
  and exists (select 1 from public.user_coupons where user_id = pg_temp.uid(7))
  and exists (select 1 from public.coin_ledger where user_id = pg_temp.uid(7))
  and exists (select 1 from public.coin_balances where user_id = pg_temp.uid(7))
  and exists (select 1 from auth.identities where user_id = pg_temp.uid(7))
  then 1 else 0 end as other_member_untouched;
-- 코인 원장의 추가 전용 가드는 탈퇴 처리 밖에서는 그대로다.
select pg_temp.expect_error(format('delete from public.coin_ledger where user_id = %L', pg_temp.uid(7)), 'coin_ledger_append_only');

-- 프로필 익명화: 닉네임(다른 회원과 겹치면 한 자리 늘림)·생년월일·프로필 사진만 바뀌고 이메일은 남는다. public_profiles도 따라간다.
-- 처리 기록은 지울 사진 경로를 갖고, 감사에는 칸 이름만 남는다. 다른 회원(7)의 프로필은 그대로다.
select 1/case when (select nickname = '탈퇴한 회원 ' || left(md5(pg_temp.uid(3)::text), 7) and birth_date is null and avatar_path is null
    and email = 'withdrawal-3@example.test' from public.profiles where id = pg_temp.uid(3))
  and (select nickname = '탈퇴한 회원 ' || left(md5(pg_temp.uid(3)::text), 7) and avatar_path is null from public.public_profiles where id = pg_temp.uid(3))
  and (select nickname = '탈퇴한 회원 ' || left(md5(pg_temp.uid(3)::text), 6) from public.profiles where id = pg_temp.uid(6))
  and (select nickname = 'TEST 탈퇴 처리 7' and birth_date = date '1990-01-01' and avatar_path is not null from public.profiles where id = pg_temp.uid(7))
  and (select avatar_erase_pending and avatar_erased_at is null from private.member_withdrawal_processings where user_id = pg_temp.uid(3))
  -- 성인 인증 기록·사진 후보 기록은 그 회원 것만 지운다.
  and not exists (select 1 from private.adult_verifications where user_id = pg_temp.uid(3))
  and not exists (select 1 from private.adult_verification_sessions where user_id = pg_temp.uid(3))
  and not exists (select 1 from public.profile_avatar_claims where user_id = pg_temp.uid(3))
  and exists (select 1 from private.adult_verifications where user_id = pg_temp.uid(7))
  and exists (select 1 from private.adult_verification_sessions where user_id = pg_temp.uid(7))
  and exists (select 1 from public.profile_avatar_claims where user_id = pg_temp.uid(7))
  and ((:'processed'::jsonb)->>'avatarErasePending')::boolean
  and (select diff->'erased'->'profileFields' = jsonb_build_array('nickname', 'birthDate', 'avatar')
    and diff::text not like '%1990%' and diff::text not like '%TEST 탈퇴 처리 3%' and diff::text not like '%aaaaaaaa%'
    from public.audit_log where action = 'admin.member.withdrawal_processed' and target = 'profile:' || pg_temp.uid(3))
  then 1 else 0 end as profile_anonymized_and_other_member_untouched;

-- 처리 기록·감사: 문의 번호·처리자·개수만 남고 메모·개인정보 원문은 없다. 정지 감사도 같은 운영자로 남는다.
select 1/case when (select count(*) = 1 and min(inquiry_reference) = :ref3 and bool_and(processed_by = pg_temp.uid(1))
    and bool_and(signin_blocked_at is null) from private.member_withdrawal_processings where user_id = pg_temp.uid(3))
  and (select count(*) from public.audit_log where action = 'admin.member.withdrawal_processed' and target = 'profile:' || pg_temp.uid(3)) = 1
  and (select actor_id = pg_temp.uid(1)
      and diff = jsonb_build_object('inquiryReference', :ref3, 'suspended', true,
        'erased', jsonb_build_object('addressBookEntries', 2, 'phoneNumbers', 1, 'marketingConsents', 2, 'demographicConsents', 1,
          'activityEvents', 2, 'activityConsents', 1, 'emailChangeRequests', 1, 'restockAlerts', 1,
    'profileFields', jsonb_build_array('nickname', 'birthDate', 'avatar'), 'adultVerifications', 2,
    'wishlistItems', 1, 'cartItems', 1, 'notifications', 1, 'follows', 1, 'coupons', 1, 'loginIdentities', 1),
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

-- ---------------------------------------------------------------------------
-- 프로필 사진 삭제 확인: 경로는 platform.manage만 읽고, 객체가 남아 있으면 기록하지 않으며, 사라진 뒤에는 경로를 비우고 한 번만 감사한다.
-- ---------------------------------------------------------------------------
select pg_temp.as_actor(pg_temp.uid(2));
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_member_withdrawal_avatar_prefix(%L)', pg_temp.uid(3)), 'operator_capability_required');
select pg_temp.expect_error(format('select public.admin_confirm_member_withdrawal_avatar_erased(%L)', pg_temp.uid(3)), 'operator_capability_required');
reset role;
select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select public.admin_member_withdrawal_avatar_prefix(pg_temp.uid(3)) as avatar_path_before \gset
select public.admin_member_withdrawal_avatar_prefix(pg_temp.uid(7)) is null as other_member_has_no_pending_avatar \gset
select pg_temp.expect_error(format('select public.admin_confirm_member_withdrawal_avatar_erased(%L)', pg_temp.uid(3)), 'member_withdrawal_avatar_not_erased');
select pg_temp.expect_error(format('select public.admin_confirm_member_withdrawal_avatar_erased(%L)', pg_temp.uid(7)), 'member_withdrawal_not_processed');
reset role;
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'user-uploads' and name = :'avatar_path_before' || 'aaaaaaaa-0000-4000-8000-000000000003.png';
select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
-- 후보 파일 하나가 남아 있으면 아직 확인하지 않는다(접두 전체가 0개여야 한다).
select pg_temp.expect_error(format('select public.admin_confirm_member_withdrawal_avatar_erased(%L)', pg_temp.uid(3)), 'member_withdrawal_avatar_not_erased');
reset role;
delete from storage.objects where bucket_id = 'user-uploads' and name like :'avatar_path_before' || '%';
select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select public.admin_confirm_member_withdrawal_avatar_erased(pg_temp.uid(3)) as avatar_erased \gset
select public.admin_confirm_member_withdrawal_avatar_erased(pg_temp.uid(3)) as avatar_erased_again \gset
select public.admin_member_withdrawal_status(pg_temp.uid(3)) as status_avatar_done \gset
select public.admin_member_withdrawal_avatar_prefix(pg_temp.uid(3)) is null as avatar_path_after \gset
reset role;
select 1/case when :'avatar_path_before' = pg_temp.uid(3)::text || '/profile/'
  and exists (select 1 from storage.objects where name like pg_temp.uid(7)::text || '/profile/%')
  and :'other_member_has_no_pending_avatar'::boolean
  and not ((:'avatar_erased'::jsonb)->>'avatarErasePending')::boolean and not ((:'avatar_erased'::jsonb)->>'replayed')::boolean
  and ((:'avatar_erased_again'::jsonb)->>'replayed')::boolean
  and not ((:'status_avatar_done'::jsonb)->>'avatarErasePending')::boolean
  and :'avatar_path_after'::boolean
  and (select not avatar_erase_pending and avatar_erased_at >= processed_at and avatar_erased_by = pg_temp.uid(1)
    from private.member_withdrawal_processings where user_id = pg_temp.uid(3))
  and (select count(*) from public.audit_log where action = 'admin.member.withdrawal_avatar_erased' and target = 'profile:' || pg_temp.uid(3)
    and actor_id = pg_temp.uid(1) and diff = jsonb_build_object('inquiryReference', :ref3)) = 1
  then 1 else 0 end as avatar_erase_confirmed_once;

-- ---------------------------------------------------------------------------
-- 처리한 회원의 프로필 쓰기 봉인: 처리 뒤 남은 access token으로도 닉네임·생년월일·사진·동의를 되살리지 못한다(철회는 허용).
-- ---------------------------------------------------------------------------
select pg_temp.as_actor(pg_temp.uid(3));
set local role authenticated;
select pg_temp.expect_error(format('update public.profiles set birth_date = date %L where id = %L', '1990-01-01', pg_temp.uid(3)), 'member_withdrawn');
select pg_temp.expect_error(format('update public.profiles set consents = consents || %L::jsonb where id = %L', '{"marketing":true}', pg_temp.uid(3)), 'member_withdrawn');
reset role;
-- 서비스 경로(닉네임·사진은 service RPC가 postgres 권한으로 쓴다)도 같은 트리거가 막는다.
select pg_temp.expect_error(format('update public.profiles set nickname = %L where id = %L', '되살린 이름', pg_temp.uid(3)), 'member_withdrawn');
select pg_temp.expect_error(format('update public.profiles set avatar_path = %L where id = %L', pg_temp.uid(3)::text || '/profile/aaaaaaaa-0000-4000-8000-0000000000d3.png', pg_temp.uid(3)), 'member_withdrawn');
select 1/case when (select birth_date is null and nickname like '탈퇴한 회원 %' and avatar_path is null from public.profiles where id = pg_temp.uid(3))
  then 1 else 0 end as withdrawn_profile_stays_anonymous;

-- ---------------------------------------------------------------------------
-- 이 migration 전에 처리된 회원(9: 처리 기록만 있고 프로필·성인 인증 그대로)은 재처리 때 같은 익명화를 받고, 감사는 한 번이다.
-- Phase 1 탈퇴 신청 fence가 있는 회원(10)도 처리된다.
-- ---------------------------------------------------------------------------
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
select pg_temp.uid(n), 'authenticated', 'authenticated', 'withdrawal-' || n || '@example.test', now(), '{}', '{}' from generate_series(9, 11) n;
update public.profiles set nickname = 'TEST 탈퇴 처리 ' || right(id::text, 2), birth_date = '1991-02-03', onboarded_at = now(),
  consents = '{"terms":true,"privacy":true}'::jsonb
where id in (select pg_temp.uid(n) from generate_series(9, 11) n);
update public.profiles set avatar_path = id::text || '/profile/aaaaaaaa-0000-4000-8000-00000000000' || right(id::text, 1) || '.png' where id = pg_temp.uid(9);
insert into public.inquiries(user_id, category, title) select pg_temp.uid(n), 'account', '탈퇴 요청' from generate_series(9, 11) n;
select reference as ref9 from public.inquiries where user_id = pg_temp.uid(9) \gset
select reference as ref10 from public.inquiries where user_id = pg_temp.uid(10) \gset
select reference as ref11 from public.inquiries where user_id = pg_temp.uid(11) \gset
insert into private.adult_verification_sessions(user_id, provider_mode, provider_order_id, callback_nonce_digest, presentation, return_path,
  registration_key, completion_token_digest, state, created_at, expires_at, completed_at)
values (pg_temp.uid(9), 'test', 'IV' || repeat('9', 32), repeat('9', 64), 'page', '/my', 'REGWD00000000099', repeat('a', 64), 'verified', now(), now() + interval '30 minutes', now());
insert into private.adult_verifications(user_id, session_id, provider, provider_mode, subject_digest, transaction_digest, policy_version, verified_at, expires_at)
select user_id, id, 'kcp', 'test', repeat('e', 64), repeat('6', 64), 'adult_19_youth_protection_act@2026-10-23', now(), now() + interval '1 year'
from private.adult_verification_sessions where user_id = pg_temp.uid(9);
insert into private.member_withdrawal_processings (user_id, basis, inquiry_reference, processed_by, processed_at)
values (pg_temp.uid(9), 'inquiry', :ref9, pg_temp.uid(1), now() - interval '1 day');

select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select (public.admin_process_member_withdrawal(pg_temp.uid(9), :ref9, '다시 처리')) - 'processedAt' - 'revokedSessions' as legacy_replay \gset
select public.admin_process_member_withdrawal(pg_temp.uid(9), :ref9, '또 다시 처리') as legacy_replay_again \gset
select public.admin_member_withdrawal_avatar_prefix(pg_temp.uid(9)) as legacy_prefix \gset
reset role;
select 1/case when (:'legacy_replay'::jsonb)->>'status' = 'already_processed'
  and ((:'legacy_replay'::jsonb)->>'avatarErasePending')::boolean
  and :'legacy_prefix' = pg_temp.uid(9)::text || '/profile/'
  and (select nickname = '탈퇴한 회원 ' || left(md5(pg_temp.uid(9)::text), 6) and birth_date is null and avatar_path is null from public.profiles where id = pg_temp.uid(9))
  and not exists (select 1 from private.adult_verifications where user_id = pg_temp.uid(9))
  and not exists (select 1 from private.adult_verification_sessions where user_id = pg_temp.uid(9))
  and (select count(*) from public.audit_log where action = 'admin.member.withdrawal_profile_anonymized' and target = 'profile:' || pg_temp.uid(9)
    and actor_id = pg_temp.uid(1)
    and diff = jsonb_build_object('profileFields', jsonb_build_array('nickname', 'birthDate', 'avatar'), 'adultVerifications', 2)) = 1
  and (select count(*) from public.audit_log where action = 'admin.member.withdrawal_processed' and target = 'profile:' || pg_temp.uid(9)) = 0
  then 1 else 0 end as pre_migration_member_anonymized_on_replay;

-- 백필(운영자 없음)도 같은 함수다: 처리 기록만 있는 회원 11을 직접 맞춘다. 두 번째 호출은 아무것도 하지 않는다.
insert into private.member_withdrawal_processings (user_id, basis, inquiry_reference, processed_by, processed_at)
values (pg_temp.uid(11), 'inquiry', :ref11, pg_temp.uid(1), now() - interval '1 day');
select private.reconcile_withdrawn_member_profile(null, pg_temp.uid(11));
select private.reconcile_withdrawn_member_profile(null, pg_temp.uid(11));
select 1/case when (select nickname like '탈퇴한 회원 %' and birth_date is null from public.profiles where id = pg_temp.uid(11))
  and (select count(*) from public.audit_log where action = 'admin.member.withdrawal_profile_anonymized' and target = 'profile:' || pg_temp.uid(11)
    and actor_id is null) = 1
  and (select not avatar_erase_pending from private.member_withdrawal_processings where user_id = pg_temp.uid(11))
  then 1 else 0 end as backfill_is_idempotent;

with r as (insert into private.account_deletion_requests(subject_user_id, idempotency_key, status)
  values (pg_temp.uid(10), gen_random_uuid(), 'awaiting_email_intent') returning deletion_event_id)
insert into private.account_action_fences(subject_user_id, deletion_event_id) select pg_temp.uid(10), deletion_event_id from r;
select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select public.admin_process_member_withdrawal(pg_temp.uid(10), :ref10, '탈퇴 신청 fence 회원') as fenced_processed \gset
reset role;
select 1/case when (:'fenced_processed'::jsonb)->>'status' = 'processed'
  and (select nickname like '탈퇴한 회원 %' and birth_date is null and consents->'marketing' = 'false'::jsonb from public.profiles where id = pg_temp.uid(10))
  then 1 else 0 end as fenced_member_can_be_processed;

-- ---------------------------------------------------------------------------
-- 처리 전 대조(문의 요약): 그 회원의 문의만, platform.manage만
-- ---------------------------------------------------------------------------
select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select 1/case when (public.admin_member_withdrawal_inquiry(pg_temp.uid(4), :ref4)) - 'createdAt'
    = jsonb_build_object('reference', :ref4, 'category', 'account', 'title', '회원 탈퇴 요청합니다', 'status', 'open')
  and (public.admin_member_withdrawal_inquiry(pg_temp.uid(4), :ref4))->>'createdAt' is not null
  and public.admin_member_withdrawal_inquiry(pg_temp.uid(4), :ref7) is null
  and public.admin_member_withdrawal_inquiry(pg_temp.uid(4), 999999999999) is null
  then 1 else 0 end as inquiry_preview_only_for_that_member;
select pg_temp.expect_error(format('select public.admin_member_withdrawal_inquiry(%L, 0)', pg_temp.uid(4)), 'invalid_member_withdrawal');
reset role;
select pg_temp.as_actor(pg_temp.uid(2));
set local role authenticated;
select pg_temp.expect_error(format('select public.admin_member_withdrawal_inquiry(%L, %s)', pg_temp.uid(4), :ref4), 'operator_capability_required');
reset role;

-- ---------------------------------------------------------------------------
-- 정지 회원의 탈퇴 경로: 계정 문의만 접수·이어 쓰기, 그 문의로 처리할 수 있다
-- ---------------------------------------------------------------------------
select id as withdrawal_variant from public.goods_variants where good_id = 'withdrawal-goods' order by is_default desc limit 1 \gset
select private.write_customer_marketing_consent(pg_temp.uid(8), 'email', true, 'marketing-channels-v1', 'onboarding', clock_timestamp() - interval '1 day');
update public.profiles set consents = consents || '{"marketing":true}'::jsonb where id = pg_temp.uid(8);
set local session_replication_role = replica;
insert into public.orders(id, user_id, total, order_number, status)
values ('a10d0de0-0000-4000-8000-000000000801', pg_temp.uid(8), 10000, '2026111819990801', 'delivered');
set local session_replication_role = origin;
update public.profiles set suspended_at = now(), suspension_reason = 'TEST 제재' where id = pg_temp.uid(8);
select pg_temp.as_actor(pg_temp.uid(8));
set local role authenticated;
select public.create_inquiry('account', '탈퇴하고 싶어요', '정지된 계정인데 탈퇴를 요청합니다.') as suspended_account_inquiry \gset
select pg_temp.expect_error($q$select public.create_inquiry('order', '배송 문의', '언제 오나요')$q$, 'account_suspended');
select pg_temp.expect_error($q$select public.create_inquiry('etc', '기타 문의', '질문')$q$, 'account_suspended');
-- 정지 회원의 계정 문의는 글만 받는다 — 첨부·주문·굿즈 연결은 DB가 거절한다(앱만 막던 빈틈).
select pg_temp.expect_error(format('select public.create_inquiry(%L, %L, %L, null, null, array[%L])', 'account', '탈퇴', '첨부 포함',
  pg_temp.uid(8)::text || '/inquiry/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg'), 'account_suspended_inquiry_limited');
select pg_temp.expect_error(format('select public.create_inquiry(%L, %L, %L, %L)', 'account', '탈퇴', '주문 연결', 'a10d0de0-0000-4000-8000-000000000801'), 'account_suspended_inquiry_limited');
select pg_temp.expect_error(format('select public.create_inquiry(%L, %L, %L, null, %L)', 'account', '탈퇴', '굿즈 연결', 'withdrawal-goods'), 'account_suspended_inquiry_limited');
select 1/case when public.append_inquiry_message(:'suspended_account_inquiry', '본인 확인 답변입니다.') is not null then 1 else 0 end as suspended_append_account_ok;
select pg_temp.expect_error(format('select public.append_inquiry_message(%L, %L, array[%L])', :'suspended_account_inquiry', '첨부',
  pg_temp.uid(8)::text || '/inquiry/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg'), 'account_suspended_inquiry_limited');
reset role;
set local session_replication_role = replica;
insert into public.inquiries(id, user_id, category, title, status, waiting_since) values
  ('a10d1a00-0000-4000-8000-000000000801', pg_temp.uid(8), 'order', '정지 전 주문 문의', 'open', now());
set local session_replication_role = origin;
select pg_temp.as_actor(pg_temp.uid(8));
set local role authenticated;
select pg_temp.expect_error($q$select public.append_inquiry_message('a10d1a00-0000-4000-8000-000000000801', '이어서 질문')$q$, 'account_suspended');

-- 정지 회원의 마케팅 동의: 이미 동의한 수단 유지·철회는 받고, 새로 켜기만 거절한다(직접 쓰기 포함).
select 1/case when (public.set_my_marketing_consents(true, false, 'marketing-channels-v1', 'settings'))->'email'->>'agreed' = 'true' then 1 else 0 end as suspended_keeps_existing_consent;
select pg_temp.expect_error($q$select public.set_my_marketing_consents(true, true, 'marketing-channels-v1', 'settings')$q$, 'account_suspended');
select pg_temp.expect_error($q$select public.set_my_marketing_consents_v2(true, false, true, 'marketing-channels-v2', 'settings')$q$, 'account_suspended');
select 1/case when (public.set_my_marketing_consents(false, false, 'marketing-channels-v1', 'settings'))->>'marketing' = 'false' then 1 else 0 end as suspended_can_withdraw;
select pg_temp.expect_error($q$select public.set_my_marketing_consents(true, false, 'marketing-channels-v1', 'settings')$q$, 'account_suspended');
update public.profiles set consents = consents || '{"marketing":true}'::jsonb where id = pg_temp.uid(8);
-- 재입고 알림 신청도 거절한다.
select pg_temp.expect_error($q$select public.request_restock_alert('withdrawal-goods')$q$, 'account_suspended');
select pg_temp.expect_error(format('select public.request_variant_restock_alert(%L, %L)', 'withdrawal-goods', :'withdrawal_variant'), 'account_suspended');
reset role;
select 1/case when (select consents->'marketing' = 'false'::jsonb from public.profiles where id = pg_temp.uid(8))
  and not exists (select 1 from private.customer_marketing_consents where user_id = pg_temp.uid(8) and agreed)
  and (select count(*) from private.customer_marketing_consent_events where user_id = pg_temp.uid(8) and agreed) = 1
  and not exists (select 1 from public.restock_alerts where user_id = pg_temp.uid(8))
  and (select count(*) from public.inquiries where user_id = pg_temp.uid(8) and category = 'account') = 1
  and (select count(*) from public.inquiry_messages m join public.inquiries i on i.id = m.inquiry_id
    where i.user_id = pg_temp.uid(8) and m.author = 'user') = 2
  then 1 else 0 end as suspended_member_writes_only_account_inquiry_and_withdrawals;

select pg_temp.as_actor(pg_temp.uid(1));
set local role authenticated;
select public.admin_process_member_withdrawal(pg_temp.uid(8), (select reference from public.inquiries where id = :'suspended_account_inquiry'), '정지 중 계정 문의로 받은 탈퇴') as processed_suspended \gset
reset role;
select 1/case when (:'processed_suspended'::jsonb)->>'status' = 'processed'
  and not ((:'processed_suspended'::jsonb)->>'suspended')::boolean
  and (select suspension_reason = 'TEST 제재' from public.profiles where id = pg_temp.uid(8))
  and exists (select 1 from private.member_withdrawal_processings where user_id = pg_temp.uid(8))
  then 1 else 0 end as suspended_member_withdrawal_processed_from_account_inquiry;

-- 정지 해제·탈퇴와 무관한 회원은 지금처럼 동의를 켠다.
select pg_temp.as_actor(pg_temp.uid(7));
set local role authenticated;
select 1/case when (public.set_my_marketing_consents(true, true, 'marketing-channels-v1', 'settings'))->'sms'->>'agreed' = 'true' then 1 else 0 end as active_member_can_agree;
reset role;

-- ---------------------------------------------------------------------------
-- 정리 잡(20261125233000): 처리 3일 뒤 이메일 원문 파기, 재가입 차단과 만료, 처리 1년 뒤 동의 원장 삭제
-- ---------------------------------------------------------------------------
-- 처리 직후에는 이메일을 지우지 않는다(처리 결과를 문의 답변 메일로 알리는 3일).
select 1/case when (private.run_member_withdrawal_retention(100))->>'emailsErased' = '0'
  and exists (select 1 from public.profiles where id = pg_temp.uid(3) and email = 'withdrawal-3@example.test')
  then 1 else 0 end as retention_waits_three_days;

update private.member_withdrawal_processings set processed_at = processed_at - interval '4 days' where user_id = pg_temp.uid(3);
select private.run_member_withdrawal_retention(100) as retention_run \gset
select 1/case when (:'retention_run'::jsonb)->>'emailsErased' = '1'
  and (select email is null from public.profiles where id = pg_temp.uid(3))
  and (select email is null and banned_until is not null from auth.users where id = pg_temp.uid(3))
  and (select email_erased_at is not null from private.member_withdrawal_processings where user_id = pg_temp.uid(3))
  and (select count(*) from public.audit_log where action = 'admin.member.withdrawal_email_erased'
    and target = 'profile:' || pg_temp.uid(3) and actor_id is null and diff = '{}'::jsonb) = 1
  -- 처리하지 않았거나 3일이 지나지 않은 회원의 이메일은 그대로다.
  and (select email = 'withdrawal-7@example.test' from public.profiles where id = pg_temp.uid(7))
  and (select email = 'withdrawal-9@example.test' from public.profiles where id = pg_temp.uid(9))
  and (select email = 'withdrawal-8@example.test' from auth.users where id = pg_temp.uid(8))
  then 1 else 0 end as email_erased_after_three_days;
select 1/case when (private.run_member_withdrawal_retention(100))->>'emailsErased' = '0'
  and (select count(*) from public.audit_log where action = 'admin.member.withdrawal_email_erased' and target = 'profile:' || pg_temp.uid(3)) = 1
  then 1 else 0 end as email_erasure_runs_once;

-- 재가입 차단: 같은 이메일(대소문자·공백 무관)·같은 소셜 계정의 새 가입은 거절하고, 다른 이메일은 그대로 가입한다.
-- 이메일 가입자가 user metadata에 같은 sub를 적어도 소셜 계정 판정은 하지 않는다.
select pg_temp.expect_error(format($q$insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (%L, 'authenticated', 'authenticated', ' Withdrawal-3@Example.TEST ', now(), '{"provider":"email","providers":["email"]}', '{}')$q$,
  pg_temp.uid(21)), 'withdrawn_member_signup_blocked');
select pg_temp.expect_error(format($q$insert into auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
  values (%L, 'authenticated', 'authenticated', null, '{"provider":"google","providers":["google"]}', '{"sub":"wd-google-3","provider_id":"wd-google-3"}')$q$,
  pg_temp.uid(22)), 'withdrawn_member_signup_blocked');
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
  (pg_temp.uid(23), 'authenticated', 'authenticated', 'fresh-23@example.test', now(), '{"provider":"email","providers":["email"]}', '{}'),
  (pg_temp.uid(24), 'authenticated', 'authenticated', 'fresh-24@example.test', now(), '{"provider":"email","providers":["email"]}', '{"sub":"wd-google-3"}');
select 1/case when exists (select 1 from public.profiles where id = pg_temp.uid(23) and email = 'fresh-23@example.test')
  and exists (select 1 from public.profiles where id = pg_temp.uid(24))
  and not exists (select 1 from auth.users where id in (pg_temp.uid(21), pg_temp.uid(22)))
  then 1 else 0 end as withdrawn_email_and_social_signup_blocked;

-- 차단 기간(1년)이 지나면 같은 이메일로 다시 가입할 수 있고, 정리 잡이 지난 값을 지운다. 소셜 계정 차단은 그대로다.
update private.withdrawn_signin_blocks set blocked_at = blocked_at - interval '2 years', blocked_until = clock_timestamp() - interval '1 second'
where digest = private.withdrawn_signin_digest('email', 'withdrawal-3@example.test');
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values (pg_temp.uid(25), 'authenticated', 'authenticated', 'withdrawal-3@example.test', now(), '{"provider":"email","providers":["email"]}', '{}');
select private.run_member_withdrawal_retention(100) as retention_expiry \gset
select 1/case when exists (select 1 from public.profiles where id = pg_temp.uid(25) and email = 'withdrawal-3@example.test')
  and ((:'retention_expiry'::jsonb)->>'signinBlocksExpired')::integer = 1
  and not exists (select 1 from private.withdrawn_signin_blocks where digest = private.withdrawn_signin_digest('email', 'withdrawal-3@example.test'))
  and exists (select 1 from private.withdrawn_signin_blocks where digest = private.withdrawn_signin_digest('identity', 'google:wd-google-3'))
  then 1 else 0 end as signin_block_expires_after_period;

-- 처리 1년이 지나면 마케팅 동의 원장·성별·활동 기록 동의 행을 지운다. 다른 회원 것은 그대로다.
update private.member_withdrawal_processings set processed_at = processed_at - interval '400 days' where user_id = pg_temp.uid(3);
select private.run_member_withdrawal_retention(100) as retention_year \gset
select 1/case when ((:'retention_year'::jsonb)->>'retentionPurged')::integer = 1
  and not exists (select 1 from private.customer_marketing_consents where user_id = pg_temp.uid(3))
  and not exists (select 1 from private.customer_marketing_consent_events where user_id = pg_temp.uid(3))
  and not exists (select 1 from private.customer_demographic_consents where user_id = pg_temp.uid(3))
  and not exists (select 1 from private.member_activity_consents where user_id = pg_temp.uid(3))
  and (select retention_purged_at is not null from private.member_withdrawal_processings where user_id = pg_temp.uid(3))
  and exists (select 1 from private.customer_marketing_consents where user_id = pg_temp.uid(7))
  and (select count(*) from public.audit_log where action = 'admin.member.withdrawal_retention_purged' and target = 'profile:' || pg_temp.uid(3)) = 1
  and ((private.run_member_withdrawal_retention(100))->>'retentionPurged')::integer = 0
  then 1 else 0 end as consent_records_purged_after_one_year;

rollback;
