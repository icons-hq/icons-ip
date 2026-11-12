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
-- 저장된 상품의 공개는 래퍼가 하지 않는다(게시 상태 전환이 맡는다). 새 상품의 '저장 후 공개'는 아래 T15b 절이 본다.
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  pg_temp.workspace_payload('12000000-0000-4000-8000-000000000002',pg_temp.workspace_good('workspace-publish','공개 요청')||'{"publish":true,"previous_id":"workspace-publish"}','{}')::text),
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

-- ---------------------------------------------------------------------------
-- T15b(1027T-024·0901-008): 나머지 설정을 첫 저장에 함께 저장하고, 새 상품도 '저장 후 공개'를 한 요청에서 시도한다.
-- 준비(시스템): 로그인 세션(수령 방식·제작·묶음그룹은 세션에 묶인다), 거래 런타임, 유형 '문구'가 연결된 분류, 확인된 대표 이미지.
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values
 ('12000000-0000-4000-9000-000000000001','00000000-0000-4000-8000-000000120001',now(),now(),now()+interval '1 hour'),
 ('12000000-0000-4000-9000-000000000002','00000000-0000-4000-8000-000000120002',now(),now(),now()+interval '1 hour');
create function pg_temp.workspace_auth(p_actor text,p_session text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub',p_actor,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','authenticated','session_id',p_session)::text,true);
end $$;
update private.goods_transaction_runtime set enabled=true where singleton;
insert into public.catalog_categories(id,code,name,depth,sort_order,good_type)
  values('12000000-0000-4000-8000-0000000c0001','test-workspace-sections','TEST-ONLY 원자 저장 분류',1,0,'문구');
select public.service_prepare_admin_artwork_upload('00000000-0000-4000-8000-000000120002','catalog/good/12000000-0000-4000-8000-0000000a0001.webp','good','image/webp',100,now()+interval '10 minutes');
select * from public.service_begin_admin_artwork_verification('00000000-0000-4000-8000-000000120002','catalog/good/12000000-0000-4000-8000-0000000a0001.webp');
select public.service_verify_admin_artwork_upload('00000000-0000-4000-8000-000000120002','catalog/good/12000000-0000-4000-8000-0000000a0001.webp',100);
select public.service_prepare_admin_artwork_upload('00000000-0000-4000-8000-000000120002','catalog/good/12000000-0000-4000-8000-0000000a0002.webp','good','image/webp',100,now()+interval '10 minutes');
select * from public.service_begin_admin_artwork_verification('00000000-0000-4000-8000-000000120002','catalog/good/12000000-0000-4000-8000-0000000a0002.webp');
select public.service_verify_admin_artwork_upload('00000000-0000-4000-8000-000000120002','catalog/good/12000000-0000-4000-8000-0000000a0002.webp',100);
-- 공개 조건(고시 7칸·대표 이미지·유형이 연결된 대표 분류·출고지)을 모두 채운 새 상품.
create function pg_temp.workspace_complete_good(p_id text,p_name text,p_image text) returns jsonb language sql as $$
  select pg_temp.workspace_good(p_id,p_name)||jsonb_build_object('notice_made_on','2026-11','notice_as_manager','TEST A/S 책임자',
    'notice_as_contact','02-0000-0000','category_id','12000000-0000-4000-8000-0000000c0001',
    'origin_id','00000000-0000-4000-8000-000000042201','shipping_fee_type','policy')
    ||case when p_image is null then '{}'::jsonb else jsonb_build_object('image_path','public-media/catalog/good/'||p_image||'.webp') end;
$$;
create function pg_temp.workspace_kc_done() returns jsonb language sql as $$
  select pg_temp.workspace_kc('reviewed',true,null,null,'[{"attributes":{"색상":"빨강"}},{"attributes":{"색상":"파랑"}}]');
$$;
create function pg_temp.workspace_benefits(p_gift text) returns jsonb language sql as $$
  select jsonb_build_object('eventText','TEST 이벤트','giftText',p_gift,'giftImagePaths','[]'::jsonb);
$$;
create function pg_temp.workspace_after_sales() returns jsonb language sql as $$
  select jsonb_build_object('phone','02-1234-5678','guide','TEST-ONLY A/S 안내','sellerSpecialNotes','');
$$;
create function pg_temp.workspace_production(p_confirmed boolean) returns jsonb language sql as $$
  select jsonb_build_object('enabled',false,'leadDays',null,'dayBasis','calendar','closedDates','[]'::jsonb,'publicNote','',
    'evidence','TEST-ONLY 제작 근거','confirmed',p_confirmed);
$$;

-- 롤백: 섹션 하나라도 실패하면(앞 섹션이 이미 저장됐어도) 기본 상품·KC·앞 섹션까지 아무것도 남지 않고, 실패한 섹션 이름을 알린다.
set local role authenticated;
select pg_temp.workspace_auth('00000000-0000-4000-8000-000000120002','12000000-0000-4000-9000-000000000002');
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  pg_temp.workspace_payload('12000000-0000-4000-8000-000000000110',pg_temp.workspace_complete_good('workspace-section-fail','섹션 실패 상품',null),
    jsonb_build_object('kc',pg_temp.workspace_kc_done(),'benefits',pg_temp.workspace_benefits('TEST 사은품'),'afterSales',pg_temp.workspace_after_sales(),
      'sizeChart',jsonb_build_object('enabled',true,'chart',jsonb_build_object('unit','cm','sizes','[]'::jsonb,'measurements','[]'::jsonb,'note',''))))::text),
  'goods_workspace_section_failed:sizeChart:');
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  pg_temp.workspace_payload('12000000-0000-4000-8000-000000000111',pg_temp.workspace_complete_good('workspace-section-fail','섹션 실패 상품',null),
    jsonb_build_object('benefits',pg_temp.workspace_benefits('TEST 사은품'),'afterSales',pg_temp.workspace_after_sales(),
      'production',pg_temp.workspace_production(false)))::text),
  'goods_workspace_section_failed:production:','22023');
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  pg_temp.workspace_payload('12000000-0000-4000-8000-000000000112',pg_temp.workspace_complete_good('workspace-section-fail','섹션 실패 상품',null),
    jsonb_build_object('benefits',pg_temp.workspace_benefits('TEST 사은품'),
      'listingColors',jsonb_build_array(jsonb_build_object('label','빨강','hex','red'))))::text),
  'goods_workspace_section_failed:listingColors:');
-- 권한 재검사: 매입단가는 관리자(platform.manage)만 저장한다. 운영자가 실어 보내면 그 RPC가 거절하고 전부 되돌린다.
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  pg_temp.workspace_payload('12000000-0000-4000-8000-000000000113',pg_temp.workspace_complete_good('workspace-section-fail','섹션 실패 상품',null),
    jsonb_build_object('benefits',pg_temp.workspace_benefits('TEST 사은품'),
      'purchaseCosts',jsonb_build_array(jsonb_build_object('variant',jsonb_build_object('attributes',jsonb_build_object('색상','빨강')),
        'unitCostKrw',4000,'taxBasis','included'))))::text),
  'goods_workspace_section_failed:purchaseCosts:operator_capability_required','42501');
-- 기간 할인 대상 옵션을 찾지 못하면 섹션을 담아 거절한다.
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  pg_temp.workspace_payload('12000000-0000-4000-8000-000000000114',pg_temp.workspace_complete_good('workspace-section-fail','섹션 실패 상품',null),
    jsonb_build_object('pricePeriods',jsonb_build_array(jsonb_build_object('variant',jsonb_build_object('attributes',jsonb_build_object('색상','초록')),
      'period',jsonb_build_object('state','draft','discountPrice',9000,'startsAt',null,'endsAt',null)))))::text),
  'goods_workspace_section_failed:pricePeriods:goods_workspace_price_period_variant_unresolved');
-- 묶음그룹: 화면이 본 그룹 버전이 지금과 다르면(없는 그룹 포함) 배정 RPC가 거절한다 — 기준값은 래퍼가 지금 저장값으로 만든다.
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  pg_temp.workspace_payload('12000000-0000-4000-8000-000000000115',pg_temp.workspace_complete_good('workspace-section-fail','섹션 실패 상품',null),
    jsonb_build_object('benefits',pg_temp.workspace_benefits('TEST 사은품'),
      'shippingChargeGroup',jsonb_build_object('groupId','12000000-0000-4000-8000-0000000b0099','expectedRevision',1)))::text),
  'goods_workspace_section_failed:shippingChargeGroup:shipping_charge_group_changed','PT409');
-- 나머지 설정은 새 상품의 첫 저장에서만 받는다. 저장된 상품은 같은 자리의 독립 패널이 자기 버전으로 저장한다.
select pg_temp.expect_error(format('select public.admin_save_good_workspace(%L::jsonb)',
  pg_temp.workspace_payload('12000000-0000-4000-8000-000000000116',pg_temp.workspace_edit_good('workspace-new'),
    jsonb_build_object('benefits',pg_temp.workspace_benefits('TEST 사은품')))::text),
  'invalid_goods_workspace_request','22023');
reset role;
select 1/case when not exists(select 1 from public.goods where id='workspace-section-fail')
  and not exists(select 1 from private.goods_benefit_content where good_id='workspace-section-fail')
  and not exists(select 1 from private.goods_after_sales_content where good_id='workspace-section-fail')
  and not exists(select 1 from private.goods_kc_reviews where good_id='workspace-section-fail')
  and not exists(select 1 from private.goods_workspace_operations where operation_id::text like '12000000-0000-4000-8000-00000000011%')
  and not exists(select 1 from private.goods_benefit_content where good_id='workspace-new')
  then 1 else 0 end as assert_section_failure_rolls_back_everything;

-- 관리자: 나머지 설정 13개를 기본 상품·KC와 함께 한 번에 저장한다(묶음그룹은 실제 그룹을 만든 뒤 배정).
-- 추가 구성 대상은 공개 중인 상품이어야 한다(기존 추가 구성 규칙).
select pg_temp.publish_goods_kc_fixture('workspace-new');
set local role authenticated;
select pg_temp.workspace_auth('00000000-0000-4000-8000-000000120001','12000000-0000-4000-9000-000000000001');
select public.admin_list_shipping_charge_groups('00000000-0000-4000-8000-000000042201','','all',1,
  '00000000-0000-4000-8000-000000120001','12000000-0000-4000-9000-000000000001')#>'{origins,0}' as group_origin \gset
select public.admin_save_shipping_charge_group(jsonb_build_object('operationId','12000000-0000-4000-8000-0000000b0001','command','save',
  'groupId','12000000-0000-4000-8000-0000000b0002','expectedRevision',0,'expectedActorId','00000000-0000-4000-8000-000000120001',
  'expectedSessionId','12000000-0000-4000-9000-000000000001','originId',:'group_origin'::jsonb->'id','originUpdatedAt',:'group_origin'::jsonb->'updatedAt',
  'expectedDefaultGroupId',:'group_origin'::jsonb->'defaultGroupId','expectedDefaultGroupRevision',:'group_origin'::jsonb->'defaultGroupRevision',
  'values',jsonb_build_object('name','TEST 원자 저장 묶음','enabled',true,'archived',false,'isDefault',false,'calculationMode','min',
    'regional','{"mode":"inherit","policy":null}'::jsonb),'attestRegional',false)) as group_receipt \gset
select pg_temp.workspace_payload('12000000-0000-4000-8000-000000000120',pg_temp.workspace_complete_good('workspace-all','전부 입력 상품',null),
  jsonb_build_object('kc',pg_temp.workspace_kc_done(),
    'optionSaleMode','select',
    'purchaseCosts',jsonb_build_array(jsonb_build_object('variant',jsonb_build_object('attributes',jsonb_build_object('색상','빨강')),'unitCostKrw',4000,'taxBasis','included')),
    'pricePeriods',jsonb_build_array(jsonb_build_object('variant',jsonb_build_object('attributes',jsonb_build_object('색상','빨강')),
      'period',jsonb_build_object('state','draft','discountPrice',9000,'startsAt',null,'endsAt',null))),
    'additional',jsonb_build_array('workspace-new'),
    'benefits',pg_temp.workspace_benefits('TEST 사은품'),
    'afterSales',pg_temp.workspace_after_sales(),
    'sizeChart',jsonb_build_object('enabled',true,'chart',jsonb_build_object('unit','cm','sizes',jsonb_build_array('S'),
      'measurements',jsonb_build_array(jsonb_build_object('name','가슴','values',jsonb_build_array('50'))),'note','')),
    'listingColors',jsonb_build_array(jsonb_build_object('label','빨강','hex','#ff0000')),
    'transactionTerms',jsonb_build_object('volume',jsonb_build_object('status','draft','terms',null,'draftValues',
      jsonb_build_object('condition','quantity','threshold','2','discountKind','fixed','discountValue','500','startsAt','','endsAt',''))),
    'shippingChargeGroup',jsonb_build_object('groupId','12000000-0000-4000-8000-0000000b0002','expectedRevision',(:'group_receipt'::jsonb#>>'{group,revision}')::integer),
    'subscriptionPolicy',jsonb_build_object('enabled',false,'intervals',jsonb_build_array('month_1'),'message',''),
    'fulfillment',jsonb_build_object('mode','shipping','methods',jsonb_build_array(jsonb_build_object('method','parcel','feeAmount',null,'feeBasis','per_order','installationFee',0)),
      'assetIds','[]'::jsonb,'publicNote','','evidence','TEST-ONLY 수령 근거','confirmed',true),
    'production',pg_temp.workspace_production(true))) as all_request \gset
select public.admin_save_good_workspace(:'all_request'::jsonb) as all_result \gset
-- 재시도: 같은 작업 ID·같은 요청은 영수증을 돌려주고 어떤 섹션도 다시 쓰지 않는다.
select public.admin_save_good_workspace(:'all_request'::jsonb) as all_replay \gset
reset role;
select 1/case when :'all_result'::jsonb->>'id'='workspace-all' and (:'all_result'::jsonb->>'created')::boolean
  and (select array_agg(key order by key) from jsonb_object_keys(:'all_result'::jsonb->'sections') key)
    =array['additional','afterSales','benefits','fulfillment','listingColors','optionSaleMode','pricePeriods','production','purchaseCosts',
      'shippingChargeGroup','sizeChart','subscriptionPolicy','transactionTerms']
  and :'all_result'::jsonb->'publish' is null
  and (select published_at is null and option_sale_mode='select' from public.goods where id='workspace-all')
  and (select status='reviewed' from private.goods_kc_reviews where good_id='workspace-all')
  and (select c.unit_cost_krw=4000 and c.tax_basis='included' and c.revision=1 from private.goods_variant_purchase_costs c
    join public.goods_variants v on v.id=c.variant_id where v.good_id='workspace-all' and v.attributes='{"색상":"빨강"}')
  and (select count(*)=1 from private.goods_variant_price_periods p join public.goods_variants v on v.id=p.variant_id
    where v.good_id='workspace-all' and p.state='draft' and p.discount_price=9000)
  and (select revision=1 from private.goods_additional_sets where good_id='workspace-all')
  and (select gift_text='TEST 사은품' and revision=1 from private.goods_benefit_content where good_id='workspace-all')
  and (select phone='02-1234-5678' and revision=1 from private.goods_after_sales_content where good_id='workspace-all')
  and (select enabled and revision=1 from private.goods_size_charts where good_id='workspace-all')
  and (select revision=1 and jsonb_array_length(colors)=1 from private.goods_listing_colors where good_id='workspace-all')
  and (select revision=1 from private.goods_transaction_configs where good_id='workspace-all')
  and (select group_id='12000000-0000-4000-8000-0000000b0002' from private.shipping_charge_group_assignments where owner_good_id='workspace-all')
  and (select not enabled and revision=1 from private.goods_subscription_policies where good_id='workspace-all')
  and (select mode='shipping' and revision=1 from private.goods_fulfillment_settings where good_id='workspace-all')
  and (select not enabled and revision=1 from private.goods_production_settings where good_id='workspace-all')
  and (:'all_replay'::jsonb->>'replayed')::boolean and (:'all_replay'::jsonb-'replayed')=:'all_result'::jsonb
  and (select count(*)=1 from private.goods_variant_price_periods p join public.goods_variants v on v.id=p.variant_id where v.good_id='workspace-all')
  and (select count(*)=1 from public.goods where name='전부 입력 상품')
  and (select diff->'sections'=jsonb_build_array('additional','afterSales','benefits','fulfillment','listingColors','optionSaleMode','pricePeriods',
      'production','purchaseCosts','shippingChargeGroup','sizeChart','subscriptionPolicy','transactionTerms')
    and not (diff->>'publishRequested')::boolean
    from public.audit_log where id='12000000-0000-4000-8000-000000000120' and action='admin.good.workspace_saved')
  then 1 else 0 end as assert_all_sections_saved_once_and_replayed;

-- 저장 후 공개(새 상품): 공개 조건·KC를 채웠으면 같은 요청에서 공개한다.
set local role authenticated;
select pg_temp.workspace_auth('00000000-0000-4000-8000-000000120002','12000000-0000-4000-9000-000000000002');
select public.admin_save_good_workspace(pg_temp.workspace_payload('12000000-0000-4000-8000-000000000130',
  pg_temp.workspace_complete_good('workspace-publish-ok','저장 후 공개 상품','12000000-0000-4000-8000-0000000a0001')||'{"publish":true}',
  jsonb_build_object('kc',pg_temp.workspace_kc_done(),'benefits',pg_temp.workspace_benefits('TEST 사은품')))) as publish_ok \gset
-- 공개 조건이 비면(대표 이미지 없음) 저장은 남기고 거절 이유를 싣는다. 재시도는 같은 공개 결과를 돌려준다.
select pg_temp.workspace_payload('12000000-0000-4000-8000-000000000131',
  pg_temp.workspace_complete_good('workspace-publish-incomplete','공개 보류 상품',null)||'{"publish":true}',
  jsonb_build_object('kc',pg_temp.workspace_kc_done(),'benefits',pg_temp.workspace_benefits('TEST 사은품'))) as incomplete_request \gset
select public.admin_save_good_workspace(:'incomplete_request'::jsonb) as publish_incomplete \gset
select public.admin_save_good_workspace(:'incomplete_request'::jsonb) as publish_incomplete_replay \gset
-- KC 검토 전이면(미검토로 저장) 공개는 KC 가드가 거절하고 저장은 남는다.
select public.admin_save_good_workspace(pg_temp.workspace_payload('12000000-0000-4000-8000-000000000132',
  pg_temp.workspace_complete_good('workspace-publish-kc','KC 보류 상품','12000000-0000-4000-8000-0000000a0002')||'{"publish":true}',
  jsonb_build_object('kc',pg_temp.workspace_kc('unreviewed',false,null,null,'[{"attributes":{"색상":"빨강"}},{"attributes":{"색상":"파랑"}}]')))) as publish_kc \gset
reset role;
select 1/case when (:'publish_ok'::jsonb#>>'{publish,published}')::boolean
  and (select published_at is not null from public.goods where id='workspace-publish-ok')
  and (select gift_text='TEST 사은품' from private.goods_benefit_content where good_id='workspace-publish-ok')
  and exists(select 1 from public.audit_log where action='admin.good.published' and target='goods:workspace-publish-ok')
  and not (:'publish_incomplete'::jsonb#>>'{publish,published}')::boolean
  and :'publish_incomplete'::jsonb#>>'{publish,error}' like '%goods_publish_incomplete%'
  and (select published_at is null from public.goods where id='workspace-publish-incomplete')
  and (select gift_text='TEST 사은품' from private.goods_benefit_content where good_id='workspace-publish-incomplete')
  and (select status='reviewed' from private.goods_kc_reviews where good_id='workspace-publish-incomplete')
  and (:'publish_incomplete_replay'::jsonb->>'replayed')::boolean
  and :'publish_incomplete_replay'::jsonb->'publish'=:'publish_incomplete'::jsonb->'publish'
  and (select count(*)=1 from public.goods where name='공개 보류 상품')
  and not (:'publish_kc'::jsonb#>>'{publish,published}')::boolean
  and :'publish_kc'::jsonb#>>'{publish,error}' like '%goods_kc_%'
  and (select published_at is null from public.goods where id='workspace-publish-kc')
  and (select (diff->>'publishRequested')::boolean and not (diff->>'published')::boolean from public.audit_log
    where id='12000000-0000-4000-8000-000000000131' and action='admin.good.workspace_saved')
  then 1 else 0 end as assert_publish_after_save_keeps_save_on_rejection;
update private.goods_transaction_runtime set enabled=false where singleton;

-- 접근 경계: 영수증 표는 앱 역할에 열리지 않고, 래퍼는 authenticated만 실행한다.
select 1/case when not has_table_privilege('authenticated','private.goods_workspace_operations','select')
  and not has_function_privilege('anon','public.admin_save_good_workspace(jsonb)','execute')
  and not has_function_privilege('service_role','public.admin_save_good_workspace(jsonb)','execute')
  and has_function_privilege('authenticated','public.admin_save_good_workspace(jsonb)','execute')
  and not has_function_privilege('authenticated','private.resolve_goods_workspace_variant(text,jsonb,uuid[],text)','execute')
  and not has_function_privilege('authenticated','private.save_goods_workspace_extra_sections(text,jsonb,uuid[])','execute')
  and not has_function_privilege('service_role','private.save_goods_workspace_extra_sections(text,jsonb,uuid[])','execute')
  and exists(select 1 from private.operator_rpc_contracts where to_regprocedure(signature)='public.admin_save_good_workspace(jsonb)'::regprocedure
    and capability='catalog.manage' and guard_kind='write')
  then 1 else 0 end as assert_workspace_grants_and_contract;
rollback;
