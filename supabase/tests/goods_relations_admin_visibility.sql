\set ON_ERROR_STOP on
-- 연관상품 관리 화면이 되읽는 '공개'(20261126154000_goods_relations_admin_visibility). goods_kc_fixture.sql 뒤에 실행한다(상품 공개에 쓴다).
-- 고르는 창(admin_search_goods_for_relation)과 저장 뒤 화면(admin_get_goods_relation·admin_list_goods_relations)이 같은 판정을 쓰는지,
-- 판매 제한(19금) 상품이 public=true·visibility=restricted로 나오는지, 보는 운영자의 성인 인증·성인 상품 공개 설정이 그 값을 바꾸지 않는지,
-- 고객 화면의 성인 인증 조건(get_good_relation_compositions)은 그대로인지, 권한·실행 권한·운영자 계약을 본다. 준비물은 모두 rollback된다.
begin;
select set_config('request.jwt.claim.sub','',true);
-- 1: 성인 인증이 없는 운영자. 2: 성인 인증을 마친 운영자. 3: 운영자가 아닌 회원.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('0b400000-0000-4000-8000-000000000001','authenticated','authenticated','relation-visibility-plain@example.test',now(),'{}','{}',now(),now()),
 ('0b400000-0000-4000-8000-000000000002','authenticated','authenticated','relation-visibility-adult@example.test',now(),'{}','{}',now(),now()),
 ('0b400000-0000-4000-8000-000000000003','authenticated','authenticated','relation-visibility-member@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id in ('0b400000-0000-4000-8000-000000000001','0b400000-0000-4000-8000-000000000002');
insert into private.operator_memberships(profile_id,manager_role) values
 ('0b400000-0000-4000-8000-000000000001','primary'),('0b400000-0000-4000-8000-000000000002','primary');
update private.operator_access_state set configured=true where id;

insert into public.ips(id,title,vertical_key,published_at) values
 ('rav-ip','연관공개검증','character',now()),
 ('rav-ip-draft','연관공개검증 초안 IP','character',null);
-- a·b: 공개. adult: 공개 + 판매 제한. draft: 공개 전. ipdraft: 상품은 공개, IP는 공개 전. archived: 보관.
-- (보관하지 않은 상품이 있는 IP는 보관할 수 없어 ip_archived는 만들지 않는다 — private.guard_ip_archive.)
insert into public.goods(id,ip_id,name,price,stock,stock_qty) values
 ('rav-a','rav-ip','연관공개검증 a',1000,'ok',10),
 ('rav-b','rav-ip','연관공개검증 b',1000,'ok',10),
 ('rav-adult','rav-ip','연관공개검증 adult',1000,'ok',10),
 ('rav-draft','rav-ip','연관공개검증 draft',1000,'ok',10),
 ('rav-ipdraft','rav-ip-draft','연관공개검증 ipdraft',1000,'ok',10),
 ('rav-archived','rav-ip','연관공개검증 archived',1000,'ok',0);
-- 상품 공개에 쓰는 KC 준비 도우미의 합성 검토자도 운영자로 미리 넣어 둔다(admin_goods_additional_candidate_search.sql과 같은 방식).
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','rav-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where id in ('rav-a','rav-b','rav-adult','rav-ipdraft');
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods
 where id in ('rav-a','rav-b','rav-adult','rav-ipdraft');
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in ('rav-a','rav-b','rav-adult','rav-ipdraft');
update public.goods set sale_restriction='adult' where id='rav-adult';
update public.goods set archived_at=now() where id='rav-archived';
update private.adult_goods_storefront_settings set enabled=true where singleton;

-- 운영자 2의 유효한 성인 인증 증거(adult_goods_sales_gate.sql과 같은 방식).
insert into private.adult_verification_sessions(
  user_id, provider_mode, provider_order_id, callback_nonce_digest, presentation, return_path,
  registration_key, completion_token_digest, state, created_at, expires_at, completed_at
) values (
  '0b400000-0000-4000-8000-000000000002','test','IV'||repeat('7',32),repeat('7',64),'page','/my',
  'REGRELATIONVIS000001',repeat('8',64),'verified',now(),now()+interval '30 minutes',now()
);
insert into private.adult_verifications(
  user_id, session_id, provider, provider_mode, subject_digest, transaction_digest, policy_version, verified_at, expires_at
)
select '0b400000-0000-4000-8000-000000000002', id, 'kcp', 'test', repeat('9',64), repeat('6',64),
  'adult_19_youth_protection_act@2026-10-23', now(), now()+interval '1 year'
from private.adult_verification_sessions where provider_order_id='IV'||repeat('7',32);
select 1/case when private.adult_verification_valid('0b400000-0000-4000-8000-000000000002')
 and not private.adult_verification_valid('0b400000-0000-4000-8000-000000000001') then 1 else 0 end as assert_fixture_adult_evidence;

-- 1. 실행 권한은 그대로다: 조회 함수는 authenticated만, 문서 함수는 아무 롤도 직접 부를 수 없다.
select 1/case when has_function_privilege('authenticated','public.admin_search_goods_for_relation(text,integer)','execute')
 and not has_function_privilege('anon','public.admin_search_goods_for_relation(text,integer)','execute')
 and not has_function_privilege('service_role','public.admin_search_goods_for_relation(text,integer)','execute')
 and not has_function_privilege('authenticated','private.goods_relation_document(uuid)','execute')
 and not has_function_privilege('anon','private.goods_relation_document(uuid)','execute')
 and not has_function_privilege('service_role','private.goods_relation_document(uuid)','execute')
 then 1 else 0 end as assert_execute_unchanged;
-- 2. 운영자 계약: 다시 정의한 두 함수의 지문이 지금 함수와 같다.
select 1/case when exists(select 1 from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
  where c.signature='public.admin_search_goods_for_relation(text,integer)'
   and c.capability='catalog.read' and c.guard_kind='read' and not c.legacy_admin_only and c.body_md5=md5(p.prosrc))
 and exists(select 1 from private.operator_internal_contracts where signature='public.admin_search_goods_for_relation(text,integer)')
 and exists(select 1 from private.operator_internal_contracts where signature='private.goods_relation_document(uuid)')
 then 1 else 0 end as assert_operator_contract_registered;

set local role authenticated;
select set_config('request.jwt.claim.sub','0b400000-0000-4000-8000-000000000001',true);
select public.admin_save_goods_relation_composition('0b400000-0000-4000-8000-000000000101',0,'0b400000-0000-4000-8000-000000000201',
 jsonb_build_object('kind','similar','title','공개검증','representativeGoodId','rav-a','enabled',true,'startsAt',null,'endsAt',null,'visual',null,
  'goodIds','["rav-a","rav-adult","rav-draft","rav-ipdraft","rav-archived","rav-b"]'::jsonb));

-- 3. 저장 뒤 화면: public은 상품·IP 공개만 본다(판매 제한 상품도 true). 안 보이는 이유는 visibility가 나눈다.
select public.admin_get_goods_relation('0b400000-0000-4000-8000-000000000101') as plain_document \gset
select 1/case when (select jsonb_agg(jsonb_build_array(good->>'id',good->'public',good->>'visibility') order by position)
  from jsonb_array_elements(:'plain_document'::jsonb->'goods') with ordinality item(good,position))
 ='[["rav-a",true,"public"],["rav-adult",true,"restricted"],["rav-draft",false,"draft"],["rav-ipdraft",false,"ip_draft"],
    ["rav-archived",false,"archived"],["rav-b",true,"public"]]'::jsonb
 then 1 else 0 end as assert_document_visibility;
select 1/case when (select array_agg(key order by key) from jsonb_object_keys(:'plain_document'::jsonb->'goods'->0) key)
  =array['code','id','imagePath','name','public','visibility'] then 1 else 0 end as assert_document_good_keys;
select 1/case when public.admin_list_goods_relations('공개검증','similar')#>'{rows,0,goods}'=:'plain_document'::jsonb->'goods'
 then 1 else 0 end as assert_list_matches_document;

-- 4. 고르는 창: 저장 뒤 화면과 같은 판정이다. 보관한 상품만 목록에서 빠지고, 공개 상품이 먼저 온다.
select public.admin_search_goods_for_relation('연관공개검증') as plain_search \gset
select 1/case when (:'plain_search'::jsonb->>'total')::int=5
 and (select jsonb_agg(jsonb_build_array(row->>'id',row->'public',row->>'visibility') order by position)
  from jsonb_array_elements(:'plain_search'::jsonb->'rows') with ordinality item(row,position))
 ='[["rav-a",true,"public"],["rav-adult",true,"restricted"],["rav-b",true,"public"],
    ["rav-draft",false,"draft"],["rav-ipdraft",false,"ip_draft"]]'::jsonb
 then 1 else 0 end as assert_search_visibility;
select 1/case when (select array_agg(key order by key) from jsonb_object_keys(:'plain_search'::jsonb->'rows'->0) key)
  =array['code','id','imagePath','name','public','visibility'] then 1 else 0 end as assert_search_row_keys;
-- 검색어 칸 하나로 상품 URL도 찾는다(선택창의 'URL로 추가'를 대신한다).
select 1/case when public.admin_search_goods_for_relation('rav-adult')#>>'{rows,0,visibility}'='restricted'
 and (public.admin_search_goods_for_relation('rav-adult')->>'total')::int=1 then 1 else 0 end as assert_search_by_good_url;

-- 5. 보는 운영자가 성인 인증을 했어도 값은 같다.
select set_config('request.jwt.claim.sub','0b400000-0000-4000-8000-000000000002',true);
select 1/case when public.admin_get_goods_relation('0b400000-0000-4000-8000-000000000101')=:'plain_document'::jsonb
 and public.admin_search_goods_for_relation('연관공개검증')=:'plain_search'::jsonb
 then 1 else 0 end as assert_viewer_adult_verification_ignored;
-- 고객 화면의 조건은 그대로다: 성인 인증을 마친 사람에게만 판매 제한 상품이 함께 나온다.
select 1/case when public.get_good_relation_compositions('rav-a')#>'{groups,0,goodIds}'='["rav-adult","rav-b"]'::jsonb
 then 1 else 0 end as assert_storefront_shows_adult_to_verified;
select set_config('request.jwt.claim.sub','0b400000-0000-4000-8000-000000000001',true);
select 1/case when public.get_good_relation_compositions('rav-a')#>'{groups,0,goodIds}'='["rav-b"]'::jsonb
 then 1 else 0 end as assert_storefront_hides_adult_from_unverified;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select 1/case when public.get_good_relation_compositions('rav-a')#>'{groups,0,goodIds}'='["rav-b"]'::jsonb
 then 1 else 0 end as assert_storefront_hides_adult_from_anonymous;
reset role;

-- 6. 성인 상품 공개 설정을 꺼도 관리자 화면 값은 같다(고객 화면에서는 인증한 사람에게도 숨는다).
update private.adult_goods_storefront_settings set enabled=false where singleton;
set local role authenticated;
select set_config('request.jwt.claim.sub','0b400000-0000-4000-8000-000000000002',true);
select 1/case when public.admin_get_goods_relation('0b400000-0000-4000-8000-000000000101')=:'plain_document'::jsonb
 and public.admin_search_goods_for_relation('연관공개검증')=:'plain_search'::jsonb
 and public.get_good_relation_compositions('rav-a')#>'{groups,0,goodIds}'='["rav-b"]'::jsonb
 then 1 else 0 end as assert_storefront_switch_ignored_by_admin_readback;

-- 7. 운영자가 아니면 두 조회 모두 거절한다.
select set_config('request.jwt.claim.sub','0b400000-0000-4000-8000-000000000003',true);
do $$ begin
 begin perform public.admin_get_goods_relation('0b400000-0000-4000-8000-000000000101'); raise exception 'member read allowed'; exception when insufficient_privilege then null; end;
 begin perform public.admin_search_goods_for_relation('연관공개검증'); raise exception 'member search allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 8. 저장 감사 기록의 문서도 같은 판정이다.
select 1/case when (select diff#>>'{after,goods,1,visibility}'='restricted' and (diff#>>'{after,goods,1,public}')::boolean
  from public.audit_log where id='0b400000-0000-4000-8000-000000000201') then 1 else 0 end as assert_audit_document_visibility;
rollback;
