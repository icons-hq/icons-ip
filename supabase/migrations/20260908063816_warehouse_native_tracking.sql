-- #429: native warehouse export values come from the order/shipment snapshots.
create or replace function public.admin_shipment_export(target_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare expected_count integer;result jsonb;
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 expected_count:=cardinality(target_ids);
 if expected_count is null or expected_count not between 1 and 1000 or expected_count<>(select count(distinct id) from unnest(target_ids) id) then raise invalid_parameter_value using message='invalid_export_selection';end if;
 if (select count(*) from public.order_shipments s join public.orders o on o.id=s.order_id where s.id=any(target_ids)
   and s.status='ready' and o.status in ('confirmed','shipping'))<>expected_count then raise check_violation using message='shipment_not_ready';end if;
 if exists(select 1 from public.order_cancellation_requests r join public.order_shipments s on s.order_id=r.order_id where s.id=any(target_ids) and r.status in ('requested','processing','needs_review'))
 or exists(select 1 from public.order_cancellation_claims c join public.order_shipments s on s.order_id=c.order_id where s.id=any(target_ids)) then raise check_violation using message='order cancellation in progress';end if;
 if (select count(*) from public.order_shipment_items where shipment_id=any(target_ids))>10000 then raise check_violation using message='export_item_limit';end if;
 select jsonb_build_object('shipments',jsonb_agg(jsonb_build_object('id',s.id,'updatedAt',s.updated_at,'originId',s.origin_id,
  'originName',s.origin_name_snapshot,'shippingFee',s.shipping_fee,'template',origin.export_template,'columns',origin.export_columns,
  'lines',coalesce((select jsonb_agg(jsonb_build_object('shipmentId',s.id,'orderId',o.id,'recipient',coalesce(o.address->>'recipientName',''),
   'phone',coalesce(o.address->>'phone',''),'postalCode',coalesce(o.address->>'postalCode',''),
   'address',concat_ws(' ',o.address->>'address1',nullif(o.address->>'address2','')),'goodCode',coalesce(g.code,i.good_id,''),
   'variantCode',coalesce(i.variant_code_snapshot,''),'goodName',i.good_name_snapshot,'optionName',coalesce(i.variant_name_snapshot,''),'qty',i.qty,'unitPrice',i.unit_price,'deliveryNote',coalesce(o.address->>'deliveryNote',''),'carrier',coalesce(carrier.label,'')) order by i.id)
   from public.order_shipment_items link join public.order_items i on i.id=link.order_item_id left join public.goods g on g.id=i.good_id where link.shipment_id=s.id),'[]')) order by origin.code,s.created_at,s.id)) into result
 from public.order_shipments s join public.orders o on o.id=s.order_id join public.fulfillment_origins origin on origin.id=s.origin_id
 left join public.shipping_carriers carrier on carrier.code=origin.default_carrier where s.id=any(target_ids);
 return result;
end $$;
revoke all on function public.admin_shipment_export(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_shipment_export(uuid[]) to authenticated;

-- Native Kimpo replies repeat the same order once per exported item. Resolve only
-- full shop order UUIDs within an explicit origin; never guess from customer data.
-- Each shipment is one savepoint: conflicts reject every row in its group before
-- any write, while unrelated valid shipments can still complete.
create function public.admin_import_warehouse_tracking_batch(target_origin_id uuid, target_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  input jsonb;
  normalized jsonb := '[]';
  outcomes jsonb := '{}';
  results jsonb := '[]';
  reference_value text;
  order_key uuid;
  shipment_key uuid;
  tracking_value text;
  row_error text;
  group_error text;
  group_row record;
  matches integer;
  origin public.fulfillment_origins;
  completed jsonb;
  outcome jsonb;
  seen uuid[] := '{}';
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message='staff required';
  end if;
  if jsonb_typeof(target_rows) is distinct from 'array' then
    raise invalid_parameter_value using message='invalid_tracking_batch';
  end if;
  if jsonb_array_length(target_rows) not between 1 and 1000 then
    raise invalid_parameter_value using message='invalid_tracking_batch';
  end if;
  if target_origin_id is null then
    raise invalid_parameter_value using message='warehouse_origin_required';
  end if;

  for input in select value from jsonb_array_elements(target_rows) loop
    reference_value := null;
    order_key := null;
    tracking_value := null;
    row_error := null;
    begin
      if jsonb_typeof(input) is distinct from 'object' then
        raise invalid_parameter_value using message='invalid_tracking_row';
      end if;
      reference_value := btrim(input->>'reference');
      if jsonb_typeof(input->'reference') is distinct from 'string'
        or reference_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise invalid_parameter_value using message='invalid_warehouse_order_reference';
      end if;
      order_key := reference_value::uuid;
      -- Keep the parsed order on row errors so an invalid sibling cannot let the
      -- first valid row write half of the same shipment group.
      if exists(select 1 from jsonb_object_keys(input) key where key not in ('line','reference','trackingNumber'))
        or jsonb_typeof(input->'line') is distinct from 'number'
        or (input->>'line') !~ '^[0-9]+$'
        or (input->>'line')::numeric not between 1 and 2147483647
        or jsonb_typeof(input->'trackingNumber') is distinct from 'string' then
        raise invalid_parameter_value using message='invalid_tracking_row';
      end if;
      tracking_value := upper(regexp_replace(btrim(input->>'trackingNumber'),'[[:space:]-]','','g'));
      if tracking_value !~ '^[A-Z0-9]{8,30}$' then
        raise check_violation using message='invalid_tracking_input';
      end if;
    exception when others then row_error := sqlerrm;
    end;
    normalized := normalized || jsonb_build_array(jsonb_build_object(
      'line',input->'line','reference',reference_value,'orderId',order_key,
      'trackingNumber',tracking_value,'error',row_error));
  end loop;

  -- Same global order->origin->shipment lock ordering as order/dispatch writers.
  -- Lock every existing order before per-shipment savepoints, including groups
  -- with invalid tracking data. Opposite file row orders cannot deadlock.
  perform o.id from public.orders o where exists(
    select 1 from jsonb_array_elements(normalized) row_value
    where row_value->>'orderId'=o.id::text
  ) order by o.id for update;
  select * into origin from public.fulfillment_origins where id=target_origin_id for share;
  if not found then raise no_data_found using message='warehouse_origin_not_found'; end if;
  if not origin.is_active then raise check_violation using message='warehouse_origin_inactive'; end if;
  if origin.export_template<>'wms_csv' then raise check_violation using message='warehouse_template_required'; end if;
  if origin.default_carrier is null then raise check_violation using message='warehouse_carrier_required'; end if;
  perform code from public.shipping_carriers where code=origin.default_carrier and is_active for share;
  if not found then raise check_violation using message='inactive_shipping_carrier'; end if;

  for group_row in
    select (value->>'orderId')::uuid order_id, jsonb_agg(value) rows
    from jsonb_array_elements(normalized)
    where value->>'orderId' is not null
    group by value->>'orderId' order by value->>'orderId'
  loop
    begin
      select value->>'error' into group_error from jsonb_array_elements(group_row.rows)
        where value->>'error' is not null limit 1;
      if group_error is not null then raise check_violation using message=group_error; end if;
      if (select count(distinct value->>'trackingNumber') from jsonb_array_elements(group_row.rows))<>1 then
        raise check_violation using message='conflicting_shipment_tracking';
      end if;
      select count(*),(array_agg(id))[1] into matches,shipment_key
        from public.order_shipments where order_id=group_row.order_id and origin_id=origin.id;
      if matches=0 then raise no_data_found using message='shipment_not_found'; end if;
      if matches<>1 then raise check_violation using message='shipment_reference_required'; end if;
      tracking_value := group_row.rows->0->>'trackingNumber';
      completed := public.admin_import_shipment_tracking(shipment_key::text,origin.default_carrier,tracking_value);
      outcomes := outcomes || jsonb_build_object(group_row.order_id::text,completed||jsonb_build_object('ok',true));
    exception when others then
      outcomes := outcomes || jsonb_build_object(group_row.order_id::text,jsonb_build_object('ok',false,'error',sqlerrm));
    end;
  end loop;

  -- Return one outcome per original row, in file order. Only the first successful
  -- row represents the mutation; duplicate rows must not count or enqueue twice.
  for input in select value from jsonb_array_elements(normalized) loop
    order_key := (input->>'orderId')::uuid;
    outcome := case when order_key is null then jsonb_build_object('ok',false,'error',input->>'error')
      else outcomes->order_key::text end;
    if outcome->>'ok'='true' then
      if order_key=any(seen) then
        outcome := outcome || jsonb_build_object('duplicate',true,'dispatched',false);
      else
        seen := array_append(seen,order_key);
        outcome := outcome || jsonb_build_object('duplicate',false);
      end if;
    end if;
    results := results || jsonb_build_array(outcome||jsonb_build_object('line',input->'line','reference',input->>'reference'));
  end loop;
  return results;
end $$;
revoke all on function public.admin_import_warehouse_tracking_batch(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_import_warehouse_tracking_batch(uuid,jsonb) to authenticated;
