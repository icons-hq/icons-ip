\set ON_ERROR_STOP on
-- 개인정보 접속기록(CUS-084·OPS-014·OPS-015): 서버(service_role)만 기록하고, 표는 운영자·서비스 키 모두 직접 읽거나 고칠 수 없다.
-- append-only(UPDATE·TRUNCATE 거절, DELETE는 보관 기간이 지난 행만)이고 정리 cron이 2년 지난 행을 지운다.
-- 점검 RPC는 매니저 관리 권한(통합·주매니저, 호환 단계 admin)만 읽고, 이상 징후(근무시간 외·대량·몰아보기)를 표시한다.
-- 합성 계정·주문·기록은 모두 롤백한다. legacy helper 없이 명시적 매니저 역할과 고정 호환 명단(cohort)으로 판정한다.
begin;
create schema pii_log_test;
create function pii_log_test.id(n integer) returns uuid language sql immutable as $$
  select ('a9000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pii_log_test.actor(n integer) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub',pii_log_test.id(n)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pii_log_test.id(n),'role','authenticated')::text,true);
end $$;
create function pii_log_test.ok(ok boolean,label text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'pii access log assertion: %',label;end if;raise notice 'PASS %',label;
end $$;
create function pii_log_test.error(q text,expected text) returns void language plpgsql as $$ begin
  begin execute q;
  exception when others then if sqlstate=expected or position(expected in sqlerrm)>0 then raise notice 'PASS rejected %',expected;return;end if;raise;end;
  raise exception 'Expected rejection: % (%)',expected,q;
end $$;
-- 서버가 부르는 기록 호출(서비스 키). 인자 순서는 앱 헬퍼와 같다.
create function pii_log_test.rec(actor integer,action text,surface text,path text,ip text,kind text,ids uuid[],total integer,detail jsonb default '{}')
returns bigint language sql as $$
  select public.service_record_operator_pii_access(pii_log_test.id(actor),action,surface,path,ip::inet,kind,ids,total,detail)
$$;
-- 기간·이상 징후 판정을 고정 시각으로 보려고 소유자 권한으로 직접 넣는 행(앱 경로가 아니다).
create function pii_log_test.raw(actor integer,at timestamptz,action text,kind text,ids uuid[],total integer,members uuid[] default '{}')
returns void language sql as $$
  insert into private.operator_pii_access_log(accessed_at,actor_id,actor_access,client_ip,action,surface,path,subject_kind,subject_ids,subject_count,member_ids,fingerprint)
  values(at,pii_log_test.id(actor),'owner','203.0.113.9',action,case when action='export' then 'export.list' else 'order.detail' end,
    '/admin/sales/orders',kind,ids,total,members,md5(random()::text))
$$;
revoke all on all functions in schema pii_log_test from public;
grant usage on schema pii_log_test to authenticated, service_role;
grant execute on all functions in schema pii_log_test to authenticated, service_role;

-- 권한 경계
select pii_log_test.ok(
  has_function_privilege('service_role','public.service_record_operator_pii_access(uuid,text,text,text,inet,text,uuid[],integer,jsonb)','execute')
  and not has_function_privilege('authenticated','public.service_record_operator_pii_access(uuid,text,text,text,inet,text,uuid[],integer,jsonb)','execute')
  and not has_function_privilege('anon','public.service_record_operator_pii_access(uuid,text,text,text,inet,text,uuid[],integer,jsonb)','execute')
  and has_function_privilege('authenticated','public.admin_pii_access_log(date,date,uuid,text,text,uuid,text,integer)','execute')
  and not has_function_privilege('anon','public.admin_pii_access_log(date,date,uuid,text,text,uuid,text,integer)','execute')
  and not has_function_privilege('service_role','public.admin_pii_access_log(date,date,uuid,text,text,uuid,text,integer)','execute')
  and has_function_privilege('authenticated','public.admin_export_pii_access_log(date,date,uuid,text,text,uuid,text)','execute')
  and not has_function_privilege('anon','public.admin_export_pii_access_log(date,date,uuid,text,text,uuid,text)','execute')
  and not has_function_privilege('service_role','public.admin_export_pii_access_log(date,date,uuid,text,text,uuid,text)','execute')
  and not has_function_privilege('authenticated','private.purge_pii_access_log()','execute')
  and not has_function_privilege('service_role','private.purge_pii_access_log()','execute'),
  'only the server records; only operators read; nobody calls the purge');
select pii_log_test.ok(not has_table_privilege('anon','private.operator_pii_access_log','select,insert,update,delete')
  and not has_table_privilege('authenticated','private.operator_pii_access_log','select,insert,update,delete')
  and not has_table_privilege('service_role','private.operator_pii_access_log','select,insert,update,delete')
  and (select relrowsecurity from pg_class where oid='private.operator_pii_access_log'::regclass),
  'the ledger is sealed from every API role');
select pii_log_test.ok((select provolatile='s' from pg_proc where oid='public.admin_pii_access_log(date,date,uuid,text,text,uuid,text,integer)'::regprocedure)
  and (select provolatile='s' from pg_proc where oid='public.admin_export_pii_access_log(date,date,uuid,text,text,uuid,text)'::regprocedure)
  and (select provolatile='v' from pg_proc where oid='public.service_record_operator_pii_access(uuid,text,text,text,inet,text,uuid[],integer,jsonb)'::regprocedure),
  'inspection reads are stable; the recorder is volatile');
select pii_log_test.ok((select count(*)=1 from cron.job where jobname='operator-pii-access-log-retention' and command like '%private.purge_pii_access_log()%'),
  'retention purge is scheduled once');
select pii_log_test.ok((select count(*)=2 from private.operator_rpc_contracts where capability='operators.manage' and guard_kind='read' and legacy_admin_only
  and signature in('public.admin_pii_access_log(date,date,uuid,text,text,uuid,text,integer)','public.admin_export_pii_access_log(date,date,uuid,text,text,uuid,text)')),
  'inspection RPCs are classified as manager-only reads');

-- 1 고객, 2 통합 매니저, 3 부매니저, 4 호환 단계 admin, 5 호환 단계 staff, 6 고객(다른 주문)
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pii_log_test.id(n),'authenticated','authenticated','pii-log-'||n||'@example.test',now(),'{"testFixture":"pii-access-log"}','{}',now(),now()
from generate_series(1,6)n;
update public.profiles set role=case when id in(pii_log_test.id(1),pii_log_test.id(6)) then 'user'::public.user_role
    when id in(pii_log_test.id(2),pii_log_test.id(4)) then 'admin'::public.user_role else 'staff'::public.user_role end,
  nickname='접속기록 합성 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
where id in(select pii_log_test.id(n) from generate_series(1,6)n);
delete from private.operator_memberships where manager_role='owner';
insert into private.operator_memberships(profile_id,manager_role) values(pii_log_test.id(2),'owner'),(pii_log_test.id(3),'deputy');
insert into private.operator_legacy_cohort(profile_id,legacy_role) values(pii_log_test.id(4),'admin'),(pii_log_test.id(5),'staff');
insert into public.orders(id,user_id,status,total,address) values
  (pii_log_test.id(101),pii_log_test.id(1),'pending',11000,'{"recipient":"접속기록-수령인-원문","phone":"010-0000-0000"}'),
  (pii_log_test.id(102),pii_log_test.id(6),'pending',22000,'{}');
insert into public.order_cancellation_requests(id,order_id,requested_by,reason) values
  (pii_log_test.id(201),pii_log_test.id(101),pii_log_test.id(1),'접속기록 합성 취소 사유');

-- 서버 기록: 회원·주문·클레임 대상의 회원이 함께 남고, 개인정보 원문은 남지 않는다.
create temp table pii_ids(label text primary key, id bigint not null);
grant all on pii_ids to service_role;
set local role service_role;
do $$ begin
  insert into pii_ids values('first',pii_log_test.rec(2,'view','customer.detail','/admin/customers/'||pii_log_test.id(1),'203.0.113.10','member',array[pii_log_test.id(1)],1));
  insert into pii_ids values('again',pii_log_test.rec(2,'view','customer.detail','/admin/customers/'||pii_log_test.id(1),'203.0.113.10','member',array[pii_log_test.id(1)],1));
  insert into pii_ids values('other',pii_log_test.rec(2,'view','customer.detail','/admin/customers/'||pii_log_test.id(1),'198.51.100.7','member',array[pii_log_test.id(1)],1));
  insert into pii_ids values('export1',pii_log_test.rec(2,'export','export.list','/api/admin/list-export','203.0.113.10','order','{}',3,'{"screen":"orders","rowCount":4}'));
  insert into pii_ids values('export2',pii_log_test.rec(2,'export','export.list','/api/admin/list-export','203.0.113.10','order','{}',3,'{"screen":"orders","rowCount":4}'));
  perform pii_log_test.rec(3,'view','order.detail','/admin/sales/orders/'||pii_log_test.id(101),null,'order',array[pii_log_test.id(101),pii_log_test.id(102)],2,'{"via":"page"}');
  perform pii_log_test.rec(2,'reveal','claim.contact','/api/admin/claim-contact/context',null,'claim',array[pii_log_test.id(201)],1);
  perform pii_log_test.rec(4,'search','order.search','/admin/sales/orders','203.0.113.11','order',array[pii_log_test.id(101)],7,'{"field":"phone","page":1}');
  perform pii_log_test.rec(2,'view','access_log','/admin/settings/access-log',null,'none','{}',0);
end $$;
reset role;
do $$ declare first bigint; row private.operator_pii_access_log; n integer;
begin
  select id into first from pii_ids where label='first';
  perform pii_log_test.ok(first=(select id from pii_ids where label='again'),'re-rendering the same view within 10 minutes is recorded once');
  perform pii_log_test.ok(first<>(select id from pii_ids where label='other'),'a view from another network location is a new record');
  perform pii_log_test.ok((select id from pii_ids where label='export1')<>(select id from pii_ids where label='export2'),'every download is recorded');
  select * into row from private.operator_pii_access_log where id=first;
  perform pii_log_test.ok(row.actor_access='owner' and host(row.client_ip)='203.0.113.10' and row.member_ids=array[pii_log_test.id(1)]
    and row.subject_count=1 and row.path='/admin/customers/'||pii_log_test.id(1),'member view records actor role, network location and the member');
  perform pii_log_test.ok((select actor_access='deputy' and member_ids=(select array_agg(x order by x) from unnest(array[pii_log_test.id(1),pii_log_test.id(6)]) x)
      and client_ip is null and subject_ids=(select array_agg(x order by x) from unnest(array[pii_log_test.id(101),pii_log_test.id(102)]) x)
    from private.operator_pii_access_log where surface='order.detail' and actor_id=pii_log_test.id(3)),'order view resolves the buyers');
  perform pii_log_test.ok((select member_ids=array[pii_log_test.id(1)] from private.operator_pii_access_log where surface='claim.contact'),'claim reveal resolves the buyer');
  perform pii_log_test.ok((select actor_access='legacy_admin' from private.operator_pii_access_log where surface='order.search'),'legacy admin is labelled');
  select count(*) into n from private.operator_pii_access_log l where l::text like '%접속기록-수령인-원문%' or l::text like '%010-0000-0000%';
  perform pii_log_test.ok(n=0,'raw personal data is never copied into the ledger');
end $$;

-- 대상의 회원: 선물 주문은 구매자와 받는 사람(배송지·연락처의 주인), 선물은 보낸·받는 사람, 리뷰는 작성자로 잇는다.
-- 주문 102(구매자 6)를 회원 1에게 보낸 선물이다. 리뷰는 상품·구매 확인 트리거를 비켜 작성자 칸만 둔다(롤백).
insert into private.gift_intents(id,sender_id,recipient_id,sender_label,expires_at,state,order_id,ordered_source_revision)
values (pii_log_test.id(301),pii_log_test.id(6),pii_log_test.id(1),'접속기록 합성 보낸 사람',now()+interval '7 days','ordered',pii_log_test.id(102),'1');
set local session_replication_role = replica;
insert into public.reviews(id,user_id,good_id,order_id,rating,body)
values (pii_log_test.id(401),pii_log_test.id(1),'pii-log-synthetic-good',pii_log_test.id(101),5,'접속기록 합성 리뷰');
set local session_replication_role = origin;
set local role service_role;
do $$ begin
  insert into pii_ids values('gift-order',pii_log_test.rec(5,'view','order.detail','/admin/sales/orders/'||pii_log_test.id(102),null,'order',array[pii_log_test.id(102)],1,'{"via":"popup"}'));
  insert into pii_ids values('gift-claim',pii_log_test.rec(5,'search','claim.search','/admin/sales/claims/cancels',null,'claim','{}',0));
  insert into pii_ids values('gift',pii_log_test.rec(5,'export','export.gifts','/api/admin/gifts/export',null,'gift',array[pii_log_test.id(301)],1));
  insert into pii_ids values('review',pii_log_test.rec(5,'export','export.reviews','/api/admin/reviews/export',null,'review',array[pii_log_test.id(401)],1));
end $$;
reset role;
do $$ declare pair uuid[] := (select array_agg(x order by x) from unnest(array[pii_log_test.id(1),pii_log_test.id(6)]) x);
begin
  perform pii_log_test.ok((select member_ids=pair from private.operator_pii_access_log where id=(select id from pii_ids where label='gift-order')),
    'a gift order view resolves the buyer and the recipient');
  perform pii_log_test.ok((select member_ids='{}' from private.operator_pii_access_log where id=(select id from pii_ids where label='gift-claim')),
    'a subject-less search resolves nobody');
  perform pii_log_test.ok((select member_ids=pair from private.operator_pii_access_log where id=(select id from pii_ids where label='gift')),
    'a gift export resolves the sender and the recipient');
  perform pii_log_test.ok((select member_ids=array[pii_log_test.id(1)] from private.operator_pii_access_log where id=(select id from pii_ids where label='review')),
    'a review export resolves the author');
end $$;

set local role service_role;
-- 입력 검증: 쿼리 문자열(검색어)·원문이 들어갈 길을 막는다.
select pii_log_test.error($q$select pii_log_test.rec(2,'view','order.search','/admin/sales/orders?query=홍길동',null,'none','{}',0)$q$,'pii_access_path_invalid');
select pii_log_test.error($q$select pii_log_test.rec(2,'peek','order.detail','/admin/sales/orders',null,'none','{}',0)$q$,'pii_access_action_invalid');
select pii_log_test.error($q$select pii_log_test.rec(2,'view','Order Detail','/admin/sales/orders',null,'none','{}',0)$q$,'pii_access_surface_invalid');
select pii_log_test.error($q$select pii_log_test.rec(2,'view','order.detail','/admin/sales/orders',null,'none',array[pii_log_test.id(101)],1)$q$,'pii_access_subject_invalid');
select pii_log_test.error($q$select pii_log_test.rec(2,'view','order.detail','/admin/sales/orders',null,'order',array[pii_log_test.id(101)],0)$q$,'pii_access_subject_invalid');
select pii_log_test.error($q$select pii_log_test.rec(2,'view','order.detail','/admin/sales/orders',null,'order',array[pii_log_test.id(101),null],2)$q$,'pii_access_subject_invalid');
select pii_log_test.error($q$select pii_log_test.rec(2,'export','export.list','/api/admin/list-export',null,'order',(select array_agg(gen_random_uuid()) from generate_series(1,1001)),1001)$q$,'pii_access_subject_invalid');
select pii_log_test.error($q$select pii_log_test.rec(2,'search','order.search','/admin/sales/orders',null,'none','{}',0,'{"query":{"name":"홍길동"}}')$q$,'pii_access_detail_invalid');
select pii_log_test.error($q$select pii_log_test.rec(2,'search','order.search','/admin/sales/orders',null,'none','{}',0,jsonb_build_object('note',repeat('가',121)))$q$,'pii_access_detail_invalid');
select pii_log_test.error($q$select public.service_record_operator_pii_access(gen_random_uuid(),'view','order.detail','/admin/sales/orders',null,'none','{}',0,'{}')$q$,'pii_access_actor_invalid');
select pii_log_test.error($q$select * from private.operator_pii_access_log$q$,'42501');
reset role;

-- append-only: 표 소유자도 고칠 수 없고, 보관 기간 안의 행은 지울 수 없다.
select pii_log_test.error($q$update private.operator_pii_access_log set client_ip=null$q$,'pii_access_log_append_only');
select pii_log_test.error($q$delete from private.operator_pii_access_log$q$,'pii_access_log_append_only');
select pii_log_test.error($q$truncate private.operator_pii_access_log$q$,'pii_access_log_append_only');
select pii_log_test.raw(2,now()-interval '2 years 1 day','view','none','{}',0);
select pii_log_test.raw(2,now()-interval '2 years'+interval '1 hour','view','none','{}',0);
do $$ declare before_count bigint; removed integer;
begin
  select count(*) into before_count from private.operator_pii_access_log;
  removed:=private.purge_pii_access_log();
  perform pii_log_test.ok(removed=1 and (select count(*) from private.operator_pii_access_log)=before_count-1
    and not exists(select 1 from private.operator_pii_access_log where accessed_at<now()-private.pii_access_log_retention()),
    'the retention purge removes only rows older than two years');
end $$;

-- 점검 조회: 고정된 과거 주(2026-03-02 월 ~ 03-08 일, KST)에 판정용 행을 둔다.
--  * 평일 10시: 몰아보기 50건(운영자 2) + 그 시간 다른 운영자 1건
--  * 평일 23시: 근무시간 외 1건 · 토요일 오후: 근무시간 외 1건
--  * 평일 14시: 대상 5,000건 내려받기(대량)
select pii_log_test.raw(2,'2026-03-03 10:00:00+09'::timestamptz+make_interval(secs=>n),'view','order',array[pii_log_test.id(101)],1,array[pii_log_test.id(1)])
from generate_series(1,50)n;
select pii_log_test.raw(3,'2026-03-03 10:30:00+09','view','order',array[pii_log_test.id(102)],1,array[pii_log_test.id(6)]);
select pii_log_test.raw(3,'2026-03-04 23:10:00+09','view','order',array[pii_log_test.id(102)],1,array[pii_log_test.id(6)]);
select pii_log_test.raw(3,'2026-03-07 15:00:00+09','view','member',array[pii_log_test.id(6)],1,array[pii_log_test.id(6)]);
select pii_log_test.raw(4,'2026-03-05 14:00:00+09','export','order','{}',5000);

set local role authenticated;
select pii_log_test.actor(3);
select pii_log_test.error($q$select public.admin_pii_access_log('2026-03-02','2026-03-08')$q$,'operator_capability_required');
select pii_log_test.error($q$select public.admin_export_pii_access_log('2026-03-02','2026-03-08')$q$,'operator_capability_required');
select pii_log_test.actor(5);
select pii_log_test.error($q$select public.admin_pii_access_log('2026-03-02','2026-03-08')$q$,'operator_capability_required');
select pii_log_test.actor(1);
select pii_log_test.error($q$select public.admin_pii_access_log('2026-03-02','2026-03-08')$q$,'operator_capability_required');
select pii_log_test.actor(4);
select pii_log_test.ok((public.admin_pii_access_log('2026-03-02','2026-03-08')->>'total')::integer=54,'legacy admin can inspect');
select pii_log_test.actor(2);
select pii_log_test.error($q$select public.admin_pii_access_log('2026-03-08','2026-03-02')$q$,'pii_access_log_range_invalid');
select pii_log_test.error($q$select public.admin_pii_access_log('2025-01-01','2026-03-02')$q$,'pii_access_log_range_invalid');
select pii_log_test.error($q$select public.admin_pii_access_log('2026-03-02','2026-03-08',null,'peek')$q$,'pii_access_log_filter_invalid');
select pii_log_test.error($q$select public.admin_pii_access_log('2026-03-02','2026-03-08',null,null,null,null,'weird')$q$,'pii_access_log_filter_invalid');
do $$ declare result jsonb; item jsonb;
begin
  result:=public.admin_pii_access_log('2026-03-02','2026-03-08');
  perform pii_log_test.ok((result->>'total')::integer=54 and (result->>'pageSize')::integer=50 and jsonb_array_length(result->'items')=50
    and (result->'summary'->>'burst')::integer=50 and (result->'summary'->>'offHours')::integer=2 and (result->'summary'->>'bulk')::integer=1
    and (result->'summary'->>'flagged')::integer=53,'summary counts each simple anomaly rule');
  item:=result->'items'->0;
  perform pii_log_test.ok(item->>'actorName' like '접속기록 합성%' and item->>'ip'='203.0.113.9' and item ? 'flags' and item ? 'subjectIds'
    and item ? 'memberIds','items carry the inspection fields');
  perform pii_log_test.ok((select count(*)=3 from jsonb_array_elements(result->'actors')),'actors with records in the range are listed');
  result:=public.admin_pii_access_log('2026-03-02','2026-03-08',null,null,null,null,'any',2);
  perform pii_log_test.ok((result->>'total')::integer=53 and (result->>'page')::integer=2 and jsonb_array_length(result->'items')=3,'any-anomaly filter pages');
  result:=public.admin_pii_access_log('2026-03-02','2026-03-08',null,null,null,null,'off_hours');
  perform pii_log_test.ok((result->>'total')::integer=2 and not exists(select 1 from jsonb_array_elements(result->'items') i where not (i->'flags') ? 'off_hours'),
    'weekday night and weekend count as off hours');
  result:=public.admin_pii_access_log('2026-03-02','2026-03-08',null,null,null,null,'burst');
  perform pii_log_test.ok((result->>'total')::integer=50 and not exists(select 1 from jsonb_array_elements(result->'items') i where i->>'actorId'<>pii_log_test.id(2)::text),
    'only the operator with 50 views in an hour is a burst');
  result:=public.admin_pii_access_log('2026-03-02','2026-03-08',null,'export',null,null,'bulk');
  perform pii_log_test.ok((result->>'total')::integer=1 and (result->'items'->0->>'subjectCount')::integer=5000,'a 5,000-subject download is bulk');
  result:=public.admin_pii_access_log('2026-03-02','2026-03-08',pii_log_test.id(3));
  perform pii_log_test.ok((result->>'total')::integer=3 and (result->'summary'->>'burst')::integer=0,'operator filter narrows the list and the summary');
  result:=public.admin_pii_access_log('2026-03-02','2026-03-08',null,null,null,pii_log_test.id(6));
  perform pii_log_test.ok((result->>'total')::integer=3,'a member filter finds views of their orders through the resolved buyer');
  result:=public.admin_pii_access_log('2026-03-02','2026-03-08',null,null,null,pii_log_test.id(102));
  perform pii_log_test.ok((result->>'total')::integer=2,'an order filter finds its own records');
  result:=public.admin_export_pii_access_log('2026-03-02','2026-03-08',null,null,null,null,'any');
  perform pii_log_test.ok((result->>'total')::integer=53 and jsonb_array_length(result->'rows')=53 and result ? 'capturedAt','export returns the same rows');
end $$;
reset role;

-- 내려받기 한도: 같은 조건 10,000건 초과는 거절한다.
insert into private.operator_pii_access_log(accessed_at,actor_id,actor_access,action,surface,path,subject_kind,subject_count,fingerprint)
select '2026-02-10 11:00:00+09'::timestamptz+make_interval(secs=>n),pii_log_test.id(2),'owner','view','order.detail','/admin/sales/orders','none',0,md5(n::text)
from generate_series(1,10001)n;
set local role authenticated;
select pii_log_test.actor(2);
select pii_log_test.error($q$select public.admin_export_pii_access_log('2026-02-09','2026-02-11')$q$,'pii_access_log_export_limit');
reset role;

-- ERP 데이터 읽기는 접속기록을 내보내지 않는다.
set local role service_role;
do $$ declare names text[];
begin
  select array_agg(t->>'name') into names from jsonb_array_elements(public.service_erp_read()->'tables') t;
  perform pii_log_test.ok(names @> array['public.orders'] and not names && array['private.operator_pii_access_log'],'ERP read does not list the access ledger');
end $$;
reset role;

-- PostgREST는 STABLE RPC를 READ ONLY 트랜잭션으로 부른다. 점검 읽기·내려받기는 잠금·쓰기 없이 끝나야 한다(1차 결함 교훈).
set transaction read only;
set local role authenticated;
select pii_log_test.actor(2);
select pii_log_test.ok((public.admin_pii_access_log('2026-03-02','2026-03-08')->>'total')::integer=54,'inspection read runs in a READ ONLY transaction');
select pii_log_test.ok((public.admin_export_pii_access_log('2026-03-02','2026-03-08',null,null,null,null,'any')->>'total')::integer=53,'inspection export runs in a READ ONLY transaction');
reset role;
rollback;
