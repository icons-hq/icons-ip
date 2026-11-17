-- 목록 정렬 3종(인기도순·판매량순·리뷰 많은순)과 BEST 기간 판매 랭킹(스펙 C §4.1).
--
-- 고객 화면의 NEW·BEST·전체 굿즈 목록은 클라이언트에서 정렬한다. 판매·위시·리뷰 원수치는 공개하지 않고
-- RPC는 정렬된 굿즈 id 배열만 돌려준다.
--
--  * private.goods_effective_sales : 홈 판매 BEST(get_home_sales_rankings)와 같은 '유효 판매 수량' 집계다.
--    원본 20261020085142_home_sales_and_review_curations.sql 의 paid_orders·quantities 규칙(결제 승인 증거가 있는
--    주문, 상태 paid/confirmed/shipping/delivered/done, 취소·반품 완료 제외)에 20261112224600 의 앵커 치환
--    (수량 = private.order_item_active_qty)을 적용한 현재 본문과 같다. get_home_sales_rankings 는 고치지 않는다 —
--    홈과 BEST 의 숫자 일치는 supabase/tests/goods_listing_orders.sql 이 고정한다.
--  * private.goods_listing_metrics : 정렬에 쓰는 굿즈별 원수치(비공개). 대상은 홈 랭킹 eligible 과 같다.
--  * public.get_goods_listing_orders : {"popular":[…],"sales":[…],"reviews":[…]} — 각 배열은 대상 굿즈 전부.
--  * public.get_goods_sales_ranking : 기간별(realtime·daily·weekly·monthly) 판매 랭킹 id 배열.
--
-- 성인 굿즈(sale_restriction<>'none')·초안·보관·IP 미공개 굿즈는 어느 결과에도 들어가지 않는다.
-- 관리자 RPC 가 아니라 운영자 계약 지문 등록 대상이 아니다.
begin;

-- 1. 유효 판매 수량: [p_starts, p_ends) 안에 결제가 승인된 주문의 살아 있는 수량(부분 취소 차감 후)을 굿즈별로 더한다.
--    홈 랭킹의 quantities 와 같은 규칙. 0 이하는 내지 않는다(홈은 coalesce(quantity,0)>0 로 같은 효과).
create function private.goods_effective_sales(p_starts timestamptz, p_ends timestamptz)
returns table(good_id text, quantity bigint)
language sql stable security definer set search_path = '' as $$
  with paid_orders as materialized (
    select o.id, min(approval.approved_at) as approved_at
    from public.orders o
    join public.payments p on p.purpose = 'order' and p.ref_id = o.id and p.status = 'paid'
      and p.user_id = o.user_id and p.amount = o.total
    join public.payment_attempts a on a.payment_id = p.id and a.purpose = 'order' and a.ref_id = o.id
      and a.state = 'approved' and a.amount = p.amount and a.provider = p.provider and a.user_id = o.user_id
    cross join lateral (
      select coalesce(
        (select min(e.approved_at) from private.payment_provider_evidence e where e.payment_attempt_id = a.id),
        (select b.confirmed_at from public.bank_transfer_confirmations b where b.attempt_id = a.id and b.order_id = o.id and a.provider = 'bank_transfer')
      ) as approved_at
    ) approval
    where o.status in ('paid', 'confirmed', 'shipping', 'delivered', 'done')
      and approval.approved_at is not null
      and not exists(select 1 from public.order_cancellation_requests c where c.order_id = o.id
        and c.claim_type in ('cancel', 'return') and (c.status = 'completed' or c.stage = 'completed'))
    group by o.id
  )
  select item.good_id, sum(private.order_item_active_qty(item.id)::bigint) as quantity
  from paid_orders paid
  join public.order_items item on item.order_id = paid.id
  where paid.approved_at >= p_starts and paid.approved_at < p_ends
  group by item.good_id
  having sum(private.order_item_active_qty(item.id)::bigint) > 0;
$$;
revoke all on function private.goods_effective_sales(timestamptz, timestamptz) from public, anon, authenticated, service_role;

-- 2. 정렬 원수치. 대상 = 게시·비보관·판매 제한 없음·IP 게시·비보관 굿즈(홈 랭킹 eligible 과 같다).
--    sales_total = (-infinity, 지금), sales_30d = 홈 monthly 와 같은 [오늘 0시(KST) − 30일, 오늘 0시).
--    리뷰 = 공개(visible) 리뷰. 평균 평점은 홈 리뷰 후보와 같이 소수 둘째 자리 반올림.
create function private.goods_listing_metrics()
returns table(good_id text, sales_total bigint, sales_30d bigint, wish_count bigint, review_count bigint,
  rating_average numeric, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with bounds as (
    select date_trunc('day', statement_timestamp() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as today,
      statement_timestamp() as captured_at
  ), eligible as materialized (
    select g.id, g.created_at
    from public.goods g
    where g.archived_at is null and g.published_at is not null and g.sale_restriction = 'none'
      and exists(select 1 from public.ips ip where ip.id = g.ip_id and ip.archived_at is null and ip.published_at is not null)
  ), total_sales as (
    select s.good_id, s.quantity from bounds
    cross join lateral private.goods_effective_sales('-infinity'::timestamptz, bounds.captured_at) s
  ), recent_sales as (
    select s.good_id, s.quantity from bounds
    cross join lateral private.goods_effective_sales(bounds.today - interval '30 days', bounds.today) s
  ), wishes as (
    select w.good_id, count(*) as wish_count from public.wishlists w join eligible on eligible.id = w.good_id group by w.good_id
  ), review_stats as (
    select r.good_id, count(*) as review_count, round(avg(r.rating)::numeric, 2) as rating_average
    from public.reviews r join eligible on eligible.id = r.good_id
    where r.status = 'visible' group by r.good_id
  )
  select e.id, coalesce(ts.quantity, 0)::bigint, coalesce(rs.quantity, 0)::bigint, coalesce(w.wish_count, 0)::bigint,
    coalesce(r.review_count, 0)::bigint, r.rating_average, e.created_at
  from eligible e
  left join total_sales ts on ts.good_id = e.id
  left join recent_sales rs on rs.good_id = e.id
  left join wishes w on w.good_id = e.id
  left join review_stats r on r.good_id = e.id;
$$;
revoke all on function private.goods_listing_metrics() from public, anon, authenticated, service_role;

-- 3. 정렬된 id 배열만 공개한다(§2.5). 동률은 뒤 키로 내려가고 마지막은 굿즈 id 다.
--    popular = 최근 30일 유효 판매 수량 + 위시 수 → 공개 리뷰 수 → 등록 최신
--    sales   = 누적 유효 판매 수량 → 위시 수 → 등록 최신
--    reviews = 공개 리뷰 수 → 평균 평점 → 등록 최신
create function public.get_goods_listing_orders()
returns jsonb language sql stable security definer set search_path = '' as $$
  with m as materialized (select * from private.goods_listing_metrics())
  select jsonb_build_object(
    'popular', coalesce((select jsonb_agg(m.good_id order by m.sales_30d + m.wish_count desc, m.review_count desc,
      m.created_at desc nulls last, m.good_id) from m), '[]'::jsonb),
    'sales', coalesce((select jsonb_agg(m.good_id order by m.sales_total desc, m.wish_count desc,
      m.created_at desc nulls last, m.good_id) from m), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(m.good_id order by m.review_count desc, coalesce(m.rating_average, 0) desc,
      m.created_at desc nulls last, m.good_id) from m), '[]'::jsonb)
  );
$$;
revoke all on function public.get_goods_listing_orders() from public, anon, authenticated, service_role;
grant execute on function public.get_goods_listing_orders() to anon, authenticated;

-- 4. BEST 기간 판매 랭킹. 기간 경계(KST)·순위는 get_home_sales_rankings 와 같다.
--    realtime = 오늘 0시~지금, daily = 어제, weekly = 지난 7일(어제까지), monthly = 지난 30일(어제까지).
--    순위 = 수량 → 위시 수 → 등록 최신 → id, 수량>0 또는 위시>0 인 굿즈. 홈은 기간마다 4개만 내지만 여기는 p_limit(최대 200).
create function public.get_goods_sales_ranking(p_period text, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare ranking jsonb;
begin
  if p_period is null or p_period not in ('realtime', 'daily', 'weekly', 'monthly')
    or p_limit is null or p_limit not between 1 and 200 then
    raise invalid_parameter_value using message = 'invalid_sales_ranking';
  end if;
  with bounds as (
    select date_trunc('day', statement_timestamp() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as today,
      statement_timestamp() as captured_at
  ), period_window as (
    select case p_period when 'realtime' then today when 'daily' then today - interval '1 day'
        when 'weekly' then today - interval '7 days' else today - interval '30 days' end as starts_at,
      case p_period when 'realtime' then captured_at else today end as ends_at
    from bounds
  ), eligible as materialized (
    select g.id, g.created_at
    from public.goods g
    where g.archived_at is null and g.published_at is not null and g.sale_restriction = 'none'
      and exists(select 1 from public.ips ip where ip.id = g.ip_id and ip.archived_at is null and ip.published_at is not null)
  ), quantities as (
    select s.good_id, s.quantity from period_window w
    cross join lateral private.goods_effective_sales(w.starts_at, w.ends_at) s
    join eligible on eligible.id = s.good_id
  ), wishes as (
    select w.good_id, count(*) as wish_count from public.wishlists w join eligible on eligible.id = w.good_id group by w.good_id
  ), ranked as (
    select g.id, row_number() over(order by coalesce(q.quantity, 0) desc, coalesce(w.wish_count, 0) desc, g.created_at desc, g.id) as position
    from eligible g
    left join quantities q on q.good_id = g.id
    left join wishes w on w.good_id = g.id
    where coalesce(q.quantity, 0) > 0 or coalesce(w.wish_count, 0) > 0
  )
  select coalesce(jsonb_agg(ranked.id order by ranked.position), '[]'::jsonb) into ranking
  from ranked where ranked.position <= p_limit;
  return ranking;
end $$;
revoke all on function public.get_goods_sales_ranking(text, integer) from public, anon, authenticated, service_role;
grant execute on function public.get_goods_sales_ranking(text, integer) to anon, authenticated;

commit;
