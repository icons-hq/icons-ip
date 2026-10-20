begin;
-- Extend encrypted claim plans without rewriting prior receipts or PII.
-- Location checks are transient trusted-server inputs; only encrypted plans/history persist.
create function private.assert_claim_destination_same_price(p_order uuid,p_before jsonb,p_after jsonb) returns void
language plpgsql stable security definer set search_path='' as $$
declare before_value jsonb:=private.shipping_region_destination(p_before);after_value jsonb:=private.shipping_region_destination(p_after);
 shipment public.order_shipments;raw jsonb;policies jsonb;policy jsonb;group_value jsonb;old_match jsonb;new_match jsonb;counted integer:=0;
begin
 if before_value is null or after_value is null then raise sqlstate 'PT409' using message='claim_contact_address_price_unknown';end if;
 if before_value=after_value then return;end if;
 for shipment in select * from public.order_shipments where order_id=p_order order by id loop
  counted:=counted+1;raw:=shipment.shipping_fee_snapshot;policies:='[]';
  if shipment.delivery_method<>'parcel' then raise sqlstate 'PT409' using message='claim_contact_address_price_unknown';end if;
  if jsonb_typeof(raw->'chargeGroupContract')='object' then
   if jsonb_typeof(raw#>'{chargeGroupContract,originRegionPolicy,configuration}')='object' then
    policies:=policies||jsonb_build_array(raw#>'{chargeGroupContract,originRegionPolicy,configuration}');
   elsif raw#>>'{chargeGroupContract,originRegionResult,regionMode}'='legacy_base_only' then
    raise sqlstate 'PT409' using message='claim_contact_address_price_unknown';
   end if;
   for group_value in select value from jsonb_array_elements(raw#>'{chargeGroupContract,groups}') loop
    if group_value->>'regionMode'='override' then
     policies:=policies||jsonb_build_array(group_value#>'{versionSnapshot,policy_values,regional,policy}');
    elsif group_value->>'regionMode' is distinct from 'inherit' then raise sqlstate 'PT409' using message='claim_contact_address_price_unknown';end if;
   end loop;
  elsif raw->>'regionMode'='managed' and raw->>'policyId' is not null then
   select configuration into policy from private.shipping_region_policies where id=(raw->>'policyId')::uuid and version=(raw->>'policyVersion')::integer;
   if found then policies:=jsonb_build_array(policy);end if;
  end if;
  if jsonb_array_length(policies)=0 then raise sqlstate 'PT409' using message='claim_contact_address_price_unknown';end if;
  for policy in select value from jsonb_array_elements(policies) loop
   if jsonb_typeof(policy->'rules') is distinct from 'array' then raise sqlstate 'PT409' using message='claim_contact_address_price_unknown';end if;
   old_match:=private.shipping_charge_group_region_match(policy,before_value);new_match:=private.shipping_charge_group_region_match(policy,after_value);
   if old_match->>'fee' is null or new_match->>'fee' is null then raise sqlstate 'PT409' using message='claim_contact_address_price_unknown';end if;
   -- Compare each tariff independently: a fee increase at one origin cannot be hidden by a decrease at another.
   if old_match->'fee' is distinct from new_match->'fee' then raise sqlstate 'PT409' using message='claim_contact_address_price_changed';end if;
  end loop;
 end loop;
 if counted=0 then raise sqlstate 'PT409' using message='claim_contact_address_price_unknown';end if;
end $$;
revoke all on function private.assert_claim_destination_same_price(uuid,jsonb,jsonb) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.service_change_order_claim_contact(p_order_id uuid, p_claim_id uuid, p_actor_id uuid, p_session_id uuid, p_operation_id uuid, p_target text, p_expected_claim_type text, p_expected_claim_revision integer, p_expected_context jsonb, p_sealed_change jsonb, p_request_hmac text, p_hmac_key_version text, p_confirmed boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare parties uuid[]:=private.contact_parties(p_order_id);op private.order_claim_contact_operations;c public.order_cancellation_requests;view jsonb;plan jsonb;hist jsonb;fields text[];result_revision integer;old_plan private.order_claim_contact_plans;begin
 perform private.contact_operation_input(p_operation_id,'change',p_target,p_expected_claim_type,p_expected_claim_revision);
 perform private.contact_require_identity(p_actor_id,p_session_id,'sales.manage',false,parties,false);
 perform pg_advisory_xact_lock(hashtextextended('claim-contact-operation:'||p_operation_id,0));
 c:=private.contact_lock_scope(p_order_id,p_claim_id,parties);
 select id,actor_id,session_id,order_id,claim_id,command,target,expected_claim_type,expected_claim_revision,result_claim_revision,
 state,changed_fields,request_hmac,hmac_key_version,null::jsonb,created_at,purged_at into op
 from private.order_claim_contact_operations where id=p_operation_id;
 if found then
  perform private.contact_operation_scope(op,p_order_id,p_claim_id,p_actor_id,p_session_id,'change',p_target,p_expected_claim_type,p_expected_claim_revision);
  if op.state='sealed' then raise sqlstate 'PT409' using message='claim_contact_operation_sealed';end if;
  if op.purged_at is not null then raise sqlstate 'PT410' using message='claim_contact_purged';end if;
  if op.request_hmac is distinct from p_request_hmac or op.hmac_key_version is distinct from p_hmac_key_version then raise unique_violation using message='claim_contact_operation_conflict';end if;
  return private.contact_operation_receipt(op);
 end if;
 if exists(select 1 from private.account_action_fences where subject_user_id=any(parties)) then raise sqlstate 'PT409' using message='claim_contact_blocked';end if;
 if p_confirmed is distinct from true or not private.contact_digest(to_jsonb(p_request_hmac)) or not private.contact_key_version(to_jsonb(p_hmac_key_version))
 or not private.contact_keys(p_sealed_change- 'destinationCheck',array['effect','changedFields','beforeAddressHmac','afterAddressHmac','addressHmacKeyVersion','plan','history'])
 or not private.contact_digest(p_sealed_change->'beforeAddressHmac') or not private.contact_digest(p_sealed_change->'afterAddressHmac')
 or not private.contact_key_version(p_sealed_change->'addressHmacKeyVersion') or jsonb_typeof(p_sealed_change->'changedFields') is distinct from 'array'
 or jsonb_typeof(p_sealed_change->'effect') is distinct from 'string' or p_sealed_change->>'effect' not in('change','noop') then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
 fields:=array(select jsonb_array_elements_text(p_sealed_change->'changedFields'));
 if cardinality(fields)>5 or fields is distinct from array(select f from unnest(array['recipientName','phone','address2','postalCode','address1']) f where f=any(fields)) then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
 view:=private.contact_assert_context(c,p_target,'change',p_expected_claim_type,p_expected_claim_revision,p_expected_context);
 if fields && array['postalCode','address1'] then
  if not private.contact_keys(p_sealed_change->'destinationCheck',array['before','after']) then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
  perform private.assert_claim_destination_same_price(p_order_id,p_sealed_change#>'{destinationCheck,before}',p_sealed_change#>'{destinationCheck,after}');
 elsif p_sealed_change ? 'destinationCheck' then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;

 if p_sealed_change->>'effect'='noop' then
  if fields<>'{}' or p_sealed_change->'plan' is distinct from 'null'::jsonb or p_sealed_change->'history' is distinct from 'null'::jsonb or p_sealed_change->'beforeAddressHmac' is distinct from p_sealed_change->'afterAddressHmac' then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
  result_revision:=c.claim_revision;
 else
  plan:=p_sealed_change->'plan';hist:=p_sealed_change->'history';
  if cardinality(fields)=0 or not private.contact_plan_envelope(plan) or not private.contact_history_envelope(hist)
   or plan->'addressHmac' is distinct from p_sealed_change->'afterAddressHmac' or plan->'addressHmacKeyVersion' is distinct from p_sealed_change->'addressHmacKeyVersion'
   or plan->'keyVersion' is distinct from hist->'keyVersion'
   or p_sealed_change->'beforeAddressHmac'=p_sealed_change->'afterAddressHmac' then raise invalid_parameter_value using message='invalid_claim_contact_request';end if;
  select * into old_plan from private.order_claim_contact_plans where claim_id=p_claim_id and target=p_target;
  if (old_plan.id is not null and(old_plan.id is distinct from(plan->>'planId')::uuid or old_plan.pii_version=(plan->>'piiVersion')::uuid))
   or exists(select 1 from private.order_claim_contact_operations where claim_id=p_claim_id and target=p_target and history->>'piiVersion'=plan->>'piiVersion') then raise sqlstate 'PT409' using message='claim_contact_changed';end if;
  insert into private.order_claim_contact_plans(id,order_id,claim_id,target,revision,pii_version,sealed_plan,source_kind,source_id,source_revision,last_operation_id)
  values((plan->>'planId')::uuid,p_order_id,p_claim_id,p_target,1,(plan->>'piiVersion')::uuid,plan,coalesce(old_plan.source_kind,view#>>'{source,sourceKind}'),coalesce(old_plan.source_id,(view#>>'{source,sourceId}')::uuid),case when old_plan.id is not null then old_plan.source_revision else view#>>'{source,sourceRevision}' end,p_operation_id)
  on conflict(claim_id,target) do update set revision=private.order_claim_contact_plans.revision+1,pii_version=excluded.pii_version,sealed_plan=excluded.sealed_plan,last_operation_id=p_operation_id,updated_at=clock_timestamp();
  update public.order_cancellation_requests set updated_at=clock_timestamp() where id=p_claim_id returning claim_revision into result_revision;
  insert into public.audit_log(actor_id,action,target,diff) values(p_actor_id,'admin.order.claim_contact_changed','order:'||p_order_id,
   jsonb_build_object('claimId',p_claim_id,'operationId',p_operation_id,'target',p_target,'changedFields',to_jsonb(fields),'claimRevision',result_revision));
  perform private.notify_order_claim(p_claim_id,'claim_updated','클레임 연락처가 변경됐어요','고객과 확인한 연락처 정보로 변경했습니다.');
 end if;
 insert into private.order_claim_contact_operations(id,actor_id,session_id,order_id,claim_id,command,target,expected_claim_type,expected_claim_revision,result_claim_revision,state,changed_fields,request_hmac,hmac_key_version,history)
 values(p_operation_id,p_actor_id,p_session_id,p_order_id,p_claim_id,'change',p_target,p_expected_claim_type,p_expected_claim_revision,result_revision,
 case when p_sealed_change->>'effect'='noop' then 'noop' else 'saved' end,fields,p_request_hmac,p_hmac_key_version,hist) returning * into op;
 return private.contact_operation_receipt(op);
end $function$;


commit;
