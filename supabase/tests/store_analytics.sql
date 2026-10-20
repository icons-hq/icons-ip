\set ON_ERROR_STOP on
begin;
create function pg_temp.analytics_id(n integer) returns uuid language sql immutable as $$select ('bfc02000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.analytics_expect(q text,expected text) returns void language plpgsql as $$
begin begin execute q;exception when others then if sqlerrm=expected or sqlstate=expected then return;end if;raise;end;raise exception 'Expected %',expected;end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 select pg_temp.analytics_id(n),'authenticated','authenticated','analytics-test-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,4)n;
update public.profiles set role=case when id in(pg_temp.analytics_id(1),pg_temp.analytics_id(4)) then 'staff'::public.user_role else 'user'::public.user_role end,
 nickname='analytics_'||right(id::text,2),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true,"marketing":false}' where id::text like 'bfc02000-%';
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.analytics_id(1),'primary'),(pg_temp.analytics_id(4),'deputy');
-- A synthetic KC reviewer has an explicit manager assignment; no legacy helper.
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values(('47c47700'||left(md5('analytics-test-good'),24))::uuid,'authenticated','authenticated','analytics-kc@example.test','{"testFixture":"goods-kc"}','{}',now(),now());
insert into private.operator_memberships(profile_id,manager_role) values(('47c47700'||left(md5('analytics-test-good'),24))::uuid,'primary');
insert into public.ips(id,title,vertical_key,published_at) select 'analytics-test-ip','방문 분석 합성 IP',key,now() from public.verticals limit 1;
insert into public.fulfillment_origins(id,code,name,base_fee,return_address,is_active)
 values(pg_temp.analytics_id(10),'analytics-origin','방문 분석 합성 출고지',0,'실제 주소가 아닌 합성 반송지',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
 values('analytics-test-good','analytics-test-ip','방문 분석 합성 상품','문구',1000,'ok',20,pg_temp.analytics_id(10));
select pg_temp.publish_goods_kc_fixture('analytics-test-good');
insert into private.marketing_links(id,token,source,original_target_id,original_title,good_id)
 values(pg_temp.analytics_id(11),repeat('a',32),'good','analytics-test-good','합성 링크','analytics-test-good');
select set_config('request.jwt.claim.sub',pg_temp.analytics_id(1)::text,true);
set local role authenticated;
select public.admin_store_analytics_report((now() at time zone 'Asia/Seoul')::date,(now() at time zone 'Asia/Seoul')::date) as before_report \gset
select 1/case when :'before_report'::jsonb#>'{summary,sessions}'='null'::jsonb and :'before_report'::jsonb#>'{collection,enabled}'='false'::jsonb then 1 else 0 end as never_measured_is_not_zero;
select pg_temp.analytics_expect($q$select public.start_store_analytics_session(repeat('1',64),'analytics-v1')$q$,'42501');
select set_config('request.jwt.claim.sub',pg_temp.analytics_id(4)::text,true);
select pg_temp.analytics_expect($q$select public.admin_store_analytics_report(current_date,current_date)$q$,'operator_capability_required');
reset role;
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select pg_temp.analytics_expect($q$select public.start_store_analytics_session(repeat('1',64),'analytics-v1')$q$,'analytics_disabled');
select public.set_store_analytics_collection(true,'analytics-v1');
select public.start_store_analytics_session(repeat('1',64),'analytics-v1');
select public.record_store_analytics_event(repeat('1',64),pg_temp.analytics_id(101),'good','analytics-test-good','social','instagram','social',repeat('a',32));
select public.record_store_analytics_event(repeat('1',64),pg_temp.analytics_id(101),'good','analytics-test-good','social','instagram','social',repeat('a',32)) as replay \gset
select 1/case when :'replay'::jsonb->>'replayed'='true' then 1 else 0 end as exact_event_replay;
select pg_temp.analytics_expect($q$select public.record_store_analytics_event(repeat('1',64),pg_temp.analytics_id(101),'home','home','direct','none','none')$q$,'analytics_event_conflict');
select pg_temp.analytics_expect($q$select public.record_store_analytics_event(repeat('1',64),pg_temp.analytics_id(102),'home','home','social','instagram','social',repeat('a',32))$q$,'analytics_link_target_mismatch');
select pg_temp.analytics_expect($q$select public.record_store_analytics_event(repeat('1',64),pg_temp.analytics_id(102),'good','no-public-good','direct','none','none')$q$,'analytics_page_unavailable');
select public.record_store_analytics_event(repeat('1',64),pg_temp.analytics_id(102),'home','home','internal','icons','internal');
select public.start_store_analytics_session(repeat('2',64),'analytics-v1');
select public.record_store_analytics_event(repeat('2',64),pg_temp.analytics_id(103),'home','home','direct','none','none');
reset role;
-- A real local order snapshot with no external provider call.
insert into public.orders(id,user_id,status,total,shipping_fee,address,created_at,expires_at,payment_method)
 values(pg_temp.analytics_id(201),pg_temp.analytics_id(2),'pending',1000,0,
 '{"recipientName":"합성 구매자","phone":"01000000000","postalCode":"00000","address1":"합성 배송지","address2":"검수 전용"}',clock_timestamp(),clock_timestamp()+interval '15 minutes','card');
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.analytics_id(202),pg_temp.analytics_id(201),'analytics-test-good',id,1,1000,'방문 분석 합성 상품','문구','analytics-test-ip' from public.goods_variants where good_id='analytics-test-good' and is_default;
set local role service_role;
select 1/case when public.bind_store_analytics_order(repeat('1',64),pg_temp.analytics_id(201),pg_temp.analytics_id(2)) then 1 else 0 end as own_order_bound;
select pg_temp.analytics_expect($q$select public.bind_store_analytics_order(repeat('1',64),pg_temp.analytics_id(201),pg_temp.analytics_id(3))$q$,'analytics_order_unavailable');
select pg_temp.analytics_expect($q$select public.bind_store_analytics_order(repeat('2',64),pg_temp.analytics_id(201),pg_temp.analytics_id(2))$q$,'analytics_order_binding_conflict');
select public.prepare_goods_payment_attempt(pg_temp.analytics_id(2),pg_temp.analytics_id(201),'toss') as attempt \gset
select public.bind_goods_payment_callback_nonce((:'attempt'::jsonb->>'id')::uuid,repeat('b',64));
select public.claim_goods_payment_attempt('toss',:'attempt'::jsonb->>'provider_order_id',repeat('b',64),pg_temp.analytics_id(203));
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',pg_temp.analytics_id(1)::text,true);
set local role authenticated;
select public.admin_store_analytics_report((now() at time zone 'Asia/Seoul')::date,(now() at time zone 'Asia/Seoul')::date) as pending_report \gset
select 1/case when :'pending_report'::jsonb#>>'{summary,sessions}'='2' and :'pending_report'::jsonb#>>'{summary,pageViews}'='3'
 and :'pending_report'::jsonb#>>'{summary,productViews}'='1' and :'pending_report'::jsonb#>>'{summary,orders}'='0' then 1 else 0 end as pending_is_not_conversion;
reset role;
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select public.finalize_goods_payment_attempt((:'attempt'::jsonb->>'id')::uuid,pg_temp.analytics_id(203),'approved','analytics-synthetic-payment',null,null,'TEST_APPROVED','CARD',null,clock_timestamp());
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select public.admin_store_analytics_report((now() at time zone 'Asia/Seoul')::date,(now() at time zone 'Asia/Seoul')::date,'link',pg_temp.analytics_id(11)::text) as paid_report \gset
select 1/case when :'paid_report'::jsonb#>>'{summary,sessions}'='1' and :'paid_report'::jsonb#>>'{summary,orders}'='1'
 and (:'paid_report'::jsonb#>>'{summary,conversionRate}')::numeric=100 and :'paid_report'::jsonb#>>'{summary,grossAmount}'='1000'
 and :'paid_report'::jsonb#>'{comparison,sessions}'='null'::jsonb and :'paid_report'::jsonb->'advertisingCost'='null'::jsonb then 1 else 0 end as finalizer_ledger_only_conversion;
select 1/case when public.admin_store_analytics_report((now() at time zone 'Asia/Seoul')::date,(now() at time zone 'Asia/Seoul')::date,p_query=>'소셜')->>'total'='1' then 1 else 0 end as localized_channel_search_matches_visible_label;
select 1/case when public.admin_store_analytics_report((now() at time zone 'Asia/Seoul')::date,(now() at time zone 'Asia/Seoul')::date,'good','analytics-test-good')#>'{summary,grossAmount}'='null'::jsonb then 1 else 0 end as no_invented_product_amount_allocation;
reset role;
-- Exercise the actual sealed cancellation finalizer and its refunded state.
-- Only synthetic local provider evidence is supplied; no external call occurs.
select public.finalize_order_cancellation_with_provider_evidence(pg_temp.analytics_id(201),'통계 합성 환불',array['analytics-synthetic-payment']);
select 1/case when (select status from public.payments where ref_id=pg_temp.analytics_id(201))='refunded' then 1 else 0 end as real_refunded_state;
set local role authenticated;
select public.admin_store_analytics_report((now() at time zone 'Asia/Seoul')::date,(now() at time zone 'Asia/Seoul')::date) as refund_report \gset
select 1/case when :'refund_report'::jsonb#>>'{summary,grossAmount}'='1000' and :'refund_report'::jsonb#>>'{summary,refundAmount}'='1000'
 and :'refund_report'::jsonb#>>'{summary,netAmount}'='0' and :'refund_report'::jsonb#>>'{summary,orders}'='1' then 1 else 0 end as gross_and_completed_refund_separate;
reset role;
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select public.revoke_store_analytics_session(repeat('1',64));
select pg_temp.analytics_expect($q$select public.record_store_analytics_event(repeat('1',64),pg_temp.analytics_id(104),'home','home','direct','none','none')$q$,'analytics_session_unavailable');
select 1/case when not public.bind_store_analytics_order(repeat('1',64),pg_temp.analytics_id(201),pg_temp.analytics_id(2)) then 1 else 0 end as withdrawn_session_cannot_attribute;
select public.process_store_analytics_retention();
reset role;
select 1/case when not exists(select 1 from private.store_analytics_order_bindings where order_id=pg_temp.analytics_id(201))
 and not exists(select 1 from private.store_analytics_sessions where token_hash=repeat('1',64))
 and (select count(*) from private.store_analytics_events)=1 then 1 else 0 end as raw_current_session_removed;
update private.store_analytics_sessions set last_seen_at=clock_timestamp()-interval '31 minutes' where token_hash=repeat('2',64);
set local role service_role;
select pg_temp.analytics_expect($q$select public.record_store_analytics_event(repeat('2',64),pg_temp.analytics_id(105),'home','home','direct','none','none')$q$,'analytics_session_expired');
reset role;
-- Public IP routes use public_slug, and the raw target is resolved to internal IP.
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub',pg_temp.analytics_id(1)::text,true);
set local role authenticated;
select public.admin_update_ip_identity('analytics-test-ip','analytics-public-ip','analytics-test-ip');
reset role;
select 1/case when private.store_analytics_page('ip','analytics-public-ip',clock_timestamp())->>'ipId'='analytics-test-ip'
 and private.store_analytics_page('ip','analytics-test-ip',clock_timestamp()) is null then 1 else 0 end as public_slug_resolves_internal_ip;
-- Session expiry and retention use server time; no client timestamp can revive one.
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select 1/case when public.store_analytics_session_status(repeat('2',64))->>'usable'='false' then 1 else 0 end as idle_session_status;
select public.start_store_analytics_session(repeat('3',64),'analytics-v1');
reset role;
update private.store_analytics_sessions set created_at=clock_timestamp()-interval '25 hours',last_seen_at=clock_timestamp() where token_hash=repeat('3',64);
set local role service_role;
select pg_temp.analytics_expect($q$select public.record_store_analytics_event(repeat('3',64),pg_temp.analytics_id(106),'home','home','direct','none','none')$q$,'analytics_session_expired');
reset role;
-- Deterministic old-day fixture represents already observed first-party traffic.
update private.store_analytics_settings set activated_at=(((clock_timestamp() at time zone 'Asia/Seoul')::date-91)::timestamp at time zone 'Asia/Seoul') where id;
insert into private.store_analytics_sessions(id,token_hash,notice_version,created_at,last_seen_at,event_count)
values(pg_temp.analytics_id(300),repeat('4',64),'analytics-v1',(((clock_timestamp() at time zone 'Asia/Seoul')::date-91)::timestamp at time zone 'Asia/Seoul')+interval '1 hour',(((clock_timestamp() at time zone 'Asia/Seoul')::date-91)::timestamp at time zone 'Asia/Seoul')+interval '1 hour',1);
insert into private.store_analytics_events(id,session_id,observed_at,page_kind,target_id,channel,source,medium,payload_hash)
values(pg_temp.analytics_id(301),pg_temp.analytics_id(300),(((clock_timestamp() at time zone 'Asia/Seoul')::date-91)::timestamp at time zone 'Asia/Seoul')+interval '1 hour','home','home','direct','none','none',repeat('0',64));
set local role service_role;
select public.process_store_analytics_retention();
reset role;
select 1/case when not exists(select 1 from private.store_analytics_sessions where id=pg_temp.analytics_id(300))
 and not exists(select 1 from private.store_analytics_events where id=pg_temp.analytics_id(301))
 and (select sessions from private.store_analytics_daily where day=(clock_timestamp() at time zone 'Asia/Seoul')::date-91 and dimension='total')=1
 then 1 else 0 end as raw_identifiers_removed_aggregate_retained;
select 1/case when private.store_analytics_day_coverage((clock_timestamp() at time zone 'Asia/Seoul')::date-91,clock_timestamp())->>'archived'='true'
 and private.store_analytics_day_coverage(((clock_timestamp() at time zone 'Asia/Seoul')::date-interval '14 months')::date,clock_timestamp())->>'state'='expired'
 then 1 else 0 end as archived_and_expired_are_explicit;
set local role service_role;
select public.start_store_analytics_session(repeat('5',64),'analytics-v1');
reset role;
insert into private.store_analytics_rate_buckets(bucket,scope,requests)
select date_trunc('minute',clock_timestamp()),'session:'||id::text,120 from private.store_analytics_sessions where token_hash=repeat('5',64);
set local role service_role;
select pg_temp.analytics_expect($q$select public.record_store_analytics_event(repeat('5',64),pg_temp.analytics_id(107),'home','home','direct','none','none')$q$,'analytics_rate_limited');
reset role;
select 1/case when not exists(select 1 from private.store_analytics_events where id=pg_temp.analytics_id(107)) then 1 else 0 end as rate_rejection_has_no_partial_event;
-- Supported bank transfers use an operator confirmation plus the common finalizer.
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select public.start_store_analytics_session(repeat('6',64),'analytics-v1');
select public.record_store_analytics_event(repeat('6',64),pg_temp.analytics_id(400),'good','analytics-test-good','direct','none','none');
reset role;
insert into public.orders(id,user_id,status,total,shipping_fee,address,created_at,expires_at,payment_method)
select pg_temp.analytics_id(n),pg_temp.analytics_id(2),'pending',1000,0,
 '{"recipientName":"합성 구매자","phone":"01000000000","postalCode":"00000","address1":"합성 배송지"}',clock_timestamp(),clock_timestamp()+interval '24 hours','bank_transfer' from unnest(array[401,403])n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select pg_temp.analytics_id(n+1),pg_temp.analytics_id(n),'analytics-test-good',v.id,1,1000,'방문 분석 합성 상품','문구','analytics-test-ip'
 from unnest(array[401,403])n cross join public.goods_variants v where v.good_id='analytics-test-good' and v.is_default;
set local role service_role;
select public.prepare_goods_payment_attempt(pg_temp.analytics_id(2),pg_temp.analytics_id(401),'bank_transfer');
select public.prepare_goods_payment_attempt(pg_temp.analytics_id(2),pg_temp.analytics_id(403),'bank_transfer');
select 1/case when public.bind_store_analytics_order(repeat('6',64),pg_temp.analytics_id(401),pg_temp.analytics_id(2))
 and public.bind_store_analytics_order(repeat('6',64),pg_temp.analytics_id(403),pg_temp.analytics_id(2)) then 1 else 0 end as bank_orders_bound_at_creation;
reset role;
-- This rollback-only test has one transaction. Deposit confirmation uses now(),
-- so model the earlier visit/order transaction explicitly with prior timestamps.
update private.store_analytics_sessions set created_at=now()-interval '40 seconds',last_seen_at=now()-interval '20 seconds' where token_hash=repeat('6',64);
update private.store_analytics_events set observed_at=now()-interval '30 seconds' where id=pg_temp.analytics_id(400);
update public.orders set created_at=now()-interval '20 seconds' where id in(pg_temp.analytics_id(401),pg_temp.analytics_id(403));
update private.store_analytics_order_bindings set bound_at=now()-interval '10 seconds' where order_id in(pg_temp.analytics_id(401),pg_temp.analytics_id(403));
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select 1/case when public.admin_store_analytics_report((now() at time zone 'Asia/Seoul')::date,(now() at time zone 'Asia/Seoul')::date)#>>'{summary,orders}'='0' then 1 else 0 end as unpaid_bank_order_not_conversion;
select 1/case when public.admin_confirm_bank_transfer_deposit(pg_temp.analytics_id(401),'합성 통계 입금 확인')='approved' then 1 else 0 end as actual_deposit_finalizer_approved;
select 1/case when public.admin_store_analytics_report((now() at time zone 'Asia/Seoul')::date,(now() at time zone 'Asia/Seoul')::date)#>>'{summary,orders}'='1'
 and public.admin_store_analytics_report((now() at time zone 'Asia/Seoul')::date,(now() at time zone 'Asia/Seoul')::date)#>>'{summary,grossAmount}'='1000' then 1 else 0 end as deposit_confirmation_is_conversion;
reset role;
-- A confirmation record alone is not enough when finalization needs review.
update public.orders set total=2000 where id=pg_temp.analytics_id(403);
set local role authenticated;
select 1/case when public.admin_confirm_bank_transfer_deposit(pg_temp.analytics_id(403),'합성 금액 불일치 확인')='needs_review' then 1 else 0 end as deposit_needs_review;
reset role;
select 1/case when exists(select 1 from public.bank_transfer_confirmations where order_id=pg_temp.analytics_id(403))
 and not exists(select 1 from private.store_analytics_paid_orders(((now() at time zone 'Asia/Seoul')::date)::timestamp at time zone 'Asia/Seoul',clock_timestamp()+interval '1 day') where order_id=pg_temp.analytics_id(403)) then 1 else 0 end as needs_review_confirmation_not_conversion;
select pg_temp.analytics_expect($q$select public.finalize_order_cancellation_with_provider_evidence(pg_temp.analytics_id(401),'합성 무통장 환급 완료',array[(select payment_key from public.payments where ref_id=pg_temp.analytics_id(401))])$q$,'bank_refund_operator_evidence_required');
-- Complete the synthetic bank refund through the current operator evidence API.
select 1/case when exists(select 1 from public.orders o join public.payments p on p.ref_id=o.id and p.purpose='order'
 where o.id=pg_temp.analytics_id(401) and o.status='paid' and o.payment_method='bank_transfer'
 and o.total=1000 and p.provider='bank_transfer' and p.status='paid' and p.amount=o.total)
 and not exists(select 1 from private.bank_transfer_claim_refunds where order_id=pg_temp.analytics_id(401))
 then 1 else 0 end as bank_refund_preconditions_valid_without_operator_evidence;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
 values(pg_temp.analytics_id(410),pg_temp.analytics_id(1),clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '1 hour');
select set_config('request.jwt.claim.sub',pg_temp.analytics_id(1)::text,true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.analytics_id(1),'role','authenticated','session_id',pg_temp.analytics_id(410))::text,true);
create function pg_temp.analytics_bank_refund_step(kind text,operation_number integer) returns jsonb language plpgsql as $$
declare context jsonb;blocker text;begin
 context:=public.admin_bank_transfer_refund_context(pg_temp.analytics_id(401),pg_temp.analytics_id(411),pg_temp.analytics_id(1),pg_temp.analytics_id(410));
 blocker:=context->>case kind when 'confirm_cancellation' then 'confirmBlocker' when 'file_transfer' then 'fileBlocker' else 'completeBlocker' end;
 if blocker is not null or (context->>'amount')::integer<>1000 then raise exception 'Unexpected analytics bank refund context: %',blocker;end if;
 return public.admin_record_bank_transfer_refund(pg_temp.analytics_id(401),pg_temp.analytics_id(411),pg_temp.analytics_id(operation_number),kind,
  (context->>'revision')::integer,1000,clock_timestamp(),'TEST 통계 합성 금융 증빙','TEST 실제 송금 없는 통계 검증',true,pg_temp.analytics_id(1),pg_temp.analytics_id(410));
end $$;
set local role authenticated;
select public.admin_submit_seller_claim_intake(pg_temp.analytics_id(411),jsonb_build_object(
 'orderId',pg_temp.analytics_id(401),'claimType','cancel','reasonType','change_of_mind','reason','TEST 통계 합성 취소','source','phone','inquiryId',null,
 'customerRequestedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'agreementEvidence','TEST 합성 고객 동의 기록','agreementConfirmed',true,'collectionAddress',null,'collections','[]'::jsonb),
 '{"bankName":"TEST 합성은행","accountNumber":"000000001234","accountHolder":"TEST 합성구매자"}'::jsonb);
select 1/case when public.admin_decide_order_claim(pg_temp.analytics_id(411),'approve',null)='processing' then 1 else 0 end as bank_refund_claim_approved;
select pg_temp.analytics_bank_refund_step('confirm_cancellation',412);
reset role;
select 1/case when (select status='canceled' from public.orders where id=pg_temp.analytics_id(401))
 and (select status='paid' from public.payments where ref_id=pg_temp.analytics_id(401) and purpose='order')
 and (select status='awaiting_transfer' and completed_at is null from public.refunds where cancellation_request_id=pg_temp.analytics_id(411))
 then 1 else 0 end as bank_cancellation_is_not_completed_transfer;
set local role authenticated;
select public.admin_store_analytics_report((now() at time zone 'Asia/Seoul')::date,(now() at time zone 'Asia/Seoul')::date) as bank_confirm_pending_report \gset
select 1/case when :'bank_confirm_pending_report'::jsonb#>>'{summary,orders}'='1' and :'bank_confirm_pending_report'::jsonb#>>'{summary,grossAmount}'='1000'
 and :'bank_confirm_pending_report'::jsonb#>>'{summary,refundAmount}'='0' and :'bank_confirm_pending_report'::jsonb#>>'{summary,netAmount}'='1000' then 1 else 0 end as bank_confirm_does_not_count_as_refund;
reset role;
set local role authenticated;
select pg_temp.analytics_bank_refund_step('file_transfer',413);
reset role;
select 1/case when (select status='awaiting_transfer' and filed_at is not null and completed_at is null from public.refunds where cancellation_request_id=pg_temp.analytics_id(411))
 then 1 else 0 end as bank_filing_is_not_completed_transfer;
set local role authenticated;
select public.admin_store_analytics_report((now() at time zone 'Asia/Seoul')::date,(now() at time zone 'Asia/Seoul')::date) as bank_file_pending_report \gset
select 1/case when :'bank_file_pending_report'::jsonb#>>'{summary,orders}'='1' and :'bank_file_pending_report'::jsonb#>>'{summary,grossAmount}'='1000'
 and :'bank_file_pending_report'::jsonb#>>'{summary,refundAmount}'='0' and :'bank_file_pending_report'::jsonb#>>'{summary,netAmount}'='1000' then 1 else 0 end as bank_file_does_not_count_as_refund;
reset role;
set local role authenticated;
select pg_temp.analytics_bank_refund_step('complete_transfer',414);
reset role;
select 1/case when (select status='refunded' from public.payments where ref_id=pg_temp.analytics_id(401) and purpose='order')
 and (select status='done' and completed_at is not null from public.refunds where cancellation_request_id=pg_temp.analytics_id(411))
 and (select stage='completed' from public.order_cancellation_requests where id=pg_temp.analytics_id(411))
 then 1 else 0 end as bank_transfer_completion_has_durable_evidence;
set local role authenticated;
select public.admin_store_analytics_report((now() at time zone 'Asia/Seoul')::date,(now() at time zone 'Asia/Seoul')::date) as bank_refund_report \gset
select 1/case when :'bank_refund_report'::jsonb#>>'{summary,orders}'='1' and :'bank_refund_report'::jsonb#>>'{summary,grossAmount}'='1000'
 and :'bank_refund_report'::jsonb#>>'{summary,refundAmount}'='1000' and :'bank_refund_report'::jsonb#>>'{summary,netAmount}'='0' then 1 else 0 end as bank_refund_preserves_gross;
reset role;
select 1/case when not has_function_privilege('authenticated','public.record_store_analytics_event(text,uuid,text,text,text,text,text,text)','execute')
 and not has_table_privilege('service_role','private.store_analytics_events','select')
 and not has_function_privilege('service_role','private.store_analytics_paid_orders(timestamptz,timestamptz)','execute') then 1 else 0 end as sealed_raw_data;
rollback;
