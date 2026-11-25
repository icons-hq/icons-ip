\set ON_ERROR_STOP on
-- 추가구성상품 선택창 조회(admin_search_goods_additional_candidates). goods_kc_fixture.sql 뒤에 실행한다(상품 공개에 쓴다).
-- 지금 연결할 수 있는 상품만 나오고 총 개수·페이지가 맞는지, 지금 편집 중인 상품은 빠지는지, 기존 후보 검색은 그대로인지,
-- 권한(catalog.read)·실행 권한 봉인·운영자 계약 등록을 본다. 준비물은 모두 rollback된다.
begin;
select set_config('request.jwt.claim.sub','',true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('05e20000-0000-4000-8000-000000000001','authenticated','authenticated','addon-candidate-primary@example.test',now(),'{}','{}',now(),now()),
 ('05e20000-0000-4000-8000-000000000003','authenticated','authenticated','addon-candidate-member@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='05e20000-0000-4000-8000-000000000001';

insert into public.ips(id,title,vertical_key,published_at) values('addon-candidate-ip','추가후보 검증','character',now());
insert into public.catalog_categories(id,code,name,parent_id,depth,sort_order) values
 ('05e20000-0000-4000-8000-000000000101','addon-candidate-parent','추가후보 상위',null,1,0),
 ('05e20000-0000-4000-8000-000000000102','addon-candidate-child','추가후보 하위','05e20000-0000-4000-8000-000000000101',2,0);
-- base: 지금 편집 중인 상품. case·stand: 연결할 수 있다. soldout: 재고 0. stopped: 판매 중지. draft: 공개 전. archived: 보관.
insert into public.goods(id,code,ip_id,name,price,stock,stock_qty,created_at,category_id) values
 ('addon-candidate-base','ADDC-BASE','addon-candidate-ip','추가후보 피규어',1000,'ok',10,'2026-11-01T00:00:00Z',null),
 ('addon-candidate-case','ADDC-CASE','addon-candidate-ip','추가후보 케이스',1000,'ok',10,'2026-11-02T00:00:00Z','05e20000-0000-4000-8000-000000000102'),
 ('addon-candidate-stand','ADDC-STAND','addon-candidate-ip','추가후보 받침대',1000,'ok',10,'2026-11-05T00:00:00Z',null),
 ('addon-candidate-soldout','ADDC-SOLDOUT','addon-candidate-ip','추가후보 엽서',1000,'ok',0,'2026-11-06T00:00:00Z',null),
 ('addon-candidate-stopped','ADDC-STOPPED','addon-candidate-ip','추가후보 스티커',1000,'soldout',10,'2026-11-07T00:00:00Z',null),
 ('addon-candidate-draft','ADDC-DRAFT','addon-candidate-ip','추가후보 키링',1000,'ok',10,'2026-11-08T00:00:00Z',null),
 ('addon-candidate-archived','ADDC-ARCHIVED','addon-candidate-ip','추가후보 배지',1000,'ok',0,'2026-11-09T00:00:00Z',null);
-- primary는 catalog.read가 있다. 상품 공개에 쓰는 KC 준비 도우미의 합성 검토자도 운영자로 미리 넣어 둔다(goods_instant_discount_period.sql과 같은 방식).
insert into private.operator_memberships(profile_id,manager_role) values('05e20000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','addc-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where id in ('addon-candidate-base','addon-candidate-case','addon-candidate-stand','addon-candidate-soldout','addon-candidate-stopped');
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods
 where id in ('addon-candidate-base','addon-candidate-case','addon-candidate-stand','addon-candidate-soldout','addon-candidate-stopped');
select pg_temp.publish_goods_kc_fixture(id) from public.goods
 where id in ('addon-candidate-base','addon-candidate-case','addon-candidate-stand','addon-candidate-soldout','addon-candidate-stopped');
update public.goods set archived_at=now() where id='addon-candidate-archived';

-- 1. 실행 권한: authenticated만. anon·service_role·public은 실행할 수 없다.
select 1/case when has_function_privilege('authenticated','public.admin_search_goods_additional_candidates(text,text,text,uuid,integer,integer)','execute')
 and not has_function_privilege('anon','public.admin_search_goods_additional_candidates(text,text,text,uuid,integer,integer)','execute')
 and not has_function_privilege('service_role','public.admin_search_goods_additional_candidates(text,text,text,uuid,integer,integer)','execute')
 then 1 else 0 end as assert_execute_is_sealed_to_authenticated;
-- 2. 운영자 계약: catalog.read 읽기로 등록되고 본문 지문이 지금 함수와 같다.
select 1/case when exists(select 1 from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
  where c.signature='public.admin_search_goods_additional_candidates(text,text,text,uuid,integer,integer)'
   and c.capability='catalog.read' and c.guard_kind='read' and not c.legacy_admin_only and c.body_md5=md5(p.prosrc))
 and exists(select 1 from private.operator_internal_contracts where signature='public.admin_search_goods_additional_candidates(text,text,text,uuid,integer,integer)')
 then 1 else 0 end as assert_operator_contract_registered;

set local role authenticated;
select set_config('request.jwt.claim.sub','05e20000-0000-4000-8000-000000000001',true);
-- 3. 지금 연결할 수 있는 상품만, 등록일 최신순(이 시험의 상품 이름 '추가후보'로 좁혀 다른 데이터가 있는 DB에서도 같은 결과다).
--    재고 0·판매 중지·공개 전·보관 상품과 지금 편집 중인 상품은 없다.
select public.admin_search_goods_additional_candidates('addon-candidate-base','추가후보') as listed \gset
select 1/case when (:'listed'::jsonb->>'total')::int=2
 and (select jsonb_agg(item->>'id' order by position) from jsonb_array_elements(:'listed'::jsonb->'rows') with ordinality as r(item,position))
  ='["addon-candidate-stand","addon-candidate-case"]'::jsonb
 then 1 else 0 end as assert_only_available_goods_newest_first;
-- 줄에는 선택창이 쓰는 값만 있다.
select 1/case when (select array_agg(key order by key) from jsonb_object_keys(:'listed'::jsonb->'rows'->0) key)
  =array['archivedAt','categoryName','code','id','imagePath','name','publishedAt']
 and :'listed'::jsonb->'rows'->1->>'categoryName'='추가후보 하위' and :'listed'::jsonb->'rows'->1->>'code'='ADDC-CASE'
 then 1 else 0 end as assert_row_shape_is_picker_projection;
-- 4. 총 개수는 걸러 낸 뒤의 수이고 페이지와 맞는다.
select 1/case when (public.admin_search_goods_additional_candidates('addon-candidate-base','추가후보',p_limit=>1)->>'total')::int=2
 and jsonb_array_length(public.admin_search_goods_additional_candidates('addon-candidate-base','추가후보',p_limit=>1)->'rows')=1
 and public.admin_search_goods_additional_candidates('addon-candidate-base','추가후보',p_limit=>1,p_offset=>1)->'rows'->0->>'id'='addon-candidate-case'
 and jsonb_array_length(public.admin_search_goods_additional_candidates('addon-candidate-base','추가후보',p_limit=>1,p_offset=>2)->'rows')=0
 then 1 else 0 end as assert_total_and_pages_agree;
-- 5. 저장 전인 새 상품(기준 상품 없음)은 자기 자신을 뺄 것이 없어 base도 후보다. 검색 대상(자동코드·상품 URL)과 카테고리(하위 포함)는 상품 조회/수정과 같다.
select 1/case when (public.admin_search_goods_additional_candidates(null,'추가후보')->>'total')::int=3
 and public.admin_search_goods_additional_candidates('addon-candidate-base','addc-stand','code')->'rows'->0->>'id'='addon-candidate-stand'
 and (public.admin_search_goods_additional_candidates('addon-candidate-base','ADDC-SOLDOUT','code')->>'total')::int=0
 and (public.admin_search_goods_additional_candidates('addon-candidate-base','addon-candidate-case, addon-candidate-draft','id')->>'total')::int=1
 and (public.admin_search_goods_additional_candidates('addon-candidate-base','',p_category_id=>'05e20000-0000-4000-8000-000000000101')->>'total')::int=1
 and public.admin_search_goods_additional_candidates('addon-candidate-base','',p_category_id=>'05e20000-0000-4000-8000-000000000101')->'rows'->0->>'id'='addon-candidate-case'
 then 1 else 0 end as assert_search_and_category_apply_before_availability;
-- 6. 기존 후보 검색(고른 상품을 저장 전에 한 번 더 확인하는 데 쓴다)은 그대로다.
select 1/case when jsonb_array_length(public.admin_search_goods_additional('addon-candidate-base','추가후보'))=2
 and public.admin_search_goods_additional('addon-candidate-base','추가후보 엽서')='[]'::jsonb
 then 1 else 0 end as assert_existing_candidate_search_is_unchanged;
-- 7. 잘못된 조건은 조회 전에 거절한다.
do $$ begin
 begin perform public.admin_search_goods_additional_candidates(p_limit=>0); raise exception 'expected invalid_goods_additional_candidate_page';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_goods_additional_candidate_page' then raise; end if; end;
 begin perform public.admin_search_goods_additional_candidates(p_offset=>-1); raise exception 'expected invalid_goods_additional_candidate_page';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_goods_additional_candidate_page' then raise; end if; end;
 begin perform public.admin_search_goods_additional_candidates(p_field=>'barcode'); raise exception 'expected invalid_goods_additional_candidate_filter';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_goods_additional_candidate_filter' then raise; end if; end;
 begin perform public.admin_search_goods_additional_candidates(p_query=>repeat('가',101)); raise exception 'expected invalid_goods_additional_candidate_filter';
 exception when invalid_parameter_value then if sqlerrm<>'invalid_goods_additional_candidate_filter' then raise; end if; end;
end $$;
-- 8. 운영자가 아닌 회원과 로그인하지 않은 호출은 거절한다.
select set_config('request.jwt.claim.sub','05e20000-0000-4000-8000-000000000003',true);
do $$ begin
 begin perform public.admin_search_goods_additional_candidates(); raise exception 'expected operator_capability_required';
 exception when insufficient_privilege then if sqlerrm<>'operator_capability_required' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 begin perform public.admin_search_goods_additional_candidates(); raise exception 'expected operator_capability_required';
 exception when insufficient_privilege then if sqlerrm<>'operator_capability_required' then raise; end if; end;
end $$;
reset role;
rollback;
