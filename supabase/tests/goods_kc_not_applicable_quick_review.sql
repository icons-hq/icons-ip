\set ON_ERROR_STOP on
-- 2026-10-07 MD 피드백 ①: 상품 전체 KC 해당 없음은 제품군·제도·전 옵션 연결만으로 검토 완료·공개된다.
-- KC 대상 제도의 필수 항목, 옵션 커버리지, 해당 없음의 번호 거절은 그대로다.
begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.kc_na_expect_error(statement text,expected_message text,expected_code text default null)
returns void language plpgsql as $$ begin
  begin execute statement;
  exception when others then
    if position(expected_message in sqlerrm)=0 or (expected_code is not null and sqlstate<>expected_code) then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %',expected_message;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000100701','authenticated','authenticated','kc-na-staff@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff',nickname='KC해당없음100701' where id='00000000-0000-4000-8000-000000100701';
insert into public.verticals(key,label,color) values('kc-na-tests','KC 해당 없음 합성검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('kc-na-tests','KC 해당 없음 합성검증','kc-na-tests',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active)
 values('00000000-0000-4000-8000-000000100730','kc-na-tests','합성 출고지','hanjin',3000,30000,'배송 금지 검증 주소',true);
insert into public.goods(id,ip_id,name,type,price,image_path,origin_id,notice_maker,notice_origin,notice_material,
 notice_size,notice_made_on,notice_as_manager,notice_as_contact) values
 ('kc-na-good','kc-na-tests','합성 해당 없음 상품','문구',1000,'public-media/kc-na-test.webp','00000000-0000-4000-8000-000000100730',
 '합성 제조자','합성 국가','합성 소재','합성 크기','2026-10','합성 CS','02-000'),
 ('kc-na-other-good','kc-na-tests','합성 다른 상품','문구',1000,'public-media/kc-na-test.webp','00000000-0000-4000-8000-000000100730',
 '합성 제조자','합성 국가','합성 소재','합성 크기','2026-10','합성 CS','02-000');
insert into public.goods_variants(id,good_id,name,attributes,price,is_default) values
 ('00000000-0000-4000-8000-000000100711','kc-na-good','합성 파랑','{"색상":"파랑"}',1000,false),
 ('00000000-0000-4000-8000-000000100712','kc-na-good','합성 중지','{"색상":"중지"}',1000,false);
update public.goods_variants set archived_at=now() where id='00000000-0000-4000-8000-000000100712';
select id as na_default from public.goods_variants where good_id='kc-na-good' and is_default \gset
select id as na_other from public.goods_variants where good_id='kc-na-other-good' and is_default \gset

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000100701',true);
select public.admin_read_goods_kc('kc-na-good') as na_unset \gset
-- 상품 전체 해당 없음의 최소 입력: 제품군·제도·사용 중인 옵션 전부. 나머지 칸은 빈 값이다.
select jsonb_build_object('family','other','scheme','not_applicable','productCategory','','modelName','',
 'businessRole','','businessName','','identifier','','publicNote','',
 'variantIds',jsonb_build_array(:'na_default','00000000-0000-4000-8000-000000100711'),'basis','',
 'evidence',jsonb_build_object('applicability','','certificate','','testReport','','declaration','')) as na_model \gset

-- 같은 최소 입력이라도 KC 대상 제도는 검토 완료를 거절한다.
select pg_temp.kc_na_expect_error(format('select public.admin_save_goods_kc(%L,%L::jsonb,%L,null,%L,true)','kc-na-good',
 jsonb_build_array(:'na_model'::jsonb||jsonb_build_object('family','living','scheme',scheme))::text,'reviewed',
 :'na_unset'::jsonb->>'contextFingerprint'),'goods_kc_review_incomplete','23514')
from unnest(array['safety_certification','safety_confirmation','supplier_conformity','safety_standard_compliance']) scheme;
-- 사용 중인 옵션 일부만 연결하면 거절한다(사용 중지 옵션은 연결하지 않아도 된다).
select pg_temp.kc_na_expect_error(format('select public.admin_save_goods_kc(%L,%L::jsonb,%L,null,%L,true)','kc-na-good',
 jsonb_build_array(jsonb_set(:'na_model'::jsonb,'{variantIds}',jsonb_build_array(:'na_default')))::text,'reviewed',
 :'na_unset'::jsonb->>'contextFingerprint'),'goods_kc_review_incomplete','23514');
select pg_temp.kc_na_expect_error(format('select public.admin_save_goods_kc(%L,%L::jsonb,%L,null,%L,true)','kc-na-good',
 jsonb_build_array(jsonb_set(:'na_model'::jsonb,'{variantIds}','[]'))::text,'reviewed',
 :'na_unset'::jsonb->>'contextFingerprint'),'goods_kc_review_incomplete','23514');
-- 다른 상품의 옵션을 함께 연결하면 거절한다(사용 중인 옵션을 모두 연결했더라도).
select pg_temp.kc_na_expect_error(format('select public.admin_save_goods_kc(%L,%L::jsonb,%L,null,%L,true)','kc-na-good',
 jsonb_build_array(jsonb_set(:'na_model'::jsonb,'{variantIds}',:'na_model'::jsonb->'variantIds'||to_jsonb(:'na_other'::text)))::text,'reviewed',
 :'na_unset'::jsonb->>'contextFingerprint'),'goods_kc_review_incomplete','23514');
-- 해당 없음에 인증·신고번호를 넣으면 거절한다.
select pg_temp.kc_na_expect_error(format('select public.admin_save_goods_kc(%L,%L::jsonb,%L,null,%L,true)','kc-na-good',
 jsonb_build_array(jsonb_set(:'na_model'::jsonb,'{identifier}','"NA-NUMBER-1"'))::text,'reviewed',
 :'na_unset'::jsonb->>'contextFingerprint'),'goods_kc_review_incomplete','23514');
-- 제도 미선택, 제품군 없는 제도는 여전히 거절한다.
select pg_temp.kc_na_expect_error(format('select public.admin_save_goods_kc(%L,%L::jsonb,%L,null,%L,true)','kc-na-good',
 jsonb_build_array(jsonb_set(:'na_model'::jsonb,'{scheme}','""'))::text,'reviewed',
 :'na_unset'::jsonb->>'contextFingerprint'),'goods_kc_review_incomplete','23514');
select pg_temp.kc_na_expect_error(format('select public.admin_save_goods_kc(%L,%L::jsonb,%L,null,%L,true)','kc-na-good',
 jsonb_build_array(jsonb_set(:'na_model'::jsonb,'{family}','""'))::text,'reviewed',
 :'na_unset'::jsonb->>'contextFingerprint'),'invalid_goods_kc_combination','23514');
-- 확인 체크 없이 완료할 수 없다.
select pg_temp.kc_na_expect_error(format('select public.admin_save_goods_kc(%L,%L::jsonb,%L,null,%L,false)','kc-na-good',
 jsonb_build_array(:'na_model'::jsonb)::text,'reviewed',:'na_unset'::jsonb->>'contextFingerprint'),'goods_kc_attestation_required','23514');
select pg_temp.kc_na_expect_error($sql$select public.admin_set_good_published('kc-na-good',true)$sql$,'goods_kc_review_required','23514');

-- 최소 입력으로 한 번에 검토 완료한다.
select public.admin_save_goods_kc('kc-na-good',jsonb_build_array(:'na_model'::jsonb),'reviewed',null,
 :'na_unset'::jsonb->>'contextFingerprint',true) as na_saved \gset
select 1/case when (:'na_saved'::jsonb->>'changed')::boolean and :'na_saved'::jsonb#>>'{configuration,status}'='reviewed'
 and :'na_saved'::jsonb#>>'{configuration,reviewerName}'='KC해당없음100701'
 and :'na_saved'::jsonb#>>'{configuration,reviewedAt}' is not null then 1 else 0 end as assert_minimal_not_applicable_reviewed;

reset role;
-- 감사 근거: 검토자·시각과 완료 이력이 남는다.
select 1/case when (select status='reviewed' and reviewed_by='00000000-0000-4000-8000-000000100701' and reviewed_at is not null
   from private.goods_kc_reviews where good_id='kc-na-good')
 and exists(select 1 from private.goods_kc_review_events where good_id='kc-na-good' and reason='review_completed'
   and actor_id='00000000-0000-4000-8000-000000100701' and snapshot->>'status'='reviewed'
   and snapshot#>>'{models,0,scheme}'='not_applicable')
 and exists(select 1 from public.audit_log where target='goods:kc-na-good' and action='admin.good.kc_saved'
   and actor_id='00000000-0000-4000-8000-000000100701' and diff->>'status'='reviewed')
 then 1 else 0 end as assert_review_actor_time_and_history_recorded;
-- 사용 중지 옵션(연결하지 않음)이 있어도 연결한 옵션만 검토 당시와 같으면 현재 검토로 본다.
select 1/case when private.goods_kc_review_current('kc-na-good')
 and cardinality(private.goods_kc_review_problems('kc-na-good',(select models from private.goods_kc_reviews where good_id='kc-na-good')))=0
 then 1 else 0 end as assert_review_current;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000100701',true);
select 1/case when public.admin_read_goods_readiness('kc-na-good')->>'publicReview'='current'
 and not (public.admin_read_goods_readiness('kc-na-good')->'reasonCodes' ? 'kc_required') then 1 else 0 end as assert_readiness_kc_current;
select public.admin_set_good_published('kc-na-good',true);
select 1/case when (select published_at is not null and jsonb_array_length(kc_disclosures)=1
   and kc_disclosures#>>'{0,scheme}'='not_applicable' and kc_disclosures#>>'{0,modelName}'=''
   and kc_disclosures#>>'{0,businessRole}'='' and kc_disclosures#>>'{0,publicNote}'='' and kc_disclosures#>>'{0,identifier}'=''
   and jsonb_array_length(kc_disclosures#>'{0,variants}')=2
   and not (kc_disclosures->0 ? 'basis') and not (kc_disclosures->0 ? 'evidence')
   from public.goods where id='kc-na-good') then 1 else 0 end as assert_minimal_not_applicable_publishes;

-- 공개 중 KC 잠금은 그대로다.
select public.admin_read_goods_kc('kc-na-good') as na_published \gset
select pg_temp.kc_na_expect_error(format('select public.admin_save_goods_kc(%L,%L::jsonb,%L,%s,%L,false)','kc-na-good',
 jsonb_build_array(:'na_model'::jsonb)::text,'unreviewed',:'na_published'::jsonb->>'revision',:'na_published'::jsonb->>'contextFingerprint'),
 'goods_kc_published_edit_requires_draft','23514');

-- 공개 후 새 옵션을 추가하려면 여전히 초안 전환과 재검토가 필요하다.
reset role;
select pg_temp.kc_na_expect_error($sql$insert into public.goods_variants(good_id,name,attributes,price) values
 ('kc-na-good','새 합성 옵션','{"색상":"초록"}',1000)$sql$,'goods_kc_reassessment_required','23514');

select 1/case when not has_function_privilege('authenticated','private.goods_kc_review_problems(text,jsonb)','execute')
 and not has_function_privilege('anon','private.goods_kc_review_problems(text,jsonb)','execute')
 and not has_function_privilege('service_role','private.goods_kc_review_problems(text,jsonb)','execute')
 and has_function_privilege('postgres','private.goods_kc_review_problems(text,jsonb)','execute')
 then 1 else 0 end as assert_review_problems_stays_private;
rollback;
