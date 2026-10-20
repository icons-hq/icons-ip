-- Synthetic fixture for a freshly leased, disposable review helpful clone only.
create schema helpful_test;
create function helpful_test.id(n integer) returns uuid language sql immutable as $$select ('a7180000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function helpful_test.actor(n integer default 3) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',case when n=0 then '' else helpful_test.id(n)::text end,true);
 perform set_config('request.jwt.claims',case when n=0 then '{"role":"anon"}' else jsonb_build_object('sub',helpful_test.id(n),'role','authenticated','session_id',helpful_test.id(n+100))::text end,true);
end$$;
create function helpful_test.ok(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'helpful assertion: %',label;end if;raise notice 'PASS %',label;end$$;
create function helpful_test.error(q text,wanted text) returns void language plpgsql as $$begin begin execute q;exception when others then if position(wanted in sqlerrm)>0 or sqlstate=wanted then raise notice 'PASS rejected %',wanted;return;end if;raise;end;raise exception 'Expected error: %',wanted;end$$;
grant usage on schema helpful_test to anon,authenticated;
grant execute on all functions in schema helpful_test to anon,authenticated;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select helpful_test.id(n),'authenticated','authenticated','helpful-'||n||'@example.test',now(),'{"testFixture":"review-helpful"}','{}',now(),now() from generate_series(1,8)n;
update public.profiles set role=case when id=helpful_test.id(1) then 'admin'::public.user_role when id=helpful_test.id(8) then 'staff'::public.user_role else 'user'::public.user_role end,
 nickname='TEST 도움 '||right(id::text,2),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id in(select helpful_test.id(n) from generate_series(1,8)n);
insert into private.operator_memberships(profile_id,manager_role) values(helpful_test.id(1),case when exists(select 1 from private.operator_memberships where manager_role='owner') then 'primary' else 'owner' end),(helpful_test.id(8),'logistics');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select helpful_test.id(100+n),helpful_test.id(n),now(),now(),now()+interval '2 hours' from generate_series(1,8)n;
insert into public.ips(id,title,vertical_key,published_at) values('helpful-ip','TEST 도움 IP','character',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) select 'helpful-'||g,'helpful-ip','TEST 도움 상품 '||g,'문구',10000,'ok',10 from unnest(array['a','b','c'])g;
select helpful_test.actor(1);
set local role authenticated;
select public.admin_save_goods_group(helpful_test.id(501),0,'{"name":"TEST 도움 그룹","optionNames":["색상"],"members":[{"goodId":"helpful-a","values":["빨강"]},{"goodId":"helpful-b","values":["파랑"]}]}',helpful_test.id(502),helpful_test.id(1),helpful_test.id(101));
reset role;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}' from public.goods where id in('helpful-a','helpful-b','helpful-c');
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id in('helpful-a','helpful-b','helpful-c');
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in('helpful-a','helpful-b','helpful-c') order by id;
-- Orders provide only required FK identity. No payment/purchase eligibility evidence.
insert into public.orders(id,user_id,status,total,address) select helpful_test.id(200+n),helpful_test.id(case when n=4 then 3 else 2 end),'canceled',10000,'{}' from generate_series(1,5)n;
insert into public.reviews(id,user_id,good_id,order_id,rating,body,created_at,image_paths)
 select helpful_test.id(300+n),helpful_test.id(case when n=4 then 3 else 2 end),case when n=2 then 'helpful-b' when n=5 then 'helpful-c' else 'helpful-a' end,
 helpful_test.id(200+n),(n%5+1)::smallint,'TEST 도움 회귀 a718 리뷰 '||n,now()-interval '1 day',case when n=2 then array['a7180000-0000-4000-8000-000000000002/review/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp'] else '{}'::text[] end from generate_series(1,5)n;
select helpful_test.actor(3);
