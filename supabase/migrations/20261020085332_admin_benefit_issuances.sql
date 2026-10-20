-- Read-only detail for the existing issuance cohort.
-- Keep admin_benefit_report and its cohortPaidUses definition unchanged.
create function public.admin_benefit_issuances(
  p_from timestamptz,
  p_to timestamptz,
  p_query text default '',
  p_discount text default 'all',
  p_segment text default 'all',
  p_code text default '',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare
  result jsonb;
  needle text := btrim(coalesce(p_query,''));
  pattern text;
begin
  if (select auth.uid()) is null or not public.has_operator_capability('marketing.manage',false) then
    raise insufficient_privilege using message='operator_capability_required';
  end if;
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
    or p_to<=p_from or p_to-p_from>interval '366 days' or length(needle)>100
    or p_discount is null or p_discount not in ('all','fixed','percent')
    or p_segment is null or p_segment not in ('all','first_purchase','repeat_purchase')
    or p_code is null or btrim(p_code)='' or length(p_code)>24
    or p_limit is null or p_limit not between 1 and 10001
    or p_offset is null or p_offset<0 then
    raise invalid_parameter_value using message='invalid_benefit_issuances';
  end if;
  pattern := '%'||replace(replace(replace(needle,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%';

  -- One statement snapshot for rows, unpaged counts and the response timestamp.
  -- A JSON response avoids the Data API's default table-row response limit.
  with definitions as materialized (
    select c.code from public.coupons c
    where c.code=p_code
      and (needle='' or c.code ilike pattern escape E'\\' or c.name ilike pattern escape E'\\')
      and (p_discount='all' or c.discount_type=p_discount)
      and (p_segment='all' or c.recipient_segment=p_segment)
  ), issued as materialized (
    select u.id,u.coupon_code,u.issued_at,
      exists(select 1 from public.coupon_redemptions r join public.orders o on o.id=r.order_id
        where r.user_coupon_id=u.id and r.status='applied' and o.status=any(private.revenue_order_statuses())) as is_paid_use
    from public.user_coupons u join definitions d on d.code=u.coupon_code
    where u.issued_at>=p_from and u.issued_at<p_to
  ), totals as (
    select count(*) as total_count,count(*) filter (where is_paid_use) as paid_use_count from issued
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',page.id,'couponCode',page.coupon_code,'issuedAt',page.issued_at,'isPaidUse',page.is_paid_use
    ) order by page.issued_at desc,page.id)
      from (select * from issued order by issued_at desc,id limit p_limit offset p_offset) page),'[]'::jsonb),
    'totalCount',totals.total_count,
    'paidUseCount',totals.paid_use_count,
    'asOf',statement_timestamp()
  ) into result from totals;
  return result;
end;
$function$;

revoke all on function public.admin_benefit_issuances(timestamptz,timestamptz,text,text,text,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_benefit_issuances(timestamptz,timestamptz,text,text,text,text,integer,integer)
  to authenticated;
comment on function public.admin_benefit_issuances(timestamptz,timestamptz,text,text,text,text,integer,integer) is
  'Selected coupon issuance cohort by issued_at [from,to). isPaidUse exactly matches admin_benefit_report cohortPaidUses; not coupon availability or historical state. One read snapshot; no customer identity. Limit 10001 is an export sentinel, not permission to export over 10000.';
select private.register_operator_rpc_contract(
  'public.admin_benefit_issuances(timestamptz,timestamptz,text,text,text,text,integer,integer)'::regprocedure,
  'marketing.manage','read',false
);
notify pgrst,'reload schema';
