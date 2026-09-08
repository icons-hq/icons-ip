-- 현업 요청 슬라이스 4 — 쿠폰 조회 · 고객 타겟팅
--
-- 설계: 「어드민 현업 요청 설계안 v1」 §2-4.

-- ---------------------------------------------------------------------------
-- 1. 타겟 조건
-- ---------------------------------------------------------------------------
-- 「누가 받을 수 있는가」다. 받은 뒤 쓸 수 있는지(최소 금액·기간)는 기존 규칙이 본다.
alter table public.coupons
  add column if not exists target_kind text not null default 'all',
  -- `bought_good` 일 때만 쓰인다.
  add column if not exists target_good_id text references public.goods (id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'coupons_target_kind_check') then
    alter table public.coupons add constraint coupons_target_kind_check
      check (target_kind in ('all', 'first_purchase', 'repeat_purchase', 'bought_good'));
  end if;

  -- 「이 상품을 산 사람」인데 상품이 없으면 아무도 못 받는 쿠폰이 된다 — 저장 때 막는다.
  if not exists (select 1 from pg_constraint where conname = 'coupons_target_good_check') then
    alter table public.coupons add constraint coupons_target_good_check check (
      (target_kind = 'bought_good' and target_good_id is not null)
      or (target_kind <> 'bought_good' and target_good_id is null)
    );
  end if;
end;
$$;

comment on column public.coupons.target_kind is
  '받을 수 있는 사람. 판정은 **발급 시점에 한 번** — 발급된 쿠폰은 조건이 바뀌어도 살아 있다.';

-- ---------------------------------------------------------------------------
-- 2. 발급 자격
-- ---------------------------------------------------------------------------
/**
 * 이 사람이 이 쿠폰을 받을 수 있는지. 못 받으면 사유를, 받을 수 있으면 null 을 돌려준다.
 *
 * **판정은 발급 시점에 한 번이다.** 손에 든 쿠폰을 쓸 때마다 다시 보면, 첫 구매 쿠폰을
 * 받아 둔 사람이 그 쿠폰으로 첫 구매를 하는 순간 자격을 잃는다 — 약속을 깨는 것이다.
 *
 * 「구매」는 **결제까지 간 주문**으로 센다(취소·미결제 제외). 장바구니에 담아 둔 것으로
 * 재구매 쿠폰을 열어 주면 아무나 받는다.
 */
create or replace function public.coupon_issue_block_reason(p_code text, p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_good text;
  v_paid bigint;
begin
  select coupon.target_kind, coupon.target_good_id
  into v_kind, v_good
  from public.coupons as coupon
  where coupon.code = p_code;

  if not found then return 'coupon_not_found'; end if;
  if v_kind = 'all' then return null; end if;
  if p_user_id is null then return 'coupon_target_mismatch'; end if;

  if v_kind = 'bought_good' then
    if exists (
      select 1
      from public.order_items as item
      join public.orders as ord on ord.id = item.order_id
      where ord.user_id = p_user_id
        and item.good_id = v_good
        and ord.status in ('paid', 'confirmed', 'shipping', 'delivered', 'done')
    ) then
      return null;
    end if;
    return 'coupon_target_mismatch';
  end if;

  select count(*) into v_paid
  from public.orders as ord
  where ord.user_id = p_user_id
    and ord.status in ('paid', 'confirmed', 'shipping', 'delivered', 'done');

  if v_kind = 'first_purchase' and v_paid > 0 then return 'coupon_target_mismatch'; end if;
  if v_kind = 'repeat_purchase' and v_paid = 0 then return 'coupon_target_mismatch'; end if;
  return null;
end;
$$;

revoke all on function public.coupon_issue_block_reason(text, uuid) from public, anon;
grant execute on function public.coupon_issue_block_reason(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. 어드민 조회
-- ---------------------------------------------------------------------------
/**
 * 쿠폰 조회. 코드·이름·상태·기간으로 좁힌다.
 *
 * 목록에 발급·사용 수를 함께 싣는다 — 「이 쿠폰이 돌긴 하나」를 보려고 화면을 옮기게 하지 않는다.
 */
create or replace function public.admin_search_coupons(
  p_query text default null,
  p_status text default null,
  p_target_kind text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  code text,
  name text,
  discount_type text,
  discount_value integer,
  max_discount_amount integer,
  min_subtotal integer,
  starts_at timestamptz,
  ends_at timestamptz,
  issue_limit integer,
  issued_count integer,
  used_count bigint,
  status text,
  grade_benefit public.loyalty_grade,
  target_kind text,
  target_good_id text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform private.require_staff_actor();

  return query
  select
    coupon.code, coupon.name, coupon.discount_type, coupon.discount_value,
    coupon.max_discount_amount, coupon.min_subtotal, coupon.starts_at, coupon.ends_at,
    coupon.issue_limit, coupon.issued_count,
    (select count(*) from public.user_coupons as held
     where held.coupon_code = coupon.code and held.used_at is not null) as used_count,
    coupon.status, coupon.grade_benefit, coupon.target_kind, coupon.target_good_id,
    count(*) over () as total_count
  from public.coupons as coupon
  where (v_query is null
         or coupon.code ilike '%' || v_query || '%'
         or coupon.name ilike '%' || v_query || '%')
    and (p_status is null or coupon.status = p_status)
    and (p_target_kind is null or coupon.target_kind = p_target_kind)
    -- 기간은 **겹치는** 쿠폰을 찾는다. 「이 기간에 시작한 것」만 보면 이미 돌고 있는
    -- 쿠폰이 빠지고, 그게 중복 발행을 못 보는 이유가 된다(팝업 편성 달력과 같은 규율).
    and (p_from is null or coupon.ends_at is null or coupon.ends_at > p_from)
    and (p_to is null or coupon.starts_at < p_to)
  order by coupon.status, coupon.starts_at desc, coupon.code
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.admin_search_coupons(text, text, text, timestamptz, timestamptz, integer, integer) from public, anon, service_role;
grant execute on function public.admin_search_coupons(text, text, text, timestamptz, timestamptz, integer, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. 발급 경로에 자격을 건다
-- ---------------------------------------------------------------------------
-- 라이브 정의를 그대로 두고 **한 곳만** 바꿨다: 새로 발급할 때 자격을 본다.
-- 손으로 다시 쓰면 나머지에서 조용한 차이가 난다.
CREATE OR REPLACE FUNCTION public.apply_cart_coupon_code(p_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := (select auth.uid());
  v_code text;
  v_coupon record;
  v_user_coupon_id uuid;
  v_subtotal bigint;
  v_eval record;
begin
  if v_user is null then
    raise insufficient_privilege using message = 'auth required';
  end if;

  v_code := upper(btrim(coalesce(p_code, '')));
  if v_code = '' then
    raise check_violation using message = 'coupon_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));

  -- 발급 한도 경합은 쿠폰 행 잠금으로 직렬화한다.
  select coupon.code, coupon.status, coupon.starts_at, coupon.ends_at,
         coupon.issue_limit, coupon.issued_count
  into v_coupon
  from public.coupons as coupon
  where coupon.code = v_code
  for update;

  -- 없는 코드와 보관된 코드는 같은 사유로 답한다 — 코드 존재를 노출하지 않는다.
  if not found or v_coupon.status <> 'active' then
    raise check_violation using message = 'coupon_not_found';
  end if;

  if now() < v_coupon.starts_at then
    raise check_violation using message = 'coupon_not_started';
  end if;

  if v_coupon.ends_at is not null and now() > v_coupon.ends_at then
    raise check_violation using message = 'coupon_expired';
  end if;

  select held.id into v_user_coupon_id
  from public.user_coupons as held
  where held.coupon_code = v_code and held.user_id = v_user;

  if v_user_coupon_id is null then
    /*
     * 타겟 조건은 **발급 시점에 한 번**만 본다(현업 슬라이스 4). 이미 받아 둔 쿠폰은
     * 여기 오지 않는다 — 첫 구매 쿠폰을 받아 둔 사람이 그 쿠폰으로 첫 구매를 하는 순간
     * 자격을 잃으면 약속을 깨는 것이다.
     */
    if public.coupon_issue_block_reason(v_code, v_user) is not null then
      raise check_violation using message = 'coupon_target_mismatch';
    end if;

    if v_coupon.issue_limit is not null and v_coupon.issued_count >= v_coupon.issue_limit then
      raise check_violation using message = 'coupon_exhausted';
    end if;

    update public.coupons
    set issued_count = issued_count + 1
    where code = v_code;

    insert into public.user_coupons (coupon_code, user_id, issued_source, expires_at)
    values (v_code, v_user, 'code_entry', v_coupon.ends_at)
    returning id into v_user_coupon_id;
  end if;

  -- 최소 주문 금액 미달은 발급·선택을 막지 않는다 — 더 담으면 살아나는 선택이고,
  -- 확정 거부는 place_order 가 한다(카트가 미달 경고를 그린다). 그 밖의 사유
  -- (만료·사용됨 등)는 쓸 수 없는 선택이므로 여기서 거부한다.
  v_subtotal := private.cart_subtotal(v_user);
  select * into v_eval from private.evaluate_user_coupon(v_user_coupon_id, v_user, v_subtotal);
  if v_eval.o_reason is not null and v_eval.o_reason <> 'coupon_min_subtotal' then
    raise check_violation using message = v_eval.o_reason;
  end if;

  insert into public.cart_coupon_selections (user_id, user_coupon_id)
  values (v_user, v_user_coupon_id)
  on conflict (user_id) do update set
    user_coupon_id = excluded.user_coupon_id,
    created_at = now();

  return v_user_coupon_id;
end;
$function$;

-- 어드민 저장에 타겟 두 칸을 더한다(기본값이 있어 기존 호출부는 그대로 돈다).
-- 옛 12인자 판을 먼저 지운다. 기본값 있는 14인자를 그냥 얹으면 같은 호출이 두 함수에
-- 걸려 「function ... is not unique」로 기존 호출부가 전부 깨진다(슬라이스 3에서 한 번 겪었다).
drop function if exists public.admin_upsert_coupon(
  text, text, text, integer, integer, integer, timestamptz, timestamptz, integer, text,
  public.loyalty_grade, text
);

CREATE OR REPLACE FUNCTION public.admin_upsert_coupon(target_code text, target_name text, target_discount_type text, target_discount_value integer, target_max_discount_amount integer, target_min_subtotal integer, target_starts_at timestamp with time zone, target_ends_at timestamp with time zone, target_issue_limit integer, target_status text, target_grade_benefit loyalty_grade, target_previous_code text, target_target_kind text DEFAULT 'all'::text, target_target_good_id text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    min_subtotal, starts_at, ends_at, issue_limit, status, grade_benefit,
    target_kind, target_good_id
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
    target_grade_benefit,
    coalesce(nullif(btrim(coalesce(target_target_kind, '')), ''), 'all'),
    nullif(btrim(coalesce(target_target_good_id, '')), '')
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
    grade_benefit = excluded.grade_benefit,
    target_kind = excluded.target_kind,
    target_good_id = excluded.target_good_id
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
$function$;

-- drop 이 권한도 함께 지운다 — 다시 걸지 않으면 anon 까지 실행할 수 있게 된다.
revoke all on function public.admin_upsert_coupon(
  text, text, text, integer, integer, integer, timestamptz, timestamptz, integer, text,
  public.loyalty_grade, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_coupon(
  text, text, text, integer, integer, integer, timestamptz, timestamptz, integer, text,
  public.loyalty_grade, text, text, text
) to authenticated;

analyze public.coupons;
