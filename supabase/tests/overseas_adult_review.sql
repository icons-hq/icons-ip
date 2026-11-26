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
update public.profiles set nickname='합성회원'||right(id::text,1),onboarded_at=now(),birth_date=case when id=pg_temp.uid(3) then make_date(extract(year from now() at time zone 'Asia/Seoul')::int-18,1,1) else make_date(extract(year from now() at time zone 'Asia/Seoul')::int-19,12,31) end,consents='{"terms":true,"privacy":true}',
  role=case when id=pg_temp.uid(1) then 'admin' else 'user' end::public.user_role where id in (pg_temp.uid(1),pg_temp.uid(2),pg_temp.uid(3));
update private.operator_access_state set configured=false where id;
insert into private.operator_legacy_cohort(profile_id,legacy_role) values(pg_temp.uid(1),'admin') on conflict do nothing;
insert into auth.sessions(id,user_id,aal,created_at,updated_at) values
  (pg_temp.uid(11),pg_temp.uid(1),'aal1',now(),now()),
  (pg_temp.uid(14),pg_temp.uid(1),'aal1',now(),now()),
  (pg_temp.uid(12),pg_temp.uid(2),'aal1',now(),now());
insert into public.ips(id,title,vertical_key,published_at) values('overseas-test','검증용','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active) values(pg_temp.uid(55),'overseas-local','합성 출고지','hanjin',1000,'시험 주소',true);
insert into public.goods(id,ip_id,name,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee,sale_restriction) values
  ('overseas-yes','overseas-test','합성 A',1000,'ok',9,pg_temp.uid(55),'policy',0,'adult'),('overseas-no','overseas-test','합성 B',1000,'ok',9,pg_temp.uid(55),'policy',0,'adult');
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
  select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','overseas-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now() from public.goods where ip_id='overseas-test';
insert into private.operator_memberships(profile_id,manager_role)
  select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where ip_id='overseas-test';
select pg_temp.publish_goods_kc_fixture('overseas-yes');
update private.adult_goods_storefront_settings set enabled=true where singleton;
select pg_temp.assert(not has_function_privilege('authenticated','public.service_finish_overseas_adult_cleanup(uuid)','execute')
  and not has_function_privilege('anon','public.open_overseas_adult_review(uuid,text)','execute')
  and not has_function_privilege('authenticated','public.begin_overseas_adult_request()','execute')
  and not has_function_privilege('authenticated','public.reserve_overseas_adult_upload(uuid,text)','execute')
  and not has_function_privilege('anon','public.reserve_overseas_adult_document(uuid,text)','execute')
  and not has_table_privilege('authenticated','private.overseas_adult_requests','select'),'grants');
-- 동일한 가입 정보의 저장은 멱등이며, 가입 완료 후에는 회원이 그 값을 변경하거나 비울 수 없다.
select pg_temp.actor(2);
set local role authenticated;
update public.profiles set birth_date=birth_date where id=pg_temp.uid(2);
do $$ begin
  begin
    update public.profiles set birth_date=date '1990-04-02' where id=pg_temp.uid(2);
    raise exception 'completed signup date changed';
  exception when insufficient_privilege then
    if sqlerrm <> 'onboarded_birth_date_locked' then raise; end if;
  end;
  begin
    update public.profiles set birth_date=null where id=pg_temp.uid(2);
    raise exception 'completed signup date cleared';
  exception when insufficient_privilege then
    if sqlerrm <> 'onboarded_birth_date_locked' then raise; end if;
  end;
end $$;
reset role;
select pg_temp.actor(2);
set local role authenticated;
do $$ begin
  begin perform public.overseas_review_queue(); raise exception 'customer read review queue'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.actor(1);
select pg_temp.assert(not exists(select 1 from private.overseas_adult_reviewers where user_id=pg_temp.uid(1))
  and not exists(select 1 from auth.mfa_factors where user_id=pg_temp.uid(1)), 'unassigned admin without an authenticator');
set local role authenticated;
select pg_temp.assert(public.overseas_review_queue() is not null,'ordinary admin session');
reset role;
savepoint global_mfa;
update private.operator_mfa_policy set required=true where singleton;
select pg_temp.assert(not private.overseas_reviewer(pg_temp.uid(1)), 'global operator policy still applies');
rollback to global_mfa;
select pg_temp.assert((select effective_at = timestamptz '2026-11-26 00:00+09' from private.overseas_adult_policy where singleton), 'prelaunch intake effective date');
update private.overseas_adult_policy set effective_at=now()+interval '1 day' where singleton;
select pg_temp.assert(not private.overseas_intake_open() and public.my_overseas_adult_request()->>'intakeStatus'='policy_pending','notice period');
update private.overseas_adult_policy set effective_at=now()-interval '1 day' where singleton;
select pg_temp.actor(2);
select pg_temp.assert((public.my_overseas_adult_request()->>'open')::boolean and public.my_overseas_adult_request()->>'intakeStatus'='open','customer can apply without product designations');
savepoint no_storefront;
update private.adult_goods_storefront_settings set enabled=false where singleton;
select pg_temp.assert(not private.overseas_intake_open() and public.my_overseas_adult_request()->>'intakeStatus'='store_closed','storefront pause');
rollback to no_storefront;
-- 이전 화면에서 이미 만들어 둔 미제출 신청도 새 동의로 바로 제출한다.
insert into private.overseas_adult_requests(user_id,challenge,policy_version)
values(pg_temp.uid(2),'OLDCODE','overseas_manual_all@2026-11-26') returning id as rid \gset
select pg_temp.assert(not ((public.my_overseas_adult_request()->'request') ? 'challenge'),'customer never receives a code');
select pg_temp.actor(3);
select pg_temp.assert(not public.cancel_overseas_adult_request(:'rid') and (public.my_overseas_adult_request()->'request')='null'::jsonb,'ownership');
select pg_temp.actor(2);
set local role authenticated;
do $$ begin
  begin perform public.reserve_overseas_adult_document(pg_temp.uid(40),'overseas_manual_all@2026-11-26');
  exception when insufficient_privilege then return; end;
  raise exception 'old consent accepted';
end $$;
select pg_temp.assert(public.reserve_overseas_adult_document(pg_temp.uid(40),'overseas_document@2026-11-26')->>'id'=:'rid','resume draft on actual submission');
select pg_temp.assert(public.reserve_overseas_adult_document(pg_temp.uid(40),'overseas_document@2026-11-26')->>'status'='existing','duplicate upload cannot reserve twice');
reset role;
select pg_temp.assert((select challenge is null and consent_version='overseas_document@2026-11-26' from private.overseas_adult_requests where id=:'rid'),'document method');
insert into storage.objects(bucket_id,name) values('overseas-adult-evidence',:'rid');
select pg_temp.assert(public.service_submit_overseas_adult_upload(:'rid',pg_temp.uid(2),repeat('a',64)),'submission');
select pg_temp.assert(public.reserve_overseas_adult_document(pg_temp.uid(40),'overseas_document@2026-11-26')->>'status'='received','lost successful response');
select pg_temp.assert(public.reserve_overseas_adult_document(pg_temp.uid(49),'overseas_document@2026-11-26')->>'status'='existing','another tab cannot replace a pending document');
select pg_temp.actor(1);
select pg_temp.assert(private.overseas_reviewer(pg_temp.uid(1)),'AAL1 admin can review');
savepoint legacy_pending;
update private.overseas_adult_requests set consent_version='overseas_manual_all@2026-11-26', challenge='OLDPHOTO' where id=:'rid';
select pg_temp.assert(public.open_overseas_adult_review(:'rid',repeat('b',64))->>'challenge'='OLDPHOTO','existing submitted photo remains reviewable under its original consent');
rollback to legacy_pending;
select pg_temp.assert(public.open_overseas_adult_review(:'rid',repeat('b',64))->>'method'='overseas_document@2026-11-26','review uses actual consent');
select pg_temp.assert(not public.deliver_overseas_adult_review(:'rid',repeat('f',64)),'one-tab ticket');
select pg_temp.assert(public.deliver_overseas_adult_review(:'rid',repeat('b',64)),'first view');
select pg_temp.assert(not public.deliver_overseas_adult_review(:'rid',repeat('b',64)),'single delivery');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(1),'role','authenticated','aal','aal1','session_id',pg_temp.uid(14))::text,true);
select pg_temp.assert(not public.overseas_adult_review_live(:'rid',repeat('b',64)),'another session cannot reuse the review');
select pg_temp.actor(1);
savepoint signed_out;
delete from auth.sessions where id=pg_temp.uid(11);
select pg_temp.assert(not public.overseas_adult_review_live(:'rid',repeat('b',64)) and
  not public.decide_overseas_adult_review(:'rid',repeat('b',64),null,false), 'signed-out session cannot read or decide');
rollback to signed_out;
savepoint revoked_admin;
update public.profiles set role='user' where id=pg_temp.uid(1);
select pg_temp.assert(not public.overseas_adult_review_live(:'rid',repeat('b',64)) and
  not public.decide_overseas_adult_review(:'rid',repeat('b',64),null,false), 'revoked role cannot read or decide');
rollback to revoked_admin;
savepoint mismatched_date;
select pg_temp.assert(public.decide_overseas_adult_review(:'rid',repeat('b',64),'1980-01-01',true),'mismatch handled');
select pg_temp.assert((select outcome='rejected' and valid_until is null from private.overseas_adult_requests where id=:'rid'),'different birthday cannot grant access');
rollback to mismatched_date;
select pg_temp.assert(public.decide_overseas_adult_review(:'rid',repeat('b',64),make_date(extract(year from now() at time zone 'Asia/Seoul')::int-19,12,31),true),'decision');
select pg_temp.assert(not public.overseas_adult_review_live(:'rid',repeat('b',64)),'decision closes review');
select pg_temp.assert((select key_share is null from private.overseas_adult_requests where id=:'rid'),'key destroyed');
select * from public.service_overseas_adult_cleanup(:'rid');
select pg_temp.assert(not public.service_finish_overseas_adult_cleanup(:'rid') and private.overseas_valid_until(pg_temp.uid(2)) is null,'failed deletion blocks entitlement');
-- 실제 Storage 바이트 이동·삭제는 브라우저 통합 시험에서 확인한다. 여기서는 파기 후 메타데이터 부재를 모의한다.
update storage.objects set name='purged-fixture' where bucket_id='overseas-adult-evidence' and name=:'rid';
select pg_temp.assert(public.service_finish_overseas_adult_cleanup(:'rid') and public.service_finish_overseas_adult_cleanup(:'rid'),'idempotent finalization');
select pg_temp.publish_goods_kc_fixture('overseas-no');
select pg_temp.actor(2);
set local role authenticated;
select pg_temp.assert(public.get_my_adult_verification()->>'method'='overseas_manual','account approval');
select pg_temp.assert((select count(*) from public.goods where id in ('overseas-yes','overseas-no'))=2,'all adult products visible through RLS');
reset role;
select pg_temp.assert(private.good_sale_restriction_visible('adult',pg_temp.uid(2))
  and private.good_sale_restriction_visible('adult',pg_temp.uid(2),'overseas-no'),'both goods visibility signatures accept the approval');
select pg_temp.assert(not private.good_sale_restriction_visible('adult',pg_temp.uid(3),'overseas-yes'),'approval is personal');
select id as first_variant from public.goods_variants where good_id='overseas-yes' and is_default \gset
select id as second_variant from public.goods_variants where good_id='overseas-no' and is_default \gset
set local role authenticated;
select public.add_cart_selection('overseas-yes',jsonb_build_array(jsonb_build_object('good_id','overseas-yes','variant_id',:'first_variant','qty',1,'expected_qty',0)));
select public.set_cart_item_quantity('overseas-no',:'second_variant',1);
reset role;
select public.place_order(pg_temp.uid(2),'{"recipientName":"시험","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}'::jsonb,pg_temp.uid(88),'card'::public.order_payment_method) as adult_order \gset
select pg_temp.assert((select adult_readable from public.my_order_line_goods(array['overseas-yes'])),'authorized order image');
select pg_temp.assert((select count(*) from public.order_items where order_id=:'adult_order' and good_id in ('overseas-yes','overseas-no'))=2,'order created');
select pg_temp.assert(public.prepare_goods_payment_attempt(pg_temp.uid(2),:'adult_order','toss')->>'provider'='toss','Toss preparation');
select public.bind_goods_payment_callback_nonce((select id from public.payment_attempts where ref_id=:'adult_order'),repeat('9',64));
select pg_temp.assert(public.claim_goods_payment_attempt('toss',(select provider_order_id from public.payment_attempts where ref_id=:'adult_order'),repeat('9',64),pg_temp.uid(89))->>'claim_status'='claimed','payment pre-capture DB check');
-- 다음 출생 연도 경계의 신분증은 판정·파기에 성공해도 권한을 얻지 못한다.
select pg_temp.actor(3);
select public.reserve_overseas_adult_document(pg_temp.uid(41),'overseas_document@2026-11-26')->>'id' as minor_id \gset
insert into storage.objects(bucket_id,name) values('overseas-adult-evidence',:'minor_id');
select public.service_submit_overseas_adult_upload(:'minor_id',pg_temp.uid(3),repeat('a',64));
select pg_temp.actor(1);
select public.open_overseas_adult_review(:'minor_id',repeat('b',64));
select public.deliver_overseas_adult_review(:'minor_id',repeat('b',64));
select pg_temp.assert(public.decide_overseas_adult_review(:'minor_id',repeat('b',64),make_date(extract(year from now() at time zone 'Asia/Seoul')::int-18,1,1),true),'underage boundary');
select * from public.service_overseas_adult_cleanup(:'minor_id');
update storage.objects set name='purged-minor-fixture' where bucket_id='overseas-adult-evidence' and name=:'minor_id';
select public.service_finish_overseas_adult_cleanup(:'minor_id');
select pg_temp.assert(private.overseas_valid_until(pg_temp.uid(3)) is null and (select outcome='underage' from private.overseas_adult_requests where id=:'minor_id'),'underage stays restricted');
select pg_temp.actor(3);
select public.reserve_overseas_adult_document(pg_temp.uid(42),'overseas_document@2026-11-26')->>'id' as aborted_id \gset
select pg_temp.assert(public.cancel_overseas_adult_request(:'aborted_id'),'cancel while uploading');
select pg_temp.assert(not public.service_submit_overseas_adult_upload(:'aborted_id',pg_temp.uid(3),repeat('d',64)),'late upload cannot re-open');
update private.overseas_adult_requests set upload_until=now()-interval '1 minute',cleanup_after=now()-interval '1 second' where id=:'aborted_id';
select * from public.service_overseas_adult_cleanup(:'aborted_id');
select pg_temp.assert(public.service_finish_overseas_adult_cleanup(:'aborted_id'),'abandoned upload destroyed');
update public.goods set description='내용 변경' where id='overseas-yes';
select pg_temp.assert(private.adult_allowed_for_good(pg_temp.uid(2),'overseas-yes'),'product edits preserve account approval');
select pg_temp.actor(2);
select pg_temp.assert((select adult_readable from public.my_order_line_goods(array['overseas-yes'])),'order history stays readable');
update private.overseas_adult_requests set valid_until=now()-interval '1 second' where id=:'rid';
select pg_temp.assert(not private.adult_allowed_for_good(pg_temp.uid(2),'overseas-yes')
  and (select not adult_readable and image_path is null from public.my_order_line_goods(array['overseas-yes'])),'expiry masks every product again');
rollback;
