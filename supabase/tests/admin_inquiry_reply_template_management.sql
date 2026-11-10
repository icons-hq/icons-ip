\set ON_ERROR_STOP on
begin isolation level repeatable read;
create function pg_temp.template_id(kind text,n integer) returns uuid language sql immutable as $$select md5('inquiry-template-management-test:'||kind||':'||n)::uuid$$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
select pg_temp.template_id('user',n),'authenticated','authenticated','inquiry-template-test-'||n||'@example.test','{}','{}' from generate_series(1,3)n;
update public.profiles set role='staff' where id in(pg_temp.template_id('user',1),pg_temp.template_id('user',2));
-- Omitting new columns exercises compatibility with the existing stored shape.
insert into public.inquiry_reply_templates(id,title,body,created_by,created_at,updated_at)
values(pg_temp.template_id('template',9),'기존 공유 문구','기존 고객문의 본문',pg_temp.template_id('user',2),'2026-01-01','2026-01-02');
create temp table template_before as select (select count(*) from public.inquiry_messages) messages,(select count(*) from public.notifications) notifications,(select count(*) from public.email_deliveries) emails;
select 1/case when exists(select 1 from public.inquiry_reply_templates where id=pg_temp.template_id('template',9) and category='other' and revision=1 and archived_at is null and created_at='2026-01-01' and updated_at='2026-01-02') then 1 else 0 end as existing_data_shape_defaults_preserved;
select set_config('request.jwt.claim.sub',pg_temp.template_id('user',1)::text,true);
set local role authenticated;
select public.admin_mutate_inquiry_reply_template(pg_temp.template_id('op',1),pg_temp.template_id('template',1),0,'save','{"category":"shipping","title":"배송 안내","body":"첫 문구\n두번째 줄"}') as created \gset
select 1/case when :'created'::jsonb#>>'{template,revision}'='1' and :'created'::jsonb#>>'{template,created_by}'=pg_temp.template_id('user',1)::text then 1 else 0 end as created_in_existing_shared_table;
select 1/case when public.admin_mutate_inquiry_reply_template(pg_temp.template_id('op',1),pg_temp.template_id('template',1),0,'save','{"category":"shipping","title":"배송 안내","body":"첫 문구\n두번째 줄"}')=:'created'::jsonb and public.admin_get_inquiry_reply_template_operation(pg_temp.template_id('op',1))=:'created'::jsonb then 1 else 0 end as replay_and_readback;
select public.admin_mutate_inquiry_reply_template(pg_temp.template_id('op',2),pg_temp.template_id('template',1),1,'save','{"category":"return","title":"반품 안내","body":"수정한 공유 문구"}');
do $$begin
  begin perform public.admin_mutate_inquiry_reply_template(pg_temp.template_id('op',1),pg_temp.template_id('template',1),0,'save','{"category":"shipping","title":"다른 제목","body":"다른 문구"}');raise exception 'operation reused with changed payload';exception when sqlstate 'PT409' then null;end;
  begin perform public.admin_mutate_inquiry_reply_template(pg_temp.template_id('op',3),pg_temp.template_id('template',1),1,'save','{"category":"shipping","title":"오래된 입력","body":"덮어쓰면 안 됨"}');raise exception 'stale revision overwrote';exception when sqlstate 'PT409' then null;end;
  begin perform public.admin_mutate_inquiry_reply_template(pg_temp.template_id('op',3),pg_temp.template_id('template',2),0,'save','{"category":"unknown","title":"제목","body":"본문"}');raise exception 'unknown category accepted';exception when invalid_parameter_value then null;end;
  begin perform public.admin_mutate_inquiry_reply_template(pg_temp.template_id('op',3),pg_temp.template_id('template',2),0,'save',jsonb_build_object('category','other','title',repeat('가',41),'body','본문'));raise exception 'long title accepted';exception when invalid_parameter_value then null;end;
  begin perform public.admin_mutate_inquiry_reply_template(pg_temp.template_id('op',3),pg_temp.template_id('template',2),0,'save',jsonb_build_object('category','other','title','제목','body',repeat('가',2001)));raise exception 'long body accepted';exception when invalid_parameter_value then null;end;
  begin perform public.admin_mutate_inquiry_reply_template(pg_temp.template_id('op',3),pg_temp.template_id('template',2),0,'save','{"category":"other","title":"제목","body":"본문","surface":"review"}');raise exception 'unexpected key accepted';exception when invalid_parameter_value then null;end;
end$$;
select set_config('request.jwt.claim.sub',pg_temp.template_id('user',2)::text,true);
select public.admin_mutate_inquiry_reply_template(pg_temp.template_id('op',4),pg_temp.template_id('template',1),2,'save','{"category":"other","title":"다른 담당자 수정","body":"공유 소유권 유지"}');
select 1/case when exists(select 1 from public.inquiry_reply_templates where id=pg_temp.template_id('template',1) and created_by=pg_temp.template_id('user',1) and updated_by=pg_temp.template_id('user',2) and revision=3) then 1 else 0 end as staff_share_ownership_and_original_creator;
do $$begin
  begin perform public.admin_get_inquiry_reply_template_operation(pg_temp.template_id('op',1));raise exception 'other operator receipt read accepted';exception when insufficient_privilege then null;end;
end$$;
select set_config('request.jwt.claim.sub',pg_temp.template_id('user',1)::text,true);
select public.admin_mutate_inquiry_reply_template(pg_temp.template_id('op',5),pg_temp.template_id('template',1),3,'archive','{}') as archived \gset
do $$begin
  begin perform public.admin_mutate_inquiry_reply_template(pg_temp.template_id('op',6),pg_temp.template_id('template',1),4,'save','{"category":"other","title":"삭제중 편집","body":"거부할 문구"}');raise exception 'archived save accepted';exception when check_violation then null;end;
end$$;
select public.admin_mutate_inquiry_reply_template(pg_temp.template_id('op',7),pg_temp.template_id('template',1),4,'restore','{}');
select 1/case when public.admin_mutate_inquiry_reply_template(pg_temp.template_id('op',5),pg_temp.template_id('template',1),3,'archive','{}')=:'archived'::jsonb and exists(select 1 from public.inquiry_reply_templates where id=pg_temp.template_id('template',1) and archived_at is null and revision=5 and body='공유 소유권 유지') then 1 else 0 end as historical_archive_replay_does_not_rearchive;
select 1/case when public.admin_mutate_inquiry_reply_template(pg_temp.template_id('op',1),pg_temp.template_id('template',1),0,'save','{"category":"shipping","title":"배송 안내","body":"첫 문구\n두번째 줄"}')=:'created'::jsonb and (select title from public.inquiry_reply_templates where id=pg_temp.template_id('template',1))='다른 담당자 수정' then 1 else 0 end as historical_save_replay_does_not_overwrite;
select public.admin_mutate_inquiry_reply_template(pg_temp.template_id('op',8),pg_temp.template_id('template',2),0,'save',jsonb_build_object('category','other','title',repeat('가',40),'body',repeat('나',2000)));
select 1/case when public.admin_get_inquiry_reply_template_operation(pg_temp.template_id('op',99)) is null then 1 else 0 end as missing_operation_readback;
reset role;
select 1/case when (select count(*) from public.audit_log where id=pg_temp.template_id('op',1))=1 and not exists(select 1 from public.audit_log where id=pg_temp.template_id('op',3))
  and (select messages from template_before)=(select count(*) from public.inquiry_messages)
  and (select notifications from template_before)=(select count(*) from public.notifications)
  and (select emails from template_before)=(select count(*) from public.email_deliveries)
  then 1 else 0 end as templates_never_send_customer_messages_or_email;
update public.profiles set suspended_at=now(),suspension_reason='합성 권한 거부 검수' where id=pg_temp.template_id('user',1);
set local role authenticated;
do $$begin
  begin perform public.admin_mutate_inquiry_reply_template(pg_temp.template_id('op',10),pg_temp.template_id('template',1),5,'archive','{}');raise exception 'suspended staff write accepted';exception when insufficient_privilege then null;end;
end$$;
select set_config('request.jwt.claim.sub',pg_temp.template_id('user',3)::text,true);
select 1/case when (select count(*) from public.inquiry_reply_templates)=0 then 1 else 0 end as customer_cannot_read_shared_templates;
do $$begin
  begin perform public.admin_get_inquiry_reply_template_operation(pg_temp.template_id('op',1));raise exception 'customer receipt read accepted';exception when insufficient_privilege then null;end;
  begin perform public.admin_mutate_inquiry_reply_template(pg_temp.template_id('op',10),pg_temp.template_id('template',1),5,'archive','{}');raise exception 'customer write accepted';exception when insufficient_privilege then null;end;
end$$;
reset role;
select 1/case when not has_function_privilege('authenticated','public.admin_upsert_inquiry_reply_template(uuid,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.admin_delete_inquiry_reply_template(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.admin_mutate_inquiry_reply_template(uuid,uuid,integer,text,jsonb)','EXECUTE')
  and not has_function_privilege('service_role','public.admin_get_inquiry_reply_template_operation(uuid)','EXECUTE')
  and not has_table_privilege('authenticated','public.inquiry_reply_templates','UPDATE')
  and not has_table_privilege('authenticated','public.inquiry_reply_templates','DELETE')
  then 1 else 0 end as legacy_hard_delete_and_direct_writes_sealed;
rollback;
