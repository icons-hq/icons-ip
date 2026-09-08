-- #422/#444: a zero-priced policy item still belongs to the policy parcel.
-- Track membership separately from its subtotal so only an absent policy group
-- or an explicitly reached free threshold waives the base fee.
create or replace function private.calculate_goods_shipping(target_lines jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
  with lines as (
    select * from jsonb_to_recordset(target_lines)
      as x(origin_id uuid,good_id text,qty integer,unit_price bigint,fee_type text,individual_fee bigint)
  ), per_good as (
    select origin_id,good_id,
      bool_or(fee_type='policy') has_policy_items,
      sum(unit_price*qty) filter(where fee_type='policy') policy_subtotal,
      max(case when fee_type='individual' then individual_fee else 0 end) individual_fee
    from lines group by origin_id,good_id
  ), per_origin as (
    select origin_id,bool_or(has_policy_items) has_policy_items,
      coalesce(sum(policy_subtotal),0)::bigint policy_subtotal,sum(individual_fee)::bigint individual_fee
    from per_good group by origin_id
  ), fees as (
    select origin.*,p.policy_subtotal,p.individual_fee,
      case when p.has_policy_items and (origin.free_threshold is null or p.policy_subtotal<origin.free_threshold)
        then origin.base_fee else 0 end policy_fee
    from per_origin p join public.fulfillment_origins origin on origin.id=p.origin_id
  ) select jsonb_build_object('totalFee',coalesce(sum(policy_fee+individual_fee),0),
    'groups',coalesce(jsonb_agg(jsonb_build_object(
      'originId',id,'originCode',code,'originName',name,'policySubtotal',policy_subtotal,
      'baseFee',base_fee,'freeThreshold',free_threshold,'policyFee',policy_fee,'individualFee',individual_fee,
      'totalFee',policy_fee+individual_fee
    ) order by code,id),'[]'::jsonb)) from fees;
$$;
revoke all on function private.calculate_goods_shipping(jsonb) from public,anon,authenticated,service_role;
