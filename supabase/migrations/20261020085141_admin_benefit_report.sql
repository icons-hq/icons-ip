-- 쿠폰 리포트: 발급 코호트와 기간 내 주문 사용은 서로 다른 지표다.
-- 사용 성과는 적용 원장+현재 결제 완료 주문 상태만 포함하고 pending 예약은 제외한다.
create index user_coupons_report_issued on public.user_coupons(issued_at,coupon_code);
create index coupon_redemptions_report_applied on public.coupon_redemptions(applied_at,coupon_code);
create index coupon_redemptions_report_released on public.coupon_redemptions(released_at,coupon_code) where released_at is not null;
create function public.admin_benefit_report(
 p_from timestamptz, p_to timestamptz, p_query text default '',
 p_discount text default 'all', p_segment text default 'all', p_code text default '',
 p_limit integer default 50, p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb; needle text := btrim(coalesce(p_query,'')); pattern text;
begin
 if (select auth.uid()) is null or not public.is_staff() then
  raise insufficient_privilege using message='staff_required';
 end if;
 if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
  or p_to<=p_from or p_to-p_from>interval '366 days' or length(needle)>100
  or p_discount is null or p_discount not in('all','fixed','percent')
  or p_segment is null or p_segment not in('all','first_purchase','repeat_purchase')
  or p_code is null or length(p_code)>24 or p_limit is null or p_limit not between 1 and 10000
  or p_offset is null or p_offset<0 then
  raise invalid_parameter_value using message='invalid_benefit_report';
 end if;
 pattern := '%'||replace(replace(replace(needle,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';
 with definitions as materialized (
  select c.code,c.name from public.coupons c
  where (needle='' or c.code ilike pattern escape E'\\' or c.name ilike pattern escape E'\\')
   and (p_discount='all' or c.discount_type=p_discount)
   and (p_segment='all' or c.recipient_segment=p_segment)
   and (p_code='' or c.code=p_code)
 ), issued as materialized (
  select u.*, exists(select 1 from public.coupon_redemptions r join public.orders o on o.id=r.order_id
    where r.user_coupon_id=u.id and r.status='applied' and o.status=any(private.revenue_order_statuses())) as cohort_paid
  from public.user_coupons u join definitions d on d.code=u.coupon_code
  where u.issued_at>=p_from and u.issued_at<p_to
 ), redemptions as materialized (
  select r.*,o.total,case when r.status='released' then 'released'
    when o.status=any(private.revenue_order_statuses()) then 'paid'
    when o.status='pending' then 'pending' else 'other' end as report_status
  from public.coupon_redemptions r join definitions d on d.code=r.coupon_code
  join public.orders o on o.id=r.order_id
  where (r.applied_at>=p_from and r.applied_at<p_to) or (r.released_at>=p_from and r.released_at<p_to)
 ), events as materialized (
  select coupon_code,(issued_at at time zone 'Asia/Seoul')::date as date,
   1::bigint as issued,0::bigint as paid_uses,0::bigint as discount_amount,0::bigint as order_amount,
   0::bigint as released,cohort_paid::integer::bigint as cohort_paid_uses from issued
  union all
  select coupon_code,(applied_at at time zone 'Asia/Seoul')::date,0,1,discount_amount,total,0,0
   from redemptions where report_status='paid' and applied_at>=p_from and applied_at<p_to
  union all
  select coupon_code,(released_at at time zone 'Asia/Seoul')::date,0,0,0,0,1,0
   from redemptions where report_status='released' and released_at>=p_from and released_at<p_to
 ), coupon_totals as materialized (
  select d.code,d.name,coalesce(sum(e.issued),0) as issued,coalesce(sum(e.paid_uses),0) as "paidUses",
   coalesce(sum(e.discount_amount),0) as "discountAmount",coalesce(sum(e.order_amount),0) as "orderAmount",
   coalesce(sum(e.released),0) as released,coalesce(sum(e.cohort_paid_uses),0) as "cohortPaidUses"
  from definitions d join events e on e.coupon_code=d.code group by d.code,d.name
 ), daily as (
  select date,sum(issued) as issued,sum(paid_uses) as "paidUses",sum(discount_amount) as "discountAmount",
   sum(order_amount) as "orderAmount",sum(released) as released,sum(cohort_paid_uses) as "cohortPaidUses"
  from events group by date
 )
 select jsonb_build_object(
  'summary',(select jsonb_build_object('issued',coalesce(sum(issued),0),'paidUses',coalesce(sum(paid_uses),0),
   'discountAmount',coalesce(sum(discount_amount),0),'orderAmount',coalesce(sum(order_amount),0),
   'released',coalesce(sum(released),0),'cohortPaidUses',coalesce(sum(cohort_paid_uses),0)) from events),
  'daily',coalesce((select jsonb_agg(to_jsonb(d) order by date) from daily d),'[]'::jsonb),
  'coupons',coalesce((select jsonb_agg(to_jsonb(c) order by "discountAmount" desc,code)
   from (select * from coupon_totals order by "discountAmount" desc,code limit p_limit offset case when p_code='' then p_offset else 0 end)c),'[]'::jsonb),
  'couponCount',(select count(*) from coupon_totals),
  'uses',case when p_code='' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
    'id',r.id,'orderId',r.order_id,'appliedAt',r.applied_at,'releasedAt',r.released_at,
    'status',r.report_status,'discountAmount',r.discount_amount,'orderAmount',r.total)
    order by r.applied_at desc,r.id)
   from(select * from redemptions order by applied_at desc,id limit p_limit offset p_offset)r),'[]'::jsonb) end,
  'useCount',case when p_code='' then 0 else(select count(*) from redemptions) end
 ) into v_result;
 return v_result;
end;$$;
revoke all on function public.admin_benefit_report(timestamptz,timestamptz,text,text,text,text,integer,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_benefit_report(timestamptz,timestamptz,text,text,text,text,integer,integer) to authenticated;
