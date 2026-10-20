\set ON_ERROR_STOP on
begin;
load 'safeupdate';
create function pg_temp.cc_id(kind text,n integer) returns uuid language sql immutable as $$select md5('claim-fees-sql:'||kind||':'||n)::uuid$$;
create function pg_temp.cc_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'claim contact assertion: %',label;end if;end$$;
create function pg_temp.cc_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;raise exception 'Expected claim contact rejection: %',expected;end$$;
create function pg_temp.cc_field(k text default 'k1') returns jsonb language sql immutable as $$select jsonb_build_object('v',1,'kid',k,'iv','AAAAAAAAAAAAAAAA','tag','AAAAAAAAAAAAAAAAAAAAAA','ct','YQ')$$;
create function pg_temp.cc_address() returns jsonb language sql immutable as $$select jsonb_build_object('recipientName',pg_temp.cc_field(),'phone',pg_temp.cc_field(),'postalCode',pg_temp.cc_field(),'address1',pg_temp.cc_field(),'address2',pg_temp.cc_field())$$;
create function pg_temp.cc_change(n integer,plan_n integer default null,noop boolean default false) returns jsonb language sql immutable as $$
 select jsonb_build_object('effect',case when noop then 'noop' else 'change' end,'changedFields',case when noop then '[]'::jsonb else '["recipientName"]'::jsonb end,
 'beforeAddressHmac',repeat('a',64),'afterAddressHmac',repeat(case when noop then 'a' else 'b' end,64),'addressHmacKeyVersion','k1',
 'plan',case when noop then null else jsonb_build_object('planId',pg_temp.cc_id('plan',coalesce(plan_n,n)),'piiVersion',pg_temp.cc_id('pii',n),'keyVersion','k1','addressHmac',repeat('b',64),'addressHmacKeyVersion','k1','address',pg_temp.cc_address()) end,
 'history',case when noop then null else jsonb_build_object('piiVersion',pg_temp.cc_id('history-pii',n),'keyVersion','k1','before',pg_temp.cc_address(),'after',pg_temp.cc_address(),'agreement',pg_temp.cc_field()) end)
$$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.cc_id('user',n),'authenticated','authenticated','claim-fees-sql-'||n||'@example.test',now(),'{}','{}' from generate_series(1,5)n;
update public.profiles set nickname='TEST contact '||right(id::text,8),role=case when id in(pg_temp.cc_id('user',1),pg_temp.cc_id('user',5)) then 'admin'::public.user_role else 'user'::public.user_role end where id in(select pg_temp.cc_id('user',n) from generate_series(1,5)n);
insert into auth.sessions(id,user_id,created_at,updated_at,aal,not_after) select pg_temp.cc_id('session',n),pg_temp.cc_id('user',n),now(),now(),'aal1',now()+interval '1 hour' from generate_series(1,5)n;
insert into private.operator_memberships(profile_id,manager_role) select pg_temp.cc_id('user',5),'owner' where not exists(select 1 from private.operator_memberships where manager_role='owner');
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.cc_id('user',1),'primary');
update private.operator_access_state set configured=true where id;
select pg_temp.cc_assert((select configured from private.operator_access_state where id) and(select count(*)=1 from private.operator_memberships where manager_role='owner'),'configured single owner');
insert into public.ips(id,title,vertical_key) values('cf-sql-ip','TEST Contact','character');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active) values(pg_temp.cc_id('origin',1),'cf-sql-origin','TEST Contact','hanjin',0,'TEST warehouse',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id) values('cf-sql-good','cf-sql-ip','TEST Contact Good','문구',1000,'ok',100,pg_temp.cc_id('origin',1));
insert into public.orders(id,user_id,status,total,shipping_fee,address,shipped_at,delivered_at)
 select pg_temp.cc_id('order',n),pg_temp.cc_id('user',2),'delivered',1000,0,
 jsonb_build_object('recipientName','원래 수령인','phone','010-1234-5678','postalCode',' 1234 ','address1',' 원본 기본 주소 ','address2','원래 상세'),now()-interval '45 days',now()-interval '44 days' from generate_series(1,18)n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.cc_id('item',n),pg_temp.cc_id('order',n),'cf-sql-good',(select id from public.goods_variants where good_id='cf-sql-good' and is_default),1,1000,'TEST Contact Good','문구','cf-sql-ip' from generate_series(1,18)n;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at)
 select pg_temp.cc_id('shipment',n),pg_temp.cc_id('order',n),pg_temp.cc_id('origin',1),'TEST Contact',0,'{}','delivered','hanjin','CONTACT'||lpad(n::text,8,'0'),now()-interval '45 days',now()-interval '44 days' from generate_series(1,18)n;
insert into public.order_shipment_items(shipment_id,order_id,order_item_id,qty) select pg_temp.cc_id('shipment',n),pg_temp.cc_id('order',n),pg_temp.cc_id('item',n),1 from generate_series(1,18)n;
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,collection_policy,collection_required)
 select pg_temp.cc_id('claim',n),pg_temp.cc_id('order',n),pg_temp.cc_id('user',2),'TEST contact','exchange','requested','legacy',false from generate_series(1,18)n;
-- Rollback-only policy and receiver account; no operating account is reused.
update private.claim_fee_policy set enabled=false,return_amount=null,exchange_amount=null,revision=1 where singleton;
update public.store_settings set bank_transfer='{"bank":"TEST BANK","accountNumber":"TEST-0000","holder":"TEST SHOP"}' where singleton;
create function pg_temp.cf_login(n integer) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cc_id('user',n),'role','authenticated','session_id',pg_temp.cc_id('session',n))::text,true)::text::void;
$$;
create function pg_temp.cf_issue(n integer,payer text default 'buyer') returns jsonb language sql as $$select jsonb_build_object('amount',3000,'payerRole',payer,'customerNote','TEST return delivery fee','evidence','TEST customer agreed payer and amount','confirmed',true)$$;
create function pg_temp.cf_change(n integer,op integer,kind text,invoice integer default null,p_values jsonb default null) returns jsonb language plpgsql as $$
declare d jsonb;begin
 d:=public.admin_get_claim_fees(pg_temp.cc_id('claim',n),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1));
 return public.admin_change_claim_fee(pg_temp.cc_id('claim',n),case when invoice is null then null else pg_temp.cc_id('fee_op',invoice) end,kind,coalesce(p_values,pg_temp.cf_issue(n)),
  (d->>'revision')::bigint,(d->>'claimRevision')::integer,pg_temp.cc_id('fee_op',op),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1));end $$;
select pg_temp.cf_login(1);
set local role authenticated;
select pg_temp.cc_assert(public.admin_get_claim_fee_policy()->>'enabled'='false','fee defaults disabled');
select pg_temp.cc_error('select pg_temp.cf_change(1,1,''issue'')','claim_fee_issue_blocked');
select public.admin_save_claim_fee_policy('{"enabled":true,"returnAmount":3000,"exchangeAmount":6000,"evidence":"TEST agreed policy","confirmed":true}',1,pg_temp.cc_id('fee_policy',1),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1));
create temp table cf_receipt(value jsonb);
insert into cf_receipt select pg_temp.cf_change(1,1,'issue');
select pg_temp.cc_assert((select value#>>'{invoices,0,state}'='unpaid' and value#>>'{invoices,0,amount}'='3000' from cf_receipt),'agreement issues unpaid fee');
select pg_temp.cc_assert(public.admin_change_claim_fee(pg_temp.cc_id('claim',1),null,'issue',pg_temp.cf_issue(1),0,0,pg_temp.cc_id('fee_op',1),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1))=(select value from cf_receipt),'same operation frozen receipt');
select pg_temp.cc_error('select pg_temp.cf_change(1,2,''issue'')','claim_fee_issue_blocked');
reset role;
select pg_temp.cc_assert((select count(*)=1 from private.claim_fee_invoices where claim_id=pg_temp.cc_id('claim',1)) and (select count(*)=1 from private.claim_fee_events where claim_id=pg_temp.cc_id('claim',1)),'one invoice and event');
select pg_temp.cf_login(2);
set local role authenticated;
select pg_temp.cc_assert(public.get_my_claim_fees(pg_temp.cc_id('claim',1),pg_temp.cc_id('user',2),pg_temp.cc_id('session',2))#>>'{invoices,0,agreementEvidence}'='','internal agreement hidden');
select pg_temp.cc_assert(public.get_my_claim_fees(pg_temp.cc_id('claim',1),pg_temp.cc_id('user',2),pg_temp.cc_id('session',2))->'policy'='null','policy hidden');
select public.report_my_claim_fee_payment(pg_temp.cc_id('claim',1),pg_temp.cc_id('fee_op',1),1,0,pg_temp.cc_id('fee_op',3),pg_temp.cc_id('user',2),pg_temp.cc_id('session',2));
select pg_temp.cc_error('select pg_temp.cf_change(1,4,''confirm_payment'',1,''{"amount":3000,"occurredAt":"2026-10-16T01:00:00Z","evidence":"TEST fake","confirmed":true}'')','42501');
reset role;
select pg_temp.cc_assert((select state='reported' and received_at is null from private.claim_fee_invoices where id=pg_temp.cc_id('fee_op',1)),'customer report is not received money');
select pg_temp.cf_login(1);
set local role authenticated;
select pg_temp.cc_error('select pg_temp.cf_change(1,4,''confirm_payment'',1,jsonb_build_object(''amount'',2000,''occurredAt'',clock_timestamp(),''evidence'',''TEST wrong amount'',''confirmed'',true))','claim_fee_amount_or_time');
select pg_temp.cf_change(1,4,'confirm_payment',1,jsonb_build_object('amount',3000,'occurredAt',clock_timestamp(),'evidence','TEST bank receipt ref only','confirmed',true));
select pg_temp.cc_assert(public.admin_get_claim_fees(pg_temp.cc_id('claim',1),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1))#>>'{invoices,0,state}'='paid','operator confirms actual amount');
select pg_temp.cf_change(1,5,'cancel',1,'{"evidence":"TEST cancel fee agreement","confirmed":true}');
select pg_temp.cc_assert(public.admin_get_claim_fees(pg_temp.cc_id('claim',1),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1))#>>'{invoices,0,state}'='refund_due','paid cancellation creates refund obligation');
select pg_temp.cf_change(1,6,'refund',1,jsonb_build_object('amount',3000,'occurredAt',clock_timestamp(),'evidence','TEST actual refund ref only','confirmed',true));
select pg_temp.cf_change(2,7,'issue');
select pg_temp.cf_change(2,8,'waive',7,'{"evidence":"TEST waived fee","confirmed":true}');
select pg_temp.cf_change(2,9,'confirm_payment',7,jsonb_build_object('amount',3000,'occurredAt',clock_timestamp(),'evidence','TEST unexpected late payment','confirmed',true));
select pg_temp.cc_assert(public.admin_get_claim_fees(pg_temp.cc_id('claim',2),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1))#>>'{invoices,0,state}'='refund_due','late payment on waived invoice requires return');
select pg_temp.cf_change(3,10,'issue');
select pg_temp.cf_change(4,11,'issue');
select pg_temp.cf_change(4,12,'confirm_payment',11,jsonb_build_object('amount',3000,'occurredAt',clock_timestamp(),'evidence','TEST bank receipt','confirmed',true));
reset role;
-- A changed basis cancels unpaid obligations and preserves a paid refund duty.
update public.order_cancellation_requests set reason='TEST changed request reason' where id in(pg_temp.cc_id('claim',3),pg_temp.cc_id('claim',4));
select pg_temp.cc_assert((select state='voided' from private.claim_fee_invoices where id=pg_temp.cc_id('fee_op',10)),'reason change cancels unpaid invoice');
select pg_temp.cc_assert((select state='refund_due' and received_at is not null from private.claim_fee_invoices where id=pg_temp.cc_id('fee_op',11)),'reason change cannot erase received funds');
select pg_temp.cc_assert(not exists(select 1 from public.refunds where cancellation_request_id in(select pg_temp.cc_id('claim',n) from generate_series(1,18)n))
 and (select bool_and(total=1000 and shipping_fee=0 and status='delivered') from public.orders where id in(select pg_temp.cc_id('order',n) from generate_series(1,18)n)),'no original money or fulfillment changes');
-- A gift payer sees only invoices addressed to them.
insert into private.gift_intents(id,sender_id,recipient_id,state,sender_label,recipient_label,expires_at,order_id,ordered_source_revision)
 values(pg_temp.cc_id('gift',9),pg_temp.cc_id('user',2),pg_temp.cc_id('user',3),'ordered','TEST sender','TEST recipient',now()+interval '1 day',pg_temp.cc_id('order',9),'1:synthetic');
update public.order_cancellation_requests set requested_by=pg_temp.cc_id('user',3) where id=pg_temp.cc_id('claim',9);
set local role authenticated;
select pg_temp.cf_change(9,13,'issue',null,pg_temp.cf_issue(9,'requester'));
reset role;
select pg_temp.cf_login(2);
set local role authenticated;
select pg_temp.cc_assert(public.get_my_claim_fees(pg_temp.cc_id('claim',9),pg_temp.cc_id('user',2),pg_temp.cc_id('session',2))->'invoices'='[]','gift sender cannot see recipient fee');
reset role;
select pg_temp.cf_login(3);
set local role authenticated;
select pg_temp.cc_assert(public.get_my_claim_fees(pg_temp.cc_id('claim',9),pg_temp.cc_id('user',3),pg_temp.cc_id('session',3))#>>'{invoices,0,amount}'='3000','gift recipient sees own fee');
select pg_temp.cc_error(format('select public.get_my_claim_fees(%L,%L,%L)',pg_temp.cc_id('claim',1),pg_temp.cc_id('user',3),pg_temp.cc_id('session',3)),'P0002');
reset role;
select pg_temp.cc_assert(not has_table_privilege('authenticated','private.claim_fee_invoices','select') and not has_function_privilege('authenticated','private.change_claim_fee(uuid,uuid,text,jsonb,bigint,integer,uuid,uuid,uuid,boolean)','execute'),'private fees sealed');

-- Historical claim fees remain discoverable even when a newer claim exists.
select pg_temp.cf_login(2);
set local role authenticated;
select pg_temp.cc_assert(public.get_my_order_claim_fees(pg_temp.cc_id('order',1),pg_temp.cc_id('user',2),pg_temp.cc_id('session',2))#>>'{0,invoices,0,state}'='refunded','order history includes completed invoice');
reset role;
select pg_temp.cf_login(1);
set local role authenticated;
select pg_temp.cc_assert(exists(select 1 from jsonb_array_elements(public.admin_list_claim_fees('refund_due',1)->'rows') r where r->>'id'=pg_temp.cc_id('fee_op',7)::text),'refund queue includes late payment');
reset role;
select pg_temp.cc_assert(private.claim_fee_account_blockers(pg_temp.cc_id('user',2))#>>'{0,code}'='active_claim_fee','open fee is deletion obligation');
-- Activate deletion only in this rollback transaction, using synthetic accounts.
update private.account_deletion_control set transaction_lookup_hmac_ready=true,legacy_transaction_evidence_ready=true,
 immutable_ticket_contract_ready=true,community_legal_records_ready=true,phase_one_enabled=true where singleton;
select pg_temp.cf_login(2);
set local role authenticated;
select public.request_my_account_deletion('회원 탈퇴를 신청합니다',pg_temp.cc_id('deletion',2));
reset role;
select pg_temp.cc_assert(exists(select 1 from private.account_deletion_legal_snapshots s join private.account_deletion_requests d on d.deletion_event_id=s.deletion_event_id
 where d.subject_user_id=pg_temp.cc_id('user',2) and s.record_type='claim_fee' and s.record_ref=pg_temp.cc_id('fee_op',1)::text
 and s.snapshot_data->>'amount'='3000' and s.snapshot_data::text!~'(bankAccount|accountNumber|agreementEvidence|sessionId|TEST customer|TEST BANK)'),'retained financial proof excludes private text and account');
select pg_temp.cf_login(1);
set local role authenticated;
select pg_temp.cc_error('select pg_temp.cf_change(5,14,''issue'')','claim_fee_issue_blocked');
select pg_temp.cf_change(2,15,'refund',7,jsonb_build_object('amount',3000,'occurredAt',clock_timestamp(),'evidence','TEST refund while payer deletion pending','confirmed',true));
select pg_temp.cc_assert(public.admin_get_claim_fees(pg_temp.cc_id('claim',2),pg_temp.cc_id('user',1),pg_temp.cc_id('session',1))#>>'{invoices,0,state}'='refunded','existing refund remains serviceable after payer fence');
reset role;
rollback;
