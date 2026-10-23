-- ==========================================================================
-- ICONS · 성인 인증(adult_19) — 휴대폰 본인확인 세션과 최소 증거
--
-- 19금 굿즈(판매 제한 상품 'adult') 판매의 전제인 성인 인증을 DB 경계로 세운다.
-- #210이 NICE를 전제로 정한 경계(정책과 증거 분리 · 최소 저장 · fail closed)를
-- 계약 업체 NHN KCP의 휴대폰 본인확인 V2로 옮긴 것이다. 판정 기준은 청소년
-- 보호법 제2조 제1호(만 19세가 되는 해의 1월 1일을 맞이하면 청소년이 아니다)이고,
-- 그 계산은 앱(lib/age/adult-age.ts)이 KCP가 돌려준 생년월일로 한 번만 한다 —
-- 생년월일은 DB에 들어오지 않는다.
--
-- 이 마이그레이션이 DB 안에서 고정하는 것:
--   1. 본인확인 세션은 서버만 만든다. 브라우저는 세션 행을 읽을 길이 없고,
--      KCP 결과 콜백은 경로 nonce 다이제스트와 KCP 거래등록키가 함께 맞아야 잡힌다.
--   2. 결과는 두 단계로 확정한다. 콜백 처리기(service role)가 KCP 결과를 조회·
--      복호화한 판정을 '보류(awaiting_owner)'로만 적고, 세션을 만든 계정의 로그인
--      세션이 그 보류를 직접 확정해야 증거가 생긴다. 확정에는 콜백을 처음 선점한
--      브라우저만 가진 완료 토큰도 필요하다 — 남이 만든 인증창을 끝까지 진행해도
--      링크를 만든 계정에 성인 인증이 붙지 않고, 링크를 만든 사람이 남의 결과를
--      자기 브라우저에서 확정하지도 못한다.
--   3. 증거는 최소다. 이름·생년월일·성별·전화번호·통신사·내외국인·CI는 저장하지
--      않는다. 남는 것은 판정, 유효기간, 정책 버전, DI와 KCP 거래번호의 키 해시다.
--      유효기간 1년은 청소년보호법 시행령 제17조 제2항(확인 후 1년까지 회원 확인으로
--      갈음)에서 온다 — 지나면 다시 인증해야 한다.
--   4. 한 명의(DI)는 한 계정에서만 유효하다. 같은 명의로 다른 계정에서 인증하면
--      이전 계정의 증거가 해제된다. 미성년 판정이 나온 계정은 기존 성인 증거도 잃는다
--      — 그 계정을 지금 미성년자가 쓰고 있다는 가장 최근 신호이기 때문이다.
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 1. 세션
-- ---------------------------------------------------------------------------
-- 상태 기계:
--   created ─(거래등록 성공)→ registered ─(콜백 선점)→ confirming
--   confirming ─(결과 조회·판정)→ awaiting_owner ─(본인 세션 확정)→ verified | underage
--   created·confirming ─(거래등록 실패·KCP 실패 코드·조회 실패·선점 만료)→ failed
--   미종결 상태 ─(TTL 경과 · 같은 계정의 새 시작 · 만료 sweeper)→ expired
-- staged_* 칸은 awaiting_owner 동안만 채워진다. 확정·만료 시 비워서 세션 테이블에
-- DI 해시가 남지 않게 한다 — 증거로 옮겨지는 건 성인 확정 한 경우뿐이다.
-- completion_token_digest는 콜백을 처음 선점한 요청이 그 브라우저에 준 완료 토큰의
-- 해시다. 선점 이후 상태에서는 늘 있고, 본인 세션 확정은 이 토큰을 함께 내야 한다.
create table private.adult_verification_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'kcp' check (provider = 'kcp'),
  provider_mode text not null check (provider_mode in ('test', 'production')),
  provider_order_id text not null unique check (provider_order_id ~ '^IV[0-9a-f]{32}$'),
  callback_nonce_digest text not null unique check (callback_nonce_digest ~ '^[0-9a-f]{64}$'),
  registration_key text unique check (registration_key ~ '^[A-Za-z0-9]{1,40}$'),
  completion_token_digest text unique check (completion_token_digest ~ '^[0-9a-f]{64}$'),
  presentation text not null check (presentation in ('popup', 'page')),
  return_path text not null check (
    char_length(return_path) between 1 and 512
    and left(return_path, 1) = '/'
    and left(return_path, 2) <> '//'
    and strpos(return_path, chr(92)) = 0
    and return_path !~ '[[:cntrl:]]'
  ),
  state text not null default 'created' check (state in (
    'created', 'registered', 'confirming', 'awaiting_owner',
    'verified', 'underage', 'failed', 'expired'
  )),
  result_code text check (result_code ~ '^[a-z0-9_]{1,40}$'),
  claim_token uuid,
  claim_expires_at timestamptz,
  staged_outcome text check (staged_outcome in ('adult', 'underage')),
  staged_subject_digest text check (staged_subject_digest ~ '^[0-9a-f]{64}$'),
  staged_transaction_digest text check (staged_transaction_digest ~ '^[0-9a-f]{64}$'),
  staged_policy_version text check (
    staged_policy_version ~ '^[a-z0-9_]{1,64}@[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  registered_at timestamptz,
  staged_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null,
  check (expires_at > created_at),
  check (state not in ('registered', 'confirming', 'awaiting_owner', 'verified', 'underage')
    or registration_key is not null),
  check (state not in ('confirming', 'awaiting_owner', 'verified', 'underage')
    or completion_token_digest is not null),
  check ((state = 'confirming') = (claim_token is not null and claim_expires_at is not null)),
  check ((state = 'awaiting_owner') = (staged_outcome is not null and staged_policy_version is not null)),
  check (staged_outcome is distinct from 'adult'
    or (staged_subject_digest is not null and staged_transaction_digest is not null)),
  check (state <> 'awaiting_owner' or staged_at is not null)
);

comment on table private.adult_verification_sessions is
  '성인 인증 본인확인 세션. 서버 전용이며 KCP 거래등록키와 콜백 nonce 다이제스트로 결과 콜백을 묶는다.';

create index adult_verification_sessions_user_created_idx
  on private.adult_verification_sessions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. 증거
-- ---------------------------------------------------------------------------
-- 해제(revoked)된 행은 지우지 않는다 — 언제 어떤 이유로 성인 인증이 사라졌는지가
-- 분쟁·CS의 근거다. 활성(미해제) 행은 계정당 하나, 명의(DI 해시)당 하나다. 만료된
-- 행도 해제 전까지는 활성으로 센다: 새 인증이 들어올 때 함께 해제된다.
create table private.adult_verifications (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null unique references private.adult_verification_sessions(id),
  provider text not null check (provider = 'kcp'),
  provider_mode text not null check (provider_mode in ('test', 'production')),
  subject_digest text not null check (subject_digest ~ '^[0-9a-f]{64}$'),
  transaction_digest text not null unique check (transaction_digest ~ '^[0-9a-f]{64}$'),
  policy_version text not null check (policy_version ~ '^[a-z0-9_]{1,64}@[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  verified_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason in ('superseded', 'subject_moved', 'underage_result', 'operator')),
  check (expires_at > verified_at),
  check ((revoked_at is null) = (revoked_reason is null))
);

comment on table private.adult_verifications is
  '성인 인증 최소 증거. 판정·유효기간·정책 버전과 DI·KCP 거래번호의 키 해시만 보관한다.';

create unique index adult_verifications_active_user_key
  on private.adult_verifications (user_id) where revoked_at is null;
create unique index adult_verifications_active_subject_key
  on private.adult_verifications (subject_digest) where revoked_at is null;
create index adult_verifications_user_verified_idx
  on private.adult_verifications (user_id, verified_at desc);

alter table private.adult_verification_sessions enable row level security;
alter table private.adult_verifications enable row level security;
revoke all on private.adult_verification_sessions, private.adult_verifications
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. 판정 helper
-- ---------------------------------------------------------------------------
-- 19금 굿즈의 노출·구매 경계가 부르는 단일 판정이다. 시각은 now()(트랜잭션
-- 시작)로 고정한다 — 한 주문 안에서 판정이 흔들리지 않는다.
create function private.adult_verification_valid(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_user_id is not null and exists (
    select 1
    from private.adult_verifications as evidence
    where evidence.user_id = p_user_id
      and evidence.revoked_at is null
      and evidence.expires_at > pg_catalog.now()
  );
$function$;

revoke all on function private.adult_verification_valid(uuid)
  from public, anon, authenticated, service_role;

-- 콜백·만료 경로가 세션을 닫을 때 쓰는 공통 정리. 보류 판정과 선점 토큰을
-- 같이 비워야 check 제약과 "세션에 DI 해시를 남기지 않는다"는 규칙이 함께 선다.
create function private.close_adult_verification_session(
  p_session_id uuid,
  p_state text,
  p_result_code text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if p_state not in ('verified', 'underage', 'failed', 'expired') then
    raise invalid_parameter_value using message = 'adult_verification_invalid';
  end if;

  update private.adult_verification_sessions
  set
    state = p_state,
    result_code = p_result_code,
    claim_token = null,
    claim_expires_at = null,
    staged_outcome = null,
    staged_subject_digest = null,
    staged_transaction_digest = null,
    staged_policy_version = null,
    completed_at = pg_catalog.clock_timestamp()
  where id = p_session_id;
end;
$function$;

revoke all on function private.close_adult_verification_session(uuid, text, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. 시작 (service role)
-- ---------------------------------------------------------------------------
-- 앱 서버가 KCP 거래등록 전에 부른다. 거래등록은 KCP 외부 호출이라 DB
-- 트랜잭션 밖에서 일어나고, 성공하면 register_adult_verification이 거래등록키를
-- 붙인다. 같은 계정의 미종결 세션은 여기서 만료시킨다 — 새 인증을 시작했으면 이전
-- 창의 결과는 쓰지 않는다.
create function public.begin_adult_verification(
  p_user_id uuid,
  p_provider_mode text,
  p_presentation text,
  p_return_path text,
  p_callback_nonce_digest text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_session private.adult_verification_sessions%rowtype;
begin
  if p_user_id is null
    or p_provider_mode is null or p_provider_mode not in ('test', 'production')
    or p_presentation is null or p_presentation not in ('popup', 'page')
    or p_callback_nonce_digest is null or p_callback_nonce_digest !~ '^[0-9a-f]{64}$'
    or p_return_path is null
    or char_length(p_return_path) not between 1 and 512
    or left(p_return_path, 1) <> '/'
    or left(p_return_path, 2) = '//'
    or strpos(p_return_path, chr(92)) > 0
    or p_return_path ~ '[[:cntrl:]]'
  then
    raise invalid_parameter_value using message = 'adult_verification_invalid';
  end if;

  -- 계정 단위 잠금을 먼저 잡는다(is_account_write_fenced가 잠근다). 같은 계정의
  -- 동시 시작이 한도 판정을 함께 통과하지 못하고, 탈퇴 신청과도 순서가 정해진다.
  if private.is_account_write_fenced(p_user_id)
    or not exists (
      select 1
      from public.profiles as profile
      where profile.id = p_user_id
        and profile.suspended_at is null
        and profile.onboarded_at is not null
    )
  then
    raise insufficient_privilege using message = 'adult_verification_account_blocked';
  end if;

  -- 거래등록은 KCP 호출이고 인증창은 문자·PASS를 보낸다. 반복 시작으로 비용과
  -- 상대 시스템에 부담을 주지 않게 계정당 시간·일 한도를 둔다.
  if (
    select pg_catalog.count(*)
    from private.adult_verification_sessions as session
    where session.user_id = p_user_id
      and session.created_at > v_now - interval '1 hour'
  ) >= 10 or (
    select pg_catalog.count(*)
    from private.adult_verification_sessions as session
    where session.user_id = p_user_id
      and session.created_at > v_now - interval '1 day'
  ) >= 30 then
    raise exception 'adult_verification_rate_limited' using errcode = '55000';
  end if;

  update private.adult_verification_sessions
  set
    state = 'expired',
    result_code = 'superseded',
    claim_token = null,
    claim_expires_at = null,
    staged_outcome = null,
    staged_subject_digest = null,
    staged_transaction_digest = null,
    staged_policy_version = null,
    completed_at = v_now
  where user_id = p_user_id
    and state in ('created', 'registered', 'confirming', 'awaiting_owner');

  insert into private.adult_verification_sessions (
    user_id,
    provider_mode,
    provider_order_id,
    callback_nonce_digest,
    presentation,
    return_path,
    created_at,
    expires_at
  )
  values (
    p_user_id,
    p_provider_mode,
    'IV' || pg_catalog.replace(extensions.gen_random_uuid()::text, '-', ''),
    p_callback_nonce_digest,
    p_presentation,
    p_return_path,
    v_now,
    v_now + interval '30 minutes'
  )
  returning * into v_session;

  return pg_catalog.jsonb_build_object(
    'sessionId', v_session.id,
    'providerOrderId', v_session.provider_order_id,
    'expiresAt', v_session.expires_at
  );
end;
$function$;

revoke all on function public.begin_adult_verification(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.begin_adult_verification(uuid, text, text, text, text)
  to service_role;

create function public.register_adult_verification(
  p_session_id uuid,
  p_registration_key text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if p_session_id is null
    or p_registration_key is null
    or p_registration_key !~ '^[A-Za-z0-9]{1,40}$'
  then
    raise invalid_parameter_value using message = 'adult_verification_invalid';
  end if;

  update private.adult_verification_sessions
  set
    state = 'registered',
    registration_key = p_registration_key,
    registered_at = pg_catalog.clock_timestamp()
  where id = p_session_id
    and state = 'created'
    and expires_at > pg_catalog.clock_timestamp();

  if not found then
    raise object_not_in_prerequisite_state using message = 'adult_verification_session_unavailable';
  end if;
end;
$function$;

revoke all on function public.register_adult_verification(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.register_adult_verification(uuid, text)
  to service_role;

-- 거래등록이 실패한 세션을 닫는다. 이미 다른 상태로 넘어간 세션은 건드리지 않는다.
create function public.fail_adult_verification_registration(
  p_session_id uuid,
  p_result_code text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if p_session_id is null
    or p_result_code is null
    or p_result_code !~ '^[a-z0-9_]{1,40}$'
  then
    raise invalid_parameter_value using message = 'adult_verification_invalid';
  end if;

  perform 1
  from private.adult_verification_sessions as session
  where session.id = p_session_id
    and session.state = 'created'
  for update;

  if found then
    perform private.close_adult_verification_session(p_session_id, 'failed', p_result_code);
  end if;
end;
$function$;

revoke all on function public.fail_adult_verification_registration(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_adult_verification_registration(uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. 콜백 선점 · 결과 보류 (service role)
-- ---------------------------------------------------------------------------
-- KCP 인증창이 사용자의 브라우저를 Ret_URL로 보내면 처리기가 부른다. 그 요청은
-- 교차 사이트 POST라 로그인 쿠키가 없으므로 계정은 세션 행에서만 읽는다.
--
-- 선점은 세션마다 한 번뿐이다. 선점한 요청만 완료 토큰 해시를 세션에 적고, 처리기는
-- 그 토큰을 같은 브라우저에만 쿠키로 준다. 선점이 만료된 confirming(처리기가 중간에
-- 죽은 경우)은 다시 선점하지 않고 실패로 닫는다 — 재선점을 허용하면 nonce와 거래등록키를
-- 아는 다른 브라우저가 남의 결과에 새 완료 토큰을 받을 수 있다.
--
-- 반환 claim_status:
--   claimed     — 이 호출이 결과 조회 권한을 얻었다(선점 토큰 2분)
--   in_progress — 다른 요청이 조회 중이다
--   staged      — 결과가 이미 보류돼 본인 세션 확정만 남았다(재전송·새로고침)
--   terminal    — 이미 끝났다(state를 함께 돌려준다)
create function public.claim_adult_verification_callback(
  p_callback_nonce_digest text,
  p_registration_key text,
  p_claim_token uuid,
  p_completion_token_digest text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_session private.adult_verification_sessions%rowtype;
begin
  if p_callback_nonce_digest is null
    or p_callback_nonce_digest !~ '^[0-9a-f]{64}$'
    or p_registration_key is null
    or p_registration_key !~ '^[A-Za-z0-9]{1,40}$'
    or p_claim_token is null
    or p_completion_token_digest is null
    or p_completion_token_digest !~ '^[0-9a-f]{64}$'
  then
    raise invalid_parameter_value using message = 'adult_verification_callback_invalid';
  end if;

  select session.*
  into v_session
  from private.adult_verification_sessions as session
  where session.callback_nonce_digest = p_callback_nonce_digest
  for update;

  if not found
    or v_session.registration_key is null
    or v_session.registration_key is distinct from p_registration_key
  then
    raise no_data_found using message = 'adult_verification_callback_invalid';
  end if;

  if v_session.state in ('verified', 'underage', 'failed', 'expired') then
    return pg_catalog.jsonb_build_object(
      'claimStatus', 'terminal',
      'state', v_session.state,
      'presentation', v_session.presentation,
      'returnPath', v_session.return_path
    );
  end if;

  if v_session.expires_at <= v_now then
    perform private.close_adult_verification_session(v_session.id, 'expired', 'session_expired');
    return pg_catalog.jsonb_build_object(
      'claimStatus', 'terminal',
      'state', 'expired',
      'presentation', v_session.presentation,
      'returnPath', v_session.return_path
    );
  end if;

  if v_session.state = 'awaiting_owner' then
    return pg_catalog.jsonb_build_object(
      'claimStatus', 'staged',
      'presentation', v_session.presentation,
      'returnPath', v_session.return_path
    );
  end if;

  if v_session.state = 'confirming' then
    if v_session.claim_expires_at > v_now then
      return pg_catalog.jsonb_build_object(
        'claimStatus', 'in_progress',
        'presentation', v_session.presentation,
        'returnPath', v_session.return_path
      );
    end if;

    perform private.close_adult_verification_session(v_session.id, 'failed', 'claim_expired');
    return pg_catalog.jsonb_build_object(
      'claimStatus', 'terminal',
      'state', 'failed',
      'presentation', v_session.presentation,
      'returnPath', v_session.return_path
    );
  end if;

  -- 거래등록만 끝난 registered만 남는다.
  update private.adult_verification_sessions
  set
    state = 'confirming',
    claim_token = p_claim_token,
    claim_expires_at = v_now + interval '2 minutes',
    completion_token_digest = p_completion_token_digest
  where id = v_session.id
  returning * into v_session;

  return pg_catalog.jsonb_build_object(
    'claimStatus', 'claimed',
    'sessionId', v_session.id,
    'providerMode', v_session.provider_mode,
    'providerOrderId', v_session.provider_order_id,
    'registrationKey', v_session.registration_key,
    'presentation', v_session.presentation,
    'returnPath', v_session.return_path
  );
end;
$function$;

revoke all on function public.claim_adult_verification_callback(text, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_adult_verification_callback(text, text, uuid, text)
  to service_role;

-- 선점한 처리기가 KCP 실패 코드·조회 실패·형식 오류로 세션을 닫는다.
create function public.fail_adult_verification_callback(
  p_session_id uuid,
  p_claim_token uuid,
  p_result_code text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if p_session_id is null
    or p_claim_token is null
    or p_result_code is null
    or p_result_code !~ '^[a-z0-9_]{1,40}$'
  then
    raise invalid_parameter_value using message = 'adult_verification_invalid';
  end if;

  perform 1
  from private.adult_verification_sessions as session
  where session.id = p_session_id
    and session.state = 'confirming'
    and session.claim_token = p_claim_token
  for update;

  if not found then
    raise object_not_in_prerequisite_state using message = 'adult_verification_claim_lost';
  end if;

  perform private.close_adult_verification_session(p_session_id, 'failed', p_result_code);
end;
$function$;

revoke all on function public.fail_adult_verification_callback(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_adult_verification_callback(uuid, uuid, text)
  to service_role;

-- 처리기가 KCP 결과를 조회·복호화해 앱 정책으로 판정한 결과를 보류로 적는다.
-- 여기서는 증거를 만들지 않는다 — 확정은 complete_my_adult_verification이 세션을
-- 만든 계정의 로그인 세션으로만 한다.
create function public.stage_adult_verification_result(
  p_session_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_subject_digest text,
  p_transaction_digest text,
  p_policy_version text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_session private.adult_verification_sessions%rowtype;
begin
  if p_session_id is null
    or p_claim_token is null
    or p_outcome is null or p_outcome not in ('adult', 'underage')
    or p_policy_version is null
    or p_policy_version !~ '^[a-z0-9_]{1,64}@[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or (p_subject_digest is not null and p_subject_digest !~ '^[0-9a-f]{64}$')
    or (p_transaction_digest is not null and p_transaction_digest !~ '^[0-9a-f]{64}$')
    or (p_outcome = 'adult' and (p_subject_digest is null or p_transaction_digest is null))
  then
    raise invalid_parameter_value using message = 'adult_verification_invalid';
  end if;

  select session.*
  into v_session
  from private.adult_verification_sessions as session
  where session.id = p_session_id
  for update;

  if not found
    or v_session.state is distinct from 'confirming'
    or v_session.claim_token is distinct from p_claim_token
  then
    raise object_not_in_prerequisite_state using message = 'adult_verification_claim_lost';
  end if;

  if v_session.expires_at <= v_now then
    perform private.close_adult_verification_session(v_session.id, 'expired', 'session_expired');
    return;
  end if;

  update private.adult_verification_sessions
  set
    state = 'awaiting_owner',
    claim_token = null,
    claim_expires_at = null,
    staged_outcome = p_outcome,
    -- 미성년 판정에는 명의·거래 해시가 필요 없다. 받지도 남기지도 않는다.
    staged_subject_digest = case when p_outcome = 'adult' then p_subject_digest end,
    staged_transaction_digest = case when p_outcome = 'adult' then p_transaction_digest end,
    staged_policy_version = p_policy_version,
    staged_at = v_now
  where id = v_session.id;
end;
$function$;

revoke all on function public.stage_adult_verification_result(uuid, uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.stage_adult_verification_result(uuid, uuid, text, text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. 본인 세션 확정 (authenticated)
-- ---------------------------------------------------------------------------
-- 콜백 처리기는 결과를 보류한 뒤 같은 브라우저를 이 확정 경로로 보낸다. 그 요청은
-- GET 최상위 이동이라 로그인 쿠키와 완료 토큰 쿠키가 함께 실린다. auth.uid()가 세션을
-- 만든 계정이고 완료 토큰이 콜백을 선점한 브라우저의 것일 때만 증거가 생긴다. 둘 중
-- 하나라도 어긋나면 "없음"과 구별되지 않게 거절한다.
create function public.complete_my_adult_verification(
  p_callback_nonce_digest text,
  p_completion_token_digest text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_session private.adult_verification_sessions%rowtype;
  v_evidence private.adult_verifications%rowtype;
  v_moved record;
begin
  if v_user is null then
    raise insufficient_privilege using message = 'auth required';
  end if;

  if p_callback_nonce_digest is null
    or p_callback_nonce_digest !~ '^[0-9a-f]{64}$'
    or p_completion_token_digest is null
    or p_completion_token_digest !~ '^[0-9a-f]{64}$'
  then
    raise invalid_parameter_value using message = 'adult_verification_invalid';
  end if;

  -- 잠금 순서: 계정(fence 잠금) → 세션 → 명의. begin과 같은 계정 잠금을 먼저 잡아
  -- 탈퇴 신청·새 인증 시작과 직렬화한다.
  if private.is_account_write_fenced(v_user) then
    raise insufficient_privilege using message = 'adult_verification_account_blocked';
  end if;

  select session.*
  into v_session
  from private.adult_verification_sessions as session
  where session.callback_nonce_digest = p_callback_nonce_digest
  for update;

  if not found
    or v_session.user_id is distinct from v_user
    or v_session.completion_token_digest is null
    or v_session.completion_token_digest is distinct from p_completion_token_digest
  then
    raise no_data_found using message = 'adult_verification_not_found';
  end if;

  if v_session.state in ('verified', 'underage', 'failed', 'expired') then
    return pg_catalog.jsonb_build_object(
      'outcome', v_session.state,
      'presentation', v_session.presentation,
      'returnPath', v_session.return_path
    );
  end if;

  if v_session.expires_at <= v_now then
    perform private.close_adult_verification_session(v_session.id, 'expired', 'session_expired');
    return pg_catalog.jsonb_build_object(
      'outcome', 'expired',
      'presentation', v_session.presentation,
      'returnPath', v_session.return_path
    );
  end if;

  -- 결과 조회 중이다. 선점이 만료됐으면 처리기가 중간에 죽은 것이고 콜백은 다시 오지
  -- 않는다 — 기다리게 두지 않고 실패로 닫아 다시 시작하게 한다.
  if v_session.state = 'confirming' and v_session.claim_expires_at <= v_now then
    perform private.close_adult_verification_session(v_session.id, 'failed', 'claim_expired');
    return pg_catalog.jsonb_build_object(
      'outcome', 'failed',
      'presentation', v_session.presentation,
      'returnPath', v_session.return_path
    );
  end if;

  if v_session.state <> 'awaiting_owner' then
    return pg_catalog.jsonb_build_object(
      'outcome', 'pending',
      'presentation', v_session.presentation,
      'returnPath', v_session.return_path
    );
  end if;

  if exists (
    select 1
    from public.profiles as profile
    where profile.id = v_user
      and profile.suspended_at is not null
  ) then
    perform private.close_adult_verification_session(v_session.id, 'failed', 'account_blocked');
    return pg_catalog.jsonb_build_object(
      'outcome', 'failed',
      'presentation', v_session.presentation,
      'returnPath', v_session.return_path
    );
  end if;

  if v_session.staged_outcome = 'underage' then
    update private.adult_verifications
    set revoked_at = v_now, revoked_reason = 'underage_result'
    where user_id = v_user
      and revoked_at is null;

    perform private.close_adult_verification_session(v_session.id, 'underage', null);

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_user,
      'identity.adult_verification.underage',
      'profiles:' || v_user::text,
      pg_catalog.jsonb_build_object(
        'provider', v_session.provider,
        'providerMode', v_session.provider_mode,
        'policyVersion', v_session.staged_policy_version
      )
    );

    return pg_catalog.jsonb_build_object(
      'outcome', 'underage',
      'presentation', v_session.presentation,
      'returnPath', v_session.return_path
    );
  end if;

  -- 같은 명의의 동시 확정을 직렬화한다. 두 계정이 같은 DI로 동시에 확정해도
  -- 활성 증거는 하나만 남고, 나중에 확정한 계정이 그 명의를 가진다.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('adult-verification-subject:' || v_session.staged_subject_digest, 0)
  );

  update private.adult_verifications
  set revoked_at = v_now, revoked_reason = 'superseded'
  where user_id = v_user
    and revoked_at is null;

  for v_moved in
    update private.adult_verifications
    set revoked_at = v_now, revoked_reason = 'subject_moved'
    where subject_digest = v_session.staged_subject_digest
      and user_id <> v_user
      and revoked_at is null
    returning user_id
  loop
    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_user,
      'identity.adult_verification.subject_moved',
      'profiles:' || v_moved.user_id::text,
      pg_catalog.jsonb_build_object('toUser', v_user)
    );
  end loop;

  insert into private.adult_verifications (
    user_id,
    session_id,
    provider,
    provider_mode,
    subject_digest,
    transaction_digest,
    policy_version,
    verified_at,
    expires_at
  )
  values (
    v_user,
    v_session.id,
    v_session.provider,
    v_session.provider_mode,
    v_session.staged_subject_digest,
    v_session.staged_transaction_digest,
    v_session.staged_policy_version,
    v_now,
    v_now + interval '1 year'
  )
  returning * into v_evidence;

  perform private.close_adult_verification_session(v_session.id, 'verified', null);

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_user,
    'identity.adult_verification.verified',
    'profiles:' || v_user::text,
    pg_catalog.jsonb_build_object(
      'provider', v_evidence.provider,
      'providerMode', v_evidence.provider_mode,
      'policyVersion', v_evidence.policy_version,
      'expiresAt', v_evidence.expires_at
    )
  );

  return pg_catalog.jsonb_build_object(
    'outcome', 'verified',
    'presentation', v_session.presentation,
    'returnPath', v_session.return_path,
    'expiresAt', v_evidence.expires_at
  );
end;
$function$;

revoke all on function public.complete_my_adult_verification(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_my_adult_verification(text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 7. 내 성인 인증 상태 (authenticated)
-- ---------------------------------------------------------------------------
-- 화면 표시용이다. 노출·구매 경계는 이 응답이 아니라 서버 함수 안의
-- adult_verification_valid로 다시 판정한다.
create function public.get_my_adult_verification()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := (select auth.uid());
  v_evidence private.adult_verifications%rowtype;
begin
  if v_user is null then
    return pg_catalog.jsonb_build_object('status', 'none');
  end if;

  select evidence.*
  into v_evidence
  from private.adult_verifications as evidence
  where evidence.user_id = v_user
  order by evidence.verified_at desc, evidence.id desc
  limit 1;

  if not found then
    return pg_catalog.jsonb_build_object('status', 'none');
  end if;

  if v_evidence.revoked_at is not null then
    return pg_catalog.jsonb_build_object(
      'status', 'revoked',
      'reason', v_evidence.revoked_reason,
      'revokedAt', v_evidence.revoked_at
    );
  end if;

  if v_evidence.expires_at <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object(
      'status', 'expired',
      'verifiedAt', v_evidence.verified_at,
      'expiresAt', v_evidence.expires_at
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'verified',
    'verifiedAt', v_evidence.verified_at,
    'expiresAt', v_evidence.expires_at
  );
end;
$function$;

revoke all on function public.get_my_adult_verification()
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_adult_verification()
  to authenticated;

-- ---------------------------------------------------------------------------
-- 8. 만료 sweeper (pg_cron)
-- ---------------------------------------------------------------------------
-- 브라우저가 돌아오지 않은 세션은 콜백·확정 경로가 닫아 주지 않는다. TTL이 지난
-- 미종결 세션을 주기적으로 expired로 닫아 보류된 DI 해시가 세션 테이블에 30분 넘게
-- 남지 않게 한다. 콜백·확정이 잠근 행은 건너뛰고 다음 실행에서 닫는다.
create function private.expire_adult_verification_sessions(p_batch_size integer default 1000)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_closed integer;
begin
  with due as (
    select session.id
    from private.adult_verification_sessions as session
    where session.state in ('created', 'registered', 'confirming', 'awaiting_owner')
      and session.expires_at <= pg_catalog.clock_timestamp()
    order by session.expires_at
    limit greatest(1, least(coalesce(p_batch_size, 1000), 10000))
    for update skip locked
  )
  update private.adult_verification_sessions as session
  set
    state = 'expired',
    result_code = 'session_expired',
    claim_token = null,
    claim_expires_at = null,
    staged_outcome = null,
    staged_subject_digest = null,
    staged_transaction_digest = null,
    staged_policy_version = null,
    completed_at = pg_catalog.clock_timestamp()
  from due
  where session.id = due.id;

  get diagnostics v_closed = row_count;
  return v_closed;
end;
$function$;

revoke all on function private.expire_adult_verification_sessions(integer)
  from public, anon, authenticated, service_role;
-- cron 작업은 등록한 롤(postgres)로 돈다. 복원 뒤 소유자가 달라져도 실행되게 명시한다.
grant execute on function private.expire_adult_verification_sessions(integer) to postgres;

-- pg_cron이 있는 배포만 등록한다. cron.schedule은 이름 기준 upsert라 재적용에 안전하다.
do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'adult-verification-session-expiry',
      '*/5 * * * *',
      'select private.expire_adult_verification_sessions()'
    );
  end if;
end;
$$;
