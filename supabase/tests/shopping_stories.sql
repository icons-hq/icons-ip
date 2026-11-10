\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql. All fixtures roll back; explicit
-- operator memberships exercise current authorization after activation.
begin;
create function pg_temp.expect_story_error(q text,expected text) returns void language plpgsql as $$
begin
 begin execute q;
 exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected shopping story rejection: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('87000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'shopping-story-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,6)n;
update public.profiles set role='staff' where id::text like '87000000-0000-4000-8000-%' and id<>'87000000-0000-4000-8000-000000000006';
insert into private.operator_memberships(profile_id,manager_role) values
 ('87000000-0000-4000-8000-000000000001','primary'),('87000000-0000-4000-8000-000000000002','deputy'),
 ('87000000-0000-4000-8000-000000000003','influencer'),('87000000-0000-4000-8000-000000000004','agency'),
 ('87000000-0000-4000-8000-000000000005','logistics');
insert into public.ips(id,title,vertical_key,published_at)
select 'story-test-ip','스토리 합성 IP',key,now() from public.verticals limit 1;
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at)
select 'story-test-'||lpad(n::text,3,'0'),'story-test-ip','스토리 합성 상품 '||lpad(n::text,3,'0'),'문구',1000,'ok',10,null
from generate_series(1,301)n;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('47c47700'||left(md5(good_id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(good_id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}',now(),now()
from unnest(array(select 'story-test-'||lpad(n::text,3,'0') from generate_series(1,300)n)||array['story-test-renamed'])good_id;
update public.profiles set role='staff' where id in(select ('47c47700'||left(md5(good_id),24))::uuid
 from unnest(array(select 'story-test-'||lpad(n::text,3,'0') from generate_series(1,300)n)||array['story-test-renamed'])good_id);
insert into private.operator_memberships(profile_id,manager_role)
select ('47c47700'||left(md5(good_id),24))::uuid,'primary'
from unnest(array(select 'story-test-'||lpad(n::text,3,'0') from generate_series(1,300)n)||array['story-test-renamed'])good_id;
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id like 'story-test-%' and id<>'story-test-301';
create function pg_temp.story_values(p_count integer default 300) returns jsonb language sql as $$
select jsonb_build_object('title','스토리 100% 검수','bodyHtml','<p>실제 저장 검수 본문</p>',
 'imagePaths','[]'::jsonb,'startsAt',null,'endsAt',null,'sections',
 coalesce((select jsonb_agg(jsonb_build_object('id',('87000000-0000-4000-8100-'||lpad(section_no::text,12,'0'))::uuid,
 'title','상품 '||section_no,'imageShape',case when section_no=1 then 'square' else 'portrait' end,
 'goodIds',(select jsonb_agg('story-test-'||lpad(n::text,3,'0') order by n)
 from generate_series((section_no-1)*200+1,least(section_no*200,p_count))n)) order by section_no)
 from generate_series(1,(p_count+199)/200)section_no),'[]'::jsonb))
$$;
select 1/case when has_function_privilege('anon','public.get_shopping_story(uuid)','execute')
 and has_function_privilege('anon','public.get_shopping_stories(integer,integer)','execute')
 and not has_function_privilege('service_role','public.admin_save_shopping_story(uuid,integer,uuid,jsonb)','execute')
 and not has_function_privilege('anon','public.admin_list_shopping_stories(text,text,date,date,text,integer,integer)','execute')
 and not has_function_privilege('authenticated','private.validate_shopping_story_values(jsonb)','execute')
 and not has_table_privilege('anon','public.shopping_stories','select')
 and not has_table_privilege('authenticated','public.shopping_story_goods','insert') then 1 else 0 end as sealed_acl;
set local role authenticated;
select set_config('request.jwt.claim.sub','87000000-0000-4000-8000-000000000001',true);
select public.admin_save_shopping_story('87000000-0000-4000-8000-000000000101',0,'87000000-0000-4000-8000-000000000201',pg_temp.story_values()) as first_result \gset
select 1/case when public.admin_save_shopping_story('87000000-0000-4000-8000-000000000101',0,'87000000-0000-4000-8000-000000000201',pg_temp.story_values())=:'first_result'::jsonb then 1 else 0 end as idempotent_retry;
select pg_temp.expect_story_error($q$select public.admin_save_shopping_story('87000000-0000-4000-8000-000000000101',0,'87000000-0000-4000-8000-000000000201',pg_temp.story_values()||'{"title":"변조"}')$q$,'shopping_story_operation_conflict');
select pg_temp.expect_story_error($q$select public.admin_save_shopping_story('87000000-0000-4000-8000-000000000101',0,gen_random_uuid(),pg_temp.story_values())$q$,'PT409');
do $$ declare result jsonb; begin
 result:=public.admin_get_shopping_story('87000000-0000-4000-8000-000000000101');
 if result->>'revision'<>'1' or result->>'goodCount'<>'300' or result#>>'{sections,0,goodIds,199}'<>'story-test-200'
  or result#>>'{sections,1,goodIds,99}'<>'story-test-300' or result#>>'{sections,1,imageShape}'<>'portrait'
  or jsonb_array_length(result->'goods')<>300 then raise exception 'Complete admin composition/order failed';end if;
 if result#>'{goods,0,variants,0,pricing}' is null or result#>'{goods,0,variants,0,supply}' is null
  or result#>>'{goods,0,code}' is null or not ((result->'goods'->0) ? 'bg') then raise exception 'Admin preview price/supply/image projection missing: %',result->'goods'->0;end if;
 if public.admin_list_shopping_stories('100%')->>'total'<>'1' or public.admin_search_shopping_story_goods('story-test-',16)->>'total'<>'301'
  or jsonb_array_length(public.admin_search_shopping_story_goods('story-test-',16)->'rows')<>1 then raise exception 'Literal search or goods pagination failed';end if;
end $$;
select pg_temp.expect_story_error($q$select public.admin_save_shopping_story(gen_random_uuid(),0,gen_random_uuid(),pg_temp.story_values(301))$q$,'shopping_story_goods_limit');
select pg_temp.expect_story_error($q$select public.admin_save_shopping_story(gen_random_uuid(),0,gen_random_uuid(),pg_temp.story_values(0)||jsonb_build_object('title',repeat('가',51)))$q$,'invalid_shopping_story');
select pg_temp.expect_story_error($q$select public.admin_save_shopping_story(gen_random_uuid(),0,gen_random_uuid(),pg_temp.story_values(0)||'{"extra":true}')$q$,'invalid_shopping_story');
select pg_temp.expect_story_error($q$select public.admin_save_shopping_story(gen_random_uuid(),0,gen_random_uuid(),jsonb_set(pg_temp.story_values(1),'{sections,0,title}',to_jsonb(repeat('가',14))))$q$,'invalid_shopping_story_section');
select pg_temp.expect_story_error($q$select public.admin_save_shopping_story(gen_random_uuid(),0,gen_random_uuid(),jsonb_set(pg_temp.story_values(1),'{sections,0,goodIds}','["story-test-001","story-test-001"]'))$q$,'invalid_shopping_story_goods');
select pg_temp.expect_story_error($q$select public.admin_save_shopping_story(gen_random_uuid(),0,gen_random_uuid(),pg_temp.story_values(0)||'{"startsAt":"2026-10-13T12:00:00+09:00","endsAt":"2026-10-13T12:00:00+09:00"}')$q$,'invalid_shopping_story_window');
select pg_temp.expect_story_error($q$select public.admin_save_shopping_story(gen_random_uuid(),0,gen_random_uuid(),pg_temp.story_values(0)||'{"startsAt":"infinity"}')$q$,'invalid_shopping_story');
select pg_temp.expect_story_error($q$select public.admin_save_shopping_story(gen_random_uuid(),0,gen_random_uuid(),jsonb_set(pg_temp.story_values(1),'{sections,0,goodIds}','["missing-story-good"]'))$q$,'shopping_story_good_unavailable');
reset role;
set local role anon;
do $$ declare result jsonb; begin
 result:=public.get_shopping_story('87000000-0000-4000-8000-000000000101');
 if jsonb_array_length(result->'goods')<>300 or jsonb_array_length(result#>'{sections,0,goodIds}')<>200
  or jsonb_array_length(result#>'{sections,1,goodIds}')<>100 then raise exception 'Public composition truncated below 300';end if;
 if result ?| array['revision','createdBy','updatedBy'] or (result->'goods'->0) ?| array['purchaseCost','cost','supplier'] then raise exception 'Private editorial metadata leaked';end if;
 if jsonb_array_length(result#>'{goods,0,variants}')<1 or result#>'{goods,0,variants,0,pricing}' is null
  or result#>'{goods,0,variants,0,supply}' is null then raise exception 'Public variant pricing/supply missing';end if;
end $$;
reset role;
-- Visibility follows current goods/IP restrictions, including already-linked goods.
update public.goods set published_at=null where id='story-test-001';
update public.goods set sale_restriction='adult' where id='story-test-002';
update public.goods_variants set stock_qty=0 where good_id='story-test-003';
update public.goods set archived_at=now() where id='story-test-003';
update public.goods_variants set stock_qty=0 where good_id='story-test-004';
select 1/case when jsonb_array_length(public.get_shopping_story('87000000-0000-4000-8000-000000000101')->'goods')=297
 and exists(select 1 from jsonb_array_elements(public.get_shopping_story('87000000-0000-4000-8000-000000000101')->'goods') g where g->>'id'='story-test-004') then 1 else 0 end as visibility_and_soldout;
update public.ips set published_at=null where id='story-test-ip';
select 1/case when jsonb_array_length(public.get_shopping_story('87000000-0000-4000-8000-000000000101')->'goods')=0 then 1 else 0 end as parent_visibility;
update public.ips set published_at=now() where id='story-test-ip';
set local role authenticated;
do $$ declare result jsonb; begin
 result:=public.admin_get_shopping_story('87000000-0000-4000-8000-000000000101');
 if jsonb_array_length(result->'goods')<>300 or exists(select 1 from jsonb_array_elements(result->'goods')g
  where g->>'id' in('story-test-001','story-test-002','story-test-003') and
   (g#>'{variants,0,pricing}'='null'::jsonb or g#>'{variants,0,supply}'='null'::jsonb)) then
  raise exception 'Unpublished/restricted/archived editor references lost their current price or supply';end if;
 if exists(select 1 from jsonb_array_elements(public.admin_search_shopping_story_goods('story-test-001')->'rows')g
  where g#>'{variants,0,pricing}'='null'::jsonb or g#>'{variants,0,supply}'='null'::jsonb) then
  raise exception 'Unpublished candidates lost their current price or supply';end if;
end $$;
reset role;
-- One statement timestamp proves inclusive start/exclusive end exactly.
do $$ begin
 update public.shopping_stories set starts_at=statement_timestamp(),ends_at=statement_timestamp()+interval '1 day' where id='87000000-0000-4000-8000-000000000101';
 if public.get_shopping_story('87000000-0000-4000-8000-000000000101') is null then raise exception 'Inclusive start excluded';end if;
 update public.shopping_stories set starts_at=null,ends_at=statement_timestamp() where id='87000000-0000-4000-8000-000000000101';
 if public.get_shopping_story('87000000-0000-4000-8000-000000000101') is not null then raise exception 'Exclusive end included';end if;
 update public.shopping_stories set starts_at=statement_timestamp()+interval '1 second',ends_at=null where id='87000000-0000-4000-8000-000000000101';
 if (public.get_shopping_stories()->>'nextChangeAt')::timestamptz<>statement_timestamp()+interval '1 second' then raise exception 'Scheduled boundary missing';end if;
end $$;
update public.shopping_stories set starts_at=null,ends_at=null where id='87000000-0000-4000-8000-000000000101';
set local role authenticated;
select public.admin_save_shopping_story('87000000-0000-4000-8000-000000000101',1,gen_random_uuid(),pg_temp.story_values()||'{"title":"수정은 순서를 바꾸지 않음"}');
reset role;
select 1/case when (select count(*) from public.audit_log where action='admin.shopping_story.saved' and target='shopping_stories:87000000-0000-4000-8000-000000000101')=2 then 1 else 0 end as retries_do_not_duplicate_audit;
-- Fresh verified curation images are single-use; existing story edits may retain them.
set local role service_role;
select public.service_prepare_admin_artwork_upload('87000000-0000-4000-8000-000000000001','catalog/curation/87000000-0000-4000-8000-000000000301.webp','curation','image/webp',100,now()+interval '10 minutes');
select * from public.service_begin_admin_artwork_verification('87000000-0000-4000-8000-000000000001','catalog/curation/87000000-0000-4000-8000-000000000301.webp');
select public.service_verify_admin_artwork_upload('87000000-0000-4000-8000-000000000001','catalog/curation/87000000-0000-4000-8000-000000000301.webp',100);
reset role;
create function pg_temp.story_image_values() returns jsonb language sql as $$
select pg_temp.story_values(0)||'{"imagePaths":["public-media/catalog/curation/87000000-0000-4000-8000-000000000301.webp"],"bodyHtml":"<p>그림 검수</p>"}'::jsonb
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','87000000-0000-4000-8000-000000000002',true);
select pg_temp.expect_story_error($q$select public.admin_save_shopping_story('87000000-0000-4000-8000-000000000102',0,gen_random_uuid(),pg_temp.story_image_values())$q$,'unverified_artwork');
select set_config('request.jwt.claim.sub','87000000-0000-4000-8000-000000000001',true);
select public.admin_save_shopping_story('87000000-0000-4000-8000-000000000102',0,gen_random_uuid(),pg_temp.story_image_values());
select pg_temp.expect_story_error($q$select public.admin_save_shopping_story('87000000-0000-4000-8000-000000000103',0,gen_random_uuid(),pg_temp.story_image_values())$q$,'unverified_artwork');
select set_config('request.jwt.claim.sub','87000000-0000-4000-8000-000000000002',true);
select public.admin_save_shopping_story('87000000-0000-4000-8000-000000000102',1,gen_random_uuid(),pg_temp.story_image_values()||'{"title":"부매니저 수정"}');
-- Other store operators can write; logistics/customers cannot read private data.
do $$ declare n integer; begin for n in 3..4 loop
 perform set_config('request.jwt.claim.sub','87000000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
 perform public.admin_save_shopping_story(('87000000-0000-4000-8000-'||lpad((110+n)::text,12,'0'))::uuid,0,gen_random_uuid(),pg_temp.story_values(0));
 perform public.admin_list_shopping_stories();
 end loop;
 for n in 5..6 loop
 perform set_config('request.jwt.claim.sub','87000000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
 perform pg_temp.expect_story_error('select public.admin_list_shopping_stories()','operator_capability_required');
 perform pg_temp.expect_story_error('select public.admin_get_shopping_story(''87000000-0000-4000-8000-000000000101'')','operator_capability_required');
 perform pg_temp.expect_story_error('select public.admin_save_shopping_story(gen_random_uuid(),0,gen_random_uuid(),pg_temp.story_values(0))','operator_capability_required');
 if exists(select 1 from public.shopping_stories) or exists(select 1 from public.shopping_story_sections)
  or exists(select 1 from public.shopping_story_goods) then raise exception 'Private story RLS opened';end if;
 end loop;
end $$;
select set_config('request.jwt.claim.sub','87000000-0000-4000-8000-000000000001',true);
-- Fresh section UUID prevents aliasing another story's composition.
select public.admin_save_shopping_story('87000000-0000-4000-8000-000000000104',0,gen_random_uuid(),
 jsonb_set(jsonb_set(pg_temp.story_values(1),'{sections,0,id}','"87000000-0000-4000-8200-000000000001"'),'{sections,0,goodIds}','["story-test-301"]'));
select 1/case when public.admin_get_shopping_story('87000000-0000-4000-8000-000000000104')#>'{goods,0,variants,0,supply}' is distinct from 'null'::jsonb
 and public.admin_get_shopping_story('87000000-0000-4000-8000-000000000104')#>'{goods,0,variants,0,pricing}' is distinct from 'null'::jsonb then 1 else 0 end as draft_editor_projection;
reset role;
update public.goods set id='story-test-renamed' where id='story-test-301';
select pg_temp.publish_goods_kc_fixture('story-test-renamed');
select 1/case when public.get_shopping_story('87000000-0000-4000-8000-000000000104')#>>'{sections,0,goodIds,0}'='story-test-renamed'
 and public.get_shopping_story('87000000-0000-4000-8000-000000000104')#>>'{goods,0,id}'='story-test-renamed' then 1 else 0 end as draft_id_cascade;
-- Creation order is stable even after edits and page offsets are honored.
update public.shopping_stories set created_at='2126-01-01T00:00:00Z',title='스토리 페이지 검수 '||id::text where id::text like '87000000-0000-4000-8000-%';
set local role authenticated;
do $$ declare result jsonb; begin
 result:=public.admin_list_shopping_stories('스토리 페이지 검수', 'all',null,null,'created_desc',2,2);
 if result->>'total'<>'5' or jsonb_array_length(result->'rows')<>2 then raise exception 'Admin pagination failed';end if;
 result:=public.get_shopping_stories(3,0);
 if result#>>'{rows,0,id}'<>'87000000-0000-4000-8000-000000000114'
  or result#>>'{rows,2,id}'<>'87000000-0000-4000-8000-000000000104' then raise exception 'Stable public latest-three order failed';end if;
 if public.admin_list_shopping_stories('스토리 페이지 검수', 'all','2126-01-01','2126-01-01')->>'total'<>'5'
  or public.admin_list_shopping_stories('스토리 페이지 검수', 'all','2125-12-31','2125-12-31')->>'total'<>'0' then raise exception 'KST creation date failed';end if;
end $$;
select pg_temp.expect_story_error($q$select public.admin_delete_shopping_stories(gen_random_uuid(),'[{"id":"87000000-0000-4000-8000-000000000101","revision":2},{"id":"87000000-0000-4000-8000-000000000102","revision":1}]')$q$,'PT409');
select 1/case when public.admin_get_shopping_story('87000000-0000-4000-8000-000000000101') is not null then 1 else 0 end as stale_batch_delete_atomic;
select public.admin_delete_shopping_stories('87000000-0000-4000-8000-000000000202','[{"id":"87000000-0000-4000-8000-000000000101","revision":2},{"id":"87000000-0000-4000-8000-000000000102","revision":2}]') as delete_result \gset
select 1/case when public.admin_delete_shopping_stories('87000000-0000-4000-8000-000000000202','[{"id":"87000000-0000-4000-8000-000000000101","revision":2},{"id":"87000000-0000-4000-8000-000000000102","revision":2}]')=:'delete_result'::jsonb
 and public.admin_get_shopping_story('87000000-0000-4000-8000-000000000101') is null
 and public.get_shopping_story('87000000-0000-4000-8000-000000000102') is null then 1 else 0 end as idempotent_tombstone_delete;
select pg_temp.expect_story_error($q$select public.admin_save_shopping_story('87000000-0000-4000-8000-000000000101',3,gen_random_uuid(),pg_temp.story_values())$q$,'shopping_story_not_found');
reset role;
select 1/case when exists(select 1 from jsonb_array_elements(private.goods_photo_references('public-media/catalog/curation/87000000-0000-4000-8000-000000000301.webp'))r where r->>'kind'='story')
 and not exists(select 1 from public.service_list_admin_artwork_cleanup_candidates(100) where path='catalog/curation/87000000-0000-4000-8000-000000000301.webp' and cleanup_mode='all')
 then 1 else 0 end as deleted_story_preserves_image_evidence;
update public.profiles set suspended_at=now(),suspension_reason='합성 검수' where id='87000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_story_error('select public.admin_save_shopping_story(gen_random_uuid(),0,gen_random_uuid(),pg_temp.story_values(0))','operator_capability_required');
rollback;
