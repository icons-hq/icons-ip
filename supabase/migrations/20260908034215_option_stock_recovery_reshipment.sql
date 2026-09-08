-- #440: keep sale snapshots frozen; record each exchange's physical option separately.
create table public.order_claim_reshipment_items (
  claim_id uuid not null references public.order_cancellation_requests(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id),
  good_id text not null references public.goods(id) on update cascade,
  source_variant_id uuid not null,
  variant_id uuid not null,
  variant_name_snapshot text not null,
  variant_code_snapshot text not null,
  qty integer not null check(qty>0),
  primary key(claim_id,order_item_id),
  foreign key(source_variant_id,good_id) references public.goods_variants(id,good_id) on update cascade,
  foreign key(variant_id,good_id) references public.goods_variants(id,good_id) on update cascade
);
create index order_claim_reshipment_items_order_idx on public.order_claim_reshipment_items(order_item_id);
alter table public.order_claim_reshipment_items enable row level security;
revoke all on public.order_claim_reshipment_items from public,anon,authenticated,service_role;
grant select on public.order_claim_reshipment_items to authenticated;
create policy order_claim_reshipment_items_owner_staff on public.order_claim_reshipment_items
  for select to authenticated using(exists(select 1 from public.order_cancellation_requests claim where claim.id=claim_id));

-- Called only after the owning order lock. Subsequent returns restore the option
-- last shipped, without rewriting the purchased option or amount in order_items.
create function private.order_item_stock_variant(target_item_id uuid)
returns uuid language sql stable security invoker set search_path='' as $$
  select coalesce((select shipped.variant_id from public.order_claim_reshipment_items shipped
    join public.order_cancellation_requests claim on claim.id=shipped.claim_id
    where shipped.order_item_id=item.id and claim.stage='completed'
    order by claim.reshipped_at desc,claim.reference desc limit 1),item.variant_id)
  from public.order_items item where item.id=target_item_id
$$;
revoke all on function private.order_item_stock_variant(uuid) from public,anon,authenticated,service_role;

create function public.admin_adjust_stock(target_adjustment_id uuid,target_good_id text,target_variant_id uuid,
  target_expected_stock_qty integer,target_delta integer,target_reason text)
returns integer language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=(select auth.uid()); normalized_reason text:=btrim(target_reason,E' \t\n\r\f\v');
  previous_stock integer; next_stock bigint; existing public.audit_log; requested_diff jsonb;
begin
  if actor is null then raise sqlstate '28000' using message='auth_required'; end if;
  if not public.is_staff() then raise insufficient_privilege using message='forbidden'; end if;
  if target_adjustment_id is null then raise null_value_not_allowed using message='invalid_adjustment_id'; end if;
  if target_variant_id is null then raise invalid_parameter_value using message='goods_variant_required'; end if;
  if target_expected_stock_qty is null or target_expected_stock_qty<0 then raise invalid_parameter_value using message='invalid_expected_stock_qty'; end if;
  if target_delta is null or target_delta=0 then raise invalid_parameter_value using message='invalid_stock_delta'; end if;
  if normalized_reason is null or char_length(normalized_reason) not between 1 and 200 then raise invalid_parameter_value using message='invalid_stock_reason'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('admin_stock_adjustment:'||target_adjustment_id::text,0));
  next_stock:=target_expected_stock_qty::bigint+target_delta::bigint;
  requested_diff:=jsonb_build_object('variantId',target_variant_id,'from',target_expected_stock_qty,'delta',target_delta,'to',next_stock,'reason',normalized_reason);
  select * into existing from public.audit_log where id=target_adjustment_id;
  if found then
    if existing.actor_id=actor and existing.action='admin.good.stock_adjusted'
      and existing.target='goods:'||target_good_id and existing.diff=requested_diff then return (existing.diff->>'to')::integer; end if;
    raise unique_violation using message='adjustment_conflict';
  end if;
  perform 1 from public.goods where id=target_good_id for update;
  if not found then raise no_data_found using message='good_not_found'; end if;
  if exists(select 1 from public.goods where id=target_good_id and archived_at is not null) then raise check_violation using message='catalog_archived'; end if;
  select stock_qty into previous_stock from public.goods_variants where id=target_variant_id and good_id=target_good_id and archived_at is null for update;
  if not found then raise no_data_found using message='goods_variant_not_found'; end if;
  if previous_stock<>target_expected_stock_qty then raise exception using message='stock_changed'; end if;
  next_stock:=private.change_goods_variant_stock(target_good_id,target_variant_id,target_delta::bigint);
  insert into public.audit_log(id,actor_id,action,target,diff)
    values(target_adjustment_id,actor,'admin.good.stock_adjusted','goods:'||target_good_id,requested_diff);
  return next_stock::integer;
end $$;
revoke all on function public.admin_adjust_stock(uuid,text,uuid,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_adjust_stock(uuid,text,uuid,integer,integer,text) to authenticated;

-- Every cancellation, refund, expiry and declined-payment path already converges here.
CREATE OR REPLACE FUNCTION public.finalize_order_cancellation_with_provider_evidence(p_order_id uuid, p_reason text, p_provider_payment_keys text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_status public.order_status;
  v_provider_payment_keys text[] := coalesce(
    array_remove(p_provider_payment_keys, null),
    array[]::text[]
  );
  v_item record;
begin
  select orders.status
  into v_status
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order not found';
  end if;

  if v_status not in (
    'pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done', 'canceled'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'order not cancelable';
  end if;

  -- 배송이 나간 뒤의 취소는 staff 결정이 남긴 durable claim이 반드시 선행한다.
  -- claim이 없다는 것은 승인 경로 밖에서 들어왔다는 뜻이므로 거절한다.
  if v_status in ('shipping', 'delivered', 'done') and not exists (
    select 1
    from public.order_cancellation_claims as claim
    where claim.order_id = p_order_id
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'order not cancelable';
  end if;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
  order by payment.id
  for update;

  if exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = p_order_id
      and payment.status in ('pending', 'paid')
      and (
        payment.payment_key is null
        or not (payment.payment_key = any(v_provider_payment_keys))
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'provider cancellation required';
  end if;

  if v_status in ('paid', 'confirmed', 'shipping', 'delivered', 'done')
    and not exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = p_order_id
        and (
          payment.status in ('canceled', 'refunded')
          or payment.payment_key = any(v_provider_payment_keys)
        )
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'payment evidence required';
  end if;

  if v_status <> 'canceled' then
    for v_item in
      select order_item.id, order_item.good_id, order_item.qty, private.order_item_stock_variant(order_item.id) as variant_id
      from public.order_items as order_item
      where order_item.order_id = p_order_id
      order by order_item.good_id, order_item.id
    loop
      perform private.change_goods_variant_stock(v_item.good_id, v_item.variant_id, v_item.qty::bigint);
      insert into public.audit_log(actor_id,action,target,diff)
      values((select auth.uid()),'order.option_stock_restored','order:'||p_order_id::text,
        jsonb_build_object('orderItemId',v_item.id,'goodId',v_item.good_id,'variantId',v_item.variant_id,'delta',v_item.qty,'reason',p_reason));
    end loop;

    perform ticket.id
    from public.draw_tickets as ticket
    where ticket.source = 'order_paid'
      and ticket.source_id = p_order_id
      and ticket.consumed_at is null
      and ticket.revoked_at is null
    order by ticket.id
    for update;

    update public.draw_tickets as ticket
    set revoked_at = now()
    where ticket.source = 'order_paid'
      and ticket.source_id = p_order_id
      and ticket.consumed_at is null
      and ticket.revoked_at is null;
  end if;

  insert into public.refunds (payment_id, amount, reason, status)
  select
    payment.id,
    payment.amount,
    p_reason,
    'done'
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
    and (
      payment.status in ('canceled', 'refunded')
      or payment.payment_key = any(v_provider_payment_keys)
    )
  on conflict (payment_id) do update
  set
    amount = excluded.amount,
    reason = coalesce(public.refunds.reason, excluded.reason),
    status = 'done';

  update public.payments as payment
  set status = 'refunded'
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
    and (
      payment.status in ('canceled', 'refunded')
      or payment.payment_key = any(v_provider_payment_keys)
    );

  if v_status <> 'canceled' then
    update public.orders
    set
      status = 'canceled',
      expires_at = null
    where id = p_order_id;
  end if;

  delete from public.order_cancellation_claims
  where order_id = p_order_id;
end;
$function$;


revoke all on function public.finalize_order_cancellation_with_provider_evidence(uuid,text,text[]) from public,anon,authenticated,service_role;

create function public.admin_record_order_claim_reshipment(p_claim_id uuid,p_carrier text,p_tracking_number text,p_items jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=(select auth.uid()); selected_order uuid; order_status public.order_status;
  claim public.order_cancellation_requests; item record; selected_variant uuid; source_variant uuid;
  variant public.goods_variants; carrier text:=nullif(btrim(p_carrier),''); tracking text:=nullif(btrim(p_tracking_number),'');
  selections jsonb; requested jsonb; shipped_items jsonb;
begin
  if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff required'; end if;
  if carrier is null or tracking is null or tracking!~'^[A-Z0-9]{8,30}$' then raise check_violation using message='invalid reshipment tracking'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>1000 then raise check_violation using message='invalid reshipment items'; end if;
  for requested in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(requested) is distinct from 'object' or not(requested ?& array['orderItemId','variantId'])
      or (select count(*) from jsonb_object_keys(requested))<>2
      or (requested->>'orderItemId') is null or (requested->>'variantId') is null
      or requested->>'orderItemId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or requested->>'variantId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then raise check_violation using message='invalid reshipment items'; end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_items) x group by (x->>'orderItemId')::uuid having count(*)>1) then
    raise check_violation using message='invalid reshipment items';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('orderItemId',(x->>'orderItemId')::uuid,'variantId',(x->>'variantId')::uuid)
    order by (x->>'orderItemId')::uuid),'[]') into selections from jsonb_array_elements(p_items) x;
  select order_id into selected_order from public.order_cancellation_requests where id=p_claim_id;
  if not found then raise no_data_found using message='claim_not_found'; end if;
  -- Cancellation, payment finalization and claim operations all lock order first.
  select status into order_status from public.orders where id=selected_order for update;
  select * into claim from public.order_cancellation_requests where id=p_claim_id for update;
  if claim.claim_type<>'exchange' then raise exception using message='claim_type_has_no_reshipment'; end if;
  if claim.stage='completed' then
    if claim.reship_carrier=carrier and claim.reship_tracking_number=tracking and not exists(
      select 1 from jsonb_array_elements(selections) selected where not exists(
        select 1 from public.order_claim_reshipment_items shipped where shipped.claim_id=p_claim_id
          and shipped.order_item_id=(selected->>'orderItemId')::uuid and shipped.variant_id=(selected->>'variantId')::uuid))
      then return 'completed'; end if;
    raise unique_violation using message='reshipment_conflict';
  end if;
  if claim.stage<>'collected' or order_status not in('delivered','done')
    or exists(select 1 from public.order_cancellation_claims where order_id=selected_order)
    then raise exception using message='claim_not_reshippable'; end if;
  if not exists(select 1 from public.shipping_carriers c where c.code=carrier and c.is_active) then raise check_violation using message='unknown shipping carrier'; end if;
  if exists(select 1 from jsonb_array_elements(selections) selected where not exists(
    select 1 from public.order_items oi where oi.id=(selected->>'orderItemId')::uuid and oi.order_id=selected_order)) then
    raise check_violation using message='invalid reshipment items';
  end if;
  perform 1 from public.goods g where g.id in(select good_id from public.order_items where order_id=selected_order) order by g.id for update;
  for item in select * from public.order_items where order_id=selected_order order by good_id,id loop
    source_variant:=private.order_item_stock_variant(item.id);
    select (selected->>'variantId')::uuid into selected_variant from jsonb_array_elements(selections) selected where (selected->>'orderItemId')::uuid=item.id;
    selected_variant:=coalesce(selected_variant,source_variant);
    select * into variant from public.goods_variants where id=selected_variant and good_id=item.good_id;
    if not found or (variant.archived_at is not null and selected_variant<>source_variant) then raise check_violation using message='reshipment_variant_unavailable'; end if;
    insert into public.order_claim_reshipment_items(claim_id,order_item_id,good_id,source_variant_id,variant_id,variant_name_snapshot,variant_code_snapshot,qty)
      values(p_claim_id,item.id,item.good_id,source_variant,selected_variant,variant.name,variant.code,item.qty);
  end loop;
  -- Net all returned/shipped options first. A two-line blue/red swap also works
  -- with no spare stock; every recovered unit belongs to this collected claim.
  for item in select changes.good_id,changes.variant_id,sum(changes.delta)::bigint delta from (
    select good_id,source_variant_id variant_id,qty::bigint delta from public.order_claim_reshipment_items where claim_id=p_claim_id
    union all select good_id,variant_id,-qty::bigint from public.order_claim_reshipment_items where claim_id=p_claim_id
  ) changes group by changes.good_id,changes.variant_id having sum(changes.delta)<>0 order by changes.good_id,delta desc,changes.variant_id loop
    perform private.change_goods_variant_stock(item.good_id,item.variant_id,item.delta);
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('orderItemId',order_item_id,'goodId',good_id,'sourceVariantId',source_variant_id,'variantId',variant_id,'qty',qty) order by order_item_id),'[]')
    into shipped_items from public.order_claim_reshipment_items where claim_id=p_claim_id;
  update public.order_cancellation_requests set stage='completed',reship_carrier=carrier,reship_tracking_number=tracking,
    reshipped_at=now(),completed_at=now(),updated_at=now() where id=p_claim_id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.claim_reshipped','order:'||selected_order::text,
    jsonb_build_object('claimId',p_claim_id,'claimType','exchange','from','collected','to','completed','carrier',carrier,'items',shipped_items));
  perform private.notify_order_claim(p_claim_id,'reshipped','교환 상품이 재출고됐어요','교환 상품을 새 운송장으로 발송했습니다.');
  return 'completed';
end $$;
revoke all on function public.admin_record_order_claim_reshipment(uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_order_claim_reshipment(uuid,text,text,jsonb) to authenticated;

-- Existing same-option callers drain through the same stock and audit seam.
create or replace function public.admin_record_order_claim_reshipment(p_claim_id uuid,p_carrier text,p_tracking_number text)
returns text language sql security definer set search_path='' as $$
  select public.admin_record_order_claim_reshipment(p_claim_id,p_carrier,p_tracking_number,'[]'::jsonb)
$$;
revoke all on function public.admin_record_order_claim_reshipment(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_record_order_claim_reshipment(uuid,text,text) to authenticated;

-- Staff-gated detail includes current exchange choices and immutable shipment history.
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
        'shippingCarrier', orders.shipping_carrier,
        'trackingNumber', orders.tracking_number,
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
