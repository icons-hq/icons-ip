\set ON_ERROR_STOP on
begin;
create function pg_temp.demographic_error(q text,wanted text) returns void language plpgsql as $$begin
 begin execute q; exception when others then if position(wanted in sqlerrm)>0 then return; end if; raise; end;
 raise exception 'Expected error %',wanted;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('a6191000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
  'demographics-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(0,20)n;
update public.profiles set nickname='TEST 집계'||right(id::text,4),
 role=(case when id='a6191000-0000-4000-8000-000000000000' then 'admin' else 'user' end)::public.user_role,
 birth_date=((now() at time zone 'Asia/Seoul')::date-case when right(id::text,12)::integer<=10 then interval '22 years' else interval '27 years' end)::date,
 onboarded_at=now(),consents='{"terms":true,"privacy":true,"marketing":false}' where id::text like 'a6191000-%';
insert into private.operator_memberships(profile_id,manager_role) values('a6191000-0000-4000-8000-000000000000','primary');
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
 select ('a6191000-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,('a6191000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 now(),now(),now()+interval '1 hour' from generate_series(0,20)n;
create function pg_temp.demographic_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','a6191000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','a6191000-0000-4000-8000-'||lpad(n::text,12,'0'),
  'role','authenticated','session_id','a6191000-0000-4000-9000-'||lpad(n::text,12,'0'))::text,true);
end $$;
select pg_temp.demographic_actor(1); set local role authenticated;
select 1/case when public.customer_demographic_state()->>'choice'='unset' and public.customer_demographic_state()->'gender'='null'::jsonb then 1 else 0 end as initial_no_gender;
select pg_temp.demographic_error($q$select public.set_customer_demographic_consent('accepted',null,0,'a6191000-0000-4000-8000-000000000001','a6191000-0000-4000-9000-000000000001','customer-demographics-v1')$q$,'invalid_customer_demographic_choice');
select pg_temp.demographic_error($q$select public.set_customer_demographic_consent('accepted','female',0,'a6191000-0000-4000-8000-000000000002','a6191000-0000-4000-9000-000000000001','customer-demographics-v1')$q$,'member_activity_auth_changed');
select pg_temp.demographic_error($q$select public.set_customer_demographic_consent('accepted','female',0,'a6191000-0000-4000-8000-000000000001','a6191000-0000-4000-9000-000000000001','old-version')$q$,'invalid_customer_demographic_choice');
select public.set_customer_demographic_consent('accepted','female',0,'a6191000-0000-4000-8000-000000000001','a6191000-0000-4000-9000-000000000001','customer-demographics-v1') as accepted \gset
select 1/case when public.set_customer_demographic_consent('accepted','female',0,'a6191000-0000-4000-8000-000000000001','a6191000-0000-4000-9000-000000000001','customer-demographics-v1')=:'accepted'::jsonb then 1 else 0 end as duplicate_converges;
select pg_temp.demographic_error($q$select public.admin_customer_demographic_report('members',null,null,null)$q$,'operator_capability_required');
reset role;
insert into private.customer_demographic_consents(user_id,choice,gender,notice_version,revision,accepted_at)
 select ('a6191000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'accepted',case when n<=10 then 'female' else 'male' end,
 'customer-demographics-v1',1,now() from generate_series(2,19)n;
select pg_temp.demographic_actor(0); set local role authenticated;
select public.admin_customer_demographic_report('members',null,null,null) as report \gset
select 1/case when jsonb_path_query_first(:'report'::jsonb,'$.cells[*] ? (@.ageBand == "20_24" && @.gender == "female").count')='10'::jsonb
 and jsonb_path_query_first(:'report'::jsonb,'$.cells[*] ? (@.ageBand == "25_29" && @.gender == "male").count')='null'::jsonb
 and not exists(select 1 from jsonb_array_elements(:'report'::jsonb->'cells') c where jsonb_typeof(c->'count')='number' and (c->>'count')::integer<10)
 and not (:'report'::jsonb ?| array['total','rawCount','users','percentage']) then 1 else 0 end as ten_shown_nine_and_zero_hidden;
select pg_temp.demographic_error($q$select public.admin_customer_demographic_report('members','day',null,null)$q$,'invalid_customer_demographic_range');
select pg_temp.demographic_error($q$select public.admin_customer_demographic_report('purchasers','day','2026-01-01','2026-01-02')$q$,'invalid_customer_demographic_range');
select pg_temp.demographic_error($q$select public.admin_customer_demographic_report('purchasers','month','2026-01-02','2026-01-31')$q$,'invalid_customer_demographic_range');
reset role;
-- Proven prior-month payments, including a duplicate refunded order. No
-- demographic profile is captured in the immutable payment/order ledgers.
update private.customer_demographic_consents set accepted_at=now()-interval '90 days' where user_id::text like 'a6191000-%';
insert into public.ips(id,title,vertical_key) values('demographic-test-ip','TEST 집계 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('demographic-test-good','demographic-test-ip','TEST 집계 상품','문구',1000,'ok',100);
insert into public.orders(id,user_id,status,total,shipping_fee,created_at,payment_method)
 select ('a6191000-0000-4002-8000-'||lpad(n::text,12,'0'))::uuid,
 ('a6191000-0000-4000-8000-'||lpad((case when n=11 then 1 else n end)::text,12,'0'))::uuid,
 case when n=11 then 'canceled'::public.order_status else 'paid'::public.order_status end,1000,0,now()-interval '45 days','card' from generate_series(1,11)n;
insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select ('a6191000-0000-4002-8000-'||lpad(n::text,12,'0'))::uuid,g.id,v.id,1,1000,g.name,g.type,g.ip_id
 from generate_series(1,11)n cross join public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default where g.id='demographic-test-good';
insert into public.payments(id,user_id,purpose,ref_id,amount,status,payment_key,idempotency_key,provider)
 select ('a6191000-0000-4003-8000-'||lpad(n::text,12,'0'))::uuid,
 ('a6191000-0000-4000-8000-'||lpad((case when n=11 then 1 else n end)::text,12,'0'))::uuid,'order',
 ('a6191000-0000-4002-8000-'||lpad(n::text,12,'0'))::uuid,1000,
 case when n=11 then 'refunded'::public.payment_status else 'paid'::public.payment_status end,'demographic-payment-'||n,'demographic-pay-key-'||n,'toss' from generate_series(1,11)n;
insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,currency,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 select ('a6191000-0000-4004-8000-'||lpad(n::text,12,'0'))::uuid,'toss',
 ('a6191000-0000-4000-8000-'||lpad((case when n=11 then 1 else n end)::text,12,'0'))::uuid,'order',
 ('a6191000-0000-4002-8000-'||lpad(n::text,12,'0'))::uuid,1000,'KRW','approved','demographic-attempt-key-'||n,'demographic-provider-order-'||n,'demographic-provider-product-'||n,
 ('a6191000-0000-4003-8000-'||lpad(n::text,12,'0'))::uuid,now()+interval '1 day' from generate_series(1,11)n;
insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,provider_payment_key,provider_transaction_id,approved_at)
 select ('a6191000-0000-4004-8000-'||lpad(n::text,12,'0'))::uuid,'confirm_approved','demographic-payment-'||n,'demographic-provider-evidence-'||n,
 (date_trunc('month',now() at time zone 'Asia/Seoul')-interval '1 month'+interval '14 days') at time zone 'Asia/Seoul' from generate_series(1,11)n;
select (date_trunc('month',now() at time zone 'Asia/Seoul')-interval '1 month')::date as purchase_from,
 (date_trunc('month',now() at time zone 'Asia/Seoul')-interval '1 day')::date as purchase_to \gset
select pg_temp.demographic_actor(0);set local role authenticated;
select 1/case when jsonb_path_query_first(public.admin_customer_demographic_report('purchasers','month',:'purchase_from',:'purchase_to'),
 '$.cells[*] ? (@.ageBand == "20_24" && @.gender == "female").count')='10'::jsonb then 1 else 0 end as proven_payment_customers_deduplicated;
reset role;
update private.customer_demographic_consents set accepted_at=now() where user_id='a6191000-0000-4000-8000-000000000010';
set local role authenticated;
select 1/case when jsonb_path_query_first(public.admin_customer_demographic_report('purchasers','month',:'purchase_from',:'purchase_to'),
 '$.cells[*] ? (@.ageBand == "20_24" && @.gender == "female").count')='null'::jsonb then 1 else 0 end as no_gender_backfill_before_consent;
reset role;
update private.customer_demographic_consents set accepted_at=now()-interval '90 days' where user_id='a6191000-0000-4000-8000-000000000010';
reset role;select pg_temp.demographic_actor(1);set local role authenticated;
select public.set_customer_demographic_consent('declined',null,1,'a6191000-0000-4000-8000-000000000001','a6191000-0000-4000-9000-000000000001','customer-demographics-v1');
select pg_temp.demographic_error($q$select public.set_customer_demographic_consent('accepted','female',0,'a6191000-0000-4000-8000-000000000001','a6191000-0000-4000-9000-000000000001','customer-demographics-v1')$q$,'customer_demographic_choice_changed');
reset role;
select 1/case when (select gender is null and accepted_at is null and revision=2 from private.customer_demographic_consents where user_id='a6191000-0000-4000-8000-000000000001')
 and not exists(select 1 from private.member_activity_consents where user_id='a6191000-0000-4000-8000-000000000001') then 1 else 0 end as withdrawal_erases_and_consents_separate;
select pg_temp.demographic_actor(0);set local role authenticated;
select 1/case when jsonb_path_query_first(public.admin_customer_demographic_report('members',null,null,null),
 '$.cells[*] ? (@.ageBand == "20_24" && @.gender == "female").count')='null'::jsonb then 1 else 0 end as withdrawal_hides_nine;
reset role;
select 1/case when not has_table_privilege('authenticated','private.customer_demographic_consents','select,insert,update,delete')
 and not has_table_privilege('service_role','private.customer_demographic_consents','select,insert,update,delete')
 and not has_function_privilege('anon','public.customer_demographic_state()','execute')
 and not has_function_privilege('service_role','public.set_customer_demographic_consent(text,text,bigint,uuid,uuid,text)','execute')
 and not has_function_privilege('authenticated','private.erase_fenced_customer_demographics()','execute') then 1 else 0 end as sealed_roles;
insert into private.account_deletion_requests(deletion_event_id,subject_user_id,idempotency_key,status)
 values('a6191000-0000-4001-8000-000000000001','a6191000-0000-4000-8000-000000000002','a6191000-0000-4001-8000-000000000002','awaiting_email_intent');
insert into private.account_action_fences(subject_user_id,deletion_event_id)
 values('a6191000-0000-4000-8000-000000000002','a6191000-0000-4001-8000-000000000001');
select 1/case when (select choice='declined' and gender is null and accepted_at is null from private.customer_demographic_consents
 where user_id='a6191000-0000-4000-8000-000000000002') then 1 else 0 end as deletion_fence_erases_gender;
select pg_temp.demographic_actor(2);set local role authenticated;
select 1/case when public.customer_demographic_state() is null then 1 else 0 end as fenced_state_unavailable;
select pg_temp.demographic_error($q$select public.set_customer_demographic_consent('accepted','male',2,'a6191000-0000-4000-8000-000000000002','a6191000-0000-4000-9000-000000000002','customer-demographics-v1')$q$,'member_activity_unavailable');
reset role;
-- Forty full cells with exactly one small remainder exercise secondary
-- suppression independently of all-empty or broadly sparse data.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select ('a6192000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',
 'demographic-secondary-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,399)n;
update public.profiles set nickname='TEST 보조 집계'||right(id::text,4),
 birth_date=((now() at time zone 'Asia/Seoul')::date-make_interval(years=>17+5*((right(id::text,12)::integer-1)/40)))::date,
 onboarded_at=now(),consents='{"terms":true,"privacy":true}' where id::text like 'a6192000-%';
insert into private.customer_demographic_consents(user_id,choice,gender,notice_version,revision,accepted_at)
 select ('a6192000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'accepted',(array['female','male','other'])[1+((n-1)/10)%4],
 'customer-demographics-v1',1,now() from generate_series(1,399)n where ((n-1)/10)%4<3;
select pg_temp.demographic_actor(0);set local role authenticated;
select 1/case when (select count(*) from jsonb_array_elements(public.admin_customer_demographic_report('members',null,null,null)->'cells') c where c->'count'='null'::jsonb)=2 then 1 else 0 end as single_remainder_gets_secondary_suppression;
reset role;
rollback;
