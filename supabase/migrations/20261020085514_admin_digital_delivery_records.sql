-- Operators can inspect supplied-file records without receiving private paths,
-- download authorization, content hashes, or customer session identifiers.
begin;
create function public.admin_get_order_downloads(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.has_operator_capability('sales.read',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if not exists(select 1 from public.orders where id=p_order) then return null;end if;
 return jsonb_build_object('orderId',p_order,'items',coalesce((
  select jsonb_agg(jsonb_build_object('itemId',i.id,'name',i.good_name_snapshot,'files',(
   select jsonb_agg(jsonb_build_object('id',f.value->'id','name',f.value->'name','mimeType',f.value->'mimeType','size',f.value->'size',
    'providedCount',d.total,'firstProvidedAt',d.first_at,'lastProvidedAt',d.last_at) order by f.position)
   from jsonb_array_elements(i.fulfillment_terms_snapshot->'files') with ordinality f(value,position)
   cross join lateral(select count(*) as total,min(created_at) first_at,max(created_at) last_at from private.order_digital_downloads
    where order_id=p_order and order_item_id=i.id and asset_id=(f.value->>'id')::uuid) d
  )) order by i.id) from public.order_items i where i.order_id=p_order and i.fulfillment_terms_snapshot->>'mode'='digital'
 ),'[]'));
end $$;
revoke all on function public.admin_get_order_downloads(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_order_downloads(uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_get_order_downloads(uuid)'::regprocedure,'sales.read','read',false);
select private.register_operator_internal_contract('public.admin_get_order_downloads(uuid)'::regprocedure);
notify pgrst,'reload schema';
commit;
