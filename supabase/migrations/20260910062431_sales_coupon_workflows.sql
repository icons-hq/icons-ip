-- #465 쿠폰 관리자 목록 조회.
--
-- 쿠폰 정의와 사용 원장은 운영자 화면의 현재 페이지에 필요한 행만 반환한다.
-- 검색어 정규화·권한·페이지 크기는 서버에서 판정하며, used_count도 원장 전체를
-- 브라우저로 내려 집계하지 않고 쿠폰별 집계로 붙인다.

create function public.admin_search_coupons(
  p_query text default null,
  p_status text default 'all',
  p_limit integer default 20,
  p_offset integer default 0
)
returns table(
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
  status text,
  grade_benefit public.loyalty_grade,
  used_count bigint,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  needle text := btrim(coalesce(p_query, ''));
  normalized_status text := lower(btrim(coalesce(p_status, 'all')));
  pattern text;
begin
  if actor_id is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  if length(needle) > 100
     or normalized_status not in ('all', 'active', 'archived')
     or p_limit is null
     or p_limit not between 1 and 100
     or p_offset is null
     or p_offset < 0 then
    raise invalid_parameter_value using message = 'invalid_coupon_search';
  end if;

  -- `%`와 `_`는 검색어가 아니라 와일드카드로 해석되지 않게 한다. 나머지
  -- PostgREST 문법은 RPC 내부의 SQL 값으로만 취급되므로 필터 문자열을 만들지 않는다.
  pattern := '%' || replace(
    replace(replace(needle, E'\\', E'\\\\'), '%', E'\\%'),
    '_', E'\\_'
  ) || '%';

  return query
    select
      coupon.code,
      coupon.name,
      coupon.discount_type,
      coupon.discount_value,
      coupon.max_discount_amount,
      coupon.min_subtotal,
      coupon.starts_at,
      coupon.ends_at,
      coupon.issue_limit,
      coupon.issued_count,
      coupon.status,
      coupon.grade_benefit,
      (
        select count(*)::bigint
        from public.coupon_redemptions as redemption
        where redemption.coupon_code = coupon.code
          and redemption.status = 'applied'
      ) as used_count,
      count(*) over () as total_count
    from public.coupons as coupon
    where (needle = ''
      or coupon.code ilike pattern escape E'\\'
      or coupon.name ilike pattern escape E'\\')
      and (normalized_status = 'all' or coupon.status = normalized_status)
    order by coupon.created_at desc, coupon.code asc
    limit p_limit
    offset p_offset;
end;
$$;

revoke all on function public.admin_search_coupons(text, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_search_coupons(text, text, integer, integer)
  to authenticated;
