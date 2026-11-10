begin;

-- Read-only list export: unlike a warehouse instruction this includes new,
-- dispatched and delivered shipments and never marks them as exported.
create function public.admin_delivery_list_export_lines(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_operator_capability('sales.manage',false);
  if p_ids is null or cardinality(p_ids) not between 1 and 1000 or array_position(p_ids,null) is not null
    or cardinality(p_ids)<>(select count(distinct id) from unnest(p_ids) id) then
    raise invalid_parameter_value using message='invalid_delivery_export_ids';
  end if;
  if (select count(*) from public.order_shipments where id=any(p_ids))<>cardinality(p_ids)
    or exists(select 1 from public.order_shipments s where s.id=any(p_ids)
      and not exists(select 1 from public.order_shipment_items link where link.shipment_id=s.id))
    or exists(select 1 from public.order_shipment_items link join public.order_items item on item.id=link.order_item_id
      where link.shipment_id=any(p_ids) and (link.qty<>item.qty or link.order_id<>item.order_id)) then
    raise check_violation using message='shipment_item_export_mismatch';
  end if;
  if exists(select 1 from public.order_shipment_items link join public.order_items item on item.id=link.order_item_id
    join public.orders purchase on purchase.id=item.order_id
    left join private.order_price_allocations allocation on allocation.order_item_id=item.id and allocation.order_id=purchase.id
    where link.shipment_id=any(p_ids) and purchase.calculation_version=2 and allocation.order_item_id is null) then
    raise check_violation using message='shipment_price_allocation_missing';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'shipmentId',s.id,'itemId',item.id,'orderId',purchase.id,'shipmentUpdatedAt',s.updated_at,
      'orderNumber',purchase.order_number,'productOrderNumber',item.product_order_number,'shipmentNumber',s.shipment_number,
      'status',case when s.status='shipping' then 'shipping' when s.status='delivered' then
        case when purchase.status='done' then 'done' else 'delivered' end
        when s.status='canceled' then 'canceled' when purchase.status='shipping' then 'confirmed' else purchase.status::text end,
      'deliveryMethod',s.delivery_method,'shippedAt',s.shipped_at,'deliveredAt',s.delivered_at,'paidAt',approval.approved_at,
      'carrier',coalesce(carrier.label,s.carrier),'trackingNumber',s.tracking_number,
      'buyerName',coalesce(profile.nickname,''),'buyerId',purchase.user_id,'buyerPhone',null,
      'recipientName',address.value->>'recipientName','phone',address.value->>'phone','postalCode',address.value->>'postalCode',
      'address',nullif(concat_ws(' ',nullif(address.value->>'address1',''),nullif(address.value->>'address2','')),''),
      'goodId',item.good_id,'goodCode',good.code,'goodName',item.good_name_snapshot,
      'variantName',item.variant_name_snapshot,'customInputs',item.custom_inputs_snapshot,'qty',link.qty,
      'productPrice',null,'optionPrice',null,
      'itemTotal',case when allocation.order_item_id is not null then allocation.paid_goods_total
        when purchase.calculation_version=1 and purchase.discount_total=0 and purchase.store_credit_total=0 and purchase.volume_discount_total=0
          then item.unit_price::bigint*item.qty else null end,
      'itemDiscount',discount.value,'sellerDiscount',discount.value,
      'shippingFee',s.shipping_fee,'shippingCollectFee',s.shipping_collect_fee,
      'regionalShippingFee',shipping.regional_fee,'shippingDiscount',shipping.coupon_discount
    ) order by array_position(p_ids,s.id),item.id),'[]'::jsonb)
    from public.order_shipments s join public.orders purchase on purchase.id=s.order_id
    join public.order_shipment_items link on link.shipment_id=s.id and link.order_id=purchase.id
    join public.order_items item on item.id=link.order_item_id and item.order_id=purchase.id
    left join public.profiles profile on profile.id=purchase.user_id
    left join public.goods good on good.id=item.good_id
    left join public.shipping_carriers carrier on carrier.code=s.carrier
    cross join lateral(select private.operational_order_address(purchase.id) as value) address
    left join private.order_price_allocations allocation on allocation.order_item_id=item.id and allocation.order_id=purchase.id
    cross join lateral(select case when item.regular_unit_price_snapshot>=item.unit_price then
      case when allocation.order_item_id is not null then
        (item.regular_unit_price_snapshot-item.unit_price)::bigint*item.qty+allocation.volume_discount+allocation.coupon_discount+allocation.store_credit_discount
      when purchase.calculation_version=1 and purchase.discount_total=0 and purchase.store_credit_total=0 and purchase.volume_discount_total=0 then
        (item.regular_unit_price_snapshot-item.unit_price)::bigint*item.qty else null end else null end as value) discount
    left join lateral(
      select min(coalesce(
        (select min(e.approved_at) from private.payment_provider_evidence e where e.payment_attempt_id=attempt.id),
        (select b.confirmed_at from public.bank_transfer_confirmations b where b.attempt_id=attempt.id and b.order_id=purchase.id and attempt.provider='bank_transfer')
      )) approved_at
      from public.payments payment join public.payment_attempts attempt on attempt.payment_id=payment.id
      where payment.purpose='order' and payment.ref_id=purchase.id and payment.status='paid'
        and payment.user_id=purchase.user_id and payment.amount=purchase.total
        and attempt.purpose='order' and attempt.ref_id=purchase.id and attempt.state='approved'
        and attempt.amount=payment.amount and attempt.provider=payment.provider and attempt.user_id=purchase.user_id
    ) approval on true
    left join lateral(select sum(component.regional_fee) regional_fee,sum(component.shipping_coupon_discount) coupon_discount
      from private.shipping_charge_components component where component.shipment_id=s.id and component.order_id=purchase.id) shipping on true
    where s.id=any(p_ids)
  );
end $$;
revoke all on function public.admin_delivery_list_export_lines(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_delivery_list_export_lines(uuid[]) to authenticated;
select private.register_operator_rpc_contract('public.admin_delivery_list_export_lines(uuid[])'::regprocedure,'sales.manage','read',false);

notify pgrst,'reload schema';
commit;
