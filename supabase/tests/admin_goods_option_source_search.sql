\set ON_ERROR_STOP on
-- 다른 상품 옵션 불러오기 선택창 조회(admin_search_goods_option_sources).
-- 선택형 옵션이 있는 상품만 나오고 총 개수·페이지가 맞는지, 기존 상품 검색(admin_search_goods_console)은 그대로인지,
-- 권한(catalog.manage)·실행 권한 봉인·운영자 계약 등록을 본다. 준비물은 모두 rollback된다.
begin;
select set_config('request.jwt.claim.sub','',true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('05e10000-0000-4000-8000-000000000001','authenticated','authenticated','option-source-primary@example.test',now(),'{}','{}',now(),now()),
 ('05e10000-0000-4000-8000-000000000002','authenticated','authenticated','option-source-logistics@example.test',now(),'{}','{}',now(),now()),
 ('05e10000-0000-4000-8000-000000000003','authenticated','authenticated','option-source-member@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id in ('05e10000-0000-4000-8000-000000000001','05e10000-0000-4000-8000-000000000002');
-- primary는 catalog.manage가 있고, logistics는 없다(공지·출고만).
insert into private.operator_memberships(profile_id,manager_role) values
 ('05e10000-0000-4000-8000-000000000001','primary'),('05e10000-0000-4000-8000-000000000002','logistics');
update private.operator_access_state set configured=true where id;

insert into public.ips(id,title,vertical_key,published_at) values('option-source-ip','옵션 원본 검증','character',now());
insert into public.catalog_categories(id,code,name,parent_id,depth,sort_order) values
 ('05e10000-0000-4000-8000-000000000101','option-source-parent','옵션 원본 상위',null,1,0),
 ('05e10000-0000-4000-8000-000000000102','option-source-child','옵션 원본 하위','05e10000-0000-4000-8000-000000000101',2,0);
-- plain: 옵션 없이 파는 상품. shirt·keyring: 선택형 옵션. cap: 선택형 옵션이 모두 사용 중지되고 옵션값 없는 줄만 사용 중.
-- socks: 선택형 옵션이 있지만 보관된 상품. mug: 옵션값 없는 줄과 선택형 옵션이 섞임(목록에는 나오고, 고르면 앱이 원인을 알린다).
-- stopped: 옵션이 모두 사용 중지.
insert into public.goods(id,code,ip_id,name,price,stock,created_at,category_id) values
 ('option-source-plain','OSRC-PLAIN','option-source-ip','옵션원본 엽서',1000,'ok','2026-11-01T00:00:00Z',null),
 ('option-source-shirt','OSRC-SHIRT','option-source-ip','옵션원본 티셔츠',1000,'ok','2026-11-02T00:00:00Z','05e10000-0000-4000-8000-000000000102'),
 ('option-source-cap','OSRC-CAP','option-source-ip','옵션원본 모자',1000,'ok','2026-11-03T00:00:00Z',null),
 ('option-source-socks','OSRC-SOCKS','option-source-ip','옵션원본 양말',1000,'ok','2026-11-04T00:00:00Z',null),
 ('option-source-keyring','OSRC-KEYRING','option-source-ip','옵션원본 키링',1000,'ok','2026-11-05T00:00:00Z',null),
 ('option-source-mug','OSRC-MUG','option-source-ip','옵션원본 머그',1000,'ok','2026-11-06T00:00:00Z',null),
 ('option-source-stopped','OSRC-STOPPED','option-source-ip','옵션원본 스티커',1000,'ok','2026-11-07T00:00:00Z',null);
-- 첫 옵션(상품을 만들 때 생긴 한 줄)에 옵션값을 주고 둘째 옵션을 더한다.
update public.goods_variants set name='빨강',attributes='{"색상":"빨강"}'
 where good_id in ('option-source-shirt','option-source-socks','option-source-keyring','option-source-stopped');
insert into public.goods_variants(good_id,name,code,price,stock_qty,is_default,attributes,sort_order) values
 ('option-source-shirt','파랑','OSRC-SHIRT-BLUE',1000,3,false,'{"색상":"파랑"}',1),
 ('option-source-socks','파랑','OSRC-SOCKS-BLUE',1000,0,false,'{"색상":"파랑"}',1),
 ('option-source-keyring','파랑','OSRC-KEYRING-BLUE',1000,3,false,'{"색상":"파랑"}',1),
 ('option-source-cap','검정','OSRC-CAP-BLACK',1000,3,false,'{"색상":"검정"}',1),
 ('option-source-mug','대','OSRC-MUG-LARGE',1000,3,false,'{"크기":"대"}',1);
update public.goods_variants set archived_at=now() where code='OSRC-CAP-BLACK' or good_id='option-source-stopped';
-- 재고가 남은 상품은 보관할 수 없어 양말의 옵션은 재고 0으로 뒀다.
update public.goods set archived_at=now() where id='option-source-socks';

-- 1. 실행 권한: authenticated만. anon·service_role·public은 실행할 수 없다.
select 1/case when has_function_privilege('authenticated','public.admin_search_goods_option_sources(text,text,uuid,text,integer,integer)','execute')
 and not has_function_privilege('anon','public.admin_search_goods_option_sources(text,text,uuid,text,integer,integer)','execute')
 and not has_function_privilege('service_role','public.admin_search_goods_option_sources(text,text,uuid,text,integer,integer)','execute')
 then 1 else 0 end as assert_execute_is_sealed_to_authenticated;
-- 2. 운영자 계약: catalog.manage 읽기로 등록되고 본문 지문이 지금 함수와 같다.
select 1/case when exists(select 1 from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
  where c.signature='public.admin_search_goods_option_sources(text,text,uuid,text,integer,integer)'
   and c.capability='catalog.manage' and c.guard_kind='read' and not c.legacy_admin_only and c.body_md5=md5(p.prosrc))
 and exists(select 1 from private.operator_internal_contracts where signature='public.admin_search_goods_option_sources(text,text,uuid,text,integer,integer)')
 then 1 else 0 end as assert_operator_contract_registered;

set local role authenticated;
select set_config('request.jwt.claim.sub','05e10000-0000-4000-8000-000000000001',true);
-- 3. 선택형 옵션이 있는 상품만, 등록일 최신순(이 시험의 상품 이름 '옵션원본'으로 좁혀 다른 데이터가 있는 DB에서도 같은 결과다). 옵션 없는 상품·옵션이 모두 사용 중지된 상품·보관 상품은 없다.
select public.admin_search_goods_option_sources(p_query=>'옵션원본') as listed \gset
select 1/case when (:'listed'::jsonb->>'total')::int=3
 and (select jsonb_agg(item->>'id' order by position) from jsonb_array_elements(:'listed'::jsonb->'rows') with ordinality as r(item,position))
  ='["option-source-mug","option-source-keyring","option-source-shirt"]'::jsonb
 then 1 else 0 end as assert_only_goods_with_selectable_options_newest_first;
-- 줄에는 선택창이 쓰는 값만 있다(재고·준비 상태 같은 운영 값은 없다).
select 1/case when (select array_agg(key order by key) from jsonb_object_keys(:'listed'::jsonb->'rows'->0) key)
  =array['archivedAt','categoryName','code','id','imagePath','name','publishedAt']
 and :'listed'::jsonb->'rows'->2->>'categoryName'='옵션 원본 하위' and :'listed'::jsonb->'rows'->2->>'code'='OSRC-SHIRT'
 and :'listed'::jsonb->'rows'->2->'archivedAt'='null'::jsonb
 then 1 else 0 end as assert_row_shape_is_picker_projection;
-- 4. 총 개수는 걸러 낸 뒤의 수이고 페이지와 맞는다.
select 1/case when (public.admin_search_goods_option_sources(p_query=>'옵션원본',p_limit=>2)->>'total')::int=3
 and jsonb_array_length(public.admin_search_goods_option_sources(p_query=>'옵션원본',p_limit=>2)->'rows')=2
 and jsonb_array_length(public.admin_search_goods_option_sources(p_query=>'옵션원본',p_limit=>2,p_offset=>2)->'rows')=1
 and public.admin_search_goods_option_sources(p_query=>'옵션원본',p_limit=>2,p_offset=>2)->'rows'->0->>'id'='option-source-shirt'
 and jsonb_array_length(public.admin_search_goods_option_sources(p_query=>'옵션원본',p_limit=>2,p_offset=>4)->'rows')=0
 then 1 else 0 end as assert_total_and_pages_agree;
-- 5. 검색 대상(상품명·자동코드·상품 URL)과 카테고리(하위 포함)는 상품 조회/수정과 같은 검색이고, 그 뒤에 옵션 조건이 걸린다.
select 1/case when public.admin_search_goods_option_sources(p_query=>'티셔츠')->'rows'->0->>'id'='option-source-shirt'
 and (public.admin_search_goods_option_sources(p_query=>'티셔츠')->>'total')::int=1
 and (public.admin_search_goods_option_sources(p_query=>'엽서')->>'total')::int=0
 and public.admin_search_goods_option_sources(p_query=>'osrc-keyring-blue',p_field=>'code')->'rows'->0->>'id'='option-source-keyring'
 and (public.admin_search_goods_option_sources(p_query=>'OSRC-PLAIN',p_field=>'code')->>'total')::int=0
 and (public.admin_search_goods_option_sources(p_query=>'option-source-shirt, option-source-plain, option-source-socks',p_field=>'id')->>'total')::int=1
 and (public.admin_search_goods_option_sources(p_category_id=>'05e10000-0000-4000-8000-000000000101')->>'total')::int=1
 and public.admin_search_goods_option_sources(p_category_id=>'05e10000-0000-4000-8000-000000000101')->'rows'->0->>'id'='option-source-shirt'
 then 1 else 0 end as assert_search_and_category_apply_before_option_condition;
-- 6. 지금 편집 중인 상품은 뺀다(자기 옵션은 불러올 수 없다).
select 1/case when (public.admin_search_goods_option_sources(p_query=>'옵션원본',p_exclude_good_id=>'option-source-keyring')->>'total')::int=2
 and not exists(select 1 from jsonb_array_elements(public.admin_search_goods_option_sources(p_query=>'옵션원본',p_exclude_good_id=>'option-source-keyring')->'rows') item
  where item->>'id'='option-source-keyring')
 then 1 else 0 end as assert_current_good_is_excluded;
-- 7. 기존 상품 검색은 그대로다: 옵션 없는 상품도 나오고(보관만 뺀다) 새 조건 키는 받지 않는다.
select 1/case when (public.admin_search_goods_console(p_ip_id=>'option-source-ip',p_status=>'active')->>'total')::int=6
 and exists(select 1 from jsonb_array_elements(public.admin_search_goods_console(p_ip_id=>'option-source-ip',p_status=>'active')->'rows') item
  where item->>'id'='option-source-plain')
 then 1 else 0 end as assert_existing_goods_search_is_unchanged;
-- 8. 잘못된 조건은 조회 전에 거절한다.
do $$ begin
 begin perform public.admin_search_goods_option_sources(p_limit=>0); raise exception 'expected invalid_goods_option_source_page';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_goods_option_source_page' then raise; end if; end;
 begin perform public.admin_search_goods_option_sources(p_offset=>-1); raise exception 'expected invalid_goods_option_source_page';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_goods_option_source_page' then raise; end if; end;
 begin perform public.admin_search_goods_option_sources(p_field=>'erp'); raise exception 'expected invalid_goods_option_source_filter';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_goods_option_source_filter' then raise; end if; end;
 begin perform public.admin_search_goods_option_sources(p_query=>repeat('가',101)); raise exception 'expected invalid_goods_option_source_filter';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_goods_option_source_filter' then raise; end if; end;
end $$;
-- 9. catalog.manage가 없는 운영자·일반 회원·로그인하지 않은 호출은 거절한다.
select set_config('request.jwt.claim.sub','05e10000-0000-4000-8000-000000000002',true);
do $$ begin
 perform public.admin_search_goods_option_sources(); raise exception 'logistics operator must not search option sources';
exception when insufficient_privilege then if sqlerrm<>'operator_capability_required' then raise; end if; end $$;
select set_config('request.jwt.claim.sub','05e10000-0000-4000-8000-000000000003',true);
do $$ begin
 perform public.admin_search_goods_option_sources(); raise exception 'member must not search option sources';
exception when insufficient_privilege then if sqlerrm<>'operator_capability_required' then raise; end if; end $$;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 perform public.admin_search_goods_option_sources(); raise exception 'signed-out caller must not search option sources';
exception when insufficient_privilege then if sqlerrm<>'operator_capability_required' then raise; end if; end $$;
reset role;
set local role anon;
do $$ begin
 perform public.admin_search_goods_option_sources(); raise exception 'anon must not execute option source search';
exception when insufficient_privilege then if sqlerrm not like 'permission denied for function%' then raise; end if; end $$;
reset role;
rollback;
