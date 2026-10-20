\set ON_ERROR_STOP on
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('bfc01353-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'member-projection-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,2)n;
update public.profiles set role='staff' where id='bfc01353-0000-4000-8000-000000000001';
update public.profiles set loyalty_grade='gold' where id='bfc01353-0000-4000-8000-000000000002';
insert into private.operator_memberships(profile_id,manager_role)
 values('bfc01353-0000-4000-8000-000000000001','primary');
set local role authenticated;
select set_config('request.jwt.claim.sub','bfc01353-0000-4000-8000-000000000001',true);
do $$ declare result jsonb;
begin
 if exists(select 1 from public.profiles where id='bfc01353-0000-4000-8000-000000000002') then
  raise exception 'cross-profile RLS must remain closed'; end if;
 result:=public.admin_member_moderation_context(array['bfc01353-0000-4000-8000-000000000002']::uuid[]);
 if result->0->>'loyaltyGrade'<>'gold' or (result->0->>'canModerate')::boolean is not true then
  raise exception 'actual grade or moderation projection missing: %',result; end if;
 if result->0 ?| array['email','birth_date','consents'] then raise exception 'unnecessary member data'; end if;
end $$;
reset role;
update private.operator_memberships set manager_role='deputy' where profile_id='bfc01353-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 begin
  perform public.admin_member_moderation_context(array['bfc01353-0000-4000-8000-000000000002']::uuid[]);
  raise exception 'deputy accessed member projection';
 exception when insufficient_privilege then null;end;
end $$;
rollback;
