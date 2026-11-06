\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- ICONS · 성인 인증(adult_19) 세션과 최소 증거
--
-- 이 스모크가 DB 안에 고정하는 것:
--   1. 세션·결과 보류 RPC는 service role만, 확정·상태 조회는 로그인 세션만 부른다.
--      세션·증거 테이블과 판정 helper는 어떤 브라우저 롤에도 열려 있지 않다
--   2. 콜백은 nonce 다이제스트와 KCP 거래등록키가 함께 맞아야 잡히고, 선점은 한 번이다.
--      선점이 만료된 세션은 다시 선점되지 않고 실패로 닫힌다
--   3. 보류된 결과는 세션을 만든 계정의 로그인 세션이, 선점한 브라우저의 완료 토큰을
--      함께 낼 때만 확정한다
--   4. 확정 전에는 성인이 아니고, 확정 뒤 1년 동안만 성인이다
--   5. 한 명의(DI 해시)는 한 계정에서만 유효하다 — 다른 계정에서 같은 명의로 확정하면
--      이전 계정의 증거가 해제되고 감사 기록이 남는다
--   6. 미성년 판정은 그 계정의 기존 성인 증거를 해제하고, 명의 해시를 남기지 않는다
--   7. 끝난 세션에는 명의·거래 해시가 남지 않는다
--   8. 만료·한도·정지 계정은 fail closed다. TTL이 지난 미종결 세션은 sweeper가 닫는다
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 계약: 실행 권한
-- ---------------------------------------------------------------------------
select 1 / case when (
  has_function_privilege('service_role', 'public.begin_adult_verification(uuid, text, text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.begin_adult_verification(uuid, text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.begin_adult_verification(uuid, text, text, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.register_adult_verification(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.register_adult_verification(uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.fail_adult_verification_registration(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.fail_adult_verification_registration(uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.claim_adult_verification_callback(text, text, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_adult_verification_callback(text, text, uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.claim_adult_verification_callback(text, text, uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.fail_adult_verification_callback(uuid, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.fail_adult_verification_callback(uuid, uuid, text)', 'execute')
  and has_function_privilege('service_role', 'public.stage_adult_verification_result(uuid, uuid, text, text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.stage_adult_verification_result(uuid, uuid, text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.stage_adult_verification_result(uuid, uuid, text, text, text, text)', 'execute')
) then 1 else 0 end as assert_session_rpcs_are_service_role_only;

-- 확정은 로그인 세션의 auth.uid()로만 묶인다. service role이 부르면 그 묶음이
-- 사라지므로 service role에도 열지 않는다.
select 1 / case when (
  has_function_privilege('authenticated', 'public.complete_my_adult_verification(text, text)', 'execute')
  and not has_function_privilege('anon', 'public.complete_my_adult_verification(text, text)', 'execute')
  and not has_function_privilege('service_role', 'public.complete_my_adult_verification(text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.get_my_adult_verification()', 'execute')
  and not has_function_privilege('anon', 'public.get_my_adult_verification()', 'execute')
  and not has_function_privilege('service_role', 'public.get_my_adult_verification()', 'execute')
) then 1 else 0 end as assert_owner_rpcs_are_session_only;

select 1 / case when (
  not has_function_privilege('anon', 'private.adult_verification_valid(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.adult_verification_valid(uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.adult_verification_valid(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.close_adult_verification_session(uuid, text, text)', 'execute')
  and not has_function_privilege('service_role', 'private.close_adult_verification_session(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'private.expire_adult_verification_sessions(integer)', 'execute')
  and not has_function_privilege('authenticated', 'private.expire_adult_verification_sessions(integer)', 'execute')
  and not has_function_privilege('service_role', 'private.expire_adult_verification_sessions(integer)', 'execute')
  and not has_table_privilege('authenticated', 'private.adult_verification_sessions', 'select')
  and not has_table_privilege('service_role', 'private.adult_verification_sessions', 'select')
  and not has_table_privilege('anon', 'private.adult_verifications', 'select')
  and not has_table_privilege('authenticated', 'private.adult_verifications', 'select')
  and not has_table_privilege('service_role', 'private.adult_verifications', 'select')
) then 1 else 0 end as assert_private_state_is_closed;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-4000-8000-0000000a1901', 'authenticated', 'authenticated', 'adult-a@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000a1902', 'authenticated', 'authenticated', 'adult-b@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000a1903', 'authenticated', 'authenticated', 'adult-suspended@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000a1904', 'authenticated', 'authenticated', 'adult-limit@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000a1905', 'authenticated', 'authenticated', 'adult-expired@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000a1906', 'authenticated', 'authenticated', 'adult-swap-c@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-0000000a1907', 'authenticated', 'authenticated', 'adult-swap-d@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-0000000a1901', 'adult-a@example.test', 'adult_a', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'::public.user_role),
  ('00000000-0000-4000-8000-0000000a1902', 'adult-b@example.test', 'adult_b', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'::public.user_role),
  ('00000000-0000-4000-8000-0000000a1903', 'adult-suspended@example.test', 'adult_suspended', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'::public.user_role),
  ('00000000-0000-4000-8000-0000000a1904', 'adult-limit@example.test', 'adult_limit', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'::public.user_role),
  ('00000000-0000-4000-8000-0000000a1905', 'adult-expired@example.test', 'adult_expired', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'::public.user_role),
  ('00000000-0000-4000-8000-0000000a1906', 'adult-swap-c@example.test', 'adult_swap_c', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'::public.user_role),
  ('00000000-0000-4000-8000-0000000a1907', 'adult-swap-d@example.test', 'adult_swap_d', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'::public.user_role)
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

update public.profiles
set suspended_at = now(), suspension_reason = '성인 인증 스모크용 정지'
where id = '00000000-0000-4000-8000-0000000a1903';

-- 테스트 nonce 다이제스트: 앞 글자만 다른 64자 hex.
create temporary table adult_fixture_nonce (label text primary key, digest text not null) on commit drop;
insert into adult_fixture_nonce (label, digest)
select label, pg_catalog.encode(extensions.digest(label, 'sha256'), 'hex')
from (values ('a1'), ('a2'), ('a3'), ('b1'), ('a4'), ('a5'), ('a6'), ('a7'), ('a8'), ('c1'), ('x1'), ('s1')) as v(label);

-- 완료 토큰 다이제스트: 콜백을 선점한 브라우저가 받는 토큰의 해시.
create temporary table adult_fixture_completion (label text primary key, digest text not null) on commit drop;
insert into adult_fixture_completion (label, digest)
select label, pg_catalog.encode(extensions.digest('completion-' || label, 'sha256'), 'hex')
from (values ('a2'), ('a3'), ('b1'), ('a5'), ('a6'), ('a7'), ('a8'), ('c1'), ('forged')) as v(label);

create temporary table adult_fixture_session (label text primary key, session_id uuid not null) on commit drop;
grant all on adult_fixture_nonce, adult_fixture_session, adult_fixture_completion to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- 시작 — 입력 검증 · 정지 계정 · 같은 계정의 이전 세션 만료
-- ---------------------------------------------------------------------------
set local role service_role;

do $$
declare
  rejected boolean;
  bad_path text;
begin
  foreach bad_path in array array['https://evil.test/', '//evil.test', '/a\b', 'relative', ''] loop
    rejected := false;
    begin
      perform public.begin_adult_verification(
        '00000000-0000-4000-8000-0000000a1901', 'test', 'page', bad_path,
        (select digest from adult_fixture_nonce where label = 'x1')
      );
    exception when invalid_parameter_value then rejected := true;
    end;
    if not rejected then
      raise exception 'unsafe return path accepted: %', bad_path;
    end if;
  end loop;

  rejected := false;
  begin
    perform public.begin_adult_verification(
      '00000000-0000-4000-8000-0000000a1903', 'test', 'page', '/my',
      (select digest from adult_fixture_nonce where label = 's1')
    );
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then
    raise exception 'suspended account began adult verification';
  end if;
end;
$$;

insert into adult_fixture_session (label, session_id)
select 'a1', (public.begin_adult_verification(
  '00000000-0000-4000-8000-0000000a1901', 'test', 'popup', '/goods/sample?tab=info',
  (select digest from adult_fixture_nonce where label = 'a1')
) ->> 'sessionId')::uuid;

insert into adult_fixture_session (label, session_id)
select 'a2', (public.begin_adult_verification(
  '00000000-0000-4000-8000-0000000a1901', 'test', 'page', '/my',
  (select digest from adult_fixture_nonce where label = 'a2')
) ->> 'sessionId')::uuid;

reset role;

-- 새 시작은 같은 계정의 이전 미종결 세션을 닫는다 — 이전 창의 결과는 쓰지 않는다.
select 1 / case when (
  select state = 'expired' and result_code = 'superseded' and completed_at is not null
  from private.adult_verification_sessions
  where id = (select session_id from adult_fixture_session where label = 'a1')
) then 1 else 0 end as assert_new_begin_expires_previous_session;

select 1 / case when (
  select state = 'created'
    and provider = 'kcp'
    and provider_mode = 'test'
    and provider_order_id ~ '^IV[0-9a-f]{32}$'
    and registration_key is null
    and expires_at between created_at + interval '29 minutes' and created_at + interval '31 minutes'
  from private.adult_verification_sessions
  where id = (select session_id from adult_fixture_session where label = 'a2')
) then 1 else 0 end as assert_session_starts_created_with_order_id_and_ttl;

-- ---------------------------------------------------------------------------
-- 거래등록 · 콜백 선점
-- ---------------------------------------------------------------------------
set local role service_role;

select public.register_adult_verification(
  (select session_id from adult_fixture_session where label = 'a2'),
  'REGA2000000000000001'
);

do $$
declare
  rejected boolean := false;
begin
  begin
    perform public.register_adult_verification(
      (select session_id from adult_fixture_session where label = 'a2'),
      'REGA2000000000000099'
    );
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then
    raise exception 'registered session accepted a second registration key';
  end if;

  -- 거래등록키가 다르면 nonce가 맞아도 콜백을 잡지 못한다.
  rejected := false;
  begin
    perform public.claim_adult_verification_callback(
      (select digest from adult_fixture_nonce where label = 'a2'),
      'REGA2000000000000099',
      extensions.gen_random_uuid(),
      (select digest from adult_fixture_completion where label = 'forged')
    );
  exception when no_data_found then rejected := true;
  end;
  if not rejected then
    raise exception 'callback with a foreign registration key was claimed';
  end if;
end;
$$;

create temporary table adult_fixture_claim (label text primary key, result jsonb not null, token uuid not null) on commit drop;
grant all on adult_fixture_claim to service_role, authenticated;

insert into adult_fixture_claim (label, result, token)
select 'a2', public.claim_adult_verification_callback(
  (select digest from adult_fixture_nonce where label = 'a2'),
  'REGA2000000000000001',
  token,
  (select digest from adult_fixture_completion where label = 'a2')
), token
from (select extensions.gen_random_uuid() as token) as t;

select 1 / case when (
  select result ->> 'claimStatus' = 'claimed'
    and result ->> 'registrationKey' = 'REGA2000000000000001'
    and result ->> 'providerMode' = 'test'
    and result ->> 'returnPath' = '/my'
    and result ->> 'presentation' = 'page'
  from adult_fixture_claim where label = 'a2'
) then 1 else 0 end as assert_first_callback_claims_session;

-- 같은 콜백이 다시 와도 두 번째 조회 권한은 생기지 않는다.
select 1 / case when (
  public.claim_adult_verification_callback(
    (select digest from adult_fixture_nonce where label = 'a2'),
    'REGA2000000000000001',
    extensions.gen_random_uuid(),
    (select digest from adult_fixture_completion where label = 'forged')
  ) ->> 'claimStatus' = 'in_progress'
) then 1 else 0 end as assert_concurrent_callback_does_not_reclaim;

reset role;

-- 완료 토큰은 처음 선점한 요청의 것만 남는다. 두 번째 콜백이 낸 토큰은 적히지 않는다.
select 1 / case when (
  select completion_token_digest = (select digest from adult_fixture_completion where label = 'a2')
  from private.adult_verification_sessions
  where id = (select session_id from adult_fixture_session where label = 'a2')
) then 1 else 0 end as assert_first_claim_owns_completion_token;

set local role service_role;

-- 성인 판정에는 명의·거래 해시가 반드시 있어야 한다.
do $$
declare
  rejected boolean := false;
begin
  begin
    perform public.stage_adult_verification_result(
      (select session_id from adult_fixture_session where label = 'a2'),
      (select token from adult_fixture_claim where label = 'a2'),
      'adult', null, null, 'adult_19_youth_protection_act@2026-10-23'
    );
  exception when invalid_parameter_value then rejected := true;
  end;
  if not rejected then
    raise exception 'adult outcome staged without digests';
  end if;

  -- 선점 토큰이 다르면 보류할 수 없다.
  rejected := false;
  begin
    perform public.stage_adult_verification_result(
      (select session_id from adult_fixture_session where label = 'a2'),
      extensions.gen_random_uuid(),
      'adult', repeat('a', 64), repeat('1', 64), 'adult_19_youth_protection_act@2026-10-23'
    );
  exception when object_not_in_prerequisite_state then rejected := true;
  end;
  if not rejected then
    raise exception 'foreign claim token staged a result';
  end if;
end;
$$;

select public.stage_adult_verification_result(
  (select session_id from adult_fixture_session where label = 'a2'),
  (select token from adult_fixture_claim where label = 'a2'),
  'adult', repeat('a', 64), repeat('1', 64), 'adult_19_youth_protection_act@2026-10-23'
);

-- 보류된 세션에 콜백이 다시 오면(재전송·새로고침) 확정 경로로만 안내한다.
select 1 / case when (
  public.claim_adult_verification_callback(
    (select digest from adult_fixture_nonce where label = 'a2'),
    'REGA2000000000000001',
    extensions.gen_random_uuid(),
    (select digest from adult_fixture_completion where label = 'forged')
  ) ->> 'claimStatus' = 'staged'
) then 1 else 0 end as assert_staged_callback_replay_is_not_reclaimed;

reset role;

-- 보류만으로는 성인이 아니다.
select 1 / case when (
  not private.adult_verification_valid('00000000-0000-4000-8000-0000000a1901')
  and not exists (select 1 from private.adult_verifications where user_id = '00000000-0000-4000-8000-0000000a1901')
) then 1 else 0 end as assert_staged_result_is_not_evidence;

-- ---------------------------------------------------------------------------
-- 본인 세션 확정
-- ---------------------------------------------------------------------------
-- 다른 계정은 남의 보류를 확정하지 못하고, 존재 여부도 구별할 수 없다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000a1902', true);

do $$
declare
  rejected boolean := false;
begin
  begin
    perform public.complete_my_adult_verification(
      (select digest from adult_fixture_nonce where label = 'a2'),
      (select digest from adult_fixture_completion where label = 'a2')
    );
  exception when no_data_found then rejected := true;
  end;
  if not rejected then
    raise exception 'foreign account completed another account''s verification';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000a1901', true);

-- 세션 주인이어도 선점한 브라우저의 완료 토큰이 없으면 확정하지 못한다.
do $$
declare
  rejected boolean := false;
begin
  begin
    perform public.complete_my_adult_verification(
      (select digest from adult_fixture_nonce where label = 'a2'),
      (select digest from adult_fixture_completion where label = 'forged')
    );
  exception when no_data_found then rejected := true;
  end;
  if not rejected then
    raise exception 'owner completed without the claiming browser''s completion token';
  end if;
end;
$$;

select 1 / case when (
  public.complete_my_adult_verification(
    (select digest from adult_fixture_nonce where label = 'a2'),
    (select digest from adult_fixture_completion where label = 'a2')
  ) ->> 'outcome' = 'verified'
) then 1 else 0 end as assert_owner_completes_verification;

-- 확정은 멱등이다. 같은 결과로 다시 와도 증거가 늘지 않는다.
select 1 / case when (
  public.complete_my_adult_verification(
    (select digest from adult_fixture_nonce where label = 'a2'),
    (select digest from adult_fixture_completion where label = 'a2')
  ) ->> 'outcome' = 'verified'
) then 1 else 0 end as assert_completion_is_idempotent;

select 1 / case when (
  public.get_my_adult_verification() ->> 'status' = 'verified'
) then 1 else 0 end as assert_owner_reads_verified_status;

reset role;

select 1 / case when (
  select count(*) = 1
    and bool_and(revoked_at is null)
    and bool_and(provider = 'kcp' and provider_mode = 'test')
    and bool_and(subject_digest = repeat('a', 64) and transaction_digest = repeat('1', 64))
    and bool_and(policy_version = 'adult_19_youth_protection_act@2026-10-23')
    and bool_and(expires_at = verified_at + interval '1 year')
  from private.adult_verifications
  where user_id = '00000000-0000-4000-8000-0000000a1901'
) then 1 else 0 end as assert_single_minimal_evidence_with_one_year_ttl;

select 1 / case when (
  private.adult_verification_valid('00000000-0000-4000-8000-0000000a1901')
  and not private.adult_verification_valid('00000000-0000-4000-8000-0000000a1902')
  and not private.adult_verification_valid(null)
) then 1 else 0 end as assert_valid_only_for_verified_account;

-- 끝난 세션에는 명의·거래 해시가 남지 않는다.
select 1 / case when (
  select state = 'verified'
    and staged_outcome is null
    and staged_subject_digest is null
    and staged_transaction_digest is null
    and staged_policy_version is null
    and claim_token is null
  from private.adult_verification_sessions
  where id = (select session_id from adult_fixture_session where label = 'a2')
) then 1 else 0 end as assert_completed_session_drops_staged_digests;

select 1 / case when (
  select count(*) = 1
  from public.audit_log
  where action = 'identity.adult_verification.verified'
    and target = 'profiles:00000000-0000-4000-8000-0000000a1901'
    and actor_id = '00000000-0000-4000-8000-0000000a1901'
    and not (diff ? 'subjectDigest')
) then 1 else 0 end as assert_verification_is_audited_without_identifiers;

-- 끝난 세션의 콜백 재전송은 종결 상태만 돌려준다.
set local role service_role;
select 1 / case when (
  public.claim_adult_verification_callback(
    (select digest from adult_fixture_nonce where label = 'a2'),
    'REGA2000000000000001',
    extensions.gen_random_uuid(),
    (select digest from adult_fixture_completion where label = 'forged')
  ) ->> 'claimStatus' = 'terminal'
) then 1 else 0 end as assert_completed_callback_replay_is_terminal;

-- ---------------------------------------------------------------------------
-- 1명의 1계정 — B가 같은 명의로 인증하면 A의 증거가 해제된다
-- ---------------------------------------------------------------------------
insert into adult_fixture_session (label, session_id)
select 'b1', (public.begin_adult_verification(
  '00000000-0000-4000-8000-0000000a1902', 'test', 'page', '/my',
  (select digest from adult_fixture_nonce where label = 'b1')
) ->> 'sessionId')::uuid;

select public.register_adult_verification(
  (select session_id from adult_fixture_session where label = 'b1'),
  'REGB1000000000000001'
);

insert into adult_fixture_claim (label, result, token)
select 'b1', public.claim_adult_verification_callback(
  (select digest from adult_fixture_nonce where label = 'b1'),
  'REGB1000000000000001',
  token,
  (select digest from adult_fixture_completion where label = 'b1')
), token
from (select extensions.gen_random_uuid() as token) as t;

select public.stage_adult_verification_result(
  (select session_id from adult_fixture_session where label = 'b1'),
  (select token from adult_fixture_claim where label = 'b1'),
  'adult', repeat('a', 64), repeat('2', 64), 'adult_19_youth_protection_act@2026-10-23'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000a1902', true);
select 1 / case when (
  public.complete_my_adult_verification(
    (select digest from adult_fixture_nonce where label = 'b1'),
    (select digest from adult_fixture_completion where label = 'b1')
  ) ->> 'outcome' = 'verified'
) then 1 else 0 end as assert_second_account_completes_with_same_subject;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000a1901', true);
select 1 / case when (
  public.get_my_adult_verification() ->> 'status' = 'revoked'
  and public.get_my_adult_verification() ->> 'reason' = 'subject_moved'
) then 1 else 0 end as assert_previous_account_sees_subject_moved;

reset role;

select 1 / case when (
  not private.adult_verification_valid('00000000-0000-4000-8000-0000000a1901')
  and private.adult_verification_valid('00000000-0000-4000-8000-0000000a1902')
  and (
    select count(*) = 1
    from private.adult_verifications
    where subject_digest = repeat('a', 64)
      and revoked_at is null
  )
) then 1 else 0 end as assert_one_active_account_per_subject;

select 1 / case when (
  select count(*) = 1
  from public.audit_log
  where action = 'identity.adult_verification.subject_moved'
    and target = 'profiles:00000000-0000-4000-8000-0000000a1901'
    and actor_id = '00000000-0000-4000-8000-0000000a1902'
) then 1 else 0 end as assert_subject_move_is_audited;

-- ---------------------------------------------------------------------------
-- 명의 맞바꾸기 — 인증된 C가 인증된 D의 명의로 확정하면 C의 이전 증거는 갱신으로,
-- D의 증거는 명의 이전으로 한 번에 해제된다. 두 해제가 잠그는 행을 id 순서로 먼저
-- 잠그는 경로다(서로의 명의로 동시에 확정해도 교착되지 않게).
-- ---------------------------------------------------------------------------
insert into private.adult_verification_sessions (
  user_id, provider_mode, provider_order_id, callback_nonce_digest, presentation, return_path,
  registration_key, completion_token_digest, state, created_at, expires_at, completed_at
)
values
  ('00000000-0000-4000-8000-0000000a1906', 'test', 'IV' || repeat('6', 32), repeat('6', 64), 'page', '/my',
    'REGSWAPC000000000001', repeat('6', 64), 'verified', now(), now() + interval '30 minutes', now()),
  ('00000000-0000-4000-8000-0000000a1907', 'test', 'IV' || repeat('8', 32), repeat('8', 64), 'page', '/my',
    'REGSWAPD000000000001', repeat('8', 64), 'verified', now(), now() + interval '30 minutes', now());

insert into private.adult_verifications (
  user_id, session_id, provider, provider_mode, subject_digest, transaction_digest,
  policy_version, verified_at, expires_at
)
select session.user_id, session.id, 'kcp', 'test', subject.digest, subject.transaction_digest,
  'adult_19_youth_protection_act@2026-10-23', now(), now() + interval '1 year'
from private.adult_verification_sessions as session
join (values
  ('IV' || repeat('6', 32), repeat('6', 64), repeat('7', 64)),
  ('IV' || repeat('8', 32), repeat('8', 64), repeat('9', 64))
) as subject(order_id, digest, transaction_digest) on subject.order_id = session.provider_order_id;

set local role service_role;

insert into adult_fixture_session (label, session_id)
select 'c1', (public.begin_adult_verification(
  '00000000-0000-4000-8000-0000000a1906', 'test', 'page', '/my',
  (select digest from adult_fixture_nonce where label = 'c1')
) ->> 'sessionId')::uuid;

select public.register_adult_verification(
  (select session_id from adult_fixture_session where label = 'c1'),
  'REGC1000000000000001'
);

insert into adult_fixture_claim (label, result, token)
select 'c1', public.claim_adult_verification_callback(
  (select digest from adult_fixture_nonce where label = 'c1'),
  'REGC1000000000000001',
  token,
  (select digest from adult_fixture_completion where label = 'c1')
), token
from (select extensions.gen_random_uuid() as token) as t;

select public.stage_adult_verification_result(
  (select session_id from adult_fixture_session where label = 'c1'),
  (select token from adult_fixture_claim where label = 'c1'),
  'adult', repeat('8', 64), repeat('ab', 32), 'adult_19_youth_protection_act@2026-10-23'
);

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000a1906', true);
select 1 / case when (
  public.complete_my_adult_verification(
    (select digest from adult_fixture_nonce where label = 'c1'),
    (select digest from adult_fixture_completion where label = 'c1')
  ) ->> 'outcome' = 'verified'
) then 1 else 0 end as assert_swap_completion_verifies;
reset role;

select 1 / case when (
  (select revoked_reason from private.adult_verifications where transaction_digest = repeat('7', 64)) = 'superseded'
  and (select revoked_reason from private.adult_verifications where transaction_digest = repeat('9', 64)) = 'subject_moved'
  and exists (
    select 1 from private.adult_verifications
    where user_id = '00000000-0000-4000-8000-0000000a1906'
      and subject_digest = repeat('8', 64)
      and transaction_digest = repeat('ab', 32)
      and revoked_at is null
  )
  and private.adult_verification_valid('00000000-0000-4000-8000-0000000a1906')
  and not private.adult_verification_valid('00000000-0000-4000-8000-0000000a1907')
) then 1 else 0 end as assert_swap_supersedes_own_and_moves_other;

-- ---------------------------------------------------------------------------
-- 미성년 판정 — B의 기존 증거가 해제되고 명의 해시는 남지 않는다
-- ---------------------------------------------------------------------------
set local role service_role;

insert into adult_fixture_session (label, session_id)
select 'a3', (public.begin_adult_verification(
  '00000000-0000-4000-8000-0000000a1902', 'test', 'popup', '/my',
  (select digest from adult_fixture_nonce where label = 'a3')
) ->> 'sessionId')::uuid;

select public.register_adult_verification(
  (select session_id from adult_fixture_session where label = 'a3'),
  'REGA3000000000000001'
);

insert into adult_fixture_claim (label, result, token)
select 'a3', public.claim_adult_verification_callback(
  (select digest from adult_fixture_nonce where label = 'a3'),
  'REGA3000000000000001',
  token,
  (select digest from adult_fixture_completion where label = 'a3')
), token
from (select extensions.gen_random_uuid() as token) as t;

-- 미성년 판정이 해시를 실어 보내도 세션에는 남지 않는다.
select public.stage_adult_verification_result(
  (select session_id from adult_fixture_session where label = 'a3'),
  (select token from adult_fixture_claim where label = 'a3'),
  'underage', repeat('b', 64), repeat('3', 64), 'adult_19_youth_protection_act@2026-10-23'
);

reset role;

select 1 / case when (
  select state = 'awaiting_owner'
    and staged_outcome = 'underage'
    and staged_subject_digest is null
    and staged_transaction_digest is null
  from private.adult_verification_sessions
  where id = (select session_id from adult_fixture_session where label = 'a3')
) then 1 else 0 end as assert_underage_stage_keeps_no_digests;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000a1902', true);
select 1 / case when (
  public.complete_my_adult_verification(
    (select digest from adult_fixture_nonce where label = 'a3'),
    (select digest from adult_fixture_completion where label = 'a3')
  ) ->> 'outcome' = 'underage'
) then 1 else 0 end as assert_underage_result_completes;

-- 상태 조회는 STABLE이라 같은 문장 안에서는 확정 전 스냅샷을 본다. 문장을 나눈다.
select 1 / case when (
  public.get_my_adult_verification() ->> 'status' = 'revoked'
  and public.get_my_adult_verification() ->> 'reason' = 'underage_result'
) then 1 else 0 end as assert_underage_result_revokes_existing_evidence;
reset role;

select 1 / case when (
  not private.adult_verification_valid('00000000-0000-4000-8000-0000000a1902')
  and not exists (
    select 1 from private.adult_verifications
    where user_id = '00000000-0000-4000-8000-0000000a1902' and revoked_at is null
  )
) then 1 else 0 end as assert_underage_account_is_not_adult;

-- ---------------------------------------------------------------------------
-- 실패 · 만료
-- ---------------------------------------------------------------------------
set local role service_role;

insert into adult_fixture_session (label, session_id)
select 'a4', (public.begin_adult_verification(
  '00000000-0000-4000-8000-0000000a1901', 'test', 'page', '/my',
  (select digest from adult_fixture_nonce where label = 'a4')
) ->> 'sessionId')::uuid;

select public.fail_adult_verification_registration(
  (select session_id from adult_fixture_session where label = 'a4'),
  'registration_failed'
);

reset role;
select 1 / case when (
  select state = 'failed' and result_code = 'registration_failed'
  from private.adult_verification_sessions
  where id = (select session_id from adult_fixture_session where label = 'a4')
) then 1 else 0 end as assert_registration_failure_closes_session;

set local role service_role;

insert into adult_fixture_session (label, session_id)
select 'a5', (public.begin_adult_verification(
  '00000000-0000-4000-8000-0000000a1901', 'test', 'page', '/my',
  (select digest from adult_fixture_nonce where label = 'a5')
) ->> 'sessionId')::uuid;

select public.register_adult_verification(
  (select session_id from adult_fixture_session where label = 'a5'),
  'REGA5000000000000001'
);

reset role;

-- TTL이 지난 세션의 콜백은 조회 권한을 얻지 못하고 만료로 닫힌다.
update private.adult_verification_sessions
set created_at = created_at - interval '2 hours',
    registered_at = registered_at - interval '2 hours',
    expires_at = pg_catalog.clock_timestamp() - interval '1 minute'
where id = (select session_id from adult_fixture_session where label = 'a5');

set local role service_role;
select 1 / case when (
  public.claim_adult_verification_callback(
    (select digest from adult_fixture_nonce where label = 'a5'),
    'REGA5000000000000001',
    extensions.gen_random_uuid(),
    (select digest from adult_fixture_completion where label = 'forged')
  ) ->> 'state' = 'expired'
) then 1 else 0 end as assert_expired_session_callback_is_closed;
reset role;

-- 선점이 만료된 confirming(처리기가 중간에 죽은 경우)은 다시 선점되지 않고 실패로 닫힌다.
set local role service_role;

insert into adult_fixture_session (label, session_id)
select 'a6', (public.begin_adult_verification(
  '00000000-0000-4000-8000-0000000a1901', 'test', 'page', '/my',
  (select digest from adult_fixture_nonce where label = 'a6')
) ->> 'sessionId')::uuid;

select public.register_adult_verification(
  (select session_id from adult_fixture_session where label = 'a6'),
  'REGA6000000000000001'
);

select public.claim_adult_verification_callback(
  (select digest from adult_fixture_nonce where label = 'a6'),
  'REGA6000000000000001',
  extensions.gen_random_uuid(),
  (select digest from adult_fixture_completion where label = 'a6')
);

reset role;
update private.adult_verification_sessions
set claim_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where id = (select session_id from adult_fixture_session where label = 'a6');

set local role service_role;
select 1 / case when (
  public.claim_adult_verification_callback(
    (select digest from adult_fixture_nonce where label = 'a6'),
    'REGA6000000000000001',
    extensions.gen_random_uuid(),
    (select digest from adult_fixture_completion where label = 'forged')
  ) ->> 'state' = 'failed'
) then 1 else 0 end as assert_expired_claim_is_not_reclaimed;
reset role;

select 1 / case when (
  select state = 'failed'
    and result_code = 'claim_expired'
    and claim_token is null
    and completion_token_digest = (select digest from adult_fixture_completion where label = 'a6')
  from private.adult_verification_sessions
  where id = (select session_id from adult_fixture_session where label = 'a6')
) then 1 else 0 end as assert_expired_claim_closes_session_failed;

-- 확정 경로도 선점이 만료된 세션을 기다리게 두지 않는다.
set local role service_role;

insert into adult_fixture_session (label, session_id)
select 'a7', (public.begin_adult_verification(
  '00000000-0000-4000-8000-0000000a1901', 'test', 'popup', '/my',
  (select digest from adult_fixture_nonce where label = 'a7')
) ->> 'sessionId')::uuid;

select public.register_adult_verification(
  (select session_id from adult_fixture_session where label = 'a7'),
  'REGA7000000000000001'
);

select public.claim_adult_verification_callback(
  (select digest from adult_fixture_nonce where label = 'a7'),
  'REGA7000000000000001',
  extensions.gen_random_uuid(),
  (select digest from adult_fixture_completion where label = 'a7')
);

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000a1901', true);
select 1 / case when (
  public.complete_my_adult_verification(
    (select digest from adult_fixture_nonce where label = 'a7'),
    (select digest from adult_fixture_completion where label = 'a7')
  ) ->> 'outcome' = 'pending'
) then 1 else 0 end as assert_live_claim_completes_as_pending;
reset role;

update private.adult_verification_sessions
set claim_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where id = (select session_id from adult_fixture_session where label = 'a7');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000a1901', true);
select 1 / case when (
  public.complete_my_adult_verification(
    (select digest from adult_fixture_nonce where label = 'a7'),
    (select digest from adult_fixture_completion where label = 'a7')
  ) ->> 'outcome' = 'failed'
) then 1 else 0 end as assert_expired_claim_completes_as_failed;
reset role;

select 1 / case when (
  select state = 'failed' and result_code = 'claim_expired'
  from private.adult_verification_sessions
  where id = (select session_id from adult_fixture_session where label = 'a7')
) then 1 else 0 end as assert_completion_closes_expired_claim;

-- 만료 sweeper — 브라우저가 돌아오지 않은 보류 세션도 TTL이 지나면 닫히고 해시를 잃는다.
set local role service_role;

insert into adult_fixture_session (label, session_id)
select 'a8', (public.begin_adult_verification(
  '00000000-0000-4000-8000-0000000a1901', 'test', 'page', '/my',
  (select digest from adult_fixture_nonce where label = 'a8')
) ->> 'sessionId')::uuid;

select public.register_adult_verification(
  (select session_id from adult_fixture_session where label = 'a8'),
  'REGA8000000000000001'
);

insert into adult_fixture_claim (label, result, token)
select 'a8', public.claim_adult_verification_callback(
  (select digest from adult_fixture_nonce where label = 'a8'),
  'REGA8000000000000001',
  token,
  (select digest from adult_fixture_completion where label = 'a8')
), token
from (select extensions.gen_random_uuid() as token) as t;

select public.stage_adult_verification_result(
  (select session_id from adult_fixture_session where label = 'a8'),
  (select token from adult_fixture_claim where label = 'a8'),
  'adult', repeat('d', 64), repeat('5', 64), 'adult_19_youth_protection_act@2026-10-23'
);

reset role;

update private.adult_verification_sessions
set created_at = created_at - interval '2 hours',
    registered_at = registered_at - interval '2 hours',
    staged_at = staged_at - interval '2 hours',
    expires_at = pg_catalog.clock_timestamp() - interval '1 minute'
where id = (select session_id from adult_fixture_session where label = 'a8');

select 1 / case when (
  private.expire_adult_verification_sessions() >= 1
) then 1 else 0 end as assert_sweeper_closes_overdue_sessions;

select 1 / case when (
  select state = 'expired'
    and result_code = 'session_expired'
    and staged_outcome is null
    and staged_subject_digest is null
    and staged_transaction_digest is null
    and staged_policy_version is null
    and completed_at is not null
  from private.adult_verification_sessions
  where id = (select session_id from adult_fixture_session where label = 'a8')
) then 1 else 0 end as assert_swept_session_drops_staged_digests;

-- pg_cron이 있는 배포에는 sweeper가 등록돼 있다.
do $$
declare
  scheduled integer;
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    execute 'select count(*) from cron.job where jobname = $1 and command = $2'
      into scheduled
      using 'adult-verification-session-expiry', 'select private.expire_adult_verification_sessions()';
    if scheduled <> 1 then
      raise exception 'adult verification session sweeper is not scheduled';
    end if;
  end if;
end;
$$;

-- 증거 만료 — 1년이 지나면 성인이 아니다. 한 트랜잭션 안의 스모크라 위 계정들의
-- 최신 증거는 이 트랜잭션 시각이다. 만료 판정은 증거가 하나뿐인 별도 계정으로 본다.
insert into private.adult_verification_sessions (
  user_id, provider_mode, provider_order_id, callback_nonce_digest, presentation, return_path,
  registration_key, completion_token_digest, state, created_at, expires_at, completed_at
)
values (
  '00000000-0000-4000-8000-0000000a1905', 'test',
  'IV' || repeat('e', 32), repeat('e', 64), 'page', '/my',
  'REGEXPIRED0000000001', repeat('f', 64), 'verified',
  pg_catalog.now() - interval '2 years', pg_catalog.now() - interval '2 years' + interval '30 minutes',
  pg_catalog.now() - interval '2 years'
);

insert into private.adult_verifications (
  user_id, session_id, provider, provider_mode, subject_digest, transaction_digest,
  policy_version, verified_at, expires_at
)
select
  '00000000-0000-4000-8000-0000000a1905', id, 'kcp', 'test', repeat('c', 64), repeat('4', 64),
  'adult_19_youth_protection_act@2026-10-23',
  pg_catalog.now() - interval '2 years', pg_catalog.now() - interval '1 year'
from private.adult_verification_sessions
where provider_order_id = 'IV' || repeat('e', 32);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000a1905', true);
select 1 / case when (
  public.get_my_adult_verification() ->> 'status' = 'expired'
) then 1 else 0 end as assert_expired_evidence_reads_expired;
reset role;

select 1 / case when (
  not private.adult_verification_valid('00000000-0000-4000-8000-0000000a1905')
) then 1 else 0 end as assert_expired_evidence_is_not_adult;

-- ---------------------------------------------------------------------------
-- 한도 — 한 시간에 10회까지
-- ---------------------------------------------------------------------------
set local role service_role;

do $$
declare
  attempt integer;
  rejected boolean := false;
begin
  for attempt in 1..10 loop
    perform public.begin_adult_verification(
      '00000000-0000-4000-8000-0000000a1904', 'test', 'page', '/my',
      pg_catalog.encode(extensions.digest('limit-' || attempt::text, 'sha256'), 'hex')
    );
  end loop;

  begin
    perform public.begin_adult_verification(
      '00000000-0000-4000-8000-0000000a1904', 'test', 'page', '/my',
      pg_catalog.encode(extensions.digest('limit-11', 'sha256'), 'hex')
    );
  exception when sqlstate '55000' then
    rejected := sqlerrm = 'adult_verification_rate_limited';
  end;

  if not rejected then
    raise exception 'eleventh adult verification start in an hour was accepted';
  end if;
end;
$$;

reset role;

-- 익명 세션은 상태 조회도 확정도 할 수 없다(선언적 권한은 위에서 단언). 로그인
-- 세션의 상태 조회는 증거가 없으면 none이다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000a1904', true);
select 1 / case when (
  public.get_my_adult_verification() ->> 'status' = 'none'
) then 1 else 0 end as assert_account_without_evidence_reads_none;
reset role;

rollback;
