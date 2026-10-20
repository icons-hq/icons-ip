-- Synthetic fixture only inside a leased disposable clone. The caller owns BEGIN/ROLLBACK.
create schema satisfaction_test;
create function satisfaction_test.id(n integer) returns uuid language sql immutable as $$select ('d5150000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function satisfaction_test.actor(n integer default 2) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',case when n=0 then '' else satisfaction_test.id(n)::text end,true);
 perform set_config('request.jwt.claims',case when n=0 then '{"role":"anon"}' else jsonb_build_object('sub',satisfaction_test.id(n),'role','authenticated','session_id',satisfaction_test.id(n+100))::text end,true);
end$$;
create function satisfaction_test.ok(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'satisfaction assertion: %',label;end if;raise notice 'PASS %',label;end$$;
create function satisfaction_test.error(q text,wanted text) returns void language plpgsql as $$begin begin execute q;exception when others then if position(wanted in sqlerrm)>0 or sqlstate=wanted then raise notice 'PASS rejected %',wanted;return;end if;raise;end;raise exception 'Expected error: %',wanted;end$$;
revoke all on all functions in schema satisfaction_test from public;
grant usage on schema satisfaction_test to anon,authenticated,service_role;
grant execute on all functions in schema satisfaction_test to anon,authenticated,service_role;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select satisfaction_test.id(n),'authenticated','authenticated','satisfaction-'||n||'@example.test',now(),'{"testFixture":"inquiry-satisfaction"}','{}',now(),now() from generate_series(1,6)n;
update public.profiles set role=case when id in(satisfaction_test.id(1),satisfaction_test.id(4)) then 'admin'::public.user_role when id=satisfaction_test.id(5) then 'staff'::public.user_role else 'user'::public.user_role end,
 nickname='TEST 만족도 '||right(id::text,2),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id in(select satisfaction_test.id(n) from generate_series(1,6)n);
insert into private.operator_memberships(profile_id,manager_role) values
 (satisfaction_test.id(1),case when exists(select 1 from private.operator_memberships where manager_role='owner') then 'primary' else 'owner' end),
 (satisfaction_test.id(4),'primary'),(satisfaction_test.id(5),'logistics');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select satisfaction_test.id(100+n),satisfaction_test.id(n),now(),now(),now()+interval '2 hours' from generate_series(1,6)n;
insert into public.inquiries(id,user_id,category,title,status,created_at,last_message_at,answered_at,closed_at)
 select satisfaction_test.id(200+n),satisfaction_test.id(2),'etc','TEST 만족도 d515 문의 '||n,
  case when n=4 then 'closed' when n<=3 then 'answered' else 'open' end,
  '2026-10-14T16:00:00Z'::timestamptz,'2026-10-14T17:00:00Z'::timestamptz,
  case when n<=4 then '2026-10-14T17:00:00Z'::timestamptz else null end,
  case when n=4 then '2026-10-14T18:00:00Z'::timestamptz else null end from generate_series(1,10)n;
insert into public.inquiry_messages(id,inquiry_id,author,author_id,body,created_at)
 select satisfaction_test.id(300+n),satisfaction_test.id(200+n),'user',satisfaction_test.id(2),'합성 문의 원문 '||n,'2026-10-14T16:00:00Z' from generate_series(1,10)n;
insert into public.inquiry_messages(id,inquiry_id,author,author_id,body,created_at)
 select satisfaction_test.id(400+n),satisfaction_test.id(200+n),'staff',satisfaction_test.id(4),'합성 답변 원문 '||n,'2026-10-14T17:00:00Z' from generate_series(1,4)n;
-- A post-migration CI fixture explicitly models pre-feature rows; when staged
-- before the DRAFT, the table is absent and these are genuinely legacy inserts.
do $$begin if to_regclass('private.inquiry_satisfaction_state') is not null then
 delete from private.inquiry_satisfaction_state where inquiry_id in(select satisfaction_test.id(200+n) from generate_series(1,10)n);end if;end$$;
select satisfaction_test.actor(2);
