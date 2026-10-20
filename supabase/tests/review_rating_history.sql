\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql in the same connection. Every change rolls back.
-- Fixture block below is copied from helpers/review_rating_history_fixture.sql.
begin;
-- Test-only helper. Run only in an explicitly leased disposable clone, or inside
-- the regression's BEGIN/ROLLBACK. Never include this file in migrations or seed.
create function pg_temp.rrh_id(n integer) returns uuid language sql immutable as $$select ('a7220000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.rrh_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'review rating history assertion: %',label;end if;raise notice 'PASS %',label;
end$$;
create function pg_temp.rrh_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then raise notice 'PASS rejected %',expected;return;end if;raise;end;
 raise exception 'Expected review rating history error: %',expected;
end$$;
create function pg_temp.rrh_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',pg_temp.rrh_id(n)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rrh_id(n),'role','authenticated','session_id',pg_temp.rrh_id(n+100))::text,true);
end$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.rrh_id(n),'authenticated','authenticated','review-rating-history-'||n||'@example.test',now(),'{"testFixture":"review-rating-history-a722"}','{}',now(),now() from generate_series(1,3)n;
update public.profiles set role=case when id=pg_temp.rrh_id(1) then 'admin'::public.user_role when id=pg_temp.rrh_id(3) then 'staff'::public.user_role else 'user'::public.user_role end,
 nickname='TEST 평점 이력 a722 '||right(id::text,2),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id in(pg_temp.rrh_id(1),pg_temp.rrh_id(2),pg_temp.rrh_id(3));
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.rrh_id(1),'primary'),(pg_temp.rrh_id(3),'logistics');
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select pg_temp.rrh_id(n+100),pg_temp.rrh_id(n),now(),now(),now()+interval '2 hours' from generate_series(1,3)n;
insert into public.ips(id,title,vertical_key,published_at) values('review-rating-history-ip','TEST 평점 이력 a722 IP','character',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty)
 select 'review-rating-history-'||suffix,'review-rating-history-ip','TEST 평점 이력 a722 상품 '||suffix,'문구',10000,'ok',10 from unnest(array['a','b','empty','draft','adult','archived'])suffix;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}' from public.goods where id in('review-rating-history-a','review-rating-history-b','review-rating-history-empty','review-rating-history-draft','review-rating-history-adult','review-rating-history-archived');
insert into private.operator_memberships(profile_id,manager_role)
 select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id in('review-rating-history-a','review-rating-history-b','review-rating-history-empty','review-rating-history-draft','review-rating-history-adult','review-rating-history-archived');
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in('review-rating-history-a','review-rating-history-b','review-rating-history-empty','review-rating-history-draft','review-rating-history-adult','review-rating-history-archived') and id<>'review-rating-history-draft' order by id;
update public.goods set sale_restriction='adult' where id='review-rating-history-adult';
update public.goods_variants set stock_qty=0 where good_id='review-rating-history-archived';
select pg_temp.rrh_assert((select stock_qty=0 from public.goods where id='review-rating-history-archived'),'owned archived fixture stock cache reaches zero');
update public.goods set archived_at=clock_timestamp(),published_at=null where id='review-rating-history-archived';
insert into public.orders(id,user_id,status,total,address)
 select pg_temp.rrh_id(200+n),pg_temp.rrh_id(2),'canceled',10000,'{}' from generate_series(1,12)n;
insert into public.reviews(id,user_id,good_id,order_id,rating,body,created_at)
 select pg_temp.rrh_id(300+n),pg_temp.rrh_id(2),case when n=1 then 'review-rating-history-a'
  when n<=8 then 'review-rating-history-b' when n=9 then 'review-rating-history-draft' when n=10 then 'review-rating-history-adult'
  when n=11 then 'review-rating-history-archived' else 'review-rating-history-empty' end,
 pg_temp.rrh_id(200+n),case when n=1 then 1 else 5 end,'TEST 평점 이력 a722 리뷰 '||n,
 case when n=1 then (date_trunc('day',statement_timestamp() at time zone 'Asia/Seoul')-interval '7 months') at time zone 'Asia/Seoul'
  when n=6 then (date_trunc('day',statement_timestamp() at time zone 'Asia/Seoul')-interval '6 months') at time zone 'Asia/Seoul'
  when n=7 then ((date_trunc('day',statement_timestamp() at time zone 'Asia/Seoul')-interval '6 months') at time zone 'Asia/Seoul')-interval '1 microsecond'
  when n=8 then date_trunc('day',statement_timestamp() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'
  else (date_trunc('day',statement_timestamp() at time zone 'Asia/Seoul')-interval '1 day') at time zone 'Asia/Seoul' end
 from generate_series(1,12)n;
select pg_temp.rrh_actor(1);
set local role authenticated;
select public.admin_set_review_status(pg_temp.rrh_id(312),'hidden','TEST 평점 이력 a722 숨김 fixture',null);
reset role;
-- Separate synthetic contract versions preserve the default v1 metadata entirely.
insert into private.review_rating_observation_contracts(version,source_reader_sha256,aggregate_sha256)
 select 7721,source_reader_sha256,aggregate_sha256 from private.review_rating_observation_contracts where version=1;
insert into private.review_rating_observation_contracts(version,source_reader_sha256,aggregate_sha256)
 select 7722,source_reader_sha256,aggregate_sha256 from private.review_rating_observation_contracts where version=1;

select pg_temp.rrh_assert((select not enabled and collection_started_at is null and last_success_at is null
 and purged_before_as_of is null and last_purged_at is null from private.review_rating_observation_contracts where version=7722),'initial disabled collection has no invented start or success');
create temporary table rrh_initial as select to_jsonb(c) value from private.review_rating_observation_contracts c where version=1;
create temporary table rrh_current_reader as select pg_get_functiondef('public.admin_review_insights(text,text,text,integer,integer)'::regprocedure) definition,
 proowner,proacl from pg_proc where oid='public.admin_review_insights(text,text,text,integer,integer)'::regprocedure;

do $$declare signature text;grantees text[];expected text[];owner_name text;rel regclass;role_name text;verb text;begin
 foreach signature in array array['private.review_rating_snapshot(timestamp with time zone)','private.assert_review_rating_contract(integer)',
 'public.service_observe_review_rating_daily()','public.admin_review_rating_comparison(date)'] loop
  select pg_get_userbyid(p.proowner),(select array_agg(pg_get_userbyid(x.grantee)::text order by pg_get_userbyid(x.grantee)::text) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))x) into owner_name,grantees from pg_proc p where p.oid=signature::regprocedure;
  expected:=case signature when 'public.service_observe_review_rating_daily()' then array['postgres','service_role']
   when 'public.admin_review_rating_comparison(date)' then array['authenticated','postgres'] else array['postgres'] end;
  perform pg_temp.rrh_assert(owner_name='postgres' and grantees=expected,'new owner and exact EXECUTE ACL '||signature);
 end loop;
 foreach rel in array array['private.review_rating_observation_contracts'::regclass,'private.review_rating_daily_observations'::regclass] loop
  perform pg_temp.rrh_assert((select relrowsecurity and relowner='postgres'::regrole from pg_class where oid=rel),'private table RLS and owner '||rel);
  foreach role_name in array array['anon','authenticated','service_role'] loop
   foreach verb in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    perform pg_temp.rrh_assert(not has_table_privilege(role_name,rel,verb),'sealed direct table '||role_name||' '||verb||' '||rel);
   end loop;
  end loop;
 end loop;
 perform pg_temp.rrh_assert((select pronargs=0 from pg_proc where oid='public.service_observe_review_rating_daily()'::regprocedure),'collector exposes no date or backfill argument');
end$$;
set local role service_role;
select pg_temp.rrh_assert(public.service_observe_review_rating_daily()->>'status'='disabled','disabled job reports disabled');
select pg_temp.rrh_error($q$select public.admin_review_rating_comparison((statement_timestamp() at time zone 'Asia/Seoul')::date-1)$q$,'42501');
select pg_temp.rrh_error('select * from private.review_rating_daily_observations','42501');
reset role;
select pg_temp.rrh_assert((select collection_started_at is null and purged_before_as_of is null from private.review_rating_observation_contracts where version=7722),'disabled unstarted job does not manufacture collection metadata');
set local role authenticated;
select pg_temp.rrh_assert(public.admin_review_rating_comparison((statement_timestamp() at time zone 'Asia/Seoul')::date-1)->>'status'='before_collection_start','initial history explicitly before collection start');
select pg_temp.rrh_error('select public.service_observe_review_rating_daily()','42501');
select pg_temp.rrh_error('select * from private.review_rating_observation_contracts','42501');
select pg_temp.rrh_error('select * from private.review_rating_snapshot(clock_timestamp())','42501');
select pg_temp.rrh_error($q$select public.admin_review_rating_comparison(null)$q$,'22023');
select pg_temp.rrh_error($q$select public.admin_review_rating_comparison((statement_timestamp() at time zone 'Asia/Seoul')::date-2)$q$,'PT409');
select pg_temp.rrh_actor(3);
select pg_temp.rrh_error($q$select public.admin_review_rating_comparison((statement_timestamp() at time zone 'Asia/Seoul')::date-1)$q$,'42501');
reset role;set local role anon;
select pg_temp.rrh_error($q$select public.admin_review_rating_comparison((statement_timestamp() at time zone 'Asia/Seoul')::date-1)$q$,'42501');
select pg_temp.rrh_error('select public.service_observe_review_rating_daily()','42501');
reset role;select pg_temp.rrh_actor(1);

-- Current-source drift blocks both readers and the collector, even while disabled.
savepoint reader_drift;
do $$declare definition text;begin
 select pg_get_functiondef('public.admin_review_insights(text,text,text,integer,integer)'::regprocedure) into definition;
 execute replace(definition,'AS $function$','AS $function$'||chr(10)||'-- test-only current source drift'||chr(10));
end$$;
set local role service_role;
select pg_temp.rrh_error('select public.service_observe_review_rating_daily()','55000');
reset role;set local role authenticated;
select pg_temp.rrh_error($q$select public.admin_review_rating_comparison((statement_timestamp() at time zone 'Asia/Seoul')::date-1)$q$,'55000');
reset role;rollback to reader_drift;
savepoint aggregate_drift;
do $$declare definition text;begin
 select pg_get_functiondef('private.review_rating_snapshot(timestamptz)'::regprocedure) into definition;
 execute replace(definition,'AS $function$','AS $function$'||chr(10)||'-- test-only aggregate source drift'||chr(10));
end$$;
set local role service_role;
select pg_temp.rrh_error('select public.service_observe_review_rating_daily()','55000');
reset role;set local role authenticated;
select pg_temp.rrh_error($q$select public.admin_review_rating_comparison((statement_timestamp() at time zone 'Asia/Seoul')::date-1)$q$,'55000');
reset role;rollback to aggregate_drift;

-- Independent grouping oracle and old reader execute in the same SQL snapshot.
create function pg_temp.rrh_parity(label text) returns void language plpgsql as $$declare result boolean;begin
 with live as materialized(select public.admin_review_insights() value), fresh as materialized(select * from private.review_rating_snapshot(statement_timestamp())),
 grouped as (select r.good_id,avg(r.rating) rating,
  avg(r.rating) filter(where r.created_at>=(date_trunc('day',statement_timestamp() at time zone 'Asia/Seoul')-interval '6 months') at time zone 'Asia/Seoul') six,
  count(*) reviews,count(*) filter(where r.created_at>=(date_trunc('day',statement_timestamp() at time zone 'Asia/Seoul')-interval '6 months') at time zone 'Asia/Seoul') six_reviews
  from public.reviews r where r.status='visible' and r.created_at<date_trunc('day',statement_timestamp() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'
  and exists(select 1 from public.goods g,public.ips i where g.id=r.good_id and i.id=g.ip_id and g.published_at is not null and g.archived_at is null and i.published_at is not null and i.archived_at is null and g.sale_restriction='none') group by r.good_id),
 oracle as (select avg(rating) rating,avg(six) six,count(rating) rated,count(six) six_rated,coalesce(sum(reviews),0) reviews,coalesce(sum(six_reviews),0) six_reviews from grouped)
 select (live.value#>'{summary,averageRating}') is not distinct from coalesce(to_jsonb(round(f.average_rating,2)),'null')
  and (live.value#>'{summary,sixMonthRating}') is not distinct from coalesce(to_jsonb(round(f.six_month_rating,2)),'null')
  and f.average_rating is not distinct from o.rating and f.six_month_rating is not distinct from o.six
  and f.rated_product_count=o.rated and f.six_month_rated_product_count=o.six_rated and f.review_count=o.reviews and f.six_month_review_count=o.six_reviews into result
 from live cross join fresh f cross join oracle o;
 perform pg_temp.rrh_assert(result,label);
end$$;
select pg_temp.rrh_parity('same snapshot live reader and independent unweighted oracle match');
select pg_temp.rrh_assert((select avg(mean)=3 from (select avg(rating) mean from public.reviews where good_id in('review-rating-history-a','review-rating-history-b') group by good_id)t)
 and (select avg(rating)>4 from public.reviews where good_id in('review-rating-history-a','review-rating-history-b')),'unequal fixture sizes distinguish product means from review weighting');
select pg_temp.rrh_assert((public.admin_review_insights('all','no-such-product-a722','reviews',2,50)#>'{summary,averageRating}') is not distinct from
 (public.admin_review_insights('rating','','rating',1,20)#>'{summary,averageRating}'),'live benchmark stays independent of search focus sort and page');
select pg_temp.rrh_assert(('2026-05-31'::timestamp-interval '3 months')::date='2026-02-28' and ('2024-05-31'::timestamp-interval '3 months')::date='2024-02-29'
 and ('2026-08-31'::timestamp-interval '3 months')::date='2026-05-31','calendar month ends and leap day remain exact');
select pg_temp.rrh_assert(('2026-10-14 14:59:59.999999+00'::timestamptz at time zone 'Asia/Seoul')::date='2026-10-14'
 and ('2026-10-14 15:00:00+00'::timestamptz at time zone 'Asia/Seoul')::date='2026-10-15'
 and ('2026-10-14 15:04:59.999999+00'::timestamptz at time zone 'Asia/Seoul')::time<time '00:05'
 and ('2026-10-14 15:05:00+00'::timestamptz at time zone 'Asia/Seoul')::time>=time '00:05','KST midnight and 00:05 collection boundary');

-- Only synthetic version metadata changes; v1 remains byte-for-byte untouched.
update private.review_rating_observation_contracts set enabled=true,collection_started_at=clock_timestamp() where version=7722;
set local role service_role;
select public.service_observe_review_rating_daily() result \gset rrh_first_
reset role;
create temporary table rrh_first as select :'rrh_first_result'::jsonb value;
create temporary table rrh_observation_before as select to_jsonb(d) value from private.review_rating_daily_observations d where version=7722;
select pg_temp.rrh_assert((select value->>'status'=case when (clock_timestamp() at time zone 'Asia/Seoul')::time>=time '00:05' then 'recorded' else 'too_early' end from rrh_first),'first actual service collection uses actual observation clock');
update public.reviews set rating=2 where id=pg_temp.rrh_id(301);
select pg_temp.rrh_parity('rating edit updates live aggregate with the same formula');
set local role authenticated;
select public.admin_set_review_status(pg_temp.rrh_id(302),'hidden','TEST 평점 이력 a722 관측 후 숨김',null);
reset role;
select pg_temp.rrh_parity('hidden review excluded by both aggregates');
update public.goods set published_at=null where id='review-rating-history-b';
select pg_temp.rrh_parity('unpublished goods excluded by both aggregates');
update public.ips set published_at=null where id='review-rating-history-ip';
select pg_temp.rrh_parity('unpublished IP excluded by both aggregates');
-- Preserve normal archive guards: retire only the six owned children and their stock.
update public.goods_variants set stock_qty=0 where good_id in('review-rating-history-a','review-rating-history-b','review-rating-history-empty','review-rating-history-draft','review-rating-history-adult','review-rating-history-archived');
select pg_temp.rrh_assert((select count(*)=6 and bool_and(stock_qty=0) from public.goods where id in('review-rating-history-a','review-rating-history-b','review-rating-history-empty','review-rating-history-draft','review-rating-history-adult','review-rating-history-archived')),'all owned child stock caches reach zero before archive');
update public.goods set published_at=null,archived_at=clock_timestamp() where id in('review-rating-history-a','review-rating-history-b','review-rating-history-empty','review-rating-history-draft','review-rating-history-adult','review-rating-history-archived') and archived_at is null;
select pg_temp.rrh_assert((select count(*)=6 and bool_and(archived_at is not null and published_at is null) from public.goods where id in('review-rating-history-a','review-rating-history-b','review-rating-history-empty','review-rating-history-draft','review-rating-history-adult','review-rating-history-archived')),'all owned children normally archived before parent');
update public.ips set archived_at=clock_timestamp() where id='review-rating-history-ip';
select pg_temp.rrh_parity('normally archived IP and children excluded by both aggregates');
set local role service_role;
select public.service_observe_review_rating_daily() result \gset rrh_repeat_
reset role;
select pg_temp.rrh_assert((select case when value->>'status'='recorded' then :'rrh_repeat_result'::jsonb-'status'=value-'status' and :'rrh_repeat_result'::jsonb->>'status'='already_recorded'
 else :'rrh_repeat_result'::jsonb->>'status'='too_early' end from rrh_first),'response loss retry returns the same first timestamp and fingerprint');
select pg_temp.rrh_assert((select coalesce(jsonb_agg(to_jsonb(d) order by as_of),'[]') from private.review_rating_daily_observations d where version=7722)
 =(select coalesce(jsonb_agg(value order by value->>'as_of'),'[]') from rrh_observation_before),'live mutations never rewrite first daily observation');
update private.review_rating_observation_contracts set enabled=false where version=7722;
set local role service_role;
select pg_temp.rrh_assert(public.service_observe_review_rating_daily()->>'status'='disabled','collection stops without deleting its start');
reset role;
update private.review_rating_observation_contracts set enabled=true where version=7722;
set local role service_role;
select public.service_observe_review_rating_daily() result \gset rrh_resume_
reset role;
select pg_temp.rrh_assert(:'rrh_resume_result'::jsonb=:'rrh_repeat_result'::jsonb,'same-day resume retains original daily result');

-- Owner-only rollback fixtures, explicitly synthetic; never a public backfill path.
create function pg_temp.rrh_observation(v integer,target date,rating numeric default 4.13) returns void language sql as $$
 insert into private.review_rating_daily_observations(version,as_of,observation_day,observed_at,six_month_from,average_rating,six_month_rating,
 eligible_product_count,rated_product_count,six_month_rated_product_count,review_count,six_month_review_count,fingerprint)
 values(v,target,target+1,((target+1)::timestamp+interval '5 minutes') at time zone 'Asia/Seoul',((target+1)::timestamp-interval '6 months')::date,
 rating,null,3,case when rating is null then 0 else 2 end,0,case when rating is null then 0 else 8 end,0,repeat('a',64));
$$;
select ((statement_timestamp() at time zone 'Asia/Seoul')::date-1)::text rrh_asof,
 (((statement_timestamp() at time zone 'Asia/Seoul')::date-1)::timestamp-interval '3 months')::date::text rrh_target \gset
update private.review_rating_observation_contracts set collection_started_at=(:'rrh_target'::date-2)::timestamp at time zone 'Asia/Seoul',last_success_at=clock_timestamp() where version in(7721,7722);
select pg_temp.rrh_observation(7721,:'rrh_target');
select pg_temp.rrh_observation(7722,:'rrh_target'::date-1);
set local role authenticated;
select pg_temp.rrh_assert(public.admin_review_rating_comparison(:'rrh_asof')->>'status'='not_collected','no nearest-day or other-version fallback');
reset role;
select pg_temp.rrh_observation(7722,:'rrh_target');
set local role authenticated;
select public.admin_review_rating_comparison(:'rrh_asof') result \gset rrh_available_
select pg_temp.rrh_assert(:'rrh_available_result'::jsonb->>'status'='available' and :'rrh_available_result'::jsonb->>'version'='7722'
 and :'rrh_available_result'::jsonb#>>'{observation,asOf}'=:'rrh_target'
 and :'rrh_available_result'::jsonb#>>'{observation,averageRating}'='4.13'
 and :'rrh_available_result'::jsonb#>'{observation,sixMonthRating}'='null'::jsonb,'exact same version available with independent null denominator');
reset role;
delete from private.review_rating_daily_observations where version=7722 and as_of=:'rrh_target';
select pg_temp.rrh_observation(7722,:'rrh_target',null);
set local role authenticated;
select pg_temp.rrh_assert(public.admin_review_rating_comparison(:'rrh_asof')#>'{observation,averageRating}'='null'::jsonb,'zero reviewed products preserve null instead of zero rating');
reset role;
delete from private.review_rating_daily_observations where version=7722 and as_of=:'rrh_target';
update private.review_rating_observation_contracts set purged_before_as_of=:'rrh_target'::date+1,last_purged_at=clock_timestamp() where version=7722;
set local role authenticated;
select pg_temp.rrh_assert(public.admin_review_rating_comparison(:'rrh_asof')->>'status'='outside_retention','absence before actual purge boundary is outside retention');
reset role;
update private.review_rating_observation_contracts set collection_started_at=clock_timestamp(),last_success_at=clock_timestamp() where version=7722;
set local role authenticated;
select pg_temp.rrh_assert(public.admin_review_rating_comparison(:'rrh_asof')->>'status'='before_collection_start','collection start precedes purge interpretation');
reset role;

-- Retention removes old values, preserves the boundary and cannot regenerate old dates.
update private.review_rating_observation_contracts set collection_started_at=clock_timestamp()-interval '2 years',last_success_at=clock_timestamp(),
 purged_before_as_of=null,last_purged_at=null where version in(7721,7722);
select ((statement_timestamp() at time zone 'Asia/Seoul')::date::timestamp-interval '13 months')::date::text rrh_purge \gset
select pg_temp.rrh_observation(7722,:'rrh_purge'::date-1);
select pg_temp.rrh_observation(7722,:'rrh_purge');
select pg_temp.rrh_observation(7721,:'rrh_purge'::date-1);
update private.review_rating_observation_contracts set enabled=false where version=7722;
set local role service_role;
select pg_temp.rrh_assert(public.service_observe_review_rating_daily()->>'status'='disabled','retention still runs while collection disabled');
reset role;
select pg_temp.rrh_assert(not exists(select 1 from private.review_rating_daily_observations where version in(7721,7722) and as_of<:'rrh_purge')
 and exists(select 1 from private.review_rating_daily_observations where version=7722 and as_of=:'rrh_purge'),'thirteen month retention deletes strictly older values only');
select pg_temp.rrh_assert((select count(*)=2 from private.review_rating_observation_contracts where version in(7721,7722) and purged_before_as_of=:'rrh_purge' and last_purged_at is not null),'completed purge boundary tracked for both versions');
update private.review_rating_observation_contracts set purged_before_as_of=:'rrh_purge'::date+1 where version=7722;
set local role service_role;select public.service_observe_review_rating_daily();reset role;
select pg_temp.rrh_assert((select purged_before_as_of=:'rrh_purge'::date+1 from private.review_rating_observation_contracts where version=7722),'purge boundary never moves backward');

-- A failure after DELETE rolls back the insert, last_success and purge metadata together.
savepoint forced_failure;
update private.review_rating_observation_contracts set enabled=true where version=7722;
delete from private.review_rating_daily_observations where version=7722 and as_of=:'rrh_asof';
select pg_temp.rrh_observation(7722,:'rrh_purge'::date-1);
create temporary table rrh_failure_metadata as select to_jsonb(c) value from private.review_rating_observation_contracts c where version=7722;
create function pg_temp.rrh_fail_purge() returns trigger language plpgsql as $$begin
 if old.version=7722 then raise exception 'rrh_synthetic_purge_failure';end if;return old;end$$;
create trigger rrh_synthetic_purge_failure after delete on private.review_rating_daily_observations for each row execute function pg_temp.rrh_fail_purge();
set local role service_role;
select pg_temp.rrh_error('select public.service_observe_review_rating_daily()','rrh_synthetic_purge_failure');
reset role;
select pg_temp.rrh_assert(not exists(select 1 from private.review_rating_daily_observations where version=7722 and as_of=:'rrh_asof')
 and exists(select 1 from private.review_rating_daily_observations where version=7722 and as_of=:'rrh_purge'::date-1)
 and (select to_jsonb(c) from private.review_rating_observation_contracts c where version=7722)=(select value from rrh_failure_metadata),'failure rolls back observation success and retention atomically');
rollback to forced_failure;
select pg_temp.rrh_assert((select to_jsonb(c) from private.review_rating_observation_contracts c where version=1)=(select value from rrh_initial),'default v1 metadata remained unchanged throughout synthetic tests');
select pg_temp.rrh_assert((select r.definition=pg_get_functiondef(p.oid) and r.proowner=p.proowner and r.proacl=p.proacl from rrh_current_reader r cross join pg_proc p
 where p.oid='public.admin_review_insights(text,text,text,integer,integer)'::regprocedure),'existing live reader definition owner and ACL preserved');
rollback;
