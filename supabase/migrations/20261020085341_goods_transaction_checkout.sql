-- Shared exact quote and explicit-selection order creation with durable replay.
-- New transactions require the runtime gate; successful receipts remain replayable.
alter table public.orders
 add column calculation_version integer not null default 1 check(calculation_version in(1,2)),
 add column volume_discount_total bigint not null default 0 check(volume_discount_total>=0),
 add column shipping_collect_total bigint not null default 0 check(shipping_collect_total>=0);
alter table public.order_items
 add column volume_unit_discount bigint not null default 0 check(volume_unit_discount>=0 and volume_unit_discount<=unit_price),
 add column volume_discount_total bigint not null default 0 check(volume_discount_total>=0),
 add column volume_discount_snapshot jsonb;
alter table public.order_shipments add column shipping_collect_fee bigint not null default 0 check(shipping_collect_fee>=0);

create table private.goods_transaction_quotes (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),source jsonb not null,
 selection jsonb not null,address jsonb not null,delivery_choices jsonb not null,user_coupon_id uuid,store_credit_amount bigint not null,
 line_ids jsonb not null,calculation jsonb not null,created_at timestamptz not null,expires_at timestamptz not null,
 order_id uuid unique references public.orders(id),check(expires_at>created_at and expires_at<=created_at+interval '10 minutes'),
 check(octet_length(selection::text)<=2097152 and octet_length(calculation::text)<=2097152)
);
create index goods_transaction_quotes_actor_expiry on private.goods_transaction_quotes(actor_id,expires_at);
create index goods_transaction_quotes_expiry on private.goods_transaction_quotes(expires_at);
create table private.order_goods_transactions (
 order_id uuid primary key references public.orders(id),actor_id uuid not null references auth.users(id),
 source_kind text not null check(source_kind in('cart','gift','subscription')),source_id uuid not null,source_revision text not null,
 quote_id uuid not null unique,checkout_key uuid not null,request_digest text not null,request_salt uuid not null,
 original_receipt jsonb not null,created_at timestamptz not null default clock_timestamp(),unique(actor_id,checkout_key)
);
create unique index order_goods_transactions_one_domain_source on private.order_goods_transactions(source_kind,source_id)
 where source_kind in('gift','subscription');
create table private.order_price_allocations (
 order_item_id uuid primary key references public.order_items(id),order_id uuid not null references public.orders(id),calculation_version integer not null check(calculation_version=2),
 subtotal bigint not null check(subtotal>=0),volume_discount bigint not null check(volume_discount>=0),
 net_subtotal bigint not null check(net_subtotal>=0),coupon_discount bigint not null check(coupon_discount>=0),
 store_credit_discount bigint not null check(store_credit_discount>=0),paid_goods_total bigint not null check(paid_goods_total>=0),
 check(net_subtotal=subtotal-volume_discount and paid_goods_total=net_subtotal-coupon_discount-store_credit_discount)
);
create index order_price_allocations_order on private.order_price_allocations(order_id);
create table private.shipping_charge_components (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),shipment_id uuid not null references public.order_shipments(id),
 good_id text not null references public.goods(id) on update cascade,origin_id uuid not null,calculation_version integer not null check(calculation_version=2),
 payment_mode text not null check(payment_mode in('prepaid','collect')),base_fee bigint not null check(base_fee>=0),
 regional_fee bigint not null check(regional_fee>=0),total_fee bigint not null check(total_fee=base_fee+regional_fee),
 delivery_policy_id uuid,collect_contract_id uuid,terms_snapshot jsonb not null,unique(order_id,good_id)
);
create index shipping_charge_components_shipment on private.shipping_charge_components(shipment_id);
create table private.shipping_collect_obligations (
 shipment_id uuid primary key references public.order_shipments(id),order_id uuid not null references public.orders(id),amount bigint not null check(amount>0),
 state text not null default 'planned' check(state in('planned','collected','void','refund_review','refunded','mismatch')),
 revision integer not null default 1 check(revision>0),contract_snapshot jsonb not null,updated_at timestamptz not null default clock_timestamp()
);
create index shipping_collect_obligations_order on private.shipping_collect_obligations(order_id);
create table private.shipping_collect_events (
 operation_id uuid primary key,shipment_id uuid not null references private.shipping_collect_obligations(shipment_id),
 event text not null check(event in('planned','collected','void','refund_review','refunded','mismatch','correction')),
 amount bigint not null check(amount>=0),actor_id uuid references auth.users(id),evidence jsonb not null,
 created_at timestamptz not null default clock_timestamp(),previous_state text,previous_revision integer,receipt jsonb
);
create index shipping_collect_events_shipment on private.shipping_collect_events(shipment_id,created_at,operation_id);
create trigger immutable_order_price_allocations before update or delete on private.order_price_allocations
 for each row execute function private.guard_goods_transaction_version();
create trigger immutable_shipping_charge_components before update or delete on private.shipping_charge_components
 for each row execute function private.guard_goods_transaction_version();
create trigger immutable_shipping_collect_events before update or delete on private.shipping_collect_events
 for each row execute function private.guard_goods_transaction_version();

create function private.reconcile_order_collect_after_cancel() returns trigger
language plpgsql volatile security definer set search_path='' as $$declare obligation private.shipping_collect_obligations;shipment public.order_shipments;next_state text;reason text;begin
 perform 1 from public.order_shipments where order_id=new.id order by id for update;
 for obligation in select * from private.shipping_collect_obligations where order_id=new.id order by shipment_id for update loop
  if obligation.state in('void','refunded','refund_review') then continue;end if;
  select * into shipment from public.order_shipments where id=obligation.shipment_id;
  if obligation.state='planned' and shipment.shipped_at is null and shipment.delivered_at is null and shipment.status::text not in('shipping','delivered') then
   next_state:='void';reason:='order_canceled_before_dispatch';
  else next_state:='refund_review';reason:='order_canceled_collection_review';end if;
  update private.shipping_collect_obligations set state=next_state,revision=revision+1,updated_at=clock_timestamp() where shipment_id=obligation.shipment_id;
  insert into private.shipping_collect_events(operation_id,shipment_id,event,amount,evidence,previous_state,previous_revision)
   values(gen_random_uuid(),obligation.shipment_id,next_state,case when next_state='void' then 0 else obligation.amount end,
    jsonb_build_object('orderId',new.id,'reason',reason),obligation.state,obligation.revision);
 end loop;
 return new;
end $$;
create trigger order_collect_cancel_reconciliation after update of status on public.orders
 for each row when(new.status='canceled' and old.status is distinct from new.status) execute function private.reconcile_order_collect_after_cancel();

create function private.normalize_goods_transaction_selection(p_selection jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$declare entry jsonb;result jsonb;begin
 if jsonb_typeof(p_selection) is distinct from 'array' or jsonb_array_length(p_selection) not between 1 and 19239
  or octet_length(p_selection::text)>2097152 then raise invalid_parameter_value using message='invalid_transaction_selection';end if;
 for entry in select value from jsonb_array_elements(p_selection) loop
  if not private.transaction_json_keys(entry,array['goodId','variantId','qty','inputRevision','inputValues'])
   or jsonb_typeof(entry->'goodId') is distinct from 'string' or char_length(entry->>'goodId') not between 1 and 200
   or entry->>'goodId'<>btrim(entry->>'goodId') or entry->>'goodId'~'[[:cntrl:]]'
   or jsonb_typeof(entry->'variantId') is distinct from 'string' or entry->>'variantId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or not private.transaction_uint(entry->'qty',1,2147483647) or not private.transaction_uint(entry->'inputRevision',0,2147483647)
   or jsonb_typeof(entry->'inputValues') is distinct from 'object' then raise invalid_parameter_value using message='invalid_transaction_selection';end if;
  if (select count(*) from jsonb_each(entry->'inputValues'))>5
   or (((entry->>'inputRevision')::integer=0) is distinct from (entry->'inputValues'='{}'::jsonb))
   or exists(select 1 from jsonb_each(entry->'inputValues') e where e.key!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(e.value) is distinct from 'string' or char_length(e.value#>>'{}') not between 1 and 100
    or (e.value#>>'{}')<>btrim(e.value#>>'{}') or (e.value#>>'{}')~'[[:cntrl:]]') then
   raise invalid_parameter_value using message='invalid_transaction_selection';end if;
 end loop;
 if (select count(distinct value-'qty') from jsonb_array_elements(p_selection))<>jsonb_array_length(p_selection) then
  raise invalid_parameter_value using message='duplicate_transaction_selection';end if;
 select jsonb_agg(value order by value->>'goodId',value->>'variantId',(value->>'inputRevision')::integer,(value->'inputValues')::text)
  into result from jsonb_array_elements(p_selection);return result;
end $$;
create function private.normalize_goods_transaction_address(p_address jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$declare name text;phone text;postal text;address1 text;begin
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
end $$;
create function private.normalize_goods_transaction_choices(p_choices jsonb,p_selection jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$begin
 if jsonb_typeof(p_choices) is distinct from 'object' or exists(select 1 from jsonb_each(p_choices) e
  where jsonb_typeof(e.value) is distinct from 'string' or (e.value#>>'{}') not in('prepaid','collect')
   or not exists(select 1 from jsonb_array_elements(p_selection) r where r->>'goodId'=e.key)) then
  raise invalid_parameter_value using message='invalid_delivery_choices';end if;
 return p_choices;
end $$;
create function private.assert_goods_transaction_actor(p_actor uuid) returns void
language plpgsql volatile security definer set search_path='' as $$begin
 if p_actor is null or private.is_account_write_fenced(p_actor) or not exists(
  select 1 from public.profiles profile join auth.users auth_user on auth_user.id=profile.id where profile.id=p_actor
   and profile.suspended_at is null and nullif(btrim(coalesce(profile.email,auth_user.email)),'') is not null
   and nullif(btrim(profile.nickname),'') is not null and profile.birth_date is not null and profile.birth_date<=current_date
   and profile.onboarded_at is not null and profile.consents->>'terms'='true' and profile.consents->>'privacy'='true') then
  raise insufficient_privilege using message='transaction_actor_unavailable';end if;
end $$;
create function private.assert_goods_transaction_runtime() returns void
language plpgsql volatile security definer set search_path='' as $$declare active boolean;begin
 -- Catalog parents precede this shared runtime lock, matching policy writers.
 -- A toggle UPDATE takes the conflicting row lock; successful receipt replay
 -- never calls this new-transaction gate.
 select enabled into active from private.goods_transaction_runtime where singleton for share;
 if not coalesce(active,false) then raise sqlstate 'PT409' using message='transaction_runtime_disabled';end if;
end $$;
create function private.lock_goods_transaction_catalog(p_actor uuid,p_selection jsonb,p_user_coupon_id uuid) returns void
language plpgsql volatile security definer set search_path='' as $$begin
 -- All mutable catalog parents precede all variants and supply policies.
 perform 1 from public.goods g where g.id in(select value->>'goodId' from jsonb_array_elements(p_selection)) order by g.id for update;
 perform 1 from public.goods_variants v where v.id in(select (value->>'variantId')::uuid from jsonb_array_elements(p_selection)) order by v.good_id,v.id for update;
 perform 1 from public.ips ip where ip.id in(select g.ip_id from public.goods g where g.id in(select value->>'goodId' from jsonb_array_elements(p_selection))) order by ip.id for share;
 perform 1 from private.goods_preorder_policies p where p.id in(select v.preorder_policy_id from public.goods_variants v
  where v.id in(select (value->>'variantId')::uuid from jsonb_array_elements(p_selection))) order by p.id for update;
 perform 1 from public.fulfillment_origins o where o.id in(select g.origin_id from public.goods g
  where g.id in(select value->>'goodId' from jsonb_array_elements(p_selection))) order by o.id for share;
 perform 1 from public.shipping_carriers c where c.code in(select o.default_carrier from public.fulfillment_origins o join public.goods g on g.origin_id=o.id
  where g.id in(select value->>'goodId' from jsonb_array_elements(p_selection))) order by c.code for share;
 if p_user_coupon_id is not null then
  perform 1 from public.user_coupons h where h.id=p_user_coupon_id for update;
  perform 1 from public.coupons c join public.user_coupons h on h.coupon_code=c.code where h.id=p_user_coupon_id for share of c;
 end if;
 perform 1 from private.store_credit_policy where singleton for share;
 perform private.lock_store_credit_account(p_actor);
 perform 1 from private.store_credit_lots where user_id=p_actor order by expires_at,id for update;
end $$;

-- Refactor the live held-validity definition into one timestamp-aware owner.
-- Existing ABI, owner, and ACL remain unchanged; v2 passes the common time only
-- after catalog/coupon/credit locks. Legacy callers keep statement-time input.
do $$declare definition text;old_header text;new_header text;begin
 definition:=pg_get_functiondef('private.evaluate_coupon_target_lines(uuid,uuid,jsonb,uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,'statement_timestamp()','')))/length('statement_timestamp()')<>3 then
  raise exception 'transaction_coupon_clock_anchor_changed';end if;
 old_header:='private.evaluate_coupon_target_lines(p_user_coupon_id uuid, p_user_id uuid, p_lines jsonb, p_order_id uuid DEFAULT NULL::uuid,';
 new_header:='private.evaluate_coupon_target_lines_at(p_user_coupon_id uuid, p_user_id uuid, p_lines jsonb, p_order_id uuid, p_at timestamp with time zone,';
 if position(old_header in definition)=0 then raise exception 'transaction_coupon_signature_anchor_changed';end if;
 definition:=replace(definition,old_header,new_header);definition:=replace(definition,'statement_timestamp()','p_at');
 definition:=replace(definition,E'begin\n o_reason:=',E'begin\n if p_at is null or not isfinite(p_at) then raise invalid_parameter_value using message=''invalid_coupon_evaluation_time'';end if;\n o_reason:=');
 execute definition;
end $$;
create or replace function private.evaluate_coupon_target_lines(p_user_coupon_id uuid,p_user_id uuid,p_lines jsonb,p_order_id uuid default null,
 out o_reason text,out o_discount bigint,out o_coupon_code text,out o_eligible_subtotal bigint,out o_terms_snapshot jsonb)
returns record language sql stable security definer set search_path='' as $$
 select * from private.evaluate_coupon_target_lines_at(p_user_coupon_id,p_user_id,p_lines,p_order_id,statement_timestamp());
$$;

create function private.reserve_order_store_credits_explicit(p_order_id uuid,p_user_id uuid,p_subtotal bigint,p_coupon_discount bigint,p_shipping_fee bigint,
 p_requested_amount bigint,p_at timestamptz) returns bigint language plpgsql volatile security definer set search_path='' as $$
declare policy private.store_credit_policy;balance jsonb;outstanding bigint;take bigint;lot private.store_credit_lots;begin
 if p_at is null or not isfinite(p_at) or p_requested_amount is null or p_requested_amount not between 0 and 999999999999 then
  raise invalid_parameter_value using message='store_credit_amount_invalid';end if;
 perform 1 from public.orders where id=p_order_id and user_id=p_user_id and status='pending';
 if not found then raise check_violation using message='store_credit_order_invalid';end if;
 select * into policy from private.store_credit_policy where singleton for share;
 update public.orders set store_credit_policy_snapshot=case when policy.enabled then private.store_credit_policy_json()-'evidence' else null end where id=p_order_id;
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
end $$;
create or replace function private.reserve_order_store_credits(p_order_id uuid,p_user_id uuid,p_subtotal bigint,p_coupon_discount bigint,p_shipping_fee bigint)
returns bigint language plpgsql volatile security definer set search_path='' as $$declare requested bigint;begin
 select coalesce(intent.amount,0) into requested from public.orders o
  left join private.store_credit_checkout_intents intent on intent.user_id=o.user_id and intent.checkout_key=o.checkout_key
  where o.id=p_order_id and o.user_id=p_user_id and o.status='pending';
 if not found then raise check_violation using message='store_credit_order_invalid';end if;
 return private.reserve_order_store_credits_explicit(p_order_id,p_user_id,p_subtotal,p_coupon_discount,p_shipping_fee,requested,clock_timestamp());
end $$;

create function private.calculate_goods_transaction_shipping(p_lines jsonb,p_destination jsonb,p_choices jsonb,p_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
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
end $$;

create function private.calculate_goods_transaction_locked(p_actor uuid,p_selection jsonb,p_address jsonb,p_delivery_choices jsonb,
 p_user_coupon_id uuid,p_store_credit_amount bigint,p_at timestamptz,p_line_ids jsonb,p_order_id uuid default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare entry jsonb;index integer:=0;good public.goods;variant public.goods_variants;price record;supply record;good_qty numeric;variant_qty numeric;
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
  where c.good_id in(select value->>'goodId' from jsonb_array_elements(p_selection));
 for entry in select value from jsonb_array_elements(p_selection) loop
  select g.* into good from public.goods g join public.ips ip on ip.id=g.ip_id
   join public.fulfillment_origins origin on origin.id=g.origin_id and origin.is_active
   where g.id=entry->>'goodId' and g.archived_at is null and g.published_at is not null and g.sale_restriction='none'
    and (g.sale_starts_at is null or g.sale_starts_at<=p_at) and (g.sale_ends_at is null or g.sale_ends_at>p_at)
    and ip.archived_at is null and ip.published_at is not null;
  if not found then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','goods_unavailable','goodId',entry->>'goodId')));end if;
  select * into variant from public.goods_variants where id=(entry->>'variantId')::uuid and good_id=good.id and archived_at is null;
  if not found then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','goods_unavailable','goodId',good.id)));end if;
  select sum((value->>'qty')::numeric) into good_qty from jsonb_array_elements(p_selection) where value->>'goodId'=good.id;
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
  priced_lines:=priced_lines||jsonb_build_array(jsonb_build_object('lineId',p_line_ids->>index,'goodId',good.id,'regularUnitPrice',price.regular_price,
   'unitPrice',price.effective_price,'qty',entry->'qty'));
  shipping_lines:=shipping_lines||jsonb_build_array(jsonb_build_object('origin_id',good.origin_id,'good_id',good.id,'qty',entry->'qty',
   'unit_price',price.effective_price,'fee_type',good.shipping_fee_type,'individual_fee',good.individual_fee));
  select value into selected_policy from jsonb_array_elements(policies) where value->>'goodId'=good.id;
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
   when coupon_data#>>'{termsSnapshot,goodsScope}'='all' or (coupon_data#>'{termsSnapshot,targetGoodIds}') ? (value->>'goodId')
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
end $$;

create function private.goods_transaction_calculation_contract(p_calculation jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select (p_calculation-'display')||jsonb_build_object('display',(p_calculation->'display')-array['calculatedAt','nextChangeAt','storeCreditMaximum']);
$$;
create function private.quote_goods_transaction(p_actor uuid,p_source jsonb,p_selection jsonb,p_address jsonb,p_delivery_choices jsonb,
 p_user_coupon_id uuid,p_store_credit_amount bigint) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare selection jsonb;address jsonb;choices jsonb;line_ids jsonb;at_time timestamptz;expires timestamptz;calculation jsonb;quote_id uuid;
begin
 perform private.lock_goods_transaction_source(p_actor,p_source);
 perform private.assert_goods_transaction_actor(p_actor);
 selection:=private.normalize_goods_transaction_selection(p_selection);
 if p_address is null or p_address='null'::jsonb then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','address_required','goodId',null)));end if;
 address:=private.normalize_goods_transaction_address(p_address);choices:=private.normalize_goods_transaction_choices(p_delivery_choices,selection);
 perform private.lock_goods_transaction_catalog(p_actor,selection,p_user_coupon_id);
 perform private.assert_goods_transaction_runtime();
 at_time:=clock_timestamp();
 -- Delete expired actor quote PII while the actor lock serializes issuance.
 delete from private.goods_transaction_quotes where actor_id=p_actor and expires_at<=at_time;
 if (select count(*) from private.goods_transaction_quotes where actor_id=p_actor and expires_at>at_time and order_id is null)>=10 then
  delete from private.goods_transaction_quotes where id=(select id from private.goods_transaction_quotes where actor_id=p_actor and expires_at>at_time and order_id is null order by created_at,id limit 1);
 end if;
 select jsonb_agg(gen_random_uuid() order by position) into line_ids from jsonb_array_elements(selection) with ordinality selected(value,position);
 calculation:=private.calculate_goods_transaction_locked(p_actor,selection,address,choices,p_user_coupon_id,p_store_credit_amount,at_time,line_ids);
 if calculation->>'state'='blocked' then return calculation;end if;
 expires:=least(at_time+interval '10 minutes',(calculation#>>'{display,nextChangeAt}')::timestamptz);
 if expires<=clock_timestamp() then return jsonb_build_object('state','blocked','issues',jsonb_build_array(jsonb_build_object('code','source_changed','goodId',null)));end if;
 if octet_length(calculation::text)>2097152 then raise program_limit_exceeded using message='transaction_quote_too_large';end if;
 insert into private.goods_transaction_quotes(actor_id,source,selection,address,delivery_choices,user_coupon_id,store_credit_amount,line_ids,calculation,created_at,expires_at)
  values(p_actor,p_source,selection,address,choices,p_user_coupon_id,p_store_credit_amount,line_ids,calculation,at_time,expires) returning id into quote_id;
 return jsonb_build_object('state','quoted','quoteId',quote_id,'expiresAt',expires,'display',calculation->'display');
end $$;

create function private.goods_transaction_public_shipping(p_source_kind text,p_raw_groups jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(case when p_source_kind='gift' then jsonb_build_object('calculationVersion',2,'originId',value->'originId',
  'originName',value->'originName','totalFee',value->'totalFee','prepaidFee',value->'prepaidFee','collectFee',value->'collectFee','fullFee',value->'fullFee',
  'components',value->'components','collector',value->'collector')
 else value-array['collectContractSnapshot','collectContractId','deliveryTerms'] end order by value->>'originId'),'[]')
 from jsonb_array_elements(p_raw_groups);
$$;
create function private.goods_transaction_request_digest(p_salt uuid,p_source jsonb,p_selection jsonb,p_address jsonb,p_quote_id uuid,p_method public.order_payment_method)
returns text language sql immutable security invoker set search_path='' as $$
 select encode(extensions.digest(convert_to(jsonb_build_array(p_salt,p_source,p_selection,p_address,p_quote_id,p_method)::text,'UTF8'),'sha256'),'hex');
$$;
create function private.replay_goods_transaction_receipt(p_actor uuid,p_source jsonb,p_quote_id uuid,p_checkout_key uuid,
 p_payment_method public.order_payment_method) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare existing private.order_goods_transactions;method public.order_payment_method;begin
 perform private.lock_goods_transaction_source(p_actor,p_source);
 if p_quote_id is null or p_checkout_key is null or p_payment_method is null then raise invalid_parameter_value using message='invalid_transaction_replay';end if;
 select * into existing from private.order_goods_transactions where actor_id=p_actor and checkout_key=p_checkout_key;
 if not found then return null;end if;
 select payment_method into method from public.orders where id=existing.order_id;
 if existing.quote_id<>p_quote_id or existing.source_kind<>p_source->>'kind' or existing.source_id<>(p_source->>'id')::uuid
  or existing.source_revision<>p_source->>'revision' or method<>p_payment_method then raise sqlstate 'PT409' using message='checkout_key_conflict';end if;
 return existing.original_receipt;
end $$;
create function private.place_goods_transaction(p_actor uuid,p_source jsonb,p_selection jsonb,p_address jsonb,p_quote_id uuid,p_checkout_key uuid,
 p_payment_method public.order_payment_method) returns uuid language plpgsql volatile security definer set search_path='' as $$
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
end $$;

create function private.goods_transaction_snapshot_matches(p_order_id uuid,p_total bigint,p_shipping_fee bigint) returns boolean
language sql stable security definer set search_path='' as $$
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
    having sum(case when c.payment_mode='prepaid' then c.total_fee else 0 end)=s.shipping_fee
     and sum(case when c.payment_mode='collect' then c.total_fee else 0 end)=s.shipping_collect_fee))
  and not exists(select 1 from private.shipping_charge_components c join public.order_shipments s on s.id=c.shipment_id
   where c.order_id=purchase.id and (s.order_id<>purchase.id or s.origin_id<>c.origin_id or not exists(
    select 1 from public.order_items item where item.order_id=purchase.id and item.good_id=c.good_id and item.origin_id_snapshot=c.origin_id)))
  and (select count(*) from private.shipping_charge_components where order_id=purchase.id)=
   (select count(distinct good_id) from public.order_items where order_id=purchase.id));
$$;
-- Preserve the current v1 amount AND preorder-reservation guard verbatim.
do $$declare definition text;begin
 definition:=pg_get_functiondef('private.goods_order_snapshot_matches(uuid,bigint,bigint)'::regprocedure);
 if position('reservation.state' in definition)=0 or position('reservation.qty' in definition)=0 then raise exception 'transaction_legacy_snapshot_anchor_changed';end if;
 definition:=replace(definition,'private.goods_order_snapshot_matches(','private.goods_order_snapshot_matches_v1(');execute definition;
end $$;
create or replace function private.goods_order_snapshot_matches(p_order_id uuid,p_total bigint,p_shipping_fee bigint) returns boolean
language sql stable security invoker set search_path='' as $$
 select case when (select calculation_version from public.orders where id=p_order_id)=2
  then private.goods_transaction_snapshot_matches(p_order_id,p_total,p_shipping_fee)
  else private.goods_order_snapshot_matches_v1(p_order_id,p_total,p_shipping_fee) end;
$$;
create function private.guard_order_transaction_terms() returns trigger
language plpgsql volatile security definer set search_path='' as $$declare version integer;begin
 select calculation_version into version from public.orders where id=new.order_id;
 if version=2 then
  if not exists(select 1 from private.order_goods_transactions where order_id=new.order_id) then
   raise check_violation using message='transaction_order_binding_required';end if;
 elsif exists(select 1 from private.goods_transaction_configs c left join private.goods_volume_discount_versions v on v.id=c.volume_version_id
  left join private.goods_delivery_versions d on d.id=c.delivery_version_id where c.good_id=new.good_id and (v.status='active' or d.status='active')) then
  raise check_violation using message='checkout_contract_upgrade_required';
 elsif new.volume_unit_discount<>0 or new.volume_discount_total<>0 then raise check_violation using message='transaction_order_binding_required';end if;
 return new;
end $$;
create trigger order_item_transaction_terms_guard before insert on public.order_items for each row execute function private.guard_order_transaction_terms();

create function private.cart_goods_transaction_expected_selection(p_expected_cart jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$declare selection jsonb;begin
 if jsonb_typeof(p_expected_cart) is distinct from 'array' or jsonb_array_length(p_expected_cart) not between 1 and 19239
  or exists(select 1 from jsonb_array_elements(p_expected_cart) r where not private.transaction_json_keys(r,array['good_id','variant_id','qty','input_revision','input_values'])) then
  raise invalid_parameter_value using message='invalid_checkout_cart_snapshot';end if;
 select jsonb_agg(jsonb_build_object('goodId',value->'good_id','variantId',value->'variant_id','qty',value->'qty',
  'inputRevision',value->'input_revision','inputValues',value->'input_values')) into selection from jsonb_array_elements(p_expected_cart);
 return private.normalize_goods_transaction_selection(selection);
end $$;
create function private.goods_cart_transaction_source(p_actor uuid,p_selection jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('kind','cart','id',p_actor,'revision',encode(extensions.digest(convert_to(p_selection::text,'UTF8'),'sha256'),'hex'));
$$;
create function private.assert_cart_goods_transaction_selection(p_actor uuid,p_selection jsonb) returns void
language plpgsql volatile security definer set search_path='' as $$declare actual jsonb;begin
 select coalesce(jsonb_agg(jsonb_build_object('goodId',good_id,'variantId',variant_id,'qty',qty,'inputRevision',input_revision,'inputValues',input_values)
  order by good_id,variant_id,input_revision,input_values::text),'[]') into actual from public.cart_items where user_id=p_actor;
 if actual is distinct from p_selection then raise sqlstate 'PT409' using message='cart_snapshot_changed';end if;
end $$;
create function public.quote_cart_goods_transaction(p_user_id uuid,p_expected_cart jsonb,p_address jsonb,p_delivery_choices jsonb,
 p_user_coupon_id uuid,p_store_credit_amount bigint) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare selection jsonb;source jsonb;selected_coupon uuid;begin
 selection:=private.cart_goods_transaction_expected_selection(p_expected_cart);source:=private.goods_cart_transaction_source(p_user_id,selection);
 perform private.lock_goods_transaction_source(p_user_id,source);
 perform private.assert_cart_goods_transaction_selection(p_user_id,selection);
 select user_coupon_id into selected_coupon from public.cart_coupon_selections where user_id=p_user_id;
 if selected_coupon is distinct from p_user_coupon_id then raise sqlstate 'PT409' using message='coupon_snapshot_changed';end if;
 return private.quote_goods_transaction(p_user_id,source,selection,p_address,p_delivery_choices,p_user_coupon_id,p_store_credit_amount);
end $$;
create function public.place_cart_goods_transaction(p_user_id uuid,p_expected_cart jsonb,p_address jsonb,p_quote_id uuid,p_checkout_key uuid,
 p_payment_method public.order_payment_method) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare selection jsonb;source jsonb;selected_coupon uuid;quoted_coupon uuid;result uuid;begin
 selection:=private.cart_goods_transaction_expected_selection(p_expected_cart);source:=private.goods_cart_transaction_source(p_user_id,selection);
 perform private.lock_goods_transaction_source(p_user_id,source);
 if exists(select 1 from private.order_goods_transactions where actor_id=p_user_id and checkout_key=p_checkout_key) then
  return private.place_goods_transaction(p_user_id,source,selection,p_address,p_quote_id,p_checkout_key,p_payment_method);end if;
 perform private.assert_cart_goods_transaction_selection(p_user_id,selection);
 select user_coupon_id into selected_coupon from public.cart_coupon_selections where user_id=p_user_id;
 select user_coupon_id into quoted_coupon from private.goods_transaction_quotes where id=p_quote_id and actor_id=p_user_id;
 if found and selected_coupon is distinct from quoted_coupon then raise sqlstate 'PT409' using message='coupon_snapshot_changed';end if;
 result:=private.place_goods_transaction(p_user_id,source,selection,p_address,p_quote_id,p_checkout_key,p_payment_method);
 -- Only this adapter owns the live cart. Gift/subscription never read it.
 delete from public.cart_items cart where user_id=p_user_id and exists(select 1 from jsonb_array_elements(selection) selected
  where selected->>'goodId'=cart.good_id and (selected->>'variantId')::uuid=cart.variant_id and (selected->>'qty')::integer=cart.qty
   and (selected->>'inputRevision')::integer=cart.input_revision and selected->'inputValues'=cart.input_values);
 delete from public.cart_coupon_selections where user_id=p_user_id and user_coupon_id=quoted_coupon;
 return result;
end $$;
create function public.resume_cart_goods_transaction(p_user_id uuid,p_quote_id uuid,p_checkout_key uuid,p_payment_method public.order_payment_method,
 p_allow_new boolean default false) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare existing private.order_goods_transactions;quoted private.goods_transaction_quotes;source jsonb;receipt jsonb;expected_cart jsonb;begin
 perform private.lock_goods_transaction_actor(p_user_id);
 if p_quote_id is null or p_checkout_key is null or p_payment_method is null or p_allow_new is null then
  raise invalid_parameter_value using message='invalid_transaction_resume';end if;
 select * into existing from private.order_goods_transactions where actor_id=p_user_id and checkout_key=p_checkout_key;
 if found then
  if existing.source_kind<>'cart' then raise sqlstate 'PT409' using message='checkout_key_conflict';end if;
  source:=jsonb_build_object('kind',existing.source_kind,'id',existing.source_id,'revision',existing.source_revision);
  receipt:=private.replay_goods_transaction_receipt(p_user_id,source,p_quote_id,p_checkout_key,p_payment_method);
  return (receipt->>'orderId')::uuid;
 end if;
 if not p_allow_new then raise check_violation using message='transaction_new_payment_disabled';end if;
 select * into quoted from private.goods_transaction_quotes where id=p_quote_id and actor_id=p_user_id;
 if not found or quoted.source->>'kind'<>'cart' or quoted.source->>'id'<>p_user_id::text then
  raise sqlstate 'PT409' using message='transaction_quote_expired';end if;
 select jsonb_agg(jsonb_build_object('good_id',value->'goodId','variant_id',value->'variantId','qty',value->'qty',
  'input_revision',value->'inputRevision','input_values',value->'inputValues')) into expected_cart from jsonb_array_elements(quoted.selection);
 return public.place_cart_goods_transaction(p_user_id,expected_cart,quoted.address,p_quote_id,p_checkout_key,p_payment_method);
end $$;
create function public.get_my_goods_transaction_receipt(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare actor uuid:=auth.uid();receipt jsonb;begin
 if actor is null then raise insufficient_privilege using message='auth_required';end if;
 select original_receipt into receipt from private.order_goods_transactions where order_id=p_order_id and actor_id=actor;
 return receipt;
end $$;
create function public.get_goods_transaction_runtime_enabled() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select enabled from private.goods_transaction_runtime where singleton),false);
$$;
create function public.get_goods_transaction_offers(p_good_ids text[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$declare result jsonb;begin
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
  order by g.id),'[]') into result from public.goods g join public.ips ip on ip.id=g.ip_id
  left join private.goods_transaction_configs c on c.good_id=g.id left join private.goods_volume_discount_versions v on v.id=c.volume_version_id
  left join private.goods_delivery_versions d on d.id=c.delivery_version_id left join public.fulfillment_origins origin on origin.id=g.origin_id
  left join private.shipping_collect_contracts collector on collector.origin_id=origin.id
  left join private.shipping_collect_contract_versions contract on contract.id=collector.version_id
 where g.id=any(p_good_ids) and g.published_at is not null and g.archived_at is null and g.sale_restriction='none'
  and ip.published_at is not null and ip.archived_at is null;
 return result;
end $$;
create function public.purge_expired_goods_transaction_quotes(p_limit integer default 1000) returns integer
language plpgsql volatile security definer set search_path='' as $$declare deleted integer;begin
 if p_limit is null or p_limit not between 1 and 10000 then raise invalid_parameter_value using message='invalid_quote_cleanup_limit';end if;
 with expired as(select id from private.goods_transaction_quotes where expires_at<=clock_timestamp() order by expires_at,id for update skip locked limit p_limit)
 delete from private.goods_transaction_quotes q using expired where q.id=expired.id;
 get diagnostics deleted=row_count;return deleted;
end $$;

-- All current application cart writes already use the four locking RPCs.
-- Direct authenticated DML otherwise bypasses the expected-selection/advisory
-- boundary (and may acquire row locks before catalog locks).
revoke insert,update,delete on public.cart_items from anon,authenticated;
-- Existing profile-first cart mutations could form a three-session cycle with
-- account suspension and a quote holding the cart lock. Acquire the common
-- actor/account/profile order before any cart or catalog row is touched.
do $$declare signature regprocedure;definition text;anchor text:='  perform private.assert_active_user(actor);';begin
 foreach signature in array array['private.set_cart_quantity_with_inputs(text,uuid,integer,integer,jsonb)'::regprocedure,
  'public.merge_cart_items(jsonb)'::regprocedure,'public.add_cart_selection(text,jsonb)'::regprocedure] loop
  definition:=pg_get_functiondef(signature);
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'transaction_cart_lock_anchor_changed: %',signature;end if;
  definition:=replace(definition,anchor,E'  perform private.lock_goods_transaction_actor(actor);\n'||anchor);execute definition;
  perform private.register_operator_internal_contract(signature);
 end loop;
end $$;

do $$declare item regclass;fn regprocedure;begin
 foreach item in array array['private.goods_transaction_quotes'::regclass,'private.order_goods_transactions'::regclass,
  'private.order_price_allocations'::regclass,'private.shipping_charge_components'::regclass,
  'private.shipping_collect_obligations'::regclass,'private.shipping_collect_events'::regclass] loop
  execute format('alter table %s enable row level security',item);
  execute format('revoke all on %s from public,anon,authenticated,service_role',item);
 end loop;
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
  and p.proname=any(array['normalize_goods_transaction_selection','normalize_goods_transaction_address','normalize_goods_transaction_choices',
   'assert_goods_transaction_actor','assert_goods_transaction_runtime','lock_goods_transaction_catalog','evaluate_coupon_target_lines_at','reserve_order_store_credits_explicit','reconcile_order_collect_after_cancel',
   'calculate_goods_transaction_shipping','calculate_goods_transaction_locked','goods_transaction_calculation_contract','quote_goods_transaction',
   'goods_transaction_public_shipping','goods_transaction_request_digest','replay_goods_transaction_receipt','place_goods_transaction','goods_transaction_snapshot_matches',
   'goods_order_snapshot_matches_v1','guard_order_transaction_terms','cart_goods_transaction_expected_selection','goods_cart_transaction_source',
   'assert_cart_goods_transaction_selection']) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',fn);
  execute format('grant execute on function %s to postgres',fn);
  perform private.register_operator_internal_contract(fn);
 end loop;
end $$;
revoke all on function public.quote_cart_goods_transaction(uuid,jsonb,jsonb,jsonb,uuid,bigint),
 public.place_cart_goods_transaction(uuid,jsonb,jsonb,uuid,uuid,public.order_payment_method),public.get_my_goods_transaction_receipt(uuid),
 public.resume_cart_goods_transaction(uuid,uuid,uuid,public.order_payment_method,boolean),
 public.get_goods_transaction_runtime_enabled(),public.get_goods_transaction_offers(text[]),public.purge_expired_goods_transaction_quotes(integer) from public,anon,authenticated,service_role;
grant execute on function public.quote_cart_goods_transaction(uuid,jsonb,jsonb,jsonb,uuid,bigint),
 public.place_cart_goods_transaction(uuid,jsonb,jsonb,uuid,uuid,public.order_payment_method),
 public.resume_cart_goods_transaction(uuid,uuid,uuid,public.order_payment_method,boolean),public.purge_expired_goods_transaction_quotes(integer) to service_role;
grant execute on function public.get_my_goods_transaction_receipt(uuid) to authenticated;
grant execute on function public.get_goods_transaction_runtime_enabled(),public.get_goods_transaction_offers(text[]) to anon,authenticated,service_role;
select private.register_operator_internal_contract('private.evaluate_coupon_target_lines(uuid,uuid,jsonb,uuid)'::regprocedure);
select private.register_operator_internal_contract('private.reserve_order_store_credits(uuid,uuid,bigint,bigint,bigint)'::regprocedure);
select private.register_operator_internal_contract('private.goods_order_snapshot_matches(uuid,bigint,bigint)'::regprocedure);
select private.register_operator_internal_contract('public.quote_cart_goods_transaction(uuid,jsonb,jsonb,jsonb,uuid,bigint)'::regprocedure);
select private.register_operator_internal_contract('public.place_cart_goods_transaction(uuid,jsonb,jsonb,uuid,uuid,public.order_payment_method)'::regprocedure);
select private.register_operator_internal_contract('public.resume_cart_goods_transaction(uuid,uuid,uuid,public.order_payment_method,boolean)'::regprocedure);
select private.register_operator_internal_contract('public.get_my_goods_transaction_receipt(uuid)'::regprocedure);
select private.register_operator_internal_contract('public.get_goods_transaction_runtime_enabled()'::regprocedure);
select private.register_operator_internal_contract('public.get_goods_transaction_offers(text[])'::regprocedure);
select private.register_operator_internal_contract('public.purge_expired_goods_transaction_quotes(integer)'::regprocedure);
-- A deployment with pg_cron gets bounded cleanup. Disposable clones omit cron.
do $$begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('goods-transaction-quote-cleanup','*/5 * * * *','select public.purge_expired_goods_transaction_quotes(10000)');
 end if;
end $$;
notify pgrst,'reload schema';
