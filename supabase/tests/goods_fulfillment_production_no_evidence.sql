\set ON_ERROR_STOP on
-- 상품의 수령 방식·주문 후 제작 저장에서 설정 근거·확인 체크를 요구하지 않는다(20261126126000_goods_fulfillment_production_no_evidence).
-- 근거 없이 저장되는지, 근거·확인을 보내는 옛 호출이 그대로 되는지, 저장돼 있던 근거를 지우지 않는지,
-- 나머지 값 검사·권한·감사 기록·같은 작업 번호 재시도·실행 권한 봉인·운영자 계약이 그대로인지 본다. 준비물은 모두 rollback된다.
begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_error(statement text,expected_code text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if sqlstate=expected_code then return;end if;raise;end;
 raise exception 'Expected error % from: %',expected_code,statement;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('0b900000-0000-4000-8000-000000000001','authenticated','authenticated','no-evidence-operator@example.test',now(),'{}','{}',now(),now()),
 ('0b900000-0000-4000-8000-000000000002','authenticated','authenticated','no-evidence-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 근거없음 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='0b900000-0000-4000-8000-000000000001' then 'staff'::public.user_role else 'user'::public.user_role end
 where id in('0b900000-0000-4000-8000-000000000001','0b900000-0000-4000-8000-000000000002');
-- 1번 계정만 운영자다(catalog.manage). 2번 계정은 일반 고객이다.
insert into private.operator_memberships(profile_id,manager_role) values('0b900000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
update private.goods_transaction_runtime set enabled=true where singleton;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
 select ('0b900000-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,('0b900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now(),now()+interval '1 hour' from generate_series(1,2)n;
create function pg_temp.act(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','0b900000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','0b900000-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated','session_id','0b900000-0000-4000-9000-'||lpad(n::text,12,'0'))::text,true);
end $$;
insert into public.ips(id,title,vertical_key,published_at) values('no-evidence-ip','TEST 근거 없는 저장','character',now());
insert into public.goods(id,code,ip_id,name,price,stock,stock_qty) values
 ('no-evidence-a','NOEV-A','no-evidence-ip','TEST 근거 없는 저장 A',10000,'ok',10),
 ('no-evidence-b','NOEV-B','no-evidence-ip','TEST 근거 없는 저장 B',10000,'ok',10);
\set op '0b900000-0000-4000-8000-000000000001'
\set op_session '0b900000-0000-4000-9000-000000000001'
\set buyer '0b900000-0000-4000-8000-000000000002'
\set buyer_session '0b900000-0000-4000-9000-000000000002'
\set production '{"enabled":true,"leadDays":5,"dayBasis":"calendar","closedDates":[],"publicNote":"TEST 주문 후 제작"}'
\set parcel '{"method":"parcel","feeAmount":null,"feeBasis":"per_order","installationFee":0}'
\set fulfillment '{"mode":"shipping","methods":[{"method":"parcel","feeAmount":null,"feeBasis":"per_order","installationFee":0},{"method":"quick","feeAmount":3000,"feeBasis":"per_order","installationFee":0}],"assetIds":[],"publicNote":"TEST 퀵 가능"}'

-- 1. 실행 권한: 두 함수 모두 authenticated만. anon·service_role은 실행할 수 없다.
select 1/case when has_function_privilege('authenticated','public.admin_save_goods_production(text,jsonb,bigint,uuid,uuid,uuid)','execute')
 and not has_function_privilege('anon','public.admin_save_goods_production(text,jsonb,bigint,uuid,uuid,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_save_goods_production(text,jsonb,bigint,uuid,uuid,uuid)','execute')
 and has_function_privilege('authenticated','public.admin_save_goods_fulfillment(text,jsonb,bigint,uuid,uuid,uuid)','execute')
 and not has_function_privilege('anon','public.admin_save_goods_fulfillment(text,jsonb,bigint,uuid,uuid,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_save_goods_fulfillment(text,jsonb,bigint,uuid,uuid,uuid)','execute')
 then 1 else 0 end as assert_execute_is_sealed_to_authenticated;
-- 2. 운영자 계약: 권한·구분은 전과 같고 본문 지문이 지금 함수와 같다.
select 1/case when (select count(*) from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
  where (c.signature,c.capability,c.guard_kind) in (
    ('public.admin_save_goods_production(text,jsonb,bigint,uuid,uuid,uuid)','catalog.manage','manual'),
    ('public.admin_save_goods_fulfillment(text,jsonb,bigint,uuid,uuid,uuid)','catalog.manage','write'))
   and not c.legacy_admin_only and c.body_md5=md5(p.prosrc))=2
 and (select count(*) from private.operator_internal_contracts where signature in (
    'public.admin_save_goods_production(text,jsonb,bigint,uuid,uuid,uuid)','public.admin_save_goods_fulfillment(text,jsonb,bigint,uuid,uuid,uuid)'))=2
 then 1 else 0 end as assert_operator_contracts_registered;

-- 주문 후 제작 ------------------------------------------------------------------------------------------------------
select pg_temp.act(1);set local role authenticated;
-- 3. 근거·확인 없이 저장된다. 같은 작업 번호로 다시 보내면 같은 결과를 돌려주고 한 번만 저장한다.
select public.admin_save_goods_production('no-evidence-a',:'production',0,'0b900000-0000-4002-8000-000000000001',:'op',:'op_session') as p1 \gset
select 1/case when :'p1'::jsonb->>'revision'='1' and (:'p1'::jsonb->>'enabled')::boolean and :'p1'::jsonb->>'leadDays'='5' and :'p1'::jsonb->>'evidence'=''
 then 1 else 0 end as assert_production_saved_without_evidence;
select 1/case when public.admin_save_goods_production('no-evidence-a',:'production',0,'0b900000-0000-4002-8000-000000000001',:'op',:'op_session')=:'p1'::jsonb
 then 1 else 0 end as assert_production_replay_returns_receipt;
-- 4. 근거·확인을 보내는 옛 호출도 그대로 저장되고, 그 뒤 근거 없이(또는 null로) 저장해도 저장돼 있던 근거는 남는다.
select public.admin_save_goods_production('no-evidence-a',:'production'::jsonb||'{"leadDays":7,"evidence":"  TEST 옛 근거  ","confirmed":true}',1,gen_random_uuid(),:'op',:'op_session')->>'evidence' as p2_evidence \gset
select public.admin_save_goods_production('no-evidence-a',:'production'::jsonb||'{"leadDays":9,"evidence":null,"confirmed":false}',2,gen_random_uuid(),:'op',:'op_session')->>'evidence' as p3_evidence \gset
select public.admin_save_goods_production('no-evidence-a','{"enabled":false,"leadDays":null,"dayBasis":"calendar","closedDates":[],"publicNote":""}',3,gen_random_uuid(),:'op',:'op_session') as p4 \gset
select 1/case when :'p2_evidence'='TEST 옛 근거' and :'p3_evidence'='TEST 옛 근거' and :'p4'::jsonb->>'evidence'='TEST 옛 근거'
 and :'p4'::jsonb->>'revision'='4' and not (:'p4'::jsonb->>'enabled')::boolean
 then 1 else 0 end as assert_production_keeps_stored_evidence;
-- 5. 나머지 값 검사는 그대로다(22023). 다른 사람이 먼저 바꾼 저장은 PT409다.
select pg_temp.expect_error(format('select public.admin_save_goods_production(%L,%L::jsonb,4,gen_random_uuid(),%L,%L)','no-evidence-a',bad,:'op',:'op_session'),'22023')
 from (values
  ('{"enabled":true,"leadDays":null,"dayBasis":"calendar","closedDates":[],"publicNote":""}'),
  ('{"enabled":true,"leadDays":366,"dayBasis":"calendar","closedDates":[],"publicNote":""}'),
  ('{"enabled":true,"leadDays":5,"dayBasis":"calendar","closedDates":["2026-12-25"],"publicNote":""}'),
  ('{"enabled":true,"leadDays":5,"dayBasis":"calendar","closedDates":[]}'),
  ('{"enabled":true,"leadDays":5,"dayBasis":"calendar","closedDates":[],"publicNote":"","reason":"TEST"}'),
  ('{"enabled":true,"leadDays":5,"dayBasis":"calendar","closedDates":[],"publicNote":"줄\n바꿈"}'),
  ('{"enabled":true,"leadDays":5,"dayBasis":"calendar","closedDates":[],"publicNote":"","evidence":12}'),
  ('{"enabled":true,"leadDays":5,"dayBasis":"calendar","closedDates":[],"publicNote":"","evidence":"줄\n바꿈"}'),
  ('{"enabled":true,"leadDays":5,"dayBasis":"calendar","closedDates":[],"publicNote":"","confirmed":"yes"}'),
  ((:'production'::jsonb||jsonb_build_object('evidence',repeat('가',1001)))::text),
  ('[]'),('null')) as cases(bad);
select pg_temp.expect_error(format('select public.admin_save_goods_production(%L,%L::jsonb,0,gen_random_uuid(),%L,%L)','no-evidence-a',:'production',:'op',:'op_session'),'PT409');
-- 6. 권한은 그대로다: 운영자가 아닌 계정, 로그인한 계정과 다른 계정 이름으로는 저장할 수 없다(42501).
select pg_temp.expect_error(format('select public.admin_save_goods_production(%L,%L::jsonb,0,gen_random_uuid(),%L,%L)','no-evidence-b',:'production',:'buyer',:'buyer_session'),'42501');
reset role;select pg_temp.act(2);set local role authenticated;
select pg_temp.expect_error(format('select public.admin_save_goods_production(%L,%L::jsonb,0,gen_random_uuid(),%L,%L)','no-evidence-b',:'production',:'buyer',:'buyer_session'),'42501');
select pg_temp.expect_error(format('select public.admin_save_goods_production(%L,%L::jsonb,0,gen_random_uuid(),%L,%L)','no-evidence-b',:'production',:'op',:'op_session'),'42501');
reset role;
-- 7. 감사 기록: 저장한 4번이 누가·무엇으로 바꿨는지와 함께 남고(근거 없는 저장도), 막힌 저장은 남지 않는다.
select 1/case when (select count(*) from public.audit_log where action='admin.goods.production_policy' and target='good:no-evidence-a' and actor_id=:'op')=4
 and (select diff->'request'->'values'=:'production'::jsonb and diff->'result'->>'revision'='1' from public.audit_log where id='0b900000-0000-4002-8000-000000000001')
 and not exists(select 1 from public.audit_log where target='good:no-evidence-b')
 and not exists(select 1 from private.goods_production_settings where good_id='no-evidence-b')
 then 1 else 0 end as assert_production_audit_rows;

-- 수령 방식 ----------------------------------------------------------------------------------------------------------
select pg_temp.act(1);set local role authenticated;
-- 8. 근거·확인 없이 저장된다. 같은 작업 번호로 다시 보내면 같은 결과를 돌려준다.
select public.admin_save_goods_fulfillment('no-evidence-a',:'fulfillment',0,'0b900000-0000-4003-8000-000000000001',:'op',:'op_session') as f1 \gset
select 1/case when :'f1'::jsonb->>'revision'='1' and :'f1'::jsonb->>'mode'='shipping' and jsonb_array_length(:'f1'::jsonb->'methods')=2
 and :'f1'::jsonb#>>'{methods,1,feeAmount}'='3000' and :'f1'::jsonb->>'evidence'=''
 then 1 else 0 end as assert_fulfillment_saved_without_evidence;
select 1/case when public.admin_save_goods_fulfillment('no-evidence-a',:'fulfillment',0,'0b900000-0000-4003-8000-000000000001',:'op',:'op_session')=:'f1'::jsonb
 then 1 else 0 end as assert_fulfillment_replay_returns_receipt;
-- 9. 옛 호출(근거·확인 포함)도 그대로 저장되고, 그 뒤 근거 없이 저장해도 저장돼 있던 근거는 남는다.
select public.admin_save_goods_fulfillment('no-evidence-a','{"mode":"no_delivery","methods":[{"method":"none","feeAmount":0,"feeBasis":"per_order","installationFee":0}],"assetIds":[],"publicNote":"","evidence":" TEST 옛 수령 근거 ","confirmed":true}',
 1,gen_random_uuid(),:'op',:'op_session')->>'evidence' as f2_evidence \gset
select public.admin_save_goods_fulfillment('no-evidence-a',jsonb_build_object('mode','shipping','methods',jsonb_build_array(:'parcel'::jsonb),'assetIds','[]'::jsonb,'publicNote','','evidence',null),
 2,gen_random_uuid(),:'op',:'op_session') as f3 \gset
select 1/case when :'f2_evidence'='TEST 옛 수령 근거' and :'f3'::jsonb->>'evidence'='TEST 옛 수령 근거' and :'f3'::jsonb->>'revision'='3' and :'f3'::jsonb->>'mode'='shipping'
 then 1 else 0 end as assert_fulfillment_keeps_stored_evidence;
-- 10. 나머지 값 검사는 그대로다(22023). 다른 사람이 먼저 바꾼 저장은 PT409다.
select pg_temp.expect_error(format('select public.admin_save_goods_fulfillment(%L,%L::jsonb,3,gen_random_uuid(),%L,%L)','no-evidence-a',bad,:'op',:'op_session'),'22023')
 from (values
  ('{"mode":"shipping","methods":[],"assetIds":[],"publicNote":""}'),
  ('{"mode":"no_delivery","methods":[{"method":"parcel","feeAmount":null,"feeBasis":"per_order","installationFee":0}],"assetIds":[],"publicNote":""}'),
  ('{"mode":"shipping","methods":[{"method":"quick","feeAmount":-1,"feeBasis":"per_order","installationFee":0}],"assetIds":[],"publicNote":""}'),
  ('{"mode":"digital","methods":[{"method":"digital","feeAmount":0,"feeBasis":"per_order","installationFee":0}],"assetIds":[],"publicNote":""}'),
  ('{"mode":"shipping","methods":[{"method":"parcel","feeAmount":null,"feeBasis":"per_order","installationFee":0}],"assetIds":[]}'),
  ('{"mode":"shipping","methods":[{"method":"parcel","feeAmount":null,"feeBasis":"per_order","installationFee":0}],"assetIds":[],"publicNote":"","reason":"TEST"}'),
  ('{"mode":"shipping","methods":[{"method":"parcel","feeAmount":null,"feeBasis":"per_order","installationFee":0}],"assetIds":[],"publicNote":"줄\n바꿈"}'),
  ('{"mode":"shipping","methods":[{"method":"parcel","feeAmount":null,"feeBasis":"per_order","installationFee":0}],"assetIds":[],"publicNote":"","evidence":12}'),
  ('{"mode":"shipping","methods":[{"method":"parcel","feeAmount":null,"feeBasis":"per_order","installationFee":0}],"assetIds":[],"publicNote":"","evidence":"줄\n바꿈"}'),
  ('{"mode":"shipping","methods":[{"method":"parcel","feeAmount":null,"feeBasis":"per_order","installationFee":0}],"assetIds":[],"publicNote":"","confirmed":"yes"}'),
  ((:'fulfillment'::jsonb||jsonb_build_object('evidence',repeat('가',1001)))::text),
  ('[]'),('null')) as cases(bad);
select pg_temp.expect_error(format('select public.admin_save_goods_fulfillment(%L,%L::jsonb,0,gen_random_uuid(),%L,%L)','no-evidence-a',:'fulfillment',:'op',:'op_session'),'PT409');
-- 11. 권한은 그대로다(42501).
reset role;select pg_temp.act(2);set local role authenticated;
select pg_temp.expect_error(format('select public.admin_save_goods_fulfillment(%L,%L::jsonb,0,gen_random_uuid(),%L,%L)','no-evidence-b',:'fulfillment',:'buyer',:'buyer_session'),'42501');
select pg_temp.expect_error(format('select public.admin_save_goods_fulfillment(%L,%L::jsonb,0,gen_random_uuid(),%L,%L)','no-evidence-b',:'fulfillment',:'op',:'op_session'),'42501');
reset role;
-- 12. 감사 기록: 저장한 3번이 남고, 막힌 저장은 남지 않는다. 고객 화면이 읽는 값에는 근거가 없다.
select 1/case when (select count(*) from public.audit_log where action='goods.fulfillment.settings' and target='good:no-evidence-a' and actor_id=:'op')=3
 and (select diff->'request'->'values'=:'fulfillment'::jsonb and diff->'result'->>'revision'='1' from public.audit_log where id='0b900000-0000-4003-8000-000000000001')
 and not exists(select 1 from private.goods_fulfillment_settings where good_id='no-evidence-b')
 and not (private.goods_fulfillment_document('no-evidence-a',false) ? 'evidence')
 and (select evidence='TEST 옛 수령 근거' and revision=3 from private.goods_fulfillment_settings where good_id='no-evidence-a')
 and (select evidence='TEST 옛 근거' and revision=4 from private.goods_production_settings where good_id='no-evidence-a')
 then 1 else 0 end as assert_fulfillment_audit_rows_and_stored_values;
rollback;
