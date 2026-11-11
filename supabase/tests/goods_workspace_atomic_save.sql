\set ON_ERROR_STOP on
-- Prepend supabase/tests/helpers/goods_kc_fixture.sql in the same psql session.
-- 10/27 회의 R13·D6②: 기본 상품 입력·KC·예약판매를 한 트랜잭션으로 저장하는 래퍼.
begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_error(statement text,expected_message text,expected_code text default null)
returns void language plpgsql as $$ begin
  begin execute statement;
  exception when others then
    if position(expected_message in sqlerrm)=0 or (expected_code is not null and sqlstate<>expected_code) then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %',expected_message;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000120001','authenticated','authenticated','workspace-admin@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000120002','authenticated','authenticated','workspace-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000120003','authenticated','authenticated','workspace-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin',nickname='작업관리0001' where id='00000000-0000-4000-8000-000000120001';
update public.profiles set role='staff',nickname='작업운영0002' where id='00000000-0000-4000-8000-000000120002';
update public.profiles set nickname='작업구매0003' where id='00000000-0000-4000-8000-000000120003';
insert into public.verticals(key,label,color) values('workspace-tests','원자 저장 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('workspace-tests','원자 저장 검증','workspace-tests',now());

create function pg_temp.workspace_good(p_id text,p_name text) returns jsonb language sql as $$
  select jsonb_build_object('id',p_id,'ip_id','workspace-tests','name',p_name,'type','문구','price',10000,
    'notice_maker','합성 제조자','notice_origin','합성 국가','notice_material','합성 소재','notice_size','합성 크기',
    'variant_baseline','[]'::jsonb,'variants',jsonb_build_array(
      jsonb_build_object('name','빨강','code','','attributes',jsonb_build_object('색상','빨강'),'extraPrice',0,'stockQty',3),
      jsonb_build_object('name','파랑','code','','attributes',jsonb_build_object('색상','파랑'),'extraPrice',0,'stockQty',0)));
$$;
-- KC 상품 전체 해당 없음(모든 옵션 연결)을 새 옵션의 옵션값 조합으로 참조한다.
create function pg_temp.workspace_kc(p_status text,p_attested boolean,p_revision integer,p_fingerprint text,p_refs jsonb) returns jsonb language sql as $$
  select jsonb_build_object('status',p_status,'attested',p_attested,'expectedRevision',p_revision,'expectedContextFingerprint',p_fingerprint,
    'models',jsonb_build_array(jsonb_build_object('family','other','scheme','not_applicable','productCategory','','modelName','',
      'businessRole','','businessName','','identifier','','publicNote','TEST-ONLY 합성 고시','basis','',
      'evidence',jsonb_build_object('applicability','','certificate','','testReport','','declaration',''),'variantRefs',p_refs)));
$$;
create function pg_temp.workspace_preorder(p_variant jsonb,p_state text) returns jsonb language sql as $$
  select jsonb_build_object('variant',p_variant,'policyId',null,'expectedRevision',null,'values',jsonb_build_object('state',p_state,
    'capacityQty',5,'startsAt',to_jsonb(now()-interval '1 hour'),'endsAt',to_jsonb(now()+interval '1 day'),
    'expectedShipDate',to_jsonb((now() at time zone 'Asia/Seoul')::date+7),'approvalReference','TEST-ONLY 공급 승인 5개'));
$$;
-- 파랑을 '사용 중지'로 등록한다(save_goods_options가 저장과 함께 보관한다).
create function pg_temp.workspace_good_inactive(p_id text,p_name text) returns jsonb language sql as $$
  select jsonb_set(pg_temp.workspace_good(p_id,p_name),'{variants,1,isActive}','false');
$$;
create function pg_temp.workspace_payload(p_operation uuid,p_good jsonb,p_sections jsonb,p_draft jsonb default null) returns jsonb language sql as $$
  select jsonb_build_object('operationId',p_operation,'good',p_good,'draft',p_draft,'sections',p_sections);
$$;
create function pg_temp.workspace_edit_good(p_id text) returns jsonb language sql as $$
  select record->'good'||jsonb_build_object('previous_id',p_id,
    'variant_baseline',(select coalesce(jsonb_agg(value->'id'),'[]') from jsonb_array_elements(record->'variants') where value->>'archived_at' is null),
    'variants',(select jsonb_agg(jsonb_build_object('id',value->'id','name',value->'name','code',value->'code','attributes',value->'attributes',
      'extraPrice',(value->>'price')::integer-(record#>>'{good,price}')::integer,'stockQty',value->'stock_qty',
      'expectedStockQty',value->'stock_qty','isActive',value->>'archived_at' is null,'lowStockThreshold',value->'low_stock_threshold'))
      from jsonb_array_elements(record->'variants')))
  from public.admin_goods_import_records('{}',array[p_id]) record;
$$;

set local role authenticated;
-- 권한: 상품 관리 권한이 없으면 아무것도 쓰지 않는다.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000120003',true);
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  pg_temp.workspace_payload('12000000-0000-4000-8000-000000000001',pg_temp.workspace_good('workspace-denied','권한 없음'),'{}')::text),
  'operator_capability_required','42501');

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000120002',true);
-- 공개는 래퍼에서 하지 않는다.
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  pg_temp.workspace_payload('12000000-0000-4000-8000-000000000002',pg_temp.workspace_good('workspace-publish','공개 요청')||'{"publish":true}','{}')::text),
  'goods_workspace_publish_unsupported','23514');
-- 롤백: 운영자(관리자 아님)의 예약 활성화가 거절되면 기본 상품과 KC도 남지 않는다.
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  pg_temp.workspace_payload('12000000-0000-4000-8000-000000000003',pg_temp.workspace_good('workspace-rollback','롤백 상품'),
    jsonb_build_object('kc',pg_temp.workspace_kc('reviewed',true,null,null,'[{"attributes":{"색상":"빨강"}},{"attributes":{"색상":"파랑"}}]'),
      'preorders',jsonb_build_array(pg_temp.workspace_preorder('{"attributes":{"색상":"파랑"}}','active'))))::text),
  'preorder_admin_required','42501');
-- 롤백: 확인 체크 없는 검토 완료, 해석되지 않는 옵션 참조.
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  pg_temp.workspace_payload('12000000-0000-4000-8000-000000000004',pg_temp.workspace_good('workspace-rollback','롤백 상품'),
    jsonb_build_object('kc',pg_temp.workspace_kc('reviewed',false,null,null,'[{"attributes":{"색상":"빨강"}},{"attributes":{"색상":"파랑"}}]')))::text),
  'goods_kc_attestation_required','23514');
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  pg_temp.workspace_payload('12000000-0000-4000-8000-000000000005',pg_temp.workspace_good('workspace-rollback','롤백 상품'),
    jsonb_build_object('preorders',jsonb_build_array(pg_temp.workspace_preorder('{"attributes":{"색상":"초록"}}','draft'))))::text),
  'goods_workspace_preorder_variant_unresolved','23514');
-- 옵션 참조 해석 실패는 어느 섹션의 참조인지 오류 코드로 구분한다(화면이 그 카드에 안내한다).
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  pg_temp.workspace_payload('12000000-0000-4000-8000-000000000007',pg_temp.workspace_good('workspace-rollback','롤백 상품'),
    jsonb_build_object('kc',pg_temp.workspace_kc('unreviewed',false,null,null,'[{"attributes":{"색상":"초록"}}]')))::text),
  'goods_workspace_kc_variant_unresolved','23514');
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  pg_temp.workspace_payload('12000000-0000-4000-8000-000000000008',pg_temp.workspace_good('workspace-rollback','롤백 상품'),
    jsonb_build_object('kc',pg_temp.workspace_kc('unreviewed',false,null,null,'[{"id":"not-a-uuid"}]')))::text),
  'invalid_goods_workspace_kc_variant','23514');
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  pg_temp.workspace_payload('12000000-0000-4000-8000-000000000009',pg_temp.workspace_good('workspace-rollback','롤백 상품'),
    jsonb_build_object('preorders',jsonb_build_array(pg_temp.workspace_preorder('{"attributes":[]}','draft'))))::text),
  'invalid_goods_workspace_preorder_variant','23514');
-- 신규 등록인데 화면이 KC 버전을 가졌다면 다른 작업의 결과이므로 거절한다.
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  pg_temp.workspace_payload('12000000-0000-4000-8000-000000000006',pg_temp.workspace_good('workspace-rollback','롤백 상품'),
    jsonb_build_object('kc',pg_temp.workspace_kc('unreviewed',false,1,null,'[]')))::text),
  'goods_kc_review_changed','PT409');
reset role;
select 1/case when not exists(select 1 from public.goods where id in ('workspace-rollback','workspace-publish','workspace-denied'))
  and not exists(select 1 from private.goods_workspace_operations)
  and not exists(select 1 from public.audit_log where action='admin.good.workspace_saved')
  then 1 else 0 end as assert_failures_roll_back_everything;

-- 신규 등록: 기본 상품·옵션 + KC 검토 완료(확인 체크) + 새 옵션의 예약 초안을 한 번에 저장한다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000120002',true);
select pg_temp.workspace_payload('12000000-0000-4000-8000-000000000010',pg_temp.workspace_good('workspace-new','원자 저장 상품'),
  jsonb_build_object('kc',pg_temp.workspace_kc('reviewed',true,null,null,'[{"attributes":{"색상":"빨강"}},{"attributes":{"색상":"파랑"}}]'),
    'preorders',jsonb_build_array(pg_temp.workspace_preorder('{"attributes":{"색상":"파랑"}}','draft')))) as new_request \gset
select public.admin_save_good_workspace(:'new_request'::jsonb) as new_result \gset
reset role;
select 1/case when :'new_result'::jsonb->>'id'='workspace-new' and (:'new_result'::jsonb->>'created')::boolean
  and :'new_result'::jsonb#>>'{kc,status}'='reviewed' and jsonb_array_length(:'new_result'::jsonb->'preorders')=1
  and (select status='reviewed' and revision=1 and reviewed_by='00000000-0000-4000-8000-000000120002'
    and models#>'{0,variantIds}'=(select jsonb_agg(id::text order by id) from public.goods_variants where good_id='workspace-new')
    from private.goods_kc_reviews where good_id='workspace-new')
  and (select count(*)=1 from private.goods_preorder_policies p join public.goods_variants v on v.id=p.variant_id
    where v.good_id='workspace-new' and v.attributes='{"색상":"파랑"}' and p.state='draft' and p.capacity_qty=5)
  and (select published_at is null from public.goods where id='workspace-new')
  and (select count(*)=1 from private.goods_workspace_operations where good_id='workspace-new')
  and (select count(*)=1 from public.audit_log where id='12000000-0000-4000-8000-000000000010' and action='admin.good.workspace_saved')
  then 1 else 0 end as assert_new_good_and_sections_saved_together;

-- 재시도: 같은 작업 ID·같은 요청은 저장 결과를 돌려주고 상품을 하나 더 만들지 않는다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000120002',true);
select public.admin_save_good_workspace(:'new_request'::jsonb) as replay_result \gset
-- 같은 작업 ID로 다른 요청(입력 변경)을 보내면 거절한다.
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  jsonb_set(:'new_request'::jsonb,'{good,name}','"바뀐 이름"')::text),'goods_workspace_operation_conflict','PT409');
-- 다른 운영자가 같은 작업 ID를 쓰면 거절한다.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000120001',true);
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',:'new_request'),'goods_workspace_operation_conflict','PT409');
reset role;
select 1/case when (:'replay_result'::jsonb->>'replayed')::boolean and :'replay_result'::jsonb->>'id'='workspace-new'
  and (select count(*)=1 from public.goods where name='원자 저장 상품')
  and (select count(*)=1 from private.goods_preorder_policies p join public.goods_variants v on v.id=p.variant_id where v.good_id='workspace-new')
  and (select revision=1 from private.goods_kc_reviews where good_id='workspace-new')
  then 1 else 0 end as assert_retry_returns_receipt_without_duplicate;

-- 수정: 상품명 변경이 KC 검토를 무효화해도, 화면이 본 버전(저장 전)이 맞으면 새 버전으로 다시 검토 완료한다.
select revision as kc_revision, private.goods_kc_fingerprint('workspace-new') as kc_fingerprint
  from private.goods_kc_reviews where good_id='workspace-new' \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000120002',true);
select pg_temp.workspace_edit_good('workspace-new') as edit_good \gset
select (select jsonb_agg(jsonb_build_object('id',id) order by id) from public.goods_variants where good_id='workspace-new') as edit_refs \gset
select public.admin_save_good_workspace(pg_temp.workspace_payload('12000000-0000-4000-8000-000000000011',
  :'edit_good'::jsonb||'{"name":"원자 저장 상품 수정"}',
  jsonb_build_object('kc',pg_temp.workspace_kc('reviewed',true,:'kc_revision'::integer,:'kc_fingerprint',:'edit_refs'::jsonb)))) as edit_result \gset
reset role;
select 1/case when not (:'edit_result'::jsonb->>'created')::boolean and :'edit_result'::jsonb#>>'{kc,status}'='reviewed'
  and (select name='원자 저장 상품 수정' from public.goods where id='workspace-new')
  and (select status='reviewed' and revision=3 from private.goods_kc_reviews where good_id='workspace-new')
  and (select array_agg(reason order by revision)=array['review_completed','goods_context_changed','review_completed']
    from private.goods_kc_review_events where good_id='workspace-new')
  then 1 else 0 end as assert_edit_reviews_again_after_invalidation;

-- 수정: 화면이 본 KC 버전이 낡았으면 기본 입력까지 되돌린다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000120002',true);
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  pg_temp.workspace_payload('12000000-0000-4000-8000-000000000012',pg_temp.workspace_edit_good('workspace-new')||'{"name":"반영되면 안 되는 이름"}',
    jsonb_build_object('kc',pg_temp.workspace_kc('reviewed',true,:'kc_revision'::integer,:'kc_fingerprint',:'edit_refs'::jsonb)))::text),
  'goods_kc_review_changed','PT409');
reset role;
select 1/case when (select name='원자 저장 상품 수정' from public.goods where id='workspace-new')
  and (select revision=3 from private.goods_kc_reviews where good_id='workspace-new')
  then 1 else 0 end as assert_stale_kc_rolls_back_goods;

-- 관리자는 등록과 함께 예약을 활성화할 수 있다(판매기간 없음, 승인 조건 완비).
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000120001',true);
select public.admin_save_good_workspace(pg_temp.workspace_payload('12000000-0000-4000-8000-000000000020',pg_temp.workspace_good('workspace-active','예약 활성 상품'),
  jsonb_build_object('preorders',jsonb_build_array(pg_temp.workspace_preorder('{"attributes":{"색상":"파랑"}}','active'))))) as active_result \gset
reset role;
select 1/case when (select p.state='active' and v.preorder_policy_id=p.id from private.goods_preorder_policies p
    join public.goods_variants v on v.id=p.variant_id where v.good_id='workspace-active')
  and not exists(select 1 from private.goods_kc_reviews where good_id='workspace-active')
  then 1 else 0 end as assert_admin_activates_preorder_with_new_good;

-- 서버 임시저장으로 등록: 임시저장 완료와 섹션이 함께 저장된다. 같은 임시저장을 다른 작업 ID(다른 탭)로 다시 보내면
-- 섹션 없는 저장은 등록 결과를 돌려주고, 섹션을 실은 저장은 그 섹션이 저장되지 않으므로 성공으로 알리지 않고 거절한다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000120002',true);
select public.admin_save_goods_draft('12000000-0000-4000-8000-0000000000d1','{"name":"임시저장 원자 상품"}',0);
select public.admin_save_good_workspace(pg_temp.workspace_payload('12000000-0000-4000-8000-000000000030',pg_temp.workspace_good('workspace-draft','임시저장 원자 상품'),
  jsonb_build_object('preorders',jsonb_build_array(pg_temp.workspace_preorder('{"attributes":{"색상":"빨강"}}','draft'))),
  '{"id":"12000000-0000-4000-8000-0000000000d1","revision":1}')) as draft_result \gset
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  pg_temp.workspace_payload('12000000-0000-4000-8000-000000000031',pg_temp.workspace_good('workspace-draft','임시저장 원자 상품'),
    jsonb_build_object('kc',pg_temp.workspace_kc('unreviewed',false,null,null,'[{"attributes":{"색상":"빨강"}}]'),
      'preorders',jsonb_build_array(pg_temp.workspace_preorder('{"attributes":{"색상":"파랑"}}','draft'))),
    '{"id":"12000000-0000-4000-8000-0000000000d1","revision":1}')::text),
  'goods_workspace_draft_completed_sections_skipped','PT409');
select public.admin_save_good_workspace(pg_temp.workspace_payload('12000000-0000-4000-8000-000000000032',pg_temp.workspace_good('workspace-draft','임시저장 원자 상품'),
  '{}','{"id":"12000000-0000-4000-8000-0000000000d1","revision":1}')) as draft_replay \gset
reset role;
select 1/case when :'draft_result'::jsonb->>'id'='workspace-draft' and (:'draft_replay'::jsonb->>'draftAlreadyCompleted')::boolean
  and :'draft_replay'::jsonb->>'id'='workspace-draft'
  and (select completed_good_id='workspace-draft' and archived_at is not null from public.admin_goods_drafts where id='12000000-0000-4000-8000-0000000000d1')
  and (select count(*)=1 from private.goods_preorder_policies p join public.goods_variants v on v.id=p.variant_id where v.good_id='workspace-draft')
  and (select v.attributes='{"색상":"빨강"}' from private.goods_preorder_policies p join public.goods_variants v on v.id=p.variant_id where v.good_id='workspace-draft')
  and not exists(select 1 from private.goods_kc_reviews where good_id='workspace-draft')
  and not exists(select 1 from private.goods_workspace_operations where operation_id='12000000-0000-4000-8000-000000000031')
  and (select count(*)=1 from public.goods where name='임시저장 원자 상품')
  then 1 else 0 end as assert_draft_completion_is_atomic_and_idempotent;

-- 사용 중지 새 옵션: 저장과 함께 보관되지만 기존 독립 패널처럼 KC 모델 연결·예약 초안 대상으로 해석한다.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000120002',true);
select public.admin_save_good_workspace(pg_temp.workspace_payload('12000000-0000-4000-8000-000000000040',pg_temp.workspace_good_inactive('workspace-inactive','사용 중지 옵션 상품'),
  jsonb_build_object('kc',pg_temp.workspace_kc('unreviewed',false,null,null,'[{"attributes":{"색상":"빨강"}},{"attributes":{"색상":"파랑"}}]'),
    'preorders',jsonb_build_array(pg_temp.workspace_preorder('{"attributes":{"색상":"파랑"}}','draft'))))) as inactive_result \gset
reset role;
select 1/case when :'inactive_result'::jsonb->>'id'='workspace-inactive'
  and (select archived_at is not null from public.goods_variants where good_id='workspace-inactive' and attributes='{"색상":"파랑"}')
  and (select models#>'{0,variantIds}'=(select jsonb_agg(id::text order by id) from public.goods_variants where good_id='workspace-inactive')
    from private.goods_kc_reviews where good_id='workspace-inactive')
  and (select count(*)=1 from private.goods_preorder_policies p join public.goods_variants v on v.id=p.variant_id
    where v.good_id='workspace-inactive' and v.attributes='{"색상":"파랑"}' and p.state='draft')
  then 1 else 0 end as assert_inactive_new_option_resolves_for_sections;
-- 이전 저장에서 보관된 옵션은 옵션값 조합으로 찾지 않는다(저장된 옵션은 id로만 가리킨다).
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000120002',true);
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  pg_temp.workspace_payload('12000000-0000-4000-8000-000000000041',pg_temp.workspace_edit_good('workspace-inactive'),
    jsonb_build_object('preorders',jsonb_build_array(pg_temp.workspace_preorder('{"attributes":{"색상":"파랑"}}','draft'))))::text),
  'goods_workspace_preorder_variant_unresolved','23514');
reset role;

-- 접근 경계: 영수증 표는 앱 역할에 열리지 않고, 래퍼는 authenticated만 실행한다.
select 1/case when not has_table_privilege('authenticated','private.goods_workspace_operations','select')
  and not has_function_privilege('anon','public.admin_save_good_workspace(jsonb)','execute')
  and not has_function_privilege('service_role','public.admin_save_good_workspace(jsonb)','execute')
  and has_function_privilege('authenticated','public.admin_save_good_workspace(jsonb)','execute')
  and not has_function_privilege('authenticated','private.resolve_goods_workspace_variant(text,jsonb,uuid[],text)','execute')
  and exists(select 1 from private.operator_rpc_contracts where to_regprocedure(signature)='public.admin_save_good_workspace(jsonb)'::regprocedure
    and capability='catalog.manage' and guard_kind='write')
  then 1 else 0 end as assert_workspace_grants_and_contract;
rollback;
