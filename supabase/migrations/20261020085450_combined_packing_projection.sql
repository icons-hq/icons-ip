begin;
create function public.admin_shipment_pack_summaries(p_ids uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 perform private.require_operator_capability('sales.manage',false);
 if cardinality(p_ids) is null or cardinality(p_ids) not between 1 and 1000 or array_position(p_ids,null) is not null then raise invalid_parameter_value;end if;
 return (select coalesce(jsonb_object_agg(id,private.shipment_pack_summary(id)),'{}') from unnest(p_ids)id);
end $$;
revoke all on function public.admin_shipment_pack_summaries(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_shipment_pack_summaries(uuid[]) to authenticated;
select private.register_operator_rpc_contract('public.admin_shipment_pack_summaries(uuid[])'::regprocedure,'sales.manage','read',false);
-- Preserve same-status retries. A newly dispatched package is still validated
-- in full; an already shipped package does not become "not ready" on retry.
create or replace function private.change_packed_shipments(p_shipment uuid,p_status text,p_carrier text,p_tracking text,p_tracking_only boolean) returns void
language plpgsql security definer set search_path='' as $$
declare ids uuid[];id uuid;begin
 ids:=private.lock_shipment_pack_scope(array[p_shipment]);
 if exists(select 1 from public.order_shipments where order_shipments.id=any(ids) and delivery_method<>'parcel') then raise check_violation using message='delivery_method_evidence_required';end if;
 if not p_tracking_only and p_status='shipping' and exists(select 1 from public.order_shipments where order_shipments.id=any(ids) and status='ready') then
  perform private.assert_shipment_pack_basis(ids);
  if cardinality(ids)>1 and exists(select 1 from unnest(ids)sid where not private.shipment_pack_ready(sid)) then raise check_violation using message='shipment_pack_ineligible';end if;
 end if;
 foreach id in array ids loop
  if p_tracking_only then perform private.admin_update_shipment_tracking_before_delivery_methods(id,p_carrier,p_tracking);
  else perform private.admin_update_shipment_status_before_delivery_methods(id,p_status,p_carrier,p_tracking);end if;
 end loop;
end $$;
commit;
