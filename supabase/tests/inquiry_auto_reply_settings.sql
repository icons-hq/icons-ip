\set ON_ERROR_STOP on
begin;
-- Keep the default contract assertion independent of saved QA examples.
update public.store_settings set inquiry_auto_replies=default where singleton;
select 1 / case when (select count(*) from public.store_settings s,jsonb_each(s.inquiry_auto_replies))=5
  and not exists(select 1 from public.store_settings s,jsonb_each(s.inquiry_auto_replies) c where c.value->>'enabled'<>'false' or c.value->>'body'<>'')
  then 1 else 0 end as assert_all_disabled_by_default;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-4000-8000-000000051201','authenticated','authenticated','auto-admin@example.test',now(),'{}','{}',now(),now()),
('00000000-0000-4000-8000-000000051202','authenticated','authenticated','auto-staff@example.test',now(),'{}','{}',now(),now()),
('00000000-0000-4000-8000-000000051203','authenticated','authenticated','auto-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin' where id='00000000-0000-4000-8000-000000051201';
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000051202';
select 1 / case when not has_table_privilege('authenticated','public.store_settings','update')
  and not has_table_privilege('service_role','public.store_settings','update')
  and not has_function_privilege('anon','public.admin_save_store_settings(text,jsonb,timestamptz)','execute')
  and not has_function_privilege('service_role','public.admin_save_store_settings(text,jsonb,timestamptz)','execute') then 1 else 0 end as assert_sealed_writes;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000051202',true);
select 1 / case when (select count(*) from public.store_settings)=1 then 1 else 0 end as assert_staff_reads;
-- TKT-019·099(사용자 결정 "아무나 가능하게"): 자동 첫 안내 설정을 여는 운영자는 매니저 권한 전환 전 호환 단계의 staff도 저장한다.
-- 같은 RPC의 사업자·계좌 섹션은 지금처럼 호환 단계 admin만 저장한다.
do $$ declare initial public.store_settings; saved timestamptz; begin
  select * into initial from public.store_settings;
  saved:=public.admin_save_store_settings('inquiry_auto_replies',
    jsonb_set(initial.inquiry_auto_replies,'{etc}',jsonb_build_object('enabled',true,'body','staff 저장 안내')),initial.updated_at);
  if saved is null or (select inquiry_auto_replies->'etc'->>'body' from public.store_settings)<>'staff 저장 안내' then
    raise exception 'staff auto reply save missing'; end if;
  saved:=public.admin_save_store_settings('inquiry_auto_replies',initial.inquiry_auto_replies,saved);
  begin
    perform public.admin_save_store_settings('business','{"phone":"02-000-0000"}',saved);
    raise exception 'staff business write allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_save_store_settings('bank_transfer','{"bank":"","accountNumber":"","holder":""}',saved);
    raise exception 'staff bank write allowed';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000051203',true);
select 1 / case when not exists(select 1 from public.store_settings) then 1 else 0 end as assert_customer_no_settings;
select public.create_inquiry('order','기본 문의','안내 꺼짐') as off_thread \gset
select 1 / case when (select count(*) from public.inquiry_messages where inquiry_id=:'off_thread')=1 then 1 else 0 end as assert_default_creation_unchanged;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000051201',true);
do $$ declare initial public.store_settings; settings jsonb; invalid jsonb;
begin
  select * into initial from public.store_settings;
  settings:=jsonb_set(initial.inquiry_auto_replies,'{order}',jsonb_build_object('enabled',true,'body',E'  주문 안내\nhttps://iconsip.com/help  '));
  foreach invalid in array array[
    '{}'::jsonb, settings-'etc', settings||'{"unknown":{"enabled":false,"body":""}}'::jsonb,
    jsonb_set(settings,'{order,enabled}','"true"'),jsonb_set(settings,'{order,body}','null'),
    jsonb_set(settings,'{order}','null'),jsonb_set(settings,'{order,unexpected}','true'),
    jsonb_set(settings,'{order,body}',to_jsonb(E' \n\t '::text)),
    jsonb_set(settings,'{order,body}',to_jsonb(U&'\00A0\3000'::text)),
    jsonb_set(settings,'{order,body}',to_jsonb(repeat('가',2001))),
    jsonb_set(settings,'{order,body}',to_jsonb('안내'||chr(1)))
  ] loop
    begin
      perform public.admin_save_store_settings('inquiry_auto_replies',invalid,initial.updated_at);
      raise exception 'invalid config allowed: %', invalid;
    exception when invalid_parameter_value then null; end;
  end loop;
  perform public.admin_save_store_settings('inquiry_auto_replies',settings,initial.updated_at);
  if (select inquiry_auto_replies->'order'->>'body' from public.store_settings)<>E'주문 안내\nhttps://iconsip.com/help' then
    raise exception 'normalization changed message';
  end if;
  if not exists(select 1 from public.admin_store_settings_history(50)
    where target='store_settings:inquiry_auto_replies' and diff->'before'=initial.inquiry_auto_replies
      and diff->'after'->'order'->>'enabled'='true') then raise exception 'missing audit'; end if;
  begin
    perform public.admin_save_store_settings('inquiry_auto_replies',settings,initial.updated_at);
    raise exception 'stale settings accepted';
  exception when sqlstate 'PT409' then null; end;
  if public.get_storefront_settings() ? 'inquiry_auto_replies' then raise exception 'public config leak'; end if;
end $$;
reset role;
select 1 / case when (select count(*) from public.audit_log where actor_id='00000000-0000-4000-8000-000000051202'
  and action='admin.store_settings.updated' and target='store_settings:inquiry_auto_replies')=2 then 1 else 0 end as assert_staff_saves_audited;
update public.profiles set suspended_at=now(),suspension_reason='test' where id='00000000-0000-4000-8000-000000051201';
set local role authenticated;
do $$ begin
  perform public.admin_save_store_settings('inquiry_auto_replies','{}',null);
  raise exception 'suspended admin accepted';
exception when insufficient_privilege then null; end $$;
rollback;
