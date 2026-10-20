-- Smartstore-style sales worklists. Read-only search extensions preserve all
-- existing order/claim/shipment mutation contracts and legacy RPC signatures.
-- Date filtering uses stored business events, never payment row insertion time.
create function private.admin_sales_order_date(p_order public.orders,p_basis text)
returns timestamptz language sql stable security invoker set search_path='' as $$
 select case p_basis
  when 'ordered' then (p_order).created_at
  when 'confirmed' then (p_order).confirmed_at
  when 'shipped' then (p_order).shipped_at
  when 'delivered' then (p_order).delivered_at
  when 'settled' then (p_order).done_at
  when 'paid' then (
   select min(coalesce(
    (select min(e.approved_at) from private.payment_provider_evidence e where e.payment_attempt_id=a.id),
    (select b.confirmed_at from public.bank_transfer_confirmations b
      where b.attempt_id=a.id and b.order_id=(p_order).id and a.provider='bank_transfer')
   )) from public.payment_attempts a join public.payments payment on payment.id=a.payment_id
    where a.purpose='order' and a.ref_id=(p_order).id and payment.purpose='order'
      and payment.ref_id=(p_order).id and a.amount=payment.amount
  ) end;
$$;
revoke all on function private.admin_sales_order_date(public.orders,text) from public,anon,authenticated,service_role;

create function private.admin_validate_sales_search(p_field text,p_date_field text,p_sort text,p_payment_method text,p_from date,p_to date,p_query text)
returns void language plpgsql immutable security invoker set search_path='' as $$
begin
 if p_field is null or p_field not in ('all','order','nickname','email','recipient','tracking','phone','product')
  or p_date_field is null or p_date_field not in ('ordered','paid','confirmed','shipped','delivered','settled')
  or p_sort is null or p_sort not in ('newest','oldest','amount_high','amount_low')
  or (p_payment_method is not null and p_payment_method not in ('card','bank_transfer'))
  or (p_from is not null and p_to is not null and p_from>p_to) or char_length(p_query)>100 then
  raise invalid_parameter_value using message='invalid_sales_search';
 end if;
end $$;
revoke all on function private.admin_validate_sales_search(text,text,text,text,date,date,text) from public,anon,authenticated,service_role;

create function private.admin_sales_order_matches(p_order public.orders,p_from date,p_to date,p_query text,p_field text,p_date_field text,p_payment_method text)
returns boolean language sql stable security invoker set search_path='' as $$
 select (p_payment_method is null or (p_order).payment_method::text=p_payment_method)
  and (p_from is null or private.admin_sales_order_date(p_order,p_date_field)>=(p_from::timestamp at time zone 'Asia/Seoul'))
  and (p_to is null or private.admin_sales_order_date(p_order,p_date_field)<((p_to+1)::timestamp at time zone 'Asia/Seoul'))
  and (p_query is null
   or (p_field in ('all','order') and position(lower(p_query) in lower((p_order).id::text))>0)
   or (p_field in ('all','nickname') and exists(select 1 from public.profiles p where p.id=(p_order).user_id and position(lower(p_query) in lower(coalesce(p.nickname,'')))>0))
   or (p_field in ('all','email') and exists(select 1 from public.profiles p where p.id=(p_order).user_id and position(lower(p_query) in lower(coalesce(p.email,'')))>0))
   or (p_field in ('all','recipient') and position(lower(p_query) in lower(coalesce((p_order).address->>'recipientName','')))>0)
   or (p_field in ('all','phone') and position(nullif(regexp_replace(p_query,'[[:space:]-]','','g'),'') in regexp_replace(coalesce((p_order).address->>'phone',''),'[[:space:]-]','','g'))>0)
   or (p_field in ('all','tracking') and exists(select 1 from public.order_shipments s where s.order_id=(p_order).id
     and position(nullif(regexp_replace(lower(p_query),'[[:space:]-]','','g'),'') in lower(coalesce(s.tracking_number,'')))>0))
   or (p_field in ('all','product') and exists(select 1 from public.order_items i where i.order_id=(p_order).id
     and (position(lower(p_query) in lower(i.good_name_snapshot))>0
       or position(lower(p_query) in lower(coalesce(i.variant_name_snapshot,'')))>0
       or position(lower(p_query) in lower(coalesce(i.variant_code_snapshot,'')))>0)))
  );
$$;
revoke all on function private.admin_sales_order_matches(public.orders,date,date,text,text,text,text) from public,anon,authenticated,service_role;

create function public.admin_search_orders_console(
  p_status text default null,
  p_from date default null,
  p_to date default null,
  p_query text default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_confirmed_before timestamptz default null,
  p_field text default 'all',
  p_date_field text default 'ordered',
  p_sort text default 'newest',
  p_payment_method text default null
)
returns table (
  id uuid,
  user_id uuid,
  buyer_name text,
  buyer_email text,
  status public.order_status,
  total bigint,
  address jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  shipping_carrier text,
  tracking_number text,
  confirmed_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  done_at timestamptz,
  cancellation_request_id uuid,
  cancellation_request_status text,
  cancellation_reason_type text,
  cancellation_requested_at timestamptz,
  cancellation_decided_at timestamptz,
  cancellation_decision_note text,
  cancellation_claim_type text,
  cancellation_stage text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_field text := coalesce(nullif(btrim(p_field), ''), 'all');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if p_status is not null
    and not exists (
      select 1
      from unnest(enum_range(null::public.order_status)) as allowed(value)
      where allowed.value::text = p_status
    )
  then
    raise check_violation using message = 'invalid order status filter';
  end if;

  perform private.admin_validate_sales_search(v_field,p_date_field,p_sort,p_payment_method,p_from,p_to,v_query);

  if v_field not in ('all', 'order', 'nickname', 'email', 'recipient', 'tracking','phone','product') then
    raise check_violation using message = 'invalid order search field';
  end if;

  if p_from is not null and p_to is not null and p_from > p_to then
    raise check_violation using message = 'invalid order date range';
  end if;

  if v_query is not null and length(v_query) > 100 then
    raise check_violation using message = 'order search query too long';
  end if;

  return query
  select
    orders.id,
    orders.user_id,
    profile.nickname as buyer_name,
    profile.email as buyer_email,
    orders.status,
    orders.total,
    orders.address,
    orders.created_at,
    orders.updated_at,
    (select max(s.carrier)
     from public.order_shipments as s
     where s.order_id = orders.id
     having count(*) = 1),
    (select max(s.tracking_number)
     from public.order_shipments as s
     where s.order_id = orders.id
     having count(*) = 1),
    orders.confirmed_at,
    orders.shipped_at,
    orders.delivered_at,
    orders.done_at,
    cancellation.id as cancellation_request_id,
    cancellation.status as cancellation_request_status,
    cancellation.reason_type as cancellation_reason_type,
    cancellation.requested_at as cancellation_requested_at,
    cancellation.decided_at as cancellation_decided_at,
    cancellation.decision_note as cancellation_decision_note,
    cancellation.claim_type as cancellation_claim_type,
    cancellation.stage as cancellation_stage,
    count(*) over()::bigint as total_count
  from public.orders as orders
  join public.profiles as profile on profile.id = orders.user_id
  left join lateral (
    select
      request.id,
      request.status,
      request.reason_type,
      request.requested_at,
      request.decided_at,
      request.decision_note,
      request.claim_type,
      request.stage
    from public.order_cancellation_requests as request
    where request.order_id = orders.id
    order by request.requested_at desc, request.id desc
    limit 1
  ) as cancellation on true
  where (p_status is null or orders.status::text = p_status)
    and private.admin_sales_order_matches(orders,p_from,p_to,v_query,v_field,p_date_field,p_payment_method)
    and (p_confirmed_before is null or orders.confirmed_at < p_confirmed_before)
  order by
    case when p_sort='amount_high' then orders.total end desc nulls last,
    case when p_sort='amount_low' then orders.total end asc nulls last,
    case when p_sort='oldest' then private.admin_sales_order_date(orders,p_date_field) end asc nulls last,
    case when p_sort<>'oldest' then private.admin_sales_order_date(orders,p_date_field) end desc nulls last,
    case when p_sort='oldest' then orders.id end asc,
    orders.id desc
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.admin_search_orders_console(
  text, date, date, text, integer, integer, timestamptz, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_orders_console(
  text, date, date, text, integer, integer, timestamptz, text, text, text, text
) to authenticated;


create function public.admin_sales_order_counts(p_from date default null,p_to date default null,p_query text default null,
 p_field text default 'all',p_date_field text default 'ordered',p_payment_method text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;needle text:=nullif(btrim(p_query),'');
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 perform private.admin_validate_sales_search(p_field,p_date_field,'newest',p_payment_method,p_from,p_to,needle);
 select jsonb_object_agg(known.value,coalesce(matched.total,0)) into result
 from unnest(enum_range(null::public.order_status)) known(value)
 left join (select o.status,count(*) total from public.orders o
  where private.admin_sales_order_matches(o,p_from,p_to,needle,p_field,p_date_field,p_payment_method)
  group by o.status) matched on matched.status=known.value;
 return result;
end $$;
revoke all on function public.admin_sales_order_counts(date,date,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_sales_order_counts(date,date,text,text,text,text) to authenticated;

create function private.admin_sales_claim_date(p_claim public.order_cancellation_requests,p_basis text)
returns timestamptz language sql stable security invoker set search_path='' as $$
 select case p_basis when 'requested' then (p_claim).requested_at when 'collected' then (p_claim).collected_at when 'completed' then (p_claim).completed_at end;
$$;
revoke all on function private.admin_sales_claim_date(public.order_cancellation_requests,text) from public,anon,authenticated,service_role;

create function private.admin_sales_claim_matches(p_claim public.order_cancellation_requests,p_reason_type text,p_from date,p_to date,p_query text,p_field text,p_date_field text)
returns boolean language sql stable security invoker set search_path='' as $$
 select (p_reason_type is null or (p_claim).reason_type=p_reason_type)
  and (p_from is null or private.admin_sales_claim_date(p_claim,p_date_field)>=(p_from::timestamp at time zone 'Asia/Seoul'))
  and (p_to is null or private.admin_sales_claim_date(p_claim,p_date_field)<((p_to+1)::timestamp at time zone 'Asia/Seoul'))
  and (p_query is null
   or (p_field in ('all','order') and (position(lower(p_query) in lower((p_claim).order_id::text))>0 or position(lower(p_query) in (p_claim).reference::text)>0))
   or exists(select 1 from public.orders o join public.profiles p on p.id=o.user_id where o.id=(p_claim).order_id
    and ((p_field in ('all','buyer') and position(lower(p_query) in lower(coalesce(p.nickname,'')))>0)
      or (p_field in ('all','email') and position(lower(p_query) in lower(coalesce(p.email,'')))>0))));
$$;
revoke all on function private.admin_sales_claim_matches(public.order_cancellation_requests,text,date,date,text,text,text) from public,anon,authenticated,service_role;

create function public.admin_search_order_claims_console(
  p_claim_type text default null,
  p_stage text default null,
  p_reason_type text default null,
  p_from date default null,
  p_to date default null,
  p_query text default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_field text default 'all',
  p_date_field text default 'requested',
  p_sort text default 'newest'
)
returns table (
  id uuid,
  reference bigint,
  order_id uuid,
  claim_type text,
  stage text,
  reason_type text,
  buyer_id uuid,
  buyer_name text,
  buyer_email text,
  order_status public.order_status,
  order_total bigint,
  requested_at timestamptz,
  collected_at timestamptz,
  completed_at timestamptz,
  refund_method text,
  handler_name text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_stages text[];
begin
  if (select auth.uid()) is null or not public.is_staff() then
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
    or p_date_field is null or p_date_field not in ('requested','collected','completed')
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

  return query
  select
    request.id,
    request.reference,
    request.order_id,
    request.claim_type,
    request.stage,
    request.reason_type,
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
$$;

revoke all on function public.admin_search_order_claims_console(
  text, text, text, date, date, text, integer, integer, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.admin_search_order_claims_console(
  text, text, text, date, date, text, integer, integer, text, text, text
) to authenticated;


create function public.admin_order_claim_stage_counts_console(p_claim_type text default null,p_reason_type text default null,
 p_from date default null,p_to date default null,p_query text default null,p_field text default 'all',p_date_field text default 'requested')
returns table(stage text,total bigint) language plpgsql stable security definer set search_path='' as $$
declare needle text:=nullif(btrim(p_query),'');
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 if (p_claim_type is not null and p_claim_type not in ('cancel','return','exchange'))
  or p_field is null or p_field not in ('all','order','buyer','email')
  or p_date_field is null or p_date_field not in ('requested','collected','completed')
  or (p_from is not null and p_to is not null and p_from>p_to) or char_length(needle)>100 then
  raise invalid_parameter_value using message='invalid_claim_search';
 end if;
 return query select known.value,count(request.id)::bigint
 from unnest(array['requested','in_review','collecting','collected','on_hold','processing','needs_review','completed','rejected']) known(value)
 left join public.order_cancellation_requests request on request.stage=known.value
  and (p_claim_type is null or request.claim_type=p_claim_type)
  and private.admin_sales_claim_matches(request,p_reason_type,p_from,p_to,needle,p_field,p_date_field)
 group by known.value;
end $$;
revoke all on function public.admin_order_claim_stage_counts_console(text,text,date,date,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_order_claim_stage_counts_console(text,text,date,date,text,text,text) to authenticated;

create function public.admin_unpaid_bank_transfer_orders_console(
  p_query text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_state text default null,
  p_sort text default 'oldest'
)
returns table (
  order_id uuid,
  buyer_name text,
  buyer_id uuid,
  recipient_name text,
  total bigint,
  created_at timestamptz,
  expires_at timestamptz,
  extended_at timestamptz,
  deposit_code text,
  item_summary text,
  attempt_state public.payment_attempt_state,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;

  if (p_state is not null and p_state not in ('prepared','confirming','needs_review','unknown','missing'))
    or p_sort is null or p_sort not in ('newest','oldest','amount_high','amount_low') or char_length(v_query)>100 then
    raise invalid_parameter_value using message='invalid_unpaid_search';
  end if;
  return query
  with candidate as (
    select
      orders.id,
      orders.user_id,
      orders.total,
      orders.created_at,
      orders.expires_at,
      orders.bank_transfer_extended_at,
      private.bank_transfer_deposit_code(orders.id) as code,
      coalesce(nullif(btrim(profile.nickname), ''), 'fan_' || left(orders.user_id::text, 6))
        as buyer,
      -- 안내한 입금자명은 수령인 + 주문코드다. 주소 전체가 아니라 이 한 칸만
      -- 나간다 — 대조에 필요한 것이 그것뿐이다.
      coalesce(nullif(btrim(orders.address ->> 'recipientName'), ''), '') as recipient,
      (
        select attempt.state
        from public.payment_attempts as attempt
        where attempt.purpose = 'order'
          and attempt.ref_id = orders.id
      ) as attempt_state,
      (
        select string_agg(
          item.good_name_snapshot || ' × ' || item.qty::text,
          ', '
          order by item.good_name_snapshot
        )
        from public.order_items as item
        where item.order_id = orders.id
      ) as items
    from public.orders
    left join public.profiles as profile on profile.id = orders.user_id
    where orders.status = 'pending'
      and orders.payment_method = 'bank_transfer'
  ),
  filtered as (
    select *
    from candidate
    where (v_query is null
      or candidate.code = upper(v_query)
      or candidate.id::text = lower(v_query)
      or candidate.buyer ilike '%' || replace(replace(replace(v_query, '\', '\\'), '%', '\%'), '_', '\_') || '%')
      and (p_state is null or (p_state='missing' and candidate.attempt_state is null) or candidate.attempt_state::text=p_state)
  )
  select
    filtered.id,
    filtered.buyer,
    filtered.user_id,
    filtered.recipient,
    filtered.total,
    filtered.created_at,
    filtered.expires_at,
    filtered.bank_transfer_extended_at,
    filtered.code,
    coalesce(filtered.items, ''),
    filtered.attempt_state,
    count(*) over ()
  from filtered
  order by
    case when p_sort='amount_high' then filtered.total end desc nulls last,
    case when p_sort='amount_low' then filtered.total end asc nulls last,
    case when p_sort='newest' then filtered.expires_at end desc nulls last,
    case when p_sort<>'newest' then filtered.expires_at end asc nulls last,
    filtered.created_at,filtered.id
  limit v_limit
  offset v_offset;
end;
$function$;


revoke all on function public.admin_unpaid_bank_transfer_orders_console(text,integer,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_unpaid_bank_transfer_orders_console(text,integer,integer,text,text) to authenticated;
create function public.admin_search_shipments_console(p_tab text,p_origin_id uuid default null,p_query text default null,
 p_from date default null,p_to date default null,p_limit integer default 100,p_offset integer default 0,
 p_field text default 'all',p_date_field text default 'ordered',p_method text default null,p_payment_method text default null,p_sort text default 'oldest')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;needle text:=nullif(btrim(p_query),'');
begin
 if (select auth.uid()) is null or not public.is_staff() then raise insufficient_privilege using message='staff required';end if;
 if p_tab is null or p_tab not in ('new','ready','delayed','transit','delivered') or p_limit is null or p_limit not between 1 and 1000 or p_offset is null or p_offset<0
   or length(needle)>100 or (p_from is not null and p_to is not null and p_from>p_to) then raise invalid_parameter_value using message='invalid_shipment_search';end if;
 if p_field is null or p_field not in ('all','order','shipment','buyer','recipient','tracking','product')
   or p_date_field is null or p_date_field not in ('ordered','paid','confirmed','shipped','delivered')
   or (p_method is not null and p_method not in ('parcel','quick','pickup'))
   or (p_payment_method is not null and p_payment_method not in ('card','bank_transfer'))
   or p_sort is null or p_sort not in ('newest','oldest','amount_high','amount_low') then
   raise invalid_parameter_value using message='invalid_shipment_search';end if;
 with matched as materialized (
  select s.*,basis.search_at,o.user_id,o.created_at order_created_at,o.confirmed_at,o.total,o.status order_status,
   coalesce(nullif(p.nickname,''),'fan_'||left(o.user_id::text,6)) buyer_name,o.address->>'recipientName' recipient_name,
   o.payment_method,coalesce((select change.reason from private.order_shipment_promise_changes change where change.shipment_id=s.id order by change.created_at desc,change.id limit 1),delay.reason) delay_reason,
   coalesce(s.expected_ship_date,delay.expected_ship_date) delay_expected_date,
   o.status='paid' and s.status='ready' is_new,
   o.status in ('confirmed','shipping') and s.status='ready' is_ready,
   o.status in ('confirmed','shipping') and s.status='ready' and case when s.original_expected_ship_date is not null
     then s.expected_ship_date<(statement_timestamp() at time zone 'Asia/Seoul')::date
     else o.confirmed_at<now()-interval '3 days' end is_delayed,
   o.status<>'canceled' and s.status='shipping' is_transit,
   o.status<>'canceled' and s.status='delivered' is_delivered
  from public.order_shipments s join public.orders o on o.id=s.order_id
  left join public.profiles p on p.id=o.user_id left join public.order_dispatch_delays delay on delay.order_id=o.id
  cross join lateral (select case p_date_field when 'shipped' then s.shipped_at when 'delivered' then s.delivered_at
   else private.admin_sales_order_date(o,p_date_field) end search_at) basis
  where (p_origin_id is null or s.origin_id=p_origin_id)
    and (p_method is null or s.delivery_method=p_method)
    and (p_payment_method is null or o.payment_method::text=p_payment_method)
    and (p_from is null or basis.search_at>=p_from::timestamp at time zone 'Asia/Seoul')
    and (p_to is null or basis.search_at<(p_to+1)::timestamp at time zone 'Asia/Seoul')
    and (needle is null
      or (p_field in ('all','shipment') and position(lower(needle) in s.id::text)>0)
      or (p_field in ('all','order') and position(lower(needle) in o.id::text)>0)
      or (p_field in ('all','buyer') and (position(lower(needle) in lower(coalesce(p.nickname,'')))>0 or position(lower(needle) in lower(coalesce(p.email,'')))>0))
      or (p_field in ('all','recipient') and position(lower(needle) in lower(coalesce(o.address->>'recipientName','')))>0)
      or (p_field in ('all','tracking') and position(nullif(regexp_replace(lower(needle),'[[:space:]-]','','g'),'') in lower(coalesce(s.tracking_number,'')))>0)
      or (p_field in ('all','product') and exists(select 1 from public.order_shipment_items link join public.order_items i on i.id=link.order_item_id
        where link.shipment_id=s.id and (position(lower(needle) in lower(i.good_name_snapshot))>0 or position(lower(needle) in lower(coalesce(i.variant_name_snapshot,'')))>0))))
 ), filtered as materialized (
  select * from matched where case p_tab when 'new' then is_new when 'ready' then is_ready when 'delayed' then is_delayed when 'transit' then is_transit else is_delivered end
 ), ranked as (
 select *,row_number() over(order by
  case when p_sort='amount_high' then total end desc nulls last,
  case when p_sort='amount_low' then total end asc nulls last,
  case when p_sort='oldest' then search_at end asc nulls last,
  case when p_sort<>'oldest' then search_at end desc nulls last,
  case when p_sort='oldest' then id end asc,id desc) display_order from filtered
 ), page as (select * from ranked order by display_order limit p_limit offset p_offset), output as (
 select page.*,coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.good_name_snapshot,'variantName',i.variant_name_snapshot,'qty',link.qty) order by i.id)
  from public.order_shipment_items link join public.order_items i on i.id=link.order_item_id where link.shipment_id=page.id),'[]') items from page
 ) select jsonb_build_object('total',(select count(*) from filtered),'counts',(select jsonb_build_object(
   'new',count(*) filter(where is_new),'ready',count(*) filter(where is_ready),'delayed',count(*) filter(where is_delayed),
   'transit',count(*) filter(where is_transit),'delivered',count(*) filter(where is_delivered)) from matched),
   'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'orderId',order_id,'originId',origin_id,'originName',origin_name_snapshot,
    'status',status,'createdAt',order_created_at,'confirmedAt',confirmed_at,'buyerName',buyer_name,'recipientName',recipient_name,
    'total',total,'paymentMethod',payment_method,'shippingFee',shipping_fee,'carrier',carrier,'trackingNumber',tracking_number,
    'shippedAt',shipped_at,'deliveredAt',delivered_at,'exportedAt',exported_at,'updatedAt',updated_at,
    'delayReason',delay_reason,'expectedShipDate',delay_expected_date,'originalExpectedShipDate',original_expected_ship_date,
    'preorderReady',private.shipment_preorder_allocation_ready(id),'items',items,'delivery',private.shipment_delivery_summary(id)) order by display_order) from output),'[]')) into result;
 return result;
end $$;
revoke all on function public.admin_search_shipments_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_shipments_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text) to authenticated;


create function private.collect_settled_export_for_date(p_from date,p_to date,p_query text,p_date_field text)
returns jsonb language sql stable security definer set search_path='' as $$
 with selected as materialized (
  select o.* from public.orders o join public.profiles p on p.id=o.user_id
  where o.status='done'
   and private.admin_sales_order_matches(o,p_from,p_to,p_query,'all',p_date_field,null)
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
revoke all on function private.collect_settled_export_for_date(date,date,text,text) from public,anon,authenticated,service_role;

create or replace function public.admin_create_settled_export(p_request_id uuid,p_filters jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=(select auth.uid()); start_date date; end_date date; query_text text; date_basis text; normalized jsonb;
 receipt private.settled_export_receipts; captured jsonb; order_count integer; item_count integer;
begin
 if actor is null or not public.is_staff() then raise insufficient_privilege using message='staff required'; end if;
 if p_request_id is null or p_filters is null or jsonb_typeof(p_filters)<>'object'
  or exists(select 1 from jsonb_object_keys(p_filters) k where k not in('from','to','query','dateField')) then
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
 query_text:=nullif(btrim(p_filters->>'query'),'');
 if start_date>end_date or char_length(query_text)>100 then raise check_violation using message='settled_export_invalid_filters'; end if;
 normalized:=jsonb_build_object('from',start_date,'to',end_date,'query',coalesce(query_text,''));
 if date_basis<>'ordered' then normalized:=normalized||jsonb_build_object('dateField',date_basis);end if;
 perform pg_advisory_xact_lock(hashtextextended('settled-export:'||actor::text||':'||p_request_id::text,0));
 select * into receipt from private.settled_export_receipts where actor_id=actor and request_id=p_request_id;
 if found then
  if receipt.filters<>normalized then raise check_violation using message='settled_export_request_conflict'; end if;
  return jsonb_build_object('id',receipt.id,'capturedAt',receipt.payload->>'capturedAt','orderCount',jsonb_array_length(receipt.payload->'orders'));
 end if;
 -- This STABLE SQL function uses one statement snapshot for every source table.
 captured:=private.collect_settled_export_for_date(start_date,end_date,query_text,date_basis);
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


notify pgrst,'reload schema';
