\set ON_ERROR_STOP on
begin;
select 1/case when not has_function_privilege('anon','public.admin_save_goods_notice_preset(uuid,text,jsonb,timestamptz)','execute')
  and not has_function_privilege('service_role','public.admin_save_goods_notice_preset(uuid,text,jsonb,timestamptz)','execute')
  and not has_function_privilege('authenticated','private.normalize_goods_notice_kc_template(jsonb)','execute')
  and not has_function_privilege('anon','private.normalize_goods_notice_kc_template(jsonb)','execute')
  and not has_function_privilege('service_role','private.normalize_goods_notice_kc_template(jsonb)','execute')
  then 1 else 0 end as sealed_template_functions;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-4000-8000-000000050901','authenticated','authenticated','kc-preset@example.test',now(),'{}','{}',now(),now()),
('00000000-0000-4000-8000-000000050902','authenticated','authenticated','kc-preset-customer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000050901';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000050901',true);
select public.admin_save_goods_notice_preset(null,'합성 KC 틀',
'{"maker":"합성","origin":"한국","material":"종이","size":"A5","madeOn":"2026","asManager":"합성","asContact":"합성","kcTemplate":{"family":"living","scheme":"not_applicable","publicNote":" 합성 안내 "}}',null) as preset_id \gset
select 1/case when (select kc_template from public.goods_notice_presets where id=:'preset_id')='{"family":"living","scheme":"not_applicable","publicNote":"합성 안내"}'::jsonb then 1 else 0 end as template_saved;

select set_config('test.kc_preset_id',:'preset_id',true);
do $$ declare preset public.goods_notice_presets; notice jsonb; invalid jsonb; begin
  select * into preset from public.goods_notice_presets where id=current_setting('test.kc_preset_id')::uuid;
  notice:='{"maker":"합성","origin":"한국","material":"종이","size":"A5","madeOn":"2026","asManager":"합성","asContact":"합성"}'::jsonb;
  foreach invalid in array array[
    '{"family":"  ","scheme":"  ","publicNote":""}'::jsonb,
    '{"family":"other","scheme":"safety_certification","publicNote":""}'::jsonb,
    '{"family":"living","scheme":"not_applicable","publicNote":"안내","identifier":"COPIED"}'::jsonb,
    '{"family":"living","scheme":"not_applicable","publicNote":1}'::jsonb,
    '{"family":"living","scheme":"safety_certification","publicNote":"해당 없음"}'::jsonb
  ] loop
    begin
      perform public.admin_save_goods_notice_preset(preset.id,preset.name,notice||jsonb_build_object('kcTemplate',invalid),preset.updated_at);
      raise exception 'invalid template accepted: %',invalid;
    exception when invalid_parameter_value or check_violation then null; end;
  end loop;
  begin
    perform public.admin_save_goods_notice_preset(preset.id,preset.name,notice||jsonb_build_object('kcTemplate',
      jsonb_build_object('family','living','scheme','not_applicable','publicNote',repeat('가',1001))),preset.updated_at);
    raise exception 'oversized KC note accepted';
  exception when invalid_parameter_value or check_violation then null; end;
  begin
    perform public.admin_save_goods_notice_preset(preset.id,preset.name,notice||'{"kcTemplate":null}',preset.updated_at-interval '1 second');
    raise exception 'stale KC template clear accepted';
  exception when serialization_failure then null; end;
  perform public.admin_save_goods_notice_preset(preset.id,preset.name,notice,preset.updated_at);
  if (select kc_template from public.goods_notice_presets where id=preset.id) is distinct from preset.kc_template then raise exception 'legacy seven fields cleared KC'; end if;
  select * into preset from public.goods_notice_presets where id=preset.id;
  perform public.admin_save_goods_notice_preset(preset.id,preset.name,notice||'{"kcTemplate":null}'::jsonb,preset.updated_at);
  if (select kc_template from public.goods_notice_presets where id=preset.id) is not null then raise exception 'explicit clear not applied'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000050902',true);
select 1/case when not exists(select 1 from public.goods_notice_presets where id=:'preset_id') then 1 else 0 end as customer_cannot_read_template;
do $$ begin
  perform public.admin_save_goods_notice_preset(null,'고객 우회','{"kcTemplate":null}',null);
  raise exception 'customer template save accepted';
exception when insufficient_privilege then null; end $$;
reset role;
select 1/case when (select count(*) from public.audit_log where actor_id='00000000-0000-4000-8000-000000050901'
  and target='goods_notice_presets:'||:'preset_id')=3 then 1 else 0 end as single_audit_per_success;
select 1/case when exists(select 1 from public.audit_log where target='goods_notice_presets:'||:'preset_id'
  and diff->'before'->'kc_template'->>'publicNote'='합성 안내' and diff->'after'->'kc_template'='null'::jsonb)
  then 1 else 0 end as cleared_template_audit_preserves_previous;
rollback;
