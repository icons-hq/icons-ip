-- Read-only editorial filtering. Catalog prices/supply and parcel fee policy use
-- the same private resolvers as checkout. Aggregate metrics expose no customers.
create function public.admin_search_shopping_story_goods_filtered(p_query text default '',p_page integer default 1,p_filters jsonb default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 field_value text:=coalesce(p_filters->>'field','all'); category_value uuid;
 visibility_value text:=coalesce(p_filters->>'visibility','all'); stock_value text:=coalesce(p_filters->>'stock','all');
 sale_value text:=coalesce(p_filters->>'saleType','all'); reviews_value text:=coalesce(p_filters->>'reviews','all');
 sort_value text:=coalesce(p_filters->>'sort','latest'); rating_value numeric;
 free_value boolean; discount_value boolean;
 min_value bigint; max_value bigint; query_value text:=lower(btrim(p_query)); result_value jsonb;
begin
 if not public.has_operator_capability('store.manage') then raise insufficient_privilege using message='operator_capability_required';end if;
 if p_query is null or char_length(p_query)>100 or p_page is null or p_page not between 1 and 1000000
  or jsonb_typeof(p_filters) is distinct from 'object'
  or exists(select 1 from jsonb_object_keys(p_filters) k where k not in ('field','categoryId','visibility','stock','saleType','reviews','sort','minRating','freeShipping','discounted','minPrice','maxPrice'))
  or exists(select 1 from jsonb_each(p_filters) e where case
    when e.key in ('field','visibility','stock','saleType','reviews','sort') then jsonb_typeof(e.value)<>'string'
    when e.key='categoryId' then jsonb_typeof(e.value) not in ('string','null')
    when e.key in ('freeShipping','discounted') then jsonb_typeof(e.value)<>'boolean'
    when e.key='minRating' then jsonb_typeof(e.value)<>'number'
    else jsonb_typeof(e.value) not in ('number','null') end)
  or field_value not in ('all','name','code','id') or visibility_value not in ('all','published','draft')
  or stock_value not in ('all','available','soldout') or sale_value not in ('all','stock','preorder')
  or reviews_value not in ('all','with','without') or sort_value not in ('latest','popular','sales','reviews','rating','price_asc','price_desc','name')
 then raise invalid_parameter_value using message='invalid_shopping_story_goods_filter';end if;
 rating_value:=coalesce((p_filters->>'minRating')::numeric,0);
 free_value:=coalesce((p_filters->>'freeShipping')::boolean,false);discount_value:=coalesce((p_filters->>'discounted')::boolean,false);
 if rating_value not in (0,3,4,4.5) or (p_filters->>'categoryId') is not null and (p_filters->>'categoryId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 then raise invalid_parameter_value using message='invalid_shopping_story_goods_filter';end if;
 category_value:=(p_filters->>'categoryId')::uuid;
 if (p_filters->>'minPrice') is not null and (p_filters->>'minPrice') !~ '^[0-9]{1,9}$'
  or (p_filters->>'maxPrice') is not null and (p_filters->>'maxPrice') !~ '^[0-9]{1,9}$'
 then raise invalid_parameter_value using message='invalid_shopping_story_goods_filter';end if;
 min_value:=(p_filters->>'minPrice')::bigint;max_value:=(p_filters->>'maxPrice')::bigint;
 if min_value>100000000 or max_value>100000000 or min_value>max_value then raise invalid_parameter_value using message='invalid_shopping_story_goods_filter';end if;
 with recursive categories as (
   select c.id,c.name::text path,c.sort_order::text||':'||c.name||':'||c.id::text sort_path from public.catalog_categories c where c.parent_id is null and c.archived_at is null
   union all select c.id,p.path||' > '||c.name,p.sort_path||'/'||c.sort_order::text||':'||c.name||':'||c.id::text from public.catalog_categories c join categories p on c.parent_id=p.id where c.archived_at is null
 ), descendants as (
   select c.id from public.catalog_categories c where c.id=category_value and c.archived_at is null
   union all select c.id from public.catalog_categories c join descendants p on c.parent_id=p.id where c.archived_at is null
 ), base as materialized (
   select g as good,g.id,g.name,g.created_at,ip.published_at is not null as ip_published,
    g.published_at is not null and ip.published_at is not null and g.sale_restriction='none' as is_published
   from public.goods g join public.ips ip on ip.id=g.ip_id
   where g.archived_at is null and ip.archived_at is null
    and (category_value is null or g.category_id in (select id from descendants)
      or exists(select 1 from public.goods_additional_categories extra where extra.good_id=g.id and extra.category_id in (select id from descendants)))
    and (query_value='' or position(query_value in lower(case field_value when 'name' then g.name when 'code' then g.code when 'id' then g.id else g.name||' '||g.code||' '||g.id end))>0)
 ), eligible as materialized (
   select b.*,coalesce(s.price,(b.good).price) as current_price,coalesce(s.available,0) as available,
    coalesce(s.available,0)<=0 as sold_out,coalesce(s.preorder,false) as preorder,
    coalesce(s.discounted,false) or coalesce((b.good).compare_at_price>(b.good).price,false) as discounted,
    (private.calculate_goods_shipping(jsonb_build_array(jsonb_build_object('origin_id',(b.good).origin_id,'good_id',b.id,'qty',1,
     'unit_price',coalesce(s.price,(b.good).price),'fee_type',(b.good).shipping_fee_type,'individual_fee',(b.good).individual_fee)))->>'totalFee')::bigint=0 as free_shipping
   from base b cross join lateral (
    select min(price.effective_price) price,sum(supply.available_qty) available,bool_or(v.preorder_policy_id is not null) preorder,
     bool_or(price.effective_price<price.regular_price) discounted
    from public.goods_variants v
    cross join lateral private.resolve_goods_variant_price(v.id,statement_timestamp()) price
    cross join lateral private.resolve_goods_variant_supply(v.id,statement_timestamp()) supply
    where v.good_id=b.id and v.archived_at is null
   ) s
   where visibility_value='all' or b.is_published=(visibility_value='published')
 ), review_metrics as (
   select r.good_id,count(*) review_count,avg(r.rating)::numeric rating_average from public.reviews r join eligible g on g.id=r.good_id where r.status='visible' group by r.good_id
 ), wishes as (
   select w.good_id,count(*) wish_count from public.wishlists w join eligible g on g.id=w.good_id group by w.good_id
 ), paid_orders as materialized (
   -- Same evidence and completed cancel/return exclusions as get_home_sales_rankings.
   select o.id,min(approval.approved_at) approved_at
   from public.orders o
   join public.payments p on p.purpose='order' and p.ref_id=o.id and p.status='paid' and p.user_id=o.user_id and p.amount=o.total
   join public.payment_attempts a on a.payment_id=p.id and a.purpose='order' and a.ref_id=o.id and a.state='approved' and a.amount=p.amount and a.provider=p.provider and a.user_id=o.user_id
   cross join lateral (select coalesce(
    (select min(e.approved_at) from private.payment_provider_evidence e where e.payment_attempt_id=a.id),
    (select b.confirmed_at from public.bank_transfer_confirmations b where b.attempt_id=a.id and b.order_id=o.id and a.provider='bank_transfer')) approved_at) approval
   where o.status in ('paid','confirmed','shipping','delivered','done') and approval.approved_at is not null
    and exists(select 1 from public.order_items item join eligible g on g.id=item.good_id where item.order_id=o.id)
    and not exists(select 1 from public.order_cancellation_requests c where c.order_id=o.id and c.claim_type in ('cancel','return') and (c.status='completed' or c.stage='completed'))
   group by o.id
 ), sales as (
   select item.good_id,sum(item.qty::bigint) quantity from paid_orders p join public.order_items item on item.order_id=p.id join eligible g on g.id=item.good_id
   where p.approved_at>=statement_timestamp()-interval '30 days' and p.approved_at<statement_timestamp() group by item.good_id
 ), filtered as materialized (
   select g.*,coalesce(r.review_count,0) review_count,r.rating_average,coalesce(w.wish_count,0) wish_count,coalesce(s.quantity,0) sales_quantity
   from eligible g left join review_metrics r on r.good_id=g.id left join wishes w on w.good_id=g.id left join sales s on s.good_id=g.id
   where (stock_value='all' or g.sold_out=(stock_value='soldout')) and (sale_value='all' or g.preorder=(sale_value='preorder'))
    and (not free_value or g.free_shipping) and (not discount_value or g.discounted)
    and (reviews_value='all' or (coalesce(r.review_count,0)>0)=(reviews_value='with'))
    and (rating_value=0 or r.rating_average>=rating_value)
    and (min_value is null or g.current_price>=min_value) and (max_value is null or g.current_price<=max_value)
 ), ranked as (
   select f.*,row_number() over(order by
    case when sort_value='popular' then wish_count end desc,
    case when sort_value in ('sales','popular') then sales_quantity end desc,
    case when sort_value='sales' then wish_count end desc,
    case when sort_value='reviews' then review_count end desc,
    case when sort_value in ('reviews','rating') then rating_average end desc nulls last,
    case when sort_value='rating' then review_count end desc,
    case when sort_value='price_asc' then current_price end asc,
    case when sort_value='price_desc' then current_price end desc,
    case when sort_value='name' then name end asc,created_at desc,id) position from filtered f
 ), page as (select * from ranked order by position limit 20 offset (p_page-1)*20)
 select jsonb_build_object('page',p_page,'pageSize',20,'checkedAt',statement_timestamp(),'total',(select count(*) from filtered),
  'categories',coalesce((select jsonb_agg(jsonb_build_object('id',id,'path',path) order by sort_path) from categories),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(private.shopping_story_admin_good(p.good,p.ip_published,false)||jsonb_build_object(
   'reviewCount',review_count,'ratingAverage',round(rating_average,2),'wishCount',wish_count,'salesQuantity',sales_quantity,
   'freeShipping',free_shipping,'discounted',discounted,'saleType',case when preorder then 'preorder' else 'stock' end) order by position) from page p),'[]'::jsonb)) into result_value;
 return result_value;
end;
$$;
revoke all on function public.admin_search_shopping_story_goods_filtered(text,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_search_shopping_story_goods_filtered(text,integer,jsonb) to authenticated;
select private.register_operator_rpc_contract('public.admin_search_shopping_story_goods_filtered(text,integer,jsonb)'::regprocedure,'store.manage','read',false);
