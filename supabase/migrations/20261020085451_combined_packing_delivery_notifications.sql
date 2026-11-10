begin;
-- The application queues each original order notification with its existing idempotency key.

CREATE OR REPLACE FUNCTION public.admin_import_shipment_tracking(p_reference text, p_carrier text, p_tracking_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare reference_key uuid;shipment_key uuid;shipment public.order_shipments;changed boolean;scope_ids uuid[];
 carrier_value text:=nullif(btrim(p_carrier),'');
 tracking_value text:=nullif(upper(regexp_replace(btrim(p_tracking_number),'[[:space:]-]','','g')),'');
begin
 perform private.require_operator_capability('sales.manage',false);
 reference_key:=btrim(p_reference)::uuid;
 select id into shipment_key from public.order_shipments where id=reference_key;
 if shipment_key is null then shipment_key:=private.single_order_shipment(reference_key);end if;
 scope_ids:=private.lock_shipment_pack_scope(array[shipment_key]);
 select * into shipment from public.order_shipments where id=shipment_key;
 changed:=shipment.status='ready';
 if changed then
  -- A pack moves together. Existing dispatch evidence must never be overwritten
  -- by importing a ready sibling from a stale or inconsistent reply.
  if exists(select 1 from public.order_shipments where id=any(scope_ids) and status<>'ready') then
   raise check_violation using message='shipment_tracking_conflict';end if;
  perform public.admin_update_shipment_status(shipment.id,'shipping',carrier_value,tracking_value);
 else
  perform private.lock_parcel_shipment(shipment.id);
  if exists(select 1 from public.order_shipments s join public.orders o on o.id=s.order_id
   where s.id=any(scope_ids) and(s.delivery_method<>'parcel' or s.status not in('shipping','delivered') or o.status='canceled')) then
   raise check_violation using message='order_not_shipped';end if;
  if exists(select 1 from public.order_shipments where id=any(scope_ids)
   and(carrier is distinct from carrier_value or tracking_number is distinct from tracking_value)) then
   raise check_violation using message='shipment_tracking_conflict';end if;
 end if;
 return jsonb_build_object('shipmentId',shipment.id,'orderId',shipment.order_id,'dispatched',changed,
  'packedShipments',(select jsonb_agg(jsonb_build_object('shipmentId',s.id,'orderId',s.order_id) order by s.id)
   from public.order_shipments s where s.id=any(scope_ids)))
  ||case when changed then '{}'::jsonb else jsonb_build_object('unchanged',true) end;
end $function$;
commit;
