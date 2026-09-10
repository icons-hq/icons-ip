\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-4000-8000-000000047001','authenticated','authenticated','sales-english@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000047001';
insert into public.verticals(key,label,color) values ('sales-english','영문명 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values ('sales-english','영문명 검증','sales-english',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000047001',true);
select public.admin_save_good('{"id":"sales-english-good","ip_id":"sales-english","name":"아크릴 키링","name_en":"  Acrylic Keyring  ","price":1000}');
select 1 / case when (select name_en from public.goods where id='sales-english-good')='Acrylic Keyring' then 1 else 0 end as assert_english_name_saved;
-- Legacy callers omit the new field and must preserve it.
select public.admin_save_good('{"previous_id":"sales-english-good","id":"sales-english-good","ip_id":"sales-english","name":"이름만 변경","price":1000}');
select 1 / case when (select name_en from public.goods where id='sales-english-good')='Acrylic Keyring' then 1 else 0 end as assert_legacy_edit_preserves_english;
do $$ begin
  perform public.admin_save_good(jsonb_build_object('previous_id','sales-english-good','id','sales-english-good','ip_id','sales-english','name','거절할 변경','price',1000,'name_en',repeat('x',201)));
  raise exception 'oversized English name accepted';
exception when check_violation then
  if sqlerrm <> 'invalid_good_english_name' then raise; end if;
end $$;
select 1 / case when (select name from public.goods where id='sales-english-good')='이름만 변경' then 1 else 0 end as assert_invalid_edit_atomic;
select public.admin_save_good('{"previous_id":"sales-english-good","id":"sales-english-good","ip_id":"sales-english","name":"이름만 변경","name_en":"","price":1000}');
select 1 / case when (select name_en from public.goods where id='sales-english-good') is null then 1 else 0 end as assert_clear_english_name;
reset role;
select 1 / case when (select count(*) from public.audit_log where action='admin.good.english_name_saved' and target='goods:sales-english-good')=2
  and not has_function_privilege('anon','public.admin_save_good(jsonb)','execute')
  and not has_function_privilege('service_role','public.admin_save_good(jsonb)','execute')
  and not has_function_privilege('authenticated','private.admin_save_good_before_english_name(jsonb)','execute')
  then 1 else 0 end as assert_english_name_audit_and_permissions;
update public.profiles set role='user' where id='00000000-0000-4000-8000-000000047001';
set local role authenticated;
do $$ begin
  perform public.admin_save_good('{"id":"forbidden-english","ip_id":"sales-english","name":"forbidden","name_en":"Not permitted","price":1000}');
  raise exception 'non-staff edit accepted';
exception when insufficient_privilege then null;
end $$;
rollback;
