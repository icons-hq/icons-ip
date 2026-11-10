-- Reviewed for isolated validation; no production application is authorized.
-- Preserve admin_sales_report's goods arithmetic and current-state cohort.
-- Keep that existing TOP20 RPC unchanged for its other report sections.
create function public.admin_sales_goods_page(
  p_from timestamptz,
  p_to timestamptz,
  p_ip_id text default null,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $function$
declare
  v_ip text := nullif(btrim(p_ip_id), '');
  v_result jsonb;
begin
  if not public.has_operator_capability('stats.read', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  -- UI selection is at most 366 days; a previous-year derived range can be 367.
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
    or p_to <= p_from or p_to - p_from > interval '367 days' then
    raise invalid_parameter_value using message = 'invalid_report_range';
  end if;
  -- 10001 is an export sentinel; the application rejects exports over 10000.
  if p_page is null or p_page < 1 or p_page_size is null
    or p_page_size not in (20, 50, 100, 10001) then
    raise invalid_parameter_value using message = 'invalid_report_page';
  end if;

  with goods as materialized (
    select item.good_id,
      max(item.good_name_snapshot) as name,
      max(item.good_ip_id_snapshot) as ip_id,
      sum(item.qty) as qty,
      sum(item.qty::bigint * item.unit_price::bigint) as revenue
    from public.order_items item
    join public.orders purchase on purchase.id = item.order_id
    where purchase.status = any (private.revenue_order_statuses())
      and purchase.created_at >= p_from and purchase.created_at < p_to
      and (v_ip is null or item.good_ip_id_snapshot = v_ip)
    group by item.good_id
  ), totals as (
    select count(*) as total_count from goods
  ), paging as (
    select total_count,
      least(p_page::bigint, greatest(1::bigint, (total_count + p_page_size - 1) / p_page_size)) as page
    from totals
  ), ranked as (
    select goods.*, row_number() over (order by revenue desc, qty desc, good_id) as rank
    from goods
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'rank', row.rank, 'goodId', row.good_id, 'name', row.name,
        'ipId', row.ip_id, 'qty', row.qty, 'revenue', row.revenue
      ) order by row.rank)
      from (
        select * from ranked
        order by rank limit p_page_size offset ((paging.page - 1) * p_page_size)
      ) row
    ), '[]'::jsonb),
    'totalCount', paging.total_count,
    'page', paging.page,
    'pageSize', p_page_size,
    'asOf', statement_timestamp()
  ) into v_result from paging;
  return v_result;
end;
$function$;

revoke all on function public.admin_sales_goods_page(timestamptz,timestamptz,text,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_sales_goods_page(timestamptz,timestamptz,text,integer,integer)
  to authenticated;
comment on function public.admin_sales_goods_page(timestamptz,timestamptz,text,integer,integer) is
  'Goods ranking matches admin_sales_report: current revenue order states, orders.created_at [from,to), item name/IP snapshots, qty*unit_price before order-level discounts/credits/shipping, revenue desc then qty desc then good_id. Count and page share one statement snapshot; export sentinel 10001 is not permission to export over 10000.';
select private.register_operator_rpc_contract(
  'public.admin_sales_goods_page(timestamptz,timestamptz,text,integer,integer)'::regprocedure,
  'stats.read', 'read', false
);
notify pgrst, 'reload schema';
