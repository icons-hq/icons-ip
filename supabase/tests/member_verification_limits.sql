\set ON_ERROR_STOP on
begin;
create function pg_temp.uid(n integer) returns uuid language sql immutable as $$
  select ('ac270000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.actor(n integer) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.uid(n)::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',pg_temp.uid(n),'role','authenticated','aal','aal1')::text, true);
end $$;
create function pg_temp.assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'member verification limits: %',label; end if; end $$;
create function pg_temp.item(n integer, kind text) returns jsonb language sql as $$
  select item from jsonb_array_elements(public.admin_member_verification_limits(pg_temp.uid(n))->'limits') item where item->>'kind' = kind
$$;
create function pg_temp.clear(n integer, kind text, revision text default null) returns jsonb language sql as $$
  select public.admin_reset_member_verification_limit(pg_temp.uid(n),kind,coalesce(revision,pg_temp.item(n,kind)->>'revision'),'재신청 테스트')
$$;
create function pg_temp.photo() returns jsonb language sql as $$
  select public.reserve_overseas_adult_photo(gen_random_uuid(),'overseas_photo@2026-11-26',false)
$$;
create function pg_temp.domestic() returns jsonb language sql as $$
  select public.begin_adult_verification(pg_temp.uid(2),'test','page','/my',encode(extensions.gen_random_bytes(32),'hex'))
$$;
create function pg_temp.phone(digest text) returns jsonb language sql as $$
  select public.service_issue_member_phone_verification(gen_random_uuid(),pg_temp.uid(2),'+821012345678',digest,
    null,repeat('c',43),300)
$$;
create function pg_temp.email_code(digest text) returns jsonb language sql as $$
  select public.service_issue_member_email_change(gen_random_uuid(),pg_temp.uid(2),pg_temp.uid(12),'new@example.test',
    digest,null,repeat('c',43),600)
$$;

insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  select pg_temp.uid(n),'member-limit-'||n||'@privaterelay.appleid.com','authenticated','authenticated','{}','{}',now(),now() from generate_series(1,4) n;
update public.profiles set onboarded_at=now(), birth_date='1990-01-01', consents='{"terms":true,"privacy":true}',
  role=(case id when pg_temp.uid(1) then 'admin' when pg_temp.uid(3) then 'staff' else 'user' end)::public.user_role
  where id in (pg_temp.uid(1),pg_temp.uid(2),pg_temp.uid(3),pg_temp.uid(4));
insert into auth.sessions(id,user_id,aal,created_at,updated_at) values (pg_temp.uid(12),pg_temp.uid(2),'aal1',now(),now());
update private.operator_access_state set configured=false where id;
insert into private.operator_legacy_cohort(profile_id,legacy_role) values (pg_temp.uid(1),'admin'),(pg_temp.uid(3),'staff') on conflict do nothing;
update private.adult_goods_storefront_settings set enabled=true where singleton;
insert into private.overseas_adult_requests(user_id,state,outcome,created_at,purged_at)
  select pg_temp.uid(member),'closed','cancelled',now() - make_interval(hours => age_hours),now()
  from unnest(array[1,2,4]) member cross join unnest(array[25,5,3,1]) age_hours;

select pg_temp.assert(not has_function_privilege('anon','public.admin_member_verification_limits(uuid)','execute')
  and not has_function_privilege('anon','public.admin_reset_member_verification_limit(uuid,text,text,text)','execute')
  and not has_function_privilege('service_role','public.admin_reset_member_verification_limit(uuid,text,text,text)','execute')
  and not has_function_privilege('authenticated','private.member_verification_window(uuid,text,timestamptz)','execute'),'private boundaries');
set local role authenticated;
select pg_temp.actor(2);
do $$ begin
  begin perform pg_temp.photo(); raise exception 'fourth photo accepted';
  exception when check_violation then if sqlerrm <> 'overseas_request_limit' then raise; end if; end;
  begin perform public.admin_member_verification_limits(pg_temp.uid(2)); raise exception 'customer read limits';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_reset_member_verification_limit(pg_temp.uid(2),'overseas_adult',repeat('0',32),'테스트'); raise exception 'customer reset limits';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.actor(3);
select pg_temp.assert(public.admin_member_verification_limits(pg_temp.uid(2))->'canReset'='false','legacy staff may only read');
do $$ begin
  begin perform pg_temp.clear(2,'overseas_adult'); raise exception 'legacy staff reset limits';
  exception when insufficient_privilege then null; end;
end $$;
select pg_temp.actor(1);
select pg_temp.assert((pg_temp.item(2,'overseas_adult')->>'dayUsed')::int = 3
  and (pg_temp.item(2,'overseas_adult')->>'retryAt')::timestamptz = now() + interval '19 hours','rolling window excludes 25h and opens at oldest counted attempt + 24h');
select pg_temp.item(2,'overseas_adult')->>'revision' as original_revision \gset
select pg_temp.assert(pg_temp.clear(2,'overseas_adult')->>'outcome'='reset','user reset');
select pg_temp.assert(pg_temp.clear(2,'overseas_adult',:'original_revision')->>'outcome'='empty','duplicate has no effect');
select pg_temp.assert((pg_temp.item(1,'overseas_adult')->>'dayUsed')::int=3 and (pg_temp.item(4,'overseas_adult')->>'dayUsed')::int=3,'other members isolated');
select pg_temp.assert(pg_temp.clear(1,'overseas_adult')->>'outcome'='reset','admin can reset own test account');
select pg_temp.actor(2);
select pg_temp.assert(pg_temp.photo()->>'status'='reserved','fourth photo can now enter normal submission');
select pg_temp.actor(1);
select pg_temp.assert(pg_temp.clear(2,'overseas_adult',:'original_revision')->>'outcome'='changed'
  and (pg_temp.item(2,'overseas_adult')->>'dayUsed')::int=1,'old confirmation never clears a later attempt');
select pg_temp.assert(public.admin_member_verification_limits(pg_temp.uid(2))->>'overseasState'='uploading','active request visible');
select pg_temp.assert(pg_temp.clear(2,'overseas_adult')->>'outcome'='reset','reset with open request');
select pg_temp.actor(2);
select pg_temp.assert(pg_temp.photo()->>'status'='existing','one open request still enforced');
reset role;
select pg_temp.assert(not private.adult_verification_valid(pg_temp.uid(2)) and private.overseas_valid_until(pg_temp.uid(2)) is null
  and (select count(*)=4 from private.overseas_adult_requests where user_id=pg_temp.uid(2) and outcome='cancelled' and purged_at is not null)
  and (select count(*)=1 from private.overseas_adult_requests where user_id=pg_temp.uid(2) and state='uploading'),'decisions, destruction and original request preserved');
select pg_temp.assert((select count(*)=2 from public.audit_log where target=pg_temp.uid(2)::text and action='admin.member.verification_limit_reset'
  and actor_id=pg_temp.uid(1) and diff->>'reason'='재신청 테스트' and diff->>'kind'='overseas_adult'),'only effective resets audited');

-- 실제 KCP 및 발송 RPC로 회원 차단과 해제를 확인한다. 공유 수신처에 대한 발송 한도는 살아 있다.
do $$ begin
  for i in 1..10 loop perform pg_temp.domestic(); end loop;
  begin perform pg_temp.domestic(); raise exception 'domestic hour limit bypassed';
  exception when sqlstate '55000' then if sqlerrm <> 'adult_verification_rate_limited' then raise; end if; end;
end $$;
insert into private.member_phone_verification_challenges(id,user_id,phone_digest,code_digest,status,created_at,expires_at,resolved_at)
  select gen_random_uuid(),pg_temp.uid(2),repeat('a',43),repeat('c',43),'superseded',now()-i*interval '2 minutes',now()+interval '1 hour',now() from generate_series(1,5) i;
insert into private.member_email_change_challenges(id,user_id,email_digest,code_digest,status,created_at,expires_at,resolved_at)
  select gen_random_uuid(),pg_temp.uid(2),repeat('a',43),repeat('c',43),'superseded',now()-i*interval '2 minutes',now()+interval '1 hour',now() from generate_series(1,5) i;
select pg_temp.assert(pg_temp.phone(repeat('b',43))->>'reason'='rate_limited' and pg_temp.email_code(repeat('b',43))->>'reason'='rate_limited','account send limits enforced');
select pg_temp.actor(1);
set local role authenticated;
select pg_temp.assert(pg_temp.clear(2,'domestic_adult')->>'outcome'='reset' and pg_temp.item(2,'phone_code')->>'hourUsed'='5','kinds isolated');
select pg_temp.assert(pg_temp.clear(2,'phone_code')->>'outcome'='reset' and pg_temp.clear(2,'email_change')->>'outcome'='reset','contact limits cleared');
reset role;
select pg_temp.assert(pg_temp.domestic()->>'sessionId' is not null,'KCP retry');
select pg_temp.assert(pg_temp.phone(repeat('a',43))->>'reason'='rate_limited' and pg_temp.email_code(repeat('a',43))->>'reason'='rate_limited','shared destination limits preserved');
select pg_temp.assert(pg_temp.phone(repeat('b',43))->>'ok'='true' and pg_temp.email_code(repeat('b',43))->>'ok'='true','new sends may proceed');
select pg_temp.assert(pg_temp.phone(repeat('d',43))->>'reason'='cooldown' and pg_temp.email_code(repeat('d',43))->>'reason'='cooldown','account resend waits');
select pg_temp.assert(pg_temp.clear(2,'phone_code')->>'outcome'='reset' and pg_temp.clear(2,'email_change')->>'outcome'='reset','resend waits cleared');
select pg_temp.assert(pg_temp.phone(repeat('b',43))->>'reason'='cooldown','same number still waits 60 seconds');
select pg_temp.assert(pg_temp.phone(repeat('d',43))->>'ok'='true' and pg_temp.email_code(repeat('d',43))->>'ok'='true','member cooldown cleared for new destination');
rollback;
