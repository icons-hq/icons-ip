-- The optional two-year fallback uses at least one verified buyer after every
-- shorter window failed the configured threshold, matching the source control.
create or replace function public.get_product_detail_experience(p_good_id text) returns jsonb
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
   if customer_count >= (case when window_row.key='twoYears' then 1 else (config->>'minBuyers')::integer end) then
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

notify pgrst,'reload schema';
