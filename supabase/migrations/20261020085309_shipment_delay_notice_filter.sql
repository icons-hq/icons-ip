-- Read-only delivery-result filters; transmission/retry contracts stay intact.
-- Latest requested notice per shipment: a newer preview is not a customer notice.
create index order_delay_notice_targets_shipments_gin on private.order_delay_notice_targets using gin(shipment_ids);
create function private.shipment_delay_notice_summary(p_shipment_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 with latest as (
  select n.id,n.requested_at,t.in_app_status,t.email_status,i.state provider_state
  from private.order_delay_notice_targets t
  join private.order_delay_notices n on n.id=t.notice_id and n.requested_at is not null
  join public.order_shipments s on s.id=p_shipment_id and s.order_id=t.order_id
  left join private.email_intents i on i.id=t.email_intent_id
  where t.shipment_ids @> array[p_shipment_id]
  order by n.requested_at desc,n.id desc,t.id desc limit 1
 ), effective as (
  select *,case when provider_state in ('accepted','sent','delivered','delayed') then 'sent'
   when provider_state in ('bounced','complained','failed') then 'failed'
   when provider_state='suppressed' then 'suppressed'
   when provider_state in ('unknown','needs_review') then 'unknown'
   when provider_state='queued' then 'queued'
   when provider_state='dispatching' then 'processing' else email_status end effective_email
  from latest
 ) select coalesce((select jsonb_build_object(
  'status',case when in_app_status='sent' and effective_email='sent' then 'sent'
    when effective_email='unknown' then 'unknown'
    when in_app_status='sent' and effective_email in ('failed','suppressed') then 'partial_failed'
    when effective_email in ('prepared','queued','processing') then 'pending' else 'unknown' end,
  'noticeId',id,'requestedAt',requested_at,'inAppStatus',in_app_status,
  'emailStatus',effective_email,'emailProviderState',provider_state) from effective),
  jsonb_build_object('status','not_sent','noticeId',null,'requestedAt',null,'inAppStatus',null,'emailStatus',null,'emailProviderState',null));
$$;
revoke all on function private.shipment_delay_notice_summary(uuid) from public,anon,authenticated,service_role;

create function public.admin_search_shipments_notice_console(p_tab text,p_origin_id uuid default null,p_query text default null,
 p_from date default null,p_to date default null,p_limit integer default 100,p_offset integer default 0,
 p_field text default 'all',p_date_field text default 'ordered',p_method text default null,p_payment_method text default null,p_sort text default 'oldest',p_delay_notice_status text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;needle text:=nullif(btrim(p_query),'');
begin
 if not public.has_operator_capability('sales.manage',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_tab is null or p_tab not in ('new','ready','delayed','transit','delivered') or p_limit is null or p_limit not between 1 and 1000 or p_offset is null or p_offset<0
   or length(needle)>100 or (p_from is not null and p_to is not null and p_from>p_to) then raise invalid_parameter_value using message='invalid_shipment_search';end if;
 if (p_delay_notice_status is not null and p_delay_notice_status not in ('sent','partial_failed','pending','unknown','not_sent'))
   or p_field is null or p_field not in ('all','order','shipment','buyer','recipient','tracking','product')
   or p_date_field is null or p_date_field not in ('ordered','paid','confirmed','shipped','delivered')
   or (p_method is not null and p_method not in ('parcel','quick','pickup'))
   or (p_payment_method is not null and p_payment_method not in ('card','bank_transfer'))
   or p_sort is null or p_sort not in ('newest','oldest','amount_high','amount_low') then
   raise invalid_parameter_value using message='invalid_shipment_search';end if;
 with matched as materialized (
  select s.*,private.shipment_delay_notice_summary(s.id) delay_notice_summary,basis.search_at,o.user_id,o.created_at order_created_at,o.confirmed_at,o.total,o.status order_status,
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
 ), notice_matched as materialized (
  select * from matched where p_delay_notice_status is null or delay_notice_summary->>'status'=p_delay_notice_status
 ), filtered as materialized (
  select * from notice_matched where case p_tab when 'new' then is_new when 'ready' then is_ready when 'delayed' then is_delayed when 'transit' then is_transit else is_delivered end
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
   'transit',count(*) filter(where is_transit),'delivered',count(*) filter(where is_delivered)) from notice_matched),
   'delayNoticeFingerprint',(select encode(extensions.digest(coalesce(jsonb_agg(jsonb_build_object('id',id,'notice',delay_notice_summary) order by id)::text,'[]'),'sha256'),'hex') from filtered),
   'rows',coalesce((select jsonb_agg(jsonb_build_object('id',id,'orderId',order_id,'originId',origin_id,'originName',origin_name_snapshot,
    'status',status,'createdAt',order_created_at,'confirmedAt',confirmed_at,'buyerName',buyer_name,'recipientName',recipient_name,
    'total',total,'paymentMethod',payment_method,'shippingFee',shipping_fee,'carrier',carrier,'trackingNumber',tracking_number,
    'shippedAt',shipped_at,'deliveredAt',delivered_at,'exportedAt',exported_at,'updatedAt',updated_at,
    'delayReason',delay_reason,'expectedShipDate',delay_expected_date,'originalExpectedShipDate',original_expected_ship_date,
    'preorderReady',private.shipment_preorder_allocation_ready(id),'delayNotice',delay_notice_summary,'items',private.with_order_item_custom_inputs(items),'delivery',private.shipment_delivery_summary(id)) order by display_order) from output),'[]')) into result;
 return result;
end $$;
revoke all on function public.admin_search_shipments_notice_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_shipments_notice_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text,text) to authenticated;


select private.register_operator_rpc_contract('public.admin_search_shipments_notice_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text,text)'::regprocedure,'sales.manage','read',false);
select private.register_operator_internal_contract('private.shipment_delay_notice_summary(uuid)'::regprocedure);
notify pgrst,'reload schema';
