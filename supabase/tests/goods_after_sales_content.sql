\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql. All synthetic content and audits roll back.
begin;
load 'safeupdate';
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_as_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected after-sales error: %',expected;end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('94000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','after-sales-content-'||n||'@example.test',now(),'{}','{}' from generate_series(1,3)n;
update public.profiles set role='staff' where id::text like '94000000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values('94000000-0000-4000-8000-000000000001','primary'),('94000000-0000-4000-8000-000000000002','deputy'),('94000000-0000-4000-8000-000000000003','logistics');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key,published_at) values('after-sales-content-ip','A/S 검증 합성 IP','character',now());
insert into public.goods(id,ip_id,name,type,price,notice_as_contact,notice_as_manager) values
 ('after-sales-content-good','after-sales-content-ip','A/S 검증 합성 상품','문구',1000,'법정 고시 연락처','법정 고시 책임자'),
 ('after-sales-content-empty','after-sales-content-ip','A/S 없는 합성 상품','문구',1000,null,null);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}' from public.goods where id='after-sales-content-good';
update public.profiles set role='staff' where id=(select ('47c47700'||left(md5(id),24))::uuid from public.goods where id='after-sales-content-good');
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id='after-sales-content-good';
select pg_temp.publish_goods_kc_fixture('after-sales-content-good');
select 1/case when not exists(
 select 1 from pg_class c cross join unnest(array['anon','authenticated','service_role']) role_name
 where c.oid in ('private.goods_after_sales_content'::regclass,'private.goods_after_sales_templates'::regclass)
 and (not c.relrowsecurity or has_table_privilege(role_name,c.oid,'select,insert,update,delete,truncate,references,trigger'))
) and not exists(
 select 1 from pg_proc p cross join unnest(array['anon','authenticated','service_role']) role_name
 where p.oid in ('private.goods_after_sales_document(text)'::regprocedure,'private.validate_goods_after_sales_values(jsonb,boolean)'::regprocedure,'private.clone_goods_after_sales_content(text,text,uuid)'::regprocedure)
 and has_function_privilege(role_name,p.oid,'execute')
) then 1 else 0 end as private_rls_and_all_untrusted_acl_sealed;
select 1/case when not has_function_privilege('anon','public.admin_get_goods_after_sales_content(text)','execute')
 and not has_function_privilege('service_role','public.admin_save_goods_after_sales_content(text,integer,uuid,jsonb)','execute') then 1 else 0 end as public_admin_acl_sealed;
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select 1/case when public.admin_get_goods_after_sales_content('after-sales-content-good')->>'revision'='0' then 1 else 0 end as absent_has_revision_zero;
select public.admin_save_goods_after_sales_content('after-sales-content-good',0,'94000000-0000-4000-8000-000000000101','{"phone":"02-123-4567","guide":"A/S 안내","sellerSpecialNotes":"판매자 특이사항"}') as saved \gset
select 1/case when public.admin_save_goods_after_sales_content('after-sales-content-good',0,'94000000-0000-4000-8000-000000000101','{"phone":"02-123-4567","guide":"A/S 안내","sellerSpecialNotes":"판매자 특이사항"}')=:'saved'::jsonb then 1 else 0 end as exact_replay;
select pg_temp.expect_as_error($q$select public.admin_save_goods_after_sales_content('after-sales-content-good',0,'94000000-0000-4000-8000-000000000101','{"phone":"02-123-4567","guide":"변경","sellerSpecialNotes":""}')$q$,'operation_conflict');
select pg_temp.expect_as_error($q$select public.admin_save_goods_after_sales_content('after-sales-content-good',0,gen_random_uuid(),'{"phone":"02-123-4567","guide":"변경","sellerSpecialNotes":""}')$q$,'goods_after_sales_changed');
select public.admin_clone_good('94000000-0000-4000-8000-000000000201','after-sales-content-good','after-sales-content-clone','AS-COPY','A/S 복사 합성');
select public.admin_clone_good('94000000-0000-4000-8000-000000000201','after-sales-content-good','after-sales-content-clone','AS-COPY','A/S 복사 합성');
select public.admin_clone_good('94000000-0000-4000-8000-000000000202','after-sales-content-empty','after-sales-content-empty-clone','AS-NONE','A/S 없는 복사');
select 1/case when public.admin_get_goods_after_sales_content('after-sales-content-empty-clone')->>'revision'='0' and public.admin_get_goods_after_sales_content('after-sales-content-clone')->>'revision'='1' and public.admin_get_goods_after_sales_content('after-sales-content-clone')->>'sellerSpecialNotes'='판매자 특이사항' then 1 else 0 end as clone_with_or_without_content;
reset role;
select 1/case when (select count(*) from public.audit_log where id='94000000-0000-4000-8000-000000000201')=1
 and (select notice_as_contact='법정 고시 연락처' and notice_as_manager='법정 고시 책임자' from public.goods where id='after-sales-content-good') then 1 else 0 end as clone_once_and_statutory_notice_untouched;
set local role anon;
select 1/case when public.get_good_after_sales_content('after-sales-content-good')='{"phone":"02-123-4567","guide":"A/S 안내","sellerSpecialNotes":"판매자 특이사항"}'::jsonb then 1 else 0 end as public_projects_information_only;
reset role;
update public.goods set published_at=null where id='after-sales-content-good';
set local role anon;
select 1/case when public.get_good_after_sales_content('after-sales-content-good') is null then 1 else 0 end as unpublished_good_hidden;
reset role;
update public.goods set published_at=now() where id='after-sales-content-good';
update public.ips set published_at=null where id='after-sales-content-ip';
set local role anon;
select 1/case when public.get_good_after_sales_content('after-sales-content-good') is null then 1 else 0 end as unpublished_ip_hidden;
reset role;
update public.ips set published_at=now() where id='after-sales-content-ip';
update public.goods set sale_restriction='adult' where id='after-sales-content-good';
set local role anon;
select 1/case when public.get_good_after_sales_content('after-sales-content-good') is null then 1 else 0 end as restricted_good_hidden;
reset role;
update public.goods set sale_restriction='none',archived_at=now() where id='after-sales-content-good';
set local role anon;
select 1/case when public.get_good_after_sales_content('after-sales-content-good') is null then 1 else 0 end as archived_good_hidden;
reset role;
update public.goods set archived_at=now() where ip_id='after-sales-content-ip' and archived_at is null;
update public.ips set archived_at=now() where id='after-sales-content-ip';
set local role anon;
select 1/case when public.get_good_after_sales_content('after-sales-content-good') is null then 1 else 0 end as archived_ip_hidden;
reset role;
update public.ips set archived_at=null where id='after-sales-content-ip';
update public.goods set archived_at=null where ip_id='after-sales-content-ip';
set local role authenticated;
select public.admin_save_goods_after_sales_content('after-sales-content-good',1,gen_random_uuid(),jsonb_build_object('phone',repeat('가',20),'guide',repeat('😀',1300),'sellerSpecialNotes',repeat('나',1300)));
select 1/case when char_length(public.admin_get_goods_after_sales_content('after-sales-content-good')->>'phone')=20 and char_length(public.admin_get_goods_after_sales_content('after-sales-content-good')->>'guide')=1300 and char_length(public.admin_get_goods_after_sales_content('after-sales-content-good')->>'sellerSpecialNotes')=1300 then 1 else 0 end as unicode_boundaries;
select pg_temp.expect_as_error($q$select public.admin_save_goods_after_sales_content('after-sales-content-good',2,gen_random_uuid(),jsonb_build_object('phone',repeat('가',21),'guide','안내','sellerSpecialNotes',''))$q$,'invalid_goods_after_sales');
select pg_temp.expect_as_error($q$select public.admin_save_goods_after_sales_content('after-sales-content-good',2,gen_random_uuid(),jsonb_build_object('phone','02','guide',repeat('😀',1301),'sellerSpecialNotes',''))$q$,'invalid_goods_after_sales');
select pg_temp.expect_as_error($q$select public.admin_save_goods_after_sales_content('after-sales-content-good',2,gen_random_uuid(),jsonb_build_object('phone','02','guide','안내','sellerSpecialNotes',repeat('가',1301)))$q$,'invalid_goods_after_sales');
select pg_temp.expect_as_error($q$select public.admin_save_goods_after_sales_content('after-sales-content-good',2,gen_random_uuid(),'{"phone":"02","guide":"","sellerSpecialNotes":""}')$q$,'invalid_goods_after_sales');
select pg_temp.expect_as_error($q$select public.admin_save_goods_after_sales_content('after-sales-content-good',2,gen_random_uuid(),'{"phone":"","guide":"","sellerSpecialNotes":"메모만"}')$q$,'invalid_goods_after_sales');
select pg_temp.expect_as_error($q$select public.admin_save_goods_after_sales_content('after-sales-content-good',2,gen_random_uuid(),'{"phone":"02","guide":null,"sellerSpecialNotes":""}')$q$,'invalid_goods_after_sales');
select pg_temp.expect_as_error($q$select public.admin_save_goods_after_sales_content('after-sales-content-good',2,gen_random_uuid(),'{"phone":"02","guide":"안내","sellerSpecialNotes":"","notice_as_contact":"덮어쓰기"}')$q$,'invalid_goods_after_sales');
select pg_temp.expect_as_error($q$select public.admin_save_goods_after_sales_content('after-sales-content-good',2,gen_random_uuid(),jsonb_build_object('phone','02','guide',E'안내\x01','sellerSpecialNotes',''))$q$,'invalid_goods_after_sales');
select public.admin_save_goods_after_sales_content('after-sales-content-good',2,gen_random_uuid(),jsonb_build_object('phone',' 02-123 ', 'guide',E'  안내\r\n둘째 줄\t오후  ', 'sellerSpecialNotes',E'  배송\r기간  '));
select 1/case when public.admin_get_goods_after_sales_content('after-sales-content-good')->>'phone'='02-123' and public.admin_get_goods_after_sales_content('after-sales-content-good')->>'guide'=E'안내\n둘째 줄\t오후' and public.admin_get_goods_after_sales_content('after-sales-content-good')->>'sellerSpecialNotes'=E'배송\n기간' then 1 else 0 end as normalized_multiline;
select public.admin_save_goods_after_sales_content('after-sales-content-good',3,'94000000-0000-4000-8000-000000000104','{"phone":"","guide":"","sellerSpecialNotes":""}');
select 1/case when public.admin_get_goods_after_sales_content('after-sales-content-good')->>'revision'='4' and public.admin_get_goods_after_sales_content('after-sales-content-good')->>'phone'='' then 1 else 0 end as explicit_clear_keeps_revision;
select 1/case when public.admin_save_goods_after_sales_content('after-sales-content-good',0,'94000000-0000-4000-8000-000000000101','{"phone":"02-123-4567","guide":"A/S 안내","sellerSpecialNotes":"판매자 특이사항"}')=:'saved'::jsonb and public.admin_get_goods_after_sales_content('after-sales-content-good')->>'revision'='4' then 1 else 0 end as old_replay_never_recreates_cleared_content;
select public.admin_clone_good('94000000-0000-4000-8000-000000000203','after-sales-content-good','after-sales-content-cleared-clone','AS-CLEAR','A/S 해제 복사');
select 1/case when public.admin_get_goods_after_sales_content('after-sales-content-cleared-clone')->>'phone'='' then 1 else 0 end as cleared_clone_stays_empty;
reset role;
set local role anon;
select 1/case when public.get_good_after_sales_content('after-sales-content-good') is null then 1 else 0 end as cleared_content_hidden;
reset role;
set local role authenticated;
select public.admin_save_goods_after_sales_template('94000000-0000-4000-8000-000000000301','{"phone":"02","guide":"템플릿 안내","sellerSpecialNotes":"배송 기간"}',false,0,'94000000-0000-4000-8000-000000000302') as template \gset
select 1/case when public.admin_save_goods_after_sales_template('94000000-0000-4000-8000-000000000301','{"phone":"02","guide":"템플릿 안내","sellerSpecialNotes":"배송 기간"}',false,0,'94000000-0000-4000-8000-000000000302')=:'template'::jsonb then 1 else 0 end as template_exact_replay;
select public.admin_save_goods_after_sales_template('94000000-0000-4000-8000-000000000301','{"phone":"02","guide":"템플릿 안내","sellerSpecialNotes":"배송 기간"}',true,1,'94000000-0000-4000-8000-000000000303');
select 1/case when public.admin_list_goods_after_sales_templates('배송 기간',false,1)->>'total'='0' and public.admin_list_goods_after_sales_templates('배송 기간',true,1)->>'total'='1' then 1 else 0 end as template_archive_search;
select public.admin_save_goods_after_sales_template('94000000-0000-4000-8000-000000000301','{"phone":"02","guide":"템플릿 복구","sellerSpecialNotes":"배송 기간"}',false,2,'94000000-0000-4000-8000-000000000304');
select 1/case when public.admin_list_goods_after_sales_templates('템플릿 복구',false,1)#>>'{rows,0,revision}'='3' and public.admin_get_goods_after_sales_content('after-sales-content-good')->>'phone'='' then 1 else 0 end as template_restore_does_not_touch_goods;
select pg_temp.expect_as_error($q$select public.admin_save_goods_after_sales_template('94000000-0000-4000-8000-000000000301','{"phone":"02","guide":"템플릿 안내","sellerSpecialNotes":""}',false,2,gen_random_uuid())$q$,'goods_after_sales_template_changed');
select pg_temp.expect_as_error($q$select public.admin_save_goods_after_sales_template(gen_random_uuid(),'{"phone":"","guide":"","sellerSpecialNotes":""}',false,0,gen_random_uuid())$q$,'invalid_goods_after_sales');
select pg_temp.expect_as_error($q$select public.admin_save_goods_after_sales_template(gen_random_uuid(),'{"phone":"02","guide":"없는 템플릿 보관","sellerSpecialNotes":""}',true,0,gen_random_uuid())$q$,'goods_after_sales_template_changed');
do $$declare n integer;begin
 for n in 1..21 loop
  perform public.admin_save_goods_after_sales_template(('94000000-0000-4000-8100-'||lpad(n::text,12,'0'))::uuid,jsonb_build_object('phone','02-'||n,'guide','A/S페이지 '||n,'sellerSpecialNotes',''),false,0,('94000000-0000-4000-8200-'||lpad(n::text,12,'0'))::uuid);
 end loop;
end$$;
select 1/case when public.admin_list_goods_after_sales_templates('A/S페이지 ',false,1)->>'total'='21'
 and jsonb_array_length(public.admin_list_goods_after_sales_templates('A/S페이지 ',false,1)->'rows')=20
 and jsonb_array_length(public.admin_list_goods_after_sales_templates('A/S페이지 ',false,2)->'rows')=1
 and (select count(distinct e->>'id') from jsonb_array_elements((public.admin_list_goods_after_sales_templates('A/S페이지 ',false,1)->'rows')||(public.admin_list_goods_after_sales_templates('A/S페이지 ',false,2)->'rows'))e)=21 then 1 else 0 end as template_server_pagination_twenty;
select pg_temp.expect_as_error($q$select public.admin_list_goods_after_sales_templates('',false,0)$q$,'invalid_after_sales_template_search');
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000002',true);
select pg_temp.expect_as_error($q$select public.admin_save_goods_after_sales_template('94000000-0000-4000-8000-000000000301','{"phone":"02","guide":"템플릿 안내","sellerSpecialNotes":"배송 기간"}',false,0,'94000000-0000-4000-8000-000000000302')$q$,'operation_conflict');
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000003',true);
select pg_temp.expect_as_error($q$select public.admin_get_goods_after_sales_content('after-sales-content-good')$q$,'operator_capability_required');
select pg_temp.expect_as_error($q$select public.admin_list_goods_after_sales_templates()$q$,'operator_capability_required');
select pg_temp.expect_as_error($q$select public.admin_save_goods_after_sales_content('after-sales-content-good',4,gen_random_uuid(),'{"phone":"02","guide":"권한 없음","sellerSpecialNotes":""}')$q$,'operator_capability_required');
reset role;
update private.operator_memberships set manager_role='logistics' where profile_id='94000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.expect_as_error($q$select public.admin_save_goods_after_sales_template('94000000-0000-4000-8000-000000000301','{"phone":"02","guide":"템플릿 안내","sellerSpecialNotes":"배송 기간"}',false,0,'94000000-0000-4000-8000-000000000302')$q$,'operator_capability_required');
reset role;
rollback;
