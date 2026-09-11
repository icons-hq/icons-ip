-- #495: one MVCC read captures the review source; later catalog, payment,
-- tracking, or coupon edits cannot rewrite a downloaded receipt.
create table private.settled_export_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  request_id uuid not null,
  filters jsonb not null check(jsonb_typeof(filters)='object'),
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  created_at timestamptz not null default now(),
  unique(actor_id,request_id)
);
revoke all on table private.settled_export_receipts from public,anon,authenticated,service_role;

create function private.collect_settled_export(p_from date,p_to date,p_query text)
returns jsonb language sql stable security definer set search_path='' as $$
 with selected as materialized (
  select o.* from public.orders o join public.profiles p on p.id=o.user_id
  where o.status='done'
   and (p_from is null or o.created_at>=(p_from::timestamp at time zone 'Asia/Seoul'))
   and (p_to is null or o.created_at<((p_to+1)::timestamp at time zone 'Asia/Seoul'))
   and (p_query is null
    or position(lower(p_query) in lower(o.id::text))>0
    or position(lower(p_query) in lower(coalesce(p.nickname,'')))>0
    or position(lower(p_query) in lower(coalesce(p.email,'')))>0
    or position(lower(p_query) in lower(coalesce(o.address->>'recipientName','')))>0
    or exists(select 1 from public.order_shipments s where s.order_id=o.id
      and position(nullif(regexp_replace(lower(p_query),'[[:space:]-]','','g'),'') in lower(coalesce(s.tracking_number,'')))>0))
  order by o.created_at desc,o.id desc limit 1001
 )
 select jsonb_build_object('schemaVersion',1,'capturedAt',statement_timestamp(),'orders',coalesce(jsonb_agg(
  jsonb_build_object(
   'id',o.id,'createdAt',o.created_at,'doneAt',o.done_at,'total',o.total,'shippingFee',o.shipping_fee,
   'couponDiscount',o.discount_total,'storeCredits',o.store_credit_total,
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
    'id',s.id,'trackingNumber',s.tracking_number,'shippingFee',s.shipping_fee,'status',s.status
   ) order by s.id) from public.order_shipments s where s.order_id=o.id),'[]'),
   'items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',item.id,'goodId',item.good_id,'variantId',item.variant_id,'goodName',item.good_name_snapshot,'variantName',item.variant_name_snapshot,
    'qty',item.qty,'unitPrice',item.unit_price,'regularUnitPrice',item.regular_unit_price_snapshot,
    'shipmentId',assignment.shipment_id,
    'erpCode',identity.erp_code,'erpName',identity.erp_name,'barcode',identity.barcode,'erpCapturedAt',identity.captured_at
   ) order by assignment.shipment_id nulls last,item.id)
    from public.order_items item left join public.order_shipment_items assignment on assignment.order_item_id=item.id and assignment.order_id=o.id
    left join private.order_item_external_identity_snapshots identity on identity.order_item_id=item.id
    where item.order_id=o.id),'[]')
  ) order by o.created_at desc,o.id desc),'[]')) from selected o;
$$;
revoke all on function private.collect_settled_export(date,date,text) from public,anon,authenticated,service_role;

create function public.admin_create_settled_export(p_request_id uuid,p_filters jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=(select auth.uid()); start_date date; end_date date; query_text text; normalized jsonb;
 receipt private.settled_export_receipts; captured jsonb; order_count integer; item_count integer;
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff required'; end if;
 if p_request_id is null or p_filters is null or jsonb_typeof(p_filters)<>'object'
  or exists(select 1 from jsonb_object_keys(p_filters) k where k not in('from','to','query')) then
  raise check_violation using message='settled_export_invalid_filters'; end if;
 if exists(select 1 from jsonb_each(p_filters) e where jsonb_typeof(e.value) not in('string','null')) then
  raise check_violation using message='settled_export_invalid_filters'; end if;
 begin
  if nullif(p_filters->>'from','') is not null then
   if (p_filters->>'from') !~ '^\d{4}-\d{2}-\d{2}$' then raise invalid_datetime_format; end if;
   start_date:=(p_filters->>'from')::date;
  end if;
  if nullif(p_filters->>'to','') is not null then
   if (p_filters->>'to') !~ '^\d{4}-\d{2}-\d{2}$' then raise invalid_datetime_format; end if;
   end_date:=(p_filters->>'to')::date;
  end if;
 exception when invalid_datetime_format or datetime_field_overflow then
  raise check_violation using message='settled_export_invalid_filters';
 end;
 query_text:=nullif(btrim(p_filters->>'query'),'');
 if start_date>end_date or char_length(query_text)>100 then raise check_violation using message='settled_export_invalid_filters'; end if;
 normalized:=jsonb_build_object('from',start_date,'to',end_date,'query',coalesce(query_text,''));
 perform pg_advisory_xact_lock(hashtextextended('settled-export:'||actor::text||':'||p_request_id::text,0));
 select * into receipt from private.settled_export_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.filters<>normalized then raise check_violation using message='settled_export_request_conflict'; end if;
  return jsonb_build_object('id',receipt.id,'capturedAt',receipt.payload->>'capturedAt','orderCount',jsonb_array_length(receipt.payload->'orders'));
 end if;
 -- This STABLE SQL function uses one statement snapshot for every source table.
 captured:=private.collect_settled_export(start_date,end_date,query_text);
 order_count:=jsonb_array_length(captured->'orders');
 select coalesce(sum(jsonb_array_length(value->'items')),0) into item_count from jsonb_array_elements(captured->'orders');
 if order_count=0 then raise check_violation using message='settled_export_empty'; end if;
 if order_count>1000 or item_count>10000 then raise check_violation using message='settled_export_limit'; end if;
 insert into private.settled_export_receipts(actor_id,request_id,filters,payload)
 values(actor,p_request_id,normalized,captured||jsonb_build_object('filters',normalized)) returning * into receipt;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.settled_export.created','settled_export:'||receipt.id,
  jsonb_build_object('filters',normalized,'orderCount',order_count,'itemCount',item_count,'capturedAt',captured->>'capturedAt'));
 return jsonb_build_object('id',receipt.id,'capturedAt',captured->>'capturedAt','orderCount',order_count);
end $$;
revoke all on function public.admin_create_settled_export(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_create_settled_export(uuid,jsonb) to authenticated;

create function public.admin_read_settled_export(p_export_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare receipt private.settled_export_receipts;
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff required'; end if;
 select * into receipt from private.settled_export_receipts where id=p_export_id and actor_id=(select auth.uid());
 if not found then raise no_data_found using message='settled_export_not_found'; end if;
 return receipt.payload||jsonb_build_object('receiptId',receipt.id);
end $$;
revoke all on function public.admin_read_settled_export(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_read_settled_export(uuid) to authenticated;
