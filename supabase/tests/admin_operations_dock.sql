\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('00000000-0000-4000-8000-'||lpad((69000+i)::text,12,'0'))::uuid,'authenticated','authenticated','operations-dock-'||i||'@example.test','{}','{}',now(),now() from generate_series(1,3)i;
update public.profiles set role='staff' where id in('00000000-0000-4000-8000-000000069001','00000000-0000-4000-8000-000000069002');
insert into public.ips(id,title,vertical_key)values('ops-dock-test','운영 알림 합성 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty)values('ops-dock-good','ops-dock-test','알림 검수 상품','문구',1000,'ok',10);
insert into public.orders(id,user_id,status,total)values('00000000-0000-4000-8000-000000069101','00000000-0000-4000-8000-000000069003','pending',1000);
update public.orders set status='paid' where id='00000000-0000-4000-8000-000000069101';
update public.orders set status='paid' where id='00000000-0000-4000-8000-000000069101';
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage)values
 ('00000000-0000-4000-8000-000000069201','00000000-0000-4000-8000-000000069101','00000000-0000-4000-8000-000000069003','합성 요청','cancel','requested');
update public.order_cancellation_requests set status='needs_review' where id='00000000-0000-4000-8000-000000069201';
insert into public.inquiries(id,user_id,category,title)values('00000000-0000-4000-8000-000000069301','00000000-0000-4000-8000-000000069003','etc','이 본문은 알림에 저장하지 않음');
update public.inquiries set status='answered',answered_at=clock_timestamp() where id='00000000-0000-4000-8000-000000069301';
update public.inquiries set status='open',last_message_at=clock_timestamp() where id='00000000-0000-4000-8000-000000069301';
insert into public.product_questions(id,good_id,user_id,body)values('00000000-0000-4000-8000-000000069401','ops-dock-good','00000000-0000-4000-8000-000000069003','질문 원문 비복제 확인');
insert into public.reviews(id,user_id,good_id,order_id,rating,body)values('00000000-0000-4000-8000-000000069501','00000000-0000-4000-8000-000000069003','ops-dock-good','00000000-0000-4000-8000-000000069101',2,'리뷰 원문 비복제 확인');
select 1/case when (select count(*) from private.admin_operation_alerts where event_key like '%000000069%')=7
 and (select href from private.admin_operation_alerts where event_key='reviews:00000000-0000-4000-8000-000000069501:created')='/admin/cs/reviews?reviewId=00000000-0000-4000-8000-000000069501'
 and not exists(select 1 from private.admin_operation_alerts where title like '%원문%' or title like '%이 본문%')
 then 1 else 0 end as events_deduped_status_only_writer_and_no_personal_body;
select id as alert_id from private.admin_operation_alerts where event_key='orders:00000000-0000-4000-8000-000000069101:paid' \gset
select clock_timestamp() as cutoff \gset
-- 같은 시각의 커서 경계와 조회 뒤의 새 알림을 독립된 합성 사건으로 검증한다.
insert into private.admin_operation_alerts(id,event_key,category,title,href,created_at)values
 ('00000000-0000-4000-8000-000000069601','qa-order-page-1','orders','동일시각 첫 행','/admin/sales/orders',now()-interval '1 day'),
 ('00000000-0000-4000-8000-000000069602','qa-order-page-2','orders','동일시각 두 행','/admin/sales/orders',now()-interval '1 day'),
 ('00000000-0000-4000-8000-000000069603','qa-order-new','orders','조회 이후 신착','/admin/sales/orders',clock_timestamp()),
 ('00000000-0000-4000-8000-000000069604','qa-order-expired','orders','90일 이전','/admin/sales/orders',now()-interval '91 days');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000069001',true);
select public.admin_update_operation_alerts('read',array[:'alert_id'::uuid],:'cutoff','orders','all');
select public.admin_update_operation_alerts('hide',null,:'cutoff','orders','unread');
select 1/case when exists(select 1 from jsonb_array_elements(public.admin_operation_alerts('orders','all')->'items')e where e->>'id'=:'alert_id')
 and exists(select 1 from jsonb_array_elements(public.admin_operation_alerts('orders','unread')->'items')e where e->>'id'='00000000-0000-4000-8000-000000069603')
 and not exists(select 1 from jsonb_array_elements(public.admin_operation_alerts('orders','all')->'items')e where e->>'id'='00000000-0000-4000-8000-000000069604')
 then 1 else 0 end as filter_scoped_hide_excludes_read_and_unseen_new_events;
select public.admin_update_operation_alerts('restore',null,clock_timestamp(),'orders','hidden');
select 1/case when exists(select 1 from jsonb_array_elements(public.admin_operation_alerts('orders','all',now()-interval '1 day','00000000-0000-4000-8000-000000069602',1)->'items')e where e->>'id'='00000000-0000-4000-8000-000000069601') then 1 else 0 end as timestamp_and_id_cursor;
select public.admin_set_operation_alert_badge(false);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000069002',true);
select 1/case when(public.admin_operation_alerts()->>'badgeEnabled')::boolean
 and exists(select 1 from jsonb_array_elements(public.admin_operation_alerts('orders','unread')->'items')e where e->>'id'=:'alert_id' and e->>'readAt' is null)
 and jsonb_array_length(public.admin_operation_tasks())=7 then 1 else 0 end as staff_account_isolation_and_tasks;
do $$begin
 begin perform public.admin_update_operation_alerts('hide',null,clock_timestamp(),'bad','all');raise exception 'bad category accepted';exception when invalid_parameter_value then null;end;
 begin perform public.admin_update_operation_alerts('read',null,'infinity');raise exception 'unbounded timestamp accepted';exception when invalid_parameter_value then null;end;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000069003',true);
do $$begin
 begin perform public.admin_operation_alerts();raise exception 'customer read';exception when insufficient_privilege then null;end;
 begin perform public.admin_operation_tasks();raise exception 'customer tasks';exception when insufficient_privilege then null;end;
 begin perform public.admin_update_operation_alerts('hide',null,clock_timestamp());raise exception 'customer write';exception when insufficient_privilege then null;end;
 begin perform public.admin_set_operation_alert_badge(false);raise exception 'customer preference';exception when insufficient_privilege then null;end;
end$$;
reset role;
select 1/case when not has_function_privilege('anon','public.admin_operation_alerts(text,text,timestamptz,uuid,integer)','execute')
 and not has_function_privilege('service_role','public.admin_update_operation_alerts(text,uuid[],timestamptz,text,text)','execute')
 and not has_table_privilege('authenticated','private.admin_operation_alerts','select')
 and(select count(*) from cron.job where jobname='admin-operation-alerts-retention')=1 then 1 else 0 end as sealed_state_and_retention;
rollback;
