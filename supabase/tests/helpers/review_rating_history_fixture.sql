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
