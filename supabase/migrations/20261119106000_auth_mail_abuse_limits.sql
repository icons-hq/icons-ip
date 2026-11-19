begin;

-- 실운영 전 3차(원장 CUS-003·OPS-085) — 가입·확인 메일 재전송·비밀번호 재설정 요청의 서버 측 시도 한도.
--
-- 왜: 이 세 요청은 공개 서버 액션이고 모두 Supabase Auth 메일을 보낸다. 앱의 재전송 창(10분 3회)은 서명 쿠키라
-- 쿠키를 버리면 매번 새 창이다. GoTrue의 IP 한도는 서버 액션이 Vercel 함수 IP로 부르므로 공격자 IP 단위로 걸리지
-- 않는다. 그래서 프로젝트 전체가 나눠 쓰는 시간당 메일 한도(rate_limit_email_sent)를 봇 하나가 먼저 소진할 수 있다.
-- 앱 서버가 보는 접속 IP와 대상 이메일로 시도를 세어, 메일을 보내기 전에 거절한다.
--
-- 저장 원칙: 접속 IP와 이메일은 원문을 저장하지 않는다. 앱 서버가 서버 비밀값으로 만든 HMAC 다이제스트(가명 처리)만
-- 받는다. 한도 판정에 필요한 하루만 보관하고 이틀 지난 행은 매시 정리 작업이 지운다(pg_cron이 있는 배포만 등록).
--
-- 한도(숫자는 docs/runbooks/signup-contact-channels.md 봇 차단 절과 같아야 한다). 세 요청이 모두 메일을 보내므로
-- 종류를 가리지 않고 합쳐 센다 — 종류별로 따로 세면 한 IP가 합산으로 프로젝트 메일 한도를 혼자 쓸 수 있다.
--   · IP당 시간 15·일 40. 한 사람의 가입은 보통 메일 1~2통(가입 + 코드 재받기)이라 학교·통신사 NAT 뒤 동시 가입
--     7~8명/시간까지 통과한다. 15는 운영 Auth 시간당 한도(30)의 절반이라 IP 하나가 한도를 독점하지 못한다.
--   · 이메일당 시간 5·일 12. 남의 이메일로 확인·재설정 메일을 반복해 보내는 메일 폭탄을 막는다(앱 쿠키는 3회/10분).
-- 막힌 시도는 기록하지 않는다(거절이 창을 늘리지 않는다).

create table private.auth_mail_abuse_attempts (
  id bigint generated always as identity primary key,
  action text not null check (action in ('signup', 'resend', 'reset')),
  ip_digest text check (ip_digest is null or ip_digest ~ '^[A-Za-z0-9_-]{32,128}$'),
  email_digest text not null check (email_digest ~ '^[A-Za-z0-9_-]{32,128}$'),
  created_at timestamptz not null default clock_timestamp()
);
create index auth_mail_abuse_attempts_ip_time
  on private.auth_mail_abuse_attempts (ip_digest, created_at desc) where ip_digest is not null;
create index auth_mail_abuse_attempts_email_time
  on private.auth_mail_abuse_attempts (email_digest, created_at desc);
create index auth_mail_abuse_attempts_created on private.auth_mail_abuse_attempts (created_at);

comment on table private.auth_mail_abuse_attempts is
  '가입·확인 메일 재전송·비밀번호 재설정 요청의 시도 원장. IP·이메일은 앱 서버 HMAC 다이제스트만 저장하고 이틀 지나면 지운다. 서비스 롤 RPC로만 쓴다.';

alter table private.auth_mail_abuse_attempts owner to postgres;
alter table private.auth_mail_abuse_attempts enable row level security;
revoke all on private.auth_mail_abuse_attempts from public, anon, authenticated, service_role;

-- 한 범위(ip·email)의 시간·일 시도 수를 세어 한도를 넘었으면 다시 시도할 수 있기까지 남은 초를, 아니면 null을 돌려준다.
create function private.auth_mail_abuse_retry_after(p_column text, p_value text, p_hour_limit integer, p_day_limit integer)
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
  if p_column = 'ip' then
    select count(*) filter (where a.created_at > now_at - interval '1 hour'), count(*)
      into hour_count, day_count
      from private.auth_mail_abuse_attempts a
      where a.ip_digest = p_value and a.created_at > now_at - interval '24 hours';
  elsif p_column = 'email' then
    select count(*) filter (where a.created_at > now_at - interval '1 hour'), count(*)
      into hour_count, day_count
      from private.auth_mail_abuse_attempts a
      where a.email_digest = p_value and a.created_at > now_at - interval '24 hours';
  else
    raise invalid_parameter_value using message = 'auth_mail_abuse_column';
  end if;

  if day_count >= p_day_limit then
    select min(a.created_at) into oldest from private.auth_mail_abuse_attempts a
      where a.created_at > now_at - interval '24 hours'
        and ((p_column = 'ip' and a.ip_digest = p_value) or (p_column = 'email' and a.email_digest = p_value));
    return greatest(1, ceil(extract(epoch from (oldest + interval '24 hours' - now_at)))::integer);
  end if;
  if hour_count >= p_hour_limit then
    select min(a.created_at) into oldest from private.auth_mail_abuse_attempts a
      where a.created_at > now_at - interval '1 hour'
        and ((p_column = 'ip' and a.ip_digest = p_value) or (p_column = 'email' and a.email_digest = p_value));
    return greatest(1, ceil(extract(epoch from (oldest + interval '1 hour' - now_at)))::integer);
  end if;
  return null;
end;
$$;

-- 메일을 보내기 전에 한 번 부른다. 한도 안이면 시도를 기록하고 ok, 넘으면 기록하지 않고 거절한다.
-- IP를 알 수 없으면(p_ip_digest null) 이메일 한도만 적용한다.
create function public.service_consume_auth_mail_attempt(p_action text, p_ip_digest text, p_email_digest text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  retry_after integer;
begin
  if p_action is null or p_action not in ('signup', 'resend', 'reset')
    or (p_ip_digest is not null and p_ip_digest !~ '^[A-Za-z0-9_-]{32,128}$')
    or p_email_digest is null or p_email_digest !~ '^[A-Za-z0-9_-]{32,128}$' then
    raise invalid_parameter_value using message = 'invalid_auth_mail_attempt';
  end if;

  -- 잠금 순서: IP → 이메일. 같은 범위의 동시 요청이 한도를 함께 넘지 않게 직렬화한다.
  if p_ip_digest is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('auth-mail:ip:' || p_ip_digest, 0));
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('auth-mail:email:' || p_email_digest, 0));

  retry_after := coalesce(
    private.auth_mail_abuse_retry_after('ip', p_ip_digest, 15, 40),
    private.auth_mail_abuse_retry_after('email', p_email_digest, 5, 12)
  );
  if retry_after is not null then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited', 'retryAfterSeconds', retry_after);
  end if;

  insert into private.auth_mail_abuse_attempts (action, ip_digest, email_digest)
    values (p_action, p_ip_digest, p_email_digest);
  return jsonb_build_object('ok', true);
end;
$$;

-- 하루 창 판정에 필요한 만큼만 보관한다. 이틀 지난 행을 지운다.
create function private.prune_auth_mail_abuse_attempts(p_limit integer default 50000)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  pruned integer;
begin
  if p_limit is null or p_limit not between 1 and 500000 then
    raise invalid_parameter_value using message = 'invalid_auth_mail_abuse_prune_limit';
  end if;
  delete from private.auth_mail_abuse_attempts
    where id in (
      select a.id from private.auth_mail_abuse_attempts a
      where a.created_at < clock_timestamp() - interval '2 days'
      order by a.created_at
      limit p_limit
    );
  get diagnostics pruned = row_count;
  return pruned;
end;
$$;

alter function private.auth_mail_abuse_retry_after(text, text, integer, integer) owner to postgres;
alter function public.service_consume_auth_mail_attempt(text, text, text) owner to postgres;
alter function private.prune_auth_mail_abuse_attempts(integer) owner to postgres;

revoke all on function private.auth_mail_abuse_retry_after(text, text, integer, integer),
  public.service_consume_auth_mail_attempt(text, text, text),
  private.prune_auth_mail_abuse_attempts(integer)
  from public, anon, authenticated, service_role;
-- cron 작업은 등록한 롤(postgres)로 돈다. 복원 뒤 소유자가 달라져도 실행되게 명시한다.
grant execute on function private.prune_auth_mail_abuse_attempts(integer) to postgres;
grant execute on function public.service_consume_auth_mail_attempt(text, text, text) to service_role;

-- pg_cron이 있는 배포만 등록한다. cron.schedule은 이름 기준 upsert라 재적용에 안전하다.
do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'auth-mail-abuse-retention',
      '23 * * * *',
      'select private.prune_auth_mail_abuse_attempts()'
    );
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
