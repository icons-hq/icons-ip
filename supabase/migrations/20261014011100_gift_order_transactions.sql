begin;
create function private.gift_checkout_source(p_id uuid,p_actor uuid,p_expected_revision bigint default null) returns private.gift_intents
language plpgsql volatile security definer set search_path='' as $$declare gift private.gift_intents;begin
 gift:=private.gift_lock(p_id,p_actor);
 if gift.sender_id is distinct from p_actor then raise insufficient_privilege using message='gift_not_found';end if;
 if p_expected_revision is not null and gift.revision<>p_expected_revision then raise sqlstate 'PT409' using message='gift_changed';end if;
 return gift;
end $$;
create function private.gift_require_payment_ready(p_gift private.gift_intents) returns void
language plpgsql volatile security definer set search_path='' as $$begin
 perform private.gift_require_runtime();
 perform private.gift_require_actor(p_gift.sender_id);perform private.gift_require_actor(p_gift.recipient_id);
 if p_gift.state<>'accepted' or p_gift.order_id is not null or p_gift.expires_at<=clock_timestamp() then
  raise check_violation using message='gift_payment_not_ready';end if;
 if not exists(select 1 from private.gift_recipient_addresses a where a.gift_id=p_gift.id and a.recipient_id=p_gift.recipient_id) then
  raise check_violation using message='gift_payment_not_ready';end if;
end $$;
create function public.quote_my_gift(p_id uuid,p_expected_revision bigint,p_user_coupon_id uuid,p_store_credit_amount bigint,p_expected_actor_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();gift private.gift_intents;address jsonb;selection jsonb;choices jsonb;quoted jsonb;begin
 if actor is null or actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='gift_auth_changed';end if;
 gift:=private.gift_checkout_source(p_id,actor,p_expected_revision);perform private.gift_require_payment_ready(gift);
 selection:=private.gift_selection(gift.id);
 select a.address into address from private.gift_recipient_addresses a where a.gift_id=gift.id;
 select jsonb_object_agg(value->>'goodId','prepaid') into choices from jsonb_array_elements(selection);
 quoted:=private.quote_goods_transaction(actor,private.gift_source(gift),selection,address,choices,p_user_coupon_id,p_store_credit_amount);
 if quoted->>'state'='quoted' and (quoted#>>'{display,totals,collectShippingTotal}')::numeric<>0 then
  raise check_violation using message='gift_prepaid_required';end if;
 return quoted;
end $$;
create function public.replay_my_gift_order(p_id uuid,p_quote_id uuid,p_checkout_key uuid,p_payment_method public.order_payment_method,p_expected_actor_id uuid) returns uuid
language plpgsql volatile security definer set search_path='' as $$declare actor uuid:=auth.uid();gift private.gift_intents;receipt jsonb;begin
 if actor is null or actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='gift_auth_changed';end if;
 gift:=private.gift_checkout_source(p_id,actor);
 receipt:=private.replay_goods_transaction_receipt(actor,private.gift_source(gift),p_quote_id,p_checkout_key,p_payment_method);
 return (receipt->>'orderId')::uuid;
end $$;
create function public.place_my_gift(p_id uuid,p_quote_id uuid,p_checkout_key uuid,p_payment_method public.order_payment_method,p_expected_actor_id uuid) returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();gift private.gift_intents;address jsonb;selection jsonb;receipt jsonb;quoted private.goods_transaction_quotes;begin
 if actor is null or actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='gift_auth_changed';end if;
 gift:=private.gift_checkout_source(p_id,actor);
 -- Recovery uses only the durable receipt. It survives quote/address retention,
 -- account fencing, runtime closure, and an already ordered gift.
 receipt:=private.replay_goods_transaction_receipt(actor,private.gift_source(gift),p_quote_id,p_checkout_key,p_payment_method);
 if receipt is not null then return (receipt->>'orderId')::uuid;end if;
 perform private.gift_require_payment_ready(gift);
 select * into quoted from private.goods_transaction_quotes where id=p_quote_id and actor_id=actor;
 if not found or quoted.source is distinct from private.gift_source(gift) then raise sqlstate 'PT409' using message='gift_source_changed';end if;
 if (quoted.calculation#>>'{display,totals,collectShippingTotal}')::numeric<>0 then raise check_violation using message='gift_prepaid_required';end if;
 selection:=private.gift_selection(gift.id);
 select a.address into address from private.gift_recipient_addresses a where a.gift_id=gift.id;
 return private.place_goods_transaction(actor,private.gift_source(gift),selection,address,p_quote_id,p_checkout_key,p_payment_method);
end $$;

-- An explicit tri-state prevents a failed gift read from falling through to a
-- raw orders reader. No address, carrier, tracking, region, or customer note is
-- present in the payer projection, even for a sender who also receives a gift.
create function public.get_my_gift_checkout_order(p_order_id uuid,p_expected_actor_id uuid default auth.uid()) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();purchase public.orders;gift private.gift_intents;receipt jsonb;payment_status text;attempt_state text;begin
 if actor is null or actor is distinct from p_expected_actor_id then return jsonb_build_object('kind','unavailable');end if;
 select * into purchase from public.orders where id=p_order_id and user_id=actor;
 if not found then return jsonb_build_object('kind','unavailable');end if;
 select * into gift from private.gift_intents where order_id=purchase.id and sender_id=actor;
 if not found then
  if exists(select 1 from private.order_delivery_private_snapshots where order_id=purchase.id) then return jsonb_build_object('kind','unavailable');end if;
  return jsonb_build_object('kind','ordinary');
 end if;
 select t.original_receipt into receipt from private.order_goods_transactions t where t.order_id=purchase.id and t.actor_id=actor and t.source_kind='gift' and t.source_id=gift.id;
 if receipt is null or purchase.calculation_version<>2 or purchase.address is not null then raise check_violation using message='gift_order_projection_invalid';end if;
 select p.status::text into payment_status from public.payments p where p.purpose='order' and p.ref_id=purchase.id and p.user_id=actor order by p.created_at desc,p.id desc limit 1;
 select a.state into attempt_state from public.payment_attempts a where a.purpose='order' and a.ref_id=purchase.id and a.user_id=actor order by a.created_at desc,a.id desc limit 1;
 return jsonb_build_object('kind','gift','receipt',receipt,'order',jsonb_build_object(
  'id',purchase.id,'giftId',gift.id,'status',purchase.status,'total',purchase.total,'shippingFee',purchase.shipping_fee,'discountTotal',purchase.discount_total,
  'storeCreditTotal',purchase.store_credit_total,'address',null,'expiresAt',purchase.expires_at,'createdAt',purchase.created_at,
  'deliveredAt',purchase.delivered_at,'paymentStatus',case when attempt_state in('confirming','unknown','needs_review') then 'pending' else payment_status end,'paymentMethod',purchase.payment_method,
  'items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'goodId',i.good_id,'variantId',i.variant_id,'variantName',i.variant_name_snapshot,
   'variantCode',i.variant_code_snapshot,'name',i.good_name_snapshot,'type',i.good_type_snapshot,'qty',i.qty,'unitPrice',i.unit_price,
   'customInputs',i.custom_inputs_snapshot,'supplySource',i.supply_source,'preorderExpectedShipDate',i.preorder_expected_ship_date) order by i.id),'[]') from public.order_items i where i.order_id=purchase.id),
  'shipments',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'orderId',s.order_id,'originId',s.origin_id,'originName',s.origin_name_snapshot,
   'shippingFee',s.shipping_fee,'status',s.status,'carrier',null,'carrierLabel',null,'trackingNumber',null,'trackingUrl',null,
   'shippedAt',s.shipped_at,'deliveredAt',s.delivered_at,'exportedAt',null,'orderItemIds',(select coalesce(jsonb_agg(si.order_item_id order by si.order_item_id),'[]') from public.order_shipment_items si where si.shipment_id=s.id),
   'originalExpectedShipDate',s.original_expected_ship_date,'expectedShipDate',s.expected_ship_date,'preorderReady',public.shipment_preorder_ready(s),
   'regionalShipping',null,'delivery',null) order by s.id),'[]') from public.order_shipments s where s.order_id=purchase.id)));
end $$;
create function public.get_my_gift_menu_state() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('canCreate',public.get_gift_availability(),'hasGifts',auth.uid() is not null and exists(
  select 1 from private.gift_intents where sender_id=auth.uid() or recipient_id=auth.uid()));
$$;
create function public.get_my_gift_latest_claim(p_order_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'status',c.status,'claimType',c.claim_type,'stage',c.stage,'reference',c.reference,
  'requestedAt',c.requested_at,'decidedAt',c.decided_at,'decisionNote',null,'reshipCarrier',null,'reshipTrackingNumber',null,'reshipDeliveredAt',c.reship_delivered_at)
 from public.order_cancellation_requests c join private.gift_intents g on g.order_id=c.order_id
 where c.order_id=p_order_id and g.sender_id=auth.uid() order by c.requested_at desc,c.id desc limit 1;
$$;
create policy gift_claims_private_read on public.order_cancellation_requests as restrictive for select to authenticated using(
 public.gift_direct_order_read_allowed(order_id) or public.has_operator_capability('sales.manage'));
do $$declare fn regprocedure;begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
  n.nspname='private' and p.proname=any(array['gift_checkout_source','gift_require_payment_ready']) or
  n.nspname='public' and p.proname=any(array['quote_my_gift','replay_my_gift_order','place_my_gift','get_my_gift_checkout_order','get_my_gift_menu_state','get_my_gift_latest_claim']) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
  execute format('grant execute on function %s to %s',fn,case when fn::text like 'private.%' then 'postgres' else 'authenticated' end);
  perform private.register_operator_internal_contract(fn);
 end loop;
end $$;
select private.register_operator_policy_contract('public.order_cancellation_requests'::regclass,'gift_claims_private_read','sales.manage');
commit;
notify pgrst,'reload schema';
