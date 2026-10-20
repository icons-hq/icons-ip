-- Reconcile deployed main cancellation and warehouse contracts with the admin
-- capability, gift, allocation, production and combined-pack domains.
begin;

-- The deployed staff-cancellation implementation stays intact. Bind its start to
-- the current operator and persist the right to finish that one provider action.
do $patch$
declare definition text;anchor text;
begin
 if (select md5(prosrc) from pg_proc where oid='public.admin_start_order_cancellation(uuid,text,text,boolean)'::regprocedure)
  is distinct from '673d476cc39b15fe2f9a032db30d2979' then raise exception 'staff_cancellation_release_source_changed';end if;
 definition:=pg_get_functiondef('public.admin_start_order_cancellation(uuid,text,text,boolean)'::regprocedure);
 anchor:=$old$  if v_actor is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;$old$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'staff_cancellation_authority_anchor_changed';end if;
 definition:=replace(definition,anchor,$new$  perform private.require_actor_operator_capability(v_actor,'sales.manage',false);$new$);
 anchor:='  returning id into v_request_id;';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'staff_cancellation_receipt_anchor_changed';end if;
 definition:=replace(definition,anchor,anchor||$new$

  insert into private.operator_cancellation_authorizations(request_id,actor_id)
  values(v_request_id,v_actor) on conflict do nothing;$new$);
 execute definition;
end $patch$;

create or replace function public.admin_origin_tracking_candidates(target_origin_id uuid,target_tracking_numbers text[],target_phones text[])
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare origin public.fulfillment_origins;result jsonb;
begin
 if auth.uid() is null or not public.has_operator_capability('sales.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';end if;
 if target_origin_id is null or target_tracking_numbers is null or cardinality(target_tracking_numbers)>1000
  or array_position(target_tracking_numbers,null) is not null or target_phones is null or cardinality(target_phones)>1000
  or array_position(target_phones,null) is not null then raise invalid_parameter_value using message='invalid_tracking_batch';end if;
 select * into origin from public.fulfillment_origins where id=target_origin_id;
 if not found then raise no_data_found using message='warehouse_origin_not_found';end if;
 with candidates as (
  select s.id,s.order_id,s.status,s.carrier,s.tracking_number,s.shipped_at,a.address
  from public.order_shipments s join public.orders o on o.id=s.order_id
  cross join lateral(select private.operational_order_address(o.id) address) a
  where s.origin_id=origin.id and s.delivery_method='parcel' and a.address->>'phone'=any(target_phones)
   and ((s.status='ready' and s.exported_at is not null and o.status in('confirmed','shipping'))
     or(s.status in('shipping','delivered') and o.status<>'canceled' and s.shipped_at>=now()-interval '45 days'))
  order by s.status<>'ready',s.shipped_at desc nulls first,s.id limit 5001
 ), bounded as(select * from candidates limit 5000)
 select jsonb_build_object('originId',origin.id,'template',origin.export_template,'active',origin.is_active,
  'defaultCarrier',origin.default_carrier,'truncated',(select count(*)>5000 from candidates),
  'shipments',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'orderId',c.order_id,'status',c.status,
   'carrier',c.carrier,'trackingNumber',c.tracking_number,
   'lines',coalesce((select jsonb_agg(jsonb_build_object('recipient',coalesce(c.address->>'recipientName',''),
    'phone',coalesce(c.address->>'phone',''),'postalCode',coalesce(c.address->>'postalCode',''),
    'address',concat_ws(' ',c.address->>'address1',nullif(c.address->>'address2','')),
    'goodName',i.good_name_snapshot,'optionName',concat_ws(' / ',nullif(i.variant_name_snapshot,''),
     (select string_agg((field->>'name')||': '||(field->>'value'),' / ' order by entry.ordinality)
      from jsonb_array_elements(i.custom_inputs_snapshot->'fields') with ordinality entry(field,ordinality))),'qty',coalesce(link.qty,i.qty),
    'deliveryNote',coalesce(c.address->>'deliveryNote','')) order by i.id)
    from public.order_shipment_items link join public.order_items i on i.id=link.order_item_id
    where link.shipment_id=c.id),'[]')) order by c.status<>'ready',c.shipped_at desc nulls first,c.id) from bounded c),'[]'),
  'usedTracking',coalesce((select jsonb_agg(jsonb_build_object('trackingNumber',s.tracking_number,'shipmentId',s.id) order by s.tracking_number,s.id)
   from public.order_shipments s where s.carrier=origin.default_carrier and s.tracking_number=any(target_tracking_numbers)),'[]'))
 into result;
 return result;
end $$;

create or replace function public.admin_origin_pending_export_ids(target_origin_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.has_operator_capability('sales.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';end if;
 -- Count and select a whole physical package. A held, already-exported or
 -- unfinished-production sibling excludes the package before the 1,000-row cap.
 with pending as (
  select s.id,s.created_at,coalesce(private.shipment_pack_id(s.id),s.id) group_id,
   (select count(*) from public.order_shipment_items link where link.shipment_id=s.id) line_count
  from public.order_shipments s join public.orders o on o.id=s.order_id
  where s.origin_id=target_origin_id and s.status='ready' and s.exported_at is null and s.delivery_method='parcel'
   and o.status in('confirmed','shipping') and private.shipment_preorder_allocation_ready(s.id)
   and(private.shipment_production_summary(s.id)->>'ready')::boolean
   and not exists(select 1 from public.order_cancellation_requests r where r.order_id=o.id and r.status in('requested','processing','needs_review'))
   and not exists(select 1 from public.order_cancellation_claims c where c.order_id=o.id)
 ), eligible as (
  select p.* from pending p where not exists(
   select 1 from unnest(private.shipment_pack_scope(array[p.id])) member(id)
   where not exists(select 1 from pending sibling where sibling.id=member.id))
 ), groups as (
  select group_id,min(created_at) created_at,sum(line_count) line_count,count(*) shipment_count
  from eligible group by group_id
 ), ordered as (
  select group_id,sum(line_count) over(order by created_at,group_id) running_lines,
   sum(shipment_count) over(order by created_at,group_id) running_shipments from groups
 )
 select jsonb_build_object('ids',coalesce((select jsonb_agg(e.id order by e.created_at,e.id) from eligible e
  join ordered g on g.group_id=e.group_id where g.running_lines<=1000 and g.running_shipments<=1000),'[]'),
  'total',(select count(*) from eligible)) into result;
 return result;
end $$;

-- Seowon replies omit order identifiers. The app sends only unambiguously
-- matched shipments, so require every member before a single pack can move.
-- Other workbook formats intentionally keep their existing batch semantics.
create function public.admin_import_seowon_tracking_batch(target_origin_id uuid,target_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare origin public.fulfillment_origins;row_value jsonb;sid uuid;ids uuid[]:='{}';scope_ids uuid[];
 shipment public.order_shipments;tracking_value text;carrier_value text;
begin
 perform private.require_operator_capability('sales.manage',false);
 if target_origin_id is null or jsonb_typeof(target_rows) is distinct from 'array'
  or jsonb_array_length(target_rows) not between 1 and 1000 then raise invalid_parameter_value using message='invalid_tracking_batch';end if;
 select * into origin from public.fulfillment_origins where id=target_origin_id;
 if not found then raise no_data_found using message='warehouse_origin_not_found';end if;
 if not origin.is_active or origin.export_template<>'seowon_xlsx' then raise check_violation using message='warehouse_origin_unavailable';end if;
 for row_value in select value from jsonb_array_elements(target_rows) loop
  if jsonb_typeof(row_value) is distinct from 'object' or jsonb_typeof(row_value->'reference') is distinct from 'string'
   or row_value->>'reference'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   raise invalid_parameter_value using message='invalid_tracking_row';end if;
  sid:=(row_value->>'reference')::uuid;
  if sid=any(ids) then raise check_violation using message='duplicate_shipment_reference';end if;
  ids:=array_append(ids,sid);
 end loop;
 scope_ids:=private.lock_shipment_pack_scope(ids);
 perform private.assert_whole_shipment_packs(ids);
 -- Validate all matching/scope evidence before delegating to per-row savepoints.
 for row_value in select value from jsonb_array_elements(target_rows) loop
  sid:=(row_value->>'reference')::uuid;
  select * into strict shipment from public.order_shipments where id=sid;
  carrier_value:=nullif(btrim(row_value->>'carrier'),'');
  tracking_value:=nullif(upper(regexp_replace(btrim(row_value->>'trackingNumber'),'[[:space:]-]','','g')),'');
  if shipment.origin_id<>origin.id then raise check_violation using message='warehouse_origin_mismatch';end if;
  if shipment.delivery_method<>'parcel' then raise check_violation using message='delivery_method_evidence_required';end if;
  if carrier_value is distinct from origin.default_carrier or tracking_value is null then
   raise check_violation using message='invalid_tracking_row';end if;
  if shipment.status='ready' then
   if shipment.exported_at is null then raise check_violation using message='shipment_not_exported';end if;
   if exists(select 1 from public.order_shipments where id=any(private.shipment_pack_scope(array[sid])) and status<>'ready') then
    raise check_violation using message='shipment_tracking_conflict';end if;
   perform private.assert_order_dispatch_allowed(shipment.order_id);
   perform private.assert_shipment_preorder_ready(sid);
   if(private.shipment_production_summary(sid)->>'ready')::boolean is distinct from true then
    raise check_violation using message='production_incomplete';end if;
  elsif shipment.status not in('shipping','delivered') or exists(select 1 from public.orders where id=shipment.order_id and status='canceled') then
   raise check_violation using message='order_not_shipped';
  elsif shipment.carrier is distinct from carrier_value or shipment.tracking_number is distinct from tracking_value then
   raise check_violation using message='shipment_tracking_conflict';
  end if;
 end loop;
 perform private.prepare_pack_tracking_batch(target_rows);
 return public.admin_import_shipment_tracking_batch(target_rows);
end $$;

-- Seal public defaults, then record the final execution metadata and body.
alter function public.admin_start_order_cancellation(uuid,text,text,boolean) owner to postgres;
alter function public.admin_origin_tracking_candidates(uuid,text[],text[]) owner to postgres;
alter function public.admin_origin_pending_export_ids(uuid) owner to postgres;
alter function public.admin_import_seowon_tracking_batch(uuid,jsonb) owner to postgres;
revoke all on function public.admin_start_order_cancellation(uuid,text,text,boolean),
 public.admin_origin_tracking_candidates(uuid,text[],text[]),public.admin_origin_pending_export_ids(uuid),
 public.admin_import_seowon_tracking_batch(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_start_order_cancellation(uuid,text,text,boolean),
 public.admin_origin_tracking_candidates(uuid,text[],text[]),public.admin_origin_pending_export_ids(uuid),
 public.admin_import_seowon_tracking_batch(uuid,jsonb) to authenticated;
select private.register_operator_rpc_contract('public.admin_start_order_cancellation(uuid,text,text,boolean)'::regprocedure,'sales.manage','write',false);
select private.register_operator_rpc_contract('public.admin_origin_tracking_candidates(uuid,text[],text[])'::regprocedure,'sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_origin_pending_export_ids(uuid)'::regprocedure,'sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_import_seowon_tracking_batch(uuid,jsonb)'::regprocedure,'sales.manage','write',false);
notify pgrst,'reload schema';
commit;
