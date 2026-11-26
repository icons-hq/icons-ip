\set ON_ERROR_STOP on
begin;
create function pg_temp.uid(n int) returns uuid language sql as $$ select ('ac260000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.actor(n int, assurance text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',pg_temp.uid(n)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(n),'role','authenticated','aal',assurance,'session_id',pg_temp.uid(n+10))::text,true);
end $$;
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'overseas test: %',label; end if; end $$;
insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.uid(n),'overseas-'||n||'@example.test','authenticated','authenticated','{}','{}',now(),now() from generate_series(1,3) n;
update public.profiles set onboarded_at=now(),birth_date='1990-01-01',consents='{"terms":true,"privacy":true}',
  role=case when id=pg_temp.uid(1) then 'admin' else 'user' end::public.user_role where id in (pg_temp.uid(1),pg_temp.uid(2),pg_temp.uid(3));
update private.operator_access_state set configured=false where id;
insert into private.operator_legacy_cohort(profile_id,legacy_role) values(pg_temp.uid(1),'admin') on conflict do nothing;
insert into auth.sessions(id,user_id,aal,created_at,updated_at) values(pg_temp.uid(11),pg_temp.uid(1),'aal2',now(),now());
insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret)
values(pg_temp.uid(12),pg_temp.uid(1),'synthetic','totp','verified',now(),now(),'synthetic');
insert into public.ips(id,title,vertical_key,published_at) values('overseas-test','검증용','character',now());
insert into public.goods(id,ip_id,name,price,stock,stock_qty,sale_restriction) values
  ('overseas-yes','overseas-test','합성 A',1000,'ok',9,'adult'),('overseas-no','overseas-test','합성 B',1000,'ok',9,'adult');
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
  select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','overseas-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now() from public.goods where ip_id='overseas-test';
insert into private.operator_memberships(profile_id,manager_role)
  select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where ip_id='overseas-test';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where ip_id='overseas-test';
update private.adult_goods_storefront_settings set enabled=true where singleton;
select pg_temp.assert(not has_function_privilege('authenticated','public.service_finish_overseas_adult_cleanup(uuid)','execute')
  and not has_function_privilege('anon','public.open_overseas_adult_review(uuid,text)','execute')
  and not has_table_privilege('authenticated','private.overseas_adult_requests','select'),'grants');
select pg_temp.actor(1,'aal2');
select public.configure_overseas_adult_review('reviewer',pg_temp.uid(1)::text,true);
select public.configure_overseas_adult_review('good','overseas-yes',true);
update private.overseas_adult_policy set effective_at=now()+interval '1 day' where singleton;
select pg_temp.assert(not private.overseas_intake_open(),'notice period');
update private.overseas_adult_policy set effective_at=now()-interval '1 day' where singleton;
select pg_temp.actor(2);
select public.begin_overseas_adult_request() as rid \gset
select pg_temp.assert(public.begin_overseas_adult_request()=:'rid'::uuid,'single pending');
select pg_temp.actor(3);
select pg_temp.assert(not public.cancel_overseas_adult_request(:'rid') and (public.my_overseas_adult_request()->'request')='null'::jsonb,'ownership');
select pg_temp.actor(2);
select pg_temp.assert(public.reserve_overseas_adult_upload(:'rid','overseas_manual@2026-11-26'),'reserve');
insert into storage.objects(bucket_id,name) values('overseas-adult-evidence',:'rid');
select pg_temp.assert(public.service_submit_overseas_adult_upload(:'rid',pg_temp.uid(2),repeat('a',64)),'submission');
select pg_temp.actor(1);
select pg_temp.assert(not private.overseas_reviewer(pg_temp.uid(1)),'AAL1 closed');
select pg_temp.actor(1,'aal2');
select public.open_overseas_adult_review(:'rid',repeat('b',64));
select pg_temp.assert(not public.deliver_overseas_adult_review(:'rid',repeat('f',64)),'one-tab ticket');
select pg_temp.assert(public.deliver_overseas_adult_review(:'rid',repeat('b',64)),'first view');
select pg_temp.assert(not public.deliver_overseas_adult_review(:'rid',repeat('b',64)),'single delivery');
select pg_temp.assert(public.decide_overseas_adult_review(:'rid',repeat('b',64),make_date(extract(year from now() at time zone 'Asia/Seoul')::int-19,12,31),true),'decision');
select pg_temp.assert(not public.overseas_adult_review_live(:'rid',repeat('b',64)),'decision closes review');
select pg_temp.assert((select key_share is null from private.overseas_adult_requests where id=:'rid'),'key destroyed');
select * from public.service_overseas_adult_cleanup(:'rid');
select pg_temp.assert(not public.service_finish_overseas_adult_cleanup(:'rid') and private.overseas_valid_until(pg_temp.uid(2)) is null,'failed deletion blocks entitlement');
-- 실제 Storage 바이트 이동·삭제는 브라우저 통합 시험에서 확인한다. 여기서는 파기 후 메타데이터 부재를 모의한다.
update storage.objects set name='purged-fixture' where bucket_id='overseas-adult-evidence' and name=:'rid';
select pg_temp.assert(public.service_finish_overseas_adult_cleanup(:'rid') and public.service_finish_overseas_adult_cleanup(:'rid'),'idempotent finalization');
select pg_temp.actor(2);
set local role authenticated;
select pg_temp.assert(public.get_my_adult_verification()->>'scope'='selected','selected scope');
select pg_temp.assert((select array_agg(id) from public.goods where id in ('overseas-yes','overseas-no'))=array['overseas-yes'],'product RLS');
reset role;
select pg_temp.assert(private.adult_allowed_for_good(pg_temp.uid(2),'overseas-yes') and not private.adult_allowed_for_good(pg_temp.uid(2),'overseas-no'),'purchase scope');
update public.goods set description='내용 변경' where id='overseas-yes';
select pg_temp.assert(not private.adult_allowed_for_good(pg_temp.uid(2),'overseas-yes'),'content change requires reclassification');
rollback;
