\set ON_ERROR_STOP on
-- 배송비 청구 설정 저장(admin_save_claim_fee_policy, 20261127101000): '정책 근거'와 확인 체크 없이 저장되는지,
-- 근거를 보내지 않은 저장이 저장돼 있던 근거를 지우지 않는지, 근거·확인을 보내는 옛 호출이 그대로 되는지,
-- 금액 검증·계좌 조건·다른 사람이 먼저 바꿨을 때의 거절·같은 작업 번호 재시도·권한·감사 기록·운영자 계약이 전과 같은지 본다.
-- 준비물은 모두 rollback된다.
begin;
create function pg_temp.fp_id(kind text,n integer) returns uuid language sql immutable as $$select md5('claim-fee-policy-sql:'||kind||':'||n)::uuid$$;
create function pg_temp.fp_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'claim fee policy assertion: %',label;end if;end$$;
create function pg_temp.fp_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;raise exception 'Expected claim fee policy rejection: % for %',expected,q;end$$;
create function pg_temp.fp_login(n integer,session_n integer default null) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.fp_id('user',n),'role','authenticated','session_id',pg_temp.fp_id('session',coalesce(session_n,n)))::text,true)::text::void;
$$;
create function pg_temp.fp_save(p_values jsonb,p_revision bigint,op integer,n integer default 1) returns jsonb language sql as $$
 select public.admin_save_claim_fee_policy(p_values,p_revision,pg_temp.fp_id('op',op),pg_temp.fp_id('user',n),pg_temp.fp_id('session',n))$$;

-- user 1: 판매 관리 권한이 있는 운영자. user 2: 일반 회원. user 3: owner 자리를 채우는 운영자(없을 때만).
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.fp_id('user',n),'authenticated','authenticated','claim-fee-policy-sql-'||n||'@example.test',now(),'{}','{}' from generate_series(1,3)n;
update public.profiles set nickname='TEST fee policy '||right(id::text,8),role=case when id in(pg_temp.fp_id('user',1),pg_temp.fp_id('user',3)) then 'admin'::public.user_role else 'user'::public.user_role end
 where id in(select pg_temp.fp_id('user',n) from generate_series(1,3)n);
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after) select pg_temp.fp_id('session',n),pg_temp.fp_id('user',n),now(),now(),'aal1',now()+interval '1 hour' from generate_series(1,3)n;
insert into private.operator_memberships(profile_id,manager_role) select pg_temp.fp_id('user',3),'owner' where not exists(select 1 from private.operator_memberships where manager_role='owner');
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.fp_id('user',1),'primary');
update private.operator_access_state set configured=true where id;
-- 운영 값은 쓰지 않는다: 설정과 입금 받을 계좌를 이 시험의 값으로 둔다.
update private.claim_fee_policy set enabled=false,return_amount=null,exchange_amount=null,evidence='',revision=1 where singleton;
update public.store_settings set bank_transfer='{"bank":"TEST BANK","accountNumber":"TEST-0000","holder":"TEST SHOP"}' where singleton;

-- 1. 실행 권한: authenticated만. 운영자 계약: sales.manage 쓰기로 등록돼 있고 본문 지문이 지금 함수와 같다.
select pg_temp.fp_assert(has_function_privilege('authenticated','public.admin_save_claim_fee_policy(jsonb,bigint,uuid,uuid,uuid)','execute')
 and not has_function_privilege('anon','public.admin_save_claim_fee_policy(jsonb,bigint,uuid,uuid,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_save_claim_fee_policy(jsonb,bigint,uuid,uuid,uuid)','execute'),'execute sealed to authenticated');
select pg_temp.fp_assert(exists(select 1 from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
  where c.signature='public.admin_save_claim_fee_policy(jsonb,bigint,uuid,uuid,uuid)' and c.capability='sales.manage' and c.guard_kind='write'
   and not c.legacy_admin_only and c.body_md5=md5(p.prosrc))
 and exists(select 1 from private.operator_internal_contracts where signature='public.admin_save_claim_fee_policy(jsonb,bigint,uuid,uuid,uuid)'),'operator contract registered with current body');

select pg_temp.fp_login(1);
set local role authenticated;
-- 2. 근거·확인 체크 없이 저장된다.
create temp table fp_receipt(step integer primary key,value jsonb);
insert into fp_receipt select 1,pg_temp.fp_save('{"enabled":true,"returnAmount":3000,"exchangeAmount":6000}',1,1);
select pg_temp.fp_assert((select value->>'enabled'='true' and value->>'returnAmount'='3000' and value->>'exchangeAmount'='6000' and value->>'revision'='2'
 and value->>'evidence'='' and value->>'accountReady'='true' from fp_receipt where step=1),'saved without evidence or confirmation');
select pg_temp.fp_assert(public.admin_get_claim_fee_policy()-'updatedAt'=(select value-'updatedAt' from fp_receipt where step=1),'readback matches the saved policy');
-- 3. 같은 작업 번호로 다시 보내면 처음 결과를 돌려주고 한 번만 저장된다. 내용이 다르면 거절한다.
select pg_temp.fp_assert(pg_temp.fp_save('{"enabled":true,"returnAmount":3000,"exchangeAmount":6000}',1,1)=(select value from fp_receipt where step=1),'same operation returns the first receipt');
select pg_temp.fp_assert(public.admin_get_claim_fee_policy()->>'revision'='2','replay saved once');
select pg_temp.fp_error($q$select pg_temp.fp_save('{"enabled":true,"returnAmount":4000,"exchangeAmount":6000}',1,1)$q$,'PT409');
-- 4. 다른 사람이 먼저 바꾼 뒤(옛 revision)에는 저장하지 않는다.
select pg_temp.fp_error($q$select pg_temp.fp_save('{"enabled":true,"returnAmount":4000,"exchangeAmount":6000}',1,2)$q$,'claim_fee_changed');
-- 5. 근거와 확인 체크를 보내는 옛 호출도 그대로 저장되고, 근거는 앞뒤 공백을 떼어 남는다.
insert into fp_receipt select 5,pg_temp.fp_save('{"enabled":true,"returnAmount":3500,"exchangeAmount":null,"evidence":"  TEST 옛 화면 근거  ","confirmed":true}',2,3);
select pg_temp.fp_assert((select value->>'returnAmount'='3500' and value->'exchangeAmount'='null'::jsonb and value->>'evidence'='TEST 옛 화면 근거' and value->>'revision'='3' from fp_receipt where step=5),'old call with evidence still saves');
-- 6. 근거를 보내지 않거나 비워 보내면 저장돼 있던 근거가 그대로 남는다.
insert into fp_receipt select 6,pg_temp.fp_save('{"enabled":false,"returnAmount":null,"exchangeAmount":null}',3,4);
select pg_temp.fp_assert((select value->>'enabled'='false' and value->'returnAmount'='null'::jsonb and value->>'evidence'='TEST 옛 화면 근거' and value->>'revision'='4' from fp_receipt where step=6),'evidence kept when not sent');
insert into fp_receipt select 7,pg_temp.fp_save('{"enabled":false,"returnAmount":1,"exchangeAmount":1000000,"evidence":null,"confirmed":null}',4,5);
select pg_temp.fp_assert((select value->>'returnAmount'='1' and value->>'exchangeAmount'='1000000' and value->>'evidence'='TEST 옛 화면 근거' and value->>'revision'='5' from fp_receipt where step=7),'evidence kept when sent as null');
insert into fp_receipt select 8,pg_temp.fp_save('{"enabled":false,"returnAmount":null,"exchangeAmount":null,"evidence":"   ","confirmed":false}',5,6);
select pg_temp.fp_assert((select value->>'evidence'='TEST 옛 화면 근거' and value->>'revision'='6' from fp_receipt where step=8),'evidence kept when sent blank');
-- 7. 금액·형식 검증은 그대로다(모두 22023, 저장되지 않는다).
do $$declare v jsonb;begin
 foreach v in array array[
  '{"enabled":true,"returnAmount":3000}','{"enabled":true,"returnAmount":3000,"exchangeAmount":null,"autoCharge":true}','{"returnAmount":3000,"exchangeAmount":null}',
  '{"enabled":"true","returnAmount":3000,"exchangeAmount":null}','{"enabled":null,"returnAmount":3000,"exchangeAmount":null}',
  '{"enabled":true,"returnAmount":0,"exchangeAmount":null}','{"enabled":true,"returnAmount":-1,"exchangeAmount":null}','{"enabled":true,"returnAmount":1000001,"exchangeAmount":null}',
  '{"enabled":true,"returnAmount":"3000","exchangeAmount":null}','{"enabled":true,"returnAmount":3000.5,"exchangeAmount":null}','{"enabled":true,"returnAmount":true,"exchangeAmount":null}',
  '{"enabled":true,"returnAmount":null,"exchangeAmount":0}','{"enabled":true,"returnAmount":null,"exchangeAmount":1000001}','{"enabled":true,"returnAmount":null,"exchangeAmount":"6000"}',
  '{"enabled":true,"returnAmount":null,"exchangeAmount":null,"evidence":1}','{"enabled":true,"returnAmount":null,"exchangeAmount":null,"evidence":["a"]}',
  '{"enabled":true,"returnAmount":null,"exchangeAmount":null,"confirmed":"yes"}','{"enabled":true,"returnAmount":null,"exchangeAmount":null,"confirmed":1}',
  '[]','"x"','null']::jsonb[]
  ||jsonb_build_object('enabled',true,'returnAmount',null,'exchangeAmount',null,'evidence',repeat('가',1001))
  ||jsonb_build_object('enabled',true,'returnAmount',null,'exchangeAmount',null,'evidence','줄'||chr(10)||'바꿈') loop
  begin perform pg_temp.fp_save(v,6,7);raise exception 'Expected claim fee policy rejection: %',left(v::text,120);
  exception when invalid_parameter_value then null;end;
 end loop;
 begin perform pg_temp.fp_save(null,6,7);raise exception 'Expected claim fee policy rejection: SQL null values';exception when invalid_parameter_value then null;end;
 begin perform pg_temp.fp_save('{"enabled":true,"returnAmount":null,"exchangeAmount":null}',0,7);raise exception 'Expected claim fee policy rejection: revision 0';exception when invalid_parameter_value then null;end;
 begin perform pg_temp.fp_save('{"enabled":true,"returnAmount":null,"exchangeAmount":null}',null,7);raise exception 'Expected claim fee policy rejection: revision null';exception when invalid_parameter_value then null;end;
 begin perform public.admin_save_claim_fee_policy('{"enabled":true,"returnAmount":null,"exchangeAmount":null}',6,null,pg_temp.fp_id('user',1),pg_temp.fp_id('session',1));
  raise exception 'Expected claim fee policy rejection: operation null';exception when invalid_parameter_value then null;end;
end $$;
-- 근거는 1000자까지 받는다(전과 같은 길이 제한).
insert into fp_receipt select 9,pg_temp.fp_save(jsonb_build_object('enabled',false,'returnAmount',null,'exchangeAmount',null,'evidence',repeat('가',1000)),6,8);
select pg_temp.fp_assert((select char_length(value->>'evidence')=1000 and value->>'revision'='7' from fp_receipt where step=9),'evidence still accepted up to 1000 chars');
select pg_temp.fp_assert(public.admin_get_claim_fee_policy()->>'revision'='7','rejected values did not save');
-- 8. 권한: 다른 로그인(세션)이나 일반 회원은 저장할 수 없다.
select pg_temp.fp_error($q$select public.admin_save_claim_fee_policy('{"enabled":false,"returnAmount":null,"exchangeAmount":null}',7,pg_temp.fp_id('op',9),pg_temp.fp_id('user',1),pg_temp.fp_id('session',2))$q$,'42501');
select pg_temp.fp_error($q$select public.admin_save_claim_fee_policy('{"enabled":false,"returnAmount":null,"exchangeAmount":null}',7,pg_temp.fp_id('op',9),pg_temp.fp_id('user',2),pg_temp.fp_id('session',2))$q$,'42501');
reset role;
select pg_temp.fp_login(2);
set local role authenticated;
select pg_temp.fp_error($q$select pg_temp.fp_save('{"enabled":false,"returnAmount":null,"exchangeAmount":null}',7,9,2)$q$,'42501');
select pg_temp.fp_error($q$select public.admin_get_claim_fee_policy()$q$,'42501');
reset role;
-- 9. 입금 받을 계좌가 없으면 켤 수 없다. 끄는 저장은 된다.
update public.store_settings set bank_transfer='{}' where singleton;
select pg_temp.fp_login(1);
set local role authenticated;
select pg_temp.fp_error($q$select pg_temp.fp_save('{"enabled":true,"returnAmount":3000,"exchangeAmount":null}',7,10)$q$,'claim_fee_account_missing');
insert into fp_receipt select 10,pg_temp.fp_save('{"enabled":false,"returnAmount":3000,"exchangeAmount":null}',7,11);
select pg_temp.fp_assert((select value->>'enabled'='false' and value->>'accountReady'='false' and value->>'revision'='8' from fp_receipt where step=10),'disabled policy saves without a receiving account');
reset role;
-- 10. 저장한 값과 감사 기록: 성공한 저장마다 한 줄(재시도·거절은 남지 않는다), 누가·무엇으로 바꿨는지가 남는다.
select pg_temp.fp_assert((select revision=8 and not enabled and return_amount=3000 and exchange_amount is null and char_length(evidence)=1000 from private.claim_fee_policy where singleton),'stored policy');
select pg_temp.fp_assert((select count(*)=7 and bool_and(actor_id=pg_temp.fp_id('user',1) and target='claim_fee' and diff ? 'request' and diff ? 'result') from public.audit_log
 where action='admin.claim_fee.policy' and id in(select pg_temp.fp_id('op',n) from generate_series(1,11)n)),'one audit row per successful save');
select pg_temp.fp_assert((select diff#>>'{request,values,returnAmount}'='3000' and diff#>>'{result,revision}'='2' and not diff#>'{request,values}' ? 'evidence' from public.audit_log where id=pg_temp.fp_id('op',1)),'audit keeps the request and result');
rollback;
