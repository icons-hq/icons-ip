\set ON_ERROR_STOP on
-- L8b (#574, CL-09·CH-10): collection_banner and search_terms curation kinds.
-- Declarative ACL assertions (CI mixes Postgres builds), save-path validation,
-- normalization, artwork claims, public visibility and constraint coverage.
begin;
load 'safeupdate';
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected error: %',expected;end $$;
create function pg_temp.save(op uuid,id uuid,kind text,title text,image text,link text,slot text,payload jsonb,
 enabled boolean default true,starts timestamptz default '2026-01-01',ends timestamptz default null,version timestamptz default null)
returns uuid language sql as $$select public.admin_save_home_curation(op,id,kind,null,title,image,link,0,starts,ends,enabled,slot,payload,version)$$;

-- Helpers are sealed: no application role can execute them.
select 1/case when bool_and(not has_function_privilege(r,p,'execute')) then 1 else 0 end as validators_sealed
 from unnest(array['anon','authenticated','service_role'])r cross join unnest(array[
 'private.is_valid_home_collection_banner(text,jsonb)','private.is_valid_home_search_terms(text,jsonb)',
 'private.save_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb,timestamptz,boolean)'])p;
select 1/case when has_function_privilege('authenticated','public.admin_save_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb,timestamptz)','execute')
 and not has_function_privilege('anon','public.admin_save_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamptz,timestamptz,boolean,text,jsonb,timestamptz)','execute')
 then 1 else 0 end as wrapper_acl_unchanged;
select 1/case when exists(select 1 from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature)
 where c.signature='public.admin_save_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamp with time zone,timestamp with time zone,boolean,text,jsonb,timestamp with time zone)'
 and c.body_md5=md5(p.prosrc) and c.capability='store.manage') then 1 else 0 end as wrapper_contract_current;
select 1/case when exists(select 1 from private.operator_internal_contracts where signature='private.save_home_curation(uuid,uuid,text,text,text,text,text,integer,timestamp with time zone,timestamp with time zone,boolean,text,jsonb,timestamp with time zone,boolean)')
 then 1 else 0 end as core_contract_registered;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('97400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','collection-banner-'||n||'@example.test',now(),'{}','{}' from generate_series(1,2)n;
update public.profiles set role='staff' where id::text like '97400000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values
 ('97400000-0000-4000-8000-000000000001','primary'),('97400000-0000-4000-8000-000000000002','logistics');
update private.operator_access_state set configured=true where id;
insert into public.admin_artwork_upload_claims(path,actor_id,kind,mime_type,source_size,final_size,status,expires_at,processing_started_at,verified_at)
 select 'catalog/curation/97410000-0000-4000-8000-'||lpad(n::text,12,'0')||'.webp','97400000-0000-4000-8000-000000000001','curation','image/webp',1024,1024,'verified',now()+interval '1 hour',now(),now() from generate_series(1,8)n;

select set_config('request.jwt.claim.sub','97400000-0000-4000-8000-000000000001',true);
set local role authenticated;

-- 1. A goods-shop slide with every optional field round-trips normalized.
select pg_temp.save('97400000-0000-4000-8000-000000000101','97420000-0000-4000-8000-000000000001','collection_banner',
 '가을 신상 굿즈','public-media/catalog/curation/97410000-0000-4000-8000-000000000001.webp','/shop/new','all',
 jsonb_build_object('subtitle','  새로 나온 굿즈를 만나보세요  ','image_alt','  리락쿠마 피크닉 키링 세 종  ',
  'mobile_image_path','public-media/catalog/curation/97410000-0000-4000-8000-000000000002.webp','image_dim','none','text_color','black'));
select 1/case when slot='all' and link_path='/shop/new' and payload->>'subtitle'='새로 나온 굿즈를 만나보세요'
 and payload->>'image_alt'='리락쿠마 피크닉 키링 세 종' and payload->>'text_color'='black' then 1 else 0 end as banner_roundtrip
 from public.home_curations where id='97420000-0000-4000-8000-000000000001';
-- A banner without link or payload is valid (title + PC artwork only).
select pg_temp.save('97400000-0000-4000-8000-000000000102','97420000-0000-4000-8000-000000000002','collection_banner',
 'BEST 아이템','public-media/catalog/curation/97410000-0000-4000-8000-000000000003.webp',null,'best',null);
reset role;
select 1/case when count(*)=3 then 1 else 0 end as banner_artwork_claims_consumed from public.admin_artwork_upload_claims
 where path in ('catalog/curation/97410000-0000-4000-8000-000000000001.webp','catalog/curation/97410000-0000-4000-8000-000000000002.webp',
  'catalog/curation/97410000-0000-4000-8000-000000000003.webp') and status='attached';
set local role authenticated;

-- 2. Banner validation: slot, artwork, copy limits, payload whitelist, style.
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'collection_banner','배너','public-media/catalog/curation/97410000-0000-4000-8000-000000000004.webp',null,null,null)$q$,'invalid_curation_slot');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'collection_banner','배너','public-media/catalog/curation/97410000-0000-4000-8000-000000000004.webp',null,'category',null)$q$,'invalid_curation_slot');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'collection_banner','배너',null,null,'new',null)$q$,'curation_image_required');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'collection_banner',repeat('가',41),'public-media/catalog/curation/97410000-0000-4000-8000-000000000004.webp',null,'new',null)$q$,'invalid_curation_title');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'collection_banner',E'두 줄\n제목','public-media/catalog/curation/97410000-0000-4000-8000-000000000004.webp',null,'new',null)$q$,'invalid_curation_title');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'collection_banner','배너','public-media/catalog/curation/97410000-0000-4000-8000-000000000004.webp',null,'new',jsonb_build_object('subtitle',repeat('가',81)))$q$,'invalid_curation_collection_banner');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'collection_banner','배너','public-media/catalog/curation/97410000-0000-4000-8000-000000000004.webp',null,'new',jsonb_build_object('image_alt',repeat('가',101)))$q$,'invalid_curation_collection_banner');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'collection_banner','배너','public-media/catalog/curation/97410000-0000-4000-8000-000000000004.webp',null,'new','{"image_alt":7}')$q$,'invalid_curation_collection_banner');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'collection_banner','배너','public-media/catalog/curation/97410000-0000-4000-8000-000000000004.webp',null,'new','{"text_color":"pink"}')$q$,'invalid_curation_collection_banner');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'collection_banner','배너','public-media/catalog/curation/97410000-0000-4000-8000-000000000004.webp',null,'new','{"badge":"NEW"}')$q$,'invalid_curation_payload');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'collection_banner','배너','public-media/catalog/curation/97410000-0000-4000-8000-000000000004.webp','//evil.test','new',null)$q$,'invalid_curation_link_path');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'collection_banner','배너','/generated/banner.webp',null,'new',null)$q$,'invalid_curation_image_path');
-- Artwork without this actor's verified claim is refused (#112 contract).
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'collection_banner','배너','public-media/catalog/curation/97410000-0000-4000-8000-000000000099.webp',null,'new',null)$q$,'unverified_artwork');
-- Other kinds still cannot carry hero style keys or a collection slot.
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'editor_pick','추천','public-media/catalog/curation/97410000-0000-4000-8000-000000000004.webp','/shop','all',null)$q$,'invalid_curation_slot');

-- 3. Search terms: normalization, limits, duplicates and the text-only shape.
select pg_temp.save('97400000-0000-4000-8000-000000000201','97420000-0000-4000-8000-000000000011','search_terms',
 '10월 추천 검색어',null,null,null,jsonb_build_object('terms',jsonb_build_array('  리락쿠마 ',E'키링\t 세트','100%_굿즈','BT21')));
select 1/case when payload->'terms'='["리락쿠마","키링 세트","100%_굿즈","BT21"]'::jsonb and image_path is null and link_path is null and slot is null
 then 1 else 0 end as terms_normalized from public.home_curations where id='97420000-0000-4000-8000-000000000011';
select pg_temp.save('97400000-0000-4000-8000-000000000202','97420000-0000-4000-8000-000000000012','search_terms',
 '열 개',null,null,null,jsonb_build_object('terms',(select jsonb_agg('검색어'||n) from generate_series(1,10)n)));
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'search_terms','열한 개',null,null,null,jsonb_build_object('terms',(select jsonb_agg('검색어'||n) from generate_series(1,11)n)))$q$,'invalid_curation_search_terms');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'search_terms','빈 목록',null,null,null,'{"terms":[]}')$q$,'invalid_curation_search_terms');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'search_terms','목록 없음',null,null,null,null)$q$,'invalid_curation_search_terms');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'search_terms','긴 검색어',null,null,null,jsonb_build_object('terms',jsonb_build_array(repeat('가',21))))$q$,'invalid_curation_search_terms');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'search_terms','중복',null,null,null,'{"terms":["BT21"," bt21 "]}')$q$,'invalid_curation_search_terms');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'search_terms','숫자',null,null,null,'{"terms":[21]}')$q$,'invalid_curation_search_terms');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'search_terms','제어',null,null,null,jsonb_build_object('terms',jsonb_build_array(E'키\u0001링')))$q$,'invalid_curation_search_terms');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'search_terms','다른 키',null,null,null,'{"terms":["키링"],"badge":"x"}')$q$,'invalid_curation_payload');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'search_terms','링크',null,'/search',null,'{"terms":["키링"]}')$q$,'invalid_curation_link_path');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'search_terms','이미지','public-media/catalog/curation/97410000-0000-4000-8000-000000000005.webp',null,null,'{"terms":["키링"]}')$q$,'invalid_curation_search_terms');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'search_terms','슬롯',null,null,'all','{"terms":["키링"]}')$q$,'invalid_curation_slot');
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'search_terms',repeat('가',41),null,null,null,'{"terms":["키링"]}')$q$,'invalid_curation_title');

-- 4. Exact replay returns the same row; a changed request with the same
--    operation id is a conflict (shared receipt contract).
select 1/case when pg_temp.save('97400000-0000-4000-8000-000000000201','97420000-0000-4000-8000-000000000011','search_terms',
 '10월 추천 검색어',null,null,null,jsonb_build_object('terms',jsonb_build_array('  리락쿠마 ',E'키링\t 세트','100%_굿즈','BT21')))
 ='97420000-0000-4000-8000-000000000011' then 1 else 0 end as exact_replay_is_idempotent;
select pg_temp.expect_error($q$select pg_temp.save('97400000-0000-4000-8000-000000000201','97420000-0000-4000-8000-000000000011','search_terms','다른 이름',null,null,null,'{"terms":["키링"]}')$q$,'operation_conflict');

-- 5. Capability: an operator without store.manage cannot save either kind.
reset role;
select set_config('request.jwt.claim.sub','97400000-0000-4000-8000-000000000002',true);
set local role authenticated;
select pg_temp.expect_error($q$select pg_temp.save(gen_random_uuid(),gen_random_uuid(),'search_terms','권한 없음',null,null,null,'{"terms":["키링"]}')$q$,'operator_capability_required');
reset role;

-- 6. Public visibility follows enabled + window like every curation.
select set_config('request.jwt.claim.sub','97400000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.save('97400000-0000-4000-8000-000000000203','97420000-0000-4000-8000-000000000013','search_terms',
 '비노출 목록',null,null,null,'{"terms":["숨김"]}',false);
select pg_temp.save('97400000-0000-4000-8000-000000000204','97420000-0000-4000-8000-000000000014','search_terms',
 '예약 목록',null,null,null,'{"terms":["예약"]}',true,now()+interval '1 day');
reset role;
set local role anon;
select 1/case when count(*) filter (where id='97420000-0000-4000-8000-000000000011')=1
 and count(*) filter (where id in ('97420000-0000-4000-8000-000000000013','97420000-0000-4000-8000-000000000014'))=0
 and count(*) filter (where id='97420000-0000-4000-8000-000000000001')=1
 then 1 else 0 end as anon_reads_only_live_rows from public.home_curations where id::text like '97420000-%';
reset role;

-- 7. The table constraints hold even for direct writes that bypass the RPC.
select pg_temp.expect_error($q$insert into public.home_curations(id,kind,title,image_path,slot,active_from,payload) values(gen_random_uuid(),'collection_banner','직접','public-media/catalog/curation/97410000-0000-4000-8000-000000000006.webp','best',now(),'{"subtitle":"   "}')$q$,'23514');
select pg_temp.expect_error($q$insert into public.home_curations(id,kind,title,image_path,slot,active_from) values(gen_random_uuid(),'collection_banner','직접','public-media/catalog/curation/97410000-0000-4000-8000-000000000006.webp',null,now())$q$,'23514');
select pg_temp.expect_error($q$insert into public.home_curations(id,kind,title,active_from,payload) values(gen_random_uuid(),'search_terms','직접',now(),'{"terms":["a","A"]}')$q$,'23514');
select pg_temp.expect_error($q$insert into public.home_curations(id,kind,title,link_path,active_from,payload) values(gen_random_uuid(),'search_terms','직접','/shop',now(),'{"terms":["a"]}')$q$,'23514');
select pg_temp.expect_error($q$insert into public.home_curations(id,kind,title,image_path,link_path,active_from,payload) values(gen_random_uuid(),'editor_pick','직접','public-media/catalog/curation/97410000-0000-4000-8000-000000000006.webp','/shop',now(),'{"text_color":"black"}')$q$,'23514');
-- Existing kinds are unaffected: a best_tab slot and a hero without link still pass.
select 1/case when not exists(select 1 from public.home_curations where not (
 (kind='best_tab' and slot in ('category','popular')) or (kind='collection_banner' and slot in ('all','best','new'))
 or (kind not in ('best_tab','collection_banner') and slot is null))) then 1 else 0 end as slot_rule_holds;
select 1/case when (select count(*) from public.audit_log where actor_id='97400000-0000-4000-8000-000000000001' and action='admin.home_curation.upserted')=6
 then 1 else 0 end as each_save_audited_once;
rollback;
