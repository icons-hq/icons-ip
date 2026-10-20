\set ON_ERROR_STOP on
-- Isolated synthetic databases only; prepend helpers/goods_kc_fixture.sql.
-- Fixtures and public writes are enclosed in one rollback transaction.
-- Run after home_review_best_priority.sql with the same KC helper prelude.
begin;
set local timezone='UTC';
load 'safeupdate';
create function pg_temp.hb_id(kind integer,n integer) returns uuid language sql immutable as $$
  select ('a7b014'||lpad(kind::text,2,'0')||'-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.hb_assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Home BEST assertion: %',label;end if;end $$;
create function pg_temp.hb_expect(statement text,expected text) returns void language plpgsql as $$
begin
  begin execute statement;exception when others then if sqlstate=expected then return;end if;raise;end;
  raise exception 'Expected SQLSTATE % from %',expected,statement;
end $$;
do $$begin
  if to_regclass('private.operator_legacy_fixture_control') is not null then
    raise exception 'Run home BEST tests without a global legacy fixture helper';
  end if;
end $$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.hb_id(0,n),'authenticated','authenticated','home-best-priority-'||n||'@example.test',now(),
  '{"testFixture":"home-review-best-priority"}','{}',now(),now() from generate_series(1,4)n;
update public.profiles set role=case when id=pg_temp.hb_id(0,1) then 'admin'::public.user_role
  when id=pg_temp.hb_id(0,2) then 'staff'::public.user_role else 'user'::public.user_role end,
  nickname='홈 후기 합성 '||right(id::text,1),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
where id in(select pg_temp.hb_id(0,n) from generate_series(1,4)n);
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.hb_id(0,1),'primary'),(pg_temp.hb_id(0,2),'deputy');
update private.operator_access_state set configured=true where id;
update private.review_best_settings set enabled=false where id;
insert into public.ips(id,title,vertical_key,published_at) values('hb-qa-ip','홈 대표 후기 합성 IP','character',now());
insert into public.goods(id,ip_id,name,type,price) values('hb-qa-main','hb-qa-ip','홈 대표 후기 합성 상품','문구',1000);
-- The existing helper creates its own synthetic KC reviewer; give only that
-- reviewer an explicit local membership before it invokes the public writer.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values(('47c47700'||left(md5('hb-qa-main'),24))::uuid,'authenticated','authenticated',
  'kc-synthetic-'||md5('hb-qa-main')||'@example.test',now(),'{"testFixture":"goods-kc"}','{}');
insert into private.operator_memberships(profile_id,manager_role) values(('47c47700'||left(md5('hb-qa-main'),24))::uuid,'primary');
select pg_temp.publish_goods_kc_fixture('hb-qa-main');
create temp table hb_clock as select date_trunc('day',statement_timestamp() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as today;
grant select on hb_clock to anon,authenticated;

-- The selected one-star review is after 1,000 ordinary reviews in ID order and
-- older than the seven-day product window. Recent ordinary reviews keep the
-- product eligible; every review must still contribute to its average/count.
insert into public.orders(id,user_id,status,total,address,created_at,delivered_at)
select pg_temp.hb_id(1,n),pg_temp.hb_id(0,case when n=1001 then 4 else 3 end),'delivered',1000,'{}',
  c.today-interval '30 days',c.today-interval '25 days' from generate_series(1,1001)n cross join hb_clock c;
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select pg_temp.hb_id(1,n),'hb-qa-main',v.id,1,1000,'홈 대표 후기 합성 상품','문구','hb-qa-ip'
from generate_series(1,1001)n cross join public.goods_variants v where v.good_id='hb-qa-main' and v.is_default;
insert into public.reviews(id,user_id,good_id,order_id,rating,body,created_at)
select pg_temp.hb_id(2,n),pg_temp.hb_id(0,case when n=1001 then 4 else 3 end),'hb-qa-main',pg_temp.hb_id(1,n),
  case when n=1001 then 1 else 4 end,'홈 대표 후기 합성 본문 '||n,
  case when n=1001 then c.today-interval '20 days' else c.today-interval '1 day'+n*interval '1 microsecond' end
from generate_series(1,1001)n cross join hb_clock c;
insert into public.payments(id,user_id,purpose,ref_id,provider,amount,status,idempotency_key)
select pg_temp.hb_id(3,n),pg_temp.hb_id(0,case when n=1001 then 4 else 3 end),'order',pg_temp.hb_id(1,n),'korpay',1000,'paid','home-best-payment-'||n
from generate_series(999,1001)n;
insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
select pg_temp.hb_id(4,n),'korpay',pg_temp.hb_id(0,case when n=1001 then 4 else 3 end),'order',pg_temp.hb_id(1,n),1000,'approved',
  'home-best-attempt-'||n,'home-best-order-'||n,'home-best-product-'||n,pg_temp.hb_id(3,n),now()+interval '1 hour'
from generate_series(999,1001)n;
insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,approved_at)
select pg_temp.hb_id(4,n),'confirm',today-interval '27 days' from generate_series(999,1001)n cross join hb_clock;

create function pg_temp.hb_select(n integer,chosen boolean) returns jsonb language plpgsql as $$
declare state jsonb;
begin
  state:=public.admin_get_review_best_states(array[pg_temp.hb_id(2,n)])->0;
  return public.admin_set_review_best(pg_temp.hb_id(2,n),chosen,'홈 대표 후기 합성 선정 또는 해제',
    (state->>'revision')::integer,state->>'reviewFingerprint',gen_random_uuid());
end $$;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
select pg_temp.hb_id(6,n),pg_temp.hb_id(0,n),now(),now(),now()+interval '2 hours' from generate_series(1,4)n;
create function pg_temp.hh_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',pg_temp.hb_id(0,n)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.hb_id(0,n),'role','authenticated','session_id',pg_temp.hb_id(6,n))::text,true);
end$$;
create function pg_temp.hh_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Home helpful assertion: %',label;end if;raise notice 'PASS %',label;end$$;
create function pg_temp.hh_ids() returns text[] language sql stable as $$select array_agg(id order by id) from public.goods where id='hb-qa-main' or id like 'hh-rank-%'$$;
insert into public.goods(id,ip_id,name,type,price)
select 'hh-rank-'||lpad(n::text,2,'0'),'hb-qa-ip','홈 도움 순위 합성 '||n,'문구',1000 from generate_series(1,21)n;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}' from public.goods where id like 'hh-rank-%';
insert into private.operator_memberships(profile_id,manager_role)
select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id like 'hh-rank-%';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id like 'hh-rank-%' order by id;
insert into public.orders(id,user_id,status,total,address)
select pg_temp.hb_id(1,n+2000),pg_temp.hb_id(0,3),'canceled',1000,'{}' from generate_series(1,21)n;
insert into public.reviews(id,user_id,good_id,order_id,rating,body,created_at)
select pg_temp.hb_id(2,n+2000),pg_temp.hb_id(0,3),'hh-rank-'||lpad(n::text,2,'0'),pg_temp.hb_id(1,n+2000),(3+n%3)::smallint,'홈 도움 순위 합성 리뷰 '||n,today-interval '1 day'+n*interval '1 second' from generate_series(1,21)n cross join hb_clock;

-- Independently build the zero-vote expectation from the synthetic rows, without
-- calling either reader under test. There are no BEST selections in this fixture.
with stats as (
 select r.good_id,round(avg(r.rating)::numeric,2) rating_average,count(*) review_count,
  max(r.created_at) filter(where r.created_at>=c.today-interval '7 days' and r.created_at<c.today) recent_review_at
 from public.reviews r cross join hb_clock c where r.good_id=any(pg_temp.hh_ids()) and r.status='visible' group by r.good_id
)
select jsonb_agg(jsonb_build_object('goodId',s.good_id,'ratingAverage',s.rating_average,'reviewCount',s.review_count,
 'recentReviewAt',s.recent_review_at,'representative',jsonb_build_object('id',r.id,'rating',r.rating,'body',r.body,
 'authorName',coalesce(nullif(btrim(p.nickname),''),'팬'),'createdAt',r.created_at)) order by s.good_id) as before_json
from stats s cross join lateral (select * from public.reviews r where r.good_id=s.good_id and r.status='visible'
 order by r.rating desc,r.created_at desc,r.id limit 1)r left join public.public_profiles p on p.id=r.user_id \gset

set local role anon;
select pg_temp.hh_assert(public.get_home_review_candidates(pg_temp.hh_ids())=:'before_json'::jsonb,'zero votes preserve entire JSON for every product');
select pg_temp.hh_assert(public.get_home_best_review_candidates(array['hb-qa-main'])='[]'::jsonb,'zero votes preserve empty selected BEST projection');
select pg_temp.hh_assert(public.get_public_review_helpful_count(null)=0 and public.get_public_review_helpful_count('00000000-0000-4000-8000-000000000000')=0,'null and missing public count are zero');
select pg_temp.hb_expect($q$select * from private.review_helpful_votes$q$,'42501');
reset role;
select pg_temp.hh_actor(1);set local role authenticated;
select public.set_review_helpful('hb-qa-main',pg_temp.hb_id(2,999),true);
select pg_temp.hh_assert(public.get_home_review_candidates(array['hb-qa-main'])#>>'{0,representative,id}'=pg_temp.hb_id(2,999)::text,'ordinary helpful count precedes newer date');
select public.set_review_helpful('hb-qa-main',pg_temp.hb_id(2,1001),true);
select pg_temp.hh_actor(2);
select public.set_review_helpful('hb-qa-main',pg_temp.hb_id(2,1001),true);
select pg_temp.hh_assert(public.get_home_review_candidates(array['hb-qa-main'])#>>'{0,representative,id}'=pg_temp.hb_id(2,999)::text,'ordinary higher rating precedes higher helpful count');
select pg_temp.hh_actor(1);
select public.set_review_helpful('hb-qa-main',pg_temp.hb_id(2,1000),true);
select pg_temp.hh_assert(public.get_home_review_candidates(array['hb-qa-main'])#>>'{0,representative,id}'=pg_temp.hb_id(2,1000)::text,'ordinary equal helpful count uses newer date');
reset role;
update public.reviews set created_at=(select created_at from public.reviews where id=pg_temp.hb_id(2,1000)) where id=pg_temp.hb_id(2,999);
set local role anon;
select pg_temp.hh_assert(public.get_home_review_candidates(array['hb-qa-main'])#>>'{0,representative,id}'=pg_temp.hb_id(2,999)::text,'ordinary complete tie keeps ID ascending');
select pg_temp.hh_assert(public.get_public_review_helpful_count(pg_temp.hb_id(2,1001))=2,'anonymous scalar exposes actual public count');
reset role;
update public.reviews set created_at=(select today-interval '1 day'+999*interval '1 microsecond' from hb_clock) where id=pg_temp.hb_id(2,999);
select pg_temp.hh_actor(1);set local role authenticated;
select public.set_review_helpful('hb-qa-main',pg_temp.hb_id(2,1000),false);
select pg_temp.hh_assert(public.get_home_review_candidates(array['hb-qa-main'])#>>'{0,representative,id}'=pg_temp.hb_id(2,999)::text,'ordinary cancellation changes representative');
select pg_temp.hb_select(1001,true);
select pg_temp.hh_assert(public.get_home_review_candidates(array['hb-qa-main'])#>>'{0,representative,id}'=pg_temp.hb_id(2,1001)::text,'valid one-star BEST precedes higher ordinary rating');
select pg_temp.hb_select(999,true);select pg_temp.hb_select(1000,true);
select pg_temp.hh_assert(public.get_home_best_review_candidates(array['hb-qa-main'])#>>'{0,representative,id}'=pg_temp.hb_id(2,999)::text,'BEST rating then helpful precedes date');
select public.set_review_helpful('hb-qa-main',pg_temp.hb_id(2,1000),true);
select pg_temp.hh_assert(public.get_home_best_review_candidates(array['hb-qa-main'])#>>'{0,representative,id}'=pg_temp.hb_id(2,1000)::text,'BEST equal helpful count uses date');
reset role;
update public.reviews set created_at=(select created_at from public.reviews where id=pg_temp.hb_id(2,1000)) where id=pg_temp.hb_id(2,999);
set local role anon;
select pg_temp.hh_assert(public.get_home_best_review_candidates(array['hb-qa-main'])#>>'{0,representative,id}'=pg_temp.hb_id(2,999)::text,'BEST complete tie keeps ID ascending');
reset role;
update public.reviews set created_at=(select today-interval '1 day'+999*interval '1 microsecond' from hb_clock) where id=pg_temp.hb_id(2,999);
select pg_temp.hh_actor(1);set local role authenticated;
select public.set_review_helpful('hb-qa-main',pg_temp.hb_id(2,1000),false);
select public.get_home_review_candidates(pg_temp.hh_ids()) as hh_after \gset
select pg_temp.hh_assert((select jsonb_agg(x-'representative' order by x->>'goodId') from jsonb_array_elements(:'hh_after'::jsonb)x)=(select jsonb_agg(x-'representative' order by x->>'goodId') from jsonb_array_elements(:'before_json'::jsonb)x),'all product IDs order average count and recent date are unchanged');
reset role;
savepoint hidden;
update public.reviews set status='hidden',hidden_at=now(),hidden_reason='홈 도움 합성 숨김' where id=pg_temp.hb_id(2,999);
set local role anon;
select pg_temp.hh_assert(public.get_public_review_helpful_count(pg_temp.hb_id(2,999))=0 and public.get_home_best_review_candidates(array['hb-qa-main'])#>>'{0,representative,id}'<>pg_temp.hb_id(2,999)::text and public.get_home_review_candidates(array['hb-qa-main'])#>>'{0,representative,id}'<>pg_temp.hb_id(2,999)::text,'hidden most-helpful review is absent from both candidates');
reset role;rollback to hidden;
savepoint good_private;update public.goods set published_at=null where id='hb-qa-main';set local role anon;
select pg_temp.hh_assert(public.get_public_review_helpful_count(pg_temp.hb_id(2,999))=0 and public.get_home_review_candidates(array['hb-qa-main'])='[]'::jsonb,'unpublished good is unavailable');
reset role;rollback to good_private;
savepoint good_archive;update public.goods set archived_at=now() where id='hb-qa-main';set local role anon;
select pg_temp.hh_assert(public.get_public_review_helpful_count(pg_temp.hb_id(2,999))=0 and public.get_home_review_candidates(array['hb-qa-main'])='[]'::jsonb,'archived good is unavailable');
reset role;rollback to good_archive;
savepoint ip_private;update public.ips set published_at=null where id='hb-qa-ip';set local role anon;
select pg_temp.hh_assert(public.get_public_review_helpful_count(pg_temp.hb_id(2,999))=0 and public.get_home_review_candidates(array['hb-qa-main'])='[]'::jsonb,'unpublished IP is unavailable');
reset role;rollback to ip_private;
savepoint ip_archive;
update public.goods set archived_at=now() where ip_id='hb-qa-ip';
update public.ips set archived_at=now() where id='hb-qa-ip';set local role anon;
select pg_temp.hh_assert(public.get_public_review_helpful_count(pg_temp.hb_id(2,999))=0 and public.get_home_review_candidates(array['hb-qa-main'])='[]'::jsonb,'archived IP is unavailable');
reset role;rollback to ip_archive;
savepoint restricted;update public.goods set sale_restriction='adult' where id='hb-qa-main';set local role anon;
select pg_temp.hh_assert(public.get_public_review_helpful_count(pg_temp.hb_id(2,999))=0 and public.get_home_review_candidates(array['hb-qa-main'])='[]'::jsonb,'restricted good is unavailable');
reset role;rollback to restricted;
set local role service_role;select pg_temp.hb_expect($q$select public.get_public_review_helpful_count(null)$q$,'42501');reset role;
select pg_temp.hh_assert(not has_function_privilege('service_role','public.get_public_review_helpful_count(uuid)','EXECUTE') and not has_table_privilege('anon','private.review_helpful_votes','SELECT') and not has_table_privilege('authenticated','private.review_helpful_votes','SELECT'),'scalar helper and raw private table ACL seals');
create temp table hh_locks as select locktype,classid,objid,objsubid,mode from pg_locks where pid=pg_backend_pid() and locktype='advisory';
create temp table hh_mutations as select md5(jsonb_build_object('votes',(select jsonb_agg(to_jsonb(v)order by review_id,user_id)from private.review_helpful_votes v),'selections',(select jsonb_agg(to_jsonb(v)order by review_id)from private.review_best_selections v),'audit',(select jsonb_agg(to_jsonb(v)order by id)from public.audit_log v),'awards',(select jsonb_agg(to_jsonb(v)order by entry_id)from private.review_event_awards v))::text)hash;
set local transaction_read_only=on;set local role anon;
select pg_temp.hh_assert(public.get_home_review_candidates(pg_temp.hh_ids())=:'hh_after'::jsonb,'actual read-only transaction preserves public JSON');
select pg_temp.hh_assert(jsonb_array_length(public.get_home_review_candidates(array_fill('hb-qa-main'::text,array[200])))=1,'200 requested IDs deduplicate');
reset role;
select pg_temp.hh_assert(not exists((select locktype,classid,objid,objsubid,mode from pg_locks where pid=pg_backend_pid() and locktype='advisory') except select * from hh_locks),'public read creates no account or topology advisory lock');
select pg_temp.hh_assert((select hash from hh_mutations)=md5(jsonb_build_object('votes',(select jsonb_agg(to_jsonb(v)order by review_id,user_id)from private.review_helpful_votes v),'selections',(select jsonb_agg(to_jsonb(v)order by review_id)from private.review_best_selections v),'audit',(select jsonb_agg(to_jsonb(v)order by id)from public.audit_log v),'awards',(select jsonb_agg(to_jsonb(v)order by entry_id)from private.review_event_awards v))::text),'public read preserves votes selections audit and rewards');
rollback;
