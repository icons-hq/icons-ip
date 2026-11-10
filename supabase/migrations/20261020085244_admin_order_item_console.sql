-- Item-level reading does not create item-level cancellation/refund authority.
create function public.admin_search_order_items_console(
 p_status text default null,p_from date default null,p_to date default null,p_query text default null,
 p_limit integer default 20,p_offset integer default 0,p_field text default 'all',p_date_field text default 'ordered',
 p_sort text default 'newest',p_payment_method text default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare needle text:=nullif(btrim(p_query),'');result jsonb;
begin
 if not private.has_operator_capability(auth.uid(),'sales.read',false) then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_limit is null or p_limit not between 1 and 500 or p_offset is null or p_offset not between 0 and 100000
  or p_field is null or p_field not in ('all','order','item','nickname','email','recipient','tracking','phone','product')
  or (p_status is not null and not exists(select 1 from unnest(enum_range(null::public.order_status))s where s::text=p_status))
 then raise invalid_parameter_value using message='invalid_order_item_search';end if;
 perform private.admin_validate_sales_search(case when p_field='item' then 'order' else p_field end,p_date_field,p_sort,p_payment_method,p_from,p_to,needle);
 with base as materialized (
  select i.id item_id,o.id order_id,o.status,o.created_at,private.admin_sales_order_date(o,p_date_field) selected_at,
   i.qty,i.unit_price,i.qty::bigint*i.unit_price::bigint amount,
   jsonb_build_object('id',i.id,'orderId',o.id,'userId',o.user_id,'buyerName',coalesce(p.nickname,'이름 미등록'),
    'recipientName',o.address->>'recipientName','status',o.status,'createdAt',o.created_at,
    'goodId',i.good_id,'goodName',i.good_name_snapshot,'variantName',i.variant_name_snapshot,'variantCode',i.variant_code_snapshot,
    'customInputs',i.custom_inputs_snapshot,'qty',i.qty,'unitPrice',i.unit_price,'itemAmount',i.qty::bigint*i.unit_price::bigint,
    'shipmentId',shipment.id,'shipmentStatus',shipment.status,'originName',shipment.origin_name_snapshot,
    'trackingNumber',shipment.tracking_number,'carrierLabel',coalesce(carrier.label,shipment.carrier),
    'claim',case when claim.id is null then null else jsonb_build_object('id',claim.id,'type',claim.claim_type,'stage',claim.stage) end) document
  from public.order_items i join public.orders o on o.id=i.order_id join public.profiles p on p.id=o.user_id
  left join public.order_shipment_items mapping on mapping.order_item_id=i.id and mapping.order_id=o.id
  left join public.order_shipments shipment on shipment.id=mapping.shipment_id and shipment.order_id=o.id
  left join public.shipping_carriers carrier on carrier.code=shipment.carrier
  left join lateral (select c.id,c.claim_type,c.stage from public.order_cancellation_requests c where c.order_id=o.id order by c.requested_at desc,c.id desc limit 1)claim on true
  where (p_payment_method is null or o.payment_method::text=p_payment_method)
   and (p_from is null or private.admin_sales_order_date(o,p_date_field)>=p_from::timestamp at time zone 'Asia/Seoul')
   and (p_to is null or private.admin_sales_order_date(o,p_date_field)<(p_to+1)::timestamp at time zone 'Asia/Seoul')
   and (needle is null
    or (p_field in ('all','order') and strpos(lower(o.id::text),lower(needle))>0)
    or (p_field in ('all','item') and strpos(lower(i.id::text),lower(needle))>0)
    or (p_field in ('all','nickname') and strpos(lower(coalesce(p.nickname,'')),lower(needle))>0)
    or (p_field in ('all','email') and strpos(lower(coalesce(p.email,'')),lower(needle))>0)
    or (p_field in ('all','recipient') and strpos(lower(coalesce(o.address->>'recipientName','')),lower(needle))>0)
    or (p_field in ('all','phone') and strpos(regexp_replace(coalesce(o.address->>'phone',''),'[[:space:]-]','','g'),nullif(regexp_replace(needle,'[[:space:]-]','','g'),''))>0)
    or (p_field in ('all','tracking') and strpos(lower(coalesce(shipment.tracking_number,'')),nullif(regexp_replace(lower(needle),'[[:space:]-]','','g'),''))>0)
    or (p_field in ('all','product') and (strpos(lower(i.good_name_snapshot),lower(needle))>0
     or strpos(lower(coalesce(i.variant_name_snapshot,'')),lower(needle))>0
     or strpos(lower(coalesce(i.variant_code_snapshot,'')),lower(needle))>0 or strpos(lower(i.good_id),lower(needle))>0)))
 ), filtered as materialized(select * from base where p_status is null or status::text=p_status),
 page as (select *,row_number() over(order by
   case when p_sort='amount_high' then amount end desc nulls last,
   case when p_sort='amount_low' then amount end asc nulls last,
   case when p_sort='oldest' then selected_at end asc nulls last,
   case when p_sort<>'oldest' then selected_at end desc nulls last,
   case when p_sort='oldest' then order_id end asc,order_id desc,item_id) ordinal
  from filtered order by ordinal limit p_limit offset p_offset)
 select jsonb_build_object('total',(select count(*) from filtered),'orderCount',(select count(distinct order_id) from filtered),
  'qty',(select coalesce(sum(qty),0) from filtered),
  'fingerprint',(select md5(coalesce(string_agg(document::text,'' order by item_id),'')) from filtered),
  'counts',(select jsonb_object_agg(s::text,(select count(*) from base b where b.status=s)) from unnest(enum_range(null::public.order_status))s),
  'rows',coalesce((select jsonb_agg(document order by ordinal) from page),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.admin_search_order_items_console(text,date,date,text,integer,integer,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_order_items_console(text,date,date,text,integer,integer,text,text,text,text) to authenticated;
do $$begin
 perform private.register_operator_rpc_contract('public.admin_search_order_items_console(text,date,date,text,integer,integer,text,text,text,text)'::regprocedure,'sales.read','read',false);
end $$;
