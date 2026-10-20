\set ON_ERROR_STOP on
select 1/case when current_database()~'^icons_(refund_account|goods_transaction)_[0-9a-f]{32}$'
 and exists(select 1 from private.operator_fixture_clone_identity where singleton and source_database='postgres'
  and replace(lease::text,'-','')=right(current_database(),32) and created_at>clock_timestamp()-interval '2 hours')
 then 1 else 0 end as assert_owned_refund_account_clone;
begin;
load 'safeupdate';
create function pg_temp.ra_id(kind text,n integer) returns uuid language sql immutable as $$select md5('claim-refund-account:'||kind||':'||n)::uuid$$;
create function pg_temp.ra_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected refund-account rejection: %',expected;end $$;
create function pg_temp.ra_auth(actor integer,session_number integer default null) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.ra_id('user',actor),
  'session_id',pg_temp.ra_id('session',coalesce(session_number,actor)))::text,true);
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.ra_id('user',n),'authenticated','authenticated','refund-account-'||n||'@example.test',clock_timestamp(),'{}','{}' from generate_series(1,3)n;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
 select pg_temp.ra_id('session',n),pg_temp.ra_id('user',case when n=4 then 1 else n end),clock_timestamp(),clock_timestamp(),
  case when n=4 then clock_timestamp()-interval '1 minute' else null end from generate_series(1,4)n;
update public.profiles set role='admin' where id=pg_temp.ra_id('user',3);
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.ra_id('user',3),'primary');
insert into public.orders(id,user_id,status,total,shipping_fee,address,payment_method)
 select pg_temp.ra_id('order',n),pg_temp.ra_id('user',1),case when n=14 then 'pending'::public.order_status when n=24 then 'canceled'::public.order_status else 'paid'::public.order_status end,
  13000,3000,'{"recipientName":"합성 고객","phone":"01000000000","postalCode":"12345","address1":"합성 검증 주소"}',
  (case when n=13 then 'card' else 'bank_transfer' end)::public.order_payment_method from generate_series(1,26)n;
insert into public.payments(id,user_id,provider,purpose,ref_id,amount,status,payment_key,idempotency_key)
 select pg_temp.ra_id('payment',n),pg_temp.ra_id('user',1),(case when n=13 then 'toss' else 'bank_transfer' end)::public.payment_provider,'order',pg_temp.ra_id('order',n),
  case when n=18 then 12000 else 13000 end,case when n=10 then 'refunded'::public.payment_status when n=14 then 'pending'::public.payment_status else 'paid'::public.payment_status end,
  case when n=13 then 'TEST-CARD-'||n else 'bank_transfer:'||pg_temp.ra_id('order',n) end,'refund-account-test-'||n
 from generate_series(1,26)n where n<>23;
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,status,held_from,hold_reason,collected_at,withdrawn_at,provider_started_at)
 select pg_temp.ra_id('claim',n),pg_temp.ra_id('order',n),pg_temp.ra_id('user',1),'합성 환불계좌 보완 검증',
  case when n=3 then 'exchange' when n in(2,7,8,16,17) then 'return' else 'cancel' end,
  stage,private.order_claim_status_for_stage(stage),case when n=8 then 'processing' else null end,
  case when n=8 then '합성 고객 요청 검토 보류' else null end,case when n=7 then clock_timestamp() else null end,
  case when n=6 then clock_timestamp() else null end,case when n=1 then clock_timestamp() else null end
 from (select n,case when n in(1,9,10,19,25,26) then 'processing' when n=4 then 'completed' when n=5 then 'rejected' when n=6 then 'withdrawn'
  when n=7 then 'collected' when n=8 then 'on_hold' when n=16 then 'needs_review' when n=17 then 'collecting' else 'requested' end stage from generate_series(1,26)n)fixtures;
insert into public.order_cancellation_claims(order_id,requested_by,previous_status)
 select pg_temp.ra_id('order',n),pg_temp.ra_id('user',1),'paid'::public.order_status from unnest(array[1,25,26])n;
-- Case 10 tests the refunded-payment blocker; it needs no completed bank refund
-- without the separate, mandatory transfer evidence lifecycle.
insert into public.refunds(id,payment_id,amount,status,cancellation_request_id,method,filed_at,handled_by)
 select pg_temp.ra_id('refund',n),pg_temp.ra_id('payment',n),13000,case when n=19 then 'failed' else 'requested' end,
  pg_temp.ra_id('claim',n),case when n=9 then 'bank_transfer' else null end,
  case when n=9 then clock_timestamp() else null end,case when n=9 then pg_temp.ra_id('user',3) else null end
 from unnest(array[1,9,19,25,26])n;
insert into private.claim_refund_accounts(claim_id,bank_name,account_number,account_holder,masked_account,masked_holder,purged_at)
 select pg_temp.ra_id('claim',n),case when n=11 then '기존은행' else null end,case when n=11 then '000000004321' else null end,
  case when n=11 then '기존합성고객' else null end,'기존은행 ********4321','기***객',case when n=12 then clock_timestamp() else null end from unnest(array[11,12])n;
insert into private.gift_intents(id,sender_id,recipient_id,state,sender_label,recipient_label,expires_at,order_id,ordered_source_revision)
 values(pg_temp.ra_id('gift',15),pg_temp.ra_id('user',1),pg_temp.ra_id('user',2),'ordered','합성 구매자','합성 수령인',clock_timestamp()+interval '1 day',pg_temp.ra_id('order',15),'test');
create function pg_temp.ra_context(n integer,actor integer default 1,session_number integer default 1) returns jsonb language sql as $$
 select public.get_my_order_claim_refund_account_context(pg_temp.ra_id('order',n),pg_temp.ra_id('claim',n),pg_temp.ra_id('user',actor),pg_temp.ra_id('session',session_number));
$$;
create function pg_temp.ra_save(n integer,operation integer,revision integer default 0,number text default '000000001234',actor integer default 1,session_number integer default 1) returns jsonb language sql as $$
 select public.set_my_order_claim_refund_account(pg_temp.ra_id('order',n),pg_temp.ra_id('claim',n),pg_temp.ra_id('operation',operation),revision,
  '합성은행',number,'합성구매자',pg_temp.ra_id('user',actor),pg_temp.ra_id('session',session_number));
$$;
create function pg_temp.ra_read(n integer,operation integer,revision integer default 0,seal boolean default false) returns jsonb language sql as $$
 select public.read_my_order_claim_refund_account_operation(pg_temp.ra_id('order',n),pg_temp.ra_id('claim',n),pg_temp.ra_id('operation',operation),revision,
  pg_temp.ra_id('user',1),pg_temp.ra_id('session',1),seal);
$$;
create temp table ra_orders_before as select to_jsonb(o) value from public.orders o;
create temp table ra_payments_before as select to_jsonb(p) value from public.payments p;
create temp table ra_refunds_before as select to_jsonb(r) value from public.refunds r;
create temp table ra_shipments_before as select to_jsonb(s) value from public.order_shipments s;
create temp table ra_stock_before as select id,stock_qty from public.goods;
commit;

begin read only;
set local role authenticated;
select pg_temp.ra_auth(1);
select 1/case when current_setting('transaction_read_only')='on' and pg_temp.ra_context(1)->>'allowed'='true'
 and pg_temp.ra_context(1)->>'stage'='processing' then 1 else 0 end as actual_stable_readonly_context;
select pg_temp.ra_auth(2);
select pg_temp.ra_error('select pg_temp.ra_context(1,2,2)','claim_not_found');
select pg_temp.ra_auth(3);
select pg_temp.ra_error('select pg_temp.ra_context(1,3,3)','claim_not_found');
rollback;

begin;
set local role authenticated;
select pg_temp.ra_auth(1);
select pg_temp.ra_error('select pg_temp.ra_save(1,1,0,''000000001234'',2,2)','42501');
select pg_temp.ra_auth(1,4);
select pg_temp.ra_error('select pg_temp.ra_save(1,1,0,''000000001234'',1,4)','42501');
select pg_temp.ra_auth(1);
select pg_temp.ra_error('select pg_temp.ra_save(1,1,0,''123'')','22023');
select pg_temp.ra_error('select pg_temp.ra_save(1,1,0,''--------'')','22023');
select pg_temp.ra_error('select pg_temp.ra_save(1,1,2)','PT409');
select pg_temp.ra_error('select pg_temp.ra_save(3,3)','refund_account_claim_closed');
select pg_temp.ra_error('select pg_temp.ra_save(4,4)','refund_account_claim_closed');
select pg_temp.ra_error('select pg_temp.ra_save(5,5)','refund_account_claim_closed');
select pg_temp.ra_error('select pg_temp.ra_save(6,6)','refund_account_claim_closed');
select pg_temp.ra_error('select pg_temp.ra_save(9,9)','refund_account_finance_started');
select pg_temp.ra_error('select pg_temp.ra_save(10,10)','refund_account_payment_unavailable');
select pg_temp.ra_error('select pg_temp.ra_save(11,11)','refund_account_already_recorded');
select pg_temp.ra_error('select pg_temp.ra_save(12,12)','refund_account_already_recorded');
select pg_temp.ra_error('select pg_temp.ra_save(13,13)','refund_account_payment_unavailable');
select pg_temp.ra_error('select pg_temp.ra_save(14,14)','refund_account_claim_closed');
select pg_temp.ra_error('select pg_temp.ra_save(15,15)','claim_not_found');
select pg_temp.ra_error('select pg_temp.ra_save(18,18)','refund_account_payment_unavailable');
select pg_temp.ra_error('select pg_temp.ra_save(19,19)','refund_account_finance_started');
select pg_temp.ra_error('select pg_temp.ra_save(23,23)','refund_account_payment_unavailable');
select pg_temp.ra_error('select pg_temp.ra_save(24,24)','refund_account_claim_closed');
select pg_temp.ra_save(1,1) as saved \gset
select 1/case when :'saved'::jsonb->>'state'='saved' and :'saved'::jsonb->>'resultRevision'='1'
 and pg_temp.ra_save(1,1)=:'saved'::jsonb and pg_temp.ra_read(1,1)=:'saved'::jsonb
 and pg_temp.ra_read(1,1,0,true)=:'saved'::jsonb then 1 else 0 end as exact_saved_receipt_replayed_after_cas_change;
select pg_temp.ra_error('select pg_temp.ra_save(1,1,0,''000000009999'')','23505');
select pg_temp.ra_error('select pg_temp.ra_save(1,101,0)','PT409');
select pg_temp.ra_error('select pg_temp.ra_save(1,101,1)','refund_account_already_recorded');
select pg_temp.ra_error('select pg_temp.ra_save(2,1)','23505');
select 1/case when pg_temp.ra_context(1)->>'allowed'='false'
 and pg_temp.ra_context(1)->>'maskedAccount' like '%1234'
 and pg_temp.ra_context(1)::text not like '%000000001234%'
 and not(pg_temp.ra_context(1)?'accountNumber') and not(:'saved'::jsonb?'requestHash') and not(:'saved'::jsonb?'sessionId')
 then 1 else 0 end as customer_projection_contains_only_masked_account;
select pg_temp.ra_save(n,n) from unnest(array[2,7,8,16,17])n;
select 1/case when pg_temp.ra_read(21,21) is null and pg_temp.ra_read(21,21,0,true)->>'state'='sealed'
 and pg_temp.ra_read(21,21,0,true)->>'state'='sealed' then 1 else 0 end as absent_operation_can_be_durably_sealed;
select pg_temp.ra_error('select pg_temp.ra_save(21,21)','refund_account_request_sealed');
select pg_temp.ra_save(21,211);
select pg_temp.ra_auth(2);
select pg_temp.ra_error('select pg_temp.ra_save(22,22,0,''000000001234'',2,2)','claim_not_found');
select pg_temp.ra_auth(3);
select pg_temp.ra_error('select pg_temp.ra_save(22,22,0,''000000001234'',3,3)','claim_not_found');
reset role;
select 1/case when (select count(*) from private.order_claim_refund_account_operations where actor_id=pg_temp.ra_id('user',1) and state='saved')=7
 and (select count(*) from public.audit_log where action='order.claim_refund_account_confirmed' and actor_id=pg_temp.ra_id('user',1))=7
 and not exists(select 1 from public.audit_log where action='order.claim_refund_account_confirmed' and diff::text~'(000000001234|합성은행|합성구매자|requestHash|sessionId)')
 and (select stage='processing' and provider_started_at is not null from public.order_cancellation_requests where id=pg_temp.ra_id('claim',1))
 then 1 else 0 end as one_account_and_pii_free_audit_per_operation;
select 1/case when not exists(select value from ra_orders_before except select to_jsonb(o) from public.orders o)
 and not exists(select value from ra_payments_before except select to_jsonb(p) from public.payments p)
 and not exists(select value from ra_refunds_before except select to_jsonb(r) from public.refunds r)
 and not exists(select value from ra_shipments_before except select to_jsonb(s) from public.order_shipments s)
 and not exists(select id,stock_qty from ra_stock_before except select id,stock_qty from public.goods)
 then 1 else 0 end as all_financial_shipping_stock_rows_unchanged;
-- A suspended/fenced customer still owns resolution of an existing transaction.
update public.profiles set suspended_at=clock_timestamp(),suspension_reason='TEST 기존 주문 해결 권한 검증' where id=pg_temp.ra_id('user',1);
set local role authenticated;
select pg_temp.ra_auth(1);
select pg_temp.ra_save(22,22);
reset role;
-- A normal rejection reaches the existing terminal retention trigger without
-- fabricating a completed bank transfer. The processing cancellation stays open.
set local role authenticated;
select pg_temp.ra_auth(1);
select pg_temp.ra_read(2,2) as retention_saved \gset
select pg_temp.ra_auth(3);
select public.admin_decide_order_claim(pg_temp.ra_id('claim',2),'reject','TEST 계좌 보관 기간을 검증하는 합성 반려 사유');
reset role;
select 1/case when (select stage='rejected' from public.order_cancellation_requests where id=pg_temp.ra_id('claim',2))
 and (select purge_after between now()+interval '29 days' and now()+interval '31 days' from private.claim_refund_accounts where claim_id=pg_temp.ra_id('claim',2))
 then 1 else 0 end as existing_terminal_account_retention_reused;
update private.claim_refund_accounts set purge_after=now()-interval '1 minute' where claim_id=pg_temp.ra_id('claim',2);
set local role service_role;
select public.purge_expired_claim_refund_accounts();
reset role;
select 1/case when (select account_number is null and bank_name is null and account_holder is null and purged_at is not null from private.claim_refund_accounts where claim_id=pg_temp.ra_id('claim',2))
 and (select request_hash is null and hash_purged_at is not null from private.order_claim_refund_account_operations where id=pg_temp.ra_id('operation',2))
 then 1 else 0 end as account_purge_also_removes_request_fingerprint;
set local role authenticated;
select pg_temp.ra_auth(1);
select 1/case when pg_temp.ra_read(2,2)=:'retention_saved'::jsonb then 1 else 0 end as historical_receipt_survives_account_purge;
select pg_temp.ra_error('select pg_temp.ra_save(2,2)','refund_account_request_expired');
reset role;
delete from auth.sessions where id=pg_temp.ra_id('session',1);
set local role authenticated;
select pg_temp.ra_error('select pg_temp.ra_read(1,1)','42501');
reset role;
select 1/case when not has_table_privilege('authenticated','private.order_claim_refund_account_operations','select,insert,update,delete')
 and not has_table_privilege('service_role','private.order_claim_refund_account_operations','select,insert,update,delete')
 and not has_function_privilege('anon','public.set_my_order_claim_refund_account(uuid,uuid,uuid,integer,text,text,text,uuid,uuid)','execute')
 and not has_function_privilege('service_role','public.set_my_order_claim_refund_account(uuid,uuid,uuid,integer,text,text,text,uuid,uuid)','execute')
 and not has_function_privilege('authenticated','private.order_claim_refund_account_receipt(uuid,uuid,uuid)','execute')
 then 1 else 0 end as account_operations_and_internal_helpers_are_sealed;
rollback;
