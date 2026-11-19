-- ============================================================================
-- 출고지시 뒤 취소: 창고 회신 기록과 '취소 뒤 출고 발견' (원장 #3 — CLM-013·SHP-063·SHP-064, ADR-0046)
--
-- 출고지시 파일이 창고로 나간 배송 건이 있는 주문을 운영자가 전액·부분 취소할 때 근거는 확인란 하나
-- (운영자 진술)였다. 창고가 이미 출고했으면 돈은 환불되고 물건도 나갔고, 그 뒤 창고 회신(운송장)이 와도
-- 서원은 대조 후보에서 빠지고 김포·표준 양식·단건은 order_not_shipped로 실패해 시스템에 흔적이 없었다.
--
-- 1. 창고 회신 원장(private.warehouse_stop_replies)과 기록 RPC admin_record_warehouse_stop_reply.
--    회신은 배송 건의 '지금 출고지시'(exported_at 스냅샷)에 묶인다. 다시 출고지시하면 예전 회신은 근거가 아니다.
-- 2. 운영자 전액 취소·재고 부족 부분 취소의 확인란 판정을 회신 판정으로 바꾼다(앵커 치환, 시그니처 그대로).
--    출고지시가 나간 대상 배송 건마다 지금 출고지시의 가장 늦은 회신이 '출고 중단'이어야 하고, 그 회신은
--    한 번의 취소에만 쓴다. '이미 출고'면 거절한다. 확인란 인자는 호환을 위해 남지만 근거가 아니다.
-- 3. 출고지시 뒤 취소된 배송 건(배송 건 canceled·exported_at 있음·발송 시각 없음)에 운송장 회신이 오면 네 반입
--    경로(단건·김포·서원·표준 양식) 모두 그 줄을 '취소 뒤 출고 발견'(private.canceled_shipment_dispatches)으로
--    남기고 canceledAfterExport 결과로 돌려준다. 다른 줄은 그대로 등록된다. 같은 운송장 재반입은 멱등.
--    '이미 출고' 회신을 취소된 배송 건에 기록해도 같은 발견이 생긴다(운송장은 나중에 회신 반입으로 붙는다).
-- 4. 재고는 실물 기준이다. 취소가 되돌린 그 배송 건의 수량을 발견 때 다시 뺀다(창고를 떠났다). 처리
--    admin_resolve_canceled_shipment_dispatch: returned(회수 입고 확인)면 뺀 수량을 되돌리고, lost(회수 불가·손실)면 그대로 둔다.
--    재고 파일 대조(private.stock_reconcile_flows)는 발견을 '기준 시각 뒤 출고', 회수 입고를 '기준 시각 뒤 회수'로 센다.
--
-- 재정의 함수는 모두 pg_get_functiondef + 앵커 치환이다(다른 작업이 같은 함수의 다른 줄을 고친다).
--   public.admin_start_order_cancellation(uuid,text,text,boolean)
--   public.admin_start_order_partial_cancellation(uuid,jsonb,text,text,boolean,bigint,uuid,jsonb)
--   public.admin_import_shipment_tracking(text,text,text)
--   public.admin_import_seowon_tracking_batch(uuid,jsonb)
--   public.admin_origin_tracking_candidates(uuid,text[],text[])
--   private.stock_reconcile_flows(uuid[],timestamp with time zone)
-- ============================================================================
begin;

create function private.o3d_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 'o3d patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception 'o3d_anchor_changed: % anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;
revoke all on function private.o3d_patch_function(regprocedure, text[]) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. 창고 회신 원장
-- ---------------------------------------------------------------------------
create table private.warehouse_stop_replies (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  shipment_id uuid not null,
  -- 이 회신이 답한 출고지시(배송 건 exported_at 스냅샷). 다시 출고지시하면 예전 회신은 판정에서 빠진다.
  exported_at timestamptz not null,
  outcome text not null check (outcome in ('stopped', 'already_shipped')),
  channel text not null check (channel in ('phone', 'messenger', 'email', 'warehouse_system', 'other')),
  replied_at timestamptz not null,
  note text check (note is null or (note = btrim(note) and char_length(note) between 1 and 500
    and translate(note, E'\n\r\t', '') !~ '[[:cntrl:]]')),
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  operation_id uuid not null,
  -- '출고 중단' 회신은 한 번의 취소(운영자 전액 취소 요청 또는 부분 취소 요청번호)에만 쓴다.
  used_at timestamptz,
  used_by uuid references public.profiles(id) on delete restrict,
  used_kind text check (used_kind in ('staff_cancellation', 'partial_cancellation')),
  used_ref uuid,
  foreign key (order_id, shipment_id) references public.order_shipments(order_id, id) on delete restrict,
  unique (operation_id, shipment_id),
  check ((used_at is null) = (used_by is null) and (used_at is null) = (used_kind is null) and (used_at is null) = (used_ref is null)),
  check (used_at is null or outcome = 'stopped'),
  check (channel <> 'other' or note is not null)
);
create index warehouse_stop_replies_shipment on private.warehouse_stop_replies(shipment_id, replied_at desc, recorded_at desc, id desc);
create index warehouse_stop_replies_order on private.warehouse_stop_replies(order_id);
alter table private.warehouse_stop_replies enable row level security;
revoke all on private.warehouse_stop_replies from public, anon, authenticated, service_role;
comment on table private.warehouse_stop_replies is
  '출고지시 뒤 취소 전 창고 회신(출고 중단·이미 출고) 기록(ADR-0046). 절차는 docs/runbooks/order-claim-intake.md.';

-- ---------------------------------------------------------------------------
-- 2. 취소 뒤 출고 발견 원장
-- ---------------------------------------------------------------------------
create table private.canceled_shipment_dispatches (
  id uuid primary key default extensions.gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  shipment_id uuid not null unique,
  source text not null check (source in ('tracking_reply', 'warehouse_reply')),
  reply_id uuid references private.warehouse_stop_replies(id) on delete restrict,
  carrier text,
  tracking_number text check (tracking_number is null or tracking_number ~ '^[A-Z0-9]{8,30}$'),
  tracking_recorded_at timestamptz,
  discovered_by uuid not null references public.profiles(id) on delete restrict,
  discovered_at timestamptz not null default clock_timestamp(),
  -- 취소가 되돌린 수량(restored)·발견 때 다시 뺀 수량(withdrawn)·재고가 모자라 빼지 못한 수량(shortfall, 그사이 다시 팔렸다).
  restored_qty integer not null default 0 check (restored_qty >= 0),
  withdrawn_qty integer not null default 0 check (withdrawn_qty >= 0),
  shortfall_qty integer not null default 0 check (shortfall_qty >= 0),
  state text not null default 'open' check (state in ('open', 'returned', 'lost')),
  resolved_by uuid references public.profiles(id) on delete restrict,
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or (resolution_note = btrim(resolution_note)
    and char_length(resolution_note) between 5 and 500 and translate(resolution_note, E'\n\r\t', '') !~ '[[:cntrl:]]')),
  resolve_operation_id uuid unique,
  returned_qty integer check (returned_qty is null or returned_qty >= 0),
  foreign key (order_id, shipment_id) references public.order_shipments(order_id, id) on delete restrict,
  check ((carrier is null) = (tracking_number is null) and (tracking_number is null) = (tracking_recorded_at is null)),
  check (source <> 'warehouse_reply' or reply_id is not null),
  check (withdrawn_qty + shortfall_qty = restored_qty),
  check ((state = 'open') = (resolved_at is null) and (resolved_at is null) = (resolved_by is null)
    and (resolved_at is null) = (resolution_note is null) and (resolved_at is null) = (resolve_operation_id is null)),
  check ((state = 'returned') = (returned_qty is not null))
);
create index canceled_shipment_dispatches_order on private.canceled_shipment_dispatches(order_id);
create index canceled_shipment_dispatches_open on private.canceled_shipment_dispatches(discovered_at) where state = 'open';

create table private.canceled_shipment_dispatch_stock (
  dispatch_id uuid not null references private.canceled_shipment_dispatches(id) on delete restrict,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  -- 발견 때 재고를 뺀 옵션(그때의 승계 옵션). 회수 입고 때는 이 옵션의 지금 승계 옵션에 되돌린다.
  good_id text not null,
  variant_id uuid not null,
  restored_qty integer not null check (restored_qty > 0),
  withdrawn_qty integer not null check (withdrawn_qty between 0 and restored_qty),
  returned_qty integer check (returned_qty is null or returned_qty = withdrawn_qty),
  primary key (dispatch_id, order_item_id)
);
create index canceled_shipment_dispatch_stock_variant on private.canceled_shipment_dispatch_stock(variant_id);
alter table private.canceled_shipment_dispatches enable row level security;
alter table private.canceled_shipment_dispatch_stock enable row level security;
revoke all on private.canceled_shipment_dispatches, private.canceled_shipment_dispatch_stock from public, anon, authenticated, service_role;
comment on table private.canceled_shipment_dispatches is
  '출고지시 뒤 취소된 배송 건이 실제로 출고된 것을 발견한 기록과 처리(회수 입고·손실, ADR-0046).';

-- ---------------------------------------------------------------------------
-- 3. 판정 도우미
-- ---------------------------------------------------------------------------
-- 배송 건의 지금 출고지시에 대한 가장 늦은 회신(회신 시각 → 기록 시각 순). 없으면 null.
create function private.warehouse_stop_current_reply(p_shipment_id uuid) returns private.warehouse_stop_replies
language sql stable security definer set search_path = '' as $$
  select r.* from private.warehouse_stop_replies r join public.order_shipments s on s.id = r.shipment_id
  where r.shipment_id = p_shipment_id and r.exported_at = s.exported_at
  order by r.replied_at desc, r.recorded_at desc, r.id desc limit 1;
$$;
revoke all on function private.warehouse_stop_current_reply(uuid) from public, anon, authenticated, service_role;

-- not_applicable(출고지시 전·발송 대기 아님) · required(회신 없음) · stopped · already_shipped · used(출고 중단 회신을 이미 다른 취소에 씀)
create function private.warehouse_stop_status(p_shipment_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when s.status <> 'ready' or s.exported_at is null or s.shipped_at is not null then 'not_applicable'
    when r.id is null then 'required'
    when r.outcome = 'already_shipped' then 'already_shipped'
    when r.used_at is not null then 'used'
    else 'stopped' end
  from public.order_shipments s left join lateral (select (private.warehouse_stop_current_reply(s.id)).*) r on true
  where s.id = p_shipment_id;
$$;
revoke all on function private.warehouse_stop_status(uuid) from public, anon, authenticated, service_role;

-- 취소 시작이 부르는 판정. 출고지시가 나간 발송 대기 배송 건마다 쓸 수 있는 '출고 중단' 회신이 있어야 하고,
-- 그 회신 id를 돌려준다(배송 건 id 순). '이미 출고' 회신이 가장 먼저 거절 사유다.
create function private.warehouse_stop_gate(p_shipment_ids uuid[]) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare statuses text[];
begin
  if p_shipment_ids is null or cardinality(p_shipment_ids) = 0 then return '{}'::uuid[]; end if;
  select coalesce(array_agg(private.warehouse_stop_status(x.id)), '{}') into statuses from unnest(p_shipment_ids) x(id);
  if 'already_shipped' = any(statuses) then raise check_violation using message = 'warehouse_already_shipped'; end if;
  if 'required' = any(statuses) then raise check_violation using message = 'warehouse_stop_reply_required'; end if;
  if 'used' = any(statuses) then raise check_violation using message = 'warehouse_stop_reply_used'; end if;
  return coalesce((select array_agg((private.warehouse_stop_current_reply(x.id)).id order by x.id)
    from unnest(p_shipment_ids) x(id) where private.warehouse_stop_status(x.id) = 'stopped'), '{}'::uuid[]);
end $$;
revoke all on function private.warehouse_stop_gate(uuid[]) from public, anon, authenticated, service_role;

create function private.consume_warehouse_stop_replies(p_reply_ids uuid[], p_kind text, p_ref uuid, p_actor uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare used integer;
begin
  if p_reply_ids is null or cardinality(p_reply_ids) = 0 then return; end if;
  update private.warehouse_stop_replies set used_at = clock_timestamp(), used_by = p_actor, used_kind = p_kind, used_ref = p_ref
  where id = any(p_reply_ids) and used_at is null and outcome = 'stopped';
  get diagnostics used = row_count;
  if used <> cardinality(p_reply_ids) then raise check_violation using message = 'warehouse_stop_reply_used'; end if;
end $$;
revoke all on function private.consume_warehouse_stop_replies(uuid[], text, uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. 취소 뒤 출고 발견 기록(반입 경로·'이미 출고' 회신이 부른다)
-- ---------------------------------------------------------------------------
create function private.canceled_shipment_dispatch_document(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'shipmentId', d.shipment_id, 'shipmentNumber', s.shipment_number, 'originName', s.origin_name_snapshot,
    'source', d.source, 'replyId', d.reply_id, 'carrier', d.carrier, 'trackingNumber', d.tracking_number, 'trackingRecordedAt', d.tracking_recorded_at,
    'discoveredAt', d.discovered_at, 'discoveredByName', discoverer.nickname, 'state', d.state,
    'restoredQty', d.restored_qty, 'withdrawnQty', d.withdrawn_qty, 'shortfallQty', d.shortfall_qty, 'returnedQty', d.returned_qty,
    'resolvedAt', d.resolved_at, 'resolvedByName', resolver.nickname, 'resolutionNote', d.resolution_note,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('orderItemId', x.order_item_id, 'goodName', i.good_name_snapshot,
        'variantName', i.variant_name_snapshot, 'restoredQty', x.restored_qty, 'withdrawnQty', x.withdrawn_qty, 'returnedQty', x.returned_qty)
        order by i.good_name_snapshot, x.order_item_id)
      from private.canceled_shipment_dispatch_stock x join public.order_items i on i.id = x.order_item_id where x.dispatch_id = d.id), '[]'::jsonb))
  from private.canceled_shipment_dispatches d
  join public.order_shipments s on s.id = d.shipment_id
  left join public.profiles discoverer on discoverer.id = d.discovered_by
  left join public.profiles resolver on resolver.id = d.resolved_by
  where d.id = p_id;
$$;
revoke all on function private.canceled_shipment_dispatch_document(uuid) from public, anon, authenticated, service_role;

create function private.record_canceled_shipment_dispatch(p_shipment_id uuid, p_carrier text, p_tracking text, p_source text, p_reply_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  shipment public.order_shipments;
  existing private.canceled_shipment_dispatches;
  v_id uuid;
  carrier_value text := nullif(btrim(coalesce(p_carrier, '')), '');
  tracking_value text := private.normalize_tracking_number(p_tracking);
  entry record;
  target record;
  available integer;
  taken integer;
  restored_total integer := 0;
  withdrawn_total integer := 0;
begin
  if actor is null then raise insufficient_privilege using message = 'operator_capability_required'; end if;
  if p_source is null or p_source not in ('tracking_reply', 'warehouse_reply') or (p_source = 'warehouse_reply') <> (p_reply_id is not null) then
    raise invalid_parameter_value using message = 'invalid_canceled_dispatch';
  end if;
  if (carrier_value is null) <> (tracking_value is null) then raise check_violation using message = 'invalid_tracking_input'; end if;
  select * into shipment from public.order_shipments where id = p_shipment_id for update;
  if not found then raise no_data_found using message = 'shipment_not_found'; end if;
  if shipment.status <> 'canceled' or shipment.exported_at is null or shipment.shipped_at is not null or shipment.delivery_method <> 'parcel' then
    raise check_violation using message = 'canceled_dispatch_not_applicable';
  end if;
  if tracking_value is not null then
    if not exists(select 1 from public.shipping_carriers c where c.code = carrier_value) then
      raise check_violation using message = 'inactive_shipping_carrier';
    end if;
    -- 다른 배송 건이 쓰는 번호면 받지 않는다(뒤바뀐 회신 의심). 형식은 택배사 규칙을 따른다.
    perform private.assert_tracking_registrable(carrier_value, tracking_value, array[shipment.id], null);
  end if;

  select * into existing from private.canceled_shipment_dispatches where shipment_id = shipment.id for update;
  if found then
    if tracking_value is not null and existing.tracking_number is null then
      update private.canceled_shipment_dispatches
      set carrier = carrier_value, tracking_number = tracking_value, tracking_recorded_at = clock_timestamp()
      where id = existing.id;
      insert into public.audit_log(actor_id, action, target, diff)
      values (actor, 'admin.shipment.canceled_dispatch_tracking_recorded', 'order:' || shipment.order_id::text,
        jsonb_build_object('dispatchId', existing.id, 'shipmentId', shipment.id, 'originName', shipment.origin_name_snapshot,
          'carrier', carrier_value, 'trackingNumber', tracking_value));
      return jsonb_build_object('shipmentId', shipment.id, 'orderId', shipment.order_id, 'dispatched', false,
        'canceledAfterExport', true, 'discoveryId', existing.id, 'replayed', false, 'trackingRecorded', true);
    elsif tracking_value is not null and (existing.carrier is distinct from carrier_value or existing.tracking_number is distinct from tracking_value) then
      raise check_violation using message = 'canceled_dispatch_tracking_conflict';
    end if;
    return jsonb_build_object('shipmentId', shipment.id, 'orderId', shipment.order_id, 'dispatched', false,
      'canceledAfterExport', true, 'discoveryId', existing.id, 'replayed', true);
  end if;

  insert into private.canceled_shipment_dispatches(order_id, shipment_id, source, reply_id, carrier, tracking_number, tracking_recorded_at, discovered_by)
  values (shipment.order_id, shipment.id, p_source, p_reply_id, carrier_value, tracking_value,
    case when tracking_value is not null then clock_timestamp() end, actor)
  returning id into v_id;

  -- 실물 기준: 이 배송 건의 취소가 되돌린 재고(전액 취소의 품목별 복원, 이 배송 건을 닫은 부분 취소의 복원)를 다시 뺀다.
  -- 그사이 다시 팔려 재고가 모자라면 남은 만큼만 빼고 모자란 수량을 기록한다(과판매 — 운영자 확인 대상).
  begin
    perform private.lock_goods_stock_successor_topology();
    for entry in
      select si.order_item_id, a.diff->>'goodId' as good_id, (a.diff->>'variantId')::uuid as variant_id,
        sum((a.diff->>'delta')::integer)::integer as qty
      from public.order_shipment_items si
      join public.audit_log a on a.target = 'order:' || si.order_id::text and a.diff->>'orderItemId' = si.order_item_id::text
        and (a.action = 'order.option_stock_restored'
          or (a.action = 'order.option_stock_partially_restored' and (a.diff->>'partialCancellationId')::uuid in (
            select c.partial_cancellation_id from private.order_partial_cancellation_shipments c where c.shipment_id = shipment.id)))
      where si.shipment_id = shipment.id
      group by 1, 2, 3 having sum((a.diff->>'delta')::integer) > 0
      order by 1, 3
    loop
      select * into target from private.resolve_goods_stock_successor(entry.good_id, entry.variant_id);
      perform 1 from public.goods where id = target.good_id for update nowait;
      select v.stock_qty into available from public.goods_variants v where v.id = target.variant_id for update nowait;
      taken := least(entry.qty, greatest(coalesce(available, 0), 0));
      if taken > 0 then
        perform private.apply_group_physical_stock_deltas(jsonb_build_array(jsonb_build_object(
          'goodId', target.good_id, 'variantId', target.variant_id, 'delta', -taken)));
      end if;
      insert into private.canceled_shipment_dispatch_stock(dispatch_id, order_item_id, good_id, variant_id, restored_qty, withdrawn_qty)
      values (v_id, entry.order_item_id, target.good_id, target.variant_id, entry.qty, taken);
      -- 주문 전체 취소의 복원(order.option_stock_restored)과 다른 액션이다 — 재고 대조는 발견 원장으로 센다.
      insert into public.audit_log(actor_id, action, target, diff)
      values (actor, 'order.canceled_dispatch_stock_withdrawn', 'order:' || shipment.order_id::text,
        jsonb_build_object('dispatchId', v_id, 'shipmentId', shipment.id, 'orderItemId', entry.order_item_id,
          'goodId', target.good_id, 'variantId', target.variant_id, 'delta', -taken, 'restoredQty', entry.qty,
          'shortfallQty', entry.qty - taken, 'sourceGoodId', entry.good_id, 'sourceVariantId', entry.variant_id));
      restored_total := restored_total + entry.qty;
      withdrawn_total := withdrawn_total + taken;
    end loop;
  exception when lock_not_available then raise sqlstate 'PT409' using message = 'goods_group_retry';
  end;
  update private.canceled_shipment_dispatches
  set restored_qty = restored_total, withdrawn_qty = withdrawn_total, shortfall_qty = restored_total - withdrawn_total
  where id = v_id;

  insert into private.admin_operation_alerts(event_key, category, title, href)
  values ('canceled_shipment_dispatch:' || v_id::text || ':created', 'orders', '취소한 주문의 상품이 출고된 것으로 확인됐습니다. 고객 연락과 회수를 진행해주세요.',
    '/admin/sales/orders/' || shipment.order_id::text)
  on conflict (event_key) do nothing;
  insert into public.audit_log(actor_id, action, target, diff)
  values (actor, 'admin.shipment.canceled_dispatch_discovered', 'order:' || shipment.order_id::text,
    jsonb_build_object('dispatchId', v_id, 'shipmentId', shipment.id, 'originName', shipment.origin_name_snapshot, 'source', p_source,
      'replyId', p_reply_id, 'carrier', carrier_value, 'trackingNumber', tracking_value, 'exportedAt', shipment.exported_at,
      'restoredQty', restored_total, 'withdrawnQty', withdrawn_total, 'shortfallQty', restored_total - withdrawn_total));
  return jsonb_build_object('shipmentId', shipment.id, 'orderId', shipment.order_id, 'dispatched', false,
    'canceledAfterExport', true, 'discoveryId', v_id, 'replayed', false);
end $$;
revoke all on function private.record_canceled_shipment_dispatch(uuid, text, text, text, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. 운영자 RPC
-- ---------------------------------------------------------------------------
-- 창고 회신 기록(출고 담당 sales.dispatch — sales.manage가 포함한다). 한 주문의 배송 건 1~20개에 같은 회신을 남긴다.
create function public.admin_record_warehouse_stop_reply(
  p_shipment_ids uuid[], p_outcome text, p_channel text, p_replied_at timestamptz, p_note text, p_operation_id uuid
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_order uuid;
  v_orders integer;
  v_found integer;
  shipment public.order_shipments;
  reply_id uuid;
  reply_ids uuid[] := '{}';
  discovery jsonb;
  discovery_ids uuid[] := '{}';
begin
  actor := private.require_operator_capability('sales.dispatch', false);
  if p_operation_id is null or p_shipment_ids is null or cardinality(p_shipment_ids) not between 1 and 20
    or array_position(p_shipment_ids, null) is not null
    or (select count(distinct x.id) from unnest(p_shipment_ids) x(id)) <> cardinality(p_shipment_ids)
    or p_outcome is null or p_outcome not in ('stopped', 'already_shipped')
    or p_channel is null or p_channel not in ('phone', 'messenger', 'email', 'warehouse_system', 'other')
    or p_replied_at is null or not isfinite(p_replied_at)
    or (v_note is not null and (char_length(v_note) > 500 or translate(v_note, E'\n\r\t', '') ~ '[[:cntrl:]]'))
    or (p_channel = 'other' and v_note is null)
  then
    raise invalid_parameter_value using message = 'invalid_warehouse_stop_reply';
  end if;
  if p_replied_at > clock_timestamp() + interval '5 minutes' then
    raise check_violation using message = 'warehouse_stop_reply_in_future';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('warehouse-stop-reply:' || p_operation_id::text, 0));
  select count(*), count(distinct s.order_id), (array_agg(s.order_id))[1] into v_found, v_orders, v_order
  from public.order_shipments s where s.id = any(p_shipment_ids);
  if v_found <> cardinality(p_shipment_ids) then raise no_data_found using message = 'shipment_not_found'; end if;
  if v_orders <> 1 then raise invalid_parameter_value using message = 'warehouse_stop_reply_single_order'; end if;

  -- 공통 잠금 순서: order → shipments → 회신 → 발견. 취소 시작과 같은 순서라 회신 기록과 취소 판정이 줄을 선다.
  perform 1 from public.orders where id = v_order for update;
  perform 1 from public.order_shipments where id = any(p_shipment_ids) order by id for update;

  if exists(select 1 from private.warehouse_stop_replies r where r.operation_id = p_operation_id) then
    if exists(select 1 from private.warehouse_stop_replies r where r.operation_id = p_operation_id
        and (r.recorded_by <> actor or r.outcome <> p_outcome or r.channel <> p_channel or r.order_id <> v_order or not (r.shipment_id = any(p_shipment_ids))))
      or (select count(*) from private.warehouse_stop_replies r where r.operation_id = p_operation_id) <> cardinality(p_shipment_ids) then
      raise sqlstate 'PT409' using message = 'warehouse_stop_reply_operation_conflict';
    end if;
    return jsonb_build_object('orderId', v_order, 'outcome', p_outcome, 'replayed', true,
      'replyIds', (select jsonb_agg(r.id order by r.shipment_id) from private.warehouse_stop_replies r where r.operation_id = p_operation_id),
      'discoveryIds', coalesce((select jsonb_agg(d.id order by d.shipment_id) from private.canceled_shipment_dispatches d
        join private.warehouse_stop_replies r on r.id = d.reply_id where r.operation_id = p_operation_id), '[]'::jsonb));
  end if;

  for shipment in select * from public.order_shipments where id = any(p_shipment_ids) order by id loop
    if shipment.delivery_method <> 'parcel' or shipment.exported_at is null then
      raise check_violation using message = 'warehouse_stop_reply_not_exported';
    end if;
    if shipment.status not in ('ready', 'canceled') or shipment.shipped_at is not null then
      raise check_violation using message = 'warehouse_stop_reply_shipment_dispatched';
    end if;
    -- 회신은 그 출고지시 뒤의 일이다. 화면은 분 단위로 받으므로 출고지시와 같은 분까지 받는다.
    if p_replied_at < date_trunc('minute', shipment.exported_at) then
      raise check_violation using message = 'warehouse_stop_reply_before_export';
    end if;
    insert into private.warehouse_stop_replies(order_id, shipment_id, exported_at, outcome, channel, replied_at, note, recorded_by, operation_id)
    values (shipment.order_id, shipment.id, shipment.exported_at, p_outcome, p_channel, p_replied_at, v_note, actor, p_operation_id)
    returning id into reply_id;
    reply_ids := reply_ids || reply_id;
    insert into public.audit_log(actor_id, action, target, diff)
    values (actor, 'admin.shipment.warehouse_stop_reply_recorded', 'order:' || shipment.order_id::text,
      jsonb_build_object('replyId', reply_id, 'shipmentId', shipment.id, 'originName', shipment.origin_name_snapshot,
        'shipmentStatus', shipment.status, 'outcome', p_outcome, 'channel', p_channel, 'repliedAt', p_replied_at,
        'exportedAt', shipment.exported_at, 'note', v_note, 'operationId', p_operation_id));
    -- 이미 취소된 배송 건에 '이미 출고' 회신이 오면 취소 뒤 출고 발견이다(운송장은 회신 반입이 나중에 붙인다).
    if shipment.status = 'canceled' and p_outcome = 'already_shipped' then
      discovery := private.record_canceled_shipment_dispatch(shipment.id, null, null, 'warehouse_reply', reply_id);
      discovery_ids := discovery_ids || (discovery->>'discoveryId')::uuid;
    end if;
  end loop;
  return jsonb_build_object('orderId', v_order, 'outcome', p_outcome, 'replayed', false,
    'replyIds', to_jsonb(reply_ids), 'discoveryIds', to_jsonb(discovery_ids));
end $$;
revoke all on function public.admin_record_warehouse_stop_reply(uuid[], text, text, timestamptz, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_record_warehouse_stop_reply(uuid[], text, text, timestamptz, text, uuid) to authenticated;

-- 취소 뒤 출고 발견 처리(주문 처리 sales.manage). returned = 회수 입고 확인(뺀 재고를 되돌린다), lost = 회수 불가·손실(그대로).
create function public.admin_resolve_canceled_shipment_dispatch(p_dispatch_id uuid, p_outcome text, p_note text, p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid;
  v_note text := btrim(coalesce(p_note, ''));
  dispatch private.canceled_shipment_dispatches;
  shipment public.order_shipments;
  item record;
  target record;
  returned_total integer := 0;
begin
  actor := private.require_operator_capability('sales.manage', false);
  if p_dispatch_id is null or p_operation_id is null or p_outcome is null or p_outcome not in ('returned', 'lost')
    or char_length(v_note) not between 5 and 500 or translate(v_note, E'\n\r\t', '') ~ '[[:cntrl:]]' then
    raise invalid_parameter_value using message = 'invalid_canceled_dispatch_resolution';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('canceled-dispatch-resolve:' || p_operation_id::text, 0));
  select * into dispatch from private.canceled_shipment_dispatches where resolve_operation_id = p_operation_id;
  if found then
    if dispatch.id <> p_dispatch_id or dispatch.resolved_by <> actor or dispatch.state <> p_outcome then
      raise sqlstate 'PT409' using message = 'canceled_dispatch_operation_conflict';
    end if;
    return jsonb_build_object('dispatchId', dispatch.id, 'orderId', dispatch.order_id, 'state', dispatch.state,
      'returnedQty', dispatch.returned_qty, 'replayed', true);
  end if;
  select * into dispatch from private.canceled_shipment_dispatches where id = p_dispatch_id;
  if not found then raise no_data_found using message = 'canceled_dispatch_not_found'; end if;
  perform 1 from public.orders where id = dispatch.order_id for update;
  select * into shipment from public.order_shipments where id = dispatch.shipment_id for update;
  select * into dispatch from private.canceled_shipment_dispatches where id = p_dispatch_id for update;
  if dispatch.state <> 'open' then raise check_violation using message = 'canceled_dispatch_already_resolved'; end if;

  if p_outcome = 'returned' then
    begin
      perform private.lock_goods_stock_successor_topology();
      for item in select * from private.canceled_shipment_dispatch_stock where dispatch_id = dispatch.id order by order_item_id loop
        if item.withdrawn_qty > 0 then
          select * into target from private.resolve_goods_stock_successor(item.good_id, item.variant_id);
          perform private.apply_group_physical_stock_deltas(jsonb_build_array(jsonb_build_object(
            'goodId', target.good_id, 'variantId', target.variant_id, 'delta', item.withdrawn_qty)));
          insert into public.audit_log(actor_id, action, target, diff)
          values (actor, 'order.canceled_dispatch_stock_returned', 'order:' || dispatch.order_id::text,
            jsonb_build_object('dispatchId', dispatch.id, 'shipmentId', dispatch.shipment_id, 'orderItemId', item.order_item_id,
              'goodId', target.good_id, 'variantId', target.variant_id, 'delta', item.withdrawn_qty,
              'sourceGoodId', item.good_id, 'sourceVariantId', item.variant_id));
          returned_total := returned_total + item.withdrawn_qty;
        end if;
        update private.canceled_shipment_dispatch_stock set returned_qty = item.withdrawn_qty
        where dispatch_id = item.dispatch_id and order_item_id = item.order_item_id;
      end loop;
    exception when lock_not_available then raise sqlstate 'PT409' using message = 'goods_group_retry';
    end;
  end if;

  update private.canceled_shipment_dispatches
  set state = p_outcome, resolved_by = actor, resolved_at = clock_timestamp(), resolution_note = v_note,
    resolve_operation_id = p_operation_id, returned_qty = case when p_outcome = 'returned' then returned_total end
  where id = dispatch.id;
  insert into public.audit_log(actor_id, action, target, diff)
  values (actor, 'admin.shipment.canceled_dispatch_resolved', 'order:' || dispatch.order_id::text,
    jsonb_build_object('dispatchId', dispatch.id, 'shipmentId', dispatch.shipment_id, 'originName', shipment.origin_name_snapshot,
      'outcome', p_outcome, 'note', v_note, 'returnedQty', case when p_outcome = 'returned' then returned_total end,
      'operationId', p_operation_id));
  return jsonb_build_object('dispatchId', dispatch.id, 'orderId', dispatch.order_id, 'state', p_outcome,
    'returnedQty', case when p_outcome = 'returned' then returned_total end, 'replayed', false);
end $$;
revoke all on function public.admin_resolve_canceled_shipment_dispatch(uuid, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_resolve_canceled_shipment_dispatch(uuid, text, text, uuid) to authenticated;

-- 주문 상세·주문 패널이 읽는 회신·발견 상태(주문 조회 sales.read). 처리 버튼은 canRecord·canResolve로만 그린다.
create function public.admin_order_warehouse_stop_context(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.require_operator_capability('sales.read', false);
  if p_order_id is null then raise invalid_parameter_value using message = 'order_not_found'; end if;
  select jsonb_build_object(
    'orderId', o.id,
    'orderStatus', o.status,
    'canRecord', public.has_operator_capability('sales.dispatch', false),
    'canResolve', public.has_operator_capability('sales.manage', false),
    'shipments', coalesce((select jsonb_agg(jsonb_build_object(
        'shipmentId', s.id, 'shipmentNumber', s.shipment_number, 'originName', s.origin_name_snapshot, 'status', s.status,
        'exportedAt', s.exported_at, 'stopStatus', private.warehouse_stop_status(s.id),
        'replies', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'outcome', r.outcome, 'channel', r.channel,
            'repliedAt', r.replied_at, 'note', r.note, 'recordedAt', r.recorded_at, 'recordedByName', recorder.nickname,
            'current', r.exported_at = s.exported_at, 'usedKind', r.used_kind, 'usedAt', r.used_at)
            order by r.replied_at desc, r.recorded_at desc, r.id desc)
          from private.warehouse_stop_replies r left join public.profiles recorder on recorder.id = r.recorded_by
          where r.shipment_id = s.id), '[]'::jsonb))
        order by s.shipment_number nulls last, s.id)
      from public.order_shipments s
      where s.order_id = o.id and s.delivery_method = 'parcel' and s.exported_at is not null
        and ((s.status in ('ready', 'canceled') and s.shipped_at is null)
          or exists(select 1 from private.warehouse_stop_replies r where r.shipment_id = s.id))), '[]'::jsonb),
    'discoveries', coalesce((select jsonb_agg(private.canceled_shipment_dispatch_document(d.id) order by d.discovered_at, d.id)
      from private.canceled_shipment_dispatches d where d.order_id = o.id), '[]'::jsonb))
  into result
  from public.orders o where o.id = p_order_id;
  if result is null then raise no_data_found using message = 'order_not_found'; end if;
  return result;
end $$;
revoke all on function public.admin_order_warehouse_stop_context(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_order_warehouse_stop_context(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. 운영자 전액 취소: 확인란 대신 회신 판정(앵커 치환)
-- ---------------------------------------------------------------------------
select private.o3d_patch_function('public.admin_start_order_cancellation(uuid,text,text,boolean)'::regprocedure, array[
$a$  v_notice text;
begin$a$,
$a$  v_notice text;
  v_stop_reply_ids uuid[];
begin$a$,
$a$  if v_exported_count > 0 and p_warehouse_stop_confirmed is distinct from true then
    raise check_violation using message = 'warehouse_stop_confirmation_required';
  end if;$a$,
$a$  -- 출고지시가 나간 배송 건의 창고 회신 판정은 다른 거절 사유를 모두 본 뒤 요청을 만들기 직전에 한다(ADR-0046).$a$,
$a$  v_reason_label := case p_reason_code$a$,
$a$  -- 출고지시가 나간 배송 건마다 그 출고지시 뒤 창고의 '출고 중단' 회신 기록이 있어야 한다(ADR-0046).
  -- 확인란(p_warehouse_stop_confirmed)은 시그니처 호환으로만 남고 근거가 아니다. 진행 중 요청·결제 같은 다른 거절 사유를
  -- 먼저 알린다(같은 주문을 두 번 누르면 두 번째는 회신이 아니라 진행 중 요청으로 거절된다).
  v_stop_reply_ids := private.warehouse_stop_gate(array(
    select shipment.id from public.order_shipments as shipment
    where shipment.order_id = p_order_id and shipment.status = 'ready' and shipment.exported_at is not null
    order by shipment.id));

  v_reason_label := case p_reason_code$a$,
$a$  insert into private.operator_cancellation_authorizations(request_id,actor_id)$a$,
$a$  -- 쓴 '출고 중단' 회신은 이 요청에 묶여 다른 취소의 근거가 되지 않는다.
  perform private.consume_warehouse_stop_replies(v_stop_reply_ids, 'staff_cancellation', v_request_id, v_actor);

  insert into private.operator_cancellation_authorizations(request_id,actor_id)$a$,
$a$      'warehouseStopConfirmed', v_exported_count > 0,$a$,
$a$      'warehouseStopConfirmed', v_exported_count > 0,
      'warehouseStopReplyIds', pg_catalog.to_jsonb(v_stop_reply_ids),$a$
]);

-- ---------------------------------------------------------------------------
-- 7. 재고 부족 부분 취소: 확인란 판정 줄만 회신 판정으로(앵커 치환 — 같은 함수의 다른 줄은 다른 작업이 고친다)
-- ---------------------------------------------------------------------------
select private.o3d_patch_function('public.admin_start_order_partial_cancellation(uuid,jsonb,text,text,boolean,bigint,uuid,jsonb)'::regprocedure, array[
$a$  if (plan->>'warehouseStopRequired')::boolean and p_warehouse_stop_confirmed is distinct from true then
    raise check_violation using message = 'warehouse_stop_confirmation_required';
  end if;$a$,
$a$  -- 출고지시가 나간 배송 건의 품목이면 그 배송 건마다 출고지시 뒤 창고의 '출고 중단' 회신 기록이 있어야 하고,
  -- 쓴 회신은 이 부분 취소 요청번호에 묶인다(ADR-0046). 확인란 인자는 근거가 아니다.
  if (plan->>'warehouseStopRequired')::boolean then
    perform private.consume_warehouse_stop_replies(private.warehouse_stop_gate(array(
      select distinct (x.value->>'shipmentId')::uuid from jsonb_array_elements(plan->'lines') x
      where (x.value->>'exported')::boolean)), 'partial_cancellation', p_operation_id, v_actor);
  end if;$a$
]);

-- ---------------------------------------------------------------------------
-- 8. 반입 경로: 출고지시 뒤 취소된 배송 건의 운송장 회신을 발견으로 남긴다
-- ---------------------------------------------------------------------------
-- 단건·김포·표준 양식·서원 일괄 등록은 모두 이 함수로 배송 건을 하나씩 처리한다.
select private.o3d_patch_function('public.admin_import_shipment_tracking(text,text,text)'::regprocedure, array[
$a$ changed:=shipment.status='ready';$a$,
$a$ -- 출고지시 뒤 취소된 배송 건의 운송장 회신은 오류로 버리지 않고 '취소 뒤 출고 발견'으로 남긴다(ADR-0046).
 if shipment.status='canceled' and shipment.exported_at is not null and shipment.shipped_at is null and shipment.delivery_method='parcel' then
  return private.record_canceled_shipment_dispatch(shipment.id,carrier_value,tracking_value,'tracking_reply',null);
 end if;
 changed:=shipment.status='ready';$a$
]);

-- 서원 사전 검증은 한 줄이라도 걸리면 파일 전체를 거절한다. 출고지시 뒤 취소된 배송 건은 통과시켜 위 발견으로 보낸다.
select private.o3d_patch_function('public.admin_import_seowon_tracking_batch(uuid,jsonb)'::regprocedure, array[
$a$  elsif shipment.status not in('shipping','delivered') or exists(select 1 from public.orders where id=shipment.order_id and status='canceled') then$a$,
$a$  elsif shipment.status='canceled' and shipment.exported_at is not null and shipment.shipped_at is null then
   -- 출고지시 뒤 취소된 배송 건: 일괄 등록이 '취소 뒤 출고 발견'으로 남긴다(ADR-0046). 추가 운송장은 붙이지 않는다.
   if row_value ? 'extraTrackingNumbers' then raise check_violation using message='canceled_dispatch_extra_tracking';end if;
  elsif shipment.status not in('shipping','delivered') or exists(select 1 from public.orders where id=shipment.order_id and status='canceled') then$a$
]);

-- 서원 회신 대조 후보에 최근 45일 안에 출고지시된 뒤 취소된 배송 건을 더한다(앱은 같은 내용의 발송 대기 건과 겹치면 넘겨짚지 않는다).
select private.o3d_patch_function('public.admin_origin_tracking_candidates(uuid,text[],text[])'::regprocedure, array[
$a$     or(s.status in('shipping','delivered') and o.status<>'canceled' and s.shipped_at>=now()-interval '45 days'))$a$,
$a$     or(s.status in('shipping','delivered') and o.status<>'canceled' and s.shipped_at>=now()-interval '45 days')
     or(s.status='canceled' and s.exported_at is not null and s.shipped_at is null and s.exported_at>=now()-interval '45 days'))$a$
]);

-- ---------------------------------------------------------------------------
-- 9. 재고 파일 대조: 발견은 기준 시각 뒤 출고, 회수 입고는 기준 시각 뒤 회수로 센다(실물 수량)
-- ---------------------------------------------------------------------------
select private.o3d_patch_function('private.stock_reconcile_flows(uuid[],timestamp with time zone)'::regprocedure, array[
$a$      +coalesce((select sum(r.qty) from reshipped r where r.holder_id=t.id and r.left_at>p_as_of),0))::bigint,$a$,
$a$      +coalesce((select sum(r.qty) from reshipped r where r.holder_id=t.id and r.left_at>p_as_of),0)
      -- 출고지시 뒤 취소됐는데 실제로 나간 배송 건(ADR-0046): 발견 시각에 창고를 떠난 것으로 본다.
      +coalesce((select sum(x.restored_qty) from private.canceled_shipment_dispatch_stock x
        join private.canceled_shipment_dispatches d on d.id=x.dispatch_id join members m on m.member_id=x.variant_id
        where m.holder_id=t.id and d.discovered_at>p_as_of),0))::bigint,$a$,
$a$    coalesce((select sum(r.qty) from returned r where r.holder_id=t.id and r.collected_at>p_as_of),0)::bigint,$a$,
$a$    (coalesce((select sum(r.qty) from returned r where r.holder_id=t.id and r.collected_at>p_as_of),0)
      +coalesce((select sum(x.restored_qty) from private.canceled_shipment_dispatch_stock x
        join private.canceled_shipment_dispatches d on d.id=x.dispatch_id join members m on m.member_id=x.variant_id
        where m.holder_id=t.id and d.state='returned' and d.resolved_at>p_as_of),0))::bigint,$a$
]);

-- ---------------------------------------------------------------------------
-- 10. 운영자 계약: 새 RPC는 새로, 고친 함수는 기존 분류값 그대로 지문을 다시 적는다
-- ---------------------------------------------------------------------------
select private.register_operator_rpc_contract('public.admin_record_warehouse_stop_reply(uuid[],text,text,timestamp with time zone,text,uuid)'::regprocedure, 'sales.dispatch', 'write', false);
select private.register_operator_rpc_contract('public.admin_resolve_canceled_shipment_dispatch(uuid,text,text,uuid)'::regprocedure, 'sales.manage', 'write', false);
select private.register_operator_rpc_contract('public.admin_order_warehouse_stop_context(uuid)'::regprocedure, 'sales.read', 'read', false);

do $$declare fn regprocedure; contract record; begin
  foreach fn in array array[
    'public.admin_start_order_cancellation(uuid,text,text,boolean)'::regprocedure,
    'public.admin_start_order_partial_cancellation(uuid,jsonb,text,text,boolean,bigint,uuid,jsonb)'::regprocedure,
    'public.admin_import_shipment_tracking(text,text,text)'::regprocedure,
    'public.admin_import_seowon_tracking_batch(uuid,jsonb)'::regprocedure,
    'public.admin_origin_tracking_candidates(uuid,text[],text[])'::regprocedure,
    'private.stock_reconcile_flows(uuid[],timestamp with time zone)'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
    elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $$;

drop function private.o3d_patch_function(regprocedure, text[]);

commit;
notify pgrst, 'reload schema';
