-- Product contract: exact sequential goods discounts followed by one prepaid transport discount.
begin;
create function private.calculate_goods_transaction_combined_locked(p_actor uuid,p_selection jsonb,p_address jsonb,p_delivery_choices jsonb,p_user_coupon_ids uuid[],p_store_credit_amount bigint,p_at timestamptz,p_line_ids jsonb,p_order_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;display jsonb;totals jsonb;lines jsonb;shipping jsonb;raw_shipping jsonb;applied jsonb:='[]';visible jsonb:='[]';
 policy private.coupon_combination_policy;credit_policy private.store_credit_policy;balance jsonb;held public.user_coupons;definition public.coupons;ev record;
 selected uuid;entry jsonb;component jsonb;weights jsonb;allocations jsonb;coupon_lines jsonb;credit_allocations jsonb;
 group_index integer;component_index integer;line_index integer;position integer:=0;goods_count integer:=0;shipping_count integer:=0;
 net bigint;goods_discount bigint:=0;shipping_discount bigint:=0;amount bigint;eligible bigint;maximum bigint:=0;online bigint;prepaid bigint;collect bigint;
 part bigint;eligible_group boolean;next_change timestamptz;boundary timestamptz;terms jsonb;
 blocked jsonb:=jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','coupon_unavailable','goodId',null)));
begin
 if p_user_coupon_ids is null or cardinality(p_user_coupon_ids)>6 or (cardinality(p_user_coupon_ids)>0 and (array_ndims(p_user_coupon_ids)<>1 or array_lower(p_user_coupon_ids,1)<>1)) or array_position(p_user_coupon_ids,null) is not null
  or (select count(distinct id) from unnest(p_user_coupon_ids) id)<>cardinality(p_user_coupon_ids) then raise invalid_parameter_value using message='invalid_coupon_selection';end if;
 select * into policy from private.coupon_combination_policy where singleton;
 if cardinality(p_user_coupon_ids)>1 and not policy.stacking_enabled then return blocked;end if;
 for selected in select unnest(p_user_coupon_ids) loop
  select * into held from public.user_coupons where id=selected and user_id=p_actor;
  if not found then return blocked;end if;
  select * into definition from public.coupons where code=held.coupon_code;
  if not found or (cardinality(p_user_coupon_ids)>1 and not definition.stackable) then return blocked;end if;
  if definition.benefit_kind='goods' then goods_count:=goods_count+1;if shipping_count>0 then return blocked;end if;
  else shipping_count:=shipping_count+1;end if;
 end loop;
 if goods_count>policy.max_goods_coupons or shipping_count>1 or (shipping_count>0 and not policy.shipping_enabled) then return blocked;end if;
 result:=private.calculate_goods_transaction_locked(p_actor,p_selection,p_address,p_delivery_choices,null,0,p_at,p_line_ids,p_order_id);
 if result->>'state'<>'calculated' then return result;end if;
 display:=result->'display';totals:=display->'totals';lines:=result->'lines';shipping:=display->'shipping';raw_shipping:=result->'shippingRaw';
 net:=(totals->>'netGoodsTotal')::bigint;prepaid:=(totals->>'prepaidShippingTotal')::bigint;collect:=(totals->>'collectShippingTotal')::bigint;next_change:=(display->>'nextChangeAt')::timestamptz;
 select jsonb_agg(jsonb_build_object('good_id',v->>'goodId','subtotal',(v->>'netSubtotal')::bigint)) into coupon_lines from jsonb_array_elements(lines) v;
 for selected in select unnest(p_user_coupon_ids) loop
  position:=position+1;select * into held from public.user_coupons where id=selected;select * into definition from public.coupons where code=held.coupon_code;
  select * into ev from private.evaluate_coupon_target_lines_at(selected,p_actor,coupon_lines,p_order_id,p_at);
  if ev.o_reason is not null then return blocked;end if;
  weights:='[]';eligible:=0;
  if definition.benefit_kind='goods' then
   for entry in select value from jsonb_array_elements(lines) loop
    part:=case when definition.goods_scope='all' or entry->>'goodId'=any(definition.target_good_ids) or private.goods_aggregation_owner(entry->>'goodId')=any(definition.target_good_ids)
     then (entry->>'netSubtotal')::bigint-(entry->>'couponDiscount')::bigint else 0 end;
    weights:=weights||jsonb_build_array(jsonb_build_object('id',entry->>'lineId','weight',part));eligible:=eligible+part;
   end loop;
  else
   -- A targeted shipping coupon applies to prepaid transport components of any fulfillment group containing an eligible good.
   for entry in select value from jsonb_array_elements(shipping) loop
    eligible_group:=definition.goods_scope='all' or exists(select 1 from jsonb_array_elements(entry->'components') c where c->>'goodId'=any(definition.target_good_ids) or private.goods_aggregation_owner(c->>'goodId')=any(definition.target_good_ids));
    for component in select value from jsonb_array_elements(entry->'components') loop
     part:=case when eligible_group and component->>'paymentMode'='prepaid' then (component->>'baseFee')::bigint+(component->>'regionalFee')::bigint else 0 end;
     weights:=weights||jsonb_build_array(jsonb_build_object('id',component->>'goodId','weight',part));eligible:=eligible+part;
    end loop;
   end loop;
  end if;
  amount:=least(case when definition.discount_type='fixed' then definition.discount_value::bigint
   else least((eligible*definition.discount_value::bigint)/100,coalesce(definition.max_discount_amount::bigint,eligible)) end,
   eligible,greatest(0,net+prepaid-goods_discount-shipping_discount-1000));
  if amount<=0 then return blocked;end if;
  allocations:=private.allocate_transaction_amount(amount,weights);
  if definition.benefit_kind='goods' then
   line_index:=0;
   for entry in select value from jsonb_array_elements(lines) loop
    part:=(allocations->>(entry->>'lineId'))::bigint;
    lines:=jsonb_set(lines,array[line_index::text],entry||jsonb_build_object('couponDiscount',(entry->>'couponDiscount')::bigint+part));line_index:=line_index+1;
   end loop;
   goods_discount:=goods_discount+amount;
  else
   group_index:=0;
   for entry in select value from jsonb_array_elements(shipping) loop
    component_index:=0;part:=0;
    for component in select value from jsonb_array_elements(entry->'components') loop
     shipping:=jsonb_set(shipping,array[group_index::text,'components',component_index::text],component||jsonb_build_object('shippingCouponDiscount',(allocations->>(component->>'goodId'))::bigint,'totalFee',(component->>'totalFee')::bigint-(allocations->>(component->>'goodId'))::bigint));
     raw_shipping:=jsonb_set(raw_shipping,array[group_index::text,'components',component_index::text],(raw_shipping#>array[group_index::text,'components',component_index::text])||jsonb_build_object('shippingCouponDiscount',(allocations->>(component->>'goodId'))::bigint,'totalFee',(component->>'totalFee')::bigint-(allocations->>(component->>'goodId'))::bigint));
     part:=part+(allocations->>(component->>'goodId'))::bigint;component_index:=component_index+1;
    end loop;
    shipping:=jsonb_set(shipping,array[group_index::text],(shipping->group_index)||jsonb_build_object('prepaidFee',(entry->>'prepaidFee')::bigint-part,'fullFee',(entry->>'fullFee')::bigint-part));
    raw_shipping:=jsonb_set(raw_shipping,array[group_index::text],(raw_shipping->group_index)||jsonb_build_object('totalFee',(entry->>'prepaidFee')::bigint-part,'prepaidFee',(entry->>'prepaidFee')::bigint-part,'fullFee',(entry->>'fullFee')::bigint-part));
    group_index:=group_index+1;
   end loop;
   shipping_discount:=amount;
  end if;
  terms:=ev.o_terms_snapshot||jsonb_build_object('calculationVersion',2,'benefitKind',definition.benefit_kind,'stackable',definition.stackable,'combinationPolicy',public.get_coupon_combination_policy(),
   'applicationIndex',position,'minimumSubtotalBasis','after_volume_before_coupons','eligibleRemainingAmount',eligible,'shippingScope','eligible_fulfillment_groups_prepaid_transport','allocations',allocations);
  applied:=applied||jsonb_build_array(jsonb_build_object('userCouponId',selected,'couponCode',definition.code,'eligibleSubtotal',ev.o_eligible_subtotal,'discount',amount,'termsSnapshot',terms,'benefitKind',definition.benefit_kind,'applicationIndex',position));
  visible:=visible||jsonb_build_array(jsonb_build_object('userCouponId',selected,'code',definition.code,'name',definition.name,'benefitKind',definition.benefit_kind,'discount',amount,'applicationIndex',position));
  select min(moment) into boundary from (values(held.usable_from),(held.expires_at),(definition.starts_at),(definition.ends_at)) moments(moment) where moment>p_at;
  next_change:=least(next_change,boundary);
 end loop;
 select * into credit_policy from private.store_credit_policy where singleton;balance:=private.store_credit_balance(p_actor);
 if credit_policy.enabled and (balance->>'debt')::bigint=0 then maximum:=least(credit_policy.max_use,(balance->>'available')::bigint,net-goods_discount,net+prepaid-goods_discount-shipping_discount-1000);end if;
 if p_store_credit_amount is null or p_store_credit_amount<0 or p_store_credit_amount>999999999999 then raise invalid_parameter_value using message='invalid_transaction_calculation';end if;
 if p_store_credit_amount>0 and (p_store_credit_amount<credit_policy.min_use or p_store_credit_amount>maximum) then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','store_credit_unavailable','goodId',null)));end if;
 if p_store_credit_amount>0 then select min(expires_at) into boundary from private.store_credit_lots where user_id=p_actor and available_amount>0 and expires_at>p_at and revoked_at is null;next_change:=least(next_change,boundary);end if;
 select jsonb_agg(jsonb_build_object('id',v->>'lineId','weight',(v->>'netSubtotal')::bigint-(v->>'couponDiscount')::bigint)) into weights from jsonb_array_elements(lines) v;
 credit_allocations:=private.allocate_transaction_amount(p_store_credit_amount,weights);line_index:=0;
 for entry in select value from jsonb_array_elements(lines) loop
  part:=(credit_allocations->>(entry->>'lineId'))::bigint;
  lines:=jsonb_set(lines,array[line_index::text],entry||jsonb_build_object('storeCreditDiscount',part,'paidGoodsTotal',(entry->>'netSubtotal')::bigint-(entry->>'couponDiscount')::bigint-part));
  display:=jsonb_set(display,array['lines',line_index::text],(display#>array['lines',line_index::text])||jsonb_build_object('couponDiscount',(entry->>'couponDiscount')::bigint,'storeCreditDiscount',part,'paidGoodsTotal',(entry->>'netSubtotal')::bigint-(entry->>'couponDiscount')::bigint-part));line_index:=line_index+1;
 end loop;
 online:=net+prepaid-goods_discount-shipping_discount-p_store_credit_amount;
 display:=display||jsonb_build_object('shipping',shipping,'nextChangeAt',next_change,'userCouponId',p_user_coupon_ids[1],'coupons',visible,'storeCreditMaximum',maximum,
  'totals',totals||jsonb_build_object('couponDiscountTotal',goods_discount,'shippingCouponDiscountTotal',shipping_discount,'storeCreditTotal',p_store_credit_amount,'prepaidShippingTotal',prepaid-shipping_discount,'onlineTotal',online,'customerTotal',online+collect));
 return result||jsonb_build_object('display',display,'lines',lines,'shippingRaw',raw_shipping,'coupon',applied->0,'coupons',applied);
end $$;

-- COMBINATION ADAPTERS
CREATE OR REPLACE FUNCTION private.lock_goods_transaction_combined_catalog(p_actor uuid, p_selection jsonb, p_user_coupon_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 -- All mutable catalog parents precede all variants and supply policies.
 perform 1 from public.goods g where g.id in(select value->>'goodId' from jsonb_array_elements(p_selection) union select private.goods_aggregation_owner(value->>'goodId') from jsonb_array_elements(p_selection)) order by g.id for update;
 perform 1 from public.goods_variants v where v.id in(select (value->>'variantId')::uuid from jsonb_array_elements(p_selection)) order by v.good_id,v.id for update;
 perform 1 from public.ips ip where ip.id in(select g.ip_id from public.goods g where g.id in(select value->>'goodId' from jsonb_array_elements(p_selection) union select private.goods_aggregation_owner(value->>'goodId') from jsonb_array_elements(p_selection))) order by ip.id for share;
 perform 1 from private.goods_preorder_policies p where p.id in(select v.preorder_policy_id from public.goods_variants v
  where v.id in(select (value->>'variantId')::uuid from jsonb_array_elements(p_selection))) order by p.id for update;
 perform 1 from public.fulfillment_origins o where o.id in(select g.origin_id from public.goods g
  where g.id in(select value->>'goodId' from jsonb_array_elements(p_selection) union select private.goods_aggregation_owner(value->>'goodId') from jsonb_array_elements(p_selection))) order by o.id for share;
 perform 1 from public.shipping_carriers c where c.code in(select o.default_carrier from public.fulfillment_origins o join public.goods g on g.origin_id=o.id
  where g.id in(select value->>'goodId' from jsonb_array_elements(p_selection) union select private.goods_aggregation_owner(value->>'goodId') from jsonb_array_elements(p_selection))) order by c.code for share;
 perform 1 from private.shipping_charge_group_assignments a where a.owner_good_id in(select private.goods_aggregation_owner(value->>'goodId') from jsonb_array_elements(p_selection)) order by a.owner_good_id for share;
 perform 1 from private.shipping_charge_groups g where g.id in(select a.group_id from private.shipping_charge_group_assignments a where a.owner_good_id in(select private.goods_aggregation_owner(value->>'goodId') from jsonb_array_elements(p_selection))) order by g.id for share;
 if cardinality(p_user_coupon_ids)>0 then
  perform 1 from public.user_coupons h where h.id=any(p_user_coupon_ids) order by h.id for update;
  perform 1 from public.coupons c join public.user_coupons h on h.coupon_code=c.code where h.id=any(p_user_coupon_ids) order by c.code for share of c;
 end if;
 perform 1 from private.coupon_combination_policy where singleton for share;
 perform 1 from private.store_credit_policy where singleton for share;
 perform private.lock_store_credit_account(p_actor);
 perform 1 from private.store_credit_lots where user_id=p_actor order by expires_at,id for update;
end $function$
;
CREATE OR REPLACE FUNCTION private.quote_goods_transaction_combined(p_actor uuid, p_source jsonb, p_selection jsonb, p_address jsonb, p_delivery_choices jsonb, p_user_coupon_ids uuid[], p_store_credit_amount bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare selection jsonb;address jsonb;choices jsonb;line_ids jsonb;at_time timestamptz;expires timestamptz;calculation jsonb;quote_id uuid;
begin
 perform private.lock_goods_transaction_source(p_actor,p_source);
 perform private.assert_goods_transaction_actor(p_actor);
 selection:=private.normalize_goods_transaction_selection(p_selection);
 if p_address is null or p_address='null'::jsonb then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','address_required','goodId',null)));end if;
 address:=private.normalize_goods_transaction_address(p_address);choices:=private.normalize_goods_transaction_choices(p_delivery_choices,selection);
 perform private.lock_goods_transaction_combined_catalog(p_actor,selection,p_user_coupon_ids);
 perform private.assert_goods_transaction_runtime();
 at_time:=clock_timestamp();
 -- Delete expired actor quote PII while the actor lock serializes issuance.
 delete from private.goods_transaction_quotes where actor_id=p_actor and expires_at<=at_time;
 if (select count(*) from private.goods_transaction_quotes where actor_id=p_actor and expires_at>at_time and order_id is null)>=10 then
  delete from private.goods_transaction_quotes where id=(select id from private.goods_transaction_quotes where actor_id=p_actor and expires_at>at_time and order_id is null order by created_at,id limit 1);
 end if;
 select jsonb_agg(gen_random_uuid() order by position) into line_ids from jsonb_array_elements(selection) with ordinality selected(value,position);
 calculation:=private.calculate_goods_transaction_combined_locked(p_actor,selection,address,choices,p_user_coupon_ids,p_store_credit_amount,at_time,line_ids);
 if calculation->>'state'='blocked' then return calculation;end if;
 expires:=least(at_time+interval '10 minutes',(calculation#>>'{display,nextChangeAt}')::timestamptz);
 if expires<=clock_timestamp() then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','source_changed','goodId',null)));end if;
 if octet_length(calculation::text)>2097152 then raise program_limit_exceeded using message='transaction_quote_too_large';end if;
 insert into private.goods_transaction_quotes(actor_id,source,selection,address,delivery_choices,user_coupon_id,user_coupon_ids,store_credit_amount,line_ids,calculation,created_at,expires_at)
  values(p_actor,p_source,selection,address,choices,p_user_coupon_ids[1],p_user_coupon_ids,p_store_credit_amount,line_ids,calculation,at_time,expires) returning id into quote_id;
 return jsonb_build_object('state','quoted','quoteId',quote_id,'expiresAt',expires,'display',calculation->'display');
end $function$
;
create function public.quote_cart_goods_transaction_combined(p_user_id uuid,p_expected_cart jsonb,p_address jsonb,p_delivery_choices jsonb,p_user_coupon_ids uuid[],p_store_credit_amount bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare selection jsonb;source jsonb;begin
 selection:=private.cart_goods_transaction_expected_selection(p_expected_cart);source:=private.goods_cart_transaction_source(p_user_id,selection);
 perform private.lock_goods_transaction_source(p_user_id,source);perform private.assert_cart_goods_transaction_selection(p_user_id,selection);
 return private.quote_goods_transaction_combined(p_user_id,source,selection,p_address,p_delivery_choices,p_user_coupon_ids,p_store_credit_amount);
end $$;
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
  values(p_actor,'pending',0,0,case when p_source->>'kind'='gift' or address->>'kind'='none' then null else address end,expires,p_checkout_key,p_payment_method,2) returning id into order_id;
 perform private.assert_first_purchase_checkout(p_actor,order_id);
 if quoted.user_coupon_ids is null then perform private.lock_goods_transaction_catalog(p_actor,selection,quoted.user_coupon_id);
 else perform private.lock_goods_transaction_combined_catalog(p_actor,selection,quoted.user_coupon_ids);end if;
 perform private.assert_goods_transaction_runtime();
 at_time:=clock_timestamp();
 if quoted.expires_at<=at_time then raise sqlstate 'PT409' using message='transaction_quote_expired';end if;
 if quoted.user_coupon_ids is null then
 calculation:=private.calculate_goods_transaction_locked(p_actor,selection,address,quoted.delivery_choices,quoted.user_coupon_id,quoted.store_credit_amount,at_time,quoted.line_ids,order_id);
 else calculation:=private.calculate_goods_transaction_combined_locked(p_actor,selection,address,quoted.delivery_choices,quoted.user_coupon_ids,quoted.store_credit_amount,at_time,quoted.line_ids,order_id);end if;
 if calculation->>'state'<>'calculated' or private.goods_transaction_calculation_contract(calculation) is distinct from private.goods_transaction_calculation_contract(quoted.calculation) then
  raise sqlstate 'PT409' using message='transaction_quote_changed';end if;
 if not (calculation#>>array['display','paymentMethods',case when p_payment_method='bank_transfer' then 'bankTransfer' else 'card' end])::boolean then
  raise check_violation using message='transaction_payment_method_unavailable';end if;
 if p_source->>'kind'='gift' and exists(select 1 from jsonb_array_elements(calculation->'lines')l where l#>>'{fulfillmentTermsSnapshot,mode}'='digital') then raise check_violation using message='digital_gift_unavailable';end if;
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
   preorder_snapshot,custom_inputs_snapshot,volume_unit_discount,volume_discount_total,volume_discount_snapshot,production_terms_snapshot,fulfillment_terms_snapshot)
  values(item_id,order_id,line->>'goodId',(line->>'variantId')::uuid,(line->>'qty')::integer,(line->>'unitPrice')::integer,
   line->>'goodName',line->>'goodType',line->>'goodIpId',(line->>'regularUnitPrice')::integer,(line->>'pricePeriodId')::uuid,at_time,line->'salesPolicySnapshot',
   line->>'supplySource',(line->>'preorderPolicyId')::uuid,(line->>'preorderExpectedShipDate')::date,
   case when line->>'supplySource'='preorder' then jsonb_build_object('version',1,'policyId',line->'preorderPolicyId','policyRevision',line->'preorderPolicyRevision',
    'startsAt',line->'preorderStartsAt','endsAt',line->'preorderEndsAt','expectedShipDate',line->'preorderExpectedShipDate') end,
   nullif(line->'customInputsSnapshot','null'::jsonb),(line->>'volumeUnitDiscount')::bigint,(line->>'volumeDiscountTotal')::bigint,
   jsonb_build_object('calculationVersion',2,'policy',line->'volumePolicySnapshot','applied',line->>'volumePolicyId' is not null),nullif(line->'productionTermsSnapshot','null'::jsonb),nullif(line->'fulfillmentTermsSnapshot','null'::jsonb));
  if line->>'supplySource'='preorder' then perform private.reserve_goods_preorder_item(item_id,at_time);end if;
  insert into private.order_price_allocations(order_item_id,order_id,calculation_version,subtotal,volume_discount,net_subtotal,coupon_discount,store_credit_discount,paid_goods_total)
   values(item_id,order_id,2,(line->>'subtotal')::bigint,(line->>'volumeDiscountTotal')::bigint,(line->>'netSubtotal')::bigint,
    (line->>'couponDiscount')::bigint,(line->>'storeCreditDiscount')::bigint,(line->>'paidGoodsTotal')::bigint);
 end loop;
 for coupon in select value from jsonb_array_elements(case when calculation ? 'coupons' then calculation->'coupons' when quoted.user_coupon_id is not null then jsonb_build_array(calculation->'coupon') else '[]'::jsonb end) loop
  perform private.reserve_first_purchase_coupon(order_id,p_actor,coupon->>'couponCode');
  update public.user_coupons set status='used',used_at=at_time,used_order_id=order_id where id=(coupon->>'userCouponId')::uuid and user_id=p_actor and status<>'used';
  if not found then raise check_violation using message='coupon_already_used';end if;
  insert into public.coupon_redemptions(user_coupon_id,coupon_code,user_id,order_id,discount_amount,eligible_subtotal,terms_snapshot,benefit_kind,application_index)
   values((coupon->>'userCouponId')::uuid,coupon->>'couponCode',p_actor,order_id,(coupon->>'discount')::bigint,(coupon->>'eligibleSubtotal')::bigint,coupon->'termsSnapshot',coalesce(coupon->>'benefitKind','goods'),coalesce((coupon->>'applicationIndex')::integer,1));
 end loop;
 reserved_credit:=private.reserve_order_store_credits_explicit(order_id,p_actor,(totals->>'netGoodsTotal')::bigint,(totals->>'couponDiscountTotal')::bigint,
  (totals->>'prepaidShippingTotal')::bigint,quoted.store_credit_amount,at_time);
 if reserved_credit<>(totals->>'storeCreditTotal')::bigint then raise check_violation using message='transaction_credit_snapshot_mismatch';end if;
 shipping_snapshot:=private.goods_transaction_public_shipping(p_source->>'kind',calculation->'shippingRaw');
 update public.orders set total=(totals->>'onlineTotal')::bigint,shipping_fee=(totals->>'prepaidShippingTotal')::bigint,
  store_credit_policy_snapshot=nullif(calculation->'creditPolicy','null'::jsonb),
  shipping_coupon_discount_total=coalesce((totals->>'shippingCouponDiscountTotal')::bigint,0),volume_discount_total=(totals->>'volumeDiscountTotal')::bigint,discount_total=(totals->>'couponDiscountTotal')::bigint,
  store_credit_total=reserved_credit,shipping_collect_total=(totals->>'collectShippingTotal')::bigint,shipping_fee_breakdown=shipping_snapshot where id=order_id;
 perform private.create_order_shipments(order_id);
 for raw_group in select value from jsonb_array_elements(calculation->'shippingRaw') loop
  update public.order_shipments set shipping_collect_fee=(raw_group->>'collectFee')::bigint
   where order_shipments.order_id=transaction_place.order_id and origin_id=(raw_group->>'originId')::uuid and fulfillment_partition=coalesce(raw_group->>'deliveryMethod','parcel') returning id into shipment_id;
  for component in select value from jsonb_array_elements(raw_group->'components') loop
   select value into delivery_terms from jsonb_array_elements(raw_group->'deliveryTerms') where value->>'goodId'=component->>'goodId';
   insert into private.shipping_charge_components(order_id,shipment_id,good_id,origin_id,calculation_version,payment_mode,base_fee,regional_fee,total_fee,installation_fee,shipping_coupon_discount,
    delivery_policy_id,collect_contract_id,terms_snapshot)
   values(order_id,shipment_id,component->>'goodId',(raw_group->>'originId')::uuid,2,component->>'paymentMode',(component->>'baseFee')::bigint,
    (component->>'regionalFee')::bigint,(component->>'totalFee')::bigint,coalesce((component->>'installationFee')::bigint,0),coalesce((component->>'shippingCouponDiscount')::bigint,0),(component->>'deliveryPolicyId')::uuid,(raw_group->>'collectContractId')::uuid,
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
end $function$
;
CREATE OR REPLACE FUNCTION public.place_cart_goods_transaction(p_user_id uuid, p_expected_cart jsonb, p_address jsonb, p_quote_id uuid, p_checkout_key uuid, p_payment_method order_payment_method)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare selection jsonb;source jsonb;selected_coupon uuid;quoted_coupon uuid;combined boolean;result uuid;begin
 selection:=private.cart_goods_transaction_expected_selection(p_expected_cart);source:=private.goods_cart_transaction_source(p_user_id,selection);
 perform private.lock_goods_transaction_source(p_user_id,source);
 if exists(select 1 from private.order_goods_transactions where actor_id=p_user_id and checkout_key=p_checkout_key) then
  return private.place_goods_transaction(p_user_id,source,selection,p_address,p_quote_id,p_checkout_key,p_payment_method);end if;
 perform private.assert_cart_goods_transaction_selection(p_user_id,selection);
 select user_coupon_id into selected_coupon from public.cart_coupon_selections where user_id=p_user_id;
 select user_coupon_id,user_coupon_ids is not null into quoted_coupon,combined from private.goods_transaction_quotes where id=p_quote_id and actor_id=p_user_id;
 if found and not combined and selected_coupon is distinct from quoted_coupon then raise sqlstate 'PT409' using message='coupon_snapshot_changed';end if;
 result:=private.place_goods_transaction(p_user_id,source,selection,p_address,p_quote_id,p_checkout_key,p_payment_method);
 -- Only this adapter owns the live cart. Gift/subscription never read it.
 delete from public.cart_items cart where user_id=p_user_id and exists(select 1 from jsonb_array_elements(selection) selected
  where selected->>'goodId'=cart.good_id and (selected->>'variantId')::uuid=cart.variant_id and (selected->>'qty')::integer=cart.qty
   and (selected->>'inputRevision')::integer=cart.input_revision and selected->'inputValues'=cart.input_values);
 delete from public.cart_coupon_selections where user_id=p_user_id and (combined or user_coupon_id=quoted_coupon);
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION private.reserve_first_purchase_coupon(p_order_id uuid, p_user_id uuid, p_coupon_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if (select recipient_segment from public.coupons where code=p_coupon_code)='first_purchase' then
   insert into private.coupon_first_purchase_claims(order_id,user_id,coupon_code) values(p_order_id,p_user_id,p_coupon_code) on conflict(order_id) do nothing;
 end if;
end $function$
;
CREATE OR REPLACE FUNCTION private.goods_transaction_snapshot_matches(p_order_id uuid, p_total bigint, p_shipping_fee bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.orders purchase where purchase.id=p_order_id and purchase.calculation_version=2
  and purchase.total=p_total and purchase.shipping_fee=p_shipping_fee
  and exists(select 1 from private.order_goods_transactions where order_id=purchase.id)
  and (select count(*)>0 and bool_and(item.volume_discount_total=item.qty::numeric*item.volume_unit_discount)
   and sum(item.qty::numeric*item.unit_price)-sum(item.volume_discount_total)+purchase.shipping_fee-purchase.discount_total-purchase.store_credit_total=purchase.total
   and sum(item.volume_discount_total)=purchase.volume_discount_total
   and bool_and(item.supply_source='stock' or exists(select 1 from private.goods_preorder_reservations reservation
    where reservation.order_item_id=item.id and reservation.order_id=item.order_id and reservation.policy_id=item.preorder_policy_id
     and reservation.qty=item.qty and reservation.state in('reserved','allocated')))
   from public.order_items item where item.order_id=purchase.id)
  and not exists(select 1 from public.order_items item left join private.order_price_allocations a on a.order_item_id=item.id
   where item.order_id=purchase.id and (a.order_item_id is null or a.order_id<>purchase.id or a.subtotal<>item.qty::numeric*item.unit_price
    or a.volume_discount<>item.volume_discount_total))
  and (select sum(a.coupon_discount)=purchase.discount_total and sum(a.store_credit_discount)=purchase.store_credit_total
   and sum(a.paid_goods_total)+purchase.shipping_fee=purchase.total from private.order_price_allocations a where a.order_id=purchase.id)
  and (select coalesce(sum(s.shipping_fee),0)=purchase.shipping_fee and coalesce(sum(s.shipping_collect_fee),0)=purchase.shipping_collect_total
   from public.order_shipments s where s.order_id=purchase.id)
  and not exists(select 1 from public.order_shipments s where s.order_id=purchase.id and not exists(
   select 1 from private.shipping_charge_components c where c.shipment_id=s.id group by c.shipment_id
    having sum(case when c.payment_mode='prepaid' then c.total_fee else c.installation_fee end)=s.shipping_fee
     and sum(case when c.payment_mode='collect' then c.total_fee-c.installation_fee else 0 end)=s.shipping_collect_fee))
  and not exists(select 1 from private.shipping_charge_components c join public.order_shipments s on s.id=c.shipment_id
   where c.order_id=purchase.id and (s.order_id<>purchase.id or s.origin_id<>c.origin_id or not exists(
    select 1 from public.order_items item where item.order_id=purchase.id and item.good_id=c.good_id and item.origin_id_snapshot=c.origin_id)))
  and (select coalesce(sum(discount_amount) filter(where benefit_kind='goods'),0)=purchase.discount_total
   and coalesce(sum(discount_amount) filter(where benefit_kind='shipping'),0)=purchase.shipping_coupon_discount_total from public.coupon_redemptions where order_id=purchase.id)
  and (select coalesce(sum(shipping_coupon_discount),0)=purchase.shipping_coupon_discount_total from private.shipping_charge_components where order_id=purchase.id)
  and (select count(*) from private.shipping_charge_components where order_id=purchase.id)=
   (select count(distinct good_id) from public.order_items where order_id=purchase.id));
$function$
;
CREATE OR REPLACE FUNCTION private.collect_settled_export(p_from date, p_to date, p_query text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with selected as materialized (
  select o.* from public.orders o join public.profiles p on p.id=o.user_id
  where o.status='done'
   and (p_from is null or o.created_at>=(p_from::timestamp at time zone 'Asia/Seoul'))
   and (p_to is null or o.created_at<((p_to+1)::timestamp at time zone 'Asia/Seoul'))
   and (p_query is null
    or position(lower(p_query) in lower(o.id::text))>0
    or position(lower(p_query) in lower(coalesce(p.nickname,'')))>0
    or position(lower(p_query) in lower(coalesce(p.email,'')))>0
    or position(lower(p_query) in lower(coalesce(private.operational_order_address(o.id)->>'recipientName','')))>0
    or exists(select 1 from public.order_shipments s where s.order_id=o.id
      and position(nullif(regexp_replace(lower(p_query),'[[:space:]-]','','g'),'') in lower(coalesce(s.tracking_number,'')))>0))
  order by o.created_at desc,o.id desc limit 1001
 )
 select jsonb_build_object('schemaVersion',2,'capturedAt',statement_timestamp(),'orders',coalesce(jsonb_agg(
  jsonb_build_object(
   'id',o.id,'createdAt',o.created_at,'doneAt',o.done_at,'total',o.total,'shippingFee',o.shipping_fee,
   'couponDiscount',o.discount_total,'storeCredits',o.store_credit_total,'shippingCouponDiscount',o.shipping_coupon_discount_total,
   'calculationVersion',o.calculation_version,'volumeDiscount',o.volume_discount_total,'shippingCollectTotal',o.shipping_collect_total,
   'shippingComponents',coalesce((select jsonb_agg(jsonb_build_object('id',component.id,'shipmentId',component.shipment_id,'paymentMode',component.payment_mode,
    'baseFee',component.base_fee,'regionalFee',component.regional_fee,'totalFee',component.total_fee,'installationFee',component.installation_fee,'shippingCouponDiscount',component.shipping_coupon_discount) order by component.id)
    from private.shipping_charge_components component where component.order_id=o.id),'[]'),
   'coupon',(
    select jsonb_build_object('code',r.coupon_code,'discountAmount',r.discount_amount,'eligibleSubtotal',r.eligible_subtotal,'terms',r.terms_snapshot)
    from public.coupon_redemptions r where r.order_id=o.id and r.status='applied' and o.calculation_version=1 order by r.application_index limit 1
   ),
   'coupons',coalesce((select jsonb_agg(jsonb_build_object('code',r.coupon_code,'discountAmount',r.discount_amount,'benefitKind',r.benefit_kind,'applicationIndex',r.application_index) order by r.application_index) from public.coupon_redemptions r where r.order_id=o.id and r.status='applied'),'[]'),
   'payments',coalesce((select jsonb_agg(jsonb_build_object(
    'id',payment.id,'amount',payment.amount,'status',payment.status,'provider',payment.provider,
    'approvedAt',approval.approved_at,
    'timeSource',case when approval.approved_at is null then null when payment.provider='bank_transfer' then 'bank_confirmation' else 'provider_approval' end
   ) order by payment.id)
    from public.payments payment left join lateral (
     select coalesce(
      (select min(e.approved_at) from private.payment_provider_evidence e where e.payment_attempt_id=a.id),
      (select b.confirmed_at from public.bank_transfer_confirmations b where b.attempt_id=a.id and b.order_id=o.id and a.provider='bank_transfer')
     ) as approved_at
     from public.payment_attempts a where a.payment_id=payment.id and a.purpose='order'
      and a.ref_id=o.id and a.state='approved' and a.amount=payment.amount
    ) approval on true
    where payment.purpose='order' and payment.ref_id=o.id and payment.status in('paid','refunded')),'[]'),
   'shipments',coalesce((select jsonb_agg(jsonb_build_object(
    'id',s.id,'trackingNumber',s.tracking_number,'shippingFee',s.shipping_fee,'status',s.status,
    'shippingCollectFee',s.shipping_collect_fee,'collectState',(select obligation.state from private.shipping_collect_obligations obligation where obligation.shipment_id=s.id)
   ) order by s.id) from public.order_shipments s where s.order_id=o.id),'[]'),
   'items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',item.id,'goodId',item.good_id,'variantId',item.variant_id,'goodName',item.good_name_snapshot,'variantName',item.variant_name_snapshot,
    'qty',item.qty,'unitPrice',item.unit_price,'regularUnitPrice',item.regular_unit_price_snapshot,
    'shipmentId',assignment.shipment_id,
    'allocation',(select jsonb_build_object('subtotal',allocation.subtotal,'volumeDiscount',allocation.volume_discount,'netSubtotal',allocation.net_subtotal,
     'couponDiscount',allocation.coupon_discount,'storeCreditDiscount',allocation.store_credit_discount,'paidGoodsTotal',allocation.paid_goods_total)
     from private.order_price_allocations allocation where allocation.order_item_id=item.id and allocation.order_id=o.id),
    'erpCode',identity.erp_code,'erpName',identity.erp_name,'barcode',identity.barcode,'erpCapturedAt',identity.captured_at
   ) order by assignment.shipment_id nulls last,item.id)
    from public.order_items item left join public.order_shipment_items assignment on assignment.order_item_id=item.id and assignment.order_id=o.id
    left join private.order_item_external_identity_snapshots identity on identity.order_item_id=item.id
    where item.order_id=o.id),'[]')
  ) order by o.created_at desc,o.id desc),'[]')) from selected o;
$function$
;
CREATE OR REPLACE FUNCTION private.collect_settled_export_for_date(p_from date, p_to date, p_query text, p_date_field text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with selected as materialized (
  select o.* from public.orders o join public.profiles p on p.id=o.user_id
  where o.status='done'
   and private.admin_sales_order_matches(o,p_from,p_to,p_query,'all',p_date_field,null)
  order by o.created_at desc,o.id desc limit 1001
 )
 select jsonb_build_object('schemaVersion',2,'capturedAt',statement_timestamp(),'orders',coalesce(jsonb_agg(
  jsonb_build_object(
   'id',o.id,'createdAt',o.created_at,'doneAt',o.done_at,'total',o.total,'shippingFee',o.shipping_fee,
   'couponDiscount',o.discount_total,'storeCredits',o.store_credit_total,'shippingCouponDiscount',o.shipping_coupon_discount_total,
   'calculationVersion',o.calculation_version,'volumeDiscount',o.volume_discount_total,'shippingCollectTotal',o.shipping_collect_total,
   'shippingComponents',coalesce((select jsonb_agg(jsonb_build_object('id',component.id,'shipmentId',component.shipment_id,'paymentMode',component.payment_mode,
    'baseFee',component.base_fee,'regionalFee',component.regional_fee,'totalFee',component.total_fee,'installationFee',component.installation_fee,'shippingCouponDiscount',component.shipping_coupon_discount) order by component.id)
    from private.shipping_charge_components component where component.order_id=o.id),'[]'),
   'coupon',(
    select jsonb_build_object('code',r.coupon_code,'discountAmount',r.discount_amount,'eligibleSubtotal',r.eligible_subtotal,'terms',r.terms_snapshot)
    from public.coupon_redemptions r where r.order_id=o.id and r.status='applied' and o.calculation_version=1 order by r.application_index limit 1
   ),
   'coupons',coalesce((select jsonb_agg(jsonb_build_object('code',r.coupon_code,'discountAmount',r.discount_amount,'benefitKind',r.benefit_kind,'applicationIndex',r.application_index) order by r.application_index) from public.coupon_redemptions r where r.order_id=o.id and r.status='applied'),'[]'),
   'payments',coalesce((select jsonb_agg(jsonb_build_object(
    'id',payment.id,'amount',payment.amount,'status',payment.status,'provider',payment.provider,
    'approvedAt',approval.approved_at,
    'timeSource',case when approval.approved_at is null then null when payment.provider='bank_transfer' then 'bank_confirmation' else 'provider_approval' end
   ) order by payment.id)
    from public.payments payment left join lateral (
     select coalesce(
      (select min(e.approved_at) from private.payment_provider_evidence e where e.payment_attempt_id=a.id),
      (select b.confirmed_at from public.bank_transfer_confirmations b where b.attempt_id=a.id and b.order_id=o.id and a.provider='bank_transfer')
     ) as approved_at
     from public.payment_attempts a where a.payment_id=payment.id and a.purpose='order'
      and a.ref_id=o.id and a.state='approved' and a.amount=payment.amount
    ) approval on true
    where payment.purpose='order' and payment.ref_id=o.id and payment.status in('paid','refunded')),'[]'),
   'shipments',coalesce((select jsonb_agg(jsonb_build_object(
    'id',s.id,'trackingNumber',s.tracking_number,'shippingFee',s.shipping_fee,'status',s.status,
    'shippingCollectFee',s.shipping_collect_fee,'collectState',(select obligation.state from private.shipping_collect_obligations obligation where obligation.shipment_id=s.id)
   ) order by s.id) from public.order_shipments s where s.order_id=o.id),'[]'),
   'items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',item.id,'goodId',item.good_id,'variantId',item.variant_id,'goodName',item.good_name_snapshot,'variantName',item.variant_name_snapshot,
    'qty',item.qty,'unitPrice',item.unit_price,'regularUnitPrice',item.regular_unit_price_snapshot,
    'shipmentId',assignment.shipment_id,
    'allocation',(select jsonb_build_object('subtotal',allocation.subtotal,'volumeDiscount',allocation.volume_discount,'netSubtotal',allocation.net_subtotal,
     'couponDiscount',allocation.coupon_discount,'storeCreditDiscount',allocation.store_credit_discount,'paidGoodsTotal',allocation.paid_goods_total)
     from private.order_price_allocations allocation where allocation.order_item_id=item.id and allocation.order_id=o.id),
    'erpCode',identity.erp_code,'erpName',identity.erp_name,'barcode',identity.barcode,'erpCapturedAt',identity.captured_at
   ) order by assignment.shipment_id nulls last,item.id)
    from public.order_items item left join public.order_shipment_items assignment on assignment.order_item_id=item.id and assignment.order_id=o.id
    left join private.order_item_external_identity_snapshots identity on identity.order_item_id=item.id
    where item.order_id=o.id),'[]')
  ) order by o.created_at desc,o.id desc),'[]')) from selected o;
$function$
;
CREATE OR REPLACE FUNCTION private.collect_settled_export_for_search(p_from date, p_to date, p_query text, p_date_field text, p_field text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with selected as materialized (
  select o.* from public.orders o join public.profiles p on p.id=o.user_id
  where o.status='done'
   and private.admin_sales_order_matches(o,p_from,p_to,p_query,p_field,p_date_field,null)
  order by o.created_at desc,o.id desc limit 1001
 )
 select jsonb_build_object('schemaVersion',2,'capturedAt',statement_timestamp(),'orders',coalesce(jsonb_agg(
  jsonb_build_object(
   'id',o.id,'createdAt',o.created_at,'doneAt',o.done_at,'total',o.total,'shippingFee',o.shipping_fee,
   'couponDiscount',o.discount_total,'storeCredits',o.store_credit_total,'shippingCouponDiscount',o.shipping_coupon_discount_total,
   'calculationVersion',o.calculation_version,'volumeDiscount',o.volume_discount_total,'shippingCollectTotal',o.shipping_collect_total,
   'shippingComponents',coalesce((select jsonb_agg(jsonb_build_object('id',component.id,'shipmentId',component.shipment_id,'paymentMode',component.payment_mode,
    'baseFee',component.base_fee,'regionalFee',component.regional_fee,'totalFee',component.total_fee,'installationFee',component.installation_fee,'shippingCouponDiscount',component.shipping_coupon_discount) order by component.id)
    from private.shipping_charge_components component where component.order_id=o.id),'[]'),
   'coupon',(
    select jsonb_build_object('code',r.coupon_code,'discountAmount',r.discount_amount,'eligibleSubtotal',r.eligible_subtotal,'terms',r.terms_snapshot)
    from public.coupon_redemptions r where r.order_id=o.id and r.status='applied' and o.calculation_version=1 order by r.application_index limit 1
   ),
   'coupons',coalesce((select jsonb_agg(jsonb_build_object('code',r.coupon_code,'discountAmount',r.discount_amount,'benefitKind',r.benefit_kind,'applicationIndex',r.application_index) order by r.application_index) from public.coupon_redemptions r where r.order_id=o.id and r.status='applied'),'[]'),
   'payments',coalesce((select jsonb_agg(jsonb_build_object(
    'id',payment.id,'amount',payment.amount,'status',payment.status,'provider',payment.provider,
    'approvedAt',approval.approved_at,
    'timeSource',case when approval.approved_at is null then null when payment.provider='bank_transfer' then 'bank_confirmation' else 'provider_approval' end
   ) order by payment.id)
    from public.payments payment left join lateral (
     select coalesce(
      (select min(e.approved_at) from private.payment_provider_evidence e where e.payment_attempt_id=a.id),
      (select b.confirmed_at from public.bank_transfer_confirmations b where b.attempt_id=a.id and b.order_id=o.id and a.provider='bank_transfer')
     ) as approved_at
     from public.payment_attempts a where a.payment_id=payment.id and a.purpose='order'
      and a.ref_id=o.id and a.state='approved' and a.amount=payment.amount
    ) approval on true
    where payment.purpose='order' and payment.ref_id=o.id and payment.status in('paid','refunded')),'[]'),
   'shipments',coalesce((select jsonb_agg(jsonb_build_object(
    'id',s.id,'trackingNumber',s.tracking_number,'shippingFee',s.shipping_fee,'status',s.status,
    'shippingCollectFee',s.shipping_collect_fee,'collectState',(select obligation.state from private.shipping_collect_obligations obligation where obligation.shipment_id=s.id)
   ) order by s.id) from public.order_shipments s where s.order_id=o.id),'[]'),
   'items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',item.id,'goodId',item.good_id,'variantId',item.variant_id,'goodName',item.good_name_snapshot,'variantName',item.variant_name_snapshot,
    'qty',item.qty,'unitPrice',item.unit_price,'regularUnitPrice',item.regular_unit_price_snapshot,
    'shipmentId',assignment.shipment_id,
    'allocation',(select jsonb_build_object('subtotal',allocation.subtotal,'volumeDiscount',allocation.volume_discount,'netSubtotal',allocation.net_subtotal,
     'couponDiscount',allocation.coupon_discount,'storeCreditDiscount',allocation.store_credit_discount,'paidGoodsTotal',allocation.paid_goods_total)
     from private.order_price_allocations allocation where allocation.order_item_id=item.id and allocation.order_id=o.id),
    'erpCode',identity.erp_code,'erpName',identity.erp_name,'barcode',identity.barcode,'erpCapturedAt',identity.captured_at
   ) order by assignment.shipment_id nulls last,item.id)
    from public.order_items item left join public.order_shipment_items assignment on assignment.order_item_id=item.id and assignment.order_id=o.id
    left join private.order_item_external_identity_snapshots identity on identity.order_item_id=item.id
    where item.order_id=o.id),'[]')
  ) order by o.created_at desc,o.id desc),'[]')) from selected o;
$function$
;
revoke all on function private.calculate_goods_transaction_combined_locked(uuid,jsonb,jsonb,jsonb,uuid[],bigint,timestamptz,jsonb,uuid),
 private.lock_goods_transaction_combined_catalog(uuid,jsonb,uuid[]),private.quote_goods_transaction_combined(uuid,jsonb,jsonb,jsonb,jsonb,uuid[],bigint),
 public.quote_cart_goods_transaction_combined(uuid,jsonb,jsonb,jsonb,uuid[],bigint) from public,anon,authenticated,service_role;
grant execute on function public.quote_cart_goods_transaction_combined(uuid,jsonb,jsonb,jsonb,uuid[],bigint) to service_role;
select private.register_operator_internal_contract('public.quote_cart_goods_transaction_combined(uuid,jsonb,jsonb,jsonb,uuid[],bigint)'::regprocedure);
commit;
