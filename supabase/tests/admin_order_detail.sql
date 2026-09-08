\set ON_ERROR_STOP on
-- #414: exact ID, source timeline, private projection, audited/idempotent staff notes.
begin;
select 1 / case when not has_function_privilege('anon','public.admin_order_detail(uuid)','EXECUTE')
 and not has_function_privilege('service_role','public.admin_order_detail(uuid)','EXECUTE')
 and not has_function_privilege('anon','public.admin_add_order_note(uuid,text,uuid)','EXECUTE')
 and not has_function_privilege('service_role','public.admin_add_order_note(uuid,text,uuid)','EXECUTE')
 then 1 else 0 end as assert_staff_session_only_acl;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-4000-8000-000000004141','authenticated','authenticated','order-detail@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000004142','authenticated','authenticated','order-detail-staff@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='상담 담당자',role='staff' where id='00000000-0000-4000-8000-000000004142';
insert into public.orders(id,user_id,status,total,address,created_at)
values ('10000000-0000-4000-8000-000000004141','00000000-0000-4000-8000-000000004141','pending',12000,
 '{"recipientName":"수취인","phone":"01012345678","postalCode":"12345","address1":"서울시"}','2026-09-01T00:00:00Z'),
 ('10000000-0000-4000-8000-000000004142','00000000-0000-4000-8000-000000004141','pending',24000,'{}','2026-09-02T00:00:00Z');
insert into public.payments(id,user_id,purpose,ref_id,amount,status,payment_key,idempotency_key,raw,created_at)
values ('20000000-0000-4000-8000-000000004141','00000000-0000-4000-8000-000000004141','order',
 '10000000-0000-4000-8000-000000004141',12000,'paid','do-not-expose-provider-secret','order-detail-idempotency',
 '{"providerRaw":"do-not-expose-provider-secret"}','2026-09-01T01:00:00Z');
insert into public.refunds(payment_id,amount,status,created_at)
values ('20000000-0000-4000-8000-000000004141',12000,'done','2026-09-01T07:00:00Z');
insert into public.audit_log(actor_id,action,target,diff,created_at)
values ('00000000-0000-4000-8000-000000004142','admin.order.status_updated','order:10000000-0000-4000-8000-000000004141',
 '{"from":"paid","to":"confirmed","providerRaw":"do-not-expose-provider-secret"}','2026-09-01T02:00:00Z'),
 ('00000000-0000-4000-8000-000000004142','admin.order.tracking_updated','order:10000000-0000-4000-8000-000000004141',
 '{"toCarrier":"hanjin","toTrackingNumber":"1234567890"}','2026-09-01T03:00:00Z');
insert into public.audit_log(actor_id,action,target,diff)
values ('00000000-0000-4000-8000-000000004142','admin.order.note','order:10000000-0000-4000-8000-000000004142',
 '{"body":"unrelated-order-private-note"}');
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,requested_at)
values ('30000000-0000-4000-8000-000000004141','10000000-0000-4000-8000-000000004141',
 '00000000-0000-4000-8000-000000004141','변심','2026-09-01T06:00:00Z');
insert into public.inquiries(id,user_id,category,title,order_id,created_at,last_message_at)
values ('40000000-0000-4000-8000-000000004141','00000000-0000-4000-8000-000000004141','order','배송 확인',
 '10000000-0000-4000-8000-000000004141','2026-09-01T05:00:00Z','2026-09-01T05:00:00Z');
insert into public.email_deliveries(dedupe_key,template,recipient,subject,status,created_at,completed_at)
values ('order_shipped:10000000-0000-4000-8000-000000004141','order_shipped','private-recipient@example.test',
 'private-subject','sent','2026-09-01T04:00:00Z','2026-09-01T04:01:00Z');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004142',true);
set local role authenticated;
select 1 / case when public.admin_order_detail('10000000-0000-4000-8000-000000004141')->'order'->>'id'
 ='10000000-0000-4000-8000-000000004141' then 1 else 0 end as assert_exact_order_is_loaded;
select 1 / case when public.admin_order_detail('10000000-0000-4000-8000-000000004149') is null
 then 1 else 0 end as assert_missing_order_is_not_replaced;
do $$ declare d jsonb; sources text[]; unsorted boolean; begin
 d := public.admin_order_detail('10000000-0000-4000-8000-000000004141');
 select array_agg(distinct e->>'source') into sources from jsonb_array_elements(d->'timeline') e;
 if not coalesce(sources,'{}'::text[]) @> array['order','payment','refund','status','shipment','claim','inquiry','email'] then
  raise exception 'missing timeline sources: %',sources;
 end if;
 select exists(select 1 from (
  select (e->>'occurredAt')::timestamptz at,lag((e->>'occurredAt')::timestamptz) over(order by n) previous
  from jsonb_array_elements(d->'timeline') with ordinality e(e,n)
 ) ordered where previous > at) into unsorted;
 if unsorted then raise exception 'order timeline is not chronological'; end if;
 if d::text like '%do-not-expose-provider-secret%' or d::text like '%private-recipient%' or d::text like '%private-subject%'
   or d::text like '%unrelated-order-private-note%'
 then raise exception 'unsafe order detail projection'; end if;
end; $$;
select public.admin_add_order_note('10000000-0000-4000-8000-000000004141','  물류팀 확인 필요  ','50000000-0000-4000-8000-000000004141');
select public.admin_add_order_note('10000000-0000-4000-8000-000000004141','물류팀 확인 필요','50000000-0000-4000-8000-000000004141');
do $$ declare d jsonb; begin
 if (select count(*) from public.audit_log where id='50000000-0000-4000-8000-000000004141'
   and actor_id='00000000-0000-4000-8000-000000004142' and action='admin.order.note'
   and target='order:10000000-0000-4000-8000-000000004141' and diff->>'body'='물류팀 확인 필요') <> 1
 then raise exception 'note must be written once with actor and target'; end if;
 d := public.admin_order_detail('10000000-0000-4000-8000-000000004141');
 if not exists(select 1 from jsonb_array_elements(d->'timeline') e where e->>'source'='note'
   and e->>'body'='물류팀 확인 필요' and e->>'actorName'='상담 담당자') then raise exception 'note absent from timeline'; end if;
 begin
  perform public.admin_add_order_note('10000000-0000-4000-8000-000000004141','다른 내용','50000000-0000-4000-8000-000000004141');
  raise exception 'operation id reused with different content';
 exception when invalid_parameter_value then
  if sqlerrm <> 'note_operation_conflict' then raise; end if;
 end;
 begin
  perform public.admin_add_order_note('10000000-0000-4000-8000-000000004141','  ',gen_random_uuid());
  raise exception 'blank note accepted';
 exception when invalid_parameter_value then
  if sqlerrm <> 'note_body_invalid' then raise; end if;
 end;
 begin
  perform public.admin_add_order_note('10000000-0000-4000-8000-000000004141',repeat('가',2001),gen_random_uuid());
  raise exception 'oversized note accepted';
 exception when invalid_parameter_value then
  if sqlerrm <> 'note_body_invalid' then raise; end if;
 end;
 begin
  perform public.admin_add_order_note('10000000-0000-4000-8000-000000004149','존재하지 않음',gen_random_uuid());
  raise exception 'missing order accepted note';
 exception when no_data_found then
  if sqlerrm <> 'order_not_found' then raise; end if;
 end;
end; $$;
select 1 / case when (select status='pending' and total=12000 and address->>'recipientName'='수취인'
 from public.orders where id='10000000-0000-4000-8000-000000004141') then 1 else 0 end as assert_order_ledger_unchanged;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000004141',true);
do $$ begin
 begin
  perform public.admin_order_detail('10000000-0000-4000-8000-000000004141');
  raise exception 'ordinary owner accessed staff order detail';
 exception when insufficient_privilege then
  if sqlerrm <> 'staff_required' then raise; end if;
 end;
 begin
  perform public.admin_add_order_note('10000000-0000-4000-8000-000000004141','고객이 내부 메모를 씀',gen_random_uuid());
  raise exception 'ordinary owner added internal note';
 exception when insufficient_privilege then
  if sqlerrm <> 'staff_required' then raise; end if;
 end;
end; $$;
reset role;
rollback;
