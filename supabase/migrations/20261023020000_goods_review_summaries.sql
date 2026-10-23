-- ============================================================================
-- ICONS · 목록 카드 별점 — 공개 굿즈 리뷰 요약 배치 읽기 (LFS 패리티 2차 L4 · CL-02)
--
-- 굿즈샵·검색·온라인 팝업·홈의 상품 카드가 "리뷰가 있으면" 별점과 리뷰 수를 보인다(11 §8.3 CL-02).
-- 카탈로그 스냅샷이 공개 굿즈 ID 를 한 번에 넘기면 이 함수가 굿즈별 요약을 한 번에 돌려준다 —
-- 카드마다 상세 리뷰 RPC 를 부르는 N+1 을 만들지 않는다.
--
-- ## 상세 페이지와 같은 숫자
--
-- 굿즈 상세의 평점 요약(get_good_group_reviews_v3 summary)은 굿즈 그룹 범위다: 같은 그룹의 공개 굿즈
-- 리뷰를 함께 센다(private.goods_group_review_good_ids). 카드가 굿즈 하나만 세면 같은 굿즈가 목록에서는
-- "리뷰 없음", 상세에서는 "4.5점 · 12개"로 보인다. 그래서 같은 범위 함수와 같은 공개 조건
-- (status = 'visible', 평균은 소수 둘째 자리 반올림)을 쓴다.
--
-- ## 공개 범위
--
-- - 숨김(블라인드) 리뷰는 세지 않는다. 신고는 운영자가 블라인드하면 숨김이 된다 — 상세와 같은 규칙.
-- - 보관·비공개·판매 제한 굿즈와 비공개 IP 의 굿즈는 요약을 내지 않는다
--   (goods_group_public_good 가 그 판정을 소유한다). 공개 카탈로그 밖 ID 는 조용히 빠진다.
-- - 리뷰 0건 굿즈는 행이 없다 — "집계를 못 읽은 것"과 "리뷰가 없는 것"을 같은 값으로 만들지 않는다
--   (public.good_review_stats 와 같은 원칙). 화면은 행이 없으면 별점을 숨긴다.
--
-- ## 읽기 전용·봉인
--
-- STABLE SECURITY DEFINER(search_path ''): 그룹 범위 함수와 그룹 테이블은 postgres 전용이라 소유자
-- 권한으로 읽되, 돌려주는 값은 공개 리뷰의 개수·평균뿐이다. 행을 바꾸지 않는다.
-- 실행은 공개 브라우징처럼 anon·authenticated 에만 연다(service_role·PUBLIC 없음).
-- ============================================================================

begin;

create function public.get_goods_review_summaries(p_good_ids text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_good_ids is null
    or pg_catalog.cardinality(p_good_ids) not between 1 and 500
    or pg_catalog.array_position(p_good_ids, null) is not null
    or exists (
      select 1 from pg_catalog.unnest(p_good_ids) as requested(id)
      where requested.id !~ '^[A-Za-z0-9_-]{1,64}$'
    )
  then
    raise invalid_parameter_value using message = 'invalid_goods_review_summary_goods';
  end if;

  with requested as (
    select distinct requested.id
    from pg_catalog.unnest(p_good_ids) as requested(id)
  ), scope as (
    -- 비공개 굿즈는 빈 배열이라 여기서 사라진다. 그룹 밖 공개 굿즈는 자기 자신 하나다.
    select requested.id as good_id, member.good_id as member_id
    from requested
    cross join lateral pg_catalog.unnest(private.goods_group_review_good_ids(requested.id)) as member(good_id)
  ), summary as (
    select
      scope.good_id,
      pg_catalog.count(*)::bigint as review_count,
      round(avg(review.rating)::numeric, 2) as rating_average
    from scope
    join public.reviews as review
      on review.good_id = scope.member_id
     and review.status = 'visible'
    group by scope.good_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'goodId', summary.good_id,
        'reviewCount', summary.review_count,
        'ratingAverage', summary.rating_average
      )
      order by summary.good_id
    ),
    '[]'::jsonb
  )
  into result
  from summary;

  return result;
end;
$$;

comment on function public.get_goods_review_summaries(text[]) is
  '목록 카드 별점: 공개 굿즈별 공개 리뷰 수·평균(굿즈 상세와 같은 그룹 범위). 리뷰 0건·비공개 굿즈는 행이 없다.';

revoke all on function public.get_goods_review_summaries(text[]) from public, anon, authenticated, service_role;
grant execute on function public.get_goods_review_summaries(text[]) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
