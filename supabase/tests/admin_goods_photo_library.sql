\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_photo_error(statement text, message text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate='42501' and sqlerrm='operator_capability_required' and message in ('forbidden','staff_required','staff required','staff access required','admin_required','admin required','purchase_cost_admin_required') then return;end if; if position(message in sqlerrm)=0 then raise; end if; return; end;
  raise exception 'Expected rejection: %',message;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000071301','authenticated','authenticated','photo-owner@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000071302','authenticated','authenticated','photo-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000071303','authenticated','authenticated','photo-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id in ('00000000-0000-4000-8000-000000071301','00000000-0000-4000-8000-000000071302');
insert into public.verticals(key,label,color) values('photo-0713','사진 QA','#000000');
insert into public.ips(id,title,vertical_key) values('photo-0713','사진 QA','photo-0713');
set local role service_role;
select public.service_prepare_admin_artwork_upload('00000000-0000-4000-8000-000000071301','catalog/good/00000000-0000-4000-8000-000000071304.webp','good','image/webp',100,now()+interval '10 minutes');
select * from public.service_begin_admin_artwork_verification('00000000-0000-4000-8000-000000071301','catalog/good/00000000-0000-4000-8000-000000071304.webp');
select public.service_verify_admin_artwork_upload('00000000-0000-4000-8000-000000071301','catalog/good/00000000-0000-4000-8000-000000071304.webp',100);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000071302',true);
select pg_temp.expect_photo_error($q$select public.admin_save_goods_photo('00000000-0000-4000-8000-000000071305','public-media/catalog/good/00000000-0000-4000-8000-000000071304.webp','타인 임시 업로드',0)$q$,'unverified_artwork');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000071301',true);
select public.admin_save_goods_photo('00000000-0000-4000-8000-000000071305','public-media/catalog/good/00000000-0000-4000-8000-000000071304.webp','공용 사진',0);
select public.admin_save_goods_photo('00000000-0000-4000-8000-000000071305','public-media/catalog/good/00000000-0000-4000-8000-000000071304.webp','공용 사진',0);
select 1/case when (public.admin_list_goods_photos('공용')->>'total')::int=1 then 1 else 0 end as registered_once;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000071302',true);
select public.admin_save_good('{"id":"photo-good-a-0713","ip_id":"photo-0713","name":"공용 사진 상품 A","type":"문구","price":1000,"stock":"ok","image_path":"public-media/catalog/good/00000000-0000-4000-8000-000000071304.webp"}');
select public.admin_save_good('{"id":"photo-good-b-0713","ip_id":"photo-0713","name":"공용 사진 상품 B","type":"문구","price":1000,"stock":"ok","gallery_paths":["public-media/catalog/good/00000000-0000-4000-8000-000000071304.webp"],"description_format":"html","description":"<p>사진</p>","description_image_paths":["public-media/catalog/good/00000000-0000-4000-8000-000000071304.webp"]}');
select 1/case when jsonb_array_length(public.admin_list_goods_photos('공용')->'rows'->0->'references')=2 then 1 else 0 end as distinct_product_references;
select pg_temp.expect_photo_error($q$select public.admin_save_goods_photo('00000000-0000-4000-8000-000000071305','public-media/catalog/good/00000000-0000-4000-8000-000000071304.webp','공용 사진',1,true)$q$,'goods_photo_in_use');
select public.admin_save_goods_photo('00000000-0000-4000-8000-000000071305','public-media/catalog/good/00000000-0000-4000-8000-000000071304.webp','공용 사진 수정',1,false);
select pg_temp.expect_photo_error($q$select public.admin_save_goods_photo('00000000-0000-4000-8000-000000071305','public-media/catalog/good/00000000-0000-4000-8000-000000071304.webp','오래된 수정',1,false)$q$,'goods_photo_changed');
select pg_temp.expect_photo_error($q$select public.admin_save_goods_photo('00000000-0000-4000-8000-000000071305','public-media/catalog/good/00000000-0000-4000-8000-000000071399.webp','경로 변조',2,false)$q$,'photo_path_immutable');
select public.admin_save_good('{"id":"photo-good-a-0713","previous_id":"photo-good-a-0713","ip_id":"photo-0713","name":"사진 해제 A","type":"문구","price":1000,"stock":"ok","image_path":null}');
select public.admin_save_good('{"id":"photo-good-b-0713","previous_id":"photo-good-b-0713","ip_id":"photo-0713","name":"사진 해제 B","type":"문구","price":1000,"stock":"ok","gallery_paths":[],"description_format":"plain","description":"","description_image_paths":[]}');
select public.admin_save_goods_photo('00000000-0000-4000-8000-000000071305','public-media/catalog/good/00000000-0000-4000-8000-000000071304.webp','공용 사진 수정',2,true);
select 1/case when (public.admin_list_goods_photos('공용',true)->>'total')::int=1 and (public.admin_list_goods_photos('공용',false)->>'total')::int=0 then 1 else 0 end as archive_filter;
select pg_temp.expect_photo_error($q$select public.admin_save_good('{"id":"photo-good-c-0713","ip_id":"photo-0713","name":"보관 사진 차단","type":"문구","price":1000,"stock":"ok","image_path":"public-media/catalog/good/00000000-0000-4000-8000-000000071304.webp"}')$q$,'unverified_artwork');
select public.admin_save_goods_photo('00000000-0000-4000-8000-000000071305','public-media/catalog/good/00000000-0000-4000-8000-000000071304.webp','공용 사진 수정',3,false);
select public.admin_save_good('{"id":"photo-good-c-0713","ip_id":"photo-0713","name":"복구 사진 허용","type":"문구","price":1000,"stock":"ok","image_path":"public-media/catalog/good/00000000-0000-4000-8000-000000071304.webp"}');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000071303',true);
select 1/case when (select count(*) from public.goods_photo_library)=0 then 1 else 0 end as buyer_rls;
select pg_temp.expect_photo_error($q$select public.admin_list_goods_photos()$q$,'forbidden');
select pg_temp.expect_photo_error($q$select public.admin_save_goods_photo('00000000-0000-4000-8000-000000071305','public-media/catalog/good/00000000-0000-4000-8000-000000071304.webp','구매자 수정',4,false)$q$,'forbidden');
reset role;
select 1/case when (select status='attached' from public.admin_artwork_upload_claims where path='catalog/good/00000000-0000-4000-8000-000000071304.webp') then 1 else 0 end as retained_attached_claim;
select 1/case when not exists(select 1 from public.service_list_admin_artwork_cleanup_candidates(100) where path='catalog/good/00000000-0000-4000-8000-000000071304.webp' and cleanup_mode='all') then 1 else 0 end as protected_from_object_gc;
select 1/case when (select count(*) from public.audit_log where action='admin.goods.photo.saved' and target='goods_photo:00000000-0000-4000-8000-000000071305')=4 then 1 else 0 end as audit_exact;
select 1/case when not has_function_privilege('anon','public.admin_list_goods_photos(text,boolean,integer)','execute') and not has_function_privilege('service_role','public.admin_save_goods_photo(uuid,text,text,integer,boolean)','execute') and not has_function_privilege('authenticated','private.can_reuse_shared_goods_artwork(text)','execute') and not has_table_privilege('authenticated','public.goods_photo_library','insert') then 1 else 0 end as closed_permissions;
rollback;
