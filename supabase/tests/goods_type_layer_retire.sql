\set ON_ERROR_STOP on
-- ADR-0044: 상품 유형 층을 걷어냈다(ADR-0037 대체). 공개 조건은 대표 카테고리이고, 유형은 파생·판정되지 않는다.
-- goods.type은 후속 migration에서 지울 때까지 남는 칸이라 저장 입력의 값을 그대로 저장하고(앱이 저장된 값을 다시 보낸다),
-- 카테고리 이동이나 카테고리의 옛 연결 칸 변경으로는 바뀌지 않는다.
-- Prepend helpers/goods_kc_fixture.sql in the same connection. Everything rolls back.

begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.gr_expect_error(statement text,expected_message text,expected_code text default null)
returns void language plpgsql as $$ begin
  begin execute statement;
  exception when others then
    if position(expected_message in sqlerrm)=0 or (expected_code is not null and sqlstate<>expected_code) then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %',expected_message;
end $$;
-- 지금 운영자로 KC 해당 없음 검토를 완료한다(사용 중인 옵션 전체 연결).
create function pg_temp.gr_review(p_good_id text) returns void language plpgsql as $$
declare config jsonb;
begin
  config:=public.admin_read_goods_kc(p_good_id);
  perform public.admin_save_goods_kc(p_good_id,jsonb_build_array(jsonb_build_object('family','other','scheme','not_applicable',
    'productCategory','','modelName','','businessRole','','businessName','','identifier','','publicNote','',
    'variantIds',(select jsonb_agg(id::text) from public.goods_variants where good_id=p_good_id and archived_at is null),'basis','',
    'evidence',jsonb_build_object('applicability','','certificate','','testReport','','declaration',''))),
    'reviewed',(config->>'revision')::integer,config->>'contextFingerprint',true);
end $$;
-- 어드민 상품 폼과 같은 전체 저장 입력(상품 + 옵션 + 기준값). 저장된 type을 그대로 싣는다(앱의 패스스루와 같다).
create function pg_temp.gr_payload(target_id text) returns jsonb language sql as $$
  select record->'good'||jsonb_build_object('previous_id',target_id,
    'variant_baseline',(select coalesce(jsonb_agg(value->'id'),'[]') from jsonb_array_elements(record->'variants') where value->>'archived_at' is null),
    'variants',(select jsonb_agg(jsonb_build_object('id',value->'id','name',value->'name','code',value->'code','attributes',value->'attributes',
      'extraPrice',(value->>'price')::integer-(record#>>'{good,price}')::integer,'stockQty',value->'stock_qty',
      'expectedStockQty',value->'stock_qty','isActive',value->>'archived_at' is null,'lowStockThreshold',value->'low_stock_threshold'))
      from jsonb_array_elements(record->'variants')))
  from public.admin_goods_import_records('{}',array[target_id]) record;
$$;

-- --------------------------------------------------------------------------
-- 걷어낸 장치: 파생 함수·트리거가 없고, KC 가드는 category_id 쓰기에 돌지 않으며, 공개 상품도 유형이 비어 있을 수 있다.
-- --------------------------------------------------------------------------
select 1/case when to_regprocedure('private.goods_category_type(uuid)') is null
 and to_regprocedure('private.goods_category_type_majority()') is null
 and to_regprocedure('private.derive_goods_type_from_category()') is null
 and to_regprocedure('private.refresh_category_good_type_goods()') is null
 and not exists(select 1 from pg_trigger where tgname in('goods_category_type_derive','catalog_categories_good_type_refresh'))
 and exists(select 1 from pg_trigger where tgrelid='public.goods'::regclass and tgname='goods_kc_guard'
   and pg_get_triggerdef(oid) not like '%category_id%')
 and pg_get_constraintdef((select oid from pg_constraint where conname='goods_type_check' and conrelid='public.goods'::regclass)) not like '%published_at%'
 and not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')
   and (p.prosrc ~ 'goods_category_type' or p.prosrc ~ 'goods_type_category_(required|locked|changed)'
     or (p.prosrc ~ '''type_(missing|category_mismatch|no_category)'''
       and p.oid<>'private.admin_goods_workspace_matches(text,text,text,text,uuid,text)'::regprocedure)))
 then 1 else 0 end as type_layer_removed;

-- --------------------------------------------------------------------------
-- 운영자·합성 데이터
-- --------------------------------------------------------------------------
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('98190000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','goods-type-retire-'||n||'@example.test',now(),'{}','{}' from generate_series(1,1) n;
update public.profiles set role='staff',nickname='유형정리1' where id='98190000-0000-4000-8000-000000000001';
insert into private.operator_memberships(profile_id,manager_role) values('98190000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into public.verticals(key,label,color) values('goods-type-retire','유형 정리 합성검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('goods-type-retire','유형 정리 합성검증','goods-type-retire',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active)
 values('00000000-0000-4000-8000-000000190030','goods-type-retire','합성 출고지','hanjin',3000,30000,'배송 금지 검증 주소',true);
-- 옛 연결 칸(good_type)이 있는 카테고리와 없는 카테고리. 이제 둘 다 공개에 쓸 수 있다.
insert into public.catalog_categories(id,code,name,parent_id,depth,sort_order,good_type) values
 ('00000000-0000-4000-8000-000000190100','gr-linked','합성 키링 연결',null,1,0,'키링'),
 ('00000000-0000-4000-8000-000000190110','gr-plain','봉투류',null,1,1,null),
 ('00000000-0000-4000-8000-000000190120','gr-other','다른분류',null,1,2,null);
-- 공개 조건(대표 이미지·고시 7칸·출고지)은 채운다. 합성 이미지 경로는 시스템 입력으로 넣는다.
insert into public.goods(id,ip_id,name,type,price,image_path,origin_id,category_id,notice_maker,notice_origin,notice_material,
 notice_size,notice_made_on,notice_as_manager,notice_as_contact)
 select id,'goods-type-retire','합성 '||id,type,1000,'public-media/goods-type-test.webp','00000000-0000-4000-8000-000000190030',category_id,
  '합성 제조자','합성 국가','합성 소재','합성 크기','2026-11','합성 CS','02-000'
 from (values
  ('gr-plain-good','','00000000-0000-4000-8000-000000190110'::uuid),
  ('gr-legacy-good','문구','00000000-0000-4000-8000-000000190100'::uuid),
  ('gr-nocat-good','',null::uuid),
  ('gr-defer-good','',null::uuid),
  ('gr-move-good','문구','00000000-0000-4000-8000-000000190110'::uuid)
 ) as fixtures(id,type,category_id);
update public.goods_variants set stock_qty=5 where good_id like 'gr-%';

-- 새 상품의 유형은 들어온 값 그대로다(연결 칸이 있는 카테고리여도 파생하지 않는다).
select 1/case when (select type from public.goods where id='gr-plain-good')=''
 and (select type from public.goods where id='gr-legacy-good')='문구'
 then 1 else 0 end as insert_keeps_given_type;

set local role authenticated;
select set_config('request.jwt.claim.sub','98190000-0000-4000-8000-000000000001',true);

-- --------------------------------------------------------------------------
-- 공개 전환: 대표 카테고리만 있으면 유형이 비어 있어도(연결 칸이 없어도) 공개된다.
-- --------------------------------------------------------------------------
select pg_temp.gr_review('gr-plain-good');
select public.admin_set_good_published('gr-plain-good',true);
select 1/case when (select published_at is not null and type='' from public.goods where id='gr-plain-good')
 and public.admin_read_goods_readiness('gr-plain-good')->>'state'='ready'
 then 1 else 0 end as category_without_type_publishes;
-- 옛 연결 칸과 다른 유형이 저장돼 있어도 공개된다(대조하지 않는다).
select pg_temp.gr_review('gr-legacy-good');
select public.admin_set_good_published('gr-legacy-good',true);
select 1/case when (select published_at is not null and type='문구' from public.goods where id='gr-legacy-good')
 then 1 else 0 end as stored_type_is_not_compared;

-- 대표 카테고리가 없으면 거절하고, 판매 준비가 category_missing을 막는 사유로 보인다. 목록 필터도 이 사유를 받는다.
select pg_temp.gr_review('gr-nocat-good');
select pg_temp.gr_expect_error($sql$select public.admin_set_good_published('gr-nocat-good',true)$sql$,'goods_category_required','23514');
select 1/case when public.admin_read_goods_readiness('gr-nocat-good')->'blockingCodes' ? 'category_missing'
 and public.admin_read_goods_readiness('gr-nocat-good')->>'state'='blocked'
 and not (public.admin_read_goods_readiness('gr-plain-good')->'reasonCodes' ? 'category_missing')
 and (public.admin_search_goods_workspace(p_query=>'합성 gr-nocat-good',p_readiness=>'category_missing')->>'total')::integer=1
 then 1 else 0 end as missing_category_blocks_draft;
-- 옛 유형 사유 필터는 배포 사이 이전 앱 호환으로 받되 아무 상품도 걸리지 않는다(판매 준비가 더는 내지 않는다).
select 1/case when (public.admin_search_goods_workspace(p_query=>'합성 gr-',p_readiness=>'type_missing')->>'total')::integer=0
 and (public.admin_search_goods_workspace(p_query=>'합성 gr-',p_readiness=>'type_no_category')->>'total')::integer=0
 then 1 else 0 end as legacy_type_filters_match_nothing;

-- 저장하며 공개하면 대표 카테고리를 넣은 뒤 공개한다(공개 판정이 새 대표 카테고리를 본다). 유형은 들어온 값 그대로다.
select pg_temp.gr_review('gr-defer-good');
select public.admin_save_good(pg_temp.gr_payload('gr-defer-good')||jsonb_build_object('category_id','00000000-0000-4000-8000-000000190110','publish',true)) is not null as gr_defer_saved;
select 1/case when (select published_at is not null and type='' and category_id='00000000-0000-4000-8000-000000190110' from public.goods where id='gr-defer-good')
 and public.admin_read_goods_kc('gr-defer-good')->>'status'='reviewed'
 then 1 else 0 end as save_and_publish_after_category;

-- --------------------------------------------------------------------------
-- 초안의 카테고리 이동: 유형이 바뀌지 않고 KC 검토도 그대로다.
-- --------------------------------------------------------------------------
select pg_temp.gr_review('gr-move-good');
select public.admin_assign_good_category('00000000-0000-4000-8000-000000190301','gr-move-good','00000000-0000-4000-8000-000000190100',null);
select 1/case when (select type='문구' and category_id='00000000-0000-4000-8000-000000190100' from public.goods where id='gr-move-good')
 and public.admin_read_goods_kc('gr-move-good')->>'status'='reviewed'
 then 1 else 0 end as draft_move_keeps_type_and_kc;
select public.admin_save_good(pg_temp.gr_payload('gr-move-good')||'{"category_id":"00000000-0000-4000-8000-000000190120"}') is not null as gr_move_saved;
select 1/case when (select type='문구' and category_id='00000000-0000-4000-8000-000000190120' from public.goods where id='gr-move-good')
 and public.admin_read_goods_kc('gr-move-good')->>'status'='reviewed'
 then 1 else 0 end as draft_save_move_keeps_type_and_kc;

-- 카테고리의 옛 연결 칸을 바꿔도 그 아래 상품은 바뀌지 않는다(갱신 트리거 없음).
select public.admin_upsert_category('00000000-0000-4000-8000-000000190302','00000000-0000-4000-8000-000000190120','gr-other','다른분류',null,2,
 (select updated_at from public.catalog_categories where id='00000000-0000-4000-8000-000000190120'),'인형') is not null as gr_other_relinked;
select 1/case when (select type from public.goods where id='gr-move-good')='문구'
 and public.admin_read_goods_kc('gr-move-good')->>'status'='reviewed'
 and not exists(select 1 from public.audit_log where action='admin.catalog.category.good_type_changed'
   and target='catalog_categories:00000000-0000-4000-8000-000000190120')
 then 1 else 0 end as legacy_link_does_not_touch_goods;

-- --------------------------------------------------------------------------
-- 공개 중: 다른 대표 카테고리로 옮길 수 있고(유형·KC 그대로), 비우는 것만 막는다.
-- --------------------------------------------------------------------------
select public.admin_assign_good_category('00000000-0000-4000-8000-000000190303','gr-legacy-good','00000000-0000-4000-8000-000000190110',null);
select 1/case when (select published_at is not null and type='문구' and category_id='00000000-0000-4000-8000-000000190110' from public.goods where id='gr-legacy-good')
 and public.admin_read_goods_kc('gr-legacy-good')->>'status'='reviewed'
 then 1 else 0 end as published_moves_to_any_category;
select public.admin_save_good(pg_temp.gr_payload('gr-legacy-good')||'{"category_id":"00000000-0000-4000-8000-000000190120"}') is not null as gr_legacy_saved;
select 1/case when (select published_at is not null and type='문구' and category_id='00000000-0000-4000-8000-000000190120' from public.goods where id='gr-legacy-good')
 then 1 else 0 end as published_save_moves_category;
select pg_temp.gr_expect_error($sql$select public.admin_assign_good_category('00000000-0000-4000-8000-000000190304','gr-legacy-good',null,null)$sql$,
 'goods_published_category_clear','23514');
select pg_temp.gr_expect_error(format('select public.admin_save_good(%L::jsonb)',
 (pg_temp.gr_payload('gr-legacy-good')||'{"category_id":null}')::text),'goods_published_category_clear','23514');
select 1/case when (select category_id='00000000-0000-4000-8000-000000190120' from public.goods where id='gr-legacy-good')
 then 1 else 0 end as published_category_not_cleared;
-- 공개 중 상품의 유형은 저장 입력으로 바뀌지 않는다(KC 맥락이 바뀌는 기존 잠금은 그대로다).
select pg_temp.gr_expect_error(format('select public.admin_save_good(%L::jsonb)',
 (pg_temp.gr_payload('gr-legacy-good')||'{"type":"인형"}')::text),'goods_kc_reassessment_required','23514');

-- 대표 카테고리가 없는 공개 상품(이전 데이터)은 category_missing을 검토 사유로만 알린다.
reset role;
set local session_replication_role = replica;
update public.goods set category_id=null where id='gr-plain-good';
set local session_replication_role = origin;
set local role authenticated;
select set_config('request.jwt.claim.sub','98190000-0000-4000-8000-000000000001',true);
select 1/case when public.admin_read_goods_readiness('gr-plain-good')->'reasonCodes' ? 'category_missing'
 and not (public.admin_read_goods_readiness('gr-plain-good')->'blockingCodes' ? 'category_missing')
 and public.admin_read_goods_readiness('gr-plain-good')->>'state'='review_required'
 then 1 else 0 end as published_without_category_is_review;
-- 그 상품의 다른 칸 저장과 공개 유지 요청(publish:true)은 그대로 통과한다(이미 공개라 공개 판정을 다시 하지 않는다).
select public.admin_save_good(pg_temp.gr_payload('gr-plain-good')||'{"price":1300,"publish":true}') is not null as gr_plain_legacy_saved;
select 1/case when (select price=1300 and published_at is not null and category_id is null from public.goods where id='gr-plain-good')
 then 1 else 0 end as legacy_published_without_category_saves_other_fields;

-- --------------------------------------------------------------------------
-- 등록 화면 원자 저장: 화면이 보낸 유형을 파생 유형과 대조하지 않는다(KC 섹션과 함께 저장된다).
-- --------------------------------------------------------------------------
create function pg_temp.gr_workspace_request(op uuid,p_good_id text) returns jsonb language sql as $$
  select jsonb_build_object('operationId',op,
    'good',(pg_temp.gr_payload(p_good_id)||jsonb_build_object('name','합성 저장 이름 '||p_good_id)),
    'sections',jsonb_build_object('kc',jsonb_build_object('status','reviewed','attested',true,
      'expectedRevision',case when (public.admin_read_goods_kc(p_good_id)->>'revision')::integer>0
        then public.admin_read_goods_kc(p_good_id)->'revision' else 'null'::jsonb end,
      'expectedContextFingerprint',public.admin_read_goods_kc(p_good_id)->'contextFingerprint',
      'models',jsonb_build_array(jsonb_build_object('family','other','scheme','not_applicable',
        'productCategory','','modelName','','businessRole','','businessName','','identifier','','publicNote','',
        'variantRefs',(select jsonb_agg(jsonb_build_object('id',id::text)) from public.goods_variants where good_id=p_good_id and archived_at is null),
        'basis','','evidence',jsonb_build_object('applicability','','certificate','','testReport','','declaration',''))))));
$$;
select public.admin_save_good_workspace(pg_temp.gr_workspace_request('00000000-0000-4000-8000-000000190901','gr-nocat-good')) is not null as gr_ws_saved;
select 1/case when (select name='합성 저장 이름 gr-nocat-good' and type='' from public.goods where id='gr-nocat-good')
 and public.admin_read_goods_kc('gr-nocat-good')->>'status'='reviewed'
 then 1 else 0 end as workspace_saves_with_kc;
-- 화면이 보낸 type이 저장값과 달라도 예전처럼 PT409로 거절하지 않는다(유형을 파생하지 않으므로 대조할 값이 없다).
select public.admin_save_good_workspace(pg_temp.gr_workspace_request('00000000-0000-4000-8000-000000190902','gr-nocat-good')
 ||jsonb_build_object('good',pg_temp.gr_payload('gr-nocat-good')||'{"type":"인형","name":"합성 다른 유형 저장"}')) is not null as gr_ws_other_type_saved;
select 1/case when (select name='합성 다른 유형 저장' and type='인형' from public.goods where id='gr-nocat-good')
 and public.admin_read_goods_kc('gr-nocat-good')->>'status'='reviewed'
 then 1 else 0 end as workspace_does_not_compare_type;

-- --------------------------------------------------------------------------
-- 검색: 굿즈 부제는 `IP · 대표 카테고리 이름`이고, 검색어는 유형 대신 대표 카테고리 이름과 맞춘다.
-- 고객 카테고리 기능이 꺼져 있으면 카테고리 이름을 쓰지 않는다.
-- --------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.category_activation_control set customer_enabled=false where id='catalog';
select 1/case when (select subtitle from public.search_public_content('합성 gr-defer-good',20) where id='gr-defer-good')='유형 정리 합성검증'
 and not exists(select 1 from public.search_public_content('봉투류',20) where id='gr-defer-good')
 then 1 else 0 end as search_hides_category_when_disabled;
update public.category_activation_control set customer_enabled=true where id='catalog';
select 1/case when (select subtitle from public.search_public_content('합성 gr-defer-good',20) where id='gr-defer-good')='유형 정리 합성검증 · 봉투류'
 and exists(select 1 from public.search_public_content('봉투류',20) where id='gr-defer-good')
 and (select subtitle from public.search_public_content('합성 gr-legacy-good',20) where id='gr-legacy-good')='유형 정리 합성검증 · 다른분류'
 and not exists(select 1 from public.search_public_content('문구',20) where id='gr-legacy-good')
 then 1 else 0 end as search_uses_category_name;
-- 보관된 카테고리 이름은 부제·검색어에 쓰지 않는다.
update public.catalog_categories set archived_at=now() where id='00000000-0000-4000-8000-000000190110';
select 1/case when (select subtitle from public.search_public_content('합성 gr-defer-good',20) where id='gr-defer-good')='유형 정리 합성검증'
 and not exists(select 1 from public.search_public_content('봉투류',20) where id='gr-defer-good')
 then 1 else 0 end as search_hides_archived_category;
rollback;
