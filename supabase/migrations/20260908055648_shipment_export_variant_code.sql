-- #429 correction: preserve the standard twelve columns and allow an optional warehouse SKU.
-- Order-item snapshots keep historical option codes even when the catalog changes.
create or replace function private.valid_shipment_export_columns(columns_value jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
 select case when jsonb_typeof(columns_value) is distinct from 'array' then false
 else jsonb_array_length(columns_value) between 12 and 13
   and (select count(distinct value->>'key')=jsonb_array_length(columns_value)
     and count(distinct btrim(value->>'header'))=jsonb_array_length(columns_value)
     and count(*) filter(where value->>'key'=any(array['shipmentId','orderId','recipient','phone','postalCode','address','goodCode','goodName','optionName','qty','deliveryNote','carrier']))=12
     and bool_and(coalesce(jsonb_typeof(value)='object'
       and value->>'key'=any(array['shipmentId','orderId','recipient','phone','postalCode','address','goodCode','goodName','optionName','qty','deliveryNote','carrier','variantCode'])
       and jsonb_typeof(value->'header')='string' and length(btrim(value->>'header')) between 1 and 80
       and (value->>'header')!~ '[[:cntrl:]]',false))
     from jsonb_array_elements(columns_value)) end;
$$;
revoke all on function private.valid_shipment_export_columns(jsonb) from public,anon,authenticated,service_role;

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
  'originName',s.origin_name_snapshot,'template',origin.export_template,'columns',origin.export_columns,
  'lines',coalesce((select jsonb_agg(jsonb_build_object('shipmentId',s.id,'orderId',o.id,'recipient',coalesce(o.address->>'recipientName',''),
   'phone',coalesce(o.address->>'phone',''),'postalCode',coalesce(o.address->>'postalCode',''),
   'address',concat_ws(' ',o.address->>'address1',nullif(o.address->>'address2','')),'goodCode',coalesce(g.code,i.good_id,''),
   'variantCode',coalesce(i.variant_code_snapshot,''),'goodName',i.good_name_snapshot,'optionName',coalesce(i.variant_name_snapshot,''),'qty',i.qty,'deliveryNote',coalesce(o.address->>'deliveryNote',''),'carrier',coalesce(carrier.label,'')) order by i.id)
   from public.order_shipment_items link join public.order_items i on i.id=link.order_item_id left join public.goods g on g.id=i.good_id where link.shipment_id=s.id),'[]')) order by origin.code,s.created_at,s.id)) into result
 from public.order_shipments s join public.orders o on o.id=s.order_id join public.fulfillment_origins origin on origin.id=s.origin_id
 left join public.shipping_carriers carrier on carrier.code=origin.default_carrier where s.id=any(target_ids);
 return result;
end $$;
revoke all on function public.admin_shipment_export(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_shipment_export(uuid[]) to authenticated;

