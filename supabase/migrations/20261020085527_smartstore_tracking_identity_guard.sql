begin;
-- An unreadable item identity cannot be assigned to a shipment group. Accepting
-- the other rows could dispatch its entire shipment through a valid sibling.
-- Resolve every identity before delegating any write; known groups retain the
-- existing per-shipment validation and whole-pack lock order.
alter function public.admin_import_item_tracking_batch(jsonb) rename to admin_import_item_tracking_batch_before_identity_guard;
alter function public.admin_import_item_tracking_batch_before_identity_guard(jsonb) set schema private;
revoke all on function private.admin_import_item_tracking_batch_before_identity_guard(jsonb) from public,anon,authenticated,service_role;

create function public.admin_import_item_tracking_batch(target_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare input jsonb;identified jsonb:='[]';reference_value text;shipment_key uuid;order_key uuid;row_error text;
begin
  perform private.require_operator_capability('sales.manage',false);
  if jsonb_typeof(target_rows) is distinct from 'array' then raise invalid_parameter_value using message='invalid_tracking_batch';end if;
  if jsonb_array_length(target_rows) not between 1 and 1000 then raise invalid_parameter_value using message='invalid_tracking_batch';end if;
  for input in select value from jsonb_array_elements(target_rows) loop
    reference_value:=null;shipment_key:=null;order_key:=null;row_error:=null;
    if jsonb_typeof(input) is distinct from 'object' then row_error:='invalid_tracking_row';
    elsif jsonb_typeof(input->'reference') is distinct from 'string' then row_error:='invalid_item_order_reference';
    else
      reference_value:=btrim(input->>'reference');
      if reference_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then row_error:='invalid_item_order_reference';
      else
        select link.shipment_id,link.order_id into shipment_key,order_key from public.order_shipment_items link where link.order_item_id=reference_value::uuid;
        if shipment_key is null then row_error:='shipment_item_not_found';end if;
      end if;
    end if;
    identified:=identified||jsonb_build_array(jsonb_build_object('line',input->'line','reference',reference_value,
      'shipmentId',shipment_key,'orderId',order_key,'error',row_error));
  end loop;
  if exists(select 1 from jsonb_array_elements(identified) row_value where row_value->>'error' is not null) then
    return(select jsonb_agg(row_value.value||jsonb_build_object('ok',false,
      'error',coalesce(row_value.value->>'error','item_tracking_identity_unresolved')) order by row_value.ordinality)
      from jsonb_array_elements(identified) with ordinality row_value(value,ordinality));
  end if;
  return private.admin_import_item_tracking_batch_before_identity_guard(target_rows);
end $$;
revoke all on function public.admin_import_item_tracking_batch(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_import_item_tracking_batch(jsonb) to authenticated;
select private.register_operator_internal_contract('private.admin_import_item_tracking_batch_before_identity_guard(jsonb)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_import_item_tracking_batch(jsonb)'::regprocedure,'sales.manage','write',false);
notify pgrst,'reload schema';
commit;
