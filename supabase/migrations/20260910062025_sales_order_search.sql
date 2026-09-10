-- #466: 주문 통합검색에서 검색 원장을 선택하고 배송 건 운송장·수취인을 조회한다.
-- 검색은 주문 행을 기준으로 유지한다. order_shipments를 직접 join하면 한 주문에
-- 여러 배송 건이 있을 때 행·total_count·페이지 오프셋이 모두 중복될 수 있으므로
-- 수취인과 운송장은 EXISTS 조건으로만 연결한다.

drop function if exists public.admin_search_orders(
  text, date, date, text, integer, integer, timestamptz
);

create function public.admin_search_orders(
  p_status text default null,
  p_from date default null,
  p_to date default null,
  p_query text default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_confirmed_before timestamptz default null,
  p_field text default 'all'
)
returns table (
  id uuid,
  user_id uuid,
  buyer_name text,
  buyer_email text,
  status public.order_status,
  total bigint,
  address jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  shipping_carrier text,
  tracking_number text,
  confirmed_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  done_at timestamptz,
  cancellation_request_id uuid,
  cancellation_request_status text,
  cancellation_reason_type text,
  cancellation_requested_at timestamptz,
  cancellation_decided_at timestamptz,
  cancellation_decision_note text,
  cancellation_claim_type text,
  cancellation_stage text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_field text := coalesce(nullif(btrim(p_field), ''), 'all');
  -- 운송장 입력은 저장 시 하이픈·공백을 제거한다. 고객이 택배사에서
  -- 복사한 표기(1234-5678)를 그대로 붙여도 같은 배송 건을 찾게 한다.
  v_tracking_query text := nullif(
    regexp_replace(lower(coalesce(p_query, '')), '[[:space:]-]', '', 'g'),
    ''
  );
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_status is not null
    and not exists (
      select 1
      from unnest(enum_range(null::public.order_status)) as allowed(value)
      where allowed.value::text = p_status
    )
  then
    raise check_violation using message = 'invalid order status filter';
  end if;

  if v_field not in ('all', 'order', 'nickname', 'email', 'recipient', 'tracking') then
    raise check_violation using message = 'invalid order search field';
  end if;

  if p_from is not null and p_to is not null and p_from > p_to then
    raise check_violation using message = 'invalid order date range';
  end if;

  if v_query is not null and length(v_query) > 100 then
    raise check_violation using message = 'order search query too long';
  end if;

  return query
  select
    orders.id,
    orders.user_id,
    profile.nickname as buyer_name,
    profile.email as buyer_email,
    orders.status,
    orders.total,
    orders.address,
    orders.created_at,
    orders.updated_at,
    (select max(s.carrier)
     from public.order_shipments as s
     where s.order_id = orders.id
     having count(*) = 1),
    (select max(s.tracking_number)
     from public.order_shipments as s
     where s.order_id = orders.id
     having count(*) = 1),
    orders.confirmed_at,
    orders.shipped_at,
    orders.delivered_at,
    orders.done_at,
    cancellation.id as cancellation_request_id,
    cancellation.status as cancellation_request_status,
    cancellation.reason_type as cancellation_reason_type,
    cancellation.requested_at as cancellation_requested_at,
    cancellation.decided_at as cancellation_decided_at,
    cancellation.decision_note as cancellation_decision_note,
    cancellation.claim_type as cancellation_claim_type,
    cancellation.stage as cancellation_stage,
    count(*) over()::bigint as total_count
  from public.orders as orders
  join public.profiles as profile on profile.id = orders.user_id
  left join lateral (
    select
      request.id,
      request.status,
      request.reason_type,
      request.requested_at,
      request.decided_at,
      request.decision_note,
      request.claim_type,
      request.stage
    from public.order_cancellation_requests as request
    where request.order_id = orders.id
    order by request.requested_at desc, request.id desc
    limit 1
  ) as cancellation on true
  where (p_status is null or orders.status::text = p_status)
    and (
      p_from is null
      or orders.created_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    )
    and (
      p_to is null
      or orders.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
    )
    -- 발주확인 기록이 없는 주문은 지연 목록에 넣지 않는다.
    and (p_confirmed_before is null or orders.confirmed_at < p_confirmed_before)
    and (
      v_query is null
      or (
        v_field = 'all'
        and (
          position(lower(v_query) in lower(orders.id::text)) > 0
          or position(lower(v_query) in lower(coalesce(profile.nickname, ''))) > 0
          or position(lower(v_query) in lower(coalesce(profile.email, ''))) > 0
          or position(lower(v_query) in lower(coalesce(orders.address ->> 'recipientName', ''))) > 0
          or exists (
            select 1
            from public.order_shipments as shipment
            where shipment.order_id = orders.id
              and position(v_tracking_query in lower(coalesce(shipment.tracking_number, ''))) > 0
          )
        )
      )
      or (v_field = 'order' and position(lower(v_query) in lower(orders.id::text)) > 0)
      or (v_field = 'nickname' and position(lower(v_query) in lower(coalesce(profile.nickname, ''))) > 0)
      or (v_field = 'email' and position(lower(v_query) in lower(coalesce(profile.email, ''))) > 0)
      or (v_field = 'recipient' and position(lower(v_query) in lower(coalesce(orders.address ->> 'recipientName', ''))) > 0)
      or (
        v_field = 'tracking'
        and v_tracking_query is not null
        and exists (
          select 1
          from public.order_shipments as shipment
          where shipment.order_id = orders.id
            and position(v_tracking_query in lower(coalesce(shipment.tracking_number, ''))) > 0
        )
      )
    )
  order by orders.created_at desc, orders.id desc
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.admin_search_orders(
  text, date, date, text, integer, integer, timestamptz, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_orders(
  text, date, date, text, integer, integer, timestamptz, text
) to authenticated;
