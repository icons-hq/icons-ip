\set ON_ERROR_STOP on
-- 지역별 추가배송비를 한 번에 저장·적용하는 admin_apply_shipping_region_policy 검증.
-- 우편번호·금액·주소·근거는 모두 합성 값이다. 준비물은 모두 rollback된다(상품·주문을 만들지 않아 KC 도우미가 필요 없다).
-- 본다: 권한·실행 권한 봉인·운영자 계약, 근거 없이 적용, 반쪽 저장이 남지 않음, 겹치는 설정을 확인한 목록대로만 정리
-- (지금 시작 = 중단, 나중 시작 = 끝만 맞춤, 뒤에 시작하려던 설정 = 중단), 주문 견적이 끊기지 않음, 저장된 근거 유지, 감사 기록.
begin;
create function pg_temp.single_save_expect_error(statement text,expected_message text,expected_code text default null)
returns void language plpgsql as $$ begin
  begin execute statement;
  exception when others then
    if position(expected_message in sqlerrm)=0 or (expected_code is not null and sqlstate<>expected_code) then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %',expected_message;
end $$;
-- 주문 견적(private.apply_shipping_region_quote)을 출고지 하나·'출고지 정책 따름' 상품 하나로 부른다. 기본 배송비는 3,000원으로 둔다.
create function pg_temp.single_save_quote(origin uuid,at timestamptz) returns jsonb language sql as $$
  select private.apply_shipping_region_quote(
    jsonb_build_object('groups',jsonb_build_array(jsonb_build_object('originId',origin,'totalFee',3000,'freeThreshold',null,'policySubtotal',10000)),'totalFee',3000),
    jsonb_build_array(jsonb_build_object('origin_id',origin,'good_id','single-save-good','fee_type','policy')),
    '{"postalCode":"10000","address1":"합성시 검증구 검증로 1"}'::jsonb,at);
$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000104001','authenticated','authenticated','single-save-admin@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000104002','authenticated','authenticated','single-save-staff@example.test',now(),'{}','{}',now(),now());
update public.profiles set role=case id when '00000000-0000-4000-8000-000000104001' then 'admin'::public.user_role else 'staff'::public.user_role end
  where id in ('00000000-0000-4000-8000-000000104001','00000000-0000-4000-8000-000000104002');
-- 통합 주매니저는 platform.manage가 있고, 부매니저는 없다.
insert into private.operator_memberships(profile_id,manager_role) values
 ('00000000-0000-4000-8000-000000104001','primary'),('00000000-0000-4000-8000-000000104002','deputy');
update private.operator_access_state set configured=true where id;
insert into public.shipping_carriers(code,label,tracking_url_template,is_active) values
 ('single_save_a','TEST-ONLY 합성 택배사 A','https://example.test/{trackingNumber}',true),
 ('single_save_b','TEST-ONLY 합성 택배사 B','https://example.test/{trackingNumber}',true);
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active) values
 ('00000000-0000-4000-8000-000000104010','single-save-a','합성 출고지 A','single_save_a',3000,null,'배송 금지 합성 주소 A',true),
 ('00000000-0000-4000-8000-000000104011','single-save-b','합성 출고지 B','single_save_a',3000,null,'배송 금지 합성 주소 B',true),
 ('00000000-0000-4000-8000-000000104012','single-save-c','합성 출고지 C','single_save_a',3000,null,'배송 금지 합성 주소 C',true);

select 1/case when has_function_privilege('authenticated','public.admin_apply_shipping_region_policy(uuid,jsonb,integer,uuid[],boolean)','execute')
  and not has_function_privilege('anon','public.admin_apply_shipping_region_policy(uuid,jsonb,integer,uuid[],boolean)','execute')
  and not has_function_privilege('service_role','public.admin_apply_shipping_region_policy(uuid,jsonb,integer,uuid[],boolean)','execute')
  and exists(select 1 from private.operator_rpc_contracts where signature='public.admin_apply_shipping_region_policy(uuid,jsonb,integer,uuid[],boolean)'
    and capability='platform.manage' and guard_kind='write' and legacy_admin_only)
  then 1 else 0 end as apply_is_sealed_and_registered_as_an_admin_write;

-- 근거(sourceEvidence)는 빈 값이다. 금액만 바꿔 가며 쓴다.
select jsonb_build_object('originId','00000000-0000-4000-8000-000000104010','carrierCode','single_save_a','name','TEST-ONLY 한 번에 적용',
  'startsAt',null,'endsAt',null,'openEnded',true,'sourceEvidence','','unlistedDisposition','standard','feeUnit','per_shipment',
  'chargePolicyGoods',true,'waivePolicyThreshold',false,'chargeFreeGoods',true,'chargeIndividualGoods',true,'noRulesConfirmed',false,
  'rules',jsonb_build_array(jsonb_build_object('id',null,'postalFrom','10000','postalTo','10010','addressPrefix','',
    'regionLabel','합성 추가배송비 구간','disposition','surcharge','amount',2500))) as single_config \gset

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000104002',true);
select pg_temp.single_save_expect_error(format('select public.admin_apply_shipping_region_policy(null,%L::jsonb,null,null,true)',:'single_config'),'','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000104001',true);
-- 권한 확인 다음에 입력을 본다. 빈 인자는 형식 오류다.
select pg_temp.single_save_expect_error('select public.admin_apply_shipping_region_policy(null,null,null,null,null)','shipping_region_input_invalid','22023');
-- 필수 항목이 비면 거절하고, 저장도 남기지 않는다(반쪽 저장 없음).
select pg_temp.single_save_expect_error(format('select public.admin_apply_shipping_region_policy(null,%L::jsonb,null,null,true)',
  :'single_config'::jsonb||'{"name":""}'::jsonb),'shipping_region_policy_incomplete','23514');
select pg_temp.single_save_expect_error(format('select public.admin_apply_shipping_region_policy(null,%L::jsonb,null,null,true)',
  :'single_config'::jsonb||'{"feeUnit":null}'::jsonb),'shipping_region_policy_incomplete','23514');
select pg_temp.single_save_expect_error(format('select public.admin_apply_shipping_region_policy(null,%L::jsonb,null,null,false)',:'single_config'),
  'shipping_region_policy_incomplete','23514');
select pg_temp.single_save_expect_error(format('select public.admin_apply_shipping_region_policy(null,%L::jsonb,1,null,true)',:'single_config'),
  'shipping_region_policy_changed','PT409');
-- 이미 끝난 기간과 출고지의 기본 택배사가 아닌 택배사는 적용하지 않는다.
select pg_temp.single_save_expect_error(format('select public.admin_apply_shipping_region_policy(null,%L::jsonb,null,null,false)',
  :'single_config'::jsonb||jsonb_build_object('startsAt',now()-interval '2 days','endsAt',now()-interval '1 day','openEnded',false)),
  'shipping_region_policy_expired','23514');
select pg_temp.single_save_expect_error(format('select public.admin_apply_shipping_region_policy(null,%L::jsonb,null,null,true)',
  :'single_config'::jsonb||jsonb_build_object('endsAt',now()-interval '1 day','openEnded',false)),'shipping_region_period_invalid','22023');
select pg_temp.single_save_expect_error(format('select public.admin_apply_shipping_region_policy(null,%L::jsonb,null,null,true)',
  :'single_config'::jsonb||'{"carrierCode":"single_save_b"}'::jsonb),'shipping_region_carrier_mismatch','23514');
reset role;
select 1/case when not exists(select 1 from private.shipping_region_policies where origin_id='00000000-0000-4000-8000-000000104010')
  and not exists(select 1 from private.shipping_region_adoptions where origin_id='00000000-0000-4000-8000-000000104010')
  and pg_temp.single_save_quote('00000000-0000-4000-8000-000000104010',clock_timestamp())#>>'{groups,0,regionMode}'='legacy_base_only'
  then 1 else 0 end as rejected_apply_leaves_nothing_behind;

-- 1) 처음 적용: 근거 없이, 저장하는 시각부터.
set local role authenticated;
select public.admin_apply_shipping_region_policy(null,:'single_config'::jsonb,null,null,true) as single_first \gset
reset role;
select 1/case when :'single_first'::jsonb#>>'{policy,status}'='active' and :'single_first'::jsonb#>>'{policy,version}'='1'
  and :'single_first'::jsonb#>>'{policy,revision}'='1' and :'single_first'::jsonb#>>'{policy,sourceEvidence}'=''
  and :'single_first'::jsonb#>>'{policy,confirmedAt}' is not null and :'single_first'::jsonb->'replaced'='[]'::jsonb
  and (select starts_at=(:'single_first'::jsonb#>>'{policy,startsAt}')::timestamptz and starts_at between now() and clock_timestamp()
    and ends_at is null and confirmed_by='00000000-0000-4000-8000-000000104001'
    from private.shipping_region_policies where id=(:'single_first'::jsonb#>>'{policy,id}')::uuid)
  and (select managed_from=(:'single_first'::jsonb#>>'{policy,startsAt}')::timestamptz from private.shipping_region_adoptions
    where origin_id='00000000-0000-4000-8000-000000104010')
  and pg_temp.single_save_quote('00000000-0000-4000-8000-000000104010',clock_timestamp())->>'finalTotalFee'='5500'
  then 1 else 0 end as first_apply_saves_and_activates_in_one_call_without_evidence;

-- 2) 지금부터 바꾸기: 겹치는 설정을 확인한 목록으로 보내야 하고, 보낸 목록이 실제와 다르면 아무것도 바꾸지 않는다.
set local role authenticated;
select pg_temp.single_save_expect_error(format('select public.admin_apply_shipping_region_policy(null,%L::jsonb,null,null,true)',
  jsonb_set(:'single_config'::jsonb,'{rules,0,amount}','4000')),'shipping_region_replace_changed','PT409');
select pg_temp.single_save_expect_error(format('select public.admin_apply_shipping_region_policy(null,%L::jsonb,null,%L::uuid[],true)',
  jsonb_set(:'single_config'::jsonb,'{rules,0,amount}','4000'),
  array[(:'single_first'::jsonb#>>'{policy,id}')::uuid,'00000000-0000-4000-8000-0000001040ff'::uuid]),'shipping_region_replace_changed','PT409');
reset role;
select 1/case when (select count(*)=1 and bool_and(status='active' and revision=1) from private.shipping_region_policies
  where origin_id='00000000-0000-4000-8000-000000104010') then 1 else 0 end as mismatched_replace_list_changes_nothing;
set local role authenticated;
select public.admin_apply_shipping_region_policy(null,jsonb_set(:'single_config'::jsonb,'{rules,0,amount}','4000'),null,
  array[(:'single_first'::jsonb#>>'{policy,id}')::uuid],true) as single_second \gset
reset role;
select 1/case when :'single_second'::jsonb#>>'{policy,status}'='active' and :'single_second'::jsonb#>>'{policy,version}'='2'
  and jsonb_array_length(:'single_second'::jsonb->'replaced')=1
  and :'single_second'::jsonb#>>'{replaced,0,id}'=:'single_first'::jsonb#>>'{policy,id}'
  and :'single_second'::jsonb#>>'{replaced,0,status}'='retired' and :'single_second'::jsonb#>>'{replaced,0,revision}'='2'
  and (select count(*)=1 from private.shipping_region_policies where origin_id='00000000-0000-4000-8000-000000104010' and status='active')
  and pg_temp.single_save_quote('00000000-0000-4000-8000-000000104010',clock_timestamp())->>'finalTotalFee'='7000'
  and pg_temp.single_save_quote('00000000-0000-4000-8000-000000104010',clock_timestamp())->>'checkoutAllowed'='true'
  then 1 else 0 end as replacing_now_retires_the_old_one_without_a_gap;

-- 3) 나중에 시작: 지금 설정은 새 시작 시각까지 그대로 쓰고 끝만 맞춘다.
set local role authenticated;
select public.admin_apply_shipping_region_policy(null,jsonb_set(:'single_config'::jsonb,'{rules,0,amount}','6000')
  ||jsonb_build_object('startsAt',now()+interval '1 day'),null,
  array[(:'single_second'::jsonb#>>'{policy,id}')::uuid],false) as single_third \gset
reset role;
select 1/case when :'single_third'::jsonb#>>'{policy,status}'='active' and :'single_third'::jsonb#>>'{policy,version}'='3'
  and :'single_third'::jsonb#>>'{replaced,0,status}'='active' and :'single_third'::jsonb#>>'{replaced,0,openEnded}'='false'
  and (:'single_third'::jsonb#>>'{replaced,0,endsAt}')::timestamptz=now()+interval '1 day'
  and :'single_third'::jsonb#>>'{replaced,0,revision}'='2'
  and (select status='active' and ends_at=now()+interval '1 day' from private.shipping_region_policies
    where id=(:'single_second'::jsonb#>>'{policy,id}')::uuid)
  and pg_temp.single_save_quote('00000000-0000-4000-8000-000000104010',clock_timestamp())->>'finalTotalFee'='7000'
  and pg_temp.single_save_quote('00000000-0000-4000-8000-000000104010',now()+interval '1 day'-interval '1 microsecond')->>'finalTotalFee'='7000'
  and pg_temp.single_save_quote('00000000-0000-4000-8000-000000104010',now()+interval '1 day')->>'finalTotalFee'='9000'
  and (select managed_from<now()+interval '1 day' from private.shipping_region_adoptions where origin_id='00000000-0000-4000-8000-000000104010')
  then 1 else 0 end as future_start_keeps_the_current_one_until_the_new_start;

-- 4) 그 사이에 시작하는 설정: 먼저 시작한 설정은 끝을 당기고, 뒤에 시작하려던 설정은 중단한다.
set local role authenticated;
select pg_temp.single_save_expect_error(format('select public.admin_apply_shipping_region_policy(null,%L::jsonb,null,%L::uuid[],false)',
  jsonb_set(:'single_config'::jsonb,'{rules,0,amount}','1000')||jsonb_build_object('startsAt',now()+interval '12 hours'),
  array[(:'single_second'::jsonb#>>'{policy,id}')::uuid]),'shipping_region_replace_changed','PT409');
select public.admin_apply_shipping_region_policy(null,jsonb_set(:'single_config'::jsonb,'{rules,0,amount}','1000')
  ||jsonb_build_object('startsAt',now()+interval '12 hours'),null,
  array[(:'single_second'::jsonb#>>'{policy,id}')::uuid,(:'single_third'::jsonb#>>'{policy,id}')::uuid],false) as single_fourth \gset
reset role;
select 1/case when jsonb_array_length(:'single_fourth'::jsonb->'replaced')=2
  and (select status='active' and ends_at=now()+interval '12 hours' and revision=3 from private.shipping_region_policies
    where id=(:'single_second'::jsonb#>>'{policy,id}')::uuid)
  and (select status='retired' and revision=2 from private.shipping_region_policies where id=(:'single_third'::jsonb#>>'{policy,id}')::uuid)
  and pg_temp.single_save_quote('00000000-0000-4000-8000-000000104010',clock_timestamp())->>'finalTotalFee'='7000'
  and pg_temp.single_save_quote('00000000-0000-4000-8000-000000104010',now()+interval '12 hours')->>'finalTotalFee'='4000'
  and pg_temp.single_save_quote('00000000-0000-4000-8000-000000104010',now()+interval '2 days')->>'finalTotalFee'='4000'
  and not exists(select 1 from private.shipping_region_policies a join private.shipping_region_policies b
    on a.origin_id=b.origin_id and a.carrier_code=b.carrier_code and a.id<b.id and a.status='active' and b.status='active'
    and tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange(b.starts_at,b.ends_at,'[)'))
  then 1 else 0 end as scheduled_successor_is_retired_and_no_active_periods_overlap;
select 1/case when exists(select 1 from public.audit_log where action='admin.shipping_region.applied'
    and target='shipping-region:'||(:'single_fourth'::jsonb#>>'{policy,id}') and actor_id='00000000-0000-4000-8000-000000104001'
    and jsonb_array_length(diff->'replaced')=2 and diff#>>'{after,status}'='active' and diff->'before'='null'::jsonb)
  and exists(select 1 from public.audit_log where action='admin.shipping_region.period_ended'
    and target='shipping-region:'||(:'single_second'::jsonb#>>'{policy,id}') and diff->>'replacedByPolicyId'=:'single_fourth'::jsonb#>>'{policy,id}'
    and diff#>>'{before,endsAt}' is distinct from diff#>>'{after,endsAt}')
  and exists(select 1 from public.audit_log where action='admin.shipping_region.retired'
    and target='shipping-region:'||(:'single_third'::jsonb#>>'{policy,id}') and diff->>'replacedByPolicyId'=:'single_fourth'::jsonb#>>'{policy,id}')
  then 1 else 0 end as apply_and_each_replaced_policy_are_audited;

-- 5) 적용하지 않고 저장해 둔 설정을 적용한다. 근거를 보내지 않아도 저장돼 있던 근거는 남는다.
set local role authenticated;
select public.admin_save_shipping_region_policy(null,:'single_config'::jsonb||jsonb_build_object('originId','00000000-0000-4000-8000-000000104011',
  'sourceEvidence','TEST-ONLY:kept-evidence','name',''),null) as single_draft \gset
select pg_temp.single_save_expect_error(format('select public.admin_apply_shipping_region_policy(%L,%L::jsonb,2,null,true)',
  :'single_draft'::jsonb->>'id',:'single_config'::jsonb||'{"originId":"00000000-0000-4000-8000-000000104011"}'::jsonb),'shipping_region_policy_changed','PT409');
select pg_temp.single_save_expect_error(format('select public.admin_apply_shipping_region_policy(%L,%L::jsonb,1,null,true)',
  :'single_draft'::jsonb->>'id',:'single_config'),'shipping_region_identity_immutable','23514');
select public.admin_apply_shipping_region_policy((:'single_draft'::jsonb->>'id')::uuid,
  :'single_config'::jsonb||'{"originId":"00000000-0000-4000-8000-000000104011"}'::jsonb,1,null,true) as single_from_draft \gset
select pg_temp.single_save_expect_error(format('select public.admin_apply_shipping_region_policy(%L,%L::jsonb,2,null,true)',
  :'single_draft'::jsonb->>'id',:'single_config'::jsonb||'{"originId":"00000000-0000-4000-8000-000000104011"}'::jsonb),'shipping_region_policy_immutable','23514');
reset role;
select 1/case when :'single_from_draft'::jsonb#>>'{policy,id}'=:'single_draft'::jsonb->>'id' and :'single_from_draft'::jsonb#>>'{policy,status}'='active'
  and :'single_from_draft'::jsonb#>>'{policy,revision}'='2' and :'single_from_draft'::jsonb#>>'{policy,version}'='1'
  and :'single_from_draft'::jsonb#>>'{policy,name}'='TEST-ONLY 한 번에 적용'
  and :'single_from_draft'::jsonb#>>'{policy,sourceEvidence}'='TEST-ONLY:kept-evidence'
  and exists(select 1 from public.audit_log where action='admin.shipping_region.applied' and target='shipping-region:'||(:'single_draft'::jsonb->>'id')
    and diff#>>'{before,status}'='draft' and diff#>>'{after,sourceEvidence}'='TEST-ONLY:kept-evidence')
  then 1 else 0 end as saved_draft_is_applied_and_keeps_its_stored_evidence;

-- 6) 기존 두 단계 함수와 금액 바꾸기도 근거 없이 통과한다. 확인 인자(p_attested)는 그대로 요구한다.
set local role authenticated;
select public.admin_save_shipping_region_policy(null,:'single_config'::jsonb||jsonb_build_object('originId','00000000-0000-4000-8000-000000104012',
  'startsAt',now()-interval '1 hour'),null) as single_legacy \gset
select pg_temp.single_save_expect_error(format('select public.admin_set_shipping_region_policy_status(%L,%L,1,false)',
  :'single_legacy'::jsonb->>'id','active'),'shipping_region_attestation_required','23514');
select public.admin_set_shipping_region_policy_status((:'single_legacy'::jsonb->>'id')::uuid,'active',1,true) as single_legacy_active \gset
select public.admin_change_shipping_region_fees((:'single_legacy'::jsonb->>'id')::uuid,2,'{"합성 추가배송비 구간":3000}'::jsonb) as single_legacy_fee \gset
reset role;
select 1/case when :'single_legacy_active'::jsonb->>'status'='active' and :'single_legacy_active'::jsonb->>'sourceEvidence'=''
  and :'single_legacy_fee'::jsonb->>'status'='active' and :'single_legacy_fee'::jsonb#>>'{rules,0,amount}'='3000'
  then 1 else 0 end as two_step_activation_and_fee_change_no_longer_need_evidence;

-- 7) 같은 검사를 쓰는 묶음그룹 지역표도 근거 없이 통과한다(나머지 필수 항목은 그대로 본다).
select 1/case when private.normalize_shipping_charge_group_values('00000000-0000-4000-8000-000000104010',jsonb_build_object(
    'name','TEST-ONLY 묶음','enabled',true,'archived',false,'isDefault',false,'calculationMode','min','regional',jsonb_build_object('mode','override',
    'policy',jsonb_build_object('carrierCode','single_save_a','startsAt',now(),'endsAt',null,'openEnded',true,'sourceEvidence','',
      'unlistedDisposition','standard','noRulesConfirmed',true,'rules','[]'::jsonb))))#>>'{regional,policy,sourceEvidence}'=''
  then 1 else 0 end as charge_group_region_table_no_longer_needs_evidence;
select pg_temp.single_save_expect_error(format('select private.normalize_shipping_charge_group_values(%L,%L::jsonb)','00000000-0000-4000-8000-000000104010',
  jsonb_build_object('name','TEST-ONLY 묶음','enabled',true,'archived',false,'isDefault',false,'calculationMode','min','regional',jsonb_build_object('mode','override',
    'policy',jsonb_build_object('carrierCode','single_save_a','startsAt',now(),'endsAt',null,'openEnded',true,'sourceEvidence','',
      'unlistedDisposition',null,'noRulesConfirmed',true,'rules','[]'::jsonb)))),'shipping_region_policy_incomplete','23514');
rollback;
