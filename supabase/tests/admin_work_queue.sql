\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000053101','authenticated','authenticated','work-queue-staff@example.test','{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000053102','authenticated','authenticated','work-queue-member@example.test','{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000053101';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000053101',true);
select public.admin_search_shipments('ready',null,null,null,null,1,0)->'counts' as before_shipments \gset
select total as before_inquiries from public.admin_inquiry_status_counts() where status='open' \gset
insert into public.orders(id,user_id,status,total,shipping_fee,address,confirmed_at) values
 ('53100000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000053102','paid',10000,3000,'{"recipientName":"합성 수취인"}',null),
 ('53100000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000053102','confirmed',20000,3000,'{"recipientName":"합성 수취인"}',now()),
 ('53100000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000053102','confirmed',30000,3000,'{"recipientName":"합성 수취인"}',now()-interval '4 days');
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot) values
 ('53200000-0000-4000-8000-000000000001','53100000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000042201','김포',3000,'{}'),
 ('53200000-0000-4000-8000-000000000002','53100000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000042202','남양주',3000,'{}'),
 ('53200000-0000-4000-8000-000000000003','53100000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000042201','김포',3000,'{}'),
 ('53200000-0000-4000-8000-000000000004','53100000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000042201','김포',3000,'{}');
insert into public.inquiries(user_id,category,title,status,answered_at) values
 ('00000000-0000-4000-8000-000000053102','etc','업무 큐 합성 미응답 1','open',null),
 ('00000000-0000-4000-8000-000000053102','etc','업무 큐 합성 미응답 2','open',null),
 ('00000000-0000-4000-8000-000000053102','etc','업무 큐 합성 답변','answered',now());
set local role authenticated;
select 1/case when (select total_count from public.admin_search_orders(p_status=>'paid',p_limit=>1,p_query=>'53100000'))=1
 and public.admin_search_shipments('new',null,'53100000',null,null,1,0)->>'total'='2' then 1 else 0 end as assert_one_order_has_two_new_shipments;
select 1/case when (public.admin_search_shipments('ready',null,null,null,null,1,0)#>>'{counts,ready}')::int=(:'before_shipments'::jsonb->>'ready')::int+2
 and (public.admin_search_shipments('ready',null,null,null,null,1,0)#>>'{counts,delayed}')::int=(:'before_shipments'::jsonb->>'delayed')::int+1
 and public.admin_search_shipments('ready',null,'53100000',null,null,1,0)->>'total'='2'
 and public.admin_search_shipments('delayed',null,'53100000',null,null,1,0)->>'total'='1' then 1 else 0 end as assert_counts_use_list_delay_and_page_independent_totals;
select 1/case when (select total from public.admin_inquiry_status_counts() where status='open')=(:'before_inquiries')::int+2
 and (select total_count from public.admin_search_inquiries(p_status=>'open',p_query=>'업무 큐 합성',p_field=>'title',p_limit=>1))=2 then 1 else 0 end as assert_unanswered_count_matches_open_list;
select 1/case when public.admin_search_shipments('ready',null,'no-queue-fixture-match',null,null,1,0)->>'total'='0'
 and not exists(select 1 from public.admin_search_orders(p_status=>'paid',p_limit=>1,p_query=>'no-queue-fixture-match')) then 1 else 0 end as assert_verified_empty_sources;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000053102',true);
do $$ begin
 begin perform public.admin_search_orders(p_status=>'paid',p_limit=>1); raise exception 'member read orders'; exception when insufficient_privilege then null; end;
 begin perform public.admin_search_shipments('ready'); raise exception 'member read shipments'; exception when insufficient_privilege then null; end;
 begin perform public.admin_inquiry_status_counts(); raise exception 'member read inquiry counts'; exception when insufficient_privilege then null; end;
end $$;
rollback;
