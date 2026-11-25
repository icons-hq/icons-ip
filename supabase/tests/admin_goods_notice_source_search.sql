\set ON_ERROR_STOP on
-- 상품정보제공고시 [다른 상품에서 복사] 선택창 조회(admin_search_goods_notice_sources).
-- 고시를 한 칸이라도 적어 둔 상품만 나오고 총 개수·페이지가 맞는지, 지금 편집 중인 상품은 빠지는지, 기존 상품 검색(admin_search_goods_console)은 그대로인지,
-- 권한(catalog.read)·실행 권한 봉인·운영자 계약 등록을 본다. 준비물은 모두 rollback된다.
begin;
select set_config('request.jwt.claim.sub','',true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('05e30000-0000-4000-8000-000000000001','authenticated','authenticated','notice-source-primary@example.test',now(),'{}','{}',now(),now()),
 ('05e30000-0000-4000-8000-000000000002','authenticated','authenticated','notice-source-logistics@example.test',now(),'{}','{}',now(),now()),
 ('05e30000-0000-4000-8000-000000000003','authenticated','authenticated','notice-source-member@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id in ('05e30000-0000-4000-8000-000000000001','05e30000-0000-4000-8000-000000000002');
-- primary는 catalog.read가 있고, logistics는 없다(공지·출고만).
insert into private.operator_memberships(profile_id,manager_role) values
 ('05e30000-0000-4000-8000-000000000001','primary'),('05e30000-0000-4000-8000-000000000002','logistics');
update private.operator_access_state set configured=true where id;

insert into public.ips(id,title,vertical_key,published_at) values('notice-source-ip','고시 원본 검증','character',now());
insert into public.catalog_categories(id,code,name,parent_id,depth,sort_order) values
 ('05e30000-0000-4000-8000-000000000101','notice-source-parent','고시 원본 상위',null,1,0),
 ('05e30000-0000-4000-8000-000000000102','notice-source-child','고시 원본 하위','05e30000-0000-4000-8000-000000000101',2,0);
-- blank: 고시를 한 칸도 적지 않았다. spaces: 공백만 적혀 있다. full: 7칸 모두. contact: A/S 연락처 한 칸만.
-- size: 크기 · 중량 한 칸만(앞뒤 공백 포함). archived: 7칸을 적었지만 보관된 상품. current: 지금 편집 중인 상품(7칸).
insert into public.goods(id,code,ip_id,name,price,stock,created_at,category_id,
  notice_maker,notice_origin,notice_material,notice_size,notice_made_on,notice_as_manager,notice_as_contact) values
 ('notice-source-blank','NSRC-BLANK','notice-source-ip','고시원본 엽서',1000,'ok','2026-11-01T00:00:00Z',null,null,null,null,null,null,null,null),
 ('notice-source-spaces','NSRC-SPACES','notice-source-ip','고시원본 스티커',1000,'ok','2026-11-02T00:00:00Z',null,'','  ',E'\t',E' \n ',null,E'\r\n',E'\f\v'),
 ('notice-source-full','NSRC-FULL','notice-source-ip','고시원본 티셔츠',1000,'ok','2026-11-03T00:00:00Z','05e30000-0000-4000-8000-000000000102',
  '아이콘스','대한민국','면','L · 200g','2026-11','고객센터','02-000-0000'),
 ('notice-source-contact','NSRC-CONTACT','notice-source-ip','고시원본 키링',1000,'ok','2026-11-04T00:00:00Z',null,null,null,null,null,null,null,'02-111-1111'),
 ('notice-source-size','NSRC-SIZE','notice-source-ip','고시원본 머그',1000,'ok','2026-11-05T00:00:00Z',null,null,'',null,'  350ml  ',null,null,null),
 ('notice-source-archived','NSRC-ARCHIVED','notice-source-ip','고시원본 양말',1000,'ok','2026-11-06T00:00:00Z',null,
  '아이콘스','대한민국','면','M','2026-10','고객센터','02-000-0000'),
 ('notice-source-current','NSRC-CURRENT','notice-source-ip','고시원본 모자',1000,'ok','2026-11-07T00:00:00Z',null,
  '아이콘스','대한민국','면','F','2026-09','고객센터','02-000-0000');
update public.goods set archived_at=now() where id='notice-source-archived';

-- 1. 실행 권한: authenticated만. anon·service_role·public은 실행할 수 없다.
select 1/case when has_function_privilege('authenticated','public.admin_search_goods_notice_sources(text,text,uuid,text,integer,integer)','execute')
 and not has_function_privilege('anon','public.admin_search_goods_notice_sources(text,text,uuid,text,integer,integer)','execute')
 and not has_function_privilege('service_role','public.admin_search_goods_notice_sources(text,text,uuid,text,integer,integer)','execute')
 and not exists(select 1 from pg_proc p, aclexplode(p.proacl) acl
  where p.oid='public.admin_search_goods_notice_sources(text,text,uuid,text,integer,integer)'::regprocedure and acl.grantee=0)
 then 1 else 0 end as assert_execute_is_sealed_to_authenticated;
-- 2. 운영자 계약: catalog.read 읽기로 등록되고 본문 지문이 지금 함수와 같다.
select 1/case when exists(select 1 from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
  where c.signature='public.admin_search_goods_notice_sources(text,text,uuid,text,integer,integer)'
   and c.capability='catalog.read' and c.guard_kind='read' and not c.legacy_admin_only and c.body_md5=md5(p.prosrc))
 and exists(select 1 from private.operator_internal_contracts where signature='public.admin_search_goods_notice_sources(text,text,uuid,text,integer,integer)')
 then 1 else 0 end as assert_operator_contract_registered;

set local role authenticated;
select set_config('request.jwt.claim.sub','05e30000-0000-4000-8000-000000000001',true);
-- 3. 고시를 한 칸이라도 적은 상품만, 등록일 최신순(이 시험의 상품 이름 '고시원본'으로 좁혀 다른 데이터가 있는 DB에서도 같은 결과다).
--    한 칸도 적지 않은 상품·공백만 적힌 상품·보관 상품은 없다. 저장 전인 새 상품(뺄 상품 없음)에서 연 경우다.
select public.admin_search_goods_notice_sources(p_query=>'고시원본') as listed \gset
select 1/case when (:'listed'::jsonb->>'total')::int=4
 and (select jsonb_agg(item->>'id' order by position) from jsonb_array_elements(:'listed'::jsonb->'rows') with ordinality as r(item,position))
  ='["notice-source-current","notice-source-size","notice-source-contact","notice-source-full"]'::jsonb
 then 1 else 0 end as assert_only_goods_with_notice_newest_first;
-- 줄에는 선택창이 쓰는 값만 있다(고시 내용·재고·준비 상태 같은 값은 없다).
select 1/case when (select array_agg(key order by key) from jsonb_object_keys(:'listed'::jsonb->'rows'->0) key)
  =array['archivedAt','categoryName','code','id','imagePath','name','publishedAt']
 and :'listed'::jsonb->'rows'->3->>'categoryName'='고시 원본 하위' and :'listed'::jsonb->'rows'->3->>'code'='NSRC-FULL'
 and :'listed'::jsonb->'rows'->3->'archivedAt'='null'::jsonb
 then 1 else 0 end as assert_row_shape_is_picker_projection;
-- 4. 지금 편집 중인 상품은 뺀다(자기 고시는 복사할 수 없다). 총 개수도 뺀 뒤의 수다.
select 1/case when (public.admin_search_goods_notice_sources(p_query=>'고시원본',p_exclude_good_id=>'notice-source-current')->>'total')::int=3
 and not exists(select 1 from jsonb_array_elements(public.admin_search_goods_notice_sources(p_query=>'고시원본',p_exclude_good_id=>'notice-source-current')->'rows') item
  where item->>'id'='notice-source-current')
 and public.admin_search_goods_notice_sources(p_query=>'고시원본',p_exclude_good_id=>'notice-source-current')->'rows'->0->>'id'='notice-source-size'
 then 1 else 0 end as assert_current_good_is_excluded;
-- 5. 총 개수는 걸러 낸 뒤의 수이고 페이지와 맞는다.
select 1/case when (public.admin_search_goods_notice_sources(p_query=>'고시원본',p_exclude_good_id=>'notice-source-current',p_limit=>2)->>'total')::int=3
 and jsonb_array_length(public.admin_search_goods_notice_sources(p_query=>'고시원본',p_exclude_good_id=>'notice-source-current',p_limit=>2)->'rows')=2
 and jsonb_array_length(public.admin_search_goods_notice_sources(p_query=>'고시원본',p_exclude_good_id=>'notice-source-current',p_limit=>2,p_offset=>2)->'rows')=1
 and public.admin_search_goods_notice_sources(p_query=>'고시원본',p_exclude_good_id=>'notice-source-current',p_limit=>2,p_offset=>2)->'rows'->0->>'id'='notice-source-full'
 and jsonb_array_length(public.admin_search_goods_notice_sources(p_query=>'고시원본',p_exclude_good_id=>'notice-source-current',p_limit=>2,p_offset=>4)->'rows')=0
 then 1 else 0 end as assert_total_and_pages_agree;
-- 6. 검색 대상(상품명·자동코드·상품 URL)과 카테고리(하위 포함)는 상품 조회/수정과 같은 검색이고, 그 뒤에 고시 조건이 걸린다.
select 1/case when public.admin_search_goods_notice_sources(p_query=>'티셔츠')->'rows'->0->>'id'='notice-source-full'
 and (public.admin_search_goods_notice_sources(p_query=>'티셔츠')->>'total')::int=1
 and (public.admin_search_goods_notice_sources(p_query=>'엽서')->>'total')::int=0
 and (public.admin_search_goods_notice_sources(p_query=>'스티커')->>'total')::int=0
 and public.admin_search_goods_notice_sources(p_query=>'nsrc-contact',p_field=>'code')->'rows'->0->>'id'='notice-source-contact'
 and (public.admin_search_goods_notice_sources(p_query=>'NSRC-BLANK',p_field=>'code')->>'total')::int=0
 and (public.admin_search_goods_notice_sources(p_query=>'notice-source-full, notice-source-blank, notice-source-archived',p_field=>'id')->>'total')::int=1
 and (public.admin_search_goods_notice_sources(p_category_id=>'05e30000-0000-4000-8000-000000000101')->>'total')::int=1
 and public.admin_search_goods_notice_sources(p_category_id=>'05e30000-0000-4000-8000-000000000101')->'rows'->0->>'id'='notice-source-full'
 then 1 else 0 end as assert_search_and_category_apply_before_notice_condition;
-- 7. 기존 상품 검색은 그대로다: 고시가 빈 상품도 나온다(보관만 뺀다).
select 1/case when (public.admin_search_goods_console(p_ip_id=>'notice-source-ip',p_status=>'active')->>'total')::int=6
 and exists(select 1 from jsonb_array_elements(public.admin_search_goods_console(p_ip_id=>'notice-source-ip',p_status=>'active')->'rows') item
  where item->>'id'='notice-source-blank')
 then 1 else 0 end as assert_existing_goods_search_is_unchanged;
-- 8. 잘못된 조건은 조회 전에 거절한다.
do $$ begin
 begin perform public.admin_search_goods_notice_sources(p_limit=>0); raise exception 'expected invalid_goods_notice_source_page';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_goods_notice_source_page' then raise; end if; end;
 begin perform public.admin_search_goods_notice_sources(p_limit=>101); raise exception 'expected invalid_goods_notice_source_page';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_goods_notice_source_page' then raise; end if; end;
 begin perform public.admin_search_goods_notice_sources(p_offset=>-1); raise exception 'expected invalid_goods_notice_source_page';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_goods_notice_source_page' then raise; end if; end;
 begin perform public.admin_search_goods_notice_sources(p_field=>'erp'); raise exception 'expected invalid_goods_notice_source_filter';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_goods_notice_source_filter' then raise; end if; end;
 begin perform public.admin_search_goods_notice_sources(p_query=>repeat('가',101)); raise exception 'expected invalid_goods_notice_source_filter';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_goods_notice_source_filter' then raise; end if; end;
 begin perform public.admin_search_goods_notice_sources(p_exclude_good_id=>repeat('a',101)); raise exception 'expected invalid_goods_notice_source_filter';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_goods_notice_source_filter' then raise; end if; end;
end $$;
-- 9. catalog.read가 없는 운영자·일반 회원·로그인하지 않은 호출은 거절한다.
select set_config('request.jwt.claim.sub','05e30000-0000-4000-8000-000000000002',true);
do $$ begin
 perform public.admin_search_goods_notice_sources(); raise exception 'logistics operator must not search notice sources';
exception when insufficient_privilege then if sqlerrm<>'operator_capability_required' then raise; end if; end $$;
select set_config('request.jwt.claim.sub','05e30000-0000-4000-8000-000000000003',true);
do $$ begin
 perform public.admin_search_goods_notice_sources(); raise exception 'member must not search notice sources';
exception when insufficient_privilege then if sqlerrm<>'operator_capability_required' then raise; end if; end $$;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 perform public.admin_search_goods_notice_sources(); raise exception 'signed-out caller must not search notice sources';
exception when insufficient_privilege then if sqlerrm<>'operator_capability_required' then raise; end if; end $$;
reset role;
set local role anon;
do $$ begin
 perform public.admin_search_goods_notice_sources(); raise exception 'anon must not execute notice source search';
exception when insufficient_privilege then if sqlerrm not like 'permission denied for function%' then raise; end if; end $$;
reset role;
rollback;
