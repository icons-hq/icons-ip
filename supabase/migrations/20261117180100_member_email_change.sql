begin;

-- 소셜 로그인이 실제 메일을 받을 수 없는 이메일을 넘긴 계정의 이메일 변경(2026-11-17 사용자 결정).
--
-- Apple 로그인에서 '이메일 가리기'를 고르면 Apple은 <임의>@privaterelay.appleid.com 릴레이 주소를 넘긴다. 이 주소는
-- 우리 발신 도메인을 Apple 개발자 콘솔(Sign in with Apple for Email Communication)에 등록해야 실제 메일함으로 전달된다
-- (docs/runbooks/signup-contact-channels.md §12). 결정은 '도메인 등록 + 선택 변경'이다 — 등록과 별개로, 원하는 회원은
-- 온보딩·설정에서 다른 이메일로 바꿀 수 있다. 이메일이 아예 없는 계정은 온보딩을 마칠 수 없으므로(isOnboarded) 그때는
-- 이 변경이 필수 단계가 된다. Apple 로그인 뒤 실제 이메일을 '필수'로 요구하지 않는다(App Store 가이드라인 4.8).
--
-- 확인은 이메일로 보낸 6자리 코드다. Supabase Auth의 이메일 변경(updateUser email)은 운영에서 보안 이메일 변경(현재·새
-- 주소 양쪽 확인)이 켜져 있어 현재 주소(릴레이)로도 확인 메일이 가야 끝난다 — 바로 그 주소가 메일을 못 받는 경우라
-- 쓸 수 없다. 그래서 휴대폰 번호 인증(20261112110000)과 같은 자체 코드 경로를 쓰고, DB가 코드를 확인하면 앱 서버가
-- 서비스 롤 Admin API로 로그인 이메일을 바꾼다(email_confirm). 이 경로는 로그인 이메일이 쓸 수 없는 주소일 때만 열린다
-- (private.member_login_email_unusable) — 일반 이메일 계정의 이메일을 현재 주소 확인 없이 바꾸는 길이 되지 않게 한다.
--
-- 저장 원칙(휴대폰 번호 인증과 같다)
--   · 코드 원문은 저장하지 않는다. 앱 서버가 서버 비밀값으로 만든 HMAC(요청 id에 결속)만 비교한다. 새 이메일 원문은
--     진행 중인 요청에만 두고 결과가 정해지면 지운다. 한도는 이메일·IP 다이제스트로 센다.
--   · '이미 쓰는 이메일'은 코드를 맞힌 뒤에만 알린다 — 주소만 알면 가입 여부를 알아내는 조회가 되지 않게 한다.
--   · 세션만 가로채서는 바꿀 수 없게 최근 30분 안에 로그인한 세션만 요청할 수 있다(auth.users.last_sign_in_at). 바꾼 뒤에는
--     앱이 이전 주소(있으면)로 변경 알림 메일을 보낸다.
--   · 재요청 간격(60초)은 회원 단위로만 센다 — 주소 단위로 세면 '누군가 방금 이 주소를 요청했다'가 드러난다. 주소별
--     시간·일 한도는 그 주소의 메일함을 코드 메일로 채우지 못하게 남긴다.
--   · 매시 정리 작업이 만료 요청을 닫고 이틀 지난 요청 행을 지운다. 탈퇴 신청(계정 봉인) 시 그 회원의 요청 행을 지운다.
--
-- 로그인 이메일이 바뀌면 public.profiles.email도 같은 값으로 맞춘다(지금까지 profiles.email은 가입 때 한 번만 채워졌다).
-- 탈퇴 진행으로 봉인된 계정은 profiles 쓰기가 막혀 있으므로 맞추지 않는다.

create table private.member_email_change_challenges (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- 결과가 정해지면(verified·expired·exhausted·superseded·send_failed·refused·email_taken) 지운다.
  email text check (email is null or (char_length(email) between 6 and 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  email_digest text not null check (email_digest ~ '^[A-Za-z0-9_-]{32,128}$'),
  ip_digest text check (ip_digest is null or ip_digest ~ '^[A-Za-z0-9_-]{32,128}$'),
  code_digest text not null check (code_digest ~ '^[A-Za-z0-9_-]{32,128}$'),
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'expired', 'exhausted', 'superseded', 'send_failed', 'refused', 'email_taken')),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  check (expires_at > created_at),
  check ((status = 'pending') = (resolved_at is null)),
  check (status = 'pending' or email is null),
  check (status <> 'pending' or email is not null)
);
create index member_email_change_challenges_user_time
  on private.member_email_change_challenges (user_id, created_at desc);
create index member_email_change_challenges_email_time
  on private.member_email_change_challenges (email_digest, created_at desc);
create index member_email_change_challenges_ip_time
  on private.member_email_change_challenges (ip_digest, created_at desc) where ip_digest is not null;
create index member_email_change_challenges_created
  on private.member_email_change_challenges (created_at);

alter table private.member_email_change_challenges owner to postgres;
alter table private.member_email_change_challenges enable row level security;
revoke all on private.member_email_change_challenges from public, anon, authenticated, service_role;

comment on table private.member_email_change_challenges is
  '로그인 이메일이 쓸 수 없는 주소(Apple 이메일 가리기 릴레이·빈 값)인 회원의 이메일 변경 요청. 코드는 HMAC만, 새 이메일 원문은 진행 중에만 둔다. 서비스 롤 RPC로만 쓰고 이틀 뒤·탈퇴 신청 시 지운다.';

-- 로그인 이메일이 실제 메일을 받을 수 없는 주소인가. 빈 값이거나 Apple 이메일 가리기 릴레이 주소다.
-- 앱의 lib/auth/email-change.ts isUnusableLoginEmail과 같은 규칙이어야 한다.
create function private.member_login_email_unusable(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select pg_catalog.btrim(coalesce(u.email, '')) = ''
      or pg_catalog.lower(u.email) like '%@privaterelay.appleid.com'
    from auth.users u where u.id = p_user_id
  ), false);
$$;

-- 시도 한도. 숫자는 런북(docs/runbooks/signup-contact-channels.md §12)과 같아야 한다.
create function private.member_email_change_rate_limited(p_column text, p_value text, p_hour_limit integer, p_day_limit integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  hour_count integer;
  day_count integer;
  oldest timestamptz;
  now_at timestamptz := clock_timestamp();
begin
  if p_value is null then return null; end if;
  if p_column not in ('user', 'email', 'ip') then
    raise invalid_parameter_value using message = 'member_email_change_rate_column';
  end if;
  select count(*) filter (where c.created_at > now_at - interval '1 hour'), count(*), min(c.created_at)
    into hour_count, day_count, oldest
    from private.member_email_change_challenges c
    where c.created_at > now_at - interval '24 hours'
      and ((p_column = 'user' and c.user_id = p_value::uuid)
        or (p_column = 'email' and c.email_digest = p_value)
        or (p_column = 'ip' and c.ip_digest = p_value));
  if day_count >= p_day_limit then
    return greatest(1, ceil(extract(epoch from (oldest + interval '24 hours' - now_at)))::integer);
  end if;
  if hour_count >= p_hour_limit then
    select min(c.created_at) into oldest from private.member_email_change_challenges c
      where c.created_at > now_at - interval '1 hour'
        and ((p_column = 'user' and c.user_id = p_value::uuid)
          or (p_column = 'email' and c.email_digest = p_value)
          or (p_column = 'ip' and c.ip_digest = p_value));
    return greatest(1, ceil(extract(epoch from (oldest + interval '1 hour' - now_at)))::integer);
  end if;
  return null;
end;
$$;

-- 코드 메일을 보내기 전에 요청을 기록한다. 한도·재발송 간격을 넘거나 대상 계정이 아니면 기록하지 않고 거절한다.
-- 같은 회원의 진행 중 요청은 새 요청이 대신한다(superseded) — 가장 최근 메일의 코드만 맞는다.
create function public.service_issue_member_email_change(
  p_challenge_id uuid,
  p_user_id uuid,
  p_email text,
  p_email_digest text,
  p_ip_digest text,
  p_code_digest text,
  p_ttl_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  now_at timestamptz;
  retry_after integer;
  last_at timestamptz;
  profile_suspended timestamptz;
  current_email text;
begin
  if p_challenge_id is null or p_user_id is null
    or p_email is null or char_length(p_email) not between 6 and 254 or p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or p_email <> pg_catalog.lower(pg_catalog.btrim(p_email))
    or p_email_digest is null or p_email_digest !~ '^[A-Za-z0-9_-]{32,128}$'
    or (p_ip_digest is not null and p_ip_digest !~ '^[A-Za-z0-9_-]{32,128}$')
    or p_code_digest is null or p_code_digest !~ '^[A-Za-z0-9_-]{32,128}$'
    or p_ttl_seconds is null or p_ttl_seconds not between 60 and 1800 then
    raise invalid_parameter_value using message = 'invalid_member_email_change';
  end if;

  if private.is_account_write_fenced(p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'account_unavailable');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('member-email:user:' || p_user_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('member-email:address:' || p_email_digest, 0));

  select p.suspended_at into profile_suspended from public.profiles p where p.id = p_user_id;
  if not found or profile_suspended is not null then
    return jsonb_build_object('ok', false, 'reason', 'account_unavailable');
  end if;
  -- 로그인 이메일이 쓸 수 있는 주소인 계정은 이 경로로 바꾸지 않는다(현재 주소 확인을 건너뛰는 길이 되지 않게).
  if not private.member_login_email_unusable(p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;
  -- 세션만으로 바꾸지 못하게 최근 로그인을 요구한다(온보딩은 막 로그인한 직후라 걸리지 않는다).
  if not exists (select 1 from auth.users u where u.id = p_user_id and u.last_sign_in_at > clock_timestamp() - interval '30 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'reauthentication_required');
  end if;
  -- 새 주소도 쓸 수 있는 주소여야 한다.
  if p_email like '%@privaterelay.appleid.com' then
    return jsonb_build_object('ok', false, 'reason', 'email_unusable');
  end if;
  select pg_catalog.lower(u.email) into current_email from auth.users u where u.id = p_user_id;
  if current_email = p_email then
    return jsonb_build_object('ok', false, 'reason', 'same_email');
  end if;

  if exists (select 1 from private.member_email_change_challenges c where c.id = p_challenge_id) then
    raise unique_violation using message = 'member_email_change_replayed';
  end if;

  now_at := clock_timestamp();

  -- 같은 회원은 60초 안에 다시 보내지 않는다(주소 단위로 세지 않는다 — 다른 회원의 요청 여부가 드러나지 않게).
  select max(c.created_at) into last_at from private.member_email_change_challenges c
    where c.user_id = p_user_id and c.created_at > now_at - interval '60 seconds';
  if last_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'cooldown',
      'retryAfterSeconds', greatest(1, ceil(extract(epoch from (last_at + interval '60 seconds' - now_at)))::integer));
  end if;

  retry_after := coalesce(
    private.member_email_change_rate_limited('user', p_user_id::text, 5, 10),
    private.member_email_change_rate_limited('email', p_email_digest, 5, 10),
    private.member_email_change_rate_limited('ip', p_ip_digest, 10, 30)
  );
  if retry_after is not null then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited', 'retryAfterSeconds', retry_after);
  end if;

  update private.member_email_change_challenges
    set status = 'superseded', resolved_at = now_at, email = null
    where user_id = p_user_id and status = 'pending';

  insert into private.member_email_change_challenges (
    id, user_id, email, email_digest, ip_digest, code_digest, status, attempts, created_at, expires_at
  ) values (
    p_challenge_id, p_user_id, p_email, p_email_digest, p_ip_digest, p_code_digest, 'pending', 0,
    now_at, now_at + make_interval(secs => p_ttl_seconds)
  );

  return jsonb_build_object('ok', true, 'expiresAt', now_at + make_interval(secs => p_ttl_seconds));
end;
$$;

-- 메일을 보내지 못했으면 요청을 닫는다. 한도에는 그대로 센다.
create function public.service_fail_member_email_change(p_challenge_id uuid, p_user_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_challenge_id is null or p_user_id is null then
    raise invalid_parameter_value using message = 'invalid_member_email_change';
  end if;
  update private.member_email_change_challenges
    set status = 'send_failed', resolved_at = clock_timestamp(), email = null
    where id = p_challenge_id and user_id = p_user_id and status = 'pending';
  return found;
end;
$$;

-- 코드를 확인한다. 5번 틀리면 그 요청은 닫힌다. 맞으면 새 이메일을 돌려주고 요청을 닫는다 — 로그인 이메일은 앱 서버가
-- Admin API로 바꾼다(Auth 스키마는 GoTrue가 소유한다). 다른 계정이 이미 쓰는 주소면 코드를 맞힌 뒤에만 그 사실을 알린다.
create function public.service_verify_member_email_change(
  p_challenge_id uuid,
  p_user_id uuid,
  p_code_digest text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  challenge private.member_email_change_challenges;
  peek_digest text;
  now_at timestamptz;
  new_email text;
begin
  if p_challenge_id is null or p_user_id is null
    or p_code_digest is null or p_code_digest !~ '^[A-Za-z0-9_-]{32,128}$' then
    raise invalid_parameter_value using message = 'invalid_member_email_change';
  end if;

  select c.email_digest into peek_digest from private.member_email_change_challenges c
    where c.id = p_challenge_id and c.user_id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if private.is_account_write_fenced(p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'account_unavailable');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('member-email:user:' || p_user_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('member-email:address:' || peek_digest, 0));

  select * into challenge from private.member_email_change_challenges c
    where c.id = p_challenge_id and c.user_id = p_user_id
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if challenge.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', challenge.status);
  end if;

  now_at := clock_timestamp();
  if challenge.expires_at <= now_at then
    update private.member_email_change_challenges
      set status = 'expired', resolved_at = now_at, email = null
      where id = challenge.id;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if challenge.code_digest <> p_code_digest then
    if challenge.attempts + 1 >= 5 then
      update private.member_email_change_challenges
        set attempts = challenge.attempts + 1, status = 'exhausted', resolved_at = now_at, email = null
        where id = challenge.id;
      return jsonb_build_object('ok', false, 'reason', 'exhausted');
    end if;
    update private.member_email_change_challenges
      set attempts = challenge.attempts + 1
      where id = challenge.id;
    return jsonb_build_object('ok', false, 'reason', 'mismatch', 'remainingAttempts', 5 - (challenge.attempts + 1));
  end if;

  -- 요청 뒤 조건이 바뀌었으면(정지·이미 바꾼 이메일) 닫는다.
  if exists (select 1 from public.profiles p where p.id = p_user_id and p.suspended_at is not null)
    or not private.member_login_email_unusable(p_user_id) then
    update private.member_email_change_challenges
      set status = 'refused', resolved_at = now_at, email = null
      where id = challenge.id;
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;

  new_email := challenge.email;
  if exists (select 1 from auth.users u where pg_catalog.lower(u.email) = new_email and u.id <> p_user_id) then
    update private.member_email_change_challenges
      set status = 'email_taken', resolved_at = now_at, email = null
      where id = challenge.id;
    return jsonb_build_object('ok', false, 'reason', 'email_taken');
  end if;

  update private.member_email_change_challenges
    set status = 'verified', resolved_at = now_at, email = null
    where id = challenge.id;
  return jsonb_build_object('ok', true, 'email', new_email);
end;
$$;

-- 로그인 이메일(auth.users.email)이 바뀌면 프로필 이메일도 맞춘다. 주문자 이메일·거래 메일 수신 주소가 profiles.email을
-- 먼저 읽는다(lib/orders/orderer.server.ts, lib/email/transactional.server.ts). 탈퇴 진행으로 봉인된 계정은 profiles
-- 쓰기가 트리거로 막혀 있어 건너뛴다 — 그 계정의 Auth 변경을 깨뜨리지 않는다.
create function private.sync_profile_email_from_auth()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.email is not distinct from old.email or private.is_account_write_fenced(new.id) then
    return new;
  end if;
  update public.profiles set email = new.email where id = new.id and email is distinct from new.email;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
after update of email on auth.users
for each row execute function private.sync_profile_email_from_auth();

create function private.erase_fenced_member_email_change()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('member-email:user:' || new.subject_user_id::text, 0));
  delete from private.member_email_change_challenges where user_id = new.subject_user_id;
  return new;
end;
$$;

create trigger erase_fenced_member_email_change
after insert on private.account_action_fences
for each row execute function private.erase_fenced_member_email_change();

-- 보관 기한: 시간이 지난 진행 중 요청은 만료로 닫으며 이메일 원문을 지우고, 이틀 지난 요청 행은 삭제한다.
create function private.prune_member_email_change_challenges(p_limit integer default 5000)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := clock_timestamp();
  pruned integer;
begin
  if p_limit is null or p_limit not between 1 and 50000 then
    raise invalid_parameter_value using message = 'invalid_member_email_change_prune_limit';
  end if;
  update private.member_email_change_challenges
    set status = 'expired', resolved_at = now_at, email = null
    where status = 'pending' and expires_at <= now_at;
  delete from private.member_email_change_challenges
    where ctid in (
      select c.ctid from private.member_email_change_challenges c
      where c.created_at < now_at - interval '2 days'
      order by c.created_at
      limit p_limit
    );
  get diagnostics pruned = row_count;
  return pruned;
end;
$$;

alter function private.member_login_email_unusable(uuid) owner to postgres;
alter function private.member_email_change_rate_limited(text, text, integer, integer) owner to postgres;
alter function public.service_issue_member_email_change(uuid, uuid, text, text, text, text, integer) owner to postgres;
alter function public.service_fail_member_email_change(uuid, uuid) owner to postgres;
alter function public.service_verify_member_email_change(uuid, uuid, text) owner to postgres;
alter function private.sync_profile_email_from_auth() owner to postgres;
alter function private.erase_fenced_member_email_change() owner to postgres;
alter function private.prune_member_email_change_challenges(integer) owner to postgres;

revoke all on function private.member_login_email_unusable(uuid),
  private.member_email_change_rate_limited(text, text, integer, integer),
  public.service_issue_member_email_change(uuid, uuid, text, text, text, text, integer),
  public.service_fail_member_email_change(uuid, uuid),
  public.service_verify_member_email_change(uuid, uuid, text),
  private.sync_profile_email_from_auth(),
  private.erase_fenced_member_email_change(),
  private.prune_member_email_change_challenges(integer)
  from public, anon, authenticated, service_role;
grant execute on function private.prune_member_email_change_challenges(integer) to postgres;
grant execute on function public.service_issue_member_email_change(uuid, uuid, text, text, text, text, integer),
  public.service_fail_member_email_change(uuid, uuid),
  public.service_verify_member_email_change(uuid, uuid, text)
  to service_role;

do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'member-email-change-retention',
      '23 * * * *',
      'select private.prune_member_email_change_challenges()'
    );
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
