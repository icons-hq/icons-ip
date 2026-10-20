begin;
-- Report each affected original shipment, including unselected package members.
CREATE OR REPLACE FUNCTION public.admin_complete_shipments(target_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare shipment_key uuid;results jsonb:='[]'::jsonb;
begin
  perform private.require_operator_capability('sales.manage',false);

 if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required';end if;
 if cardinality(target_ids) is null or cardinality(target_ids) not between 1 and 1000 then raise invalid_parameter_value using message='invalid_shipment_selection';end if;
 perform private.lock_shipment_pack_scope(target_ids);
 perform o.id from public.orders o where exists(select 1 from public.order_shipments s where s.order_id=o.id and s.id=any(target_ids)) order by o.id for update;
 for shipment_key in select distinct id from unnest(target_ids) id order by id loop
  begin
   perform public.admin_update_shipment_status(shipment_key,'delivered',null,null);
   results:=results||jsonb_build_array(jsonb_build_object('id',shipment_key,'ok',true,'affectedIds',to_jsonb(private.shipment_pack_scope(array[shipment_key]))));
  exception when others then results:=results||jsonb_build_array(jsonb_build_object('id',shipment_key,'ok',false,'error',sqlerrm));end;
 end loop;
 return results;
end $function$;
commit;
