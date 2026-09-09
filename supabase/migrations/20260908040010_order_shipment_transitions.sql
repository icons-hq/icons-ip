-- #446: warehouse transitions are shipment-scoped. Lock order before shipment in
-- every writer so concurrent warehouses serialize only their shared aggregate.
drop trigger orders_legacy_shipment_sync on public.orders;
drop function private.sync_legacy_order_shipment();

create function private.refresh_order_fulfillment(target_order uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare purchase public.orders; next_status public.order_status; first_shipped timestamptz; last_delivered timestamptz; single_shipment public.order_shipments;
begin
  select * into purchase from public.orders where id=target_order for update;
  if not found or purchase.status in ('pending','canceled','done') then return; end if;
  next_status:=private.derive_order_shipment_status(target_order);
  select min(shipped_at),case when bool_and(status='delivered' and delivered_at is not null) then max(delivered_at) end
    into first_shipped,last_delivered from public.order_shipments where order_id=target_order;
  if (select count(*) from public.order_shipments where order_id=target_order)=1 then
    select * into single_shipment from public.order_shipments where order_id=target_order;
  end if;
  update public.orders set status=next_status,shipped_at=first_shipped,delivered_at=last_delivered,
    shipping_carrier=single_shipment.carrier,tracking_number=single_shipment.tracking_number where id=target_order;
end $$;
revoke all on function private.refresh_order_fulfillment(uuid) from public,anon,authenticated,service_role;
create function private.refresh_shipment_order_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform private.refresh_order_fulfillment(new.order_id);return new;end $$;
revoke all on function private.refresh_shipment_order_trigger() from public,anon,authenticated,service_role;
create trigger shipments_refresh_order after update of status,carrier,tracking_number,shipped_at,delivered_at on public.order_shipments
for each row execute function private.refresh_shipment_order_trigger();
create function private.cancel_order_shipments() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='canceled' and old.status is distinct from new.status then
   update public.order_shipments set status='canceled',updated_at=now() where order_id=new.id and status<>'canceled';
 end if;
 return new;
end $$;
revoke all on function private.cancel_order_shipments() from public,anon,authenticated,service_role;
create trigger orders_cancel_shipments after update of status on public.orders for each row execute function private.cancel_order_shipments();

create function private.assert_order_dispatch_allowed(target_order uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.order_cancellation_requests where order_id=target_order and status in ('requested','processing','needs_review'))
    or exists(select 1 from public.order_cancellation_claims where order_id=target_order) then
    raise check_violation using message='order cancellation in progress';
  end if;
end $$;
revoke all on function private.assert_order_dispatch_allowed(uuid) from public,anon,authenticated,service_role;

create function public.admin_update_shipment_status(p_shipment_id uuid,p_status text,p_carrier text,p_tracking_number text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid()); shipment public.order_shipments; purchase public.orders;
 carrier_value text:=nullif(btrim(p_carrier),'');tracking_value text:=nullif(btrim(p_tracking_number),'');
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 select o.* into purchase from public.orders o join public.order_shipments s on s.order_id=o.id where s.id=p_shipment_id for update of o;
 if not found then raise no_data_found using message='shipment_not_found';end if;
 select * into shipment from public.order_shipments where id=p_shipment_id for update;
 if p_status is null or p_status not in ('shipping','delivered') then raise check_violation using message='invalid_shipment_status';end if;
 if shipment.status=p_status then return;end if;
 if purchase.status not in ('confirmed','shipping','delivered')
   or not ((shipment.status='ready' and p_status='shipping') or (shipment.status='shipping' and p_status='delivered')) then
   raise check_violation using message='invalid_shipment_transition';
 end if;
 perform private.assert_order_dispatch_allowed(purchase.id);
 carrier_value:=coalesce(carrier_value,shipment.carrier);tracking_value:=coalesce(tracking_value,shipment.tracking_number);
 if carrier_value is null or tracking_value is null then raise check_violation using message='tracking_required';end if;
 if tracking_value !~ '^[A-Z0-9]{8,30}$' then raise check_violation using message='invalid_tracking_input';end if;
 if carrier_value is distinct from shipment.carrier and not exists(select 1 from public.shipping_carriers where code=carrier_value and is_active) then
   raise check_violation using message='inactive_shipping_carrier';end if;
 update public.order_shipments set status=p_status,carrier=carrier_value,tracking_number=tracking_value,
   shipped_at=case when p_status='shipping' then clock_timestamp() else shipped_at end,
   delivered_at=case when p_status='delivered' then clock_timestamp() else delivered_at end,updated_at=clock_timestamp()
   where id=p_shipment_id;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipment.status_updated','order:'||purchase.id,
   jsonb_build_object('shipmentId',shipment.id,'originName',shipment.origin_name_snapshot,'from',shipment.status,'to',p_status,'carrier',carrier_value,'trackingNumber',tracking_value));
end $$;
revoke all on function public.admin_update_shipment_status(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_update_shipment_status(uuid,text,text,text) to authenticated;

create function public.admin_update_shipment_tracking(p_shipment_id uuid,p_carrier text,p_tracking_number text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());shipment public.order_shipments;purchase public.orders;
 carrier_value text:=nullif(btrim(p_carrier),'');tracking_value text:=nullif(btrim(p_tracking_number),'');
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 select o.* into purchase from public.orders o join public.order_shipments s on s.order_id=o.id where s.id=p_shipment_id for update of o;
 if not found then raise no_data_found using message='shipment_not_found';end if;
 select * into shipment from public.order_shipments where id=p_shipment_id for update;
 if shipment.status not in ('shipping','delivered') or purchase.status='canceled' then raise check_violation using message='order_not_shipped';end if;
 if carrier_value is null or tracking_value is null then raise check_violation using message='tracking_required';end if;
 if tracking_value !~ '^[A-Z0-9]{8,30}$' then raise check_violation using message='invalid_tracking_input';end if;
 if shipment.carrier is not distinct from carrier_value and shipment.tracking_number is not distinct from tracking_value then return;end if;
 if carrier_value is distinct from shipment.carrier and not exists(select 1 from public.shipping_carriers where code=carrier_value and is_active) then
   raise check_violation using message='inactive_shipping_carrier';end if;
 update public.order_shipments set carrier=carrier_value,tracking_number=tracking_value,updated_at=clock_timestamp() where id=p_shipment_id;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipment.tracking_updated','order:'||purchase.id,
   jsonb_build_object('shipmentId',shipment.id,'originName',shipment.origin_name_snapshot,'fromCarrier',shipment.carrier,'fromTrackingNumber',shipment.tracking_number,'toCarrier',carrier_value,'toTrackingNumber',tracking_value));
end $$;
revoke all on function public.admin_update_shipment_tracking(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_update_shipment_tracking(uuid,text,text) to authenticated;

create function private.single_order_shipment(target_order uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare shipment_key uuid;shipment_count integer;
begin
 select count(*),(array_agg(id))[1] into shipment_count,shipment_key from public.order_shipments where order_id=target_order;
 if shipment_count=0 then raise no_data_found using message='shipment_not_found';end if;
 if shipment_count>1 then raise check_violation using message='shipment_reference_required';end if;
 return shipment_key;
end $$;
revoke all on function private.single_order_shipment(uuid) from public,anon,authenticated,service_role;

create or replace function public.admin_update_order_status(p_order_id uuid,p_status public.order_status,p_carrier text,p_tracking_number text)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());purchase public.orders;
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 select * into purchase from public.orders where id=p_order_id for update;
 if not found then raise no_data_found using message='order_not_found';end if;
 if p_status is null or p_status not in ('confirmed','shipping','delivered') then raise check_violation using message='invalid_order_status';end if;
 if p_status in ('shipping','delivered') then
   perform public.admin_update_shipment_status(private.single_order_shipment(p_order_id),p_status::text,p_carrier,p_tracking_number);return;
 end if;
 if purchase.status='confirmed' then return;end if;
 if purchase.status<>'paid' then raise exception using message='invalid_order_transition';end if;
 perform private.assert_order_dispatch_allowed(p_order_id);
 update public.orders set status='confirmed',confirmed_at=clock_timestamp() where id=p_order_id;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.status_updated','order:'||p_order_id,
  jsonb_build_object('from',purchase.status,'to','confirmed'));
end $$;
revoke all on function public.admin_update_order_status(uuid,public.order_status,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_update_order_status(uuid,public.order_status,text,text) to authenticated;
create or replace function public.admin_update_order_tracking(p_order_id uuid,p_carrier text,p_tracking_number text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 perform id from public.orders where id=p_order_id for update;
 if not found then raise no_data_found using message='order_not_found';end if;
 perform public.admin_update_shipment_tracking(private.single_order_shipment(p_order_id),p_carrier,p_tracking_number);
end $$;
revoke all on function public.admin_update_order_tracking(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_update_order_tracking(uuid,text,text) to authenticated;

create function public.admin_import_shipment_tracking(p_reference text,p_carrier text,p_tracking_number text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare reference_key uuid;shipment_key uuid;shipment public.order_shipments;changed boolean;
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 reference_key:=btrim(p_reference)::uuid;
 select id into shipment_key from public.order_shipments where id=reference_key;
 if shipment_key is null then shipment_key:=private.single_order_shipment(reference_key);end if;
 perform o.id from public.orders o join public.order_shipments s on s.order_id=o.id where s.id=shipment_key for update of o;
 select * into shipment from public.order_shipments where id=shipment_key for update;
 changed:=shipment.status='ready';
 if changed then perform public.admin_update_shipment_status(shipment.id,'shipping',p_carrier,p_tracking_number);
 else perform public.admin_update_shipment_tracking(shipment.id,p_carrier,p_tracking_number);end if;
 return jsonb_build_object('shipmentId',shipment.id,'orderId',shipment.order_id,'dispatched',changed);
end $$;
revoke all on function public.admin_import_shipment_tracking(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_import_shipment_tracking(text,text,text) to authenticated;

-- Every shipment must independently pass the full eight-day window.
create or replace function public.settle_delivered_orders()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_count integer := 0;
  r record;
begin
  /*
   * 클레임이 걸린 주문은 후보 쿼리에서 미리 걸러낸다.
   *
   * 루프 안에서 continue로 건너뛰면 그 행이 limit 예산을 먹는다. delivered_at 오름차순
   * 정렬이라 오래 막힌 행이 늘 맨 앞에 서고, needs_review로 주차된 요청처럼 스스로
   * 풀리지 않는 클레임이 예산만큼 쌓이면 뒤의 멀쩡한 주문이 영원히 확정되지 않는다.
   * (실측: 막힌 행 200건 + 정상 1건이면 반환값이 계속 0이다.)
   *
   * limit은 한 번의 실행이 무한정 길어지지 않게 두는 안전장치다. 초과분은 다음 날
   * 오래된 것부터 빠지므로 밀려도 순서는 지켜진다.
   */
  for r in
    select orders.id
    from public.orders
    where orders.status = 'delivered'
      and exists(select 1 from public.order_shipments s where s.order_id=orders.id)
      and not exists(select 1 from public.order_shipments s where s.order_id=orders.id
        and (s.status<>'delivered' or s.delivered_at is null or s.delivered_at + interval '8 days' >= now()))
      and not exists (
        select 1
        from public.order_cancellation_requests as request
        where request.order_id = orders.id
          and request.status in ('requested', 'processing', 'needs_review')
      )
      and not exists (
        select 1
        from public.order_cancellation_claims as claim
        where claim.order_id = orders.id
      )
    order by orders.delivered_at, orders.id
    limit 1000
    for update of orders skip locked
  loop
    /* 후보를 고른 뒤 행 잠금을 얻기 전에 클레임이 끼어들 수 있다. 예산과 무관한
       방어용 재확인이라 여기서는 continue가 기아를 만들지 않는다. */
    if exists (
      select 1
      from public.order_cancellation_requests as request
      where request.order_id = r.id
        and request.status in ('requested', 'processing', 'needs_review')
    ) or exists (
      select 1
      from public.order_cancellation_claims as claim
      where claim.order_id = r.id
    ) then
      continue;
    end if;

    -- status 조건을 update에도 남겨 재실행이 done_at을 덮어쓰지 않게 한다.
    update public.orders
    set
      status = 'done',
      done_at = now()
    where id = r.id
      and status = 'delivered';

    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$function$;

-- default privileges 봉인(AGENTS.md) — 스케줄러(postgres)와 수동 운영(service_role)만 실행
revoke all on function public.settle_delivered_orders()
  from public, anon, authenticated, service_role;
grant execute on function public.settle_delivered_orders() to service_role;

