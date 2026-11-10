begin;

CREATE OR REPLACE FUNCTION private.reserve_order_store_credits_explicit(p_order_id uuid, p_user_id uuid, p_subtotal bigint, p_coupon_discount bigint, p_shipping_fee bigint, p_requested_amount bigint, p_at timestamp with time zone)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare policy private.store_credit_policy;balance jsonb;outstanding bigint;take bigint;lot private.store_credit_lots;begin
 if p_at is null or not isfinite(p_at) or p_requested_amount is null or p_requested_amount not between 0 and 999999999999 then
  raise invalid_parameter_value using message='store_credit_amount_invalid';end if;
 perform 1 from public.orders where id=p_order_id and user_id=p_user_id and status='pending';
 if not found then raise check_violation using message='store_credit_order_invalid';end if;
 select * into policy from private.store_credit_policy where singleton for share;
 update public.orders set store_credit_policy_snapshot=case when policy.enabled then private.store_credit_policy_for_member(p_user_id)-'evidence' else null end where id=p_order_id;
 if p_requested_amount=0 then return 0;end if;
 if not policy.enabled then raise check_violation using message='store_credit_disabled';end if;
 if p_requested_amount<policy.min_use or p_requested_amount>policy.max_use or p_requested_amount>greatest(0,p_subtotal-p_coupon_discount)
  or p_subtotal::numeric+p_shipping_fee-p_coupon_discount-p_requested_amount<1000 then raise check_violation using message='store_credit_amount_invalid';end if;
 perform private.expire_store_credit_lots(p_user_id,p_at);balance:=private.store_credit_balance(p_user_id);
 if (balance->>'debt')::bigint>0 then raise check_violation using message='store_credit_debt';end if;
 if (balance->>'available')::bigint<p_requested_amount then raise check_violation using message='store_credit_insufficient';end if;
 outstanding:=p_requested_amount;
 for lot in select * from private.store_credit_lots where user_id=p_user_id and available_amount>0 and revoked_at is null and expires_at>p_at order by expires_at,id for update loop
  take:=least(outstanding,lot.available_amount);
  update private.store_credit_lots set available_amount=available_amount-take,reserved_amount=reserved_amount+take where id=lot.id;
  insert into private.store_credit_allocations(order_id,user_id,lot_id,amount,original_expires_at,restore_grace_days)
   values(p_order_id,p_user_id,lot.id,take,lot.expires_at,policy.restore_grace_days);
  insert into public.store_credit_ledger(user_id,kind,amount,available_delta,reserved_delta,order_id,lot_id,expires_at)
   values(p_user_id,'reserve',-take,-take,take,p_order_id,lot.id,lot.expires_at);
  outstanding:=outstanding-take;exit when outstanding=0;
 end loop;
 if outstanding<>0 then raise check_violation using message='store_credit_insufficient';end if;return p_requested_amount;
end $function$;


CREATE OR REPLACE FUNCTION private.calculate_goods_transaction_locked(p_actor uuid, p_selection jsonb, p_address jsonb, p_delivery_choices jsonb, p_user_coupon_id uuid, p_store_credit_amount bigint, p_at timestamp with time zone, p_line_ids jsonb, p_order_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare entry jsonb;index integer:=0;good public.goods;owner_row public.goods;variant public.goods_variants;price record;supply record;good_qty numeric;variant_qty numeric;
 custom_inputs jsonb;quantity_error text;priced_lines jsonb:='[]';shipping_lines jsonb:='[]';internal_lines jsonb:='[]';display_lines jsonb:='[]';policies jsonb;volume jsonb;
 discounted jsonb;line jsonb;shipping jsonb;coupon_eval record;coupon_data jsonb;coupon_lines jsonb;coupon_weights jsonb;credit_weights jsonb;
 coupon_allocations jsonb;credit_allocations jsonb;policy private.store_credit_policy;balance jsonb;available numeric;maximum numeric:=0;
 subtotal numeric;volume_total numeric;net numeric;coupon numeric:=0;credit numeric:=p_store_credit_amount;online numeric;customer numeric;
 next_change timestamptz;boundary timestamptz;card_allowed boolean:=true;bank_allowed boolean:=true;selected_policy jsonb;line_coupon numeric;line_credit numeric;
begin
 if p_at is null or not isfinite(p_at) or p_store_credit_amount is null or p_store_credit_amount not between 0 and 999999999999
  or jsonb_typeof(p_line_ids) is distinct from 'array' or jsonb_array_length(p_line_ids)<>jsonb_array_length(p_selection)
  or exists(select 1 from jsonb_array_elements(p_line_ids) id where jsonb_typeof(id) is distinct from 'string'
   or id#>>'{}'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  or (select count(distinct id) from jsonb_array_elements(p_line_ids) id)<>jsonb_array_length(p_line_ids) then
  raise invalid_parameter_value using message='invalid_transaction_calculation';end if;
 begin perform private.assert_goods_purchase_allowed(p_actor);
 exception when check_violation then
  if sqlerrm<>'goods_purchase_restricted' then raise;end if;
  return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','purchase_restricted','goodId',null)));
 end;
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'goodId',v.good_id,'revision',v.revision,'status',v.status,'terms',v.terms,'draftValues',v.draft_values)),'[]')
  into policies from private.goods_transaction_configs c join private.goods_volume_discount_versions v on v.id=c.volume_version_id
  where c.good_id in(select private.goods_aggregation_owner(value->>'goodId') from jsonb_array_elements(p_selection));
 for entry in select value from jsonb_array_elements(p_selection) loop
  select g.* into good from public.goods g join public.ips ip on ip.id=g.ip_id
   join public.goods owner_good on owner_good.id=private.goods_aggregation_owner(g.id)
   join public.fulfillment_origins origin on origin.id=owner_good.origin_id and origin.is_active
   where g.id=entry->>'goodId' and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
    and (g.sale_starts_at is null or g.sale_starts_at<=p_at) and (g.sale_ends_at is null or g.sale_ends_at>p_at)
    and ip.archived_at is null and ip.published_at is not null;
  if not found then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','goods_unavailable','goodId',entry->>'goodId')));end if;
  select * into owner_row from public.goods where id=private.goods_aggregation_owner(good.id);
  good.origin_id:=owner_row.origin_id;good.shipping_fee_type:=owner_row.shipping_fee_type;good.individual_fee:=owner_row.individual_fee;
  good.order_quantity_limit_enabled:=owner_row.order_quantity_limit_enabled;good.min_order_qty:=owner_row.min_order_qty;good.max_order_qty:=owner_row.max_order_qty;
  good.member_purchase_limit_enabled:=owner_row.member_purchase_limit_enabled;good.member_lifetime_qty_limit:=owner_row.member_lifetime_qty_limit;
  select * into variant from public.goods_variants where id=(entry->>'variantId')::uuid and good_id=good.id and archived_at is null;
  if not found then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','goods_unavailable','goodId',good.id)));end if;
  select sum((value->>'qty')::numeric) into good_qty from jsonb_array_elements(p_selection) where private.goods_aggregation_owner(value->>'goodId')=owner_row.id;
  quantity_error:=private.check_goods_purchase_quantity(good,p_actor,good_qty::bigint,true);
  if quantity_error is not null then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','purchase_limit','goodId',good.id)));end if;
  begin custom_inputs:=private.resolve_goods_custom_inputs(good.id,(entry->>'inputRevision')::integer,entry->'inputValues');
  exception when check_violation or invalid_parameter_value then
   return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','invalid_selection','goodId',good.id)));
  end;
  select * into supply from private.resolve_goods_variant_supply(variant.id,p_at);
  select sum((value->>'qty')::numeric) into variant_qty from jsonb_array_elements(p_selection) where value->>'variantId'=variant.id::text;
  if good.stock='soldout' or supply.available_qty<variant_qty or (supply.mode='preorder' and supply.state<>'open') then
   return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','goods_unavailable','goodId',good.id)));end if;
  select * into price from private.resolve_goods_variant_price(variant.id,p_at);
  priced_lines:=priced_lines||jsonb_build_array(jsonb_build_object('lineId',p_line_ids->>index,'goodId',owner_row.id,'regularUnitPrice',price.regular_price,
   'unitPrice',price.effective_price,'qty',entry->'qty'));
  shipping_lines:=shipping_lines||jsonb_build_array(jsonb_build_object('origin_id',good.origin_id,'good_id',good.id,'qty',entry->'qty',
   'unit_price',price.effective_price,'fee_type',good.shipping_fee_type,'individual_fee',good.individual_fee));
  select value into selected_policy from jsonb_array_elements(policies) where value->>'goodId'=owner_row.id;
  internal_lines:=internal_lines||jsonb_build_array(entry||jsonb_build_object('lineId',p_line_ids->>index,
   'goodName',good.name,'goodType',good.type,'goodIpId',good.ip_id,'originId',good.origin_id,'variantName',variant.name,
   'customInputsSnapshot',custom_inputs,'regularUnitPrice',price.regular_price,'unitPrice',price.effective_price,'pricePeriodId',price.price_period_id,
   'priceStartsAt',price.starts_at,'priceEndsAt',price.ends_at,'volumePolicySnapshot',selected_policy,
   'supplySource',supply.mode,'preorderPolicyId',supply.policy_id,'preorderPolicyRevision',supply.policy_revision,
   'preorderStartsAt',supply.starts_at,'preorderEndsAt',supply.ends_at,'preorderExpectedShipDate',supply.expected_ship_date,
   'salesPolicySnapshot',jsonb_build_object('version',2,'allowCardPayment',good.allow_card_payment,'allowBankTransfer',good.allow_bank_transfer,
    'orderQuantityLimitEnabled',good.order_quantity_limit_enabled,'minOrderQty',good.min_order_qty,'maxOrderQty',good.max_order_qty,
    'memberPurchaseLimitEnabled',good.member_purchase_limit_enabled,'memberLifetimeQtyLimit',good.member_lifetime_qty_limit,
    'saleStartsAt',good.sale_starts_at,'saleEndsAt',good.sale_ends_at,'salePeriodRevision',good.sale_period_revision)));
  select min(moment) into boundary from (
   select schedule.starts_at moment from private.goods_variant_price_periods schedule where schedule.variant_id=variant.id and schedule.state='active' and schedule.starts_at>p_at
   union all select schedule.ends_at from private.goods_variant_price_periods schedule where schedule.variant_id=variant.id and schedule.state='active' and schedule.ends_at>p_at
   union all select good.sale_starts_at where good.sale_starts_at>p_at union all select good.sale_ends_at where good.sale_ends_at>p_at
   union all select supply.next_change_at where supply.next_change_at>p_at) moments;
  next_change:=least(next_change,boundary);card_allowed:=card_allowed and good.allow_card_payment;bank_allowed:=bank_allowed and good.allow_bank_transfer;
  index:=index+1;
 end loop;
 if not card_allowed and not bank_allowed then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','payment_method_unavailable','goodId',null)));end if;
 volume:=private.calculate_goods_volume_discounts(priced_lines,policies,p_at);
 -- Restore actual selected IDs before coupon targeting, display and immutable order snapshots.
 select jsonb_agg(v.value||jsonb_build_object('goodId',i.value->>'goodId') order by v.ordinality) into discounted
  from jsonb_array_elements(volume->'lines') with ordinality v(value,ordinality)
  join jsonb_array_elements(internal_lines) i(value) on i.value->>'lineId'=v.value->>'lineId';
 volume:=jsonb_set(volume,'{lines}',discounted);
 subtotal:=(volume->>'subtotal')::numeric;volume_total:=(volume->>'volumeDiscountTotal')::numeric;net:=subtotal-volume_total;
 next_change:=least(next_change,(volume->>'nextChangeAt')::timestamptz);
 shipping:=private.calculate_goods_transaction_shipping(shipping_lines,jsonb_build_object('postalCode',p_address->>'postalCode','address1',p_address->>'address1'),p_delivery_choices,p_at);
 if shipping->>'state'='blocked' then return shipping;end if;
 next_change:=least(next_change,(shipping->>'nextChangeAt')::timestamptz);
 select jsonb_agg(jsonb_build_object('good_id',value->>'goodId','subtotal',(value->>'netSubtotal')::bigint)) into coupon_lines from jsonb_array_elements(volume->'lines');
 if p_user_coupon_id is not null then
  select * into coupon_eval from private.evaluate_coupon_target_lines_at(p_user_coupon_id,p_actor,coupon_lines,p_order_id,p_at);
  if coupon_eval.o_reason is not null then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','coupon_unavailable','goodId',null)));end if;
  coupon:=least(coupon_eval.o_discount,greatest(0,net+(shipping->>'prepaidFee')::numeric-1000));
  if coupon<=0 then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','coupon_unavailable','goodId',null)));end if;
  coupon_data:=jsonb_build_object('userCouponId',p_user_coupon_id,'couponCode',coupon_eval.o_coupon_code,'eligibleSubtotal',coupon_eval.o_eligible_subtotal,
   'discount',coupon,'termsSnapshot',coupon_eval.o_terms_snapshot||jsonb_build_object('calculationVersion',2,'eligibleNetSubtotal',coupon_eval.o_eligible_subtotal));
  select min(moment) into boundary from public.user_coupons held join public.coupons definition on definition.code=held.coupon_code
   cross join lateral(values(held.usable_from),(held.expires_at),(definition.starts_at),(definition.ends_at)) moments(moment)
   where held.id=p_user_coupon_id and moment>p_at;
  next_change:=least(next_change,boundary);
 end if;
 select jsonb_agg(jsonb_build_object('id',value->>'lineId','weight',case when p_user_coupon_id is null then 0
   when coupon_data#>>'{termsSnapshot,goodsScope}'='all' or ((coupon_data#>'{termsSnapshot,targetGoodIds}') ? (value->>'goodId')
    or (coupon_data#>'{termsSnapshot,targetGoodIds}') ? private.goods_aggregation_owner(value->>'goodId'))
   then (value->>'netSubtotal')::numeric else 0 end)) into coupon_weights from jsonb_array_elements(volume->'lines');
 coupon_allocations:=private.allocate_transaction_amount(coupon,coupon_weights);
 select * into policy from private.store_credit_policy where singleton;
 perform private.expire_store_credit_lots(p_actor,p_at);balance:=private.store_credit_balance(p_actor);available:=(balance->>'available')::numeric;
 if policy.enabled and (balance->>'debt')::numeric=0 then
  maximum:=least(policy.max_use,available,greatest(0,net-coupon),greatest(0,net+(shipping->>'prepaidFee')::numeric-coupon-1000));end if;
 if credit>0 and (credit<policy.min_use or credit>maximum) then
  return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','store_credit_unavailable','goodId',null)));end if;
 if credit>0 then
  select min(expires_at) into boundary from private.store_credit_lots where user_id=p_actor and available_amount>0 and expires_at>p_at and revoked_at is null;
  next_change:=least(next_change,boundary);
 end if;
 online:=net+(shipping->>'prepaidFee')::numeric-coupon-credit;customer:=online+(shipping->>'collectFee')::numeric;
 if online<1000 then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','below_minimum_payment','goodId',null)));end if;
 if customer>9007199254740991 or online>999999999999 then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','amount_overflow','goodId',null)));end if;
 select jsonb_agg(jsonb_build_object('id',value->>'lineId','weight',(value->>'netSubtotal')::numeric-(coupon_allocations->>(value->>'lineId'))::numeric))
  into credit_weights from jsonb_array_elements(volume->'lines');
 credit_allocations:=private.allocate_transaction_amount(credit,credit_weights);
 index:=0;
 for discounted in select value from jsonb_array_elements(volume->'lines') loop
  line:=internal_lines->index;line_coupon:=(coupon_allocations->>(line->>'lineId'))::numeric;line_credit:=(credit_allocations->>(line->>'lineId'))::numeric;
  line:=line||jsonb_build_object('subtotal',(discounted->>'unitPrice')::numeric*(discounted->>'qty')::numeric,
   'volumeUnitDiscount',discounted->'volumeUnitDiscount','volumeDiscountTotal',discounted->'volumeDiscountTotal','netSubtotal',discounted->'netSubtotal',
   'couponDiscount',line_coupon,'storeCreditDiscount',line_credit,'paidGoodsTotal',(discounted->>'netSubtotal')::numeric-line_coupon-line_credit,
   'volumePolicyId',discounted->'policyId');
  internal_lines:=jsonb_set(internal_lines,array[index::text],line);
  display_lines:=display_lines||jsonb_build_array(jsonb_build_object('lineId',line->'lineId','goodId',line->'goodId','variantId',line->'variantId','qty',line->'qty',
   'regularUnitPrice',line->'regularUnitPrice','unitPrice',line->'unitPrice','volumeUnitDiscount',line->'volumeUnitDiscount','subtotal',line->'subtotal',
   'volumeDiscountTotal',line->'volumeDiscountTotal','netSubtotal',line->'netSubtotal','couponDiscount',line->'couponDiscount',
   'storeCreditDiscount',line->'storeCreditDiscount','paidGoodsTotal',line->'paidGoodsTotal','volumePolicyId',line->'volumePolicyId'));
  index:=index+1;
 end loop;
 return jsonb_build_object('state','calculated','display',jsonb_build_object('calculationVersion',2,'currency','KRW','calculatedAt',p_at,'nextChangeAt',next_change,
  'lines',display_lines,'shipping',shipping->'displayGroups','totals',jsonb_build_object('subtotal',subtotal,'volumeDiscountTotal',volume_total,'netGoodsTotal',net,
   'couponDiscountTotal',coupon,'storeCreditTotal',credit,'prepaidShippingTotal',shipping->'prepaidFee','collectShippingTotal',shipping->'collectFee','onlineTotal',online,'customerTotal',customer),
  'userCouponId',p_user_coupon_id,'storeCreditMaximum',maximum,'paymentMethods',jsonb_build_object('card',card_allowed,'bankTransfer',bank_allowed)),
  'lines',internal_lines,'shippingRaw',shipping->'rawGroups','coupon',coupon_data,'creditPolicy',case when policy.enabled then private.store_credit_policy_for_member(p_actor)-'evidence' else null end);
exception when numeric_value_out_of_range then
 return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','amount_overflow','goodId',null)));
end $function$;


CREATE OR REPLACE FUNCTION private.place_goods_transaction(p_actor uuid, p_source jsonb, p_selection jsonb, p_address jsonb, p_quote_id uuid, p_checkout_key uuid, p_payment_method order_payment_method)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
<<transaction_place>>
declare selection jsonb;address jsonb;existing private.order_goods_transactions;quoted private.goods_transaction_quotes;calculation jsonb;
 order_id uuid;at_time timestamptz;expires timestamptz;request_salt uuid:=gen_random_uuid();receipt jsonb;totals jsonb;line jsonb;coupon jsonb;
 raw_group jsonb;component jsonb;shipment_id uuid;shipping_snapshot jsonb;reserved_credit bigint;item_id uuid;delivery_terms jsonb;
begin
 perform private.lock_goods_transaction_source(p_actor,p_source);
 if p_quote_id is null or p_checkout_key is null or p_payment_method is null then raise invalid_parameter_value using message='invalid_transaction_place';end if;
 selection:=private.normalize_goods_transaction_selection(p_selection);address:=private.normalize_goods_transaction_address(p_address);
 -- Durable success replay is intentionally before quote expiry/PII cleanup,
 -- current cart, current source lifecycle, and present-day price calculations.
 select * into existing from private.order_goods_transactions where actor_id=p_actor and checkout_key=p_checkout_key;
 if found then
  if existing.quote_id<>p_quote_id or existing.source_kind<>p_source->>'kind' or existing.source_id<>(p_source->>'id')::uuid
   or existing.source_revision<>p_source->>'revision' or existing.request_digest is distinct from
    private.goods_transaction_request_digest(existing.request_salt,p_source,selection,address,p_quote_id,p_payment_method) then
   raise sqlstate 'PT409' using message='checkout_key_conflict';end if;
  return existing.order_id;
 end if;
 if exists(select 1 from public.orders where user_id=p_actor and checkout_key=p_checkout_key) then raise sqlstate 'PT409' using message='checkout_key_conflict';end if;
 perform private.assert_goods_transaction_actor(p_actor);
 select * into quoted from private.goods_transaction_quotes where id=p_quote_id and actor_id=p_actor for update;
 if not found or quoted.source is distinct from p_source or quoted.selection is distinct from selection or quoted.address is distinct from address then
  raise sqlstate 'PT409' using message='transaction_quote_changed';end if;
 if quoted.order_id is not null then raise sqlstate 'PT409' using message='transaction_quote_already_used';end if;
 if quoted.expires_at<=clock_timestamp() then raise sqlstate 'PT409' using message='transaction_quote_expired';end if;
 if p_source->>'kind'='gift' and to_regprocedure('private.bind_goods_transaction_delivery_snapshot(uuid,uuid,jsonb,jsonb,jsonb)') is null then
  raise check_violation using message='gift_delivery_owner_not_ready';end if;
 expires:=case when p_payment_method='bank_transfer' then clock_timestamp()+interval '24 hours' else clock_timestamp()+interval '15 minutes' end;
 insert into public.orders(user_id,status,total,shipping_fee,address,expires_at,checkout_key,payment_method,calculation_version)
  values(p_actor,'pending',0,0,case when p_source->>'kind'='gift' then null else address end,expires,p_checkout_key,p_payment_method,2) returning id into order_id;
 perform private.assert_first_purchase_checkout(p_actor,order_id);
 perform private.lock_goods_transaction_catalog(p_actor,selection,quoted.user_coupon_id);
 perform private.assert_goods_transaction_runtime();
 at_time:=clock_timestamp();
 if quoted.expires_at<=at_time then raise sqlstate 'PT409' using message='transaction_quote_expired';end if;
 calculation:=private.calculate_goods_transaction_locked(p_actor,selection,address,quoted.delivery_choices,quoted.user_coupon_id,quoted.store_credit_amount,at_time,quoted.line_ids,order_id);
 if calculation->>'state'<>'calculated' or private.goods_transaction_calculation_contract(calculation) is distinct from private.goods_transaction_calculation_contract(quoted.calculation) then
  raise sqlstate 'PT409' using message='transaction_quote_changed';end if;
 if not (calculation#>>array['display','paymentMethods',case when p_payment_method='bank_transfer' then 'bankTransfer' else 'card' end])::boolean then
  raise check_violation using message='transaction_payment_method_unavailable';end if;
 totals:=calculation#>'{display,totals}';receipt:=jsonb_build_object('orderId',order_id,'quoteId',p_quote_id,'display',calculation->'display');
 insert into private.order_goods_transactions(order_id,actor_id,source_kind,source_id,source_revision,quote_id,checkout_key,request_digest,request_salt,original_receipt)
  values(order_id,p_actor,p_source->>'kind',(p_source->>'id')::uuid,p_source->>'revision',p_quote_id,p_checkout_key,
   private.goods_transaction_request_digest(request_salt,p_source,selection,address,p_quote_id,p_payment_method),request_salt,receipt);
 update private.goods_transaction_quotes set order_id=transaction_place.order_id where id=p_quote_id;
 if p_source->>'kind'='gift' then
  perform private.bind_goods_transaction_delivery_snapshot(order_id,p_actor,p_source,address,calculation->'shippingRaw');
 end if;
 for line in select value from jsonb_array_elements(calculation->'lines') loop
  if line->>'supplySource'='stock' then perform private.change_goods_variant_stock(line->>'goodId',(line->>'variantId')::uuid,-(line->>'qty')::bigint);end if;
  item_id:=(line->>'lineId')::uuid;
  insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,
   regular_unit_price_snapshot,price_period_id,price_evaluated_at,sales_policy_snapshot,supply_source,preorder_policy_id,preorder_expected_ship_date,
   preorder_snapshot,custom_inputs_snapshot,volume_unit_discount,volume_discount_total,volume_discount_snapshot)
  values(item_id,order_id,line->>'goodId',(line->>'variantId')::uuid,(line->>'qty')::integer,(line->>'unitPrice')::integer,
   line->>'goodName',line->>'goodType',line->>'goodIpId',(line->>'regularUnitPrice')::integer,(line->>'pricePeriodId')::uuid,at_time,line->'salesPolicySnapshot',
   line->>'supplySource',(line->>'preorderPolicyId')::uuid,(line->>'preorderExpectedShipDate')::date,
   case when line->>'supplySource'='preorder' then jsonb_build_object('version',1,'policyId',line->'preorderPolicyId','policyRevision',line->'preorderPolicyRevision',
    'startsAt',line->'preorderStartsAt','endsAt',line->'preorderEndsAt','expectedShipDate',line->'preorderExpectedShipDate') end,
   nullif(line->'customInputsSnapshot','null'::jsonb),(line->>'volumeUnitDiscount')::bigint,(line->>'volumeDiscountTotal')::bigint,
   jsonb_build_object('calculationVersion',2,'policy',line->'volumePolicySnapshot','applied',line->>'volumePolicyId' is not null));
  if line->>'supplySource'='preorder' then perform private.reserve_goods_preorder_item(item_id,at_time);end if;
  insert into private.order_price_allocations(order_item_id,order_id,calculation_version,subtotal,volume_discount,net_subtotal,coupon_discount,store_credit_discount,paid_goods_total)
   values(item_id,order_id,2,(line->>'subtotal')::bigint,(line->>'volumeDiscountTotal')::bigint,(line->>'netSubtotal')::bigint,
    (line->>'couponDiscount')::bigint,(line->>'storeCreditDiscount')::bigint,(line->>'paidGoodsTotal')::bigint);
 end loop;
 coupon:=calculation->'coupon';
 if quoted.user_coupon_id is not null then
  perform private.reserve_first_purchase_coupon(order_id,p_actor,coupon->>'couponCode');
  update public.user_coupons set status='used',used_at=at_time,used_order_id=order_id where id=quoted.user_coupon_id and user_id=p_actor and status<>'used';
  if not found then raise check_violation using message='coupon_already_used';end if;
  insert into public.coupon_redemptions(user_coupon_id,coupon_code,user_id,order_id,discount_amount,eligible_subtotal,terms_snapshot)
   values(quoted.user_coupon_id,coupon->>'couponCode',p_actor,order_id,(coupon->>'discount')::bigint,(coupon->>'eligibleSubtotal')::bigint,coupon->'termsSnapshot');
 end if;
 reserved_credit:=private.reserve_order_store_credits_explicit(order_id,p_actor,(totals->>'netGoodsTotal')::bigint,(totals->>'couponDiscountTotal')::bigint,
  (totals->>'prepaidShippingTotal')::bigint,quoted.store_credit_amount,at_time);
 if reserved_credit<>(totals->>'storeCreditTotal')::bigint then raise check_violation using message='transaction_credit_snapshot_mismatch';end if;
 shipping_snapshot:=private.goods_transaction_public_shipping(p_source->>'kind',calculation->'shippingRaw');
 update public.orders set total=(totals->>'onlineTotal')::bigint,shipping_fee=(totals->>'prepaidShippingTotal')::bigint,
  store_credit_policy_snapshot=nullif(calculation->'creditPolicy','null'::jsonb),
  volume_discount_total=(totals->>'volumeDiscountTotal')::bigint,discount_total=(totals->>'couponDiscountTotal')::bigint,
  store_credit_total=reserved_credit,shipping_collect_total=(totals->>'collectShippingTotal')::bigint,shipping_fee_breakdown=shipping_snapshot where id=order_id;
 perform private.create_order_shipments(order_id);
 for raw_group in select value from jsonb_array_elements(calculation->'shippingRaw') loop
  update public.order_shipments set shipping_collect_fee=(raw_group->>'collectFee')::bigint
   where order_shipments.order_id=transaction_place.order_id and origin_id=(raw_group->>'originId')::uuid returning id into shipment_id;
  for component in select value from jsonb_array_elements(raw_group->'components') loop
   select value into delivery_terms from jsonb_array_elements(raw_group->'deliveryTerms') where value->>'goodId'=component->>'goodId';
   insert into private.shipping_charge_components(order_id,shipment_id,good_id,origin_id,calculation_version,payment_mode,base_fee,regional_fee,total_fee,
    delivery_policy_id,collect_contract_id,terms_snapshot)
   values(order_id,shipment_id,component->>'goodId',(raw_group->>'originId')::uuid,2,component->>'paymentMode',(component->>'baseFee')::bigint,
    (component->>'regionalFee')::bigint,(component->>'totalFee')::bigint,(component->>'deliveryPolicyId')::uuid,(raw_group->>'collectContractId')::uuid,
    jsonb_build_object('deliveryTerms',delivery_terms,'regionalPolicyId',raw_group->'policyId','regionalPolicyVersion',raw_group->'policyVersion',
     'regionStatus',raw_group->'regionStatus','collectContract',raw_group->'collectContractSnapshot'));
  end loop;
  if (raw_group->>'collectFee')::bigint>0 then
   insert into private.shipping_collect_obligations(shipment_id,order_id,amount,contract_snapshot)
    values(shipment_id,order_id,(raw_group->>'collectFee')::bigint,raw_group->'collectContractSnapshot');
   insert into private.shipping_collect_events(operation_id,shipment_id,event,amount,evidence)
    values(gen_random_uuid(),shipment_id,'planned',(raw_group->>'collectFee')::bigint,jsonb_build_object('orderId',order_id,'quoteId',p_quote_id));
  end if;
 end loop;
 if not private.goods_order_snapshot_matches(order_id,(totals->>'onlineTotal')::bigint,(totals->>'prepaidShippingTotal')::bigint) then
  raise check_violation using message='transaction_order_snapshot_mismatch';end if;
 if quoted.expires_at<=clock_timestamp() then raise sqlstate 'PT409' using message='transaction_quote_expired';end if;
 perform private.assert_order_goods_sale_period(order_id);
 if p_payment_method='bank_transfer' then
  perform public.prepare_goods_payment_attempt(p_actor,order_id,'bank_transfer');
  insert into public.notifications(user_id,type,title,body,link_path,source_type,source_id,dedupe_key)
   values(p_actor,'order_bank_transfer_pending','입금 안내를 확인해주세요',format('%s원을 기한 안에 입금해주세요. 입금자명 끝에 주문코드 %s를 붙이면 확인이 빨라집니다.',
    to_char((totals->>'onlineTotal')::bigint,'FM999,999,999,999,999,999'),private.bank_transfer_deposit_code(order_id)),
    '/checkout/'||order_id::text,'order',order_id::text,'order:bank_transfer_pending:'||order_id::text) on conflict(user_id,dedupe_key) do nothing;
 end if;
 return order_id;
end $function$;


commit;
