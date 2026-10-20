-- Always invoke the real RPC as authenticated with persisted synthetic session claims.
-- Fixture setup uses a trusted connection, while every product call uses SET LOCAL ROLE authenticated.
-- Prepend goods_kc_fixture.sql. Caller wraps BEGIN; this entire fixture rolls back.
create function pg_temp.ho_id(n integer) returns uuid language sql immutable as $$select ('a7190000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.ho_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'owner regression: %',label;end if;raise notice 'PASS %',label;end$$;
create function pg_temp.ho_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',pg_temp.ho_id(n)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.ho_id(n),'role','authenticated','session_id',pg_temp.ho_id(n+100))::text,true);
end$$;
create function pg_temp.ho_error(q text,code text,part text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=code and position(part in sqlerrm)>0 then raise notice 'PASS rejected %: %',code,part;return;end if;raise;end;
 raise exception 'Expected %: %',code,part;end$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.ho_id(n),'authenticated','authenticated','helpful-owner-'||n||'@example.test',now(),'{"testFixture":"helpful-owner"}','{}',now(),now() from generate_series(1,3)n;
update public.profiles set role=case when id=pg_temp.ho_id(1) then 'admin'::public.user_role when id=pg_temp.ho_id(3) then 'staff'::public.user_role else 'user'::public.user_role end,
 nickname='TEST 도움 소유자 '||right(id::text,2),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id in(pg_temp.ho_id(1),pg_temp.ho_id(2),pg_temp.ho_id(3));
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.ho_id(1),'primary'),(pg_temp.ho_id(3),'logistics');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select pg_temp.ho_id(n+100),pg_temp.ho_id(n),now(),now(),now()+interval '1 hour' from generate_series(1,3)n;
insert into public.ips(id,title,vertical_key,published_at) values('helpful-owner-ip','TEST 도움 소유자 IP','character',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('helpful-owner-good','helpful-owner-ip','TEST 도움 소유자 상품','문구',10000,'ok',10);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 values(('47c47700'||left(md5('helpful-owner-good'),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5('helpful-owner-good')||'@example.test',now(),'{"testFixture":"goods-kc"}','{}');
insert into private.operator_memberships(profile_id,manager_role) values(('47c47700'||left(md5('helpful-owner-good'),24))::uuid,'primary');
select pg_temp.publish_goods_kc_fixture('helpful-owner-good');
insert into public.orders(id,user_id,status,total,address,delivered_at) values(pg_temp.ho_id(201),pg_temp.ho_id(2),'delivered',10000,'{}',now()-interval '1 day'),(pg_temp.ho_id(202),pg_temp.ho_id(2),'canceled',10000,'{}',null);
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.ho_id(201),'helpful-owner-good',id,1,10000,'TEST 도움 소유자 상품','문구','helpful-owner-ip' from public.goods_variants where good_id='helpful-owner-good' and is_default;
insert into public.payments(id,user_id,purpose,ref_id,provider,amount,status,idempotency_key)
 values(pg_temp.ho_id(401),pg_temp.ho_id(2),'order',pg_temp.ho_id(201),'korpay',10000,'paid','helpful-owner-payment');
insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 values(pg_temp.ho_id(402),'korpay',pg_temp.ho_id(2),'order',pg_temp.ho_id(201),10000,'approved','helpful-owner-attempt','helpful-owner-order','helpful-owner-product',pg_temp.ho_id(401),now()+interval '1 hour');
insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,approved_at) values(pg_temp.ho_id(402),'confirm',now()-interval '2 days');
insert into public.reviews(id,user_id,good_id,order_id,rating,body) values
 (pg_temp.ho_id(301),pg_temp.ho_id(2),'helpful-owner-good',pg_temp.ho_id(201),5,'TEST 도움 소유자 선정 리뷰'),
 (pg_temp.ho_id(302),pg_temp.ho_id(2),'helpful-owner-good',pg_temp.ho_id(202),3,'TEST 도움 소유자 일반 리뷰');
select pg_temp.ho_actor(3);
set local role authenticated;
select pg_temp.ho_assert(current_user='authenticated' and auth.uid()=pg_temp.ho_id(3) and (auth.jwt()->>'session_id')::uuid=pg_temp.ho_id(103),'actual authenticated role and matching persisted session claims');
select public.set_review_helpful('helpful-owner-good',pg_temp.ho_id(302),true);
select pg_temp.ho_actor(1);
select public.admin_set_review_best(pg_temp.ho_id(301),true,'TEST 소유자 회귀 선정 근거',0,public.admin_get_review_best_states(array[pg_temp.ho_id(301)])#>>'{0,reviewFingerprint}',pg_temp.ho_id(501));
select pg_temp.ho_assert((select count(*)=2 from public.admin_search_reviews_best(p_query=>'TEST 도움 소유자 상품')),'old reader succeeds through existing helper privileges');
select pg_temp.ho_assert((select best_selection->>'state'='selected' from public.admin_search_reviews_best(p_review_id=>pg_temp.ho_id(301))),'normal BEST writer and complete eligible helper chain');
do $$declare old jsonb;new jsonb;sorting text;begin
  foreach sorting in array array['recent','oldest','rating_desc','rating_asc','good_name_asc','photo_count_desc'] loop
   select coalesce(jsonb_agg(to_jsonb(r)),'[]') into old from public.admin_search_reviews_best(p_query=>'TEST 도움 소유자 상품',p_sort=>sorting,p_limit=>1,p_offset=>1)r;
   select coalesce(jsonb_agg(to_jsonb(r)-'helpful_count'),'[]') into new from public.admin_search_reviews_helpful(p_query=>'TEST 도움 소유자 상품',p_sort=>sorting,p_limit=>1,p_offset=>1)r;
   perform pg_temp.ho_assert(old=new,'authenticated full-row parity '||sorting);
  end loop;
  perform pg_temp.ho_assert((select id=pg_temp.ho_id(302) and helpful_count=1 and total_count=2 from public.admin_search_reviews_helpful(p_query=>'TEST 도움 소유자 상품',p_sort=>'helpful_desc',p_limit=>1)),'actual stored helpful count and sorting');
  perform pg_temp.ho_assert((select id=pg_temp.ho_id(301) and best_selection->>'state'='selected' from public.admin_search_reviews_helpful(p_query=>'TEST 도움 소유자 상품',p_best=>'selected')),'selected BEST filter and helper state remain exact');
end$$;
select pg_temp.ho_actor(3);
select pg_temp.ho_error($q$select * from public.admin_search_reviews_helpful(p_query=>'TEST 도움 소유자 상품')$q$,'42501','operator_capability_required');
reset role;set local role anon;
select pg_temp.ho_error($q$select * from public.admin_search_reviews_helpful()$q$,'42501','permission denied');
reset role;set local role service_role;
select pg_temp.ho_error($q$select * from public.admin_search_reviews_helpful()$q$,'42501','permission denied');
reset role;
select pg_temp.ho_assert(not has_function_privilege('anon','public.admin_search_reviews_helpful(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)','EXECUTE') and not has_function_privilege('service_role','public.admin_search_reviews_helpful(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)','EXECUTE') and not has_table_privilege('authenticated','private.review_helpful_votes','SELECT'),'public function and private table seals preserved');
rollback;
