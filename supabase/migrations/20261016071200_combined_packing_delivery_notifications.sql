begin;
-- The application queues each original order notification with its existing idempotency key.
CREATE OR REPLACE FUNCTION public.admin_import_shipment_tracking(p_reference text, p_carrier text, p_tracking_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare reference_key uuid;shipment_key uuid;shipment public.order_shipments;changed boolean;
begin
  perform private.require_operator_capability('sales.manage',false);

 if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 reference_key:=btrim(p_reference)::uuid;
 select id into shipment_key from public.order_shipments where id=reference_key;
 if shipment_key is null then shipment_key:=private.single_order_shipment(reference_key);end if;
 perform private.lock_shipment_pack_scope(array[shipment_key]);
 perform o.id from public.orders o join public.order_shipments s on s.order_id=o.id where s.id=shipment_key for update of o;
 select * into shipment from public.order_shipments where id=shipment_key for update;
 changed:=shipment.status='ready';
 if changed then perform public.admin_update_shipment_status(shipment.id,'shipping',p_carrier,p_tracking_number);
 else perform public.admin_update_shipment_tracking(shipment.id,p_carrier,p_tracking_number);end if;
 return jsonb_build_object('shipmentId',shipment.id,'orderId',shipment.order_id,'dispatched',changed,'packedShipments',(select jsonb_agg(jsonb_build_object('shipmentId',s.id,'orderId',s.order_id) order by s.id) from public.order_shipments s where s.id=any(private.shipment_pack_scope(array[shipment.id]))));
end $function$;
commit;
