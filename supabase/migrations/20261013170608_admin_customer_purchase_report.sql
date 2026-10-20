-- Validated in a disposable clone and independently reviewed before local application.
-- Payment-time goods cohorts are separate from the existing customer dashboard.
create function private.admin_customer_purchase_payment_times()
returns table(order_id uuid,paid_at timestamptz)
language sql stable security invoker set search_path='' as $$
 -- Set-based equivalent of admin_sales_order_date(order,'paid'). Keep the
 -- inner provider MIN, per-attempt bank fallback and outer MIN in that order.
 -- Current payment/order status is intentionally absent: refunds retain history.
 -- The matching fields stay inside CASE: filtering three correlated join keys
 -- made the planner estimate one match and repeatedly aggregate all evidence.
 with provider_times as materialized (
  select evidence.payment_attempt_id,min(evidence.approved_at) approved_at
  from private.payment_provider_evidence evidence group by evidence.payment_attempt_id
 )
 select attempt.ref_id,min(case
  when payment.purpose='order' and payment.ref_id=attempt.ref_id and payment.amount=attempt.amount
   then coalesce(provider.approved_at,bank.confirmed_at)
  end)
 from public.payment_attempts attempt join public.payments payment on payment.id=attempt.payment_id
 left join provider_times provider on provider.payment_attempt_id=attempt.id
 left join public.bank_transfer_confirmations bank on bank.attempt_id=attempt.id
  and bank.order_id=attempt.ref_id and attempt.provider='bank_transfer'
 where attempt.purpose='order'
 group by attempt.ref_id;
$$;
alter function private.admin_customer_purchase_payment_times() owner to postgres;
revoke all on function private.admin_customer_purchase_payment_times() from public,anon,authenticated,service_role;

create function public.admin_customer_purchase_report(
 p_grain text,p_from date,p_to date,p_compare_from date default null,p_compare_to date default null
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
 today_kst date:=(statement_timestamp() at time zone 'Asia/Seoul')::date;
 current_period_start date;
 trend_last_start date;
 trend_step interval;
 selected_range record;
 result jsonb;
begin
 perform private.require_operator_capability('stats.read',false);
 if p_grain is null or p_grain not in ('week','month') or p_from is null or p_to is null
  or (p_compare_from is null)<>(p_compare_to is null) then
  raise invalid_parameter_value using message='invalid_customer_purchase_range';
 end if;
 current_period_start:=date_trunc(p_grain,today_kst::timestamp)::date;
 for selected_range in
  select p_from as range_from,p_to as range_to
  union all select p_compare_from,p_compare_to where p_compare_from is not null
 loop
  if not isfinite(selected_range.range_from) or not isfinite(selected_range.range_to)
   or selected_range.range_from<date '2010-01-01' or selected_range.range_from>selected_range.range_to
   or selected_range.range_to>=current_period_start then
   raise invalid_parameter_value using message='invalid_customer_purchase_range';
  end if;
  if selected_range.range_to-selected_range.range_from+1>366
   or selected_range.range_from<>date_trunc(p_grain,selected_range.range_from::timestamp)::date
   or selected_range.range_to+1<>date_trunc(p_grain,(selected_range.range_to+1)::timestamp)::date then
   raise invalid_parameter_value using message='invalid_customer_purchase_range';
  end if;
 end loop;

 -- Input validation ensures the inclusive end completes the selected grain.
 -- Weeks show 13 complete Monday-Sunday weeks; months show 13 calendar months.
 trend_last_start:=date_trunc(p_grain,p_to::timestamp)::date;
 trend_step:=case when p_grain='week' then interval '1 week' else interval '1 month' end;

 with periods as materialized (
  select 'current'::text period_kind,0 period_order,p_from range_from,p_to range_to
  union all select 'comparison',1,p_compare_from,p_compare_to where p_compare_from is not null
  union all select 'trend',2+series.n,
   (trend_last_start+(series.n-12)*trend_step)::date,
   (trend_last_start+(series.n-11)*trend_step-interval '1 day')::date
  from generate_series(0,12) series(n)
 ), bounds as (
  select (min(range_from)::timestamp at time zone 'Asia/Seoul')-interval '4320 hours' earliest_history,
   ((max(range_to)+1)::timestamp at time zone 'Asia/Seoul') latest_end from periods
 ), order_dates as materialized (
  -- Reuse the provider approval/bank confirmation contract. Do not infer the
  -- event from orders.created_at, payments.created_at, or a current status.
  select purchase.id,purchase.user_id,purchase.status,purchase.created_at,
   purchase.total,purchase.shipping_fee,purchase.discount_total,purchase.store_credit_total,
   payment_time.paid_at
  from public.orders purchase
  left join private.admin_customer_purchase_payment_times() payment_time on payment_time.order_id=purchase.id
 ), ordered_events as materialized (
  select purchase.*,
   lag(purchase.paid_at) over(partition by purchase.user_id order by purchase.paid_at,purchase.id) previous_paid_at
  from order_dates purchase cross join bounds
  where purchase.paid_at>=bounds.earliest_history and purchase.paid_at<bounds.latest_end
 ), classified as materialized (
  select purchase.*,
   case when previous_paid_at>=paid_at-interval '4320 hours' then 'repeat' else 'new' end customer_group,
   item.subtotal,
   item.subtotal is null
    or purchase.discount_total>item.subtotal
    or purchase.store_credit_total>item.subtotal-purchase.discount_total
    or purchase.total::numeric is distinct from item.subtotal+purchase.shipping_fee-purchase.discount_total-purchase.store_credit_total
    as monetary_issue
  from ordered_events purchase
  left join lateral (
   select sum(line.qty::numeric*line.unit_price::numeric) subtotal
   from public.order_items line where line.order_id=purchase.id
  ) item on true
 ), groups(group_key,group_order) as (values ('all'::text,0),('new',1),('repeat',2)),
 metrics as materialized (
  select period.period_kind,period.period_order,period.range_from,period.range_to,
   category.group_key,category.group_order,
   count(distinct purchase.user_id) customer_count,count(purchase.id) order_count,
   count(purchase.id) filter(where purchase.monetary_issue) monetary_issue_count,
   coalesce(sum(purchase.subtotal),0) item_subtotal,
   coalesce(sum(purchase.discount_total),0) coupon_amount,
   coalesce(sum(purchase.store_credit_total),0) credit_amount,
   coalesce(sum(purchase.subtotal-purchase.discount_total),0) product_sales_amount,
   coalesce(sum(purchase.subtotal-purchase.discount_total-purchase.store_credit_total),0) cash_product_amount
  from periods period cross join groups category
  left join classified purchase on purchase.paid_at>=period.range_from::timestamp at time zone 'Asia/Seoul'
   and purchase.paid_at<(period.range_to+1)::timestamp at time zone 'Asia/Seoul'
   and (category.group_key='all' or category.group_key=purchase.customer_group)
  group by period.period_kind,period.period_order,period.range_from,period.range_to,category.group_key,category.group_order
 ), period_results as (
  select metric.period_kind,metric.period_order,
   jsonb_build_object('from',metric.range_from,'to',metric.range_to,
    'unknownPaidAtCount',(
     select count(*) from order_dates unknown_order
     where unknown_order.paid_at is null
      and unknown_order.created_at>=metric.range_from::timestamp at time zone 'Asia/Seoul'
      and unknown_order.created_at<(metric.range_to+1)::timestamp at time zone 'Asia/Seoul'
      and (unknown_order.status=any(private.revenue_order_statuses()) or exists(
       select 1 from public.payments payment where payment.purpose='order' and payment.ref_id=unknown_order.id
        and payment.status in ('paid','refunded')
      ))
    ),
    'rows',jsonb_agg(jsonb_build_object(
     'group',metric.group_key,'customerCount',metric.customer_count,'orderCount',metric.order_count,
     'monetaryIssueOrderCount',metric.monetary_issue_count,
     'itemSubtotal',case when metric.monetary_issue_count=0 then metric.item_subtotal end,
     'couponAmount',case when metric.monetary_issue_count=0 then metric.coupon_amount end,
     'storeCreditAmount',case when metric.monetary_issue_count=0 then metric.credit_amount end,
     'productSalesAmount',case when metric.monetary_issue_count=0 then metric.product_sales_amount end,
     'cashProductAmount',case when metric.monetary_issue_count=0 then metric.cash_product_amount end,
     'averagePerCustomer',case when metric.monetary_issue_count=0 and metric.customer_count>0
      then round(metric.product_sales_amount/metric.customer_count,2) end
    ) order by metric.group_order)) payload
  from metrics metric
  group by metric.period_kind,metric.period_order,metric.range_from,metric.range_to
 )
 select jsonb_build_object(
  'current',(select payload from period_results where period_kind='current'),
  'comparison',(select payload from period_results where period_kind='comparison'),
  'trend',(select jsonb_agg(payload order by period_order) from period_results where period_kind='trend')
 ) into result;

 -- JSON numbers consumed by JavaScript must not silently round integer money.
 if exists(
  select 1 from jsonb_array_elements(jsonb_build_array(result->'current',result->'comparison')||(result->'trend')) period(value)
  cross join lateral jsonb_array_elements(period.value->'rows') row_value(value)
  cross join lateral jsonb_each(row_value.value) amount(key,value)
  where amount.key in ('itemSubtotal','couponAmount','storeCreditAmount','productSalesAmount','cashProductAmount')
   and jsonb_typeof(amount.value)='number' and (amount.value::text)::numeric>9007199254740991
 ) then raise numeric_value_out_of_range using message='customer_purchase_amount_out_of_range';end if;
 return result;
end $$;
alter function public.admin_customer_purchase_report(text,date,date,date,date) owner to postgres;
revoke all on function public.admin_customer_purchase_report(text,date,date,date,date) from public,anon,authenticated,service_role;
grant execute on function public.admin_customer_purchase_report(text,date,date,date,date) to authenticated;
comment on function public.admin_customer_purchase_report(text,date,date,date,date) is
 'Goods purchase cohorts by proven payment time. Rolling 180 days inclusive; ties by order ID. Product sales excludes coupons and shipping, includes credits. Later cancellations remain in history.';
do $$begin
 perform private.register_operator_internal_contract('private.admin_customer_purchase_payment_times()'::regprocedure);
 perform private.register_operator_rpc_contract('public.admin_customer_purchase_report(text,date,date,date,date)'::regprocedure,'stats.read','read',false);
end $$;
