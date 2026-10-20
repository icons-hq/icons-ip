-- Reviewed read-only hourly sales; verified in an isolated 308-prefix clone.
-- Keep admin_sales_report's order-total, current-state and item-snapshot contracts.
create function public.admin_sales_hourly_report(
  p_compare_date date default null,
  p_ip_id text default null,
  p_cutoff timestamptz default null
)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare
  v_as_of timestamptz := statement_timestamp();
  v_today date := (v_as_of at time zone 'Asia/Seoul')::date;
  v_start timestamptz := v_today::timestamp at time zone 'Asia/Seoul';
  v_latest timestamptz := date_trunc('hour',v_as_of at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  v_cutoff timestamptz := coalesce(p_cutoff,v_latest);
  v_compare date := coalesce(p_compare_date,v_today-7);
  v_compare_start timestamptz;
  v_compare_cutoff timestamptz;
  v_hours integer;
  v_ip text := nullif(btrim(coalesce(p_ip_id,'')),'');
  result jsonb;
begin
  if (select auth.uid()) is null or not public.has_operator_capability('stats.read',false) then
    raise insufficient_privilege using message='operator_capability_required';
  end if;
  if not isfinite(v_compare) or v_compare<date '0001-01-01' or v_compare>=v_today or length(v_ip)>64
    or not isfinite(v_cutoff) or v_cutoff<v_start or v_cutoff>v_latest
    or date_trunc('hour',v_cutoff at time zone 'Asia/Seoul')<>(v_cutoff at time zone 'Asia/Seoul') then
    raise invalid_parameter_value using message='invalid_sales_hourly_filters';
  end if;
  v_compare_start := v_compare::timestamp at time zone 'Asia/Seoul';
  v_compare_cutoff := v_compare_start+(v_cutoff-v_start);
  v_hours := extract(epoch from (v_cutoff-v_start))::integer/3600;

  -- Both calendar days and both ranking windows share this statement snapshot.
  -- At midnight the last completed hour belongs to the preceding calendar day.
  with ranges(side,starts_at,ends_at,day_starts_at) as (
    values ('current',least(v_start,v_cutoff-interval '1 hour'),v_cutoff,v_start),
      ('comparison',least(v_compare_start,v_compare_cutoff-interval '1 hour'),v_compare_cutoff,v_compare_start)
  ), scoped as materialized (
    select r.side,r.day_starts_at,r.ends_at,o.id,o.total,o.created_at
    from ranges r join public.orders o on o.created_at>=r.starts_at and o.created_at<r.ends_at
    where o.status=any(private.revenue_order_statuses())
  ), hourly as (
    select side,extract(hour from created_at at time zone 'Asia/Seoul')::integer as hour,
      count(*) as orders,coalesce(sum(total),0) as revenue
    from scoped where created_at>=day_starts_at group by side,hour
  ), hours as (
    select h.hour,
      case when h.hour<v_hours then coalesce(c.orders,0) end as orders,
      case when h.hour<v_hours then coalesce(c.revenue,0) end as revenue,
      case when h.hour<v_hours then coalesce(p.orders,0) end as comparison_orders,
      case when h.hour<v_hours then coalesce(p.revenue,0) end as comparison_revenue
    from generate_series(0,23) h(hour)
    left join hourly c on c.side='current' and c.hour=h.hour
    left join hourly p on p.side='comparison' and p.hour=h.hour
  ), accumulated as (
    select *,
      case when hour<v_hours then sum(orders) over(order by hour) end as cumulative_orders,
      case when hour<v_hours then sum(revenue) over(order by hour) end as cumulative_revenue,
      case when hour<v_hours then sum(comparison_orders) over(order by hour) end as comparison_cumulative_orders,
      case when hour<v_hours then sum(comparison_revenue) over(order by hour) end as comparison_cumulative_revenue
    from hours
  ), goods as materialized (
    select w.period,s.side,item.good_id,max(item.good_name_snapshot) as name,
      max(item.good_ip_id_snapshot) as ip_id,sum(item.qty) as qty,
      sum(item.qty::bigint*item.unit_price::bigint) as revenue
    from scoped s join public.order_items item on item.order_id=s.id
    cross join (values ('today'),('lastHour')) w(period)
    where (v_ip is null or item.good_ip_id_snapshot=v_ip)
      and s.created_at>=case when w.period='today' then s.day_starts_at else s.ends_at-interval '1 hour' end
    group by w.period,s.side,item.good_id
  ), ranked as (
    select goods.*,row_number() over(partition by period order by revenue desc,qty desc,good_id) as rank
    from goods where side='current'
  ), top_goods as (
    select c.period,c.rank,c.good_id,c.name,c.ip_id,c.qty,c.revenue,
      coalesce(p.qty,0) as comparison_qty,coalesce(p.revenue,0) as comparison_revenue
    from ranked c left join goods p on p.side='comparison' and p.period=c.period and p.good_id=c.good_id
    where c.rank<=10
  )
  select jsonb_build_object(
    'asOf',v_as_of,'date',v_today,'comparisonDate',v_compare,'cutoff',v_cutoff,
    'comparisonCutoff',v_compare_cutoff,'completedHours',v_hours,'ipId',coalesce(v_ip,''),
    'lastHourFrom',v_cutoff-interval '1 hour','comparisonLastHourFrom',v_compare_cutoff-interval '1 hour',
    'summary',jsonb_build_object(
      'current',case when v_hours>0 then jsonb_build_object('orderCount',(select coalesce(sum(orders),0) from hours),'revenue',(select coalesce(sum(revenue),0) from hours)) end,
      'comparison',case when v_hours>0 then jsonb_build_object('orderCount',(select coalesce(sum(comparison_orders),0) from hours),'revenue',(select coalesce(sum(comparison_revenue),0) from hours)) end
    ),
    'hours',(select jsonb_agg(jsonb_build_object(
      'hour',hour,'orderCount',orders,'revenue',revenue,
      'comparisonOrderCount',comparison_orders,'comparisonRevenue',comparison_revenue,
      'cumulativeOrderCount',cumulative_orders,'cumulativeRevenue',cumulative_revenue,
      'comparisonCumulativeOrderCount',comparison_cumulative_orders,'comparisonCumulativeRevenue',comparison_cumulative_revenue
    ) order by hour) from accumulated),
    'todayGoods',coalesce((select jsonb_agg(jsonb_build_object(
      'rank',rank,'goodId',good_id,'name',name,'ipId',ip_id,'qty',qty,'revenue',revenue,
      'comparisonQty',comparison_qty,'comparisonRevenue',comparison_revenue
    ) order by rank) from top_goods where period='today'),'[]'::jsonb),
    'lastHourGoods',coalesce((select jsonb_agg(jsonb_build_object(
      'rank',rank,'goodId',good_id,'name',name,'ipId',ip_id,'qty',qty,'revenue',revenue,
      'comparisonQty',comparison_qty,'comparisonRevenue',comparison_revenue
    ) order by rank) from top_goods where period='lastHour'),'[]'::jsonb)
  ) into result;
  return result;
end;
$function$;

revoke all on function public.admin_sales_hourly_report(date,text,timestamptz)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_sales_hourly_report(date,text,timestamptz) to authenticated;
comment on function public.admin_sales_hourly_report(date,text,timestamptz) is
  'Completed KST hours before exclusive cutoff on the current DB day, compared to the same hours of an earlier day. Current revenue-order states and orders.created_at; order count/total are unfiltered by IP. IP filters only goods qty*unit_price snapshot TOP10. Null future hours are unobserved, not zero. Midnight last hour crosses into the preceding day. asOf is current read time, not a historical-state promise; rows, summary and rankings share one snapshot.';
select private.register_operator_rpc_contract(
  'public.admin_sales_hourly_report(date,text,timestamptz)'::regprocedure,'stats.read','read',false
);
notify pgrst,'reload schema';
