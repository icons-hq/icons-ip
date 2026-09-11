-- #493. Actual carrier tables are absent: no live regions, prices or active
-- policies are seeded. First adoption is explicit; expiry never falls back.
create table private.shipping_region_policies (
  id uuid primary key default gen_random_uuid(),
  origin_id uuid not null references public.fulfillment_origins(id),
  carrier_code text not null references public.shipping_carriers(code),
  version integer not null check(version>0), revision integer not null default 1 check(revision>0),
  status text not null default 'draft' check(status in ('draft','active','retired')),
  configuration jsonb not null check(jsonb_typeof(configuration)='object'),
  starts_at timestamptz, ends_at timestamptz,
  confirmed_by uuid references public.profiles(id), confirmed_at timestamptz,
  updated_by uuid not null references public.profiles(id), updated_at timestamptz not null default clock_timestamp(),
  unique(origin_id,carrier_code,version),
  check(status='draft' or (starts_at is not null and confirmed_by is not null and confirmed_at is not null)),
  check(ends_at is null or starts_at is null or ends_at>starts_at)
);
create index shipping_region_policies_effective on private.shipping_region_policies(origin_id,carrier_code,starts_at,ends_at) where status='active';
create table private.shipping_region_adoptions (
  origin_id uuid primary key references public.fulfillment_origins(id),
  managed_from timestamptz not null, first_confirmed_at timestamptz not null default clock_timestamp()
);
alter table private.shipping_region_policies enable row level security;
alter table private.shipping_region_adoptions enable row level security;
revoke all on private.shipping_region_policies,private.shipping_region_adoptions from public,anon,authenticated,service_role;
grant all on private.shipping_region_policies,private.shipping_region_adoptions to postgres;

create function private.shipping_region_text(value text) returns text language sql immutable set search_path='' as $$
  select btrim(regexp_replace(translate(coalesce(value,''),
    chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279),
    repeat(' ',19)),'[[:space:]]+',' ','g'));
$$;
revoke all on function private.shipping_region_text(text) from public,anon,authenticated,service_role;
grant execute on function private.shipping_region_text(text) to postgres;

create function private.normalize_shipping_region_policy(p_values jsonb) returns jsonb
language plpgsql volatile set search_path='' as $$
declare result jsonb; rule jsonb; rules jsonb:='[]'; key text; rule_id uuid; seen_ids uuid[]:='{}';
begin
  if p_values is null or jsonb_typeof(p_values)<>'object' or not (p_values ?& array[
    'originId','carrierCode','name','startsAt','endsAt','openEnded','sourceEvidence','unlistedDisposition','feeUnit',
    'chargePolicyGoods','waivePolicyThreshold','chargeFreeGoods','chargeIndividualGoods','noRulesConfirmed','rules'])
    or exists(select 1 from jsonb_object_keys(p_values) field where field not in (
      'originId','carrierCode','name','startsAt','endsAt','openEnded','sourceEvidence','unlistedDisposition','feeUnit',
      'chargePolicyGoods','waivePolicyThreshold','chargeFreeGoods','chargeIndividualGoods','noRulesConfirmed','rules'))
    or jsonb_typeof(p_values->'originId')<>'string' or nullif(p_values->>'originId','') is null
    or jsonb_typeof(p_values->'carrierCode')<>'string' or nullif(btrim(p_values->>'carrierCode'),'') is null or length(p_values->>'carrierCode')>80
    or jsonb_typeof(p_values->'name')<>'string' or length(p_values->>'name')>100
    or jsonb_typeof(p_values->'sourceEvidence')<>'string' or length(p_values->>'sourceEvidence')>2000
    or jsonb_typeof(p_values->'noRulesConfirmed')<>'boolean'
    or jsonb_typeof(p_values->'rules')<>'array' or jsonb_array_length(p_values->'rules')>1000
    or jsonb_typeof(p_values->'unlistedDisposition') not in ('null','string')
    or (p_values->>'unlistedDisposition' is not null and p_values->>'unlistedDisposition' not in ('standard','manual_review'))
    or jsonb_typeof(p_values->'feeUnit') not in ('null','string')
    or (p_values->>'feeUnit' is not null and p_values->>'feeUnit' not in ('per_shipment','per_good')) then
    raise invalid_parameter_value using message='shipping_region_input_invalid';
  end if;
  perform (p_values->>'originId')::uuid;
  foreach key in array array['openEnded','chargePolicyGoods','waivePolicyThreshold','chargeFreeGoods','chargeIndividualGoods'] loop
    if jsonb_typeof(p_values->key) not in ('boolean','null') then raise invalid_parameter_value using message='shipping_region_input_invalid'; end if;
  end loop;
  foreach key in array array['startsAt','endsAt'] loop
    if jsonb_typeof(p_values->key) not in ('string','null') or (p_values->>key is not null and not isfinite((p_values->>key)::timestamptz)) then
      raise invalid_parameter_value using message='shipping_region_input_invalid';
    end if;
  end loop;
  if p_values->>'startsAt' is not null and p_values->>'endsAt' is not null
    and (p_values->>'startsAt')::timestamptz >= (p_values->>'endsAt')::timestamptz then
    raise invalid_parameter_value using message='shipping_region_period_invalid';
  end if;
  for rule in select value from jsonb_array_elements(p_values->'rules') loop
    if jsonb_typeof(rule)<>'object' or not (rule ?& array['id','postalFrom','postalTo','addressPrefix','regionLabel','disposition','amount'])
      or exists(select 1 from jsonb_object_keys(rule) field where field not in ('id','postalFrom','postalTo','addressPrefix','regionLabel','disposition','amount'))
      or jsonb_typeof(rule->'id') not in ('null','string')
      or jsonb_typeof(rule->'postalFrom')<>'string' or (rule->>'postalFrom')!~'^(\d{5})?$'
      or jsonb_typeof(rule->'postalTo')<>'string' or (rule->>'postalTo')!~'^(\d{5})?$'
      or jsonb_typeof(rule->'addressPrefix')<>'string' or length(rule->>'addressPrefix')>200
      or jsonb_typeof(rule->'regionLabel')<>'string' or length(rule->>'regionLabel')>100
      or jsonb_typeof(rule->'disposition')<>'string' or rule->>'disposition' not in ('','standard','surcharge','unavailable','manual_review')
      or jsonb_typeof(rule->'amount') not in ('null','number')
      or (rule->>'amount' is not null and ((rule->>'amount')!~'^\d+$' or (rule->>'amount')::numeric not between 0 and 1000000)) then
      raise invalid_parameter_value using message='shipping_region_rule_invalid';
    end if;
    rule_id:=coalesce((rule->>'id')::uuid,gen_random_uuid());
    if rule_id=any(seen_ids) then raise invalid_parameter_value using message='shipping_region_rule_invalid'; end if;
    seen_ids:=array_append(seen_ids,rule_id);
    rules:=rules||jsonb_build_array(rule||jsonb_build_object('id',rule_id,
      'addressPrefix',private.shipping_region_text(rule->>'addressPrefix'),'regionLabel',private.shipping_region_text(rule->>'regionLabel')));
  end loop;
  result:=p_values||jsonb_build_object('originId',(p_values->>'originId')::uuid,'carrierCode',btrim(p_values->>'carrierCode'),
    'name',private.shipping_region_text(p_values->>'name'),'sourceEvidence',btrim(p_values->>'sourceEvidence'),
    'startsAt',(p_values->>'startsAt')::timestamptz,'endsAt',(p_values->>'endsAt')::timestamptz,'rules',rules);
  return result;
end $$;
revoke all on function private.normalize_shipping_region_policy(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.normalize_shipping_region_policy(jsonb) to postgres;

create function private.assert_shipping_region_policy_complete(configuration jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare rule jsonb;
begin
  if private.shipping_region_text(configuration->>'name')='' or private.shipping_region_text(configuration->>'sourceEvidence')=''
    or configuration->>'startsAt' is null or configuration->>'openEnded' is null
    or ((configuration->>'openEnded')::boolean and configuration->>'endsAt' is not null)
    or (not (configuration->>'openEnded')::boolean and configuration->>'endsAt' is null)
    or configuration->>'unlistedDisposition' is null or configuration->>'feeUnit' is null
    or configuration->>'chargePolicyGoods' is null or configuration->>'waivePolicyThreshold' is null
    or configuration->>'chargeFreeGoods' is null or configuration->>'chargeIndividualGoods' is null
    or ((jsonb_array_length(configuration->'rules')=0) is distinct from (configuration->>'noRulesConfirmed')::boolean) then
    raise check_violation using message='shipping_region_policy_incomplete';
  end if;
  for rule in select value from jsonb_array_elements(configuration->'rules') loop
    if rule->>'postalFrom'!~'^\d{5}$' or rule->>'postalTo'!~'^\d{5}$' or rule->>'postalFrom'>rule->>'postalTo'
      or private.shipping_region_text(rule->>'regionLabel')='' or rule->>'disposition'=''
      or ((rule->>'disposition'='surcharge') is distinct from (rule->>'amount' is not null)) then
      raise check_violation using message='shipping_region_policy_incomplete';
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(configuration->'rules') with ordinality a(rule,position)
    join jsonb_array_elements(configuration->'rules') with ordinality b(rule,position) on a.position<b.position
    where a.rule->>'postalFrom'<=b.rule->>'postalTo' and b.rule->>'postalFrom'<=a.rule->>'postalTo'
      and (a.rule->>'addressPrefix'='' or b.rule->>'addressPrefix'='' or a.rule->>'addressPrefix'=b.rule->>'addressPrefix'
        or starts_with(a.rule->>'addressPrefix',(b.rule->>'addressPrefix')||' ')
        or starts_with(b.rule->>'addressPrefix',(a.rule->>'addressPrefix')||' '))) then
    raise check_violation using message='shipping_region_rules_overlap';
  end if;
end $$;
revoke all on function private.assert_shipping_region_policy_complete(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.assert_shipping_region_policy_complete(jsonb) to postgres;

create function private.shipping_region_policy_record(policy private.shipping_region_policies) returns jsonb
language sql stable security invoker set search_path='' as $$
  select policy.configuration||jsonb_build_object('id',policy.id,'version',policy.version,'revision',policy.revision,
    'status',policy.status,'confirmedAt',policy.confirmed_at,'confirmedBy',
    case when policy.confirmed_by is not null then coalesce((select nickname from public.profiles where id=policy.confirmed_by),'관리자') end,
    'updatedAt',policy.updated_at);
$$;
revoke all on function private.shipping_region_policy_record(private.shipping_region_policies) from public,anon,authenticated,service_role;
grant execute on function private.shipping_region_policy_record(private.shipping_region_policies) to postgres;

create function public.admin_list_shipping_region_policies() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='staff required'; end if;
  return jsonb_build_object('policies',(select coalesce(jsonb_agg(private.shipping_region_policy_record(policy)
    order by policy.origin_id,policy.carrier_code,policy.version desc),'[]') from private.shipping_region_policies policy),
    'adoptions',(select coalesce(jsonb_agg(jsonb_build_object('originId',origin_id,'managedFrom',managed_from) order by origin_id),'[]')
      from private.shipping_region_adoptions));
end $$;
revoke all on function public.admin_list_shipping_region_policies() from public,anon,authenticated,service_role;
grant execute on function public.admin_list_shipping_region_policies() to authenticated;

create function public.admin_save_shipping_region_policy(p_policy_id uuid,p_values jsonb,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); v_configuration jsonb; previous private.shipping_region_policies; saved private.shipping_region_policies;
  origin public.fulfillment_origins; next_version integer;
begin
  if actor is null or not exists(select 1 from public.profiles where id=actor and role='admin')
    or not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='admin required'; end if;
  v_configuration:=private.normalize_shipping_region_policy(p_values);
  select * into origin from public.fulfillment_origins where id=(v_configuration->>'originId')::uuid for update;
  if not found then raise no_data_found using message='fulfillment_origin_not_found'; end if;
  if not exists(select 1 from public.shipping_carriers where code=v_configuration->>'carrierCode') then
    raise check_violation using message='shipping_region_carrier_invalid'; end if;
  if p_policy_id is null then
    if p_expected_revision is not null then raise sqlstate 'PT409' using message='shipping_region_policy_changed'; end if;
    select coalesce(max(version),0)+1 into next_version from private.shipping_region_policies
      where origin_id=origin.id and carrier_code=v_configuration->>'carrierCode';
    insert into private.shipping_region_policies(origin_id,carrier_code,version,configuration,starts_at,ends_at,updated_by)
      values(origin.id,v_configuration->>'carrierCode',next_version,v_configuration,(v_configuration->>'startsAt')::timestamptz,
        (v_configuration->>'endsAt')::timestamptz,actor) returning * into saved;
  else
    select * into previous from private.shipping_region_policies where id=p_policy_id for update;
    if not found then raise no_data_found using message='shipping_region_policy_not_found'; end if;
    if previous.origin_id<>origin.id or previous.carrier_code<>v_configuration->>'carrierCode' then
      raise check_violation using message='shipping_region_identity_immutable'; end if;
    if previous.status<>'draft' then raise check_violation using message='shipping_region_policy_immutable'; end if;
    if previous.revision is distinct from p_expected_revision then raise sqlstate 'PT409' using message='shipping_region_policy_changed'; end if;
    update private.shipping_region_policies set configuration=v_configuration,
      starts_at=(v_configuration->>'startsAt')::timestamptz,
      ends_at=(v_configuration->>'endsAt')::timestamptz,
      revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where id=previous.id returning * into saved;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipping_region.saved','shipping-region:'||saved.id,
    jsonb_build_object('originId',saved.origin_id,'version',saved.version,'revision',saved.revision,
      'before',case when previous.id is not null then private.shipping_region_policy_record(previous) end,
      'after',private.shipping_region_policy_record(saved)));
  return private.shipping_region_policy_record(saved);
end $$;
revoke all on function public.admin_save_shipping_region_policy(uuid,jsonb,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_shipping_region_policy(uuid,jsonb,integer) to authenticated;

create function public.admin_set_shipping_region_policy_status(p_policy_id uuid,p_status text,p_expected_revision integer,p_attested boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous private.shipping_region_policies; saved private.shipping_region_policies; origin public.fulfillment_origins;
begin
  if actor is null or not exists(select 1 from public.profiles where id=actor and role='admin')
    or not coalesce(public.is_staff(),false) then raise insufficient_privilege using message='admin required'; end if;
  if p_status is null or p_status not in ('active','retired') then raise invalid_parameter_value using message='shipping_region_status_invalid'; end if;
  select * into previous from private.shipping_region_policies where id=p_policy_id;
  if not found then raise no_data_found using message='shipping_region_policy_not_found'; end if;
  select * into origin from public.fulfillment_origins where id=previous.origin_id for update;
  select * into previous from private.shipping_region_policies where id=p_policy_id for update;
  if previous.revision is distinct from p_expected_revision then raise sqlstate 'PT409' using message='shipping_region_policy_changed'; end if;
  if p_attested is distinct from true then raise check_violation using message='shipping_region_attestation_required'; end if;
  if p_status='active' then
    if previous.status<>'draft' then raise check_violation using message='shipping_region_policy_immutable'; end if;
    perform private.assert_shipping_region_policy_complete(previous.configuration);
    if not origin.is_active or origin.default_carrier is distinct from previous.carrier_code
      or not exists(select 1 from public.shipping_carriers where code=previous.carrier_code and is_active) then
      raise check_violation using message='shipping_region_carrier_mismatch'; end if;
    if previous.ends_at is not null and previous.ends_at<=statement_timestamp() then
      raise check_violation using message='shipping_region_policy_expired'; end if;
    if exists(select 1 from private.shipping_region_policies policy where policy.origin_id=previous.origin_id
      and policy.carrier_code=previous.carrier_code and policy.status='active' and policy.id<>previous.id
      and tstzrange(policy.starts_at,policy.ends_at,'[)')&&tstzrange(previous.starts_at,previous.ends_at,'[)')) then
      raise check_violation using message='shipping_region_period_overlap'; end if;
    insert into private.shipping_region_adoptions(origin_id,managed_from) values(previous.origin_id,previous.starts_at)
      on conflict(origin_id) do update set managed_from=least(private.shipping_region_adoptions.managed_from,excluded.managed_from);
  elsif previous.status<>'active' then raise check_violation using message='shipping_region_status_invalid'; end if;
  update private.shipping_region_policies set status=p_status,revision=revision+1,updated_by=actor,updated_at=clock_timestamp(),
    confirmed_by=case when p_status='active' then actor else confirmed_by end,
    confirmed_at=case when p_status='active' then clock_timestamp() else confirmed_at end
    where id=p_policy_id returning * into saved;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipping_region.'||p_status,'shipping-region:'||saved.id,
    jsonb_build_object('originId',saved.origin_id,'version',saved.version,'before',private.shipping_region_policy_record(previous),
      'after',private.shipping_region_policy_record(saved)));
  return private.shipping_region_policy_record(saved);
end $$;
revoke all on function public.admin_set_shipping_region_policy_status(uuid,text,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_set_shipping_region_policy_status(uuid,text,integer,boolean) to authenticated;

create function private.shipping_region_destination(p_destination jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare postal text; address_line text;
begin
  if p_destination is null or p_destination='null'::jsonb then return null; end if;
  if jsonb_typeof(p_destination)<>'object' or not (p_destination ?& array['postalCode','address1'])
    or exists(select 1 from jsonb_object_keys(p_destination) field where field not in ('postalCode','address1'))
    or jsonb_typeof(p_destination->'postalCode')<>'string' or jsonb_typeof(p_destination->'address1')<>'string' then
    raise invalid_parameter_value using message='shipping_destination_invalid'; end if;
  postal:=btrim(p_destination->>'postalCode'); address_line:=private.shipping_region_text(p_destination->>'address1');
  if postal!~'^\d{5}$' or address_line='' or length(address_line)>200 or address_line~'[[:cntrl:]]' then return null; end if;
  return jsonb_build_object('postalCode',postal,'address1',address_line);
end $$;
revoke all on function private.shipping_region_destination(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.shipping_region_destination(jsonb) to postgres;

-- The caller supplies already-validated catalog lines or frozen order lines.
-- Base policy/free/individual math remains private.calculate_goods_shipping.
create function private.apply_shipping_region_quote(p_base_quote jsonb,p_lines jsonb,p_destination jsonb,p_at timestamptz)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare destination jsonb:=private.shipping_region_destination(p_destination); group_value jsonb; groups jsonb:='[]';
  origin public.fulfillment_origins; policy private.shipping_region_policies; managed_from timestamptz;
  rule jsonb; matched_rule jsonb; candidate_count integer; postal_candidates integer; eligible_goods integer;
  status text; mode text; contract_fee bigint; region_fee bigint; final_fee bigint; total bigint:=0;
  allowed boolean:=true; units integer; next_change timestamptz; group_change timestamptz; policy_present boolean;
begin
  if p_at is null or not isfinite(p_at) then raise invalid_parameter_value using message='shipping_quote_time_invalid'; end if;
  for group_value in select value from jsonb_array_elements(p_base_quote->'groups') loop
    select * into origin from public.fulfillment_origins where id=(group_value->>'originId')::uuid;
    if not found or not origin.is_active then raise check_violation using message='fulfillment_origin_inactive'; end if;
    select adoption.managed_from into managed_from from private.shipping_region_adoptions adoption where origin_id=origin.id;
    select min(moment) into group_change from (
      select region.starts_at moment from private.shipping_region_policies region where region.origin_id=origin.id and region.status='active' and region.starts_at>p_at
      union all select region.ends_at from private.shipping_region_policies region where region.origin_id=origin.id and region.status='active' and region.ends_at>p_at
      union all select managed_from where managed_from>p_at
    ) moments;
    next_change:=least(next_change,group_change);
    policy:=null; matched_rule:=null; units:=0; contract_fee:=null; region_fee:=null; final_fee:=null;
    policy_present:=false;
    if managed_from is null or p_at<managed_from then
      mode:='legacy_base_only'; status:='unconfigured'; region_fee:=0; final_fee:=(group_value->>'totalFee')::bigint;
    else
      mode:='managed';
      select region.* into policy from private.shipping_region_policies region where region.origin_id=origin.id and region.carrier_code=origin.default_carrier
        and region.status='active' and region.starts_at<=p_at and (region.ends_at is null or p_at<region.ends_at) order by region.starts_at desc limit 1;
      policy_present:=found;
      if not exists(select 1 from public.shipping_carriers where code=origin.default_carrier and is_active) then
        status:='carrier_mismatch'; policy_present:=false; policy:=null;
      elsif not policy_present then
        status:=case when exists(select 1 from private.shipping_region_policies region where region.origin_id=origin.id
          and region.status='active' and region.starts_at<=p_at and (region.ends_at is null or p_at<region.ends_at) and region.carrier_code<>origin.default_carrier)
          then 'carrier_mismatch' else 'policy_unavailable' end;
      elsif destination is null then status:='address_required';
      else
        candidate_count:=0; postal_candidates:=0;
        for rule in select value from jsonb_array_elements(policy.configuration->'rules')
          where value->>'postalFrom'<=destination->>'postalCode' and destination->>'postalCode'<=value->>'postalTo' loop
          postal_candidates:=postal_candidates+1;
          if rule->>'addressPrefix'='' or destination->>'address1'=rule->>'addressPrefix'
            or starts_with(destination->>'address1',(rule->>'addressPrefix')||' ') then
            candidate_count:=candidate_count+1; matched_rule:=rule;
          end if;
        end loop;
        if candidate_count>1 or (postal_candidates>0 and candidate_count=0) then
          status:='manual_review'; matched_rule:=null;
        elsif candidate_count=1 then status:=matched_rule->>'disposition';
        else status:=policy.configuration->>'unlistedDisposition'; end if;
        if status='standard' then contract_fee:=0; region_fee:=0;
        elsif status='surcharge' then
          contract_fee:=(matched_rule->>'amount')::bigint;
          select count(distinct line.good_id)::integer into eligible_goods
          from jsonb_to_recordset(p_lines) line(origin_id uuid,good_id text,fee_type text)
          where line.origin_id=origin.id and case line.fee_type
            when 'policy' then (policy.configuration->>'chargePolicyGoods')::boolean
              and not ((policy.configuration->>'waivePolicyThreshold')::boolean and group_value->>'freeThreshold' is not null
                and (group_value->>'policySubtotal')::bigint>=(group_value->>'freeThreshold')::bigint)
            when 'free' then (policy.configuration->>'chargeFreeGoods')::boolean
            when 'individual' then (policy.configuration->>'chargeIndividualGoods')::boolean else false end;
          units:=case when policy.configuration->>'feeUnit'='per_shipment' then least(eligible_goods,1) else eligible_goods end;
          region_fee:=contract_fee*units;
        end if;
        if region_fee is not null then final_fee:=(group_value->>'totalFee')::bigint+region_fee; end if;
      end if;
    end if;
    if final_fee is null then allowed:=false; end if;
    total:=total+(group_value->>'totalFee')::bigint+coalesce(region_fee,0);
    groups:=groups||jsonb_build_array(group_value||jsonb_build_object(
      'totalFee',(group_value->>'totalFee')::bigint+coalesce(region_fee,0),'regionMode',mode,'regionStatus',status,
      'regionalContractFee',contract_fee,'regionalFee',region_fee,'finalFee',final_fee,
      'policyId',case when policy_present then policy.id end,'policyVersion',case when policy_present then policy.version end,
      'ruleId',(matched_rule->>'id')::uuid,'regionLabel',matched_rule->>'regionLabel','carrierCode',origin.default_carrier,
      'feeUnit',case when policy_present then policy.configuration->>'feeUnit' end,'unitCount',units,
      'destinationPostalCode',destination->>'postalCode','matchedAddressPrefix',nullif(matched_rule->>'addressPrefix','')));
  end loop;
  return p_base_quote||jsonb_build_object('groups',groups,'totalFee',total,'finalTotalFee',case when allowed then total end,
    'checkoutAllowed',allowed,'destination',destination,'nextChangeAt',next_change);
end $$;
revoke all on function private.apply_shipping_region_quote(jsonb,jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.apply_shipping_region_quote(jsonb,jsonb,jsonb,timestamptz) to postgres;

create function public.quote_goods_shipping_for_address(items jsonb,destination jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base_quote jsonb; lines jsonb;
begin
  base_quote:=public.quote_goods_shipping(items);
  select coalesce(jsonb_agg(jsonb_build_object('origin_id',good.origin_id,'good_id',good.id,'fee_type',good.shipping_fee_type)),'[]') into lines
    from jsonb_to_recordset(items) line("goodId" text,"variantId" uuid,qty integer) join public.goods good on good.id=line."goodId";
  return private.apply_shipping_region_quote(base_quote,lines,destination,statement_timestamp());
end $$;
revoke all on function public.quote_goods_shipping_for_address(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quote_goods_shipping_for_address(jsonb,jsonb) to anon,authenticated,postgres;

create function public.quote_goods_sales_for_address(items jsonb,destination jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare quote jsonb; shipping jsonb; lines jsonb;
begin
  quote:=public.quote_goods_sales(items);
  select coalesce(jsonb_agg(jsonb_build_object('origin_id',good.origin_id,'good_id',good.id,'fee_type',good.shipping_fee_type)),'[]') into lines
    from jsonb_to_recordset(items) line("goodId" text,"variantId" uuid,qty integer) join public.goods good on good.id=line."goodId";
  shipping:=private.apply_shipping_region_quote(quote->'shipping',lines,destination,statement_timestamp());
  return quote||jsonb_build_object('shipping',shipping,
    'nextChangeAt',least((quote->>'nextChangeAt')::timestamptz,(shipping->>'nextChangeAt')::timestamptz),
    'coupon',private.quote_selected_coupon(quote->'lines',(quote->>'subtotal')::bigint,(shipping->>'totalFee')::bigint));
end $$;
revoke all on function public.quote_goods_sales_for_address(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quote_goods_sales_for_address(jsonb,jsonb) to anon,authenticated,postgres;

-- Orders already hold their item/catalog locks. The sorted origin locks are
-- shared with policy activation/retirement and origin/carrier contract changes.
create or replace function private.goods_shipping_fee_for(target_order uuid) returns bigint
language plpgsql security invoker set search_path='' as $$
declare origin_key uuid; lines jsonb; quote jsonb; destination jsonb; block_reason text;
begin
  for origin_key in select origin.id from public.fulfillment_origins origin where origin.id in (
    select item.origin_id_snapshot from public.order_items item where item.order_id=target_order
  ) order by origin.id for share loop
    if not (select is_active from public.fulfillment_origins where id=origin_key) then
      raise check_violation using message='fulfillment_origin_inactive'; end if;
  end loop;
  select jsonb_build_object('postalCode',address->>'postalCode','address1',address->>'address1') into destination from public.orders where id=target_order;
  if not found then raise no_data_found using message='order_not_found'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('origin_id',origin_id_snapshot,'good_id',good_id,'qty',qty,
    'unit_price',unit_price,'fee_type',shipping_fee_type_snapshot,'individual_fee',individual_fee_snapshot)),'[]')
    into lines from public.order_items where order_id=target_order;
  quote:=private.apply_shipping_region_quote(private.calculate_goods_shipping(lines),lines,destination,clock_timestamp());
  if not (quote->>'checkoutAllowed')::boolean then
    select value->>'regionStatus' into block_reason from jsonb_array_elements(quote->'groups') where value->>'finalFee' is null limit 1;
    raise check_violation using message='shipping_region_'||coalesce(block_reason,'unresolved');
  end if;
  update public.orders set shipping_fee_breakdown=quote->'groups' where id=target_order;
  return (quote->>'finalTotalFee')::bigint;
end $$;
revoke all on function private.goods_shipping_fee_for(uuid) from public,anon,authenticated,service_role;
grant execute on function private.goods_shipping_fee_for(uuid) to postgres;

-- Both ABIs use the same balance/limit formula and the current targeted coupon.
-- Only the address-aware ABI requires final regional shipping before credit use.
create function private.store_credit_checkout_quote(p_requested_amount bigint,p_destination jsonb,p_with_address boolean) returns jsonb
language plpgsql volatile security invoker set search_path='' as $$
declare actor uuid:=(select auth.uid()); policy private.store_credit_policy; balance jsonb; items jsonb; sales jsonb;
  subtotal bigint; shipping bigint; coupon bigint:=0; maximum bigint:=0; reason text;
begin
  if actor is null then raise insufficient_privilege using message='auth_required'; end if;
  if p_requested_amount is null or p_requested_amount not between 0 and 999999999999 then
    raise invalid_parameter_value using message='store_credit_amount_invalid'; end if;
  select * into policy from private.store_credit_policy where singleton;
  perform private.expire_store_credit_lots(actor,clock_timestamp()); balance:=private.store_credit_balance(actor);
  if not policy.enabled then reason:='store_credit_disabled';
  elsif (balance->>'debt')::bigint>0 then reason:='store_credit_debt';
  else
    select coalesce(jsonb_agg(jsonb_build_object('goodId',good_id,'variantId',variant_id,'qty',qty)),'[]') into items
      from public.cart_items where user_id=actor;
    sales:=case when p_with_address then public.quote_goods_sales_for_address(items,p_destination) else public.quote_goods_sales(items) end;
    subtotal:=(sales->>'subtotal')::bigint; shipping:=(sales->'shipping'->>'totalFee')::bigint;
    if p_with_address and not (sales->'shipping'->>'checkoutAllowed')::boolean then reason:='shipping_region_unresolved';
    elsif sales->'coupon'->>'reason' is not null then reason:=sales->'coupon'->>'reason';
    else coupon:=coalesce((sales->'coupon'->>'discount')::bigint,0); end if;
    if reason is null then
      maximum:=least(policy.max_use,(balance->>'available')::bigint,greatest(0,subtotal-coupon),greatest(0,subtotal+shipping-coupon-1000));
      if p_requested_amount>0 and (p_requested_amount<policy.min_use or p_requested_amount>maximum) then reason:='store_credit_amount_invalid'; end if;
    end if;
  end if;
  return balance||jsonb_build_object('enabled',policy.enabled,'minUse',policy.min_use,'maxUse',maximum,
    'requestedAmount',p_requested_amount,'valid',p_requested_amount=0 or reason is null,'reason',reason);
end $$;
revoke all on function private.store_credit_checkout_quote(bigint,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function private.store_credit_checkout_quote(bigint,jsonb,boolean) to postgres;
create or replace function public.get_my_store_credit_checkout(p_requested_amount bigint default 0) returns jsonb
language sql volatile security definer set search_path='' as $$ select private.store_credit_checkout_quote(p_requested_amount,null,false); $$;
revoke all on function public.get_my_store_credit_checkout(bigint) from public,anon,authenticated,service_role;
grant execute on function public.get_my_store_credit_checkout(bigint) to authenticated;
create function public.get_my_store_credit_checkout_for_address(p_requested_amount bigint,p_destination jsonb) returns jsonb
language sql volatile security definer set search_path='' as $$ select private.store_credit_checkout_quote(p_requested_amount,p_destination,true); $$;
revoke all on function public.get_my_store_credit_checkout_for_address(bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_my_store_credit_checkout_for_address(bigint,jsonb) to authenticated;

-- create_order_shipments already copies the whole origin group unchanged.
-- Add the frozen fee record to the existing preorder-aware detail projection.
create or replace function private.order_shipment_records(target_order uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',shipment.id,'orderId',shipment.order_id,'originId',shipment.origin_id,
    'originName',shipment.origin_name_snapshot,'shippingFee',shipment.shipping_fee,'status',shipment.status,'carrier',shipment.carrier,
    'carrierLabel',coalesce(carrier.label,shipment.carrier),'trackingNumber',shipment.tracking_number,
    'trackingUrl',case when shipment.tracking_number is not null then replace(carrier.tracking_url_template,'{trackingNumber}',shipment.tracking_number) end,
    'shippedAt',shipment.shipped_at,'deliveredAt',shipment.delivered_at,'exportedAt',shipment.exported_at,
    'originalExpectedShipDate',shipment.original_expected_ship_date,'expectedShipDate',shipment.expected_ship_date,
    'preorderReady',private.shipment_preorder_allocation_ready(shipment.id),'regionalShipping',
    case when shipment.shipping_fee_snapshot ? 'regionMode' then shipment.shipping_fee_snapshot end,
    'orderItemIds',(select coalesce(jsonb_agg(item.order_item_id order by item.order_item_id),'[]')
      from public.order_shipment_items item where item.shipment_id=shipment.id)) order by shipment.created_at,shipment.id),'[]')
  from public.order_shipments shipment left join public.shipping_carriers carrier on carrier.code=shipment.carrier where shipment.order_id=target_order;
$$;
revoke all on function private.order_shipment_records(uuid) from public,anon,authenticated,service_role;
grant execute on function private.order_shipment_records(uuid) to postgres;
notify pgrst,'reload schema';
