-- D-8 ③ — 회원 검색 v2 · 상위 회원 · 등급 규칙 표 (설계서 v2 §1-6)
--
-- 등급 임계값이 함수 안에 상수로 박혀 있다. 마케팅이 「실버를 8만 원으로 내리자」고 하면
-- 마이그레이션을 짜야 한다 — 그건 개발 일정이 정책을 결정한다는 뜻이다. 표로 뺀다.
--
-- 더 큰 문제: 지금 재산정은 결제·취소 전이 때만 돈다. 그래서 **창이 지나도 강등되지 않는다** —
-- 작년에 백만 원 쓰고 안 온 사람이 아직 플래티넘이다. 야간 잡으로 닫는다.

create table if not exists public.loyalty_grade_rules (
  grade public.loyalty_grade primary key,
  min_spend bigint not null check (min_spend >= 0),
  window_days integer not null default 90 check (window_days between 1 and 3650),
  sort_order integer not null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.loyalty_grade_rules enable row level security;
drop policy if exists "everyone reads loyalty grade rules" on public.loyalty_grade_rules;
create policy "everyone reads loyalty grade rules" on public.loyalty_grade_rules
  for select to anon, authenticated using (true);
grant select on public.loyalty_grade_rules to anon, authenticated;

-- 현재 코드에 박혀 있던 값 그대로 옮긴다. 이관은 값을 바꾸는 자리가 아니다.
insert into public.loyalty_grade_rules (grade, min_spend, window_days, sort_order) values
  ('welcome', 0, 90, 1),
  ('silver', 100000, 90, 2),
  ('gold', 300000, 90, 3),
  ('platinum', 1000000, 90, 4)
on conflict (grade) do nothing;

create or replace function private.assert_grade_rules_monotonic()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- 높은 등급의 문턱이 낮은 등급보다 낮으면 어느 등급인지 정할 수 없다.
  if exists (
    select 1
    from public.loyalty_grade_rules as lower_rule
    join public.loyalty_grade_rules as upper_rule on upper_rule.sort_order > lower_rule.sort_order
    where upper_rule.min_spend <= lower_rule.min_spend
  ) then
    raise exception 'grade_thresholds_not_monotonic' using errcode = '23514';
  end if;
  return null;
end;
$$;

drop trigger if exists loyalty_grade_rules_monotonic on public.loyalty_grade_rules;
create constraint trigger loyalty_grade_rules_monotonic
  after insert or update on public.loyalty_grade_rules
  deferrable initially deferred
  for each row execute function private.assert_grade_rules_monotonic();

-- 규칙 표를 읽도록 교체한다. 시그니처는 그대로라 부르는 쪽은 하나도 안 바뀐다.
create or replace function private.loyalty_grade_for_spend(p_spend bigint)
returns public.loyalty_grade
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select rule.grade
    from public.loyalty_grade_rules as rule
    where rule.min_spend <= coalesce(p_spend, 0)
    order by rule.sort_order desc
    limit 1
  ), 'welcome'::public.loyalty_grade);
$$;

create or replace function public.admin_upsert_loyalty_grade_rule(
  p_grade public.loyalty_grade,
  p_min_spend bigint,
  p_window_days integer default 90
)
returns public.loyalty_grade
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := private.require_staff_actor();
begin
  if not private.is_admin_actor() then
    -- 등급 문턱은 매출 정책이다. 스태프가 혼자 내릴 수 있으면 정책이 아니다.
    raise exception 'admin_role_required' using errcode = '42501';
  end if;

  update public.loyalty_grade_rules
  set min_spend = p_min_spend, window_days = coalesce(p_window_days, window_days),
      updated_by = v_actor, updated_at = now()
  where grade = p_grade;
  if not found then
    raise exception 'grade_rule_not_found' using errcode = 'P0002';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (v_actor, 'admin.loyalty.rule_updated', 'grade:' || p_grade::text,
          jsonb_build_object('minSpend', p_min_spend, 'windowDays', p_window_days));
  return p_grade;
end;
$$;

-- 야간 재산정 — 창이 지난 실적을 강등으로 반영한다.
create or replace function public.recalculate_all_loyalty_grades()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in select id from public.profiles loop
    perform private.recalculate_loyalty_grade(v_row.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.recalculate_all_loyalty_grades() from public, anon, authenticated;
grant execute on function public.recalculate_all_loyalty_grades() to service_role;
revoke all on function public.admin_upsert_loyalty_grade_rule(public.loyalty_grade, bigint, integer) from public, anon, service_role;
grant execute on function public.admin_upsert_loyalty_grade_rule(public.loyalty_grade, bigint, integer) to authenticated;

select cron.schedule('recalculate-loyalty-grades', '50 18 * * *',
  $$select public.recalculate_all_loyalty_grades();$$)
where not exists (select 1 from cron.job where jobname = 'recalculate-loyalty-grades');

-- ---------------------------------------------------------------------------
-- 검색 v2 — 상태·등급·구매액으로 좁힌다
-- ---------------------------------------------------------------------------

-- 목록용 이메일 마스킹. 기존 검색 RPC 가 안에서 하던 것을 함수로 꺼낸다 —
-- 두 곳(검색·상위 회원)이 다르게 가리면 같은 사람이 화면마다 달라 보인다.
-- 온보딩 전 회원은 별명이 없다. 목록이 빈칸을 그리면 운영자가 「누구인지 모르는 줄」을 본다 —
-- 기존 검색 RPC 가 쓰던 `fan_` + id 앞 여섯 자 규칙을 그대로 옮긴다.
create or replace function private.member_display_name(p_nickname text, p_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(pg_catalog.btrim(coalesce(p_nickname, '')), ''), 'fan_' || pg_catalog.left(p_id::text, 6));
$$;

create or replace function private.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null or pg_catalog.strpos(p_email, '@') < 2 then '이메일 없음'
    else pg_catalog.left(p_email, 1) || '***' || pg_catalog.substr(p_email, pg_catalog.strpos(p_email, '@'))
  end;
$$;

drop function if exists public.admin_search_members(text, integer, integer);
drop function if exists public.admin_search_members(text, integer, integer, text, public.loyalty_grade, bigint, bigint);

create function public.admin_search_members(
  target_query text default null,
  target_limit integer default 20,
  target_offset integer default 0,
  p_status text default null,
  p_grade public.loyalty_grade default null,
  p_min_spend bigint default null,
  p_max_spend bigint default null
)
returns table (
  profile_id uuid,
  nickname text,
  masked_email text,
  role public.user_role,
  created_at timestamptz,
  suspended_at timestamptz,
  dormant_at timestamptz,
  last_login_at timestamptz,
  loyalty_grade public.loyalty_grade,
  order_count integer,
  gross_total bigint,
  last_order_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
-- 회원 함수들은 빈 search_path 규약을 따른다(테스트가 그 계약을 지킨다) — 이름은 전부 한정한다.
set search_path = ''
as $$
declare
  v_query text := nullif(pg_catalog.btrim(coalesce(target_query, '')), '');
  v_limit integer := least(greatest(coalesce(target_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(target_offset, 0), 0);
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  if p_status is not null and p_status not in ('active', 'suspended', 'dormant') then
    raise check_violation using message = 'invalid member status filter';
  end if;

  return query
  select
    profile.id,
    private.member_display_name(profile.nickname, profile.id),
    -- 목록에서는 언제나 가린다. 원문은 상세(열람 기록이 남는 자리)에서만 본다.
    private.mask_email(profile.email),
    profile.role,
    profile.created_at,
    profile.suspended_at,
    profile.dormant_at,
    profile.last_login_at,
    profile.loyalty_grade,
    coalesce(stats.order_count, 0),
    coalesce(stats.gross_total, 0),
    stats.last_order_at,
    pg_catalog.count(*) over()::bigint
  from public.profiles as profile
  left join public.member_purchase_stats as stats on stats.user_id = profile.id
  where (
      v_query is null
      or position(pg_catalog.lower(v_query) in pg_catalog.lower(coalesce(profile.nickname, ''))) > 0
      or position(pg_catalog.lower(v_query) in pg_catalog.lower(coalesce(profile.email, ''))) > 0
      or profile.id::text = pg_catalog.lower(v_query)
    )
    and (
      p_status is null
      or (p_status = 'suspended' and profile.suspended_at is not null)
      or (p_status = 'dormant' and profile.dormant_at is not null)
      or (p_status = 'active' and profile.suspended_at is null and profile.dormant_at is null)
    )
    and (p_grade is null or profile.loyalty_grade = p_grade)
    and (p_min_spend is null or coalesce(stats.gross_total, 0) >= p_min_spend)
    and (p_max_spend is null or coalesce(stats.gross_total, 0) <= p_max_spend)
  order by profile.created_at desc, profile.id
  limit v_limit
  offset v_offset;
end;
$$;

create or replace function public.admin_top_buyers(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 20
)
returns table (
  profile_id uuid, nickname text, masked_email text,
  loyalty_grade public.loyalty_grade, order_count integer, gross_total bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  -- 전체 기간은 롤업을 그대로 읽는다. 기간을 지정하면 그때만 원장을 센다 —
  -- 캐시는 「전체 기간」 하나만 들고 있고, 모든 기간의 캐시를 들 수는 없다.
  if p_from is null and p_to is null then
    return query
    select profile.id, private.member_display_name(profile.nickname, profile.id), private.mask_email(profile.email),
           profile.loyalty_grade, stats.order_count, stats.gross_total
    from public.member_purchase_stats as stats
    join public.profiles as profile on profile.id = stats.user_id
    order by stats.gross_total desc, profile.id
    limit v_limit;
  else
    return query
    select profile.id, private.member_display_name(profile.nickname, profile.id), private.mask_email(profile.email),
           profile.loyalty_grade,
           count(*)::integer, sum(ord.total)::bigint
    from public.orders as ord
    join public.profiles as profile on profile.id = ord.user_id
    where ord.status in ('paid', 'confirmed', 'shipping', 'delivered', 'done')
      and (p_from is null or coalesce(ord.paid_at, ord.created_at) >= p_from)
      and (p_to is null or coalesce(ord.paid_at, ord.created_at) < p_to)
    group by profile.id, profile.nickname, profile.email, profile.loyalty_grade
    order by sum(ord.total) desc, profile.id
    limit v_limit;
  end if;
end;
$$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.admin_search_members(text, integer, integer, text, public.loyalty_grade, bigint, bigint)',
    'public.admin_top_buyers(timestamptz, timestamptz, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, service_role', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
  end loop;
end;
$$;
