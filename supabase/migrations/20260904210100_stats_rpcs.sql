-- D-6 ② — 통계 RPC 3종 (설계서 v2 §1-5)
--
-- 세 화면(시계열·축별·상품)이 **같은 모집단**을 봐야 한다. 지금은 화면마다 조건이 조금씩
-- 달라서 「합계는 같은데 축을 나누면 안 맞는」 표가 나온다. 모집단을 함수 하나로 못 박는다.
--
-- 순매출 = 결제합계(결제일 버킷) − 환불합계(환불 완료일 버킷). 과거 버킷이 안 움직이므로
-- 나중에 롤업 표로 바꿔도 같은 숫자가 나온다 — 지금은 조회 시 집계로 시작한다.

create or replace function private.stats_sales_scope(
  p_from timestamptz,
  p_to timestamptz,
  p_ip_id text default null
)
returns table (
  order_id uuid,
  paid_at timestamptz,
  created_at timestamptz,
  user_id uuid,
  total bigint,
  payment_method text,
  postal_prefix text
)
language sql
stable
set search_path = ''
as $$
  select
    ord.id,
    coalesce(ord.paid_at, ord.created_at),
    ord.created_at,
    ord.user_id,
    ord.total,
    ord.payment_method::text,
    pg_catalog.left(pg_catalog.regexp_replace(coalesce(ord.address ->> 'postalCode', ''), '[^0-9]', '', 'g'), 2)
  from public.orders as ord
  where ord.status in ('paid', 'confirmed', 'shipping', 'delivered', 'done')
    and coalesce(ord.paid_at, ord.created_at) >= p_from
    and coalesce(ord.paid_at, ord.created_at) < p_to
    and (
      p_ip_id is null
      or exists (
        select 1 from public.order_items as item
        where item.order_id = ord.id and item.good_ip_id_snapshot = p_ip_id
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- 시계열 — 결제합계 · 환불합계 · 순매출 · 주문수, 비교 구간 포함
-- ---------------------------------------------------------------------------
create or replace function public.admin_stats_timeseries(
  p_from timestamptz,
  p_to timestamptz,
  p_unit text default 'day',
  p_compare text default 'none',
  p_ip_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_span interval;
  v_shift interval;
  v_rows jsonb;
  v_compare jsonb := null;
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  if p_unit not in ('day', 'week', 'month') then
    raise check_violation using message = 'invalid stats unit';
  end if;
  if p_compare not in ('none', 'previous_period', 'previous_year') then
    raise check_violation using message = 'invalid stats compare';
  end if;
  if p_from >= p_to then
    raise check_violation using message = 'invalid stats range';
  end if;

  v_span := p_to - p_from;
  v_shift := case p_compare
    when 'previous_period' then v_span
    when 'previous_year' then interval '1 year'
    else null
  end;

  select jsonb_agg(bucket order by bucket ->> 'bucket') into v_rows
  from private.stats_timeseries_rows(p_from, p_to, p_unit, p_ip_id) as bucket;

  if v_shift is not null then
    select jsonb_agg(bucket order by bucket ->> 'bucket') into v_compare
    from private.stats_timeseries_rows(p_from - v_shift, p_to - v_shift, p_unit, p_ip_id) as bucket;
  end if;

  return jsonb_build_object(
    'unit', p_unit,
    'from', p_from,
    'to', p_to,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'compare', v_compare,
    -- 화면이 「언제 기준 숫자인가」를 말할 수 있어야 한다. 캐시가 없어도 이 값을 보여준다.
    'refreshedAt', now()
  );
end;
$$;

create or replace function private.stats_timeseries_rows(
  p_from timestamptz,
  p_to timestamptz,
  p_unit text,
  p_ip_id text
)
returns setof jsonb
language sql
stable
set search_path = ''
as $$
  with buckets as (
    -- 버킷 경계는 KST 다. UTC 로 자르면 한국 자정 전후 주문이 옆 날로 넘어간다.
    select pg_catalog.generate_series(
      pg_catalog.date_trunc(p_unit, p_from at time zone 'Asia/Seoul'),
      pg_catalog.date_trunc(p_unit, (p_to - interval '1 microsecond') at time zone 'Asia/Seoul'),
      ('1 ' || p_unit)::interval
    ) as bucket
  ),
  sales as (
    select pg_catalog.date_trunc(p_unit, scope.paid_at at time zone 'Asia/Seoul') as bucket,
           pg_catalog.sum(scope.total)::bigint as gross,
           pg_catalog.count(*)::bigint as order_count
    from private.stats_sales_scope(p_from, p_to, p_ip_id) as scope
    group by 1
  ),
  refunded as (
    -- 환불은 **완료된 날**의 버킷에 넣는다. 주문일 버킷에 넣으면 지난달 숫자가 이번 달에 바뀐다.
    select pg_catalog.date_trunc(p_unit, refund.completed_at at time zone 'Asia/Seoul') as bucket,
           pg_catalog.sum(refund.amount)::bigint as refunds
    from public.refunds as refund
    join public.payments as payment on payment.id = refund.payment_id
    where refund.completed_at >= p_from and refund.completed_at < p_to
      and payment.purpose = 'order'
      and (
        p_ip_id is null
        or exists (
          select 1 from public.order_items as item
          where item.order_id = payment.ref_id and item.good_ip_id_snapshot = p_ip_id
        )
      )
    group by 1
  )
  select jsonb_build_object(
    'bucket', pg_catalog.to_char(buckets.bucket, 'YYYY-MM-DD'),
    'gross', coalesce(sales.gross, 0),
    'refunds', coalesce(refunded.refunds, 0),
    'net', coalesce(sales.gross, 0) - coalesce(refunded.refunds, 0),
    'orderCount', coalesce(sales.order_count, 0)
  )
  from buckets
  left join sales on sales.bucket = buckets.bucket
  left join refunded on refunded.bucket = buckets.bucket
  order by buckets.bucket;
$$;

-- ---------------------------------------------------------------------------
-- 축별 — 결제수단 · 지역 · 도서산간 · 등급 · 연령대 · 요일 · 시간대 · 구매자 유형
-- ---------------------------------------------------------------------------
create or replace function public.admin_stats_breakdown(
  p_from timestamptz,
  p_to timestamptz,
  p_axis text,
  p_ip_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows jsonb;
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  if p_axis not in (
    'payment_method', 'region', 'remote_area', 'grade', 'age_band', 'dow', 'hour', 'buyer_type'
  ) then
    raise check_violation using message = 'invalid stats axis';
  end if;
  if p_from >= p_to then
    raise check_violation using message = 'invalid stats range';
  end if;

  with scope as (
    select * from private.stats_sales_scope(p_from, p_to, p_ip_id)
  ),
  labelled as (
    select
      case p_axis
        when 'payment_method' then scope.payment_method
        when 'region' then coalesce(region.sido, '미상')
        when 'remote_area' then case when coalesce(region.remote_area, false) then '도서산간' else '일반' end
        when 'grade' then coalesce(profile.loyalty_grade::text, '미상')
        when 'age_band' then case
          -- 주문 시점 만 나이. 생년월일은 만 14세 확인 목적으로 받은 값이라
          -- 통계 목적 명시 여부는 처리방침 확인 항목이다(설계서 §5).
          when profile.birth_date is null then '미상'
          -- `extract(year from …)` 은 구문이라 스키마 한정이 안 된다. 같은 값을 함수로 얻는다.
          else (
            (pg_catalog.date_part('year', pg_catalog.age(scope.created_at, profile.birth_date))::integer / 10) * 10
          )::text || '대'
        end
        -- 요일·시간대는 **주문한 때**를 본다. 매출이 아니라 고객 행동을 보는 축이다.
        when 'dow' then pg_catalog.to_char(scope.created_at at time zone 'Asia/Seoul', 'Dy')
        when 'hour' then pg_catalog.lpad(pg_catalog.to_char(scope.created_at at time zone 'Asia/Seoul', 'HH24'), 2, '0') || '시'
        when 'buyer_type' then case
          when (
            select pg_catalog.count(*) from public.orders as prior
            where prior.user_id = scope.user_id
              and prior.status in ('paid', 'confirmed', 'shipping', 'delivered', 'done')
              and coalesce(prior.paid_at, prior.created_at) < scope.paid_at
          ) > 0 then '재구매' else '첫구매'
        end
      end as label,
      scope.total
    from scope
    left join public.profiles as profile on profile.id = scope.user_id
    left join public.postal_regions as region on region.prefix = scope.postal_prefix
  )
  select jsonb_agg(row order by row ->> 'label')
  into v_rows
  from (
    select jsonb_build_object(
      'label', labelled.label,
      'gross', pg_catalog.sum(labelled.total)::bigint,
      'orderCount', pg_catalog.count(*)::bigint
    ) as row
    from labelled
    group by labelled.label
  ) as grouped;

  return jsonb_build_object(
    'axis', p_axis,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'refreshedAt', now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 상품 — 판매 순위 · 분류별 · 클레임 많은 순
-- ---------------------------------------------------------------------------
create or replace function public.admin_stats_products(
  p_from timestamptz,
  p_to timestamptz,
  p_rank text default 'sales',
  p_limit integer default 20,
  p_ip_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_rows jsonb;
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  if p_rank not in ('sales', 'category', 'claims', 'ip') then
    raise check_violation using message = 'invalid stats rank';
  end if;
  if p_from >= p_to then
    raise check_violation using message = 'invalid stats range';
  end if;

  with scope as (
    select * from private.stats_sales_scope(p_from, p_to, p_ip_id)
  ),
  lines as (
    select item.good_id, item.good_name_snapshot, item.good_type_snapshot, item.good_ip_id_snapshot,
           item.qty, item.qty::bigint * item.unit_price::bigint as revenue,
           item.order_id
    from public.order_items as item
    join scope on scope.order_id = item.order_id
  ),
  claims as (
    select item.good_id, pg_catalog.count(*)::bigint as claim_count
    from public.order_cancellation_requests as claim
    join public.order_items as item on item.order_id = claim.order_id
    where claim.requested_at >= p_from and claim.requested_at < p_to
      and (p_ip_id is null or item.good_ip_id_snapshot = p_ip_id)
    group by item.good_id
  )
  select jsonb_agg(row)
  into v_rows
  from (
    select jsonb_build_object(
      'key', grouped.key,
      'label', grouped.label,
      'qty', grouped.qty,
      'revenue', grouped.revenue,
      'claimCount', grouped.claim_count
    ) as row
    from (
      select
        case p_rank
          when 'category' then lines.good_type_snapshot
          when 'ip' then lines.good_ip_id_snapshot
          else lines.good_id
        end as key,
        -- 라벨의 모든 가지가 집계여야 한다 — 묶음 키가 아닌 열을 그대로 읽으면 GROUP BY 가 막는다.
        case p_rank
          when 'category' then pg_catalog.max(lines.good_type_snapshot)
          when 'ip' then coalesce(pg_catalog.max(ip.title), pg_catalog.max(lines.good_ip_id_snapshot))
          else pg_catalog.max(lines.good_name_snapshot)
        end as label,
        pg_catalog.sum(lines.qty)::bigint as qty,
        pg_catalog.sum(lines.revenue)::bigint as revenue,
        coalesce(pg_catalog.sum(claims.claim_count), 0)::bigint as claim_count
      from lines
      left join claims on claims.good_id = lines.good_id
      left join public.ips as ip on ip.id = lines.good_ip_id_snapshot
      group by 1
      order by
        case when p_rank = 'claims' then coalesce(pg_catalog.sum(claims.claim_count), 0) else pg_catalog.sum(lines.revenue) end desc,
        1
      limit v_limit
    ) as grouped
  ) as ranked;

  return jsonb_build_object(
    'rank', p_rank,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'refreshedAt', now()
  );
end;
$$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.admin_stats_timeseries(timestamptz, timestamptz, text, text, text)',
    'public.admin_stats_breakdown(timestamptz, timestamptz, text, text)',
    'public.admin_stats_products(timestamptz, timestamptz, text, integer, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, service_role', v_signature);
    execute format('grant execute on function %s to authenticated', v_signature);
  end loop;
end;
$$;

revoke all on function private.stats_sales_scope(timestamptz, timestamptz, text) from public, anon, authenticated, service_role;
revoke all on function private.stats_timeseries_rows(timestamptz, timestamptz, text, text) from public, anon, authenticated, service_role;
