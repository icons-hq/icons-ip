\set ON_ERROR_STOP on
begin;
create function pg_temp.marketing_expect(q text,expected text) returns void language plpgsql as $$
begin begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;raise exception 'expected %',expected;end $$;
create function pg_temp.marketing_id(n integer) returns uuid language sql immutable as $$select ('bfc01900-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.marketing_id(n),'authenticated','authenticated','marketing-test-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,5)n;
update public.profiles set role=case when id in(pg_temp.marketing_id(1),pg_temp.marketing_id(2)) then 'staff'::public.user_role else 'user'::public.user_role end,
 nickname='marketing_'||right(id::text,2),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true,"marketing":true}' where id::text like 'bfc01900-%';
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.marketing_id(1),'primary'),(pg_temp.marketing_id(2),'deputy');
insert into public.ips(id,title,vertical_key) select 'marketing-test-ip','마케팅 합성 IP',key from public.verticals limit 1;
insert into public.ip_follows(user_id,ip_id) values(pg_temp.marketing_id(3),'marketing-test-ip'),(pg_temp.marketing_id(4),'marketing-test-ip');
create function pg_temp.marketing_values(p_exclusion text default 'none') returns jsonb language sql as $$
 select jsonb_build_object('name','마케팅 합성 검사','segmentId',pg_temp.marketing_id(100),'segmentRevision',1,
 'content',jsonb_build_object('template','text','title','검사 안내','body','인앱 마케팅 원장 검사','imagePath',null,'goodIds','[]'::jsonb,'buttons',jsonb_build_array(jsonb_build_object('label','굿즈 보기','path','/shop'))),
 'schedule',jsonb_build_object('kind','once','at',(((statement_timestamp() at time zone 'Asia/Seoul')::date+1)+time '10:00') at time zone 'Asia/Seoul'),'exclusion',p_exclusion);
$$;

insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values(pg_temp.marketing_id(900),pg_temp.marketing_id(1),now(),now(),now()+interval '1 hour');
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,issue_starts_at,issue_ends_at,ends_at,status,recipient_segment)
 values('ATTACH-TEST','TEST 첨부 쿠폰','fixed',1000,10000,now()-interval '1 day',now()-interval '1 day',now()+interval '7 days',now()+interval '30 days','active','first_purchase');
select set_config('request.jwt.claim.sub',pg_temp.marketing_id(1)::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.marketing_id(1),'session_id',pg_temp.marketing_id(900),'role','authenticated')::text,true);
set local role authenticated;
select public.admin_estimate_customer_segment('{"version":1,"target":"ip_notifications","ipId":"marketing-test-ip"}',pg_temp.marketing_id(101));
select public.admin_save_customer_segment(pg_temp.marketing_id(100),0,pg_temp.marketing_id(102),'마케팅 합성 세그먼트','{"version":1,"target":"ip_notifications","ipId":"marketing-test-ip"}',pg_temp.marketing_id(101));
select 1/case when public.admin_marketing_coupon_options('ATTACH-TEST')#>>'{rows,0,code}'='ATTACH-TEST' then 1 else 0 end as assert_coupon_option;
select public.admin_save_marketing_campaign(pg_temp.marketing_id(201),0,pg_temp.marketing_id(301),jsonb_set(pg_temp.marketing_values(),'{content,couponCode}','"ATTACH-TEST"'),false);
select public.admin_send_marketing_test(pg_temp.marketing_id(201),1,pg_temp.marketing_id(401),pg_temp.marketing_id(1),pg_temp.marketing_id(900)) as receipt \gset
select 1/case when public.admin_send_marketing_test(pg_temp.marketing_id(201),1,pg_temp.marketing_id(401),pg_temp.marketing_id(1),pg_temp.marketing_id(900))=:'receipt'::jsonb then 1 else 0 end as assert_exact_test_replay;
select 1/case when public.get_my_marketing_test_receipt(pg_temp.marketing_id(401))#>>'{content,couponCode}'='ATTACH-TEST'
 and public.get_my_marketing_test_receipt(pg_temp.marketing_id(401))#>>'{coupon,discountValue}'='1000' then 1 else 0 end as assert_self_test_content;
select pg_temp.marketing_expect($q$select public.admin_send_marketing_test(pg_temp.marketing_id(201),1,pg_temp.marketing_id(402),pg_temp.marketing_id(2),pg_temp.marketing_id(900))$q$,'marketing_test_auth_changed');
select pg_temp.marketing_expect($q$select public.admin_send_marketing_test(pg_temp.marketing_id(201),2,pg_temp.marketing_id(402),pg_temp.marketing_id(1),pg_temp.marketing_id(900))$q$,'marketing_campaign_changed');
reset role;
select 1/case when (select count(*)=1 from public.notifications where source_type='marketing_test' and source_id=pg_temp.marketing_id(401)::text)
 and not exists(select 1 from private.marketing_runs where campaign_id=pg_temp.marketing_id(201))
 and not exists(select 1 from public.user_coupons where coupon_code='ATTACH-TEST') then 1 else 0 end as assert_self_only_no_campaign_or_coupon_side_effect;
select 1/case when (select user_id=pg_temp.marketing_id(1) and title like '[테스트] %' from public.notifications where id=(:'receipt'::jsonb->>'notificationId')::uuid) then 1 else 0 end as assert_recipient_not_user_supplied;
select set_config('request.jwt.claim.sub',pg_temp.marketing_id(3)::text,true);
set local role authenticated;
select pg_temp.marketing_expect($q$select public.get_my_marketing_test_receipt(pg_temp.marketing_id(401))$q$,'42501');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.marketing_id(1)::text,true);
set local role authenticated;
select public.admin_save_marketing_campaign(pg_temp.marketing_id(201),1,pg_temp.marketing_id(302),jsonb_set(jsonb_set(pg_temp.marketing_values(),'{content,couponCode}','"ATTACH-TEST"'),'{content,body}','"변경 후 메시지"'),true,pg_temp.marketing_id(101));
select 1/case when public.get_my_marketing_test_receipt(pg_temp.marketing_id(401))#>>'{content,body}'='인앱 마케팅 원장 검사' then 1 else 0 end as assert_test_snapshot_not_later_edit;
reset role;
select private.process_marketing_run(id,scheduled_at) from private.marketing_runs where campaign_id=pg_temp.marketing_id(201);
select private.process_marketing_run(id,scheduled_at) from private.marketing_runs where campaign_id=pg_temp.marketing_id(201);
select id as recipient_id from private.marketing_recipients where customer_id=pg_temp.marketing_id(3) and run_id=(select id from private.marketing_runs where campaign_id=pg_temp.marketing_id(201)) \gset
select set_config('request.jwt.claim.sub',pg_temp.marketing_id(3)::text,true);
set local role authenticated;
select 1/case when public.get_my_marketing_message(:'recipient_id')#>>'{content,couponCode}'='ATTACH-TEST'
 and public.get_my_marketing_message(:'recipient_id')#>>'{coupon,name}'='TEST 첨부 쿠폰' then 1 else 0 end as assert_real_recipient_coupon_readback;
select public.claim_coupon_code('ATTACH-TEST') as held_id \gset
select 1/case when public.claim_coupon_code('ATTACH-TEST')=:'held_id'::uuid then 1 else 0 end as assert_receive_coupon_once;
reset role;
select 1/case when (select issued_count=1 from public.coupons where code='ATTACH-TEST') and (select count(*)=1 from public.user_coupons where coupon_code='ATTACH-TEST') then 1 else 0 end as assert_coupon_ledger_once;
update public.coupons set status='archived' where code='ATTACH-TEST';
set local role authenticated;
select 1/case when public.get_my_marketing_message(:'recipient_id')#>>'{coupon,available}'='false' then 1 else 0 end as assert_current_coupon_availability;
select pg_temp.marketing_expect($q$select public.claim_coupon_code('ATTACH-TEST')$q$,'coupon_not_found');
reset role;
update private.operator_memberships set manager_role='deputy' where profile_id=pg_temp.marketing_id(1);
select set_config('request.jwt.claim.sub',pg_temp.marketing_id(1)::text,true);
set local role authenticated;
select pg_temp.marketing_expect($q$select public.get_my_marketing_test_receipt(pg_temp.marketing_id(401))$q$,'42501');
select pg_temp.marketing_expect($q$select public.admin_send_marketing_test(pg_temp.marketing_id(201),1,pg_temp.marketing_id(401),pg_temp.marketing_id(1),pg_temp.marketing_id(900))$q$,'operator_capability_required');
reset role;
select 1/case when not has_table_privilege('authenticated','private.marketing_test_receipts','select')
 and not has_function_privilege('service_role','public.admin_send_marketing_test(uuid,integer,uuid,uuid,uuid)','execute') then 1 else 0 end as assert_sealed_receipts;
update private.marketing_test_receipts set content=content||'{"imagePath":"public-media/catalog/curation/bfc01900-0000-4000-8000-000000000001.png"}' where id=pg_temp.marketing_id(401);
select 1/case when exists(select 1 from jsonb_array_elements(private.goods_photo_references('public-media/catalog/curation/bfc01900-0000-4000-8000-000000000001.png')) item where item->>'kind'='marketing_test') then 1 else 0 end as assert_test_snapshot_image_reference;
select pg_temp.marketing_expect(format('select private.normalize_marketing_content(%L::jsonb)',(pg_temp.marketing_values()->'content')||'{"couponCode":"//wrong"}'),'invalid_marketing_coupon');
rollback;
