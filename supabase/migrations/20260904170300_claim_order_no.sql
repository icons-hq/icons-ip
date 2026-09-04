-- D-3 ④ — 클레임 화면도 같은 주문번호를 부른다 (설계서 v2 §1-3)
--
-- 목록 화면마다 다른 코드를 「주문번호」라고 부르면, 운영자가 클레임 큐에서 본 번호로
-- 주문 목록을 검색해도 나오지 않는다. 같은 이름은 어디서나 같은 값이어야 한다.

drop function if exists public.admin_search_order_claims(text, text, text, date, date, text, integer, integer);

CREATE OR REPLACE FUNCTION public.admin_search_order_claims(p_claim_type text DEFAULT NULL::text, p_stage text DEFAULT NULL::text, p_reason_type text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, reference bigint, order_id uuid, order_no text, claim_type text, stage text, reason_type text, buyer_id uuid, buyer_name text, buyer_email text, order_status order_status, order_total bigint, requested_at timestamp with time zone, collected_at timestamp with time zone, completed_at timestamp with time zone, refund_method text, handler_name text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    orders.order_no,
    request.claim_type,
    request.stage,
    request.reason_type,
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
    and (p_reason_type is null or request.reason_type = p_reason_type)
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
      or position(lower(v_query) in lower(orders.order_no)) > 0
      or position(lower(v_query) in lower(request.order_id::text)) > 0
      or position(lower(v_query) in lower(request.reference::text)) > 0
      or position(lower(v_query) in lower(coalesce(profile.email, ''))) > 0
      or position(lower(v_query) in lower(coalesce(profile.nickname, ''))) > 0
    )
  order by request.requested_at desc, request.id desc
  limit v_limit
  offset v_offset;
end;
$function$

;

revoke all on function public.admin_search_order_claims(text, text, text, date, date, text, integer, integer) from public, anon, service_role;
grant execute on function public.admin_search_order_claims(text, text, text, date, date, text, integer, integer) to authenticated;

-- 클레임 상세도 같은 번호를 싣는다.
CREATE OR REPLACE FUNCTION public.admin_order_claim_detail(p_claim_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_claim record;
  v_result jsonb;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  select request.*
  into v_claim
  from public.order_cancellation_requests as request
  where request.id = p_claim_id;

  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'claim', jsonb_build_object(
      'id', v_claim.id,
      'reference', v_claim.reference,
      'orderId', v_claim.order_id,
      'claimType', v_claim.claim_type,
      'stage', v_claim.stage,
      'status', v_claim.status,
      'reason', v_claim.reason,
      'reasonType', v_claim.reason_type,
      'decisionNote', v_claim.decision_note,
      'holdReason', v_claim.hold_reason,
      'heldAt', v_claim.held_at,
      -- 보류를 풀었을 때 돌아갈 단계. 화면이 이 값을 봐야 processing에서 건 보류에
      -- 거부 버튼을 그리지 않는다(DB의 claim_not_rejectable와 같은 판정).
      'heldFrom', v_claim.held_from,
      'requestedAt', v_claim.requested_at,
      'decidedAt', v_claim.decided_at,
      'collectingAt', v_claim.collecting_at,
      'collectedAt', v_claim.collected_at,
      'completedAt', v_claim.completed_at,
      'reshipCarrier', v_claim.reship_carrier,
      'reshipTrackingNumber', v_claim.reship_tracking_number,
      'reshippedAt', v_claim.reshipped_at,
      'lastErrorCode', v_claim.last_error_code,
      'handlerName', (
        select handler.nickname
        from public.profiles as handler
        where handler.id = v_claim.decided_by
      )
    ),
    'order', (
      select jsonb_build_object(
        'id', orders.id,
        'orderNo', orders.order_no,
        'status', orders.status,
        'total', orders.total,
        'shippingFee', orders.shipping_fee,
        'createdAt', orders.created_at,
        'deliveredAt', orders.delivered_at,
        'shippingCarrier', orders.shipping_carrier,
        'trackingNumber', orders.tracking_number,
        'buyerName', profile.nickname,
        'buyerEmail', profile.email,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', item.good_name_snapshot,
            'qty', item.qty,
            'unitPrice', item.unit_price
          ) order by item.id)
          from public.order_items as item
          where item.order_id = orders.id
        ), '[]'::jsonb)
      )
      from public.orders as orders
      join public.profiles as profile on profile.id = orders.user_id
      where orders.id = v_claim.order_id
    ),
    'payment', (
      select jsonb_build_object(
        'id', payment.id,
        'provider', payment.provider,
        'status', payment.status,
        'amount', payment.amount,
        'createdAt', payment.created_at
      )
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = v_claim.order_id
        and payment.status <> 'failed'
      order by payment.created_at desc, payment.id desc
      limit 1
    ),
    'refund', (
      select jsonb_build_object(
        'status', refund.status,
        'amount', refund.amount,
        'method', refund.method,
        'filedAt', refund.filed_at,
        'completedAt', refund.completed_at,
        'settlementNote', refund.settlement_note,
        'handlerName', (
          select handler.nickname
          from public.profiles as handler
          where handler.id = refund.handled_by
        )
      )
      from public.refunds as refund
      join public.payments as payment on payment.id = refund.payment_id
      where payment.purpose = 'order'
        and payment.ref_id = v_claim.order_id
      order by refund.created_at desc, refund.id desc
      limit 1
    ),
    -- 뽑기권 발급/사용 여부. 취소·반품 완료 시 회수 대상이 남아 있는지를
    -- 운영자가 승인 전에 봐야 한다(약관 제17조).
    'cardPacks', (
      select jsonb_build_object(
        'issued', count(*),
        'consumed', count(*) filter (where ticket.consumed_at is not null),
        'revoked', count(*) filter (where ticket.revoked_at is not null)
      )
      from public.draw_tickets as ticket
      where ticket.source = 'order_paid'
        and ticket.source_id = v_claim.order_id
    ),
    'refundAccount', (
      select jsonb_build_object(
        'maskedAccount', account.masked_account,
        'maskedHolder', account.masked_holder,
        'purgeAfter', account.purge_after,
        'purgedAt', account.purged_at
      )
      from private.claim_refund_accounts as account
      where account.claim_id = v_claim.id
    ),
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object(
        'action', entry.action,
        'createdAt', entry.created_at,
        'diff', entry.diff,
        'actorName', (
          select actor.nickname
          from public.profiles as actor
          where actor.id = entry.actor_id
        )
      ) order by entry.created_at, entry.id)
      from public.audit_log as entry
      where entry.target = 'order:' || v_claim.order_id::text
        -- 레거시 감사 액션(admin.order.cancellation_*)도 같은 클레임의 이력이다.
        -- 'claim'만 찾으면 #252 이전 경로로 처리된 건의 타임라인이 비어 보인다.
        and (entry.action like '%claim%' or entry.action like '%cancellation%')
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$

;
