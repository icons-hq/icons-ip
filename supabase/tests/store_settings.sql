\set ON_ERROR_STOP on
begin;
select 1 / case when to_regclass('public.store_settings') is not null then 1 else 0 end as assert_store_settings_exists;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-4000-8000-000000042601','authenticated','authenticated','settings-admin@example.test',now(),'{}','{}',now(),now()),
('00000000-0000-4000-8000-000000042602','authenticated','authenticated','settings-staff@example.test',now(),'{}','{}',now(),now()),
('00000000-0000-4000-8000-000000042603','authenticated','authenticated','settings-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin' where id='00000000-0000-4000-8000-000000042601';
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000042602';
select 1 / case when not has_table_privilege('authenticated','public.store_settings','insert,update,delete')
  and not has_table_privilege('anon','public.store_settings','select')
  and not has_function_privilege('anon','public.admin_save_store_settings(text,jsonb,timestamptz)','execute')
  and not has_function_privilege('service_role','public.admin_save_store_settings(text,jsonb,timestamptz)','execute')
  and not has_table_privilege('authenticated','public.shipping_carriers','insert,update,delete')
  and not has_table_privilege('service_role','public.shipping_carriers','insert,update,delete,truncate') then 1 else 0 end as assert_write_acl;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042602',true);
select 1 / case when (select count(*) from public.store_settings)=1 then 1 else 0 end as assert_staff_read;
do $$ begin
  perform public.admin_save_store_settings('business','{"phone":"02-111-1111"}',null);
  raise exception 'staff write allowed';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.admin_save_shipping_carrier('test426','연습택배','https://carrier.example.test/{trackingNumber}',true,null);
  raise exception 'staff carrier write allowed';
exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042603',true);
select 1 / case when not exists(select 1 from public.store_settings) then 1 else 0 end as assert_buyer_private_read_denied;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042601',true);
select updated_at as stamp from public.store_settings \gset
select public.admin_save_store_settings('business','{"phone":"02-111-1111","email":"cs@demo.example.test"}', :'stamp');
select 1 / case when (public.get_storefront_settings()->>'phone')='02-111-1111' then 1 else 0 end as assert_public_value;
do $$ declare row public.store_settings;
begin
  select * into row from public.store_settings;
  begin
    perform public.admin_save_store_settings('business','{"phone":"stale"}',row.updated_at - interval '1 second');
    raise exception 'stale write allowed';
  exception when serialization_failure then null; end;
  begin
    perform public.admin_save_store_settings('bank_transfer','{"bank":"은행","accountNumber":"","holder":""}',row.updated_at);
    raise exception 'partial account allowed';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.admin_save_store_settings('business','{"unrecognized":"value"}',row.updated_at);
    raise exception 'unknown key allowed';
  exception when invalid_parameter_value then null; end;
  perform public.admin_save_store_settings('bank_transfer','{"bank":"","accountNumber":"","holder":""}',row.updated_at);
end $$;
select public.admin_save_shipping_carrier('test426','연습택배','https://carrier.example.test/{trackingNumber}',true,null);
select updated_at as carrier_stamp from public.shipping_carriers where code='test426' \gset
select public.admin_save_shipping_carrier('test426','연습택배','https://carrier.example.test/{trackingNumber}',false,:'carrier_stamp');
select 1 / case when exists(select 1 from public.shipping_carriers where code='test426' and not is_active and updated_at > :'carrier_stamp') then 1 else 0 end as assert_disable_preserves_carrier;
do $$ begin
  perform public.admin_save_shipping_carrier('bad426','잘못된택배','https://user:pass@carrier.example.test/{trackingNumber}',true,null);
  raise exception 'credential URL allowed';
exception when invalid_parameter_value then null; end $$;
select 1 / case when (select count(*) from public.admin_store_settings_history(20))>=4 then 1 else 0 end as assert_audit_history;
reset role;
set local role anon;
select 1 / case when public.get_storefront_settings() ? 'phone' and not (public.get_storefront_settings() ? 'bank_transfer') then 1 else 0 end as assert_anon_safe_projection;
rollback;
