\set ON_ERROR_STOP on
begin;
update public.store_settings set navigation=default where singleton;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-4000-8000-000000019001','authenticated','authenticated','menu-admin@example.test',now(),'{}','{}',now(),now()),
('00000000-0000-4000-8000-000000019002','authenticated','authenticated','menu-staff@example.test',now(),'{}','{}',now(),now()),
('00000000-0000-4000-8000-000000019003','authenticated','authenticated','menu-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin' where id='00000000-0000-4000-8000-000000019001';
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000019002';
select 1 / case when not has_function_privilege('anon','public.admin_save_store_navigation(uuid,jsonb,timestamptz)','execute')
  and not has_function_privilege('service_role','public.admin_save_store_navigation(uuid,jsonb,timestamptz)','execute')
  and not has_function_privilege('authenticated','private.store_navigation_valid(jsonb)','execute')
  and not has_table_privilege('authenticated','public.store_settings','update') then 1 else 0 end as assert_sealed_writes;
set local role anon;
select 1 / case when public.get_storefront_navigation()='[{"id":"new","label":"NEW"},{"id":"best","label":"BEST"},{"id":"shop","label":"카테고리"},{"id":"iphub","label":"온라인 팝업"},{"id":"packs","label":"카드팩"},{"id":"events","label":"이벤트"},{"id":"community","label":"커뮤니티"},{"id":"stories","label":"쇼핑스토리"}]'::jsonb then 1 else 0 end as assert_public_defaults;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000019002',true);
select 1 / case when (select count(*) from public.store_settings)=1 then 1 else 0 end as assert_staff_reads;
do $$ begin
  perform public.admin_save_store_navigation(gen_random_uuid(),'[]',null); raise exception 'staff write accepted';
exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000019003',true);
select 1 / case when not exists(select 1 from public.store_settings) then 1 else 0 end as assert_buyer_no_settings;
do $$ begin
  perform public.admin_save_store_navigation(gen_random_uuid(),'[]',null); raise exception 'buyer write accepted';
exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000019001',true);
do $$ declare initial public.store_settings; payload jsonb; invalid jsonb; saved timestamptz; replay timestamptz;
begin
  select * into initial from public.store_settings;
  select jsonb_agg(value order by ordinal desc) into payload from jsonb_array_elements(initial.navigation) with ordinality item(value,ordinal);
  payload:=jsonb_set(payload,'{7,label}','"숨겨진 신상품 메뉴"');
  payload:=jsonb_set(payload,'{7,visible}','false');
  foreach invalid in array array[
    'null'::jsonb,'{}'::jsonb,'[]'::jsonb,payload-0,payload||'[{}]',
    jsonb_set(payload,'{0}','null'),jsonb_set(payload,'{0,id}','"admin"'),jsonb_set(payload,'{0,id}','"best"'),
    jsonb_set(payload,'{0,label}','""'),jsonb_set(payload,'{0,label}','" new"'),
    jsonb_set(payload,'{0,label}',to_jsonb(repeat('가',21))),jsonb_set(payload,'{0,label}',to_jsonb(E'hello\nworld'::text)),
    jsonb_set(payload,'{0,label}',to_jsonb(U&'\00A0'::text)),jsonb_set(payload,'{0,visible}','"true"'),
    jsonb_set(payload,'{0,href}','"/admin"'),jsonb_set(payload,'{5,visible}','false')
  ] loop
    begin
      perform public.admin_save_store_navigation(gen_random_uuid(),invalid,initial.updated_at); raise exception 'invalid menu accepted: %',invalid;
    exception when invalid_parameter_value then null; end;
  end loop;
  saved:=public.admin_save_store_navigation('10000000-0000-4000-8000-000000019001',payload,initial.updated_at);
  replay:=public.admin_save_store_navigation('10000000-0000-4000-8000-000000019001',payload,initial.updated_at);
  if replay<>saved then raise exception 'replay changed saved timestamp'; end if;
  if (select count(*) from public.admin_store_settings_history(50) where target='store_settings:navigation' and diff->'after'=payload)<>1 then raise exception 'duplicate/missing audit'; end if;
  if (select navigation from public.store_settings)<>payload then raise exception 'order/hidden settings lost'; end if;
  if public.get_storefront_navigation()<>'[{"id":"stories","label":"쇼핑스토리"},{"id":"community","label":"커뮤니티"},{"id":"events","label":"이벤트"},{"id":"packs","label":"카드팩"},{"id":"iphub","label":"온라인 팝업"},{"id":"shop","label":"카테고리"},{"id":"best","label":"BEST"}]'::jsonb then raise exception 'public projection mismatch'; end if;
  if public.get_storefront_settings() ? 'navigation' then raise exception 'legal contract changed'; end if;
  begin
    perform public.admin_save_store_navigation('10000000-0000-4000-8000-000000019001',initial.navigation,saved); raise exception 'operation reused with changed payload';
  exception when unique_violation then null; end;
  begin
    perform public.admin_save_store_navigation(gen_random_uuid(),payload,initial.updated_at); raise exception 'stale update accepted';
  exception when sqlstate 'PT409' then null; end;
  -- Other settings sections share the same row version, including unchanged menu data.
  perform public.admin_save_store_settings('business',initial.business,saved);
  begin
    perform public.admin_save_store_navigation(gen_random_uuid(),initial.navigation,saved); raise exception 'cross section stale update accepted';
  exception when sqlstate 'PT409' then null; end;
end $$;
reset role;
update public.profiles set suspended_at=now(),suspension_reason='test' where id='00000000-0000-4000-8000-000000019001';
set local role authenticated;
do $$ begin
  perform public.admin_save_store_navigation(gen_random_uuid(),'[]',null); raise exception 'suspended admin accepted';
exception when insufficient_privilege then null; end $$;
rollback;
