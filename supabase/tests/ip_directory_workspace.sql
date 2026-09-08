\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-4000-8000-000000041201','authenticated','authenticated','ip-directory-staff@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000041202','authenticated','authenticated','ip-directory-user@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000041201';
update public.ips set featured=false;
insert into public.verticals(key,label,color) values ('ip-workspace','IP 허브','#000000');
insert into public.ips(id,title,vertical_key,published_at)
select 'ip-workspace-'||n,'허브 '||n,'ip-workspace',now() from generate_series(1,6)n;

select 1 / case when not has_function_privilege('anon','public.admin_set_ip_directory(text,boolean,integer,text[],boolean)','execute')
 then 1 else 0 end as assert_anonymous_directory_write_sealed;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000041202',true);
do $$ begin
  begin
    perform public.admin_set_ip_directory('ip-workspace-1',true,1,array(select id from public.ips order by sort_order,id),false);
    raise exception 'nonstaff directory update allowed';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000041201',true);
create temp table prior_ip_order as select array_agg(id order by sort_order,id) ids from public.ips;
select public.admin_set_ip_directory('ip-workspace-1',true,1,(select ids from prior_ip_order),false);
select public.admin_upsert_ip('ip-workspace-1','기본정보 편집',null,'ip-workspace',null,null,null,null,null,null,'ip-workspace-1',null);
select 1 / case when (select featured from public.ips where id='ip-workspace-1') then 1 else 0 end as assert_metadata_save_preserves_directory_controls;
select 1 / case when (select id from public.ips order by sort_order,id limit 1)='ip-workspace-1'
 then 1 else 0 end as assert_rank_changes_directory_order;
do $$ begin
  begin
    perform public.admin_set_ip_directory('ip-workspace-2',true,1,(select ids from prior_ip_order),false);
    raise exception 'stale order accepted';
  exception when serialization_failure then null; end;
end $$;
do $$ declare n integer; begin
  for n in 2..5 loop
    perform public.admin_set_ip_directory('ip-workspace-'||n,true,n,array(select id from public.ips order by sort_order,id),false);
  end loop;
  begin
    perform public.admin_set_ip_directory('ip-workspace-6',true,6,array(select id from public.ips order by sort_order,id),false);
    raise exception 'six featured IPs allowed';
  exception when check_violation then
    if sqlerrm <> 'ip_featured_limit' then raise; end if;
  end;
end $$;
select 1 / case when (select count(*) from public.ips where featured)=5
 and exists(select 1 from public.audit_log where actor_id='00000000-0000-4000-8000-000000041201'
  and action='catalog.ip.directory_updated' and target='ips:ip-workspace-1')
 then 1 else 0 end as assert_featured_limit_and_audit;
reset role;
do $$ begin
  begin
    update public.ips set featured=true where id='ip-workspace-6';
    raise exception 'legacy writer bypassed featured cap';
  exception when check_violation then
    if sqlerrm <> 'ip_featured_limit' then raise; end if;
  end;
end $$;
rollback;
