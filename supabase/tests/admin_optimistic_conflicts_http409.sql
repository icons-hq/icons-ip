\set ON_ERROR_STOP on
begin;
set local statement_timeout='3s';
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('00000000-0000-4000-8000-000000713201','authenticated','authenticated','http409-admin@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='admin' where id='00000000-0000-4000-8000-000000713201';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000713201',true);
do $$ declare settings public.store_settings; layout public.home_layout_settings;
begin
 select * into settings from public.store_settings where singleton;
 select * into layout from public.home_layout_settings where singleton;
 begin
  perform public.admin_save_store_settings('business',settings.business,settings.updated_at-interval '1 second');
  raise exception 'Stale business settings accepted';
 exception when sqlstate 'PT409' then if sqlerrm<>'store_settings_conflict' then raise; end if; end;
 begin
  perform public.admin_save_store_settings('inquiry_auto_replies',settings.inquiry_auto_replies,settings.updated_at-interval '1 second');
  raise exception 'Stale auto replies accepted';
 exception when sqlstate 'PT409' then if sqlerrm<>'store_settings_conflict' then raise; end if; end;
 begin
  perform public.admin_save_store_branding(gen_random_uuid(),settings.branding,settings.updated_at-interval '1 second');
  raise exception 'Stale branding accepted';
 exception when sqlstate 'PT409' then if sqlerrm<>'store_settings_conflict' then raise; end if; end;
 begin
  perform public.admin_save_home_layout(gen_random_uuid(),layout.revision+1,coalesce(layout.blocks,'[{"key":"hero","enabled":true},{"key":"editor_picks","enabled":true},{"key":"category_best","enabled":true},{"key":"popular","enabled":true},{"key":"benefits","enabled":true}]'));
  raise exception 'Stale home layout accepted';
 exception when sqlstate 'PT409' then if sqlerrm<>'home_layout_conflict' then raise; end if; end;
 if (select updated_at from public.store_settings where singleton)<>settings.updated_at
 or (select revision from public.home_layout_settings where singleton)<>layout.revision then raise exception 'Conflict changed saved data'; end if;
end $$;
reset role;
select 1/case when not exists(select 1 from public.audit_log where actor_id='00000000-0000-4000-8000-000000713201') then 1 else 0 end as no_conflict_audit;
-- Keep PostgreSQL's real serialization errors and the customer ticket path separate.
select 1/case when not exists(
 select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.proname<>'reserve_tickets'
 and p.prosrc ~* 'raise[[:space:]]+serialization_failure[[:space:]]+using[[:space:]]+message'
) then 1 else 0 end as no_manual_admin_serialization_errors;
rollback;
