\set ON_ERROR_STOP on
-- 배송정보 관리의 택배 외 수령 방식·착불 조건을 근거 칸 없이 켠다(20261127102000_delivery_policy_collect_no_evidence).
-- 근거 없이 '사용'으로 저장되는지, 근거를 보내는 옛 호출이 그대로 되는지, 저장돼 있던 근거를 지우지 않는지,
-- 고객에게 보이는 값의 필수 검사·켠 조건은 못 고침·권한·감사 기록·같은 작업 번호 재시도·실행 권한 봉인·운영자 계약이 그대로인지 본다.
-- 준비물은 모두 rollback된다.
begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_error(statement text,expected_message text,expected_code text) returns void language plpgsql as $$begin
 begin execute statement;
 exception when others then
  if sqlstate=expected_code and (expected_message is null or position(expected_message in sqlerrm)>0) then return;end if;raise;
 end;
 raise exception 'Expected error % (%) from: %',expected_code,expected_message,statement;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('d2c00000-0000-4000-8000-000000000001','authenticated','authenticated','no-evidence-origin-admin@example.test',now(),'{}','{}',now(),now()),
 ('d2c00000-0000-4000-8000-000000000002','authenticated','authenticated','no-evidence-origin-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin',nickname='TEST 출고지 관리자' where id='d2c00000-0000-4000-8000-000000000001';
update public.profiles set nickname='TEST 출고지 고객' where id='d2c00000-0000-4000-8000-000000000002';
-- 1번 계정만 최고 관리자다(platform.manage). 2번 계정은 일반 고객이다.
insert into private.operator_memberships(profile_id,manager_role) values('d2c00000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into public.fulfillment_origins(id,code,name,base_fee,return_address,is_active) values
 ('d2c00000-0000-4000-8000-000000000010','no-evidence-origin-a','TEST 근거 없는 출고지 A',3000,'TEST 합성 주소 A',true),
 ('d2c00000-0000-4000-8000-000000000011','no-evidence-origin-b','TEST 근거 없는 출고지 B',3000,'TEST 합성 주소 B',true);
\set admin 'd2c00000-0000-4000-8000-000000000001'
\set buyer 'd2c00000-0000-4000-8000-000000000002'
\set origin_a 'd2c00000-0000-4000-8000-000000000010'
\set origin_b 'd2c00000-0000-4000-8000-000000000011'
-- 고객에게 보이는 값만 채운 조건(승인 근거 없음).
\set terms '{"contactName":"TEST 인계 담당","contactPhone":"02-0000-0000","handoffLocation":"TEST 인계 장소","handoffInstructions":"TEST 인계 방법","appointmentInstructions":"TEST 예약 안내","allowDelegate":false,"completionInstructions":"TEST 받았는지 확인하는 방법","cancellationInstructions":"TEST 취소 안내"}'
-- 고객에게 보이는 착불 네 칸.
\set collect '{"collectorName":"TEST 수납사","collectionMethod":"TEST 받을 때 기사에게","refundContact":"TEST 환불 문의","customerInstructions":"TEST 착불 안내"}'

-- 1. 실행 권한: 저장 함수는 authenticated만, 검사 함수는 내부 전용이다.
select 1/case when has_function_privilege('authenticated','public.admin_save_delivery_policy(uuid,text,uuid,jsonb,integer)','execute')
 and not has_function_privilege('anon','public.admin_save_delivery_policy(uuid,text,uuid,jsonb,integer)','execute')
 and not has_function_privilege('service_role','public.admin_save_delivery_policy(uuid,text,uuid,jsonb,integer)','execute')
 and has_function_privilege('authenticated','public.admin_save_shipping_collect_contract(uuid,integer,text,jsonb,uuid,uuid)','execute')
 and not has_function_privilege('anon','public.admin_save_shipping_collect_contract(uuid,integer,text,jsonb,uuid,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_save_shipping_collect_contract(uuid,integer,text,jsonb,uuid,uuid)','execute')
 and not has_function_privilege('authenticated','private.valid_delivery_policy_terms(jsonb,boolean)','execute')
 and not has_function_privilege('service_role','private.valid_delivery_policy_terms(jsonb,boolean)','execute')
 and not has_function_privilege('authenticated','private.shipping_collect_contract_input_valid(jsonb,text)','execute')
 and not has_function_privilege('service_role','private.shipping_collect_contract_input_valid(jsonb,text)','execute')
 then 1 else 0 end as assert_execute_is_sealed;
-- 2. 운영자 계약: 권한·구분은 전과 같고(최고 관리자 전용) 본문 지문이 지금 함수와 같다.
select 1/case when (select count(*) from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
  where (c.signature,c.capability,c.guard_kind) in (
    ('public.admin_save_delivery_policy(uuid,text,uuid,jsonb,integer)','platform.manage','write'),
    ('public.admin_save_shipping_collect_contract(uuid,integer,text,jsonb,uuid,uuid)','platform.manage','manual'))
   and c.legacy_admin_only and c.body_md5=md5(p.prosrc))=2
 and (select count(*) from private.operator_internal_contracts where signature in (
    'public.admin_save_delivery_policy(uuid,text,uuid,jsonb,integer)','public.admin_save_shipping_collect_contract(uuid,integer,text,jsonb,uuid,uuid)',
    'private.shipping_collect_contract_input_valid(jsonb,text)'))=3
 then 1 else 0 end as assert_operator_contracts_registered;

-- 택배 외 수령 방식 --------------------------------------------------------------------------------------------------
-- 3. 검사 함수: 승인 근거가 없어도 '사용'이 된다. 고객에게 보이는 값이 비면 안 되고, 저장되는 모양에는 근거 키가 그대로 있어야 한다.
select 1/case when private.valid_delivery_policy_terms(:'terms'::jsonb||'{"approvalReference":null}',true)
 and private.valid_delivery_policy_terms(:'terms'::jsonb||'{"approvalReference":"TEST 근거"}',true)
 and not private.valid_delivery_policy_terms(:'terms'::jsonb||'{"approvalReference":null,"contactPhone":null}',true)
 and not private.valid_delivery_policy_terms(:'terms'::jsonb||'{"approvalReference":null,"allowDelegate":null}',true)
 and private.valid_delivery_policy_terms(:'terms'::jsonb||'{"approvalReference":null,"contactPhone":null}',false)
 and not private.valid_delivery_policy_terms(:'terms'::jsonb,true)
 and not private.valid_delivery_policy_terms(:'terms'::jsonb||'{"approvalReference":""}',true)
 then 1 else 0 end as assert_delivery_terms_validator;
select count(*) as policy_audit_before from public.audit_log where action='admin.fulfillment_delivery_policy.saved' and target='origin:'||:'origin_a' \gset
set local role authenticated;
select set_config('request.jwt.claim.sub',:'admin',true);
-- 4. 승인 근거 없이 바로 '사용'으로 저장된다.
select public.admin_save_delivery_policy(:'origin_a','quick',null,:'terms'::jsonb||'{"state":"active"}',null) as quick_saved \gset
select 1/case when (:'quick_saved'::jsonb->>'changed')::boolean and :'quick_saved'::jsonb->>'revision'='1'
 and public.admin_list_delivery_policies(:'origin_a')#>>'{0,state}'='active'
 and public.admin_list_delivery_policies(:'origin_a')#>'{0,approvalReference}'='null'::jsonb
 and public.admin_list_delivery_policies(:'origin_a')#>>'{0,activatedAt}' is not null
 then 1 else 0 end as assert_delivery_policy_active_without_evidence;
-- 5. 같은 값으로 다시 '사용'을 보내면 바뀐 것이 없고, 켠 조건은 전처럼 고칠 수 없다.
select 1/case when not (public.admin_save_delivery_policy(:'origin_a','quick',(:'quick_saved'::jsonb->>'id')::uuid,:'terms'::jsonb||'{"state":"active"}',1)->>'changed')::boolean
 then 1 else 0 end as assert_delivery_policy_same_values_unchanged;
select pg_temp.expect_error(format('select public.admin_save_delivery_policy(%L,%L,%L,%L::jsonb,1)',:'origin_a','quick',:'quick_saved'::jsonb->>'id',
 (:'terms'::jsonb||'{"state":"active","contactPhone":"02-1111-1111"}')::text),'activated_delivery_policy_immutable','23514');
-- 6. 고객에게 보이는 값이 비면 전처럼 켤 수 없다.
select pg_temp.expect_error(format('select public.admin_save_delivery_policy(%L,%L,null,%L::jsonb,null)',:'origin_a','pickup',
 ((:'terms'::jsonb-'handoffLocation')||'{"state":"active"}')::text),'delivery_policy_incomplete','23514');
select pg_temp.expect_error(format('select public.admin_save_delivery_policy(%L,%L,null,%L::jsonb,null)',:'origin_a','pickup',
 (:'terms'::jsonb||'{"state":"active","allowDelegate":null}')::text),'delivery_policy_incomplete','23514');
-- 7. 근거를 보내는 옛 호출도 그대로 저장되고, 그 뒤 근거 없이(또는 빈 글·null로) 저장해도 저장돼 있던 근거는 남는다.
select public.admin_save_delivery_policy(:'origin_a','pickup',null,'{"state":"draft","contactName":"TEST 방문 담당","approvalReference":"  TEST 옛 근거  "}',null)->>'id' as pickup_policy \gset
select 1/case when public.admin_save_delivery_policy(:'origin_a','pickup',:'pickup_policy','{"state":"draft","contactName":"TEST 방문 담당 2"}',1)->>'revision'='2'
 and public.admin_save_delivery_policy(:'origin_a','pickup',:'pickup_policy','{"state":"draft","contactName":"TEST 방문 담당 3","approvalReference":""}',2)->>'revision'='3'
 and public.admin_save_delivery_policy(:'origin_a','pickup',:'pickup_policy',:'terms'::jsonb||'{"state":"active","approvalReference":null}',3)->>'revision'='4'
 then 1 else 0 end as assert_delivery_policy_saved_without_resending_evidence;
reset role;
select 1/case when (select terms->>'approvalReference'='TEST 옛 근거' and state='active' and private.valid_delivery_policy_terms(terms,true)
  from private.fulfillment_delivery_policies where id=:'pickup_policy')
 -- 발송처리의 방식 변경이 쓰는 같은 검사를, 근거 없이 켠 조건도 통과한다.
 and (select private.valid_delivery_policy_terms(terms,true) and not terms ? 'state' and terms ? 'approvalReference'
  from private.fulfillment_delivery_policies where id=(:'quick_saved'::jsonb->>'id')::uuid)
 then 1 else 0 end as assert_stored_evidence_kept;
-- 8. 감사 기록은 바뀐 저장마다 남는다(퀵 1 + 방문수령 4, 바뀐 것이 없는 재저장은 남기지 않는다).
select 1/case when (select count(*) from public.audit_log where action='admin.fulfillment_delivery_policy.saved' and target='origin:'||:'origin_a')=:policy_audit_before+5
 then 1 else 0 end as assert_delivery_policy_audited;
-- 9. 권한은 그대로다: 최고 관리자가 아니면 저장할 수 없다.
set local role authenticated;
select set_config('request.jwt.claim.sub',:'buyer',true);
select pg_temp.expect_error(format('select public.admin_save_delivery_policy(%L,%L,null,%L::jsonb,null)',:'origin_a','direct',(:'terms'::jsonb||'{"state":"active"}')::text),null,'42501');
select set_config('request.jwt.claim.sub',:'admin',true);
-- 10. '사용 안 함'으로 바꾸는 것도 그대로다. 한 번 끈 조건은 다시 켤 수 없다.
select 1/case when public.admin_save_delivery_policy(:'origin_a','quick',(:'quick_saved'::jsonb->>'id')::uuid,'{"state":"stopped"}',1)->>'revision'='2'
 then 1 else 0 end as assert_delivery_policy_stopped;
select pg_temp.expect_error(format('select public.admin_save_delivery_policy(%L,%L,%L,%L::jsonb,2)',:'origin_a','quick',:'quick_saved'::jsonb->>'id',
 (:'terms'::jsonb||'{"state":"active"}')::text),'activated_delivery_policy_immutable','23514');

-- 착불 --------------------------------------------------------------------------------------------------------------
reset role;
-- 11. 검사 함수: 고객에게 보이는 네 칸만으로 '사용'이 된다. 그 네 칸이 비거나 빠지면 안 되고, 근거 칸은 비어도 된다.
select 1/case when private.shipping_collect_contract_input_valid(:'collect','active')
 and private.shipping_collect_contract_input_valid(:'collect'::jsonb||'{"contractReference":"","disputeContact":""}','active')
 and private.shipping_collect_contract_input_valid(:'collect'::jsonb||'{"contractReference":"TEST 계약","dispatchMappingReference":"TEST 표기","receiptReference":"TEST 증빙","disputeContact":"TEST 담당"}','active')
 and not private.shipping_collect_contract_input_valid(:'collect'::jsonb||'{"refundContact":""}','active')
 and private.shipping_collect_contract_input_valid(:'collect'::jsonb||'{"refundContact":""}','draft')
 and private.shipping_collect_contract_input_valid(:'collect'::jsonb||'{"refundContact":""}','disabled')
 and not private.shipping_collect_contract_input_valid(:'collect'::jsonb-'collectorName','draft')
 and not private.shipping_collect_contract_input_valid(:'collect'::jsonb||'{"secret":"no"}','draft')
 and not private.shipping_collect_contract_input_valid(:'collect'::jsonb||'{"contractReference":" 앞 공백"}','draft')
 and not private.shipping_collect_contract_input_valid(:'collect'::jsonb||'{"disputeContact":1}','draft')
 and not private.shipping_collect_contract_input_valid('"글"'::jsonb,'draft')
 and not private.shipping_collect_contract_input_valid('[]'::jsonb,'draft')
 and not private.shipping_collect_contract_input_valid(null,'draft')
 and not private.shipping_collect_contract_input_valid(:'collect','unknown')
 then 1 else 0 end as assert_collect_validator;
set local role authenticated;
select set_config('request.jwt.claim.sub',:'admin',true);
-- 12. 근거 없이 '사용'으로 저장된다. 저장되는 모양은 전과 같은 여덟 칸이고 근거 칸은 빈 글이다.
select public.admin_save_shipping_collect_contract(:'origin_a',0,'active',:'collect','d2c00000-0000-4002-8000-000000000001',:'admin') as c1 \gset
select 1/case when :'c1'::jsonb->>'revision'='1' and :'c1'::jsonb->>'status'='active' and :'c1'::jsonb->>'operationId'='d2c00000-0000-4002-8000-000000000001'
 and :'c1'::jsonb->'values'=:'collect'::jsonb||'{"contractReference":"","dispatchMappingReference":"","receiptReference":"","disputeContact":""}'
 then 1 else 0 end as assert_collect_saved_without_evidence;
-- 13. 같은 작업 번호로 다시 보내면 같은 결과를 돌려주고 한 번만 저장한다. 같은 번호로 다른 내용은 거절한다.
select 1/case when public.admin_save_shipping_collect_contract(:'origin_a',0,'active',:'collect','d2c00000-0000-4002-8000-000000000001',:'admin')=:'c1'::jsonb
 and public.admin_get_shipping_collect_operation('d2c00000-0000-4002-8000-000000000001',:'admin')=:'c1'::jsonb
 and (public.admin_get_shipping_collect_contract(:'origin_a')->>'revision')::integer=1
 then 1 else 0 end as assert_collect_replay_returns_receipt;
select pg_temp.expect_error(format('select public.admin_save_shipping_collect_contract(%L,0,%L,%L::jsonb,%L,%L)',:'origin_a','active',
 (:'collect'::jsonb||'{"collectorName":"TEST 다른 수납사"}')::text,'d2c00000-0000-4002-8000-000000000001',:'admin'),'operation_conflict','23505');
-- 14. 착불을 켜면 상품이 읽는 준비 상태에 고객에게 보이는 네 칸이 나온다.
select 1/case when public.admin_get_shipping_collect_readiness(:'origin_a')->>'status'='active'
 and public.admin_get_shipping_collect_readiness(:'origin_a')->'collector'=jsonb_build_object('name','TEST 수납사','method','TEST 받을 때 기사에게','refundContact','TEST 환불 문의','instructions','TEST 착불 안내')
 then 1 else 0 end as assert_collect_ready_for_goods;
-- 15. 근거를 보내는 옛 호출도 그대로 저장되고, 그 뒤 근거 없이 저장해도 저장돼 있던 근거는 남는다. 보낸 칸은 빈 글이어도 보낸 값대로 저장한다.
select public.admin_save_shipping_collect_contract(:'origin_a',1,'active',
 :'collect'::jsonb||'{"contractReference":"TEST 옛 계약","dispatchMappingReference":"TEST 옛 표기","receiptReference":"TEST 옛 증빙","disputeContact":"TEST 옛 담당"}',
 'd2c00000-0000-4002-8000-000000000002',:'admin')#>>'{values,contractReference}' as c2_contract \gset
select public.admin_save_shipping_collect_contract(:'origin_a',2,'disabled',:'collect'::jsonb||'{"customerInstructions":"TEST 착불 안내 2"}',
 'd2c00000-0000-4002-8000-000000000003',:'admin') as c3 \gset
select public.admin_save_shipping_collect_contract(:'origin_a',3,'active',:'collect'::jsonb||'{"disputeContact":""}',
 'd2c00000-0000-4002-8000-000000000004',:'admin') as c4 \gset
select 1/case when :'c2_contract'='TEST 옛 계약'
 and :'c3'::jsonb->>'revision'='3' and :'c3'::jsonb->>'status'='disabled' and :'c3'::jsonb#>>'{values,customerInstructions}'='TEST 착불 안내 2'
 and :'c3'::jsonb#>>'{values,contractReference}'='TEST 옛 계약' and :'c3'::jsonb#>>'{values,dispatchMappingReference}'='TEST 옛 표기'
 and :'c3'::jsonb#>>'{values,receiptReference}'='TEST 옛 증빙' and :'c3'::jsonb#>>'{values,disputeContact}'='TEST 옛 담당'
 and :'c4'::jsonb->>'revision'='4' and :'c4'::jsonb#>>'{values,contractReference}'='TEST 옛 계약' and :'c4'::jsonb#>>'{values,disputeContact}'=''
 then 1 else 0 end as assert_collect_stored_evidence_kept;
-- 16. 고객에게 보이는 칸이 비면 전처럼 켤 수 없고, 모르는 칸·끝 공백은 거절한다. 거절된 저장은 남지 않는다.
select pg_temp.expect_error(format('select public.admin_save_shipping_collect_contract(%L,4,%L,%L::jsonb,%L,%L)',:'origin_a','active',
 (:'collect'::jsonb||'{"collectionMethod":""}')::text,'d2c00000-0000-4002-8000-000000000005',:'admin'),'invalid_collect_contract','22023');
select pg_temp.expect_error(format('select public.admin_save_shipping_collect_contract(%L,4,%L,%L::jsonb,%L,%L)',:'origin_a','draft',
 (:'collect'::jsonb||'{"secret":"no"}')::text,'d2c00000-0000-4002-8000-000000000006',:'admin'),'invalid_collect_contract','22023');
select pg_temp.expect_error(format('select public.admin_save_shipping_collect_contract(%L,4,%L,%L::jsonb,%L,%L)',:'origin_a','draft',
 (:'collect'::jsonb||'{"collectorName":"TEST 수납사 "}')::text,'d2c00000-0000-4002-8000-000000000007',:'admin'),'invalid_collect_contract','22023');
select pg_temp.expect_error(format('select public.admin_save_shipping_collect_contract(%L,4,%L,%L::jsonb,%L,%L)',:'origin_a','draft','"글"',
 'd2c00000-0000-4002-8000-000000000008',:'admin'),'invalid_collect_contract','22023');
-- 17. 다른 사람이 먼저 바꿨으면(저장 번호가 다르면) 전처럼 거절한다.
select pg_temp.expect_error(format('select public.admin_save_shipping_collect_contract(%L,3,%L,%L::jsonb,%L,%L)',:'origin_a','active',:'collect',
 'd2c00000-0000-4002-8000-000000000009',:'admin'),'collect_contract_changed','PT409');
-- 18. 처음 저장하는 출고지에서 '사용 안 함'으로 일부만 적어 두는 것도 그대로 된다.
select 1/case when public.admin_save_shipping_collect_contract(:'origin_b',0,'disabled',
 '{"collectorName":"","collectionMethod":"","refundContact":"","customerInstructions":""}','d2c00000-0000-4002-8000-000000000010',:'admin')#>>'{values,receiptReference}'=''
 then 1 else 0 end as assert_collect_disabled_empty_saved;
-- 19. 권한은 그대로다: 로그인한 사람이 다르거나 최고 관리자가 아니면 저장할 수 없다.
select pg_temp.expect_error(format('select public.admin_save_shipping_collect_contract(%L,4,%L,%L::jsonb,%L,%L)',:'origin_a','active',:'collect',
 'd2c00000-0000-4002-8000-000000000011',:'buyer'),'auth_context_changed','42501');
select set_config('request.jwt.claim.sub',:'buyer',true);
select pg_temp.expect_error(format('select public.admin_save_shipping_collect_contract(%L,4,%L,%L::jsonb,%L,%L)',:'origin_a','active',:'collect',
 'd2c00000-0000-4002-8000-000000000012',:'buyer'),null,'42501');
reset role;
-- 20. 감사 기록은 저장한 작업 번호로 남고(성공 4 + 출고지 B 1), 거절된 저장은 남지 않는다. 저장된 판은 모두 여덟 칸이다.
select 1/case when (select count(*) from public.audit_log where action='admin.shipping.collect_contract.saved'
   and target in('fulfillment_origins:'||:'origin_a','fulfillment_origins:'||:'origin_b') and actor_id=:'admin')=5
 and (select diff#>'{request,values}'=:'collect'::jsonb and diff#>>'{result,values,contractReference}'='' from public.audit_log where id='d2c00000-0000-4002-8000-000000000001')
 and not exists(select 1 from public.audit_log where id in('d2c00000-0000-4002-8000-000000000005','d2c00000-0000-4002-8000-000000000009','d2c00000-0000-4002-8000-000000000012'))
 and (select count(*)=5 and bool_and((select count(*) from jsonb_object_keys(contract_values))=8) from private.shipping_collect_contract_versions
   where origin_id in(:'origin_a',:'origin_b'))
 then 1 else 0 end as assert_collect_audited_and_shaped;
rollback;
