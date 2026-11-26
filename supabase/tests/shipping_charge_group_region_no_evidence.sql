\set ON_ERROR_STOP on
-- 배송비 묶음그룹의 지역표를 근거 없이 저장하는 경로 검증(화면이 근거 칸과 확인 체크를 없앤 뒤 보내는 모양 그대로).
-- 이 파일에 딸린 migration은 없다. 근거 검사는 공용 private.assert_shipping_region_policy_complete에서
-- 20261127104000_shipping_region_policy_single_save가 뺐고, 묶음그룹 저장(admin_save_shipping_charge_group)은 그 검사를 함께 쓴다.
-- 본다: 근거가 빈 지역표를 '사용'으로 저장, 받는 지역 없음(noRulesConfirmed)과 지역표 줄 두 모양, 저장돼 있던 근거 유지,
--       지역 설정이 바뀌는 저장의 확인 값(attestRegional)과 최고 관리자 권한은 그대로 요구, 빠진 값은 그대로 거절.
-- 우편번호·금액·근거는 모두 합성 값이다. 준비물은 모두 rollback된다(상품·주문을 만들지 않아 KC 도우미가 필요 없다).
begin;
create function pg_temp.ne_id(n integer) returns uuid language sql immutable as $$select ('a7170000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.ne_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'charge group no-evidence assertion: %',label;end if;raise notice 'PASS %',label;end $$;
create function pg_temp.ne_error(q text,wanted text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if position(wanted in sqlerrm)>0 then raise notice 'PASS rejected %',wanted;return;end if;raise;end;
 raise exception 'Expected error: %',wanted;
end $$;
create function pg_temp.ne_auth(actor integer default 1,session integer default 11) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',pg_temp.ne_id(actor)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.ne_id(actor),'role','authenticated','session_id',pg_temp.ne_id(session))::text,true);
end $$;
-- 화면이 보내는 지역표: 근거(sourceEvidence)는 키만 있고 비어 있다.
create function pg_temp.ne_region(evidence text default '',rules jsonb default '[]') returns jsonb language sql stable as $$
 select jsonb_build_object('mode','override','policy',jsonb_build_object('carrierCode','hanjin','startsAt',now()-interval '1 day','endsAt',null,
  'openEnded',true,'sourceEvidence',evidence,'unlistedDisposition','standard','noRulesConfirmed',jsonb_array_length(rules)=0,'rules',rules));
$$;
create function pg_temp.ne_values(enabled boolean,regional jsonb,name text default 'TEST 근거 없는 묶음') returns jsonb language sql immutable as $$
 select jsonb_build_object('name',name,'enabled',enabled,'archived',false,'isDefault',false,'calculationMode','min','regional',regional)$$;
create function pg_temp.ne_save(operation integer,group_number integer,revision integer,group_values jsonb,attest boolean,actor integer default 1,session integer default 11)
returns jsonb language plpgsql volatile as $$declare origin jsonb;begin
 origin:=public.admin_list_shipping_charge_groups(pg_temp.ne_id(101),'','all',1,pg_temp.ne_id(actor),pg_temp.ne_id(session))#>'{origins,0}';
 return jsonb_build_object('operationId',pg_temp.ne_id(operation),'command','save','groupId',pg_temp.ne_id(group_number),'expectedRevision',revision,
  'expectedActorId',pg_temp.ne_id(actor),'expectedSessionId',pg_temp.ne_id(session),'originId',origin->'id','originUpdatedAt',origin->'updatedAt',
  'expectedDefaultGroupId',origin->'defaultGroupId','expectedDefaultGroupRevision',origin->'defaultGroupRevision','values',group_values,'attestRegional',attest);
end $$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.ne_id(n),'authenticated','authenticated','charge-no-evidence-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,2)n;
update public.profiles set role=case when id=pg_temp.ne_id(1) then 'admin'::public.user_role else 'staff'::public.user_role end,
 nickname='TEST 근거 '||right(id::text,3),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id in(pg_temp.ne_id(1),pg_temp.ne_id(2));
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.ne_id(1),'primary'),(pg_temp.ne_id(2),'deputy');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values
 (pg_temp.ne_id(11),pg_temp.ne_id(1),now(),now(),now()+interval '1 hour'),(pg_temp.ne_id(12),pg_temp.ne_id(2),now(),now(),now()+interval '1 hour');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active) values
 (pg_temp.ne_id(101),'charge-no-evidence','TEST 근거 없는 출고지','hanjin',3000,50000,'TEST 반송주소',true);
update private.goods_transaction_runtime set enabled=true where singleton;

select pg_temp.ne_auth();
set local role authenticated;
-- 1. 받는 지역 없음 + 빈 근거: '사용'으로 저장된다(확인 값은 화면이 확인창 뒤 true로 보낸다).
select public.admin_save_shipping_charge_group(pg_temp.ne_save(301,201,0,pg_temp.ne_values(true,pg_temp.ne_region()),true)) as saved_empty \gset
select pg_temp.ne_assert(:'saved_empty'::jsonb->>'state'='saved' and (:'saved_empty'::jsonb#>>'{group,enabled}')::boolean
 and :'saved_empty'::jsonb#>>'{group,regional,policy,sourceEvidence}'=''
 and (:'saved_empty'::jsonb#>>'{group,regional,policy,noRulesConfirmed}')::boolean,
 'enabled group override saves without evidence when no region is charged');
-- 2. 지역표 줄 + 빈 근거: 저장되고 줄 금액이 그대로 남는다.
select public.admin_save_shipping_charge_group(pg_temp.ne_save(302,201,1,pg_temp.ne_values(true,pg_temp.ne_region('',
 jsonb_build_array(jsonb_build_object('id',null,'postalFrom','63000','postalTo','63644','addressPrefix','','regionLabel','TEST 제주','disposition','surcharge','amount',3000)))),true)) as saved_rules \gset
select pg_temp.ne_assert(:'saved_rules'::jsonb#>>'{group,revision}'='2' and :'saved_rules'::jsonb#>>'{group,regional,policy,sourceEvidence}'=''
 and :'saved_rules'::jsonb#>>'{group,regional,policy,rules,0,amount}'='3000' and not(:'saved_rules'::jsonb#>>'{group,regional,policy,noRulesConfirmed}')::boolean,
 'enabled group override saves a region table without evidence');
-- 3. 지역 설정이 바뀌는 저장의 확인 값은 그대로 요구한다(화면은 확인창을 거친 저장에만 true를 보낸다).
select pg_temp.ne_error(format('select public.admin_save_shipping_charge_group(%L)',pg_temp.ne_save(303,201,2,pg_temp.ne_values(true,pg_temp.ne_region()),false)),
 'shipping_charge_group_region_confirmation_required');
-- 4. 지역 설정을 그대로 둔 저장은 확인 값 없이 된다(이름만 바꾼다). 저장된 지역표를 그대로 돌려보낸다.
select public.admin_save_shipping_charge_group(pg_temp.ne_save(304,201,2,jsonb_set((:'saved_rules'::jsonb->'group')
 -array['id','originId','revision','versionId','assignedCount','createdAt','updatedAt'],'{name}','"TEST 이름만 바꿈"'),false)) as renamed \gset
select pg_temp.ne_assert(:'renamed'::jsonb#>>'{group,revision}'='3' and :'renamed'::jsonb#>>'{group,name}'='TEST 이름만 바꿈'
 and :'renamed'::jsonb#>'{group,regional}'=:'saved_rules'::jsonb#>'{group,regional}','unchanged region table is saved without confirmation');
-- 5. 빠진 값(적용 시작 없음)은 '사용'으로 저장되지 않고, '사용 안 함'으로는 저장해 둘 수 있다.
select pg_temp.ne_error(format('select public.admin_save_shipping_charge_group(%L)',pg_temp.ne_save(305,202,0,
 pg_temp.ne_values(true,jsonb_set(pg_temp.ne_region(),'{policy,startsAt}','null'),'TEST 빠진 값'),true)),'shipping_region_policy_incomplete');
select public.admin_save_shipping_charge_group(pg_temp.ne_save(306,202,0,
 pg_temp.ne_values(false,jsonb_set(pg_temp.ne_region(),'{policy,startsAt}','null'),'TEST 빠진 값'),true)) as saved_incomplete \gset
select pg_temp.ne_assert(:'saved_incomplete'::jsonb->>'state'='saved' and not(:'saved_incomplete'::jsonb#>>'{group,enabled}')::boolean,'incomplete region table can be kept while not in use');
-- 6. 받는 지역 없음과 지역표 줄은 함께 둘 수 없다(확인 체크를 선택으로 바꿔도 값의 모양은 같다).
select pg_temp.ne_error(format('select public.admin_save_shipping_charge_group(%L)',pg_temp.ne_save(307,203,0,
 pg_temp.ne_values(true,jsonb_set(pg_temp.ne_region(),'{policy,noRulesConfirmed}','false'),'TEST 표 없음'),true)),'shipping_region_policy_incomplete');
-- 7. 근거 키는 계속 받는다. 이전에 적어 둔 근거가 있는 묶음그룹은 화면이 그 값을 그대로 실어 보내 남는다.
select public.admin_save_shipping_charge_group(pg_temp.ne_save(308,204,0,pg_temp.ne_values(true,pg_temp.ne_region('TEST-ONLY 예전에 적은 근거'),'TEST 예전 근거'),true)) as saved_old \gset
select public.admin_save_shipping_charge_group(pg_temp.ne_save(309,204,1,jsonb_set((:'saved_old'::jsonb->'group')
 -array['id','originId','revision','versionId','assignedCount','createdAt','updatedAt'],'{calculationMode}','"max"'),false)) as kept_old \gset
select pg_temp.ne_assert(:'kept_old'::jsonb#>>'{group,regional,policy,sourceEvidence}'='TEST-ONLY 예전에 적은 근거' and :'kept_old'::jsonb#>>'{group,calculationMode}'='max',
 'stored evidence stays when the screen sends it back untouched');
select pg_temp.ne_error(format('select public.admin_save_shipping_charge_group(%L)',jsonb_set(pg_temp.ne_save(310,205,0,pg_temp.ne_values(true,pg_temp.ne_region(),'TEST 키 없음'),true),
 '{values,regional,policy}',(pg_temp.ne_region()->'policy')-'sourceEvidence')),'invalid_shipping_charge_group_region');
-- 8. 지역 설정을 바꾸는 저장은 최고 관리자 권한(platform.manage)을 그대로 요구한다.
select pg_temp.ne_auth(2,12);
select pg_temp.ne_error(format('select public.admin_save_shipping_charge_group(%L)',pg_temp.ne_save(311,206,0,pg_temp.ne_values(true,pg_temp.ne_region(),'TEST 권한'),true,2,12)),
 'operator_capability_required');
reset role;
-- 감사 기록: 지역 설정이 바뀐 저장은 확인을 거친 저장으로 남는다.
select pg_temp.ne_assert((select diff->>'regionalChanged'='true' and diff->>'regionalConfirmed'='true' from public.audit_log where id=pg_temp.ne_id(301))
 and (select diff->>'regionalChanged'='false' and diff->>'regionalConfirmed'='false' from public.audit_log where id=pg_temp.ne_id(304)),
 'audit log keeps whether the regional change was confirmed');
rollback;
