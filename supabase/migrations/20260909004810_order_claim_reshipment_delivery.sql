-- #453 / ADR-0017: a replacement's dispatch is not proof of its delivery.
-- These are new observations; never backfill an actual receipt from old tracking
-- or change the original order's delivery date, withdrawal window or ledgers.
alter table public.order_cancellation_requests
  add column reship_delivered_at timestamptz,
  add column reship_delivered_by uuid references public.profiles(id) on delete restrict,
  add column reship_delivery_evidence text,
  add constraint order_claim_reshipment_delivery_evidence check (
    (reship_delivered_at is null and reship_delivered_by is null and reship_delivery_evidence is null)
    or (reship_delivered_at is not null and reship_delivered_by is not null
      and reship_delivery_evidence is not null
      and reship_delivery_evidence=btrim(reship_delivery_evidence)
      and char_length(reship_delivery_evidence) between 1 and 500
      and translate(reship_delivery_evidence,E'\n\r\t','') !~ '[[:cntrl:]]'
      and claim_type='exchange' and stage='completed' and reshipped_at is not null
      and reship_carrier is not null and reship_tracking_number is not null
      and reship_delivered_at>=reshipped_at)
  );

-- Customer rows remain protected by the existing owner/staff policy. Only the
-- date is a customer field; staff identity and free-text evidence use the RPC.
revoke all (reship_delivered_at,reship_delivered_by,reship_delivery_evidence)
  on public.order_cancellation_requests from public,anon,authenticated,service_role;
grant select(reship_delivered_at) on public.order_cancellation_requests to authenticated;

create or replace function private.order_all_items_delivered(target_order uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.orders o where o.id=target_order and o.status in ('delivered','done'))
    and exists(select 1 from public.order_items i where i.order_id=target_order)
    and not exists(select 1 from public.order_items i where i.order_id=target_order and
      coalesce((select sum(link.qty) from public.order_shipment_items link
        join public.order_shipments s on s.id=link.shipment_id
        where link.order_item_id=i.id and link.order_id=i.order_id
          and s.status='delivered' and s.delivered_at is not null),0)<>i.qty)
    -- Every completed exchange represents a whole-order replacement. Unknown
    -- historical receipts stay unknown, and any new replacement closes intake.
    and not exists(select 1 from public.order_cancellation_requests c
      where c.order_id=target_order and c.claim_type='exchange' and c.stage='completed'
        and (c.reshipped_at is null or c.reship_carrier is null or c.reship_tracking_number is null
          or c.reship_delivered_at is null or c.reship_delivered_by is null or c.reship_delivery_evidence is null));
$$;
revoke all on function private.order_all_items_delivered(uuid) from public,anon,authenticated,service_role;

create function public.admin_record_order_claim_reshipment_delivery(p_claim_id uuid,p_evidence text)
returns text language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=(select auth.uid());
  order_key uuid;
  claim public.order_cancellation_requests;
  observed_at timestamptz;
begin
  if actor is null or not public.is_staff() then
    raise insufficient_privilege using message='staff required';
  end if;
  if p_evidence is null or p_evidence<>btrim(p_evidence)
    or char_length(p_evidence) not between 1 and 500
    or translate(p_evidence,E'\n\r\t','') ~ '[[:cntrl:]]' then
    raise check_violation using message='invalid_reshipment_delivery_evidence';
  end if;
  select order_id into order_key from public.order_cancellation_requests where id=p_claim_id;
  if not found then raise no_data_found using message='claim_not_found'; end if;
  -- Same parent-first ordering as intake and reshipment: concurrent confirmation
  -- cannot reopen intake against a different replacement transaction.
  perform id from public.orders where id=order_key for update;
  select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
  if not found then raise no_data_found using message='claim_not_found'; end if;
  observed_at:=clock_timestamp();
  if claim.claim_type<>'exchange' or claim.stage<>'completed' or claim.reshipped_at is null
    or claim.reship_carrier is null or btrim(claim.reship_carrier)=''
    or claim.reship_tracking_number is null or btrim(claim.reship_tracking_number)=''
    or claim.reshipped_at>observed_at then
    raise check_violation using message='claim_reshipment_not_dispatched';
  end if;
  if claim.reship_delivered_at is not null then
    if claim.reship_delivered_by=actor and claim.reship_delivery_evidence=p_evidence then return 'delivered'; end if;
    raise unique_violation using message='reshipment_delivery_conflict';
  end if;
  update public.order_cancellation_requests
    set reship_delivered_at=observed_at,reship_delivered_by=actor,reship_delivery_evidence=p_evidence
    where id=p_claim_id;
  insert into public.audit_log(actor_id,action,target,diff)
    values(actor,'admin.order.claim_reshipment_delivered','order:'||order_key::text,
      jsonb_build_object('claimId',p_claim_id,'reshippedAt',claim.reshipped_at,
        'reshipDeliveredAt',observed_at,'evidence',p_evidence));
  return 'delivered';
end $$;
revoke all on function public.admin_record_order_claim_reshipment_delivery(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_record_order_claim_reshipment_delivery(uuid,text) to authenticated;

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
      'collectionPolicy',v_claim.collection_policy,
      'collectionComplete',private.claim_collections_complete(v_claim.id),
      'collections',private.claim_collection_records(v_claim.id),
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
      'reshipDeliveredAt', v_claim.reship_delivered_at,
      'reshipDeliveredBy', v_claim.reship_delivered_by,
      'reshipDeliveredByName', (select nickname from public.profiles where id=v_claim.reship_delivered_by),
      'reshipDeliveryEvidence', v_claim.reship_delivery_evidence,
      'reshippedItems', (select coalesce(jsonb_agg(jsonb_build_object('orderItemId',r.order_item_id,'name',oi.good_name_snapshot,
        'variantId',r.variant_id,'variantName',r.variant_name_snapshot,'variantCode',r.variant_code_snapshot,'qty',r.qty) order by r.order_item_id),'[]')
        from public.order_claim_reshipment_items r join public.order_items oi on oi.id=r.order_item_id where r.claim_id=v_claim.id),
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
        'status', orders.status,
        'total', orders.total,
        'shippingFee', orders.shipping_fee,
        'createdAt', orders.created_at,
        'deliveredAt', orders.delivered_at,
        'shipments', private.order_shipment_records(orders.id),
        'buyerName', profile.nickname,
        'buyerEmail', profile.email,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', item.id,
            'goodId', item.good_id,
            'variantId', item.variant_id,
            'variantName', item.variant_name_snapshot,
            'currentVariantId', private.order_item_stock_variant(item.id),
            'options', (select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'code',v.code,'stockQty',v.stock_qty) order by v.sort_order,v.id),'[]')
              from public.goods_variants v where v.good_id=item.good_id and (v.archived_at is null or v.id=private.order_item_stock_variant(item.id))),
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
$function$;

revoke all on function public.admin_order_claim_detail(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_claim_detail(uuid) to authenticated;
