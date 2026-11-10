-- Loaded only in a leased disposable clone. No trigger/permission bypasses.
begin;
do $$begin
 if current_database() !~ '^icons_(group_edges|goods_transaction)_[0-9a-f]{32}$'
  or not exists(select 1 from private.operator_fixture_clone_identity where singleton
   and source_database='postgres' and container_id ~ '^[0-9a-f]{64}$'
   and right(current_database(),32)=replace(lease::text,'-','')) then
  raise exception 'Group edge fixtures require their leased disposable clone';end if;
end$$;
create function goods_group_edge_test.id(n integer) returns uuid language sql immutable as $$select ('a6150000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select goods_group_edge_test.id(n),'authenticated','authenticated','group-edge-'||n||'@example.test',now(),'{"testFixture":"group-edge"}','{}',now(),now() from generate_series(1,4)n;
update public.profiles set role=case when id=goods_group_edge_test.id(1) then 'admin'::public.user_role when id=goods_group_edge_test.id(2) then 'staff'::public.user_role else 'user'::public.user_role end,
 nickname='TEST 그룹 엣지 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id in(select goods_group_edge_test.id(n) from generate_series(1,4)n);
-- Role-change HTTP/races need an actual owner. Preserve the existing fixture
-- owner, transfer only inside this leased clone, then restore in the race finalizer.
create table goods_group_edge_test.prior_owners as select to_jsonb(m) value from private.operator_memberships m where manager_role='owner';
create table goods_group_edge_test.prior_access_state as select to_jsonb(s) value from private.operator_access_state s;
update private.operator_memberships set manager_role='primary' where manager_role='owner';
insert into private.operator_memberships(profile_id,manager_role) values(goods_group_edge_test.id(1),'owner'),(goods_group_edge_test.id(2),'deputy');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select goods_group_edge_test.id(100+n),goods_group_edge_test.id(n),now(),now(),now()+interval '2 hours' from generate_series(1,4)n;
insert into public.ips(id,title,vertical_key,published_at) values('group-edge-ip','TEST 그룹 엣지 IP','character',now());
create function goods_group_edge_test.actor(n integer default 1) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',goods_group_edge_test.id(n)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',goods_group_edge_test.id(n),'role','authenticated','session_id',goods_group_edge_test.id(100+n))::text,true);
end$$;
create function goods_group_edge_test.make_source(n integer,p_publish boolean default false) returns text language plpgsql as $$
declare gid text:='group-edge-'||n;reviewer uuid:=('47c47700'||left(md5(gid),24))::uuid;
begin
 insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values(gid,'group-edge-ip','TEST 엣지 '||n||' 빨강','문구',10000,'ok',7);
 insert into public.goods_variants(id,good_id,name,attributes,price,stock_qty,sort_order,is_default) values
  (goods_group_edge_test.id(1000+n*10+1),gid,'파랑','{"색상":"파랑"}',12000,11,1,false),
  (goods_group_edge_test.id(1000+n*10+2),gid,'미선택','{"색상":"미선택"}',13000,13,2,false);
 if p_publish then
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
   values(reviewer,'authenticated','authenticated','kc-group-edge-'||n||'@example.test',now(),'{"testFixture":"goods-kc"}','{}',now(),now());
  insert into private.operator_memberships(profile_id,manager_role) values(reviewer,'primary');
  perform goods_group_edge_test.publish_goods_kc_fixture(gid);
 end if;
 return gid;
end$$;
create function goods_group_edge_test.request(n integer) returns jsonb language sql stable as $$
 select jsonb_build_object('sourceGoodId','group-edge-'||n,'name','TEST 엣지 '||n,'optionNames',jsonb_build_array('색상'),'selections',jsonb_build_array(
  jsonb_build_object('variantId',(select id from public.goods_variants where good_id='group-edge-'||n and is_default and archived_at is null),'values',jsonb_build_array('빨강')),
  jsonb_build_object('variantId',goods_group_edge_test.id(1000+n*10+1),'values',jsonb_build_array('파랑'))));
$$;
create function goods_group_edge_test.assert_error(q text,wanted text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if position(wanted in sqlerrm)>0 or sqlstate=wanted then return;end if;raise;end;
 raise exception 'Expected error: %',wanted;
end$$;
create function goods_group_edge_test.preview(n integer,p_actor integer default 1) returns jsonb language sql as $$
 select public.admin_preview_goods_group_conversion(goods_group_edge_test.request(n),goods_group_edge_test.id(p_actor),goods_group_edge_test.id(100+p_actor));
$$;
create function goods_group_edge_test.confirm(p_preview uuid,p_operation integer,p_actor integer default 1) returns jsonb language sql as $$
 select public.admin_confirm_goods_group_conversion(p_preview,goods_group_edge_test.id(p_operation),goods_group_edge_test.id(p_actor),goods_group_edge_test.id(100+p_actor));
$$;
create function goods_group_edge_test.restore_owner() returns void language plpgsql as $$
declare previous jsonb;assignments text;
begin
 if current_database() !~ '^icons_(group_edges|goods_transaction)_[0-9a-f]{32}$'
  or not exists(select 1 from private.operator_fixture_clone_identity where singleton and source_database='postgres'
   and container_id ~ '^[0-9a-f]{64}$' and right(current_database(),32)=replace(lease::text,'-','')) then
  raise exception 'Group edge restoration requires its leased disposable clone';end if;
 update private.operator_memberships set manager_role='primary' where profile_id=goods_group_edge_test.id(1) and manager_role='owner';
 select string_agg(format('%I=prior.%I',attname,attname),',' order by attnum) into assignments from pg_attribute
  where attrelid='private.operator_memberships'::regclass and attnum>0 and not attisdropped;
 for previous in select value from goods_group_edge_test.prior_owners loop
  execute 'update private.operator_memberships m set '||assignments||' from jsonb_populate_record(null::private.operator_memberships,$1) prior where m.profile_id=prior.profile_id' using previous;
  if not exists(select 1 from private.operator_memberships m where m.profile_id=(previous->>'profile_id')::uuid and to_jsonb(m)=previous) then
   raise exception 'Prior fixture owner was not exactly restored';end if;
 end loop;
 select string_agg(format('%I=prior.%I',attname,attname),',' order by attnum) into assignments from pg_attribute
  where attrelid='private.operator_access_state'::regclass and attnum>0 and not attisdropped;
 for previous in select value from goods_group_edge_test.prior_access_state loop
  execute 'update private.operator_access_state s set '||assignments||' from jsonb_populate_record(null::private.operator_access_state,$1) prior where s.id=prior.id' using previous;
  if not exists(select 1 from private.operator_access_state s where s.id=(previous->>'id')::boolean and to_jsonb(s)=previous) then
   raise exception 'Prior fixture access state was not exactly restored';end if;
 end loop;
end$$;
-- Fixture helpers are reachable only through the test schema in this clone;
-- PostgREST exposes public alone, and all writes under test call the real RPCs.
grant usage on schema goods_group_edge_test to authenticated,service_role;
grant execute on all functions in schema goods_group_edge_test to authenticated,service_role;
commit;
