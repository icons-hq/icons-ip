begin;

create function private.operational_order_address(p_order_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select private.order_delivery_snapshot(p_order_id)->'address';
$$;
revoke all on function private.operational_order_address(uuid) from public,anon,authenticated,service_role;
grant execute on function private.operational_order_address(uuid) to postgres,supabase_admin;
select private.register_operator_internal_contract('private.operational_order_address(uuid)'::regprocedure);

-- Only these existing, capability-protected operation/search readers are changed.
-- All function signatures, owners, ACLs, filtering and ordering remain intact.
-- Unpaid/deposit-name readers intentionally keep the payer-visible public address:
-- gift payers are instructed to use the order code, never the recipient's private name.
do $$declare target record;definition text;changed text;found_count integer;begin
 for target in select * from (values
  ('public.admin_search_order_items_console(text,date,date,text,integer,integer,text,text,text,text)','o',3),
  ('public.admin_search_orders_console(text,date,date,text,integer,integer,timestamptz,text,text,text,text)','orders',1),
  ('public.admin_search_orders(text,date,date,text,integer,integer,timestamptz,text)','orders',3),
  ('public.admin_search_shipments_notice_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text,text)','o',2),
  ('private.admin_order_detail_before_preorder(uuid)','o',6),
  ('private.admin_sales_claim_matches(public.order_cancellation_requests,text,date,date,text,text,text)','o',1),
  ('private.admin_search_shipments_before_delivery_methods(text,uuid,text,date,date,integer,integer)','o',2),
  ('private.admin_search_shipments_console_before_custom_inputs(text,uuid,text,date,date,integer,integer,text,text,text,text,text)','o',2),
  ('private.admin_shipment_export_before_preorder(uuid[])','o',6),
  ('private.collect_settled_export(date,date,text)','o',1)
 ) supplied(signature,alias,expected_count) loop
  definition:=pg_get_functiondef(target.signature::regprocedure);
  select count(*) into found_count from regexp_matches(definition,'\m'||target.alias||'\.address\M','g');
  if found_count<>target.expected_count then raise exception 'operational_address_reader_anchor_changed: %',target.signature;end if;
  changed:=regexp_replace(definition,'\m'||target.alias||'\.address\M','private.operational_order_address('||target.alias||'.id)','g');
  execute changed;
 end loop;
 definition:=pg_get_functiondef('private.admin_sales_order_matches(public.orders,date,date,text,text,text,text)'::regprocedure);
 if (length(definition)-length(replace(definition,'(p_order).address','')))/length('(p_order).address')<>2 then
  raise exception 'operational_order_search_anchor_changed';end if;
 execute replace(definition,'(p_order).address','private.operational_order_address((p_order).id)');
end $$;

create function public.admin_get_order_transaction_receipts(p_order_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 perform private.require_actor_operator_capability(auth.uid(),'sales.read',false);
 if p_order_ids is null or cardinality(p_order_ids)>1000 or array_position(p_order_ids,null) is not null then
  raise invalid_parameter_value using message='invalid_order_transaction_ids';end if;
 if exists(select 1 from public.orders o left join private.order_goods_transactions t on t.order_id=o.id
   where o.id=any(p_order_ids) and o.calculation_version=2 and t.order_id is null) then
  raise check_violation using message='order_transaction_receipt_missing';end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('orderId',o.id,'receipt',case when o.calculation_version=2 then t.original_receipt else null end) order by o.id),'[]')
  from public.orders o left join private.order_goods_transactions t on t.order_id=o.id where o.id=any(p_order_ids));
end $$;
create function public.service_get_order_transaction_receipt(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare receipt jsonb;version integer;begin
 select o.calculation_version,t.original_receipt into version,receipt from public.orders o
  left join private.order_goods_transactions t on t.order_id=o.id where o.id=p_order_id;
 if not found or version=1 then return null;end if;
 if receipt is null then raise check_violation using message='order_transaction_receipt_missing';end if;
 return receipt;
end $$;
revoke all on function public.admin_get_order_transaction_receipts(uuid[]),public.service_get_order_transaction_receipt(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_get_order_transaction_receipts(uuid[]) to authenticated;
grant execute on function public.service_get_order_transaction_receipt(uuid) to service_role;
select private.register_operator_rpc_contract('public.admin_get_order_transaction_receipts(uuid[])'::regprocedure,'sales.read','read',false);
select private.register_operator_internal_contract('public.service_get_order_transaction_receipt(uuid)'::regprocedure);

create or replace function public.admin_shipment_export(target_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare result jsonb;begin
 if auth.uid() is null or not public.has_operator_capability('sales.manage',false) then
  raise insufficient_privilege using message='operator_capability_required';end if;
 if exists(select 1 from public.order_shipments where id=any(target_ids) and delivery_method<>'parcel') then
  raise check_violation using message='delivery_method_evidence_required';end if;
 result:=private.admin_shipment_export_before_delivery_methods(target_ids);
 return jsonb_set(result,'{shipments}',(select jsonb_agg(entry.value||jsonb_build_object(
  'isGift',exists(select 1 from private.gift_intents g where g.order_id=s.order_id),
  'shippingCollectFee',s.shipping_collect_fee,
  'collector',(select group_value->'collector' from jsonb_array_elements(t.original_receipt#>'{display,shipping}') group_value
   where group_value->>'originId'=s.origin_id::text)) order by entry.ordinality)
  from jsonb_array_elements(result->'shipments') with ordinality entry(value,ordinality)
  join public.order_shipments s on s.id=(entry.value->>'id')::uuid
  left join private.order_goods_transactions t on t.order_id=s.order_id));
end $$;

-- Refresh only the reviewed bodies; preserve each existing permission contract verbatim.
do $$declare signature text;fn regprocedure;contract record;begin
 foreach signature in array ARRAY[
  'public.admin_search_order_items_console(text,date,date,text,integer,integer,text,text,text,text)',
  'public.admin_search_orders_console(text,date,date,text,integer,integer,timestamptz,text,text,text,text)',
  'public.admin_search_orders(text,date,date,text,integer,integer,timestamptz,text)',
  'public.admin_search_shipments_notice_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text,text)',
  'private.admin_order_detail_before_preorder(uuid)',
  'private.admin_sales_claim_matches(public.order_cancellation_requests,text,date,date,text,text,text)',
  'private.admin_search_shipments_before_delivery_methods(text,uuid,text,date,date,integer,integer)',
  'private.admin_search_shipments_console_before_custom_inputs(text,uuid,text,date,date,integer,integer,text,text,text,text,text)',
  'private.admin_shipment_export_before_preorder(uuid[])',
  'private.collect_settled_export(date,date,text)',
  'private.admin_sales_order_matches(public.orders,date,date,text,text,text,text)',
  'public.admin_shipment_export(uuid[])'
 ] loop
  fn:=signature::regprocedure;
  select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure=fn;
  if found then perform private.register_operator_rpc_contract(fn,contract.capability,contract.guard_kind,contract.legacy_admin_only);
  elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure=fn) then
   perform private.register_operator_internal_contract(fn);
  elsif signature like 'public.admin_%' then raise exception 'operational_rpc_contract_missing: %',signature;
  end if;
 end loop;
end $$;

commit;
notify pgrst,'reload schema';
