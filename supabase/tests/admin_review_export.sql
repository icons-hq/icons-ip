\set ON_ERROR_STOP on
-- Isolated synthetic databases only. Prepend helpers/goods_kc_fixture.sql.
-- Actual caller roles/sessions, complete filters and final issuance revalidation.
-- Every fixture, public write and audit is contained in this rollback transaction.
begin;
set local timezone='UTC';
create function pg_temp.rx_id(n integer) returns uuid language sql immutable as $$select ('a7210000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.rx_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'review export: %',label;end if;raise notice 'PASS %',label;end$$;
create function pg_temp.rx_error(q text,expected_code text,part text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected_code and position(part in sqlerrm)>0 then raise notice 'PASS rejected %: %',expected_code,part;return;end if;raise;end;
 raise exception 'Expected %: %',expected_code,part;end$$;
create function pg_temp.rx_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',pg_temp.rx_id(n)::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rx_id(n),'role','authenticated','session_id',pg_temp.rx_id(n+100))::text,true);
end$$;
create function pg_temp.rx_filters(patch jsonb default '{}') returns jsonb language sql immutable as $$
 select jsonb_build_object('from',null,'to',null,'rating','all','lowRating',false,'status','all','photo','all','reply','all','best','all',
 'query','TEST XLSX a721','field','body','sort','recent','reviewId',null)||patch;
$$;
create function pg_temp.rx_projection(value jsonb) returns jsonb language sql immutable as $$select jsonb_build_object(
 'id',value->'id','goodId',value->'good_id','goodName',value->'good_name','authorName',value->'author_name','rating',value->'rating','body',value->'body',
 'imageCount',jsonb_array_length(coalesce(value->'image_paths','[]')),'helpfulCount',value->'helpful_count','status',value->'status',
 'bestState',value#>'{best_selection,state}','reportCount',value->'report_count','openReportCount',value->'open_report_count',
 'hasReply',value->'admin_reply'<>'null'::jsonb,'replyAt',value->'admin_reply_at','createdAt',value->'created_at','editedAt',value->'edited_at');$$;
create function pg_temp.rx_oracle(filters jsonb) returns jsonb language sql stable as $$
 select coalesce(jsonb_agg(pg_temp.rx_projection(to_jsonb(reader)) order by page,reader.ordinality),'[]')
 from generate_series(0,1) page cross join lateral public.admin_search_reviews_helpful(
 p_review_id=>(filters->>'reviewId')::uuid,p_from=>(filters->>'from')::date,p_to=>(filters->>'to')::date,
 p_rating=>nullif(filters->>'rating','all')::integer,p_status=>nullif(filters->>'status','all'),
 p_has_photo=>case filters->>'photo' when 'with' then true when 'without' then false else null end,
 p_has_reply=>case filters->>'reply' when 'with' then true when 'without' then false else null end,
 p_low_rating=>(filters->>'lowRating')::boolean,p_query=>filters->>'query',p_field=>filters->>'field',p_sort=>filters->>'sort',
 p_limit=>100,p_offset=>page*100,p_best=>filters->>'best') with ordinality as reader;
$$;
create function pg_temp.rx_compare(filters jsonb,label text) returns void language plpgsql as $$declare actual jsonb;expected jsonb;begin
 -- Both reads occur in one SQL statement with the same visible database snapshot.
 select public.admin_export_reviews(filters),pg_temp.rx_oracle(filters) into actual,expected;
 perform pg_temp.rx_assert(actual->'rows'=expected and (actual->>'total')::integer=jsonb_array_length(expected),label);
 perform pg_temp.rx_assert((select bool_and((select count(*)=16 from jsonb_object_keys(value))) from jsonb_array_elements(actual->'rows')) is not false,'minimal sixteen-key SQL projection');
end$$;

-- New functions follow the existing reader owner; no inherited default grant survives.
do $$declare signature text;expected_owner oid;actual_owner oid;expected_roles oid[];actual_roles oid[];begin
 select proowner into expected_owner from pg_proc where oid='public.admin_search_reviews_helpful(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)'::regprocedure;
 foreach signature in array array['private.review_export_snapshot(uuid,jsonb)','public.admin_export_reviews(jsonb)',
  'public.service_record_review_export(uuid,uuid,jsonb,text,integer,timestamptz,text)'] loop
  select proowner into actual_owner from pg_proc where oid=signature::regprocedure;
  select array_agg(distinct grantee order by grantee) into actual_roles from pg_proc p,
   lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=signature::regprocedure and a.privilege_type='EXECUTE';
  select array_agg(distinct role_id order by role_id) into expected_roles from unnest(array[expected_owner]||case
   when signature='public.admin_export_reviews(jsonb)' then array['authenticated'::regrole::oid]
   when signature like 'public.service_record_review_export%' then array['service_role'::regrole::oid] else '{}'::oid[] end) role_id;
  perform pg_temp.rx_assert(actual_owner=expected_owner and actual_roles=expected_roles,'new owner and exact EXECUTE ACL: '||signature);
 end loop;
end$$;

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.rx_id(n),'authenticated','authenticated','review-export-'||n||'@example.test',now(),'{"testFixture":"review-export"}','{}',now(),now() from generate_series(1,3)n;
update public.profiles set role=case when id=pg_temp.rx_id(1) then 'admin'::public.user_role when id=pg_temp.rx_id(3) then 'staff'::public.user_role else 'user'::public.user_role end,
 nickname='TEST XLSX a721 '||right(id::text,2),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id in(pg_temp.rx_id(1),pg_temp.rx_id(2),pg_temp.rx_id(3));
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.rx_id(1),'primary'),(pg_temp.rx_id(3),'logistics');
insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select pg_temp.rx_id(n+100),pg_temp.rx_id(n),now(),now(),now()+interval '1 hour' from generate_series(1,3)n;
insert into public.ips(id,title,vertical_key,published_at) values('review-export-ip','TEST XLSX a721 IP','character',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('review-export-good','review-export-ip','TEST XLSX a721 상품','문구',10000,'ok',10);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 values(('47c47700'||left(md5('review-export-good'),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5('review-export-good')||'@example.test',now(),'{"testFixture":"goods-kc"}','{}');
insert into private.operator_memberships(profile_id,manager_role) values(('47c47700'||left(md5('review-export-good'),24))::uuid,'primary');
select pg_temp.publish_goods_kc_fixture('review-export-good');
insert into public.orders(id,user_id,status,total,address,delivered_at) values(pg_temp.rx_id(201),pg_temp.rx_id(2),'delivered',10000,'{}',now()-interval '1 day'),(pg_temp.rx_id(202),pg_temp.rx_id(2),'canceled',10000,'{}',null);
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.rx_id(201),'review-export-good',id,1,10000,'TEST XLSX a721 상품','문구','review-export-ip' from public.goods_variants where good_id='review-export-good' and is_default;
insert into public.payments(id,user_id,purpose,ref_id,provider,amount,status,idempotency_key)
 values(pg_temp.rx_id(401),pg_temp.rx_id(2),'order',pg_temp.rx_id(201),'korpay',10000,'paid','review-export-payment');
insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 values(pg_temp.rx_id(402),'korpay',pg_temp.rx_id(2),'order',pg_temp.rx_id(201),10000,'approved','review-export-attempt','review-export-order','review-export-product',pg_temp.rx_id(401),now()+interval '1 hour');
insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,approved_at) values(pg_temp.rx_id(402),'confirm',now()-interval '2 days');
insert into public.reviews(id,user_id,good_id,order_id,rating,body) values
 (pg_temp.rx_id(301),pg_temp.rx_id(2),'review-export-good',pg_temp.rx_id(201),5,'TEST XLSX a721 선정 리뷰'),
 (pg_temp.rx_id(302),pg_temp.rx_id(2),'review-export-good',pg_temp.rx_id(202),3,'TEST XLSX a721 일반 리뷰');
select pg_temp.rx_actor(3);
set local role authenticated;
select pg_temp.rx_assert(current_user='authenticated' and auth.uid()=pg_temp.rx_id(3) and (auth.jwt()->>'session_id')::uuid=pg_temp.rx_id(103),'actual authenticated role and matching persisted session claims');
select public.set_review_helpful('review-export-good',pg_temp.rx_id(302),true);
select pg_temp.rx_actor(1);
select public.admin_set_review_best(pg_temp.rx_id(301),true,'TEST 소유자 회귀 선정 근거',0,public.admin_get_review_best_states(array[pg_temp.rx_id(301)])#>>'{0,reviewFingerprint}',pg_temp.rx_id(501));
select pg_temp.rx_assert((select count(*)=2 from public.admin_search_reviews_best(p_query=>'TEST XLSX a721 상품')),'old reader succeeds through existing helper privileges');
select pg_temp.rx_assert((select best_selection->>'state'='selected' from public.admin_search_reviews_best(p_review_id=>pg_temp.rx_id(301))),'normal BEST writer and complete eligible helper chain');
do $$declare old jsonb;new jsonb;sorting text;begin
 if false then
  perform pg_temp.rx_error($q$select * from public.admin_search_reviews_helpful(p_query=>'TEST XLSX a721 상품')$q$,'42501','review_best_state');
 else
  foreach sorting in array array['recent','oldest','rating_desc','rating_asc','good_name_asc','photo_count_desc'] loop
   select coalesce(jsonb_agg(to_jsonb(r)),'[]') into old from public.admin_search_reviews_best(p_query=>'TEST XLSX a721 상품',p_sort=>sorting,p_limit=>1,p_offset=>1)r;
   select coalesce(jsonb_agg(to_jsonb(r)-'helpful_count'),'[]') into new from public.admin_search_reviews_helpful(p_query=>'TEST XLSX a721 상품',p_sort=>sorting,p_limit=>1,p_offset=>1)r;
   perform pg_temp.rx_assert(old=new,'authenticated full-row parity '||sorting);
  end loop;
  perform pg_temp.rx_assert((select id=pg_temp.rx_id(302) and helpful_count=1 and total_count=2 from public.admin_search_reviews_helpful(p_query=>'TEST XLSX a721 상품',p_sort=>'helpful_desc',p_limit=>1)),'actual stored helpful count and sorting');
  perform pg_temp.rx_assert((select id=pg_temp.rx_id(301) and best_selection->>'state'='selected' from public.admin_search_reviews_helpful(p_query=>'TEST XLSX a721 상품',p_best=>'selected')),'selected BEST filter and helper state remain exact');
 end if;
end$$;
select pg_temp.rx_actor(3);
select pg_temp.rx_error($q$select * from public.admin_search_reviews_helpful(p_query=>'TEST XLSX a721 상품')$q$,'42501','operator_capability_required');
reset role;set local role anon;
select pg_temp.rx_error($q$select * from public.admin_search_reviews_helpful()$q$,'42501','permission denied');
reset role;set local role service_role;
select pg_temp.rx_error($q$select * from public.admin_search_reviews_helpful()$q$,'42501','permission denied');
reset role;
select pg_temp.rx_assert(not has_function_privilege('anon','public.admin_search_reviews_helpful(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)','EXECUTE') and not has_function_privilege('service_role','public.admin_search_reviews_helpful(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)','EXECUTE') and not has_table_privilege('authenticated','private.review_helpful_votes','SELECT'),'public function and private table seals preserved');

-- Appended to prepare-fixture.sql in the same transaction/session.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.rx_id(n),'authenticated','authenticated','review-export-'||n||'@example.test',now(),'{"testFixture":"review-export"}','{}',now(),now() from generate_series(4,5)n;
update public.profiles set role='staff',nickname='TEST XLSX a721 operator '||right(id::text,2),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id in (pg_temp.rx_id(4),pg_temp.rx_id(5));
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.rx_id(5),'primary');
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
 select pg_temp.rx_id(n+100),pg_temp.rx_id(n),now(),now(),now()+interval '1 hour' from generate_series(4,5)n;
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty)
 values('review-export-zgood','review-export-ip','TEST XLSX a721 Z 상품','문구',10000,'ok',10);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 values(('47c47700'||left(md5('review-export-zgood'),24))::uuid,'authenticated','authenticated',
 'kc-synthetic-'||md5('review-export-zgood')||'@example.test',now(),'{"testFixture":"goods-kc"}','{}');
insert into private.operator_memberships(profile_id,manager_role)
 values(('47c47700'||left(md5('review-export-zgood'),24))::uuid,'primary');
select pg_temp.publish_goods_kc_fixture('review-export-zgood');
insert into public.orders(id,user_id,status,total,address,delivered_at)
 select pg_temp.rx_id(100000+n),pg_temp.rx_id(2),'delivered',10000,'{}',now()-interval '1 day' from generate_series(1,101)n;
insert into public.reviews(id,user_id,good_id,order_id,rating,body,image_paths,status,hidden_reason,hidden_at,
 admin_reply,admin_reply_at,created_at,edited_at)
 select pg_temp.rx_id(1000+n),pg_temp.rx_id(2),case when n%2=0 then 'review-export-zgood' else 'review-export-good' end,
 pg_temp.rx_id(100000+n),(1+n%5)::smallint,'TEST XLSX a721 extra '||n||E' 한글\n줄바꿈',
 case when n%2=0 then array[pg_temp.rx_id(2)::text||'/review/'||pg_temp.rx_id(1000+n)::text||'.jpg'] else '{}'::text[] end,
 case when n%7=0 then 'hidden' else 'visible' end,case when n%7=0 then 'TEST 숨김 사유 파일 제외' else null end,
 case when n%7=0 then timestamptz '2026-10-15 00:00:00+00' else null end,
 case when n%3=0 then 'TEST 비공개 답글 원문 제외' else null end,
 case when n%3=0 then timestamptz '2026-10-15 00:01:00+00' else null end,
 timestamptz '2026-10-14 15:00:00+00'+((n%5)-2)*interval '1 second',
 case when n%4=0 then timestamptz '2026-10-15 00:02:00+00' else null end
 from generate_series(1,101)n;
insert into private.review_helpful_votes(review_id,user_id)
 values(pg_temp.rx_id(1001),pg_temp.rx_id(1)),(pg_temp.rx_id(1001),pg_temp.rx_id(3)),(pg_temp.rx_id(1002),pg_temp.rx_id(1));
insert into public.reports(id,target_type,target_id,reporter_id,reason,status)
 values(pg_temp.rx_id(701),'review',pg_temp.rx_id(1001)::text,pg_temp.rx_id(1),'TEST 신고 원문 제외','open'),
 (pg_temp.rx_id(702),'review',pg_temp.rx_id(1001)::text,pg_temp.rx_id(3),'TEST 처리 신고 원문 제외','resolved');

select pg_temp.rx_actor(1);
set local role authenticated;
select pg_temp.rx_assert(current_user='authenticated' and auth.uid()=pg_temp.rx_id(1),'actual authenticated identity');
do $$declare sorting text;patch jsonb;begin
 foreach sorting in array array['recent','oldest','rating_desc','rating_asc','good_name_asc','photo_count_desc','helpful_desc'] loop
  perform pg_temp.rx_compare(pg_temp.rx_filters(jsonb_build_object('sort',sorting)),'full-row parity sort '||sorting);
 end loop;
 for patch in select value from jsonb_array_elements('[
  {"from":"2026-10-15","to":"2026-10-15"},{"rating":"2"},{"rating":"5","lowRating":true},{"lowRating":true},
  {"status":"hidden"},{"status":"visible"},{"photo":"with"},{"photo":"without"},{"reply":"with"},{"reply":"without"},
  {"best":"selected"},{"best":"not_selected"},{"best":"needs_review"},
  {"field":"good","query":"TEST XLSX a721 Z"},{"field":"author","query":"review-export-2@example.test"},
  {"field":"all","query":"extra 17"},{"field":"body","query":"한글"},
  {"reviewId":"a7210000-0000-4000-8000-000000000301"},{"reviewId":"a7210000-0000-4000-8000-000000999999"},
  {"query":"no-such-a721-review"},{"query":""}
 ]'::jsonb) loop
  -- Empty-query comparison remains isolated through the reviewId condition.
  if patch->>'query'='' then patch:=patch||jsonb_build_object('reviewId',pg_temp.rx_id(301));end if;
  perform pg_temp.rx_compare(pg_temp.rx_filters(patch),'filter parity '||patch::text);
 end loop;
 perform pg_temp.rx_assert((public.admin_export_reviews(pg_temp.rx_filters(' {"query":"TEST XLSX a721 extra"}')) ->>'total')::integer=101,'snapshot returns all 101 rows beyond old reader clamp');
 perform pg_temp.rx_assert(public.admin_export_reviews(pg_temp.rx_filters('{"best":"selected"}'))#>>'{rows,0,bestState}'='selected','selected BEST helper chain through actual reader owner');
 perform pg_temp.rx_assert(public.admin_export_reviews(pg_temp.rx_filters('{"query":"no-such-a721-review"}'))->'rows'='[]','zero-row snapshot');
 perform pg_temp.rx_assert((public.admin_export_reviews(pg_temp.rx_filters(jsonb_build_object('query',repeat('😀',50))))->>'total')::integer=0,'100 UTF16 units accepted');
 perform pg_temp.rx_error(format('select public.admin_export_reviews(%L::jsonb)',pg_temp.rx_filters(jsonb_build_object('query',repeat('😀',51)))), '22023','invalid_review_export_filters');
 perform pg_temp.rx_error(format('select public.admin_export_reviews(%L::jsonb)',pg_temp.rx_filters(jsonb_build_object('query',chr(160)||'value'))), '22023','invalid_review_export_filters');
 perform pg_temp.rx_error(format('select public.admin_export_reviews(%L::jsonb)',pg_temp.rx_filters(jsonb_build_object('query',E'\tvalue\n'))), '22023','invalid_review_export_filters');
 for patch in select value from jsonb_array_elements('[{"from":"2026-02-30"},{"from":"0099-01-01"},{"from":"2026-10-15","to":"2026-10-14"},{"rating":"7"},{"lowRating":"false"},{"status":"deleted"},{"photo":"yes"},{"reply":"yes"},{"best":"bad"},{"field":"email"},{"sort":"bad"},{"page":1},{"reviewId":"bad"},{"query":null}]'::jsonb) loop
  perform pg_temp.rx_error(format('select public.admin_export_reviews(%L::jsonb)',pg_temp.rx_filters(patch)), '22023','invalid_review_export_filters');
 end loop;
 perform pg_temp.rx_error(format('select public.admin_export_reviews(%L::jsonb)',pg_temp.rx_filters()-'reviewId'), '22023','invalid_review_export_filters');
end$$;
select public.admin_export_reviews(pg_temp.rx_filters()) as saved_snapshot \gset
reset role;
create temp table rx_saved(snapshot jsonb,issued_before bigint);
insert into rx_saved values(:'saved_snapshot'::jsonb,(select count(*) from public.audit_log where actor_id=pg_temp.rx_id(1) and action='admin.review_export.file_issued'));
grant select on pg_temp.rx_saved to authenticated,service_role;
set local role service_role;
select public.service_record_review_export(pg_temp.rx_id(1),pg_temp.rx_id(101),pg_temp.rx_filters(),
 (select snapshot->>'fingerprint' from rx_saved),(select (snapshot->>'total')::integer from rx_saved),
 (select (snapshot->>'capturedAt')::timestamptz from rx_saved),repeat('b',64)) as audit_id \gset
reset role;
select pg_temp.rx_assert((select count(*)=1 and bool_and(action='admin.review_export.file_issued' and target='admin_screen:reviews'
 and diff->>'fileSha256'=repeat('b',64) and diff->>'encryption'='ECMA-376-Agile' and diff->>'queryPresent'='true'
 and not ((diff->'filters')?'query') and not (diff?'rows') and not (diff?'password') and not (diff?'passwordHash'))
 from public.audit_log where id=:'audit_id'::uuid),'minimal successful issuance audit');
update rx_saved set issued_before=issued_before+1;

-- Fingerprint drift cases are appended here by the verifier as savepoint-scoped
-- mutations of only a721 synthetic rows, with actual SET ROLE service_role calls.
savepoint drift_body;
update public.reviews set body=body||' changed' where id=pg_temp.rx_id(1001);
set local role service_role;
select pg_temp.rx_error($error$select public.service_record_review_export(pg_temp.rx_id(1),pg_temp.rx_id(101),pg_temp.rx_filters(),(select snapshot->>'fingerprint' from rx_saved),(select (snapshot->>'total')::integer from rx_saved),(select (snapshot->>'capturedAt')::timestamptz from rx_saved),repeat('b',64))$error$,'PT409','review_export_changed');
reset role;rollback to drift_body;
savepoint drift_rating;
update public.reviews set rating=4 where id=pg_temp.rx_id(1001);
set local role service_role;
select pg_temp.rx_error($error$select public.service_record_review_export(pg_temp.rx_id(1),pg_temp.rx_id(101),pg_temp.rx_filters(),(select snapshot->>'fingerprint' from rx_saved),(select (snapshot->>'total')::integer from rx_saved),(select (snapshot->>'capturedAt')::timestamptz from rx_saved),repeat('b',64))$error$,'PT409','review_export_changed');
reset role;rollback to drift_rating;
savepoint drift_author;
update public.profiles set nickname='TEST changed author' where id=pg_temp.rx_id(2);
set local role service_role;
select pg_temp.rx_error($error$select public.service_record_review_export(pg_temp.rx_id(1),pg_temp.rx_id(101),pg_temp.rx_filters(),(select snapshot->>'fingerprint' from rx_saved),(select (snapshot->>'total')::integer from rx_saved),(select (snapshot->>'capturedAt')::timestamptz from rx_saved),repeat('b',64))$error$,'PT409','review_export_changed');
reset role;rollback to drift_author;
savepoint drift_good_name;
update public.goods set name=name||' changed',published_at=null where id='review-export-good';
set local role service_role;
select pg_temp.rx_error($error$select public.service_record_review_export(pg_temp.rx_id(1),pg_temp.rx_id(101),pg_temp.rx_filters(),(select snapshot->>'fingerprint' from rx_saved),(select (snapshot->>'total')::integer from rx_saved),(select (snapshot->>'capturedAt')::timestamptz from rx_saved),repeat('b',64))$error$,'PT409','review_export_changed');
reset role;rollback to drift_good_name;
savepoint drift_visibility;
update public.reviews set status='hidden',hidden_reason='TEST hidden',hidden_at=now() where id=pg_temp.rx_id(1001);
set local role service_role;
select pg_temp.rx_error($error$select public.service_record_review_export(pg_temp.rx_id(1),pg_temp.rx_id(101),pg_temp.rx_filters(),(select snapshot->>'fingerprint' from rx_saved),(select (snapshot->>'total')::integer from rx_saved),(select (snapshot->>'capturedAt')::timestamptz from rx_saved),repeat('b',64))$error$,'PT409','review_export_changed');
reset role;rollback to drift_visibility;
savepoint drift_reply;
update public.reviews set admin_reply='TEST new reply',admin_reply_at=now() where id=pg_temp.rx_id(1001);
set local role service_role;
select pg_temp.rx_error($error$select public.service_record_review_export(pg_temp.rx_id(1),pg_temp.rx_id(101),pg_temp.rx_filters(),(select snapshot->>'fingerprint' from rx_saved),(select (snapshot->>'total')::integer from rx_saved),(select (snapshot->>'capturedAt')::timestamptz from rx_saved),repeat('b',64))$error$,'PT409','review_export_changed');
reset role;rollback to drift_reply;
savepoint drift_photo;
update public.reviews set image_paths=array[pg_temp.rx_id(2)::text||'/review/'||pg_temp.rx_id(1001)::text||'.jpg'] where id=pg_temp.rx_id(1001);
set local role service_role;
select pg_temp.rx_error($error$select public.service_record_review_export(pg_temp.rx_id(1),pg_temp.rx_id(101),pg_temp.rx_filters(),(select snapshot->>'fingerprint' from rx_saved),(select (snapshot->>'total')::integer from rx_saved),(select (snapshot->>'capturedAt')::timestamptz from rx_saved),repeat('b',64))$error$,'PT409','review_export_changed');
reset role;rollback to drift_photo;
savepoint drift_helpful;
delete from private.review_helpful_votes where review_id=pg_temp.rx_id(1001) and user_id=pg_temp.rx_id(3);
set local role service_role;
select pg_temp.rx_error($error$select public.service_record_review_export(pg_temp.rx_id(1),pg_temp.rx_id(101),pg_temp.rx_filters(),(select snapshot->>'fingerprint' from rx_saved),(select (snapshot->>'total')::integer from rx_saved),(select (snapshot->>'capturedAt')::timestamptz from rx_saved),repeat('b',64))$error$,'PT409','review_export_changed');
reset role;rollback to drift_helpful;
savepoint drift_report_open;
update public.reports set status='resolved' where id=pg_temp.rx_id(701);
set local role service_role;
select pg_temp.rx_error($error$select public.service_record_review_export(pg_temp.rx_id(1),pg_temp.rx_id(101),pg_temp.rx_filters(),(select snapshot->>'fingerprint' from rx_saved),(select (snapshot->>'total')::integer from rx_saved),(select (snapshot->>'capturedAt')::timestamptz from rx_saved),repeat('b',64))$error$,'PT409','review_export_changed');
reset role;rollback to drift_report_open;
savepoint drift_report_total;
delete from public.reports where id=pg_temp.rx_id(702);
set local role service_role;
select pg_temp.rx_error($error$select public.service_record_review_export(pg_temp.rx_id(1),pg_temp.rx_id(101),pg_temp.rx_filters(),(select snapshot->>'fingerprint' from rx_saved),(select (snapshot->>'total')::integer from rx_saved),(select (snapshot->>'capturedAt')::timestamptz from rx_saved),repeat('b',64))$error$,'PT409','review_export_changed');
reset role;rollback to drift_report_total;
savepoint drift_created_at;
update public.reviews set created_at=created_at+interval '1 day' where id=pg_temp.rx_id(1001);
set local role service_role;
select pg_temp.rx_error($error$select public.service_record_review_export(pg_temp.rx_id(1),pg_temp.rx_id(101),pg_temp.rx_filters(),(select snapshot->>'fingerprint' from rx_saved),(select (snapshot->>'total')::integer from rx_saved),(select (snapshot->>'capturedAt')::timestamptz from rx_saved),repeat('b',64))$error$,'PT409','review_export_changed');
reset role;rollback to drift_created_at;
savepoint drift_edited_at;
update public.reviews set edited_at=now() where id=pg_temp.rx_id(1001);
set local role service_role;
select pg_temp.rx_error($error$select public.service_record_review_export(pg_temp.rx_id(1),pg_temp.rx_id(101),pg_temp.rx_filters(),(select snapshot->>'fingerprint' from rx_saved),(select (snapshot->>'total')::integer from rx_saved),(select (snapshot->>'capturedAt')::timestamptz from rx_saved),repeat('b',64))$error$,'PT409','review_export_changed');
reset role;rollback to drift_edited_at;
savepoint drift_row_deleted;
delete from public.reviews where id=pg_temp.rx_id(1003);
set local role service_role;
select pg_temp.rx_error($error$select public.service_record_review_export(pg_temp.rx_id(1),pg_temp.rx_id(101),pg_temp.rx_filters(),(select snapshot->>'fingerprint' from rx_saved),(select (snapshot->>'total')::integer from rx_saved),(select (snapshot->>'capturedAt')::timestamptz from rx_saved),repeat('b',64))$error$,'PT409','review_export_changed');
reset role;rollback to drift_row_deleted;
savepoint drift_same_count_identity;
update public.reviews set id=pg_temp.rx_id(999998) where id=pg_temp.rx_id(1003);
set local role service_role;
select pg_temp.rx_error($error$select public.service_record_review_export(pg_temp.rx_id(1),pg_temp.rx_id(101),pg_temp.rx_filters(),(select snapshot->>'fingerprint' from rx_saved),(select (snapshot->>'total')::integer from rx_saved),(select (snapshot->>'capturedAt')::timestamptz from rx_saved),repeat('b',64))$error$,'PT409','review_export_changed');
reset role;rollback to drift_same_count_identity;
savepoint drift_best_state;
set local role authenticated;select public.admin_set_review_best(pg_temp.rx_id(301),false,'TEST 선정 해제',(public.admin_get_review_best_states(array[pg_temp.rx_id(301)])#>>'{0,revision}')::integer,public.admin_get_review_best_states(array[pg_temp.rx_id(301)])#>>'{0,reviewFingerprint}',pg_temp.rx_id(803));reset role;
set local role service_role;
select pg_temp.rx_error($error$select public.service_record_review_export(pg_temp.rx_id(1),pg_temp.rx_id(101),pg_temp.rx_filters(),(select snapshot->>'fingerprint' from rx_saved),(select (snapshot->>'total')::integer from rx_saved),(select (snapshot->>'capturedAt')::timestamptz from rx_saved),repeat('b',64))$error$,'PT409','review_export_changed');
reset role;rollback to drift_best_state;

savepoint suspended_actor;
update public.profiles set suspended_at=now(),suspension_reason='TEST review export suspension' where id=pg_temp.rx_id(1);
set local role authenticated;
select pg_temp.rx_error('select public.admin_export_reviews(pg_temp.rx_filters())','42501','review_export_auth_changed');
reset role;rollback to suspended_actor;
savepoint provider_banned;
update auth.users set banned_until=now()+interval '1 day' where id=pg_temp.rx_id(1);
set local role authenticated;
select pg_temp.rx_error('select public.admin_export_reviews(pg_temp.rx_filters())','42501','review_export_auth_changed');
reset role;rollback to provider_banned;
savepoint fenced_actor;
insert into private.account_deletion_requests(deletion_event_id,subject_user_id,idempotency_key,status)
 values(pg_temp.rx_id(801),pg_temp.rx_id(1),pg_temp.rx_id(802),'awaiting_email_intent');
insert into private.account_action_fences(subject_user_id,deletion_event_id) values(pg_temp.rx_id(1),pg_temp.rx_id(801));
set local role authenticated;
select pg_temp.rx_error('select public.admin_export_reviews(pg_temp.rx_filters())','42501','review_export_auth_changed');
reset role;rollback to fenced_actor;
savepoint expired_session;
update auth.sessions set not_after=now()-interval '1 second' where id=pg_temp.rx_id(101);
set local role authenticated;
select pg_temp.rx_error('select public.admin_export_reviews(pg_temp.rx_filters())','42501','review_export_auth_changed');
reset role;rollback to expired_session;
savepoint removed_session;
delete from auth.sessions where id=pg_temp.rx_id(101);
set local role authenticated;
select pg_temp.rx_error('select public.admin_export_reviews(pg_temp.rx_filters())','42501','review_export_auth_changed');
reset role;rollback to removed_session;
select pg_temp.rx_actor(4);
set local role authenticated;
select pg_temp.rx_error('select public.admin_export_reviews(pg_temp.rx_filters())','42501','review_export_auth_changed');
reset role;
select pg_temp.rx_actor(1);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rx_id(2),'role','authenticated','session_id',pg_temp.rx_id(101))::text,true);
set local role authenticated;
select pg_temp.rx_error('select public.admin_export_reviews(pg_temp.rx_filters())','42501','review_export_auth_changed');
reset role;
select pg_temp.rx_actor(1);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.rx_id(1),'role','authenticated','session_id',pg_temp.rx_id(102))::text,true);
set local role authenticated;
select pg_temp.rx_error('select public.admin_export_reviews(pg_temp.rx_filters())','42501','review_export_auth_changed');
reset role;
select pg_temp.rx_actor(3);
set local role authenticated;
select pg_temp.rx_error('select public.admin_export_reviews(pg_temp.rx_filters())','42501','review_export_auth_changed');
select pg_temp.rx_error('select private.review_export_snapshot(pg_temp.rx_id(1),pg_temp.rx_filters())','42501','permission denied');
select pg_temp.rx_error('select public.service_record_review_export(null,null,null,null,null,null,null)','42501','permission denied');
reset role;set local role anon;
select pg_temp.rx_error('select public.admin_export_reviews(pg_temp.rx_filters())','42501','permission denied');
reset role;set local role service_role;
select pg_temp.rx_error('select public.admin_export_reviews(pg_temp.rx_filters())','42501','permission denied');
select pg_temp.rx_error('select private.review_export_snapshot(pg_temp.rx_id(1),pg_temp.rx_filters())','42501','permission denied');
reset role;
select pg_temp.rx_assert((select count(*) from public.audit_log where actor_id=pg_temp.rx_id(1) and action='admin.review_export.file_issued')=(select issued_before from rx_saved),'failed attempts add no issuance audit');
rollback;
