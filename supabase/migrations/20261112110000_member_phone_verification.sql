begin;

-- 10/14 실사용 QA 회의 1014-005·006 — 이메일 가입은 그대로 두고 온보딩에 휴대폰 번호 인증(SMS 인증번호,
-- 해외 번호 포함)을 더한다. 앱 스위치(ICONS_PHONE_VERIFICATION_ENABLED)는 기본 OFF이고, 이 migration은
-- 표와 서비스 롤 RPC만 만든다 — 스위치가 꺼져 있으면 아무도 부르지 않는다.
--
-- Supabase Auth 전화 인증(updateUser phone + Send SMS Hook)이 아니라 자체 인증번호를 쓴다(근거:
-- docs/runbooks/signup-contact-channels.md). 이 번호는 연락처 확인용이고 로그인 수단이 아니며, 성인 인증(KCP
-- 휴대폰 본인확인, ADR-0024)을 대체하지 않는다.
--
-- 저장 원칙
--   · 인증을 마친 번호만 private.member_phone_numbers에 회원당 하나 남긴다. 한 번호는 한 계정에서만 유효하다 —
--     다른 계정이 같은 번호를 인증하면 이전 계정의 인증을 해제하고 옮긴다(ADR-0024의 '차단하지 않고 옮긴다'와
--     같은 선택: 계정을 새로 만든 이용자가 CS 없이 막히지 않고, 어느 순간에도 번호당 인증 계정은 하나다).
--     인증 전에 '이미 쓰는 번호'라고 답하지 않는다 — 번호만 알면 가입 여부를 알아내는 조회가 된다.
--   · 인증번호 원문은 저장하지 않는다. 앱 서버가 서버 비밀값으로 만든 HMAC(인증 요청 id에 결속)만 비교한다.
--     번호·IP 시도 한도도 HMAC 다이제스트로 센다. 요청 행의 번호 원문은 결과가 정해지면 지우고, 이틀 지난
--     요청 행은 다음 요청 때 지운다(한도 창은 24시간).
--   · 탈퇴 신청(계정 봉인)이 생기면 주소록과 같은 방식으로 같은 트랜잭션에서 번호와 요청 행을 지운다.
--
-- 잠금 순서: 계정 행동 잠금(private.is_account_write_fenced) → 회원 잠금('member-phone:user:') →
-- 번호 잠금('member-phone:number:' + 다이제스트) → 행. 발송 요청과 확인이 같은 순서라 서로 교착하지 않는다.

create table private.member_phone_numbers (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  phone_e164 text not null unique check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  verified_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp()
);

create table private.member_phone_verification_challenges (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- 결과가 정해지면(verified·expired·exhausted·superseded·send_failed) 지운다.
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  phone_digest text not null check (phone_digest ~ '^[A-Za-z0-9_-]{32,128}$'),
  ip_digest text check (ip_digest is null or ip_digest ~ '^[A-Za-z0-9_-]{32,128}$'),
  code_digest text not null check (code_digest ~ '^[A-Za-z0-9_-]{32,128}$'),
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'expired', 'exhausted', 'superseded', 'send_failed')),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  check (expires_at > created_at),
  check ((status = 'pending') = (resolved_at is null)),
  check (status = 'pending' or phone_e164 is null),
  check (status <> 'pending' or phone_e164 is not null)
);
create index member_phone_verification_challenges_user_time
  on private.member_phone_verification_challenges (user_id, created_at desc);
create index member_phone_verification_challenges_phone_time
  on private.member_phone_verification_challenges (phone_digest, created_at desc);
create index member_phone_verification_challenges_ip_time
  on private.member_phone_verification_challenges (ip_digest, created_at desc) where ip_digest is not null;
create index member_phone_verification_challenges_created
  on private.member_phone_verification_challenges (created_at);

-- 인증·해제 이력(번호는 다이제스트로만). 같은 번호로 여러 계정을 돌려 쓰는지 운영자가 SQL로 추적하는 근거다.
create table private.member_phone_verification_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event text not null check (event in ('verified', 'released')),
  phone_digest text not null check (phone_digest ~ '^[A-Za-z0-9_-]{32,128}$'),
  occurred_at timestamptz not null default clock_timestamp()
);
create index member_phone_verification_events_user_time
  on private.member_phone_verification_events (user_id, occurred_at desc);
create index member_phone_verification_events_phone_time
  on private.member_phone_verification_events (phone_digest, occurred_at desc);

alter table private.member_phone_numbers owner to postgres;
alter table private.member_phone_verification_challenges owner to postgres;
alter table private.member_phone_verification_events owner to postgres;
alter table private.member_phone_numbers enable row level security;
alter table private.member_phone_verification_challenges enable row level security;
alter table private.member_phone_verification_events enable row level security;
revoke all on private.member_phone_numbers, private.member_phone_verification_challenges,
  private.member_phone_verification_events from public, anon, authenticated, service_role;

comment on table private.member_phone_numbers is
  '회원이 SMS 인증번호로 확인한 휴대폰 번호(E.164, 회원당 1개·번호당 1계정). 연락처 확인용이며 로그인 수단·성인 인증이 아니다. 서비스 롤 RPC로만 쓰고, 탈퇴 신청(계정 봉인) 시 지운다.';

-- 시도 한도. 숫자는 런북(docs/runbooks/signup-contact-channels.md)과 같아야 한다.
create function private.member_phone_rate_limited(p_column text, p_value text, p_hour_limit integer, p_day_limit integer)
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
  if p_column = 'user' then
    select count(*) filter (where c.created_at > now_at - interval '1 hour'), count(*)
      into hour_count, day_count
      from private.member_phone_verification_challenges c
      where c.user_id = p_value::uuid and c.created_at > now_at - interval '24 hours';
  elsif p_column = 'phone' then
    select count(*) filter (where c.created_at > now_at - interval '1 hour'), count(*)
      into hour_count, day_count
      from private.member_phone_verification_challenges c
      where c.phone_digest = p_value and c.created_at > now_at - interval '24 hours';
  elsif p_column = 'ip' then
    select count(*) filter (where c.created_at > now_at - interval '1 hour'), count(*)
      into hour_count, day_count
      from private.member_phone_verification_challenges c
      where c.ip_digest = p_value and c.created_at > now_at - interval '24 hours';
  else
    raise invalid_parameter_value using message = 'member_phone_rate_column';
  end if;

  if day_count >= p_day_limit then
    select min(c.created_at) into oldest from private.member_phone_verification_challenges c
      where c.created_at > now_at - interval '24 hours'
        and ((p_column = 'user' and c.user_id = p_value::uuid)
          or (p_column = 'phone' and c.phone_digest = p_value)
          or (p_column = 'ip' and c.ip_digest = p_value));
    return greatest(1, ceil(extract(epoch from (oldest + interval '24 hours' - now_at)))::integer);
  end if;
  if hour_count >= p_hour_limit then
    select min(c.created_at) into oldest from private.member_phone_verification_challenges c
      where c.created_at > now_at - interval '1 hour'
        and ((p_column = 'user' and c.user_id = p_value::uuid)
          or (p_column = 'phone' and c.phone_digest = p_value)
          or (p_column = 'ip' and c.ip_digest = p_value));
    return greatest(1, ceil(extract(epoch from (oldest + interval '1 hour' - now_at)))::integer);
  end if;
  return null;
end;
$$;

-- 인증번호 발송 전에 요청을 기록한다. 한도·재발송 간격을 넘으면 기록하지 않고 거절한다.
-- 같은 회원의 진행 중 요청은 새 요청이 대신한다(superseded) — 가장 최근 문자의 번호만 맞는다.
create function public.service_issue_member_phone_verification(
  p_challenge_id uuid,
  p_user_id uuid,
  p_phone_e164 text,
  p_phone_digest text,
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
begin
  if p_challenge_id is null or p_user_id is null
    or p_phone_e164 is null or p_phone_e164 !~ '^\+[1-9][0-9]{6,14}$'
    or p_phone_digest is null or p_phone_digest !~ '^[A-Za-z0-9_-]{32,128}$'
    or (p_ip_digest is not null and p_ip_digest !~ '^[A-Za-z0-9_-]{32,128}$')
    or p_code_digest is null or p_code_digest !~ '^[A-Za-z0-9_-]{32,128}$'
    or p_ttl_seconds is null or p_ttl_seconds not between 60 and 900 then
    raise invalid_parameter_value using message = 'invalid_member_phone_verification';
  end if;

  if private.is_account_write_fenced(p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'account_unavailable');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('member-phone:user:' || p_user_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('member-phone:number:' || p_phone_digest, 0));

  select p.suspended_at into profile_suspended from public.profiles p where p.id = p_user_id;
  if not found or profile_suspended is not null then
    return jsonb_build_object('ok', false, 'reason', 'account_unavailable');
  end if;

  if exists (select 1 from private.member_phone_verification_challenges c where c.id = p_challenge_id) then
    raise unique_violation using message = 'member_phone_verification_replayed';
  end if;

  now_at := clock_timestamp();

  -- 같은 회원이나 같은 번호로 60초 안에 다시 보내지 않는다.
  select max(c.created_at) into last_at from private.member_phone_verification_challenges c
    where (c.user_id = p_user_id or c.phone_digest = p_phone_digest) and c.created_at > now_at - interval '60 seconds';
  if last_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'cooldown',
      'retryAfterSeconds', greatest(1, ceil(extract(epoch from (last_at + interval '60 seconds' - now_at)))::integer));
  end if;

  retry_after := coalesce(
    private.member_phone_rate_limited('user', p_user_id::text, 5, 10),
    private.member_phone_rate_limited('phone', p_phone_digest, 5, 10),
    private.member_phone_rate_limited('ip', p_ip_digest, 10, 30)
  );
  if retry_after is not null then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited', 'retryAfterSeconds', retry_after);
  end if;

  update private.member_phone_verification_challenges
    set status = 'superseded', resolved_at = now_at, phone_e164 = null
    where user_id = p_user_id and status = 'pending';

  insert into private.member_phone_verification_challenges (
    id, user_id, phone_e164, phone_digest, ip_digest, code_digest, status, attempts, created_at, expires_at
  ) values (
    p_challenge_id, p_user_id, p_phone_e164, p_phone_digest, p_ip_digest, p_code_digest, 'pending', 0,
    now_at, now_at + make_interval(secs => p_ttl_seconds)
  );

  -- 한도 창(24시간)을 넘긴 오래된 요청은 조금씩 지운다.
  delete from private.member_phone_verification_challenges
    where ctid in (
      select c.ctid from private.member_phone_verification_challenges c
      where c.created_at < now_at - interval '2 days'
      order by c.created_at
      limit 200
    );

  return jsonb_build_object('ok', true, 'expiresAt', now_at + make_interval(secs => p_ttl_seconds));
end;
$$;

-- 발송사가 문자를 받지 못했으면 요청을 닫는다. 한도에는 그대로 센다(실패하는 번호로 발송을 반복하지 않게).
create function public.service_fail_member_phone_verification(p_challenge_id uuid, p_user_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_challenge_id is null or p_user_id is null then
    raise invalid_parameter_value using message = 'invalid_member_phone_verification';
  end if;
  update private.member_phone_verification_challenges
    set status = 'send_failed', resolved_at = clock_timestamp(), phone_e164 = null
    where id = p_challenge_id and user_id = p_user_id and status = 'pending';
  return found;
end;
$$;

-- 인증번호를 확인한다. 5번 틀리면 그 요청은 닫힌다. 맞으면 번호를 회원에게 옮겨 기록한다.
create function public.service_verify_member_phone_verification(
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
  challenge private.member_phone_verification_challenges;
  peek_digest text;
  now_at timestamptz;
  released_user uuid;
begin
  if p_challenge_id is null or p_user_id is null
    or p_code_digest is null or p_code_digest !~ '^[A-Za-z0-9_-]{32,128}$' then
    raise invalid_parameter_value using message = 'invalid_member_phone_verification';
  end if;

  select c.phone_digest into peek_digest from private.member_phone_verification_challenges c
    where c.id = p_challenge_id and c.user_id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if private.is_account_write_fenced(p_user_id) then
    return jsonb_build_object('ok', false, 'reason', 'account_unavailable');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('member-phone:user:' || p_user_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('member-phone:number:' || peek_digest, 0));

  select * into challenge from private.member_phone_verification_challenges c
    where c.id = p_challenge_id and c.user_id = p_user_id
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if challenge.status = 'verified' then
    return jsonb_build_object('ok', true, 'replayed', true);
  end if;
  if challenge.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', challenge.status);
  end if;

  now_at := clock_timestamp();
  if challenge.expires_at <= now_at then
    update private.member_phone_verification_challenges
      set status = 'expired', resolved_at = now_at, phone_e164 = null
      where id = challenge.id;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if challenge.code_digest <> p_code_digest then
    if challenge.attempts + 1 >= 5 then
      update private.member_phone_verification_challenges
        set attempts = challenge.attempts + 1, status = 'exhausted', resolved_at = now_at, phone_e164 = null
        where id = challenge.id;
      return jsonb_build_object('ok', false, 'reason', 'exhausted');
    end if;
    update private.member_phone_verification_challenges
      set attempts = challenge.attempts + 1
      where id = challenge.id;
    return jsonb_build_object('ok', false, 'reason', 'mismatch', 'remainingAttempts', 5 - (challenge.attempts + 1));
  end if;

  if exists (select 1 from public.profiles p where p.id = p_user_id and p.suspended_at is not null) then
    return jsonb_build_object('ok', false, 'reason', 'account_unavailable');
  end if;

  -- 같은 번호를 인증해 둔 다른 계정이 있으면 그 인증을 해제한다(옮기기).
  for released_user in
    delete from private.member_phone_numbers n
      where n.phone_e164 = challenge.phone_e164 and n.user_id <> p_user_id
      returning n.user_id
  loop
    insert into private.member_phone_verification_events (user_id, event, phone_digest, occurred_at)
      values (released_user, 'released', challenge.phone_digest, now_at);
  end loop;

  insert into private.member_phone_numbers (user_id, phone_e164, verified_at, updated_at)
    values (p_user_id, challenge.phone_e164, now_at, now_at)
    on conflict (user_id) do update
      set phone_e164 = excluded.phone_e164, verified_at = excluded.verified_at, updated_at = excluded.updated_at;
  insert into private.member_phone_verification_events (user_id, event, phone_digest, occurred_at)
    values (p_user_id, 'verified', challenge.phone_digest, now_at);
  update private.member_phone_verification_challenges
    set status = 'verified', resolved_at = now_at, phone_e164 = null
    where id = challenge.id;

  return jsonb_build_object('ok', true, 'replayed', false);
end;
$$;

-- 본인의 인증된 번호. 온보딩·설정 화면이 서버에서 읽어 가려진 번호로 보여 준다.
create function public.my_member_phone_verification()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or not exists (select 1 from public.profiles p where p.id = actor) then
    raise insufficient_privilege using message = 'member_phone_auth_required';
  end if;
  return coalesce(
    (select jsonb_build_object('verified', true, 'phoneE164', n.phone_e164, 'verifiedAt', n.verified_at)
      from private.member_phone_numbers n where n.user_id = actor),
    jsonb_build_object('verified', false, 'phoneE164', null, 'verifiedAt', null)
  );
end;
$$;

-- 탈퇴 신청(계정 봉인) 행이 생기는 트랜잭션 안에서 번호와 진행 중 요청을 지운다. 주소록과 같은 잠금 순서다.
create function private.erase_member_phone(p_user_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  erased integer;
begin
  if p_user_id is null then
    raise invalid_parameter_value using message = 'member_phone_member_required';
  end if;
  perform private.lock_account_action_subject(p_user_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('member-phone:user:' || p_user_id::text, 0));
  delete from private.member_phone_numbers where user_id = p_user_id;
  get diagnostics erased = row_count;
  update private.member_phone_verification_challenges
    set status = 'superseded', resolved_at = clock_timestamp(), phone_e164 = null
    where user_id = p_user_id and status = 'pending';
  return erased;
end;
$$;

create function private.erase_fenced_member_phone()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.erase_member_phone(new.subject_user_id);
  return new;
end;
$$;

create trigger erase_fenced_member_phone
after insert on private.account_action_fences
for each row execute function private.erase_fenced_member_phone();

alter function private.member_phone_rate_limited(text, text, integer, integer) owner to postgres;
alter function public.service_issue_member_phone_verification(uuid, uuid, text, text, text, text, integer) owner to postgres;
alter function public.service_fail_member_phone_verification(uuid, uuid) owner to postgres;
alter function public.service_verify_member_phone_verification(uuid, uuid, text) owner to postgres;
alter function public.my_member_phone_verification() owner to postgres;
alter function private.erase_member_phone(uuid) owner to postgres;
alter function private.erase_fenced_member_phone() owner to postgres;

revoke all on function private.member_phone_rate_limited(text, text, integer, integer),
  public.service_issue_member_phone_verification(uuid, uuid, text, text, text, text, integer),
  public.service_fail_member_phone_verification(uuid, uuid),
  public.service_verify_member_phone_verification(uuid, uuid, text),
  public.my_member_phone_verification(),
  private.erase_member_phone(uuid),
  private.erase_fenced_member_phone()
  from public, anon, authenticated, service_role;
grant execute on function public.service_issue_member_phone_verification(uuid, uuid, text, text, text, text, integer),
  public.service_fail_member_phone_verification(uuid, uuid),
  public.service_verify_member_phone_verification(uuid, uuid, text)
  to service_role;
grant execute on function public.my_member_phone_verification() to authenticated;

notify pgrst, 'reload schema';

commit;
