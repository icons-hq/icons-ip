-- DRAFT: group physical fulfillment by purchased method without changing the
-- transport-price calculation for existing parcel contracts.
begin;
alter table public.order_shipments drop constraint order_shipments_order_id_origin_id_key;
alter table public.order_shipments add column fulfillment_partition text not null default 'parcel';
alter table public.order_shipments add constraint shipment_partition_known check(fulfillment_partition in('parcel','quick','pickup','direct','freight','none','digital'));
alter table public.order_shipments add constraint shipment_order_origin_partition_key unique(order_id,origin_id,fulfillment_partition);
alter table public.order_shipments drop constraint order_shipments_delivery_method_check;
alter table public.order_shipments add constraint order_shipments_delivery_method_check check(delivery_method in('parcel','quick','pickup','direct','freight','none','digital'));
alter table private.fulfillment_delivery_policies drop constraint fulfillment_delivery_policies_method_check;
alter table private.fulfillment_delivery_policies add constraint fulfillment_delivery_policies_method_check check(method in('quick','pickup','direct','freight','none'));
alter table public.order_shipments drop constraint shipment_delivery_policy_consistent;
alter table public.order_shipments add constraint shipment_delivery_policy_consistent check(
 (delivery_method='parcel' and delivery_policy_id is null and delivery_method_snapshot is null)
 or(delivery_method in('quick','pickup','direct','freight','none') and delivery_policy_id is not null and jsonb_typeof(delivery_method_snapshot)='object' and delivery_selection_id is not null)
 or(delivery_method='digital' and delivery_policy_id is null and delivery_method_snapshot->>'version'='2' and delivery_method_snapshot->>'confirmationRule'='protected_download' and delivery_selection_id is not null));
alter table private.shipment_delivery_operations drop constraint shipment_delivery_operations_kind_check;
alter table private.shipment_delivery_operations add constraint shipment_delivery_operations_kind_check check(kind in('method_selected','quick_handoff','quick_receive','pickup_receive','direct_handoff','direct_receive','freight_handoff','freight_receive','none_receive','digital_access'));
alter table private.shipping_charge_components add column installation_fee bigint not null default 0 check(installation_fee>=0);
alter table private.shipping_charge_components drop constraint shipping_charge_components_check;
alter table private.shipping_charge_components add constraint shipping_charge_components_check check(total_fee=base_fee+regional_fee+installation_fee);

create function private.goods_fulfillment_selected_terms(p_good text,p_choice jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare config private.goods_fulfillment_settings;method text;terms jsonb;begin
 select * into config from private.goods_fulfillment_settings where good_id=p_good;
 if not found then
  if jsonb_typeof(p_choice)='object' and p_choice->>'method'<>'parcel' then return jsonb_build_object('invalid',true);end if;return null;
 end if;
 method:=case when jsonb_typeof(p_choice)='object' then p_choice->>'method' when jsonb_array_length(config.methods)=1 then config.methods->0->>'method' end;
 select value into terms from jsonb_array_elements(config.methods) where value->>'method'=method;
 if terms is null or method<>'parcel' and coalesce(case when jsonb_typeof(p_choice)='object' then p_choice->>'paymentMode' else p_choice#>>'{}' end,'prepaid')<>'prepaid' then return jsonb_build_object('invalid',true);end if;
 return jsonb_build_object('version',1,'goodId',p_good,'revision',config.revision,'mode',config.mode,'method',method,'terms',terms,'files',private.digital_file_metadata(config.asset_ids),'publicNote',config.public_note);
end $$;
create or replace function private.normalize_goods_transaction_choices(p_choices jsonb,p_selection jsonb) returns jsonb language plpgsql immutable set search_path='' as $$begin
 if jsonb_typeof(p_choices) is distinct from 'object' or exists(select 1 from jsonb_each(p_choices)e where not exists(select 1 from jsonb_array_elements(p_selection)r where r->>'goodId'=e.key)
  or not(jsonb_typeof(e.value)='string' and e.value#>>'{}' in('prepaid','collect') or private.transaction_json_keys(e.value,array['method','paymentMode'])
   and e.value->>'method' in('parcel','quick','pickup','direct','freight','none','digital') and e.value->>'paymentMode' in('prepaid','collect'))) then raise invalid_parameter_value using message='invalid_delivery_choices';end if;
 return p_choices;
end $$;
alter function private.calculate_goods_transaction_shipping(jsonb,jsonb,jsonb,timestamptz) rename to calculate_shipping_before_fulfillment;
create function private.calculate_goods_transaction_shipping(p_lines jsonb,p_destination jsonb,p_choices jsonb,p_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare line jsonb;selection jsonb;selected jsonb:='{}';method text;mode text;parcel_lines jsonb:='[]';parcel_choices jsonb:='{}';other_lines jsonb:='[]';
 legacy jsonb;raw jsonb;raws jsonb:='[]';components jsonb;component jsonb;installation numeric;quantity numeric;prepaid numeric:=0;collect numeric:=0;group_prepaid numeric;group_collect numeric;
 group_key record;origin public.fulfillment_origins;policy private.fulfillment_delivery_policies;delivery_policy jsonb;terms jsonb;delivery_terms jsonb;amount numeric;next_change timestamptz;
begin
 for line in select value from jsonb_array_elements(p_lines) loop
  selection:=private.goods_fulfillment_selected_terms(line->>'good_id',p_choices->(line->>'good_id'));
  if selection->>'invalid'='true' then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','delivery_choice_required','goodId',line->>'good_id')));end if;
  method:=coalesce(selection->>'method','parcel');selected:=selected||jsonb_build_object(line->>'good_id',selection);
  if method in('parcel','quick','direct','freight') and (p_destination->>'postalCode' is null or p_destination->>'address1' is null) then
   return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','address_required','goodId',line->>'good_id')));end if;
  if method='parcel' then
   parcel_lines:=parcel_lines||jsonb_build_array(line);
   if p_choices ? (line->>'good_id') then parcel_choices:=parcel_choices||jsonb_build_object(line->>'good_id',case when jsonb_typeof(p_choices->(line->>'good_id'))='object' then p_choices#>>array[line->>'good_id','paymentMode'] else p_choices->>(line->>'good_id') end);end if;
  else other_lines:=other_lines||jsonb_build_array(line||jsonb_build_object('method',method));end if;
 end loop;
 if jsonb_array_length(parcel_lines)>0 then
  legacy:=private.calculate_shipping_before_fulfillment(parcel_lines,p_destination,parcel_choices,p_at);
  if legacy->>'state'='blocked' then return legacy;end if;
  next_change:=(legacy->>'nextChangeAt')::timestamptz;
  for raw in select value from jsonb_array_elements(legacy->'rawGroups') loop
   components:='[]';group_prepaid:=(raw->>'prepaidFee')::numeric;group_collect:=(raw->>'collectFee')::numeric;
   for component in select value from jsonb_array_elements(raw->'components') loop
    select sum((l->>'qty')::numeric) into quantity from jsonb_array_elements(parcel_lines)l where l->>'good_id'=component->>'goodId';
    installation:=coalesce((selected#>>array[component->>'goodId','terms','installationFee'])::numeric,0)*quantity;
    component:=component||jsonb_build_object('installationFee',installation,'totalFee',(component->>'totalFee')::numeric+installation);
    components:=components||jsonb_build_array(component);group_prepaid:=group_prepaid+installation;
   end loop;
   raw:=raw||jsonb_build_object('deliveryMethod','parcel','deliveryPolicy',null,'components',components,'prepaidFee',group_prepaid,'totalFee',group_prepaid,'fullFee',group_prepaid+group_collect);
   raws:=raws||jsonb_build_array(raw);prepaid:=prepaid+group_prepaid;collect:=collect+group_collect;
  end loop;
 end if;
 for group_key in select distinct l->>'origin_id' origin_id,l->>'method' method from jsonb_array_elements(other_lines)l order by 1,2 loop
  select * into origin from public.fulfillment_origins where id=group_key.origin_id::uuid and is_active;
  if not found then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','shipping_unresolved','goodId',null)));end if;
  if group_key.method<>'digital' then
   select p.* into policy from private.fulfillment_delivery_policies p where p.origin_id=origin.id and p.method=group_key.method and p.state='active';
   if not found then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','shipping_unresolved','goodId',null)));end if;
   delivery_policy:=(policy.terms-'approvalReference')||jsonb_build_object('version',2,'policyId',policy.id,'revision',policy.revision,'feeRule','checkout_prepaid','confirmationRule','recipient_code');
  else delivery_policy:=jsonb_build_object('version',2,'feeRule','checkout_prepaid','confirmationRule','protected_download');end if;
  components:='[]';delivery_terms:='[]';group_prepaid:=0;
  for line in select jsonb_build_object('goodId',l->>'good_id','qty',sum((l->>'qty')::numeric),'subtotal',sum((l->>'qty')::numeric*(l->>'unit_price')::numeric))
   from jsonb_array_elements(other_lines)l where l->>'origin_id'=group_key.origin_id and l->>'method'=group_key.method group by l->>'good_id' order by l->>'good_id' loop
   terms:=selected->(line->>'goodId');quantity:=(line->>'qty')::numeric;
   amount:=(terms#>>'{terms,feeAmount}')::numeric*case when terms#>>'{terms,feeBasis}'='per_item' then quantity else 1 end;
   installation:=(terms#>>'{terms,installationFee}')::numeric*quantity;
   components:=components||jsonb_build_array(jsonb_build_object('goodId',line->>'goodId','paymentMode','prepaid','baseFee',amount,'regionalFee',0,'installationFee',installation,'totalFee',amount+installation,'deliveryPolicyId',null));
   delivery_terms:=delivery_terms||jsonb_build_array(line||jsonb_build_object('fulfillment',terms));group_prepaid:=group_prepaid+amount+installation;
  end loop;
  raw:=jsonb_build_object('calculationVersion',2,'originId',origin.id,'originCode',origin.code,'originName',origin.name,'deliveryMethod',group_key.method,'deliveryPolicy',delivery_policy,
   'totalFee',group_prepaid,'prepaidFee',group_prepaid,'collectFee',0,'fullFee',group_prepaid,'components',components,'collector',null,'collectContractId',null,'collectContractSnapshot',null,
   'deliveryTerms',delivery_terms,'regionMode','not_applicable','regionalFee',0,'policyId',null,'policyVersion',null,'regionStatus','not_applicable');
  raws:=raws||jsonb_build_array(raw);prepaid:=prepaid+group_prepaid;
 end loop;
 if prepaid+collect>9007199254740991 then raise numeric_value_out_of_range;end if;
 return jsonb_build_object('state','calculated','prepaidFee',prepaid,'collectFee',collect,'rawGroups',raws,
  'displayGroups',(select coalesce(jsonb_agg(private.shipping_charge_group_display(r)),'[]') from jsonb_array_elements(raws)r),'nextChangeAt',next_change);
end $$;
create or replace function private.shipping_charge_group_display(p_raw_group jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('originId',p_raw_group->'originId','prepaidFee',p_raw_group->'prepaidFee','collectFee',p_raw_group->'collectFee','fullFee',p_raw_group->'fullFee','components',p_raw_group->'components','collector',p_raw_group->'collector')
 ||case when p_raw_group ? 'chargeDetails' then jsonb_build_object('chargeDetails',p_raw_group->'chargeDetails') else '{}'::jsonb end
 ||case when p_raw_group ? 'deliveryMethod' then jsonb_build_object('deliveryMethod',p_raw_group->'deliveryMethod','deliveryPolicy',p_raw_group->'deliveryPolicy') else '{}'::jsonb end;
$$;
create function private.fulfillment_item_guard() returns trigger language plpgsql security definer set search_path='' as $$declare expected jsonb;begin
 if tg_op='UPDATE' then if new.fulfillment_terms_snapshot is distinct from old.fulfillment_terms_snapshot then raise check_violation using message='fulfillment_terms_immutable';end if;return new;end if;
 expected:=private.goods_fulfillment_selected_terms(new.good_id,case when new.fulfillment_terms_snapshot is null then null else jsonb_build_object('method',new.fulfillment_terms_snapshot->>'method','paymentMode','prepaid') end);
 if expected is not null and expected->>'invalid'='true' or expected is distinct from new.fulfillment_terms_snapshot then raise check_violation using message='fulfillment_terms_changed';end if;
 if expected is not null and (select calculation_version from public.orders where id=new.order_id) is distinct from 2 then raise check_violation using message='fulfillment_requires_transaction';end if;
 return new;
end $$;
create trigger fulfillment_item_guard before insert or update on public.order_items for each row execute function private.fulfillment_item_guard();
create function private.digital_supply_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 if (tg_table_name='goods_production_settings' and (to_jsonb(new)->>'enabled')::boolean or tg_table_name='goods_variants' and to_jsonb(new)->>'preorder_policy_id' is not null)
  and exists(select 1 from private.goods_fulfillment_settings where good_id=to_jsonb(new)->>'good_id' and mode='digital') then raise check_violation using message='digital_supply_conflict';end if;return new;
end $$;
create trigger digital_production_guard before insert or update on private.goods_production_settings for each row execute function private.digital_supply_guard();
create trigger digital_preorder_guard before insert or update of preorder_policy_id on public.goods_variants for each row execute function private.digital_supply_guard();

-- GENERATED CONTRACT ADAPTERS
CREATE OR REPLACE FUNCTION private.normalize_goods_transaction_address(p_address jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$declare name text;phone text;postal text;address1 text;begin
 if p_address='{"kind":"none"}'::jsonb then return p_address;end if;
 if jsonb_typeof(p_address) is distinct from 'object' or not(p_address ?& array['recipientName','phone','postalCode','address1'])
  or p_address-array['recipientName','phone','postalCode','address1','address2','deliveryNote']<>'{}'::jsonb
  or exists(select 1 from jsonb_each(p_address) e where jsonb_typeof(e.value) is distinct from 'string'
   or (e.value#>>'{}')<>btrim(e.value#>>'{}') or (e.value#>>'{}')~'[[:cntrl:]]') then
  raise invalid_parameter_value using message='invalid_checkout_address';end if;
 name:=p_address->>'recipientName';phone:=p_address->>'phone';postal:=p_address->>'postalCode';address1:=p_address->>'address1';
 if char_length(name) not between 1 and 50 or phone!~'^[0-9]{8,15}$' or postal!~'^[0-9]{5}$'
  or char_length(address1) not between 1 and 200 or char_length(coalesce(p_address->>'address2',''))>200
  or char_length(coalesce(p_address->>'deliveryNote',''))>200 then raise invalid_parameter_value using message='invalid_checkout_address';end if;
 return jsonb_build_object('recipientName',name,'phone',phone,'postalCode',postal,'address1',address1,
  'address2',coalesce(p_address->>'address2',''),'deliveryNote',coalesce(p_address->>'deliveryNote',''));
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
 perform private.lock_goods_transaction_catalog(p_actor,selection,quoted.user_coupon_id);
 perform private.assert_goods_transaction_runtime();
 at_time:=clock_timestamp();
 if quoted.expires_at<=at_time then raise sqlstate 'PT409' using message='transaction_quote_expired';end if;
 calculation:=private.calculate_goods_transaction_locked(p_actor,selection,address,quoted.delivery_choices,quoted.user_coupon_id,quoted.store_credit_amount,at_time,quoted.line_ids,order_id);
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
   where order_shipments.order_id=transaction_place.order_id and origin_id=(raw_group->>'originId')::uuid and fulfillment_partition=coalesce(raw_group->>'deliveryMethod','parcel') returning id into shipment_id;
  for component in select value from jsonb_array_elements(raw_group->'components') loop
   select value into delivery_terms from jsonb_array_elements(raw_group->'deliveryTerms') where value->>'goodId'=component->>'goodId';
   insert into private.shipping_charge_components(order_id,shipment_id,good_id,origin_id,calculation_version,payment_mode,base_fee,regional_fee,total_fee,installation_fee,
    delivery_policy_id,collect_contract_id,terms_snapshot)
   values(order_id,shipment_id,component->>'goodId',(raw_group->>'originId')::uuid,2,component->>'paymentMode',(component->>'baseFee')::bigint,
    (component->>'regionalFee')::bigint,(component->>'totalFee')::bigint,coalesce((component->>'installationFee')::bigint,0),(component->>'deliveryPolicyId')::uuid,(raw_group->>'collectContractId')::uuid,
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
  and (select count(*) from private.shipping_charge_components where order_id=purchase.id)=
   (select count(distinct good_id) from public.order_items where order_id=purchase.id));
$function$

;
CREATE OR REPLACE FUNCTION private.goods_transaction_public_shipping(p_source_kind text, p_raw_groups jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(case when value ? 'chargeDetails' then jsonb_build_object('calculationVersion',2,'originId',value->'originId',
  'originName',value->'originName','totalFee',value->'totalFee','prepaidFee',value->'prepaidFee','collectFee',value->'collectFee','fullFee',value->'fullFee',
  'components',value->'components','collector',value->'collector','chargeDetails',private.shipping_charge_group_safe_details(value->'chargeDetails'))
 when p_source_kind='gift' then jsonb_build_object('calculationVersion',2,'originId',value->'originId',
  'originName',value->'originName','totalFee',value->'totalFee','prepaidFee',value->'prepaidFee','collectFee',value->'collectFee','fullFee',value->'fullFee',
  'components',value->'components','collector',value->'collector')
 else value-array['collectContractSnapshot','collectContractId','deliveryTerms'] end ||case when value ? 'deliveryMethod' then jsonb_build_object('deliveryMethod',value->'deliveryMethod','deliveryPolicy',value->'deliveryPolicy') else '{}'::jsonb end order by value->>'originId',value->>'deliveryMethod'),'[]')
 from jsonb_array_elements(p_raw_groups);
$function$

;
CREATE OR REPLACE FUNCTION public.admin_save_delivery_policy(p_origin_id uuid, p_method text, p_policy_id uuid, p_values jsonb, p_expected_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); policy private.fulfillment_delivery_policies; values_object jsonb:='{}'; field text; state_value text;
  origin public.fulfillment_origins; instant timestamptz:=clock_timestamp();
begin
  perform private.require_operator_capability('platform.manage',true);

  if actor is null or not public.has_operator_capability('platform.manage',true) or not exists(select 1 from public.profiles where id=actor and private.has_operator_capability(id,'platform.manage',true)) then
    raise insufficient_privilege using message='admin_required'; end if;
  if p_method is null or p_method not in ('quick','pickup','direct','freight','none') or jsonb_typeof(p_values) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_values) key where key not in ('state','contactName','contactPhone','handoffLocation','handoffInstructions',
      'appointmentInstructions','allowDelegate','completionInstructions','cancellationInstructions','approvalReference')) then
    raise invalid_parameter_value using message='invalid_delivery_policy'; end if;
  state_value:=p_values->>'state';
  if state_value is null or state_value not in ('draft','active','stopped') then raise invalid_parameter_value using message='invalid_delivery_policy'; end if;
  select * into origin from public.fulfillment_origins where id=p_origin_id for update;
  if not found then raise no_data_found using message='fulfillment_origin_not_found'; end if;
  if p_policy_id is not null then
    select * into policy from private.fulfillment_delivery_policies where id=p_policy_id and origin_id=p_origin_id and method=p_method for update;
    if not found then raise no_data_found using message='delivery_policy_not_found'; end if;
    if p_expected_revision is null or policy.revision<>p_expected_revision then raise sqlstate 'PT409' using message='delivery_policy_changed'; end if;
  elsif p_expected_revision is not null or state_value='stopped' then raise invalid_parameter_value using message='invalid_delivery_policy'; end if;
  if state_value='stopped' then values_object:=policy.terms;
  else
    foreach field in array array['contactName','contactPhone','handoffLocation','handoffInstructions','appointmentInstructions',
      'completionInstructions','cancellationInstructions','approvalReference'] loop
      if p_values?field and jsonb_typeof(p_values->field) not in ('null','string') then raise invalid_parameter_value using message='invalid_delivery_policy'; end if;
      values_object:=values_object||jsonb_build_object(field,nullif(btrim(p_values->>field),''));
    end loop;
    values_object:=values_object||jsonb_build_object('allowDelegate',coalesce(p_values->'allowDelegate','null'::jsonb));
    if not private.valid_delivery_policy_terms(values_object,state_value='active') then
      raise check_violation using message='delivery_policy_incomplete'; end if;
  end if;
  if state_value='active' and not origin.is_active then raise check_violation using message='delivery_policy_unavailable'; end if;
  if policy.activated_at is not null and (values_object is distinct from policy.terms or state_value not in ('active','stopped')
    or (policy.state='stopped' and state_value<>'stopped')) then raise check_violation using message='activated_delivery_policy_immutable'; end if;
  if state_value='active' and exists(select 1 from private.fulfillment_delivery_policies existing where existing.origin_id=p_origin_id
    and existing.method=p_method and existing.state='active' and existing.id is distinct from p_policy_id) then
    raise check_violation using message='delivery_policy_already_active'; end if;
  if p_policy_id is null then
    insert into private.fulfillment_delivery_policies(origin_id,method,state,terms,created_by,updated_by,activated_at)
    values(p_origin_id,p_method,state_value,values_object,actor,actor,case when state_value='active' then instant end) returning * into policy;
  else
    if policy.state=state_value and policy.terms=values_object then return jsonb_build_object('id',policy.id,'revision',policy.revision,'changed',false); end if;
    update private.fulfillment_delivery_policies set state=state_value,terms=values_object,revision=revision+1,updated_by=actor,updated_at=instant,
      activated_at=case when state_value='active' then coalesce(activated_at,instant) else activated_at end,
      stopped_at=case when state_value='stopped' then coalesce(stopped_at,instant) else stopped_at end where id=policy.id returning * into policy;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.fulfillment_delivery_policy.saved','origin:'||p_origin_id,
    jsonb_build_object('policyId',policy.id,'method',p_method,'state',state_value,'revision',policy.revision));
  return jsonb_build_object('id',policy.id,'revision',policy.revision,'changed',true);
end $function$

;
CREATE OR REPLACE FUNCTION public.admin_record_shipment_delivery(p_shipment_id uuid, p_kind text, p_evidence jsonb, p_receipt_code text, p_expected_updated_at timestamp with time zone, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); shipment public.order_shipments; purchase public.orders; operation private.shipment_delivery_operations;
  confirmation private.shipment_receipt_confirmations; evidence jsonb:='{}'; field text; allowed_fields text[]; occurred timestamptz;
  value text; confirmation_value text:=upper(regexp_replace(coalesce(p_receipt_code,''),'[[:space:]-]','','g'));
  fingerprint bytea; instant timestamptz; next_status text; max_length integer;
begin
  perform private.require_operator_capability('sales.manage',false);

  if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
  if p_operation_id is null or p_kind is null or p_kind not in ('quick_handoff','quick_receive','pickup_receive','direct_handoff','direct_receive','freight_handoff','freight_receive','none_receive')
    or jsonb_typeof(p_evidence) is distinct from 'object' then raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
  allowed_fields:=case when p_kind in('quick_handoff','direct_handoff','freight_handoff') then array['operatorName','providerName','providerPhone','handoffReference','occurredAt']
    else array['operatorName','receiptReference','recipientKind','occurredAt'] end;
  if exists(select 1 from jsonb_object_keys(p_evidence) key where not key=any(allowed_fields)) then
    raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
  foreach field in array allowed_fields loop
    if jsonb_typeof(p_evidence->field) is distinct from 'string' then raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
    value:=btrim(p_evidence->>field);
    max_length:=case when field in ('operatorName','providerName') then 100 when field='providerPhone' then 40 else 2000 end;
    if length(value) not between 1 and max_length then raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
    evidence:=evidence||jsonb_build_object(field,value);
  end loop;
  if evidence->>'occurredAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
    raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
  begin occurred:=(evidence->>'occurredAt')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then raise invalid_parameter_value using message='invalid_delivery_evidence'; end;
  evidence:=evidence||jsonb_build_object('occurredAt',occurred);
  if p_kind not in('quick_handoff','direct_handoff','freight_handoff') and (evidence->>'recipientKind' not in ('self','delegate') or confirmation_value!~'^[0-9A-F]{12}$') then
    raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
  if p_kind in('quick_handoff','direct_handoff','freight_handoff') and confirmation_value<>'' then raise invalid_parameter_value using message='invalid_delivery_evidence'; end if;
  select purchase_row.* into purchase from public.orders purchase_row join public.order_shipments shipment_row on shipment_row.order_id=purchase_row.id
    where shipment_row.id=p_shipment_id for update of purchase_row;
  if not found then raise no_data_found using message='shipment_not_found'; end if;
  select * into shipment from public.order_shipments where id=p_shipment_id for update;
  instant:=clock_timestamp();
  fingerprint:=extensions.digest(jsonb_build_object('actor',actor,'kind',p_kind,'evidence',evidence,'expectedAt',p_expected_updated_at,
    'receiptDigest',case when confirmation_value<>'' then encode(extensions.digest(confirmation_value,'sha256'),'hex') end)::text,'sha256');
  select * into operation from private.shipment_delivery_operations where id=p_operation_id;
  if found then
    if operation.shipment_id<>shipment.id or operation.kind<>p_kind or operation.actor_id is distinct from actor
      or operation.request_digest is distinct from fingerprint then raise sqlstate 'PT409' using message='delivery_operation_conflict'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'shipmentId',shipment.id);
  end if;
  if split_part(p_kind,'_',1)<>shipment.delivery_method then raise check_violation using message='delivery_method_evidence_required';end if;
  if p_expected_updated_at is null or shipment.updated_at<>p_expected_updated_at then raise sqlstate 'PT409' using message='shipment_delivery_changed'; end if;
  if purchase.status not in ('confirmed','shipping') or not ((shipment.delivery_method in('quick','direct','freight') and shipment.status='ready' and p_kind in('quick_handoff','direct_handoff','freight_handoff'))
    or (shipment.delivery_method in('quick','direct','freight') and shipment.status='shipping' and p_kind in('quick_receive','direct_receive','freight_receive'))
    or (shipment.delivery_method in('pickup','none') and shipment.status='ready' and p_kind in('pickup_receive','none_receive'))) then
    raise check_violation using message='delivery_method_evidence_required'; end if;
  if p_kind not in('quick_receive','direct_receive','freight_receive') then perform private.assert_order_dispatch_allowed(purchase.id);end if;
  perform private.assert_shipment_preorder_ready(shipment.id);
  if occurred>instant or occurred<greatest(shipment.created_at,coalesce(purchase.confirmed_at,shipment.created_at))
    or (p_kind in('quick_receive','direct_receive','freight_receive') and occurred<shipment.shipped_at) then raise check_violation using message='invalid_delivery_evidence'; end if;
  if evidence->>'recipientKind'='delegate' and shipment.delivery_method_snapshot->'allowDelegate' is distinct from 'true'::jsonb then
    raise check_violation using message='delivery_delegate_not_allowed'; end if;
  if p_kind not in('quick_handoff','direct_handoff','freight_handoff') then
    select * into confirmation from private.shipment_receipt_confirmations where shipment_id=shipment.id for update;
    if not found or confirmation.selection_id is distinct from shipment.delivery_selection_id or confirmation.owner_id<>purchase.user_id
      or confirmation.consumed_at is not null or confirmation.expires_at<=instant or confirmation.failed_attempts>=5 then
      return jsonb_build_object('ok',false,'error','delivery_receipt_code_unavailable'); end if;
    if confirmation.confirmation_digest is distinct from extensions.digest(confirmation_value,'sha256') then
      update private.shipment_receipt_confirmations set failed_attempts=failed_attempts+1 where shipment_id=shipment.id;
      -- Return a failure object so the failed-attempt count commits without a status change.
      return jsonb_build_object('ok',false,'error',case when confirmation.failed_attempts+1>=5 then 'delivery_receipt_code_unavailable'
        else 'delivery_receipt_code_invalid' end,'remainingAttempts',greatest(0,4-confirmation.failed_attempts));
    end if;
  end if;
  evidence:=evidence||jsonb_build_object('selectionId',shipment.delivery_selection_id,'policyId',shipment.delivery_policy_id,
    'policyRevision',shipment.delivery_method_snapshot->'revision');
  insert into private.shipment_delivery_operations(id,shipment_id,kind,actor_id,request_digest,evidence)
    values(p_operation_id,shipment.id,p_kind,actor,fingerprint,evidence);
  if p_kind not in('quick_handoff','direct_handoff','freight_handoff') then
    update private.shipment_receipt_confirmations set consumed_at=instant,consumed_operation_id=p_operation_id where shipment_id=shipment.id;
  end if;
  next_status:=case when p_kind in('quick_handoff','direct_handoff','freight_handoff') then 'shipping' else 'delivered' end;
  update public.order_shipments set status=next_status,delivery_event_id=p_operation_id,
    shipped_at=case when p_kind in('quick_handoff','direct_handoff','freight_handoff','pickup_receive','none_receive') then occurred else shipped_at end,
    delivered_at=case when next_status='delivered' then occurred else delivered_at end,updated_at=instant where id=shipment.id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipment.delivery_evidence_recorded','order:'||purchase.id,
    jsonb_build_object('shipmentId',shipment.id,'operationId',p_operation_id,'method',shipment.delivery_method,'kind',p_kind,'occurredAt',occurred));
  return jsonb_build_object('ok',true,'replayed',false,'shipmentId',shipment.id);
end $function$

;
CREATE OR REPLACE FUNCTION public.issue_shipment_receipt_confirmation(p_shipment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); shipment public.order_shipments; purchase public.orders; confirmation_value text; instant timestamptz:=clock_timestamp();
begin
  if actor is null or not exists(select 1 from public.profiles where id=actor and suspended_at is null) then
    raise insufficient_privilege using message='authentication_required'; end if;
  select purchase_row.* into purchase from public.orders purchase_row join public.order_shipments shipment_row on shipment_row.order_id=purchase_row.id
    where shipment_row.id=p_shipment_id and purchase_row.user_id=actor for update of purchase_row;
  if not found then raise no_data_found using message='shipment_not_found'; end if;
  select * into shipment from public.order_shipments where id=p_shipment_id for update;
  if purchase.status not in ('confirmed','shipping') or not ((shipment.delivery_method in('pickup','none') and shipment.status='ready')
    or (shipment.delivery_method in('quick','direct','freight') and shipment.status='shipping')) then raise check_violation using message='delivery_receipt_code_unavailable'; end if;
  perform private.assert_order_dispatch_allowed(purchase.id);
  confirmation_value:=upper(encode(extensions.gen_random_bytes(6),'hex'));
  insert into private.shipment_receipt_confirmations(shipment_id,selection_id,owner_id,confirmation_digest,issued_at,expires_at)
    values(shipment.id,shipment.delivery_selection_id,actor,extensions.digest(confirmation_value,'sha256'),instant,instant+interval '10 minutes')
    on conflict(shipment_id) do update set selection_id=excluded.selection_id,owner_id=excluded.owner_id,confirmation_digest=excluded.confirmation_digest,
      issued_at=excluded.issued_at,expires_at=excluded.expires_at,failed_attempts=0,consumed_at=null,consumed_operation_id=null;
  return jsonb_build_object('code',confirmation_value,'expiresAt',instant+interval '10 minutes','maxAttempts',5);
end $function$

;
CREATE OR REPLACE FUNCTION public.admin_read_shipment_delivery(p_shipment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare shipment public.order_shipments; purchase public.orders; has_claim boolean;
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if auth.uid() is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
  select * into shipment from public.order_shipments where id=p_shipment_id;
  if not found then raise no_data_found using message='shipment_not_found'; end if;
  select * into purchase from public.orders where id=shipment.order_id;
  has_claim:=exists(select 1 from public.order_cancellation_requests where order_id=purchase.id and status in ('requested','processing','needs_review'))
    or exists(select 1 from public.order_cancellation_claims where order_id=purchase.id);
  return jsonb_build_object('shipmentId',shipment.id,'orderId',purchase.id,'originId',shipment.origin_id,'status',shipment.status,
    'orderStatus',purchase.status,'updatedAt',shipment.updated_at,'shippingFee',shipment.shipping_fee,'exportedAt',shipment.exported_at,
    'canSelect',shipment.fulfillment_partition not in('none','digital') and not has_claim and shipment.status='ready' and shipment.exported_at is null and shipment.carrier is null
      and shipment.tracking_number is null and purchase.status in ('paid','confirmed','shipping'),
    'canTransition',not has_claim and purchase.status in ('confirmed','shipping')
      and ((shipment.delivery_method in('quick','direct','freight') and shipment.status in ('ready','shipping')) or (shipment.delivery_method in('pickup','none') and shipment.status='ready')),
    'preorderReady',private.shipment_preorder_allocation_ready(shipment.id),'summary',private.shipment_delivery_summary(shipment.id),
    'policies',public.admin_list_delivery_policies(shipment.origin_id),
    'history',(select coalesce(jsonb_agg(jsonb_build_object('id',operation.id,'kind',operation.kind,'evidence',operation.evidence,
      'actorName',profile.nickname,'recordedAt',operation.recorded_at) order by operation.recorded_at,operation.id),'[]')
      from private.shipment_delivery_operations operation left join public.profiles profile on profile.id=operation.actor_id where operation.shipment_id=shipment.id));
end $function$

;
CREATE OR REPLACE FUNCTION private.shipment_delivery_summary(p_shipment_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object('method',shipment.delivery_method,'policy',case when shipment.delivery_method='digital' then null else shipment.delivery_method_snapshot end,
    'canIssueReceipt',purchase.status in ('confirmed','shipping')
      and ((shipment.delivery_method in('pickup','none') and shipment.status='ready') or (shipment.delivery_method in('quick','direct','freight') and shipment.status='shipping'))
      and not exists(select 1 from public.order_cancellation_requests request where request.order_id=purchase.id and request.status in ('requested','processing','needs_review'))
      and not exists(select 1 from public.order_cancellation_claims claim where claim.order_id=purchase.id),
    'providerName',(select operation.evidence->>'providerName' from private.shipment_delivery_operations operation
      where operation.shipment_id=shipment.id and operation.kind in('quick_handoff','direct_handoff','freight_handoff') order by operation.recorded_at desc,operation.id limit 1))
  from public.order_shipments shipment join public.orders purchase on purchase.id=shipment.order_id where shipment.id=p_shipment_id;
$function$

;
CREATE OR REPLACE FUNCTION public.admin_select_shipment_delivery_method(p_shipment_id uuid, p_method text, p_policy_id uuid, p_customer_request_reference text, p_fee_consent_reference text, p_fee_unchanged boolean, p_expected_updated_at timestamp with time zone, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); shipment public.order_shipments; purchase public.orders; policy private.fulfillment_delivery_policies;
  operation private.shipment_delivery_operations; evidence jsonb; fingerprint bytea; snapshot jsonb; instant timestamptz:=clock_timestamp();
begin
  perform private.require_operator_capability('sales.manage',false);

  if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff_required'; end if;
  if p_method is null or p_method not in ('parcel','quick','pickup','direct','freight') or p_operation_id is null or p_fee_unchanged is distinct from true
    or length(coalesce(btrim(p_customer_request_reference),'')) not between 1 and 2000
    or length(coalesce(btrim(p_fee_consent_reference),'')) not between 1 and 2000
    or (p_method='parcel' and p_policy_id is not null) or (p_method<>'parcel' and p_policy_id is null) then
    raise invalid_parameter_value using message='invalid_delivery_selection'; end if;
  select purchase_row.* into purchase from public.orders purchase_row join public.order_shipments shipment_row on shipment_row.order_id=purchase_row.id
    where shipment_row.id=p_shipment_id for update of purchase_row;
  if not found then raise no_data_found using message='shipment_not_found'; end if;
  select * into shipment from public.order_shipments where id=p_shipment_id for update;
  fingerprint:=extensions.digest(jsonb_build_object('actor',actor,'method',p_method,'policyId',p_policy_id,
    'request',btrim(p_customer_request_reference),'consent',btrim(p_fee_consent_reference),'expectedAt',p_expected_updated_at)::text,'sha256');
  select * into operation from private.shipment_delivery_operations where id=p_operation_id;
  if found then
    if operation.shipment_id<>shipment.id or operation.kind<>'method_selected' or operation.actor_id is distinct from actor
      or operation.request_digest is distinct from fingerprint then raise sqlstate 'PT409' using message='delivery_operation_conflict'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'shipmentId',shipment.id);
  end if;
  if p_expected_updated_at is null or shipment.updated_at<>p_expected_updated_at then raise sqlstate 'PT409' using message='shipment_delivery_changed'; end if;
  if shipment.status<>'ready' or shipment.exported_at is not null or shipment.carrier is not null or shipment.tracking_number is not null
    or purchase.status not in ('paid','confirmed','shipping') then raise check_violation using message='delivery_method_selection_unavailable'; end if;
  perform private.assert_order_dispatch_allowed(purchase.id);
  if p_method<>'parcel' then
    -- All policy writers lock the origin first; only SHARE is needed by selection.
    perform id from public.fulfillment_origins where id=shipment.origin_id and is_active for share;
    if not found then raise check_violation using message='delivery_policy_unavailable'; end if;
    select * into policy from private.fulfillment_delivery_policies where id=p_policy_id and origin_id=shipment.origin_id and method=p_method for share;
    if not found or policy.state<>'active' or not private.valid_delivery_policy_terms(policy.terms,true) then
      raise check_violation using message='delivery_policy_unavailable'; end if;
    snapshot:=(policy.terms-'approvalReference')||jsonb_build_object('version',1,'policyId',policy.id,'revision',policy.revision,
      'feeRule','order_fee_unchanged','confirmationRule','recipient_code');
  end if;
  evidence:=jsonb_build_object('fromMethod',shipment.delivery_method,'toMethod',p_method,'policyId',p_policy_id,
    'policyRevision',policy.revision,'customerRequestReference',btrim(p_customer_request_reference),'feeConsentReference',btrim(p_fee_consent_reference),
    'shippingFee',shipment.shipping_fee,'orderTotal',purchase.total,'feeRule','order_fee_unchanged');
  insert into private.shipment_delivery_operations(id,shipment_id,kind,actor_id,request_digest,evidence)
    values(p_operation_id,shipment.id,'method_selected',actor,fingerprint,evidence);
  update public.order_shipments set delivery_method=p_method,delivery_policy_id=p_policy_id,delivery_method_snapshot=snapshot,
    delivery_selection_id=p_operation_id,delivery_event_id=null,updated_at=instant where id=shipment.id;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipment.delivery_method_selected','order:'||purchase.id,
    jsonb_build_object('shipmentId',shipment.id,'operationId',p_operation_id,'from',shipment.delivery_method,'to',p_method,'shippingFee',shipment.shipping_fee));
  return jsonb_build_object('ok',true,'replayed',false,'shipmentId',shipment.id);
end $function$

;

alter function private.create_order_shipments_before_preorder(uuid) rename to create_shipments_before_fulfillment;
create function private.create_order_shipments_before_preorder(target_order uuid) returns void language plpgsql set search_path='' as $$
declare purchase public.orders;fee jsonb;shipment_key uuid;selection_id uuid;method text;expected_count integer;begin
 select * into purchase from public.orders where id=target_order for update;if not found then raise no_data_found;end if;
 if purchase.calculation_version<>2 then perform private.create_shipments_before_fulfillment(target_order);return;end if;
 if exists(select 1 from public.order_shipments where order_id=target_order) then return;end if;
 select count(distinct(origin_id_snapshot,coalesce(fulfillment_terms_snapshot->>'method','parcel'))) into expected_count from public.order_items where order_id=target_order;
 if expected_count=0 or expected_count<>jsonb_array_length(purchase.shipping_fee_breakdown)
  or(select coalesce(sum((value->>'totalFee')::bigint),0) from jsonb_array_elements(purchase.shipping_fee_breakdown))<>purchase.shipping_fee then raise check_violation using message='invalid_order_shipment_breakdown';end if;
 for fee in select value from jsonb_array_elements(purchase.shipping_fee_breakdown) order by value->>'originId',value->>'deliveryMethod' loop
  method:=coalesce(fee->>'deliveryMethod','parcel');selection_id:=case when method='parcel' then null else gen_random_uuid() end;
  insert into public.order_shipments(order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,fulfillment_partition,delivery_method,delivery_policy_id,delivery_method_snapshot,delivery_selection_id)
   values(target_order,(fee->>'originId')::uuid,fee->>'originName',(fee->>'totalFee')::bigint,fee,method,method,
    case when method in('parcel','digital') then null else(fee#>>'{deliveryPolicy,policyId}')::uuid end,
    case when method='parcel' then null else fee->'deliveryPolicy' end,selection_id) returning id into shipment_key;
  insert into public.order_shipment_items(order_id,shipment_id,order_item_id)
   select target_order,shipment_key,id from public.order_items where order_id=target_order and origin_id_snapshot=(fee->>'originId')::uuid and coalesce(fulfillment_terms_snapshot->>'method','parcel')=method;
  if not found then raise check_violation using message='shipment_method_without_items';end if;
  if selection_id is not null then
   insert into private.shipment_delivery_operations(id,shipment_id,kind,actor_id,request_digest,evidence)
    values(selection_id,shipment_key,'method_selected',purchase.user_id,extensions.digest(fee::text,'sha256'),
     jsonb_build_object('fromMethod',null,'toMethod',method,'checkout',true,'policyId',fee#>'{deliveryPolicy,policyId}','policyRevision',fee#>'{deliveryPolicy,revision}'));
  end if;
 end loop;
 if(select count(*) from public.order_shipment_items where order_id=target_order)<>(select count(*) from public.order_items where order_id=target_order) then raise check_violation using message='shipment_item_missing';end if;
end $$;
create or replace function private.guard_shipment_delivery_method() returns trigger language plpgsql set search_path='' as $$
declare operation private.shipment_delivery_operations;begin
 if tg_op='INSERT' then
  if new.delivery_method<>'parcel' or new.fulfillment_partition<>'parcel' then
   if new.fulfillment_partition<>new.delivery_method or not exists(select 1 from public.orders o join private.order_goods_transactions t on t.order_id=o.id
    where o.id=new.order_id and o.calculation_version=2 and o.shipping_fee_breakdown @> jsonb_build_array(new.shipping_fee_snapshot)
     and new.shipping_fee_snapshot->>'deliveryMethod'=new.delivery_method and new.shipping_fee_snapshot->'deliveryPolicy'=new.delivery_method_snapshot)
    then raise check_violation using message='delivery_method_selection_required';end if;
  end if;return new;
 end if;
 if new.fulfillment_partition is distinct from old.fulfillment_partition then raise check_violation using message='fulfillment_partition_immutable';end if;
 if new.delivery_method is distinct from old.delivery_method or new.delivery_selection_id is distinct from old.delivery_selection_id or new.delivery_method_snapshot is distinct from old.delivery_method_snapshot or new.delivery_policy_id is distinct from old.delivery_policy_id then
  if old.fulfillment_partition in('none','digital') then raise check_violation using message='delivery_method_fixed';end if;
  select * into operation from private.shipment_delivery_operations where id=new.delivery_selection_id and shipment_id=new.id and kind='method_selected';
  if not found or old.status<>'ready' or new.status<>'ready' or old.exported_at is not null or operation.evidence->>'toMethod' is distinct from new.delivery_method
   or operation.evidence->>'fromMethod' is distinct from old.delivery_method then raise check_violation using message='delivery_method_selection_required';end if;
 end if;
 if new.delivery_method<>'parcel' then
  if new.carrier is not null or new.tracking_number is not null or new.exported_at is distinct from old.exported_at then raise check_violation using message='delivery_method_evidence_required';end if;
  if new.status in('shipping','delivered') and(new.status is distinct from old.status or new.shipped_at is distinct from old.shipped_at or new.delivered_at is distinct from old.delivered_at) then
   select * into operation from private.shipment_delivery_operations where id=new.delivery_event_id and shipment_id=new.id;
   if not found or not(
    new.delivery_method in('quick','direct','freight') and old.status='ready' and new.status='shipping' and operation.kind=new.delivery_method||'_handoff'
    or new.delivery_method in('quick','direct','freight') and old.status='shipping' and new.status='delivered' and operation.kind=new.delivery_method||'_receive'
    or new.delivery_method in('pickup','none') and old.status='ready' and new.status='delivered' and operation.kind=new.delivery_method||'_receive'
    or new.delivery_method='digital' and old.status='ready' and new.status='delivered' and operation.kind='digital_access'
   ) then raise check_violation using message='delivery_method_evidence_required';end if;
   if(operation.evidence->>'occurredAt')::timestamptz is distinct from(case when new.status='shipping' then new.shipped_at else new.delivered_at end) then raise check_violation using message='delivery_method_evidence_required';end if;
   if new.delivery_method='digital' then
    if exists(select 1 from public.order_shipment_items i where i.shipment_id=new.id and not exists(select 1 from private.order_digital_downloads d where d.order_item_id=i.order_item_id and d.order_id=new.order_id)) then raise check_violation using message='digital_delivery_incomplete';end if;
   elsif new.status='delivered' and not exists(select 1 from private.shipment_receipt_confirmations c where c.shipment_id=new.id and c.selection_id=new.delivery_selection_id and c.consumed_operation_id=new.delivery_event_id and c.consumed_at is not null) then raise check_violation using message='delivery_method_evidence_required';end if;
   perform private.assert_shipment_preorder_ready(new.id);
  end if;
 end if;
 return new;
end $$;
create function public.get_goods_transaction_offers_v3(p_good_ids text[]) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(r||jsonb_build_object('fulfillment',private.goods_fulfillment_document(r->>'goodId',false))),'[]')
 from jsonb_array_elements(public.get_goods_transaction_offers_v2(p_good_ids))r;
$$;
revoke all on function private.calculate_shipping_before_fulfillment(jsonb,jsonb,jsonb,timestamptz),private.goods_fulfillment_selected_terms(text,jsonb),private.fulfillment_item_guard(),private.digital_supply_guard(),private.create_shipments_before_fulfillment(uuid),private.create_order_shipments_before_preorder(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_goods_transaction_offers_v3(text[]) from public,anon,authenticated,service_role;
grant execute on function public.get_goods_transaction_offers_v3(text[]) to anon,authenticated;
select private.register_operator_internal_contract('private.calculate_shipping_before_fulfillment(jsonb,jsonb,jsonb,timestamptz)'::regprocedure);
select private.register_operator_internal_contract('private.goods_fulfillment_selected_terms(text,jsonb)'::regprocedure);
select private.register_operator_internal_contract('private.fulfillment_item_guard()'::regprocedure);
select private.register_operator_internal_contract('private.digital_supply_guard()'::regprocedure);
select private.register_operator_internal_contract('private.create_shipments_before_fulfillment(uuid)'::regprocedure);
select private.register_operator_internal_contract('private.create_order_shipments_before_preorder(uuid)'::regprocedure);
-- The recreated private calculator does not inherit its former function ACL.
revoke all on function private.calculate_goods_transaction_shipping(jsonb,jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;
select private.register_operator_internal_contract('private.calculate_goods_transaction_shipping(jsonb,jsonb,jsonb,timestamptz)'::regprocedure);
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
   'couponDiscount',o.discount_total,'storeCredits',o.store_credit_total,
   'calculationVersion',o.calculation_version,'volumeDiscount',o.volume_discount_total,'shippingCollectTotal',o.shipping_collect_total,
   'shippingComponents',coalesce((select jsonb_agg(jsonb_build_object('id',component.id,'shipmentId',component.shipment_id,'paymentMode',component.payment_mode,
    'baseFee',component.base_fee,'regionalFee',component.regional_fee,'totalFee',component.total_fee,'installationFee',component.installation_fee) order by component.id)
    from private.shipping_charge_components component where component.order_id=o.id),'[]'),
   'coupon',(
    select jsonb_build_object('code',r.coupon_code,'discountAmount',r.discount_amount,'eligibleSubtotal',r.eligible_subtotal,'terms',r.terms_snapshot)
    from public.coupon_redemptions r where r.order_id=o.id and r.status='applied'
   ),
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
   'couponDiscount',o.discount_total,'storeCredits',o.store_credit_total,
   'calculationVersion',o.calculation_version,'volumeDiscount',o.volume_discount_total,'shippingCollectTotal',o.shipping_collect_total,
   'shippingComponents',coalesce((select jsonb_agg(jsonb_build_object('id',component.id,'shipmentId',component.shipment_id,'paymentMode',component.payment_mode,
    'baseFee',component.base_fee,'regionalFee',component.regional_fee,'totalFee',component.total_fee,'installationFee',component.installation_fee) order by component.id)
    from private.shipping_charge_components component where component.order_id=o.id),'[]'),
   'coupon',(
    select jsonb_build_object('code',r.coupon_code,'discountAmount',r.discount_amount,'eligibleSubtotal',r.eligible_subtotal,'terms',r.terms_snapshot)
    from public.coupon_redemptions r where r.order_id=o.id and r.status='applied'
   ),
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
   'couponDiscount',o.discount_total,'storeCredits',o.store_credit_total,
   'calculationVersion',o.calculation_version,'volumeDiscount',o.volume_discount_total,'shippingCollectTotal',o.shipping_collect_total,
   'shippingComponents',coalesce((select jsonb_agg(jsonb_build_object('id',component.id,'shipmentId',component.shipment_id,'paymentMode',component.payment_mode,
    'baseFee',component.base_fee,'regionalFee',component.regional_fee,'totalFee',component.total_fee,'installationFee',component.installation_fee) order by component.id)
    from private.shipping_charge_components component where component.order_id=o.id),'[]'),
   'coupon',(
    select jsonb_build_object('code',r.coupon_code,'discountAmount',r.discount_amount,'eligibleSubtotal',r.eligible_subtotal,'terms',r.terms_snapshot)
    from public.coupon_redemptions r where r.order_id=o.id and r.status='applied'
   ),
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
notify pgrst,'reload schema';
commit;
