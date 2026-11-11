\set ON_ERROR_STOP on
-- LFS 패리티 2차 L5(#570). Rollback-only. Prepend helpers/goods_kc_fixture.sql in the SAME psql session.
-- 공개 메뉴 RPC(공개 스위치·보관·공개 상품·준비 중 이름 비노출), 전시분류 노드 이미지 RPC(claim·CAS·멱등·감사),
-- 카테고리 전시 정렬 7종·'예약판매' 타입 facet/필터를 고정한다.
begin;
create function pg_temp.cm_id(n integer) returns uuid language sql immutable as $$select ('94932000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.cm_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'category menu assertion: %',label;end if;end$$;
create function pg_temp.cm_ids(menu jsonb) returns uuid[] language sql immutable as $$select coalesce(array_agg((item->>'id')::uuid order by ordinality),'{}') from jsonb_array_elements(menu) with ordinality as rows(item,ordinality)$$;
create function pg_temp.cm_page_ids(page jsonb) returns text[] language sql immutable as $$select coalesce(array_agg(item->>'id' order by ordinality),'{}') from jsonb_array_elements(page->'rows') with ordinality as rows(item,ordinality)$$;
create function pg_temp.cm_query(extra jsonb default '{}') returns jsonb language sql immutable as $$select '{"ips":[],"types":[],"min":null,"max":null,"sort":"recommended"}'::jsonb||extra$$;

-- 선언 단언(CI Postgres 빌드마다 권한 없는 런타임 호출의 실패 모양이 달라 has_function_privilege 로 본다).
select pg_temp.cm_assert(has_function_privilege('anon','public.get_storefront_category_menu()','execute')
 and has_function_privilege('authenticated','public.get_storefront_category_menu()','execute')
 and not has_function_privilege('service_role','public.get_storefront_category_menu()','execute')
 and not has_function_privilege('anon','public.admin_set_category_display_node_image(uuid,text,bigint,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_set_category_display_node_image(uuid,text,bigint,uuid)','execute')
 and has_function_privilege('authenticated','public.admin_set_category_display_node_image(uuid,text,bigint,uuid)','execute')
 and not has_function_privilege('anon','public.admin_list_category_displays()','execute')
 and not has_table_privilege('anon','private.category_display_nodes','select')
 and not has_table_privilege('authenticated','private.category_display_nodes','update'),'menu read is public; node image write is operator-only and private tables stay sealed');

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.cm_id(n),'authenticated','authenticated','category-menu-'||n||'@example.test',now(),'{"testFixture":"category-menu"}','{}',now(),now() from generate_series(1,2)n;
update public.profiles set role=case when id=pg_temp.cm_id(1) then 'staff'::public.user_role else 'user'::public.user_role end where id in(pg_temp.cm_id(1),pg_temp.cm_id(2));
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.cm_id(1),'primary');
update private.operator_access_state set configured=true where id;
-- 이 테스트는 자기 루트만 본다 — 시드·다른 테스트의 공개 전시가 메뉴 단언을 흔들지 않게 기존 루트를 보관한다.
update private.category_display_nodes set archived_at=coalesce(archived_at,clock_timestamp()) where parent_id is null;
update public.category_activation_control set customer_enabled=true where id='catalog';
insert into public.catalog_categories(id,code,name,parent_id,sort_order) values
 (pg_temp.cm_id(10),'cm-menu-source','메뉴 원천 분류',null,0),(pg_temp.cm_id(11),'cm-menu-empty','상품 없는 원천',null,1);
insert into public.ips(id,title,vertical_key,published_at) values('cm-menu-ip','메뉴 검증 IP','character',now());
insert into public.goods(id,ip_id,name,type,price,category_id,created_at) values
 ('cm-menu-g-1','cm-menu-ip','나 피규어','피규어',3000,pg_temp.cm_id(10),'2026-01-03T00:00:00Z'),
 ('cm-menu-g-2','cm-menu-ip','가 피규어','피규어',5000,pg_temp.cm_id(10),'2026-01-01T00:00:00Z'),
 ('cm-menu-g-3','cm-menu-ip','B figure','키링',1000,pg_temp.cm_id(10),'2026-01-05T00:00:00Z'),
 ('cm-menu-g-4','cm-menu-ip','10번 굿즈','키링',4000,pg_temp.cm_id(10),'2026-01-02T00:00:00Z'),
 ('cm-menu-g-5','cm-menu-ip','2번 굿즈','기타',2000,pg_temp.cm_id(10),'2026-01-04T00:00:00Z'),
 ('cm-menu-draft','cm-menu-ip','공개 전 상품','문구',2000,pg_temp.cm_id(11),now());
update public.goods_variants set stock_qty=5 where good_id like 'cm-menu-g-%';
insert into private.goods_preorder_policies(id,variant_id,state,capacity_qty,starts_at,ends_at,expected_ship_date,approval_reference,created_by,activated_by,activated_at)
select pg_temp.cm_id(90),id,'active',3,now()-interval '1 day',now()+interval '1 day',current_date+30,'synthetic QA',pg_temp.cm_id(1),pg_temp.cm_id(1),now()
from public.goods_variants where good_id='cm-menu-g-2' and is_default;
update public.goods_variants set preorder_policy_id=pg_temp.cm_id(90),stock_qty=0 where good_id='cm-menu-g-2' and is_default;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-menu-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}' from public.goods where id like 'cm-menu-g-%';
insert into private.operator_memberships(profile_id,manager_role)
select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id like 'cm-menu-g-%';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id like 'cm-menu-g-%';
-- 전시 트리: 토이(20, 자기 전시 없음) ┬ 피규어(21, 공개) · 빈 분류(22, 켠 전시·공개 상품 없음) · 준비 중(23, 끈 전시)
--          라이프(24, 수동 공개) └ 보관 하위(25, 공개 구성이지만 보관)
--          숨긴 루트(26, 보관) └ 하위(27, 공개 구성 — 보관 조상 때문에 비공개)
--          준비 루트(28, 자기 전시 없음) └ 준비 하위(29, 끈 전시) — 공개 전시가 없는 가지는 이름도 내보내지 않는다.
insert into private.category_display_nodes(id,parent_id,name,sort_order,archived_at) values
 (pg_temp.cm_id(20),null,'토이',0,null),(pg_temp.cm_id(21),pg_temp.cm_id(20),'피규어',0,null),(pg_temp.cm_id(22),pg_temp.cm_id(20),'빈 분류',1,null),(pg_temp.cm_id(23),pg_temp.cm_id(20),'준비 중',2,null),
 (pg_temp.cm_id(24),null,'라이프',1,null),(pg_temp.cm_id(25),pg_temp.cm_id(24),'보관 하위',0,clock_timestamp()),
 (pg_temp.cm_id(26),null,'숨긴 루트',2,clock_timestamp()),(pg_temp.cm_id(27),pg_temp.cm_id(26),'하위',0,null),
 (pg_temp.cm_id(28),null,'준비 루트',3,null),(pg_temp.cm_id(29),pg_temp.cm_id(28),'준비 하위',0,null);

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.cm_id(1)::text,true);
do $$declare v jsonb;n integer;begin
 foreach n in array array[21,25,27] loop
  v:=public.admin_get_category_display(pg_temp.cm_id(n))->'values';
  perform public.admin_save_category_display(pg_temp.cm_id(n),v||jsonb_build_object('enabled',true,'categoryIds',jsonb_build_array(pg_temp.cm_id(10))),0,gen_random_uuid());
 end loop;
 v:=public.admin_get_category_display(pg_temp.cm_id(22))->'values';
 perform public.admin_save_category_display(pg_temp.cm_id(22),v||jsonb_build_object('enabled',true,'categoryIds',jsonb_build_array(pg_temp.cm_id(11))),0,gen_random_uuid());
 foreach n in array array[23,29] loop
  v:=public.admin_get_category_display(pg_temp.cm_id(n))->'values';
  perform public.admin_save_category_display(pg_temp.cm_id(n),v||jsonb_build_object('enabled',false,'categoryIds',jsonb_build_array(pg_temp.cm_id(10))),0,gen_random_uuid());
 end loop;
 v:=public.admin_get_category_display(pg_temp.cm_id(24))->'values';
 perform public.admin_save_category_display(pg_temp.cm_id(24),v||'{"enabled":true,"mode":"manual","goodIds":["cm-menu-g-3","cm-menu-g-1"]}',0,gen_random_uuid());
end $$;
reset role;

-- 공개 메뉴: 공개 전시 노드와 그 조상만, 트리 순서로.
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$declare menu jsonb:=public.get_storefront_category_menu();toy jsonb;figure jsonb;life jsonb;begin
 perform pg_temp.cm_assert(pg_temp.cm_ids(menu)=array[pg_temp.cm_id(20),pg_temp.cm_id(21),pg_temp.cm_id(24)],'menu holds only public displays and their ancestors in tree order: '||menu::text);
 toy:=menu->0;figure:=menu->1;life:=menu->2;
 perform pg_temp.cm_assert(toy->>'navigable'='false' and toy->>'depth'='1' and toy->'parentId'='null'::jsonb and toy->>'name'='토이','container root without its own display is listed but not navigable');
 perform pg_temp.cm_assert(figure->>'navigable'='true' and figure->>'depth'='2' and figure->>'parentId'=pg_temp.cm_id(20)::text and figure->'imagePath'='null'::jsonb,'public child carries parent, depth and image slot');
 perform pg_temp.cm_assert(life->>'navigable'='true' and life->>'depth'='1','manual display root is navigable');
 perform pg_temp.cm_assert((select bool_and(item ?& array['id','parentId','name','depth','imagePath','navigable'] and (select count(*) from jsonb_object_keys(item))=6) from jsonb_array_elements(menu) item),'menu rows expose exactly six public fields');
 perform pg_temp.cm_assert(not exists(select 1 from jsonb_array_elements(menu) item where item->>'name' in ('빈 분류','준비 중','보관 하위','숨긴 루트','하위','준비 루트','준비 하위')),'empty, disabled, archived and unpublished branches never leak their names');
end $$;
reset role;
update public.category_activation_control set customer_enabled=false where id='catalog';
set local role anon;
select pg_temp.cm_assert(public.get_storefront_category_menu()='[]'::jsonb,'customer category gate off returns an empty menu (shell keeps the legacy menu)');
reset role;
update public.category_activation_control set customer_enabled=true where id='catalog';

-- 노드 이미지: 검증된 본인 claim만 소비, revision CAS, 요청 UUID 멱등, 감사, 해제.
insert into public.admin_artwork_upload_claims(path,actor_id,kind,mime_type,source_size,status,expires_at,verified_at,final_size,processing_started_at) values
 ('catalog/curation/94932000-0000-4000-8000-000000000301.png',pg_temp.cm_id(1),'curation','image/png',100,'verified',now()+interval '1 hour',now(),100,now()),
 ('catalog/curation/94932000-0000-4000-8000-000000000302.png',pg_temp.cm_id(2),'curation','image/png',100,'verified',now()+interval '1 hour',now(),100,now());
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.cm_id(1)::text,true);
do $$declare revision bigint;result jsonb;replayed jsonb;node jsonb;path text:='public-media/catalog/curation/94932000-0000-4000-8000-000000000301.png';begin
 revision:=(public.admin_list_category_displays()->>'revision')::bigint;
 perform pg_temp.cm_assert((select bool_and(item ? 'imagePath') from jsonb_array_elements(public.admin_list_category_displays()->'categories') item),'admin directory lists every node image slot');
 begin perform public.admin_set_category_display_node_image(pg_temp.cm_id(21),'https://external.example/icon.png',revision,pg_temp.cm_id(400));raise exception 'external image accepted';exception when invalid_parameter_value then null;end;
 begin perform public.admin_set_category_display_node_image(pg_temp.cm_id(21),'public-media/catalog/curation/94932000-0000-4000-8000-000000000302.png',revision,pg_temp.cm_id(401));raise exception 'another operator claim consumed';exception when check_violation then null;end;
 begin perform public.admin_set_category_display_node_image(pg_temp.cm_id(21),path,revision+1,pg_temp.cm_id(402));raise exception 'stale revision accepted';exception when sqlstate 'PT409' then null;end;
 begin perform public.admin_set_category_display_node_image(pg_temp.cm_id(99),path,revision,pg_temp.cm_id(403));raise exception 'missing node accepted';exception when no_data_found then null;end;
 result:=public.admin_set_category_display_node_image(pg_temp.cm_id(21),path,revision,pg_temp.cm_id(404));
 replayed:=public.admin_set_category_display_node_image(pg_temp.cm_id(21),path,revision,pg_temp.cm_id(404));
 select item into node from jsonb_array_elements(result#>'{directory,categories}') item where item->>'id'=pg_temp.cm_id(21)::text;
 perform pg_temp.cm_assert(result=replayed and result->>'nodeId'=pg_temp.cm_id(21)::text and (result#>>'{directory,revision}')::bigint=revision+1 and node->>'imagePath'=path,'image applies exactly once and bumps the tree revision');
 begin perform public.admin_set_category_display_node_image(pg_temp.cm_id(21),null,revision,pg_temp.cm_id(404));raise exception 'operation payload reused';exception when unique_violation then null;end;
 -- 같은 이미지를 다시 적용해도 claim 을 다시 요구하지 않는다(이미 연결됨).
 result:=public.admin_set_category_display_node_image(pg_temp.cm_id(21),path,revision+1,pg_temp.cm_id(405));
 perform pg_temp.cm_assert((result#>>'{directory,revision}')::bigint=revision+2,'re-applying the current image keeps working without a fresh claim');
end $$;
reset role;
select pg_temp.cm_assert((select status='attached' from public.admin_artwork_upload_claims where path='catalog/curation/94932000-0000-4000-8000-000000000301.png'),'node image claim is consumed');
select pg_temp.cm_assert((select status='verified' from public.admin_artwork_upload_claims where path='catalog/curation/94932000-0000-4000-8000-000000000302.png'),'another operator claim stays untouched');
select pg_temp.cm_assert((select diff#>>'{before,imagePath}' is null and diff#>>'{request,imagePath}'='public-media/catalog/curation/94932000-0000-4000-8000-000000000301.png' from public.audit_log where id=pg_temp.cm_id(404) and action='admin.category_display.image_changed' and actor_id=pg_temp.cm_id(1)),'image change is audited with before and request');
set local role service_role;
select pg_temp.cm_assert(not exists(select 1 from public.service_list_admin_artwork_cleanup_candidates(10000) where path='catalog/curation/94932000-0000-4000-8000-000000000301.png' and cleanup_mode='all'),'attached node image is never an all-object cleanup candidate');
reset role;
set local role anon;
select pg_temp.cm_assert((select item->>'imagePath' from jsonb_array_elements(public.get_storefront_category_menu()) item where item->>'id'=pg_temp.cm_id(21)::text)='public-media/catalog/curation/94932000-0000-4000-8000-000000000301.png','public menu carries the node image path');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.cm_id(1)::text,true);
do $$declare result jsonb;begin
 result:=public.admin_set_category_display_node_image(pg_temp.cm_id(21),null,(public.admin_list_category_displays()->>'revision')::bigint,pg_temp.cm_id(406));
 perform pg_temp.cm_assert((select item->'imagePath' from jsonb_array_elements(result#>'{directory,categories}') item where item->>'id'=pg_temp.cm_id(21)::text)='null'::jsonb,'image can be cleared');
end $$;
select set_config('request.jwt.claim.sub',pg_temp.cm_id(2)::text,true);
do $$begin perform public.admin_set_category_display_node_image(pg_temp.cm_id(21),null,0,pg_temp.cm_id(407));raise exception 'customer changed a display image';exception when insufficient_privilege then null;end$$;
reset role;

-- 카테고리 전시 정렬 7종·예약판매(컬렉션과 같은 판정).
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$declare page jsonb;facets jsonb;begin
 page:=public.get_category_display_page(pg_temp.cm_id(21),pg_temp.cm_query('{"sort":"name_asc"}'));
 perform pg_temp.cm_assert(pg_temp.cm_page_ids(page)=array['cm-menu-g-5','cm-menu-g-4','cm-menu-g-2','cm-menu-g-1','cm-menu-g-3'],'name ascending is natural Korean order (number, Hangul, Latin): '||array_to_string(pg_temp.cm_page_ids(page),','));
 page:=public.get_category_display_page(pg_temp.cm_id(21),pg_temp.cm_query('{"sort":"name_desc"}'));
 perform pg_temp.cm_assert(pg_temp.cm_page_ids(page)=array['cm-menu-g-3','cm-menu-g-1','cm-menu-g-2','cm-menu-g-4','cm-menu-g-5'],'name descending reverses the natural order');
 page:=public.get_category_display_page(pg_temp.cm_id(21),pg_temp.cm_query('{"sort":"oldest"}'));
 perform pg_temp.cm_assert(pg_temp.cm_page_ids(page)=array['cm-menu-g-2','cm-menu-g-4','cm-menu-g-1','cm-menu-g-5','cm-menu-g-3'],'oldest first');
 page:=public.get_category_display_page(pg_temp.cm_id(21),pg_temp.cm_query('{"sort":"newest"}'));
 perform pg_temp.cm_assert(pg_temp.cm_page_ids(page)=array['cm-menu-g-3','cm-menu-g-5','cm-menu-g-1','cm-menu-g-4','cm-menu-g-2'],'newest first');
 facets:=public.get_category_display_page(pg_temp.cm_id(21),pg_temp.cm_query())->'typeFacets';
 perform pg_temp.cm_assert(facets=jsonb_build_array(
   jsonb_build_object('value','피규어','label','피규어','count',2),jsonb_build_object('value','키링','label','키링','count',2),
   jsonb_build_object('value','기타','label','기타','count',1),jsonb_build_object('value','예약판매','label','예약판매','count',1)),'type facets follow the taxonomy order (기타 last) and end with 예약판매: '||facets::text);
 page:=public.get_category_display_page(pg_temp.cm_id(21),pg_temp.cm_query('{"types":["예약판매"]}'));
 perform pg_temp.cm_assert(page->>'filteredTotal'='1' and pg_temp.cm_page_ids(page)=array['cm-menu-g-2'] and page->>'total'='5','예약판매 filters preorder goods inside the same scope');
 page:=public.get_category_display_page(pg_temp.cm_id(21),pg_temp.cm_query('{"types":["키링","예약판매"]}'));
 perform pg_temp.cm_assert(page->>'filteredTotal'='3','type values combine with OR including 예약판매');
 page:=public.get_category_display_page(pg_temp.cm_id(21),pg_temp.cm_query('{"types":["피규어","인형","키링","아크릴","문구","쿠션","파우치","세트","기타","예약판매"]}'));
 perform pg_temp.cm_assert(page->>'filteredTotal'='5','every taxonomy value (기타 포함) plus 예약판매 is accepted');
 page:=public.get_category_display_page(pg_temp.cm_id(21),pg_temp.cm_query('{"types":["기타"]}'));
 perform pg_temp.cm_assert(page->>'filteredTotal'='1' and pg_temp.cm_page_ids(page)=array['cm-menu-g-5'],'기타 filters its goods');
 begin perform public.get_category_display_page(pg_temp.cm_id(21),pg_temp.cm_query('{"types":["피규어","인형","키링","아크릴","문구","쿠션","파우치","세트","기타","예약판매","피규어"]}'));raise exception 'eleven type values accepted';exception when invalid_parameter_value then null;end;
 begin perform public.get_category_display_page(pg_temp.cm_id(21),pg_temp.cm_query('{"sort":"sales"}'));raise exception 'unknown sort accepted';exception when invalid_parameter_value then null;end;
 begin perform public.get_category_display_page(pg_temp.cm_id(21),pg_temp.cm_query('{"types":["중고"]}'));raise exception 'unknown type accepted';exception when invalid_parameter_value then null;end;
 -- 수동 전시의 동률·정렬도 같은 규칙이다(가격 동률 없음 — 이름순만 확인).
 page:=public.get_category_display_page(pg_temp.cm_id(24),pg_temp.cm_query('{"sort":"name_asc"}'));
 perform pg_temp.cm_assert(pg_temp.cm_page_ids(page)=array['cm-menu-g-1','cm-menu-g-3'],'manual display sorts by name too');
 page:=public.get_category_display_page(pg_temp.cm_id(24),pg_temp.cm_query());
 perform pg_temp.cm_assert(pg_temp.cm_page_ids(page)=array['cm-menu-g-3','cm-menu-g-1'],'manual recommended order stays the configured order');
end $$;
reset role;
rollback;
