\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub','',true);
create function pg_temp.expect_html_error(statement text, message text) returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if position(message in sqlerrm)=0 then raise; end if;
    return;
  end;
  raise exception 'Expected rejection: %',message;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000047801','authenticated','authenticated','goods-html-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000047802','authenticated','authenticated','goods-html-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000047801';
insert into public.verticals(key,label,color) values('goods-html-0478','HTML 검증','#000000');
insert into public.ips(id,title,vertical_key) values('goods-html-0478','HTML 검증','goods-html-0478');

set local role service_role;
select public.service_prepare_admin_artwork_upload('00000000-0000-4000-8000-000000047801','catalog/good/00000000-0000-4000-8000-000000047803.webp','good','image/webp',100,now()+interval '10 minutes');
select * from public.service_begin_admin_artwork_verification('00000000-0000-4000-8000-000000047801','catalog/good/00000000-0000-4000-8000-000000047803.webp');
select public.service_verify_admin_artwork_upload('00000000-0000-4000-8000-000000047801','catalog/good/00000000-0000-4000-8000-000000047803.webp',100);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047801',true);
select public.admin_save_good('{"id":"goods-html-source-0478","ip_id":"goods-html-0478","name":"HTML 상품","type":"문구","price":1000,"stock":"ok","description":"<h2>구성</h2><p>키링 &amp; 스티커</p><img src=\"public-media/catalog/good/00000000-0000-4000-8000-000000047803.webp\" alt=\"구성품\" loading=\"lazy\" decoding=\"async\" />","description_format":"html","description_image_paths":["public-media/catalog/good/00000000-0000-4000-8000-000000047803.webp"]}');
select 1/case when exists(select 1 from public.goods where id='goods-html-source-0478' and description_format='html'
 and description like '<h2>구성</h2>%' and cardinality(description_image_paths)=1 and published_at is null)
 then 1 else 0 end as assert_html_draft_saved;
reset role;
select 1/case when (select status='attached' from public.admin_artwork_upload_claims where path='catalog/good/00000000-0000-4000-8000-000000047803.webp') then 1 else 0 end as assert_html_claim_attached;

set local role authenticated;
select public.admin_save_good(jsonb_build_object('id','goods-html-source-0478','previous_id','goods-html-source-0478','ip_id','goods-html-0478','name','HTML 수정','type','문구','price',1000,'stock','ok',
 'description',(select description from public.goods where id='goods-html-source-0478'),'description_format','html','description_image_paths',jsonb_build_array('public-media/catalog/good/00000000-0000-4000-8000-000000047803.webp'),
 'gallery_paths',jsonb_build_array('public-media/catalog/good/00000000-0000-4000-8000-000000047803.webp')));
select 1/case when exists(select 1 from public.goods where id='goods-html-source-0478' and name='HTML 수정' and gallery_paths=description_image_paths)
 then 1 else 0 end as assert_existing_verified_image_moves_between_content_slots;

-- Real editor payloads remove the old slot in the SAME save. Retaining the old
-- gallery while adding HTML would miss the wrapper's two-write regression.
select public.admin_save_good(jsonb_build_object('id','goods-html-source-0478','previous_id','goods-html-source-0478','ip_id','goods-html-0478','name','갤러리 이동','type','문구','price',1000,'stock','ok',
 'description','일반 설명','description_format','plain','description_image_paths','[]'::jsonb,
 'gallery_paths',jsonb_build_array('public-media/catalog/good/00000000-0000-4000-8000-000000047803.webp')));
select public.admin_save_good(jsonb_build_object('id','goods-html-source-0478','previous_id','goods-html-source-0478','ip_id','goods-html-0478','name','갤러리에서 HTML로','type','문구','price',1000,'stock','ok',
 'description','<img src="public-media/catalog/good/00000000-0000-4000-8000-000000047803.webp" />','description_format','html',
 'description_image_paths',jsonb_build_array('public-media/catalog/good/00000000-0000-4000-8000-000000047803.webp'),'gallery_paths','[]'::jsonb));
select 1/case when exists(select 1 from public.goods where id='goods-html-source-0478' and cardinality(gallery_paths)=0 and cardinality(description_image_paths)=1)
 then 1 else 0 end as assert_gallery_to_html_removes_old_slot_atomically;
select public.admin_save_good(jsonb_build_object('id','goods-html-source-0478','previous_id','goods-html-source-0478','ip_id','goods-html-0478','name','HTML에서 대표로','type','문구','price',1000,'stock','ok',
 'description','일반 설명','description_format','plain','description_image_paths','[]'::jsonb,
 'image_path','public-media/catalog/good/00000000-0000-4000-8000-000000047803.webp'));
select 1/case when exists(select 1 from public.goods where id='goods-html-source-0478' and image_path is not null and cardinality(description_image_paths)=0)
 then 1 else 0 end as assert_html_to_main_removes_old_slot_atomically;
select public.admin_save_good(jsonb_build_object('id','goods-html-source-0478','previous_id','goods-html-source-0478','ip_id','goods-html-0478','name','대표에서 HTML로','type','문구','price',1000,'stock','ok',
 'description','<img src="public-media/catalog/good/00000000-0000-4000-8000-000000047803.webp" />','description_format','html',
 'description_image_paths',jsonb_build_array('public-media/catalog/good/00000000-0000-4000-8000-000000047803.webp'),'image_path',null));
select 1/case when exists(select 1 from public.goods where id='goods-html-source-0478' and image_path is null and cardinality(description_image_paths)=1)
 then 1 else 0 end as assert_main_to_html_removes_old_slot_atomically;
select public.admin_save_good(jsonb_build_object('id','goods-html-source-0478','previous_id','goods-html-source-0478','ip_id','goods-html-0478','name','HTML에서 상세로','type','문구','price',1000,'stock','ok',
 'description','일반 설명','description_format','plain','description_image_paths','[]'::jsonb,
 'detail_image_path','public-media/catalog/good/00000000-0000-4000-8000-000000047803.webp'));
select 1/case when exists(select 1 from public.goods where id='goods-html-source-0478' and detail_image_path is not null and cardinality(description_image_paths)=0)
 then 1 else 0 end as assert_html_to_detail_removes_old_slot_atomically;
select public.admin_save_good(jsonb_build_object('id','goods-html-source-0478','previous_id','goods-html-source-0478','ip_id','goods-html-0478','name','상세에서 HTML로','type','문구','price',1000,'stock','ok',
 'description','<img src="public-media/catalog/good/00000000-0000-4000-8000-000000047803.webp" />','description_format','html',
 'description_image_paths',jsonb_build_array('public-media/catalog/good/00000000-0000-4000-8000-000000047803.webp'),'detail_image_path',null));
select 1/case when exists(select 1 from public.goods where id='goods-html-source-0478' and detail_image_path is null and cardinality(description_image_paths)=1)
 then 1 else 0 end as assert_detail_to_html_removes_old_slot_atomically;
select pg_temp.expect_html_error($sql$select public.admin_save_good('{"id":"goods-html-source-0478","previous_id":"goods-html-source-0478","ip_id":"goods-html-0478","name":"실패한 수정","type":"문구","price":1000,"stock":"ok","description":"<p>저장되면 안 됨</p>","description_format":"html","description_image_paths":["public-media/catalog/good/00000000-0000-4000-8000-000000047803.webp","public-media/catalog/good/00000000-0000-4000-8000-000000047899.webp"]}')$sql$,'unverified_artwork');
select 1/case when exists(select 1 from public.goods where id='goods-html-source-0478' and name='상세에서 HTML로'
 and description='<img src="public-media/catalog/good/00000000-0000-4000-8000-000000047803.webp" />')
 then 1 else 0 end as assert_failed_move_rolls_back_metadata_and_permission;

select public.admin_clone_good('00000000-0000-4000-8000-000000047804','goods-html-source-0478','goods-html-clone-0478','HTML-CLONE-0478','HTML 복사');
select 1/case when exists(select 1 from public.goods clone join public.goods source on source.id='goods-html-source-0478'
 where clone.id='goods-html-clone-0478' and clone.description=source.description and clone.description_format='html'
 and clone.description_image_paths=source.description_image_paths and clone.gallery_paths=source.gallery_paths
 and clone.published_at is null and clone.first_published_at is null and clone.stock_qty=0)
 then 1 else 0 end as assert_html_clone_keeps_document_and_verified_images;
select public.admin_clone_good('00000000-0000-4000-8000-000000047806','goods-html-source-0478','goods-html-rename-0478','HTML-RENAME-0478','이동 후 URL 변경');
select public.admin_save_good(jsonb_build_object('id','goods-html-rename-0478','previous_id','goods-html-rename-0478','ip_id','goods-html-0478','name','갤러리에서 이전 준비','type','문구','price',1000,'stock','ok',
 'description','일반 설명','description_format','plain','description_image_paths','[]'::jsonb,
 'gallery_paths',jsonb_build_array('public-media/catalog/good/00000000-0000-4000-8000-000000047803.webp')));
select public.admin_save_good(jsonb_build_object('id','goods-html-renamed-0478','previous_id','goods-html-rename-0478','ip_id','goods-html-0478','name','URL 변경과 HTML 이동','type','문구','price',1000,'stock','ok',
 'description','<img src="public-media/catalog/good/00000000-0000-4000-8000-000000047803.webp" />','description_format','html',
 'description_image_paths',jsonb_build_array('public-media/catalog/good/00000000-0000-4000-8000-000000047803.webp'),'gallery_paths','[]'::jsonb));
select 1/case when exists(select 1 from public.goods where id='goods-html-renamed-0478' and cardinality(gallery_paths)=0 and cardinality(description_image_paths)=1)
 and not exists(select 1 from public.goods where id='goods-html-rename-0478') then 1 else 0 end as assert_draft_rename_and_image_move_share_the_locked_source;

select pg_temp.expect_html_error($sql$select public.admin_save_good('{"id":"goods-html-stolen-0478","ip_id":"goods-html-0478","name":"무단 재사용","type":"문구","price":1000,"stock":"ok","description":"<p>무단 이미지</p>","description_format":"html","description_image_paths":["public-media/catalog/good/00000000-0000-4000-8000-000000047803.webp"]}')$sql$,'unverified_artwork');
select pg_temp.expect_html_error($sql$select public.admin_save_good('{"id":"goods-html-unverified-0478","ip_id":"goods-html-0478","name":"미검증 이미지","type":"문구","price":1000,"stock":"ok","description":"<p>미검증</p>","description_format":"html","description_image_paths":["public-media/catalog/good/00000000-0000-4000-8000-000000047899.webp"]}')$sql$,'unverified_artwork');
select 1/case when not exists(select 1 from public.goods where id in ('goods-html-stolen-0478','goods-html-unverified-0478')) then 1 else 0 end as assert_invalid_images_rollback_the_whole_draft;
select pg_temp.expect_html_error($sql$select public.admin_save_good(jsonb_build_object('id','goods-html-overlong-0478','ip_id','goods-html-0478','name','너무 긴 HTML','price',0,'description_format','html','description',repeat('가',30001)))$sql$,'goods_description_length');
select pg_temp.expect_html_error($sql$select public.admin_save_good('{"ip_id":"goods-html-0478","name":"잘못된 형식","price":0,"description_format":"css"}')$sql$,'goods_description_format');
select pg_temp.expect_html_error($sql$select public.admin_save_good('{"ip_id":"goods-html-0478","name":"배열 오류","price":0,"description_format":"html","description_image_paths":[null]}')$sql$,'goods_description_images');

select public.admin_save_good('{"id":"goods-html-clone-0478","previous_id":"goods-html-clone-0478","ip_id":"goods-html-0478","name":"일반 텍스트로 변경","type":"문구","price":1000,"stock":"ok","description":"<3 <strong>그대로인 원문</strong>","description_format":"plain","description_image_paths":[]}');
select 1/case when exists(select 1 from public.goods where id='goods-html-clone-0478' and description_format='plain'
 and description='<3 <strong>그대로인 원문</strong>' and cardinality(description_image_paths)=0)
 then 1 else 0 end as assert_plain_transition_preserves_literal_source;
reset role;
insert into public.goods(id,ip_id,name,type,price,description) values('goods-html-legacy-0478','goods-html-0478','긴 기존 설명','문구',1000,repeat('가',3000));
set local role authenticated;
select public.admin_clone_good('00000000-0000-4000-8000-000000047805','goods-html-legacy-0478','goods-html-legacy-copy-0478','HTML-LEGACY-0478','긴 설명 복사');
select 1/case when exists(select 1 from public.goods where id='goods-html-legacy-copy-0478' and description_format='plain' and description=repeat('가',3000))
 then 1 else 0 end as assert_existing_long_plain_description_survives_clone;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047802',true);
select pg_temp.expect_html_error($sql$select public.admin_save_good('{"ip_id":"goods-html-0478","name":"구매자 작성","price":0,"description_format":"html"}')$sql$,'forbidden');
-- Existing goods_read is broader than storefront discovery.
-- Observe the public search boundary instead of inventing a table-RLS change.
select 1/case when not exists(select 1 from public.search_public_content('HTML',20) where id='goods-html-source-0478') then 1 else 0 end as assert_drafts_absent_from_public_search;
reset role;
select 1/case when not has_function_privilege('anon','public.admin_save_good(jsonb)','execute')
 and has_function_privilege('authenticated','public.admin_save_good(jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_save_good(jsonb)','execute')
 and not has_function_privilege('authenticated','private.admin_save_good_before_description(jsonb)','execute')
 then 1 else 0 end as assert_html_writer_acl;
select 1/case when exists(select 1 from public.audit_log where target='goods:goods-html-source-0478' and action='admin.good.description_saved'
 and diff->'after'->>'format'='html') then 1 else 0 end as assert_description_audited;
select 1/case when exists(select 1 from public.audit_log where id='00000000-0000-4000-8000-000000047804'
 and diff#>>'{copiedDescription,format}'='html'
 and diff#>'{copiedArtwork,descriptionImagePaths}'='["public-media/catalog/good/00000000-0000-4000-8000-000000047803.webp"]'::jsonb)
 then 1 else 0 end as assert_cloned_description_and_images_audited;
select 1/case when not exists(select 1 from private.goods_artwork_copy_authorizations) then 1 else 0 end as assert_clone_authorization_cleared;
rollback;
