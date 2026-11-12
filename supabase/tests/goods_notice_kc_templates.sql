\set ON_ERROR_STOP on
begin;
select 1/case when not has_function_privilege('anon','public.admin_save_goods_notice_preset(uuid,text,jsonb,timestamptz)','execute')
  and not has_function_privilege('service_role','public.admin_save_goods_notice_preset(uuid,text,jsonb,timestamptz)','execute')
  and not has_function_privilege('authenticated','private.normalize_goods_notice_kc_template(jsonb)','execute')
  and not has_function_privilege('anon','private.normalize_goods_notice_kc_template(jsonb)','execute')
  and not has_function_privilege('service_role','private.normalize_goods_notice_kc_template(jsonb)','execute')
  then 1 else 0 end as sealed_template_functions;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-4000-8000-000000050901','authenticated','authenticated','kc-preset@example.test',now(),'{}','{}',now(),now()),
('00000000-0000-4000-8000-000000050902','authenticated','authenticated','kc-preset-customer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000050901';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000050901',true);
select public.admin_save_goods_notice_preset(null,'합성 KC 틀',
'{"maker":"합성","origin":"한국","material":"종이","size":"A5","madeOn":"2026","asManager":"합성","asContact":"합성","kcTemplate":{"family":"living","scheme":"not_applicable","publicNote":" 합성 안내 "}}',null) as preset_id \gset
select 1/case when (select kc_template from public.goods_notice_presets where id=:'preset_id')='{"family":"living","scheme":"not_applicable","publicNote":"합성 안내"}'::jsonb then 1 else 0 end as template_saved;

select set_config('test.kc_preset_id',:'preset_id',true);
do $$ declare preset public.goods_notice_presets; notice jsonb; invalid jsonb; begin
  select * into preset from public.goods_notice_presets where id=current_setting('test.kc_preset_id')::uuid;
  notice:='{"maker":"합성","origin":"한국","material":"종이","size":"A5","madeOn":"2026","asManager":"합성","asContact":"합성"}'::jsonb;
  foreach invalid in array array[
    '{"family":"  ","scheme":"  ","publicNote":""}'::jsonb,
    '{"family":"other","scheme":"safety_certification","publicNote":""}'::jsonb,
    '{"family":"living","scheme":"not_applicable","publicNote":"안내","identifier":"COPIED"}'::jsonb,
    '{"family":"living","scheme":"not_applicable","publicNote":1}'::jsonb,
    '{"family":"living","scheme":"safety_certification","publicNote":"해당 없음"}'::jsonb
  ] loop
    begin
      perform public.admin_save_goods_notice_preset(preset.id,preset.name,notice||jsonb_build_object('kcTemplate',invalid),preset.updated_at);
      raise exception 'invalid template accepted: %',invalid;
    exception when invalid_parameter_value or check_violation then null; end;
  end loop;
  begin
    perform public.admin_save_goods_notice_preset(preset.id,preset.name,notice||jsonb_build_object('kcTemplate',
      jsonb_build_object('family','living','scheme','not_applicable','publicNote',repeat('가',1001))),preset.updated_at);
    raise exception 'oversized KC note accepted';
  exception when invalid_parameter_value or check_violation then null; end;
  begin
    perform public.admin_save_goods_notice_preset(preset.id,preset.name,notice||'{"kcTemplate":null}',preset.updated_at-interval '1 second');
    raise exception 'stale KC template clear accepted';
  exception when sqlstate 'PT409' then null; end;
  perform public.admin_save_goods_notice_preset(preset.id,preset.name,notice,preset.updated_at);
  if (select kc_template from public.goods_notice_presets where id=preset.id) is distinct from preset.kc_template then raise exception 'legacy seven fields cleared KC'; end if;
  select * into preset from public.goods_notice_presets where id=preset.id;
  perform public.admin_save_goods_notice_preset(preset.id,preset.name,notice||'{"kcTemplate":null}'::jsonb,preset.updated_at);
  if (select kc_template from public.goods_notice_presets where id=preset.id) is not null then raise exception 'explicit clear not applied'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000050902',true);
select 1/case when not exists(select 1 from public.goods_notice_presets where id=:'preset_id') then 1 else 0 end as customer_cannot_read_template;
do $$ begin
  perform public.admin_save_goods_notice_preset(null,'고객 우회','{"kcTemplate":null}',null);
  raise exception 'customer template save accepted';
exception when insufficient_privilege then null; end $$;
reset role;
select 1/case when (select count(*) from public.audit_log where actor_id='00000000-0000-4000-8000-000000050901'
  and target='goods_notice_presets:'||:'preset_id')=3 then 1 else 0 end as single_audit_per_success;
select 1/case when exists(select 1 from public.audit_log where target='goods_notice_presets:'||:'preset_id'
  and diff->'before'->'kc_template'->>'publicNote'='합성 안내' and diff->'after'->'kc_template'='null'::jsonb)
  then 1 else 0 end as cleared_template_audit_preserves_previous;

-- TKT-006·TKT-086 등록 화면 경로: 프리셋의 KC 틀은 같은 화면 KC 입력의 새 모델이 되고(제품군·제도·해당 없음 안내만),
-- 등록과 함께 저장해도 틀이 남는다. 확인 체크가 없으므로 미검토 초안이고 고객 고시로 나가지 않으며 공개할 수 없다.
insert into public.verticals(key,label,color) values('kc-preset-tests','KC 틀 합성검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('kc-preset-tests','KC 틀 합성검증','kc-preset-tests',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000050901',true);
select public.admin_save_goods_notice_preset(null,'합성 등록 화면 KC 틀',
'{"maker":"합성","origin":"한국","material":"종이","size":"A5","madeOn":"2026","asManager":"합성","asContact":"합성","kcTemplate":{"family":"living","scheme":"not_applicable","publicNote":"합성 등록 화면 안내"}}',null) as create_preset_id \gset
select kc_template as create_template from public.goods_notice_presets where id=:'create_preset_id' \gset
-- 화면은 틀을 lib/admin/goods-kc.ts kcModelFromTemplate으로 모델에 옮긴다: 틀의 세 값만 채우고 옵션·번호·근거는 비운다.
select public.admin_save_good_workspace(jsonb_build_object('operationId','15090000-0000-4000-8000-000000000001','draft',null,
  'good',jsonb_build_object('id','kc-preset-created','ip_id','kc-preset-tests','name','합성 KC 틀 등록','type','문구','price',1000,
    'notice_maker','합성','notice_origin','한국','notice_material','종이','notice_size','A5','variant_baseline','[]'::jsonb,
    'variants',jsonb_build_array(jsonb_build_object('name','빨강','code','','attributes',jsonb_build_object('색상','빨강'),'extraPrice',0,'stockQty',1))),
  'sections',jsonb_build_object('kc',jsonb_build_object('status','unreviewed','attested',false,'expectedRevision',null,'expectedContextFingerprint',null,
    'models',jsonb_build_array(jsonb_build_object('family',:'create_template'::jsonb->>'family','scheme',:'create_template'::jsonb->>'scheme',
      'publicNote',:'create_template'::jsonb->>'publicNote','productCategory','','modelName','','businessRole','','businessName','','identifier','',
      'basis','','evidence',jsonb_build_object('applicability','','certificate','','testReport','','declaration',''),'variantRefs','[]'::jsonb)))))) as template_created \gset
select public.admin_read_goods_kc('kc-preset-created') as template_kc \gset
select 1/case when :'template_created'::jsonb#>>'{kc,status}'='unreviewed'
  and :'template_kc'::jsonb->>'status'='unreviewed' and :'template_kc'::jsonb->>'reviewedAt' is null
  and jsonb_array_length(:'template_kc'::jsonb->'models')=1
  and :'template_kc'::jsonb#>>'{models,0,family}'='living' and :'template_kc'::jsonb#>>'{models,0,scheme}'='not_applicable'
  and :'template_kc'::jsonb#>>'{models,0,publicNote}'='합성 등록 화면 안내'
  and :'template_kc'::jsonb#>'{models,0,variantIds}'='[]'::jsonb and :'template_kc'::jsonb#>>'{models,0,identifier}'=''
  and :'template_kc'::jsonb#>>'{models,0,modelName}'='' and :'template_kc'::jsonb#>>'{models,0,basis}'=''
  then 1 else 0 end as create_screen_template_saved_as_unreviewed_draft;
select 1/case when (select kc_disclosures='[]' and published_at is null from public.goods where id='kc-preset-created')
  then 1 else 0 end as create_screen_template_not_public;
-- 다른 공개 조건(대표 이미지·고시 7칸·출고지)은 채워 KC만 남긴다. 이 칸들은 KC 맥락이 아니라 검토 상태를 바꾸지 않는다.
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active)
 values('00000000-0000-4000-8000-000000050930','kc-preset-tests','합성 출고지','hanjin',3000,30000,'배송 금지 검증 주소',true);
update public.goods set image_path='public-media/kc-preset.webp',notice_made_on='2026',notice_as_manager='합성',notice_as_contact='합성',
  origin_id='00000000-0000-4000-8000-000000050930' where id='kc-preset-created';
-- SHEET-003(ADR-0037): 공개는 대표 카테고리의 상품 유형 연결을 본다. KC 판정을 보려고 같은 유형이 연결된 합성 카테고리에 붙인다(유형은 그대로).
select pg_temp.link_goods_type_category_fixture('kc-preset-created');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000050901',true);
do $$ begin
  perform public.admin_set_good_published('kc-preset-created',true);
  raise exception 'unreviewed template model published';
exception when check_violation then if sqlerrm not like '%goods_kc_review_required%' then raise; end if; end $$;
reset role;
rollback;
