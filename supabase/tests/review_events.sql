\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql. All synthetic data and clock transitions roll back.
begin;
load 'safeupdate';
create function pg_temp.review_event_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected review event error: %',expected;end $$;
update private.operator_access_state set configured=false where id;
delete from private.operator_memberships where true;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('92000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','review-event-'||n||'@example.test',now(),'{}','{}' from generate_series(1,12)n;
update public.profiles set role=case when id='92000000-0000-4000-8000-000000000001' then 'admin'::public.user_role when right(id::text,12)::integer<=6 then 'staff'::public.user_role else 'user'::public.user_role end,
 nickname='이벤트 합성 '||right(id::text,2),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id::text like '92000000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role)
 select ('92000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,role from unnest(array['owner','primary','deputy','influencer','agency','logistics']) with ordinality r(role,n);
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key,published_at) select 'review-event-ip','리뷰이벤트 합성 IP',key,now() from public.verticals limit 1;
insert into public.catalog_categories(id,code,name) values('92000000-0000-4000-8000-000000010001','review-event-root','이벤트 분류');
insert into public.catalog_categories(id,code,name,parent_id) values('92000000-0000-4000-8000-000000010002','review-event-leaf','이벤트 하위분류','92000000-0000-4000-8000-000000010001');
update public.category_activation_control set customer_enabled=true where id='catalog';
insert into public.goods(id,ip_id,name,type,price,category_id)
 select 'review-event-good-'||n,'review-event-ip','리뷰이벤트 합성 상품 '||n,'문구',10000,'92000000-0000-4000-8000-000000010002' from generate_series(1,3)n;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','kc-synthetic-'||md5(id)||'@example.test',now(),'{"testFixture":"goods-kc"}','{}' from public.goods where id like 'review-event-good-%';
update public.profiles set role='staff' where id in(select ('47c47700'||left(md5(id),24))::uuid from public.goods where id like 'review-event-good-%');
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id like 'review-event-good-%';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id like 'review-event-good-%';
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.admin_save_store_credit_policy(gen_random_uuid(),(public.admin_get_store_credit_policy()->>'version')::integer,
 '{"enabled":true,"earnKind":"fixed","earnValue":0,"earnMaxPerOrder":0,"maxBalance":100000,"validityDays":30,"minUse":100,"maxUse":30000,"restoreGraceDays":3,"refundEarnedCreditMode":"offset_future_credits","evidence":"리뷰이벤트 격리 합성 검증"}');
create function pg_temp.review_event_values(amount integer default 1000) returns jsonb language sql as $$
 select jsonb_build_object('title','합성 리뷰 이벤트','description','별점과 무관한 구체적인 사용 후기','targetType','goods','goodIds',jsonb_build_array('review-event-good-1'),'categoryIds','[]'::jsonb,
  'startsOn',((statement_timestamp() at time zone 'Asia/Seoul')::date+1)::text,'endsOn',((statement_timestamp() at time zone 'Asia/Seoul')::date+3)::text,
  'announcesOn',((statement_timestamp() at time zone 'Asia/Seoul')::date+6)::text,'plannedWinners',4,'creditAmount',amount,'creditValidityDays',10,'bannerStyle','basic');$$;
select public.admin_save_review_event('92000000-0000-4000-8000-000000000101',0,'92000000-0000-4000-8000-000000001001',pg_temp.review_event_values()) as first_saved \gset
select 1/case when public.admin_save_review_event('92000000-0000-4000-8000-000000000101',0,'92000000-0000-4000-8000-000000001001',pg_temp.review_event_values())=:'first_saved'::jsonb then 1 else 0 end as exact_save_replay;
select pg_temp.review_event_error($q$select public.admin_save_review_event('92000000-0000-4000-8000-000000000101',0,'92000000-0000-4000-8000-000000001001',pg_temp.review_event_values(500))$q$,'operation_conflict');
select pg_temp.review_event_error($q$select public.admin_save_review_event('92000000-0000-4000-8000-000000000101',0,gen_random_uuid(),pg_temp.review_event_values())$q$,'review_event_changed');
select pg_temp.review_event_error($q$select public.admin_save_review_event(gen_random_uuid(),0,gen_random_uuid(),pg_temp.review_event_values()||'{"creditAmount":"1000"}')$q$,'invalid_review_event');
select pg_temp.review_event_error($q$select public.admin_save_review_event(gen_random_uuid(),0,gen_random_uuid(),pg_temp.review_event_values()||'{"title":"1234567890123456"}')$q$,'invalid_review_event');
select pg_temp.review_event_error($q$select public.admin_save_review_event(gen_random_uuid(),0,gen_random_uuid(),pg_temp.review_event_values()||'{"startsOn":"2026-02-30"}')$q$,'invalid_review_event');
select pg_temp.review_event_error($q$select public.admin_save_review_event(gen_random_uuid(),0,gen_random_uuid(),pg_temp.review_event_values()||'{"goodIds":["missing"]}')$q$,'review_event_target_missing');
select pg_temp.review_event_error($q$select public.admin_save_review_event(gen_random_uuid(),0,gen_random_uuid(),pg_temp.review_event_values()||jsonb_build_object('goodIds',(select jsonb_agg('over-'||n) from generate_series(1,501)n)))$q$,'invalid_review_event');
select pg_temp.review_event_error($q$select public.admin_save_review_event(gen_random_uuid(),0,gen_random_uuid(),pg_temp.review_event_values()||'{"creditValidityDays":31}')$q$,'review_event_credit_policy');
select public.admin_save_review_event('92000000-0000-4000-8000-000000000100',0,gen_random_uuid(),pg_temp.review_event_values(500));
select public.admin_save_review_event('92000000-0000-4000-8000-000000000102',0,gen_random_uuid(),pg_temp.review_event_values());
select public.admin_save_review_event('92000000-0000-4000-8000-000000000103',0,gen_random_uuid(),pg_temp.review_event_values());
select public.admin_save_review_event('92000000-0000-4000-8000-000000000104',0,gen_random_uuid(),pg_temp.review_event_values(2000)||'{"goodIds":["review-event-good-2"]}');
select public.admin_save_review_event('92000000-0000-4000-8000-000000000105',0,gen_random_uuid(),pg_temp.review_event_values(100)||'{"targetType":"categories","goodIds":[],"categoryIds":["92000000-0000-4000-8000-000000010001"]}');
select 1/case when (public.admin_list_review_events('합성', 'scheduled')->>'total')::integer=6 then 1 else 0 end as list_and_state;
select public.admin_archive_review_event('92000000-0000-4000-8000-000000000100',1,gen_random_uuid(),true);
select 1/case when (public.admin_list_review_events('','archived')->>'total')::integer=1 then 1 else 0 end as archive_before_start;
select public.admin_archive_review_event('92000000-0000-4000-8000-000000000100',2,gen_random_uuid(),false);
reset role;
select 1/case when not has_table_privilege('authenticated','private.review_event_entries','select')
 and not has_function_privilege('anon','public.admin_publish_review_event(uuid,integer,uuid)','execute')
 and not has_function_privilege('service_role','public.get_review_event(uuid,integer)','execute')
 and not has_function_privilege('authenticated','private.reverse_review_event_award(uuid,text,uuid)','execute') then 1 else 0 end as sealed_acl;
set local role anon;
select 1/case when public.get_review_event('92000000-0000-4000-8000-000000000101')#>>'{event,state}'='scheduled'
 and not (public.get_review_event('92000000-0000-4000-8000-000000000101')->'event' ? 'goodIds') then 1 else 0 end as public_prestart_projection;
reset role;
-- Advance the isolated fixture clock by moving the event window, not the host clock.
update private.review_events set starts_on=(statement_timestamp() at time zone 'Asia/Seoul')::date-2,ends_on=(statement_timestamp() at time zone 'Asia/Seoul')::date+1,
 announces_on=(statement_timestamp() at time zone 'Asia/Seoul')::date+4 where id::text like '92000000-0000-4000-8000-%';
update private.review_events set starts_on=starts_on+1 where id='92000000-0000-4000-8000-000000000102';
create function pg_temp.review_event_order(n integer,customer integer,good integer default 1,rating integer default 1,with_evidence boolean default true) returns uuid language plpgsql as $$
declare purchase uuid:=('92000000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid;payment uuid:=('92000000-0000-4000-8002-'||lpad(n::text,12,'0'))::uuid;
 attempt uuid:=('92000000-0000-4000-8003-'||lpad(n::text,12,'0'))::uuid;buyer uuid:=('92000000-0000-4000-8000-'||lpad(customer::text,12,'0'))::uuid;review uuid;
begin
 insert into public.orders(id,user_id,status,total,address,delivered_at) values(purchase,buyer,'delivered',10000,'{}',clock_timestamp()-interval '2 days');
 insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select purchase,g.id,v.id,1,10000,g.name,g.type,g.ip_id from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default where g.id='review-event-good-'||good;
 insert into public.payments(id,user_id,purpose,ref_id,provider,amount,status,idempotency_key) values(payment,buyer,'order',purchase,'korpay',10000,'paid','review-event-payment-'||n);
 insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 values(attempt,'korpay',buyer,'order',purchase,10000,'approved','review-event-attempt-'||n,'review-event-order-'||n,'review-event-product-'||n,payment,now()+interval '1 hour');
 if with_evidence then insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,approved_at) values(attempt,'confirm',now()-interval '3 days');end if;
 perform set_config('request.jwt.claim.sub',buyer::text,true);
 review:=public.create_good_review(purchase,'review-event-good-'||good,rating,'별점과 무관한 합성 사용 후기 '||n);
 return review;
end $$;
select pg_temp.review_event_order(1,8,1,1) as review_a \gset
select pg_temp.review_event_order(2,9,1,2) as review_b \gset
select pg_temp.review_event_order(3,10,1,3) as review_c \gset
select pg_temp.review_event_order(4,11,1,5) as review_d \gset
select pg_temp.review_event_order(5,8,1,4) as review_duplicate \gset
select pg_temp.review_event_order(6,12,2,1) as review_higher \gset
select pg_temp.review_event_order(7,12,3,1) as review_category \gset
select pg_temp.review_event_order(8,12,1,5,false) as review_unpaid \gset
select 1/case when (select count(*) from private.review_event_entries where event_id='92000000-0000-4000-8000-000000000101')=5
 and (select event_id from private.review_event_entries where source_review_id=:'review_higher')='92000000-0000-4000-8000-000000000104'
 and (select event_id from private.review_event_entries where source_review_id=:'review_category')='92000000-0000-4000-8000-000000000105'
 and not exists(select 1 from private.review_event_entries where source_review_id=:'review_unpaid') then 1 else 0 end as valid_purchase_highest_benefit_ties_categories_and_one_star;
set local role anon;
select 1/case when public.get_goods_review_events(array['review-event-good-1'])#>>'{rows,0,event,id}'='92000000-0000-4000-8000-000000000101' then 1 else 0 end as banner_matches_entry;
reset role;
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select pg_temp.review_event_error($q$select public.admin_save_review_event('92000000-0000-4000-8000-000000000101',1,gen_random_uuid(),pg_temp.review_event_values())$q$,'review_event_terms_locked');
select pg_temp.review_event_error($q$select public.admin_select_review_event_entries('92000000-0000-4000-8000-000000000101',1,gen_random_uuid(),'[]','합성 사유')$q$,'review_event_selection_closed');
reset role;
update private.review_events set starts_on=(statement_timestamp() at time zone 'Asia/Seoul')::date-5,ends_on=(statement_timestamp() at time zone 'Asia/Seoul')::date-3,
 announces_on=(statement_timestamp() at time zone 'Asia/Seoul')::date where id='92000000-0000-4000-8000-000000000101';
create function pg_temp.review_event_selection(include_duplicate boolean default false) returns jsonb language sql as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',entry.id,'reviewUpdatedAt',review.updated_at,'reviewFingerprint',private.review_event_review_fingerprint(review)) order by entry.id),'[]'::jsonb)
 from private.review_event_entries entry join public.reviews review on review.id=entry.review_id
 where entry.event_id='92000000-0000-4000-8000-000000000101' and (include_duplicate or entry.order_id<>'92000000-0000-4000-8001-000000000005');$$;
select pg_temp.review_event_selection(true) as duplicate_selection \gset
select pg_temp.review_event_selection() as valid_selection \gset
set local role authenticated;
select pg_temp.review_event_error(format($q$select public.admin_select_review_event_entries('92000000-0000-4000-8000-000000000101',1,gen_random_uuid(),%L,'구체적인 사용 경험')$q$,:'duplicate_selection'),'review_event_customer_once');
select public.admin_select_review_event_entries('92000000-0000-4000-8000-000000000101',1,'92000000-0000-4000-8000-000000001002',:'valid_selection','구체적인 사용 경험') as selected_result \gset
select 1/case when public.admin_select_review_event_entries('92000000-0000-4000-8000-000000000101',1,'92000000-0000-4000-8000-000000001002',:'valid_selection','구체적인 사용 경험')=:'selected_result'::jsonb then 1 else 0 end as selection_replay;
select pg_temp.review_event_error($q$select public.admin_publish_review_event('92000000-0000-4000-8000-000000000101',2,gen_random_uuid())$q$,'operator_capability_required');
reset role;
update public.reviews set body='선정 뒤 수정한 합성 리뷰',updated_at=clock_timestamp()+interval '1 second' where id=:'review_a';
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select pg_temp.review_event_error($q$select public.admin_publish_review_event('92000000-0000-4000-8000-000000000101',2,gen_random_uuid())$q$,'review_event_review_changed');
reset role;
select pg_temp.review_event_selection() as revised_selection \gset
set local role authenticated;
select public.admin_select_review_event_entries('92000000-0000-4000-8000-000000000101',2,gen_random_uuid(),:'revised_selection','수정된 내용을 다시 확인');
select public.admin_adjust_store_credit(gen_random_uuid(),'92000000-0000-4000-8000-000000000009',99500,clock_timestamp()+interval '10 days','별도 합성 지급',0);
select pg_temp.review_event_error($q$select public.admin_publish_review_event('92000000-0000-4000-8000-000000000101',3,gen_random_uuid())$q$,'store_credit_balance_limit');
reset role;
select 1/case when not exists(select 1 from private.review_event_awards where event_id='92000000-0000-4000-8000-000000000101')
 and (private.store_credit_balance('92000000-0000-4000-8000-000000000008')->>'available')::bigint=0
 and (select announced_at from private.review_events where id='92000000-0000-4000-8000-000000000101') is null then 1 else 0 end as grant_failure_rolls_back_every_recipient_and_announcement;
set local role authenticated;
select public.admin_adjust_store_credit(gen_random_uuid(),'92000000-0000-4000-8000-000000000009',-500,null,'별도 지급 일부 조정',99500);
select public.admin_publish_review_event('92000000-0000-4000-8000-000000000101',3,'92000000-0000-4000-8000-000000001003') as published \gset
select 1/case when public.admin_publish_review_event('92000000-0000-4000-8000-000000000101',3,'92000000-0000-4000-8000-000000001003')=:'published'::jsonb then 1 else 0 end as publish_replay;
reset role;
select 1/case when (select count(*) from private.review_event_awards where event_id='92000000-0000-4000-8000-000000000101')=4
 and (select count(*) from public.audit_log where id='92000000-0000-4000-8000-000000001003')=1
 and (private.store_credit_balance('92000000-0000-4000-8000-000000000008')->>'available')::bigint=1000 then 1 else 0 end as actual_credits_four_customers_once;
set local role anon;
select 1/case when (public.get_review_event('92000000-0000-4000-8000-000000000101')->>'winnerTotal')::integer=4
 and public.get_review_event_disclosures(array[:'review_a'::uuid])#>>'{0,revoked}'='false'
 and position('userId' in public.get_review_event('92000000-0000-4000-8000-000000000101')::text)=0
 and position('orderId' in public.get_review_event('92000000-0000-4000-8000-000000000101')::text)=0 then 1 else 0 end as public_winners_and_incentive_disclosure_without_private_ids;
reset role;
update public.reviews set status='hidden',hidden_reason='합성 비공개 검증',hidden_at=now() where id=:'review_a';
update public.payments set status='refunded' where id='92000000-0000-4000-8002-000000000002';
delete from public.reviews where id=:'review_d';
select 1/case when (select count(*) from private.review_event_awards where event_id='92000000-0000-4000-8000-000000000101' and revoked_at is not null)=3
 and (private.store_credit_balance('92000000-0000-4000-8000-000000000008')->>'available')::bigint=0
 and (private.store_credit_balance('92000000-0000-4000-8000-000000000009')->>'available')::bigint=99000
 and (private.store_credit_balance('92000000-0000-4000-8000-000000000011')->>'available')::bigint=0 then 1 else 0 end as hidden_refunded_deleted_recover_only_linked_awards;
-- A real allocation shape represents credits already consumed by another order.
insert into public.orders(id,user_id,status,total,address) values('92000000-0000-4000-8001-000000000020','92000000-0000-4000-8000-000000000010','paid',9400,'{}');
update private.store_credit_lots set available_amount=400,spent_amount=600 where id=(select lot_id from private.review_event_awards where source_review_id=:'review_c');
insert into private.store_credit_allocations(order_id,user_id,lot_id,amount,state,original_expires_at,restore_grace_days)
 select '92000000-0000-4000-8001-000000000020',user_id,lot_id,600,'consumed',expires_at,3 from private.review_event_awards where source_review_id=:'review_c';
select entry_id as entry_c from private.review_event_awards where source_review_id=:'review_c' \gset
set local role authenticated;
select public.admin_revoke_review_event_award(:'entry_c','92000000-0000-4000-8000-000000001004','선정 오류 확인') as revoked \gset
select 1/case when public.admin_revoke_review_event_award(:'entry_c','92000000-0000-4000-8000-000000001004','선정 오류 확인')=:'revoked'::jsonb then 1 else 0 end as revoke_replay;
reset role;
select 1/case when (private.store_credit_balance('92000000-0000-4000-8000-000000000010')->>'available')::bigint=0
 and (private.store_credit_balance('92000000-0000-4000-8000-000000000010')->>'debt')::bigint=600 then 1 else 0 end as spent_award_future_offset;
set local role authenticated;
select public.admin_adjust_store_credit(gen_random_uuid(),'92000000-0000-4000-8000-000000000010',200,clock_timestamp()+interval '5 days','미래 적립 상계 검증',0);
reset role;
select 1/case when (private.store_credit_balance('92000000-0000-4000-8000-000000000010')->>'debt')::bigint=400 then 1 else 0 end as future_grant_offsets_award_debt;
select private.release_order_store_credits('92000000-0000-4000-8001-000000000020','92000000-0000-4000-8000-000000000010');
select 1/case when (private.store_credit_balance('92000000-0000-4000-8000-000000000010')->>'available')::bigint=200
 and (private.store_credit_balance('92000000-0000-4000-8000-000000000010')->>'debt')::bigint=0
 and (select total from public.orders where id='92000000-0000-4000-8001-000000000020')=9400
 and (select amount from public.payments where id='92000000-0000-4000-8002-000000000003')=10000 then 1 else 0 end as restore_only_repaid_part_and_preserve_payment_amounts;
update public.reviews set status='visible',hidden_reason=null,hidden_at=null,hidden_by=null where id=:'review_a';
set local role anon;
select 1/case when (public.get_review_event('92000000-0000-4000-8000-000000000101')->>'winnerTotal')::integer=0
 and public.get_review_event_disclosures(array[:'review_a'::uuid])#>>'{0,revoked}'='true' then 1 else 0 end as restoring_review_never_regrants_and_discloses_past_reward;
reset role;
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000008',true);
set local role authenticated;
select 1/case when jsonb_array_length(public.get_my_review_event_entries(array[:'review_a'::uuid,:'review_b'::uuid]))=1 then 1 else 0 end as my_entry_isolation;
reset role;
do $$ declare n integer;begin
 for n in 1..5 loop
  perform set_config('request.jwt.claim.sub',('92000000-0000-4000-8000-'||lpad(n::text,12,'0')),true);
  perform public.admin_get_review_event('92000000-0000-4000-8000-000000000101');
 end loop;
 for n in 6..8 loop
  perform set_config('request.jwt.claim.sub',('92000000-0000-4000-8000-'||lpad(n::text,12,'0')),true);
  perform pg_temp.review_event_error($q$select public.admin_get_review_event('92000000-0000-4000-8000-000000000101')$q$,'operator_capability_required');
 end loop;
end $$;
update public.profiles set suspended_at=now(),suspension_reason='합성 회수 검증' where id='92000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000002',true);
select pg_temp.review_event_error($q$select public.admin_list_review_events()$q$,'operator_capability_required');
select 1/case when not exists(select 1 from private.store_credit_lots where user_id::text like '92000000-0000-4000-8000-%'
 and issued_amount<>available_amount+reserved_amount+spent_amount+expired_amount+revoked_amount+offset_amount+transferred_amount) then 1 else 0 end as all_credit_lots_conserved;
rollback;
