\set ON_ERROR_STOP on
select 1/case when current_database()~'^icons_(bank_refund|goods_transaction)_[0-9a-f]{32}$'
 and exists(select 1 from private.operator_fixture_clone_identity where singleton and source_database='postgres'
  and replace(lease::text,'-','')=right(current_database(),32) and created_at>clock_timestamp()-interval '2 hours')
 then 1 else 0 end as assert_owned_bank_refund_clone;
begin;
load 'safeupdate';
create function pg_temp.br_id(kind text,n integer) returns uuid language sql immutable as $$select md5('bank-transfer-refund:'||kind||':'||n)::uuid$$;
create function pg_temp.br_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected bank refund rejection: %',expected;end $$;
create function pg_temp.br_auth(actor integer default 1,session_number integer default null) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.br_id('user',actor),
  'session_id',pg_temp.br_id('session',coalesce(session_number,actor)))::text,true);
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.br_id('user',n),'authenticated','authenticated','bank-refund-'||n||'@example.test',clock_timestamp(),'{}','{}' from generate_series(1,6)n;
insert into auth.sessions(id,user_id,created_at,updated_at)
 select pg_temp.br_id('session',n),pg_temp.br_id('user',n),clock_timestamp(),clock_timestamp() from generate_series(1,6)n;
update public.profiles set nickname='TEST 은행환불 '||right(id::text,6),role=case when id=pg_temp.br_id('user',1) then 'admin'::public.user_role
 when id in(pg_temp.br_id('user',5),pg_temp.br_id('user',6)) then 'staff'::public.user_role else 'user'::public.user_role end
 where id in(select pg_temp.br_id('user',n)from generate_series(1,6)n);
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.br_id('user',1),'primary'),(pg_temp.br_id('user',5),'logistics'),(pg_temp.br_id('user',6),'primary');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values(pg_temp.br_id('origin',1),'bank-refund-origin','TEST 은행환불 출고지','hanjin',0,'TEST 반품 주소',true);
insert into public.ips(id,title,vertical_key) values('bank-refund-ip','TEST 은행환불 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
 select 'bank-refund-good-'||n,'bank-refund-ip','TEST 은행환불 상품 '||n,'문구',5000,'ok',98,pg_temp.br_id('origin',1) from generate_series(1,44)n;
insert into public.orders(id,user_id,status,total,shipping_fee,address,payment_method,created_at,delivered_at)
 select pg_temp.br_id('order',n),pg_temp.br_id('user',2),case when n in(3,4) then 'delivered'::public.order_status
  when n in(10,11) then 'pending'::public.order_status else 'paid'::public.order_status end,10000,0,
 '{"recipientName":"TEST 구매자","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}',
 (case when n in(8,9) then 'card' else 'bank_transfer' end)::public.order_payment_method,
 clock_timestamp()-interval '2 days',case when n in(3,4) then clock_timestamp()-interval '1 day' else null end from generate_series(1,44)n;
insert into public.order_items(id,order_id,good_id,variant_id,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,qty,unit_price)
 select pg_temp.br_id('item',n),pg_temp.br_id('order',n),'bank-refund-good-'||n,v.id,'TEST 은행환불 상품','문구','bank-refund-ip',2,5000
 from generate_series(1,44)n join public.goods_variants v on v.good_id='bank-refund-good-'||n and v.is_default;
create function pg_temp.br_shipments(n integer) returns void language plpgsql as $$declare lines jsonb;quote jsonb;begin
 select jsonb_agg(jsonb_build_object('origin_id',origin_id_snapshot,'good_id',good_id,'qty',qty,'unit_price',unit_price,'fee_type',shipping_fee_type_snapshot,'individual_fee',individual_fee_snapshot)) into lines
 from public.order_items where order_id=pg_temp.br_id('order',n);
 quote:=private.apply_shipping_region_quote(private.calculate_goods_shipping(lines),lines,'{"postalCode":"12345","address1":"TEST 합성 주소"}',clock_timestamp());
 update public.orders set shipping_fee_breakdown=quote->'groups' where id=pg_temp.br_id('order',n);
 perform private.create_order_shipments(pg_temp.br_id('order',n));end $$;
select pg_temp.br_shipments(n) from generate_series(1,44)n;
insert into public.payments(id,user_id,provider,purpose,ref_id,amount,status,payment_key,idempotency_key,created_at)
 select pg_temp.br_id('payment',n),pg_temp.br_id('user',2),
 (case when n=8 then 'toss' when n=9 then 'korpay' else 'bank_transfer' end)::public.payment_provider,'order',pg_temp.br_id('order',n),10000,
 case when n=11 then 'failed'::public.payment_status else 'paid'::public.payment_status end,
 case when n in(8,9) then 'TEST-CARD-'||n else 'bank_transfer:'||pg_temp.br_id('order',n) end,'bank-refund-test-'||n,
 clock_timestamp()-interval '1 hour' from generate_series(1,44)n where n<>10;
insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,currency,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 select pg_temp.br_id('attempt',n),'bank_transfer',pg_temp.br_id('user',2),'order',pg_temp.br_id('order',n),10000,'KRW',
 case when n=15 then 'unknown'::public.payment_attempt_state else 'approved'::public.payment_attempt_state end,
 'bank-refund-attempt-'||n,'TEST-ORDER-'||n,'TEST-PRODUCT-'||n,pg_temp.br_id('payment',n),clock_timestamp()+interval '1 hour'
 from unnest(array[1,2,3,4,15,20])n;
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,collection_policy,collected_at,requested_at)
 select pg_temp.br_id('claim',n),pg_temp.br_id('order',n),pg_temp.br_id('user',2),'TEST 무통장 환불 검증',
 case when n in(3,4) then 'return' else 'cancel' end,case when n in(3,4) then 'collected' when n=1 then 'needs_review' else 'processing' end,
 case when n in(3,4) then 'legacy' else 'origin' end,case when n in(3,4) then clock_timestamp()-interval '30 minutes' else null end,
 clock_timestamp()-interval '40 minutes' from generate_series(1,44)n where n not in(10,11);
insert into public.order_cancellation_claims(order_id,requested_by,previous_status)
 select pg_temp.br_id('order',n),pg_temp.br_id('user',2),'paid' from generate_series(1,44)n where n not in(3,4,10,11);
insert into public.refunds(id,payment_id,amount,status,cancellation_request_id,method,filed_at,handled_by)
 select pg_temp.br_id('refund',n),pg_temp.br_id('payment',n),10000,case when n=1 then 'failed' else 'requested' end,
 pg_temp.br_id('claim',n),case when n=1 then 'bank_transfer' else null end,
 case when n=1 then clock_timestamp()-interval '20 minutes' else null end,case when n=1 then pg_temp.br_id('user',1) else null end
 from generate_series(1,44)n where n not in(3,4,10,11);
insert into private.claim_refund_accounts(claim_id,bank_name,account_number,account_holder,masked_account,masked_holder)
 select pg_temp.br_id('claim',n),'TEST 합성은행','000000001234','TEST 합성구매자','TEST 합성은행 ********1234','T*********'
 from generate_series(1,44)n where n not in(7,10,11,20);
insert into private.gift_intents(id,sender_id,recipient_id,state,sender_label,recipient_label,expires_at,order_id,ordered_source_revision)
 select pg_temp.br_id('gift',n),pg_temp.br_id('user',2),pg_temp.br_id('user',3),'ordered','TEST 결제자','TEST 수령자',clock_timestamp()+interval '1 day',pg_temp.br_id('order',n),'test'
 from unnest(array[4,20])n;
insert into private.gift_claim_parties(claim_id,gift_id,payer_id,recipient_id,actual_requester)
 select pg_temp.br_id('claim',n),pg_temp.br_id('gift',n),pg_temp.br_id('user',2),pg_temp.br_id('user',3),pg_temp.br_id('user',case when n=4 then 3 else 2 end) from unnest(array[4,20])n;
insert into private.shipping_collect_obligations(shipment_id,order_id,amount,state,revision,contract_snapshot)
 select id,order_id,6000,'collected',2,'{}' from public.order_shipments where order_id=pg_temp.br_id('order',1);
create function pg_temp.br_context(n integer,actor integer default 1,session_number integer default 1) returns jsonb language sql as $$
 select public.admin_bank_transfer_refund_context(pg_temp.br_id('order',n),pg_temp.br_id('claim',n),pg_temp.br_id('user',actor),pg_temp.br_id('session',session_number));$$;
create function pg_temp.br_do(n integer,operation integer,kind text,revision integer default -1,occurred timestamptz default null,evidence text default 'TEST 증빙') returns jsonb language plpgsql as $$
declare current_revision integer:=revision;begin
 if current_revision<0 then current_revision:=(pg_temp.br_context(n)->>'revision')::integer;end if;
 return public.admin_record_bank_transfer_refund(pg_temp.br_id('order',n),pg_temp.br_id('claim',n),pg_temp.br_id('operation',operation),kind,current_revision,10000,
  coalesce(occurred,clock_timestamp()),evidence,'TEST-ONLY 합성 금융 검증. 실제 송금 없음.',true,pg_temp.br_id('user',1),pg_temp.br_id('session',1));end $$;
create function pg_temp.br_read(n integer,operation integer,kind text,revision integer,seal boolean default false) returns jsonb language sql as $$
 select public.admin_read_bank_transfer_refund(pg_temp.br_id('order',n),pg_temp.br_id('claim',n),pg_temp.br_id('operation',operation),kind,revision,10000,
 pg_temp.br_id('user',1),pg_temp.br_id('session',1),seal);$$;
create function pg_temp.br_view(n integer,operation integer) returns jsonb language sql as $$
 select public.admin_view_bank_transfer_refund_account(pg_temp.br_id('order',n),pg_temp.br_id('claim',n),pg_temp.br_id('view',operation),
 (pg_temp.br_context(n)->>'revision')::integer,pg_temp.br_id('user',1),pg_temp.br_id('session',1));$$;
select count(*) as br_existing_pending from private.bank_transfer_claim_refunds where state='awaiting_transfer' \gset
commit;

begin read only;
set local role authenticated;
select pg_temp.br_auth();
select 1/case when pg_temp.br_context(1)->>'confirmBlocker' is null
 and (public.admin_list_bank_transfer_refunds(50,0)->>'total')::bigint=:br_existing_pending then 1 else 0 end as stable_readers_are_readonly;
rollback;

begin;
set local role authenticated;
select pg_temp.br_auth(2);
select pg_temp.br_error('select pg_temp.br_context(1,2,2)','42501');
select pg_temp.br_auth(5);
select pg_temp.br_error('select pg_temp.br_context(1,5,5)','42501');
select pg_temp.br_auth(1,2);
select pg_temp.br_error('select pg_temp.br_context(1)','42501');
select pg_temp.br_auth();
select pg_temp.br_error('select pg_temp.br_do(7,7,''confirm_cancellation'')','claim_refund_account_missing');
select pg_temp.br_error('select pg_temp.br_do(8,8,''confirm_cancellation'')','bank_refund_payment_unavailable');
select pg_temp.br_error('select pg_temp.br_do(9,9,''confirm_cancellation'')','bank_refund_payment_unavailable');
select pg_temp.br_error('select pg_temp.br_do(15,15,''confirm_cancellation'')','bank_refund_payment_unavailable');
select pg_temp.br_error('select pg_temp.br_do(2,200,''file_transfer'')','bank_refund_confirmation_required');
select pg_temp.br_error('select pg_temp.br_do(3,300,''confirm_cancellation'')','bank_refund_claim_unavailable');
select pg_temp.br_error('select pg_temp.br_do(2,201,''confirm_cancellation'',0,clock_timestamp()+interval ''1 hour'')','bank_refund_occurred_at_invalid');
select pg_temp.br_error('select pg_temp.br_do(2,202,''confirm_cancellation'',0,clock_timestamp()-interval ''5 days'')','bank_refund_occurred_at_invalid');
select clock_timestamp() as happened \gset
select pg_temp.br_do(1,1,'confirm_cancellation',0,:'happened') as confirmed \gset
select 1/case when pg_temp.br_do(1,1,'confirm_cancellation',0,:'happened')=:'confirmed'::jsonb
 and pg_temp.br_read(1,1,'confirm_cancellation',0)=:'confirmed'::jsonb
 and pg_temp.br_context(1)->>'phase'='awaiting_transfer' and pg_temp.br_context(1)->>'stage'='processing'
 and pg_temp.br_context(1)->>'completeBlocker' is null then 1 else 0 end as needs_review_confirmation_replay_and_stage_recovery;
select pg_temp.br_error(format('select pg_temp.br_do(1,1,''confirm_cancellation'',0,%L,''OTHER EVIDENCE'')',:'happened'),'23505');
select pg_temp.br_error('select pg_temp.br_do(1,101,''confirm_cancellation'',0)','PT409');
reset role;
select 1/case when (select status='canceled' from public.orders where id=pg_temp.br_id('order',1))
 and (select status='paid' from public.payments where id=pg_temp.br_id('payment',1))
 and (select status='awaiting_transfer' and completed_at is null and amount=10000 from public.refunds where payment_id=pg_temp.br_id('payment',1))
 and (select stock_qty=100 from public.goods where id='bank-refund-good-1')
 and (select state='refund_review' and revision=3 and amount=6000 from private.shipping_collect_obligations where order_id=pg_temp.br_id('order',1))
 and (select purge_after is null and purged_at is null and account_number='000000001234' from private.claim_refund_accounts where claim_id=pg_temp.br_id('claim',1))
 and exists(select 1 from jsonb_array_elements(private.account_deletion_blockers(pg_temp.br_id('user',2))) item where item->>'code'='active_order_refund')
 then 1 else 0 end as confirmation_restores_stock_but_preserves_unpaid_refund_and_account;
select pg_temp.br_error('update public.refunds set status=''done'' where payment_id=pg_temp.br_id(''payment'',1)','bank_refund_evidence_required');
select pg_temp.br_error('update public.payments set status=''refunded'' where id=pg_temp.br_id(''payment'',1)','bank_refund_evidence_required');
select pg_temp.br_error('update public.order_cancellation_requests set stage=''completed'' where id=pg_temp.br_id(''claim'',1)','bank_refund_transfer_pending');
select pg_temp.br_error('update private.claim_refund_accounts set purged_at=clock_timestamp() where claim_id=pg_temp.br_id(''claim'',1)','bank_refund_transfer_pending');
set local role authenticated;
select pg_temp.br_auth();
select pg_temp.br_view(1,1) as account_view \gset
select 1/case when :'account_view'::jsonb->>'accountNumber'='000000001234'
 and current_setting('response.headers') like '%no-store%' then 1 else 0 end as audited_raw_account_no_store;
select pg_temp.br_error('select pg_temp.br_view(1,1)','23505');
select pg_temp.br_do(1,2,'complete_transfer') as completed \gset
reset role;
select 1/case when (select status='canceled' from public.orders where id=pg_temp.br_id('order',1))
 and (select status='refunded' and amount=10000 from public.payments where id=pg_temp.br_id('payment',1))
 and (select status='done' and completed_at is not null and amount=10000 from public.refunds where payment_id=pg_temp.br_id('payment',1))
 and (select stage='completed' from public.order_cancellation_requests where id=pg_temp.br_id('claim',1))
 and (select stock_qty=100 from public.goods where id='bank-refund-good-1')
 and (select purge_after between now()+interval '29 days' and now()+interval '31 days' from private.claim_refund_accounts where claim_id=pg_temp.br_id('claim',1))
 and (select count(*)=1 from private.bank_transfer_refund_account_views where claim_id=pg_temp.br_id('claim',1))
 and not exists(select 1 from public.audit_log where target='order:'||pg_temp.br_id('order',1)::text and diff::text~'(000000001234|accountNumber|accountHolder|sessionId|requestHash)')
 then 1 else 0 end as transfer_evidence_closes_money_once_and_starts_retention;
set local role authenticated;
select pg_temp.br_auth();
select pg_temp.br_do(2,3,'confirm_cancellation');
select pg_temp.br_error('select pg_temp.br_do(2,4,''complete_transfer'')','bank_refund_filing_required');
select pg_temp.br_do(2,5,'file_transfer');
select pg_temp.br_do(2,6,'complete_transfer');
select pg_temp.br_do(3,7,'file_transfer');
select pg_temp.br_do(3,8,'confirm_cancellation');
select pg_temp.br_do(3,9,'complete_transfer');
select pg_temp.br_do(4,10,'file_transfer');
select pg_temp.br_do(4,11,'confirm_cancellation');
select 1/case when exists(select 1 from jsonb_array_elements(public.admin_list_bank_transfer_refunds(50,:br_existing_pending)->'rows') row
 where row->>'claimId'=pg_temp.br_id('claim',4)::text and row->>'gift'='true' and row->>'confirmedAt' is not null)
 then 1 else 0 end as gift_pending_queue_preserves_parties;
select pg_temp.br_auth(3);
select pg_temp.br_error('select pg_temp.br_context(4,3,3)','42501');
select pg_temp.br_auth();
select pg_temp.br_do(4,12,'complete_transfer');
select 1/case when pg_temp.br_read(12,90,'confirm_cancellation',0,true)->>'state'='sealed' then 1 else 0 end as durable_seal;
select pg_temp.br_error('select pg_temp.br_do(12,90,''confirm_cancellation'')','bank_refund_request_sealed');
-- The existing bank filing RPC remains available after cancellation, but never
-- accepts a card cancellation method or a direct completion without evidence.
select pg_temp.br_do(13,13,'confirm_cancellation');
select pg_temp.br_error('select public.admin_record_order_claim_refund(pg_temp.br_id(''claim'',13),''pg_cancel'',''filed'',''TEST method'')','bank_refund_method_required');
select public.admin_record_order_claim_refund(pg_temp.br_id('claim',13),'bank_transfer','filed','TEST post-confirmation filing');
select pg_temp.br_error('select public.admin_record_order_claim_refund(pg_temp.br_id(''claim'',13),''bank_transfer'',''completed'',''TEST no evidence'')','bank_refund_evidence_required');
select pg_temp.br_do(13,14,'complete_transfer');
-- Payer-only gift account completion is available after approval.
select pg_temp.br_auth(3);
select pg_temp.br_error('select public.set_my_gift_claim_refund_account(pg_temp.br_id(''gift'',20),pg_temp.br_id(''claim'',20),pg_temp.br_id(''gift-op'',1),''TEST 은행'',''000000005678'',''TEST 구매자'',pg_temp.br_id(''user'',3))','gift_not_found');
select pg_temp.br_auth(2);
select public.set_my_gift_claim_refund_account(pg_temp.br_id('gift',20),pg_temp.br_id('claim',20),pg_temp.br_id('gift-op',2),'TEST 은행','000000005678','TEST 구매자',pg_temp.br_id('user',2));
select pg_temp.br_auth();
select pg_temp.br_do(20,20,'confirm_cancellation');
select pg_temp.br_do(20,21,'file_transfer');
select pg_temp.br_do(20,22,'complete_transfer');
reset role;
select 1/case when not has_function_privilege('anon','public.admin_record_bank_transfer_refund(uuid,uuid,uuid,text,integer,integer,timestamptz,text,text,boolean,uuid,uuid)','execute')
 and not has_function_privilege('service_role','public.admin_view_bank_transfer_refund_account(uuid,uuid,uuid,integer,uuid,uuid)','execute')
 and not has_table_privilege('authenticated','private.bank_transfer_claim_refunds','select')
 then 1 else 0 end as bank_refund_private_acl;
-- Model a pre-migration terminal ledger without inventing money: first finish
-- the real synthetic refund above, temporarily remove only its new proof row,
-- and require an exact no-op. The savepoint restores that proof immediately.
savepoint legacy_terminal_fixture;
delete from private.bank_transfer_claim_refunds where claim_id=pg_temp.br_id('claim',1);
select public.finalize_order_cancellation_with_provider_evidence(pg_temp.br_id('order',1),'TEST legacy no-op',array[]::text[]);
set local role authenticated;
select pg_temp.br_auth();
select public.admin_record_order_claim_refund(pg_temp.br_id('claim',1),'bank_transfer','completed','TEST legacy no-op');
select 1/case when pg_temp.br_context(1)->>'phase'='completed' then 1 else 0 end as legacy_completed_context_is_not_reopened;
reset role;
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,collection_policy,withdrawn_at)
 values(pg_temp.br_id('claim',99),pg_temp.br_id('order',1),pg_temp.br_id('user',2),'TEST 이전 철회 요청','cancel','withdrawn','origin',clock_timestamp());
set local role authenticated;
select 1/case when public.admin_bank_transfer_refund_context(pg_temp.br_id('order',1),pg_temp.br_id('claim',99),
 pg_temp.br_id('user',1),pg_temp.br_id('session',1))->>'phase'='not_confirmed'
 and public.admin_bank_transfer_refund_context(pg_temp.br_id('order',1),pg_temp.br_id('claim',99),
 pg_temp.br_id('user',1),pg_temp.br_id('session',1))->>'filedAt' is null
 then 1 else 0 end as earlier_withdrawn_claim_does_not_inherit_completed_refund;
select pg_temp.br_error('select public.admin_record_order_claim_refund(pg_temp.br_id(''claim'',99),''bank_transfer'',''completed'',''TEST 다른 요청'')','bank_refund_evidence_required');
reset role;
select 1/case when (select stock_qty=100 from public.goods where id='bank-refund-good-1')
 and (select status='refunded' from public.payments where id=pg_temp.br_id('payment',1))
 and (select status='done' and completed_at is not null from public.refunds where payment_id=pg_temp.br_id('payment',1))
 then 1 else 0 end as complete_legacy_bank_ledger_replay_is_noop;
rollback to legacy_terminal_fixture;
set local role authenticated;
select pg_temp.br_auth();
select public.admin_cancel_unpaid_bank_transfer_order(pg_temp.br_id('order',10),'TEST 미입금 결제행 없는 주문 취소');
select public.admin_cancel_unpaid_bank_transfer_order(pg_temp.br_id('order',11),'TEST 실패한 결제행만 남은 미입금 취소');
reset role;
select 1/case when (select count(*)=2 from public.orders where id in(pg_temp.br_id('order',10),pg_temp.br_id('order',11)) and status='canceled')
 and (select status='failed' from public.payments where id=pg_temp.br_id('payment',11))
 and not exists(select 1 from public.refunds where payment_id=pg_temp.br_id('payment',11))
 then 1 else 0 end as both_unpaid_bank_cancellation_routes_preserved;
rollback;
