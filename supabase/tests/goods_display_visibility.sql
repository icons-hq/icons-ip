\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql. QA1 MD 후속: 전시 구성에 담은 상품이 고객 화면에 보이지 않는 이유(private.goods_display_visibility)를
-- CONTEXT.md 게시 상태 말로 나누고, 저장된 구성 다시 열기는 이름·판매자상품코드·이유만 돌려주는 가벼운 읽기(admin_goods_display_visibility)로 한다.
-- 같은 이유가 관련상품 찾기·여러 줄 추가 후보 행(private.shopping_story_admin_good)의 visibility에도 실린다.
begin;
create function pg_temp.vis_assert(p_ok boolean,p_message text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception '%',p_message;end if;end $$;
create function pg_temp.vis_error(p_sql text,p_error text) returns void language plpgsql as $$
begin begin execute p_sql;exception when others then if position(p_error in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected %',p_error;end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at) values
 ('b9300000-0000-4000-8000-000000000001','authenticated','authenticated','vis-admin@example.test','{}',now(),now()),
 ('b9300000-0000-4000-8000-000000000002','authenticated','authenticated','vis-logistics@example.test','{}',now(),now());
update public.profiles set role='admin',nickname='노출이유관리자' where id='b9300000-0000-4000-8000-000000000001';
update public.profiles set role='staff',nickname='노출이유물류' where id='b9300000-0000-4000-8000-000000000002';
insert into private.operator_memberships(profile_id,manager_role) values('b9300000-0000-4000-8000-000000000001','primary'),('b9300000-0000-4000-8000-000000000002','logistics');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key,published_at) select 'vis-ip-open','노출 이유 공개 IP',key,now() from public.verticals limit 1;
insert into public.ips(id,title,vertical_key,published_at) select 'vis-ip-later','노출 이유 IP 공개 전',key,now() from public.verticals limit 1;
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values
 ('vis-public','vis-ip-open','노출 공개','문구',10000,'ok',10),
 ('vis-draft','vis-ip-open','노출 초안','문구',10000,'ok',10),
 ('vis-adult','vis-ip-open','노출 성인','문구',10000,'ok',10),
 ('vis-archived','vis-ip-open','노출 보관','문구',10000,'ok',0),
 ('vis-ip-draft','vis-ip-later','노출 IP 초안','문구',10000,'ok',10);
update public.goods set code='VIS-PUBLIC' where id='vis-public';
-- KC 합성 검토로 공개한다(트리거를 끄지 않는다). IP 공개 전 상품은 IP가 공개일 때 공개한 뒤 IP를 공개 전으로 돌린다.
-- 활성 상품이 있는 IP는 보관할 수 없어(ip_has_active_children) IP 보관 이유는 판정 함수에 직접 넣어 확인한다.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}'
from public.goods where id in ('vis-public','vis-adult','vis-ip-draft');
update public.profiles set role='staff' where id in (select ('47c47700'||left(md5(id),24))::uuid from public.goods where id in ('vis-public','vis-adult','vis-ip-draft'));
insert into private.operator_memberships(profile_id,manager_role)
select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id in ('vis-public','vis-adult','vis-ip-draft');
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in ('vis-public','vis-adult','vis-ip-draft');
update public.goods set sale_restriction='adult' where id='vis-adult';
update public.goods set archived_at=now() where id='vis-archived';
update public.ips set published_at=null where id='vis-ip-later';

-- 1. 이유 판정: 상품 보관 > IP 보관 > 상품 초안 > IP 초안 > 판매 제한 > 공개.
select pg_temp.vis_assert((select jsonb_object_agg(g.id,private.goods_display_visibility(g,ip.published_at is not null,ip.archived_at is not null))
  from public.goods g join public.ips ip on ip.id=g.ip_id where g.id like 'vis-%')
 ='{"vis-public":"public","vis-draft":"draft","vis-adult":"restricted","vis-archived":"archived","vis-ip-draft":"ip_draft"}'::jsonb,
 'visibility reasons');
select pg_temp.vis_assert((select array_agg(private.goods_display_visibility(g,true,true) order by g.id) from public.goods g where g.id in ('vis-public','vis-archived'))
 =array['archived','ip_archived'],'ip archived ranks after the own archive');

set local role authenticated;
select set_config('request.jwt.claim.sub','b9300000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"b9300000-0000-4000-8000-000000000001","role":"authenticated"}',true);

-- 2. 가벼운 읽기: 입력 순서대로 이름·판매자상품코드·이유만 돌려주고, 없는 상품번호는 뺀다(판매자상품코드로는 찾지 않는다).
select public.admin_goods_display_visibility(array['vis-ip-draft','vis-public','nope-404','vis-draft','vis-adult','vis-archived','VIS-PUBLIC']) as rows \gset
select pg_temp.vis_assert((select jsonb_agg(jsonb_build_object('id',r->>'id','name',r->>'name','visibility',r->>'visibility') order by ord)
  from jsonb_array_elements(:'rows'::jsonb) with ordinality x(r,ord))='[
 {"id":"vis-ip-draft","name":"노출 IP 초안","visibility":"ip_draft"},
 {"id":"vis-public","name":"노출 공개","visibility":"public"},
 {"id":"vis-draft","name":"노출 초안","visibility":"draft"},
 {"id":"vis-adult","name":"노출 성인","visibility":"restricted"},
 {"id":"vis-archived","name":"노출 보관","visibility":"archived"}]'::jsonb
 and :'rows'::jsonb->1->>'code'='VIS-PUBLIC'
 and (select bool_and(r ?& array['id','name','code','visibility'] and (select count(*) from jsonb_object_keys(r))=4) from jsonb_array_elements(:'rows'::jsonb) r),
 'light read rows: '||:'rows');
select pg_temp.vis_error($q$select public.admin_goods_display_visibility('{}'::text[])$q$,'invalid_goods_display_ids');
select pg_temp.vis_error($q$select public.admin_goods_display_visibility(array[' vis-public'])$q$,'invalid_goods_display_ids');
select pg_temp.vis_error($q$select public.admin_goods_display_visibility(array[null::text])$q$,'invalid_goods_display_ids');
select pg_temp.vis_error($q$select public.admin_goods_display_visibility(array(select 'id-'||n from generate_series(1,1001) n))$q$,'invalid_goods_display_ids');

-- 3. 같은 이유가 관련상품 찾기·여러 줄 추가 후보 행에 실린다. 공개 판정(published)과 어긋나지 않는다.
select pg_temp.vis_assert((select jsonb_object_agg(r->>'ref',r->'candidate'->>'visibility')
  from jsonb_array_elements(public.admin_resolve_goods_references(array['vis-public','vis-draft','vis-adult','vis-ip-draft'])) r)
 ='{"vis-public":"public","vis-draft":"draft","vis-adult":"restricted","vis-ip-draft":"ip_draft"}'::jsonb,'resolver candidate visibility');
select pg_temp.vis_assert((select bool_and((r->'candidate'->>'visibility'='public')=(r->>'published')::boolean)
  from jsonb_array_elements(public.admin_resolve_goods_references(array['vis-public','vis-draft','vis-adult','vis-ip-draft'])) r),'visibility agrees with published');
select pg_temp.vis_assert((select count(*)=2 from jsonb_array_elements(public.admin_search_shopping_story_goods_filtered('노출',1,
  jsonb_build_object('field','name','categoryId',null,'visibility','all','stock','all','saleType','all','freeShipping',false,'discounted',false,
   'reviews','all','minRating',0,'sort','name','minPrice',null,'maxPrice',null))->'rows') r
  where (r->>'id'='vis-public' and r->>'visibility'='public') or (r->>'id'='vis-draft' and r->>'visibility'='draft')),'picker search rows carry visibility');

-- 4. 권한: 물류 매니저는 읽을 수 없고, 익명·service_role은 실행 권한이 없다. 내부 판정 함수는 어느 롤에도 열지 않는다.
select set_config('request.jwt.claim.sub','b9300000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"b9300000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.vis_error($q$select public.admin_goods_display_visibility(array['vis-public'])$q$,'operator_capability_required');
reset role;
select pg_temp.vis_assert(not has_function_privilege('anon','public.admin_goods_display_visibility(text[])','execute')
 and not has_function_privilege('service_role','public.admin_goods_display_visibility(text[])','execute')
 and has_function_privilege('authenticated','public.admin_goods_display_visibility(text[])','execute')
 and not has_function_privilege('authenticated','private.goods_display_visibility(public.goods,boolean,boolean)','execute')
 and not has_function_privilege('anon','private.goods_display_visibility(public.goods,boolean,boolean)','execute')
 and not has_function_privilege('authenticated','private.shopping_story_admin_good(public.goods,boolean,boolean)','execute'),'ACL');
select pg_temp.vis_assert(exists(select 1 from private.operator_rpc_contracts c where c.signature='public.admin_goods_display_visibility(text[])'
  and c.capability='catalog.read' and c.guard_kind='read' and not c.legacy_admin_only),'rpc contract registered');
select pg_temp.vis_assert((select count(*)=2 from private.operator_internal_contracts c where c.signature in
  ('private.goods_display_visibility(public.goods,boolean,boolean)','private.shopping_story_admin_good(public.goods,boolean,boolean)')),'internal contracts registered');
rollback;
