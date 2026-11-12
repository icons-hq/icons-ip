\set ON_ERROR_STOP on
-- 1007-047·048(20261112120200): 환불 송금 대기 목록 엑셀의 계좌 일괄 열람과 발급 감사.
-- 서버만(service_role) 부를 수 있고, 요청 상세의 계좌 열람과 같은 권한·세션·판정으로 요청마다 열람 기록을 남긴다.
-- 합성 데이터만 쓰고 끝에서 rollback한다. 실제 송금은 없다.
begin;
create function pg_temp.rt_id(kind text,n integer) returns uuid language sql immutable as $$select md5('refund-transfer-export:'||kind||':'||n)::uuid$$;
create function pg_temp.rt_assert(condition boolean,label text) returns void language plpgsql as $$begin
 if condition is distinct from true then raise exception 'Assertion failed: %',label;end if;end $$;
create function pg_temp.rt_error(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected rejection: %',expected;end $$;
create function pg_temp.rt_auth(actor integer default 1) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.rt_id('user',actor),
  'session_id',pg_temp.rt_id('session',actor))::text,true);
end $$;
-- 1: 주문 처리 관리자(내려받는 사람), 2: 결제자, 3: 물류 매니저(환불 권한 없음), 4: 다른 주문 처리 관리자
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.rt_id('user',n),'authenticated','authenticated','refund-transfer-export-'||n||'@example.test',clock_timestamp(),'{}','{}' from generate_series(1,4)n;
insert into auth.sessions(id,user_id,created_at,updated_at)
 select pg_temp.rt_id('session',n),pg_temp.rt_id('user',n),clock_timestamp(),clock_timestamp() from generate_series(1,4)n;
update public.profiles set nickname='TEST 환불엑셀 '||right(id::text,6),
 role=case when id in(pg_temp.rt_id('user',1),pg_temp.rt_id('user',4)) then 'admin'::public.user_role
  when id=pg_temp.rt_id('user',3) then 'staff'::public.user_role else 'user'::public.user_role end
 where id in(select pg_temp.rt_id('user',n) from generate_series(1,4)n);
insert into private.operator_memberships(profile_id,manager_role) values
 (pg_temp.rt_id('user',1),'primary'),(pg_temp.rt_id('user',3),'logistics'),(pg_temp.rt_id('user',4),'primary');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values(pg_temp.rt_id('origin',1),'refund-export-origin','TEST 환불엑셀 출고지','hanjin',0,'TEST 반품 주소',true);
insert into public.ips(id,title,vertical_key) values('refund-export-ip','TEST 환불엑셀 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
 select 'refund-export-good-'||n,'refund-export-ip','TEST 환불엑셀 상품 '||n,'문구',5000,'ok',98,pg_temp.rt_id('origin',1) from generate_series(1,4)n;
insert into public.orders(id,user_id,status,total,shipping_fee,address,payment_method,created_at)
 select pg_temp.rt_id('order',n),pg_temp.rt_id('user',2),'paid',10000,0,
 '{"recipientName":"TEST 구매자","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}','bank_transfer',
 clock_timestamp()-interval '2 days' from generate_series(1,4)n;
insert into public.order_items(id,order_id,good_id,variant_id,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,qty,unit_price)
 select pg_temp.rt_id('item',n),pg_temp.rt_id('order',n),'refund-export-good-'||n,v.id,'TEST 환불엑셀 상품','문구','refund-export-ip',2,5000
 from generate_series(1,4)n join public.goods_variants v on v.good_id='refund-export-good-'||n and v.is_default;
create function pg_temp.rt_shipments(n integer) returns void language plpgsql as $$declare lines jsonb;quote jsonb;begin
 select jsonb_agg(jsonb_build_object('origin_id',origin_id_snapshot,'good_id',good_id,'qty',qty,'unit_price',unit_price,'fee_type',shipping_fee_type_snapshot,'individual_fee',individual_fee_snapshot)) into lines
 from public.order_items where order_id=pg_temp.rt_id('order',n);
 quote:=private.apply_shipping_region_quote(private.calculate_goods_shipping(lines),lines,'{"postalCode":"12345","address1":"TEST 합성 주소"}',clock_timestamp());
 update public.orders set shipping_fee_breakdown=quote->'groups' where id=pg_temp.rt_id('order',n);
 perform private.create_order_shipments(pg_temp.rt_id('order',n));end $$;
select pg_temp.rt_shipments(n) from generate_series(1,4)n;
insert into public.payments(id,user_id,provider,purpose,ref_id,amount,status,payment_key,idempotency_key,created_at)
 select pg_temp.rt_id('payment',n),pg_temp.rt_id('user',2),'bank_transfer','order',pg_temp.rt_id('order',n),10000,'paid',
 'bank_transfer:'||pg_temp.rt_id('order',n),'refund-export-test-'||n,clock_timestamp()-interval '1 hour' from generate_series(1,4)n;
insert into public.payment_attempts(id,provider,user_id,purpose,ref_id,amount,currency,state,idempotency_key,provider_order_id,provider_product_code,payment_id,expires_at)
 select pg_temp.rt_id('attempt',n),'bank_transfer',pg_temp.rt_id('user',2),'order',pg_temp.rt_id('order',n),10000,'KRW','approved',
 'refund-export-attempt-'||n,'TEST-REFUND-EXPORT-'||n,'TEST-PRODUCT-'||n,pg_temp.rt_id('payment',n),clock_timestamp()+interval '1 hour' from generate_series(1,4)n;
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,collection_policy,requested_at)
 select pg_temp.rt_id('claim',n),pg_temp.rt_id('order',n),pg_temp.rt_id('user',2),'TEST 환불 엑셀 검증','cancel','processing','origin',
 clock_timestamp()-interval '40 minutes' from generate_series(1,4)n;
insert into public.order_cancellation_claims(order_id,requested_by,previous_status)
 select pg_temp.rt_id('order',n),pg_temp.rt_id('user',2),'paid' from generate_series(1,4)n;
insert into public.refunds(id,payment_id,amount,status,cancellation_request_id)
 select pg_temp.rt_id('refund',n),pg_temp.rt_id('payment',n),10000,'requested',pg_temp.rt_id('claim',n) from generate_series(1,4)n;
insert into private.claim_refund_accounts(claim_id,bank_name,account_number,account_holder,masked_account,masked_holder)
 select pg_temp.rt_id('claim',n),'TEST 합성은행','00000000123'||n,'TEST 합성구매자','TEST 합성은행 ********123'||n,'T*********' from generate_series(1,4)n;
create function pg_temp.rt_revision(n integer) returns integer language sql as $$
 select (public.admin_bank_transfer_refund_context(pg_temp.rt_id('order',n),pg_temp.rt_id('claim',n),pg_temp.rt_id('user',1),pg_temp.rt_id('session',1))->>'revision')::integer$$;
create function pg_temp.rt_do(n integer,operation integer,kind text) returns jsonb language sql as $$
 select public.admin_record_bank_transfer_refund(pg_temp.rt_id('order',n),pg_temp.rt_id('claim',n),pg_temp.rt_id('operation',operation),kind,
  pg_temp.rt_revision(n),10000,clock_timestamp(),'TEST 증빙','TEST-ONLY 합성 금융 검증. 실제 송금 없음.',true,pg_temp.rt_id('user',1),pg_temp.rt_id('session',1));$$;

-- 네 요청 모두 취소 확정으로 송금 대기에 둔다. 1·3·4는 계좌 송금 접수까지, 2는 접수 전이다.
set local role authenticated;
select pg_temp.rt_auth();
select pg_temp.rt_do(n,n,'confirm_cancellation') from generate_series(1,4)n;
select pg_temp.rt_do(n,10+n,'file_transfer') from unnest(array[1,3,4])n;
reset role;
select pg_temp.rt_assert((select count(*)=4 from private.bank_transfer_claim_refunds
 where claim_id in(select pg_temp.rt_id('claim',n) from generate_series(1,4)n) and state='awaiting_transfer'),'four claims await transfer');
-- 3은 송금 대기이지만 결제 시도가 확인 필요 상태라 요청 상세에서도 계좌를 열 수 없다(view_account 판정 실패).
update public.payment_attempts set state='needs_review' where id=pg_temp.rt_id('attempt',3);
create function pg_temp.rt_claims(numbers integer[]) returns jsonb language sql as $$
 select jsonb_agg(jsonb_build_object('claimId',c.id,'orderId',c.order_id,'revision',c.claim_revision) order by array_position(numbers,n))
 from unnest(numbers) n join public.order_cancellation_requests c on c.id=pg_temp.rt_id('claim',n)$$;
select pg_temp.rt_claims(array[1,2,3]) as claims123 \gset
create temp table rt_views_before as select count(*) n from private.bank_transfer_refund_account_views;

-- 브라우저 세션(authenticated)·anon은 일괄 열람 함수를 부를 수 없다. 서버(service_role)만 부른다.
select pg_temp.rt_assert(not has_function_privilege('authenticated','public.service_export_bank_transfer_refund_accounts(uuid,uuid,uuid,jsonb)','execute')
 and not has_function_privilege('anon','public.service_export_bank_transfer_refund_accounts(uuid,uuid,uuid,jsonb)','execute')
 and has_function_privilege('service_role','public.service_export_bank_transfer_refund_accounts(uuid,uuid,uuid,jsonb)','execute'),
 'bulk account reveal is service-only');
set local role authenticated;
select pg_temp.rt_auth();
select pg_temp.rt_error(format('select public.service_export_bank_transfer_refund_accounts(%L,%L,%L,%L)',
 pg_temp.rt_id('user',1),pg_temp.rt_id('session',1),pg_temp.rt_id('export',99),:'claims123'),'42501');
reset role;

set local role service_role;
select public.service_export_bank_transfer_refund_accounts(pg_temp.rt_id('user',1),pg_temp.rt_id('session',1),pg_temp.rt_id('export',1),:'claims123') as exported \gset
reset role;
select pg_temp.rt_assert(:'exported'::jsonb->>'exportId'=pg_temp.rt_id('export',1)::text
 and jsonb_array_length(:'exported'::jsonb->'rows')=3
 and :'exported'::jsonb->'rows'->0=jsonb_build_object('claimId',pg_temp.rt_id('claim',1),'status','revealed','bankName','TEST 합성은행','accountNumber','000000001231','accountHolder','TEST 합성구매자')
 and :'exported'::jsonb->'rows'->1=jsonb_build_object('claimId',pg_temp.rt_id('claim',2),'status','not_filed','bankName',null,'accountNumber',null,'accountHolder',null)
 and :'exported'::jsonb->'rows'->2=jsonb_build_object('claimId',pg_temp.rt_id('claim',3),'status','unavailable','bankName',null,'accountNumber',null,'accountHolder',null),
 'reveals filed accounts in request order and leaves not-filed/unavailable rows blank');
-- 계좌를 내준 요청만 열람 기록·주문 감사 기록을 남기고, 내려받기 한 번에 요약 기록 하나를 남긴다. 계좌 원문은 기록에 없다.
select pg_temp.rt_assert((select count(*) from private.bank_transfer_refund_account_views)=(select n from rt_views_before)+1
 and exists(select 1 from private.bank_transfer_refund_account_views v where v.claim_id=pg_temp.rt_id('claim',1)
  and v.actor_id=pg_temp.rt_id('user',1) and v.session_id=pg_temp.rt_id('session',1) and v.order_id=pg_temp.rt_id('order',1))
 and exists(select 1 from public.audit_log a join private.bank_transfer_refund_account_views v on v.id=a.id
  where v.claim_id=pg_temp.rt_id('claim',1) and a.action='admin.order.bank_refund_account_viewed' and a.target='order:'||pg_temp.rt_id('order',1)
   and a.diff->>'purpose'='list_export' and a.diff->>'exportId'=pg_temp.rt_id('export',1)::text)
 and (select action='admin.list_export.bank_refund_accounts_revealed' and actor_id=pg_temp.rt_id('user',1) and target='admin_screen:refund-transfers'
   and diff=jsonb_build_object('claimCount',3,'revealedCount',1) from public.audit_log where id=pg_temp.rt_id('export',1))
 and not exists(select 1 from public.audit_log where diff::text like '%00000000123%'),
 'per-claim view audit and one export summary without plaintext');

set local role service_role;
-- 같은 exportId로 다시 열지 못한다(평문을 다시 돌려주지 않는다).
select pg_temp.rt_error(format('select public.service_export_bank_transfer_refund_accounts(%L,%L,%L,%L)',
 pg_temp.rt_id('user',1),pg_temp.rt_id('session',1),pg_temp.rt_id('export',1),:'claims123'),'23505');
-- 목록을 읽은 뒤 요청이 바뀌었으면(리비전) 아무것도 돌려주지 않는다.
select pg_temp.rt_error(format('select public.service_export_bank_transfer_refund_accounts(%L,%L,%L,%L)',
 pg_temp.rt_id('user',1),pg_temp.rt_id('session',1),pg_temp.rt_id('export',2),
 jsonb_build_array(jsonb_build_object('claimId',pg_temp.rt_id('claim',1),'orderId',pg_temp.rt_id('order',1),'revision',0))),'PT409');
-- 다른 주문과 짝지은 요청도 바뀐 목록으로 본다.
select pg_temp.rt_error(format('select public.service_export_bank_transfer_refund_accounts(%L,%L,%L,%L)',
 pg_temp.rt_id('user',1),pg_temp.rt_id('session',1),pg_temp.rt_id('export',3),
 jsonb_build_array(jsonb_build_object('claimId',pg_temp.rt_id('claim',1),'orderId',pg_temp.rt_id('order',2),'revision',(:'claims123'::jsonb->0->>'revision')::integer))),'PT409');
-- 권한이 없는 매니저·다른 사람의 세션·없는 세션은 거절한다.
select pg_temp.rt_error(format('select public.service_export_bank_transfer_refund_accounts(%L,%L,%L,%L)',
 pg_temp.rt_id('user',3),pg_temp.rt_id('session',3),pg_temp.rt_id('export',4),:'claims123'),'42501');
select pg_temp.rt_error(format('select public.service_export_bank_transfer_refund_accounts(%L,%L,%L,%L)',
 pg_temp.rt_id('user',1),pg_temp.rt_id('session',4),pg_temp.rt_id('export',5),:'claims123'),'42501');
select pg_temp.rt_error(format('select public.service_export_bank_transfer_refund_accounts(%L,%L,%L,%L)',
 pg_temp.rt_id('user',1),pg_temp.rt_id('session',99),pg_temp.rt_id('export',6),:'claims123'),'42501');
-- 형식이 다른 요청 목록은 거절한다.
select pg_temp.rt_error(format('select public.service_export_bank_transfer_refund_accounts(%L,%L,%L,%L)',
 pg_temp.rt_id('user',1),pg_temp.rt_id('session',1),pg_temp.rt_id('export',7),bad),'22023')
from (values
 ((:'claims123'::jsonb)||jsonb_build_array(:'claims123'::jsonb->0)),
 (jsonb_build_array((:'claims123'::jsonb->0)-'revision')),
 (jsonb_build_array((:'claims123'::jsonb->0)||'{"accountNumber":"x"}')),
 (jsonb_build_array(jsonb_set(:'claims123'::jsonb->0,'{revision}','"1"'))),
 (jsonb_build_array(jsonb_set(:'claims123'::jsonb->0,'{claimId}','"not-a-uuid"'))),
 ('{"claimId":"x"}'::jsonb),
 (null::jsonb)
) cases(bad);
select pg_temp.rt_error(format('select public.service_export_bank_transfer_refund_accounts(%L,%L,%L,%L)',
 null,pg_temp.rt_id('session',1),pg_temp.rt_id('export',8),:'claims123'),'22023');
reset role;
-- 만료된 세션도 거절한다.
update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id=pg_temp.rt_id('session',4);
set local role service_role;
select pg_temp.rt_error(format('select public.service_export_bank_transfer_refund_accounts(%L,%L,%L,%L)',
 pg_temp.rt_id('user',4),pg_temp.rt_id('session',4),pg_temp.rt_id('export',9),:'claims123'),'42501');
-- 빈 목록도 요약 기록을 남긴다(엑셀은 0건이어도 발급 기록이 이 열람을 가리킨다).
select public.service_export_bank_transfer_refund_accounts(pg_temp.rt_id('user',1),pg_temp.rt_id('session',1),pg_temp.rt_id('export',10),'[]') as empty_export \gset
reset role;
select pg_temp.rt_assert(:'empty_export'::jsonb=jsonb_build_object('exportId',pg_temp.rt_id('export',10),'rows','[]'::jsonb)
 and exists(select 1 from public.audit_log where id=pg_temp.rt_id('export',10) and diff->>'claimCount'='0'),'empty export keeps a summary');

-- 송금을 끝낸 요청은 더 이상 송금 대기가 아니라 바뀐 목록으로 본다.
set local role authenticated;
select pg_temp.rt_auth();
select pg_temp.rt_do(4,24,'complete_transfer');
reset role;
select pg_temp.rt_claims(array[4]) as claims4 \gset
set local role service_role;
select pg_temp.rt_error(format('select public.service_export_bank_transfer_refund_accounts(%L,%L,%L,%L)',
 pg_temp.rt_id('user',1),pg_temp.rt_id('session',1),pg_temp.rt_id('export',11),:'claims4'),'PT409');

-- 발급 감사: 환불 송금 대기 화면을 받고, accountExportId는 같은 운영자의 계좌 열람 요약이어야 한다.
select pg_temp.rt_assert(public.service_record_encrypted_list_export(pg_temp.rt_id('user',1),'refund-transfers',
 jsonb_build_object('accountExportId',pg_temp.rt_id('export',1)),3,3,repeat('a',64)) is not null,'refund transfer file audit');
select pg_temp.rt_assert((select diff->'filters'->>'accountExportId'=pg_temp.rt_id('export',1)::text and target='admin_screen:refund-transfers'
 from public.audit_log where actor_id=pg_temp.rt_id('user',1) and action='admin.list_export.file_issued' order by created_at desc limit 1),'file audit links reveal');
-- 계좌 열을 끈 파일(열람 없음)도 화면은 받는다.
select pg_temp.rt_assert(public.service_record_encrypted_list_export(pg_temp.rt_id('user',1),'refund-transfers','{}',3,3,repeat('b',64)) is not null,'no-account file audit');
select pg_temp.rt_error(format('select public.service_record_encrypted_list_export(%L,%L,%L,3,3,%L)',pg_temp.rt_id('user',4),'refund-transfers',
 jsonb_build_object('accountExportId',pg_temp.rt_id('export',1)),repeat('a',64)),'22023');
select pg_temp.rt_error(format('select public.service_record_encrypted_list_export(%L,%L,%L,3,3,%L)',pg_temp.rt_id('user',1),'refund-transfers',
 jsonb_build_object('accountExportId',gen_random_uuid()),repeat('a',64)),'22023');
select pg_temp.rt_error(format('select public.service_record_encrypted_list_export(%L,%L,%L,3,3,%L)',pg_temp.rt_id('user',1),'refund-transfers',
 jsonb_build_object('accountExportId','not-a-uuid'),repeat('a',64)),'22023');
select pg_temp.rt_error(format('select public.service_record_encrypted_list_export(%L,%L,%L,3,3,%L)',pg_temp.rt_id('user',1),'refund-transfers',
 jsonb_build_object('accountExportId',null),repeat('a',64)),'22023');
select pg_temp.rt_error(format('select public.service_record_encrypted_list_export(%L,%L,%L,3,3,%L)',pg_temp.rt_id('user',1),'claims-cancels',
 jsonb_build_object('accountExportId',pg_temp.rt_id('export',1)),repeat('a',64)),'22023');
select pg_temp.rt_error(format('select public.service_record_encrypted_list_export(%L,%L,%L,3,3,%L)',pg_temp.rt_id('user',3),'refund-transfers','{}',repeat('a',64)),'42501');
reset role;

-- 무통장 재고 부족 부분 취소(ADR-0032)의 송금 대기도 같은 목록·같은 내려받기 번호의 계좌 열람에 합친다.
-- 원장 행은 합성으로 바로 넣는다(시작·적용·송금 완료는 order_partial_cancellation.sql이 본다). 스위치가 꺼져 있으면 이런 행이 없다.
insert into public.orders(id,user_id,status,total,shipping_fee,address,payment_method,created_at)
 values(pg_temp.rt_id('order',5),pg_temp.rt_id('user',2),'confirmed',10000,0,
 '{"recipientName":"TEST 구매자","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}','bank_transfer',clock_timestamp()-interval '2 days');
insert into public.payments(id,user_id,provider,purpose,ref_id,amount,status,payment_key,idempotency_key,created_at)
 values(pg_temp.rt_id('payment',5),pg_temp.rt_id('user',2),'bank_transfer','order',pg_temp.rt_id('order',5),10000,'paid',
 'bank_transfer:'||pg_temp.rt_id('order',5),'refund-export-test-5',clock_timestamp()-interval '1 hour');
insert into private.order_partial_cancellations(id,order_id,payment_id,provider,sequence,reason_code,customer_decision,warehouse_stop_confirmed,
 payment_amount,balance_before,goods_refund_amount,shipping_refund_amount,refund_amount,store_credit_restore_amount,state,operation_id,created_by,
 applied_at,filed_at,filed_by)
 values(pg_temp.rt_id('partial',1),pg_temp.rt_id('order',5),pg_temp.rt_id('payment',5),'bank_transfer',1,'out_of_stock','TEST 고객 결정 — 품절분만 취소',false,
 10000,10000,5000,0,5000,0,'awaiting_transfer',pg_temp.rt_id('operation',51),pg_temp.rt_id('user',1),clock_timestamp(),clock_timestamp(),pg_temp.rt_id('user',1));
insert into private.order_partial_cancellation_refund_accounts(partial_cancellation_id,bank_name,account_number,account_holder,masked_account,masked_holder)
 values(pg_temp.rt_id('partial',1),'TEST 합성은행','000000005555','TEST 합성구매자','TEST 합성은행 ********5555','T*********');
set local role authenticated;
select pg_temp.rt_auth();
select pg_temp.rt_assert((select (page->>'total')::integer=4 and jsonb_array_length(page->'rows')=4
  and (select count(*)=1 from jsonb_array_elements(page->'rows') r where r@>jsonb_build_object('kind','partial_cancellation',
   'partialCancellationId',pg_temp.rt_id('partial',1),'orderId',pg_temp.rt_id('order',5),'sequence',1,'amount',5000,'gift',false) and r->>'filedAt' is not null)
  and (select count(*)=3 from jsonb_array_elements(page->'rows') r where r ? 'claimId')
 from (select public.admin_list_bank_transfer_refunds_numbered(50,0) page) s),'queue merges partial cancellation transfers');
reset role;
create function pg_temp.rt_partial_items(order_n integer) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('partialCancellationId',pg_temp.rt_id('partial',1),'orderId',pg_temp.rt_id('order',order_n)))$$;
set local role service_role;
select pg_temp.rt_assert(public.service_export_order_partial_cancellation_refund_accounts(pg_temp.rt_id('user',1),pg_temp.rt_id('session',1),pg_temp.rt_id('export',12),
 pg_temp.rt_partial_items(5))=jsonb_build_object('exportId',pg_temp.rt_id('export',12),'rows',jsonb_build_array(jsonb_build_object('partialCancellationId',pg_temp.rt_id('partial',1),
  'status','revealed','bankName','TEST 합성은행','accountNumber','000000005555','accountHolder','TEST 합성구매자'))),'partial account revealed in the same export');
-- 물류 매니저·짝이 틀린 주문은 거절한다.
select pg_temp.rt_error(format('select public.service_export_order_partial_cancellation_refund_accounts(%L,%L,%L,%L)',
 pg_temp.rt_id('user',3),pg_temp.rt_id('session',3),pg_temp.rt_id('export',13),pg_temp.rt_partial_items(5)),'42501');
select pg_temp.rt_error(format('select public.service_export_order_partial_cancellation_refund_accounts(%L,%L,%L,%L)',
 pg_temp.rt_id('user',1),pg_temp.rt_id('session',1),pg_temp.rt_id('export',14),pg_temp.rt_partial_items(1)),'PT409');
reset role;
select pg_temp.rt_assert(exists(select 1 from public.audit_log where action='admin.order.partial_cancellation_account_viewed'
  and diff->>'partialCancellationId'=pg_temp.rt_id('partial',1)::text and diff->>'exportId'=pg_temp.rt_id('export',12)::text and diff->>'purpose'='list_export')
 and exists(select 1 from public.audit_log where action='admin.list_export.partial_cancel_refund_accounts_revealed' and actor_id=pg_temp.rt_id('user',1)
  and diff->>'exportId'=pg_temp.rt_id('export',12)::text and (diff->>'revealedCount')::integer=1)
 and not exists(select 1 from public.audit_log where diff::text like '%000000005555%')
 and not has_function_privilege('authenticated','public.service_export_order_partial_cancellation_refund_accounts(uuid,uuid,uuid,jsonb)','execute')
 and has_function_privilege('service_role','public.service_export_order_partial_cancellation_refund_accounts(uuid,uuid,uuid,jsonb)','execute'),
 'partial account reveal is audited without plaintext and service-only');
rollback;
