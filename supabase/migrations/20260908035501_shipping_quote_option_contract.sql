-- #443: shipping quotes require the same explicit option identity as cart/order writes.
CREATE OR REPLACE FUNCTION public.quote_goods_shipping(items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare input record; good public.goods; variant public.goods_variants; line_qty integer; variant_key uuid; lines jsonb:='[]';
begin
  if jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items)>1000 then
    raise invalid_parameter_value using message='invalid_shipping_quote_items';
  end if;
  for input in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(input.value) is distinct from 'object' or exists(select 1 from jsonb_object_keys(input.value) k where k not in ('goodId','variantId','qty'))
      or jsonb_typeof(input.value->'qty') is distinct from 'number'
      or jsonb_typeof(input.value->'variantId') is distinct from 'string'
      or (input.value->>'variantId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise invalid_parameter_value using message='invalid_shipping_quote_items'; end if;
    line_qty:=(input.value->>'qty')::integer;
    if line_qty not between 1 and 2147483647 then raise invalid_parameter_value using message='invalid_shipping_quote_items'; end if;
    select g.* into good from public.goods g join public.ips ip on ip.id=g.ip_id
      join public.fulfillment_origins origin on origin.id=g.origin_id and origin.is_active
      where g.id=input.value->>'goodId' and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
        and ip.archived_at is null and ip.published_at is not null;
    if not found then raise check_violation using message='shipping_quote_good_unavailable'; end if;
    variant_key:=(input.value->>'variantId')::uuid;
    select v.* into variant from public.goods_variants v where v.good_id=good.id and v.archived_at is null
      and v.id=variant_key;
    if not found then raise check_violation using message='shipping_quote_variant_unavailable'; end if;
    lines:=lines||jsonb_build_array(jsonb_build_object('origin_id',good.origin_id,'good_id',good.id,'qty',line_qty,
      'unit_price',variant.price,'fee_type',good.shipping_fee_type,'individual_fee',good.individual_fee));
  end loop;
  return private.calculate_goods_shipping(lines);
end $function$;

revoke all on function public.quote_goods_shipping(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.quote_goods_shipping(jsonb) to anon, authenticated;
