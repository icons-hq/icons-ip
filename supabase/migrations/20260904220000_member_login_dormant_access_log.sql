-- D-8 ① — 접속 기록 · 휴면 · 취급자 열람 로그 (설계서 v2 §1-6)
--
-- 법정 휴면(1년 미접속 분리보관)은 2023-09-15 개정으로 **폐지**됐다. 그래서 휴면은
-- 법이 시키는 파기가 아니라 **우리 정책의 상태 플래그**다 — 분리보관 표를 만들지 않는다.
--
-- 반대로 **취급자 접속기록은 의무**다(고시 제2025-9호 §8). 그 의무는 이용자 로그인이 아니라
-- **운영자가 개인정보를 열어 본 기록**에 걸린다. 두 기록을 다른 표에 두는 이유가 그것이다:
-- 하나는 우리 정책의 재료, 하나는 법이 요구하는 증거다. 보관 기간도 1년과 2년으로 다르다.

alter table public.profiles
  add column if not exists last_login_at timestamptz,
  add column if not exists dormant_at timestamptz,
  add column if not exists dormant_notified_at timestamptz;

create index if not exists profiles_dormant_idx on public.profiles (dormant_at) where dormant_at is not null;
create index if not exists profiles_last_login_idx on public.profiles (last_login_at);

create table if not exists private.member_login_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  ip inet,
  user_agent text
);
create index if not exists member_login_events_user_idx on private.member_login_events (user_id, occurred_at desc);
create index if not exists member_login_events_occurred_idx on private.member_login_events (occurred_at);
alter table private.member_login_events enable row level security;
revoke all on table private.member_login_events from public, anon, authenticated;

comment on table private.member_login_events is
  '이용자 로그인 기록(1년). 휴면 판정의 재료다 — 취급자 접속기록은 pii_access_log 에 따로 있다.';

create table if not exists private.pii_access_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  subject_id uuid,
  action text not null check (char_length(action) between 1 and 60),
  context jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists pii_access_log_actor_idx on private.pii_access_log (actor_id, occurred_at desc);
create index if not exists pii_access_log_subject_idx on private.pii_access_log (subject_id, occurred_at desc);
create index if not exists pii_access_log_occurred_idx on private.pii_access_log (occurred_at);
alter table private.pii_access_log enable row level security;
revoke all on table private.pii_access_log from public, anon, authenticated;

comment on table private.pii_access_log is
  '취급자 개인정보 열람 기록(2년). 고시 제2025-9호 §8 — 5만 명 이상이면 2년이라 처음부터 2년으로 둔다.';

-- ---------------------------------------------------------------------------
-- 본인 로그인 기록 — 앱이 콜백에서 부른다
-- ---------------------------------------------------------------------------
create or replace function public.record_my_login(p_ip text default null, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  insert into private.member_login_events (user_id, ip, user_agent)
  values (
    v_actor,
    case when p_ip ~ '^[0-9a-fA-F:.]+$' then p_ip::inet end,
    left(nullif(btrim(coalesce(p_user_agent, '')), ''), 300)
  );

  -- 로그인하면 휴면이 풀린다. 별도의 「복귀」 절차를 두지 않는 이유는,
  -- 돌아온 사람에게 문을 한 번 더 여는 일을 시키지 않기 위해서다.
  update public.profiles
  set last_login_at = now(),
      dormant_at = null,
      dormant_notified_at = null
  where id = v_actor;
end;
$$;

-- ---------------------------------------------------------------------------
-- 취급자 열람 기록
-- ---------------------------------------------------------------------------
create or replace function private.record_pii_access(
  p_subject uuid,
  p_action text,
  p_context jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.pii_access_log (actor_id, subject_id, action, context)
  values ((select auth.uid()), p_subject, p_action, p_context);
end;
$$;

create or replace function public.admin_member_login_events(p_user_id uuid, p_limit integer default 30)
returns table (occurred_at timestamptz, ip text, user_agent text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  return query
  select event.occurred_at,
         -- 접속 IP 도 개인정보다. 목록에서는 뒤 한 칸을 가린다.
         regexp_replace(host(event.ip), '\.[0-9]+$', '.***'),
         event.user_agent
  from private.member_login_events as event
  where event.user_id = p_user_id
  order by event.occurred_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 200);
end;
$$;

-- ---------------------------------------------------------------------------
-- 휴면 — 정책 상태다. 스윕은 만들되 **켜지 않는다**(처리방침 개정이 먼저다).
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_dormant(p_user_id uuid, p_dormant boolean, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
begin
  update public.profiles
  set dormant_at = case when p_dormant then coalesce(dormant_at, now()) else null end,
      dormant_notified_at = case when p_dormant then dormant_notified_at else null end
  where id = p_user_id;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0002';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.member.dormant', 'profile:' || p_user_id::text,
          jsonb_build_object('dormant', p_dormant, 'note', p_note));
  return coalesce(p_dormant, false);
end;
$$;

create or replace function public.sweep_dormant_members(
  p_idle_months integer default 12,
  p_notice_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_notified integer;
  v_dormant integer;
begin
  -- 안내 먼저, 전환은 안내 뒤 30일. 예고 없이 상태를 바꾸면 사용자는 이유를 모른 채
  -- 마케팅이 끊긴 것만 겪는다.
  with candidates as (
    update public.profiles
    set dormant_notified_at = now()
    where dormant_at is null
      and dormant_notified_at is null
      and coalesce(last_login_at, created_at) < now() - (p_idle_months || ' months')::interval
    returning 1
  )
  select count(*)::integer into v_notified from candidates;

  with switched as (
    update public.profiles
    set dormant_at = now()
    where dormant_at is null
      and dormant_notified_at is not null
      and dormant_notified_at < now() - (p_notice_days || ' days')::interval
      and coalesce(last_login_at, created_at) < now() - (p_idle_months || ' months')::interval
    returning 1
  )
  select count(*)::integer into v_dormant from switched;

  return jsonb_build_object('notified', v_notified, 'switched', v_dormant);
end;
$$;

comment on function public.sweep_dormant_members(integer, integer) is
  '휴면 안내·전환 스윕. **크론에 등록하지 않았다** — 휴면 정책은 개인정보처리방침에 적어야
   효력이 있고, 그 개정은 사람의 판정이다(설계서 v2 §5, Class C).';

-- 로그 보관 — 이용자 로그인 1년, 취급자 열람 2년.
create or replace function public.purge_member_logs()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_logins integer;
  v_access integer;
begin
  with removed as (
    delete from private.member_login_events where occurred_at < now() - interval '1 year' returning 1
  )
  select count(*)::integer into v_logins from removed;
  with removed as (
    delete from private.pii_access_log where occurred_at < now() - interval '2 years' returning 1
  )
  select count(*)::integer into v_access from removed;
  return jsonb_build_object('loginEvents', v_logins, 'accessLog', v_access);
end;
$$;

revoke all on function private.record_pii_access(uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.record_my_login(text, text) from public, anon, service_role;
grant execute on function public.record_my_login(text, text) to authenticated;
revoke all on function public.admin_member_login_events(uuid, integer) from public, anon, service_role;
grant execute on function public.admin_member_login_events(uuid, integer) to authenticated;
revoke all on function public.admin_set_dormant(uuid, boolean, text) from public, anon, service_role;
grant execute on function public.admin_set_dormant(uuid, boolean, text) to authenticated;
revoke all on function public.sweep_dormant_members(integer, integer) from public, anon, authenticated;
grant execute on function public.sweep_dormant_members(integer, integer) to service_role;
revoke all on function public.purge_member_logs() from public, anon, authenticated;
grant execute on function public.purge_member_logs() to service_role;

select cron.schedule('purge-member-logs', '30 18 * * *', $$select public.purge_member_logs();$$)
where not exists (select 1 from cron.job where jobname = 'purge-member-logs');
