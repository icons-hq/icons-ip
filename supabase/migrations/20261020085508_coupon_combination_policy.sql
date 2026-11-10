-- Product contract: opt-in coupon combinations, immutable issued benefit kind, and prepaid shipping discounts.
begin;
alter table public.coupons add column benefit_kind text not null default 'goods' check(benefit_kind in('goods','shipping')),
 add column stackable boolean not null default false;
alter table public.coupon_redemptions add column benefit_kind text not null default 'goods' check(benefit_kind in('goods','shipping')),
 add column application_index integer not null default 1 check(application_index between 1 and 6);
drop index public.coupon_redemptions_applied_order_uidx;
create unique index coupon_redemptions_applied_order_position on public.coupon_redemptions(order_id,application_index) where status='applied';
create unique index coupon_redemptions_one_shipping on public.coupon_redemptions(order_id) where status='applied' and benefit_kind='shipping';
alter table private.goods_transaction_quotes add column user_coupon_ids uuid[];
alter table private.shipping_charge_components add column shipping_coupon_discount bigint not null default 0 check(shipping_coupon_discount>=0),
 drop constraint shipping_charge_components_check,
 add constraint shipping_charge_components_net_fee check(total_fee=base_fee+regional_fee+installation_fee-shipping_coupon_discount
  and shipping_coupon_discount<=base_fee+regional_fee and (payment_mode='prepaid' or shipping_coupon_discount=0));
alter table public.orders add column shipping_coupon_discount_total bigint not null default 0 check(shipping_coupon_discount_total>=0);
create table private.coupon_combination_policy(singleton boolean primary key default true check(singleton),revision bigint not null default 1,
 stacking_enabled boolean not null default false,max_goods_coupons integer not null default 1 check(max_goods_coupons between 1 and 5),
 shipping_enabled boolean not null default false,evidence text not null default '',updated_at timestamptz not null default clock_timestamp());
insert into private.coupon_combination_policy(singleton) values(true);
create table private.coupon_combination_operations(operation_id uuid primary key,actor_id uuid not null references auth.users(id),
 session_id uuid not null,request jsonb not null,receipt jsonb not null,created_at timestamptz not null default clock_timestamp());
alter table private.coupon_combination_policy enable row level security;
alter table private.coupon_combination_operations enable row level security;
revoke all on private.coupon_combination_policy,private.coupon_combination_operations from public,anon,authenticated,service_role;
create function public.get_coupon_combination_policy() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('revision',revision,'stackingEnabled',stacking_enabled,'maxGoodsCoupons',max_goods_coupons,'shippingEnabled',shipping_enabled)
 from private.coupon_combination_policy where singleton;
$$;
create function public.admin_get_coupon_combination_policy() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform private.require_operator_capability('marketing.manage',false);
 return public.get_coupon_combination_policy()||(select jsonb_build_object('evidence',evidence,'updatedAt',updated_at) from private.coupon_combination_policy where singleton);end $$;
create function public.admin_save_coupon_combination_policy(p_values jsonb,p_revision bigint,p_operation uuid,p_actor uuid,p_session uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare current_policy private.coupon_combination_policy; previous private.coupon_combination_operations;request jsonb;receipt jsonb;
begin
 perform private.production_identity(p_actor,p_session,null,'marketing.manage');
 if p_operation is null or p_revision is null or p_revision<1 or jsonb_typeof(p_values)<>'object'
  or p_values-array['stackingEnabled','maxGoodsCoupons','shippingEnabled','evidence','confirmed']<>'{}'::jsonb
  or jsonb_typeof(p_values->'stackingEnabled') is distinct from 'boolean' or jsonb_typeof(p_values->'shippingEnabled') is distinct from 'boolean'
  or jsonb_typeof(p_values->'maxGoodsCoupons') is distinct from 'number' or p_values->>'maxGoodsCoupons' !~ '^[1-5]$' or p_values->'confirmed' is distinct from 'true'::jsonb
  or jsonb_typeof(p_values->'evidence') is distinct from 'string' or length(btrim(p_values->>'evidence')) not between 2 and 1000
  or p_values->>'evidence' ~ '[[:cntrl:]]' then raise invalid_parameter_value using message='invalid_coupon_combination_policy';end if;
 request:=jsonb_build_object('values',p_values,'revision',p_revision);
 select * into current_policy from private.coupon_combination_policy where singleton for update;
 select * into previous from private.coupon_combination_operations where operation_id=p_operation;
 if found then if previous.actor_id<>p_actor or previous.session_id<>p_session or previous.request is distinct from request then raise sqlstate 'PT409' using message='coupon_operation_conflict';end if;return previous.receipt;end if;
 if current_policy.revision<>p_revision then raise sqlstate 'PT409' using message='coupon_policy_changed';end if;
 if (p_values->>'stackingEnabled')::boolean or (p_values->>'shippingEnabled')::boolean then perform private.assert_goods_transaction_runtime();end if;
 update private.coupon_combination_policy set revision=revision+1,stacking_enabled=(p_values->>'stackingEnabled')::boolean,
 max_goods_coupons=(p_values->>'maxGoodsCoupons')::integer,shipping_enabled=(p_values->>'shippingEnabled')::boolean,evidence=btrim(p_values->>'evidence'),updated_at=clock_timestamp() where singleton;
 receipt:=public.admin_get_coupon_combination_policy();
 insert into private.coupon_combination_operations values(p_operation,p_actor,p_session,request,receipt,clock_timestamp());
 insert into public.audit_log(actor_id,action,target,diff) values(p_actor,'commerce.coupon.combination_policy_updated','coupon_combination_policy',jsonb_build_object('before',to_jsonb(current_policy),'after',receipt,'operationId',p_operation));
 return receipt;
end $$;
create function private.guard_issued_coupon_benefit() returns trigger language plpgsql set search_path='' as $$
begin if old.issued_count>0 and (new.benefit_kind is distinct from old.benefit_kind or new.stackable is distinct from old.stackable) then
 raise check_violation using message='coupon_issued_benefit_immutable';end if;return new;end $$;
create trigger coupon_issued_benefit_guard before update on public.coupons for each row execute function private.guard_issued_coupon_benefit();
CREATE OR REPLACE FUNCTION public.admin_upsert_coupon_scheduled(target_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid:=auth.uid(); saved public.coupons; previous public.coupons;
  issue_start timestamptz:=(target_payload->>'target_issue_starts_at')::timestamptz;
  issue_end timestamptz:=(target_payload->>'target_issue_ends_at')::timestamptz;
  usage_end timestamptz:=(target_payload->>'target_ends_at')::timestamptz;
  days integer:=(target_payload->>'target_valid_days')::integer;
  normalized_code text:=upper(btrim(target_payload->>'target_code')); benefit text; combined boolean;
begin
  perform private.require_operator_capability('marketing.manage',false);

  perform private.assert_active_user(actor);
  if not public.has_operator_capability('marketing.manage',false) or private.is_account_write_fenced(actor) then raise insufficient_privilege using message='staff_required';end if;
  if issue_start is null or (issue_end is not null and issue_end<=issue_start)
    or (days is not null and (days not between 1 and 365 or usage_end is not null))
    or (days is null and usage_end is not null and (issue_start>=usage_end or issue_end>usage_end))
    then raise invalid_parameter_value using message='invalid_coupon_issue_schedule';end if;
  perform pg_advisory_xact_lock(hashtextextended('coupon_admin:'||normalized_code,0));
  select * into previous from public.coupons where code=normalized_code for update;
  benefit:=coalesce(target_payload->>'target_benefit_kind',previous.benefit_kind,'goods');
  if benefit not in('goods','shipping') or (target_payload ? 'target_stackable' and jsonb_typeof(target_payload->'target_stackable') is distinct from 'boolean') then raise invalid_parameter_value using message='invalid_coupon_benefit';end if;
  combined:=coalesce((target_payload->>'target_stackable')::boolean,previous.stackable,false);
  perform public.admin_upsert_coupon_targeted(target_payload-array['target_issue_starts_at','target_issue_ends_at','target_valid_days','target_benefit_kind','target_stackable']);
  update public.coupons set benefit_kind=benefit,stackable=combined,issue_starts_at=issue_start,issue_ends_at=issue_end,valid_days=days where code=normalized_code returning * into saved;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'commerce.coupon.schedule_updated','coupons:'||normalized_code,
    jsonb_build_object('before',case when previous.code is null then null else jsonb_build_object('issueStartsAt',previous.issue_starts_at,'issueEndsAt',previous.issue_ends_at,'validDays',previous.valid_days,'benefitKind',previous.benefit_kind,'stackable',previous.stackable) end,
      'after',jsonb_build_object('issueStartsAt',saved.issue_starts_at,'issueEndsAt',saved.issue_ends_at,'validDays',saved.valid_days,'benefitKind',saved.benefit_kind,'stackable',saved.stackable),'revision',saved.terms_revision));
  return jsonb_build_object('code',saved.code,'revision',saved.terms_revision);
end $function$
;
CREATE OR REPLACE FUNCTION private.evaluate_user_coupon(p_user_coupon_id uuid, p_user_id uuid, p_subtotal bigint, OUT o_reason text, OUT o_discount bigint, OUT o_coupon_code text)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare lines jsonb; evaluated record;
begin
 if exists(select 1 from public.user_coupons held join public.coupons c on c.code=held.coupon_code where held.id=p_user_coupon_id and c.benefit_kind='shipping') then o_reason:='coupon_checkout_required';o_discount:=0;o_coupon_code:=null;return;end if;

 select coalesce(jsonb_agg(jsonb_build_object('good_id',cart.good_id,'subtotal',cart.qty::bigint*price.effective_price::bigint)),'[]') into lines
 from public.cart_items cart join public.goods_variants variant on variant.id=cart.variant_id and variant.good_id=cart.good_id
 cross join lateral private.resolve_goods_variant_price(variant.id,statement_timestamp()) price where cart.user_id=p_user_id;
 select * into evaluated from private.evaluate_coupon_target_lines(p_user_coupon_id,p_user_id,lines,null);
 o_reason:=evaluated.o_reason; o_discount:=evaluated.o_discount; o_coupon_code:=evaluated.o_coupon_code;
end $function$
;
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
   'fulfillmentTermsSnapshot',private.goods_fulfillment_selected_terms(good.id,p_delivery_choices->good.id),'productionTermsSnapshot',private.goods_production_terms(good.id),'salesPolicySnapshot',jsonb_build_object('version',2,'allowCardPayment',good.allow_card_payment,'allowBankTransfer',good.allow_bank_transfer,
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
  if exists(select 1 from public.user_coupons held join public.coupons c on c.code=held.coupon_code where held.id=p_user_coupon_id and c.benefit_kind='shipping') then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','coupon_unavailable','goodId',null)));end if;
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
   'storeCreditDiscount',line->'storeCreditDiscount','paidGoodsTotal',line->'paidGoodsTotal','volumePolicyId',line->'volumePolicyId','production',line->'productionTermsSnapshot','fulfillment',line->'fulfillmentTermsSnapshot'));
  index:=index+1;
 end loop;
 return jsonb_build_object('state','calculated','display',jsonb_build_object('calculationVersion',2,'currency','KRW','calculatedAt',p_at,'nextChangeAt',next_change,
  'lines',display_lines,'shipping',shipping->'displayGroups','totals',jsonb_build_object('subtotal',subtotal,'volumeDiscountTotal',volume_total,'netGoodsTotal',net,
   'couponDiscountTotal',coupon,'storeCreditTotal',credit,'prepaidShippingTotal',shipping->'prepaidFee','collectShippingTotal',shipping->'collectFee','onlineTotal',online,'customerTotal',customer),
  'userCouponId',p_user_coupon_id,'storeCreditMaximum',maximum,'paymentMethods',jsonb_build_object('card',card_allowed,'bankTransfer',bank_allowed)),
  'lines',internal_lines,'shippingRaw',shipping->'rawGroups','coupon',coupon_data,'creditPolicy',case when policy.enabled then private.store_credit_policy_for_member(p_actor)-'evidence' else null end);
exception when numeric_value_out_of_range then
 return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','amount_overflow','goodId',null)));
end $function$
;
CREATE OR REPLACE FUNCTION public.admin_search_coupon_console_v2(p_query text DEFAULT NULL::text, p_status text DEFAULT 'all'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(code text, name text, discount_type text, discount_value integer, max_discount_amount integer, min_subtotal integer, starts_at timestamp with time zone, ends_at timestamp with time zone, issue_limit integer, issued_count integer, status text, grade_benefit loyalty_grade, used_count bigint, total_count bigint, recipient_segment text, goods_scope text, target_good_ids text[], terms_revision integer, target_goods jsonb, issue_starts_at timestamp with time zone, issue_ends_at timestamp with time zone, valid_days integer, benefit_kind text, stackable boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor_id uuid := (select auth.uid());
  needle text := btrim(coalesce(p_query, ''));
  normalized_status text := lower(btrim(coalesce(p_status, 'all')));
  pattern text;
  phase text := coalesce(p_filters->>'phase','all');
  discount text := coalesce(p_filters->>'discountType','all');
  segment text := coalesce(p_filters->>'segment','any');
  date_field text := coalesce(p_filters->>'dateField','created');
  sort_key text := coalesce(p_filters->>'sort','created_desc');
  date_from date := nullif(p_filters->>'from','')::date;
  date_to date := nullif(p_filters->>'to','')::date;
begin
  if not public.has_operator_capability('marketing.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if actor_id is null or not public.has_operator_capability('marketing.manage',false) then
    raise insufficient_privilege using message = 'staff_required';
  end if;

  if length(needle) > 100
     or normalized_status not in ('all', 'active', 'archived')
     or p_limit is null
     or p_limit not between 1 and 100
     or p_offset is null
     or p_offset < 0 or p_offset > 10000000
     or phase not in ('all','scheduled','live','ended','stopped')
     or discount not in ('all','fixed','percent')
     or segment not in ('any','all','first_purchase','repeat_purchase','grade')
     or date_field not in ('created','starts')
     or sort_key not in ('created_desc','name_asc','starts_desc','ends_asc')
     or (date_from is not null and date_to is not null and date_from > date_to) then
    raise invalid_parameter_value using message = 'invalid_coupon_search';
  end if;

  -- `%`와 `_`는 검색어가 아니라 와일드카드로 해석되지 않게 한다. 나머지
  -- PostgREST 문법은 RPC 내부의 SQL 값으로만 취급되므로 필터 문자열을 만들지 않는다.
  pattern := '%' || replace(
    replace(replace(needle, E'\\', E'\\\\'), '%', E'\\%'),
    '_', E'\\_'
  ) || '%';

  return query
    select
      coupon.code,
      coupon.name,
      coupon.discount_type,
      coupon.discount_value,
      coupon.max_discount_amount,
      coupon.min_subtotal,
      coupon.starts_at,
      coupon.ends_at,
      coupon.issue_limit,
      coupon.issued_count,
      coupon.status,
      coupon.grade_benefit,
      (
        select count(*)::bigint
        from public.coupon_redemptions as redemption
        where redemption.coupon_code = coupon.code
          and redemption.status = 'applied'
      ) as used_count,
      count(*) over () as total_count,
      coupon.recipient_segment,coupon.goods_scope,coupon.target_good_ids,coupon.terms_revision,public.admin_coupon_target_goods(coupon),coupon.issue_starts_at,coupon.issue_ends_at,coupon.valid_days,coupon.benefit_kind,coupon.stackable
    from public.coupons as coupon
    where (needle = ''
      or coupon.code ilike pattern escape E'\\'
      or coupon.name ilike pattern escape E'\\')
      and (normalized_status = 'all' or coupon.status = normalized_status)
      and (discount='all' or coupon.discount_type=discount)
      and (segment='any' or (segment='grade' and coupon.grade_benefit is not null) or coupon.recipient_segment=segment)
      and (phase='all' or (phase='stopped' and coupon.status='archived')
        or (coupon.status='active' and ((phase='scheduled' and coalesce(coupon.issue_starts_at,coupon.starts_at)>now())
        or (phase='ended' and least(coupon.ends_at,case when coupon.issue_starts_at is null then coupon.ends_at else coupon.issue_ends_at end)<=now())
        or (phase='live' and coalesce(coupon.issue_starts_at,coupon.starts_at)<=now() and (least(coupon.ends_at,case when coupon.issue_starts_at is null then coupon.ends_at else coupon.issue_ends_at end) is null or least(coupon.ends_at,case when coupon.issue_starts_at is null then coupon.ends_at else coupon.issue_ends_at end)>now())))))
      and (date_from is null or (case when date_field='starts' then coupon.starts_at else coupon.created_at end) >= (date_from::timestamp at time zone 'Asia/Seoul'))
      and (date_to is null or (case when date_field='starts' then coupon.starts_at else coupon.created_at end) < ((date_to+1)::timestamp at time zone 'Asia/Seoul'))
    order by case when sort_key='name_asc' then coupon.name end asc,
      case when sort_key='starts_desc' then coupon.starts_at end desc,
      case when sort_key='ends_asc' then coupon.ends_at end asc nulls last,
      coupon.created_at desc, coupon.code asc
    limit p_limit
    offset p_offset;
end;
$function$
;
revoke all on function public.get_coupon_combination_policy(),public.admin_get_coupon_combination_policy(),
 public.admin_save_coupon_combination_policy(jsonb,bigint,uuid,uuid,uuid),private.guard_issued_coupon_benefit(),
 public.admin_search_coupon_console_v2(text,text,integer,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_coupon_combination_policy() to authenticated;
grant execute on function public.admin_get_coupon_combination_policy(),public.admin_save_coupon_combination_policy(jsonb,bigint,uuid,uuid,uuid),public.admin_search_coupon_console_v2(text,text,integer,integer,jsonb) to authenticated;
select private.register_operator_rpc_contract('public.admin_get_coupon_combination_policy()'::regprocedure,'marketing.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_coupon_combination_policy(jsonb,bigint,uuid,uuid,uuid)'::regprocedure,'marketing.manage','write',false);
select private.register_operator_rpc_contract('public.admin_search_coupon_console_v2(text,text,integer,integer,jsonb)'::regprocedure,'marketing.manage','read',false);
CREATE OR REPLACE FUNCTION private.marketing_coupon_document(p_code text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object('code',c.code,'name',c.name,'benefitKind',c.benefit_kind,'stackable',c.stackable,'discountType',c.discount_type,'discountValue',c.discount_value,
  'maxDiscountAmount',c.max_discount_amount,'minSubtotal',c.min_subtotal,'startsAt',c.starts_at,'endsAt',c.ends_at,
  'validDays',c.valid_days,'issueStartsAt',coalesce(c.issue_starts_at,c.starts_at),'issueEndsAt',case when c.issue_starts_at is null then c.ends_at else c.issue_ends_at end,
  'available',c.status='active' and coalesce(c.issue_starts_at,c.starts_at)<=statement_timestamp()
    and ((case when c.issue_starts_at is null then c.ends_at else c.issue_ends_at end) is null or (case when c.issue_starts_at is null then c.ends_at else c.issue_ends_at end)>statement_timestamp())
    and (c.ends_at is null or c.ends_at>statement_timestamp()) and (c.issue_limit is null or c.issued_count<c.issue_limit))
 from public.coupons c where c.code=p_code;
$function$
;
commit;
