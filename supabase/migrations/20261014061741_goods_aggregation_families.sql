-- DRAFT: immutable financial families survive display regrouping and option conversion.
-- No existing goods, orders, policy versions or runtime gates are rewritten.
create table private.goods_aggregation_roots (
 root_good_id text primary key references public.goods(id),
 aggregation_id uuid not null unique default gen_random_uuid(),
 created_by uuid not null references auth.users(id),
 operation_id uuid not null,
 created_at timestamptz not null default clock_timestamp()
);
create table private.goods_aggregation_members (
 good_id text primary key references public.goods(id),
 root_good_id text not null references private.goods_aggregation_roots(root_good_id),
 created_by uuid not null references auth.users(id),
 operation_id uuid not null,
 created_at timestamptz not null default clock_timestamp()
);
create index goods_aggregation_members_root_idx on private.goods_aggregation_members(root_good_id,good_id);
create function private.goods_aggregation_owner(p_good_id text) returns text
language sql stable security definer set search_path='' as $$
 select coalesce((select root_good_id from private.goods_aggregation_members where good_id=p_good_id),p_good_id);
$$;
create function private.guard_goods_aggregation_identity() returns trigger
language plpgsql security definer set search_path='' as $$begin
 raise check_violation using message='goods_aggregation_identity_immutable';
end $$;
create trigger goods_aggregation_roots_immutable before update or delete on private.goods_aggregation_roots
 for each row execute function private.guard_goods_aggregation_identity();
create trigger goods_aggregation_members_immutable before update or delete on private.goods_aggregation_members
 for each row execute function private.guard_goods_aggregation_identity();

-- Called by the converter after locking the sorted union of source/owner/new goods,
-- then variants. Targets are unpublished goods created in the same transaction.
create function private.bind_goods_aggregation(p_source_good_id text,p_new_good_ids text[],p_operation_id uuid,p_actor uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare owner_id text;family_id uuid;target_id text;begin
 if p_actor is null or auth.uid() is distinct from p_actor then raise insufficient_privilege using message='auth_context_changed';end if;
 perform private.require_actor_operator_capability(p_actor,'catalog.manage');
 if p_operation_id is null or p_source_good_id is null or p_new_good_ids is null or cardinality(p_new_good_ids) not between 1 and 99
  or array_position(p_new_good_ids,null) is not null or p_source_good_id=any(p_new_good_ids)
  or (select count(distinct id) from unnest(p_new_good_ids) id)<>cardinality(p_new_good_ids) then
  raise invalid_parameter_value using message='invalid_goods_aggregation_binding';end if;
 owner_id:=private.goods_aggregation_owner(p_source_good_id);
 perform 1 from public.goods where id in (owner_id,p_source_good_id) order by id for update;
 if not exists(select 1 from public.goods where id=p_source_good_id and archived_at is null) then raise no_data_found using message='good_not_found';end if;
 if exists(select 1 from unnest(p_new_good_ids) target(id) left join public.goods g on g.id=target.id
  where g.id is null or g.published_at is not null or g.archived_at is not null or g.xmin<>pg_current_xact_id()::text::xid
   or exists(select 1 from private.goods_aggregation_members where good_id=target.id)
   or exists(select 1 from private.goods_transaction_configs where good_id=target.id)
   or exists(select 1 from public.order_items where good_id=target.id)) then
  raise check_violation using message='goods_aggregation_target_not_new';end if;
 if coalesce((select count(*) from private.goods_aggregation_members where root_good_id=owner_id),1)+cardinality(p_new_good_ids)>100 then
  raise check_violation using message='goods_aggregation_member_limit';end if;
 insert into private.goods_aggregation_roots(root_good_id,created_by,operation_id) values(owner_id,p_actor,p_operation_id) on conflict do nothing;
 insert into private.goods_aggregation_members(good_id,root_good_id,created_by,operation_id) values(owner_id,owner_id,p_actor,p_operation_id) on conflict do nothing;
 insert into private.goods_aggregation_members(good_id,root_good_id,created_by,operation_id)
  select id,owner_id,p_actor,p_operation_id from unnest(p_new_good_ids) id order by id;
 select aggregation_id into family_id from private.goods_aggregation_roots where root_good_id=owner_id;
 return family_id;
end $$;

create function private.goods_aggregation_shared_policy(p_good_id text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('originId',g.origin_id,'shippingFeeType',g.shipping_fee_type,'individualFee',g.individual_fee,
  'orderQuantityLimitEnabled',g.order_quantity_limit_enabled,'minOrderQty',g.min_order_qty,'maxOrderQty',g.max_order_qty,
  'memberPurchaseLimitEnabled',g.member_purchase_limit_enabled,'memberLifetimeQtyLimit',g.member_lifetime_qty_limit)
 from public.goods g where g.id=private.goods_aggregation_owner(p_good_id);
$$;
create function public.admin_get_goods_aggregation(p_good_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare result jsonb;begin
 if not public.has_operator_capability('catalog.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 select jsonb_build_object('goodId',g.id,'ownerGoodId',coalesce(m.root_good_id,g.id),'aggregationId',r.aggregation_id,
  'sharedPolicy',private.goods_aggregation_shared_policy(g.id),'shared',m.good_id is not null,'editable',coalesce(m.root_good_id,g.id)=g.id)
 into result from public.goods g left join private.goods_aggregation_members m on m.good_id=g.id
 left join private.goods_aggregation_roots r on r.root_good_id=m.root_good_id where g.id=p_good_id;
 return result;
end $$;

create function private.guard_goods_aggregation_policy() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner_id text;owner_row public.goods;field text;begin
 owner_id:=private.goods_aggregation_owner(new.id);
 if owner_id=new.id then return new;end if;
 select * into owner_row from public.goods where id=owner_id;
 foreach field in array array['origin_id','shipping_fee_type','individual_fee','order_quantity_limit_enabled','min_order_qty','max_order_qty',
  'member_purchase_limit_enabled','member_lifetime_qty_limit'] loop
  -- An unrelated stale editor save is harmless. A deliberate separate policy is not.
  if to_jsonb(new)->field is distinct from to_jsonb(old)->field and to_jsonb(new)->field is distinct from to_jsonb(owner_row)->field then
   raise check_violation using message='goods_aggregation_policy_owned_by_source';end if;
 end loop;
 return new;
end $$;
create trigger goods_aggregation_shared_policy_guard before update on public.goods
 for each row execute function private.guard_goods_aggregation_policy();
create function private.guard_goods_aggregation_config() returns trigger
language plpgsql security definer set search_path='' as $$begin
 if private.goods_aggregation_owner(new.good_id)<>new.good_id then raise check_violation using message='goods_aggregation_policy_owned_by_source';end if;
 return new;
end $$;
create trigger goods_aggregation_config_guard before insert or update on private.goods_transaction_configs
 for each row execute function private.guard_goods_aggregation_config();

CREATE OR REPLACE FUNCTION private.member_goods_reserved_qty(p_user_id uuid, p_good_id text)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(sum(item.qty::bigint),0)
  from public.order_items item join public.orders orders on orders.id=item.order_id
  where orders.user_id=p_user_id and private.goods_aggregation_owner(item.good_id)=private.goods_aggregation_owner(p_good_id) and orders.status<>'canceled';
$function$;

CREATE OR REPLACE FUNCTION private.check_goods_purchase_quantity(p_good goods, p_user_id uuid, p_qty bigint, p_check_minimum boolean)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when policy.order_quantity_limit_enabled and (policy.min_order_qty is null or policy.max_order_qty is null)
      then 'purchase_limit_not_configured'
    when policy.member_purchase_limit_enabled and policy.member_lifetime_qty_limit is null
      then 'purchase_limit_not_configured'
    when policy.order_quantity_limit_enabled and p_check_minimum and p_qty<policy.min_order_qty
      then 'order_quantity_below_minimum'
    when policy.order_quantity_limit_enabled and p_qty>policy.max_order_qty
      then 'order_quantity_above_maximum'
    when policy.member_purchase_limit_enabled and p_user_id is not null
      and private.member_goods_reserved_qty(p_user_id,policy.id)+p_qty>policy.member_lifetime_qty_limit
      then 'member_purchase_limit_exceeded'
    else null end
  from public.goods policy where policy.id=private.goods_aggregation_owner(p_good.id);
$function$;

CREATE OR REPLACE FUNCTION private.lock_goods_transaction_catalog(p_actor uuid, p_selection jsonb, p_user_coupon_id uuid)
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
 if p_user_coupon_id is not null then
  perform 1 from public.user_coupons h where h.id=p_user_coupon_id for update;
  perform 1 from public.coupons c join public.user_coupons h on h.coupon_code=c.code where h.id=p_user_coupon_id for share of c;
 end if;
 perform 1 from private.store_credit_policy where singleton for share;
 perform private.lock_store_credit_account(p_actor);
 perform 1 from private.store_credit_lots where user_id=p_actor order by expires_at,id for update;
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
  'lines',internal_lines,'shippingRaw',shipping->'rawGroups','coupon',coupon_data,'creditPolicy',case when policy.enabled then private.store_credit_policy_json()-'evidence' else null end);
exception when numeric_value_out_of_range then
 return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','amount_overflow','goodId',null)));
end $function$;

CREATE OR REPLACE FUNCTION private.evaluate_coupon_target_lines_at(p_user_coupon_id uuid, p_user_id uuid, p_lines jsonb, p_order_id uuid, p_at timestamp with time zone, OUT o_reason text, OUT o_discount bigint, OUT o_coupon_code text, OUT o_eligible_subtotal bigint, OUT o_terms_snapshot jsonb)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare held public.user_coupons; coupon public.coupons;
begin
 if p_at is null or not isfinite(p_at) then raise invalid_parameter_value using message='invalid_coupon_evaluation_time';end if;
 o_reason:=null; o_discount:=0; o_coupon_code:=null; o_eligible_subtotal:=0; o_terms_snapshot:=null;
 select * into held from public.user_coupons where id=p_user_coupon_id;
 if not found or held.user_id is distinct from p_user_id then o_reason:='coupon_not_owned'; return; end if;
 o_coupon_code:=held.coupon_code;
 if held.status='used' then o_reason:='coupon_already_used'; return; end if;
 select * into coupon from public.coupons where code=held.coupon_code;
 if not found or coupon.status<>'active' then o_reason:='coupon_not_found'; return; end if;
 if p_at<(case when coupon.issue_starts_at is null then coupon.starts_at else held.usable_from end) then o_reason:='coupon_not_started'; return; end if;
 if (coupon.issue_starts_at is null and coupon.ends_at is not null and p_at>coupon.ends_at) or (held.expires_at is not null and p_at>held.expires_at)
   then o_reason:='coupon_expired'; return; end if;
 o_reason:=private.coupon_recipient_reason(coupon.recipient_segment,p_user_id);
 if o_reason is not null then return; end if;
 if coupon.recipient_segment='first_purchase' then
   if exists(select 1 from private.coupon_first_purchase_claims where user_id=p_user_id and state='reserved' and order_id is distinct from p_order_id)
     then o_reason:='coupon_first_purchase_reserved'; return; end if;
   if exists(select 1 from public.orders where user_id=p_user_id and status='pending' and id is distinct from p_order_id)
     then o_reason:='coupon_first_purchase_pending'; return; end if;
 end if;
 select coalesce(sum(line.subtotal),0) into o_eligible_subtotal
   from jsonb_to_recordset(p_lines) line(good_id text,subtotal bigint)
   where coupon.goods_scope='all' or line.good_id=any(coupon.target_good_ids) or private.goods_aggregation_owner(line.good_id)=any(coupon.target_good_ids);
 o_terms_snapshot:=jsonb_build_object('revision',coupon.terms_revision,'recipientSegment',coupon.recipient_segment,'goodsScope',coupon.goods_scope,
   'targetGoodIds',coupon.target_good_ids,'eligibleSubtotal',o_eligible_subtotal,'discountType',coupon.discount_type,'discountValue',coupon.discount_value,
   'maxDiscountAmount',coupon.max_discount_amount,'minSubtotal',coupon.min_subtotal,'startsAt',coupon.starts_at,'endsAt',coupon.ends_at,'expiresAt',held.expires_at,'usableFrom',held.usable_from,'issueStartsAt',coupon.issue_starts_at,'issueEndsAt',coupon.issue_ends_at,'validDays',coupon.valid_days);
 if o_eligible_subtotal=0 then o_reason:='coupon_no_eligible_goods'; return; end if;
 if o_eligible_subtotal<coupon.min_subtotal then o_reason:='coupon_min_subtotal'; return; end if;
 o_discount:=case when coupon.discount_type='fixed' then least(coupon.discount_value::bigint,o_eligible_subtotal)
   else least((o_eligible_subtotal*coupon.discount_value::bigint)/100,coalesce(coupon.max_discount_amount::bigint,o_eligible_subtotal),o_eligible_subtotal) end;
end $function$;

CREATE OR REPLACE FUNCTION private.calculate_goods_transaction_shipping_families_base(p_lines jsonb, p_destination jsonb, p_choices jsonb, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare grouped jsonb:='[]';row record;delivery private.goods_delivery_versions;shipping_lines jsonb:='[]';base_quote jsonb;regional_quote jsonb;
 raw_group jsonb;group_goods jsonb;policy_rows jsonb;regional_rows jsonb;policy_allocations jsonb;base_allocations jsonb;regional_allocations jsonb;
 region private.shipping_region_policies;component jsonb;components jsonb;raw_groups jsonb:='[]';display_groups jsonb:='[]';good_line jsonb;
 quantity numeric;fee numeric;subtotal numeric;policy_sum numeric;regional_sum numeric;prepaid numeric;collect numeric;prepaid_total numeric:=0;collect_total numeric:=0;
 payment_mode text;contract private.shipping_collect_contract_versions;collector jsonb;contract_id uuid;regional_eligible boolean;basis text;basis_sum numeric;
begin
 for row in select good_id,origin_id,sum(qty::numeric) qty,sum(unit_price::numeric*qty) subtotal,max(fee_type) fee_type,max(individual_fee) individual_fee
  from jsonb_to_recordset(p_lines) l(good_id text,origin_id uuid,qty integer,unit_price bigint,fee_type text,individual_fee bigint)
  group by good_id,origin_id order by good_id loop
  select d.* into delivery from private.goods_transaction_configs c join private.goods_delivery_versions d on d.id=c.delivery_version_id
   where c.good_id=row.good_id and d.status='active';
  payment_mode:=case when delivery.id is null then 'prepaid' when delivery.payment_mode='buyer_choice' then coalesce(p_choices->>row.good_id,'prepaid') else delivery.payment_mode end;
  if p_choices ? row.good_id and delivery.id is not null and delivery.payment_mode<>'buyer_choice' and p_choices->>row.good_id<>delivery.payment_mode then
   return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','delivery_choice_required','goodId',row.good_id)));end if;
  if p_choices ? row.good_id and delivery.id is null and p_choices->>row.good_id<>'prepaid' then
   return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','delivery_choice_required','goodId',row.good_id)));end if;
  fee:=case when delivery.quantity_terms is not null then private.goods_quantity_delivery_fee(row.qty,delivery.quantity_terms)
   when row.fee_type='individual' then row.individual_fee else 0 end;
  grouped:=grouped||jsonb_build_array(jsonb_build_object('goodId',row.good_id,'originId',row.origin_id,'qty',row.qty,'subtotal',row.subtotal,
   'feeType',case when delivery.quantity_terms is not null then 'individual' else row.fee_type end,'individualFee',fee,'paymentMode',payment_mode,
   'deliveryPolicyId',delivery.id,'deliveryPolicyRevision',delivery.revision,'quantityTerms',delivery.quantity_terms));
  shipping_lines:=shipping_lines||jsonb_build_array(jsonb_build_object('origin_id',row.origin_id,'good_id',row.good_id,'qty',1,'unit_price',row.subtotal,
   'fee_type',case when delivery.quantity_terms is not null then 'individual' else row.fee_type end,'individual_fee',fee));
 end loop;
 base_quote:=private.calculate_goods_shipping(shipping_lines);
 regional_quote:=private.apply_shipping_region_quote(base_quote,shipping_lines,p_destination,p_at);
 if not (regional_quote->>'checkoutAllowed')::boolean then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','shipping_unresolved','goodId',null)));end if;
 for raw_group in select value from jsonb_array_elements(regional_quote->'groups') loop
  select jsonb_agg(value order by value->>'goodId') into group_goods from jsonb_array_elements(grouped) where value->>'originId'=raw_group->>'originId';
  select coalesce(sum((value->>'subtotal')::numeric),0) into policy_sum from jsonb_array_elements(group_goods) where value->>'feeType'='policy';
  select coalesce(jsonb_agg(jsonb_build_object('id',value->>'goodId','weight',case when policy_sum>0 then (value->>'subtotal')::numeric else (value->>'qty')::numeric end)),'[]')
   into policy_rows from jsonb_array_elements(group_goods) where value->>'feeType'='policy';
  policy_allocations:=case when jsonb_array_length(policy_rows)>0 then private.allocate_transaction_amount((raw_group->>'policyFee')::numeric,policy_rows) else '{}'::jsonb end;
  select jsonb_object_agg(value->>'goodId',case when value->>'feeType'='policy' then (policy_allocations->>(value->>'goodId'))::numeric else (value->>'individualFee')::numeric end)
   into base_allocations from jsonb_array_elements(group_goods);
  region:=null;if raw_group->>'policyId' is not null then select * into region from private.shipping_region_policies where id=(raw_group->>'policyId')::uuid;end if;
  regional_rows:='[]';
  for good_line in select value from jsonb_array_elements(group_goods) loop
   regional_eligible:=region.id is not null and raw_group->>'regionStatus'='surcharge' and case good_line->>'feeType'
    when 'policy' then (region.configuration->>'chargePolicyGoods')::boolean and not((region.configuration->>'waivePolicyThreshold')::boolean
     and raw_group->>'freeThreshold' is not null and (raw_group->>'policySubtotal')::numeric>=(raw_group->>'freeThreshold')::numeric)
    when 'free' then (region.configuration->>'chargeFreeGoods')::boolean else (region.configuration->>'chargeIndividualGoods')::boolean end;
   if regional_eligible then regional_rows:=regional_rows||jsonb_build_array(good_line);end if;
  end loop;
  regional_allocations:='{}';
  if jsonb_array_length(regional_rows)>0 then
   if raw_group->>'feeUnit'='per_good' then
    select jsonb_object_agg(value->>'goodId',(raw_group->>'regionalContractFee')::numeric) into regional_allocations from jsonb_array_elements(regional_rows);
   else
    select sum((base_allocations->>(value->>'goodId'))::numeric),sum((value->>'subtotal')::numeric) into basis_sum,subtotal from jsonb_array_elements(regional_rows);
    basis:=case when basis_sum>0 then 'base' when subtotal>0 then 'subtotal' else 'qty' end;
    select jsonb_agg(jsonb_build_object('id',value->>'goodId','weight',case when basis='base' then (base_allocations->>(value->>'goodId'))::numeric else (value->>basis)::numeric end))
     into regional_rows from jsonb_array_elements(regional_rows);
    regional_allocations:=private.allocate_transaction_amount((raw_group->>'regionalFee')::numeric,regional_rows);
   end if;
  end if;
  components:='[]';prepaid:=0;collect:=0;contract:=null;collector:=null;contract_id:=null;regional_sum:=0;
  for good_line in select value from jsonb_array_elements(group_goods) loop
   fee:=(base_allocations->>(good_line->>'goodId'))::numeric+coalesce((regional_allocations->>(good_line->>'goodId'))::numeric,0);
   regional_sum:=regional_sum+coalesce((regional_allocations->>(good_line->>'goodId'))::numeric,0);
   component:=jsonb_build_object('goodId',good_line->>'goodId','paymentMode',good_line->>'paymentMode',
    'baseFee',(base_allocations->>(good_line->>'goodId'))::numeric,'regionalFee',coalesce((regional_allocations->>(good_line->>'goodId'))::numeric,0),
    'totalFee',fee,'deliveryPolicyId',good_line->'deliveryPolicyId');
   components:=components||jsonb_build_array(component);
   if good_line->>'paymentMode'='collect' then collect:=collect+fee;else prepaid:=prepaid+fee;end if;
  end loop;
  if regional_sum<>(raw_group->>'regionalFee')::numeric or prepaid+collect<>(raw_group->>'finalFee')::numeric then
   raise check_violation using message='transaction_shipping_allocation_mismatch';end if;
  -- Contract readiness is required even for a zero-fee collect choice: later
  -- regional/base changes must not turn a dormant unsupported mode payable.
  if exists(select 1 from jsonb_array_elements(group_goods) where value->>'paymentMode'='collect') then
   select v.* into contract from private.shipping_collect_contracts c join private.shipping_collect_contract_versions v on v.id=c.version_id
    where c.origin_id=(raw_group->>'originId')::uuid and v.status='active';
   if not found then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','collect_not_ready','goodId',null)));end if;
   contract_id:=contract.id;collector:=jsonb_build_object('name',contract.contract_values->>'collectorName','method',contract.contract_values->>'collectionMethod',
    'refundContact',contract.contract_values->>'refundContact','instructions',contract.contract_values->>'customerInstructions');
  end if;
  prepaid_total:=prepaid_total+prepaid;collect_total:=collect_total+collect;
  if prepaid_total+collect_total>9007199254740991 then raise numeric_value_out_of_range using message='transaction_amount_overflow';end if;
  raw_groups:=raw_groups||jsonb_build_array(raw_group||jsonb_build_object('calculationVersion',2,'totalFee',prepaid,'prepaidFee',prepaid,'collectFee',collect,
   'fullFee',prepaid+collect,'components',components,'collector',collector,'collectContractId',contract_id,'collectContractSnapshot',to_jsonb(contract),
   'deliveryTerms',group_goods));
  display_groups:=display_groups||jsonb_build_array(jsonb_build_object('originId',raw_group->'originId','prepaidFee',prepaid,'collectFee',collect,
   'fullFee',prepaid+collect,'components',components,'collector',collector));
 end loop;
 return jsonb_build_object('state','calculated','prepaidFee',prepaid_total,'collectFee',collect_total,'rawGroups',raw_groups,'displayGroups',display_groups,
  'nextChangeAt',regional_quote->'nextChangeAt');
end $function$;

create or replace function private.calculate_goods_transaction_shipping(p_lines jsonb,p_destination jsonb,p_choices jsonb,p_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare lines jsonb;choices jsonb:='{}';calculation jsonb;selected record;root_id text;selected_mode text;delivery_mode text;
 raw_group jsonb;component jsonb;terms jsonb;weights jsonb;base_alloc jsonb;regional_alloc jsonb;member jsonb;
 components jsonb;delivery_terms jsonb;raw_groups jsonb:='[]';display_groups jsonb:='[]';expanded jsonb;family_subtotal numeric;begin
 if not exists(select 1 from jsonb_to_recordset(p_lines) l(good_id text) join private.goods_aggregation_members m on m.good_id=l.good_id) then
  return private.calculate_goods_transaction_shipping_families_base(p_lines,p_destination,p_choices,p_at);end if;
 select jsonb_agg(l.value||jsonb_build_object('good_id',owner.id,'origin_id',owner.origin_id,'fee_type',owner.shipping_fee_type,'individual_fee',owner.individual_fee) order by l.ordinality)
 into lines from jsonb_array_elements(p_lines) with ordinality l(value,ordinality)
 join public.goods owner on owner.id=private.goods_aggregation_owner(l.value->>'good_id');
 -- Choices are keyed by actual selected IDs. A shared charge cannot be both collect and prepaid.
 for selected in select distinct good_id from jsonb_to_recordset(p_lines) l(good_id text) order by good_id loop
  root_id:=private.goods_aggregation_owner(selected.good_id);
  select d.payment_mode into delivery_mode from private.goods_transaction_configs c join private.goods_delivery_versions d on d.id=c.delivery_version_id
   where c.good_id=root_id and d.status='active';
  selected_mode:=coalesce(p_choices->>selected.good_id,case when delivery_mode='collect' then 'collect' else 'prepaid' end);
  if choices ? root_id and choices->>root_id<>selected_mode then
   return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','delivery_choice_required','goodId',selected.good_id)));end if;
  choices:=choices||jsonb_build_object(root_id,selected_mode);
 end loop;
 calculation:=private.calculate_goods_transaction_shipping_families_base(lines,p_destination,choices,p_at);
 if calculation->>'state'='blocked' then
  -- Do not disclose an unselected/unpublished owner's catalog identity in errors.
  select jsonb_agg(value||jsonb_build_object('goodId',case when value->>'goodId' is null then null else
   (select min(l.good_id) from jsonb_to_recordset(p_lines) l(good_id text) where private.goods_aggregation_owner(l.good_id)=value->>'goodId') end))
  into components from jsonb_array_elements(calculation->'issues');
  return jsonb_set(calculation,'{issues}',components);
 end if;
 for raw_group in select value from jsonb_array_elements(calculation->'rawGroups') loop
  components:='[]';delivery_terms:='[]';
  for component in select value from jsonb_array_elements(raw_group->'components') loop
   select value into terms from jsonb_array_elements(raw_group->'deliveryTerms') where value->>'goodId'=component->>'goodId';
   select sum(qty::numeric*unit_price) into family_subtotal from jsonb_to_recordset(p_lines) l(good_id text,qty integer,unit_price bigint)
    where private.goods_aggregation_owner(good_id)=component->>'goodId';
   select jsonb_agg(jsonb_build_object('id',good_id,'weight',weight) order by good_id) into weights from
    (select good_id,sum(case when family_subtotal>0 then qty::numeric*unit_price else qty::numeric end) weight
     from jsonb_to_recordset(p_lines) l(good_id text,qty integer,unit_price bigint)
     where private.goods_aggregation_owner(good_id)=component->>'goodId' group by good_id) grouped;
   base_alloc:=private.allocate_transaction_amount((component->>'baseFee')::numeric,weights);
   regional_alloc:=private.allocate_transaction_amount((component->>'regionalFee')::numeric,weights);
   for member in select jsonb_build_object('goodId',good_id,'qty',sum(qty::numeric),'subtotal',sum(qty::numeric*unit_price))
    from jsonb_to_recordset(p_lines) l(good_id text,qty integer,unit_price bigint)
    where private.goods_aggregation_owner(good_id)=component->>'goodId' group by good_id order by good_id loop
    expanded:=component||jsonb_build_object('goodId',member->>'goodId','baseFee',(base_alloc->>(member->>'goodId'))::numeric,
     'regionalFee',(regional_alloc->>(member->>'goodId'))::numeric,
     'totalFee',(base_alloc->>(member->>'goodId'))::numeric+(regional_alloc->>(member->>'goodId'))::numeric);
    components:=components||jsonb_build_array(expanded);
    delivery_terms:=delivery_terms||jsonb_build_array(terms||member);
   end loop;
  end loop;
  raw_groups:=raw_groups||jsonb_build_array(raw_group||jsonb_build_object('components',components,'deliveryTerms',delivery_terms));
  display_groups:=display_groups||jsonb_build_array(jsonb_build_object('originId',raw_group->'originId','prepaidFee',raw_group->'prepaidFee',
   'collectFee',raw_group->'collectFee','fullFee',raw_group->'fullFee','components',components,'collector',raw_group->'collector'));
 end loop;
 return calculation||jsonb_build_object('rawGroups',raw_groups,'displayGroups',display_groups);
end $$;

CREATE OR REPLACE FUNCTION private.goods_transaction_base_shipping_quote(p_items jsonb, p_legacy_quote jsonb, p_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$declare lines jsonb;begin
 if not exists(select 1 from jsonb_to_recordset(p_items) i("goodId" text) join private.goods_aggregation_members m on m.good_id=i."goodId") and not exists(select 1 from jsonb_to_recordset(p_items) item("goodId" text,"variantId" uuid,qty integer)
  join private.goods_transaction_configs c on c.good_id=private.goods_aggregation_owner(item."goodId")
  join private.goods_delivery_versions d on d.id=c.delivery_version_id where d.status='active' and d.quantity_terms is not null) then return p_legacy_quote;end if;
 select jsonb_agg(jsonb_build_object('origin_id',grouped.origin_id,'good_id',grouped.good_id,'qty',1,'unit_price',grouped.subtotal,
  'fee_type',case when grouped.quantity_terms is null then grouped.shipping_fee_type else 'individual' end,
  'individual_fee',case when grouped.quantity_terms is null then grouped.individual_fee else private.goods_quantity_delivery_fee(grouped.qty,grouped.quantity_terms) end))
 into lines from(select good.id good_id,good.origin_id,good.shipping_fee_type,good.individual_fee,d.quantity_terms,
   sum(item.qty::numeric) qty,sum(item.qty::numeric*pricing.effective_price) subtotal
  from jsonb_to_recordset(p_items) item("goodId" text,"variantId" uuid,qty integer)
  join public.goods good on good.id=private.goods_aggregation_owner(item."goodId") join public.goods_variants variant on variant.id=item."variantId" and variant.good_id=item."goodId"
  cross join lateral private.resolve_goods_variant_price(variant.id,p_at) pricing
  left join private.goods_transaction_configs c on c.good_id=good.id
  left join private.goods_delivery_versions d on d.id=c.delivery_version_id and d.status='active'
  group by good.id,good.origin_id,good.shipping_fee_type,good.individual_fee,d.quantity_terms) grouped;
 return private.calculate_goods_shipping(lines);
end $function$;

CREATE OR REPLACE FUNCTION private.guard_order_transaction_terms()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare version integer;begin
 select calculation_version into version from public.orders where id=new.order_id;
 if version=2 then
  if not exists(select 1 from private.order_goods_transactions where order_id=new.order_id) then
   raise check_violation using message='transaction_order_binding_required';end if;
 elsif exists(select 1 from private.goods_aggregation_members where good_id=new.good_id) then
  raise check_violation using message='checkout_contract_upgrade_required';
 elsif exists(select 1 from private.goods_transaction_configs c left join private.goods_volume_discount_versions v on v.id=c.volume_version_id
  left join private.goods_delivery_versions d on d.id=c.delivery_version_id where c.good_id=new.good_id and (v.status='active' or d.status='active')) then
  raise check_violation using message='checkout_contract_upgrade_required';
 elsif new.volume_unit_discount<>0 or new.volume_discount_total<>0 then raise check_violation using message='transaction_order_binding_required';end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.place_order(p_address jsonb, p_checkout_key uuid, p_payment_method order_payment_method)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare order_key uuid;
begin
  if not exists(select 1 from public.orders where user_id=auth.uid() and checkout_key=p_checkout_key)
   and exists(select 1 from public.cart_items cart join private.goods_aggregation_members family on family.good_id=cart.good_id where cart.user_id=auth.uid()) then
   raise check_violation using message='checkout_contract_upgrade_required';end if;
  order_key:=private.place_order_before_shipments(p_address,p_checkout_key,p_payment_method);
  perform private.create_order_shipments(order_key);
  return order_key;
end $function$;

CREATE OR REPLACE FUNCTION private.goods_transaction_terms_document(p_good_id text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('goodId',g.id,'revision',coalesce(c.revision,0),'goodUpdatedAt',g.updated_at,
  'volume',case when v.id is null then null else jsonb_build_object('id',v.id,'goodId',g.id,'revision',v.revision,'status',v.status,'terms',v.terms,'draftValues',v.draft_values) end,
  'delivery',case when d.id is null then null else jsonb_build_object('id',d.id,'goodId',g.id,'revision',d.revision,'status',d.status,
   'paymentMode',d.payment_mode,'quantityTerms',d.quantity_terms,'draftValues',d.draft_values) end)
 from public.goods g left join private.goods_transaction_configs c on c.good_id=private.goods_aggregation_owner(g.id)
 left join private.goods_volume_discount_versions v on v.id=c.volume_version_id
 left join private.goods_delivery_versions d on d.id=c.delivery_version_id where g.id=p_good_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_goods_transaction_offers(p_good_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$declare result jsonb;begin
 if p_good_ids is null or cardinality(p_good_ids)>1000 or array_position(p_good_ids,null) is not null
  or exists(select 1 from unnest(p_good_ids) id where char_length(id) not between 1 and 200 or id<>btrim(id) or id~'[[:cntrl:]]') then
  raise invalid_parameter_value using message='invalid_goods_transaction_offer_ids';end if;
 select coalesce(jsonb_agg(jsonb_build_object('goodId',g.id,
  'volume',case when v.status='active' then jsonb_build_object('id',v.id,'goodId',g.id,'revision',v.revision,'status',v.status,'terms',v.terms,'draftValues','{}'::jsonb) end,
  'delivery',case when d.status='active' then jsonb_build_object('id',d.id,'goodId',g.id,'revision',d.revision,'status',d.status,
   'paymentMode',d.payment_mode,'quantityTerms',d.quantity_terms,'draftValues','{}'::jsonb) end,
  'collectReady',coalesce(contract.status='active' and origin.is_active,false),
  'collector',case when contract.status='active' and origin.is_active then jsonb_build_object('name',contract.contract_values->>'collectorName',
   'method',contract.contract_values->>'collectionMethod','refundContact',contract.contract_values->>'refundContact','instructions',contract.contract_values->>'customerInstructions') end)
  ||case when family.aggregation_id is null then '{}'::jsonb else jsonb_build_object('aggregation',jsonb_build_object('id',family.aggregation_id,'requiresV2',true,
   'runtimeEnabled',(select enabled from private.goods_transaction_runtime where singleton)),'sharedPolicy',private.goods_aggregation_shared_policy(g.id)) end
  order by g.id),'[]') into result from public.goods g join public.ips ip on ip.id=g.ip_id
  left join private.goods_aggregation_members member on member.good_id=g.id
  left join private.goods_aggregation_roots family on family.root_good_id=member.root_good_id
  join public.goods owner_good on owner_good.id=coalesce(member.root_good_id,g.id)
  left join private.goods_transaction_configs c on c.good_id=owner_good.id left join private.goods_volume_discount_versions v on v.id=c.volume_version_id
  left join private.goods_delivery_versions d on d.id=c.delivery_version_id left join public.fulfillment_origins origin on origin.id=owner_good.origin_id
  left join private.shipping_collect_contracts collector on collector.origin_id=origin.id
  left join private.shipping_collect_contract_versions contract on contract.id=collector.version_id
 where g.id=any(p_good_ids) and g.published_at is not null and g.archived_at is null and g.sale_restriction='none'
  and ip.published_at is not null and ip.archived_at is null;
 return result;
end $function$;

-- All family state is internal; preserve existing function owners and ACLs.
alter table private.goods_aggregation_roots enable row level security;
alter table private.goods_aggregation_members enable row level security;
revoke all on private.goods_aggregation_roots,private.goods_aggregation_members from public,anon,authenticated,service_role;
grant select on private.goods_aggregation_roots,private.goods_aggregation_members to postgres;
do $$declare fn regprocedure;begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname=any(array['goods_aggregation_owner','guard_goods_aggregation_identity','bind_goods_aggregation',
   'goods_aggregation_shared_policy','guard_goods_aggregation_policy','guard_goods_aggregation_config','calculate_goods_transaction_shipping_families_base']) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
  execute format('grant execute on function %s to postgres',fn);
  perform private.register_operator_internal_contract(fn);
 end loop;
 -- Existing internals are re-registered after their bodies change.
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname=any(array['member_goods_reserved_qty','check_goods_purchase_quantity','lock_goods_transaction_catalog',
   'calculate_goods_transaction_locked','evaluate_coupon_target_lines_at','calculate_goods_transaction_shipping','goods_transaction_base_shipping_quote',
   'guard_order_transaction_terms','goods_transaction_terms_document']) loop
  perform private.register_operator_internal_contract(fn);
 end loop;
end $$;
select private.register_operator_internal_contract('public.get_goods_transaction_offers(text[])'::regprocedure);
select private.register_operator_internal_contract('public.place_order(jsonb,uuid,public.order_payment_method)'::regprocedure);
revoke all on function public.admin_get_goods_aggregation(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_goods_aggregation(text) to authenticated;
select private.register_operator_rpc_contract('public.admin_get_goods_aggregation(text)'::regprocedure,'catalog.manage','read',false);
notify pgrst,'reload schema';
