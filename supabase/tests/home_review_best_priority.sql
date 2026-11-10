\set ON_ERROR_STOP on
-- Isolated synthetic databases only; prepend helpers/goods_kc_fixture.sql.
-- Every fixture and temporary policy/role change below rolls back.
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

create temp table hb_dependencies as select oid,proowner,proacl,prosrc from pg_proc
where oid in ('private.review_event_purchase_eligible(uuid,uuid,text)'::regprocedure,
  'private.review_event_review_fingerprint(public.reviews)'::regprocedure,
  'private.review_best_problem(public.reviews)'::regprocedure,
  'public.get_good_selected_reviews(text)'::regprocedure);
select pg_temp.hb_assert((select md5(prosrc)='7dd4b2594b429843867c0ce0b19aabf3'
  from pg_proc where oid='private.review_event_purchase_eligible(uuid,uuid,text)'::regprocedure),
  'mirrored purchase source contract has not silently drifted');
select pg_temp.hb_assert((select md5(prosrc)='cd3fd66480d98957eb4276f26c336678'
  from pg_proc where oid='private.review_event_review_fingerprint(public.reviews)'::regprocedure),
  'mirrored fingerprint source contract has not silently drifted');
select pg_temp.hb_assert((select md5(prosrc)='e11fd5d6ad4cbb0aa52898b29af041c7'
  from pg_proc where oid='private.review_best_problem(public.reviews)'::regprocedure),
  'mirrored visibility/account source contract has not silently drifted');

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
-- The existing authorized CS reader is the oracle: it executes the original
-- private helpers under their existing owner even on the mixed-owner database.
-- No helper ACL/owner normalization is required to compare their real result.
create function pg_temp.hb_compare(label text) returns void language plpgsql as $$
declare states jsonb; projected jsonb; aggregate_row jsonb; expected_id uuid; ordinary_id uuid; visible_count bigint; visible_average numeric;
begin
  states:=public.admin_get_review_best_states(array[pg_temp.hb_id(2,999),pg_temp.hb_id(2,1000),pg_temp.hb_id(2,1001)]);
  select r.id into expected_id from public.reviews r where r.id in (
    select (value->>'reviewId')::uuid from jsonb_array_elements(states) where value->>'state'='selected'
  ) order by r.rating desc,r.created_at desc,r.id limit 1;
  projected:=public.get_home_best_review_candidates(array['hb-qa-main']);
  perform pg_temp.hb_assert(case when expected_id is null then projected='[]'::jsonb
    else jsonb_array_length(projected)=1 and projected#>>'{0,representative,id}'=expected_id::text end,label||': existing helper oracle agrees');
  aggregate_row:=public.get_home_review_candidates(array['hb-qa-main'])->0;
  if aggregate_row is not null then
    select id into ordinary_id from public.reviews where good_id='hb-qa-main' and status='visible' order by rating desc,created_at desc,id limit 1;
    select count(*),round(avg(rating)::numeric,2) into visible_count,visible_average from public.reviews where good_id='hb-qa-main' and status='visible';
    perform pg_temp.hb_assert(aggregate_row#>>'{representative,id}'=coalesce(expected_id,ordinary_id)::text,label||': BEST or ordinary fallback');
    perform pg_temp.hb_assert((aggregate_row->>'reviewCount')::bigint=visible_count
      and (aggregate_row->>'ratingAverage')::numeric=visible_average,label||': complete ordinary statistics unchanged');
    perform pg_temp.hb_assert((select array_agg(key order by key) from jsonb_object_keys(aggregate_row) key)
      =array['goodId','ratingAverage','recentReviewAt','representative','reviewCount'],label||': aggregate public keys');
    perform pg_temp.hb_assert((select array_agg(key order by key) from jsonb_object_keys(aggregate_row->'representative') key)
      =array['authorName','body','createdAt','id','rating'],label||': representative public keys');
  else perform pg_temp.hb_assert(projected='[]'::jsonb,label||': unavailable public product has no BEST projection');end if;
end $$;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
select public.get_home_review_candidates(array['hb-qa-main']) as hb_baseline \gset
select pg_temp.hb_assert(:'hb_baseline'::jsonb#>>'{0,reviewCount}'='1001'
  and (:'hb_baseline'::jsonb#>>'{0,ratingAverage}')::numeric>=3
  and :'hb_baseline'::jsonb#>>'{0,representative,id}'=pg_temp.hb_id(2,1000)::text,'1001 ordinary rows and pre-selection fallback');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.hb_id(0,2)::text,true);
select pg_temp.hb_select(1001,true);
select pg_temp.hb_compare('one selected low-rating old review');
select pg_temp.hb_assert(public.get_good_selected_reviews('hb-qa-main')='[]'::jsonb
  and jsonb_array_length(public.get_home_best_review_candidates(array['hb-qa-main']))=1,
  'home priority is independent of the disabled PDP gallery and its three-review minimum');
select pg_temp.hb_assert(public.get_home_review_candidates(array['hb-qa-main'])#>>'{0,representative,rating}'='1'
  and ((public.get_home_review_candidates(array['hb-qa-main'])->0)-'representative')=((:'hb_baseline'::jsonb->0)-'representative'),
  'one-star BEST changes only representative, not average/count/recent date');
select pg_temp.hb_select(1000,true);
select pg_temp.hb_select(999,true);
select pg_temp.hb_compare('rating before date among selected reviews');
reset role;
update public.reviews set created_at=(select created_at from public.reviews where id=pg_temp.hb_id(2,1000)) where id=pg_temp.hb_id(2,999);
set local role authenticated;
select pg_temp.hb_compare('equal rating/date uses review ID ascending');
select pg_temp.hb_assert(public.get_home_best_review_candidates(array['hb-qa-main'])#>>'{0,representative,id}'=pg_temp.hb_id(2,999)::text,'deterministic selected tie');
select pg_temp.hb_select(999,false);
select pg_temp.hb_select(1000,false);
select pg_temp.hb_compare('explicit release restores sole one-star priority');
reset role;

savepoint hb_body;
update public.reviews set body='수정된 합성 원문' where id=pg_temp.hb_id(2,1001);
set local role authenticated;
select pg_temp.hb_compare('changed original loses priority');
reset role;
update public.reviews set body='홈 대표 후기 합성 본문 1001' where id=pg_temp.hb_id(2,1001);
set local role authenticated;
select pg_temp.hb_compare('restored original still requires reselection');
reset role;
rollback to hb_body;
savepoint hb_refund;
update public.payments set status='refunded' where id=pg_temp.hb_id(3,1001);
set local role authenticated;
select pg_temp.hb_compare('refund and invalidation use original purchase eligibility');
reset role;
rollback to hb_refund;
savepoint hb_cancel;
-- A complete canceled-order fixture isolates the read predicate without trying
-- to cancel a delivered fixture through the unrelated collection workflow.
insert into public.orders(id,user_id,status,total,address,created_at,delivered_at)
select pg_temp.hb_id(1,2001),user_id,'canceled',total,address,created_at,delivered_at
from public.orders where id=pg_temp.hb_id(1,1001);
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select pg_temp.hb_id(1,2001),good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot
from public.order_items where order_id=pg_temp.hb_id(1,1001);
update public.payments set ref_id=pg_temp.hb_id(1,2001) where id=pg_temp.hb_id(3,1001);
update public.payment_attempts set ref_id=pg_temp.hb_id(1,2001) where id=pg_temp.hb_id(4,1001);
update public.reviews set order_id=pg_temp.hb_id(1,2001) where id=pg_temp.hb_id(2,1001);
set local role authenticated;
select pg_temp.hb_compare('canceled order loses priority');
reset role;
rollback to hb_cancel;
savepoint hb_unpaid;
delete from private.payment_provider_evidence where payment_attempt_id=pg_temp.hb_id(4,1001);
set local role authenticated;
select pg_temp.hb_compare('missing payment evidence loses priority without an invalidation trigger');
reset role;
rollback to hb_unpaid;
savepoint hb_pending_payment;
update public.payments set status='pending' where id=pg_temp.hb_id(3,1001);
set local role authenticated;
select pg_temp.hb_compare('unpaid payment loses priority without an invalidation trigger');
reset role;
rollback to hb_pending_payment;
savepoint hb_amount;
update public.payments set amount=amount+1 where id=pg_temp.hb_id(3,1001);
set local role authenticated;
select pg_temp.hb_compare('payment amount must match order and attempt');
reset role;
rollback to hb_amount;
savepoint hb_bank;
update public.orders set payment_method='bank_transfer' where id=pg_temp.hb_id(1,1001);
update public.payments set provider='bank_transfer' where id=pg_temp.hb_id(3,1001);
update public.payment_attempts set provider='bank_transfer' where id=pg_temp.hb_id(4,1001);
delete from private.payment_provider_evidence where payment_attempt_id=pg_temp.hb_id(4,1001);
insert into public.bank_transfer_confirmations(order_id,attempt_id,confirmed_by,confirmed_at,memo)
values(pg_temp.hb_id(1,1001),pg_temp.hb_id(4,1001),pg_temp.hb_id(0,1),now()-interval '27 days','홈 대표 후기 합성 입금 근거');
set local role authenticated;
select pg_temp.hb_compare('existing bank-transfer confirmation qualifies without provider evidence');
reset role;
rollback to hb_bank;
savepoint hb_return;
insert into public.order_cancellation_requests(order_id,requested_by,reason,claim_type,stage,status,completed_at)
values(pg_temp.hb_id(1,1001),pg_temp.hb_id(0,4),'홈 대표 후기 합성 완료 반품','return','completed','completed',now());
set local role authenticated;
select pg_temp.hb_compare('completed return loses priority');
reset role;
rollback to hb_return;
savepoint hb_hidden;
update public.reviews set status='hidden',hidden_at=now(),hidden_reason='홈 대표 후기 합성 블라인드' where id=pg_temp.hb_id(2,1001);
set local role authenticated;
select pg_temp.hb_compare('hidden review never leaks to a staff reader');
reset role;
rollback to hb_hidden;
savepoint hb_fence;
insert into private.account_deletion_requests(deletion_event_id,subject_user_id,idempotency_key,status)
values(pg_temp.hb_id(5,1),pg_temp.hb_id(0,4),pg_temp.hb_id(5,2),'awaiting_email_intent');
insert into private.account_action_fences(subject_user_id,deletion_event_id) values(pg_temp.hb_id(0,4),pg_temp.hb_id(5,1));
set local role authenticated;
select pg_temp.hb_compare('withdrawal fence loses priority');
reset role;
rollback to hb_fence;
savepoint hb_suspended;
update public.profiles set suspended_at=now(),suspension_reason='홈 대표 후기 합성 이용 정지' where id=pg_temp.hb_id(0,4);
set local role authenticated;
select pg_temp.hb_compare('suspended author loses priority');
reset role;
rollback to hb_suspended;
savepoint hb_good;
update public.goods set published_at=null where id='hb-qa-main';
set local role authenticated;
select pg_temp.hb_compare('unpublished product closes both public readers');
reset role;
rollback to hb_good;
savepoint hb_ip;
update public.ips set published_at=null where id='hb-qa-ip';
set local role authenticated;
select pg_temp.hb_compare('unpublished IP closes both public readers');
reset role;
rollback to hb_ip;
savepoint hb_archive;
-- IP archival requires all children to be archived under the existing guard.
update public.goods set archived_at=now() where id='hb-qa-main';
update public.ips set archived_at=now() where id='hb-qa-ip';
set local role authenticated;
select pg_temp.hb_compare('archived product and IP close both public readers');
reset role;
rollback to hb_archive;

-- Losing BEST priority does not blacklist an otherwise visible ordinary review.
savepoint hb_same_fallback;
set local role authenticated;
select pg_temp.hb_select(1001,false);
select pg_temp.hb_select(999,true);
reset role;
update public.reviews set body='높은 별점 일반 후기에도 남는 수정 원문' where id=pg_temp.hb_id(2,999);
set local role authenticated;
select pg_temp.hb_compare('invalidated BEST may remain the ordinary highest-rated review');
select pg_temp.hb_assert(public.get_home_best_review_candidates(array['hb-qa-main'])='[]'::jsonb
  and public.get_home_review_candidates(array['hb-qa-main'])#>>'{0,representative,id}'=pg_temp.hb_id(2,999)::text,'fallback is not an extra review moderation gate');
reset role;
rollback to hb_same_fallback;

-- Revoking the selector's current role blocks new writes, but does not
-- retroactively undo an existing selection (same contract as the PDP ledger).
update private.operator_memberships set manager_role='logistics' where profile_id=pg_temp.hb_id(0,2);
set local role authenticated;
select pg_temp.hb_expect('select pg_temp.hb_select(1001,false)','42501');
select set_config('request.jwt.claim.sub',pg_temp.hb_id(0,1)::text,true);
select pg_temp.hb_compare('past selection survives selector role revocation');
select public.get_home_review_candidates(array['hb-qa-main']) as hb_final \gset
reset role;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.hb_assert(public.get_home_review_candidates(array['hb-qa-main'])=:'hb_final'::jsonb,'anonymous and authorized viewer have identical public output');
select pg_temp.hb_assert(jsonb_array_length(public.get_home_best_review_candidates(array_fill('hb-qa-main'::text,array[200])))=1,'200 requested IDs deduplicate to one public product');
select pg_temp.hb_assert(public.get_home_best_review_candidates(array['hb-qa-not-found'])='[]'::jsonb,'missing product is an empty public projection');
select pg_temp.hb_expect('select public.get_home_best_review_candidates(null)','22023');
select pg_temp.hb_expect('select public.get_home_best_review_candidates(array[]::text[])','22023');
select pg_temp.hb_expect('select public.get_home_best_review_candidates(array[null]::text[])','22023');
select pg_temp.hb_expect($q$select public.get_home_best_review_candidates(array['../private'])$q$,'22023');
select pg_temp.hb_expect($q$select public.get_home_best_review_candidates(array_fill('hb-qa-main'::text,array[201]))$q$,'22023');
select pg_temp.hb_expect($q$select public.get_home_best_review_candidates(array[['hb-qa-main']])$q$,'22023');
reset role;
set local role service_role;
select pg_temp.hb_expect($q$select public.get_home_best_review_candidates(array['hb-qa-main'])$q$,'42501');
reset role;

select pg_temp.hb_assert(not has_function_privilege('service_role','public.get_home_best_review_candidates(text[])','execute')
  and has_function_privilege('anon','public.get_home_best_review_candidates(text[])','execute')
  and has_function_privilege('authenticated','public.get_home_best_review_candidates(text[])','execute')
  and not has_table_privilege('anon','private.review_best_selections','select')
  and not has_table_privilege('authenticated','private.review_best_selections','select')
  and exists(select 1 from private.operator_internal_contracts where signature='public.get_home_best_review_candidates(text[])'),
  'minimal public roles and registry, no raw private ledger grants');
select pg_temp.hb_assert((select not prosecdef and provolatile='s' from pg_proc where oid='public.get_home_review_candidates(text[])'::regprocedure)
  and (select prosecdef and provolatile='s' and proconfig @> array['search_path=""'] from pg_proc where oid='public.get_home_best_review_candidates(text[])'::regprocedure),
  'stable statement snapshots and retained aggregate invoker boundary');
select pg_temp.hb_assert(not exists(select 1 from hb_dependencies old join pg_proc present on present.oid=old.oid
  where present.prosrc is distinct from old.prosrc or present.proowner is distinct from old.proowner or present.proacl is distinct from old.proacl),
  'existing helper source owner ACL and PDP reader remain unchanged');
create temp table hb_locks as select locktype,classid,objid,objsubid,mode from pg_locks where pid=pg_backend_pid() and locktype='advisory';
create temp table hb_mutation_fingerprint as select md5(jsonb_build_object(
  'selections',(select jsonb_agg(to_jsonb(s) order by review_id) from private.review_best_selections s where review_id in(select pg_temp.hb_id(2,n) from generate_series(999,1001)n)),
  'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_log a where target like 'review:a7b014%'),
  'rewards',(select jsonb_agg(to_jsonb(a) order by entry_id) from private.review_event_awards a where source_review_id in(select pg_temp.hb_id(2,n) from generate_series(999,1001)n)))::text) fingerprint;
set local transaction_read_only=on;
set local timezone='America/New_York';
set local role anon;
select public.get_home_review_candidates(array['hb-qa-main']) as hb_other_zone \gset
-- Existing JSON timestamps retain the session's ISO offset; compare instants,
-- while checking all non-timestamp fields exactly under an actual read-only TX.
select pg_temp.hb_assert(((:'hb_other_zone'::jsonb->0)-'recentReviewAt'-'representative')
    =((:'hb_final'::jsonb->0)-'recentReviewAt'-'representative')
  and (:'hb_other_zone'::jsonb#>'{0,representative}')-'createdAt'=(:'hb_final'::jsonb#>'{0,representative}')-'createdAt'
  and (:'hb_other_zone'::jsonb#>>'{0,recentReviewAt}')::timestamptz=(:'hb_final'::jsonb#>>'{0,recentReviewAt}')::timestamptz
  and (:'hb_other_zone'::jsonb#>>'{0,representative,createdAt}')::timestamptz=(:'hb_final'::jsonb#>>'{0,representative,createdAt}')::timestamptz,
  'actual read-only transaction preserves data and timestamp instants across session timezones');
reset role;
set local timezone='UTC';
select pg_temp.hb_assert(not exists((select locktype,classid,objid,objsubid,mode from pg_locks where pid=pg_backend_pid() and locktype='advisory')
  except select * from hb_locks),'public read acquires no new account or selection advisory lock');
select pg_temp.hb_assert((select fingerprint from hb_mutation_fingerprint)=md5(jsonb_build_object(
  'selections',(select jsonb_agg(to_jsonb(s) order by review_id) from private.review_best_selections s where review_id in(select pg_temp.hb_id(2,n) from generate_series(999,1001)n)),
  'audit',(select jsonb_agg(to_jsonb(a) order by id) from public.audit_log a where target like 'review:a7b014%'),
  'rewards',(select jsonb_agg(to_jsonb(a) order by entry_id) from private.review_event_awards a where source_review_id in(select pg_temp.hb_id(2,n) from generate_series(999,1001)n)))::text),
  'public read neither changes selection/audit nor creates a reward');
rollback;
