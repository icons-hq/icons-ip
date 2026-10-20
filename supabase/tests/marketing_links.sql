\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql; fixtures use real KC review gates.
begin;
create function pg_temp.expect_link_error(q text,expected text) returns void language plpgsql as $$
begin begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;raise exception 'expected error: %',expected;end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('86000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','marketing-link-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,6) n;
update public.profiles set role=case when right(id::text,1)='6' then 'user'::public.user_role else 'staff'::public.user_role end,
 nickname='link-test-'||right(id::text,3),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id::text like '86000000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values
 ('86000000-0000-4000-8000-000000000001','primary'),('86000000-0000-4000-8000-000000000002','deputy'),
 ('86000000-0000-4000-8000-000000000003','influencer'),('86000000-0000-4000-8000-000000000004','agency'),('86000000-0000-4000-8000-000000000005','logistics');
insert into public.ips(id,title,vertical_key,published_at,public_slug) select 'marketing-test-ip','마케팅 합성 IP',key,now(),'marketing-test-ip' from public.verticals limit 1;
insert into public.goods(id,ip_id,name,type,price,published_at) values
 ('marketing-test-good','marketing-test-ip','마케팅 합성 상품','문구',1000,null),('marketing-test-soldout','marketing-test-ip','품절 합성 상품','문구',1000,null),
 ('marketing-test-draft','marketing-test-ip','초안 합성 상품','문구',1000,null),('marketing-test-delete','marketing-test-ip','삭제 합성 상품','문구',1000,null);
-- Configure each deterministic KC fixture reviewer without broadening legacy access.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(good_id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(good_id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}',now(),now()
 from unnest(array['marketing-test-good','marketing-test-soldout','marketing-test-delete','marketing-test-renamed'])good_id;
update public.profiles set role='staff' where id in(select ('47c47700'||left(md5(good_id),24))::uuid from unnest(array['marketing-test-good','marketing-test-soldout','marketing-test-delete','marketing-test-renamed'])good_id);
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(good_id),24))::uuid,'primary' from unnest(array['marketing-test-good','marketing-test-soldout','marketing-test-delete','marketing-test-renamed'])good_id;
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in('marketing-test-good','marketing-test-soldout','marketing-test-delete');
update public.goods set stock='soldout',stock_qty=0 where id='marketing-test-soldout';
insert into public.shopping_stories(id,title,body_html) values('86000000-0000-4000-8000-000000000101','공개 합성 스토리','<p>합성 본문</p>'),('86000000-0000-4000-8000-000000000102','권한 합성 스토리','<p>합성 본문</p>');
insert into public.catalog_categories(id,code,name) values('86000000-0000-4000-8000-000000000201','marketing-test-parent','마케팅 부모');
insert into public.catalog_categories(id,code,name,parent_id,depth) values('86000000-0000-4000-8000-000000000202','marketing-test-child','마케팅 하위','86000000-0000-4000-8000-000000000201',2);
update public.category_activation_control set customer_enabled=true where id='catalog';
select 1/case when not has_table_privilege('anon','private.marketing_links','select') and not has_table_privilege('authenticated','private.marketing_links','insert')
 and not has_table_privilege('service_role','private.marketing_links','update') and not has_function_privilege('anon','public.admin_issue_marketing_links(text,text[],uuid)','execute')
 and not has_function_privilege('service_role','public.admin_list_marketing_links(text,text,text,integer,integer)','execute')
 and has_function_privilege('anon','public.resolve_marketing_link(text)','execute')
 and not has_function_privilege('authenticated','private.marketing_link_rows(uuid[])','execute') then 1 else 0 end as sealed_acl;
select set_config('request.jwt.claim.sub','86000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.expect_link_error($q$select public.admin_issue_marketing_links('good',array[]::text[],'86000000-0000-4000-8000-000000000301')$q$,'invalid_marketing_targets');
select pg_temp.expect_link_error($q$select public.admin_issue_marketing_links('good',array['marketing-test-good','marketing-test-good'],'86000000-0000-4000-8000-000000000301')$q$,'invalid_marketing_targets');
select pg_temp.expect_link_error($q$select public.admin_issue_marketing_links('good',(select array_agg('item-'||n) from generate_series(1,101)n),'86000000-0000-4000-8000-000000000301')$q$,'invalid_marketing_targets');
select pg_temp.expect_link_error($q$select public.admin_issue_marketing_links('story',array['https://evil.test'],'86000000-0000-4000-8000-000000000301')$q$,'invalid_marketing_targets');
select pg_temp.expect_link_error($q$select public.admin_issue_marketing_links('good',array['marketing-test-good','marketing-missing'],'86000000-0000-4000-8000-000000000301')$q$,'marketing_target_missing');
reset role;
select 1/case when not exists(select 1 from private.marketing_links where good_id='marketing-test-good') then 1 else 0 end as failed_batch_is_atomic;
set local role authenticated;
select public.admin_issue_marketing_links('good',array['marketing-test-good','marketing-test-soldout','marketing-test-draft','marketing-test-delete'],'86000000-0000-4000-8000-000000000302') as issued \gset
select 1/case when public.admin_issue_marketing_links('good',array['marketing-test-draft','marketing-test-delete','marketing-test-soldout','marketing-test-good'],'86000000-0000-4000-8000-000000000302')=:'issued'::jsonb then 1 else 0 end as sorted_exact_retry;
select pg_temp.expect_link_error($q$select public.admin_issue_marketing_links('good',array['marketing-test-good'],'86000000-0000-4000-8000-000000000302')$q$,'operation_conflict');
select public.admin_issue_marketing_links('good',array['marketing-test-good'],'86000000-0000-4000-8000-000000000303') as same_target \gset
select public.admin_issue_marketing_links('home',array['home'],'86000000-0000-4000-8000-000000000304') as home \gset
select public.admin_issue_marketing_links('story',array['86000000-0000-4000-8000-000000000101'],'86000000-0000-4000-8000-000000000305') as story \gset
select public.admin_issue_marketing_links('category',array['86000000-0000-4000-8000-000000000202'],'86000000-0000-4000-8000-000000000306') as category \gset
select 1/case when public.admin_list_marketing_links('good','마케팅 합성')->>'total'='1' and public.admin_list_marketing_links('good','합성','unavailable')->>'total'='1' then 1 else 0 end as ledger_search_and_availability;
reset role;
select token as good_token from private.marketing_links where good_id='marketing-test-good' \gset
select token as soldout_token from private.marketing_links where good_id='marketing-test-soldout' \gset
select token as draft_token from private.marketing_links where good_id='marketing-test-draft' \gset
select token as delete_token from private.marketing_links where good_id='marketing-test-delete' \gset
select token as story_token from private.marketing_links where story_id='86000000-0000-4000-8000-000000000101' \gset
select token as category_token from private.marketing_links where category_id='86000000-0000-4000-8000-000000000202' \gset
select 1/case when (select count(*) from private.marketing_links where good_id='marketing-test-good')=1 and :'same_target'::jsonb#>>'{rows,0,token}'=:'good_token' then 1 else 0 end as one_token_per_target;
set local role anon;
select 1/case when public.resolve_marketing_link(:'good_token')->>'targetId'='marketing-test-good'
 and public.resolve_marketing_link(:'soldout_token') is not null and public.resolve_marketing_link(:'draft_token') is null
 and public.resolve_marketing_link(:'story_token')->>'source'='story' and public.resolve_marketing_link(:'category_token')->>'source'='category'
 and public.resolve_marketing_link('https://evil.test') is null then 1 else 0 end as anonymous_safe_projection;
reset role;
select pg_temp.expect_link_error($q$update public.goods set id='marketing-test-forbidden' where id='marketing-test-good'$q$,'goods_slug_locked');
update public.goods set id='marketing-test-renamed' where id='marketing-test-draft';
select pg_temp.publish_goods_kc_fixture('marketing-test-renamed');
select 1/case when public.resolve_marketing_link(:'draft_token')->>'targetId'='marketing-test-renamed' then 1 else 0 end as draft_renaming_preserves_target;
update public.goods set archived_at=now() where id='marketing-test-good';
select 1/case when public.resolve_marketing_link(:'good_token') is null then 1 else 0 end as archive_closes_link;
update public.goods set archived_at=null where id='marketing-test-good';
select pg_temp.publish_goods_kc_fixture('marketing-test-good');
select 1/case when public.resolve_marketing_link(:'good_token') is not null then 1 else 0 end as restore_reopens_same_link;
update public.goods set sale_restriction='adult' where id='marketing-test-good';
select 1/case when public.resolve_marketing_link(:'good_token') is null then 1 else 0 end as adult_is_private;
update public.goods set sale_restriction='none' where id='marketing-test-good';
update public.ips set published_at=null where id='marketing-test-ip';
select 1/case when public.resolve_marketing_link(:'good_token') is null then 1 else 0 end as parent_draft_is_private;
update public.goods set archived_at=now() where ip_id='marketing-test-ip';
update public.ips set published_at=now(),archived_at=now() where id='marketing-test-ip';
select 1/case when public.resolve_marketing_link(:'good_token') is null then 1 else 0 end as parent_archive_is_private;
update public.ips set archived_at=null where id='marketing-test-ip';
update public.goods set archived_at=null where id='marketing-test-good';
select pg_temp.publish_goods_kc_fixture('marketing-test-good');
update public.shopping_stories set starts_at=statement_timestamp()+interval '1 day' where id='86000000-0000-4000-8000-000000000101';
select 1/case when public.resolve_marketing_link(:'story_token') is null then 1 else 0 end as future_story_is_private;
update public.shopping_stories set starts_at=null,ends_at=statement_timestamp() where id='86000000-0000-4000-8000-000000000101';
select 1/case when public.resolve_marketing_link(:'story_token') is null then 1 else 0 end as end_boundary_is_private;
update public.shopping_stories set ends_at=null where id='86000000-0000-4000-8000-000000000101';
select 1/case when public.resolve_marketing_link(:'story_token') is not null then 1 else 0 end as restored_window_reuses_token;
update public.shopping_stories set deleted_at=now() where id='86000000-0000-4000-8000-000000000101';
select 1/case when public.resolve_marketing_link(:'story_token') is null then 1 else 0 end as deleted_story_is_private;
update public.catalog_categories set archived_at=now() where id='86000000-0000-4000-8000-000000000201';
select 1/case when public.resolve_marketing_link(:'category_token') is null then 1 else 0 end as ancestor_archive_closes_category;
update public.catalog_categories set archived_at=null where id='86000000-0000-4000-8000-000000000201';
update public.category_activation_control set customer_enabled=false where id='catalog';
select 1/case when public.resolve_marketing_link(:'category_token') is null then 1 else 0 end as category_global_gate;
update public.category_activation_control set customer_enabled=true where id='catalog';
select 1/case when public.resolve_marketing_link(:'category_token') is not null then 1 else 0 end as category_reactivation;
select pg_temp.cleanup_goods_kc_fixture('marketing-test-delete');
delete from public.goods where id='marketing-test-delete';
insert into public.goods(id,ip_id,name,type,price,published_at) values('marketing-test-delete','marketing-test-ip','새 합성 상품','문구',1000,null);
select 1/case when public.resolve_marketing_link(:'delete_token') is null then 1 else 0 end as deleted_identity_never_rebinds;
-- All three source managers may issue but may not read the integrated ledger.
set local role authenticated;
do $$ declare n integer; begin for n in 2..4 loop
 perform set_config('request.jwt.claim.sub','86000000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
 perform public.admin_issue_marketing_links('good',array['marketing-test-good'],gen_random_uuid());
 perform public.admin_issue_marketing_links('home',array['home'],gen_random_uuid());
 perform public.admin_issue_marketing_links('story',array['86000000-0000-4000-8000-000000000102'],gen_random_uuid());
 perform public.admin_issue_marketing_links('category',array['86000000-0000-4000-8000-000000000202'],gen_random_uuid());
 perform pg_temp.expect_link_error('select public.admin_list_marketing_links()','operator_capability_required');
 end loop;end $$;
select set_config('request.jwt.claim.sub','86000000-0000-4000-8000-000000000005',true);
select pg_temp.expect_link_error($q$select public.admin_issue_marketing_links('good',array['marketing-test-good'],gen_random_uuid())$q$,'operator_capability_required');
select pg_temp.expect_link_error($q$select public.admin_issue_marketing_links('home',array['home'],gen_random_uuid())$q$,'operator_capability_required');
select pg_temp.expect_link_error($q$select public.admin_issue_marketing_links('story',array['86000000-0000-4000-8000-000000000102'],gen_random_uuid())$q$,'operator_capability_required');
select pg_temp.expect_link_error($q$select public.admin_issue_marketing_links('category',array['86000000-0000-4000-8000-000000000202'],gen_random_uuid())$q$,'operator_capability_required');
select set_config('request.jwt.claim.sub','86000000-0000-4000-8000-000000000006',true);
select pg_temp.expect_link_error('select public.admin_list_marketing_links()','operator_capability_required');
select pg_temp.expect_link_error($q$select public.admin_issue_marketing_links('good',array['marketing-test-good'],gen_random_uuid())$q$,'operator_capability_required');
reset role;
update public.profiles set suspended_at=now(),suspension_reason='합성 권한 검수' where id='86000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','86000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.expect_link_error($q$select public.admin_issue_marketing_links('good',array['marketing-test-good'],gen_random_uuid())$q$,'operator_capability_required');
reset role;
rollback;
