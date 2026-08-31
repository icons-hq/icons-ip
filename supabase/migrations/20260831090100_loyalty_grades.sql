-- S7 회원 등급 (ADR-0011 B2): 구매 실적 파생 등급과 등급 혜택 쿠폰 발급.
--
-- 등급은 무료이고 결제에 개입하지 않는다 — 혜택은 쿠폰 발급으로만 표현된다.
-- 유료 멤버십(v2)과 별개 개념이며, CONTEXT.md 규율대로 VIP·티어 어휘를 쓰지
-- 않는다(최상위 등급명은 PLATINUM).
--
-- 산정 기준(어드민 안내와 같은 값이어야 한다 — lib/loyalty.ts 계약 테스트가 지킨다):
--   창: 최근 90일 / 실적: 취소되지 않은 결제 확정(paid 이후 상태) 주문의 총
--   결제액 합(total = 할인·배송비 반영 청구액) /
--   임계: SILVER 100,000 · GOLD 300,000 · PLATINUM 1,000,000.

create type public.loyalty_grade as enum ('welcome', 'silver', 'gold', 'platinum');

alter table public.profiles
  add column loyalty_grade public.loyalty_grade not null default 'welcome';

-- profiles 의 select 는 20260717100001 이 컬럼 화이트리스트로 재구성했다 —
-- 새 컬럼은 명시 grant 가 없으면 본인 프로필 조회까지 조용히 깨진다.
grant select (loyalty_grade) on table public.profiles to authenticated;

-- 등급 혜택: 이 등급에 도달하면 자동 발급되는 쿠폰 표시.
alter table public.coupons
  add column grade_benefit public.loyalty_grade;

-- 산정·보정 이력. 등급 분쟁 시 "언제, 왜, 누가"에 답하는 감사 원장이다.
create table public.loyalty_grade_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  previous_grade public.loyalty_grade not null,
  next_grade public.loyalty_grade not null,
  reason text not null
    check (reason in ('recalculation', 'manual_adjustment')),
  basis jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles (id),
  note text
    check (note is null or (note = btrim(note) and length(note) between 1 and 200)),
  created_at timestamptz not null default now(),
  check ((reason = 'manual_adjustment') = (actor_id is not null))
);

create index loyalty_grade_events_user_id_idx
  on public.loyalty_grade_events (user_id, created_at desc);

alter table public.loyalty_grade_events enable row level security;

create policy loyalty_grade_events_select_own_or_staff on public.loyalty_grade_events
  for select using (
    user_id = (select auth.uid()) or public.is_staff()
  );

revoke all on table public.loyalty_grade_events from public, anon, authenticated, service_role;
grant select on table public.loyalty_grade_events to authenticated;

-- 등급 승급 알림 type 등록. 목록을 통째로 다시 쓰지 않고 기존 정의에 덧붙인다 —
-- 다른 마이그레이션이 넣은 값을 지우면 알림 발급이 조용히 깨진다.
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

  if position('''loyalty_grade_upgraded''' in v_values) = 0 then
    v_values := v_values || ', ' || quote_literal('loyalty_grade_upgraded');
  end if;

  execute 'alter table public.notifications drop constraint notifications_type_check';
  execute format(
    'alter table public.notifications add constraint notifications_type_check check (type in (%s))',
    v_values
  );
end;
$$;

-- ── 산정 ────────────────────────────────────────────────────────────────────

create function private.loyalty_grade_for_spend(p_spend bigint)
returns public.loyalty_grade
language sql
immutable
set search_path = ''
as $$
  select case
    when p_spend >= 1000000 then 'platinum'::public.loyalty_grade
    when p_spend >= 300000 then 'gold'::public.loyalty_grade
    when p_spend >= 100000 then 'silver'::public.loyalty_grade
    else 'welcome'::public.loyalty_grade
  end;
$$;

-- 승급으로 통과한 모든 등급의 혜택 쿠폰을 발급한다(점프 승급도 중간 혜택을
-- 받는다). 한도 소진·중복 보유는 조용히 건너뛴다 — 혜택이 승급을 막지 않는다.
create function private.grant_grade_benefit_coupons(
  p_user_id uuid,
  p_from_grade public.loyalty_grade,
  p_to_grade public.loyalty_grade
)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select coupon.code, coupon.ends_at, coupon.issue_limit, coupon.issued_count
    from public.coupons as coupon
    where coupon.status = 'active'
      and coupon.grade_benefit is not null
      and coupon.grade_benefit > p_from_grade
      and coupon.grade_benefit <= p_to_grade
    order by coupon.code
    for update
  loop
    if r.issue_limit is not null and r.issued_count >= r.issue_limit then
      continue;
    end if;

    if exists (
      select 1 from public.user_coupons as held
      where held.coupon_code = r.code and held.user_id = p_user_id
    ) then
      continue;
    end if;

    update public.coupons
    set issued_count = issued_count + 1
    where code = r.code;

    insert into public.user_coupons (coupon_code, user_id, issued_source, expires_at)
    values (r.code, p_user_id, 'grade_benefit', r.ends_at);
  end loop;
end;
$$;

-- 실적을 다시 계산해 등급을 맞춘다. 승급이면 혜택·알림까지, 강등이면 이력만
-- 남기고 조용히 내린다(이미 발급된 혜택은 회수하지 않는다). 멱등 — 같은 실적
-- 재실행은 아무것도 바꾸지 않는다.
create function private.recalculate_loyalty_grade(p_user_id uuid)
returns public.loyalty_grade
language plpgsql
volatile
set search_path = ''
as $$
declare
  c_window constant interval := interval '90 days';
  v_current public.loyalty_grade;
  v_spend bigint;
  v_next public.loyalty_grade;
begin
  -- 같은 유저의 동시 재산정(두 주문이 동시에 paid)을 직렬화한다.
  select profile.loyalty_grade
  into v_current
  from public.profiles as profile
  where profile.id = p_user_id
  for update;

  if not found then
    return null;
  end if;

  -- 실적 = 창 안에서 결제 확정(paid 이후 상태) 상태로 남아 있는 주문의 총
  -- 청구액. 취소는 상태가 canceled로 빠지며 자동 차감된다.
  select coalesce(sum(order_row.total), 0)
  into v_spend
  from public.orders as order_row
  where order_row.user_id = p_user_id
    and order_row.status in ('paid', 'confirmed', 'shipping', 'delivered', 'done')
    and order_row.created_at >= now() - c_window;

  v_next := private.loyalty_grade_for_spend(v_spend);

  if v_next = v_current then
    return v_current;
  end if;

  update public.profiles
  set loyalty_grade = v_next
  where id = p_user_id;

  insert into public.loyalty_grade_events (user_id, previous_grade, next_grade, reason, basis)
  values (
    p_user_id, v_current, v_next, 'recalculation',
    jsonb_build_object('spend', v_spend, 'windowDays', 90)
  );

  if v_next > v_current then
    perform private.grant_grade_benefit_coupons(p_user_id, v_current, v_next);

    -- 강등 후 재승급도 알림 가치가 있다 — 같은 dedupe 키는 재부상시킨다.
    insert into public.notifications (
      user_id, type, title, body, link_path, source_type, source_id, dedupe_key
    )
    values (
      p_user_id,
      'loyalty_grade_upgraded',
      '회원 등급이 올랐어요',
      format('%s 등급이 되었어요. 등급 혜택 쿠폰은 쿠폰함에서 확인할 수 있어요.', upper(v_next::text)),
      '/my/coupons',
      'profile',
      p_user_id::text,
      'loyalty:upgrade:' || p_user_id::text || ':' || v_next::text
    )
    on conflict (user_id, dedupe_key) do update set
      read_at = null,
      created_at = now();
  end if;

  return v_next;
end;
$$;

revoke all on function private.loyalty_grade_for_spend(bigint)
  from public, anon, authenticated, service_role;
revoke all on function private.grant_grade_benefit_coupons(uuid, public.loyalty_grade, public.loyalty_grade)
  from public, anon, authenticated, service_role;
revoke all on function private.recalculate_loyalty_grade(uuid)
  from public, anon, authenticated, service_role;

-- ── 주문 상태 전이 연동 ─────────────────────────────────────────────────────

-- 결제 확정(paid)과 취소(canceled) 전이가 실적을 바꾼다. 재산정 실패는 삼킨다 —
-- 등급은 결제에 개입하지 않는다는 원칙의 방어 코드다. 놓친 승급은
-- admin_recalculate_loyalty_grade가 따라잡는다.
create function private.recalculate_loyalty_on_order_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  begin
    perform private.recalculate_loyalty_grade(new.user_id);
  exception
    when others then
      raise warning 'loyalty recalculation skipped for order %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function private.recalculate_loyalty_on_order_transition()
  from public, anon, authenticated, service_role;

create trigger orders_recalculate_loyalty
after update of status on public.orders
for each row
when (new.status in ('paid', 'canceled') and old.status is distinct from new.status)
execute function private.recalculate_loyalty_on_order_transition();

-- ── 어드민: 수동 보정·재산정 ────────────────────────────────────────────────

-- 오프라인 실적·분쟁 대응용 수동 보정. 산정과 같은 혜택 경로를 지나고,
-- 이벤트와 audit_log 양쪽에 근거를 남긴다.
create function public.admin_adjust_loyalty_grade(
  p_user_id uuid,
  p_grade public.loyalty_grade,
  p_note text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  v_current public.loyalty_grade;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_note is null then
    raise check_violation using message = 'note_required';
  end if;

  select profile.loyalty_grade
  into v_current
  from public.profiles as profile
  where profile.id = p_user_id
  for update;

  if not found then
    raise exception 'member_missing' using errcode = 'P0002';
  end if;

  if v_current is distinct from p_grade then
    update public.profiles
    set loyalty_grade = p_grade
    where id = p_user_id;

    insert into public.loyalty_grade_events (
      user_id, previous_grade, next_grade, reason, actor_id, note
    )
    values (p_user_id, v_current, p_grade, 'manual_adjustment', actor_id, v_note);

    -- 수동 승급도 자동 산정과 같은 대우다(US7) — 혜택 쿠폰과 승급 알림을 함께 준다.
    if p_grade > v_current then
      perform private.grant_grade_benefit_coupons(p_user_id, v_current, p_grade);

      insert into public.notifications (
        user_id, type, title, body, link_path, source_type, source_id, dedupe_key
      )
      values (
        p_user_id,
        'loyalty_grade_upgraded',
        '회원 등급이 올랐어요',
        format('%s 등급이 되었어요. 등급 혜택 쿠폰은 쿠폰함에서 확인할 수 있어요.', upper(p_grade::text)),
        '/my/coupons',
        'profile',
        p_user_id::text,
        'loyalty:upgrade:' || p_user_id::text || ':' || p_grade::text
      )
      on conflict (user_id, dedupe_key) do update set
        read_at = null,
        created_at = now();
    end if;
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'loyalty.grade.adjust',
    'profiles:' || p_user_id::text,
    jsonb_build_object('from', v_current, 'to', p_grade, 'note', v_note)
  );
end;
$$;

-- 트리거가 삼킨 실패를 사람 손으로 따라잡는 복구 경로(분쟁 대응 포함).
create function public.admin_recalculate_loyalty_grade(p_user_id uuid)
returns public.loyalty_grade
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return private.recalculate_loyalty_grade(p_user_id);
end;
$$;

revoke all on function public.admin_adjust_loyalty_grade(uuid, public.loyalty_grade, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_adjust_loyalty_grade(uuid, public.loyalty_grade, text)
  to authenticated;
revoke all on function public.admin_recalculate_loyalty_grade(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_recalculate_loyalty_grade(uuid)
  to authenticated;

-- ── 어드민 upsert 에 등급 혜택 연결 ─────────────────────────────────────────

-- 등급 혜택 쿠폰(승급 시 자동 발급)을 코드 배포 없이 운영하려면 upsert 가
-- grade_benefit 을 받아야 한다. 인자 목록이 달라지므로 옛 시그니처를 지우고
-- 다시 만든다 — create or replace 는 오버로드를 하나 더 만들 뿐이다.
drop function public.admin_upsert_coupon(
  text, text, text, integer, integer, integer, timestamptz, timestamptz, integer, text, text
);

create function public.admin_upsert_coupon(
  target_code text,
  target_name text,
  target_discount_type text,
  target_discount_value integer,
  target_max_discount_amount integer,
  target_min_subtotal integer,
  target_starts_at timestamptz,
  target_ends_at timestamptz,
  target_issue_limit integer,
  target_status text,
  target_grade_benefit public.loyalty_grade,
  target_previous_code text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_code text := upper(btrim(coalesce(target_code, '')));
  normalized_previous_code text := nullif(upper(btrim(coalesce(target_previous_code, ''))), '');
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if normalized_previous_code is not null
     and normalized_previous_code is distinct from normalized_code then
    raise exception 'catalog_id_immutable' using errcode = '22023';
  end if;

  if normalized_previous_code is not null then
    perform coupon.code
    from public.coupons as coupon
    where coupon.code = normalized_previous_code
    for update;

    if not found then
      raise exception 'catalog_record_missing' using errcode = 'P0002';
    end if;
  end if;

  -- 발급 한도를 이미 발급된 수 아래로 줄이면 issued_count 검사가 영구 소진
  -- 상태가 될 뿐 원장은 깨지지 않는다 — 운영 실수로 두고 스키마는 막지 않는다.
  insert into public.coupons (
    code, name, discount_type, discount_value, max_discount_amount,
    min_subtotal, starts_at, ends_at, issue_limit, status, grade_benefit
  )
  values (
    normalized_code,
    btrim(coalesce(target_name, '')),
    target_discount_type,
    target_discount_value,
    target_max_discount_amount,
    coalesce(target_min_subtotal, 0),
    coalesce(target_starts_at, now()),
    target_ends_at,
    target_issue_limit,
    coalesce(target_status, 'active'),
    target_grade_benefit
  )
  on conflict (code) do update set
    name = excluded.name,
    discount_type = excluded.discount_type,
    discount_value = excluded.discount_value,
    max_discount_amount = excluded.max_discount_amount,
    min_subtotal = excluded.min_subtotal,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    issue_limit = excluded.issue_limit,
    status = excluded.status,
    grade_benefit = excluded.grade_benefit
  where normalized_previous_code is not null;

  if not found then
    raise exception 'catalog_id_taken' using errcode = '23505';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    actor_id,
    'commerce.coupon.upsert',
    'coupons:' || normalized_code,
    jsonb_build_object(
      'mode', case when normalized_previous_code is null then 'create' else 'update' end,
      'after', jsonb_build_object(
        'name', btrim(coalesce(target_name, '')),
        'discountType', target_discount_type,
        'discountValue', target_discount_value,
        'maxDiscountAmount', target_max_discount_amount,
        'minSubtotal', coalesce(target_min_subtotal, 0),
        'startsAt', coalesce(target_starts_at, now()),
        'endsAt', target_ends_at,
        'issueLimit', target_issue_limit,
        'status', coalesce(target_status, 'active'),
        'gradeBenefit', target_grade_benefit
      )
    )
  );
end;
$$;

revoke all on function public.admin_upsert_coupon(
  text, text, text, integer, integer, integer, timestamptz, timestamptz, integer, text,
  public.loyalty_grade, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_coupon(
  text, text, text, integer, integer, integer, timestamptz, timestamptz, integer, text,
  public.loyalty_grade, text
) to authenticated;
