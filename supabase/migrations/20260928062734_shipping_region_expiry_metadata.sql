-- #514: warnings read a bounded set of policy metadata, never regional rules/evidence.
create function public.admin_shipping_region_expiry_metadata(p_at timestamptz default statement_timestamp())
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.is_staff() then raise insufficient_privilege using message='staff_required'; end if;
  if p_at is null or not isfinite(p_at) then raise invalid_parameter_value using message='invalid_warning_time'; end if;
  with candidates as (
    select policy.id,policy.version,policy.starts_at,policy.ends_at,
      origin.id origin_id,origin.name origin_name,origin.default_carrier carrier_code,carrier.label carrier_label
    from public.fulfillment_origins origin
    join public.shipping_carriers carrier on carrier.code=origin.default_carrier and carrier.is_active
    cross join lateral (
      (select p.id,p.version,p.starts_at,p.ends_at from private.shipping_region_policies p
        where p.origin_id=origin.id and p.carrier_code=origin.default_carrier and p.status='active' and p.starts_at<=p_at
        order by p.starts_at desc,p.version desc limit 1)
      union all
      (select p.id,p.version,p.starts_at,p.ends_at from private.shipping_region_policies p
        where p.origin_id=origin.id and p.carrier_code=origin.default_carrier and p.status='active'
          and p.starts_at>p_at and p.ends_at<=p_at+interval '7 days')
    ) policy
    where origin.is_active
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',candidate.id,'name',policy.configuration->>'name','version',candidate.version,'status','active',
    'startsAt',candidate.starts_at,'endsAt',candidate.ends_at,'originId',candidate.origin_id,
    'originName',candidate.origin_name,'carrierCode',candidate.carrier_code,'carrierLabel',candidate.carrier_label
  ) order by candidate.ends_at,candidate.id),'[]'::jsonb) into result
  from candidates candidate join private.shipping_region_policies policy on policy.id=candidate.id
  where candidate.ends_at<=p_at+interval '7 days';
  return result;
end $$;
revoke all on function public.admin_shipping_region_expiry_metadata(timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.admin_shipping_region_expiry_metadata(timestamptz) to authenticated;
