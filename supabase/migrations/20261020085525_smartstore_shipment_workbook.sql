begin;

-- Keep the existing export's ready/cancellation/preorder/production/whole-pack
-- checks and CAS versions. The extra fields come from order snapshots and the
-- immutable price ledger, never from today's catalog prices.
create function public.admin_smartstore_shipment_export(p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_operator_capability('sales.manage',false);
  result:=public.admin_shipment_export(p_ids);
  if exists(
    select 1 from jsonb_array_elements(result->'shipments') shipment
    where jsonb_array_length(shipment->'lines')<>(select count(*) from public.order_shipment_items where shipment_id=(shipment->>'id')::uuid)
  ) or exists(
    select 1 from public.order_shipment_items link join public.order_items item on item.id=link.order_item_id
    where link.shipment_id=any(p_ids) and link.qty<>item.qty
  ) then raise check_violation using message='shipment_item_export_mismatch';end if;
  if exists(
    select 1 from public.order_shipment_items link join public.order_items item on item.id=link.order_item_id
    join public.orders purchase on purchase.id=item.order_id
    left join private.order_price_allocations allocation on allocation.order_item_id=item.id and allocation.order_id=purchase.id
    where link.shipment_id=any(p_ids) and purchase.calculation_version=2 and allocation.order_item_id is null
  ) then raise check_violation using message='shipment_price_allocation_missing';end if;

  return jsonb_set(result,'{shipments}',(
    select jsonb_agg(shipment.value||jsonb_build_object('lines',(
      select jsonb_agg(line.value||jsonb_build_object('smartstore',jsonb_build_object(
        'itemId',item.id,'goodId',item.good_id,'goodType',item.good_type_snapshot,
        'buyerName',coalesce(profile.nickname,''),'buyerId',purchase.user_id,'buyerPhone','',
        'address1',coalesce(address.value->>'address1',''),'address2',coalesce(address.value->>'address2',''),
        'orderedAt',purchase.created_at,'paidAt',approval.approved_at,'confirmedAt',purchase.confirmed_at,
        'expectedShipDate',delivery.expected_ship_date,'shippedAt',delivery.shipped_at,'exportedAt',delivery.exported_at,
        'paymentMethod',purchase.payment_method,'productPrice',null,'optionPrice',null,
        'itemTotal',case when allocation.order_item_id is not null then allocation.paid_goods_total
          when purchase.calculation_version=1 and purchase.discount_total=0 and purchase.store_credit_total=0 and purchase.volume_discount_total=0
            then item.unit_price::bigint*item.qty else null end,
        'itemDiscount',discount.value,'sellerDiscount',discount.value,
        'regionalShippingFee',shipping.regional_fee,'shippingDiscount',shipping.coupon_discount
      )) order by line.ordinality)
      from jsonb_array_elements(shipment.value->'lines') with ordinality line(value,ordinality)
      join lateral(
        select original.*,row_number() over(order by original.id) as line_number
        from public.order_shipment_items link join public.order_items original on original.id=link.order_item_id
        where link.shipment_id=delivery.id
      ) item on item.line_number=line.ordinality
      left join private.order_price_allocations allocation on allocation.order_item_id=item.id and allocation.order_id=purchase.id
      cross join lateral(select case when item.regular_unit_price_snapshot>=item.unit_price then
        case when allocation.order_item_id is not null then
          (item.regular_unit_price_snapshot-item.unit_price)::bigint*item.qty+allocation.volume_discount+allocation.coupon_discount+allocation.store_credit_discount
        when purchase.calculation_version=1 and purchase.discount_total=0 and purchase.store_credit_total=0 and purchase.volume_discount_total=0 then
          (item.regular_unit_price_snapshot-item.unit_price)::bigint*item.qty else null end
        else null end as value) discount
    )) order by shipment.ordinality)
    from jsonb_array_elements(result->'shipments') with ordinality shipment(value,ordinality)
    join public.order_shipments delivery on delivery.id=(shipment.value->>'id')::uuid
    join public.orders purchase on purchase.id=delivery.order_id
    left join public.profiles profile on profile.id=purchase.user_id
    cross join lateral(select private.operational_order_address(purchase.id) as value) address
    left join lateral(
      select min(coalesce(
        (select min(e.approved_at) from private.payment_provider_evidence e where e.payment_attempt_id=attempt.id),
        (select confirmation.confirmed_at from public.bank_transfer_confirmations confirmation
          where confirmation.attempt_id=attempt.id and confirmation.order_id=purchase.id and attempt.provider='bank_transfer')
      )) as approved_at
      from public.payments payment join public.payment_attempts attempt on attempt.payment_id=payment.id
      where payment.purpose='order' and payment.ref_id=purchase.id and payment.status='paid'
        and payment.user_id=purchase.user_id and payment.amount=purchase.total
        and attempt.purpose='order' and attempt.ref_id=purchase.id and attempt.state='approved'
        and attempt.amount=payment.amount and attempt.provider=payment.provider and attempt.user_id=purchase.user_id
    ) approval on true
    left join lateral(
      select sum(component.regional_fee) as regional_fee,sum(component.shipping_coupon_discount) as coupon_discount
      from private.shipping_charge_components component where component.shipment_id=delivery.id and component.order_id=purchase.id
    ) shipping on true
  ));
end $$;

-- The reply sheet identifies an order item, not an order or a shipment. Resolve
-- that exact UUID through the allocation table; never guess by an ID suffix.
create function public.admin_import_item_tracking_batch(target_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  input jsonb; normalized jsonb:='[]'; delegated jsonb:='[]'; results jsonb:='[]';
  outcomes jsonb:='{}'; group_errors jsonb:='{}'; completed jsonb; outcome jsonb;
  reference_value text; item_key uuid; shipment_key uuid; order_key uuid;
  carrier_value text; tracking_value text; row_error text; group_error text; batch_error text;
  grouped record; seen uuid[]:='{}';
begin
  perform private.require_operator_capability('sales.manage',false);
  if jsonb_typeof(target_rows) is distinct from 'array' then raise invalid_parameter_value using message='invalid_tracking_batch';end if;
  if jsonb_array_length(target_rows) not between 1 and 1000 then raise invalid_parameter_value using message='invalid_tracking_batch';end if;

  for input in select value from jsonb_array_elements(target_rows) loop
    reference_value:=null;item_key:=null;shipment_key:=null;order_key:=null;
    carrier_value:=null;tracking_value:=null;row_error:=null;
    begin
      if jsonb_typeof(input) is distinct from 'object' then raise invalid_parameter_value using message='invalid_tracking_row';end if;
      if jsonb_typeof(input->'reference') is distinct from 'string' then raise invalid_parameter_value using message='invalid_item_order_reference';end if;
      reference_value:=btrim(input->>'reference');
      if reference_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise invalid_parameter_value using message='invalid_item_order_reference';end if;
      item_key:=reference_value::uuid;
      select link.shipment_id,link.order_id into shipment_key,order_key from public.order_shipment_items link where link.order_item_id=item_key;
      if shipment_key is null then raise no_data_found using message='shipment_item_not_found';end if;
      -- Resolve before the remaining validation so one malformed item row blocks
      -- every sibling in its shipment, including a valid row earlier in the file.
      if exists(select 1 from jsonb_object_keys(input) key where key not in('line','reference','carrier','trackingNumber'))
        or jsonb_typeof(input->'line') is distinct from 'number' or (input->>'line') !~ '^[0-9]+$'
        or (input->>'line')::numeric not between 1 and 2147483647
        or jsonb_typeof(input->'carrier') is distinct from 'string'
        or jsonb_typeof(input->'trackingNumber') is distinct from 'string' then
        raise invalid_parameter_value using message='invalid_tracking_row';end if;
      carrier_value:=btrim(input->>'carrier');
      tracking_value:=upper(regexp_replace(btrim(input->>'trackingNumber'),'[[:space:]-]','','g'));
      if carrier_value='' or char_length(carrier_value)>100 or tracking_value !~ '^[A-Z0-9]{8,30}$' then
        raise check_violation using message='invalid_tracking_input';end if;
    exception when others then row_error:=sqlerrm;
    end;
    normalized:=normalized||jsonb_build_array(jsonb_build_object('line',input->'line','reference',reference_value,
      'shipmentId',shipment_key,'orderId',order_key,'carrier',carrier_value,'trackingNumber',tracking_value,'error',row_error));
  end loop;

  for grouped in select value->>'shipmentId' as id,jsonb_agg(value) as rows
    from jsonb_array_elements(normalized) where value->>'shipmentId' is not null
    group by value->>'shipmentId' order by value->>'shipmentId'
  loop
    select value->>'error' into group_error from jsonb_array_elements(grouped.rows) where value->>'error' is not null limit 1;
    if group_error is null and (
      (select count(distinct value->>'carrier') from jsonb_array_elements(grouped.rows))<>1
      or (select count(distinct value->>'trackingNumber') from jsonb_array_elements(grouped.rows))<>1
    ) then group_error:='conflicting_shipment_tracking';end if;
    group_errors:=group_errors||jsonb_build_object(grouped.id,group_error);
    -- Invalid groups remain in the existing whole-pack preflight with empty
    -- assignment data. Omitting them could dispatch a pack via a valid sibling.
    delegated:=delegated||jsonb_build_array(jsonb_build_object('line',1,'reference',grouped.id,
      'carrier',case when group_error is null then grouped.rows->0->>'carrier' else '' end,
      'trackingNumber',case when group_error is null then grouped.rows->0->>'trackingNumber' else '' end));
  end loop;
  if jsonb_array_length(delegated)>0 then
    begin
      completed:=public.admin_import_shipment_tracking_batch(delegated);
      if jsonb_typeof(completed) is distinct from 'array' or jsonb_array_length(completed)<>jsonb_array_length(delegated) then
        raise check_violation using message='tracking_batch_result_missing';end if;
      select jsonb_object_agg(value->>'reference',value) into outcomes from jsonb_array_elements(completed);
    exception when others then
      batch_error:=sqlerrm;
      select jsonb_object_agg(value->>'reference',jsonb_build_object('ok',false,'error',batch_error)) into outcomes from jsonb_array_elements(delegated);
    end;
  end if;

  for input in select value from jsonb_array_elements(normalized) loop
    shipment_key:=(input->>'shipmentId')::uuid;
    if shipment_key is null then outcome:=jsonb_build_object('ok',false,'error',input->>'error');
    elsif group_errors->>shipment_key::text is not null then
      outcome:=jsonb_build_object('ok',false,'error',group_errors->>shipment_key::text);
    else outcome:=outcomes->shipment_key::text;end if;
    if outcome->>'ok'='true' then
      if shipment_key=any(seen) then outcome:=outcome||jsonb_build_object('duplicate',true,'dispatched',false);
      else seen:=array_append(seen,shipment_key);outcome:=outcome||jsonb_build_object('duplicate',false);end if;
    end if;
    results:=results||jsonb_build_array(outcome||jsonb_build_object('line',input->'line','reference',input->>'reference',
      'shipmentId',shipment_key,'orderId',input->'orderId'));
  end loop;
  return results;
end $$;

revoke all on function public.admin_smartstore_shipment_export(uuid[]),public.admin_import_item_tracking_batch(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_smartstore_shipment_export(uuid[]),public.admin_import_item_tracking_batch(jsonb) to authenticated;
select private.register_operator_rpc_contract('public.admin_smartstore_shipment_export(uuid[])'::regprocedure,'sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_import_item_tracking_batch(jsonb)'::regprocedure,'sales.manage','write',false);
notify pgrst,'reload schema';
commit;
