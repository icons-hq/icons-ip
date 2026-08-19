-- ============================================================================
-- ICONS · 발송지연 메모와 지연 조회 (#251)
--
-- 발송지연은 **상태가 아니다**. 자사몰이라 지연에 붙는 페널티가 없고, 사다리에
-- `delayed` 칸을 만들면 발주확인→발송 사이에 되돌려야 하는 전이가 하나 늘어난다.
-- v1이 필요한 것은 두 가지뿐이다.
--
--   1. 지표 — 발주확인 후 N일이 지난 주문이 몇 건인가
--   2. 메모 — 왜 늦었고 언제 나가는가 (운영 기록)
--
-- 1은 orders.confirmed_at 조회로 충분하므로 컬럼을 더하지 않고
-- admin_search_orders에 조건만 연다. 2는 주문 행에 섞으면 "지연 사유"가 주문의
-- 속성처럼 보이므로 별도 테이블에 둔다 — 지연이 해소되면 행 자체가 사라진다.
--
-- 고객에게 노출하지 않는다. 지연 고지는 문구·기한·법적 함의가 따로 있는 별개
-- 결정이고(#248 후속), 운영 메모를 그대로 띄우는 것은 그 결정을 건너뛰는 것이다.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 지연 메모
-- ---------------------------------------------------------------------------
create table if not exists public.order_dispatch_delays (
  order_id uuid primary key references public.orders (id) on delete cascade,
  reason text not null,
  -- 발송 예정일. 모르면 비운다 — 지어낸 날짜는 CS에서 그대로 약속이 된다.
  expected_ship_date date,
  noted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_dispatch_delays_reason_check
    check (btrim(reason) <> '' and length(reason) <= 500)
);

drop trigger if exists order_dispatch_delays_touch on public.order_dispatch_delays;
create trigger order_dispatch_delays_touch
  before update on public.order_dispatch_delays
  for each row execute function public.set_updated_at();

alter table public.order_dispatch_delays enable row level security;

-- 운영 기록이다. 구매자에게는 읽히지 않는다.
drop policy if exists order_dispatch_delays_staff_read on public.order_dispatch_delays;
create policy order_dispatch_delays_staff_read on public.order_dispatch_delays
  for select using ((select public.is_staff()));

-- 쓰기 정책은 두지 않는다. 감사 로그를 남기는 RPC만이 유일한 입구다.
grant select on public.order_dispatch_delays to authenticated;

-- ---------------------------------------------------------------------------
-- 2. 메모 등록·해제
-- ---------------------------------------------------------------------------
-- 사유를 비워 부르면 메모를 지운다. "지연이 풀렸다"를 표현할 방법이 없으면
-- 운영자는 사유를 '해결'로 덮어쓰고, 그러면 지연 목록이 영원히 줄지 않는다.
create or replace function public.admin_upsert_order_dispatch_delay(
  p_order_id uuid,
  p_reason text,
  p_expected_ship_date date
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := (select auth.uid());
  v_status public.order_status;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  select orders.status into v_status
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order_not_found';
  end if;

  -- 발송 전 주문에만 붙는 메모다. 이미 나간 주문의 "지연 사유"는 기록이 아니라 혼선이다.
  if v_status not in ('paid', 'confirmed') then
    raise check_violation using message = 'order_already_dispatched';
  end if;

  if v_reason is null then
    delete from public.order_dispatch_delays where order_id = p_order_id;

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      v_actor,
      'admin.order.dispatch_delay_cleared',
      'order:' || p_order_id::text,
      jsonb_build_object('status', v_status::text)
    );
    return;
  end if;

  insert into public.order_dispatch_delays (order_id, reason, expected_ship_date, noted_by)
  values (p_order_id, v_reason, p_expected_ship_date, v_actor)
  on conflict (order_id) do update set
    reason = excluded.reason,
    expected_ship_date = excluded.expected_ship_date,
    noted_by = excluded.noted_by;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.dispatch_delay_noted',
    'order:' || p_order_id::text,
    jsonb_build_object(
      'reason', v_reason,
      'expectedShipDate', p_expected_ship_date,
      'status', v_status::text
    )
  );
end;
$$;

revoke all on function public.admin_upsert_order_dispatch_delay(uuid, text, date)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_order_dispatch_delay(uuid, text, date)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. 발주확인 시점 필터
-- ---------------------------------------------------------------------------
-- 발송지연 목록은 "confirmed이면서 발주확인이 N일 이상 지난 주문"이다. 목록은
-- 페이지네이션되므로 앱에서 가져온 뒤 걸러내면 건수와 페이지가 전부 어긋난다.
-- 조건은 DB에 있어야 한다.
--
-- 경계값은 앱이 절대 시각으로 넘긴다. 며칠을 지연으로 볼지는 운영 정책이고
-- (지금은 3일), 정책 상수가 DB 함수 안에 박히면 바꿀 때마다 마이그레이션이 든다.
--
-- 기본값 null이라 기존 6-인자 호출은 그대로 동작한다. 반환 타입은 그대로지만
-- 인자가 늘어 시그니처가 바뀌므로 drop 후 재생성한다(20260818090001 선례).
drop function if exists public.admin_search_orders(text, date, date, text, integer, integer);

create or replace function public.admin_search_orders(
  p_status text default null,
  p_from date default null,
  p_to date default null,
  p_query text default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_confirmed_before timestamptz default null
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
    -- 발주확인 기록이 없는 주문은 지연 목록에 넣지 않는다. confirmed_at이 비어
    -- 있다는 것은 사다리 도입 전 행이라는 뜻이고, 없는 기산점으로 "지연"이라고
    -- 부르면 운영자가 실제로 늦은 주문을 못 찾는다.
    and (p_confirmed_before is null or orders.confirmed_at < p_confirmed_before)
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

revoke all on function public.admin_search_orders(
  text, date, date, text, integer, integer, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_orders(
  text, date, date, text, integer, integer, timestamptz
) to authenticated;
