-- ============================================================================
-- ICONS · 회원 등급 혜택 안내 — 등급별 혜택 읽기 (LFS 패리티 2차 L6 · MY-05)
--
-- 마이페이지의 '회원 등급 혜택' 화면(/my/grade-benefits)이 등급표를 그린다. 등급 조건과 내 등급·실적은
-- 이미 로그인 회원용 get_my_loyalty_status() 가 돌려준다. 빈 곳은 "각 등급에 오르면 무엇을 받는가"다:
--   - 등급 혜택 쿠폰은 RLS 상 보유한 정의만 보인다(20260831090000 coupons_select_held_or_staff) — 아직 오르지
--     않은 등급의 쿠폰은 회원이 읽을 수 없다.
--   - 등급 적립률(private.customer_reward_policy.grade_rates)은 관리자 전용 테이블이다.
-- 이 함수가 그 둘을 등급별로 묶어 읽기 전용으로 돌려준다.
--
-- ## 돌려주는 것 / 돌려주지 않는 것
--
-- - 쿠폰: 이름·혜택(정액/정률·상한·굿즈/배송비)·최소 주문 금액·대상 범위 종류·받는 회원 조건·유효 기간
--   (사용 기간 또는 지급일 기준 일수). **쿠폰 코드는 돌려주지 않는다** — 코드 입력 발급(claim_coupon_code)은
--   등급을 묻지 않으므로 코드가 새면 아무 회원이나 상위 등급 쿠폰을 받을 수 있다. 대상 굿즈·카테고리 ID,
--   발급 수량·한도 같은 운영 값도 내지 않는다.
-- - 지금 승급하면 실제로 지급되는 정의만 싣는다. 승급 지급(private.grant_grade_benefit_coupons)과 같은 거름이다:
--   활성 정의, 사용 기간이 끝나지 않음, 발급 기간이 열려 있음, 발급 한도가 남음, 등급이 WELCOME 보다 위
--   (WELCOME 은 가입 기본 등급이라 승급 지급 대상이 아니다). 받는 회원 조건(첫 구매·재구매)은 회원마다
--   달라 거르지 않고 값으로 내보낸다 — 화면이 조건으로 적는다.
-- - 적립률: 등급 적립(customer_reward_policy.grade_enabled)과 기본 적립금 정책(store_credit_policy.enabled)이
--   둘 다 켜져 있을 때만 등급별 정률(0.01% 단위 = bps)을 낸다. 하나라도 꺼져 있으면 null 이다 — 주문 시점
--   적립 스냅샷(private.store_credit_policy_for_member)과 같은 판정이다.
--
-- ## 읽기 전용·봉인
--
-- STABLE SECURITY DEFINER(search_path ''): 관리자 전용 정책 테이블과 RLS 로 가려진 쿠폰 정의를 소유자
-- 권한으로 읽되 행을 바꾸지 않는다. 로그인 회원(auth.uid())만 부를 수 있고 비로그인 세션은 auth_required 로
-- 거절한다. 실행 권한은 PUBLIC·anon·service_role 에서 걷고 authenticated 에만 연다.
-- ============================================================================

begin;

create function public.get_loyalty_grade_benefits()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  credit_enabled boolean;
  reward_enabled boolean;
  reward_rates jsonb;
  rates_effective boolean;
  result jsonb;
begin
  if actor is null then
    raise insufficient_privilege using message = 'auth_required';
  end if;

  select policy.enabled into credit_enabled
  from private.store_credit_policy as policy
  where policy.singleton;

  select policy.grade_enabled, policy.grade_rates into reward_enabled, reward_rates
  from private.customer_reward_policy as policy
  where policy.singleton;

  rates_effective := coalesce(credit_enabled, false) and coalesce(reward_enabled, false);

  with grades as (
    select grade.value as grade, grade.position
    from pg_catalog.unnest(pg_catalog.enum_range(null::public.loyalty_grade)) with ordinality as grade(value, position)
  ), grantable as (
    -- private.grant_grade_benefit_coupons 와 같은 거름(받는 회원 조건만 값으로 남긴다).
    select coupon.*
    from public.coupons as coupon
    where coupon.grade_benefit is not null
      and coupon.grade_benefit > 'welcome'::public.loyalty_grade
      and coupon.status = 'active'
      and (coupon.ends_at is null or coupon.ends_at > statement_timestamp())
      and (coupon.issue_starts_at is null or coupon.issue_starts_at <= statement_timestamp())
      and (coupon.issue_starts_at is null or coupon.issue_ends_at is null or coupon.issue_ends_at > statement_timestamp())
      and (coupon.issue_limit is null or coupon.issued_count < coupon.issue_limit)
  )
  select jsonb_build_object(
    'creditRatesEnabled', rates_effective,
    'grades', jsonb_agg(
      jsonb_build_object(
        'grade', grades.grade,
        'creditRateBps', case when rates_effective then (reward_rates ->> grades.grade::text)::integer end,
        'coupons', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'name', coupon.name,
              'benefitKind', coupon.benefit_kind,
              'discountType', coupon.discount_type,
              'discountValue', coupon.discount_value,
              'maxDiscountAmount', coupon.max_discount_amount,
              'minSubtotal', coupon.min_subtotal,
              'goodsScope', coupon.goods_scope,
              'recipientSegment', coupon.recipient_segment,
              'startsAt', coupon.starts_at,
              'endsAt', coupon.ends_at,
              'validDays', coupon.valid_days
            )
            -- 코드는 정렬의 마지막 결정자로만 쓰고 내보내지 않는다(같은 조건의 정의도 순서가 흔들리지 않게).
            order by coupon.min_subtotal, coupon.benefit_kind, coupon.discount_type, coupon.discount_value desc, coupon.name, coupon.code
          )
          from grantable as coupon
          where coupon.grade_benefit = grades.grade
        ), '[]'::jsonb)
      )
      order by grades.position
    )
  )
  into result
  from grades;

  return result;
end;
$$;

comment on function public.get_loyalty_grade_benefits() is
  '회원 등급 혜택 안내: 등급별 지급 중인 등급 혜택 쿠폰(코드 제외)과 등급 적립률(bps, 적립 정책이 꺼져 있으면 null). 로그인 회원 전용 읽기.';

revoke all on function public.get_loyalty_grade_benefits() from public, anon, authenticated, service_role;
grant execute on function public.get_loyalty_grade_benefits() to authenticated;

notify pgrst, 'reload schema';

commit;
