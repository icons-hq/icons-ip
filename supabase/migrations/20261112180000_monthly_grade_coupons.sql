-- ============================================================================
-- ICONS · 매월 등급 혜택 쿠폰 자동 지급 (S36-062 '회원 할인', 2026-11-11 사용자 결정
-- "매월 등급 쿠폰 자동 지급 (Recommended)" — 매월 1일 현재 등급 회원에게 등급 쿠폰 자동 지급(멱등).
-- 금액·조건은 운영값.)
--
-- ## 무엇이 바뀌나
--
-- - 쿠폰 정의의 등급 혜택에 지급 방식(`coupons.grade_benefit_cadence`)을 둔다. 'upgrade'(승급 시 1회)가
--   기본이고 기존 정의는 모두 그대로다. 운영자가 쿠폰 등록 화면에서 'monthly'(매월 1일 지급)를 고른
--   정의만 새 경로를 탄다 — 둘 중 하나다. 승급 지급(private.grant_grade_benefit_coupons)은 'upgrade'
--   정의만, 매월 지급은 'monthly' 정의만 본다.
-- - 매월 지급은 그 달(KST) 첫 실행(보통 1일 0시대)에 고정한 'monthly' 정의를, 그 시점 등급이 쿠폰 등급
--   이상인 회원에게 한 장씩 준다. 등급 혜택은 기존 승급 지급과 같은 '도달한 등급' 계약이다(점프 승급이
--   중간 등급 혜택을 받고, 마이페이지 등급 혜택 안내가 내가 오른 등급 이하의 쿠폰을 펼치는 것과 같다).
-- - 대상 회원은 운영자 지정 발급(private.coupon_issue_rows)과 같은 '이용 가능한 고객'이다: 일반 회원,
--   정지·탈퇴 진행(쓰기 차단) 아님, 온보딩 완료, 만 14세 이상. 받는 회원 조건(첫 구매·재구매)·발급 기간·
--   사용 종료·발급 한도는 승급 지급과 같은 거름을 지난다.
-- - '그 시점 등급'은 캐시(profiles.loyalty_grade)가 아니라 지급 직전 재산정 결과다. 캐시는 주문 결제·취소
--   때만 갱신돼, 90일 실적이 빠진 회원도 주문이 없으면 상위 등급으로 남는다. 묶음에서 등급이 WELCOME 보다
--   높게 캐시된 회원을 잠근 뒤 기존 private.recalculate_loyalty_grade 를 그대로 불러(강등 이력·승급 쿠폰·
--   승급 알림은 기존 규칙대로) 그 결과로 판정한다. WELCOME 으로 캐시된 회원은 재산정하지 않는다(지금처럼
--   다음 결제·취소나 수동 재산정 때 오른다 — 정책 저장만으로 일괄 재산정하지 않는 계약 유지).
--
-- ## 멱등과 '놓친 달'
--
-- - (쿠폰, 회원, 월) 하나에 한 장: user_coupons.grade_benefit_month 와 부분 유일 색인이 스키마로 막는다.
-- - 한 달에 실행 하나: private.loyalty_monthly_coupon_runs(grant_month PK)가 지급 대상 쿠폰을 고정하고
--   회원 id 커서로 묶음을 이어 간다. 끝난 달은 다시 돌지 않는다.
-- - 실행은 '지금의 달'만 다룬다. 지난달 실행이 끝나지 못한 채 달이 바뀌면 이어 주지 않고 'month_ended'로
--   닫는다 — 놓친 달은 몰아서 주지 않는다(사용자 결정 지시). 1일에 DB가 멈췄다가 같은 달 안에 돌아오면 그
--   달 몫은 늦게라도 준다(그 달의 첫 실행이 기준).
-- - 그 달 실행이 이미 쿠폰을 고정한 뒤 새로 '매월'로 지정한 정의는 다음 달 1일부터 준다.
--
-- ## user_coupons (코드, 회원) 유일 제약
--
-- '같은 쿠폰은 1인 1장'(20260831090000)은 코드 입력·운영자 발급·승급 지급에 그대로 남긴다: 기존 유일
-- 제약을 'grade_benefit_month is null' 부분 유일 색인으로 옮긴다. 매월 지급분만 (코드, 회원, 월)로
-- 유일하다. 그래서 한 회원이 같은 쿠폰을 여러 장 가질 수 있는 경로는 매월 지급뿐이고, '이미 보유'를
-- 묻는 두 곳(코드 입력·운영자 발급의 보유 판정)은 여러 장 중 사용 가능한 최신 한 장을 결정적으로
-- 고르게 고친다(같은 쿠폰을 또 주지 않는 기존 계약 유지). 매월 정의를 새 코드로 복제하는 안은 쿠폰 목록·
-- 등급 혜택 안내·발급 한도·통계가 모두 쪼개져 택하지 않았다.
--
-- ## 잠금 순서
--
-- 실행 행 → 이번 묶음 회원(profiles FOR UPDATE, id 순 — 재산정이 같은 잠금을 쓴다) → 재산정의 승급 쿠폰
-- (승급일 때만) → 지급할 쿠폰 정의(FOR UPDATE, code 순) → 쓰기. 주문 생성(회원 → 쿠폰 FOR SHARE)·주문 전이
-- 재산정(회원 FOR UPDATE → 승급 쿠폰)과 같은 '회원 → 쿠폰' 방향이다. 코드 입력은 회원 FOR SHARE 를 먼저
-- 잡으므로 묶음 회원이면 그 자리에서 기다리고, 쿠폰을 쥔 채 이 실행의 회원 잠금을 기다리지 않는다. 틱은
-- lock_timeout 5초로 오래 기다리지 않고 다음 분에 다시 시도한다.
--
-- ## 감사
--
-- 지급한 장수가 있는 실행 마감과, 달이 바뀌어 끝난 실행(month_ended)만 audit_log 에 남긴다. 지급 0장 마감
-- (매월 정의 없음 등)은 실행 원장에만 남긴다 — 매월 첫 틱이 audit_log 전역 개수를 흔들지 않게 한다.
--
-- ## 알림
--
-- 등급 혜택 쿠폰 지급은 기존처럼 같은 트랜잭션의 인앱 알림 한 건으로 알린다(승급 알림과 같은 규칙: 이메일·
-- 푸시 없음, dedupe 키, 쿠폰함 링크). 회원·월마다 한 건이며 유형은 loyalty_monthly_coupons_issued 다.
-- ============================================================================

begin;

-- ── 1. 쿠폰 정의: 등급 혜택 지급 방식 ─────────────────────────────────────────

alter table public.coupons
  add column grade_benefit_cadence text not null default 'upgrade'
    constraint coupons_grade_benefit_cadence_check check (grade_benefit_cadence in ('upgrade', 'monthly'));

-- 등급 혜택이 없는 정의의 지급 방식은 의미가 없다 — 'upgrade'로 고정한다.
alter table public.coupons
  add constraint coupons_grade_benefit_cadence_scope
    check (grade_benefit is not null or grade_benefit_cadence = 'upgrade');

comment on column public.coupons.grade_benefit_cadence is
  '등급 혜택 지급 방식. upgrade = 승급 시 1회(기본), monthly = 매월 1일(KST) 그 시점 등급 이상 회원에게 1장. grade_benefit 이 없으면 upgrade.';

-- 등급 혜택을 지우는 기존 쓰기 경로(지정 고객 전환·legacy upsert)는 지급 방식을 모른다. 그 경로들을
-- 고치지 않고 BEFORE 트리거가 'upgrade'로 되돌려 위 CHECK 를 지킨다(조건 버전 트리거보다 먼저 돈다 — 이름순).
create function private.normalize_coupon_grade_cadence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.grade_benefit is null then
    new.grade_benefit_cadence := 'upgrade';
  end if;
  return new;
end;
$$;

revoke all on function private.normalize_coupon_grade_cadence() from public, anon, authenticated, service_role;

create trigger coupons_grade_cadence_scope
before insert or update of grade_benefit, grade_benefit_cadence on public.coupons
for each row execute function private.normalize_coupon_grade_cadence();

-- ── 2. 보유 쿠폰: 매월 지급분의 지급 월 ───────────────────────────────────────

alter table public.user_coupons
  add column grade_benefit_month date
    constraint user_coupons_grade_benefit_month_check check (
      grade_benefit_month is null
      or (issued_source = 'grade_benefit' and extract(day from grade_benefit_month) = 1)
    );

comment on column public.user_coupons.grade_benefit_month is
  '매월 등급 혜택 지급분의 지급 월(KST 1일). 그 밖의 발급(코드 입력·운영자 발급·승급 지급)은 null 이고 (코드, 회원)당 한 장이다.';

alter table public.user_coupons drop constraint user_coupons_coupon_code_user_id_key;

create unique index user_coupons_single_issue_key
  on public.user_coupons (coupon_code, user_id)
  where grade_benefit_month is null;

-- 월 → 쿠폰 순서라 '그 달 지급분' 집계도 이 색인을 쓴다.
create unique index user_coupons_monthly_grade_key
  on public.user_coupons (grade_benefit_month, coupon_code, user_id)
  where grade_benefit_month is not null;

-- ── 3. 알림 유형 ──────────────────────────────────────────────────────────────

-- 목록을 통째로 다시 쓰지 않고 기존 정의에 덧붙인다 — 다른 마이그레이션이 넣은 값을 지우면 알림 발급이
-- 조용히 깨진다(20260831090100 과 같은 방식).
do $$
declare
  v_def text;
  v_values text;
begin
  select pg_get_constraintdef(constraint_row.oid)
  into strict v_def
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.notifications'::regclass
    and constraint_row.conname = 'notifications_type_check';

  select string_agg(distinct quote_literal(matched[1]), ', ')
  into v_values
  from regexp_matches(v_def, '''([a-z_]+)''::text', 'g') as matched;

  if position('''loyalty_monthly_coupons_issued''' in v_values) = 0 then
    v_values := v_values || ', ' || quote_literal('loyalty_monthly_coupons_issued');
  end if;

  execute 'alter table public.notifications drop constraint notifications_type_check';
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type in (%s))',
    v_values
  );
end;
$$;

-- ── 4. 실행 원장 ──────────────────────────────────────────────────────────────

create table private.loyalty_monthly_coupon_runs (
  grant_month date primary key check (extract(day from grant_month) = 1),
  started_at timestamptz not null,
  -- 그 달 첫 실행이 고정한 '매월 지급' 정의. 이후에 지정한 정의는 다음 달부터 준다.
  coupon_codes text[] not null default '{}',
  -- 처리한 마지막 회원 id. 다음 묶음은 이 뒤부터다.
  cursor_user_id uuid,
  member_count integer not null default 0 check (member_count >= 0),
  recipient_count integer not null default 0 check (recipient_count >= 0),
  granted_count integer not null default 0 check (granted_count >= 0),
  notified_count integer not null default 0 check (notified_count >= 0),
  -- 등급 재산정이 실패해 이번 달 지급에서 뺀 회원 수(잠금 대기·교착은 빼지 않고 틱을 다시 돈다).
  skipped_count integer not null default 0 check (skipped_count >= 0),
  batch_count integer not null default 0 check (batch_count >= 0),
  finished_at timestamptz,
  finish_reason text check (finish_reason in ('completed', 'no_monthly_coupons', 'coupons_closed', 'month_ended')),
  check ((finished_at is null) = (finish_reason is null))
);

alter table private.loyalty_monthly_coupon_runs enable row level security;
revoke all on private.loyalty_monthly_coupon_runs from public, anon, authenticated, service_role;

-- ── 5. 판정 ───────────────────────────────────────────────────────────────────

-- 지금 지급할 수 있는 등급 혜택 정의 — 승급 지급(private.grant_grade_benefit_coupons)과 회원 등급 혜택
-- 안내(get_loyalty_grade_benefits)의 거름과 같다. 지급 방식은 호출부가 따로 본다.
create function private.grade_benefit_coupon_grantable(p_coupon public.coupons, p_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_coupon.status = 'active'
    and p_coupon.grade_benefit is not null
    and p_coupon.grade_benefit > 'welcome'::public.loyalty_grade
    and p_coupon.issuance_mode = 'code'
    and (p_coupon.ends_at is null or p_coupon.ends_at > p_at)
    and (p_coupon.issue_starts_at is null or p_coupon.issue_starts_at <= p_at)
    and (p_coupon.issue_starts_at is null or p_coupon.issue_ends_at is null or p_coupon.issue_ends_at > p_at)
    and (p_coupon.issue_limit is null or p_coupon.issued_count < p_coupon.issue_limit);
$$;

revoke all on function private.grade_benefit_coupon_grantable(public.coupons, timestamptz)
  from public, anon, authenticated, service_role;

-- 매월 지급을 받을 수 있는 회원 — 운영자 지정 발급(private.coupon_issue_rows)의 '이용 가능한 고객'과 같다.
-- 탈퇴 진행 차단은 잠금 없이 표만 본다(지급은 차단 대상 쓰기가 아니고, 회원별 advisory lock 수백 개를
-- 한 트랜잭션에 쥐지 않기 위해서다).
create function private.monthly_grade_coupon_recipient(p_profile public.profiles, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile.loyalty_grade > 'welcome'::public.loyalty_grade
    and p_profile.role = 'user'::public.user_role
    and p_profile.suspended_at is null
    and p_profile.onboarded_at is not null
    and p_profile.birth_date is not null
    and p_profile.birth_date <= ((p_at at time zone 'Asia/Seoul')::date - interval '14 years')::date
    and not exists (
      select 1 from private.account_action_fences as fence
      where fence.subject_user_id = p_profile.id
    );
$$;

revoke all on function private.monthly_grade_coupon_recipient(public.profiles, timestamptz)
  from public, anon, authenticated, service_role;

-- ── 6. 실행 ───────────────────────────────────────────────────────────────────

create function private.finish_monthly_grade_coupon_run(p_month date, p_at timestamptz, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_run private.loyalty_monthly_coupon_runs;
begin
  update private.loyalty_monthly_coupon_runs as run
  set finished_at = p_at,
      finish_reason = p_reason
  where run.grant_month = p_month
    and run.finished_at is null
  returning * into v_run;

  if not found then
    return;
  end if;

  -- 지급 0장 마감(매월 정의 없음·대상 없음·쿠폰 중지)은 실행 원장에만 남긴다. 달이 바뀌어 끝난 실행은
  -- 지급 장수와 관계없이 남긴다(이어 주지 않은 회원이 있다는 기록이다).
  if v_run.granted_count = 0 and p_reason <> 'month_ended' then
    return;
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    null,
    'commerce.coupon.grade_monthly_run_finished',
    'loyalty_monthly_coupons:' || to_char(p_month, 'YYYY-MM'),
    jsonb_build_object(
      'grantMonth', to_char(p_month, 'YYYY-MM'),
      'reason', p_reason,
      'startedAt', v_run.started_at,
      'finishedAt', v_run.finished_at,
      'couponCodes', to_jsonb(v_run.coupon_codes),
      'members', v_run.member_count,
      'recipients', v_run.recipient_count,
      'granted', v_run.granted_count,
      'notified', v_run.notified_count,
      'skipped', v_run.skipped_count,
      'batches', v_run.batch_count
    )
  );
end;
$$;

revoke all on function private.finish_monthly_grade_coupon_run(date, timestamptz, text)
  from public, anon, authenticated, service_role;

-- 한 묶음(회원 p_batch 명)을 처리한다. p_now 를 주입받아 날짜 경계를 시험할 수 있다(운영 틱은 현재 시각).
create function private.run_monthly_grade_coupons(p_now timestamptz, p_batch integer default 200)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_month date;
  v_label text;
  v_run private.loyalty_monthly_coupon_runs;
  v_stale date;
  v_member_ids uuid[];
  v_member_grades public.loyalty_grade[] := '{}';
  v_member uuid;
  v_grade public.loyalty_grade;
  v_skipped integer := 0;
  v_scanned integer;
  v_last_member uuid;
  v_live_codes text[];
  v_granted_codes text[] := '{}';
  v_granted_users uuid[] := '{}';
  v_recipients integer := 0;
  v_notified integer := 0;
  v_status text;
begin
  if p_now is null or not isfinite(p_now) or p_batch is null or p_batch not between 1 and 1000 then
    raise invalid_parameter_value using message = 'invalid_monthly_grade_coupon_run';
  end if;

  v_month := date_trunc('month', p_now at time zone 'Asia/Seoul')::date;
  v_label := to_char(v_month, 'YYYY-MM');

  -- 잠금 없는 사전 확인: 그 달 실행이 끝났으면 대부분의 틱은 여기서 끝난다.
  if exists (
    select 1 from private.loyalty_monthly_coupon_runs as run
    where run.grant_month = v_month and run.finished_at is not null
  ) then
    return jsonb_build_object('status', 'already_ran', 'grantMonth', v_label);
  end if;

  -- 끝나지 못한 지난달 실행은 이번 달에 이어 주지 않고 닫는다 — 놓친 몫을 몰아서 주지 않는다.
  for v_stale in
    select run.grant_month
    from private.loyalty_monthly_coupon_runs as run
    where run.grant_month < v_month and run.finished_at is null
    order by run.grant_month
    for update
  loop
    perform private.finish_monthly_grade_coupon_run(v_stale, p_now, 'month_ended');
  end loop;

  -- 그 달 첫 실행이 지급할 정의를 고정한다. 동시 틱은 실행 행 잠금으로 줄을 선다.
  insert into private.loyalty_monthly_coupon_runs (grant_month, started_at, coupon_codes)
  select v_month, p_now, coalesce(array_agg(coupon.code order by coupon.code), '{}'::text[])
  from public.coupons as coupon
  where coupon.grade_benefit_cadence = 'monthly'
    and private.grade_benefit_coupon_grantable(coupon, p_now)
  on conflict (grant_month) do nothing;

  select * into v_run
  from private.loyalty_monthly_coupon_runs as run
  where run.grant_month = v_month
  for update;

  if v_run.finished_at is not null then
    return jsonb_build_object('status', 'already_ran', 'grantMonth', v_label);
  end if;

  if cardinality(v_run.coupon_codes) = 0 then
    perform private.finish_monthly_grade_coupon_run(v_month, p_now, 'no_monthly_coupons');
    return jsonb_build_object('status', 'finished', 'grantMonth', v_label, 'reason', 'no_monthly_coupons', 'granted', 0);
  end if;

  -- 이번 묶음 회원(등급이 WELCOME 보다 높게 캐시된 이용 가능 고객)을 id 순으로 먼저 잠근다(회원 → 쿠폰 순서).
  -- FOR UPDATE: 아래 재산정이 같은 잠금을 쓰고, 코드 입력·주문 경로는 이 회원 잠금에서 먼저 기다린다.
  select coalesce(array_agg(member.id order by member.id), '{}'::uuid[]), count(*)::integer
  into v_member_ids, v_scanned
  from (
    select profile.id
    from public.profiles as profile
    where profile.id > coalesce(v_run.cursor_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and private.monthly_grade_coupon_recipient(profile, p_now)
    order by profile.id
    limit p_batch
    for update of profile
  ) as member;

  if v_scanned = 0 then
    perform private.finish_monthly_grade_coupon_run(v_month, p_now, 'completed');
    return jsonb_build_object('status', 'finished', 'grantMonth', v_label, 'reason', 'completed', 'granted', 0);
  end if;

  v_last_member := v_member_ids[v_scanned];

  -- 고정한 정의가 모두 닫혔으면 재산정 없이 끝낸다(잠그기 전 확인 — 아래에서 잠근 뒤 다시 본다).
  if not exists (
    select 1 from public.coupons as coupon
    where coupon.code = any (v_run.coupon_codes)
      and coupon.grade_benefit_cadence = 'monthly'
      and private.grade_benefit_coupon_grantable(coupon, p_now)
  ) then
    perform private.finish_monthly_grade_coupon_run(v_month, p_now, 'coupons_closed');
    return jsonb_build_object('status', 'finished', 'grantMonth', v_label, 'reason', 'coupons_closed', 'granted', 0);
  end if;

  -- '그 시점 등급'을 확정한다. 캐시(profiles.loyalty_grade)는 결제·취소 때만 갱신돼 90일 실적이 빠져도
  -- 남으므로, 기존 재산정을 그대로 불러(강등 이력·승급 쿠폰·승급 알림 포함) 그 결과로 판정한다.
  -- 잠금 대기·교착·취소는 틱을 실패시켜 다음 분에 다시 돌고, 그 밖의 재산정 실패는 그 회원만 이번 달
  -- 지급에서 뺀다(한 회원 때문에 그 달 실행이 멈추지 않게).
  foreach v_member in array v_member_ids loop
    begin
      v_grade := private.recalculate_loyalty_grade(v_member);
    exception
      when lock_not_available or deadlock_detected or query_canceled then
        raise;
      when others then
        raise warning 'monthly grade coupon recalculation skipped for %: % %', v_member, sqlstate, sqlerrm;
        v_grade := null;
        v_skipped := v_skipped + 1;
    end;
    v_member_grades := v_member_grades || coalesce(v_grade, 'welcome'::public.loyalty_grade);
  end loop;

  -- 고정한 정의 중 지금도 지급할 수 있는 것만 잠근다 — 발급 수·한도를 이 트랜잭션이 확정한다.
  select coalesce(array_agg(locked.code order by locked.code), '{}'::text[])
  into v_live_codes
  from (
    select coupon.code
    from public.coupons as coupon
    where coupon.code = any (v_run.coupon_codes)
      and coupon.grade_benefit_cadence = 'monthly'
      and private.grade_benefit_coupon_grantable(coupon, p_now)
    order by coupon.code
    for update of coupon
  ) as locked;

  if cardinality(v_live_codes) = 0 then
    perform private.finish_monthly_grade_coupon_run(v_month, p_now, 'coupons_closed');
    return jsonb_build_object('status', 'finished', 'grantMonth', v_label, 'reason', 'coupons_closed', 'granted', 0);
  end if;

  -- (쿠폰, 회원, 월) 하나에 한 장. 회원 등급이 쿠폰 등급 이상이면 준다. 발급 한도가 남은 만큼만 회원 id 순으로.
  with candidates as (
    select coupon.code, coupon.issue_limit, coupon.issued_count, member.id as user_id,
      row_number() over (partition by coupon.code order by member.id) as position
    from public.coupons as coupon
    join unnest(v_member_ids, v_member_grades) as member(id, grade) on member.grade >= coupon.grade_benefit
    where coupon.code = any (v_live_codes)
      and private.coupon_recipient_reason(coupon.recipient_segment, member.id) is null
      and not exists (
        select 1 from public.user_coupons as held
        where held.grade_benefit_month = v_month
          and held.coupon_code = coupon.code
          and held.user_id = member.id
      )
  ), inserted as (
    insert into public.user_coupons (coupon_code, user_id, issued_source, issued_at, expires_at, grade_benefit_month)
    select candidate.code, candidate.user_id, 'grade_benefit', p_now, private.coupon_issue_expiry(coupon, p_now), v_month
    from candidates as candidate
    join public.coupons as coupon on coupon.code = candidate.code
    where candidate.issue_limit is null
       or candidate.position <= candidate.issue_limit - candidate.issued_count
    order by candidate.code, candidate.user_id
    on conflict (grade_benefit_month, coupon_code, user_id) where grade_benefit_month is not null do nothing
    returning coupon_code, user_id
  )
  select coalesce(array_agg(inserted.coupon_code order by inserted.coupon_code, inserted.user_id), '{}'::text[]),
         coalesce(array_agg(inserted.user_id order by inserted.coupon_code, inserted.user_id), '{}'::uuid[])
  into v_granted_codes, v_granted_users
  from inserted;

  update public.coupons as coupon
  set issued_count = coupon.issued_count + granted.issued
  from (
    select code, count(*)::integer as issued
    from unnest(v_granted_codes) as code
    group by code
  ) as granted
  where coupon.code = granted.code;

  -- 회원·월마다 알림 한 건. 같은 달에 두 번 쓰지 않는다(dedupe).
  with recipients as (
    select recipient.user_id, count(*)::integer as coupons
    from unnest(v_granted_users) as recipient(user_id)
    group by recipient.user_id
  ), sent as (
    insert into public.notifications (
      user_id, type, title, body, link_path, source_type, source_id, dedupe_key
    )
    select
      recipient.user_id,
      'loyalty_monthly_coupons_issued',
      '이번 달 등급 혜택 쿠폰이 도착했어요',
      format('%s 등급 혜택 쿠폰 %s장을 드렸어요. 쿠폰함에서 확인할 수 있어요.', upper(profile.loyalty_grade::text), recipient.coupons),
      '/my/coupons',
      'loyalty_monthly_coupons',
      v_label,
      'loyalty:monthly-coupons:' || recipient.user_id::text || ':' || v_label
    from recipients as recipient
    join public.profiles as profile on profile.id = recipient.user_id
    on conflict (user_id, dedupe_key) do nothing
    returning 1
  )
  select (select count(*)::integer from recipients), (select count(*)::integer from sent)
  into v_recipients, v_notified;

  update private.loyalty_monthly_coupon_runs as run
  set cursor_user_id = v_last_member,
      member_count = run.member_count + v_scanned,
      recipient_count = run.recipient_count + v_recipients,
      granted_count = run.granted_count + cardinality(v_granted_codes),
      notified_count = run.notified_count + v_notified,
      skipped_count = run.skipped_count + v_skipped,
      batch_count = run.batch_count + 1
  where run.grant_month = v_month;

  -- 묶음이 덜 찼다고 끝으로 보지 않는다(잠금 중 조건이 바뀐 행은 LIMIT 위에서 빠진다). 커서 뒤에 대상
  -- 회원이 남았는지로 판정한다.
  if exists (
    select 1 from public.profiles as profile
    where profile.id > v_last_member
      and private.monthly_grade_coupon_recipient(profile, p_now)
  ) then
    v_status := 'continuing';
  else
    perform private.finish_monthly_grade_coupon_run(v_month, p_now, 'completed');
    v_status := 'finished';
  end if;

  return jsonb_build_object(
    'status', v_status,
    'grantMonth', v_label,
    'members', v_scanned,
    'granted', cardinality(v_granted_codes),
    'recipients', v_recipients,
    'notified', v_notified,
    'skipped', v_skipped
  );
end;
$$;

revoke all on function private.run_monthly_grade_coupons(timestamptz, integer)
  from public, anon, authenticated, service_role;

-- 매분 틱. 잠금을 5초 넘게 기다리지 않고 다음 분에 다시 시도한다.
create function private.tick_monthly_grade_coupons()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  return private.run_monthly_grade_coupons(clock_timestamp(), 200);
end;
$$;

revoke all on function private.tick_monthly_grade_coupons()
  from public, anon, authenticated, service_role;

-- 매분. cron.schedule은 이름 기준 upsert라 재적용에도 안전하다.
select cron.schedule('monthly-grade-coupons', '* * * * *', 'select private.tick_monthly_grade_coupons()');

-- 고객등급 관리 화면의 '매월 지급 기록'. 쿠폰별 지급 수는 보유 쿠폰 원장에서 센다(진실원 하나).
create function private.loyalty_monthly_coupon_run_summaries(p_limit integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'grantMonth', to_char(run.grant_month, 'YYYY-MM'),
      'startedAt', run.started_at,
      'finishedAt', run.finished_at,
      'finishReason', run.finish_reason,
      'members', run.member_count,
      'recipients', run.recipient_count,
      'granted', run.granted_count,
      'skipped', run.skipped_count,
      'coupons', coalesce((
        select jsonb_agg(jsonb_build_object('code', issued.coupon_code, 'name', coalesce(coupon.name, issued.coupon_code), 'granted', issued.granted)
          order by issued.coupon_code)
        from (
          select held.coupon_code, count(*)::integer as granted
          from public.user_coupons as held
          where held.grade_benefit_month = run.grant_month
          group by held.coupon_code
        ) as issued
        left join public.coupons as coupon on coupon.code = issued.coupon_code
      ), '[]'::jsonb)
    ) order by run.grant_month desc), '[]'::jsonb)
  from (
    select * from private.loyalty_monthly_coupon_runs
    order by grant_month desc
    limit greatest(1, least(coalesce(p_limit, 6), 24))
  ) as run;
$$;

revoke all on function private.loyalty_monthly_coupon_run_summaries(integer)
  from public, anon, authenticated, service_role;

-- ── 7. 기존 함수 최소 변경 ────────────────────────────────────────────────────

-- 다른 변경이 같은 함수를 고쳐도 본문을 덮어쓰지 않도록 앵커 치환만 한다. 앵커가 예상 횟수와 다르면
-- 이 migration이 실패한다(조용히 빠지지 않는다).
do $patch$
declare
  v_source text;
  v_procedure regprocedure;
  v_old text;
  v_new text;
  v_expected integer;
  v_found integer;
  v_patch jsonb;
  v_patches jsonb := jsonb_build_array(
    -- 승급 지급은 '승급 시 1회' 정의만 준다.
    jsonb_build_array('private.grant_grade_benefit_coupons(uuid,public.loyalty_grade,public.loyalty_grade)',
      $o$and coupon.grade_benefit is not null$o$,
      $n$and coupon.grade_benefit is not null
      and coupon.grade_benefit_cadence = 'upgrade'$n$, 1),
    -- 지급 방식 변경도 조건 버전을 올린다(다른 탭의 오래된 저장이 되돌리지 못하게).
    jsonb_build_array('private.touch_coupon_terms_revision()',
      $o$new.target_ip_ids)$o$, $n$new.target_ip_ids,new.grade_benefit_cadence)$n$, 1),
    jsonb_build_array('private.touch_coupon_terms_revision()',
      $o$old.target_ip_ids)$o$, $n$old.target_ip_ids,old.grade_benefit_cadence)$n$, 1),
    -- 보유 판정: 매월 지급으로 여러 장일 수 있어 사용 가능한 최신 한 장을 결정적으로 고른다.
    jsonb_build_array('private.issue_coupon_code(text,uuid,text)',
      $o$select id into held_id from public.user_coupons where user_id=p_user_id and coupon_code=coupon.code;$o$,
      $n$select id into held_id from public.user_coupons where user_id=p_user_id and coupon_code=coupon.code
    order by (status='active') desc,issued_at desc,id limit 1;$n$, 1),
    jsonb_build_array('private.coupon_issue_rows(public.coupons,uuid[])',
      $o$(select id from public.user_coupons where coupon_code=p_coupon.code and user_id=ids.id)$o$,
      $n$(select id from public.user_coupons where coupon_code=p_coupon.code and user_id=ids.id order by (status='active') desc,issued_at desc,id limit 1)$n$, 1),
    -- 쿠폰 저장: target_grade_benefit_cadence 를 받는다(없으면 기존 값 유지, 등급 혜택이 없으면 upgrade).
    jsonb_build_array('public.admin_upsert_coupon_scheduled(jsonb)',
      $o$benefit text; combined boolean;$o$, $n$benefit text; combined boolean; cadence text;$n$, 1),
    jsonb_build_array('public.admin_upsert_coupon_scheduled(jsonb)',
      $o$combined:=coalesce((target_payload->>'target_stackable')::boolean,previous.stackable,false);$o$,
      $n$combined:=coalesce((target_payload->>'target_stackable')::boolean,previous.stackable,false);
  if target_payload ? 'target_grade_benefit_cadence' and (jsonb_typeof(target_payload->'target_grade_benefit_cadence') is distinct from 'string'
    or target_payload->>'target_grade_benefit_cadence' not in ('upgrade','monthly')) then raise invalid_parameter_value using message='invalid_coupon_grade_cadence';end if;
  cadence:=case when nullif(btrim(coalesce(target_payload->>'target_grade_benefit','')),'') is null then 'upgrade'
    else coalesce(target_payload->>'target_grade_benefit_cadence',previous.grade_benefit_cadence,'upgrade') end;$n$, 1),
    jsonb_build_array('public.admin_upsert_coupon_scheduled(jsonb)',
      $o$'target_benefit_kind','target_stackable']$o$, $n$'target_benefit_kind','target_stackable','target_grade_benefit_cadence']$n$, 1),
    jsonb_build_array('public.admin_upsert_coupon_scheduled(jsonb)',
      $o$valid_days=days where code=normalized_code returning * into saved;$o$,
      $n$valid_days=days,grade_benefit_cadence=cadence where code=normalized_code returning * into saved;$n$, 1),
    jsonb_build_array('public.admin_upsert_coupon_scheduled(jsonb)',
      $o$'stackable',previous.stackable) end$o$, $n$'stackable',previous.stackable,'gradeBenefitCadence',previous.grade_benefit_cadence) end$n$, 1),
    jsonb_build_array('public.admin_upsert_coupon_scheduled(jsonb)',
      $o$'stackable',saved.stackable)$o$, $n$'stackable',saved.stackable,'gradeBenefitCadence',saved.grade_benefit_cadence)$n$, 1),
    -- 고객등급 관리: 연결 쿠폰의 지급 방식과 최근 매월 지급 기록.
    jsonb_build_array('public.admin_get_loyalty_policy()',
      $o$'grade',grade_benefit,'status',status)$o$, $n$'grade',grade_benefit,'status',status,'cadence',grade_benefit_cadence)$n$, 1),
    jsonb_build_array('public.admin_get_loyalty_policy()',
      $o$from public.coupons where grade_benefit in ('silver','gold','platinum')),'[]'::jsonb));$o$,
      $n$from public.coupons where grade_benefit in ('silver','gold','platinum')),'[]'::jsonb),
    'monthlyRuns',private.loyalty_monthly_coupon_run_summaries(6));$n$, 1),
    -- 회원 등급 혜택 안내: 쿠폰마다 지급 방식, 오르지 않은 등급은 매월 지급 장수.
    jsonb_build_array('public.get_loyalty_grade_benefits()',
      $o$'validDays', coupon.valid_days$o$, $n$'validDays', coupon.valid_days,
              'cadence', coupon.grade_benefit_cadence$n$, 1),
    jsonb_build_array('public.get_loyalty_grade_benefits()',
      $o$'shipping', (select count(*) from grantable as coupon where coupon.grade_benefit = grades.grade and coupon.benefit_kind = 'shipping')$o$,
      $n$'shipping', (select count(*) from grantable as coupon where coupon.grade_benefit = grades.grade and coupon.benefit_kind = 'shipping'),
          'monthly', (select count(*) from grantable as coupon where coupon.grade_benefit = grades.grade and coupon.grade_benefit_cadence = 'monthly')$n$, 1)
  );
begin
  -- pg_get_functiondef 는 현재 search_path 기준으로 형 이름을 줄여 쓴다 — 같은 세션에서 다시 실행한다.
  for v_patch in select value from jsonb_array_elements(v_patches) loop
    v_procedure := to_regprocedure(v_patch->>0);
    if v_procedure is null then
      raise exception 'monthly grade coupon dependency missing: %', v_patch->>0;
    end if;
    v_old := v_patch->>1;
    v_new := v_patch->>2;
    v_expected := (v_patch->>3)::integer;
    select pg_get_functiondef(v_procedure) into v_source;
    v_found := (length(v_source) - length(replace(v_source, v_old, ''))) / length(v_old);
    if v_found <> v_expected then
      raise exception 'monthly grade coupon dependency changed: % (% of % matches for %)', v_patch->>0, v_found, v_expected, v_old;
    end if;
    execute replace(v_source, v_old, v_new);
  end loop;
end;
$patch$;

-- ── 8. 운영자 계약 지문 재등록(ACL·본문 확정 뒤) ────────────────────────────────

select private.register_operator_rpc_contract('public.admin_upsert_coupon_scheduled(jsonb)'::regprocedure, 'marketing.manage', 'write', false);
select private.register_operator_rpc_contract('public.admin_get_loyalty_policy()'::regprocedure, 'marketing.manage', 'read', true);
select private.register_operator_internal_contract('private.touch_coupon_terms_revision()'::regprocedure);
select private.register_operator_internal_contract('private.issue_coupon_code(text,uuid,text)'::regprocedure);

notify pgrst, 'reload schema';

commit;
