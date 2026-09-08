-- #429: shipment directory and configurable warehouse exchange columns.
alter table public.fulfillment_origins add column export_columns jsonb not null default '[{"key":"shipmentId","header":"배송건번호"},{"key":"orderId","header":"주문번호"},{"key":"recipient","header":"수취인"},{"key":"phone","header":"연락처"},{"key":"postalCode","header":"우편번호"},{"key":"address","header":"주소"},{"key":"goodCode","header":"상품코드"},{"key":"goodName","header":"상품명"},{"key":"optionName","header":"옵션"},{"key":"qty","header":"수량"},{"key":"deliveryNote","header":"배송메시지"},{"key":"carrier","header":"택배사"}]'::jsonb;
create function private.valid_shipment_export_columns(columns_value jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
 select case when jsonb_typeof(columns_value) is distinct from 'array' then false
 else jsonb_array_length(columns_value)=12
   and (select count(distinct value->>'key')=12 and count(distinct btrim(value->>'header'))=12
     and bool_and(jsonb_typeof(value)='object' and value->>'key'=any(array['shipmentId','orderId','recipient','phone','postalCode','address','goodCode','goodName','optionName','qty','deliveryNote','carrier'])
       and jsonb_typeof(value->'header')='string' and length(btrim(value->>'header')) between 1 and 80 and (value->>'header')!~ '[[:cntrl:]]')
     from jsonb_array_elements(columns_value)) end;
$$;
revoke all on function private.valid_shipment_export_columns(jsonb) from public,anon,authenticated,service_role;
alter table public.fulfillment_origins add constraint fulfillment_export_columns_valid check(private.valid_shipment_export_columns(export_columns));
create function public.admin_save_origin_export_columns(target_id uuid,target_columns jsonb,expected_updated_at timestamptz)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare previous public.fulfillment_origins;updated_stamp timestamptz:=clock_timestamp();actor uuid:=(select auth.uid());
begin
 if actor is null or not public.is_staff() or not exists(select 1 from public.profiles where id=actor and role='admin') then raise insufficient_privilege using message='admin required';end if;
 if private.valid_shipment_export_columns(target_columns) is distinct from true then raise check_violation using message='invalid_export_columns';end if;
 select * into previous from public.fulfillment_origins where id=target_id for update;
 if not found then raise no_data_found using message='origin_not_found';end if;
 if expected_updated_at is null or previous.updated_at<>expected_updated_at then raise serialization_failure using message='origin_settings_changed';end if;
 update public.fulfillment_origins set export_columns=target_columns,updated_at=updated_stamp where id=target_id;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.fulfillment_origin.export_columns_updated','fulfillment_origins:'||target_id,
  jsonb_build_object('before',previous.export_columns,'after',target_columns));
 return updated_stamp;
end $$;
revoke all on function public.admin_save_origin_export_columns(uuid,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_origin_export_columns(uuid,jsonb,timestamptz) to authenticated;

create function public.admin_search_shipments(p_tab text,p_origin_id uuid default null,p_query text default null,
 p_from date default null,p_to date default null,p_limit integer default 100,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;needle text:=nullif(btrim(p_query),'');
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 if p_tab is null or p_tab not in ('new','ready','delayed','transit','delivered') or p_limit is null or p_limit not between 1 and 1000 or p_offset is null or p_offset<0
   or length(needle)>100 or (p_from is not null and p_to is not null and p_from>p_to) then raise invalid_parameter_value using message='invalid_shipment_search';end if;
 with matched as materialized (
  select s.*,o.user_id,o.created_at order_created_at,o.confirmed_at,o.total,o.status order_status,
   coalesce(nullif(p.nickname,''),'fan_'||left(o.user_id::text,6)) buyer_name,o.address->>'recipientName' recipient_name,
   o.payment_method,delay.reason delay_reason,delay.expected_ship_date delay_expected_date,
   o.status='paid' and s.status='ready' is_new,
   o.status in ('confirmed','shipping') and s.status='ready' is_ready,
   o.status in ('confirmed','shipping') and s.status='ready' and o.confirmed_at<now()-interval '3 days' is_delayed,
   o.status<>'canceled' and s.status='shipping' is_transit,
   o.status<>'canceled' and s.status='delivered' is_delivered
  from public.order_shipments s join public.orders o on o.id=s.order_id
  left join public.profiles p on p.id=o.user_id left join public.order_dispatch_delays delay on delay.order_id=o.id
  where (p_origin_id is null or s.origin_id=p_origin_id)
    and (p_from is null or o.created_at>=p_from::timestamp at time zone 'Asia/Seoul')
    and (p_to is null or o.created_at<(p_to+1)::timestamp at time zone 'Asia/Seoul')
    and (needle is null or s.id::text ilike '%'||needle||'%' or o.id::text ilike '%'||needle||'%'
      or p.nickname ilike '%'||needle||'%' or p.email ilike '%'||needle||'%' or o.address->>'recipientName' ilike '%'||needle||'%')
 ), filtered as materialized (
  select * from matched where case p_tab when 'new' then is_new when 'ready' then is_ready when 'delayed' then is_delayed when 'transit' then is_transit else is_delivered end
 ), page as (select * from filtered order by order_created_at,id limit p_limit offset p_offset), output as (
 select page.*,coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.good_name_snapshot,'variantName',i.variant_name_snapshot,'qty',i.qty) order by i.id)
  from public.order_shipment_items link join public.order_items i on i.id=link.order_item_id where link.shipment_id=page.id),'[]') items from page
 ) select jsonb_build_object('total',(select count(*) from filtered),'counts',(select jsonb_build_object(
   'new',count(*) filter(where is_new),'ready',count(*) filter(where is_ready),'delayed',count(*) filter(where is_delayed),
   'transit',count(*) filter(where is_transit),'delivered',count(*) filter(where is_delivered)) from matched),
   'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'orderId',order_id,'originId',origin_id,'originName',origin_name_snapshot,
    'status',status,'createdAt',order_created_at,'confirmedAt',confirmed_at,'buyerName',buyer_name,'recipientName',recipient_name,
    'total',total,'paymentMethod',payment_method,'shippingFee',shipping_fee,'carrier',carrier,'trackingNumber',tracking_number,
    'shippedAt',shipped_at,'deliveredAt',delivered_at,'exportedAt',exported_at,'updatedAt',updated_at,
    'delayReason',delay_reason,'expectedShipDate',delay_expected_date,'items',items) order by order_created_at,id) from output),'[]')) into result;
 return result;
end $$;
revoke all on function public.admin_search_shipments(text,uuid,text,date,date,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_shipments(text,uuid,text,date,date,integer,integer) to authenticated;

create function public.admin_shipment_export(target_ids uuid[]) returns jsonb
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
   'goodName',i.good_name_snapshot,'optionName',coalesce(i.variant_name_snapshot,''),'qty',i.qty,'deliveryNote',coalesce(o.address->>'deliveryNote',''),'carrier',coalesce(carrier.label,'')) order by i.id)
   from public.order_shipment_items link join public.order_items i on i.id=link.order_item_id left join public.goods g on g.id=i.good_id where link.shipment_id=s.id),'[]')) order by origin.code,s.created_at,s.id)) into result
 from public.order_shipments s join public.orders o on o.id=s.order_id join public.fulfillment_origins origin on origin.id=s.origin_id
 left join public.shipping_carriers carrier on carrier.code=origin.default_carrier where s.id=any(target_ids);
 return result;
end $$;
revoke all on function public.admin_shipment_export(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_shipment_export(uuid[]) to authenticated;

create function public.admin_mark_shipments_exported(target_versions jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare row_value record;shipment public.order_shipments;total integer:=0;actor uuid:=(select auth.uid());
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 if jsonb_typeof(target_versions) is distinct from 'array' or jsonb_array_length(target_versions) not between 1 and 1000 then raise invalid_parameter_value using message='invalid_export_selection';end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(target_versions))<>jsonb_array_length(target_versions) then raise invalid_parameter_value using message='invalid_export_selection';end if;
 -- Global order sequence matches all other shipment mutations.
 perform o.id from public.orders o where exists(select 1 from public.order_shipments s join jsonb_to_recordset(target_versions) v(id uuid,"updatedAt" timestamptz) on v.id=s.id where s.order_id=o.id) order by o.id for update;
 for row_value in select * from jsonb_to_recordset(target_versions) as v(id uuid,"updatedAt" timestamptz) order by id loop
  select * into shipment from public.order_shipments where id=row_value.id for update;
  if not found or shipment.status<>'ready' or row_value."updatedAt" is null or shipment.updated_at<>row_value."updatedAt"
    or not exists(select 1 from public.orders where id=shipment.order_id and status in ('confirmed','shipping')) then raise serialization_failure using message='shipment_changed';end if;
  perform private.assert_order_dispatch_allowed(shipment.order_id);
  update public.order_shipments set exported_at=clock_timestamp(),exported_by=actor,updated_at=clock_timestamp() where id=shipment.id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipment.exported','order:'||shipment.order_id,jsonb_build_object('shipmentId',shipment.id,'originName',shipment.origin_name_snapshot));
  total:=total+1;
 end loop;
 return total;
end $$;
revoke all on function public.admin_mark_shipments_exported(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_mark_shipments_exported(jsonb) to authenticated;

create function private.resolve_shipment_reference(target_reference text) returns uuid
language plpgsql stable security invoker set search_path='' as $$
declare reference_value text:=btrim(target_reference);shipment_key uuid;matches integer;
begin
 if reference_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   select id into shipment_key from public.order_shipments where id=reference_value::uuid;
   if shipment_key is null then shipment_key:=private.single_order_shipment(reference_value::uuid);end if;
 elsif reference_value ~* '^[0-9a-f]{8}$' then
   select count(*),(array_agg(id))[1] into matches,shipment_key from public.order_shipments
    where right(id::text,8)=lower(reference_value) or right(order_id::text,8)=lower(reference_value);
   if matches>1 then raise check_violation using message='shipment_reference_required';end if;
 else raise invalid_parameter_value using message='invalid_shipment_reference';end if;
 if shipment_key is null then raise no_data_found using message='shipment_not_found';end if;
 return shipment_key;
end $$;
revoke all on function private.resolve_shipment_reference(text) from public,anon,authenticated,service_role;

create function public.admin_import_shipment_tracking_batch(target_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare input jsonb;shipment_key uuid;completed jsonb;results jsonb:='[]'::jsonb;seen uuid[]:='{}'::uuid[];
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 if jsonb_typeof(target_rows) is distinct from 'array' or jsonb_array_length(target_rows) not between 1 and 1000 then raise invalid_parameter_value using message='invalid_tracking_batch';end if;
 -- Hold all existing target order locks in one stable order before per-row savepoints.
 -- Different files may list the same warehouses in opposite orders.
 perform o.id from public.orders o where exists(select 1 from public.order_shipments s
   where s.order_id=o.id and exists(select 1 from jsonb_array_elements(target_rows) row_value
     where lower(btrim(row_value->>'reference')) in (s.id::text,o.id::text,right(s.id::text,8),right(o.id::text,8)))) order by o.id for update;
 for input in select value from jsonb_array_elements(target_rows) loop
  begin
   if jsonb_typeof(input) is distinct from 'object' then raise invalid_parameter_value using message='invalid_tracking_row';end if;
   shipment_key:=private.resolve_shipment_reference(input->>'reference');
   if shipment_key=any(seen) then raise check_violation using message='duplicate_shipment_reference';end if;
   completed:=public.admin_import_shipment_tracking(shipment_key::text,input->>'carrier',input->>'trackingNumber');
   seen:=array_append(seen,shipment_key);
   results:=results||jsonb_build_array(completed||jsonb_build_object('line',input->'line','reference',input->>'reference','ok',true));
  exception when others then
   results:=results||jsonb_build_array(jsonb_build_object('line',input->'line','reference',input->>'reference','ok',false,'error',sqlerrm));
  end;
 end loop;
 return results;
end $$;
revoke all on function public.admin_import_shipment_tracking_batch(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_import_shipment_tracking_batch(jsonb) to authenticated;

create function public.admin_complete_shipments(target_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare shipment_key uuid;results jsonb:='[]'::jsonb;
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 if cardinality(target_ids) is null or cardinality(target_ids) not between 1 and 1000 then raise invalid_parameter_value using message='invalid_shipment_selection';end if;
 perform o.id from public.orders o where exists(select 1 from public.order_shipments s where s.order_id=o.id and s.id=any(target_ids)) order by o.id for update;
 for shipment_key in select distinct id from unnest(target_ids) id order by id loop
  begin
   perform public.admin_update_shipment_status(shipment_key,'delivered',null,null);
   results:=results||jsonb_build_array(jsonb_build_object('id',shipment_key,'ok',true));
  exception when others then results:=results||jsonb_build_array(jsonb_build_object('id',shipment_key,'ok',false,'error',sqlerrm));end;
 end loop;
 return results;
end $$;
revoke all on function public.admin_complete_shipments(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_complete_shipments(uuid[]) to authenticated;
