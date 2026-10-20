begin;
create function private.order_delivery_context(p_order_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('orderId',o.id,'isGift',g.id is not null,'senderId',o.user_id,'recipientId',coalesce(g.recipient_id,o.user_id),
  'address',d->'address','addressRevision',d->'addressRevision','shippingEvidence',d->'shippingEvidence')
 from public.orders o left join private.gift_intents g on g.order_id=o.id
 cross join lateral(select private.order_delivery_snapshot(o.id)d)delivery where o.id=p_order_id;
$$;
create function public.admin_get_order_delivery_snapshots(p_order_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 perform private.require_actor_operator_capability(auth.uid(),'sales.read',false);
 if p_order_ids is null or cardinality(p_order_ids)>1000 or array_position(p_order_ids,null) is not null then
  raise invalid_parameter_value using message='invalid_delivery_order_ids';end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('orderId',o.id,'isGift',g.id is not null,
   'address',d->'address','addressRevision',d->'addressRevision','shippingEvidence',d->'shippingEvidence') order by o.id),'[]')
  from public.orders o left join private.gift_intents g on g.order_id=o.id
  cross join lateral(select private.order_delivery_snapshot(o.id)d)delivery where o.id=any(p_order_ids));
end $$;
create function public.service_get_order_delivery_context(p_order_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$select private.order_delivery_context(p_order_id);$$;
revoke all on function private.order_delivery_context(uuid),public.admin_get_order_delivery_snapshots(uuid[]),public.service_get_order_delivery_context(uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.order_delivery_context(uuid) to postgres;
grant execute on function public.admin_get_order_delivery_snapshots(uuid[]) to authenticated;
grant execute on function public.service_get_order_delivery_context(uuid) to service_role;
select private.register_operator_internal_contract('private.order_delivery_context(uuid)'::regprocedure);
select private.register_operator_internal_contract('public.service_get_order_delivery_context(uuid)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_get_order_delivery_snapshots(uuid[])','sales.read','read',false);
create or replace function private.order_address_change_receipt(p_id uuid,p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'orderId',c.order_id,'changedAt',c.created_at,'address',c.after_address,'reason',c.reason,
  'currentMatches',private.order_delivery_snapshot(o.id)->'address'=c.after_address)
 from private.order_address_changes c join public.orders o on o.id=c.order_id where c.id=p_id and c.actor_id=p_actor;
$$;
revoke all on function private.order_address_change_receipt(uuid,uuid) from public,anon,authenticated,service_role;


create or replace function public.admin_order_address_context(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare purchase public.orders;blocker text;result jsonb;
begin
 if not private.has_operator_capability(auth.uid(),'sales.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 select * into purchase from public.orders where id=p_order_id;
 if not found then raise no_data_found using message='order_not_found';end if;
 blocker:=private.order_address_change_blocker(purchase);
 select jsonb_build_object('orderId',purchase.id,'address',private.order_delivery_snapshot(purchase.id)->'address','revision',private.order_delivery_snapshot(purchase.id)->'addressRevision',
  'isGift',exists(select 1 from private.gift_intents where order_id=purchase.id),
  'allowed',blocker is null,'blocker',blocker,'shipmentCount',(select count(*) from public.order_shipments where order_id=p_order_id),
  'history',coalesce((select jsonb_agg(entry order by happened desc) from (
   select c.created_at happened,jsonb_build_object('id',c.id,'changedAt',c.created_at,'actorName',coalesce(p.nickname,'이름 미등록'),
    'before',c.before_address,'after',c.after_address,'reason',c.reason) entry
   from private.order_address_changes c join public.profiles p on p.id=c.actor_id where c.order_id=p_order_id
   order by c.created_at desc,c.id desc limit 20)h),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.admin_order_address_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_address_context(uuid) to authenticated;


create or replace function public.admin_change_order_address(p_operation_id uuid,p_order_id uuid,p_expected_revision integer,p_address jsonb,p_reason text,p_customer_agreed boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();purchase public.orders; previous private.order_address_changes; address_value jsonb;
 reason text:=nullif(btrim(p_reason),'');blocked text;shipment public.order_shipments;base_groups jsonb:='[]';lines jsonb;
 quote jsonb;origin_key uuid;group_value jsonb;changed_fields jsonb;delivery jsonb;is_gift boolean;v2_lines jsonb;choices jsonb;
begin
 perform private.require_actor_operator_capability(actor,'sales.manage',false);
 if p_operation_id is null or p_order_id is null or p_expected_revision is null or p_expected_revision<0
  or p_customer_agreed is distinct from true or reason is null or char_length(reason)>500 or reason~'[[:cntrl:]]' then
  raise invalid_parameter_value using message='invalid_order_address_change';end if;
 address_value:=private.normalize_order_address_change(p_address);
 perform pg_advisory_xact_lock(hashtextextended('order_address_change:'||p_operation_id::text,0));
 select * into previous from private.order_address_changes where id=p_operation_id;
 if found then
  if previous.actor_id<>actor or previous.order_id<>p_order_id or previous.expected_order_revision<>p_expected_revision
   or previous.after_address<>address_value or previous.reason<>reason then raise unique_violation using message='order_address_request_conflict';end if;
  return private.order_address_change_receipt(p_operation_id,actor);
 end if;
 select * into purchase from public.orders where id=p_order_id for update;
 if not found then raise no_data_found using message='order_not_found';end if;
 perform id from public.order_shipments where order_id=p_order_id order by id for update;
 perform order_id from private.order_delivery_private_snapshots where order_id=p_order_id for update;
 delivery:=private.order_delivery_snapshot(p_order_id);
 is_gift:=exists(select 1 from private.gift_intents where order_id=p_order_id);
 if (delivery->>'addressRevision')::integer<>p_expected_revision then raise sqlstate 'PT409' using message='order_address_changed';end if;
 blocked:=private.order_address_change_blocker(purchase);
 if blocked is not null then raise check_violation using message=blocked;end if;
 select jsonb_agg(k order by k) into changed_fields from jsonb_object_keys(address_value)k where coalesce((delivery->'address')->>k,'')<>address_value->>k;
 if changed_fields is null then raise invalid_parameter_value using message='order_address_unchanged';end if;
 -- Contact/detail-note corrections preserve the destination quote. A changed
 -- postal/base address must remain deliverable at every frozen shipment amount.
 if (delivery->'address')->>'postalCode' is distinct from address_value->>'postalCode'
  or private.shipping_region_text((delivery->'address')->>'address1') is distinct from private.shipping_region_text(address_value->>'address1') then
  if purchase.calculation_version=2 then
   -- Match quote/place's catalog lock order before any origin policy lock.
   perform id from public.goods where id in(select good_id from public.order_items where order_id=p_order_id) order by id for share;
   perform good_id from private.goods_transaction_configs where good_id in(select good_id from public.order_items where order_id=p_order_id) order by good_id for share;
  end if;
  for origin_key in select distinct origin_id from public.order_shipments where order_id=p_order_id order by origin_id loop
   perform id from public.fulfillment_origins where id=origin_key for share;
  end loop;
  if purchase.calculation_version=2 then
   select jsonb_agg(jsonb_build_object('good_id',good_id,'origin_id',origin_id_snapshot,'qty',qty,'unit_price',unit_price,'fee_type',shipping_fee_type_snapshot,'individual_fee',individual_fee_snapshot)) into v2_lines
    from public.order_items where order_id=p_order_id;
   select jsonb_object_agg(good_id,payment_mode) into choices from private.shipping_charge_components where order_id=p_order_id;
   quote:=private.calculate_goods_transaction_shipping(v2_lines,jsonb_build_object('postalCode',address_value->>'postalCode','address1',address_value->>'address1'),choices,clock_timestamp());
   if quote->>'state'='blocked' then raise check_violation using message='order_address_region_unavailable';end if;
   if (quote->>'prepaidFee')::bigint<>purchase.shipping_fee or (quote->>'collectFee')::bigint<>purchase.shipping_collect_total
    or exists(select 1 from jsonb_array_elements(quote->'rawGroups')g full join (select * from public.order_shipments where order_id=p_order_id)s on s.origin_id=(g->>'originId')::uuid
     where (s.id is null or g is null or (g->>'prepaidFee')::bigint<>s.shipping_fee or (g->>'collectFee')::bigint<>s.shipping_collect_fee)) then
    raise check_violation using message='order_address_shipping_fee_changed';end if;
  else
  for shipment in select * from public.order_shipments where order_id=p_order_id order by id loop
   group_value:=shipment.shipping_fee_snapshot;
   if shipment.delivery_method<>'parcel' or group_value->>'originId' is distinct from shipment.origin_id::text
    or not(group_value ?& array['policySubtotal','baseFee','freeThreshold','policyFee','individualFee','totalFee'])
    or jsonb_typeof(group_value->'totalFee') is distinct from 'number'
    or (group_value->>'totalFee')::bigint<>shipment.shipping_fee then
    raise check_violation using message='order_address_quote_unavailable';end if;
   base_groups:=base_groups||jsonb_build_array(group_value||jsonb_build_object('totalFee',shipment.shipping_fee-coalesce((group_value->>'regionalFee')::bigint,0)));
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('origin_id',origin_id_snapshot,'good_id',good_id,'fee_type',shipping_fee_type_snapshot)),'[]') into lines
   from public.order_items where order_id=p_order_id;
  quote:=private.apply_shipping_region_quote(jsonb_build_object('groups',base_groups),lines,
   jsonb_build_object('postalCode',address_value->>'postalCode','address1',address_value->>'address1'),clock_timestamp());
  if not coalesce((quote->>'checkoutAllowed')::boolean,false) then raise check_violation using message='order_address_region_unavailable';end if;
  if (quote->>'finalTotalFee')::bigint<>purchase.shipping_fee or exists(
   select 1 from jsonb_array_elements(quote->'groups')g join public.order_shipments s on s.order_id=p_order_id and s.origin_id=(g->>'originId')::uuid
   where (g->>'finalFee')::bigint<>s.shipping_fee) then raise check_violation using message='order_address_shipping_fee_changed';end if;
  end if;
 end if;
 insert into private.order_address_changes(id,order_id,actor_id,expected_order_revision,before_address,after_address,reason,destination_quote)
 values(p_operation_id,p_order_id,actor,p_expected_revision,delivery->'address',address_value,reason,quote);
 if is_gift then
  update private.order_delivery_private_snapshots set address=address_value,address_revision=address_revision+1,updated_at=clock_timestamp() where order_id=p_order_id;
  if not found then raise check_violation using message='gift_delivery_snapshot_missing';end if;
 else update public.orders set address=address_value,updated_at=clock_timestamp() where id=p_order_id;end if;
 -- Invalidate any export prepared before the change but not yet marked sent.
 update public.order_shipments set updated_at=clock_timestamp() where order_id=p_order_id;
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.order.address_changed','order:'||p_order_id,
  jsonb_build_object('changedFields',changed_fields,'customerAgreed',true,'agreementParty',case when is_gift then 'recipient' else 'buyer' end,'shipmentCount',(select count(*) from public.order_shipments where order_id=p_order_id),'shippingFeeUnchanged',true));
 return private.order_address_change_receipt(p_operation_id,actor);
end $$;
revoke all on function public.admin_change_order_address(uuid,uuid,integer,jsonb,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_change_order_address(uuid,uuid,integer,jsonb,text,boolean) to authenticated;


select private.register_operator_internal_contract('private.order_address_change_receipt(uuid,uuid)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_order_address_context(uuid)','sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_change_order_address(uuid,uuid,integer,jsonb,text,boolean)','sales.manage','write',false);
commit;
notify pgrst,'reload schema';
