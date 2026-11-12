\set ON_ERROR_STOP on
-- SHEET-003(ADR-0037): 상품 유형은 대표 카테고리(없으면 가까운 상위)에 연결한 값이다. goods.type은 그 파생값을 저장한다.
-- Prepend helpers/goods_kc_fixture.sql in the same connection. Everything below the read-only report rolls back.

-- ==========================================================================
-- [배포 뒤 읽기 확인] 아래 세 쿼리는 읽기 전용이다. 운영 DB에서 이 블록만 그대로 실행해 사람 게이트(카테고리별
-- 상품 유형 연결 운영값·기존 상품 불일치 정리) 목록을 본다. 시험에서는 문법·권한만 확인한다(결과는 시험 데이터).
-- ==========================================================================
-- (1) 상품이 쓰는데 상품 유형이 연결되지 않은 카테고리(상위에도 없음)와 그 카테고리 상품의 유형 분포. 동률이면 tied_types가 있다.
select category.code, category.name,
  (select count(*) from public.goods as good where good.category_id = category.id and good.archived_at is null) as active_goods,
  (select string_agg(votes.type || ' ' || votes.goods, ', ' order by votes.goods desc, votes.type)
     from (select good.type, count(*) as goods from public.goods as good
       where good.category_id = category.id and good.archived_at is null and good.type <> '' group by good.type) as votes) as type_votes,
  majority.tied_types
from public.catalog_categories as category
left join private.goods_category_type_majority() as majority on majority.category_id = category.id
where private.goods_category_type(category.id) = ''
  and exists(select 1 from public.goods as good where good.category_id = category.id and good.archived_at is null)
order by category.code;
-- (2) 저장된 유형이 카테고리 연결값과 다른 상품(연결 없음 포함). 공개 중은 저장된 유형을 유지하고 판매 준비에 경고가 보인다.
select good.product_no, good.id, good.name, good.type as stored_type,
  private.goods_category_type(good.category_id) as category_type,
  case when good.published_at is not null then '공개' else '초안' end as publication,
  category.code as category_code
from public.goods as good
left join public.catalog_categories as category on category.id = good.category_id
where good.archived_at is null and good.category_id is not null
  and good.type is distinct from private.goods_category_type(good.category_id)
order by good.published_at is null, good.product_no;
-- (3) 대표 카테고리가 없는 상품. 초안은 공개할 수 없고, 공개 중은 저장된 유형을 유지한 채 판매 준비에 경고가 보인다.
select good.product_no, good.id, good.name, good.type as stored_type,
  case when good.published_at is not null then '공개' else '초안' end as publication
from public.goods as good
where good.archived_at is null and good.category_id is null
order by good.published_at is null, good.product_no;

begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.gt_expect_error(statement text,expected_message text,expected_code text default null)
returns void language plpgsql as $$ begin
  begin execute statement;
  exception when others then
    if position(expected_message in sqlerrm)=0 or (expected_code is not null and sqlstate<>expected_code) then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %',expected_message;
end $$;
-- 지금 운영자로 KC 해당 없음 검토를 완료한다(사용 중인 옵션 전체 연결).
create function pg_temp.gt_review(p_good_id text) returns void language plpgsql as $$
declare config jsonb;
begin
  config:=public.admin_read_goods_kc(p_good_id);
  perform public.admin_save_goods_kc(p_good_id,jsonb_build_array(jsonb_build_object('family','other','scheme','not_applicable',
    'productCategory','','modelName','','businessRole','','businessName','','identifier','','publicNote','',
    'variantIds',(select jsonb_agg(id::text) from public.goods_variants where good_id=p_good_id and archived_at is null),'basis','',
    'evidence',jsonb_build_object('applicability','','certificate','','testReport','','declaration',''))),
    'reviewed',(config->>'revision')::integer,config->>'contextFingerprint',true);
end $$;
-- 어드민 상품 폼과 같은 전체 저장 입력(상품 + 옵션 + 기준값).
create function pg_temp.gt_payload(target_id text) returns jsonb language sql as $$
  select record->'good'||jsonb_build_object('previous_id',target_id,
    'variant_baseline',(select coalesce(jsonb_agg(value->'id'),'[]') from jsonb_array_elements(record->'variants') where value->>'archived_at' is null),
    'variants',(select jsonb_agg(jsonb_build_object('id',value->'id','name',value->'name','code',value->'code','attributes',value->'attributes',
      'extraPrice',(value->>'price')::integer-(record#>>'{good,price}')::integer,'stockQty',value->'stock_qty',
      'expectedStockQty',value->'stock_qty','isActive',value->>'archived_at' is null,'lowStockThreshold',value->'low_stock_threshold'))
      from jsonb_array_elements(record->'variants')))
  from public.admin_goods_import_records('{}',array[target_id]) record;
$$;

-- --------------------------------------------------------------------------
-- 봉인·계약: 새 함수는 브라우저 롤이 못 부른다. 카테고리 RPC는 새 시그니처만 있고 authenticated만 실행한다.
-- 연결 칸의 유형 목록은 goods_type_check와 같다(lib/goods-taxonomy.ts GOOD_TYPES와 함께 고친다).
-- --------------------------------------------------------------------------
select 1/case when not exists(select 1 from pg_proc p cross join unnest(array['public','anon','authenticated','service_role']) r
    where p.oid in('private.goods_category_type(uuid)'::regprocedure,'private.goods_category_type_majority()'::regprocedure,
      'private.derive_goods_type_from_category()'::regprocedure,'private.refresh_category_good_type_goods()'::regprocedure)
      and r<>'public' and has_function_privilege(r,p.oid,'execute'))
 and has_function_privilege('authenticated','public.admin_upsert_category(uuid,uuid,text,text,uuid,integer,timestamptz,text)','execute')
 and not has_function_privilege('anon','public.admin_upsert_category(uuid,uuid,text,text,uuid,integer,timestamptz,text)','execute')
 and not has_function_privilege('service_role','public.admin_upsert_category(uuid,uuid,text,text,uuid,integer,timestamptz,text)','execute')
 and to_regprocedure('public.admin_upsert_category(uuid,uuid,text,text,uuid,integer,timestamptz)') is null
 and exists(select 1 from private.operator_rpc_contracts where signature='public.admin_upsert_category(uuid,uuid,text,text,uuid,integer,timestamp with time zone,text)'
   and capability='catalog.manage' and guard_kind='write')
 and not exists(select 1 from private.operator_rpc_contracts where signature='public.admin_upsert_category(uuid,uuid,text,text,uuid,integer,timestamp with time zone)')
 and (select array_agg(m[1] order by m[1]) from regexp_matches(pg_get_constraintdef((select oid from pg_constraint
     where conname='catalog_categories_good_type_check' and conrelid='public.catalog_categories'::regclass)),'''([^'']+)''','g') m)
   = (select array_agg(m[1] order by m[1]) from regexp_matches(pg_get_constraintdef((select oid from pg_constraint
     where conname='goods_type_check' and conrelid='public.goods'::regclass)),'''([^'']+)''','g') m)
 and exists(select 1 from pg_trigger where tgrelid='public.goods'::regclass and tgname='goods_kc_guard'
   and pg_get_triggerdef(oid) like '%category_id%')
 then 1 else 0 end as sealed_functions_signature_and_type_list;

-- --------------------------------------------------------------------------
-- 운영자·합성 데이터
-- --------------------------------------------------------------------------
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('98160000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','goods-type-'||n||'@example.test',now(),'{}','{}' from generate_series(1,2) n;
update public.profiles set role='staff',nickname='유형파생'||right(id::text,1) where id::text like '98160000-0000-4000-8000-00000000000%';
insert into private.operator_memberships(profile_id,manager_role) values
 ('98160000-0000-4000-8000-000000000001','primary'),('98160000-0000-4000-8000-000000000002','logistics');
update private.operator_access_state set configured=true where id;
insert into public.verticals(key,label,color) values('goods-type-tests','유형 파생 합성검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('goods-type-tests','유형 파생 합성검증','goods-type-tests',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active)
 values('00000000-0000-4000-8000-000000160030','goods-type-tests','합성 출고지','hanjin',3000,30000,'배송 금지 검증 주소',true);
-- 루트(피규어) > 물려받는 말단·자기 연결(인형) 말단, 연결 없는 루트 말단, 키링 루트 말단 2개.
insert into public.catalog_categories(id,code,name,parent_id,depth,sort_order,good_type) values
 ('00000000-0000-4000-8000-000000160100','gt-root','합성 피규어',null,1,0,'피규어'),
 ('00000000-0000-4000-8000-000000160101','gt-inherit','합성 물려받는 말단','00000000-0000-4000-8000-000000160100',2,0,null),
 ('00000000-0000-4000-8000-000000160102','gt-own','합성 인형 말단','00000000-0000-4000-8000-000000160100',2,1,'인형'),
 ('00000000-0000-4000-8000-000000160103','gt-inherit-2','합성 물려받는 말단 2','00000000-0000-4000-8000-000000160100',2,2,null),
 ('00000000-0000-4000-8000-000000160110','gt-none','합성 연결 없음',null,1,1,null),
 ('00000000-0000-4000-8000-000000160120','gt-keyring','합성 키링',null,1,2,'키링'),
 ('00000000-0000-4000-8000-000000160121','gt-keyring-pub','합성 키링 공개',null,1,3,'키링'),
 ('00000000-0000-4000-8000-000000160130','gt-pouch-parent','합성 파우치 상위',null,1,4,'파우치');
-- 공개 조건(대표 이미지·고시 7칸·출고지)은 채운다. 합성 이미지 경로는 시스템 입력으로 넣는다.
insert into public.goods(id,ip_id,name,type,price,image_path,origin_id,category_id,notice_maker,notice_origin,notice_material,
 notice_size,notice_made_on,notice_as_manager,notice_as_contact)
 select id,'goods-type-tests','합성 '||id,type,1000,'public-media/goods-type-test.webp','00000000-0000-4000-8000-000000160030',category_id,
  '합성 제조자','합성 국가','합성 소재','합성 크기','2026-11','합성 CS','02-000'
 from (values
  ('gt-inherit-good','문구','00000000-0000-4000-8000-000000160101'::uuid),
  ('gt-own-good','피규어','00000000-0000-4000-8000-000000160102'::uuid),
  ('gt-none-good','문구','00000000-0000-4000-8000-000000160110'::uuid),
  ('gt-nocat-good','쿠션',null::uuid),
  ('gt-move-good','문구','00000000-0000-4000-8000-000000160101'::uuid),
  ('gt-draft-good','문구','00000000-0000-4000-8000-000000160101'::uuid),
  ('gt-defer-good','키링',null::uuid),
  ('gt-keyring-good','문구','00000000-0000-4000-8000-000000160120'::uuid)
 ) as fixtures(id,type,category_id);
update public.goods_variants set stock_qty=5 where good_id like 'gt-%';

-- 새 초안은 대표 카테고리(없으면 가까운 상위)의 연결값으로 저장된다. 연결이 없으면 들어온 값을 둔다(공개는 막힌다).
select 1/case when (select type from public.goods where id='gt-inherit-good')='피규어'
 and (select type from public.goods where id='gt-own-good')='인형'
 and (select type from public.goods where id='gt-none-good')='문구'
 and (select type from public.goods where id='gt-nocat-good')='쿠션'
 and (select type from public.goods where id='gt-keyring-good')='키링'
 and private.goods_category_type('00000000-0000-4000-8000-000000160101')='피규어'
 and private.goods_category_type('00000000-0000-4000-8000-000000160102')='인형'
 and private.goods_category_type('00000000-0000-4000-8000-000000160110')=''
 and private.goods_category_type(null)=''
 then 1 else 0 end as insert_derives_nearest_link;

-- --------------------------------------------------------------------------
-- 연결 초기값(배포 migration과 같은 함수): 보관 제외·유형 있는 상품의 최다 유형, 동률은 비우고 tied_types로 알린다.
-- --------------------------------------------------------------------------
insert into public.catalog_categories(id,code,name,depth,sort_order) values
 ('00000000-0000-4000-8000-000000160201','gt-vote-majority','합성 다수결',1,9),
 ('00000000-0000-4000-8000-000000160202','gt-vote-tie','합성 동률',1,9),
 ('00000000-0000-4000-8000-000000160203','gt-vote-empty','합성 유형 없음',1,9);
insert into public.goods(id,ip_id,name,type,price,category_id)
 select 'gt-vote-'||n,'goods-type-tests','합성 투표 '||n,type,1000,category_id::uuid from (values
  (1,'키링','00000000-0000-4000-8000-000000160201'),(2,'키링','00000000-0000-4000-8000-000000160201'),
  (3,'인형','00000000-0000-4000-8000-000000160201'),(4,'인형','00000000-0000-4000-8000-000000160201'),
  (5,'인형','00000000-0000-4000-8000-000000160201'),
  (6,'문구','00000000-0000-4000-8000-000000160202'),(7,'쿠션','00000000-0000-4000-8000-000000160202'),
  (8,'','00000000-0000-4000-8000-000000160203')) as votes(n,type,category_id);
-- 보관 상품은 세지 않는다: 인형 2개를 보관하면 키링 2 > 인형 1이다.
update public.goods set archived_at=now() where id in('gt-vote-4','gt-vote-5');
select 1/case when (select good_type from private.goods_category_type_majority() where category_id='00000000-0000-4000-8000-000000160201')='키링'
 and (select good_type is null and tied_types=array['문구','쿠션'] from private.goods_category_type_majority() where category_id='00000000-0000-4000-8000-000000160202')
 and not exists(select 1 from private.goods_category_type_majority() where category_id='00000000-0000-4000-8000-000000160203')
 then 1 else 0 end as initial_links_follow_unique_majority;

set local role authenticated;
select set_config('request.jwt.claim.sub','98160000-0000-4000-8000-000000000001',true);

-- --------------------------------------------------------------------------
-- 공개 전환: 연결이 없으면(대표 카테고리 없음 포함) 거절하고, 판매 준비가 type_missing을 막는 사유로 보인다.
-- --------------------------------------------------------------------------
select pg_temp.gt_review('gt-none-good');
select pg_temp.gt_review('gt-nocat-good');
select pg_temp.gt_expect_error($sql$select public.admin_set_good_published('gt-none-good',true)$sql$,'goods_type_category_required','23514');
select pg_temp.gt_expect_error($sql$select public.admin_set_good_published('gt-nocat-good',true)$sql$,'goods_type_category_required','23514');
select 1/case when public.admin_read_goods_readiness('gt-none-good')->'blockingCodes' ? 'type_missing'
 and public.admin_read_goods_readiness('gt-nocat-good')->'blockingCodes' ? 'type_missing'
 and not (public.admin_read_goods_readiness('gt-inherit-good')->'reasonCodes' ? 'type_missing')
 then 1 else 0 end as readiness_blocks_unlinked_drafts;
-- 연결된 카테고리 상품은 KC 검토 뒤 공개된다.
select pg_temp.gt_review('gt-inherit-good');
select public.admin_set_good_published('gt-inherit-good',true);
select 1/case when (select published_at is not null and type='피규어' from public.goods where id='gt-inherit-good')
 and public.admin_read_goods_readiness('gt-inherit-good')->>'state'='ready'
 then 1 else 0 end as linked_draft_publishes_with_category_type;

-- 아직 맞추지 않은 초안(배포 전 초안처럼 저장된 유형이 연결값과 다름)은 공개를 거절하고, 판매 준비가 막는 사유로 보인다.
reset role;
set local session_replication_role = replica;
update public.goods set type='문구' where id='gt-own-good';
set local session_replication_role = origin;
set local role authenticated;
select set_config('request.jwt.claim.sub','98160000-0000-4000-8000-000000000001',true);
select pg_temp.gt_review('gt-own-good');
select pg_temp.gt_expect_error($sql$select public.admin_set_good_published('gt-own-good',true)$sql$,'goods_type_category_changed','23514');
select 1/case when public.admin_read_goods_readiness('gt-own-good')->'blockingCodes' ? 'type_category_mismatch'
 then 1 else 0 end as readiness_blocks_stale_drafts;
-- 그 초안을 저장하면 연결값으로 맞춰지고(KC 미검토로 돌아감) 다시 검토하면 공개된다.
select public.admin_save_good(pg_temp.gt_payload('gt-own-good')) is not null as gt_own_saved;
select 1/case when (select type from public.goods where id='gt-own-good')='인형'
 and public.admin_read_goods_kc('gt-own-good')->>'status'='unreviewed'
 then 1 else 0 end as saving_stale_draft_applies_category_type;
select pg_temp.gt_review('gt-own-good');
select public.admin_set_good_published('gt-own-good',true);

-- --------------------------------------------------------------------------
-- 초안: 들어온 유형은 연결값이 있으면 무시하고, 카테고리를 바꾸면 유형이 바뀌며 KC 검토가 미검토로 돌아간다.
-- --------------------------------------------------------------------------
select public.admin_save_good(pg_temp.gt_payload('gt-keyring-good')||'{"type":"인형"}') is not null as gt_keyring_saved;
select 1/case when (select type from public.goods where id='gt-keyring-good')='키링' then 1 else 0 end as draft_payload_type_ignored_when_linked;
select pg_temp.gt_review('gt-move-good');
select public.admin_assign_good_category('00000000-0000-4000-8000-000000160301','gt-move-good','00000000-0000-4000-8000-000000160120',null);
select 1/case when (select type from public.goods where id='gt-move-good')='키링'
 and public.admin_read_goods_kc('gt-move-good')->>'status'='unreviewed'
 and public.admin_read_goods_kc('gt-move-good')#>>'{history,0,reason}'='goods_context_changed'
 then 1 else 0 end as draft_category_change_rederives_and_invalidates_kc;

-- 카테고리를 바꾸며 공개하면 카테고리를 바꾼 뒤 공개한다(공개 판정이 새 카테고리의 유형을 본다).
select pg_temp.gt_review('gt-defer-good');
select public.admin_save_good(pg_temp.gt_payload('gt-defer-good')||jsonb_build_object('category_id','00000000-0000-4000-8000-000000160121','publish',true)) is not null as gt_defer_saved;
select 1/case when (select published_at is not null and type='키링' and category_id='00000000-0000-4000-8000-000000160121' from public.goods where id='gt-defer-good')
 and public.admin_read_goods_kc('gt-defer-good')->>'status'='reviewed'
 then 1 else 0 end as publish_waits_for_category_change;

-- --------------------------------------------------------------------------
-- 공개 중: 상품 유형이 바뀌는(연결 없음 포함) 대표 카테고리 변경은 막고, 유형이 같으면 옮길 수 있다.
-- --------------------------------------------------------------------------
select pg_temp.gt_expect_error($sql$select public.admin_assign_good_category('00000000-0000-4000-8000-000000160302','gt-inherit-good','00000000-0000-4000-8000-000000160102',null)$sql$,
 'goods_type_category_locked','23514');
select pg_temp.gt_expect_error($sql$select public.admin_assign_good_category('00000000-0000-4000-8000-000000160303','gt-inherit-good','00000000-0000-4000-8000-000000160110',null)$sql$,
 'goods_type_category_required','23514');
select pg_temp.gt_expect_error($sql$select public.admin_assign_good_category('00000000-0000-4000-8000-000000160304','gt-inherit-good',null,null)$sql$,
 'goods_type_category_required','23514');
select pg_temp.gt_expect_error(format('select public.admin_save_good(%L::jsonb)',
 (pg_temp.gt_payload('gt-inherit-good')||'{"category_id":"00000000-0000-4000-8000-000000160102"}')::text),'goods_type_category_locked','23514');
select public.admin_assign_good_category('00000000-0000-4000-8000-000000160305','gt-inherit-good','00000000-0000-4000-8000-000000160103',null);
select 1/case when (select published_at is not null and type='피규어' and category_id='00000000-0000-4000-8000-000000160103' from public.goods where id='gt-inherit-good')
 then 1 else 0 end as published_moves_within_same_type;
-- 공개 중 상품의 유형은 저장 입력으로 바뀌지 않는다(KC 재검토가 필요하다는 기존 잠금).
select pg_temp.gt_expect_error(format('select public.admin_save_good(%L::jsonb)',
 (pg_temp.gt_payload('gt-inherit-good')||'{"type":"인형"}')::text),'goods_kc_reassessment_required','23514');

-- --------------------------------------------------------------------------
-- 카테고리 연결 변경: 그 아래(하위 포함) 초안은 새 연결값으로 바뀌고 KC가 미검토로 돌아간다. 공개 중 상품은 저장된 유형을
-- 유지하고(다른 칸 저장도 된다) 판매 준비에 검토 사유로만 남는다. 연결을 지우면 초안의 유형을 지우지 않는다.
-- --------------------------------------------------------------------------
select pg_temp.gt_review('gt-draft-good');
select public.admin_upsert_category('00000000-0000-4000-8000-000000160306','00000000-0000-4000-8000-000000160100','gt-root','합성 피규어',null,0,
 (select updated_at from public.catalog_categories where id='00000000-0000-4000-8000-000000160100'),'인형') as root_relinked \gset
select 1/case when :'root_relinked'::jsonb->>'goodType'='인형'
 and (select type from public.goods where id='gt-draft-good')='인형'
 and public.admin_read_goods_kc('gt-draft-good')->>'status'='unreviewed'
 and (select type from public.goods where id='gt-inherit-good')='피규어'
 and (select type from public.goods where id='gt-own-good')='인형'
 and exists(select 1 from public.audit_log where action='admin.catalog.category.good_type_changed'
   and target='catalog_categories:00000000-0000-4000-8000-000000160100' and diff->>'before'='피규어' and diff->>'after'='인형'
   and diff->'refreshedDraftGoodIds' ? 'gt-draft-good' and not (diff->'refreshedDraftGoodIds' ? 'gt-inherit-good'))
 and exists(select 1 from public.audit_log where id='00000000-0000-4000-8000-000000160306' and diff#>>'{before,good_type}'='피규어'
   and diff#>>'{after,good_type}'='인형' and diff#>>'{request,good_type}'='인형')
 then 1 else 0 end as relink_refreshes_drafts_and_keeps_published;
select 1/case when public.admin_read_goods_readiness('gt-inherit-good')->'reasonCodes' ? 'type_category_mismatch'
 and not (public.admin_read_goods_readiness('gt-inherit-good')->'blockingCodes' ? 'type_category_mismatch')
 and public.admin_read_goods_readiness('gt-inherit-good')->>'state'='review_required'
 and (public.admin_search_goods_workspace(p_query=>'합성 gt-',p_readiness=>'type_category_mismatch')->>'total')::integer>=1
 then 1 else 0 end as published_mismatch_is_review_warning;
-- 공개 중 상품은 연결값과 달라도 다른 칸 저장이 된다(저장된 유형 유지).
select public.admin_save_good(pg_temp.gt_payload('gt-inherit-good')||'{"price":1200}') is not null as gt_inherit_price_saved;
select 1/case when (select price=1200 and type='피규어' and published_at is not null from public.goods where id='gt-inherit-good')
 then 1 else 0 end as published_keeps_stored_type_on_other_saves;
-- 연결을 지우면(상위도 없음) 초안의 유형은 남지만 공개는 막힌다.
select public.admin_upsert_category('00000000-0000-4000-8000-000000160307','00000000-0000-4000-8000-000000160100','gt-root','합성 피규어',null,0,
 (select updated_at from public.catalog_categories where id='00000000-0000-4000-8000-000000160100'),'') is not null as root_unlinked;
select 1/case when (select good_type is null from public.catalog_categories where id='00000000-0000-4000-8000-000000160100')
 and (select type from public.goods where id='gt-draft-good')='인형'
 and public.admin_read_goods_readiness('gt-draft-good')->'blockingCodes' ? 'type_missing'
 then 1 else 0 end as unlink_keeps_draft_type_but_blocks_publish;
-- 상위를 옮기면 그 아래 초안도 새 경로의 연결값을 따른다(연결 없는 루트 말단을 파우치 상위 아래로).
select public.admin_upsert_category('00000000-0000-4000-8000-000000160308','00000000-0000-4000-8000-000000160110','gt-none','합성 연결 없음',
 '00000000-0000-4000-8000-000000160130',1,(select updated_at from public.catalog_categories where id='00000000-0000-4000-8000-000000160110'),null)
 is not null as gt_none_moved;
select 1/case when (select type from public.goods where id='gt-none-good')='파우치'
 and (select good_type is null from public.catalog_categories where id='00000000-0000-4000-8000-000000160110')
 then 1 else 0 end as parent_move_refreshes_subtree_drafts;

-- --------------------------------------------------------------------------
-- 카테고리 RPC: 새로 만들 때 연결, null은 그대로, ''는 해제, 목록 밖 값은 거절, 같은 요청 재시도는 같은 결과.
-- --------------------------------------------------------------------------
select public.admin_upsert_category('00000000-0000-4000-8000-000000160309',null,'gt-created','합성 새 카테고리',null,5,null,'세트') as created \gset
select public.admin_upsert_category('00000000-0000-4000-8000-000000160309',null,'gt-created','합성 새 카테고리',null,5,null,'세트') as created_again \gset
select 1/case when :'created'::jsonb->>'goodType'='세트' and :'created'::jsonb->>'id'=:'created_again'::jsonb->>'id'
 and (select good_type from public.catalog_categories where id=(:'created'::jsonb->>'id')::uuid)='세트'
 then 1 else 0 end as create_links_type_idempotently;
select public.admin_upsert_category('00000000-0000-4000-8000-000000160310',(:'created'::jsonb->>'id')::uuid,'gt-created','합성 새 카테고리 이름',null,5,
 (select updated_at from public.catalog_categories where id=(:'created'::jsonb->>'id')::uuid)) is not null as created_renamed;
select 1/case when (select good_type from public.catalog_categories where id=(:'created'::jsonb->>'id')::uuid)='세트'
 then 1 else 0 end as omitted_type_keeps_link;
select pg_temp.gt_expect_error(format('select public.admin_upsert_category(%L,%L,%L,%L,null,5,%L,%L)','00000000-0000-4000-8000-000000160311',
 :'created'::jsonb->>'id','gt-created','합성 새 카테고리 이름',(select updated_at from public.catalog_categories where id=(:'created'::jsonb->>'id')::uuid),'포스터'),
 'invalid_category_good_type','22023');
-- 상품 관리 권한이 없는 운영자(물류)는 연결을 바꾸지 못한다.
select set_config('request.jwt.claim.sub','98160000-0000-4000-8000-000000000002',true);
select pg_temp.gt_expect_error(format('select public.admin_upsert_category(%L,%L,%L,%L,null,5,%L,%L)','00000000-0000-4000-8000-000000160312',
 :'created'::jsonb->>'id','gt-created','합성 새 카테고리 이름',(select updated_at from public.catalog_categories where id=(:'created'::jsonb->>'id')::uuid),'기타'),
 'operator_capability_required','42501');
reset role;
rollback;
