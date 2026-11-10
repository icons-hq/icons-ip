-- Reflect the aggregation owner's quantity/member policy in each
-- selected good's display metadata. Selected identities, line quantities,
-- family enforcement, prices, stock, supply and payment methods stay intact.
-- No helper, permission, table, business-row or legacy-reader change.
do $family_projection$
declare definition text; anchor text; replacement text;
begin
 definition:=pg_get_functiondef('private.goods_sales_conditions_core(jsonb)'::regprocedure);
 if encode(extensions.digest(convert_to(definition,'UTF8'),'sha256'),'hex')<>'9ea96ac1321a6e10292c486a8cd92c42cea1e68a0d0b9c9bba7bec6a8f45d8ff' then
  raise exception 'goods_sales_family_projection_baseline_changed';
 end if;
 anchor:=$anchor1$  good public.goods;
$anchor1$;
 replacement:=$replacement1$  good public.goods;
  quantity_policy public.goods;
$replacement1$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'goods_sales_family_projection_anchor_1_changed';
 end if;
 definition:=replace(definition,anchor,replacement);
 anchor:=$anchor2$    select * into good from public.goods where id=line.good_id;
$anchor2$;
 replacement:=$replacement2$    select * into good from public.goods where id=line.good_id;
    select * into quantity_policy from public.goods where id=private.goods_aggregation_owner(good.id);
$replacement2$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'goods_sales_family_projection_anchor_2_changed';
 end if;
 definition:=replace(definition,anchor,replacement);
 anchor:=$anchor3$      'orderQuantityLimitEnabled',good.order_quantity_limit_enabled,'minOrderQty',good.min_order_qty,'maxOrderQty',good.max_order_qty,
      'memberPurchaseLimitEnabled',good.member_purchase_limit_enabled,'memberLifetimeQtyLimit',good.member_lifetime_qty_limit,
      'memberReservedQty',reserved_qty,'memberRemainingQty',case when not good.member_purchase_limit_enabled or actor is null
        then null else greatest(0,good.member_lifetime_qty_limit::bigint-reserved_qty) end,'reason',quantity_error));$anchor3$;
 replacement:=$replacement3$      'orderQuantityLimitEnabled',quantity_policy.order_quantity_limit_enabled,'minOrderQty',quantity_policy.min_order_qty,'maxOrderQty',quantity_policy.max_order_qty,
      'memberPurchaseLimitEnabled',quantity_policy.member_purchase_limit_enabled,'memberLifetimeQtyLimit',quantity_policy.member_lifetime_qty_limit,
      'memberReservedQty',reserved_qty,'memberRemainingQty',case when not quantity_policy.member_purchase_limit_enabled or actor is null
        then null else greatest(0,quantity_policy.member_lifetime_qty_limit::bigint-reserved_qty) end,'reason',quantity_error));$replacement3$;
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'goods_sales_family_projection_anchor_3_changed';
 end if;
 definition:=replace(definition,anchor,replacement);
 execute definition;
end $family_projection$;
select private.register_operator_internal_contract('private.goods_sales_conditions_core(jsonb)'::regprocedure);
