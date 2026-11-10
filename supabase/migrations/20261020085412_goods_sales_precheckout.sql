-- DRAFT: cart price/availability conditions are independent from checkout's
-- address, payment-mode and delivery-group calculation. No state is written.
-- Preserve the current savings payload while sharing its product-condition
-- readers with the transaction cart's explicit checkout-required preview.

do $$declare definition text;anchor text;begin
 definition:=pg_get_functiondef('private.shipping_savings_sales_core(jsonb)'::regprocedure);
 anchor:='CREATE OR REPLACE FUNCTION private.shipping_savings_sales_core(';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'goods_sales_precheckout_core_signature_changed';end if;
 definition:=replace(definition,anchor,'CREATE OR REPLACE FUNCTION private.goods_sales_conditions_core(');
 anchor:=E'    ''shipping'',private.shipping_savings_base_quote(items),\n    ''coupon'',private.quote_selected_coupon(quoted_lines,subtotal,(private.shipping_savings_base_quote(items)->>''totalFee'')::bigint),\n';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'goods_sales_precheckout_core_return_changed';end if;
 definition:=replace(definition,anchor,'');
 if strpos(definition,'private.shipping_savings_base_quote(')>0 or strpos(definition,'private.quote_selected_coupon(')>0
  or strpos(definition,'public.quote_goods_shipping(')>0 or strpos(definition,'public.quote_goods_sales(')>0 then
  raise exception 'goods_sales_precheckout_core_still_reads_shipping';end if;
 execute definition;
end $$;

-- Preserve the existing preorder/supply enrichment and its next-change time.
-- The common core retains effective period prices, actual selected identities,
-- family-aggregated purchase quantities and the current caller's member limits.
create function private.goods_sales_conditions_quote(items jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare quote jsonb;lines jsonb:='[]';line jsonb;supply jsonb;next_change timestamptz;selling boolean;
begin
 quote:=private.goods_sales_conditions_core(items);
 next_change:=(quote->>'nextChangeAt')::timestamptz;
 for line in select value from jsonb_array_elements(quote->'lines') loop
  select public.goods_variant_supply(variant),good.stock<>'soldout' into supply,selling
   from public.goods_variants variant join public.goods good on good.id=variant.good_id
   where variant.id=(line->>'variantId')::uuid and good.id=line->>'goodId';
  if supply is null then raise check_violation using message='sales_quote_variant_unavailable';end if;
  lines:=lines||jsonb_build_array(line||jsonb_build_object('supply',supply,'available',selling and (line->>'qty')::bigint<=(supply->>'availableQty')::integer));
  next_change:=least(next_change,(supply->>'nextChangeAt')::timestamptz);
 end loop;
 return quote||jsonb_build_object('lines',lines,'nextChangeAt',next_change);
end $$;

-- Existing private savings contracts retain their complete previous shape and
-- fee/coupon meaning. Their read-only basic shipping estimate is unchanged.
create or replace function private.shipping_savings_sales_core(items jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare quote jsonb;shipping jsonb;begin
 quote:=private.goods_sales_conditions_core(items);
 shipping:=private.shipping_savings_base_quote(items);
 return quote||jsonb_build_object('shipping',shipping,
  'coupon',private.quote_selected_coupon(quote->'lines',(quote->>'subtotal')::bigint,(shipping->>'totalFee')::bigint));
end $$;

create or replace function private.shipping_savings_sales_quote(items jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare quote jsonb;shipping jsonb;begin
 quote:=private.goods_sales_conditions_quote(items);
 shipping:=private.shipping_savings_base_quote(items);
 return quote||jsonb_build_object('shipping',shipping,
  'coupon',private.quote_selected_coupon(quote->'lines',(quote->>'subtotal')::bigint,(shipping->>'totalFee')::bigint));
end $$;

-- This is display-only product validation. It creates no quote receipt, order,
-- reservation, payment or coupon application. The order sheet still obtains
-- its complete address/payment-mode quote from the locked transaction engine.
create function public.quote_goods_sales_precheckout(items jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 if not coalesce((select enabled from private.goods_transaction_runtime where singleton),false) then
  raise check_violation using message='checkout_contract_upgrade_required';end if;
 return private.goods_sales_conditions_quote(items)||jsonb_build_object('shipping',jsonb_build_object('status','checkout_required'));
end $$;

revoke all on function private.goods_sales_conditions_core(jsonb),private.goods_sales_conditions_quote(jsonb),
 public.quote_goods_sales_precheckout(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.goods_sales_conditions_core(jsonb),private.goods_sales_conditions_quote(jsonb) to postgres;
grant execute on function public.quote_goods_sales_precheckout(jsonb) to anon,authenticated,postgres;
select private.register_operator_internal_contract('private.goods_sales_conditions_core(jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.goods_sales_conditions_quote(jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.shipping_savings_sales_core(jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.shipping_savings_sales_quote(jsonb)'::regprocedure);
select private.register_operator_internal_contract('public.quote_goods_sales_precheckout(jsonb)'::regprocedure);

-- Commit publishes the new RPC to the local PostgREST schema cache.
notify pgrst,'reload schema';
