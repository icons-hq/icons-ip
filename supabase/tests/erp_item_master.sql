\set ON_ERROR_STOP on

-- MD 회의(2026-10-07) ⑦ ERP 품목 반입·검색·ERP 분류 연결·삭제.
-- 반입은 ERP 코드 기준 upsert이고, 선행 0을 보존하며, 잘못된 행은 사유와 함께 돌려준다.
-- 검색어의 와일드카드는 글자로만 다루고, 새 연결이 없으면 고객 카테고리의 정본 ERP 분류 매핑으로 제안한다.
-- 삭제는 지운 행의 값을 감사 기록에 남기고, 비스태프는 ACL과 함수 가드 양쪽에서 막힌다.

begin;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000071101','authenticated','authenticated','erp-items-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000071102','authenticated','authenticated','erp-items-member@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000071101';

insert into public.catalog_categories(id,code,name,parent_id,depth) values
 ('00000000-0000-4000-8000-000000071110','erp-smoke-parent','ERP 검증 문구',null,1),
 ('00000000-0000-4000-8000-000000071111','erp-smoke-keyring','ERP 검증 키링','00000000-0000-4000-8000-000000071110',2),
 ('00000000-0000-4000-8000-000000071112','erp-smoke-archived','ERP 검증 보관','00000000-0000-4000-8000-000000071110',2),
 ('00000000-0000-4000-8000-000000071113','erp-smoke-photo','ERP 검증 포토카드','00000000-0000-4000-8000-000000071110',2),
 ('00000000-0000-4000-8000-000000071114','erp-smoke-sticker','ERP 검증 스티커','00000000-0000-4000-8000-000000071110',2),
 ('00000000-0000-4000-8000-000000071115','erp-smoke-goods-a','ERP 검증 굿즈 A','00000000-0000-4000-8000-000000071110',2),
 ('00000000-0000-4000-8000-000000071116','erp-smoke-goods-b','ERP 검증 굿즈 B','00000000-0000-4000-8000-000000071110',2);

-- 고객 카테고리 화면의 정본 ERP 분류 매핑(카테고리 → ERP 분류 코드·이름). 새 연결이 없을 때의 제안 근거다.
insert into public.catalog_category_erp_mappings(category_id,erp_code,erp_name,source,verified_at,verified_by) values
 ('00000000-0000-4000-8000-000000071113','ERP-PC','문구 > 포토카드','erp-smoke',now(),'00000000-0000-4000-8000-000000071101'),
 ('00000000-0000-4000-8000-000000071114','ERP-STICKER','스티커','erp-smoke',now(),'00000000-0000-4000-8000-000000071101'),
 ('00000000-0000-4000-8000-000000071115','ERP-GA','굿즈','erp-smoke',now(),'00000000-0000-4000-8000-000000071101'),
 ('00000000-0000-4000-8000-000000071116','ERP-GB','굿즈','erp-smoke',now(),'00000000-0000-4000-8000-000000071101'),
 ('00000000-0000-4000-8000-000000071112','ERP-ARCH','보관 분류','erp-smoke',now(),'00000000-0000-4000-8000-000000071101');
update public.catalog_categories set archived_at=now() where id='00000000-0000-4000-8000-000000071112';

-- 실행 권한은 인증 사용자에게만 열고, 테이블 직접 쓰기는 누구에게도 열지 않는다.
select 1/case when
  not has_function_privilege('anon','public.admin_import_erp_items(jsonb)','execute')
  and has_function_privilege('authenticated','public.admin_import_erp_items(jsonb)','execute')
  and not has_function_privilege('service_role','public.admin_import_erp_items(jsonb)','execute')
  and not has_function_privilege('anon','public.admin_search_erp_items(text,integer)','execute')
  and has_function_privilege('authenticated','public.admin_search_erp_items(text,integer)','execute')
  and not has_function_privilege('service_role','public.admin_search_erp_items(text,integer)','execute')
  and not has_function_privilege('anon','public.admin_list_erp_items(text,integer,integer)','execute')
  and has_function_privilege('authenticated','public.admin_list_erp_items(text,integer,integer)','execute')
  and not has_function_privilege('service_role','public.admin_list_erp_items(text,integer,integer)','execute')
  and not has_function_privilege('anon','public.admin_list_erp_categories()','execute')
  and has_function_privilege('authenticated','public.admin_list_erp_categories()','execute')
  and not has_function_privilege('service_role','public.admin_list_erp_categories()','execute')
  and not has_function_privilege('anon','public.admin_set_erp_category_mapping(text,uuid)','execute')
  and has_function_privilege('authenticated','public.admin_set_erp_category_mapping(text,uuid)','execute')
  and not has_function_privilege('service_role','public.admin_set_erp_category_mapping(text,uuid)','execute')
  and not has_function_privilege('anon','public.admin_delete_erp_items(text[])','execute')
  and has_function_privilege('authenticated','public.admin_delete_erp_items(text[])','execute')
  and not has_function_privilege('service_role','public.admin_delete_erp_items(text[])','execute')
  and not has_function_privilege('authenticated','private.normalize_erp_item_row(jsonb)','execute')
  and not has_function_privilege('authenticated','private.erp_category_target(text)','execute')
  and not has_function_privilege('authenticated','private.erp_category_legacy_target(text)','execute')
  and not has_function_privilege('authenticated','private.erp_item_text(text,boolean)','execute')
  and has_table_privilege('authenticated','public.erp_items','select')
  and not has_table_privilege('authenticated','public.erp_items','insert')
  and not has_table_privilege('authenticated','public.erp_items','update')
  and not has_table_privilege('authenticated','public.erp_items','delete')
  and not has_table_privilege('anon','public.erp_items','select')
  and not has_table_privilege('authenticated','public.erp_category_mappings','insert')
  and not has_table_privilege('anon','public.erp_category_mappings','select')
then 1 else 0 end as assert_erp_item_acl;

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000071101',true);

-- 첫 반입: 추가 4건, 거부 6건(빈 코드·빈 품명·음수 판매가·긴 코드·탭이 든 코드·앞선 중복).
with result as (
  select public.admin_import_erp_items(jsonb_build_array(
    jsonb_build_object('row',2,'code','000123','name',E' 아크릴\n키링 ','category','문구 > 키링','sale_price',12000,'barcode','0088012345678'),
    jsonb_build_object('row',3,'code','A-100%','name','포토카드 세트','category','문구 > 포토카드'),
    jsonb_build_object('row',4,'code','K-2','name','키링 거치대','category','문구 > 키링','sale_price','8,000원'),
    jsonb_build_object('row',5,'code','','name','빈 코드'),
    jsonb_build_object('row',6,'code','BAD','name','  '),
    jsonb_build_object('row',7,'code','X1','name','가격 오류','sale_price',-1),
    jsonb_build_object('row',8,'code',repeat('L',121),'name','긴 코드'),
    jsonb_build_object('row',9,'code',E'A\tB','name','탭 코드'),
    jsonb_build_object('row',10,'code','DUP','name','첫 번째'),
    jsonb_build_object('row',11,'code','DUP','name','두 번째')
  )) as r
)
select 1/case when
  (r->>'inserted')::int=4 and (r->>'updated')::int=0 and (r->>'unchanged')::int=0
  and jsonb_array_length(r->'rejected')=6
  and r->'rejected' @> '[{"row":5,"reason":"missing_code"}]'
  and r->'rejected' @> '[{"row":6,"code":"BAD","reason":"missing_name"}]'
  and r->'rejected' @> '[{"row":7,"code":"X1","reason":"invalid_sale_price"}]'
  and r->'rejected' @> '[{"row":8,"reason":"invalid_code"}]'
  and r->'rejected' @> '[{"row":9,"reason":"invalid_code"}]'
  and r->'rejected' @> '[{"row":10,"code":"DUP","reason":"duplicate_code"}]'
then 1 else 0 end as assert_erp_import_counts_and_rejections
from result;

-- ERP 코드·바코드의 선행 0을 보존하고, 품명 공백을 정리하고, 서식 있는 판매가를 정수로 읽는다.
select 1/case when
  (select name from public.erp_items where code='000123')='아크릴 키링'
  and (select barcode from public.erp_items where code='000123')='0088012345678'
  and (select sale_price from public.erp_items where code='000123')=12000
  and (select sale_price from public.erp_items where code='K-2')=8000
  and (select name from public.erp_items where code='DUP')='두 번째'
  and (select imported_by from public.erp_items where code='DUP')='00000000-0000-4000-8000-000000071101'
  and not exists(select 1 from public.erp_items where code in ('','BAD','X1'))
then 1 else 0 end as assert_erp_import_normalization;

-- 재반입: 같은 값은 그대로, 빠진 열은 기존 값을 유지하고, 새 코드는 추가한다.
with result as (
  select public.admin_import_erp_items(jsonb_build_array(
    jsonb_build_object('code','000123','name','아크릴 키링','category','문구 > 키링','sale_price',12000,'barcode','0088012345678'),
    jsonb_build_object('code','A-100%','name','포토카드 세트 v2'),
    jsonb_build_object('code','NEW1','name','신규 품목')
  )) as r
)
select 1/case when
  (r->>'inserted')::int=1 and (r->>'updated')::int=1 and (r->>'unchanged')::int=1
  and jsonb_array_length(r->'rejected')=0
then 1 else 0 end as assert_erp_reimport_classification
from result;

select 1/case when
  (select name from public.erp_items where code='A-100%')='포토카드 세트 v2'
  and (select category from public.erp_items where code='A-100%')='문구 > 포토카드'
then 1 else 0 end as assert_erp_missing_column_keeps_value;

-- 열이 있고 값이 비면 지운다. 함수가 바꾼 행은 다음 문장에서 확인한다(같은 문장의 스냅샷에는 보이지 않는다).
select (public.admin_import_erp_items('[{"code":"A-100%","name":"포토카드 세트 v2","category":"","barcode":null}]'::jsonb)->>'updated') as blank_import_updated \gset
select 1/case when :'blank_import_updated'='1'
  and (select category from public.erp_items where code='A-100%') is null
then 1 else 0 end as assert_erp_blank_column_clears_value;

-- 제안 검색: 품명 앞부분 일치가 먼저, 와일드카드는 글자로만 맞춘다.
select 1/case when
  (select count(*) from public.admin_search_erp_items('키링',8))=2
  and (select code from public.admin_search_erp_items('키링',8) limit 1)='K-2'
  and (select code from public.admin_search_erp_items('000123',8) limit 1)='000123'
  and (select count(*) from public.admin_search_erp_items('%',8))=1
  and (select code from public.admin_search_erp_items('%',8))='A-100%'
  and (select count(*) from public.admin_search_erp_items('_',8))=0
  and (select count(*) from public.admin_search_erp_items(E'\\',8))=0
  and (select count(*) from public.admin_search_erp_items('   ',8))=0
  and (select count(*) from public.admin_search_erp_items('키',1))=1
then 1 else 0 end as assert_erp_search_rank_and_wildcards;

-- ERP 분류 연결: 활성 말단만 허용하고, 같은 연결은 변경으로 세지 않는다.
select public.admin_set_erp_category_mapping(' 문구 > 키링 ','00000000-0000-4000-8000-000000071111')->>'changed' as mapping_first_changed \gset
select public.admin_set_erp_category_mapping('문구 > 키링','00000000-0000-4000-8000-000000071111')->>'changed' as mapping_repeat_changed \gset
select 1/case when
  :'mapping_first_changed'='true'
  and :'mapping_repeat_changed'='false'
  and (select mapped_category_id from public.admin_search_erp_items('000123',8) limit 1)='00000000-0000-4000-8000-000000071111'
  and (select category_id from public.admin_list_erp_categories() where erp_category='문구 > 키링')='00000000-0000-4000-8000-000000071111'
  and (select item_count from public.admin_list_erp_categories() where erp_category='문구 > 키링')=2
then 1 else 0 end as assert_erp_category_mapping_saved;

do $$ begin
  begin
    perform public.admin_set_erp_category_mapping('문구 > 키링','00000000-0000-4000-8000-000000071112');
    raise exception 'archived category accepted';
  exception when check_violation then if sqlerrm<>'category_archived' then raise; end if; end;
  begin
    perform public.admin_set_erp_category_mapping('문구 > 키링','00000000-0000-4000-8000-000000071110');
    raise exception 'non-leaf category accepted';
  exception when check_violation then if sqlerrm<>'category_not_leaf' then raise; end if; end;
  begin
    perform public.admin_set_erp_category_mapping('문구 > 키링','00000000-0000-4000-8000-000000071199');
    raise exception 'missing category accepted';
  exception when no_data_found then null; end;
  begin
    perform public.admin_set_erp_category_mapping('  ','00000000-0000-4000-8000-000000071111');
    raise exception 'blank erp category accepted';
  exception when invalid_parameter_value then null; end;
end $$;

-- 연결 해제 뒤에는 제안에서 카테고리가 빠지고, 품목 없는 연결도 목록에 남지 않는다.
select public.admin_set_erp_category_mapping('문구 > 키링',null)->>'changed' as mapping_clear_changed \gset
select public.admin_set_erp_category_mapping('문구 > 키링',null)->>'changed' as mapping_clear_repeat_changed \gset
select 1/case when
  :'mapping_clear_changed'='true'
  and :'mapping_clear_repeat_changed'='false'
  and (select mapped_category_id from public.admin_search_erp_items('000123',8) limit 1) is null
  and (select category_id from public.admin_list_erp_categories() where erp_category='문구 > 키링') is null
then 1 else 0 end as assert_erp_category_mapping_cleared;

-- 목록은 총 개수와 페이지를 함께 주고, 검색어 와일드카드를 글자로 다룬다.
select 1/case when
  (public.admin_list_erp_items(null,0,2)->>'total')::int=5
  and jsonb_array_length(public.admin_list_erp_items(null,0,2)->'items')=2
  and jsonb_array_length(public.admin_list_erp_items(null,4,2)->'items')=1
  and public.admin_list_erp_items(null,0,1)->'items'->0->>'code'='000123'
  and (public.admin_list_erp_items('키링',0,20)->>'total')::int=2
  and (public.admin_list_erp_items('%',0,20)->>'total')::int=1
then 1 else 0 end as assert_erp_list_paging_and_search;

do $$ begin
  begin perform public.admin_search_erp_items('키링',51); raise exception 'search limit accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_list_erp_items(null,-1,20); raise exception 'negative offset accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_import_erp_items('[]'::jsonb); raise exception 'empty import accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_import_erp_items('{"code":"A"}'::jsonb); raise exception 'object import accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.admin_import_erp_items((select jsonb_agg(jsonb_build_object('code','L'||g,'name','한도')) from generate_series(1,5001) g));
    raise exception 'oversized import accepted';
  exception when invalid_parameter_value then null; end;
end $$;

-- 새 연결이 없으면 정본 ERP 분류 매핑에서 이름 또는 코드가 원문과 정확히 같은 활성 말단 하나를 제안한다.
-- 후보가 둘 이상이거나, 보관된 카테고리이거나, 대소문자만 같으면 제안하지 않는다.
select public.admin_import_erp_items(jsonb_build_array(
  jsonb_build_object('code','FB-NAME','name','정본 이름 일치','category','문구 > 포토카드'),
  jsonb_build_object('code','FB-CODE','name','정본 코드 일치','category','ERP-STICKER'),
  jsonb_build_object('code','FB-TWO','name','정본 후보 둘','category','굿즈'),
  jsonb_build_object('code','FB-ARCH','name','정본 보관 말단','category','보관 분류'),
  jsonb_build_object('code','FB-NEAR','name','정본 대소문자 다름','category','erp-sticker')
))->>'inserted' as fallback_inserted \gset
select 1/case when :'fallback_inserted'='5'
  and (select mapped_category_id from public.admin_search_erp_items('FB-NAME',8) limit 1)='00000000-0000-4000-8000-000000071113'
  and (select mapped_category_id from public.admin_search_erp_items('FB-CODE',8) limit 1)='00000000-0000-4000-8000-000000071114'
  and (select mapped_category_id from public.admin_search_erp_items('FB-TWO',8) limit 1) is null
  and (select mapped_category_id from public.admin_search_erp_items('FB-ARCH',8) limit 1) is null
  and (select mapped_category_id from public.admin_search_erp_items('FB-NEAR',8) limit 1) is null
  and public.admin_list_erp_items('FB-NAME',0,20)->'items'->0->>'mapped_category_id'='00000000-0000-4000-8000-000000071113'
  and (select category_id from public.admin_list_erp_categories() where erp_category='문구 > 포토카드') is null
  and (select fallback_category_id from public.admin_list_erp_categories() where erp_category='문구 > 포토카드')='00000000-0000-4000-8000-000000071113'
  and (select fallback_category_id from public.admin_list_erp_categories() where erp_category='굿즈') is null
  and (select fallback_category_id from public.admin_list_erp_categories() where erp_category='보관 분류') is null
then 1 else 0 end as assert_erp_legacy_mapping_fallback;

-- 새 연결이 있으면 정본 매핑보다 새 연결을 따르고, 해제하면 다시 정본 매핑으로 제안한다.
select public.admin_set_erp_category_mapping('문구 > 포토카드','00000000-0000-4000-8000-000000071111')->>'changed' as override_changed \gset
select 1/case when :'override_changed'='true'
  and (select mapped_category_id from public.admin_search_erp_items('FB-NAME',8) limit 1)='00000000-0000-4000-8000-000000071111'
  and (select category_id from public.admin_list_erp_categories() where erp_category='문구 > 포토카드')='00000000-0000-4000-8000-000000071111'
  and (select fallback_category_id from public.admin_list_erp_categories() where erp_category='문구 > 포토카드')='00000000-0000-4000-8000-000000071113'
then 1 else 0 end as assert_erp_new_mapping_overrides_legacy;
select public.admin_set_erp_category_mapping('문구 > 포토카드',null)->>'changed' as override_cleared \gset
select 1/case when :'override_cleared'='true'
  and (select mapped_category_id from public.admin_search_erp_items('FB-NAME',8) limit 1)='00000000-0000-4000-8000-000000071113'
then 1 else 0 end as assert_erp_cleared_mapping_falls_back;

-- 삭제: 요청한 코드 중 있는 행만 지우고 없는 코드는 missing으로 센다. 지운 행의 값은 감사 기록에 남는다.
select public.admin_delete_erp_items(array['FB-TWO','FB-ARCH','FB-ARCH','NO-SUCH']) as delete_result \gset
select public.admin_delete_erp_items(array['NO-SUCH'])->>'deleted' as delete_missing_deleted \gset
select 1/case when
  (:'delete_result'::jsonb->>'requested')::int=3
  and (:'delete_result'::jsonb->>'deleted')::int=2
  and (:'delete_result'::jsonb->>'missing')::int=1
  and :'delete_missing_deleted'='0'
  and not exists(select 1 from public.erp_items where code in ('FB-TWO','FB-ARCH'))
  and (select count(*) from public.admin_search_erp_items('FB-',8))=3
  and (select item_count from public.admin_list_erp_categories() where erp_category='굿즈') is null
  and (select count(*) from public.audit_log where action='admin.erp_items.deleted'
    and actor_id='00000000-0000-4000-8000-000000071101')=1
  and (select diff from public.audit_log where action='admin.erp_items.deleted'
    and actor_id='00000000-0000-4000-8000-000000071101') @> '{"requested":3,"deleted":2,"items":[{"code":"FB-ARCH","name":"정본 보관 말단","category":"보관 분류"},{"code":"FB-TWO","name":"정본 후보 둘","category":"굿즈"}]}'
then 1 else 0 end as assert_erp_delete_items;

do $$ begin
  begin perform public.admin_delete_erp_items(array[]::text[]); raise exception 'empty delete accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_delete_erp_items(null); raise exception 'null delete accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.admin_delete_erp_items(array['FB-NAME',null]); raise exception 'null code delete accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.admin_delete_erp_items((select array_agg('L'||g) from generate_series(1,501) g));
    raise exception 'oversized delete accepted';
  exception when invalid_parameter_value then null; end;
end $$;

-- 반입은 호출마다, 연결 변경은 실제로 바뀐 경우만 감사 기록을 남긴다.
select 1/case when
  (select count(*) from public.audit_log where action='admin.erp_items.imported'
    and actor_id='00000000-0000-4000-8000-000000071101')=4
  and (select (diff->>'inserted')::int from public.audit_log where action='admin.erp_items.imported'
    and actor_id='00000000-0000-4000-8000-000000071101' order by (diff->>'rows')::int desc limit 1)=4
  and (select count(*) from public.audit_log where action='admin.erp_items.category_mapping_updated'
    and actor_id='00000000-0000-4000-8000-000000071101' and target='erp_category_mappings:문구 > 키링')=2
  and (select count(*) from public.audit_log where action='admin.erp_items.category_mapping_updated'
    and actor_id='00000000-0000-4000-8000-000000071101' and target='erp_category_mappings:문구 > 포토카드')=2
then 1 else 0 end as assert_erp_audit_log;

-- 비스태프: 직접 조회는 RLS가 비우고, 모든 RPC는 함수 가드에서 거절한다.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000071102',true);
select 1/case when (select count(*) from public.erp_items)=0
  and (select count(*) from public.erp_category_mappings)=0
then 1 else 0 end as assert_erp_items_hidden_from_member;

do $$ begin
  begin perform public.admin_import_erp_items('[{"code":"M1","name":"회원"}]'::jsonb); raise exception 'member import accepted';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_search_erp_items('키링',8); raise exception 'member search accepted';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_list_erp_items(null,0,20); raise exception 'member list accepted';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_list_erp_categories(); raise exception 'member category list accepted';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_set_erp_category_mapping('문구 > 키링','00000000-0000-4000-8000-000000071111'); raise exception 'member mapping accepted';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_delete_erp_items(array['000123']); raise exception 'member delete accepted';
  exception when insufficient_privilege then null; end;
end $$;

rollback;
