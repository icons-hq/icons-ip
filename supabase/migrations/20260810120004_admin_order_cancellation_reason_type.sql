-- ============================================================================
-- ICONS · 어드민 주문 콘솔의 청약철회 사유 노출 (#196)
-- #189로 요청이 사유 구분(reason_type)을 갖게 됐지만 어드민 목록은 그 값을
-- 돌려주지 않았다. 승인 감사 로그에만 남아 사후 추적은 되고 판단 시점에는
-- 보이지 않는 상태였다.
--
-- 사유는 기한(변심 7일 · 하자 3개월)뿐 아니라 반품 배송비 부담 주체까지
-- 가른다. 운영자가 승인·거절을 누르는 화면에 없으면 판단 근거가 없다.
--
-- 자유 서술 사유(reason)는 계속 반환하지 않는다. 운영 판단에 필요한 것은
-- 분류값이고, 본문은 요청자가 무엇이든 적을 수 있는 필드다.
-- 반환 타입이 바뀌므로 drop 후 재생성한다.
-- ============================================================================

drop function if exists public.admin_search_orders(text, date, date, text, integer, integer);

create or replace function public.admin_search_orders(
  p_status text default null,
  p_from date default null,
  p_to date default null,
  p_query text default null,
  p_limit integer default 20,
  p_offset integer default 0
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
  cancellation_request_id uuid,
  cancellation_request_status text,
  cancellation_reason_type text,
  cancellation_requested_at timestamptz,
  cancellation_decided_at timestamptz,
  cancellation_decision_note text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
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
    orders.shipping_carrier,
    orders.tracking_number,
    cancellation.id as cancellation_request_id,
    cancellation.status as cancellation_request_status,
    cancellation.reason_type as cancellation_reason_type,
    cancellation.requested_at as cancellation_requested_at,
    cancellation.decided_at as cancellation_decided_at,
    cancellation.decision_note as cancellation_decision_note,
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
      request.decision_note
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
    and (
      v_query is null
      or position(lower(v_query) in lower(orders.id::text)) > 0
      or position(lower(v_query) in lower(coalesce(profile.email, ''))) > 0
      or position(lower(v_query) in lower(coalesce(profile.nickname, ''))) > 0
    )
  order by orders.created_at desc, orders.id desc
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.admin_search_orders(text, date, date, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_search_orders(text, date, date, text, integer, integer)
  to authenticated;
