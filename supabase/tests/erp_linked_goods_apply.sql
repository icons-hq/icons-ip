\set ON_ERROR_STOP on
-- 1027T-016·1027T-X04(사용자 결정 2026-11-11 묶음 13): MD(catalog.manage) ERP 품목 반입 권한과 연결 상품 판매가·바코드 반영.
-- 반영은 미리보기 → 고른 행 확정이고, 잠금 뒤 다시 계산해 바뀐 값이 있으면 아무것도 바꾸지 않으며, 같은 확정은 같은 결과(이중 반영 없음)다.
-- 합성 계정·상품만 쓰고 끝에서 모두 되돌린다. legacy fixture 없이, 역할 설정 전(configured=false) DB에서 돈다.
begin;
do $$ begin
 if to_regclass('private.operator_legacy_fixture_control') is not null then
  raise exception 'ERP linked goods tests must run without the legacy fixture helper';end if;
end $$;
update private.operator_access_state set configured=false,revision=1 where id;

create function pg_temp.ea_id(n integer) returns uuid language sql immutable as $$
 select ('e7180000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.ea_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'ERP linked goods assertion: %',label;end if;
end $$;
-- 기대 오류는 SQLSTATE 또는 메시지로 맞춘다. 다른 오류는 그대로 올린다.
create function pg_temp.ea_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;
 exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected error % from %',expected,statement;
end $$;
create function pg_temp.ea_as(n integer) returns void language sql as $$
 select set_config('request.jwt.claim.sub',pg_temp.ea_id(n)::text,true);
$$;
create function pg_temp.ea_variant(p_good text,p_default boolean) returns uuid language sql as $$
 select id from public.goods_variants where good_id=p_good and is_default=p_default and archived_at is null order by sort_order,id limit 1;
$$;
create function pg_temp.ea_option(p_good text,p_name text) returns uuid language sql as $$
 select id from public.goods_variants where good_id=p_good and name=p_name and archived_at is null;
$$;
create function pg_temp.ea_row(p_preview jsonb,p_key text) returns jsonb language sql as $$
 select value from jsonb_array_elements(p_preview->'rows') where value->>'key'=p_key;
$$;

-- 계정: 1 통합 매니저, 2 부매니저(MD), 3 물류출고관리, 4 구매자, 5 다른 부매니저.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.ea_id(n),'authenticated','authenticated','erp-linked-'||n||'@example.test',now(),'{}','{}',now(),now()
from generate_series(1,5) n;
update public.profiles set role=(case when id=pg_temp.ea_id(1) then 'admin' when id=pg_temp.ea_id(4) then 'user' else 'staff' end)::public.user_role,
 nickname='erp_linked_'||right(id::text,2),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
where id::text like 'e7180000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values
 (pg_temp.ea_id(1),'owner'),(pg_temp.ea_id(2),'deputy'),(pg_temp.ea_id(3),'logistics'),(pg_temp.ea_id(5),'deputy');
insert into public.ips(id,title,vertical_key) values('erp-linked-ip','TEST ERP 연결 상품','character');
-- KC 합성 검토자(helpers/goods_kc_fixture.sql)는 역할 설정 전 DB에서 운영자가 아니므로 미리 주매니저로 둔다.
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 values(('47c47700'||left(md5('erp-linked-f'),24))::uuid,'authenticated','authenticated','erp-linked-kc@example.test','{"testFixture":"goods-kc"}',now(),now());
insert into private.operator_memberships(profile_id,manager_role) values(('47c47700'||left(md5('erp-linked-f'),24))::uuid,'primary');

-- A. 권한: ERP 품목 화면 읽기·반입·분류 연결은 catalog.manage, 품목 삭제는 platform.manage 그대로.
select pg_temp.ea_assert((select bool_and(capability='catalog.manage') and count(*)=6 from private.operator_rpc_contracts where signature in (
  'public.admin_import_erp_items(jsonb)','public.admin_search_erp_items(text,integer)','public.admin_list_erp_items(text,integer,integer)',
  'public.admin_list_erp_categories()','public.admin_set_erp_category_mapping(text,uuid)','public.admin_set_erp_category_mappings(jsonb)')),
 'ERP item read, import and category links are catalog.manage contracts');
select pg_temp.ea_assert((select capability='platform.manage' from private.operator_rpc_contracts where signature='public.admin_delete_erp_items(text[])'),
 'ERP item deletion stays platform.manage');
select pg_temp.ea_assert((select bool_and(capability='catalog.manage') and count(*)=3 from private.operator_policy_contracts
  where (table_name,policy_name) in (('erp_items','erp_items_staff_read'),('erp_category_mappings','erp_category_mappings_staff_read'),
   ('catalog_category_erp_mappings','catalog_category_erp_mappings_staff_read'))),'ERP read policies are catalog.manage contracts');
select pg_temp.ea_assert((select bool_and(capability='catalog.manage' and guard_kind='write') and count(*)=2 from private.operator_rpc_contracts
  where signature in ('public.admin_preview_erp_linked_goods(uuid,text[])','public.admin_commit_erp_linked_goods(uuid,text[])')),
 'apply RPCs are catalog.manage write contracts');
select pg_temp.ea_assert(
 not has_function_privilege('anon','public.admin_preview_erp_linked_goods(uuid,text[])','execute')
 and has_function_privilege('authenticated','public.admin_preview_erp_linked_goods(uuid,text[])','execute')
 and not has_function_privilege('service_role','public.admin_preview_erp_linked_goods(uuid,text[])','execute')
 and not has_function_privilege('anon','public.admin_commit_erp_linked_goods(uuid,text[])','execute')
 and has_function_privilege('authenticated','public.admin_commit_erp_linked_goods(uuid,text[])','execute')
 and not has_function_privilege('service_role','public.admin_commit_erp_linked_goods(uuid,text[])','execute')
 and not has_function_privilege('authenticated','private.erp_linked_goods_plan(text[])','execute')
 and not has_table_privilege('authenticated','private.erp_goods_apply_operations','select'),'apply ACL');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);

-- 부매니저(MD)가 반입·목록·분류 목록·연결을 한다.
select pg_temp.ea_as(2);
select pg_temp.ea_assert((public.admin_import_erp_items('[
  {"code":"EA-A","name":"연결 A","category":"ERP검증 > 키링","sale_price":11000,"barcode":"8807180000011"},
  {"code":"EA-B1","name":"연결 B 기본","category":"ERP검증 > 키링","sale_price":13000},
  {"code":"EA-B2","name":"연결 B 추가","category":"ERP검증 > 키링","sale_price":14000},
  {"code":"EA-C","name":"할인 중","category":"ERP검증 > 미연결","sale_price":16000},
  {"code":"EA-D1","name":"옵션 낮음 기본","sale_price":10000},
  {"code":"EA-D2","name":"옵션 낮음 추가","sale_price":9000},
  {"code":"EA-Z","name":"0원","sale_price":0},
  {"code":"EA-R","name":"랜덤","sale_price":9500},
  {"code":"EA-T","name":"바코드 겹침","barcode":"8807180000099"},
  {"code":"EA-U1","name":"같은 바코드 1","barcode":"8807180000077"},
  {"code":"EA-U2","name":"같은 바코드 2","barcode":"8807180000077"},
  {"code":"EA-F","name":"저장 거절","sale_price":21000},
  {"code":"EA-I","name":"즉시할인","sale_price":12000},
  {"code":"EA-N","name":"연결 없음","sale_price":5000,"barcode":"8807180000055"}
]'::jsonb)->>'inserted')::int=14,'MD imports ERP items');
select pg_temp.ea_assert((public.admin_list_erp_items('EA-',0,50)->>'total')::int=14,'MD lists ERP items');
select pg_temp.ea_assert(exists(select 1 from public.admin_list_erp_categories() where erp_category='ERP검증 > 키링'),'MD lists ERP categories');
select pg_temp.ea_assert((select count(*)=2 from public.admin_search_erp_items('EA-B',8)),'MD searches ERP items for option names');
select pg_temp.ea_assert((select count(*)=14 from public.erp_items where code like 'EA-%'),'MD reads the ERP item table through RLS');
select pg_temp.ea_error($q$select public.admin_delete_erp_items(array['EA-N'])$q$,'42501');

-- 물류출고관리·구매자는 반입·미리보기를 못 한다.
select pg_temp.ea_as(3);
select pg_temp.ea_error($q$select public.admin_import_erp_items('[{"code":"EA-L","name":"물류"}]'::jsonb)$q$,'42501');
select pg_temp.ea_error($q$select public.admin_preview_erp_linked_goods(pg_temp.ea_id(900),null)$q$,'42501');
select pg_temp.ea_assert((select count(*)=0 from public.erp_items where code like 'EA-%'),'logistics cannot read ERP items');
select pg_temp.ea_as(4);
select pg_temp.ea_error($q$select public.admin_preview_erp_linked_goods(pg_temp.ea_id(901),null)$q$,'42501');

-- 상품: 옵션의 ERP 코드가 같으면 연결 상품이다.
select pg_temp.ea_as(2);
select public.admin_save_good('{"id":"erp-linked-a","ip_id":"erp-linked-ip","name":"TEST 연결 A","price":10000,"variant_baseline":[],
 "variants":[{"name":"기본 옵션","attributes":{},"extraPrice":0,"stockQty":3,"erpCode":"EA-A","erpName":"연결 A"}]}');
select public.admin_save_good('{"id":"erp-linked-b","ip_id":"erp-linked-ip","name":"TEST 연결 B","price":10000,"variant_baseline":[],
 "variants":[{"name":"기본","attributes":{"색":"빨강"},"extraPrice":0,"stockQty":3,"erpCode":"EA-B1","erpName":"연결 B 기본","barcode":"8807180000021"},
  {"name":"추가","attributes":{"색":"파랑"},"extraPrice":2000,"stockQty":4,"erpCode":"EA-B2","erpName":"연결 B 추가"}]}');
select public.admin_save_good('{"id":"erp-linked-c","ip_id":"erp-linked-ip","name":"TEST 할인 중","price":15000,"variant_baseline":[],
 "variants":[{"name":"기본 옵션","attributes":{},"extraPrice":0,"stockQty":3,"erpCode":"EA-C","erpName":"할인 중"}]}');
select public.admin_save_good('{"id":"erp-linked-d","ip_id":"erp-linked-ip","name":"TEST 옵션 낮음","price":10000,"variant_baseline":[],
 "variants":[{"name":"기본","attributes":{"맛":"단"},"extraPrice":0,"stockQty":3,"erpCode":"EA-D1","erpName":"옵션 낮음 기본"},
  {"name":"추가","attributes":{"맛":"짠"},"extraPrice":1000,"stockQty":3,"erpCode":"EA-D2","erpName":"옵션 낮음 추가"}]}');
select public.admin_save_good('{"id":"erp-linked-z","ip_id":"erp-linked-ip","name":"TEST 0원","price":7000,"variant_baseline":[],
 "variants":[{"name":"기본 옵션","attributes":{},"extraPrice":0,"stockQty":3,"erpCode":"EA-Z","erpName":"0원"}]}');
select public.admin_save_good('{"id":"erp-linked-r","ip_id":"erp-linked-ip","name":"TEST 랜덤","price":9000,"variant_baseline":[],
 "variants":[{"name":"하나","attributes":{"종류":"1"},"extraPrice":0,"stockQty":3,"erpCode":"EA-R","erpName":"랜덤"},
  {"name":"둘","attributes":{"종류":"2"},"extraPrice":0,"stockQty":3}]}');
select public.admin_save_good('{"id":"erp-linked-t","ip_id":"erp-linked-ip","name":"TEST 바코드","price":5000,"variant_baseline":[],
 "variants":[{"name":"기본","attributes":{"판":"1"},"extraPrice":0,"stockQty":3,"erpCode":"EA-T","erpName":"바코드 겹침"},
  {"name":"다른","attributes":{"판":"2"},"extraPrice":0,"stockQty":3,"barcode":"8807180000099"},
  {"name":"같은1","attributes":{"판":"3"},"extraPrice":0,"stockQty":3,"erpCode":"EA-U1","erpName":"같은 바코드 1"},
  {"name":"같은2","attributes":{"판":"4"},"extraPrice":0,"stockQty":3,"erpCode":"EA-U2","erpName":"같은 바코드 2"}]}');
select public.admin_save_good('{"id":"erp-linked-f","ip_id":"erp-linked-ip","name":"TEST 저장 거절","type":"기타","price":20000,"variant_baseline":[],
 "variants":[{"name":"기본 옵션","attributes":{},"extraPrice":0,"stockQty":3,"erpCode":"EA-F","erpName":"저장 거절"}]}');
-- 즉시할인: 상품 편집은 판매가(할인 전)를 표시용 정가에, 할인가를 price에 저장한다(lib/admin/goods-price-editor.ts).
select public.admin_save_good('{"id":"erp-linked-i","ip_id":"erp-linked-ip","name":"TEST 즉시할인","price":9000,"compare_at_price":12000,"variant_baseline":[],
 "variants":[{"name":"기본 옵션","attributes":{},"extraPrice":0,"stockQty":3,"erpCode":"EA-I","erpName":"즉시할인"}]}');
-- 진행 예정 할인(상품 단위로 판매가를 건너뛴다).
select public.admin_save_goods_price_period('erp-linked-c',pg_temp.ea_variant('erp-linked-c',true),null,
 jsonb_build_object('state','active','discountPrice',14000,'startsAt',now()+interval '1 day','endsAt',now()+interval '2 days'),null);
reset role;
update public.goods set option_sale_mode='random' where id='erp-linked-r';
set local role authenticated;
select pg_temp.ea_as(2);

-- B. 미리보기: 값이 다른 연결 옵션만, 건너뛰는 행은 이유와 함께. 상품은 바뀌지 않는다.
do $$ declare preview jsonb; codes text[]:=array['EA-A','EA-B1','EA-B2','EA-C','EA-D1','EA-D2','EA-Z','EA-R','EA-T','EA-U1','EA-U2','EA-F','EA-I','EA-N'];
 a uuid:=pg_temp.ea_variant('erp-linked-a',true); b1 uuid:=pg_temp.ea_variant('erp-linked-b',true); b2 uuid:=pg_temp.ea_variant('erp-linked-b',false);
 d1 uuid:=pg_temp.ea_variant('erp-linked-d',true); d2 uuid:=pg_temp.ea_variant('erp-linked-d',false);
 t uuid:=pg_temp.ea_option('erp-linked-t','기본');
 u1 uuid:=pg_temp.ea_option('erp-linked-t','같은1');
 u2 uuid:=pg_temp.ea_option('erp-linked-t','같은2');
begin
 preview:=public.admin_preview_erp_linked_goods(pg_temp.ea_id(100),codes);
 perform pg_temp.ea_assert((preview->>'linked')::int=13,'thirteen linked options are compared (EA-N has no option)');
 perform pg_temp.ea_assert((preview->>'scopeCount')::int=14 and preview->>'truncated'='false','scope and size');
 perform pg_temp.ea_assert(pg_temp.ea_row(preview,a||':price') @> jsonb_build_object('status','apply','current',10000,'next',11000,'goodId','erp-linked-a','isDefault',true),
  'single option price differs');
 perform pg_temp.ea_assert(pg_temp.ea_row(preview,a||':barcode') @> '{"status":"apply","current":null,"next":"8807180000011","warning":null}'::jsonb,
  'empty barcode is filled without a warning');
 perform pg_temp.ea_assert(pg_temp.ea_row(preview,b1||':price') @> '{"status":"apply","current":10000,"next":13000}'::jsonb
  and pg_temp.ea_row(preview,b2||':price') @> '{"status":"apply","current":12000,"next":14000}'::jsonb,'base and option rise together');
 perform pg_temp.ea_assert(pg_temp.ea_row(preview,b1||':barcode') is null,'ERP without a barcode never clears the option barcode');
 perform pg_temp.ea_assert(pg_temp.ea_row(preview,pg_temp.ea_variant('erp-linked-c',true)||':price') @> '{"status":"skip","reason":"active_discount"}'::jsonb,
  'upcoming discount skips the price');
 -- 즉시할인 상품의 price는 할인가라 ERP 판매가(할인 전)를 넣으면 할인이 사라진다. 건너뛴다.
 perform pg_temp.ea_assert(pg_temp.ea_row(preview,pg_temp.ea_variant('erp-linked-i',true)||':price') @> '{"status":"skip","reason":"instant_discount","current":9000,"next":12000}'::jsonb,
  'instant discount skips the price');
 perform pg_temp.ea_assert(pg_temp.ea_row(preview,d1||':price') is null
  and pg_temp.ea_row(preview,d2||':price') @> '{"status":"skip","reason":"option_price_order","current":11000,"next":9000}'::jsonb,
  'option price below the product price is skipped');
 perform pg_temp.ea_assert(pg_temp.ea_row(preview,pg_temp.ea_variant('erp-linked-z',true)||':price') @> '{"status":"skip","reason":"zero_price"}'::jsonb,
  'ERP price 0 is skipped');
 perform pg_temp.ea_assert(pg_temp.ea_row(preview,pg_temp.ea_variant('erp-linked-r',true)||':price') @> '{"status":"skip","reason":"random_option"}'::jsonb,
  'random goods keep one price');
 perform pg_temp.ea_assert(pg_temp.ea_row(preview,t||':barcode') @> '{"status":"skip","reason":"barcode_taken"}'::jsonb,'barcode used by another option');
 perform pg_temp.ea_assert(pg_temp.ea_row(preview,u1||':barcode') @> '{"status":"skip","reason":"barcode_duplicate"}'::jsonb
  and pg_temp.ea_row(preview,u2||':barcode') @> '{"status":"skip","reason":"barcode_duplicate"}'::jsonb,'one barcode for two options');
 perform pg_temp.ea_assert((select price=10000 from public.goods where id='erp-linked-a')
  and (select barcode is null from public.admin_list_goods_variant_external_identities('erp-linked-a') where variant_id=a),'preview never changes goods');
 -- 같은 operation id로 다시 부르면 고정한 미리보기를 돌려준다.
 perform pg_temp.ea_assert(public.admin_preview_erp_linked_goods(pg_temp.ea_id(100),null)=preview,'preview is pinned to its operation');
end $$;

-- 상품정보제공고시가 빈 공개 상품은 상품 저장 규칙(admin_upsert_good)에 막히므로 미리 건너뛴다.
reset role;
select pg_temp.publish_goods_kc_fixture('erp-linked-f');
set local role authenticated;
select pg_temp.ea_as(2);
select pg_temp.ea_assert(pg_temp.ea_row(public.admin_preview_erp_linked_goods(pg_temp.ea_id(101),array['EA-F']),
 pg_temp.ea_variant('erp-linked-f',true)||':price') @> '{"status":"skip","reason":"notice_required","published":true}'::jsonb,'published good without notices is skipped');
reset role;
update public.goods set published_at=null where id='erp-linked-f';
set local role authenticated;
select pg_temp.ea_as(2);

-- C. 확정 요청 오류는 operation을 닫지 않는다: 건너뛰는 행·없는 행, 남의 operation.
select pg_temp.ea_error(format($q$select public.admin_commit_erp_linked_goods(pg_temp.ea_id(100),array['%s:price'])$q$,pg_temp.ea_variant('erp-linked-z',true)),'invalid_erp_goods_apply_keys');
select pg_temp.ea_error($q$select public.admin_commit_erp_linked_goods(pg_temp.ea_id(100),array['nope:price'])$q$,'invalid_erp_goods_apply_keys');
select pg_temp.ea_as(5);
select pg_temp.ea_error(format($q$select public.admin_commit_erp_linked_goods(pg_temp.ea_id(100),array['%s:price'])$q$,pg_temp.ea_variant('erp-linked-a',true)),'erp_goods_apply_unavailable');
select pg_temp.ea_as(2);
-- 같은 상품의 판매가 행을 일부만 고르면(기본 옵션만 올림) 옵션 판매가가 상품 판매가보다 낮아져 거절한다.
select pg_temp.ea_error(format($q$select public.admin_commit_erp_linked_goods(pg_temp.ea_id(100),array['%s:price'])$q$,pg_temp.ea_variant('erp-linked-b',true)),'erp_goods_apply_partial_price');

-- D. 확정: 고른 행만 반영하고 감사 기록을 남긴다. 상품 저장 규칙에 막힌 상품은 그 상품만 빼고 사유를 남긴다.
reset role;
create function public.ea_block_good_f() returns trigger language plpgsql as $$
begin if new.id='erp-linked-f' and new.price is distinct from old.price then raise check_violation using message='erp_linked_test_blocked';end if;return new;end $$;
create trigger ea_block_good_f before update on public.goods for each row execute function public.ea_block_good_f();
set local role authenticated;
select pg_temp.ea_as(2);
do $$ declare receipt jsonb; again jsonb;
 a uuid:=pg_temp.ea_variant('erp-linked-a',true); b1 uuid:=pg_temp.ea_variant('erp-linked-b',true); b2 uuid:=pg_temp.ea_variant('erp-linked-b',false);
 f uuid:=pg_temp.ea_variant('erp-linked-f',true);
begin
 perform public.admin_preview_erp_linked_goods(pg_temp.ea_id(102),array['EA-F']);
 receipt:=public.admin_commit_erp_linked_goods(pg_temp.ea_id(100),array[a||':price',a||':barcode',b1||':price',b2||':price']);
 perform pg_temp.ea_assert(receipt @> '{"state":"completed","applied":{"price":3,"barcode":1,"goods":2}}'::jsonb
  and jsonb_array_length(receipt->'failed')=0,'selected rows applied: '||receipt::text);
 again:=public.admin_commit_erp_linked_goods(pg_temp.ea_id(100),array[a||':price']);
 perform pg_temp.ea_assert(again=receipt,'the same operation returns the same receipt');
 receipt:=public.admin_commit_erp_linked_goods(pg_temp.ea_id(102),array[f||':price']);
 perform pg_temp.ea_assert(receipt @> '{"state":"completed","applied":{"price":0,"barcode":0,"goods":0}}'::jsonb
  and receipt->'failed' @> jsonb_build_array(jsonb_build_object('key',f||':price','goodId','erp-linked-f','error','erp_linked_test_blocked')),
  'blocked good is reported, not applied: '||receipt::text);
end $$;
reset role;
drop trigger ea_block_good_f on public.goods;
drop function public.ea_block_good_f();
select pg_temp.ea_assert((select price=11000 from public.goods where id='erp-linked-a')
 and (select price=11000 from public.goods_variants where id=pg_temp.ea_variant('erp-linked-a',true))
 and (select barcode='8807180000011' from private.goods_variant_external_identity where variant_id=pg_temp.ea_variant('erp-linked-a',true))
 and (select erp_code='EA-A' and erp_name='연결 A' from private.goods_variant_external_identity where variant_id=pg_temp.ea_variant('erp-linked-a',true)),
 'single option price and barcode applied; ERP code and name kept');
select pg_temp.ea_assert((select price=13000 from public.goods where id='erp-linked-b')
 and (select price=13000 from public.goods_variants where id=pg_temp.ea_variant('erp-linked-b',true))
 and (select price=14000 from public.goods_variants where id=pg_temp.ea_variant('erp-linked-b',false))
 and (select sum(stock_qty)=7 from public.goods_variants where good_id='erp-linked-b'),'option prices set as absolute values, stock kept');
select pg_temp.ea_assert((select price=20000 from public.goods where id='erp-linked-f'),'blocked good keeps its price');
select pg_temp.ea_assert((select count(*)=1 from public.audit_log where action='admin.erp_items.linked_goods_applied' and actor_id=pg_temp.ea_id(2)
  and diff->>'operationId'=pg_temp.ea_id(100)::text
  and diff->'applied' @> jsonb_build_array(jsonb_build_object('key',pg_temp.ea_variant('erp-linked-a',true)||':price','before',10000,'after',11000)))
 ,'one apply audit with before and after');
select pg_temp.ea_assert(exists(select 1 from public.audit_log where action='admin.good.options_saved' and target='goods:erp-linked-b' and actor_id=pg_temp.ea_id(2)
  and diff->'after' @> jsonb_build_array(jsonb_build_object('id',pg_temp.ea_variant('erp-linked-b',false),'price',14000)))
 and exists(select 1 from public.audit_log where action='admin.good.variant_external_identity_saved'
  and target='goods_variant:'||pg_temp.ea_variant('erp-linked-a',true) and diff->'after'->>'barcode'='8807180000011'),
 'existing product and barcode writers leave their own audit');

-- E. 같은 붙여넣기를 다시 비교하면 반영한 행은 더 나오지 않는다. 값이 같으면 operation도 남기지 않는다.
set local role authenticated;
select pg_temp.ea_as(2);
select pg_temp.ea_assert(public.admin_preview_erp_linked_goods(pg_temp.ea_id(103),array['EA-A','EA-B1','EA-B2'])->>'total'='0','re-pasting the same values shows nothing');
reset role;
select pg_temp.ea_assert(not exists(select 1 from private.erp_goods_apply_operations where id=pg_temp.ea_id(103)),'no operation without differences');

-- F. 미리보기 뒤 값이 바뀌면 아무것도 바꾸지 않고 거절 결과를 남긴다. 15분이 지나도 같다.
set local role authenticated;
select pg_temp.ea_as(2);
select public.admin_import_erp_items('[{"code":"EA-A","name":"연결 A","sale_price":12000,"barcode":"8807180000012"}]'::jsonb);
-- 이미 있던 바코드가 바뀌는 행에는 출고 대조 경고가 붙는다.
select pg_temp.ea_assert(pg_temp.ea_row(public.admin_preview_erp_linked_goods(pg_temp.ea_id(104),array['EA-A']),pg_temp.ea_variant('erp-linked-a',true)||':barcode')
 @> '{"status":"apply","current":"8807180000011","next":"8807180000012","warning":"barcode_changed"}'::jsonb,'changing an existing barcode warns');
-- 범위를 비우면 반입한 전체 ERP 품목과 비교한다.
select pg_temp.ea_assert((public.admin_preview_erp_linked_goods(pg_temp.ea_id(107),null)->>'scopeCount') is null
 and (public.admin_preview_erp_linked_goods(pg_temp.ea_id(107),null)->>'linked')::int>=13,'whole ERP master is compared without a scope');
reset role;
update public.goods set price=10500 where id='erp-linked-a';
set local role authenticated;
select pg_temp.ea_as(2);
select pg_temp.ea_assert(public.admin_commit_erp_linked_goods(pg_temp.ea_id(104),
  array[pg_temp.ea_variant('erp-linked-a',true)||':price',pg_temp.ea_variant('erp-linked-a',true)||':barcode'])
 @> '{"state":"rejected","error":"erp_goods_apply_changed"}'::jsonb,'changed after preview rejects');
select pg_temp.ea_assert((select barcode='8807180000011' from public.admin_list_goods_variant_external_identities('erp-linked-a') where variant_id=pg_temp.ea_variant('erp-linked-a',true)),
 'no partial apply after a conflict');
select public.admin_preview_erp_linked_goods(pg_temp.ea_id(105),array['EA-A']);
reset role;
update private.erp_goods_apply_operations set expires_at=clock_timestamp()-interval '1 second' where id=pg_temp.ea_id(105);
set local role authenticated;
select pg_temp.ea_as(2);
select pg_temp.ea_assert(public.admin_commit_erp_linked_goods(pg_temp.ea_id(105),array[pg_temp.ea_variant('erp-linked-a',true)||':barcode'])
 @> '{"state":"rejected","error":"erp_goods_apply_expired"}'::jsonb,'expired preview rejects');

-- G. 할인 중 상품은 할인이 끝나면(중지) 다음 비교에서 반영할 수 있다.
reset role;
update private.goods_variant_price_periods set state='disabled' where good_id='erp-linked-c';
set local role authenticated;
select pg_temp.ea_as(2);
select pg_temp.ea_assert(pg_temp.ea_row(public.admin_preview_erp_linked_goods(pg_temp.ea_id(106),array['EA-C']),
 pg_temp.ea_variant('erp-linked-c',true)||':price') @> '{"status":"apply","next":16000}'::jsonb,'stopped discount no longer skips');

reset role;
rollback;
