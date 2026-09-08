\set ON_ERROR_STOP on
begin;

select 1 / case when (
  not has_table_privilege('anon', 'public.goods_notice_presets', 'select')
  and has_table_privilege('authenticated', 'public.goods_notice_presets', 'select')
  and not has_table_privilege('authenticated', 'public.goods_notice_presets', 'insert,update,delete')
  and not has_table_privilege('service_role', 'public.goods_notice_presets', 'select,insert,update,delete')
  and not has_function_privilege('anon', 'public.admin_save_goods_notice_preset(uuid,text,jsonb,timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_save_goods_notice_preset(uuid,text,jsonb,timestamptz)', 'execute')
) then 1 else 0 end as assert_preset_acl;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
('00000000-0000-4000-8000-000000042401','authenticated','authenticated','preset-staff@example.test',now(),'{}','{}',now(),now()),
('00000000-0000-4000-8000-000000042402','authenticated','authenticated','preset-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role = 'staff' where id = '00000000-0000-4000-8000-000000042401';

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042401',true);
select public.admin_save_goods_notice_preset(null, ' 아크릴 기본 ',
  '{"maker":"아이콘스","origin":"대한민국","material":"아크릴","size":"80mm","madeOn":"2026-09","asManager":"아이콘스 고객센터","asContact":"02-000-0000"}', null) as preset_id \gset
select 1 / case when exists (
  select 1 from public.goods_notice_presets where id = :'preset_id'
    and name = '아크릴 기본' and maker = '아이콘스' and origin = '대한민국'
    and material = '아크릴' and size = '80mm' and made_on = '2026-09'
    and as_manager = '아이콘스 고객센터' and as_contact = '02-000-0000'
) then 1 else 0 end as assert_staff_saves_and_reads_seven_fields;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042402',true);
select 1 / case when not exists(select 1 from public.goods_notice_presets) then 1 else 0 end as assert_buyer_cannot_read;
do $$ begin
  perform public.admin_save_goods_notice_preset(null,'권한 우회','{}',null);
  raise exception 'buyer write was allowed';
exception when insufficient_privilege then null; end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000042401',true);
select updated_at as original_updated_at from public.goods_notice_presets where id = :'preset_id' \gset
select public.admin_save_goods_notice_preset(:'preset_id', '아크릴 개선',
  '{"maker":"수정 제조사","origin":"일본","material":"금속","size":"90mm","madeOn":"2026-10","asManager":"수정 고객센터","asContact":"02-111-1111"}', :'original_updated_at');
select 1 / case when exists (
  select 1 from public.goods_notice_presets where id = :'preset_id'
    and name = '아크릴 개선' and maker = '수정 제조사' and origin = '일본'
    and material = '금속' and size = '90mm' and made_on = '2026-10'
    and as_manager = '수정 고객센터' and as_contact = '02-111-1111'
    and updated_at > :'original_updated_at'
) then 1 else 0 end as assert_update_copies_seven_fields;

do $$ declare row public.goods_notice_presets; notice jsonb;
begin
  select * into row from public.goods_notice_presets where name = '아크릴 개선';
  notice := '{"maker":"제조사","origin":"한국","material":"소재","size":"1mm","madeOn":"2026","asManager":"센터","asContact":"02-000-0000"}';
  begin
    perform public.admin_save_goods_notice_preset(row.id,'덮어쓰기',notice,row.updated_at - interval '1 second');
    raise exception 'stale update was allowed';
  exception when serialization_failure then null; end;
  begin
    perform public.admin_save_goods_notice_preset(null,' 아크릴 개선 ',notice,null);
    raise exception 'ambiguous duplicate name was allowed';
  exception when unique_violation then null; end;
  begin
    perform public.admin_save_goods_notice_preset(null,'필드 누락',notice - 'asContact',null);
    raise exception 'incomplete preset was allowed';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.admin_save_goods_notice_preset(null,'잘못된 형식',notice || '{"maker":3}',null);
    raise exception 'non-string field was allowed';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.admin_delete_goods_notice_preset(row.id,row.updated_at - interval '1 second');
    raise exception 'stale deletion was allowed';
  exception when serialization_failure then null; end;
end $$;

select updated_at as delete_updated_at from public.goods_notice_presets where id = :'preset_id' \gset
select public.admin_delete_goods_notice_preset(:'preset_id', :'delete_updated_at');
select 1 / case when not exists(select 1 from public.goods_notice_presets where id = :'preset_id') then 1 else 0 end as assert_delete;

reset role;
select 1 / case when exists (
  select 1 from public.audit_log where actor_id = '00000000-0000-4000-8000-000000042401'
    and action = 'catalog.goods_notice_preset.created' and target = 'goods_notice_presets:' || :'preset_id'
) then 1 else 0 end as assert_creation_audited;
select 1 / case when (
  select count(*) from public.audit_log where actor_id = '00000000-0000-4000-8000-000000042401'
    and action like 'catalog.goods_notice_preset.%'
) = 3 then 1 else 0 end as assert_crud_audit;
select 1 / case when (
  not has_function_privilege('anon', 'public.admin_delete_goods_notice_preset(uuid,timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_delete_goods_notice_preset(uuid,timestamptz)', 'execute')
) then 1 else 0 end as assert_delete_acl;

update public.profiles set suspended_at = now(), suspension_reason = '프리셋 권한 테스트' where id = '00000000-0000-4000-8000-000000042401';
set local role authenticated;
do $$ begin
  perform public.admin_save_goods_notice_preset(null,'정지 운영자','{}',null);
  raise exception 'suspended staff write was allowed';
exception when insufficient_privilege then null; end $$;
rollback;
