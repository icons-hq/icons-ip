-- 지역별 추가배송비: 저장과 적용을 한 번에 한다(2026-11-26 결정 — 저장 = 적용, 근거 칸·확인 체크 없음).
--
-- 지금까지는 초안 저장(admin_save_shipping_region_policy) → '원본과 일치' 체크 → 활성화(admin_set_shipping_region_policy_status)
-- 세 단계였고, 적용 중인 설정과 기간이 겹치면 활성화가 거절돼 이전 설정을 먼저 중단해야 했다(그 사이 새 주문이 막힌다).
--
-- 1. private.assert_shipping_region_policy_complete: '물류사 회신·계약 근거'(sourceEvidence)를 더는 요구하지 않는다.
--    - 인자 시그니처와 나머지 조건(이름·적용 시작·끝 방식·표에 없는 지역·받는 단위·상품별 적용·지역표 줄 형식·겹침)은 그대로다.
--    - sourceEvidence 키는 계속 받는다(normalize_shipping_region_policy는 그대로). 이미 저장된 근거 값은 지우지 않는다.
--    - 이 검사는 묶음그룹 지역표(private.normalize_shipping_charge_group_values)와 금액 바꾸기
--      (admin_change_shipping_region_fees)도 함께 쓴다. 두 곳도 근거가 비어 있어도 통과한다.
-- 2. public.admin_apply_shipping_region_policy: 저장과 적용을 한 트랜잭션에서 한다.
--    - 새 설정(p_policy_id null)이나 아직 적용하지 않은 설정(초안)을 받은 값으로 저장하고 바로 활성으로 만든다.
--      검사는 두 단계 때와 같다: 권한(platform.manage), 값 형식, 필수 항목, 출고지 기본 택배사와 같은 사용 중 택배사,
--      이미 끝난 기간 거절, 다른 사람이 먼저 바꿨을 때의 거절(PT409).
--    - p_start_now=true면 적용 시작을 이 저장 시각으로 정한다(화면의 '저장하면 바로').
--    - 같은 출고지·택배사에서 기간이 겹치는 활성 설정은 p_replace_policy_ids로 받은 것만 함께 정리한다.
--      화면이 확인창에 보여 준 목록과 실제로 겹치는 목록이 다르면 아무것도 바꾸지 않고 PT409(shipping_region_replace_changed)로 거절한다.
--        · 새 설정이 지금(또는 과거)부터면 겹치는 설정을 같은 트랜잭션에서 중단한다 → 중단과 적용 사이에 주문이 막히는 틈이 없다.
--        · 새 설정이 나중에 시작하면, 그 전에 시작한 설정은 끝만 새 시작 시각으로 맞추고(그때까지 그대로 적용),
--          새 시작 뒤에 시작하려던 설정은 중단한다.
--    - 적용 근거를 보내지 않았으면(빈 값) 저장돼 있던 근거를 그대로 둔다.
--    - 감사 기록: admin.shipping_region.applied(바뀐 설정 전후와 함께 정리한 설정 목록), 정리한 설정마다
--      admin.shipping_region.retired 또는 admin.shipping_region.period_ended.
-- 추가배송비 계산(private.apply_shipping_region_quote)과 주문에 저장된 배송비는 건드리지 않는다.
-- 기존 두 함수(초안 저장·상태 변경)와 금액 바꾸기는 그대로 둔다. 화면은 초안 저장을 '적용하지 않고 저장'에, 상태 변경을 '끝내기'에 쓴다.

create or replace function private.assert_shipping_region_policy_complete(configuration jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare rule jsonb;
begin
  if private.shipping_region_text(configuration->>'name')=''
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

create function public.admin_apply_shipping_region_policy(p_policy_id uuid,p_values jsonb,p_expected_revision integer,
  p_replace_policy_ids uuid[],p_start_now boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; v_configuration jsonb; previous private.shipping_region_policies; saved private.shipping_region_policies;
  origin public.fulfillment_origins; replaced private.shipping_region_policies; changed private.shipping_region_policies;
  next_version integer; v_now timestamptz:=statement_timestamp(); v_starts timestamptz; v_ends timestamptz;
  v_overlap uuid[]; v_requested uuid[]; v_replaced jsonb:='[]'; v_mode text;
begin
  actor:=private.require_operator_capability('platform.manage',true);
  if p_start_now is null or p_values is null or jsonb_typeof(p_values)<>'object' then
    raise invalid_parameter_value using message='shipping_region_input_invalid'; end if;
  -- '저장하면 바로': 적용 시작을 이 저장 시각으로 정한다.
  if p_start_now then p_values:=p_values||jsonb_build_object('startsAt',v_now); end if;
  v_configuration:=private.normalize_shipping_region_policy(p_values);
  -- 초안 저장·상태 변경·금액 바꾸기·주문 견적과 같은 순서(출고지 → 정책)로 잠근다.
  select * into origin from public.fulfillment_origins where id=(v_configuration->>'originId')::uuid for update;
  if not found then raise no_data_found using message='fulfillment_origin_not_found'; end if;
  if not exists(select 1 from public.shipping_carriers where code=v_configuration->>'carrierCode') then
    raise check_violation using message='shipping_region_carrier_invalid'; end if;
  if p_policy_id is null then
    if p_expected_revision is not null then raise sqlstate 'PT409' using message='shipping_region_policy_changed'; end if;
  else
    select * into previous from private.shipping_region_policies where id=p_policy_id for update;
    if not found then raise no_data_found using message='shipping_region_policy_not_found'; end if;
    if previous.origin_id<>origin.id or previous.carrier_code<>v_configuration->>'carrierCode' then
      raise check_violation using message='shipping_region_identity_immutable'; end if;
    if previous.status<>'draft' then raise check_violation using message='shipping_region_policy_immutable'; end if;
    if previous.revision is distinct from p_expected_revision then raise sqlstate 'PT409' using message='shipping_region_policy_changed'; end if;
    -- 근거를 보내지 않았으면 저장돼 있던 근거를 그대로 둔다.
    if v_configuration->>'sourceEvidence'='' then
      v_configuration:=v_configuration||jsonb_build_object('sourceEvidence',coalesce(previous.configuration->>'sourceEvidence',''));
    end if;
  end if;
  perform private.assert_shipping_region_policy_complete(v_configuration);
  if not origin.is_active or origin.default_carrier is distinct from v_configuration->>'carrierCode'
    or not exists(select 1 from public.shipping_carriers where code=v_configuration->>'carrierCode' and is_active) then
    raise check_violation using message='shipping_region_carrier_mismatch'; end if;
  v_starts:=(v_configuration->>'startsAt')::timestamptz; v_ends:=(v_configuration->>'endsAt')::timestamptz;
  if v_ends is not null and v_ends<=v_now then raise check_violation using message='shipping_region_policy_expired'; end if;

  -- 기간이 겹치는 활성 설정. 화면이 확인창에 보여 준 목록과 같을 때만 함께 정리한다.
  select coalesce(array_agg(policy.id order by policy.id),'{}') into v_overlap from private.shipping_region_policies policy
    where policy.origin_id=origin.id and policy.carrier_code=v_configuration->>'carrierCode' and policy.status='active'
      and policy.id is distinct from p_policy_id
      and tstzrange(policy.starts_at,policy.ends_at,'[)')&&tstzrange(v_starts,v_ends,'[)');
  select coalesce(array_agg(distinct requested.policy_id order by requested.policy_id),'{}') into v_requested
    from unnest(coalesce(p_replace_policy_ids,'{}'::uuid[])) requested(policy_id);
  if v_overlap is distinct from v_requested then
    raise sqlstate 'PT409' using message='shipping_region_replace_changed'; end if;
  for replaced in select * from private.shipping_region_policies policy where policy.id=any(v_overlap)
    order by policy.starts_at,policy.id for update loop
    if v_starts>v_now and replaced.starts_at<v_starts then
      -- 새 설정이 시작할 때까지는 이전 설정을 그대로 쓴다. 끝만 새 시작 시각으로 맞춘다.
      update private.shipping_region_policies set ends_at=v_starts,
        configuration=configuration||jsonb_build_object('endsAt',v_starts,'openEnded',false),
        revision=revision+1,updated_by=actor,updated_at=clock_timestamp() where id=replaced.id returning * into changed;
      v_mode:='period_ended';
    else
      update private.shipping_region_policies set status='retired',revision=revision+1,updated_by=actor,updated_at=clock_timestamp()
        where id=replaced.id returning * into changed;
      v_mode:='retired';
    end if;
    v_replaced:=v_replaced||jsonb_build_array(jsonb_build_object('mode',v_mode,
      'before',private.shipping_region_policy_record(replaced),'after',private.shipping_region_policy_record(changed)));
  end loop;

  if p_policy_id is null then
    select coalesce(max(version),0)+1 into next_version from private.shipping_region_policies
      where origin_id=origin.id and carrier_code=v_configuration->>'carrierCode';
    insert into private.shipping_region_policies(origin_id,carrier_code,version,status,configuration,starts_at,ends_at,
        confirmed_by,confirmed_at,updated_by)
      values(origin.id,v_configuration->>'carrierCode',next_version,'active',v_configuration,v_starts,v_ends,
        actor,clock_timestamp(),actor) returning * into saved;
  else
    update private.shipping_region_policies set configuration=v_configuration,starts_at=v_starts,ends_at=v_ends,status='active',
      confirmed_by=actor,confirmed_at=clock_timestamp(),revision=revision+1,updated_by=actor,updated_at=clock_timestamp()
      where id=previous.id returning * into saved;
  end if;
  if exists(select 1 from private.shipping_region_policies policy where policy.origin_id=saved.origin_id
    and policy.carrier_code=saved.carrier_code and policy.status='active' and policy.id<>saved.id
    and tstzrange(policy.starts_at,policy.ends_at,'[)')&&tstzrange(saved.starts_at,saved.ends_at,'[)')) then
    raise check_violation using message='shipping_region_period_overlap'; end if;
  insert into private.shipping_region_adoptions(origin_id,managed_from) values(saved.origin_id,saved.starts_at)
    on conflict(origin_id) do update set managed_from=least(private.shipping_region_adoptions.managed_from,excluded.managed_from);

  insert into public.audit_log(actor_id,action,target,diff)
    select actor,'admin.shipping_region.'||(entry->>'mode'),'shipping-region:'||(entry#>>'{after,id}'),
      jsonb_build_object('originId',saved.origin_id,'version',(entry#>>'{after,version}')::integer,'replacedByPolicyId',saved.id,
        'before',entry->'before','after',entry->'after')
    from jsonb_array_elements(v_replaced) entry;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipping_region.applied','shipping-region:'||saved.id,
    jsonb_build_object('originId',saved.origin_id,'version',saved.version,'revision',saved.revision,'startNow',p_start_now,
      'before',case when previous.id is not null then private.shipping_region_policy_record(previous) end,
      'after',private.shipping_region_policy_record(saved),'replaced',v_replaced));
  return jsonb_build_object('policy',private.shipping_region_policy_record(saved),
    'replaced',(select coalesce(jsonb_agg(entry->'after'),'[]') from jsonb_array_elements(v_replaced) entry));
end $$;
revoke all on function public.admin_apply_shipping_region_policy(uuid,jsonb,integer,uuid[],boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_apply_shipping_region_policy(uuid,jsonb,integer,uuid[],boolean) to authenticated;
select private.register_operator_rpc_contract('public.admin_apply_shipping_region_policy(uuid,jsonb,integer,uuid[],boolean)'::regprocedure,'platform.manage','write',true);
