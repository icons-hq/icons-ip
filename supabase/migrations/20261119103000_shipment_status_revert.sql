begin;
-- 배송 상태 오처리 정정과 실제 도착 시각(원장 #14 — SHP-048·SHP-050·SHP-086·SHP-046·CLM-028, ADR-0045).
--
-- 1) 배송완료 되돌리기 admin_revert_shipment_delivery: 엉뚱한 배송 건을 배송완료로 누른 것을 배송 중으로 되돌린다. 합포장은 묶음 전체.
--    구매확정(주문 done)·리뷰·진행 중이거나 끝난 취소·반품·교환·부분 취소 진행 중이면 막는다(그 뒤의 돈·적립금·재고 흐름을 되감지 않는다).
--    운송장 없이 강제 배송완료한 택배 건은 발송된 적이 없어 발송 대기(주문 발주확인)로 되돌린다. 구매확정 보류 중이면 막는다(보류가 조용히 풀리지 않게).
--    구매확정 기한 행(order_purchase_confirmations)은 지운다 — 다음 배송완료 때 그 시각과 그때 정책으로 새로 잡힌다(포착 트리거가
--    `on conflict do nothing`이라 남겨 두면 잘못 누른 시각의 기한이 그대로 남는다). 지운 행은 되돌리기 원장과 감사에 남는다.
--    고객 앱의 "배송이 완료됐어요" 알림은 받은편지함에서 지운다(다음 배송완료 때 다시 간다). 이미 본 알림은 회수할 수 없어 화면이 연락을 안내한다.
-- 2) 발송 되돌리기 admin_revert_shipment_dispatch: 잘못 발송 처리한 배송 건을 발송 대기로 되돌린다. 대표·추가 운송장과 발송 시각을 비워
--    그 번호를 올바른 배송 건에 다시 쓸 수 있게 하고 이전 값은 원장·감사에 남긴다. 그 배송 건의 중복 등록 승인(tracking_duplicate_approvals)도
--    지운다 — 남기면 승인으로 등록했던 다른 주문의 번호를 되돌린 뒤 승인 없이 다시 등록할 수 있다(#679 가드 우회). 출고지시 전달(exported_at)은 그대로다.
--    아직 보내지 않은 발송 안내 메일 작업은 지우고(다시 발송하면 새로 쌓인다), 이미 보낸 메일은 회수할 수 없어 화면이 알린다.
-- 3) 실제 도착 시각 admin_complete_shipments_at: 선택 배송완료 때 택배사 조회의 배송완료 일시를 넣는다(기본은 처리 시각).
--    발송 등록 시각 이후·지금 이전만 받고, 처리 시각보다 7일(단순 변심 청약철회 기간) 넘게 이른 시각은 판매 관리 권한 + 사유로만 받는다.
--    건별로 입력한 일시가 실제로 기록됐는지(arrivalIds) 돌려준다. 기존 일괄 함수는 그대로 두고
--    이 함수가 트랜잭션 로컬 값으로 넘긴 시각을 안쪽 전이 함수가 읽는다(앵커 치환 한 줄).
-- 4) 택배 추적 자동 배송완료는 운영자가 배송완료를 되돌린 배송 건을 같은 발송(shipped_at) 동안 다시 자동 완료하지 않는다.
--
-- 다른 트랙이 같은 함수의 다른 줄을 고칠 수 있어 기존 함수는 앵커 치환으로만 바꾼다(앵커가 정확히 한 번이 아니면 멈춘다).

create function private.o3c_patch_function(p_signature text,p_anchor text,p_replacement text)
returns void language plpgsql volatile set search_path='' as $$
declare body text; found_count integer;
begin
  body:=pg_get_functiondef(p_signature::regprocedure);
  found_count:=(length(body)-length(replace(body,p_anchor,'')))/length(p_anchor);
  if found_count<>1 then raise exception 'o3c_anchor_changed: % (found %)',p_signature,found_count; end if;
  execute replace(body,p_anchor,p_replacement);
end $$;
revoke all on function private.o3c_patch_function(text,text,text) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 되돌리기 원장. 배송 건마다 되돌리기 직전 값(상태·시각·운송장·추가 운송장·메일 작업·구매확정 기한 행)을 남긴다.
-- 감사 기록이 같은 내용을 주문별로 남기지만, 자동 배송완료 제외 판정이 배송 건 단위로 읽어야 해 따로 둔다.
create table private.shipment_status_reverts (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  kind text not null check (kind in ('delivery','dispatch')),
  shipment_id uuid not null references public.order_shipments(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  previous jsonb not null check (jsonb_typeof(previous)='object'),
  reason text not null check (reason=btrim(reason) and char_length(reason) between 5 and 500),
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  unique (operation_id, shipment_id)
);
create index shipment_status_reverts_shipment_idx on private.shipment_status_reverts(shipment_id, kind, created_at);
alter table private.shipment_status_reverts enable row level security;
revoke all on table private.shipment_status_reverts from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 실제 도착 시각. admin_complete_shipments_at이 트랜잭션 로컬 값으로 넘기고, 없으면 지금(기존 동작)이다.
-- 배송 건마다 발송 등록 시각보다 이를 수 없다(택배 추적 자동 배송완료가 발송 등록 시각 밑으로 내리지 않는 것과 같은 하한).
create function private.shipment_operator_delivered_at(p_shipped_at timestamptz) returns timestamptz
language plpgsql volatile set search_path='' as $$
declare raw text:=nullif(current_setting('icons.shipment_delivered_at',true),''); value timestamptz;
begin
  if raw is null then return clock_timestamp(); end if;
  value:=raw::timestamptz;
  if p_shipped_at is not null and value<p_shipped_at then raise check_violation using message='delivered_at_before_shipped'; end if;
  return value;
end $$;
revoke all on function private.shipment_operator_delivered_at(timestamptz) from public,anon,authenticated,service_role;

select private.o3c_patch_function('private.admin_update_shipment_status_before_delivery_methods(uuid,text,text,text)',
  $a$delivered_at=case when p_status='delivered' then clock_timestamp() else delivered_at end$a$,
  $r$delivered_at=case when p_status='delivered' then private.shipment_operator_delivered_at(shipment.shipped_at) else delivered_at end$r$);

-- 선택 배송완료 + 택배사 도착 일시. 기존 admin_complete_shipments(uuid[])는 그대로 두고(옛 화면·시험 호환) 이 함수가 시각을 넘겨 부른다.
-- p_delivered_at이 null이면 처리 시각이다. 시계 차이로 몇 분 앞선 값은 지금으로 맞추고, 10분 넘게 미래면 거절한다.
create function public.admin_complete_shipments_at(target_ids uuid[], p_delivered_at timestamptz, p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; now_value timestamptz:=clock_timestamp(); at_value timestamptz; reason_value text:=nullif(btrim(coalesce(p_reason,'')),'');
  results jsonb; touched uuid[]; related record;
begin
  actor:=private.require_operator_capability('sales.dispatch',false);
  if cardinality(target_ids) is null or cardinality(target_ids) not between 1 and 1000 then raise invalid_parameter_value using message='invalid_shipment_selection'; end if;
  if reason_value is not null and char_length(reason_value) not between 5 and 500 then raise invalid_parameter_value using message='delivered_at_reason_invalid'; end if;
  if p_delivered_at is not null and p_delivered_at>now_value+interval '10 minutes' then raise check_violation using message='delivered_at_in_future'; end if;
  at_value:=least(coalesce(p_delivered_at,now_value),now_value);
  -- 처리 시각보다 7일(단순 변심 청약철회 기간) 넘게 이른 일시는 처리하는 순간 고객의 철회 기간을 지운다. 판매 관리 권한(되돌리기와 같은 권한)이
  -- 사유와 함께 넣을 때만 받는다 — SHP-086 원장의 "처리 지연은 고객 유리": 늦게 처리한 만큼의 고객 권리를 출고 담당이 소급해 지우지 않는다(ADR-0045).
  if at_value<now_value-interval '7 days' then
    if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='delivered_at_late_requires_manager'; end if;
    if reason_value is null then raise check_violation using message='delivered_at_late_reason_required'; end if;
  end if;
  perform set_config('icons.shipment_delivered_at',at_value::text,true);
  results:=public.admin_complete_shipments(target_ids);
  perform set_config('icons.shipment_delivered_at','',true);
  if p_delivered_at is not null then
    -- 건별로 입력한 일시가 실제로 기록된 배송 건(arrivalIds). 이미 배송완료돼 있던 건은 같은 상태 재처리라 일시를 바꾸지 않으므로 빠진다.
    select coalesce(jsonb_agg(entry.item||jsonb_build_object('arrivalIds',coalesce((select jsonb_agg(s.id order by s.id) from public.order_shipments s
        where s.id in(select value::uuid from jsonb_array_elements_text(coalesce(entry.item->'affectedIds','[]'::jsonb)))
          and s.status='delivered' and s.delivered_at=at_value),'[]'::jsonb)) order by entry.ord),'[]'::jsonb)
      into results from jsonb_array_elements(results) with ordinality as entry(item,ord);
    select coalesce(array_agg(distinct arrived.id::uuid),'{}'::uuid[]) into touched
      from jsonb_array_elements(results) item cross join lateral jsonb_array_elements_text(item->'arrivalIds') arrived(id);
    for related in select s.order_id, array_agg(s.id order by s.id) ids from public.order_shipments s
      where s.id=any(touched) group by s.order_id order by s.order_id loop
      insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipment.arrival_recorded','order:'||related.order_id,
        jsonb_build_object('shipmentIds',to_jsonb(related.ids),'deliveredAt',at_value,'processedAt',now_value,'reason',reason_value));
    end loop;
  end if;
  return results;
end $$;
revoke all on function public.admin_complete_shipments_at(uuid[],timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_complete_shipments_at(uuid[],timestamptz,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 되돌리기를 막는 사유(주문 단위). null이면 되돌릴 수 있다. 실행 함수가 주문을 잠근 뒤 부른다.
create function private.shipment_revert_blocker(p_order_id uuid, p_kind text) returns text
language sql stable security definer set search_path='' as $$
  select case
    when o.id is null then 'shipment_not_found'
    when o.status='canceled' then 'shipment_revert_order_canceled'
    when o.status='done' or exists(select 1 from private.order_purchase_confirmations c where c.order_id=o.id and c.confirmed_at is not null)
      then 'shipment_revert_purchase_confirmed'
    when exists(select 1 from public.reviews r where r.order_id=o.id) then 'shipment_revert_review_exists'
    -- 구매확정 보류(분쟁 조사 등)는 되돌리면 기한 행과 함께 사라져 다시 배송완료한 뒤 조용히 자동 확정될 수 있다. 보류를 먼저 해제하게 한다.
    when exists(select 1 from private.order_purchase_confirmations c where c.order_id=o.id and c.held) then 'shipment_revert_confirmation_held'
    when exists(select 1 from public.order_cancellation_claims k where k.order_id=o.id)
      or exists(select 1 from public.order_cancellation_requests q where q.order_id=o.id and q.stage not in ('rejected','withdrawn'))
      then 'shipment_revert_claim_exists'
    when private.order_partial_cancel_in_flight(o.id) then 'shipment_revert_partial_cancel_in_progress'
    when p_kind='delivery' and o.status not in ('shipping','delivered') then 'shipment_revert_order_state'
    when p_kind='dispatch' and o.status<>'shipping' then 'shipment_revert_order_state'
  end
  from (select 1) one left join public.orders o on o.id=p_order_id;
$$;
revoke all on function private.shipment_revert_blocker(uuid,text) from public,anon,authenticated,service_role;

-- 배송완료 되돌리기. p_expected_delivered_at은 화면이 본 배송완료 시각이다(그 사이 다시 처리됐으면 PT409).
create function public.admin_revert_shipment_delivery(p_shipment_id uuid, p_reason text, p_operation_id uuid, p_expected_delivered_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; reason_value text:=btrim(coalesce(p_reason,'')); request jsonb; receipt jsonb; ids uuid[]; picked public.order_shipments;
  member public.order_shipments; related record; blocker text; at_value timestamptz; before_status jsonb; confirmation jsonb;
  removed_notification uuid; removed_request uuid; removed_shipping uuid; order_ids uuid[]; order_status public.order_status; status_now public.order_status;
begin
  actor:=private.require_operator_capability('sales.manage',false);
  if p_shipment_id is null or p_operation_id is null or p_expected_delivered_at is null then raise invalid_parameter_value using message='invalid_shipment_revert'; end if;
  if char_length(reason_value) not between 5 and 500 then raise invalid_parameter_value using message='shipment_revert_reason_required'; end if;
  request:=jsonb_build_object('shipmentId',p_shipment_id,'reason',reason_value,'expectedDeliveredAt',p_expected_delivered_at);
  perform pg_advisory_xact_lock(hashtextextended('shipment-revert:'||p_operation_id::text,0));
  receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.shipment.delivery_reverted',request);
  if receipt is not null then return receipt; end if;
  -- 주문 id 순 → 배송 건 id 순(운영 배송완료·강제 배송완료·자동 배송완료·반품 접수와 같은 순서).
  ids:=private.lock_shipment_pack_scope(array[p_shipment_id]);
  select * into picked from public.order_shipments where id=p_shipment_id;
  if exists(select 1 from public.order_shipments where id=any(ids) and delivery_method<>'parcel') then raise check_violation using message='shipment_revert_parcel_only'; end if;
  if picked.status<>'delivered' then raise check_violation using message='shipment_revert_not_delivered'; end if;
  if picked.delivered_at is distinct from p_expected_delivered_at then raise sqlstate 'PT409' using message='shipment_revert_changed'; end if;
  if exists(select 1 from public.order_shipments where id=any(ids) and status<>'delivered') then raise check_violation using message='shipment_revert_pack_mixed'; end if;
  select array_agg(distinct order_id order by order_id) into order_ids from public.order_shipments where id=any(ids);
  for related in select unnest(order_ids) id loop
    blocker:=private.shipment_revert_blocker(related.id,'delivery');
    if blocker is not null then raise check_violation using message=blocker; end if;
  end loop;
  select jsonb_object_agg(id::text,status) into before_status from public.orders where id=any(order_ids);
  at_value:=clock_timestamp();
  for member in select * from public.order_shipments where id=any(ids) order by id loop
    insert into private.shipment_status_reverts(operation_id,kind,shipment_id,order_id,previous,reason,actor_id,created_at)
    values(p_operation_id,'delivery',member.id,member.order_id,jsonb_build_object('status',member.status,'deliveredAt',member.delivered_at,
      'shippedAt',member.shipped_at,'carrier',member.carrier,'trackingNumber',member.tracking_number,
      'autoDelivery',(select jsonb_build_object('state',a.state,'deliveredAt',a.delivered_at,'provider',a.provider) from private.shipment_auto_deliveries a where a.shipment_id=member.id),
      'orderStatus',before_status->>(member.order_id::text)),reason_value,actor,at_value);
    -- 운송장 없이 강제 배송완료한 택배 건은 발송된 적이 없다. 배송 중으로 두면 운송장 없이 다시 배송완료할 수 없으므로 발송 대기로 되돌린다.
    update public.order_shipments set status=case when member.tracking_number is null then 'ready' else 'shipping' end,
      shipped_at=case when member.tracking_number is null then null else shipped_at end,delivered_at=null,updated_at=at_value where id=member.id;
  end loop;
  -- 주문 상태는 배송 건 트리거(refresh_order_fulfillment)가 다시 계산했다. 배송 건이 모두 발송 대기가 된 주문은 트리거가 상태를 그대로 두므로
  -- 발주확인으로 되돌린다(배송 시작 알림을 만들지 않는다). 구매확정 기한·구매확정 요청 알림·배송완료 알림을 정리한다.
  for related in select o.id,o.user_id,o.status from public.orders o where o.id=any(order_ids) order by o.id loop
    removed_shipping:=null;
    if related.status in ('shipping','delivered') and not exists(select 1 from public.order_shipments s where s.order_id=related.id and s.status in ('shipping','delivered')) then
      update public.orders set status='confirmed' where id=related.id;
      delete from public.notifications where user_id=related.user_id and dedupe_key='order:shipping:'||related.id returning id into removed_shipping;
    end if;
    select status into status_now from public.orders where id=related.id;
    select to_jsonb(c) into confirmation from private.order_purchase_confirmations c where c.order_id=related.id;
    delete from private.order_purchase_confirmations where order_id=related.id and confirmed_at is null;
    removed_notification:=null; removed_request:=null;
    if before_status->>(related.id::text)='delivered' and status_now<>'delivered' then
      delete from public.notifications where user_id=related.user_id and dedupe_key='order:delivered:'||related.id returning id into removed_notification;
    end if;
    -- 운영자의 구매확정 요청 알림도 지운다. 남기면 다시 배송완료한 뒤의 재요청이 같은 dedupe 키로 가지 않는다.
    delete from public.notifications where user_id=related.user_id and dedupe_key='purchase-confirmation:'||related.id returning id into removed_request;
    if related.id=picked.order_id then order_status:=status_now; end if;
    update private.shipment_status_reverts set previous=previous||jsonb_build_object('purchaseConfirmation',confirmation,'deliveredNotificationRemoved',removed_notification is not null,
      'confirmationRequestNotificationRemoved',removed_request is not null,'shippingNotificationRemoved',removed_shipping is not null,'orderStatusAfter',status_now)
      where operation_id=p_operation_id and order_id=related.id;
    if related.id<>picked.order_id then
      insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipment.delivery_reverted','order:'||related.id,
        jsonb_build_object('viaPackOf',picked.order_id,'operationId',p_operation_id,'reason',reason_value,
          'shipmentId',(select min(id::text) from public.order_shipments where id=any(ids) and order_id=related.id),
          'shipmentIds',(select to_jsonb(array_agg(id order by id)) from public.order_shipments where id=any(ids) and order_id=related.id),
          'previous',(select jsonb_agg(jsonb_build_object('shipmentId',r.shipment_id,'deliveredAt',r.previous->'deliveredAt') order by r.shipment_id)
            from private.shipment_status_reverts r where r.operation_id=p_operation_id and r.order_id=related.id),
          'purchaseConfirmation',confirmation,'deliveredNotificationRemoved',removed_notification is not null,
          'confirmationRequestNotificationRemoved',removed_request is not null,'shippingNotificationRemoved',removed_shipping is not null));
    end if;
  end loop;
  receipt:=jsonb_build_object('orderId',picked.order_id,'shipmentId',picked.id,'shipmentIds',to_jsonb(ids),'orderCount',cardinality(order_ids),
    'orderStatus',order_status,'shipmentStatus',(select status from public.order_shipments where id=picked.id),
    'previousDeliveredAt',picked.delivered_at,'revertedAt',at_value);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.shipment.delivery_reverted','order:'||picked.order_id,
    jsonb_build_object('request',request,'result',receipt,'reason',reason_value,'shipmentId',picked.id,'originName',picked.origin_name_snapshot,
      'shipmentIds',to_jsonb(ids),
      'previous',(select jsonb_agg(jsonb_build_object('shipmentId',r.shipment_id,'deliveredAt',r.previous->'deliveredAt') order by r.shipment_id)
        from private.shipment_status_reverts r where r.operation_id=p_operation_id),
      'purchaseConfirmation',(select r.previous->'purchaseConfirmation' from private.shipment_status_reverts r where r.operation_id=p_operation_id and r.shipment_id=picked.id),
      'deliveredNotificationRemoved',(select (r.previous->>'deliveredNotificationRemoved')::boolean from private.shipment_status_reverts r where r.operation_id=p_operation_id and r.shipment_id=picked.id),
      'confirmationRequestNotificationRemoved',(select (r.previous->>'confirmationRequestNotificationRemoved')::boolean from private.shipment_status_reverts r where r.operation_id=p_operation_id and r.shipment_id=picked.id),
      'shippingNotificationRemoved',(select (r.previous->>'shippingNotificationRemoved')::boolean from private.shipment_status_reverts r where r.operation_id=p_operation_id and r.shipment_id=picked.id)));
  return receipt;
end $$;
revoke all on function public.admin_revert_shipment_delivery(uuid,text,uuid,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.admin_revert_shipment_delivery(uuid,text,uuid,timestamptz) to authenticated;

-- 발송 되돌리기. p_expected_tracking_number는 화면이 본 대표 운송장이다(그 사이 바뀌었으면 PT409). 운송장 없이 배송 중인 건(강제 배송완료를
-- 되돌린 건 등)은 빈 값으로 대조한다.
create function public.admin_revert_shipment_dispatch(p_shipment_id uuid, p_reason text, p_operation_id uuid, p_expected_tracking_number text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; reason_value text:=btrim(coalesce(p_reason,'')); expected text:=nullif(upper(btrim(coalesce(p_expected_tracking_number,''))),'');
  request jsonb; receipt jsonb; ids uuid[]; picked public.order_shipments; member public.order_shipments; related record; extra public.order_shipment_extra_trackings;
  blocker text; at_value timestamptz; order_ids uuid[]; extras jsonb; job public.order_shipment_email_jobs; email_sent boolean:=false;
  removed_notification uuid; order_status public.order_status; delivery_state text; approvals jsonb;
begin
  actor:=private.require_operator_capability('sales.manage',false);
  if p_shipment_id is null or p_operation_id is null then raise invalid_parameter_value using message='invalid_shipment_revert'; end if;
  if char_length(reason_value) not between 5 and 500 then raise invalid_parameter_value using message='shipment_revert_reason_required'; end if;
  request:=jsonb_build_object('shipmentId',p_shipment_id,'reason',reason_value,'expectedTrackingNumber',expected);
  perform pg_advisory_xact_lock(hashtextextended('shipment-revert:'||p_operation_id::text,0));
  receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.shipment.dispatch_reverted',request);
  if receipt is not null then return receipt; end if;
  ids:=private.lock_shipment_pack_scope(array[p_shipment_id]);
  select * into picked from public.order_shipments where id=p_shipment_id;
  if exists(select 1 from public.order_shipments where id=any(ids) and delivery_method<>'parcel') then raise check_violation using message='shipment_revert_parcel_only'; end if;
  if picked.status<>'shipping' then raise check_violation using message='shipment_revert_not_shipping'; end if;
  if picked.tracking_number is distinct from expected then raise sqlstate 'PT409' using message='shipment_revert_changed'; end if;
  if exists(select 1 from public.order_shipments where id=any(ids) and status<>'shipping') then raise check_violation using message='shipment_revert_pack_mixed'; end if;
  select array_agg(distinct order_id order by order_id) into order_ids from public.order_shipments where id=any(ids);
  for related in select unnest(order_ids) id loop
    blocker:=private.shipment_revert_blocker(related.id,'dispatch');
    if blocker is not null then raise check_violation using message=blocker; end if;
  end loop;
  at_value:=clock_timestamp();
  for member in select * from public.order_shipments where id=any(ids) order by id loop
    select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'carrier',x.carrier,'trackingNumber',x.tracking_number,'source',x.source,'createdAt',x.created_at) order by x.created_at,x.id),'[]'::jsonb)
      into extras from public.order_shipment_extra_trackings x where x.shipment_id=member.id;
    select coalesce(jsonb_agg(jsonb_build_object('carrier',a.carrier,'trackingNumber',a.tracking_number,'reason',a.reason,'conflict',a.conflict,'actorId',a.actor_id,'createdAt',a.created_at)
      order by a.created_at,a.id),'[]'::jsonb) into approvals from private.tracking_duplicate_approvals a where a.shipment_id=member.id;
    job:=null;
    select * into job from public.order_shipment_email_jobs where shipment_id=member.id for update;
    -- 발송 안내 메일을 지금 보내는 중이면(작업 임대 중·메일 원장 발송 중) 끝난 뒤 다시 한다. 보내는 중인 메일이 옛 운송장으로
    -- 나갔는지 알 수 없게 되지 않도록 작업 행을 잠근 뒤 본다. 보냈거나 결과를 모르는 메일은 고객 안내가 필요하다고 알린다.
    delivery_state:=private.shipment_email_delivery_state(member.order_id,member.id);
    if job.status='processing' and job.lease_until>clock_timestamp() or delivery_state='busy' then
      raise sqlstate 'PT409' using message='shipment_revert_email_sending'; end if;
    if job.status='completed' or delivery_state in ('sent','unknown') then email_sent:=true; end if;
    insert into private.shipment_status_reverts(operation_id,kind,shipment_id,order_id,previous,reason,actor_id,created_at)
    values(p_operation_id,'dispatch',member.id,member.order_id,jsonb_build_object('status',member.status,'carrier',member.carrier,'trackingNumber',member.tracking_number,
      'shippedAt',member.shipped_at,'exportedAt',member.exported_at,'extraTrackings',extras,
      'emailJob',case when job.shipment_id is not null then jsonb_build_object('status',job.status,'attempts',job.attempts,'completedAt',job.completed_at) end,
      'emailDelivery',delivery_state,'duplicateApprovals',approvals),
      reason_value,actor,at_value);
    -- 추가 운송장도 비운다. 이력(private.order_shipment_tracking_changes)에 운영자 삭제로 남긴다(작업 ID는 배송 건·번호마다 파생).
    for extra in select * from public.order_shipment_extra_trackings where shipment_id=member.id order by created_at,id for update loop
      delete from public.order_shipment_extra_trackings where id=extra.id;
      insert into private.order_shipment_tracking_changes(order_id,shipment_id,action,carrier,tracking_number,source,reason,actor_id,operation_id)
      values(extra.order_id,extra.shipment_id,'removed',extra.carrier,extra.tracking_number,'operator',reason_value,actor,extensions.uuid_generate_v5(p_operation_id,'extra:'||extra.id::text));
    end loop;
    -- 이 배송 건의 중복 등록 승인(대표·추가 번호)도 지운다. 다시 등록할 때 다른 주문의 번호면 다시 승인을 받아야 한다(#679).
    delete from private.tracking_duplicate_approvals where shipment_id=member.id;
    -- 아직 보내지 않은 메일 작업은 지운다(다시 발송 처리하면 올바른 운송장으로 새로 쌓인다). 보낸 작업은 남긴다 — 같은 배송 건 메일은 다시 보내지 않는다.
    if job.shipment_id is not null and job.status<>'completed' then delete from public.order_shipment_email_jobs where shipment_id=member.id; end if;
    update public.order_shipments set status='ready',carrier=null,tracking_number=null,shipped_at=null,delivered_at=null,updated_at=at_value where id=member.id;
  end loop;
  -- 배송 건 트리거는 남은 배송 건이 모두 발송 대기면 주문 상태를 그대로 둔다(derive_order_shipment_status). 그런 주문은 발주확인으로 되돌린다.
  for related in select o.id,o.user_id,o.status from public.orders o where o.id=any(order_ids) order by o.id loop
    removed_notification:=null;
    if related.status='shipping' and not exists(select 1 from public.order_shipments s where s.order_id=related.id and s.status in ('shipping','delivered')) then
      update public.orders set status='confirmed' where id=related.id;
      delete from public.notifications where user_id=related.user_id and dedupe_key='order:shipping:'||related.id returning id into removed_notification;
    end if;
    if related.id=picked.order_id then select status into order_status from public.orders where id=related.id; end if;
    if related.id<>picked.order_id then
      insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipment.dispatch_reverted','order:'||related.id,
        jsonb_build_object('viaPackOf',picked.order_id,'operationId',p_operation_id,'reason',reason_value,
          'shipmentId',(select min(id::text) from public.order_shipments where id=any(ids) and order_id=related.id),
          'shipmentIds',(select to_jsonb(array_agg(id order by id)) from public.order_shipments where id=any(ids) and order_id=related.id),
          'previous',(select jsonb_agg(r.previous||jsonb_build_object('shipmentId',r.shipment_id) order by r.shipment_id)
            from private.shipment_status_reverts r where r.operation_id=p_operation_id and r.order_id=related.id),
          'shippingNotificationRemoved',removed_notification is not null));
    end if;
  end loop;
  receipt:=jsonb_build_object('orderId',picked.order_id,'shipmentId',picked.id,'shipmentIds',to_jsonb(ids),'orderCount',cardinality(order_ids),
    'orderStatus',order_status,'previousTrackingNumber',picked.tracking_number,'previousCarrier',picked.carrier,'emailSent',email_sent,'revertedAt',at_value);
  insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.shipment.dispatch_reverted','order:'||picked.order_id,
    jsonb_build_object('request',request,'result',receipt,'reason',reason_value,'shipmentId',picked.id,'originName',picked.origin_name_snapshot,
      'shipmentIds',to_jsonb(ids),
      'previous',(select jsonb_agg(r.previous||jsonb_build_object('shipmentId',r.shipment_id) order by r.shipment_id)
        from private.shipment_status_reverts r where r.operation_id=p_operation_id)));
  return receipt;
end $$;
revoke all on function public.admin_revert_shipment_dispatch(uuid,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_revert_shipment_dispatch(uuid,text,uuid,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 택배 추적 자동 배송완료: 운영자가 배송완료를 되돌린 배송 건은 같은 발송 동안(되돌린 시각이 발송 등록 시각 이후) 자동으로 다시 완료하지 않는다.
-- 같은 운송장의 "배달완료" 이벤트가 남아 있어 다음 회차가 되돌리기를 곧바로 덮어쓰기 때문이다. 발송을 되돌려 다시 발송하면 새 발송 시각부터 다시 본다.
select private.o3c_patch_function('public.service_complete_tracked_deliveries(integer)',
  $a$and not exists(select 1 from private.shipment_auto_deliveries a where a.shipment_id = s.id and a.state = 'held' and a.updated_at > now() - interval '6 hours')$a$,
  $r$and not exists(select 1 from private.shipment_auto_deliveries a where a.shipment_id = s.id and a.state = 'held' and a.updated_at > now() - interval '6 hours')
      and not exists(select 1 from private.shipment_status_reverts r where r.shipment_id = s.id and r.kind = 'delivery' and r.created_at >= s.shipped_at)$r$);
select private.o3c_patch_function('public.service_complete_tracked_deliveries(integer)',
  $a$or s.tracking_number is null or s.shipped_at is null$a$,
  $r$or s.tracking_number is null or s.shipped_at is null
            or exists(select 1 from private.shipment_status_reverts r where r.shipment_id = s.id and r.kind = 'delivery' and r.created_at >= s.shipped_at)$r$);

-- 운영자 계약(새 RPC). 정정은 출고 담당(sales.dispatch)보다 넓은 판매 관리 권한이다 — 강제 배송완료와 같다.
select private.register_operator_rpc_contract('public.admin_complete_shipments_at(uuid[],timestamp with time zone,text)'::regprocedure,'sales.dispatch','write',false);
select private.register_operator_rpc_contract('public.admin_revert_shipment_delivery(uuid,text,uuid,timestamp with time zone)'::regprocedure,'sales.manage','write',false);
select private.register_operator_rpc_contract('public.admin_revert_shipment_dispatch(uuid,text,uuid,text)'::regprocedure,'sales.manage','write',false);

drop function private.o3c_patch_function(text,text,text);
commit;
