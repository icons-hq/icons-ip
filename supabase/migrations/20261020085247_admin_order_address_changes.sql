-- Preserve the original shipping/payment amounts and the complete address history.
-- Once a warehouse export or physical dispatch exists, address changes are closed.
alter table public.orders add column address_revision integer not null default 0 check(address_revision>=0);
create function private.advance_order_address_revision() returns trigger
language plpgsql security invoker set search_path='' as $$
begin new.address_revision:=old.address_revision+case when new.address is distinct from old.address then 1 else 0 end;return new;end $$;
revoke all on function private.advance_order_address_revision() from public,anon,authenticated,service_role;
create trigger orders_address_revision before update of address,address_revision on public.orders for each row execute function private.advance_order_address_revision();

create table private.order_address_changes (
 id uuid primary key, order_id uuid not null references public.orders(id),
 actor_id uuid not null references public.profiles(id), expected_order_revision integer not null,
 before_address jsonb not null, after_address jsonb not null, reason text not null,
 destination_quote jsonb, created_at timestamptz not null default clock_timestamp()
);
alter table private.order_address_changes enable row level security;
revoke all on private.order_address_changes from public,anon,authenticated,service_role;
create index order_address_changes_order_idx on private.order_address_changes(order_id,created_at desc,id);

create function private.normalize_order_address_change(p_address jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare normalized jsonb; field text;
begin
 if p_address is null or jsonb_typeof(p_address)<>'object'
  or not(p_address ?& array['recipientName','phone','postalCode','address1'])
  or exists(select 1 from jsonb_object_keys(p_address)k where k not in ('recipientName','phone','postalCode','address1','address2','deliveryNote'))
  or exists(select 1 from jsonb_each(p_address)e where jsonb_typeof(e.value)<>'string') then
  raise invalid_parameter_value using message='invalid_order_address';end if;
 foreach field in array array['recipientName','phone','postalCode','address1','address2','deliveryNote'] loop
  if coalesce(p_address->>field,'')~'[[:cntrl:]]' then raise invalid_parameter_value using message='invalid_order_address';end if;
 end loop;
 normalized:=jsonb_build_object('recipientName',btrim(p_address->>'recipientName'),'phone',btrim(p_address->>'phone'),
  'postalCode',btrim(p_address->>'postalCode'),'address1',btrim(p_address->>'address1'),
  'address2',btrim(coalesce(p_address->>'address2','')),'deliveryNote',btrim(coalesce(p_address->>'deliveryNote','')));
 if char_length(normalized->>'recipientName') not between 1 and 50 or normalized->>'phone'!~'^[0-9]{8,15}$'
  or normalized->>'postalCode'!~'^[0-9]{5}$' or char_length(normalized->>'address1') not between 1 and 200
  or char_length(normalized->>'address2')>200 or char_length(normalized->>'deliveryNote')>200 then
  raise invalid_parameter_value using message='invalid_order_address';end if;
 return normalized;
end $$;
revoke all on function private.normalize_order_address_change(jsonb) from public,anon,authenticated,service_role;

create function private.order_address_change_blocker(p_order public.orders) returns text
language sql stable security invoker set search_path='' as $$
 select case
  when p_order.status not in ('paid','confirmed') then 'order_not_ready'
  when p_order.shipped_at is not null or p_order.delivered_at is not null or p_order.done_at is not null then 'order_dispatched'
  when not exists(select 1 from public.order_shipments where order_id=p_order.id) then 'shipments_missing'
  when exists(select 1 from public.order_shipments where order_id=p_order.id and
   (status<>'ready' or exported_at is not null or shipped_at is not null or delivered_at is not null or tracking_number is not null)) then 'order_dispatched'
  when exists(select 1 from public.audit_log where target='order:'||p_order.id::text and
   (action='admin.shipment.exported' or (action in ('admin.order.status_updated','admin.shipment.status_updated') and diff->>'to' in ('shipping','delivered','done')))) then 'order_dispatched'
  when exists(select 1 from public.order_cancellation_requests where order_id=p_order.id and status in ('requested','processing','needs_review'))
   or exists(select 1 from public.order_cancellation_claims where order_id=p_order.id) then 'order_claim_open'
  else null end;
$$;
revoke all on function private.order_address_change_blocker(public.orders) from public,anon,authenticated,service_role;

create function private.order_address_change_receipt(p_id uuid,p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'orderId',c.order_id,'changedAt',c.created_at,'address',c.after_address,'reason',c.reason,
  'currentMatches',o.address=c.after_address)
 from private.order_address_changes c join public.orders o on o.id=c.order_id where c.id=p_id and c.actor_id=p_actor;
$$;
revoke all on function private.order_address_change_receipt(uuid,uuid) from public,anon,authenticated,service_role;

create function public.admin_order_address_context(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare purchase public.orders;blocker text;result jsonb;
begin
 if not private.has_operator_capability(auth.uid(),'sales.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 select * into purchase from public.orders where id=p_order_id;
 if not found then raise no_data_found using message='order_not_found';end if;
 blocker:=private.order_address_change_blocker(purchase);
 select jsonb_build_object('orderId',purchase.id,'address',purchase.address,'revision',purchase.address_revision,
  'allowed',blocker is null,'blocker',blocker,'shipmentCount',(select count(*) from public.order_shipments where order_id=p_order_id),
  'history',coalesce((select jsonb_agg(entry order by happened desc) from (
   select c.created_at happened,jsonb_build_object('id',c.id,'changedAt',c.created_at,'actorName',coalesce(p.nickname,'이름 미등록'),
    'before',c.before_address,'after',c.after_address,'reason',c.reason) entry
   from private.order_address_changes c join public.profiles p on p.id=c.actor_id where c.order_id=p_order_id
   order by c.created_at desc,c.id desc limit 20)h),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.admin_order_address_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_address_context(uuid) to authenticated;

create function public.admin_change_order_address(p_operation_id uuid,p_order_id uuid,p_expected_revision integer,p_address jsonb,p_reason text,p_customer_agreed boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();purchase public.orders; previous private.order_address_changes; address_value jsonb;
 reason text:=nullif(btrim(p_reason),'');blocked text;shipment public.order_shipments;base_groups jsonb:='[]';lines jsonb;
 quote jsonb;origin_key uuid;group_value jsonb;changed_fields jsonb;
begin
 perform private.require_actor_operator_capability(actor,'sales.manage',false);
 if p_operation_id is null or p_order_id is null or p_expected_revision is null or p_expected_revision<0
  or p_customer_agreed is distinct from true or reason is null or char_length(reason)>500 or reason~'[[:cntrl:]]' then
  raise invalid_parameter_value using message='invalid_order_address_change';end if;
 address_value:=private.normalize_order_address_change(p_address);
 perform pg_advisory_xact_lock(hashtextextended('order_address_change:'||p_operation_id::text,0));
 select * into previous from private.order_address_changes where id=p_operation_id;
 if found then
  if previous.actor_id<>actor or previous.order_id<>p_order_id or previous.expected_order_revision<>p_expected_revision
   or previous.after_address<>address_value or previous.reason<>reason then raise unique_violation using message='order_address_request_conflict';end if;
  return private.order_address_change_receipt(p_operation_id,actor);
 end if;
 select * into purchase from public.orders where id=p_order_id for update;
 if not found then raise no_data_found using message='order_not_found';end if;
 perform id from public.order_shipments where order_id=p_order_id order by id for update;
 if purchase.address_revision<>p_expected_revision then raise sqlstate 'PT409' using message='order_address_changed';end if;
 blocked:=private.order_address_change_blocker(purchase);
 if blocked is not null then raise check_violation using message=blocked;end if;
 select jsonb_agg(k order by k) into changed_fields from jsonb_object_keys(address_value)k where coalesce(purchase.address->>k,'')<>address_value->>k;
 if changed_fields is null then raise invalid_parameter_value using message='order_address_unchanged';end if;
 -- Contact/detail-note corrections preserve the destination quote. A changed
 -- postal/base address must remain deliverable at every frozen shipment amount.
 if purchase.address->>'postalCode' is distinct from address_value->>'postalCode'
  or private.shipping_region_text(purchase.address->>'address1') is distinct from private.shipping_region_text(address_value->>'address1') then
  for origin_key in select distinct origin_id from public.order_shipments where order_id=p_order_id order by origin_id loop
   perform id from public.fulfillment_origins where id=origin_key for share;
  end loop;
  for shipment in select * from public.order_shipments where order_id=p_order_id order by id loop
   group_value:=shipment.shipping_fee_snapshot;
   if shipment.delivery_method<>'parcel' or group_value->>'originId' is distinct from shipment.origin_id::text
    or not(group_value ?& array['policySubtotal','baseFee','freeThreshold','policyFee','individualFee','totalFee'])
    or jsonb_typeof(group_value->'totalFee') is distinct from 'number'
    or (group_value->>'totalFee')::bigint<>shipment.shipping_fee then
    raise check_violation using message='order_address_quote_unavailable';end if;
   base_groups:=base_groups||jsonb_build_array(group_value||jsonb_build_object('totalFee',shipment.shipping_fee-coalesce((group_value->>'regionalFee')::bigint,0)));
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('origin_id',origin_id_snapshot,'good_id',good_id,'fee_type',shipping_fee_type_snapshot)),'[]') into lines
   from public.order_items where order_id=p_order_id;
  quote:=private.apply_shipping_region_quote(jsonb_build_object('groups',base_groups),lines,
   jsonb_build_object('postalCode',address_value->>'postalCode','address1',address_value->>'address1'),clock_timestamp());
  if not coalesce((quote->>'checkoutAllowed')::boolean,false) then raise check_violation using message='order_address_region_unavailable';end if;
  if (quote->>'finalTotalFee')::bigint<>purchase.shipping_fee or exists(
   select 1 from jsonb_array_elements(quote->'groups')g join public.order_shipments s on s.order_id=p_order_id and s.origin_id=(g->>'originId')::uuid
   where (g->>'finalFee')::bigint<>s.shipping_fee) then raise check_violation using message='order_address_shipping_fee_changed';end if;
 end if;
 insert into private.order_address_changes(id,order_id,actor_id,expected_order_revision,before_address,after_address,reason,destination_quote)
 values(p_operation_id,p_order_id,actor,p_expected_revision,purchase.address,address_value,reason,quote);
 update public.orders set address=address_value,updated_at=clock_timestamp() where id=p_order_id;
 -- Invalidate any export prepared before the change but not yet marked sent.
 update public.order_shipments set updated_at=clock_timestamp() where order_id=p_order_id;
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.order.address_changed','order:'||p_order_id,
  jsonb_build_object('changedFields',changed_fields,'customerAgreed',true,'shipmentCount',(select count(*) from public.order_shipments where order_id=p_order_id),'shippingFeeUnchanged',true));
 return private.order_address_change_receipt(p_operation_id,actor);
end $$;
revoke all on function public.admin_change_order_address(uuid,uuid,integer,jsonb,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_change_order_address(uuid,uuid,integer,jsonb,text,boolean) to authenticated;

create function public.admin_get_order_address_change(p_operation_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 perform private.require_actor_operator_capability(actor,'sales.manage',false);
 if p_operation_id is null then raise invalid_parameter_value using message='invalid_order_address_change';end if;
 perform pg_advisory_xact_lock(hashtextextended('order_address_change:'||p_operation_id::text,0));
 return private.order_address_change_receipt(p_operation_id,actor);
end $$;
revoke all on function public.admin_get_order_address_change(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_order_address_change(uuid) to authenticated;

do $$begin
 perform private.register_operator_rpc_contract('public.admin_order_address_context(uuid)'::regprocedure,'sales.manage','read',false);
 perform private.register_operator_rpc_contract('public.admin_change_order_address(uuid,uuid,integer,jsonb,text,boolean)'::regprocedure,'sales.manage','write',false);
 perform private.register_operator_rpc_contract('public.admin_get_order_address_change(uuid)'::regprocedure,'sales.manage','read',false);
 perform private.register_operator_internal_contract('private.advance_order_address_revision()'::regprocedure);
 perform private.register_operator_internal_contract('private.normalize_order_address_change(jsonb)'::regprocedure);
 perform private.register_operator_internal_contract('private.order_address_change_blocker(public.orders)'::regprocedure);
 perform private.register_operator_internal_contract('private.order_address_change_receipt(uuid,uuid)'::regprocedure);
end $$;
