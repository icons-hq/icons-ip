-- #447: shipment records are the only active tracking authority. Historical order columns remain frozen.
revoke insert,update on public.orders from public,anon,authenticated,service_role;
DO $$ declare cols text; begin
 select string_agg(quote_ident(attname),',' order by attnum) into cols from pg_attribute
 where attrelid='public.orders'::regclass and attnum>0 and not attisdropped and attname not in ('shipping_carrier','tracking_number');
 execute 'grant insert ('||cols||'),update ('||cols||') on public.orders to anon,authenticated,service_role';
end $$;
create function private.freeze_legacy_order_tracking() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (tg_op='INSERT' and (new.shipping_carrier is not null or new.tracking_number is not null))
  or (tg_op='UPDATE' and (new.shipping_carrier is distinct from old.shipping_carrier or new.tracking_number is distinct from old.tracking_number)) then
  raise check_violation using message='legacy_order_tracking_frozen';
 end if;
 return new;
end $$;
revoke all on function private.freeze_legacy_order_tracking() from public,anon,authenticated,service_role;
create trigger orders_legacy_tracking_frozen before insert or update of shipping_carrier,tracking_number on public.orders
for each row execute function private.freeze_legacy_order_tracking();

create function private.order_shipment_records(target_order uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'orderId',s.order_id,'originId',s.origin_id,
  'originName',s.origin_name_snapshot,'shippingFee',s.shipping_fee,'status',s.status,'carrier',s.carrier,
  'carrierLabel',coalesce(c.label,s.carrier),'trackingNumber',s.tracking_number,
  'trackingUrl',case when s.tracking_number is not null then replace(c.tracking_url_template,'{trackingNumber}',s.tracking_number) end,
  'shippedAt',s.shipped_at,'deliveredAt',s.delivered_at,'exportedAt',s.exported_at,
  'orderItemIds',(select coalesce(jsonb_agg(i.order_item_id order by i.order_item_id),'[]') from public.order_shipment_items i where i.shipment_id=s.id)
 ) order by s.created_at,s.id),'[]') from public.order_shipments s left join public.shipping_carriers c on c.code=s.carrier where s.order_id=target_order;
$$;
revoke all on function private.order_shipment_records(uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.refresh_order_fulfillment(target_order uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare purchase public.orders; next_status public.order_status; first_shipped timestamptz; last_delivered timestamptz;
begin
  select * into purchase from public.orders where id=target_order for update;
  if not found or purchase.status in ('pending','canceled','done') then return; end if;
  next_status:=private.derive_order_shipment_status(target_order);
  select min(shipped_at),case when bool_and(status='delivered' and delivered_at is not null) then max(delivered_at) end
    into first_shipped,last_delivered from public.order_shipments where order_id=target_order;
  update public.orders set status=next_status,shipped_at=first_shipped,delivered_at=last_delivered where id=target_order;
end $function$;

revoke all on function private.refresh_order_fulfillment(uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.admin_inquiry_context(target_inquiry_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_thread public.inquiries%rowtype;
  v_order jsonb := 'null'::jsonb;
  v_buyer jsonb;
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  select * into v_thread
  from public.inquiries as thread
  where thread.id = target_inquiry_id;

  if not found then
    raise no_data_found using message = 'inquiry_not_found';
  end if;

  if v_thread.order_id is not null then
    select jsonb_build_object(
      'id', target.id,
      'status', target.status::text,
      'total', target.total,
      'createdAt', target.created_at,
      'shipments', private.order_shipment_records(target.id),
      'itemCount', (
        select coalesce(sum(item.qty), 0)
        from public.order_items as item
        where item.order_id = target.id
      ),
      'leadItemName', (
        select item.good_name_snapshot
        from public.order_items as item
        where item.order_id = target.id
        order by item.id
        limit 1
      ),
      'payment', (
        select jsonb_build_object(
          'provider', summary.provider,
          'status', summary.status,
          'amount', summary.amount
        )
        from public.payment_summaries as summary
        where summary.purpose = 'order'
          and summary.ref_id = target.id
        order by (summary.status = 'paid') desc, summary.created_at desc
        limit 1
      ),
      'claims', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'status', request.status,
            'requestedAt', request.requested_at,
            'decidedAt', request.decided_at,
            'reasonType', request.reason_type
          )
          order by request.requested_at desc
        )
        from public.order_cancellation_requests as request
        where request.order_id = target.id
      ), '[]'::jsonb)
    )
    into v_order
    from public.orders as target
    where target.id = v_thread.order_id;
  end if;

  select jsonb_build_object(
    'id', buyer.id,
    'nickname', buyer.nickname,
    'email', buyer.email,
    'suspendedAt', buyer.suspended_at,
    'orderCount', (
      select count(*)
      from public.orders as target
      where target.user_id = buyer.id
        and target.status <> 'pending'
    ),
    'inquiryCount', (
      select count(*)
      from public.inquiries as other
      where other.user_id = buyer.id
    ),
    'openInquiryCount', (
      select count(*)
      from public.inquiries as other
      where other.user_id = buyer.id
        and other.status <> 'closed'
    )
  )
  into v_buyer
  from public.profiles as buyer
  where buyer.id = v_thread.user_id;

  return jsonb_build_object('order', coalesce(v_order, 'null'::jsonb), 'buyer', v_buyer);
end;
$function$;

revoke all on function public.admin_inquiry_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_inquiry_context(uuid) to authenticated;

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

CREATE OR REPLACE FUNCTION public.admin_search_orders(p_status text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_confirmed_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, user_id uuid, buyer_name text, buyer_email text, status order_status, total bigint, address jsonb, created_at timestamp with time zone, updated_at timestamp with time zone, shipping_carrier text, tracking_number text, confirmed_at timestamp with time zone, shipped_at timestamp with time zone, delivered_at timestamp with time zone, done_at timestamp with time zone, cancellation_request_id uuid, cancellation_request_status text, cancellation_reason_type text, cancellation_requested_at timestamp with time zone, cancellation_decided_at timestamp with time zone, cancellation_decision_note text, cancellation_claim_type text, cancellation_stage text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    (select max(s.carrier) from public.order_shipments s where s.order_id=orders.id having count(*)=1),
    (select max(s.tracking_number) from public.order_shipments s where s.order_id=orders.id having count(*)=1),
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
$function$;

revoke all on function public.admin_search_orders(text,date,date,text,integer,integer,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_orders(text,date,date,text,integer,integer,timestamptz) to authenticated;

CREATE OR REPLACE FUNCTION public.admin_order_detail(target_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if (select auth.uid()) is null or not public.is_staff() then
  raise insufficient_privilege using message='staff_required';
 end if;
 select jsonb_build_object(
  'order',jsonb_build_object('id',o.id,'userId',o.user_id,'buyerName',p.nickname,'buyerEmail',p.email,
   'status',o.status,'total',o.total,'shippingFee',o.shipping_fee,'discountTotal',o.discount_total,
   'createdAt',o.created_at,
   'address',jsonb_build_object('recipientName',o.address->>'recipientName','phone',o.address->>'phone',
    'postalCode',o.address->>'postalCode','address1',o.address->>'address1','address2',o.address->>'address2',
    'deliveryNote',o.address->>'deliveryNote')),
  'shipments',private.order_shipment_records(o.id),
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.good_name_snapshot,
   'variantId',i.variant_id,'variantName',i.variant_name_snapshot,'variantCode',i.variant_code_snapshot,
   'type',i.good_type_snapshot,'qty',i.qty,'unitPrice',i.unit_price) order by i.id)
   from public.order_items i where i.order_id=o.id),'[]'::jsonb),
  'timeline',coalesce((
    select jsonb_agg(e.payload || jsonb_build_object('id',e.id,'occurredAt',e.at) order by e.at,e.id)
    from (
      select 'order:'||o.id id,o.created_at at,jsonb_build_object('source','order','action','created') payload
      union all
      select 'payment:'||p.id,p.created_at,jsonb_build_object('source','payment','action','recorded',
        'status',p.status,'amount',p.amount,'provider',p.provider)
      from public.payment_summaries p where p.purpose='order' and p.ref_id=o.id
      union all
      select 'refund:'||r.id,r.created_at,jsonb_build_object('source','refund','action','requested',
        'status',r.status,'amount',r.amount)
      from public.refunds r join public.payment_summaries p on p.id=r.payment_id
      where p.purpose='order' and p.ref_id=o.id
      union all
      select 'refund-completed:'||r.id,r.completed_at,jsonb_build_object('source','refund','action','completed',
        'status',r.status,'amount',r.amount)
      from public.refunds r join public.payment_summaries p on p.id=r.payment_id
      where p.purpose='order' and p.ref_id=o.id and r.completed_at is not null
      union all
      select 'audit:'||a.id,a.created_at,jsonb_build_object(
        'source',case when a.action='admin.order.note' then 'note'
          when a.action='admin.order.tracking_updated' or a.action like 'admin.shipment.%' then 'shipment'
          when a.action like 'admin.order.claim%' or a.action like '%cancellation%' then 'claim'
          else 'status' end,
        'action',a.action,'actorName',actor.nickname,
        'shipmentId',a.diff->>'shipmentId','originName',a.diff->>'originName',
        'fromStatus',case when a.action in ('admin.order.status_updated','admin.shipment.status_updated') then a.diff->>'from' end,
        'toStatus',case when a.action in ('admin.order.status_updated','admin.shipment.status_updated') then a.diff->>'to' end,
        'carrier',case when a.action in ('admin.order.tracking_updated','admin.shipment.tracking_updated') then a.diff->>'toCarrier'
          when a.action in ('admin.order.status_updated','admin.shipment.status_updated') then a.diff->>'carrier' end,
        'trackingNumber',case when a.action in ('admin.order.tracking_updated','admin.shipment.tracking_updated') then a.diff->>'toTrackingNumber'
          when a.action in ('admin.order.status_updated','admin.shipment.status_updated') then a.diff->>'trackingNumber' end,
        'body',case when a.action='admin.order.note' then a.diff->>'body' end)
      from public.audit_log a left join public.profiles actor on actor.id=a.actor_id
      where a.target='order:'||o.id
      union all
      select 'shipped:'||s.id,s.shipped_at,jsonb_build_object('source','shipment','action','shipped',
        'shipmentId',s.id,'originName',s.origin_name_snapshot,'carrier',s.carrier,'trackingNumber',s.tracking_number)
      from public.order_shipments s where s.order_id=o.id and s.shipped_at is not null
      union all
      select 'delivered:'||s.id,s.delivered_at,jsonb_build_object('source','shipment','action','delivered',
        'shipmentId',s.id,'originName',s.origin_name_snapshot)
      from public.order_shipments s where s.order_id=o.id and s.delivered_at is not null
      union all
      select 'claim:'||c.id,c.requested_at,jsonb_build_object('source','claim','action','requested',
        'status',c.stage,'claimType',c.claim_type,'relatedId',c.id)
      from public.order_cancellation_requests c where c.order_id=o.id
      union all
      select 'inquiry:'||i.id,i.created_at,jsonb_build_object('source','inquiry','action','created',
        'status',i.status,'title',i.title,'relatedId',i.id)
      from public.inquiries i where i.order_id=o.id
      union all
      select 'email:'||m.id,coalesce(m.completed_at,m.created_at),jsonb_build_object('source','email',
        'action',m.template,'status',m.status,'shipmentId',nullif(split_part(m.dedupe_key,':',3),''))
      from public.email_deliveries m
      where m.dedupe_key in ('order_confirmation:'||o.id,'order_shipped:'||o.id)
        or m.dedupe_key like 'order_shipped:'||o.id||':%'
        or exists(select 1 from public.inquiry_messages im join public.inquiries iq on iq.id=im.inquiry_id
          where iq.order_id=o.id and m.dedupe_key='inquiry_answered:'||im.id)
    ) e
  ),'[]'::jsonb)
 ) into result from public.orders o left join public.profiles p on p.id=o.user_id
 where o.id=target_order_id;
 return result;
end;
$function$;

revoke all on function public.admin_order_detail(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_detail(uuid) to authenticated;

CREATE OR REPLACE FUNCTION private.snapshot_account_deletion_legal_records(p_deletion_event_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_tracking_hmac_key bytea;
  v_tracking_key_version smallint;
begin
  select
    control.shipment_tracking_hmac_key,
    control.shipment_tracking_key_version
    into strict v_tracking_hmac_key, v_tracking_key_version
  from private.account_deletion_control as control
  where control.singleton;

  insert into private.account_deletion_legal_snapshots (
    deletion_event_id,
    record_type,
    record_ref,
    snapshot_data,
    legal_basis,
    retain_until
  )
  select
    p_deletion_event_id,
    'order',
    order_record.id::text,
    pg_catalog.jsonb_build_object(
      'orderRef', order_record.id::text,
      'status', order_record.status,
      'total', order_record.total,
      'shippingFee', order_record.shipping_fee,
      'contractedAt', order_record.created_at,
      'items', coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'goodRef', item.good_id,
              'goodName', item.good_name_snapshot,
              'goodType', item.good_type_snapshot,
              'ipRef', item.good_ip_id_snapshot,
              'quantity', item.qty,
              'unitPrice', item.unit_price
            )
            order by item.id
          )
          from public.order_items as item
          where item.order_id = order_record.id
        ),
        '[]'::jsonb
      )
    ),
    'ecommerce_transaction_v1',
    order_record.created_at + interval '5 years'
  from public.orders as order_record
  where order_record.user_id = p_user_id
    and order_record.created_at + interval '5 years' > pg_catalog.now()
  on conflict (deletion_event_id, record_type, record_ref) do update
  set
    snapshot_data = excluded.snapshot_data,
    legal_basis = excluded.legal_basis,
    retain_until = greatest(
      private.account_deletion_legal_snapshots.retain_until,
      excluded.retain_until
    )
  where private.account_deletion_legal_snapshots.destroyed_at is null;

  insert into private.account_deletion_legal_snapshots (
    deletion_event_id,
    record_type,
    record_ref,
    snapshot_data,
    legal_basis,
    retain_until
  )
  select
    p_deletion_event_id,
    'order_cancellation',
    request.id::text,
    pg_catalog.jsonb_build_object(
      'cancellationRef', request.id::text,
      'orderRef', request.order_id::text,
      'status', request.status,
      'decision', case
        when request.status = 'rejected' then 'rejected'
        when request.decided_at is not null
          and request.status in ('processing', 'needs_review', 'completed')
          then 'approved'
        when request.status = 'requested' then 'pending'
        else 'unknown'
      end,
      'reasonType', request.reason_type,
      'requestedAt', request.requested_at,
      'decidedAt', request.decided_at,
      'providerStartedAt', request.provider_started_at,
      'completedAt', request.completed_at
    ),
    'ecommerce_transaction_v1',
    request.requested_at + interval '5 years'
  from public.order_cancellation_requests as request
  join public.orders as order_record on order_record.id = request.order_id
  where order_record.user_id = p_user_id
    and request.requested_at + interval '5 years' > pg_catalog.now()
  on conflict (deletion_event_id, record_type, record_ref) do update
  set
    snapshot_data = excluded.snapshot_data,
    legal_basis = excluded.legal_basis,
    retain_until = greatest(
      private.account_deletion_legal_snapshots.retain_until,
      excluded.retain_until
    )
  where private.account_deletion_legal_snapshots.destroyed_at is null;

  insert into private.account_deletion_legal_snapshots (
    deletion_event_id,
    record_type,
    record_ref,
    snapshot_data,
    legal_basis,
    retain_until
  )
  select
    p_deletion_event_id,
    'shipment',
    shipment.id::text,
    pg_catalog.jsonb_build_object(
      'orderRef', order_record.id::text,
      'shipmentRef', shipment.id::text,
      'originName', shipment.origin_name_snapshot,
      'status', shipment.status,
      'carrier', shipment.carrier,
      'opaqueTrackingRef', case
        when shipment.tracking_number is null then null
        else pg_catalog.encode(
          extensions.hmac(
            pg_catalog.convert_to(
              'account-deletion-shipment-v1|'
                || shipment.carrier
                || '|'
                || shipment.tracking_number,
              'UTF8'
            ),
            v_tracking_hmac_key,
            'sha256'
          ),
          'hex'
        )
      end,
      'trackingKeyVersion', case
        when shipment.tracking_number is null then null
        else v_tracking_key_version
      end,
      'shippedAt', shipment.shipped_at,
      'suppliedAt', shipment.delivered_at
    ),
    'ecommerce_transaction_v1',
    coalesce(
      shipment.delivered_at,
      shipment.shipped_at,
      order_record.created_at
    ) + interval '5 years'
  from public.order_shipments as shipment
  join public.orders as order_record on order_record.id=shipment.order_id
  where order_record.user_id = p_user_id
    and shipment.delivered_at is not null
    and coalesce(
      shipment.delivered_at,
      shipment.shipped_at,
      order_record.created_at
    ) + interval '5 years' > pg_catalog.now()
  on conflict (deletion_event_id, record_type, record_ref) do update
  set
    snapshot_data = excluded.snapshot_data,
    legal_basis = excluded.legal_basis,
    retain_until = greatest(
      private.account_deletion_legal_snapshots.retain_until,
      excluded.retain_until
    )
  where private.account_deletion_legal_snapshots.destroyed_at is null;

  insert into private.account_deletion_legal_snapshots (
    deletion_event_id,
    record_type,
    record_ref,
    snapshot_data,
    legal_basis,
    retain_until
  )
  select
    p_deletion_event_id,
    'payment',
    payment.id::text,
    pg_catalog.jsonb_build_object(
      'paymentRef', payment.id::text,
      'provider', payment.provider,
      'purpose', payment.purpose,
      'relatedRef', payment.ref_id,
      'amount', payment.amount,
      'currency', 'KRW',
      'status', payment.status,
      'ledgerRecordedAt', payment.created_at,
      'approvedAt', (
        select pg_catalog.max(evidence.approved_at)
        from public.payment_attempts as attempt
        join private.payment_provider_evidence as evidence
          on evidence.payment_attempt_id = attempt.id
        where attempt.payment_id = payment.id
          and attempt.state = 'approved'
      )
    ),
    case when payment.purpose = 'ticket'
      then 'ticket_transaction_v1'
      else 'ecommerce_transaction_v1'
    end,
    payment.created_at + interval '5 years'
  from public.payments as payment
  where payment.user_id = p_user_id
    and exists (
      select 1
      from public.payment_attempts as attempt
      join private.payment_provider_evidence as evidence
        on evidence.payment_attempt_id = attempt.id
      where attempt.payment_id = payment.id
        and attempt.state = 'approved'
        and evidence.approved_at is not null
    )
    and payment.created_at + interval '5 years' > pg_catalog.now()
  on conflict (deletion_event_id, record_type, record_ref) do update
  set
    snapshot_data = excluded.snapshot_data,
    legal_basis = excluded.legal_basis,
    retain_until = greatest(
      private.account_deletion_legal_snapshots.retain_until,
      excluded.retain_until
    )
  where private.account_deletion_legal_snapshots.destroyed_at is null;

  insert into private.account_deletion_legal_snapshots (
    deletion_event_id,
    record_type,
    record_ref,
    snapshot_data,
    legal_basis,
    retain_until
  )
  select
    p_deletion_event_id,
    'refund',
    refund.id::text,
    pg_catalog.jsonb_build_object(
      'refundRef', refund.id::text,
      'paymentRef', refund.payment_id::text,
      'relatedCancellationRef', coalesce(
        refund.cancellation_request_id::text,
        refund.ticket_cancellation_request_id::text
      ),
      'amount', refund.amount,
      'status', refund.status,
      'requestedAt', refund.created_at,
      'refundedAt', case
        when refund.status = 'done' then coalesce(
          order_request.completed_at,
          ticket_request.completed_at
        )
        else null
      end
    ),
    case when payment.purpose = 'ticket'
      then 'ticket_transaction_v1'
      else 'ecommerce_transaction_v1'
    end,
    refund.created_at + interval '5 years'
  from public.refunds as refund
  join public.payments as payment on payment.id = refund.payment_id
  left join public.order_cancellation_requests as order_request
    on order_request.id = refund.cancellation_request_id
  left join public.ticket_cancellation_requests as ticket_request
    on ticket_request.id = refund.ticket_cancellation_request_id
  where payment.user_id = p_user_id
    and refund.status = 'done'
    and coalesce(order_request.completed_at, ticket_request.completed_at) is not null
    and refund.created_at + interval '5 years' > pg_catalog.now()
  on conflict (deletion_event_id, record_type, record_ref) do update
  set
    snapshot_data = excluded.snapshot_data,
    legal_basis = excluded.legal_basis,
    retain_until = greatest(
      private.account_deletion_legal_snapshots.retain_until,
      excluded.retain_until
    )
  where private.account_deletion_legal_snapshots.destroyed_at is null;

  insert into private.account_deletion_legal_snapshots (
    deletion_event_id,
    record_type,
    record_ref,
    snapshot_data,
    legal_basis,
    retain_until
  )
  select
    p_deletion_event_id,
    'ticket_order',
    ticket_order.id::text,
    pg_catalog.jsonb_build_object(
      'ticketOrderRef', ticket_order.id::text,
      'eventRef', ticket_order.event_id,
      'status', ticket_order.status,
      'total', ticket_order.total,
      'contractedAt', ticket_order.created_at,
      'tickets', coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'ticketRef', ticket.id::text,
              'ticketTypeRef', ticket.ticket_type_id::text,
              'status', ticket.status
            )
            order by ticket.id
          )
          from public.tickets as ticket
          where ticket.ticket_order_id = ticket_order.id
        ),
        '[]'::jsonb
      )
    ),
    'ticket_transaction_v1',
    ticket_order.created_at + interval '5 years'
  from public.ticket_orders as ticket_order
  where ticket_order.user_id = p_user_id
    and ticket_order.created_at + interval '5 years' > pg_catalog.now()
  on conflict (deletion_event_id, record_type, record_ref) do update
  set
    snapshot_data = excluded.snapshot_data,
    legal_basis = excluded.legal_basis,
    retain_until = greatest(
      private.account_deletion_legal_snapshots.retain_until,
      excluded.retain_until
    )
  where private.account_deletion_legal_snapshots.destroyed_at is null;

  insert into private.account_deletion_legal_snapshots (
    deletion_event_id,
    record_type,
    record_ref,
    snapshot_data,
    legal_basis,
    retain_until
  )
  select
    p_deletion_event_id,
    'ticket_cancellation',
    request.id::text,
    pg_catalog.jsonb_build_object(
      'cancellationRef', request.id::text,
      'ticketOrderRef', request.ticket_order_id::text,
      'source', request.source,
      'status', request.status,
      'policyCode', request.policy_code,
      'cutoffAt', request.cutoff_at,
      'grossAmount', request.gross_amount,
      'feeAmount', request.fee_amount,
      'refundAmount', request.refund_amount,
      'requestedAt', request.requested_at,
      'providerStartedAt', request.provider_started_at,
      'completedAt', request.completed_at
    ),
    'ticket_transaction_v1',
    request.requested_at + interval '5 years'
  from public.ticket_cancellation_requests as request
  join public.ticket_orders as ticket_order
    on ticket_order.id = request.ticket_order_id
  where ticket_order.user_id = p_user_id
    and request.requested_at + interval '5 years' > pg_catalog.now()
  on conflict (deletion_event_id, record_type, record_ref) do update
  set
    snapshot_data = excluded.snapshot_data,
    legal_basis = excluded.legal_basis,
    retain_until = greatest(
      private.account_deletion_legal_snapshots.retain_until,
      excluded.retain_until
    )
  where private.account_deletion_legal_snapshots.destroyed_at is null;

  insert into private.account_deletion_legal_snapshots (
    deletion_event_id,
    record_type,
    record_ref,
    snapshot_data,
    legal_basis,
    retain_until
  )
  select
    p_deletion_event_id,
    'ticket_check_in',
    ticket.id::text,
    pg_catalog.jsonb_build_object(
      'ticketRef', ticket.id::text,
      'ticketOrderRef', ticket.ticket_order_id::text,
      'checkedAt', check_in.checked_at
    ),
    'ticket_transaction_v1',
    check_in.checked_at + interval '5 years'
  from public.check_ins as check_in
  join public.tickets as ticket on ticket.id = check_in.ticket_id
  join public.ticket_orders as ticket_order
    on ticket_order.id = ticket.ticket_order_id
  where ticket_order.user_id = p_user_id
    and check_in.checked_at + interval '5 years' > pg_catalog.now()
  on conflict (deletion_event_id, record_type, record_ref) do update
  set
    snapshot_data = excluded.snapshot_data,
    legal_basis = excluded.legal_basis,
    retain_until = greatest(
      private.account_deletion_legal_snapshots.retain_until,
      excluded.retain_until
    )
  where private.account_deletion_legal_snapshots.destroyed_at is null;
end;
$function$;

revoke all on function private.snapshot_account_deletion_legal_records(uuid,uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.admin_request_email_resend(p_dedupe_key text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_key text := nullif(btrim(coalesce(p_dedupe_key, ''), E' \t\n\r\f\v'), '');
  v_template text;
  v_status text;
  v_attempt_count integer;
  v_order_id text;
  v_order_status text;
  v_shipment_id text;
  v_shipment_status text;
begin
  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if v_key is null then
    raise check_violation using message = 'invalid_dedupe_key';
  end if;

  select delivery.template, delivery.status, delivery.attempt_count
  into v_template, v_status, v_attempt_count
  from public.email_deliveries as delivery
  where delivery.dedupe_key = v_key
  for update;

  if not found then
    raise no_data_found using message = 'email_delivery_not_found';
  end if;

  if v_status = 'sent' then
    raise check_violation using message = 'email_already_sent';
  end if;

  -- 주문 메일이 아닌 템플릿은 이 게이트가 판정할 근거가 없다. 문의 답변 메일의
  -- 재발송 경로는 운영자가 문의 상세에서 답변을 다시 등록하는 것이다.
  if v_template not in ('order_confirmation', 'order_shipped') then
    raise check_violation using message = 'email_delivery_not_resendable';
  end if;

  -- dedupe_key는 '<template>:<order uuid>'다(lib/email/dedupe.ts).
  if split_part(v_key,':',1)<>v_template
    or (v_template='order_confirmation' and array_length(string_to_array(v_key,':'),1)<>2)
    or (v_template='order_shipped' and array_length(string_to_array(v_key,':'),1) not in (2,3)) then
    raise check_violation using message='email_delivery_target_unresolved';
  end if;
  v_order_id := split_part(v_key, ':', 2);
  if v_order_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise check_violation using message = 'email_delivery_target_unresolved';
  end if;

  select target.status::text
  into v_order_status
  from public.orders as target
  where target.id = lower(v_order_id)::uuid;

  if not found then
    raise no_data_found using message = 'order_missing';
  end if;

  if v_template='order_shipped' then
    v_shipment_id:=nullif(split_part(v_key,':',3),'');
    if v_shipment_id is null then
      select case when count(*)=1 then min(id::text) end into v_shipment_id from public.order_shipments where order_id=lower(v_order_id)::uuid;
    end if;
    if v_shipment_id is null or v_shipment_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or array_length(string_to_array(v_key,':'),1)>3 then
      raise check_violation using message='email_delivery_target_unresolved';
    end if;
    select status into v_shipment_status from public.order_shipments where id=v_shipment_id::uuid and order_id=lower(v_order_id)::uuid;
    if not found or v_shipment_status not in ('shipping','delivered') then
      raise check_violation using message='email_no_longer_accurate';
    end if;
  end if;

  -- 본문이 지금도 사실인 상태에서만 통과시킨다.
  -- lib/email/transactional.server.ts의 ACCURATE_ORDER_STATUSES와 같은 집합이다.
  if v_template = 'order_confirmation'
    and v_order_status not in ('paid', 'confirmed', 'shipping', 'delivered', 'done')
  then
    raise check_violation using message = 'email_no_longer_accurate';
  end if;
  if v_template = 'order_shipped'
    and v_order_status not in ('shipping', 'delivered', 'done')
  then
    raise check_violation using message = 'email_no_longer_accurate';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    v_actor,
    'admin.email_delivery.resend_requested',
    'email_delivery:' || v_key,
    jsonb_build_object(
      'template', v_template,
      'status', v_status,
      'attemptCount', v_attempt_count,
      'orderStatus', v_order_status
    )
  );

  return v_template;
end;
$function$;

revoke all on function public.admin_request_email_resend(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_request_email_resend(text) to authenticated;

-- Carry legacy single-parcel delivery fences forward so completed mail is not sent again.
update public.email_deliveries e set dedupe_key=e.dedupe_key||':'||s.id
from public.order_shipments s
where e.template='order_shipped' and e.dedupe_key='order_shipped:'||s.order_id
 and (select count(*) from public.order_shipments same_order where same_order.order_id=s.order_id)=1
 and not exists(select 1 from public.email_deliveries target where target.dedupe_key=e.dedupe_key||':'||s.id);
