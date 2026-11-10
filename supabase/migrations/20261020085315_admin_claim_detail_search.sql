-- Extend existing claim worklist reads; preserve order-wide processing.

create or replace function private.admin_sales_claim_matches(
 p_claim public.order_cancellation_requests,p_reason_type text,p_from date,p_to date,
 p_query text,p_field text,p_date_field text
) returns boolean language sql stable security invoker set search_path='' as $$
 select (p_reason_type is null or (p_reason_type not like 'staff:%' and (p_claim).reason_type=p_reason_type)
  or(p_reason_type like 'staff:%' and (p_claim).reason_type='staff' and (p_claim).staff_reason_code=substr(p_reason_type,7)))
  and (p_from is null or private.admin_sales_claim_date(p_claim,p_date_field)>=(p_from::timestamp at time zone 'Asia/Seoul'))
  and (p_to is null or private.admin_sales_claim_date(p_claim,p_date_field)<((p_to+1)::timestamp at time zone 'Asia/Seoul'))
  and (p_query is null
   or (p_field in ('all','order') and (position(lower(p_query) in lower((p_claim).order_id::text))>0
     or position(lower(p_query) in (p_claim).reference::text)>0))
   or exists(select 1 from public.orders o join public.profiles p on p.id=o.user_id where o.id=(p_claim).order_id
    and ((p_field in ('all','buyer') and position(lower(p_query) in lower(coalesce(p.nickname,'')))>0)
      or (p_field in ('all','email') and position(lower(p_query) in lower(coalesce(p.email,'')))>0)
      or (p_field in ('all','recipient') and position(lower(p_query) in lower(coalesce(o.address->>'recipientName','')))>0)))
   -- IDs use literal, case-insensitive contains like the existing order/item list.
   -- A matching item selects its whole claim; multiple matches never duplicate it.
   or exists(select 1 from public.order_items i where i.order_id=(p_claim).order_id
    and ((p_field in ('all','item') and position(lower(p_query) in lower(i.id::text))>0)
      or (p_field in ('all','product') and position(lower(p_query) in lower(i.good_id))>0))));
$$;

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

  if p_field is null or p_field not in ('all','order','buyer','email','recipient','item','product')
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
 if (p_claim_type is not null and p_claim_type not in('cancel','return','exchange')) or p_field is null or p_field not in('all','order','buyer','email','recipient','item','product')
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

revoke all on function private.admin_sales_claim_matches(public.order_cancellation_requests,text,date,date,text,text,text),
 public.admin_search_order_claims_console(text,text,text,date,date,text,integer,integer,text,text,text),
 public.admin_order_claim_stage_counts_console(text,text,date,date,text,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_search_order_claims_console(text,text,text,date,date,text,integer,integer,text,text,text),
 public.admin_order_claim_stage_counts_console(text,text,date,date,text,text,text) to authenticated;
select private.register_operator_internal_contract('private.admin_sales_claim_matches(public.order_cancellation_requests,text,date,date,text,text,text)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_search_order_claims_console(text,text,text,date,date,text,integer,integer,text,text,text)','sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_order_claim_stage_counts_console(text,text,date,date,text,text,text)','sales.manage','read',false);
notify pgrst,'reload schema';
