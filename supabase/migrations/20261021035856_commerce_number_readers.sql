begin;

-- Preserve the existing role, filter, gift, claim and dispatch contracts. Each
-- replacement has an exact anchor count so a changed upstream reader fails.
create function pg_temp.patch_commerce_reader(signature text,anchor text,replacement text,expected integer default 1)
returns void language plpgsql as $$
declare definition text;
begin
  definition:=pg_get_functiondef(signature::regprocedure);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>expected then
    raise exception 'commerce_number_reader_anchor_changed: % / %',signature,anchor;
  end if;
  execute replace(definition,anchor,replacement);
end $$;

-- Existing deployed readers validate exact JSON keys. Opt-in read RPCs keep
-- those responses and frozen mutation receipts valid during DB-first rollout.
create function pg_temp.copy_commerce_reader(signature text,target_name text)
returns void language plpgsql as $$
declare source regprocedure:=signature::regprocedure; schema_name text; source_name text; definition text; target regprocedure;
begin
  select n.nspname,p.proname,pg_get_functiondef(p.oid) into schema_name,source_name,definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid=source;
  execute replace(definition,format('CREATE OR REPLACE FUNCTION %I.%I(',schema_name,source_name),
    format('CREATE OR REPLACE FUNCTION %I.%I(',schema_name,target_name));
  select format('%I.%I(%s)',schema_name,target_name,oidvectortypes(proargtypes))::regprocedure into target from pg_proc where oid=source;
  execute format('revoke all on function %s from public,anon,authenticated,service_role',target);
  if has_function_privilege('authenticated',source,'execute') then
    execute format('grant execute on function %s to authenticated',target);
  end if;
end $$;
select pg_temp.copy_commerce_reader('public.admin_get_order_delivery_snapshots(uuid[])','admin_get_order_delivery_snapshots_numbered');
select pg_temp.copy_commerce_reader('public.admin_list_bank_transfer_refunds(integer,integer)','admin_list_bank_transfer_refunds_numbered');
select pg_temp.copy_commerce_reader('public.admin_list_claim_fees(text,integer)','admin_list_claim_fees_numbered');
select pg_temp.copy_commerce_reader('public.get_my_gift_checkout_order(uuid,uuid)','get_my_gift_checkout_order_numbered');
select pg_temp.copy_commerce_reader('public.get_my_gift(uuid)','get_my_gift_numbered');
select pg_temp.copy_commerce_reader('public.list_my_gifts(text,timestamp with time zone,uuid)','list_my_gifts_numbered');
select pg_temp.copy_commerce_reader('public.admin_inquiry_satisfaction_console(text,text,date,date,text,text,integer,integer,text)','admin_inquiry_satisfaction_console_numbered');

select pg_temp.patch_commerce_reader('private.admin_sales_order_matches(public.orders,date,date,text,text,text,text)',
  $a$position(lower(p_query) in lower((p_order).id::text))>0$a$,
  $a$(position(lower(p_query) in lower((p_order).id::text))>0 or position(p_query in (p_order).order_number)>0)$a$);
select private.register_operator_internal_contract('private.admin_sales_order_matches(public.orders,date,date,text,text,text,text)'::regprocedure);
select pg_temp.patch_commerce_reader('private.admin_sales_claim_matches(public.order_cancellation_requests,text,date,date,text,text,text)',
  $a$position(lower(p_query) in lower((p_claim).order_id::text))>0$a$,
  $a$(position(lower(p_query) in lower((p_claim).order_id::text))>0 or exists(select 1 from public.orders numbered where numbered.id=(p_claim).order_id and position(p_query in numbered.order_number)>0))$a$);
select pg_temp.patch_commerce_reader('private.admin_sales_claim_matches(public.order_cancellation_requests,text,date,date,text,text,text)',
  $a$position(lower(p_query) in lower(i.id::text))>0$a$,
  $a$(position(lower(p_query) in lower(i.id::text))>0 or position(p_query in i.product_order_number)>0)$a$);
select private.register_operator_internal_contract('private.admin_sales_claim_matches(public.order_cancellation_requests,text,date,date,text,text,text)'::regprocedure);

do $$declare signature text;begin
  foreach signature in array array[
    'private.admin_search_shipments_console_before_custom_inputs(text,uuid,text,date,date,integer,integer,text,text,text,text,text)',
    'public.admin_search_shipments_notice_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text,text)'
  ] loop
    perform pg_temp.patch_commerce_reader(signature,$a$position(lower(needle) in s.id::text)>0$a$,
      $a$(position(lower(needle) in s.id::text)>0 or position(needle in s.shipment_number)>0)$a$);
    perform pg_temp.patch_commerce_reader(signature,$a$position(lower(needle) in o.id::text)>0$a$,
      $a$(position(lower(needle) in o.id::text)>0 or position(needle in o.order_number)>0)$a$);
    perform pg_temp.patch_commerce_reader(signature,'o.created_at order_created_at,','o.created_at order_created_at,o.order_number,');
    perform pg_temp.patch_commerce_reader(signature,$a$'id',id,'orderId',order_id,'originId'$a$,
      $a$'id',id,'orderId',order_id,'orderNumber',order_number,'shipmentNumber',shipment_number,'originId'$a$);
    perform pg_temp.patch_commerce_reader(signature,$a$'id',i.id,'name',i.good_name_snapshot$a$,
      $a$'id',i.id,'productOrderNumber',i.product_order_number,'name',i.good_name_snapshot$a$);
  end loop;
end $$;
select private.register_operator_internal_contract('private.admin_search_shipments_console_before_custom_inputs(text,uuid,text,date,date,integer,integer,text,text,text,text,text)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_search_shipments_notice_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text,text)'::regprocedure,'sales.manage','read',false);

select pg_temp.patch_commerce_reader('public.admin_search_order_items_console(text,date,date,text,integer,integer,text,text,text,text)',
  $a$'id',i.id,'orderId',o.id,$a$,$a$'id',i.id,'productOrderNumber',i.product_order_number,'orderId',o.id,'orderNumber',o.order_number,$a$);
select pg_temp.patch_commerce_reader('public.admin_search_order_items_console(text,date,date,text,integer,integer,text,text,text,text)',
  $a$strpos(lower(o.id::text),lower(needle))>0$a$,$a$(strpos(lower(o.id::text),lower(needle))>0 or strpos(o.order_number,needle)>0)$a$);
select pg_temp.patch_commerce_reader('public.admin_search_order_items_console(text,date,date,text,integer,integer,text,text,text,text)',
  $a$strpos(lower(i.id::text),lower(needle))>0$a$,$a$(strpos(lower(i.id::text),lower(needle))>0 or strpos(i.product_order_number,needle)>0)$a$);
select private.register_operator_rpc_contract('public.admin_search_order_items_console(text,date,date,text,integer,integer,text,text,text,text)'::regprocedure,'sales.read','read',false);

select pg_temp.patch_commerce_reader('public.admin_get_order_delivery_snapshots_numbered(uuid[])',
  $a$'orderId',o.id,'isGift'$a$,$a$'orderId',o.id,'orderNumber',o.order_number,'isGift'$a$);
select private.register_operator_rpc_contract('public.admin_get_order_delivery_snapshots_numbered(uuid[])'::regprocedure,'sales.read','read',false);

select pg_temp.patch_commerce_reader('public.admin_smartstore_shipment_export(uuid[])',
  $a$'itemId',item.id,'goodId'$a$,
  $a$'itemId',item.id,'productOrderNumber',item.product_order_number,'orderNumber',purchase.order_number,'shipmentNumber',delivery.shipment_number,'goodId'$a$);
select private.register_operator_rpc_contract('public.admin_smartstore_shipment_export(uuid[])'::regprocedure,'sales.manage','read',false);

-- Numeric references resolve to the same UUID before the existing tracking
-- mutation. Unknown identities still block every row before any dispatch.
alter function public.admin_import_item_tracking_batch(jsonb) rename to admin_import_item_tracking_batch_before_numbers;
alter function public.admin_import_item_tracking_batch_before_numbers(jsonb) set schema private;
revoke all on function private.admin_import_item_tracking_batch_before_numbers(jsonb) from public,anon,authenticated,service_role;
create function public.admin_import_item_tracking_batch(target_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare input jsonb; normalized jsonb:='[]'; result jsonb; number text; item_id uuid;
begin
  perform private.require_operator_capability('sales.manage',false);
  if jsonb_typeof(target_rows) is distinct from 'array' or jsonb_array_length(target_rows) not between 1 and 1000 then
    raise invalid_parameter_value using message='invalid_tracking_batch';end if;
  for input in select value from jsonb_array_elements(target_rows) loop
    number:=case when jsonb_typeof(input->'reference')='string' then btrim(input->>'reference') end;
    if number ~ '^[0-9]{8}2[0-9]{7}$' then
      select id into item_id from public.order_items where product_order_number=number;
      -- Leave unresolved numbers unchanged: the identity guard rejects the
      -- whole batch, including valid siblings, before delegating any writes.
      if item_id is not null then input:=jsonb_set(input,'{reference}',to_jsonb(item_id::text));end if;
    end if;
    normalized:=normalized||jsonb_build_array(input);
  end loop;
  result:=private.admin_import_item_tracking_batch_before_numbers(normalized);
  if jsonb_typeof(result) is distinct from 'array' or jsonb_array_length(result)<>jsonb_array_length(target_rows) then
    raise check_violation using message='tracking_batch_result_missing';end if;
  return (select jsonb_agg(outcome.value||case when jsonb_typeof(target_rows->(outcome.ordinality::integer-1)->'reference')='string'
      then jsonb_build_object('reference',btrim(target_rows->(outcome.ordinality::integer-1)->>'reference')) else '{}'::jsonb end order by outcome.ordinality)
    from jsonb_array_elements(result) with ordinality outcome(value,ordinality));
end $$;
revoke all on function public.admin_import_item_tracking_batch(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_import_item_tracking_batch(jsonb) to authenticated;
select private.register_operator_internal_contract('private.admin_import_item_tracking_batch_before_numbers(jsonb)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_import_item_tracking_batch(jsonb)'::regprocedure,'sales.manage','write',false);

select pg_temp.patch_commerce_reader('private.resolve_shipment_reference(text)',
  $a$elsif reference_value ~* '^[0-9a-f]{8}$' then$a$,
  $a$elsif reference_value ~ '^[0-9]{8}3[0-9]{7}$' then
   select id into shipment_key from public.order_shipments where shipment_number=reference_value;
 elsif reference_value ~ '^[0-9]{8}1[0-9]{7}$' then
   select id into shipment_key from public.orders where order_number=reference_value;
   if shipment_key is not null then shipment_key:=private.single_order_shipment(shipment_key);end if;
 elsif reference_value ~* '^[0-9a-f]{8}$' then$a$);
select private.register_operator_internal_contract('private.resolve_shipment_reference(text)'::regprocedure);

-- Append a display column to the existing table-returning readers without
-- dropping their dependencies or rewriting their authorization/filter logic.
do $numbered_tables$
declare entry record; original regprocedure; moved regprocedure; arguments text; result_type text; call_args text; output_columns text; function_name text;
begin
  for entry in select * from (values
    ('public.admin_search_orders_console(text,date,date,text,integer,integer,timestamp with time zone,text,text,text,text)','id','sales.read'),
    ('public.admin_unpaid_bank_transfer_orders_console(text,integer,integer,text,text)','order_id','sales.manage'),
    ('public.admin_search_order_claims_console(text,text,text,date,date,text,integer,integer,text,text,text)','order_id','sales.manage'),
    ('public.admin_search_reviews_typed(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text,text,text)','order_id','cs.manage'),
    ('public.my_review_targets_v2(uuid,text,integer)','order_id',null)
  ) spec(signature,key_column,capability) loop
    original:=entry.signature::regprocedure;
    select proname,pg_get_function_arguments(oid),pg_get_function_result(oid),
      (select string_agg(quote_ident(name),',' order by ordinal) from unnest(proargnames[1:pronargs]) with ordinality args(name,ordinal)),
      (select string_agg(format('source.%I',name),',' order by ordinal)
        from unnest(proargnames,proargmodes) with ordinality args(name,mode,ordinal) where mode in('o','t'))
      into function_name,arguments,result_type,call_args,output_columns from pg_proc where oid=original;
    if left(result_type,6)<>'TABLE(' or position('order_number' in result_type)>0 then
      raise exception 'commerce_number_table_shape_changed: %',entry.signature;end if;
    execute format('alter function %s rename to %I',original,function_name||'_before_numbers');
    execute format('alter function %s set schema private',original);
    moved:=original;
    execute format('revoke all on function %s from public,anon,authenticated,service_role',moved);
    execute format('create function public.%I(%s) returns %s language plpgsql stable security definer set search_path='''' as $body$
      begin
        if %s then raise insufficient_privilege using message=''operator_capability_required'';end if;
        return query select %s,purchase.order_number from private.%I(%s) with ordinality source
          join public.orders purchase on purchase.id=source.%I order by source.ordinality;
      end $body$',function_name,arguments,left(result_type,length(result_type)-1)||', order_number text)',
      case when entry.capability is null then 'auth.uid() is null' else format('not public.has_operator_capability(%L,false)',entry.capability) end,
      output_columns,function_name||'_before_numbers',call_args,entry.key_column);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',entry.signature::regprocedure);
    execute format('grant execute on function %s to authenticated',entry.signature::regprocedure);
    perform private.register_operator_internal_contract(moved);
    if entry.capability is null then perform private.register_operator_internal_contract(entry.signature::regprocedure);
    else perform private.register_operator_rpc_contract(entry.signature::regprocedure,entry.capability,'read',false);end if;
  end loop;
end $numbered_tables$;

-- The same persisted number accompanies authorized order contexts; UUIDs remain
-- the action, route and receipt keys. No new data access path is introduced.
select pg_temp.patch_commerce_reader('private.with_order_item_custom_inputs(jsonb)',
  'entry.value||case when item.custom_inputs_snapshot',
  $a$entry.value||case when item.id is null then '{}'::jsonb else jsonb_build_object('productOrderNumber',item.product_order_number) end||case when item.custom_inputs_snapshot$a$);
select private.register_operator_internal_contract('private.with_order_item_custom_inputs(jsonb)'::regprocedure);
select pg_temp.patch_commerce_reader('public.admin_order_claim_detail(uuid)',
  'return result || jsonb_build_object(',
  $a$if jsonb_typeof(result->'order')='object' then
    result:=jsonb_set(result,'{order}',(result->'order')||jsonb_build_object('orderNumber',
      (select order_number from public.orders where id=(result#>>'{order,id}')::uuid)));
  end if;
  return result || jsonb_build_object($a$);
select pg_temp.patch_commerce_reader('public.admin_inquiry_context(uuid)',
  $a$'id', target.id,$a$,$a$'id', target.id, 'orderNumber', target.order_number,$a$);
select pg_temp.patch_commerce_reader('public.admin_order_address_context(uuid)',
  $a$'orderId',purchase.id,'address'$a$,$a$'orderId',purchase.id,'orderNumber',purchase.order_number,'address'$a$);
select pg_temp.patch_commerce_reader('public.admin_seller_claim_intake_context(uuid)',
  $a$'orderId', target.id, 'orderStatus'$a$,$a$'orderId', target.id, 'orderNumber', target.order_number, 'orderStatus'$a$);
select pg_temp.patch_commerce_reader('public.admin_get_order_delay_notice(uuid)',
  $a$'orderId',t.order_id,'buyerName'$a$,
  $a$'orderId',t.order_id,'orderNumber',(select o.order_number from public.orders o where o.id=t.order_id),'buyerName'$a$);
select pg_temp.patch_commerce_reader('public.admin_list_bank_transfer_refunds_numbered(integer,integer)',
  $a$'orderId',purchase.id,'reference'$a$,$a$'orderId',purchase.id,'orderNumber',purchase.order_number,'reference'$a$);
select pg_temp.patch_commerce_reader('public.admin_inquiry_satisfaction_console_numbered(text,text,date,date,text,text,integer,integer,text)',
  $a$then thread.order_id else null::uuid end order_id,$a$,
  $a$then thread.order_id else null::uuid end order_id,
   case when public.has_operator_capability('sales.read') then (select o.order_number from public.orders o where o.id=thread.order_id) else null::text end order_number,$a$);
select pg_temp.patch_commerce_reader('public.admin_inquiry_satisfaction_console_numbered(text,text,date,date,text,text,integer,integer,text)',
  $a$position(lower(v_query) in lower(coalesce(thread.order_id::text,'')))>0$a$,
  $a$(position(lower(v_query) in lower(coalesce(thread.order_id::text,'')))>0 or exists(select 1 from public.orders o where o.id=thread.order_id and position(v_query in o.order_number)>0))$a$);
-- Enrich only the returned rows, after the original version digest is built.
-- Both app versions therefore submit the same version to the unchanged writer.
create function public.admin_get_shipment_packs_numbered(p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare document jsonb;
begin
  perform private.require_operator_capability('sales.manage',false);
  document:=public.admin_get_shipment_packs(p_ids);
  return jsonb_set(document,'{rows}',(select coalesce(jsonb_agg(entry.value||
    jsonb_build_object('orderNumber',o.order_number,'shipmentNumber',s.shipment_number) order by entry.ordinality),'[]')
    from jsonb_array_elements(document->'rows') with ordinality entry(value,ordinality)
    join public.order_shipments s on s.id=(entry.value->>'id')::uuid join public.orders o on o.id=s.order_id));
end $$;
revoke all on function public.admin_get_shipment_packs_numbered(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_shipment_packs_numbered(uuid[]) to authenticated;
select private.register_operator_rpc_contract('public.admin_get_shipment_packs_numbered(uuid[])'::regprocedure,'sales.manage','read',false);

select pg_temp.patch_commerce_reader('public.admin_list_claim_fees_numbered(text,integer)',
  $a$'orderId',c.order_id,'claimType'$a$,
  $a$'orderId',c.order_id,'orderNumber',(select o.order_number from public.orders o where o.id=c.order_id),'claimType'$a$);
create function private.gift_detail_numbered(p_actor uuid,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare document jsonb:=private.gift_detail(p_actor,p_id);
begin
  if jsonb_typeof(document->'order')='object' then
    document:=jsonb_set(document,'{order}',(document->'order')||jsonb_build_object('orderNumber',
      (select o.order_number from public.orders o where o.id=(document#>>'{order,id}')::uuid)));
  end if;
  return document;
end $$;
revoke all on function private.gift_detail_numbered(uuid,uuid) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.gift_detail_numbered(uuid,uuid)'::regprocedure);
select pg_temp.patch_commerce_reader('public.get_my_gift_numbered(uuid)','private.gift_detail(','private.gift_detail_numbered(');
select pg_temp.patch_commerce_reader('public.list_my_gifts_numbered(text,timestamp with time zone,uuid)','private.gift_detail(','private.gift_detail_numbered(');
select private.register_operator_internal_contract('public.get_my_gift_numbered(uuid)'::regprocedure);
select private.register_operator_internal_contract('public.list_my_gifts_numbered(text,timestamp with time zone,uuid)'::regprocedure);
select pg_temp.patch_commerce_reader('public.get_my_gift_checkout_order_numbered(uuid,uuid)',
  $a$'id',purchase.id,'giftId'$a$,$a$'id',purchase.id,'orderNumber',purchase.order_number,'giftId'$a$);
select private.register_operator_internal_contract('public.get_my_gift_checkout_order_numbered(uuid,uuid)'::regprocedure);

do $refresh_contexts$declare entry record;begin
  for entry in select * from private.operator_rpc_contracts where signature in (
    'public.admin_order_claim_detail(uuid)','public.admin_inquiry_context(uuid)','public.admin_order_address_context(uuid)',
    'public.admin_seller_claim_intake_context(uuid)','public.admin_get_order_delay_notice(uuid)'
  ) loop
    perform private.register_operator_rpc_contract(entry.signature::regprocedure,entry.capability,entry.guard_kind,entry.legacy_admin_only);
  end loop;
end $refresh_contexts$;
select private.register_operator_rpc_contract('public.admin_list_bank_transfer_refunds_numbered(integer,integer)'::regprocedure,capability,guard_kind,legacy_admin_only)
from private.operator_rpc_contracts where signature='public.admin_list_bank_transfer_refunds(integer,integer)';
select private.register_operator_rpc_contract('public.admin_list_claim_fees_numbered(text,integer)'::regprocedure,'sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_inquiry_satisfaction_console_numbered(text,text,date,date,text,text,integer,integer,text)'::regprocedure,capability,guard_kind,legacy_admin_only)
from private.operator_rpc_contracts where signature='public.admin_inquiry_satisfaction_console(text,text,date,date,text,text,integer,integer,text)';

select pg_temp.patch_commerce_reader('private.order_shipment_records_before_delivery_methods(uuid)',
  $a$'id',shipment.id,'orderId'$a$,$a$'id',shipment.id,'shipmentNumber',shipment.shipment_number,'orderId'$a$);
select private.register_operator_internal_contract('private.order_shipment_records_before_delivery_methods(uuid)'::regprocedure);
select pg_temp.patch_commerce_reader('private.admin_unpaid_bank_transfer_orders_console_before_numbers(text,integer,integer,text,text)',
  $a$or candidate.id::text = lower(v_query)$a$,
  $a$or candidate.id::text = lower(v_query)
      or exists(select 1 from public.orders numbered where numbered.id=candidate.id and position(v_query in numbered.order_number)>0)$a$);
select private.register_operator_internal_contract('private.admin_unpaid_bank_transfer_orders_console_before_numbers(text,integer,integer,text,text)'::regprocedure);

notify pgrst,'reload schema';
commit;
