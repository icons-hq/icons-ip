-- ============================================================================
-- 운영자 전액 취소를 구매자 단순 변심과 구분해 남기고 보여준다
-- (2026-10-12 브라우저 QA QA-4·QA-10, ADR-0018)
--
-- 20261013110200은 운영자 전액 취소 요청의 reason_type을 'change_of_mind'로 적었다.
-- reason_type은 구매자의 청약철회 사유(단순 변심 7일·하자 3개월, 반송비 부담 주체)를
-- 가르는 값이라, 운영자가 품절·테스트 결제 정리로 연 취소가 클레임 목록·상세·주문
-- 패널·사유 필터·통계에 전부 "단순 변심"으로 나왔다. 운영 사유는 '요청 내용' 문자열에만
-- 있었다.
--
-- 이 migration은:
--   1. reason_type에 'staff'(운영자 전액 취소)를 더하고, 발원이 staff인 요청만 그 값을
--      갖게 묶는다. 이미 만들어진 운영자 요청을 바로잡는다.
--   2. 운영자 전액 취소 시작 RPC가 'staff'로 적게 한다.
--   3. 운영 읽기 RPC(클레임 목록·상세·주문 통합검색·클레임 통계)가 운영 사유 코드를
--      함께 싣고, 클레임 목록 사유 필터가 운영 사유로 거를 수 있게 한다.
--   4. 주문 통합검색이 최근 요청의 정합화 오류 코드(last_error_code)를 함께 싣는다.
--      주문 패널의 재시도 결과·취소 요청 영역에서 원인 코드를 볼 수 있어야 런북의
--      코드별 조치를 따를 수 있다(QA-10).
--
-- 구매자 직접 신청(request_order_claim)은 계속 change_of_mind·defect만 받는다.
-- 'staff'는 구매자 컬럼 grant로 읽히지만 "운영자가 시작한 취소"라는 사실은 구매자 알림이
-- 이미 알린다. 운영 사유 코드·메모·처리자는 계속 구매자 grant 밖이다.
--
-- 재정의 함수는 최신 정의를 복사해 위 차이만 넣었다:
--   admin_start_order_cancellation ← 20261013110200:99
--   admin_search_order_claims       ← 20260820090000:17
--   admin_search_orders             ← 20260910062025:10
--   admin_order_claim_detail        ← 20260910083942:197 (wrapper)
--   admin_claims_report             ← 20260818160000:223
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. reason_type 'staff'
-- ---------------------------------------------------------------------------
alter table public.order_cancellation_requests
  drop constraint order_cancellation_requests_reason_type_check;

-- 값 정정만 하는 backfill이다. 운영 행위가 아니므로 updated_at을 움직이지 않는다
-- (20260909001505의 metadata backfill과 같은 방식).
alter table public.order_cancellation_requests disable trigger trg_order_cancellation_requests_updated;
update public.order_cancellation_requests
set reason_type = 'staff'
where origin = 'staff'
  and reason_type is distinct from 'staff';
alter table public.order_cancellation_requests enable trigger trg_order_cancellation_requests_updated;

alter table public.order_cancellation_requests
  add constraint order_cancellation_requests_reason_type_check
  check (reason_type in ('change_of_mind', 'defect', 'staff'));

-- 운영자 전액 취소 사유는 운영자 발원 요청에만 있고, 운영자 발원 요청은 늘 그 값이다.
alter table public.order_cancellation_requests
  add constraint order_cancellation_requests_staff_reason_type
  check ((origin = 'staff') = (reason_type = 'staff'));

-- ---------------------------------------------------------------------------
-- 2. 운영자 전액 취소 시작 — reason_type = 'staff'
-- ---------------------------------------------------------------------------
create or replace function public.admin_start_order_cancellation(
  p_order_id uuid,
  p_reason_code text,
  p_note text,
  p_warehouse_stop_confirmed boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_order public.orders%rowtype;
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_request_id uuid;
  v_exported_count integer;
  v_payment_count integer;
  v_reason_label text;
  v_notice text;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_reason_code is null
    or p_reason_code not in ('out_of_stock', 'customer_request', 'test_payment_cleanup', 'other')
  then
    raise check_violation using message = 'invalid_staff_cancellation_reason';
  end if;

  if (v_note is not null and (
        char_length(v_note) > 500
        or pg_catalog.translate(v_note, E'\n\r\t', '') ~ '[[:cntrl:]]'
      ))
    or (p_reason_code = 'other' and (v_note is null or char_length(v_note) < 5))
  then
    raise check_violation using message = 'invalid_staff_cancellation_note';
  end if;

  -- 공통 잠금 순서: order → shipments → request → attempts → payments.
  select order_record.*
  into v_order
  from public.orders as order_record
  where order_record.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order_not_found';
  end if;

  perform shipment.id
  from public.order_shipments as shipment
  where shipment.order_id = p_order_id
  order by shipment.id
  for update;

  if v_order.status not in ('paid', 'confirmed')
    or v_order.shipped_at is not null
    or v_order.delivered_at is not null
    or v_order.done_at is not null
  then
    raise check_violation using message = 'order_not_staff_cancelable';
  end if;

  if exists (
    select 1
    from public.order_shipments as shipment
    where shipment.order_id = p_order_id
      and (
        shipment.status not in ('ready', 'canceled')
        or shipment.shipped_at is not null
        or shipment.delivered_at is not null
      )
  ) then
    raise check_violation using message = 'shipment_already_dispatched';
  end if;

  select pg_catalog.count(*)::integer
  into v_exported_count
  from public.order_shipments as shipment
  where shipment.order_id = p_order_id
    and shipment.status = 'ready'
    and shipment.exported_at is not null;

  if v_exported_count > 0 and p_warehouse_stop_confirmed is distinct from true then
    raise check_violation using message = 'warehouse_stop_confirmation_required';
  end if;

  if exists (
    select 1
    from public.order_cancellation_requests as request
    where request.order_id = p_order_id
      and request.status in ('requested', 'processing', 'needs_review')
  ) or exists (
    select 1
    from public.order_cancellation_claims as claim
    where claim.order_id = p_order_id
  ) then
    raise check_violation using message = 'order_claim_in_progress';
  end if;

  perform attempt.id
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = p_order_id
  order by attempt.id
  for update;

  if exists (
    select 1
    from public.payment_attempts as attempt
    where attempt.purpose = 'order'
      and attempt.ref_id = p_order_id
      and attempt.state in ('prepared', 'confirming', 'unknown', 'needs_review')
  ) then
    raise check_violation using message = 'payment_reconciliation_required';
  end if;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
  order by payment.id
  for update;

  /*
   * 이 경로가 결제사 취소까지 닫을 수 있는 결제만 받는다.
   *
   * 토스 결제는 서버 오케스트레이터가 전액 취소를 발행하고 fresh 조회로 검증한다.
   * Korpay(취소 API 없음)와 무통장(계좌 송금 종결 미구현, #279·#280·#281)은 이
   * 경로로 열면 결제확인필요에 영구히 갇히므로 시작 자체를 거절한다.
   */
  select pg_catalog.count(*)::integer
  into v_payment_count
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
    and payment.status <> 'failed';

  if v_payment_count = 0 or exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = p_order_id
      and payment.status <> 'failed'
      and (
        payment.provider <> 'toss'
        or payment.status <> 'paid'
        or nullif(pg_catalog.btrim(payment.payment_key), '') is null
      )
  ) then
    raise check_violation using message = 'staff_cancellation_toss_only';
  end if;

  v_reason_label := case p_reason_code
    when 'out_of_stock' then '품절·출고 불가'
    when 'customer_request' then '고객 요청(CS 접수)'
    when 'test_payment_cleanup' then '테스트 결제 정리'
    else '기타'
  end;

  insert into public.order_cancellation_requests (
    order_id,
    requested_by,
    reason,
    reason_type,
    claim_type,
    stage,
    origin,
    staff_reason_code,
    staff_note,
    initiated_by,
    warehouse_stop_confirmed,
    decided_by,
    decided_at,
    provider_started_at
  )
  values (
    p_order_id,
    v_order.user_id,
    '운영자 전액 취소 · ' || v_reason_label,
    'staff',
    'cancel',
    'processing',
    'staff',
    p_reason_code,
    v_note,
    v_actor,
    v_exported_count > 0,
    v_actor,
    pg_catalog.now(),
    pg_catalog.now()
  )
  returning id into v_request_id;

  insert into public.order_cancellation_claims (order_id, requested_by, previous_status)
  values (p_order_id, v_order.user_id, v_order.status)
  on conflict (order_id) do nothing;

  insert into public.refunds (payment_id, amount, reason, status, cancellation_request_id)
  select
    payment.id,
    payment.amount,
    '운영자 전액 취소 · ' || v_reason_label,
    'requested',
    v_request_id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
    and payment.status = 'paid'
  on conflict (payment_id) do update
  set
    cancellation_request_id = excluded.cancellation_request_id,
    reason = coalesce(public.refunds.reason, excluded.reason),
    status = case when public.refunds.status = 'done' then 'done' else 'requested' end;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.order.staff_cancellation_started',
    'order:' || p_order_id::text,
    pg_catalog.jsonb_build_object(
      'claimId', v_request_id,
      'claimType', 'cancel',
      'to', 'processing',
      'reasonCode', p_reason_code,
      'note', v_note,
      'previousOrderStatus', v_order.status::text,
      'exportedShipmentCount', v_exported_count,
      'warehouseStopConfirmed', v_exported_count > 0,
      'paymentCount', v_payment_count
    )
  );

  v_notice := case p_reason_code
    when 'out_of_stock' then '판매자 사정(품절·출고 불가)으로 주문 전체를 취소하고 결제 금액 전액을 환불합니다.'
    when 'customer_request' then '요청하신 주문 취소를 접수해 주문 전체를 취소하고 결제 금액 전액을 환불합니다.'
    when 'test_payment_cleanup' then '테스트 결제로 만들어진 주문이라 주문 전체를 취소하고 결제를 취소합니다.'
    else '주문 전체를 취소하고 결제 금액 전액을 환불합니다. 자세한 사유는 고객센터로 문의해주세요.'
  end;

  perform private.notify_order_claim(
    v_request_id,
    'staff_cancel_started',
    '주문 취소를 진행해요',
    v_notice
  );

  return v_request_id;
end;
$function$;

revoke all on function public.admin_start_order_cancellation(uuid, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_start_order_cancellation(uuid, text, text, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3. 클레임 목록 — 운영 사유 코드와 사유 필터
-- ---------------------------------------------------------------------------
-- 반환 테이블이 바뀌어 drop 후 재생성한다. 인자 시그니처는 그대로다.
drop function if exists public.admin_search_order_claims(
  text, text, text, date, date, text, integer, integer
);

create function public.admin_search_order_claims(
  p_claim_type text default null,
  p_stage text default null,
  p_reason_type text default null,
  p_from date default null,
  p_to date default null,
  p_query text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  reference bigint,
  order_id uuid,
  claim_type text,
  stage text,
  reason_type text,
  staff_reason_code text,
  buyer_id uuid,
  buyer_name text,
  buyer_email text,
  order_status public.order_status,
  order_total bigint,
  requested_at timestamptz,
  collected_at timestamptz,
  completed_at timestamptz,
  refund_method text,
  handler_name text,
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
  v_stages text[];
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_claim_type is not null and p_claim_type not in ('cancel', 'return', 'exchange') then
    raise check_violation using message = 'invalid claim type filter';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise check_violation using message = 'invalid claim date range';
  end if;
  if v_query is not null and length(v_query) > 100 then
    raise check_violation using message = 'claim search query too long';
  end if;
  -- 사유 필터: 구매자 사유(change_of_mind·defect), 운영자 전액 취소 전체(staff),
  -- 운영자 전액 취소의 사유 하나(staff:<사유 코드>). 모르는 값은 빈 목록이 아니라 거절한다.
  if p_reason_type is not null and p_reason_type not in (
    'change_of_mind', 'defect', 'staff',
    'staff:out_of_stock', 'staff:customer_request', 'staff:test_payment_cleanup', 'staff:other'
  ) then
    raise check_violation using message = 'invalid claim reason filter';
  end if;

  -- 'open'은 단계 하나가 아니라 "아직 끝나지 않은 것 전부"다. 화면이 이 집합을
  -- 직접 나열하면 단계를 하나 더할 때 목록에서만 조용히 빠진다.
  if p_stage = 'open' then
    v_stages := array[
      'requested', 'in_review', 'collecting', 'collected',
      'on_hold', 'processing', 'needs_review'
    ];
  elsif p_stage is not null then
    v_stages := array[p_stage];
  end if;

  return query
  select
    request.id,
    request.reference,
    request.order_id,
    request.claim_type,
    request.stage,
    request.reason_type,
    request.staff_reason_code,
    orders.user_id as buyer_id,
    profile.nickname as buyer_name,
    profile.email as buyer_email,
    orders.status as order_status,
    orders.total as order_total,
    request.requested_at,
    request.collected_at,
    request.completed_at,
    refund.method as refund_method,
    handler.nickname as handler_name,
    count(*) over()::bigint as total_count
  from public.order_cancellation_requests as request
  join public.orders as orders on orders.id = request.order_id
  join public.profiles as profile on profile.id = orders.user_id
  left join public.profiles as handler on handler.id = request.decided_by
  left join lateral (
    select payment_refund.method
    from public.refunds as payment_refund
    join public.payments as payment on payment.id = payment_refund.payment_id
    where payment.purpose = 'order'
      and payment.ref_id = request.order_id
    order by payment_refund.created_at desc, payment_refund.id desc
    limit 1
  ) as refund on true
  where (p_claim_type is null or request.claim_type = p_claim_type)
    and (v_stages is null or request.stage = any(v_stages))
    and (
      p_reason_type is null
      or (p_reason_type not like 'staff:%' and request.reason_type = p_reason_type)
      or (
        p_reason_type like 'staff:%'
        and request.reason_type = 'staff'
        and request.staff_reason_code = substr(p_reason_type, 7)
      )
    )
    and (
      p_from is null
      or request.requested_at >= (p_from::timestamp at time zone 'Asia/Seoul')
    )
    and (
      p_to is null
      or request.requested_at < ((p_to + 1)::timestamp at time zone 'Asia/Seoul')
    )
    and (
      v_query is null
      or position(lower(v_query) in lower(request.order_id::text)) > 0
      or position(lower(v_query) in lower(request.reference::text)) > 0
      or position(lower(v_query) in lower(coalesce(profile.email, ''))) > 0
      or position(lower(v_query) in lower(coalesce(profile.nickname, ''))) > 0
    )
  order by request.requested_at desc, request.id desc
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.admin_search_order_claims(
  text, text, text, date, date, text, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_order_claims(
  text, text, text, date, date, text, integer, integer
) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. 주문 통합검색 — 최근 요청의 운영 사유 코드와 정합화 오류 코드
-- ---------------------------------------------------------------------------
-- 반환 테이블이 바뀌어 drop 후 재생성한다. 인자 시그니처는 그대로다.
drop function if exists public.admin_search_orders(
  text, date, date, text, integer, integer, timestamptz, text
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
  cancellation_staff_reason_code text,
  cancellation_last_error_code text,
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
    cancellation.staff_reason_code as cancellation_staff_reason_code,
    cancellation.last_error_code as cancellation_last_error_code,
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
      request.stage,
      request.staff_reason_code,
      request.last_error_code
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

-- ---------------------------------------------------------------------------
-- 5. 클레임 상세 — 발원과 운영 사유
-- ---------------------------------------------------------------------------
create or replace function public.admin_order_claim_detail(p_claim_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid := (select auth.uid());
  detail jsonb;
  fee public.order_cancellation_requests;
begin
  if actor is null or not public.is_staff() then raise insufficient_privilege using message = 'staff_required'; end if;
  detail := private.admin_order_claim_detail_before_operational_fee(p_claim_id);
  if detail is null then return null; end if;
  select * into fee from public.order_cancellation_requests where id = p_claim_id;
  return detail || jsonb_build_object('claim', (detail->'claim') || jsonb_build_object(
    'operationalFee', jsonb_build_object(
      'kind', fee.operational_fee_kind,
      'amount', fee.operational_fee_amount,
      'note', fee.operational_fee_note,
      'evidence', fee.operational_fee_evidence,
      'confirmedBy', fee.operational_fee_confirmed_by,
      'confirmedAt', fee.operational_fee_confirmed_at,
      'updatedAt', fee.updated_at
    ),
    'updatedAt', fee.updated_at,
    -- 운영자 전액 취소(ADR-0018)의 발원과 운영 사유. 구매자 컬럼 grant 밖의 운영 정보라
    -- staff 게이트가 붙은 이 RPC로만 싣는다.
    'origin', fee.origin,
    'staffReasonCode', fee.staff_reason_code,
    'staffNote', fee.staff_note
  ));
end;
$$;
revoke all on function public.admin_order_claim_detail(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_claim_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. 클레임 통계 — 운영자 전액 취소를 운영 사유별로
-- ---------------------------------------------------------------------------
create or replace function public.admin_claims_report(
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
      request.staff_reason_code,
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
  -- 운영자 전액 취소는 운영 사유별로 나눈다. 구매자 사유 행의 staff_reason_code는
  -- 항상 null이라 기존 묶음은 그대로다.
  by_reason as (
    select
      scoped.claim_type,
      scoped.reason_type,
      scoped.staff_reason_code,
      count(*) as total
    from scoped
    group by scoped.claim_type, scoped.reason_type, scoped.staff_reason_code
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
          'staffReasonCode', by_reason.staff_reason_code,
          'total', by_reason.total
        )
        order by by_reason.claim_type, by_reason.total desc, by_reason.reason_type,
          by_reason.staff_reason_code nulls first
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

revoke all on function public.admin_claims_report(timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_claims_report(timestamptz, timestamptz)
  to authenticated;
