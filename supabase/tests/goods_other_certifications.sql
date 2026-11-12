\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql in the same connection. Everything rolls back.
-- SHEET-014(ADR-0036): 기타 인증(종류·인증기관·인증번호·고객 노출 여부) 여러 건 — 원본은 private, 고객에게는
-- 노출을 고른 항목의 종류·인증기관·인증번호만 goods.other_certification_disclosures로 나간다.
begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_oc_error(statement text,expected_message text,expected_code text default null)
returns void language plpgsql as $$ begin
  begin execute statement;
  exception when others then
    if position(expected_message in sqlerrm)=0 or (expected_code is not null and sqlstate<>expected_code) then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %',expected_message;
end $$;

-- 봉인: 원본 표와 helper는 브라우저 롤이 못 쓰고, RPC는 authenticated만 실행한다.
select 1/case when not exists(
  select 1 from unnest(array['anon','authenticated','service_role']) r
  where has_table_privilege(r,'private.goods_other_certifications','select,insert,update,delete,truncate,references,trigger'))
 and (select relrowsecurity from pg_class where oid='private.goods_other_certifications'::regclass)
 and not exists(select 1 from pg_proc p cross join unnest(array['anon','authenticated','service_role']) r
  where p.oid in('private.normalize_goods_other_certifications(jsonb)'::regprocedure,'private.goods_other_certification_disclosures(text)'::regprocedure,
    'private.guard_goods_other_certification_disclosures()'::regprocedure) and has_function_privilege(r,p.oid,'execute'))
 and has_function_privilege('authenticated','public.admin_read_goods_other_certifications(text)','execute')
 and has_function_privilege('authenticated','public.admin_save_goods_other_certifications(text,jsonb,integer)','execute')
 and not has_function_privilege('anon','public.admin_read_goods_other_certifications(text)','execute')
 and not has_function_privilege('anon','public.admin_save_goods_other_certifications(text,jsonb,integer)','execute')
 and not has_function_privilege('service_role','public.admin_save_goods_other_certifications(text,jsonb,integer)','execute')
 and exists(select 1 from private.operator_rpc_contracts where signature='public.admin_read_goods_other_certifications(text)' and capability='catalog.read' and guard_kind='read')
 and exists(select 1 from private.operator_rpc_contracts where signature='public.admin_save_goods_other_certifications(text,jsonb,integer)' and capability='catalog.manage' and guard_kind='write')
 then 1 else 0 end as sealed_storage_and_classified_rpcs;

-- 항목 규칙: 형식·길이·제어 문자는 invalid, 종류·번호가 비면 incomplete, 같은 종류·번호(대소문자 무시)는 duplicate.
do $$ declare invalid jsonb; normalized jsonb; begin
  foreach invalid in array array[
    '{}'::jsonb, '"x"'::jsonb,
    '[{"kind":"전파","agency":"","number":"R-1"}]'::jsonb,
    '[{"kind":"전파","agency":"","number":"R-1","visible":true,"extra":1}]'::jsonb,
    '[{"kind":1,"agency":"","number":"R-1","visible":true}]'::jsonb,
    '[{"kind":"전파","agency":"","number":"R-1","visible":"true"}]'::jsonb,
    jsonb_build_array(jsonb_build_object('kind','전파'||chr(10)||'인증','agency','','number','R-1','visible',true)),
    jsonb_build_array(jsonb_build_object('kind',repeat('가',101),'agency','','number','R-1','visible',true)),
    jsonb_build_array(jsonb_build_object('kind','전파','agency',repeat('가',101),'number','R-1','visible',true)),
    (select jsonb_agg(jsonb_build_object('kind','전파','agency','','number','R-'||n,'visible',true)) from generate_series(1,21) n)
  ] loop
    begin perform private.normalize_goods_other_certifications(invalid); raise exception 'accepted invalid entries %',invalid;
    exception when check_violation then if sqlerrm<>'invalid_goods_other_certifications' then raise; end if; end;
  end loop;
  foreach invalid in array array[
    jsonb_build_array(jsonb_build_object('kind',E' \t'||chr(160),'agency','기관','number','R-1','visible',true)),
    jsonb_build_array(jsonb_build_object('kind','전파','agency','기관','number',chr(12288),'visible',true))
  ] loop
    begin perform private.normalize_goods_other_certifications(invalid); raise exception 'accepted incomplete entry %',invalid;
    exception when check_violation then if sqlerrm<>'goods_other_certification_incomplete' then raise; end if; end;
  end loop;
  begin
    perform private.normalize_goods_other_certifications('[{"kind":"KS","agency":"","number":"ab-1","visible":true},{"kind":"ks","agency":"다른 기관","number":"AB-1","visible":false}]');
    raise exception 'accepted duplicate entry';
  exception when check_violation then if sqlerrm<>'goods_other_certification_duplicate' then raise; end if; end;
  normalized:=private.normalize_goods_other_certifications(jsonb_build_array(
    jsonb_build_object('kind',chr(160)||' 방송통신기자재 적합성평가 ','agency',E'\t국립전파연구원 ','number',' R-R-TEST-0001'||chr(65279),'visible',true)));
  if normalized<>'[{"kind":"방송통신기자재 적합성평가","agency":"국립전파연구원","number":"R-R-TEST-0001","visible":true}]'::jsonb then
    raise exception 'normalization mismatch: %',normalized;
  end if;
  if private.normalize_goods_other_certifications('[]')<>'[]'::jsonb then raise exception 'empty list must stay empty'; end if;
end $$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('98060000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','other-cert-'||n||'@example.test',now(),'{}','{}' from generate_series(1,3) n;
update public.profiles set role='staff',nickname='기타인증'||right(id::text,1) where id::text like '98060000-0000-4000-8000-00000000000%' and id<>'98060000-0000-4000-8000-000000000003';
insert into private.operator_memberships(profile_id,manager_role) values
 ('98060000-0000-4000-8000-000000000001','primary'),('98060000-0000-4000-8000-000000000002','logistics');
update private.operator_access_state set configured=true where id;
insert into public.verticals(key,label,color) values('other-cert-tests','기타 인증 합성검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('other-cert-tests','기타 인증 합성검증','other-cert-tests',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active)
 values('00000000-0000-4000-8000-000000140030','other-cert-tests','합성 출고지','hanjin',3000,30000,'배송 금지 검증 주소',true);
insert into public.goods(id,ip_id,name,type,price,origin_id,notice_maker,notice_origin,notice_material,
 notice_size,notice_made_on,notice_as_manager,notice_as_contact) values
 ('other-cert-good','other-cert-tests','합성 기타 인증 상품','문구',1000,'00000000-0000-4000-8000-000000140030',
  '합성 제조자','합성 국가','합성 소재','합성 크기','2026-11','합성 CS','02-000'),
 ('other-cert-archived','other-cert-tests','합성 보관 상품','문구',1000,'00000000-0000-4000-8000-000000140030',
  '합성 제조자','합성 국가','합성 소재','합성 크기','2026-11','합성 CS','02-000');
-- 새 상품은 projection을 직접 넣어도 빈 목록으로 시작한다(복사·일반 writer 포함).
insert into public.goods(id,ip_id,name,type,price,other_certification_disclosures)
 values('other-cert-insert','other-cert-tests','합성 직접 입력','문구',1000,'[{"kind":"주입","agency":"","number":"INJECTED"}]');
select 1/case when (select other_certification_disclosures='[]' from public.goods where id='other-cert-insert') then 1 else 0 end
 as insert_cannot_supply_projection;
update public.goods set archived_at=now() where id='other-cert-archived';
-- KC fixture의 합성 검토자도 상품 관리 권한이 필요하다(설정된 운영자 접근).
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}' from public.goods where id='other-cert-good';
update public.profiles set role='staff' where id=(select ('47c47700'||left(md5(id),24))::uuid from public.goods where id='other-cert-good');
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id='other-cert-good';

select jsonb_build_array(
  jsonb_build_object('kind','방송통신기자재 적합성평가','agency','국립전파연구원','number','R-R-TEST-0001','visible',true),
  jsonb_build_object('kind','내부 보관 인증','agency','','number','INTERNAL-TEST-1','visible',false)) as entries \gset

set local role authenticated;
-- 권한: 상품 조회·관리 권한이 없는 운영자(물류)·구매자는 읽지도 쓰지도 못한다.
select set_config('request.jwt.claim.sub','98060000-0000-4000-8000-000000000002',true);
select pg_temp.expect_oc_error($sql$select public.admin_read_goods_other_certifications('other-cert-good')$sql$,'operator_capability_required','42501');
select pg_temp.expect_oc_error(format('select public.admin_save_goods_other_certifications(%L,%L::jsonb,null)','other-cert-good',:'entries'),
  'operator_capability_required','42501');
select set_config('request.jwt.claim.sub','98060000-0000-4000-8000-000000000003',true);
select pg_temp.expect_oc_error($sql$select public.admin_read_goods_other_certifications('other-cert-good')$sql$,'operator_capability_required','42501');

select set_config('request.jwt.claim.sub','98060000-0000-4000-8000-000000000001',true);
select public.admin_read_goods_other_certifications('other-cert-good') as initial \gset
select 1/case when :'initial'::jsonb->'revision'='null'::jsonb and :'initial'::jsonb->'entries'='[]'::jsonb
 and :'initial'::jsonb->'publishedAt'='null'::jsonb then 1 else 0 end as initial_empty;
select pg_temp.expect_oc_error($sql$select public.admin_read_goods_other_certifications('other-cert-missing')$sql$,'good_not_found');
select pg_temp.expect_oc_error(format('select public.admin_save_goods_other_certifications(%L,%L::jsonb,null)','other-cert-archived',:'entries'),
  'catalog_item_archived','23514');
select pg_temp.expect_oc_error(format('select public.admin_save_goods_other_certifications(%L,%L::jsonb,null)','other-cert-good',
  '[{"kind":"전파","agency":"","number":"","visible":true}]'),'goods_other_certification_incomplete','23514');
select pg_temp.expect_oc_error(format('select public.admin_save_goods_other_certifications(%L,%L::jsonb,3)','other-cert-good',:'entries'),
  'goods_other_certifications_changed','PT409');

-- 저장: 두 건 중 고객 노출을 고른 한 건만 고객 열에 나간다. 감사 기록에 전후 값이 남는다.
select public.admin_save_goods_other_certifications('other-cert-good',:'entries'::jsonb,null) as saved \gset
select 1/case when (:'saved'::jsonb->>'changed')::boolean and :'saved'::jsonb#>>'{configuration,revision}'='1'
 and jsonb_array_length(:'saved'::jsonb#>'{configuration,entries}')=2
 and :'saved'::jsonb#>>'{configuration,updatedByName}'='기타인증1' then 1 else 0 end as saved_two_entries;
select 1/case when (select other_certification_disclosures from public.goods where id='other-cert-good')
  ='[{"kind":"방송통신기자재 적합성평가","agency":"국립전파연구원","number":"R-R-TEST-0001"}]'::jsonb
 then 1 else 0 end as only_visible_entry_is_public;
-- 같은 입력은 버전·감사를 늘리지 않는다. 이전 버전으로 다시 저장하면 충돌이다.
select public.admin_save_goods_other_certifications('other-cert-good',:'entries'::jsonb,1) as unchanged \gset
select 1/case when not (:'unchanged'::jsonb->>'changed')::boolean and :'unchanged'::jsonb#>>'{configuration,revision}'='1' then 1 else 0 end
 as unchanged_save_is_noop;
select pg_temp.expect_oc_error(format('select public.admin_save_goods_other_certifications(%L,%L::jsonb,null)','other-cert-good','[]'),
  'goods_other_certifications_changed','PT409');
reset role;
select 1/case when (select count(*) from public.audit_log where target='goods:other-cert-good' and action='admin.good.other_certifications_saved')=1
 and exists(select 1 from public.audit_log where target='goods:other-cert-good' and action='admin.good.other_certifications_saved'
   and actor_id='98060000-0000-4000-8000-000000000001' and diff->'before'='[]'::jsonb and jsonb_array_length(diff->'after')=2
   and diff->>'revision'='1')
 then 1 else 0 end as single_audit_with_before_after;

-- 고객 열은 어떤 직접 갱신으로도 바꿀 수 없다(트리거가 원본에서 다시 계산한다). 고객(익명)은 노출 항목만 읽는다.
update public.goods set other_certification_disclosures='[{"kind":"주입","agency":"","number":"INJECTED"}]' where id='other-cert-good';
select 1/case when (select other_certification_disclosures::text not like '%INJECTED%' and jsonb_array_length(other_certification_disclosures)=1
 from public.goods where id='other-cert-good') then 1 else 0 end as projection_not_writable;
set local role anon;
select 1/case when (select other_certification_disclosures#>>'{0,number}'='R-R-TEST-0001'
  and other_certification_disclosures::text not like '%INTERNAL-TEST-1%' and other_certification_disclosures::text not like '%visible%'
 from public.goods where id='other-cert-good') then 1 else 0 end as anon_reads_only_visible_projection;
select pg_temp.expect_oc_error($sql$select * from private.goods_other_certifications$sql$,'permission denied','42501');
reset role;

-- 공개 중에도 고칠 수 있다(공개 조건이 아니고 KC 잠금 대상이 아니다). 고객 열이 바로 바뀐다.
select pg_temp.publish_goods_kc_fixture('other-cert-good');
set local role authenticated;
select set_config('request.jwt.claim.sub','98060000-0000-4000-8000-000000000001',true);
select public.admin_save_goods_other_certifications('other-cert-good',jsonb_build_array(
  jsonb_set(:'entries'::jsonb->0,'{visible}','false'),jsonb_set(:'entries'::jsonb->1,'{visible}','true')),1) as published_edit \gset
select 1/case when :'published_edit'::jsonb#>>'{configuration,revision}'='2' and :'published_edit'::jsonb#>>'{configuration,publishedAt}' is not null
 and (select published_at is not null and other_certification_disclosures='[{"kind":"내부 보관 인증","agency":"","number":"INTERNAL-TEST-1"}]'::jsonb
   and jsonb_array_length(kc_disclosures)=1 from public.goods where id='other-cert-good')
 then 1 else 0 end as published_edit_updates_projection_without_touching_kc;
-- 모두 지우면 고객 열도 빈다.
select public.admin_save_goods_other_certifications('other-cert-good','[]',2);
select 1/case when (select other_certification_disclosures='[]' from public.goods where id='other-cert-good')
 and public.admin_read_goods_other_certifications('other-cert-good')->>'revision'='3' then 1 else 0 end as clearing_empties_projection;
reset role;

-- 등록 화면 원자 저장: otherCertifications 섹션이 같은 트랜잭션에 저장되고, 실패하면 상품까지 남지 않는다.
create function pg_temp.oc_workspace(p_operation uuid,p_id text,p_sections jsonb) returns jsonb language sql as $$
  select jsonb_build_object('operationId',p_operation,'draft',null,'sections',p_sections,'good',jsonb_build_object(
    'id',p_id,'ip_id','other-cert-tests','name','합성 등록 '||p_id,'type','문구','price',10000,'variant_baseline','[]'::jsonb,
    'variants',jsonb_build_array(
      jsonb_build_object('name','빨강','code','','attributes',jsonb_build_object('색상','빨강'),'extraPrice',0,'stockQty',1),
      jsonb_build_object('name','파랑','code','','attributes',jsonb_build_object('색상','파랑'),'extraPrice',0,'stockQty',0))));
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','98060000-0000-4000-8000-000000000001',true);
select public.admin_save_good_workspace(pg_temp.oc_workspace('14000000-0000-4000-8000-000000000001','other-cert-created',
  jsonb_build_object('otherCertifications',jsonb_build_object('entries',:'entries'::jsonb,'expectedRevision',null)))) as created \gset
select 1/case when :'created'::jsonb#>>'{otherCertifications,revision}'='1' and (:'created'::jsonb#>>'{otherCertifications,changed}')::boolean
 and :'created'::jsonb->'kc'='null'::jsonb
 and (select jsonb_array_length(other_certification_disclosures)=1 and published_at is null from public.goods where id='other-cert-created')
 then 1 else 0 end as workspace_saves_other_certifications;
-- 같은 작업의 재시도는 처음 결과를 돌려준다(두 번 저장하지 않는다).
select public.admin_save_good_workspace(pg_temp.oc_workspace('14000000-0000-4000-8000-000000000001','other-cert-created',
  jsonb_build_object('otherCertifications',jsonb_build_object('entries',:'entries'::jsonb,'expectedRevision',null)))) as replayed \gset
select 1/case when (:'replayed'::jsonb->>'replayed')::boolean
 and public.admin_read_goods_other_certifications('other-cert-created')->>'revision'='1' then 1 else 0 end as workspace_replay_keeps_revision;
select pg_temp.expect_oc_error(format('select public.admin_save_good_workspace(%L::jsonb)',pg_temp.oc_workspace('14000000-0000-4000-8000-000000000002',
  'other-cert-rollback',jsonb_build_object('otherCertifications',jsonb_build_object('entries','[{"kind":"전파","agency":"","number":" ","visible":true}]'::jsonb,
  'expectedRevision',null)))::text),'goods_other_certification_incomplete','23514');
select pg_temp.expect_oc_error(format('select public.admin_save_good_workspace(%L::jsonb)',pg_temp.oc_workspace('14000000-0000-4000-8000-000000000003',
  'other-cert-stale',jsonb_build_object('otherCertifications',jsonb_build_object('entries',:'entries'::jsonb,'expectedRevision',1)))::text),
  'goods_other_certifications_changed','PT409');
select pg_temp.expect_oc_error(format('select public.admin_save_good_workspace(%L::jsonb)',pg_temp.oc_workspace('14000000-0000-4000-8000-000000000004',
  'other-cert-shape',jsonb_build_object('otherCertifications',jsonb_build_object('entries',:'entries'::jsonb)))::text),
  'invalid_goods_workspace_request','22023');
select pg_temp.expect_oc_error(format('select public.admin_save_good_workspace(%L::jsonb)',pg_temp.oc_workspace('14000000-0000-4000-8000-000000000005',
  'other-cert-array',jsonb_build_object('otherCertifications',:'entries'::jsonb))::text),
  'invalid_goods_workspace_request','22023');
reset role;
select 1/case when not exists(select 1 from public.goods where id in ('other-cert-rollback','other-cert-stale','other-cert-shape','other-cert-array'))
 and not exists(select 1 from private.goods_other_certifications where good_id in ('other-cert-rollback','other-cert-stale'))
 then 1 else 0 end as workspace_failure_rolls_back_goods;
select 1/case when exists(select 1 from public.audit_log where target='goods:other-cert-created' and action='admin.good.workspace_saved'
   and diff->>'otherCertifications'='2')
 then 1 else 0 end as workspace_audit_counts_entries;
-- 한 번도 공개하지 않은 상품의 URL(id)을 바꿔도 기록과 고객 열이 그대로 따라간다.
update public.goods set id='other-cert-renamed' where id='other-cert-created';
select 1/case when exists(select 1 from private.goods_other_certifications where good_id='other-cert-renamed' and revision=1)
 and (select jsonb_array_length(other_certification_disclosures)=1 from public.goods where id='other-cert-renamed')
 then 1 else 0 end as rename_keeps_entries_and_projection;
rollback;
