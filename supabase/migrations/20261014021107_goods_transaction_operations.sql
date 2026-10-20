-- Reviewed post-checkout COD evidence, public previews and finance readers.
-- No provider call or carrier collection occurs through these functions.
create function private.shipping_collect_document(p_shipment_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('shipmentId',o.shipment_id,'orderId',o.order_id,'originName',s.origin_name_snapshot,'amount',o.amount,
  'state',o.state,'revision',o.revision,'updatedAt',o.updated_at,'events',coalesce((select jsonb_agg(jsonb_build_object(
   'operationId',e.operation_id,'event',e.event,'amount',e.amount,'recordedAt',e.created_at,
   'occurredAt',e.evidence->'occurredAt','party',e.evidence->'party','reversesOperationId',e.evidence->'reversesOperationId','reference',e.evidence->'reference','note',e.evidence->'note') order by coalesce(e.previous_revision,0),e.created_at,e.operation_id)
   from private.shipping_collect_events e where e.shipment_id=o.shipment_id),'[]'))
 from private.shipping_collect_obligations o join public.order_shipments s on s.id=o.shipment_id where o.shipment_id=p_shipment_id;
$$;
create function public.admin_get_order_shipping_collect(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not public.has_operator_capability('sales.read',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_order_id is null then raise invalid_parameter_value using message='invalid_shipping_collect_order';end if;
 return(select coalesce(jsonb_agg(private.shipping_collect_document(o.shipment_id) order by o.shipment_id),'[]')
  from private.shipping_collect_obligations o where o.order_id=p_order_id);
end $$;
create function public.admin_get_shipping_collect_event_operation(p_operation_id uuid,p_expected_actor_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$declare actor uuid:=auth.uid();begin
 if actor is null or actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='auth_context_changed';end if;
 perform private.require_actor_operator_capability(actor,'sales.manage');
 if p_operation_id is null then raise invalid_parameter_value using message='invalid_shipping_collect_operation';end if;
 perform pg_advisory_xact_lock(hashtextextended('goods-collect-operation:'||p_operation_id::text,0));
 return(select diff->'result' from public.audit_log where id=p_operation_id and actor_id=actor and action='admin.shipping.collect_recorded');
end $$;
create function public.admin_record_shipping_collect_event(p_order_id uuid,p_shipment_id uuid,p_expected_revision integer,p_operation_id uuid,
 p_event text,p_amount bigint,p_occurred_at timestamptz,p_party text,p_reverses_operation_id uuid,p_reference text,p_note text,p_expected_actor_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();selected_order uuid;purchase public.orders;shipment public.order_shipments;
 obligation private.shipping_collect_obligations;reversed private.shipping_collect_events;request jsonb;receipt jsonb;next_state text;previous_document jsonb;
begin
 if actor is null or actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='auth_context_changed';end if;
 perform private.require_actor_operator_capability(actor,'sales.manage');
 if p_order_id is null or p_shipment_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<1
  or p_event is null or p_event not in('collected','void','refund_review','refunded','mismatch','correction')
  or p_amount is null or p_amount not between 0 and 9007199254740991 or p_occurred_at is null or not isfinite(p_occurred_at)
  or p_party is null or p_party<>btrim(p_party) or char_length(p_party) not between 1 and 200 or p_party~'[[:cntrl:]]'
  or ((p_event='correction') is distinct from (p_reverses_operation_id is not null))
  or p_reference is null or p_reference<>btrim(p_reference) or char_length(p_reference) not between 1 and 1000 or p_reference~'[[:cntrl:]]'
  or p_note is null or p_note<>btrim(p_note) or char_length(p_note) not between 1 and 1000 or p_note~'[[:cntrl:]]' then
  raise invalid_parameter_value using message='invalid_shipping_collect_evidence';end if;
 request:=jsonb_build_object('orderId',p_order_id,'shipmentId',p_shipment_id,'expectedRevision',p_expected_revision,'event',p_event,'amount',p_amount,
  'occurredAt',p_occurred_at,'party',p_party,'reversesOperationId',p_reverses_operation_id,'reference',p_reference,'note',p_note);
 perform pg_advisory_xact_lock(hashtextextended('goods-collect-operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.shipping.collect_recorded',request);
 if receipt is not null then return receipt;end if;
 select order_id into selected_order from public.order_shipments where id=p_shipment_id;
 if not found or selected_order<>p_order_id then raise no_data_found using message='shipping_collect_not_found';end if;
 -- Same order as full cancellation: order, shipment, COD obligation.
 select * into purchase from public.orders where id=selected_order for update;
 select * into shipment from public.order_shipments where id=p_shipment_id and order_id=selected_order for update;
 select * into obligation from private.shipping_collect_obligations where shipment_id=p_shipment_id for update;
 if not found then raise no_data_found using message='shipping_collect_not_found';end if;
 if obligation.revision<>p_expected_revision then raise sqlstate 'PT409' using message='shipping_collect_changed';end if;
 if p_occurred_at<purchase.created_at or p_occurred_at>clock_timestamp() then raise invalid_parameter_value using message='invalid_shipping_collect_time';end if;
 if p_event<>'correction' and obligation.state in('void','refunded') then raise check_violation using message='shipping_collect_terminal';end if;
 if p_event='correction' then
  select * into reversed from private.shipping_collect_events where operation_id=p_reverses_operation_id and shipment_id=p_shipment_id;
  if not found or reversed.previous_revision is null or reversed.previous_state is null or reversed.previous_revision<>obligation.revision-1
   or reversed.event='correction' or p_amount<>reversed.amount then raise check_violation using message='shipping_collect_correction_requires_latest';end if;
  next_state:=case when purchase.status='canceled' and reversed.previous_state not in('void','refunded') then 'refund_review' else reversed.previous_state end;
 elsif p_event='collected' then
  if purchase.status='pending' or p_amount<>obligation.amount then raise check_violation using message='shipping_collect_amount_or_state';end if;
  if obligation.state not in('planned','mismatch','refund_review') then raise check_violation using message='shipping_collect_transition';end if;
  next_state:=case when purchase.status='canceled' or obligation.state='refund_review' then 'refund_review' else 'collected' end;
 elsif p_event='void' then
  if purchase.status<>'canceled' or p_amount<>0 or obligation.state='collected'
   or exists(select 1 from private.shipping_collect_events e where e.shipment_id=p_shipment_id and e.event='collected'
    and not exists(select 1 from private.shipping_collect_events reversal where reversal.shipment_id=e.shipment_id and reversal.event='correction' and reversal.evidence->>'reversesOperationId'=e.operation_id::text)) then
   raise check_violation using message='shipping_collect_void_requires_uncollected_cancel';end if;
  next_state:='void';
 elsif p_event='refund_review' then
  if p_amount<>obligation.amount then raise check_violation using message='shipping_collect_amount_or_state';end if;
  next_state:='refund_review';
 elsif p_event='refunded' then
  if purchase.status<>'canceled' or p_amount<>obligation.amount or obligation.state not in('collected','refund_review','mismatch') then
   raise check_violation using message='shipping_collect_refund_requires_full_cancel';end if;
  next_state:='refunded';
 else
  if p_amount=obligation.amount then raise check_violation using message='shipping_collect_mismatch_requires_difference';end if;
  next_state:='mismatch';
 end if;
 previous_document:=private.shipping_collect_document(p_shipment_id);
 update private.shipping_collect_obligations set state=next_state,revision=revision+1,updated_at=clock_timestamp() where shipment_id=p_shipment_id;
 insert into private.shipping_collect_events(operation_id,shipment_id,event,amount,actor_id,evidence,previous_state,previous_revision)
 values(p_operation_id,p_shipment_id,p_event,p_amount,actor,jsonb_build_object('occurredAt',p_occurred_at,'party',p_party,'reversesOperationId',p_reverses_operation_id,'reference',p_reference,'note',p_note),obligation.state,obligation.revision);
 receipt:=jsonb_build_object('operationId',p_operation_id,'obligation',private.shipping_collect_document(p_shipment_id));
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.shipping.collect_recorded','order:'||selected_order::text,
  jsonb_build_object('request',request,'before',previous_document,'result',receipt));
 return receipt;
end $$;
revoke all on function private.shipping_collect_document(uuid),public.admin_get_order_shipping_collect(uuid),
 public.admin_get_shipping_collect_event_operation(uuid,uuid),public.admin_record_shipping_collect_event(uuid,uuid,integer,uuid,text,bigint,timestamptz,text,uuid,text,text,uuid)
 from public,anon,authenticated,service_role;
grant execute on function private.shipping_collect_document(uuid) to postgres;
grant execute on function public.admin_get_order_shipping_collect(uuid),public.admin_get_shipping_collect_event_operation(uuid,uuid),
 public.admin_record_shipping_collect_event(uuid,uuid,integer,uuid,text,bigint,timestamptz,text,uuid,text,text,uuid) to authenticated;
select private.register_operator_internal_contract('private.shipping_collect_document(uuid)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_get_order_shipping_collect(uuid)'::regprocedure,'sales.read','read',false);
select private.register_operator_rpc_contract('public.admin_get_shipping_collect_event_operation(uuid,uuid)'::regprocedure,'sales.manage','manual',false);
select private.register_operator_rpc_contract('public.admin_record_shipping_collect_event(uuid,uuid,integer,uuid,text,bigint,timestamptz,text,uuid,text,text,uuid)'::regprocedure,'sales.manage','manual',false);
notify pgrst,'reload schema';

-- Address-free catalog comparison includes all physical base delivery charges.
-- It never claims a payable amount or a regional surcharge without an address.
create function private.goods_transaction_base_shipping_quote(p_items jsonb,p_legacy_quote jsonb,p_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare lines jsonb;begin
 if not exists(select 1 from jsonb_to_recordset(p_items) item("goodId" text,"variantId" uuid,qty integer)
  join private.goods_transaction_configs c on c.good_id=item."goodId"
  join private.goods_delivery_versions d on d.id=c.delivery_version_id where d.status='active' and d.quantity_terms is not null) then return p_legacy_quote;end if;
 select jsonb_agg(jsonb_build_object('origin_id',grouped.origin_id,'good_id',grouped.good_id,'qty',1,'unit_price',grouped.subtotal,
  'fee_type',case when grouped.quantity_terms is null then grouped.shipping_fee_type else 'individual' end,
  'individual_fee',case when grouped.quantity_terms is null then grouped.individual_fee else private.goods_quantity_delivery_fee(grouped.qty,grouped.quantity_terms) end))
 into lines from(select good.id good_id,good.origin_id,good.shipping_fee_type,good.individual_fee,d.quantity_terms,
   sum(item.qty::numeric) qty,sum(item.qty::numeric*pricing.effective_price) subtotal
  from jsonb_to_recordset(p_items) item("goodId" text,"variantId" uuid,qty integer)
  join public.goods good on good.id=item."goodId" join public.goods_variants variant on variant.id=item."variantId" and variant.good_id=good.id
  cross join lateral private.resolve_goods_variant_price(variant.id,p_at) pricing
  left join private.goods_transaction_configs c on c.good_id=good.id
  left join private.goods_delivery_versions d on d.id=c.delivery_version_id and d.status='active'
  group by good.id,good.origin_id,good.shipping_fee_type,good.individual_fee,d.quantity_terms) grouped;
 return private.calculate_goods_shipping(lines);
end $$;
revoke all on function private.goods_transaction_base_shipping_quote(jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.goods_transaction_base_shipping_quote(jsonb,jsonb,timestamptz) to postgres;
select private.register_operator_internal_contract('private.goods_transaction_base_shipping_quote(jsonb,jsonb,timestamptz)'::regprocedure);
do $$declare definition text;anchor text:='quote:=private.quote_goods_shipping_before_preorder(items);';begin
 definition:=pg_get_functiondef('public.quote_goods_shipping(jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'transaction_base_shipping_anchor_changed';end if;
 execute replace(definition,anchor,anchor||E'\n  quote:=private.goods_transaction_base_shipping_quote(items,quote,statement_timestamp());');
 perform private.register_operator_internal_contract('public.quote_goods_shipping(jsonb)'::regprocedure);
end $$;

-- Keep all existing filters, gift operational-address readers, owner and ACL.
-- New receipts include immutable allocations; existing v1 receipts stay readable.
do $patch$
declare signature text;definition text;pair text[];replacements text[][]:=array[
 array[$old$'schemaVersion',1$old$,$new$'schemaVersion',2$new$],
 array[$old$'couponDiscount',o.discount_total,'storeCredits',o.store_credit_total,$old$,$new$'couponDiscount',o.discount_total,'storeCredits',o.store_credit_total,
   'calculationVersion',o.calculation_version,'volumeDiscount',o.volume_discount_total,'shippingCollectTotal',o.shipping_collect_total,
   'shippingComponents',coalesce((select jsonb_agg(jsonb_build_object('id',component.id,'shipmentId',component.shipment_id,'paymentMode',component.payment_mode,
    'baseFee',component.base_fee,'regionalFee',component.regional_fee,'totalFee',component.total_fee) order by component.id)
    from private.shipping_charge_components component where component.order_id=o.id),'[]'),$new$],
 array[$old$'id',s.id,'trackingNumber',s.tracking_number,'shippingFee',s.shipping_fee,'status',s.status$old$,$new$'id',s.id,'trackingNumber',s.tracking_number,'shippingFee',s.shipping_fee,'status',s.status,
    'shippingCollectFee',s.shipping_collect_fee,'collectState',(select obligation.state from private.shipping_collect_obligations obligation where obligation.shipment_id=s.id)$new$],
 array[$old$'shipmentId',assignment.shipment_id,$old$,$new$'shipmentId',assignment.shipment_id,
    'allocation',(select jsonb_build_object('subtotal',allocation.subtotal,'volumeDiscount',allocation.volume_discount,'netSubtotal',allocation.net_subtotal,
     'couponDiscount',allocation.coupon_discount,'storeCreditDiscount',allocation.store_credit_discount,'paidGoodsTotal',allocation.paid_goods_total)
     from private.order_price_allocations allocation where allocation.order_item_id=item.id and allocation.order_id=o.id),$new$]
];
begin
 foreach signature in array array['private.collect_settled_export(date,date,text)','private.collect_settled_export_for_date(date,date,text,text)',
  'private.collect_settled_export_for_search(date,date,text,text,text)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  foreach pair slice 1 in array replacements loop
   if (length(definition)-length(replace(definition,pair[1],'')))/length(pair[1])<>1 then raise exception 'settled_transaction_anchor_changed % %',signature,pair[1];end if;
   definition:=replace(definition,pair[1],pair[2]);
  end loop;
  execute definition;
  perform private.register_operator_internal_contract(signature::regprocedure);
 end loop;
end $patch$;

-- Reports count item net subtotal after volume discount and before coupon/credit.
-- PG/order totals already represent the actual online amount and exclude COD.
do $patch$
declare signature text;definition text;anchor text;replacement text;
begin
 foreach signature in array array['public.admin_sales_report(timestamptz,timestamptz,text)',
  'public.admin_sales_goods_page(timestamptz,timestamptz,text,integer,integer)','public.admin_sales_hourly_report(date,text,timestamptz)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  anchor:=case when signature like '%hourly%' then 'sum(item.qty::bigint*item.unit_price::bigint)' else 'sum(item.qty::bigint * item.unit_price::bigint)' end;
  replacement:='sum(item.qty::numeric*item.unit_price::numeric-coalesce((select allocation.volume_discount from private.order_price_allocations allocation where allocation.order_item_id=item.id),0))';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'sales_transaction_anchor_changed %',signature;end if;
  execute replace(definition,anchor,replacement);
  perform private.register_operator_rpc_contract(signature::regprocedure,'stats.read','read',false);
 end loop;
 signature:='public.admin_customer_purchase_report(text,date,date,date,date)';
 definition:=pg_get_functiondef(signature::regprocedure);anchor:='sum(line.qty::numeric*line.unit_price::numeric)';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'customer_transaction_anchor_changed';end if;
 execute replace(definition,anchor,'sum(line.qty::numeric*line.unit_price::numeric-coalesce((select allocation.volume_discount from private.order_price_allocations allocation where allocation.order_item_id=line.id),0))');
 perform private.register_operator_rpc_contract(signature::regprocedure,'stats.read','read',false);
end $patch$;
comment on function public.admin_sales_goods_page(timestamptz,timestamptz,text,integer,integer) is
 'Goods ranking uses stored item qty*unit_price less immutable volume discount, before coupon/store credit/shipping. Current revenue order states, orders.created_at [from,to), item name/IP snapshots; revenue desc then qty desc then good_id. Count and page share one statement snapshot; export sentinel 10001 is not permission to export over 10000.';
comment on function public.admin_sales_hourly_report(date,text,timestamptz) is
 'Completed KST hours before exclusive cutoff; current order states and online total exclude COD. IP filters goods rankings only. Goods revenue is stored subtotal less immutable volume discount, before coupon/store credit/shipping. Null future hours are unobserved. asOf is read time, not historical-state promise.';
notify pgrst,'reload schema';

-- A refreshed browser has only operation identifiers, never evidence bodies.
-- Seal a still-unseen operation under the same lock before permitting a new ID.
create function public.admin_seal_shipping_collect_operation(p_order_id uuid,p_shipment_id uuid,p_operation_id uuid,p_expected_actor_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();previous public.audit_log;request jsonb;receipt jsonb;
begin
 if actor is null or actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='auth_context_changed';end if;
 perform private.require_actor_operator_capability(actor,'sales.manage');
 if p_order_id is null or p_shipment_id is null or p_operation_id is null then raise invalid_parameter_value using message='invalid_shipping_collect_operation';end if;
 perform pg_advisory_xact_lock(hashtextextended('goods-collect-operation:'||p_operation_id::text,0));
 request:=jsonb_build_object('orderId',p_order_id,'shipmentId',p_shipment_id);
 select * into previous from public.audit_log where id=p_operation_id;
 if found then
  if previous.actor_id is distinct from actor or previous.diff#>>'{request,orderId}' is distinct from p_order_id::text or previous.diff#>>'{request,shipmentId}' is distinct from p_shipment_id::text then raise unique_violation using message='operation_conflict';end if;
  if previous.action='admin.shipping.collect_recorded' then return jsonb_build_object('state','recorded','receipt',previous.diff->'result');end if;
  if previous.action='admin.shipping.collect_abandoned' then return previous.diff->'result';end if;
  raise unique_violation using message='operation_conflict';
 end if;
 if not exists(select 1 from private.shipping_collect_obligations where shipment_id=p_shipment_id and order_id=p_order_id) then raise no_data_found using message='shipping_collect_not_found';end if;
 receipt:=jsonb_build_object('state','sealed','operationId',p_operation_id,'orderId',p_order_id,'shipmentId',p_shipment_id);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.shipping.collect_abandoned','order:'||p_order_id::text,jsonb_build_object('request',request,'result',receipt));
 return receipt;
end $$;
revoke all on function public.admin_seal_shipping_collect_operation(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_seal_shipping_collect_operation(uuid,uuid,uuid,uuid) to authenticated;
select private.register_operator_rpc_contract('public.admin_seal_shipping_collect_operation(uuid,uuid,uuid,uuid)'::regprocedure,'sales.manage','manual',false);
notify pgrst,'reload schema';
