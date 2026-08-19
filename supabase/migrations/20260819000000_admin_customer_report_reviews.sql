-- ==========================================================================
-- ICONS · 고객현황 리포트에 리뷰 지표를 더한다 (#258 후속)
--
-- #258을 만들 때 리뷰 도메인(#254)이 아직 main에 없어 문의 지표만 넣고 화면이
-- "리뷰 지표는 리뷰 도메인이 들어온 뒤 더한다"고 밝히고 있었다. #267이 머지돼
-- 조회할 테이블이 생겼으므로 그 자리를 채운다.
--
-- 집계 기준은 공개 표면과 같다: 블라인드된 리뷰는 빼고, 리뷰가 없으면 평균을
-- 0으로 만들지 않는다.
-- ==========================================================================

create or replace function public.admin_customer_report(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_result jsonb;
begin
  if not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_from is null or p_to is null or p_to <= p_from then
    raise invalid_parameter_value using message = 'invalid_report_range';
  end if;

  with signups as (
    select
      (profile.created_at at time zone 'Asia/Seoul')::date as kst_date,
      count(*) as total
    from public.profiles as profile
    where profile.created_at >= p_from
      and profile.created_at < p_to
    group by 1
  ),
  buyers as (
    select
      orders.user_id,
      count(*) as order_count
    from public.orders
    where orders.status = any (private.revenue_order_statuses())
      and orders.created_at >= p_from
      and orders.created_at < p_to
    group by orders.user_id
  ),
  inquiries as (
    select
      count(*) as total,
      count(*) filter (where inquiry.answered_at is null and inquiry.closed_at is null)
        as unanswered,
      avg(
        extract(epoch from (inquiry.answered_at - inquiry.created_at)) / 3600.0
      ) filter (where inquiry.answered_at is not null) as avg_first_response_hours
    from public.inquiries as inquiry
    where inquiry.created_at >= p_from
      and inquiry.created_at < p_to
  ),
  -- 블라인드된 리뷰는 평점 분포에서 뺀다. 공개 표면의 평균(good_review_stats)이
  -- 그렇게 계산되므로, 여기만 포함하면 운영자가 보는 평점과 구매자가 보는
  -- 평점이 갈린다(#254).
  reviews as (
    select
      count(*) as total,
      avg(review.rating) as average_rating,
      count(*) filter (where review.admin_reply is null) as unanswered,
      count(*) filter (where review.rating = 1) as rating_1,
      count(*) filter (where review.rating = 2) as rating_2,
      count(*) filter (where review.rating = 3) as rating_3,
      count(*) filter (where review.rating = 4) as rating_4,
      count(*) filter (where review.rating = 5) as rating_5
    from public.reviews as review
    where review.status = 'visible'
      and review.created_at >= p_from
      and review.created_at < p_to
  )
  select jsonb_build_object(
    'signups', coalesce((
      select jsonb_agg(
        jsonb_build_object('date', to_char(signups.kst_date, 'YYYY-MM-DD'), 'total', signups.total)
        order by signups.kst_date
      )
      from signups
    ), '[]'::jsonb),
    'signupTotal', coalesce((select sum(signups.total) from signups), 0),
    'buyerCount', coalesce((select count(*) from buyers), 0),
    -- 재구매자는 기간 안에서 두 번 이상 산 사람이다. 기간을 넘는 재구매는 이
    -- 정의로 잡히지 않으며, 그래서 "기간 내 재구매율"이라고 적는다.
    'repeatBuyerCount', coalesce((select count(*) from buyers where buyers.order_count > 1), 0),
    'inquiries', (
      select jsonb_build_object(
        'total', inquiries.total,
        'unanswered', inquiries.unanswered,
        'averageFirstResponseHours', case
          when inquiries.avg_first_response_hours is null then null
          else round(inquiries.avg_first_response_hours::numeric, 1)
        end
      )
      from inquiries
    ),
    'reviews', (
      select jsonb_build_object(
        'total', reviews.total,
        'unanswered', reviews.unanswered,
        -- 리뷰가 없으면 평균은 0이 아니라 값 없음이다. 0점은 존재할 수 없는
        -- 평점이라 화면에 찍히는 순간 거짓말이 된다.
        'averageRating', case
          when reviews.average_rating is null then null
          else round(reviews.average_rating::numeric, 2)
        end,
        'distribution', jsonb_build_array(
          reviews.rating_1,
          reviews.rating_2,
          reviews.rating_3,
          reviews.rating_4,
          reviews.rating_5
        )
      )
      from reviews
    )
  )
  into v_result;

  return v_result;
end;
$function$;
