\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_draft_error(statement text,message text) returns void language plpgsql as $$
begin
 begin execute statement; exception when others then
    if sqlstate='42501' and sqlerrm='operator_capability_required' and message in ('forbidden','staff_required','staff required','staff access required','admin_required','admin required','purchase_cost_admin_required') then return;end if; if strpos(sqlerrm,message)=0 then raise; end if; return; end;
 raise exception 'Expected rejection: %',message;
end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values
 ('76000000-0000-4000-8000-000000000001','authenticated','authenticated','draft-staff1@example.test','{}','{}'),
 ('76000000-0000-4000-8000-000000000002','authenticated','authenticated','draft-staff2@example.test','{}','{}'),
 ('76000000-0000-4000-8000-000000000003','authenticated','authenticated','draft-customer@example.test','{}','{}');
update public.profiles set role='staff' where id in ('76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000002');
insert into public.ips(id,title,vertical_key) values('server-draft-qa-ip','임시저장 검증','character');
-- Verified synthetic image claims, including one shared-library image owned by staff2.
insert into public.admin_artwork_upload_claims(path,actor_id,kind,mime_type,source_size,final_size,status,expires_at,processing_started_at,verified_at)
select 'catalog/good/76000000-0000-4000-8000-'||lpad(n::text,12,'0')||'.png',
 case when n=12 then '76000000-0000-4000-8000-000000000002'::uuid else '76000000-0000-4000-8000-000000000001'::uuid end,
 'good','image/png',100,100,'verified',now()+interval '1 hour',now(),now() from generate_series(10,12) n;
select 1/case when not has_function_privilege('anon','public.admin_save_goods_draft(uuid,jsonb,integer)','execute')
 and not has_function_privilege('service_role','public.admin_get_goods_draft(uuid)','execute')
 and not has_table_privilege('authenticated','public.admin_goods_drafts','insert') then 1 else 0 end as sealed_api;
set local role authenticated;
select set_config('request.jwt.claim.sub','76000000-0000-4000-8000-000000000002',true);
select public.admin_save_goods_photo('76000000-0000-4000-8000-000000000012','public-media/catalog/good/76000000-0000-4000-8000-000000000012.png','다른 직원 공용 사진',0);
select set_config('request.jwt.claim.sub','76000000-0000-4000-8000-000000000001',true);
select public.admin_save_goods_draft('76000000-0000-4000-8000-000000000020','{"name":"미완성 임시저장","price":"미정"}',0);
select public.admin_save_goods_draft('76000000-0000-4000-8000-000000000020','{"name":"미완성 임시저장","price":"미정"}',0);
select 1/case when public.admin_get_goods_draft('76000000-0000-4000-8000-000000000020')->>'revision'='1'
 and public.admin_get_goods_draft('76000000-0000-4000-8000-000000000020')#>>'{values,price}'='미정' then 1 else 0 end as incomplete_and_retry_kept;
select pg_temp.expect_draft_error($q$select public.admin_save_goods_draft('76000000-0000-4000-8000-000000000020','{"name":"다른 입력"}',0)$q$,'goods_draft_changed');
select pg_temp.expect_draft_error($q$select public.admin_save_goods_draft('76000000-0000-4000-8000-000000000021','{"name":"민감값 차단","email":"private@example.test"}',0)$q$,'invalid_goods_draft');
select pg_temp.expect_draft_error($q$select public.admin_save_goods_draft('76000000-0000-4000-8000-000000000021','{"name":"기존 상품 차단","variantBaseline":"[\"existing\"]"}',0)$q$,'invalid_goods_draft');
select pg_temp.expect_draft_error($q$select public.admin_save_goods_draft('76000000-0000-4000-8000-000000000021','{"name":"비검증 이미지 차단","imagePath":"public-media/catalog/good/76000000-0000-4000-8000-000000000099.png"}',0)$q$,'unverified_artwork');
select public.admin_save_goods_draft('76000000-0000-4000-8000-000000000020','{"name":"이미지 포함 임시저장","imagePath":"public-media/catalog/good/76000000-0000-4000-8000-000000000010.png","galleryPath0":"public-media/catalog/good/76000000-0000-4000-8000-000000000012.png","description":"<img src=\"public-media/catalog/good/76000000-0000-4000-8000-000000000011.png\">","descriptionFormat":"html"}',1);
select pg_temp.expect_draft_error($q$select public.admin_save_goods_draft('76000000-0000-4000-8000-000000000020','{"name":"이전 버전"}',1)$q$,'goods_draft_changed');
select set_config('request.jwt.claim.sub','76000000-0000-4000-8000-000000000002',true);
select 1/case when (select count(*) from public.admin_goods_drafts)=0 and public.admin_list_goods_drafts()->>'total'='0' then 1 else 0 end as other_staff_cannot_read;
select pg_temp.expect_draft_error($q$select public.admin_get_goods_draft('76000000-0000-4000-8000-000000000020')$q$,'goods_draft_not_found');
select pg_temp.expect_draft_error($q$select public.admin_save_goods_draft('76000000-0000-4000-8000-000000000020','{"name":"타인 덮어쓰기"}',2)$q$,'forbidden');
select pg_temp.expect_draft_error($q$select public.admin_save_good('{"id":"draft-image-theft","ip_id":"server-draft-qa-ip","name":"타인 이미지 차단","type":"문구","price":1000,"stock":"ok","image_path":"public-media/catalog/good/76000000-0000-4000-8000-000000000010.png"}')$q$,'unverified_artwork');
select pg_temp.expect_draft_error($q$select public.admin_save_goods_photo('76000000-0000-4000-8000-000000000012','public-media/catalog/good/76000000-0000-4000-8000-000000000012.png','다른 직원 공용 사진',1,true)$q$,'goods_photo_in_use');
select set_config('request.jwt.claim.sub','76000000-0000-4000-8000-000000000001',true);
select public.admin_set_goods_draft_archived('76000000-0000-4000-8000-000000000020',2,true);
select public.admin_set_goods_draft_archived('76000000-0000-4000-8000-000000000020',2,true);
select 1/case when public.admin_list_goods_drafts('',true)->>'total'='1' then 1 else 0 end as soft_delete_can_be_found;
select public.admin_set_goods_draft_archived('76000000-0000-4000-8000-000000000020',3,false);
select pg_temp.expect_draft_error($q$select public.admin_save_good_from_draft('{"id":"bad-draft-product"}','76000000-0000-4000-8000-000000000020',4)$q$,'goods_name_required');
select 1/case when public.admin_get_goods_draft('76000000-0000-4000-8000-000000000020')->>'archived'='false'
 and public.admin_get_goods_draft('76000000-0000-4000-8000-000000000020')->>'revision'='4' then 1 else 0 end as failed_registration_does_not_consume_draft;
select public.admin_save_good_from_draft('{"id":"server-draft-product","ip_id":"server-draft-qa-ip","name":"임시저장 상품 등록","type":"문구","price":1000,"stock":"ok","image_path":"public-media/catalog/good/76000000-0000-4000-8000-000000000010.png","gallery_paths":["public-media/catalog/good/76000000-0000-4000-8000-000000000012.png"],"description_format":"html","description":"<p>사진</p>","description_image_paths":["public-media/catalog/good/76000000-0000-4000-8000-000000000011.png"]}','76000000-0000-4000-8000-000000000020',4);
select 1/case when public.admin_save_good_from_draft('{"id":"should-not-create-again"}','76000000-0000-4000-8000-000000000020',4)->>'id'='server-draft-product'
 and public.admin_list_goods_drafts()->>'total'='0' then 1 else 0 end as retry_returns_first_catalogue_result;
select pg_temp.expect_draft_error($q$select public.admin_set_goods_draft_archived('76000000-0000-4000-8000-000000000020',5,false)$q$,'goods_draft_completed');
-- Keep the latest 40; older entries remain available in the deleted list.
do $$ begin for i in 100..139 loop
 perform public.admin_save_goods_draft(('76000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,jsonb_build_object('name','한도 검증 '||i),0);
end loop; end $$;
select 1/case when public.admin_list_goods_drafts()->>'total'='40' and jsonb_array_length(public.admin_list_goods_drafts('',false,2)->'rows')=20 then 1 else 0 end as full_second_page;
select public.admin_save_goods_draft('76000000-0000-4000-8000-000000000140','{"name":"41번째"}',0);
select 1/case when public.admin_list_goods_drafts()->>'total'='40'
 and public.admin_get_goods_draft('76000000-0000-4000-8000-000000000100')->>'archived'='true'
 and public.admin_get_goods_draft('76000000-0000-4000-8000-000000000100')#>>'{values,name}'='한도 검증 100'
 then 1 else 0 end as oldest_is_recoverable;
select public.admin_set_goods_draft_archived('76000000-0000-4000-8000-000000000100',2,false);
select 1/case when public.admin_list_goods_drafts()->>'total'='40'
 and public.admin_get_goods_draft('76000000-0000-4000-8000-000000000100')->>'archived'='false'
 and public.admin_get_goods_draft('76000000-0000-4000-8000-000000000101')->>'archived'='true'
 then 1 else 0 end as restore_keeps_latest_40;
select set_config('request.jwt.claim.sub','76000000-0000-4000-8000-000000000003',true);
select pg_temp.expect_draft_error($q$select public.admin_list_goods_drafts()$q$,'forbidden');
reset role;
select 1/case when (select count(*) from public.goods where id='server-draft-product')=1
 and not exists(select 1 from public.goods where id in ('should-not-create-again','bad-draft-product','draft-image-theft'))
 and (select count(*) from public.audit_log where action='admin.goods.draft.completed' and target='goods_draft:76000000-0000-4000-8000-000000000020')=1
 and (select count(*) from public.admin_artwork_upload_claims where actor_id='76000000-0000-4000-8000-000000000001' and status='attached')=2
 then 1 else 0 end as atomic_completion_and_owned_images;
update public.profiles set suspended_at=now(),suspension_reason='검수용' where id='76000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','76000000-0000-4000-8000-000000000001',true);
select 1/case when (select count(*) from public.admin_goods_drafts)=0 then 1 else 0 end as suspended_owner_loses_access;
select pg_temp.expect_draft_error($q$select public.admin_list_goods_drafts()$q$,'forbidden');
rollback;
