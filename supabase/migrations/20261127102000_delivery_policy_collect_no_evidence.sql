-- 배송정보 관리의 '택배 외 수령 방식'과 '착불' 조건: 근거 칸 없이 켠다(2026-11-25 결정 — 저장 = 적용).
--
-- 두 저장은 '사용'으로 켜려면 고객에게 보이지 않는 근거 글까지 모두 채워야 했다.
--   - 택배 외 수령 방식(admin_save_delivery_policy): '운영 승인 근거'(approvalReference).
--     주문 기록에 넣을 때 빼는 값이고(terms-'approvalReference'), 이 값을 읽는 주문·발송 처리는 없다.
--   - 착불(admin_save_shipping_collect_contract): 계약 근거·출고 표기 근거·증빙 확인 방법·내부 분쟁 담당자
--     (contractReference·dispatchMappingReference·receiptReference·disputeContact). 저장과 관리자 조회 말고는 읽는 곳이 없다.
-- 화면에서 그 칸을 걷어 내므로 필수 검사만 없앤다. 누가 언제 켰는지는 감사 기록(audit_log)이 그대로 남긴다.
--
--   - 인자 시그니처는 그대로다. 근거를 보내는 옛 호출도 전과 같이 저장된다.
--   - 근거를 보내지 않은 저장은 저장돼 있던 근거를 그대로 둔다(없으면 수령 방식은 null, 착불은 빈 글).
--     착불 조건은 저장할 때 근거 네 칸을 채워 넣어, 저장되는 모양(여덟 칸)과 조회 응답은 전과 같다.
--   - 고객에게 보이고 주문에 기록되는 값은 전처럼 '사용'의 필수다.
--       수령 방식: 담당자 이름·연락처, 인계 장소·방법, 예약 안내, 받았는지 확인하는 방법, 취소 안내, 대리수령 여부.
--       착불: 수납 주체·수납 방법·환불 문의처·고객 안내 문구.
--   - private.valid_delivery_policy_terms는 테이블 check와 발송처리의 방식 변경(admin_select_shipment_delivery_method·
--     admin_dispatch_delivery_options·admin_dispatch_apply_delivery)도 함께 쓴다. 그 함수들의 본문은 바꾸지 않는다 —
--     근거 없이 켠 조건도 발송처리에서 고를 수 있어야 하므로 같은 검사를 따라간다.
--   - 나머지는 그대로다: 권한(platform.manage · 최고 관리자), 값 형식·길이, 켠 조건은 고칠 수 없음, 방식마다 사용 중인 조건 하나,
--     다른 사람이 먼저 바꿨을 때의 거절(PT409), 같은 작업 번호 재시도, 감사 기록. 배송비·착불 금액 계산은 건드리지 않는다.

create or replace function private.valid_delivery_policy_terms(p_terms jsonb,p_complete boolean) returns boolean
language plpgsql immutable set search_path='' as $$
declare field text; max_length integer;
begin
  if jsonb_typeof(p_terms) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_terms) key
    where key not in ('contactName','contactPhone','handoffLocation','handoffInstructions','appointmentInstructions',
      'allowDelegate','completionInstructions','cancellationInstructions','approvalReference')) then return false; end if;
  foreach field in array array['contactName','contactPhone','handoffLocation','handoffInstructions','appointmentInstructions',
    'completionInstructions','cancellationInstructions','approvalReference'] loop
    max_length:=case field when 'contactName' then 100 when 'contactPhone' then 40 else 2000 end;
    if not p_terms?field or jsonb_typeof(p_terms->field) not in ('string','null') then return false; end if;
    if jsonb_typeof(p_terms->field)='string' and (length(btrim(p_terms->>field)) not between 1 and max_length) then return false; end if;
    -- 승인 근거는 '사용'의 필수가 아니다. 있으면 형식만 본다.
    if p_complete and field<>'approvalReference' and jsonb_typeof(p_terms->field) is distinct from 'string' then return false; end if;
  end loop;
  return p_terms?'allowDelegate' and jsonb_typeof(p_terms->'allowDelegate') in ('boolean','null')
    and (not p_complete or jsonb_typeof(p_terms->'allowDelegate')='boolean');
end $$;

create or replace function public.admin_save_delivery_policy(p_origin_id uuid,p_method text,p_policy_id uuid,p_values jsonb,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); policy private.fulfillment_delivery_policies; values_object jsonb:='{}'; field text; state_value text;
  origin public.fulfillment_origins; instant timestamptz:=clock_timestamp();
begin
  perform private.require_operator_capability('platform.manage',true);

  if actor is null or not public.has_operator_capability('platform.manage',true) or not exists(select 1 from public.profiles where id=actor and private.has_operator_capability(id,'platform.manage',true)) then
    raise insufficient_privilege using message='admin_required'; end if;
  if p_method is null or p_method not in ('quick','pickup','direct','freight','none') or jsonb_typeof(p_values) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_values) key where key not in ('state','contactName','contactPhone','handoffLocation','handoffInstructions',
      'appointmentInstructions','allowDelegate','completionInstructions','cancellationInstructions','approvalReference')) then
    raise invalid_parameter_value using message='invalid_delivery_policy'; end if;
  state_value:=p_values->>'state';
  if state_value is null or state_value not in ('draft','active','stopped') then raise invalid_parameter_value using message='invalid_delivery_policy'; end if;
  select * into origin from public.fulfillment_origins where id=p_origin_id for update;
  if not found then raise no_data_found using message='fulfillment_origin_not_found'; end if;
  if p_policy_id is not null then
    select * into policy from private.fulfillment_delivery_policies where id=p_policy_id and origin_id=p_origin_id and method=p_method for update;
    if not found then raise no_data_found using message='delivery_policy_not_found'; end if;
    if p_expected_revision is null or policy.revision<>p_expected_revision then raise sqlstate 'PT409' using message='delivery_policy_changed'; end if;
  elsif p_expected_revision is not null or state_value='stopped' then raise invalid_parameter_value using message='invalid_delivery_policy'; end if;
  if state_value='stopped' then values_object:=policy.terms;
  else
    foreach field in array array['contactName','contactPhone','handoffLocation','handoffInstructions','appointmentInstructions',
      'completionInstructions','cancellationInstructions','approvalReference'] loop
      if p_values?field and jsonb_typeof(p_values->field) not in ('null','string') then raise invalid_parameter_value using message='invalid_delivery_policy'; end if;
      values_object:=values_object||jsonb_build_object(field,nullif(btrim(p_values->>field),''));
    end loop;
    -- 승인 근거를 보내지 않았으면 저장돼 있던 근거를 그대로 둔다(없으면 null).
    if values_object->>'approvalReference' is null then
      values_object:=values_object||jsonb_build_object('approvalReference',policy.terms->>'approvalReference'); end if;
    values_object:=values_object||jsonb_build_object('allowDelegate',coalesce(p_values->'allowDelegate','null'::jsonb));
    if not private.valid_delivery_policy_terms(values_object,state_value='active') then
      raise check_violation using message='delivery_policy_incomplete'; end if;
  end if;
  if state_value='active' and not origin.is_active then raise check_violation using message='delivery_policy_unavailable'; end if;
  if policy.activated_at is not null and (values_object is distinct from policy.terms or state_value not in ('active','stopped')
    or (policy.state='stopped' and state_value<>'stopped')) then raise check_violation using message='activated_delivery_policy_immutable'; end if;
  if state_value='active' and exists(select 1 from private.fulfillment_delivery_policies existing where existing.origin_id=p_origin_id
    and existing.method=p_method and existing.state='active' and existing.id is distinct from p_policy_id) then
    raise check_violation using message='delivery_policy_already_active'; end if;
  if p_policy_id is null then
    insert into private.fulfillment_delivery_policies(origin_id,method,state,terms,created_by,updated_by,activated_at)
    values(p_origin_id,p_method,state_value,values_object,actor,actor,case when state_value='active' then instant end) returning * into policy;
  else
    if policy.state=state_value and policy.terms=values_object then return jsonb_build_object('id',policy.id,'revision',policy.revision,'changed',false); end if;
    update private.fulfillment_delivery_policies set state=state_value,terms=values_object,revision=revision+1,updated_by=actor,updated_at=instant,
      activated_at=case when state_value='active' then coalesce(activated_at,instant) else activated_at end,
      stopped_at=case when state_value='stopped' then coalesce(stopped_at,instant) else stopped_at end where id=policy.id returning * into policy;
  end if;
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.fulfillment_delivery_policy.saved','origin:'||p_origin_id,
    jsonb_build_object('policyId',policy.id,'method',p_method,'state',state_value,'revision',policy.revision));
  return jsonb_build_object('id',policy.id,'revision',policy.revision,'changed',true);
end $$;

-- 착불 조건 값 검사. 테이블 check(shipping_collect_contract_values_valid)와 저장 함수가 함께 쓴다.
-- 고객에게 보이는 네 칸은 반드시 있어야 하고 '사용'이면 비어 있을 수 없다. 근거 네 칸은 없어도 되고, 있으면 형식만 본다.
create or replace function private.shipping_collect_contract_input_valid(p_values jsonb,p_status text) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(p_status in ('draft','active','disabled')
  and private.transaction_json_keys(case when jsonb_typeof(p_values)='object' then p_values-array['contractReference','dispatchMappingReference','receiptReference','disputeContact'] else p_values end,
   array['collectorName','collectionMethod','refundContact','customerInstructions'])
  and not exists(select 1 from jsonb_each(case when jsonb_typeof(p_values)='object' then p_values else '{}'::jsonb end) e
   where jsonb_typeof(e.value)<>'string' or (e.value#>>'{}')<>btrim(e.value#>>'{}') or (e.value#>>'{}')~'[[:cntrl:]]'
    or char_length(e.value#>>'{}')>case when e.key='customerInstructions' then 500 when e.key='collectorName' then 100 else 200 end
    or (p_status='active' and e.key in('collectorName','collectionMethod','refundContact','customerInstructions') and char_length(e.value#>>'{}')=0)),false);
$$;

create or replace function public.admin_save_shipping_collect_contract(p_origin_id uuid,p_expected_revision integer,p_status text,p_values jsonb,p_operation_id uuid,p_expected_actor_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();previous private.shipping_collect_contracts;request jsonb;receipt jsonb;version_id uuid;stored jsonb;begin
 if actor is null or actor is distinct from p_expected_actor_id then raise insufficient_privilege using message='auth_context_changed';end if;
 perform private.require_actor_operator_capability(actor,'platform.manage',true);
 if p_origin_id is null or p_expected_revision is null or p_expected_revision<0 or p_operation_id is null
  or not private.shipping_collect_contract_input_valid(p_values,p_status) then raise invalid_parameter_value using message='invalid_collect_contract';end if;
 request:=jsonb_build_object('originId',p_origin_id,'expectedRevision',p_expected_revision,'status',p_status,'values',p_values);
 perform pg_advisory_xact_lock(hashtextextended('shipping-collect-operation:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.shipping.collect_contract.saved',request);if receipt is not null then return receipt;end if;
 perform 1 from public.fulfillment_origins where id=p_origin_id and is_active for update;
 if not found then raise no_data_found using message='fulfillment_origin_not_found';end if;
 select * into previous from private.shipping_collect_contracts where origin_id=p_origin_id for update;
 if coalesce(previous.revision,0)<>p_expected_revision then raise sqlstate 'PT409' using message='collect_contract_changed';end if;
 -- 근거 네 칸을 보내지 않았으면 저장돼 있던 값을 그대로 둔다(없으면 빈 글). 보낸 칸은 보낸 값대로 저장한다.
 select v.contract_values into stored from private.shipping_collect_contract_versions v where v.id=previous.version_id;
 insert into private.shipping_collect_contract_versions(origin_id,revision,status,contract_values,created_by)
  values(p_origin_id,p_expected_revision+1,p_status,jsonb_build_object('contractReference',coalesce(stored->>'contractReference',''),
   'dispatchMappingReference',coalesce(stored->>'dispatchMappingReference',''),'receiptReference',coalesce(stored->>'receiptReference',''),
   'disputeContact',coalesce(stored->>'disputeContact',''))||p_values,actor) returning id into version_id;
 insert into private.shipping_collect_contracts(origin_id,revision,version_id) values(p_origin_id,p_expected_revision+1,version_id)
  on conflict(origin_id) do update set revision=excluded.revision,version_id=excluded.version_id;
 receipt:=private.shipping_collect_contract_document(p_origin_id)||jsonb_build_object('operationId',p_operation_id);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.shipping.collect_contract.saved','fulfillment_origins:'||p_origin_id,
  jsonb_build_object('request',request,'before',to_jsonb(previous),'result',receipt));return receipt;
end $$;

-- 같은 시그니처를 다시 정의해 실행 권한은 그대로지만, 봉인을 한 번 더 적어 둔다(저장 함수는 authenticated만, 검사 함수는 내부 전용).
revoke all on function public.admin_save_delivery_policy(uuid,text,uuid,jsonb,integer),
 public.admin_save_shipping_collect_contract(uuid,integer,text,jsonb,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_delivery_policy(uuid,text,uuid,jsonb,integer),
 public.admin_save_shipping_collect_contract(uuid,integer,text,jsonb,uuid,uuid) to authenticated;
revoke all on function private.valid_delivery_policy_terms(jsonb,boolean),private.shipping_collect_contract_input_valid(jsonb,text)
 from public,anon,authenticated,service_role;
grant execute on function private.valid_delivery_policy_terms(jsonb,boolean),private.shipping_collect_contract_input_valid(jsonb,text) to postgres;

-- 다시 정의한 함수의 본문 지문을 운영자 계약에 재등록한다(권한·구분은 전과 같다).
-- private.valid_delivery_policy_terms는 계약에 등록된 적이 없어 그대로 둔다.
select private.register_operator_rpc_contract('public.admin_save_delivery_policy(uuid,text,uuid,jsonb,integer)'::regprocedure,'platform.manage','write',true);
select private.register_operator_internal_contract('private.shipping_collect_contract_input_valid(jsonb,text)'::regprocedure);
select private.register_operator_rpc_contract('public.admin_save_shipping_collect_contract(uuid,integer,text,jsonb,uuid,uuid)'::regprocedure,'platform.manage','manual',true);
