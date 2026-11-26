-- 활성 지역 정책의 추가료 금액만 바꾼다. 같은 지역표·기간·적용 관계로 새 버전을 바로 활성화하고
-- 이전 버전을 같은 트랜잭션에서 중단한다. 새 버전은 이전 버전의 적용 기간을 그대로 이어받으므로
-- 중단과 활성화 사이에 신규 주문이 막히는 틈이 없다. 이미 들어온 주문의 배송비 스냅샷은 그대로다.
create function public.admin_change_shipping_region_fees(p_policy_id uuid,p_expected_revision integer,p_fees jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; previous private.shipping_region_policies; saved private.shipping_region_policies; origin public.fulfillment_origins;
  label text; fee jsonb; rules jsonb:='[]'; rule jsonb; changed boolean:=false; v_configuration jsonb; next_version integer;
begin
  actor:=private.require_operator_capability('platform.manage',true);
  if p_fees is null or jsonb_typeof(p_fees)<>'object' or p_fees='{}'::jsonb then
    raise invalid_parameter_value using message='shipping_region_fees_invalid'; end if;
  for label,fee in select key,value from jsonb_each(p_fees) loop
    if jsonb_typeof(fee)<>'number' or fee::text!~'^\d+$' or fee::text::numeric>1000000 then
      raise invalid_parameter_value using message='shipping_region_fees_invalid'; end if;
  end loop;
  select * into previous from private.shipping_region_policies where id=p_policy_id;
  if not found then raise no_data_found using message='shipping_region_policy_not_found'; end if;
  -- 상태 변경·주문 견적과 같은 순서(출고지 → 정책)로 잠근다.
  select * into origin from public.fulfillment_origins where id=previous.origin_id for update;
  select * into previous from private.shipping_region_policies where id=p_policy_id for update;
  if previous.revision is distinct from p_expected_revision then raise sqlstate 'PT409' using message='shipping_region_policy_changed'; end if;
  if previous.status<>'active' then raise check_violation using message='shipping_region_policy_not_active'; end if;
  if previous.ends_at is not null and previous.ends_at<=statement_timestamp() then
    raise check_violation using message='shipping_region_policy_expired'; end if;
  if not origin.is_active or origin.default_carrier is distinct from previous.carrier_code
    or not exists(select 1 from public.shipping_carriers where code=previous.carrier_code and is_active) then
    raise check_violation using message='shipping_region_carrier_mismatch'; end if;
  for label in select key from jsonb_object_keys(p_fees) key loop
    if not exists(select 1 from jsonb_array_elements(previous.configuration->'rules') existing
      where existing->>'disposition'='surcharge' and existing->>'regionLabel'=label) then
      raise invalid_parameter_value using message='shipping_region_fee_label_unknown'; end if;
  end loop;
  for rule in select value from jsonb_array_elements(previous.configuration->'rules') loop
    if rule->>'disposition'='surcharge' and p_fees ? (rule->>'regionLabel') then
      if (rule->>'amount') is distinct from (p_fees->>(rule->>'regionLabel')) then changed:=true; end if;
      rule:=rule||jsonb_build_object('amount',p_fees->(rule->>'regionLabel'));
    end if;
    rules:=rules||jsonb_build_array(rule||jsonb_build_object('id',null));
  end loop;
  if not changed then raise invalid_parameter_value using message='shipping_region_fees_unchanged'; end if;
  v_configuration:=private.normalize_shipping_region_policy(previous.configuration||jsonb_build_object('rules',rules));
  perform private.assert_shipping_region_policy_complete(v_configuration);
  select coalesce(max(version),0)+1 into next_version from private.shipping_region_policies
    where origin_id=previous.origin_id and carrier_code=previous.carrier_code;
  update private.shipping_region_policies set status='retired',revision=revision+1,updated_by=actor,updated_at=clock_timestamp()
    where id=previous.id;
  insert into private.shipping_region_policies(origin_id,carrier_code,version,status,configuration,starts_at,ends_at,
      confirmed_by,confirmed_at,updated_by)
    values(previous.origin_id,previous.carrier_code,next_version,'active',v_configuration,previous.starts_at,previous.ends_at,
      actor,clock_timestamp(),actor) returning * into saved;
  if exists(select 1 from private.shipping_region_policies policy where policy.origin_id=saved.origin_id
    and policy.carrier_code=saved.carrier_code and policy.status='active' and policy.id<>saved.id
    and tstzrange(policy.starts_at,policy.ends_at,'[)')&&tstzrange(saved.starts_at,saved.ends_at,'[)')) then
    raise check_violation using message='shipping_region_period_overlap'; end if;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipping_region.fees_changed','shipping-region:'||saved.id,
    jsonb_build_object('originId',saved.origin_id,'version',saved.version,'replacedPolicyId',previous.id,
      'replacedVersion',previous.version,'fees',p_fees,'before',private.shipping_region_policy_record(previous),
      'after',private.shipping_region_policy_record(saved)));
  return private.shipping_region_policy_record(saved);
end $$;
revoke all on function public.admin_change_shipping_region_fees(uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_change_shipping_region_fees(uuid,integer,jsonb) to authenticated;
select private.register_operator_rpc_contract('public.admin_change_shipping_region_fees(uuid,integer,jsonb)'::regprocedure,'platform.manage','write',true);
