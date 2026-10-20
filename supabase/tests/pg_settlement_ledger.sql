\set ON_ERROR_STOP on
begin;
load 'safeupdate';
create function pg_temp.settlement_id(kind text,n integer) returns uuid language sql immutable as $$select md5('pg-settlement:'||kind||':'||n)::uuid$$;
create function pg_temp.settlement_expect(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected settlement error: %',expected;end $$;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.settlement_id('actor',n),'authenticated','authenticated','pg-settlement-'||n||'@example.test','{}','{}' from generate_series(1,4)n;
update public.profiles set role='staff' where id in(select pg_temp.settlement_id('actor',n)from generate_series(1,3)n);
insert into private.operator_memberships(profile_id,manager_role)
 values(pg_temp.settlement_id('actor',1),'primary'),(pg_temp.settlement_id('actor',2),'primary'),(pg_temp.settlement_id('actor',3),'logistics');
insert into public.orders(id,user_id,status,total,address) values(pg_temp.settlement_id('order',1),pg_temp.settlement_id('actor',4),'paid',101,'{"recipientName":"합성 고객","phone":"01000000000","postalCode":"12345","address1":"합성시 검증로 1"}');
insert into public.payments(id,user_id,purpose,ref_id,amount,status,payment_key,idempotency_key,provider)
 values(pg_temp.settlement_id('payment',1),pg_temp.settlement_id('actor',4),'order',pg_temp.settlement_id('order',1),101,'paid','settlement-payment-1','settlement-idempotency-1','toss');
insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,currency,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 values(pg_temp.settlement_id('attempt',1),'toss',pg_temp.settlement_id('actor',4),'order',pg_temp.settlement_id('order',1),101,'KRW','approved',
 'settlement-attempt-1','settlement-order-1','settlement-product-1',pg_temp.settlement_id('payment',1),now()+interval '1 day');
insert into private.payment_provider_evidence(payment_attempt_id,evidence_kind,provider_payment_key,provider_transaction_id,approved_at)
 values(pg_temp.settlement_id('attempt',1),'confirm_approved','settlement-payment-1','settlement-approve-1',now());
create function pg_temp.settlement_query()returns jsonb language sql immutable as $$select '{"dateType":"soldDate","startDate":"2026-10-01","endDate":"2026-10-02"}'::jsonb$$;
create function pg_temp.settlement_record(key text default 'settlement-approve-1',amount text default '101')returns jsonb language sql immutable as $$
 select jsonb_build_object('mId','syntheticmid','paymentKey','settlement-payment-1','transactionKey',key,'orderId','settlement-order-1',
 'currency','KRW','method','카드','amount',amount,'interestFee','0.1','fees','[{"type":"BASE","fee":"0.2"},{"type":"ETC","fee":"0.01"}]'::jsonb,
 'supplyAmount','0.21','vat','0.021','payOutAmount','100.769','approvedAt','2026-10-01T12:00:00+09:00','soldDate','2026-10-01','paidOutDate','2026-10-02','cancel',null);
$$;
create function pg_temp.settlement_page(records jsonb,page integer default 1,source_keys jsonb default null)returns jsonb language sql immutable as $$
 select jsonb_build_object('records',records,'page',page,'sourceCount',jsonb_array_length(coalesce(source_keys,(select coalesce(jsonb_agg(x->'transactionKey'),'[]'::jsonb)from jsonb_array_elements(records)x))),
 'sourceTransactionKeys',coalesce(source_keys,(select coalesce(jsonb_agg(x->'transactionKey'),'[]'::jsonb)from jsonb_array_elements(records)x)),
 'sourceHash',repeat('a',64),'recordsHash',repeat('b',64),'terminal',jsonb_array_length(coalesce(source_keys,records))<1000);
$$;
create function pg_temp.settlement_create(n integer)returns uuid language sql volatile as $$
 select (public.service_create_pg_settlement_import(pg_temp.settlement_id('actor',1),pg_temp.settlement_id('op',n),pg_temp.settlement_query(),'test',repeat('a',64),'syntheticmid')#>>'{job,id}')::uuid;
$$;
create function pg_temp.settlement_step(id uuid,records jsonb,page integer default 1,source_keys jsonb default null)returns jsonb language plpgsql as $$
declare claim jsonb;begin
 claim:=public.service_claim_pg_settlement_import(pg_temp.settlement_id('actor',1),id,repeat('a',64));
 return public.service_finish_pg_settlement_import(pg_temp.settlement_id('actor',1),id,(claim->>'claimId')::uuid,repeat('a',64),pg_temp.settlement_page(records,page,source_keys));end $$;
create function pg_temp.settlement_complete(n integer,records jsonb)returns uuid language plpgsql as $$declare id uuid;begin
 id:=pg_temp.settlement_create(n);perform pg_temp.settlement_step(id,records);perform pg_temp.settlement_step(id,records);return id;end $$;
create function pg_temp.settlement_report(extra jsonb default '{}')returns jsonb language sql volatile as $$
 select public.admin_get_pg_settlement_report(pg_temp.settlement_query()||'{"mode":"test","page":1,"pageSize":20}'::jsonb||extra);$$;
-- Exercise the actual goods cancellation completion boundary. It persists a
-- refund, but currently no refund transaction evidence; reconciliation must
-- disclose that missing evidence rather than fabricate a matched transaction.
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values(pg_temp.settlement_id('origin',1),'pg-settlement-origin','정산 합성 출고지','hanjin',0,'합성 반송 주소',true);
insert into public.ips(id,title,vertical_key)values('pg-settlement-ip','정산 합성 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
 values('pg-settlement-good','pg-settlement-ip','정산 합성 상품','문구',101,'ok',9,pg_temp.settlement_id('origin',1));
insert into public.order_items(id,order_id,good_id,variant_id,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,qty,unit_price)
 select pg_temp.settlement_id('item',1),pg_temp.settlement_id('order',1),'pg-settlement-good',id,'정산 합성 상품','문구','pg-settlement-ip',1,101
 from public.goods_variants where good_id='pg-settlement-good' and is_default;
do $$declare lines jsonb;quote jsonb;begin
 select jsonb_agg(jsonb_build_object('origin_id',origin_id_snapshot,'good_id',good_id,'qty',qty,'unit_price',unit_price,'fee_type',shipping_fee_type_snapshot,'individual_fee',individual_fee_snapshot))into lines from public.order_items where order_id=pg_temp.settlement_id('order',1);
 quote:=private.apply_shipping_region_quote(private.calculate_goods_shipping(lines),lines,'{"postalCode":"12345","address1":"합성시 검증로 1"}',clock_timestamp());
 update public.orders set shipping_fee_breakdown=quote->'groups' where id=pg_temp.settlement_id('order',1);
 perform private.create_order_shipments(pg_temp.settlement_id('order',1));end $$;
select public.request_order_cancellation(pg_temp.settlement_id('order',1),pg_temp.settlement_id('actor',4),'합성 고객의 환불 요청','change_of_mind');
select public.complete_order_cancellation_request((select id from public.order_cancellation_requests where order_id=pg_temp.settlement_id('order',1)),array['settlement-payment-1'],pg_temp.settlement_id('actor',1));
select 1/case when exists(select 1 from public.refunds where payment_id=pg_temp.settlement_id('payment',1) and status='done' and amount=101)
 and not exists(select 1 from private.payment_provider_evidence where payment_attempt_id=pg_temp.settlement_id('attempt',1) and evidence_kind='refund_approved')then 1 else 0 end as real_goods_refund_has_no_transaction_evidence;

-- Ticket approval and refund finalizers do persist transaction evidence.
update public.profiles set nickname='pg_settlement_buyer',birth_date='2000-01-01',consents='{"terms":true,"privacy":true}',onboarded_at=now() where id=pg_temp.settlement_id('actor',4);
insert into public.events(id,title,mode,status,starts_at)values('pg-settlement-event','정산 합성 티켓','오프라인','예매중',now()+interval '30 days');
insert into public.ticket_types(id,event_id,name,price,capacity,sold,per_user_limit)
 values(pg_temp.settlement_id('ticket-type',1),'pg-settlement-event','정산 합성 회차',1000,10,0,4);
do $$declare order_id uuid;attempt public.payment_attempts;request_id uuid;begin
 order_id:=public.reserve_tickets(pg_temp.settlement_id('actor',4),pg_temp.settlement_id('ticket-type',1),1,pg_temp.settlement_id('reservation',1));
 perform public.prepare_ticket_payment_attempt(pg_temp.settlement_id('actor',4),order_id,'toss');
 select * into attempt from public.payment_attempts where purpose='ticket' and ref_id=order_id;
 perform public.bind_ticket_payment_callback_nonce(attempt.id,repeat('c',64));
 perform public.claim_ticket_payment_attempt('toss',attempt.provider_order_id,repeat('c',64),pg_temp.settlement_id('ticket-token',1));
 if public.finalize_ticket_payment_attempt(attempt.id,pg_temp.settlement_id('ticket-token',1),'approved','settlement-ticket-payment-1','settlement-ticket-approve-1',null,null,'카드',null,now())<>'approved' then raise exception 'Ticket approval fixture failed';end if;
 select requested.request_id into request_id from public.request_ticket_cancellation(pg_temp.settlement_id('actor',4),order_id)requested;
 perform public.claim_ticket_payment_refund(request_id,pg_temp.settlement_id('actor',4),pg_temp.settlement_id('ticket-token',2));
 if public.finalize_ticket_payment_refund(request_id,attempt.id,pg_temp.settlement_id('ticket-token',2),'approved',1000,'settlement-ticket-payment-1','settlement-ticket-cancel-1',null,null,'카드',null,now())<>'approved' then raise exception 'Ticket refund fixture failed';end if;
end $$;
create function pg_temp.settlement_ticket_record()returns jsonb language sql stable as $$
 select pg_temp.settlement_record('settlement-ticket-cancel-1','-1000')||jsonb_build_object('paymentKey','settlement-ticket-payment-1','orderId',a.provider_order_id,
 'cancel',jsonb_build_object('cancelAmount','1000','canceledAt','2026-10-01T13:00:00+09:00','transactionKey','settlement-ticket-cancel-1'))
 from public.payment_attempts a join public.ticket_orders t on t.id=a.ref_id and a.purpose='ticket' where t.reservation_key=pg_temp.settlement_id('reservation',1);
$$;
create temp table settlement_finance_before as select to_jsonb(p)value from public.payments p;
create temp table settlement_refunds_before as select to_jsonb(r)value from public.refunds r;

select 1/case when (select count(*)=case when to_regprocedure('public.admin_list_pg_settlement_accounts()') is null then 8 else 10 end and bool_and(md5(p.prosrc)=c.body_md5) from private.operator_rpc_contracts c join pg_proc p on p.oid=to_regprocedure(c.signature) where p.proname like '%pg_settlement%')
 and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname like 'pg_settlement_%' and c.relkind='r'
  and (not c.relrowsecurity or has_table_privilege('anon',c.oid,'select,insert,update,delete') or has_table_privilege('authenticated',c.oid,'select,insert,update,delete') or has_table_privilege('service_role',c.oid,'select,insert,update,delete')))
 then 1 else 0 end as settlement_contracts_and_rls;
select 1/case when not has_table_privilege('service_role','private.pg_settlement_imports','select,insert,update,delete')
 and not has_table_privilege('authenticated','private.pg_settlement_records','select,insert,update,delete')
 and not has_function_privilege('authenticated','public.service_create_pg_settlement_import(uuid,uuid,jsonb,text,text,text)','execute')
 and not has_function_privilege('anon','public.admin_get_pg_settlement_report(jsonb)','execute')
 and not has_function_privilege('service_role','public.admin_export_pg_settlement_report(jsonb)','execute')then 1 else 0 end as sealed;
set local role service_role;
select pg_temp.settlement_expect('select public.service_create_pg_settlement_import(pg_temp.settlement_id(''actor'',3),pg_temp.settlement_id(''op'',1),pg_temp.settlement_query(),''test'',repeat(''a'',64),''syntheticmid'')','42501');
select pg_temp.settlement_expect('select public.service_create_pg_settlement_import(pg_temp.settlement_id(''actor'',1),pg_temp.settlement_id(''op'',1),''{"dateType":"soldDate","startDate":"2026-02-30","endDate":"2026-03-01"}'',''test'',repeat(''a'',64),''syntheticmid'')','settlement_invalid_query');
select pg_temp.settlement_create(1) as first_id \gset
select 1/case when pg_temp.settlement_create(1)=:'first_id'::uuid then 1 else 0 end as same_operation;
select pg_temp.settlement_expect('select public.service_create_pg_settlement_import(pg_temp.settlement_id(''actor'',2),pg_temp.settlement_id(''op'',1),pg_temp.settlement_query(),''test'',repeat(''a'',64),''syntheticmid'')','settlement_operation_conflict');
select pg_temp.settlement_expect('select public.service_create_pg_settlement_import(pg_temp.settlement_id(''actor'',1),pg_temp.settlement_id(''op'',1),pg_temp.settlement_query(),''live'',repeat(''a'',64),''syntheticmid'')','settlement_operation_conflict');
select public.service_claim_pg_settlement_import(pg_temp.settlement_id('actor',1),:'first_id',repeat('a',64)) as first_claim \gset
select 1/case when public.service_claim_pg_settlement_import(pg_temp.settlement_id('actor',1),:'first_id',repeat('a',64))->>'kind'='busy' then 1 else 0 end as busy_lease;
select public.service_finish_pg_settlement_import(pg_temp.settlement_id('actor',1),:'first_id',(:'first_claim'::jsonb->>'claimId')::uuid,repeat('a',64),pg_temp.settlement_page(jsonb_build_array(pg_temp.settlement_record()))) as first_page \gset
select 1/case when :'first_page'::jsonb#>>'{job,state}'='verifying' and :'first_page'::jsonb#>>'{job,sourceCount}'='1' then 1 else 0 end as first_scan_only;
select 1/case when public.service_finish_pg_settlement_import(pg_temp.settlement_id('actor',1),:'first_id',(:'first_claim'::jsonb->>'claimId')::uuid,repeat('a',64),pg_temp.settlement_page(jsonb_build_array(pg_temp.settlement_record())))=:'first_page'::jsonb then 1 else 0 end as replay_page_receipt;
select pg_temp.settlement_expect(format('select public.service_finish_pg_settlement_import(%L,%L,%L,%L,%L)',pg_temp.settlement_id('actor',1),:'first_id',:'first_claim'::jsonb->>'claimId',repeat('a',64),pg_temp.settlement_page('[]')),'settlement_page_conflict');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.settlement_id('actor',3)::text,true);
select pg_temp.settlement_expect('select pg_temp.settlement_report()','42501');
select set_config('request.jwt.claim.sub',pg_temp.settlement_id('actor',1)::text,true);
select 1/case when pg_temp.settlement_report()->>'coverage'='uncollected' then 1 else 0 end as partial_not_published;
reset role;set local role service_role;
select 1/case when pg_temp.settlement_step(:'first_id',jsonb_build_array(pg_temp.settlement_record()))->>'kind'='complete' then 1 else 0 end as complete_after_second_scan;
reset role;set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.settlement_id('actor',1)::text,true);
select pg_temp.settlement_report() as first_report \gset
select 1/case when :'first_report'::jsonb#>>'{snapshot,sourceCount}'='2' and :'first_report'::jsonb#>>'{transactions,0,matchState}'='matched'
 and :'first_report'::jsonb#>>'{totals,0,feeAmount}'='0.21' and :'first_report'::jsonb#>>'{daily,0,date}'='2026-10-01'
 and :'first_report' !~ 'syntheticmid|settlement-payment|settlement-approve|scopeHash|paymentKey|transactionKey|orderId' then 1 else 0 end as safe_exact_matched_report;
select 1/case when pg_temp.settlement_report('{"currency":"USD"}')->>'coverage'='complete' and pg_temp.settlement_report('{"mode":"live"}')->>'coverage'='uncollected' then 1 else 0 end as currency_and_mode_bound;
select pg_temp.settlement_expect('select public.admin_export_pg_settlement_report(pg_temp.settlement_query()||''{"mode":"test"}'')','settlement_snapshot_required');
select public.admin_export_pg_settlement_report(pg_temp.settlement_query()||jsonb_build_object('mode','test','importId',:'first_id')) as export_report \gset
select public.admin_record_pg_settlement_export(pg_temp.settlement_query()||jsonb_build_object('mode','test','importId',:'first_id'),:'export_report'::jsonb->>'fingerprint',1) as export_receipt \gset
select pg_temp.settlement_expect(format('select public.admin_record_pg_settlement_export(%L,%L,2)',pg_temp.settlement_query()||jsonb_build_object('mode','test','importId',:'first_id'),:'export_report'::jsonb->>'fingerprint'),'settlement_export_changed');
reset role;
select 1/case when (select not diff?'query' and diff->>'recordCount'='1' from public.audit_log where id=:'export_receipt')then 1 else 0 end as safe_export_audit;
select pg_temp.settlement_expect(format('update private.pg_settlement_imports set error_code=''x'' where id=%L',:'first_id'),'settlement_snapshot_immutable');
select pg_temp.settlement_expect(format('delete from private.pg_settlement_records where import_id=%L',:'first_id'),'settlement_snapshot_immutable');
select pg_temp.settlement_expect(format('insert into private.pg_settlement_source_keys(import_id,scan,transaction_key)values(%L,1,''extra'')',:'first_id'),'settlement_snapshot_immutable');
select pg_temp.settlement_expect(format('insert into private.pg_settlement_pages(import_id,scan,page,claim_id,source_count,record_count,source_hash,records_hash,input_hash,terminal)values(%L,2,20,extensions.gen_random_uuid(),0,0,''a'',''a'',''a'',true)',:'first_id'),'settlement_snapshot_immutable');
select pg_temp.settlement_expect(format('insert into private.pg_settlement_records(import_id,transaction_key,record,record_hash,kind,currency,sold_date,paid_out_date)values(%L,''extra'',''{}'',''a'',''approval'',''KRW'',''2026-10-01'',''2026-10-02'')',:'first_id'),'settlement_snapshot_immutable');
set local role service_role;
select pg_temp.settlement_create(2) as changed_id \gset
select pg_temp.settlement_step(:'changed_id',jsonb_build_array(pg_temp.settlement_record()));
select 1/case when pg_temp.settlement_step(:'changed_id',jsonb_build_array(pg_temp.settlement_record('settlement-approve-1','102')))#>>'{job,errorCode}'='snapshot_changed' then 1 else 0 end as changing_scan_fails;
select pg_temp.settlement_create(3) as duplicate_id \gset
select 1/case when pg_temp.settlement_step(:'duplicate_id',jsonb_build_array(pg_temp.settlement_record(),pg_temp.settlement_record()))#>>'{job,errorCode}'='duplicate_transaction' then 1 else 0 end as duplicate_fails;
select pg_temp.settlement_create(4) as retry_id \gset
select public.service_claim_pg_settlement_import(pg_temp.settlement_id('actor',1),:'retry_id',repeat('a',64)) as retry_claim \gset
select 1/case when public.service_fail_pg_settlement_import(pg_temp.settlement_id('actor',1),:'retry_id',(:'retry_claim'::jsonb->>'claimId')::uuid,repeat('a',64),'provider_unavailable')#>>'{job,state}'='collecting' then 1 else 0 end as transport_retryable;
select 1/case when public.service_claim_pg_settlement_import(pg_temp.settlement_id('actor',1),:'retry_id',repeat('b',64))#>>'{job,errorCode}'='scope_changed' then 1 else 0 end as scope_changed_fails;
reset role;
select pg_temp.settlement_expect(format('update private.pg_settlement_records set import_id=%L where import_id=%L',:'first_id',:'changed_id'),'settlement_snapshot_immutable');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.settlement_id('actor',1)::text,true);
select 1/case when pg_temp.settlement_report()#>>'{snapshot,id}'=:'first_id' then 1 else 0 end as failures_preserve_previous;
select set_config('request.jwt.claim.sub',pg_temp.settlement_id('actor',2)::text,true);
select 1/case when public.admin_get_pg_settlement_import(:'first_id') is null then 1 else 0 end as other_actor_readback_denied;
reset role;set local role service_role;
select pg_temp.settlement_complete(5,'[]') as empty_id \gset
reset role;set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.settlement_id('actor',1)::text,true);
select 1/case when pg_temp.settlement_report()->>'coverage'='empty' and public.admin_export_pg_settlement_report(pg_temp.settlement_query()||jsonb_build_object('mode','test','importId',:'empty_id'))#>>'{pagination,total}'='0' then 1 else 0 end as verified_empty_export;
reset role;set local role service_role;
select pg_temp.settlement_complete(6,jsonb_build_array(pg_temp.settlement_record(),
 pg_temp.settlement_record('settlement-cancel-1','-101')||'{"cancel":{"cancelAmount":"101","canceledAt":"2026-10-01T13:00:00+09:00","transactionKey":"settlement-cancel-1"}}',
 pg_temp.settlement_record('settlement-usd-1','999999999999999999.12345678')||'{"currency":"USD","orderId":"not-linked-order"}')) as mixed_id \gset
reset role;set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.settlement_id('actor',1)::text,true);
select pg_temp.settlement_report() as mixed_report \gset
select 1/case when jsonb_array_length(:'mixed_report'::jsonb->'totals')=3
 and (select value->>'amount' from jsonb_array_elements(:'mixed_report'::jsonb->'totals') where value->>'kind'='cancel')='-101'
 and (select value->>'amount' from jsonb_array_elements(:'mixed_report'::jsonb->'totals') where value->>'currency'='USD')='999999999999999999.12345678'
 and (select value->>'matchState' from jsonb_array_elements(:'mixed_report'::jsonb->'transactions')where value->>'kind'='cancel')='unlinked' then 1 else 0 end as signs_currencies_precision_and_refund;
select 1/case when pg_temp.settlement_report('{"match":"unlinked"}')#>>'{pagination,total}'='2'
 and pg_temp.settlement_report(jsonb_build_object('query',upper(left(pg_temp.settlement_id('order',1)::text,8))))#>>'{pagination,total}'='2' then 1 else 0 end as exact_filters;
reset role;set local role service_role;
select pg_temp.settlement_create(7) as boundary_id \gset
select 1/case when pg_temp.settlement_step(:'boundary_id','[]',1,(select jsonb_agg('boundary-'||n)from generate_series(1,1000)n))#>>'{job,nextPage}'='2' then 1 else 0 end as filtered_empty_full_page_continues;
select 1/case when pg_temp.settlement_step(:'boundary_id','[]',2,'["boundary-1"]')#>>'{job,errorCode}'='duplicate_transaction' then 1 else 0 end as outside_window_duplicate_caught;
select pg_temp.settlement_create(8) as invalid_id \gset
select 1/case when pg_temp.settlement_step(:'invalid_id',jsonb_build_array(pg_temp.settlement_record()||'{"account":"must-not-store"}'))#>>'{job,errorCode}'='invalid_response' then 1 else 0 end as unknown_private_fields_rejected;
do $$declare change jsonb;n integer:=30;id uuid;begin
 for change in select * from jsonb_array_elements('[{"amount":101},{"amount":"1000000000000000000"},{"amount":"0.000000001"},{"amount":"0.20"},{"mId":"other-mid"},{"soldDate":"2026-10-03"},{"soldDate":"2026-02-30"},{"fees":null},{"approvedAt":"2026-10-01"},{"cancel":{"cancelAmount":"101","canceledAt":"2026-10-01T13:00:00+09:00","transactionKey":"wrong"}}]')loop
  id:=pg_temp.settlement_create(n);n:=n+1;
  if pg_temp.settlement_step(id,jsonb_build_array(pg_temp.settlement_record()||change))#>>'{job,errorCode}'<>'invalid_response' then raise exception 'Malformed normalized settlement record accepted';end if;
 end loop;
end $$;
select pg_temp.settlement_create(40) as missing_id \gset
select pg_temp.settlement_step(:'missing_id',jsonb_build_array(pg_temp.settlement_record()));
select 1/case when pg_temp.settlement_step(:'missing_id','[]')#>>'{job,errorCode}'='snapshot_changed' then 1 else 0 end as missing_record_fails;
select pg_temp.settlement_create(41) as additional_id \gset
select pg_temp.settlement_step(:'additional_id',jsonb_build_array(pg_temp.settlement_record()));
select 1/case when pg_temp.settlement_step(:'additional_id',jsonb_build_array(pg_temp.settlement_record(),pg_temp.settlement_record('additional')))#>>'{job,errorCode}'='snapshot_changed' then 1 else 0 end as added_record_fails;
select pg_temp.settlement_create(42) as reorder_id \gset
select pg_temp.settlement_step(:'reorder_id',jsonb_build_array(pg_temp.settlement_record('first-row'),pg_temp.settlement_record('second-row')));
select 1/case when pg_temp.settlement_step(:'reorder_id',jsonb_build_array(pg_temp.settlement_record('second-row'),pg_temp.settlement_record('first-row')))->>'kind'='complete' then 1 else 0 end as row_order_is_not_identity;
select pg_temp.settlement_create(43) as scope_replay_id \gset
select public.service_claim_pg_settlement_import(pg_temp.settlement_id('actor',1),:'scope_replay_id',repeat('a',64)) as scope_replay_claim \gset
select public.service_finish_pg_settlement_import(pg_temp.settlement_id('actor',1),:'scope_replay_id',(:'scope_replay_claim'::jsonb->>'claimId')::uuid,repeat('a',64),pg_temp.settlement_page('[]'));
select 1/case when public.service_finish_pg_settlement_import(pg_temp.settlement_id('actor',1),:'scope_replay_id',(:'scope_replay_claim'::jsonb->>'claimId')::uuid,repeat('b',64),pg_temp.settlement_page('[]'))#>>'{job,errorCode}'='scope_changed' then 1 else 0 end as replay_checks_current_scope;
-- A full page containing only adjacent dates still consumes the raw-page
-- budget. Exactly 20 full pages require page 21 to be empty, in both scans.
do $$declare id uuid;keys jsonb;result jsonb;pass integer;page integer;begin
 id:=pg_temp.settlement_create(44);
 for pass in 1..2 loop
  for page in 1..20 loop
   select jsonb_agg('budget-'||page||'-'||n) into keys from generate_series(1,1000)n;
   result:=pg_temp.settlement_step(id,'[]',page,keys);
   if result->>'kind'<>'accepted' then raise exception '20 page budget failed before terminal page';end if;
  end loop;
  result:=pg_temp.settlement_step(id,'[]',21);
 end loop;
 if result->>'kind'<>'complete' or result#>>'{job,sourceCount}'<>'40000' or result#>>'{job,recordCount}'<>'0' then
  raise exception 'Exact 20000 rows per scan did not complete';end if;
end $$;
reset role;
select pg_temp.settlement_create(45) as over_limit_id \gset
update private.pg_settlement_imports set next_page=21 where id=:'over_limit_id';
set local role service_role;
select 1/case when pg_temp.settlement_step(:'over_limit_id','[]',21,'["over-limit"]')#>>'{job,errorCode}'='page_limit' then 1 else 0 end as nonempty_page_twenty_one_rejected;
select pg_temp.settlement_complete(9,jsonb_build_array(pg_temp.settlement_ticket_record())) as ticket_id \gset
reset role;set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.settlement_id('actor',1)::text,true);
select 1/case when pg_temp.settlement_report()#>>'{transactions,0,matchState}'='matched' and pg_temp.settlement_report()#>>'{transactions,0,purpose}'='ticket' then 1 else 0 end as actual_ticket_refund_evidence_matched;
reset role;
select 1/case when not exists(select value from settlement_finance_before except select to_jsonb(p)from public.payments p)
 and not exists(select value from settlement_refunds_before except select to_jsonb(r)from public.refunds r)then 1 else 0 end as finance_untouched;
rollback;
