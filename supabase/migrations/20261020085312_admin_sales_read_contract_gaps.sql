-- Read-only worklist gaps: preserve order/payment/claim mutation contracts.
-- The paid date is the existing provider approval or bank-confirmation event.
create or replace function private.admin_sales_claim_date(p_claim public.order_cancellation_requests,p_basis text)
returns timestamptz language sql stable security invoker set search_path='' as $$
 select case p_basis
  when 'requested' then (p_claim).requested_at
  when 'collected' then (p_claim).collected_at
  when 'completed' then (p_claim).completed_at
  when 'paid' then (select private.admin_sales_order_date(o,'paid') from public.orders o where o.id=(p_claim).order_id)
 end;
$$;
revoke all on function private.admin_sales_claim_date(public.order_cancellation_requests,text) from public,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION public.admin_search_order_claims_console(p_claim_type text DEFAULT NULL::text, p_stage text DEFAULT NULL::text, p_reason_type text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_field text DEFAULT 'all'::text, p_date_field text DEFAULT 'requested'::text, p_sort text DEFAULT 'newest'::text)
 RETURNS TABLE(id uuid, reference bigint, order_id uuid, claim_type text, stage text, reason_type text, staff_reason_code text, buyer_id uuid, buyer_name text, buyer_email text, order_status order_status, order_total bigint, requested_at timestamp with time zone, collected_at timestamp with time zone, completed_at timestamp with time zone, refund_method text, handler_name text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_stages text[];
begin
  if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required'; end if;

  if (select auth.uid()) is null or not public.has_operator_capability('sales.manage',false) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_claim_type is not null and p_claim_type not in ('cancel', 'return', 'exchange') then
    raise check_violation using message = 'invalid claim type filter';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise check_violation using message = 'invalid claim date range';
  end if;
  if v_query is not null and length(v_query) > 100 then
    raise check_violation using message = 'claim search query too long';
  end if;

  if p_field is null or p_field not in ('all','order','buyer','email')
    or p_date_field is null or p_date_field not in ('requested','paid','collected','completed')
    or p_sort is null or p_sort not in ('newest','oldest','amount_high','amount_low') then
    raise invalid_parameter_value using message='invalid_claim_search';
  end if;

  -- 'open'은 단계 하나가 아니라 "아직 끝나지 않은 것 전부"다. 화면이 이 집합을
  -- 직접 나열하면 단계를 하나 더할 때 목록에서만 조용히 빠진다.
  if p_stage = 'open' then
    v_stages := array[
      'requested', 'in_review', 'collecting', 'collected',
      'on_hold', 'processing', 'needs_review'
    ];
  elsif p_stage is not null then
    v_stages := array[p_stage];
  end if;

  if p_reason_type is not null and p_reason_type not in('change_of_mind','defect','staff',
    'staff:out_of_stock','staff:customer_request','staff:test_payment_cleanup','staff:other') then
    raise check_violation using message='invalid claim reason filter';
  end if;
  return query
  select
    request.id,
    request.reference,
    request.order_id,
    request.claim_type,
    request.stage,
    request.reason_type,
    request.staff_reason_code,
    orders.user_id as buyer_id,
    profile.nickname as buyer_name,
    profile.email as buyer_email,
    orders.status as order_status,
    orders.total as order_total,
    request.requested_at,
    request.collected_at,
    request.completed_at,
    refund.method as refund_method,
    handler.nickname as handler_name,
    count(*) over()::bigint as total_count
  from public.order_cancellation_requests as request
  join public.orders as orders on orders.id = request.order_id
  join public.profiles as profile on profile.id = orders.user_id
  left join public.profiles as handler on handler.id = request.decided_by
  left join lateral (
    select payment_refund.method
    from public.refunds as payment_refund
    join public.payments as payment on payment.id = payment_refund.payment_id
    where payment.purpose = 'order'
      and payment.ref_id = request.order_id
    order by payment_refund.created_at desc, payment_refund.id desc
    limit 1
  ) as refund on true
  where (p_claim_type is null or request.claim_type = p_claim_type)
    and (v_stages is null or request.stage = any(v_stages))
    and private.admin_sales_claim_matches(request,p_reason_type,p_from,p_to,v_query,p_field,p_date_field)
  order by
    case when p_sort='amount_high' then orders.total end desc nulls last,
    case when p_sort='amount_low' then orders.total end asc nulls last,
    case when p_sort='oldest' then private.admin_sales_claim_date(request,p_date_field) end asc nulls last,
    case when p_sort<>'oldest' then private.admin_sales_claim_date(request,p_date_field) end desc nulls last,
    case when p_sort='oldest' then request.id end asc,
    request.id desc
  limit v_limit
  offset v_offset;
end;
$function$;

create or replace function public.admin_order_claim_stage_counts_console(p_claim_type text default null,p_reason_type text default null,p_from date default null,p_to date default null,p_query text default null,p_field text default 'all',p_date_field text default 'requested')
returns table(stage text,total bigint) language plpgsql stable security definer set search_path='' as $$
declare needle text:=nullif(btrim(p_query),'');begin
 if not private.has_operator_capability(auth.uid(),'sales.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if (p_claim_type is not null and p_claim_type not in('cancel','return','exchange')) or p_field is null or p_field not in('all','order','buyer','email')
  or p_date_field is null or p_date_field not in('requested','paid','collected','completed') or p_from is not null and p_to is not null and p_from>p_to or char_length(needle)>100 then
  raise invalid_parameter_value using message='invalid_claim_search';end if;
  if p_reason_type is not null and p_reason_type not in('change_of_mind','defect','staff',
    'staff:out_of_stock','staff:customer_request','staff:test_payment_cleanup','staff:other') then
    raise check_violation using message='invalid claim reason filter';
  end if;
 return query select known.value,count(request.id)::bigint from unnest(array['requested','in_review','collecting','collected','on_hold','processing','needs_review','completed','rejected','withdrawn'])known(value)
 left join public.order_cancellation_requests request on request.stage=known.value and(p_claim_type is null or request.claim_type=p_claim_type)
  and private.admin_sales_claim_matches(request,p_reason_type,p_from,p_to,needle,p_field,p_date_field) group by known.value;
end $$;

-- Keep the historical date-only collector unchanged for existing callers.
create function private.collect_settled_export_for_search(p_from date,p_to date,p_query text,p_date_field text,p_field text)
returns jsonb language sql stable security definer set search_path='' as $$
 with selected as materialized (
  select o.* from public.orders o join public.profiles p on p.id=o.user_id
  where o.status='done'
   and private.admin_sales_order_matches(o,p_from,p_to,p_query,p_field,p_date_field,null)
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

CREATE OR REPLACE FUNCTION public.admin_create_settled_export(p_request_id uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 actor uuid:=(select auth.uid()); start_date date; end_date date; query_text text; date_basis text; search_field text; normalized jsonb;
 receipt private.settled_export_receipts; captured jsonb; order_count integer; item_count integer;
begin
  perform private.require_operator_capability('sales.manage',false);

 if actor is null or not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='staff required'; end if;
 if p_request_id is null or p_filters is null or jsonb_typeof(p_filters)<>'object'
  or exists(select 1 from jsonb_object_keys(p_filters) k where k not in('from','to','query','dateField','field')) then
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
 date_basis:=coalesce(nullif(p_filters->>'dateField',''),'ordered');
 if date_basis not in ('ordered','paid','confirmed','shipped','delivered','settled') then raise check_violation using message='settled_export_invalid_filters';end if;
 search_field:=coalesce(nullif(p_filters->>'field',''),'all');
 if search_field not in('all','order','nickname','email','recipient','tracking','phone','product') then
  raise check_violation using message='settled_export_invalid_filters';end if;
 query_text:=nullif(btrim(p_filters->>'query'),'');
 if start_date>end_date or char_length(query_text)>100 then raise check_violation using message='settled_export_invalid_filters'; end if;
 normalized:=jsonb_build_object('from',start_date,'to',end_date,'query',coalesce(query_text,''));
 if date_basis<>'ordered' then normalized:=normalized||jsonb_build_object('dateField',date_basis);end if;
 if search_field<>'all' then normalized:=normalized||jsonb_build_object('field',search_field);end if;
 perform pg_advisory_xact_lock(hashtextextended('settled-export:'||actor::text||':'||p_request_id::text,0));
 select * into receipt from private.settled_export_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.filters<>normalized then raise check_violation using message='settled_export_request_conflict'; end if;
  return jsonb_build_object('id',receipt.id,'capturedAt',receipt.payload->>'capturedAt','orderCount',jsonb_array_length(receipt.payload->'orders'));
 end if;
 -- This STABLE SQL function uses one statement snapshot for every source table.
 captured:=private.collect_settled_export_for_search(start_date,end_date,query_text,date_basis,search_field);
 order_count:=jsonb_array_length(captured->'orders');
 select coalesce(sum(jsonb_array_length(value->'items')),0) into item_count from jsonb_array_elements(captured->'orders');
 if order_count=0 then raise check_violation using message='settled_export_empty'; end if;
 if order_count>1000 or item_count>10000 then raise check_violation using message='settled_export_limit'; end if;
 insert into private.settled_export_receipts(actor_id,request_id,filters,payload)
 values(actor,p_request_id,normalized,captured||jsonb_build_object('filters',normalized)) returning * into receipt;
 insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.settled_export.created','settled_export:'||receipt.id,
  jsonb_build_object('filters',normalized,'orderCount',order_count,'itemCount',item_count,'capturedAt',captured->>'capturedAt'));
 return jsonb_build_object('id',receipt.id,'capturedAt',captured->>'capturedAt','orderCount',order_count);
end $function$;


revoke all on function public.admin_search_order_claims_console(text,text,text,date,date,text,integer,integer,text,text,text),
 public.admin_order_claim_stage_counts_console(text,text,date,date,text,text,text),public.admin_create_settled_export(uuid,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_search_order_claims_console(text,text,text,date,date,text,integer,integer,text,text,text),
 public.admin_order_claim_stage_counts_console(text,text,date,date,text,text,text),public.admin_create_settled_export(uuid,jsonb) to authenticated;
revoke all on function private.collect_settled_export_for_search(date,date,text,text,text) from public,anon,authenticated,service_role;
-- CREATE OR REPLACE preserves the existing RPC's postgres owner, while local
-- migrations may create this helper as supabase_admin. Only that definer needs it.
grant execute on function private.collect_settled_export_for_search(date,date,text,text,text) to postgres;
select private.register_operator_internal_contract('private.admin_sales_claim_date(public.order_cancellation_requests,text)'::regprocedure);
select private.register_operator_internal_contract('private.collect_settled_export_for_search(date,date,text,text,text)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_search_order_claims_console(text,text,text,date,date,text,integer,integer,text,text,text)','sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_order_claim_stage_counts_console(text,text,date,date,text,text,text)','sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_create_settled_export(uuid,jsonb)','sales.manage','write',false);
notify pgrst,'reload schema';
