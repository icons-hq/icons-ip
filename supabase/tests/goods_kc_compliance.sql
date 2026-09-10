\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.kc_expect_error(statement text,expected_message text,expected_code text default null)
returns void language plpgsql as $$ begin
  begin execute statement;
  exception when others then
    if position(expected_message in sqlerrm)=0 or (expected_code is not null and sqlstate<>expected_code) then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %',expected_message;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000047701','authenticated','authenticated','kc-review-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000047702','authenticated','authenticated','kc-review-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff',nickname='KC검토47701' where id='00000000-0000-4000-8000-000000047701';
insert into public.verticals(key,label,color) values('kc-tests','KC 합성검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('kc-tests','KC 합성검증','kc-tests',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active)
 values('00000000-0000-4000-8000-000000047730','kc-tests','합성 출고지','hanjin',3000,30000,'배송 금지 검증 주소',true);
select pg_temp.kc_expect_error($sql$insert into public.goods(id,ip_id,name,type,price,published_at,origin_id)
 values('kc-direct-publish','kc-tests','합성 상품','문구',1000,now(),'00000000-0000-4000-8000-000000047730')$sql$,
 'goods_kc_review_required','23514');
insert into public.goods(id,ip_id,name,type,price,image_path,origin_id,notice_maker,notice_origin,notice_material,
 notice_size,notice_made_on,notice_as_manager,notice_as_contact) values
 ('kc-test-good','kc-tests','합성 KC 상품','문구',1000,'public-media/kc-test.webp','00000000-0000-4000-8000-000000047730',
 '합성 제조자','합성 국가','합성 소재','합성 크기','2026-09','합성 CS','02-000'),
 ('kc-other-good','kc-tests','합성 다른 상품','문구',1000,'public-media/kc-test.webp','00000000-0000-4000-8000-000000047730',
 '합성 제조자','합성 국가','합성 소재','합성 크기','2026-09','합성 CS','02-000');
insert into public.goods_variants(id,good_id,name,attributes,price,is_default) values
 ('00000000-0000-4000-8000-000000047711','kc-test-good','합성 파랑','{"색상":"파랑"}',1000,false);
update public.goods_variants set name='합성 빨강',attributes='{"색상":"빨강"}' where good_id='kc-test-good' and is_default;
select id as kc_default from public.goods_variants where good_id='kc-test-good' and is_default \gset
select id as kc_other from public.goods_variants where good_id='kc-other-good' and is_default \gset
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047701',true);
select public.admin_read_goods_kc('kc-test-good') as kc_unset \gset
select 1/case when :'kc_unset'::jsonb->>'status'='unreviewed' and :'kc_unset'::jsonb->>'revision' is null then 1 else 0 end
 as assert_initial_unreviewed;
select pg_temp.kc_expect_error($sql$select public.admin_set_good_published('kc-test-good',true)$sql$,'goods_kc_review_required','23514');
select jsonb_build_object('family','children','scheme','safety_confirmation','productCategory','자동검증 합성 분류',
 'modelName','TEST-ONLY 모델 A','businessRole','importer','businessName','자동검증 합성 수입자','identifier','TEST-ONLY-0001',
 'publicNote','실제 판매 제품의 인증을 나타내지 않는 합성 고시','variantIds',jsonb_build_array(:'kc_default'),
 'basis','실제 모델 적합성을 판정하지 않는 자동검증 입력',
 'evidence',jsonb_build_object('applicability','TEST-ONLY:classification','certificate','TEST-ONLY:confirmation','testReport','','declaration','')) as kc_model \gset
select pg_temp.kc_expect_error(format('select public.admin_save_goods_kc(%L,%L::jsonb,%L,null,%L,true)','kc-test-good',
 jsonb_build_array(:'kc_model'::jsonb)::text,'reviewed',:'kc_unset'::jsonb->>'contextFingerprint'),'goods_kc_review_incomplete','23514');
select jsonb_set(:'kc_model'::jsonb,'{variantIds}',jsonb_build_array(:'kc_default','00000000-0000-4000-8000-000000047711')) as kc_complete_model \gset
select pg_temp.kc_expect_error(format('select public.admin_save_goods_kc(%L,%L::jsonb,%L,null,%L,true)','kc-test-good',
 jsonb_build_array(jsonb_set(:'kc_complete_model'::jsonb,'{basis}',to_jsonb(E'\t\n'||chr(160))))::text,'reviewed',:'kc_unset'::jsonb->>'contextFingerprint'),
 'goods_kc_review_incomplete','23514');
select pg_temp.kc_expect_error(format('select public.admin_save_goods_kc(%L,%L::jsonb,%L,null,%L,true)','kc-test-good',
 jsonb_build_array(jsonb_set(:'kc_complete_model'::jsonb,'{identifier}','""'))::text,'reviewed',:'kc_unset'::jsonb->>'contextFingerprint'),
 'goods_kc_review_incomplete','23514');
select pg_temp.kc_expect_error(format('select public.admin_save_goods_kc(%L,%L::jsonb,%L,null,%L,true)','kc-test-good',
 jsonb_build_array(jsonb_set(:'kc_complete_model'::jsonb,'{scheme}','"safety_standard_compliance"'))::text,'reviewed',:'kc_unset'::jsonb->>'contextFingerprint'),
 'invalid_goods_kc_combination','23514');
select pg_temp.kc_expect_error(format('select public.admin_save_goods_kc(%L,%L::jsonb,%L,null,%L,true)','kc-test-good',
 jsonb_build_array(jsonb_set(:'kc_complete_model'::jsonb,'{variantIds}',jsonb_build_array(:'kc_other')))::text,'reviewed',:'kc_unset'::jsonb->>'contextFingerprint'),
 'goods_kc_review_incomplete','23514');
select pg_temp.kc_expect_error(format('select public.admin_save_goods_kc(%L,%L::jsonb,%L,null,%L,false)','kc-test-good',
 jsonb_build_array(:'kc_complete_model'::jsonb)::text,'reviewed',:'kc_unset'::jsonb->>'contextFingerprint'),'goods_kc_attestation_required','23514');
select public.admin_save_goods_kc('kc-test-good',jsonb_build_array(:'kc_complete_model'::jsonb),'unreviewed',null,
 :'kc_unset'::jsonb->>'contextFingerprint',false);
select 1/case when (select kc_disclosures='[]' from public.goods where id='kc-test-good') then 1 else 0 end as assert_draft_not_public;
select pg_temp.kc_expect_error($sql$select public.admin_set_good_published('kc-test-good',true)$sql$,'goods_kc_review_required','23514');
select pg_temp.kc_expect_error(format('select public.admin_save_goods_kc(%L,%L::jsonb,%L,null,%L,true)','kc-test-good',
 jsonb_build_array(:'kc_complete_model'::jsonb)::text,'reviewed',:'kc_unset'::jsonb->>'contextFingerprint'),'goods_kc_review_changed','PT409');
select public.admin_save_goods_kc('kc-test-good',jsonb_build_array(:'kc_complete_model'::jsonb),'reviewed',1,
 :'kc_unset'::jsonb->>'contextFingerprint',true);
select public.admin_set_good_published('kc-test-good',true);
select 1/case when (select jsonb_array_length(kc_disclosures)=1 and kc_disclosures#>>'{0,identifier}'='TEST-ONLY-0001'
 and kc_disclosures::text not like '%TEST-ONLY:classification%' and kc_disclosures::text not like '%basis%'
 and notice_maker='합성 제조자' and notice_origin='합성 국가' and notice_material='합성 소재'
 and notice_size='합성 크기' and notice_made_on='2026-09' and notice_as_manager='합성 CS' and notice_as_contact='02-000'
 from public.goods where id='kc-test-good') then 1 else 0 end as assert_public_projection_and_seven_notice_fields;
select public.admin_read_goods_kc('kc-test-good') as kc_published \gset
select pg_temp.kc_expect_error(format('select public.admin_save_goods_kc(%L,%L::jsonb,%L,2,%L,false)','kc-test-good',
 jsonb_build_array(:'kc_complete_model'::jsonb)::text,'unreviewed',:'kc_published'::jsonb->>'contextFingerprint'),
 'goods_kc_published_edit_requires_draft','23514');
reset role;
select pg_temp.kc_expect_error($sql$update public.goods set notice_material='다른 소재' where id='kc-test-good'$sql$,
 'goods_kc_reassessment_required','23514');
select pg_temp.kc_expect_error($sql$insert into public.goods_variants(good_id,name,attributes,price) values
 ('kc-test-good','새 합성 옵션','{"색상":"빨강"}',1000)$sql$,'goods_kc_reassessment_required','23514');
update public.goods_variants set archived_at=now() where id='00000000-0000-4000-8000-000000047711';
update public.goods_variants set archived_at=null where id='00000000-0000-4000-8000-000000047711';
update public.goods_variants set stock_qty=4,price=1200 where id=:'kc_default';
select 1/case when private.goods_kc_review_current('kc-test-good') then 1 else 0 end as assert_price_stock_and_covered_restore_keep_review;
update public.goods set kc_disclosures='[{"evidence":"must not leak"}]' where id='kc-test-good';
select 1/case when (select kc_disclosures::text not like '%must not leak%' from public.goods where id='kc-test-good') then 1 else 0 end
 as assert_projection_not_writable;
set local role anon;
select pg_temp.kc_expect_error($sql$select public.admin_read_goods_kc('kc-test-good')$sql$,'permission denied','42501');
select pg_temp.kc_expect_error($sql$select * from private.goods_kc_reviews$sql$,'permission denied','42501');
select 1/case when (select kc_disclosures#>>'{0,modelName}'='TEST-ONLY 모델 A' from public.goods where id='kc-test-good') then 1 else 0 end
 as assert_anon_gets_only_customer_disclosure;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047702',true);
select pg_temp.kc_expect_error($sql$select public.admin_read_goods_kc('kc-test-good')$sql$,'staff required','42501');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047701',true);
select public.admin_set_good_published('kc-test-good',false);
select public.admin_read_goods_kc('kc-test-good') as kc_before_change \gset
reset role;
update public.goods set notice_material='새 합성 소재' where id='kc-test-good';
select 1/case when (select status='unreviewed' and reviewed_by is null from private.goods_kc_reviews where good_id='kc-test-good')
 and (select kc_disclosures='[]' from public.goods where id='kc-test-good') then 1 else 0 end as assert_draft_change_invalidates_review;
set local role authenticated;
select pg_temp.kc_expect_error(format('select public.admin_save_goods_kc(%L,%L::jsonb,%L,2,%L,true)','kc-test-good',
 jsonb_build_array(:'kc_complete_model'::jsonb)::text,'reviewed',:'kc_before_change'::jsonb->>'contextFingerprint'),'goods_kc_review_changed','PT409');
select public.admin_read_goods_kc('kc-test-good') as kc_changed \gset
select jsonb_set(jsonb_set(:'kc_complete_model'::jsonb,'{scheme}','"supplier_conformity"'),'{identifier}','""')
 || jsonb_build_object('evidence',jsonb_build_object('applicability','TEST-ONLY:supplier-classification','certificate','',
 'testReport','TEST-ONLY:report','declaration','TEST-ONLY:supplier-declaration')) as kc_supplier \gset
select public.admin_save_goods_kc('kc-test-good',jsonb_build_array(:'kc_supplier'::jsonb),'reviewed',
 (:'kc_changed'::jsonb->>'revision')::integer,:'kc_changed'::jsonb->>'contextFingerprint',true);
select 1/case when (select kc_disclosures#>>'{0,identifier}'='' from public.goods where id='kc-test-good') then 1 else 0 end
 as assert_supplier_does_not_require_common_certification_number;
reset role;
select 1/case when (select count(*) from private.goods_kc_review_events where good_id='kc-test-good')=4
 and exists(select 1 from private.goods_kc_review_events where good_id='kc-test-good' and revision=2
   and snapshot#>>'{models,0,evidence,certificate}'='TEST-ONLY:confirmation')
 then 1 else 0 end as assert_old_evidence_preserved;
select 1/case when not has_function_privilege('anon','public.admin_save_goods_kc(text,jsonb,text,integer,text,boolean)','execute')
 and not has_function_privilege('service_role','public.admin_save_goods_kc(text,jsonb,text,integer,text,boolean)','execute')
 and has_function_privilege('authenticated','public.admin_save_goods_kc(text,jsonb,text,integer,text,boolean)','execute')
 and not has_function_privilege('authenticated','private.normalize_goods_kc_models(jsonb)','execute')
 then 1 else 0 end as assert_minimal_execute_grants;

-- A worksheet update participates in the original goods/option transaction and
-- cannot turn a spreadsheet's completion label into an attested review.
create function pg_temp.kc_goods_payload(target_id text) returns jsonb language sql as $$
  select record->'good'||jsonb_build_object('previous_id',target_id,
    'variant_baseline',(select coalesce(jsonb_agg(value->'id'),'[]') from jsonb_array_elements(record->'variants') where value->>'archived_at' is null),
    'variants',(select jsonb_agg(jsonb_build_object('id',value->'id','name',value->'name','code',value->'code','attributes',value->'attributes',
      'extraPrice',(value->>'price')::integer-(record#>>'{good,price}')::integer,'stockQty',value->'stock_qty',
      'expectedStockQty',value->'stock_qty','isActive',value->>'archived_at' is null,'lowStockThreshold',value->'low_stock_threshold'))
      from jsonb_array_elements(record->'variants')))
  from public.admin_goods_import_records('{}',array[target_id]) record;
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047701',true);
select public.admin_read_goods_kc('kc-test-good') as kc_before_import \gset
select 1/case when (select record#>>'{kcReview,revision}'='4' from public.admin_goods_import_records('{}','{kc-test-good}') record)
 then 1 else 0 end as assert_workbook_read_has_private_review;
select public.admin_save_good(pg_temp.kc_goods_payload('kc-test-good'));
select 1/case when public.admin_read_goods_kc('kc-test-good')->>'revision'='4'
 and public.admin_read_goods_kc('kc-test-good')->>'status'='reviewed' then 1 else 0 end as assert_omitted_worksheet_preserves_review;
select jsonb_build_object('expectedRevision',4,'expectedContextFingerprint',:'kc_before_import'::jsonb->>'contextFingerprint',
 'models',jsonb_build_array((:'kc_supplier'::jsonb-'variantIds')||jsonb_build_object('variantCodes',jsonb_build_array('DOES-NOT-EXIST')))) as kc_bad_import \gset
select pg_temp.kc_expect_error(format('select public.admin_save_good(%L::jsonb)',
 (pg_temp.kc_goods_payload('kc-test-good')||jsonb_build_object('name','반영되면 안 되는 이름','kc_update',:'kc_bad_import'::jsonb))::text),
 'goods_kc_variant_code_not_found','23514');
select 1/case when (select name='합성 KC 상품' from public.goods where id='kc-test-good')
 and public.admin_read_goods_kc('kc-test-good')->>'revision'='4' then 1 else 0 end as assert_bad_kc_import_rolls_back_goods_and_review;
select jsonb_build_object('expectedRevision',4,'expectedContextFingerprint',:'kc_before_import'::jsonb->>'contextFingerprint',
 'models',jsonb_build_array((:'kc_supplier'::jsonb-'variantIds')||jsonb_build_object('variantCodes',
   (select jsonb_agg(code order by id) from public.goods_variants where good_id='kc-test-good')||'"KC-NEW-OPTION"'::jsonb))) as kc_import \gset
select public.admin_save_good(pg_temp.kc_goods_payload('kc-test-good')||jsonb_build_object('publish',false,'kc_update',:'kc_import'::jsonb,
 'variants',pg_temp.kc_goods_payload('kc-test-good')->'variants'||jsonb_build_array(jsonb_build_object(
 'name','신규 합성 옵션','code','KC-NEW-OPTION','attributes','{"색상":"신규"}'::jsonb,'extraPrice',0,'stockQty',0))));
select 1/case when public.admin_read_goods_kc('kc-test-good')->>'status'='unreviewed'
 and (select public.admin_read_goods_kc('kc-test-good')#>'{models,0,variantIds}' ? id::text from public.goods_variants where code='KC-NEW-OPTION')
 and (select kc_disclosures='[]' and published_at is null from public.goods where id='kc-test-good')
 then 1 else 0 end as assert_new_option_code_resolves_before_unreviewed_save;
rollback;
