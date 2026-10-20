\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql. Run only in an isolated local database.
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000062201','authenticated','authenticated','announcement-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000062202','authenticated','authenticated','announcement-member@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000062201';
insert into public.verticals(key,label,color) values('announcement-test','공지검증','#000');
insert into public.ips(id,title,vertical_key,published_at) values('announcement-ip','공지검증','announcement-test',now());
insert into public.goods(id,code,ip_id,name,type,price,stock) values
 ('announcement-good-a','ANNOUNCEMENT-A','announcement-ip','공지 상품 A','문구',1000,'ok'),
 ('announcement-good-b','ANNOUNCEMENT-B','announcement-ip','공지 상품 B','문구',2000,'ok'),
 ('announcement-good-draft','ANNOUNCEMENT-DRAFT','announcement-ip','비공개 상품','문구',1000,'ok');
update public.goods set image_path='public-media/announcement-fixture.webp',notice_maker='합성',notice_origin='한국',notice_material='종이',notice_size='A5',notice_made_on='2026',notice_as_manager='합성 CS',notice_as_contact='02-000' where id like 'announcement-good-%';
select pg_temp.publish_goods_kc_fixture('announcement-good-a');
select pg_temp.publish_goods_kc_fixture('announcement-good-b');
create function pg_temp.announcement_payload(title text,enabled boolean default true,all_goods boolean default true,ids text[] default '{}',starts timestamptz default null,ends timestamptz default null)
returns jsonb language sql as $$ select jsonb_build_object('title',title,'body','안내 본문','format','plain','category','general','device','all',
  'enabled',enabled,'important',false,'allGoods',all_goods,'goodIds',ids,'startsAt',starts,'endsAt',ends); $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000062201',true);
select public.admin_save_goods_announcement('00000000-0000-4000-8000-000000062211',0,pg_temp.announcement_payload('전체 공지'));
select public.admin_save_goods_announcement('00000000-0000-4000-8000-000000062212',0,pg_temp.announcement_payload('선택 중요 공지',true,false,array['announcement-good-a'])||'{"important":true,"device":"mobile"}') as saved_selected \gset
select public.admin_save_goods_announcement('00000000-0000-4000-8000-000000062213',0,pg_temp.announcement_payload('예정 공지',true,false,array['announcement-good-a'],now()+interval '1 hour',now()+interval '2 hours'));
select public.admin_save_goods_announcement('00000000-0000-4000-8000-000000062214',0,pg_temp.announcement_payload('종료 공지',true,true,'{}',now()-interval '2 hours',now()));
select public.admin_save_goods_announcement('00000000-0000-4000-8000-000000062215',0,pg_temp.announcement_payload('중지 공지',false));
select public.admin_save_goods_announcement('00000000-0000-4000-8000-000000062216',0,pg_temp.announcement_payload('다른 상품 공지',true,false,array['announcement-good-b']));
select public.admin_get_goods_announcement('00000000-0000-4000-8000-000000062212') as readback \gset
select 1/case when :'readback'::jsonb->>'title'='선택 중요 공지' and (:'readback'::jsonb->>'revision')::int=1
 and :'readback'::jsonb->'goods'->0->>'id'='announcement-good-a' and :'readback'::jsonb->'goods'->0->>'name'='공지 상품 A'
 then 1 else 0 end as assert_create_readback_and_product_link;
select 1/case when (public.admin_list_goods_announcements(p_state=>'shown')->>'total')::int=3
 and (public.admin_list_goods_announcements(p_state=>'waiting')->>'total')::int=1
 and (public.admin_list_goods_announcements(p_state=>'stopped')->>'total')::int=2
 and (public.admin_list_goods_announcements(p_query=>:'readback'::jsonb->>'reference',p_field=>'reference')->>'total')::int=1
 then 1 else 0 end as assert_state_and_reference_filters;
do $$ begin
 begin perform public.admin_save_goods_announcement('00000000-0000-4000-8000-000000062212',0,pg_temp.announcement_payload('재시도'));
   raise exception 'stale revision accepted'; exception when sqlstate 'PT409' then null; end;
 begin perform public.admin_save_goods_announcement('00000000-0000-4000-8000-000000062219',0,pg_temp.announcement_payload('상품 누락',true,false));
   raise exception 'empty selected goods accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_save_goods_announcement('00000000-0000-4000-8000-000000062219',0,pg_temp.announcement_payload('상품 없음',true,false,array['missing']));
   raise exception 'missing good accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_save_goods_announcement('00000000-0000-4000-8000-000000062219',0,pg_temp.announcement_payload('역방향 기간',true,true,'{}',now(),now()-interval '1 hour'));
   raise exception 'backwards period accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.admin_save_goods_announcement('00000000-0000-4000-8000-000000062219',0,pg_temp.announcement_payload('알 수 없는 값')||'{"unknown":true}');
   raise exception 'unknown key accepted'; exception when invalid_parameter_value then null; end;
end $$;
select public.admin_search_goods_for_announcement('ANNOUNCEMENT-A',1) as candidates \gset
select 1/case when (:'candidates'::jsonb->>'total')::int=1 and :'candidates'::jsonb->'rows'->0->>'id'='announcement-good-a'
 then 1 else 0 end as assert_goods_picker_code_search;
reset role;
set local role anon;
select public.get_good_announcements('announcement-good-a') as public_a \gset
select public.get_good_announcements('announcement-good-b') as public_b \gset
select 1/case when jsonb_array_length(:'public_a'::jsonb->'items')=2
 and :'public_a'::jsonb->'items'->0->>'title'='선택 중요 공지'
 and :'public_a'::jsonb->'items'->0->>'device'='mobile'
 and :'public_a'::jsonb->>'nextChangeAt' is not null
 and jsonb_array_length(:'public_b'::jsonb->'items')=2
 and not ((:'public_a'::jsonb->'items'->0)?'created_by') and not ((:'public_a'::jsonb->'items'->0)?'revision')
 and jsonb_array_length(public.get_good_announcements('announcement-good-draft')->'items')=0
 and jsonb_array_length(public.get_good_announcements('missing')->'items')=0
 then 1 else 0 end as assert_public_product_scope_period_priority_and_minimal_projection;
reset role;
update public.goods set sale_restriction='adult' where id='announcement-good-a';
set local role anon;
select 1/case when jsonb_array_length(public.get_good_announcements('announcement-good-a')->'items')=0 then 1 else 0 end as assert_restricted_product_has_no_announcements;
reset role;
update public.goods set sale_restriction='none' where id='announcement-good-a';
update public.ips set published_at=null where id='announcement-ip';
set local role anon;
select 1/case when jsonb_array_length(public.get_good_announcements('announcement-good-b')->'items')=0 then 1 else 0 end as assert_private_ip_has_no_announcements;
reset role;
update public.ips set published_at=now() where id='announcement-ip';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000062201',true);
select public.admin_save_goods_announcement('00000000-0000-4000-8000-000000062212',1,pg_temp.announcement_payload('수정 후 중지',false,false,array['announcement-good-b']));
select public.admin_get_goods_announcement('00000000-0000-4000-8000-000000062212') as updated \gset
select 1/case when (:'updated'::jsonb->>'revision')::int=2 and :'updated'::jsonb->>'title'='수정 후 중지'
 and jsonb_array_length(:'updated'::jsonb->'goods')=1 and :'updated'::jsonb->'goods'->0->>'id'='announcement-good-b'
 and jsonb_array_length(public.get_good_announcements('announcement-good-a')->'items')=1
 then 1 else 0 end as assert_update_replaces_link_set_and_public_visibility;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000062202',true);
select 1/case when (select count(*) from public.goods_announcements)=0 and (select count(*) from public.goods_announcement_goods)=0 then 1 else 0 end as assert_member_rls;
do $$ begin
 begin perform public.admin_list_goods_announcements(); raise exception 'member list allowed'; exception when insufficient_privilege then null; end;
 begin perform public.admin_get_goods_announcement('00000000-0000-4000-8000-000000062212'); raise exception 'member detail allowed'; exception when insufficient_privilege then null; end;
 begin perform public.admin_search_goods_for_announcement(); raise exception 'member picker allowed'; exception when insufficient_privilege then null; end;
 begin perform public.admin_save_goods_announcement('00000000-0000-4000-8000-000000062219',0,pg_temp.announcement_payload('침범')); raise exception 'member save allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 1/case when (select count(*) from public.audit_log where target='goods_announcement:00000000-0000-4000-8000-000000062212')=2
 and not has_table_privilege('authenticated','public.goods_announcements','insert')
 and not has_function_privilege('anon','public.admin_save_goods_announcement(uuid,integer,jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_save_goods_announcement(uuid,integer,jsonb)','execute')
 and has_function_privilege('anon','public.get_good_announcements(text)','execute')
 then 1 else 0 end as assert_audit_and_execute_grants;
rollback;
