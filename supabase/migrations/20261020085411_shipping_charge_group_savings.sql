-- DRAFT: address-free delivery savings use checkout's shared basic-charge math.
-- This estimate deliberately excludes regional fees and payment-mode selection.
create function private.shipping_savings_base_quote(items jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare lines jsonb;result jsonb;begin
 if not exists(select 1 from jsonb_to_recordset(items) item("goodId" text)
  join private.shipping_charge_group_assignments a on a.owner_good_id=private.goods_aggregation_owner(item."goodId") where a.group_id is not null) then
  return public.quote_goods_shipping(items);
 end if;
 if not coalesce((select enabled from private.goods_transaction_runtime where singleton),false) then
  raise check_violation using message='checkout_contract_upgrade_required';end if;
 select jsonb_agg(jsonb_build_object('good_id',owner.id,'origin_id',owner.origin_id,'qty',item.qty,'unit_price',price.effective_price,
  'fee_type',owner.shipping_fee_type,'individual_fee',owner.individual_fee) order by owner.id,item."variantId") into lines
 from jsonb_to_recordset(items) item("goodId" text,"variantId" uuid,qty integer)
 join public.goods owner on owner.id=private.goods_aggregation_owner(item."goodId")
 join public.goods_variants variant on variant.id=item."variantId" and variant.good_id=item."goodId"
 cross join lateral private.resolve_goods_variant_price(variant.id,statement_timestamp()) price;
 result:=private.calculate_shipping_charge_group_base(private.shipping_charge_group_effective_lines(lines));
 return jsonb_build_object('totalFee',result->'totalFee');
end $$;
revoke all on function private.shipping_savings_base_quote(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.shipping_savings_base_quote(jsonb) to postgres;
select private.register_operator_internal_contract('private.shipping_savings_base_quote(jsonb)'::regprocedure);

-- Reuse the current availability, quantity-limit, price-window and preorder
-- readers in private copies. Only their delivery estimate is substituted;
-- the legacy public checkout endpoints still reject unsupported group orders.
do $$declare definition text;source text;destination text;anchor text;expected integer;begin
 for source,destination,expected in values
  ('private.quote_goods_sales_before_preorder','private.shipping_savings_sales_core',2),
  ('public.quote_goods_sales','private.shipping_savings_sales_quote',1)
 loop
  definition:=pg_get_functiondef((source||'(jsonb)')::regprocedure);
  anchor:='CREATE OR REPLACE FUNCTION '||source||'(';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
   raise exception 'shipping_savings_function_signature_changed';end if;
  definition:=replace(definition,anchor,'CREATE OR REPLACE FUNCTION '||destination||'(');
  anchor:='public.quote_goods_shipping(items)';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>expected then
   raise exception 'shipping_savings_base_quote_anchor_changed';end if;
  definition:=replace(definition,anchor,'private.shipping_savings_base_quote(items)');
  if source='private.quote_goods_sales_before_preorder' then
   -- Purchase limits follow the economic family, independently of the
   -- mutable delivery group. Splitting selected siblings cannot lower Q.
   anchor:='quantity_error:=private.check_goods_purchase_quantity(good,actor,line.qty,true);';
   if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'shipping_savings_quantity_guard_anchor_changed';end if;
   definition:=replace(definition,anchor,'quantity_error:=private.check_goods_purchase_quantity(good,actor,(select sum(item.qty::bigint)::bigint from jsonb_to_recordset(normalized) item(good_id text,qty integer) where private.goods_aggregation_owner(item.good_id)=private.goods_aggregation_owner(good.id)),true);');
  end if;
  if source='public.quote_goods_sales' then
   anchor:='private.quote_goods_sales_before_preorder(items)';
   if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'shipping_savings_sales_core_anchor_changed';end if;
   definition:=replace(definition,anchor,'private.shipping_savings_sales_core(items)');
  end if;
  execute definition;
  execute 'revoke all on function '||destination||'(jsonb) from public,anon,authenticated,service_role';
  execute 'grant execute on function '||destination||'(jsonb) to postgres';
  perform private.register_operator_internal_contract((destination||'(jsonb)')::regprocedure);
 end loop;
 definition:=pg_get_functiondef('public.get_product_shipping_savings(text,uuid,integer)'::regprocedure);
 anchor:='public.quote_goods_sales(';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>3 then
  raise exception 'shipping_savings_public_reader_anchor_changed';end if;
 definition:=replace(definition,anchor,'private.shipping_savings_sales_quote(');
 anchor:='from public.goods g join public.ips ip on ip.id=g.ip_id';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>2 then
  raise exception 'shipping_savings_candidate_owner_anchor_changed';end if;
 definition:=replace(definition,anchor,anchor||' join public.goods policy on policy.id=private.goods_aggregation_owner(g.id)');
 definition:=replace(definition,'g.order_quantity_limit_enabled','policy.order_quantity_limit_enabled');
 definition:=replace(definition,'g.min_order_qty','policy.min_order_qty');
 anchor:='g.origin_id=current_good.origin_id';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'shipping_savings_candidate_origin_anchor_changed';end if;
 definition:=replace(definition,anchor,'policy.origin_id=(select origin_id from public.goods where id=private.goods_aggregation_owner(current_good.id))');
 execute definition;
 perform private.register_operator_internal_contract('public.get_product_shipping_savings(text,uuid,integer)'::regprocedure);
end $$;
