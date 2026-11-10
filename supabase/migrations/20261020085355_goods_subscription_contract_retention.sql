-- Retain consent evidence without shipping addresses, free-form item inputs,
-- billing identities, ciphertext, or provider secrets. Existing RPC shape stays v1.
create function private.subscription_retention_display(p_display jsonb,p_recorded_at timestamptz) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('calculationVersion',p_display->'calculationVersion','currency',p_display->'currency',
  'totals',jsonb_build_object('subtotal',p_display#>'{totals,subtotal}','volumeDiscountTotal',p_display#>'{totals,volumeDiscountTotal}',
   'netGoodsTotal',p_display#>'{totals,netGoodsTotal}','couponDiscountTotal',p_display#>'{totals,couponDiscountTotal}',
   'storeCreditTotal',p_display#>'{totals,storeCreditTotal}','prepaidShippingTotal',p_display#>'{totals,prepaidShippingTotal}',
   'collectShippingTotal',p_display#>'{totals,collectShippingTotal}','onlineTotal',p_display#>'{totals,onlineTotal}','customerTotal',p_display#>'{totals,customerTotal}'),
  'lines',coalesce((select jsonb_agg(jsonb_build_object('goodId',line->'goodId','variantId',line->'variantId','qty',line->'qty',
    'regularUnitPrice',line->'regularUnitPrice','unitPrice',line->'unitPrice','volumeUnitDiscount',line->'volumeUnitDiscount',
    'subtotal',line->'subtotal','volumeDiscountTotal',line->'volumeDiscountTotal','netSubtotal',line->'netSubtotal',
    'couponDiscount',line->'couponDiscount','storeCreditDiscount',line->'storeCreditDiscount','paidGoodsTotal',line->'paidGoodsTotal','volumePolicyId',line->'volumePolicyId') order by ordinal)
    from jsonb_array_elements(p_display->'lines') with ordinality selected(line,ordinal)),'[]'),
  'shipping',coalesce((select jsonb_agg(jsonb_build_object('originId',shipping->'originId','prepaidFee',shipping->'prepaidFee',
    'collectFee',shipping->'collectFee','fullFee',shipping->'fullFee','components',coalesce((select jsonb_agg(jsonb_build_object(
     'goodId',component->'goodId','paymentMode',component->'paymentMode','baseFee',component->'baseFee','regionalFee',component->'regionalFee',
     'totalFee',component->'totalFee','deliveryPolicyId',component->'deliveryPolicyId') order by component->>'goodId')
     from jsonb_array_elements(shipping->'components') component),'[]'),
    -- The public collector copy may contain contact/free text. Retain its hash
    -- and matching immutable business contract versions, never that copy itself.
    'collectorTermsHash',case when shipping->'collector' is not null and shipping->'collector'<>'null'::jsonb
      then encode(sha256(convert_to((shipping->'collector')::text,'UTF8')),'hex') end,
    'matchingCollectContractVersions',coalesce((select jsonb_agg(contract.id order by contract.created_at,contract.id)
      from private.shipping_collect_contract_versions contract where contract.origin_id::text=shipping->>'originId'
       and contract.created_at<=p_recorded_at and contract.status='active'
       and jsonb_build_object('name',contract.contract_values->>'collectorName','method',contract.contract_values->>'collectionMethod',
        'refundContact',contract.contract_values->>'refundContact','instructions',contract.contract_values->>'customerInstructions')=shipping->'collector'),'[]')) order by ordinal)
    from jsonb_array_elements(p_display->'shipping') with ordinality selected(shipping,ordinal)),'[]'));
$$;

create or replace function private.goods_subscription_account_retention(p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',1,'subscriptions',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'state',p.state,
  'createdAt',p.created_at,'consentedAt',p.consented_at,'canceledAt',p.canceled_at,'currentTermsId',p.current_terms_id,
  'terms',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'createdAt',t.created_at,'policyTermsVersion',t.policy_terms_version,
    'renewalTermsHash',t.renewal_terms_hash,'schedule',jsonb_build_object('unit',t.schedule->'unit','interval',t.schedule->'interval',
     'anchorDate',t.schedule->'anchorDate','time',t.schedule->'time','monthEnd',t.schedule->'monthEnd'),
    'selection',coalesce((select jsonb_agg(jsonb_build_object('goodId',line->'goodId','variantId',line->'variantId',
      'qty',line->'qty','inputRevision',line->'inputRevision') order by ordinal)
      from jsonb_array_elements(t.selection) with ordinality selected(line,ordinal)),'[]'),
    'firstAmounts',private.subscription_retention_display(t.first_display,t.created_at),
    'renewalAmounts',private.subscription_retention_display(t.renewal_display,t.created_at)) order by t.created_at,t.id)
    from private.goods_subscription_terms t where t.plan_id=p.id and exists(select 1 from private.goods_subscription_cycles c where c.plan_id=p.id and c.terms_id=t.id)),'[]'),
  'operations',coalesce((select jsonb_agg(jsonb_build_object('id',operation.operation_id,'command',operation.command,
    'recordedAt',operation.created_at,'requestHash',operation.request_hash,'revision',operation.receipt->'revision','state',operation.receipt->'state',
    'cycleId',cycle.id,'termsId',cycle.terms_id,'orderId',cycle.order_id) order by operation.created_at,operation.operation_id)
    from private.goods_subscription_operations operation left join private.goods_subscription_cycles cycle on cycle.plan_id=p.id and cycle.id::text=operation.receipt->>'cycleId'
    where operation.plan_id=p.id),'[]'),
  'cycles',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'number',c.cycle_number,'slot',c.schedule_slot,'termsId',c.terms_id,'state',c.state,
    'orderId',c.order_id,'amount',o.total,'scheduledAt',c.scheduled_at,'settledAt',c.settled_at) order by c.cycle_number)
    from private.goods_subscription_cycles c left join public.orders o on o.id=c.order_id where c.plan_id=p.id),'[]')) order by p.created_at,p.id)
   from private.goods_subscription_plans p where p.owner_id=p_actor and p.state<>'draft' and p.consented_at is not null),'[]'));
$$;

revoke all on function private.subscription_retention_display(jsonb,timestamptz) from public,anon,authenticated,service_role;
revoke all on function private.goods_subscription_account_retention(uuid) from public,anon,authenticated,service_role;
grant execute on function private.subscription_retention_display(jsonb,timestamptz) to postgres;
grant execute on function private.goods_subscription_account_retention(uuid) to postgres;
select private.register_operator_internal_contract('private.subscription_retention_display(jsonb,timestamptz)'::regprocedure);
select private.register_operator_internal_contract('private.goods_subscription_account_retention(uuid)'::regprocedure);
notify pgrst,'reload schema';
