-- Independent PDP experiences. The existing banner/modules contract stays intact.
create function private.product_detail_experience_values_valid(p_section text,p_values jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare field text;
begin
 if jsonb_typeof(p_values) is distinct from 'object' then return false;end if;
 if p_section='messages' then
  if (select count(*) from jsonb_object_keys(p_values))<>7
   or not p_values ?& array['buyers','minBuyers','twoYears','repeatBuyers','minRepeatBuyers','bestSeller','newProduct'] then return false;end if;
  foreach field in array array['buyers','twoYears','repeatBuyers','bestSeller','newProduct'] loop
   if jsonb_typeof(p_values->field) is distinct from 'boolean' then return false;end if;
  end loop;
  foreach field in array array['minBuyers','minRepeatBuyers'] loop
   if jsonb_typeof(p_values->field) is distinct from 'number' or p_values->>field !~ '^[0-9]+$'
    or (p_values->>field)::numeric not between 10 and 1000 then return false;end if;
  end loop;
  return true;
 elsif p_section='discovery' then
  return (select count(*)=2 from jsonb_object_keys(p_values)) and p_values ?& array['interests','shippingSavings']
   and jsonb_typeof(p_values->'interests')='boolean' and jsonb_typeof(p_values->'shippingSavings')='boolean';
 end if;
 return false;
exception when others then return false;
end $$;
revoke all on function private.product_detail_experience_values_valid(text,jsonb) from public,anon,authenticated,service_role;

create table private.product_detail_experience_settings (
 section text primary key check(section in('messages','discovery')),
 values jsonb not null,
 revision bigint not null default 0 check(revision>=0),
 updated_at timestamptz not null default now(),
 check(private.product_detail_experience_values_valid(section,values))
);
alter table private.product_detail_experience_settings enable row level security;
revoke all on private.product_detail_experience_settings from public,anon,authenticated,service_role;
insert into private.product_detail_experience_settings(section,values) values
 ('messages','{"buyers":false,"minBuyers":10,"twoYears":true,"repeatBuyers":false,"minRepeatBuyers":10,"bestSeller":false,"newProduct":false}'),
 ('discovery','{"interests":false,"shippingSavings":false}');

create function public.admin_get_product_detail_experiences() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.require_actor_operator_capability(auth.uid(),'store.manage',false);
 select jsonb_build_object('values',jsonb_object_agg(section,values),'revisions',jsonb_object_agg(section,revision)) into result
 from private.product_detail_experience_settings;
 return result;
end $$;
revoke all on function public.admin_get_product_detail_experiences() from public,anon,authenticated,service_role;
grant execute on function public.admin_get_product_detail_experiences() to authenticated;

create function public.admin_save_product_detail_experiences(p_section text,p_values jsonb,p_expected_revision bigint,p_operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous private.product_detail_experience_settings%rowtype; request jsonb; receipt jsonb;
begin
 perform private.require_actor_operator_capability(actor,'store.manage',false);
 if p_operation_id is null or p_expected_revision is null or p_expected_revision<0
  or private.product_detail_experience_values_valid(p_section,p_values) is distinct from true then
  raise invalid_parameter_value using message='invalid_product_detail_experience';end if;
 request:=jsonb_build_object('section',p_section,'values',p_values,'expectedRevision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended('product-detail-experience:operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.product_detail_experience.updated',request);
 if receipt is not null then return receipt;end if;
 select * into previous from private.product_detail_experience_settings where section=p_section for update;
 if not found then raise no_data_found using message='product_detail_experience_missing';end if;
 if previous.revision<>p_expected_revision then raise sqlstate 'PT409' using message='product_detail_experience_conflict';end if;
 update private.product_detail_experience_settings set values=p_values,revision=revision+1,updated_at=clock_timestamp() where section=p_section;
 receipt:=jsonb_build_object('section',p_section,'values',p_values,'revision',previous.revision+1);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.product_detail_experience.updated','product_detail_experience:'||p_section,
  jsonb_build_object('request',request,'result',receipt,'before',previous.values));
 return receipt;
end $$;
revoke all on function public.admin_save_product_detail_experiences(text,jsonb,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_product_detail_experiences(text,jsonb,bigint,uuid) to authenticated;

create function public.get_product_detail_experience_config() returns jsonb
language sql stable security definer set search_path='' as $$
 select values from private.product_detail_experience_settings where section='discovery';
$$;
revoke all on function public.get_product_detail_experience_config() from public,anon,authenticated,service_role;
grant execute on function public.get_product_detail_experience_config() to anon,authenticated;

create function public.get_product_detail_experience(p_good_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare current_good public.goods%rowtype; config jsonb; messages jsonb:='[]'; window_row record; customer_count bigint; sale_rank bigint;
 at_time timestamptz:=statement_timestamp(); today timestamptz:=date_trunc('day',statement_timestamp() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
 next_change timestamptz;
begin
 select g.* into current_good from public.goods g join public.ips ip on ip.id=g.ip_id
 where g.id=p_good_id and g.published_at is not null and g.archived_at is null and g.sale_restriction='none'
  and ip.published_at is not null and ip.archived_at is null;
 if not found then return null;end if;
 select values into config from private.product_detail_experience_settings where section='messages';
 if (config->>'buyers')::boolean then
  for window_row in select * from (values
   (1,'today',today),(2,'week',today-interval '6 days'),(3,'sixMonths',today-interval '6 months'),
   (4,'year',today-interval '1 year'),(5,'twoYears',today-interval '2 years')
  ) periods(position,key,starts_at) where key<>'twoYears' or (config->>'twoYears')::boolean order by position loop
   select count(distinct o.user_id) into customer_count from private.product_detail_paid_orders(window_row.starts_at,at_time) paid
    join public.orders o on o.id=paid.id where exists(select 1 from public.order_items i where i.order_id=o.id and i.good_id=p_good_id);
   if customer_count >= (config->>'minBuyers')::integer then
    messages:=messages||jsonb_build_array(jsonb_build_object('kind','buyers','window',window_row.key,'count',customer_count));exit;
   end if;
  end loop;
 end if;
 if (config->>'repeatBuyers')::boolean then
  for window_row in select * from (values
   (1,'threeMonths',today-interval '3 months'),(2,'sixMonths',today-interval '6 months'),(3,'year',today-interval '1 year')
  ) periods(position,key,starts_at) order by position loop
   select count(*) into customer_count from (
    select o.user_id from private.product_detail_paid_orders(window_row.starts_at,at_time) paid
     join public.orders o on o.id=paid.id where exists(select 1 from public.order_items i where i.order_id=o.id and i.good_id=p_good_id)
     group by o.user_id having count(distinct o.id)>=2
   ) repeated;
   if customer_count >= (config->>'minRepeatBuyers')::integer then
    messages:=messages||jsonb_build_array(jsonb_build_object('kind','repeatBuyers','window',window_row.key,'count',customer_count));exit;
   end if;
  end loop;
 end if;
 if (config->>'bestSeller')::boolean then
  with sales as (
   select item.good_id,sum(item.qty::bigint) quantity from private.product_detail_paid_orders(today-interval '3 days',today) paid
    join public.order_items item on item.order_id=paid.id join public.goods g on g.id=item.good_id join public.ips ip on ip.id=g.ip_id
   where g.published_at is not null and g.archived_at is null and g.sale_restriction='none'
    and ip.published_at is not null and ip.archived_at is null group by item.good_id
  ), ranked as (select good_id,row_number() over(order by quantity desc,good_id) rank from sales where quantity>0)
  select rank into sale_rank from ranked where good_id=p_good_id and rank<=10;
  if sale_rank is not null then messages:=messages||jsonb_build_array(jsonb_build_object('kind','bestSeller','rank',sale_rank));end if;
 end if;
 if (config->>'newProduct')::boolean and current_good.created_at<=at_time and current_good.created_at>at_time-interval '7 days' then
  messages:=messages||jsonb_build_array(jsonb_build_object('kind','newProduct'));
  next_change:=current_good.created_at+interval '7 days';
 end if;
 if (config->>'buyers')::boolean or (config->>'repeatBuyers')::boolean or (config->>'bestSeller')::boolean then next_change:=least(next_change,today+interval '1 day');end if;
 return jsonb_build_object('messages',messages,'discovery',public.get_product_detail_experience_config(),'nextChangeAt',next_change);
end $$;
revoke all on function public.get_product_detail_experience(text) from public,anon,authenticated,service_role;
grant execute on function public.get_product_detail_experience(text) to anon,authenticated;

-- No requested customer id: the authenticated identity is the only ownership key.
create function public.get_my_product_detail_interests() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result jsonb;
begin
 if actor is null or not (public.get_product_detail_experience_config()->>'interests')::boolean then
  return jsonb_build_object('ownerId',actor,'cart','[]'::jsonb,'wishlist','[]'::jsonb,'repurchase','[]'::jsonb);end if;
 with eligible as materialized (
  select g.id from public.goods g join public.ips ip on ip.id=g.ip_id where g.published_at is not null and g.archived_at is null
   and g.sale_restriction='none' and ip.published_at is not null and ip.archived_at is null
 ), cart as (
  select c.good_id id,max(c.created_at) moment from public.cart_items c join eligible g on g.id=c.good_id where c.user_id=actor
   group by c.good_id order by moment desc,c.good_id limit 30
 ), wishes as (
  select w.good_id id,w.created_at moment from public.wishlists w join eligible g on g.id=w.good_id where w.user_id=actor
   order by moment desc,w.good_id limit 30
 ), repeated as (
  select i.good_id id,max(paid.approved_at) moment from private.product_detail_paid_orders(statement_timestamp()-interval '2 years',statement_timestamp()) paid
   join public.orders o on o.id=paid.id and o.user_id=actor join public.order_items i on i.order_id=o.id join eligible g on g.id=i.good_id
   group by i.good_id having count(distinct o.id)>=2 order by moment desc,i.good_id limit 30
 ) select jsonb_build_object('ownerId',actor,
  'cart',coalesce((select jsonb_agg(id order by moment desc,id) from cart),'[]'::jsonb),
  'wishlist',coalesce((select jsonb_agg(id order by moment desc,id) from wishes),'[]'::jsonb),
  'repurchase',coalesce((select jsonb_agg(id order by moment desc,id) from repeated),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.get_my_product_detail_interests() from public,anon,authenticated,service_role;
grant execute on function public.get_my_product_detail_interests() to anon,authenticated;

-- Advisory shipping quotes reuse checkout calculations; no inventory/cart writes.
create function public.get_product_shipping_savings(p_good_id text,p_variant_id uuid,p_qty integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare current_good public.goods%rowtype; candidate record; base_items jsonb; other_items jsonb; base_quote jsonb; other_quote jsonb; combined_quote jsonb;
 rows jsonb:='[]'; separate_fee bigint; combined_fee bigint; result jsonb; next_change timestamptz;
begin
 if p_good_id is null or p_variant_id is null or p_qty is null or p_qty not between 1 and 1000 then raise invalid_parameter_value using message='invalid_shipping_savings_selection';end if;
 if not (public.get_product_detail_experience_config()->>'shippingSavings')::boolean then return jsonb_build_object('items','[]'::jsonb,'nextChangeAt',null);end if;
 select g.* into current_good from public.goods g join public.ips ip on ip.id=g.ip_id
 where g.id=p_good_id and g.published_at is not null and g.archived_at is null and g.sale_restriction='none'
  and ip.published_at is not null and ip.archived_at is null;
 if not found then return null;end if;
 base_items:=jsonb_build_array(jsonb_build_object('goodId',p_good_id,'variantId',p_variant_id,'qty',p_qty));
 base_quote:=public.quote_goods_sales(base_items);
 if exists(select 1 from jsonb_array_elements(base_quote->'lines') l where not (l->>'available')::boolean)
  or exists(select 1 from jsonb_array_elements(base_quote->'goods') g where g->'reason'<>'null'::jsonb) then
  return jsonb_build_object('items','[]'::jsonb,'selectionUnavailable',true,'nextChangeAt',base_quote->'nextChangeAt');end if;
 next_change:=(base_quote->>'nextChangeAt')::timestamptz;
 for candidate in
  select g.id,chosen.id variant_id,chosen.name variant_name,case when g.order_quantity_limit_enabled then g.min_order_qty else 1 end qty
  from public.goods g join public.ips ip on ip.id=g.ip_id
  join lateral (
   select v.id,v.name from public.goods_variants v cross join lateral private.resolve_goods_variant_supply(v.id,statement_timestamp()) supply
    cross join lateral private.resolve_goods_variant_price(v.id,statement_timestamp()) pricing
   where v.good_id=g.id and v.archived_at is null and (supply.available_qty is null or supply.available_qty>=case when g.order_quantity_limit_enabled then g.min_order_qty else 1 end)
   order by v.is_default desc,pricing.effective_price,v.id limit 1
  ) chosen on true
  where g.id<>p_good_id and g.origin_id=current_good.origin_id and g.published_at is not null and g.archived_at is null and g.sale_restriction='none'
   and ip.published_at is not null and ip.archived_at is null and (not g.order_quantity_limit_enabled or g.min_order_qty between 1 and 1000)
  order by md5(g.id||(statement_timestamp() at time zone 'Asia/Seoul')::date::text),g.id limit 50
 loop
  other_items:=jsonb_build_array(jsonb_build_object('goodId',candidate.id,'variantId',candidate.variant_id,'qty',candidate.qty));
  begin
   other_quote:=public.quote_goods_sales(other_items);combined_quote:=public.quote_goods_sales(base_items||other_items);
  exception when check_violation or no_data_found then continue;end;
  if exists(select 1 from jsonb_array_elements(combined_quote->'lines') l where not (l->>'available')::boolean)
   or exists(select 1 from jsonb_array_elements(combined_quote->'goods') g where g->'reason'<>'null'::jsonb) then continue;end if;
  separate_fee:=(base_quote#>>'{shipping,totalFee}')::bigint+(other_quote#>>'{shipping,totalFee}')::bigint;
  combined_fee:=(combined_quote#>>'{shipping,totalFee}')::bigint;
  if combined_fee<separate_fee then
   rows:=rows||jsonb_build_array(jsonb_build_object('goodId',candidate.id,'variantId',candidate.variant_id,'variantName',candidate.variant_name,'qty',candidate.qty,
    'separateFee',separate_fee,'combinedFee',combined_fee,'savings',separate_fee-combined_fee));
   next_change:=least(next_change,(combined_quote->>'nextChangeAt')::timestamptz);
  end if;
  exit when jsonb_array_length(rows)>=12;
 end loop;
 result:=jsonb_build_object('items',rows,'nextChangeAt',next_change,'calculatedAt',statement_timestamp());
 return result;
end $$;
revoke all on function public.get_product_shipping_savings(text,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_product_shipping_savings(text,uuid,integer) to anon,authenticated;

select private.register_operator_rpc_contract('public.admin_get_product_detail_experiences()','store.manage','read',false);
select private.register_operator_rpc_contract('public.admin_save_product_detail_experiences(text,jsonb,bigint,uuid)','store.manage','manual',false);
select private.register_operator_internal_contract('private.product_detail_experience_values_valid(text,jsonb)'::regprocedure);
select private.register_operator_internal_contract('public.get_product_detail_experience_config()'::regprocedure);
select private.register_operator_internal_contract('public.get_product_detail_experience(text)'::regprocedure);
select private.register_operator_internal_contract('public.get_my_product_detail_interests()'::regprocedure);
select private.register_operator_internal_contract('public.get_product_shipping_savings(text,uuid,integer)'::regprocedure);
notify pgrst,'reload schema';
