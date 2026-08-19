-- ==========================================================================
-- ICONS · 통계 리포트 (#258)
--
-- 조회 전용이다. 여기서 만드는 것은 화면 셋(판매분석·클레임·고객현황)이 읽을
-- 집계뿐이고, 어떤 상태도 바꾸지 않는다.
--
-- RPC로 내리는 이유는 두 가지다. 클레임·환불·프로필은 staff 세션이 테이블로
-- 직접 읽을 수 없고(`order_cancellation_requests`·`refunds`·`profiles`는
-- authenticated에 select가 없다), 열려 있는 표면도 PostgREST가 1000행에서
-- 조용히 자르기 때문에 앱에서 재집계하면 기간이 길어질수록 조용히 틀린다.
-- 집계는 DB에서 끝내고 앱은 그리기만 한다.
--
-- 버킷은 KST 자정 기준이다(`at time zone 'Asia/Seoul'`). 대시보드의
-- `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' })`과 같은 경계여야
-- 두 화면의 같은 날짜가 다른 값을 말하지 않는다.
-- ==========================================================================

-- 매출로 세는 주문 상태. lib/admin/insights.server.ts의 REVENUE_ORDER_STATUSES와
-- 같은 목록이어야 한다 — 한쪽만 넓히면 사다리를 지나는 동안 매출이 사라졌다
-- 돌아온다(#250).
create function private.revenue_order_statuses()
returns public.order_status[]
language sql
immutable
security invoker
set search_path = ''
as $function$
  select array[
    'paid', 'confirmed', 'shipping', 'delivered', 'done'
  ]::public.order_status[];
$function$;

revoke all on function private.revenue_order_statuses()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. 판매분석
-- ---------------------------------------------------------------------------
-- 일별 매출·주문수·객단가는 한 소스(orders)에서 뽑는다. 매출을 payments에서,
-- 주문수를 orders에서 세면 객단가가 두 테이블의 시차만큼 어긋난다.
create function public.admin_sales_report(
  p_from timestamptz,
  p_to timestamptz,
  p_ip_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_ip text := nullif(btrim(coalesce(p_ip_id, '')), '');
  v_result jsonb;
begin
  if not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_from is null or p_to is null or p_to <= p_from then
    raise invalid_parameter_value using message = 'invalid_report_range';
  end if;

  with scoped as (
    select
      orders.id,
      orders.total,
      orders.payment_method,
      (orders.created_at at time zone 'Asia/Seoul')::date as kst_date
    from public.orders
    where orders.status = any (private.revenue_order_statuses())
      and orders.created_at >= p_from
      and orders.created_at < p_to
  ),
  daily as (
    select
      scoped.kst_date,
      count(*) as order_count,
      sum(scoped.total) as revenue
    from scoped
    group by scoped.kst_date
  ),
  methods as (
    select
      scoped.payment_method,
      count(*) as order_count,
      sum(scoped.total) as revenue
    from scoped
    group by scoped.payment_method
  ),
  goods_rank as (
    select
      item.good_id,
      max(item.good_name_snapshot) as name,
      max(item.good_ip_id_snapshot) as ip_id,
      sum(item.qty) as qty,
      sum(item.qty::bigint * item.unit_price::bigint) as revenue
    from public.order_items as item
    join scoped on scoped.id = item.order_id
    where v_ip is null or item.good_ip_id_snapshot = v_ip
    group by item.good_id
    order by revenue desc, qty desc, item.good_id
    limit 20
  ),
  ticket_scoped as (
    select
      ticket_order.id,
      ticket_order.event_id,
      ticket_order.total,
      (ticket_order.created_at at time zone 'Asia/Seoul')::date as kst_date
    from public.ticket_orders as ticket_order
    where ticket_order.status = 'paid'
      and ticket_order.created_at >= p_from
      and ticket_order.created_at < p_to
  ),
  tickets as (
    select
      ticket_scoped.event_id,
      max(coalesce(event.title, ticket_scoped.event_id)) as event_title,
      count(*) as order_count,
      sum(ticket_scoped.total) as revenue,
      coalesce(sum(reservation.quantity), 0) as ticket_count
    from ticket_scoped
    left join public.events as event on event.id = ticket_scoped.event_id
    left join public.ticket_order_reservations as reservation
      on reservation.ticket_order_id = ticket_scoped.id
    group by ticket_scoped.event_id
    order by revenue desc, ticket_scoped.event_id
    limit 20
  ),
  -- 회차 축. 이벤트 합계만으로는 "어느 회차가 안 팔리는가"를 볼 수 없고, 그
  -- 판단이 정원 조정의 근거다. 매출은 예약 스냅샷(수량 × 단가)에서 센다 —
  -- ticket_orders.total은 회차별로 쪼갤 수 없다.
  ticket_occurrences as (
    select
      reservation.ticket_type_id,
      max(coalesce(ticket_type.name, '이름 없는 회차')) as occurrence_name,
      max(coalesce(event.title, ticket_scoped.event_id)) as event_title,
      sum(reservation.quantity) as ticket_count,
      sum(reservation.quantity::bigint * reservation.unit_price::bigint) as revenue
    from ticket_scoped
    join public.ticket_order_reservations as reservation
      on reservation.ticket_order_id = ticket_scoped.id
    left join public.ticket_types as ticket_type on ticket_type.id = reservation.ticket_type_id
    left join public.events as event on event.id = ticket_scoped.event_id
    group by reservation.ticket_type_id
    order by revenue desc, reservation.ticket_type_id
    limit 20
  )
  select jsonb_build_object(
    'daily', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', to_char(daily.kst_date, 'YYYY-MM-DD'),
          'orderCount', daily.order_count,
          'revenue', daily.revenue,
          -- 객단가는 정수 원 단위로 내린다. 소수점 원은 화면에서 의미가 없다.
          'averageOrderValue', (daily.revenue / greatest(daily.order_count, 1))::bigint
        )
        order by daily.kst_date
      )
      from daily
    ), '[]'::jsonb),
    'paymentMethods', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'method', methods.payment_method,
          'orderCount', methods.order_count,
          'revenue', methods.revenue
        )
        order by methods.revenue desc
      )
      from methods
    ), '[]'::jsonb),
    'goods', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'goodId', goods_rank.good_id,
          'name', goods_rank.name,
          'ipId', goods_rank.ip_id,
          'qty', goods_rank.qty,
          'revenue', goods_rank.revenue
        )
      )
      from goods_rank
    ), '[]'::jsonb),
    'tickets', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'eventId', tickets.event_id,
          'eventTitle', tickets.event_title,
          'orderCount', tickets.order_count,
          'ticketCount', tickets.ticket_count,
          'revenue', tickets.revenue
        )
      )
      from tickets
    ), '[]'::jsonb),
    'ticketOccurrences', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'ticketTypeId', ticket_occurrences.ticket_type_id,
          'occurrenceName', ticket_occurrences.occurrence_name,
          'eventTitle', ticket_occurrences.event_title,
          'ticketCount', ticket_occurrences.ticket_count,
          'revenue', ticket_occurrences.revenue
        )
      )
      from ticket_occurrences
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. 클레임
-- ---------------------------------------------------------------------------
-- 클레임율의 분모는 같은 기간의 결제 확정 주문수다. 접수 건수만 보면 판매가
-- 늘어난 달과 품질이 나빠진 달을 구분할 수 없다.
create function public.admin_claims_report(
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
  v_order_count bigint;
  v_result jsonb;
begin
  if not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_from is null or p_to is null or p_to <= p_from then
    raise invalid_parameter_value using message = 'invalid_report_range';
  end if;

  select count(*)
  into v_order_count
  from public.orders
  where orders.status = any (private.revenue_order_statuses())
    and orders.created_at >= p_from
    and orders.created_at < p_to;

  with scoped as (
    select
      request.id,
      request.claim_type,
      request.reason_type,
      request.stage,
      request.requested_at,
      request.completed_at
    from public.order_cancellation_requests as request
    where request.requested_at >= p_from
      and request.requested_at < p_to
  ),
  by_type as (
    select
      scoped.claim_type,
      count(*) as total,
      count(*) filter (where scoped.stage = 'completed') as completed,
      count(*) filter (where scoped.stage = 'rejected') as rejected,
      count(*) filter (where scoped.stage not in ('completed', 'rejected')) as open_count
    from scoped
    group by scoped.claim_type
  ),
  by_reason as (
    select
      scoped.claim_type,
      scoped.reason_type,
      count(*) as total
    from scoped
    group by scoped.claim_type, scoped.reason_type
  ),
  -- 환급 소요시간은 접수(requested_at)부터 환불 완료(completed_at)까지다.
  -- 배송·반품 정책이 약속한 "반환받은 날부터 3영업일"과 기산점이 다르므로
  -- 화면에서 SLA 준수율이라고 부르지 않고 접수→완료 소요로 적는다.
  refund_speed as (
    select
      count(*) as completed_count,
      avg(extract(epoch from (refund.completed_at - scoped.requested_at)) / 3600.0) as avg_hours,
      count(*) filter (
        where refund.completed_at - scoped.requested_at <= interval '72 hours'
      ) as within_72h
    from public.refunds as refund
    join scoped on scoped.id = refund.cancellation_request_id
    -- refunds.status는 'requested|done|failed'다. 'completed'는 클레임 stage의
    -- 값이라 여기서 쓰면 항상 0건이 된다.
    where refund.status = 'done'
      and refund.completed_at is not null
  )
  select jsonb_build_object(
    'orderCount', v_order_count,
    'claimCount', coalesce((select sum(by_type.total) from by_type), 0),
    'byType', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'claimType', by_type.claim_type,
          'total', by_type.total,
          'completed', by_type.completed,
          'rejected', by_type.rejected,
          'open', by_type.open_count,
          -- 분모가 0이면 비율이 아니라 null이다. 0%로 적으면 "클레임이 없다"로
          -- 읽히지만 실제로는 "판매가 없었다"이다.
          'ratePerMille', case
            when v_order_count = 0 then null
            else round((by_type.total::numeric / v_order_count) * 1000, 1)
          end
        )
        order by by_type.total desc, by_type.claim_type
      )
      from by_type
    ), '[]'::jsonb),
    'byReason', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'claimType', by_reason.claim_type,
          'reasonType', by_reason.reason_type,
          'total', by_reason.total
        )
        order by by_reason.claim_type, by_reason.total desc
      )
      from by_reason
    ), '[]'::jsonb),
    'refunds', (
      select jsonb_build_object(
        'completedCount', refund_speed.completed_count,
        'averageHours', case
          when refund_speed.avg_hours is null then null
          else round(refund_speed.avg_hours::numeric, 1)
        end,
        'within72h', refund_speed.within_72h
      )
      from refund_speed
    )
  )
  into v_result;

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. 고객현황
-- ---------------------------------------------------------------------------
create function public.admin_customer_report(
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
    )
  )
  into v_result;

  return v_result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. ACL
-- ---------------------------------------------------------------------------
revoke all on function public.admin_sales_report(timestamptz, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_sales_report(timestamptz, timestamptz, text)
  to authenticated;

revoke all on function public.admin_claims_report(timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_claims_report(timestamptz, timestamptz)
  to authenticated;

revoke all on function public.admin_customer_report(timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_customer_report(timestamptz, timestamptz)
  to authenticated;
