-- ============================================================================
-- ICONS · 운송장 등록·조회 (#178)
-- 어드민 수기 입력 경로만 연다. WMS 자동 수신은 물류 연동 사양 확인(#177) 뒤에
-- 붙인다 — 수기 필드는 사양과 무관하게 필요하고, 없으면 고객이 배송을 추적할 수
-- 없어 CS가 100% 수동이 된다.
-- ============================================================================

alter table public.orders
  add column shipping_carrier text,
  add column tracking_number text;

-- 택배사 코드는 앱의 SHIPPING_CARRIERS가 진실원이다. DB는 형식만 강제해
-- 택배사 추가에 마이그레이션이 필요 없게 둔다.
alter table public.orders
  add constraint orders_shipping_carrier_check
    check (shipping_carrier is null or shipping_carrier ~ '^[a-z0-9_]{2,32}$'),
  add constraint orders_tracking_number_check
    check (tracking_number is null or tracking_number ~ '^[A-Z0-9]{8,30}$'),
  -- 한쪽만 남으면 배송조회 링크를 만들 수 없다. 쌍으로만 존재하게 한다.
  add constraint orders_shipment_pairing_check
    check ((shipping_carrier is null) = (tracking_number is null));

-- 배송 상태 전이가 운송장을 함께 받는다. 인자가 늘어 기존 2-arg 시그니처는
-- 남겨두면 호출이 모호해지므로 제거한다.
drop function if exists public.admin_update_order_status(uuid, public.order_status);

create or replace function public.admin_update_order_status(
  p_order_id uuid,
  p_status public.order_status,
  p_carrier text,
  p_tracking_number text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_current_status public.order_status;
  v_current_carrier text;
  v_current_tracking text;
  v_carrier text := nullif(btrim(coalesce(p_carrier, '')), '');
  v_tracking text := nullif(btrim(coalesce(p_tracking_number, '')), '');
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  select orders.status, orders.shipping_carrier, orders.tracking_number
  into v_current_status, v_current_carrier, v_current_tracking
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order_not_found';
  end if;

  if p_status not in ('shipping', 'done') then
    raise check_violation using message = 'invalid_order_status';
  end if;

  if v_current_status = p_status then
    return;
  end if;

  if not (
    (v_current_status = 'paid' and p_status = 'shipping')
    or (v_current_status = 'shipping' and p_status = 'done')
  ) then
    raise exception using message = 'invalid_order_transition';
  end if;

  if exists (
    select 1
    from public.order_cancellation_requests as request
    where request.order_id = p_order_id
      and request.status in ('requested', 'processing', 'needs_review')
  ) then
    raise check_violation using message = 'order cancellation in progress';
  end if;

  -- 입력을 생략하면 이미 등록된 운송장을 유지한다. 배송 완료 전이가 송장을
  -- 조용히 지우지 않게 하는 장치다.
  v_carrier := coalesce(v_carrier, v_current_carrier);
  v_tracking := coalesce(v_tracking, v_current_tracking);

  if (v_carrier is null) <> (v_tracking is null) then
    raise check_violation using message = 'invalid_tracking_input';
  end if;

  -- 운송장 없이 배송을 시작하면 고객이 배송을 추적할 수 없다. fail closed한다.
  if p_status = 'shipping' and v_tracking is null then
    raise check_violation using message = 'tracking_required';
  end if;

  update public.orders
  set
    status = p_status,
    shipping_carrier = v_carrier,
    tracking_number = v_tracking
  where id = p_order_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.status_updated',
    'order:' || p_order_id::text,
    jsonb_build_object(
      'from', v_current_status::text,
      'to', p_status::text,
      'carrier', v_carrier,
      'trackingNumber', v_tracking
    )
  );
end;
$$;

revoke all on function public.admin_update_order_status(
  uuid, public.order_status, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_update_order_status(
  uuid, public.order_status, text, text
) to authenticated;

-- 송장 오등록 정정 경로. 상태를 움직이지 않고 값만 교체하며, 이전 값과 새 값을
-- 함께 감사 로그에 남겨 수정 이력을 추적 가능하게 한다.
create or replace function public.admin_update_order_tracking(
  p_order_id uuid,
  p_carrier text,
  p_tracking_number text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_current_status public.order_status;
  v_current_carrier text;
  v_current_tracking text;
  v_carrier text := nullif(btrim(coalesce(p_carrier, '')), '');
  v_tracking text := nullif(btrim(coalesce(p_tracking_number, '')), '');
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if v_carrier is null or v_tracking is null then
    raise check_violation using message = 'tracking_required';
  end if;

  select orders.status, orders.shipping_carrier, orders.tracking_number
  into v_current_status, v_current_carrier, v_current_tracking
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order_not_found';
  end if;

  -- 출고 전 주문에는 운송장이 없다. 배송이 시작된 주문만 정정 대상이다.
  if v_current_status not in ('shipping', 'done') then
    raise check_violation using message = 'order_not_shipped';
  end if;

  if v_current_carrier is not distinct from v_carrier
    and v_current_tracking is not distinct from v_tracking
  then
    return;
  end if;

  update public.orders
  set
    shipping_carrier = v_carrier,
    tracking_number = v_tracking
  where id = p_order_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.tracking_updated',
    'order:' || p_order_id::text,
    jsonb_build_object(
      'fromCarrier', v_current_carrier,
      'fromTrackingNumber', v_current_tracking,
      'toCarrier', v_carrier,
      'toTrackingNumber', v_tracking
    )
  );
end;
$$;

revoke all on function public.admin_update_order_tracking(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_update_order_tracking(uuid, text, text)
  to authenticated;

-- 어드민 목록도 운송장을 함께 읽는다. 반환 타입이 바뀌므로 drop 후 재생성한다.
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
