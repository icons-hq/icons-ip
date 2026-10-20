\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql. Explicit operator memberships are local
-- test records; every fixture and the verified upload claims roll back.
begin;
create function pg_temp.visual_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected relation visual error: %',expected;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select ('99000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','relation-visual-'||n||'@example.test',now(),'{}','{}' from generate_series(1,4)n;
update public.profiles set role='staff' where id::text like '99000000-0000-4000-8000-%' and id<>'99000000-0000-4000-8000-000000000004';
insert into private.operator_memberships(profile_id,manager_role) values
 ('99000000-0000-4000-8000-000000000001','primary'),('99000000-0000-4000-8000-000000000002','deputy'),('99000000-0000-4000-8000-000000000003','logistics');
insert into public.ips(id,title,vertical_key,published_at) select 'relation-visual-ip','이미지 연관 검수',key,now() from public.verticals limit 1;
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty)
select 'relation-visual-'||k,'relation-visual-ip','이미지 연관 상품 '||k,'문구',1000,'ok',10 from unnest(array['a','b','c','draft','adult','archived'])k;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}'
from public.goods where id in ('relation-visual-a','relation-visual-b','relation-visual-c','relation-visual-adult','relation-visual-archived');
update public.profiles set role='staff' where id in(select ('47c47700'||left(md5(id),24))::uuid from public.goods where id in ('relation-visual-a','relation-visual-b','relation-visual-c','relation-visual-adult','relation-visual-archived'));
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id in ('relation-visual-a','relation-visual-b','relation-visual-c','relation-visual-adult','relation-visual-archived');
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in ('relation-visual-a','relation-visual-b','relation-visual-c','relation-visual-adult','relation-visual-archived');
update public.goods set sale_restriction='adult' where id='relation-visual-adult';
update public.goods_variants set stock_qty=0 where good_id='relation-visual-archived';update public.goods set archived_at=now() where id='relation-visual-archived';
create function pg_temp.visual_values(p_image integer default 301,p_kind text default 'together') returns jsonb language sql as $$
 select jsonb_build_object('kind',p_kind,'title','이미지 연관 검수','representativeGoodId','relation-visual-a','enabled',true,'startsAt',null,'endsAt',null,
 'goodIds','["relation-visual-a","relation-visual-b","relation-visual-draft"]'::jsonb,
 'visual',jsonb_build_object('imagePath','public-media/catalog/curation/99000000-0000-4000-8000-'||lpad(p_image::text,12,'0')||'.webp',
 'alt','함께 연출한 상품','description','현재 상품을 함께 확인하세요.','hotspots','[{"goodId":"relation-visual-a","x":0,"y":10000},{"goodId":"relation-visual-b","x":6500,"y":2500},{"goodId":"relation-visual-draft","x":3000,"y":5000}]'::jsonb))
$$;
set local role service_role;
select public.service_prepare_admin_artwork_upload('99000000-0000-4000-8000-000000000001','catalog/curation/99000000-0000-4000-8000-000000000301.webp','curation','image/webp',100,now()+interval '10 minutes');
select * from public.service_begin_admin_artwork_verification('99000000-0000-4000-8000-000000000001','catalog/curation/99000000-0000-4000-8000-000000000301.webp');
select public.service_verify_admin_artwork_upload('99000000-0000-4000-8000-000000000001','catalog/curation/99000000-0000-4000-8000-000000000301.webp',100);
select public.service_prepare_admin_artwork_upload('99000000-0000-4000-8000-000000000001','catalog/curation/99000000-0000-4000-8000-000000000302.webp','curation','image/webp',100,now()+interval '10 minutes');
select * from public.service_begin_admin_artwork_verification('99000000-0000-4000-8000-000000000001','catalog/curation/99000000-0000-4000-8000-000000000302.webp');
select public.service_verify_admin_artwork_upload('99000000-0000-4000-8000-000000000001','catalog/curation/99000000-0000-4000-8000-000000000302.webp',100);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000002',true);
select pg_temp.visual_error($q$select public.admin_save_goods_relation_composition('99000000-0000-4000-8000-000000000101',0,gen_random_uuid(),pg_temp.visual_values())$q$,'unverified_artwork');
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000001',true);
select public.admin_save_goods_relation_composition('99000000-0000-4000-8000-000000000101',0,'99000000-0000-4000-8000-000000000201',pg_temp.visual_values()) as first_save \gset
select 1/case when public.admin_save_goods_relation_composition('99000000-0000-4000-8000-000000000101',0,'99000000-0000-4000-8000-000000000201',pg_temp.visual_values())=:'first_save'::jsonb then 1 else 0 end as exact_retry;
select pg_temp.visual_error($q$select public.admin_save_goods_relation_composition('99000000-0000-4000-8000-000000000101',0,'99000000-0000-4000-8000-000000000201',pg_temp.visual_values()||'{"title":"다른 본문"}')$q$,'PT409');
select pg_temp.visual_error($q$select public.admin_save_goods_relation_composition('99000000-0000-4000-8000-000000000101',0,gen_random_uuid(),pg_temp.visual_values())$q$,'PT409');
select pg_temp.visual_error($q$select public.admin_save_goods_relation_composition('99000000-0000-4000-8000-000000000102',0,gen_random_uuid(),pg_temp.visual_values())$q$,'unverified_artwork');
select pg_temp.visual_error($q$select public.admin_save_goods_relation('99000000-0000-4000-8000-000000000101',1,pg_temp.visual_values()-'visual')$q$,'goods_relation_visual_required');
-- Codi's direct-search mode is represented by an image and a list without points.
select public.admin_save_goods_relation_composition('99000000-0000-4000-8000-000000000102',0,gen_random_uuid(),jsonb_set(pg_temp.visual_values(302,'codi'),'{visual,hotspots}','[]'));
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000002',true);
select public.admin_save_goods_relation_composition('99000000-0000-4000-8000-000000000101',1,gen_random_uuid(),pg_temp.visual_values()||'{"title":"부매니저 유지"}');
do $$declare r jsonb;begin
 r:=public.admin_get_goods_relation('99000000-0000-4000-8000-000000000101');
 if r->>'revision'<>'2' or jsonb_array_length(r#>'{visual,hotspots}')<>3 or r#>>'{visual,hotspots,0,x}'<>'0' or r#>>'{visual,hotspots,0,y}'<>'10000' then raise exception 'Saved image points/revision incomplete';end if;
 if public.admin_list_goods_relations('','codi')->>'total'<>'1' then raise exception 'Codi filter missing';end if;
end $$;
reset role;
select 1/case when jsonb_array_length(private.goods_photo_references('public-media/catalog/curation/99000000-0000-4000-8000-000000000301.webp'))=1
 and private.goods_photo_references('public-media/catalog/curation/99000000-0000-4000-8000-000000000301.webp')#>>'{0,kind}'='relation'
 and (select count(*) from public.audit_log where id='99000000-0000-4000-8000-000000000201')=1 then 1 else 0 end as image_reference_and_single_audit;
set local role anon;
do $$declare r jsonb;g jsonb;begin
 r:=public.get_good_relation_compositions('relation-visual-b');
 if jsonb_array_length(r->'groups')<>2 then raise exception 'Image/codi did not expose on another member';end if;
 for g in select value from jsonb_array_elements(r->'groups') loop
  if jsonb_array_length(g->'allGoodIds')<>2 or g->'goodIds'<>'["relation-visual-a"]'::jsonb
   or g ?| array['revision','createdBy','updatedBy'] or g#>'{visual,hotspots}' @> '[{"goodId":"relation-visual-draft"}]'::jsonb then raise exception 'Hidden goods/private metadata leaked';end if;
 end loop;
 if jsonb_array_length(r#>'{groups,0,visual,hotspots}')<>0 or jsonb_array_length(r#>'{groups,1,visual,hotspots}')<>2 then raise exception 'Public point projection incorrect';end if;
 if public.get_good_relation_compositions('relation-visual-draft')<>'{"groups":[],"nextChangeAt":null}'::jsonb then raise exception 'Draft target exposed';end if;
end $$;
reset role;
-- Current visibility gates are evaluated again on every public request.
update public.goods set published_at=null where id='relation-visual-b';
select 1/case when public.get_good_relation_compositions('relation-visual-a')='{"groups":[],"nextChangeAt":null}'::jsonb then 1 else 0 end as minimum_public_members;
update public.goods set published_at=now() where id='relation-visual-b';
update public.goods set sale_restriction='adult' where id='relation-visual-a';
select 1/case when public.get_good_relation_compositions('relation-visual-b')='{"groups":[],"nextChangeAt":null}'::jsonb then 1 else 0 end as hidden_representative;
update public.goods set sale_restriction='none' where id='relation-visual-a';
update public.ips set published_at=null where id='relation-visual-ip';
select 1/case when public.get_good_relation_compositions('relation-visual-b')='{"groups":[],"nextChangeAt":null}'::jsonb then 1 else 0 end as private_parent;
update public.ips set published_at=now() where id='relation-visual-ip';
-- Stop codi to isolate the exact interval assertions for the image relation.
update public.goods_relations set enabled=false where id='99000000-0000-4000-8000-000000000102';
do $$begin
 update public.goods_relations set starts_at=statement_timestamp(),ends_at=statement_timestamp()+interval '1 day' where id='99000000-0000-4000-8000-000000000101';
 if jsonb_array_length(public.get_good_relation_compositions('relation-visual-a')->'groups')<>1 then raise exception 'Inclusive start lost';end if;
 update public.goods_relations set starts_at=null,ends_at=statement_timestamp() where id='99000000-0000-4000-8000-000000000101';
 if jsonb_array_length(public.get_good_relation_compositions('relation-visual-a')->'groups')<>0 then raise exception 'Exclusive end lost';end if;
 update public.goods_relations set starts_at=statement_timestamp()+interval '1 hour',ends_at=null where id='99000000-0000-4000-8000-000000000101';
 if (public.get_good_relation_compositions('relation-visual-a')->>'nextChangeAt')::timestamptz<>statement_timestamp()+interval '1 hour' then raise exception 'Future boundary missing';end if;
end $$;
update public.goods_relations set starts_at=null,ends_at=null where id='99000000-0000-4000-8000-000000000101';
-- The draft ID follows the existing goods rename contract into member and point FKs.
update public.goods set id='relation-visual-draft-renamed' where id='relation-visual-draft';
select 1/case when exists(select 1 from public.goods_relation_hotspots where relation_id='99000000-0000-4000-8000-000000000101' and good_id='relation-visual-draft-renamed')
 and not exists(select 1 from public.goods_relation_hotspots where good_id='relation-visual-draft') then 1 else 0 end as renamed_point_fk;
set local role authenticated;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000001',true);
do $$declare v jsonb;bad jsonb;begin
 v:=jsonb_set(jsonb_set(pg_temp.visual_values(),'{goodIds}','["relation-visual-a","relation-visual-b"]'),'{visual,hotspots}','[{"goodId":"relation-visual-b","x":5000,"y":5000}]');
 for bad in select value from jsonb_array_elements('[{"goodId":"missing","x":1,"y":1},{"goodId":"relation-visual-b","x":-1,"y":1},{"goodId":"relation-visual-b","x":10001,"y":1},{"goodId":"relation-visual-b","x":1.5,"y":1},{"goodId":"relation-visual-b","x":"1","y":1},{"goodId":"relation-visual-b","x":1,"y":1,"url":"https://outside.test"}]') loop
  perform pg_temp.visual_error(format('select public.admin_save_goods_relation_composition(%L,2,gen_random_uuid(),%L::jsonb)','99000000-0000-4000-8000-000000000101',jsonb_set(v,'{visual,hotspots}',jsonb_build_array(bad))::text),'invalid_goods_relation_visual');
 end loop;
 perform pg_temp.visual_error(format('select public.admin_save_goods_relation_composition(%L,2,gen_random_uuid(),%L::jsonb)','99000000-0000-4000-8000-000000000101',jsonb_set(v,'{visual,hotspots}',(v#>'{visual,hotspots}')||(v#>'{visual,hotspots}'))::text),'invalid_goods_relation_visual');
 perform pg_temp.visual_error(format('select public.admin_save_goods_relation_composition(%L,2,gen_random_uuid(),%L::jsonb)','99000000-0000-4000-8000-000000000101',jsonb_set(v,'{visual,imagePath}','"https://outside.test/image.png"')::text),'invalid_goods_relation_visual');
 perform public.admin_save_goods_relation_composition('99000000-0000-4000-8000-000000000101',2,gen_random_uuid(),v);
end $$;
reset role;
select 1/case when (select count(*) from public.goods_relation_hotspots where relation_id='99000000-0000-4000-8000-000000000101')=1 then 1 else 0 end as removed_members_remove_points;
set local role authenticated;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000003',true);
select pg_temp.visual_error($q$select public.admin_save_goods_relation_composition(gen_random_uuid(),0,gen_random_uuid(),pg_temp.visual_values())$q$,'operator_capability_required');
select 1/case when (select count(*) from public.goods_relation_hotspots where relation_id='99000000-0000-4000-8000-000000000101')=0 then 1 else 0 end as logistics_read_hidden;
select set_config('request.jwt.claim.sub','99000000-0000-4000-8000-000000000004',true);
select pg_temp.visual_error($q$select public.admin_get_goods_relation('99000000-0000-4000-8000-000000000101')$q$,'42501');
select pg_temp.visual_error($q$insert into public.goods_relation_hotspots values('99000000-0000-4000-8000-000000000101','relation-visual-a',100,100)$q$,'42501');
reset role;
select 1/case when has_function_privilege('anon','public.get_good_relation_compositions(text)','execute')
 and not has_function_privilege('service_role','public.get_good_relation_compositions(text)','execute')
 and not has_function_privilege('anon','public.admin_save_goods_relation_composition(uuid,integer,uuid,jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_save_goods_relation_composition(uuid,integer,uuid,jsonb)','execute')
 and not has_function_privilege('authenticated','private.validate_goods_relation_composition(jsonb)','execute')
 and not has_table_privilege('authenticated','public.goods_relation_hotspots','insert')
 and not has_table_privilege('anon','public.goods_relation_hotspots','select') then 1 else 0 end as relation_visual_acl;
rollback;
