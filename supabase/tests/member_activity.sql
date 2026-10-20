\set ON_ERROR_STOP on
begin;
-- Restore automatically at rollback, even if the disposable browser runtime has
-- already enabled collection for its separate UI checks.
update private.member_activity_settings set enabled=false,enabled_since=null,revision=1 where singleton;
create function pg_temp.ma_error(q text,wanted text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if position(wanted in sqlerrm)>0 then return;end if;raise;end;
 raise exception 'Expected error: %',wanted;
end$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('a6161000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','member-activity-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,3)n;
update public.profiles set nickname='TEST 분석'||right(id::text,4),role=(case when id='a6161000-0000-4000-8000-000000000001' then 'admin' else 'user' end)::public.user_role,
 birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true,"marketing":false}' where id::text like 'a6161000-%';
insert into private.operator_memberships(profile_id,manager_role) values('a6161000-0000-4000-8000-000000000001','primary');
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select ('a6161000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid,
 ('a6161000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now(),now()+interval '1 hour' from generate_series(1,3)n;
insert into public.ips(id,title,vertical_key,published_at) values('member-activity-ip','TEST 분석 IP','character',now());
insert into public.catalog_categories(id,code,name) values('a6161000-0000-4000-8000-000000000501','member-activity-category','TEST 분석 분류');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,category_id) values
 ('member-activity-good','member-activity-ip','TEST 분석 상품','문구',1000,'ok',10,'a6161000-0000-4000-8000-000000000501'),
 ('member-activity-similar','member-activity-ip','TEST 유사 상품','문구',1000,'ok',10,'a6161000-0000-4000-8000-000000000501');
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values(('47c47700'||left(md5('member-activity-good'),24))::uuid,'authenticated','authenticated','member-activity-kc@example.test','{"testFixture":"goods-kc"}','{}',now(),now());
insert into private.operator_memberships(profile_id,manager_role) values(('47c47700'||left(md5('member-activity-good'),24))::uuid,'primary');
select pg_temp.publish_goods_kc_fixture('member-activity-good');
insert into private.goods_media_assets(id,kind,path,source_size,status,expires_at,metadata) values
 ('a6161000-0000-4000-8000-000000000502','video','video/a6161000-0000-4000-8000-000000000502.mp4',100,'attached',now()+interval '1 day','{}');
insert into private.goods_media_bindings(good_id,video_asset_id,video_title) values('member-activity-good','a6161000-0000-4000-8000-000000000502','TEST 동영상');
set local role authenticated;
select set_config('request.jwt.claim.sub','a6161000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"a6161000-0000-4000-8000-000000000002","role":"authenticated","session_id":"a6161000-0000-4000-8000-000000000102"}',true);
select 1/case when public.member_activity_state()->>'choice'='unset' and public.member_activity_state()->>'enabled'='false' then 1 else 0 end as assert_default_off;
select pg_temp.ma_error($q$select public.set_member_activity_consent('accepted',0,'a6161000-0000-4000-8000-000000000002','a6161000-0000-4000-8000-000000000102','member-activity-v1')$q$,'member_activity_disabled');
select set_config('request.jwt.claim.sub','a6161000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a6161000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a6161000-0000-4000-8000-000000000101"}',true);
select public.admin_save_member_activity_settings(true,1,'a6161000-0000-4000-8000-000000000201','a6161000-0000-4000-8000-000000000001','a6161000-0000-4000-8000-000000000101') as settings \gset
select 1/case when public.admin_save_member_activity_settings(true,1,'a6161000-0000-4000-8000-000000000201','a6161000-0000-4000-8000-000000000001','a6161000-0000-4000-8000-000000000101')=:'settings'::jsonb then 1 else 0 end as assert_settings_replay;
select set_config('request.jwt.claim.sub','a6161000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"a6161000-0000-4000-8000-000000000002","role":"authenticated","session_id":"a6161000-0000-4000-8000-000000000102"}',true);
select pg_temp.ma_error($q$select public.record_member_activity_event('a6161000-0000-4000-8000-000000000301','visit','home','home',null,0,'a6161000-0000-4000-8000-000000000002','a6161000-0000-4000-8000-000000000102')$q$,'member_activity_consent_required');
select public.set_member_activity_consent('accepted',0,'a6161000-0000-4000-8000-000000000002','a6161000-0000-4000-8000-000000000102','member-activity-v1') as consent \gset
select 1/case when :'consent'::jsonb->>'revision'='1' and :'consent'::jsonb->>'choice'='accepted' then 1 else 0 end as assert_consent_readback;
select public.record_member_activity_event('a6161000-0000-4000-8000-000000000301','visit','home','home',null,1,'a6161000-0000-4000-8000-000000000002','a6161000-0000-4000-8000-000000000102');
select 1/case when public.record_member_activity_event('a6161000-0000-4000-8000-000000000301','visit','home','home',null,1,'a6161000-0000-4000-8000-000000000002','a6161000-0000-4000-8000-000000000102')->>'duplicate'='true' then 1 else 0 end as assert_event_replay;
select pg_temp.ma_error($q$select public.record_member_activity_event('a6161000-0000-4000-8000-000000000301','visit','shop','all',null,1,'a6161000-0000-4000-8000-000000000002','a6161000-0000-4000-8000-000000000102')$q$,'member_activity_event_conflict');
select pg_temp.ma_error($q$select public.record_member_activity_event('a6161000-0000-4000-8000-000000000302','visit','good','unpublished',null,1,'a6161000-0000-4000-8000-000000000002','a6161000-0000-4000-8000-000000000102')$q$,'member_activity_target_unavailable');
select pg_temp.ma_error($q$select public.set_member_activity_consent('declined',1,'a6161000-0000-4000-8000-000000000003','a6161000-0000-4000-8000-000000000103','member-activity-v1')$q$,'member_activity_auth_changed');
select public.set_member_activity_consent('declined',1,'a6161000-0000-4000-8000-000000000002','a6161000-0000-4000-8000-000000000102','member-activity-v1');
reset role;
select 1/case when not exists(select 1 from private.member_activity_events where user_id='a6161000-0000-4000-8000-000000000002') then 1 else 0 end as assert_withdrawal_erases_events;
set local role authenticated;
select pg_temp.ma_error($q$select public.record_member_activity_event('a6161000-0000-4000-8000-000000000303','visit','home','home',null,1,'a6161000-0000-4000-8000-000000000002','a6161000-0000-4000-8000-000000000102')$q$,'member_activity_consent_required');
select public.set_member_activity_consent('accepted',2,'a6161000-0000-4000-8000-000000000002','a6161000-0000-4000-8000-000000000102','member-activity-v1');
select public.record_member_activity_event('a6161000-0000-4000-8000-000000000304','visit','home','home',null,3,'a6161000-0000-4000-8000-000000000002','a6161000-0000-4000-8000-000000000102');
select public.record_member_activity_event('a6161000-0000-4000-8000-000000000305','visit','good','member-activity-good',null,3,'a6161000-0000-4000-8000-000000000002','a6161000-0000-4000-8000-000000000102');
select public.record_member_activity_event('a6161000-0000-4000-8000-000000000306','video_started','good','member-activity-good','a6161000-0000-4000-8000-000000000502',3,'a6161000-0000-4000-8000-000000000002','a6161000-0000-4000-8000-000000000102');
select pg_temp.ma_error($q$select public.record_member_activity_event('a6161000-0000-4000-8000-000000000307','video_started','good','member-activity-good','a6161000-0000-4000-8000-000000000503',3,'a6161000-0000-4000-8000-000000000002','a6161000-0000-4000-8000-000000000102')$q$,'member_activity_video_unavailable');
reset role;
select 1/case when exists(select 1 from private.customer_segment_members('{"version":1,"target":"product_viewed","goodsScope":"goods","goodIds":["member-activity-good"]}',clock_timestamp()) where customer_id='a6161000-0000-4000-8000-000000000002')
 and exists(select 1 from private.customer_segment_members('{"version":1,"target":"video_viewed","goodsScope":"category","categoryId":"a6161000-0000-4000-8000-000000000501"}',clock_timestamp()) where customer_id='a6161000-0000-4000-8000-000000000002')
 and exists(select 1 from private.customer_segment_members('{"version":1,"target":"similar_product_viewed","goodsScope":"goods","goodIds":["member-activity-similar"]}',clock_timestamp()) where customer_id='a6161000-0000-4000-8000-000000000002')
 and not exists(select 1 from private.customer_segment_members('{"version":1,"target":"similar_product_viewed","goodsScope":"goods","goodIds":["member-activity-good"]}',clock_timestamp()) where customer_id='a6161000-0000-4000-8000-000000000002') then 1 else 0 end as assert_product_video_similar_scopes;
select 1/case when exists(select 1 from private.customer_segment_members('{"version":1,"target":"visited"}',clock_timestamp()) where customer_id='a6161000-0000-4000-8000-000000000002' and marketing_consent=false)
 and not exists(select 1 from private.customer_segment_members('{"version":1,"target":"not_visited"}',clock_timestamp()) where customer_id='a6161000-0000-4000-8000-000000000003') then 1 else 0 end as assert_opt_in_and_marketing_separate;
insert into private.member_activity_consents(user_id,choice,notice_version,revision,accepted_at) values('a6161000-0000-4000-8000-000000000003','accepted','member-activity-v1',1,now()-interval '31 days');
select 1/case when not exists(select 1 from private.customer_segment_members('{"version":1,"target":"not_visited"}',clock_timestamp()) where customer_id='a6161000-0000-4000-8000-000000000003') then 1 else 0 end as assert_observation_coverage_required;
update private.member_activity_settings set enabled_since=now()-interval '31 days' where singleton;
select 1/case when exists(select 1 from private.customer_segment_members('{"version":1,"target":"not_visited"}',clock_timestamp()) where customer_id='a6161000-0000-4000-8000-000000000003')
 and not exists(select 1 from private.customer_segment_members('{"version":1,"target":"not_visited"}',clock_timestamp()) where customer_id='a6161000-0000-4000-8000-000000000002') then 1 else 0 end as assert_nonvisitor_requires_full_consent_window;
insert into private.member_activity_events(user_id,event_id,consent_revision,kind,page_kind,target_id,observed_at)
 values('a6161000-0000-4000-8000-000000000002','a6161000-0000-4000-8000-000000000399',3,'visit','home','home',now()-interval '91 days');
select coalesce(current_setting('request.jwt.claims',true),'{}') as retention_previous_claims \gset
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.process_member_activity_retention();
reset role;
select set_config('request.jwt.claims',:'retention_previous_claims',true);
select 1/case when not exists(select 1 from private.member_activity_events where event_id='a6161000-0000-4000-8000-000000000399')
 and exists(select 1 from private.member_activity_events where event_id='a6161000-0000-4000-8000-000000000304') then 1 else 0 end as assert_retention_only_expired;
select 1/case when not has_table_privilege('authenticated','private.member_activity_events','select')
 and not has_table_privilege('service_role','private.member_activity_consents','select')
 and not has_function_privilege('anon','public.record_member_activity_event(uuid,text,text,text,uuid,bigint,uuid,uuid)','execute')
 and not has_function_privilege('authenticated','public.process_member_activity_retention()','execute') then 1 else 0 end as assert_sealed_roles;
insert into private.account_deletion_requests(deletion_event_id,subject_user_id,idempotency_key,status)
 values('a6161000-0000-4000-8000-000000000401','a6161000-0000-4000-8000-000000000002','a6161000-0000-4000-8000-000000000402','awaiting_email_intent');
insert into private.account_action_fences(subject_user_id,deletion_event_id) values('a6161000-0000-4000-8000-000000000002','a6161000-0000-4000-8000-000000000401');
select 1/case when not exists(select 1 from private.member_activity_events where user_id='a6161000-0000-4000-8000-000000000002')
 and (select choice='declined' from private.member_activity_consents where user_id='a6161000-0000-4000-8000-000000000002') then 1 else 0 end as assert_deletion_fence_purges;
rollback;
